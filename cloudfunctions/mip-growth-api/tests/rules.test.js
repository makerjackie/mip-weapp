'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const { accountDto, levelSnapshot, projectAward, selectApplicableRules } = require('../domain/rules')

test('server rule caps a positive award at the daily limit', () => {
  const projection = projectAward({ experience_balance: 90 }, {
    metric: 'EXPERIENCE',
    delta_value: 20,
    daily_limit_value: 30,
    status: 'ACTIVE',
  }, 25)
  assert.deepEqual(projection, {
    field: 'experience_balance',
    requested: 20,
    applied: 5,
    balanceAfter: 95,
    capped: true,
  })
})

test('server rule refuses to create a negative balance', () => {
  assert.throws(() => projectAward({ contribution_balance: 3 }, {
    metric: 'CONTRIBUTION',
    delta_value: -4,
    daily_limit_value: null,
    status: 'ACTIVE',
  }, 0), /GROWTH_BALANCE_INVALID/)
})

test('server projects game coin awards and protects the balance', () => {
  assert.deepEqual(projectAward({ coin_balance: 3 }, {
    metric: 'COIN',
    delta_value: 1,
    daily_limit_value: null,
    status: 'ACTIVE',
  }, 0), {
    field: 'coin_balance',
    requested: 1,
    applied: 1,
    balanceAfter: 4,
    capped: false,
  })
  assert.throws(() => projectAward({ coin_balance: 3 }, {
    metric: 'COIN',
    delta_value: -4,
    daily_limit_value: null,
    status: 'ACTIVE',
  }, 0), /GROWTH_BALANCE_INVALID/)
  assert.deepEqual(accountDto({
    user_id: 'user-id',
    experience_balance: 1,
    contribution_balance: 2,
    coin_balance: 3,
    version: 4,
  }), {
    userId: 'user-id',
    experienceBalance: 1,
    contributionBalance: 2,
    coinBalance: 3,
    version: 4,
  })
})

test('selects the branch rule before the platform fallback inside its effective window', () => {
  const rows = [
    { id: 'platform', metric: 'EXPERIENCE', scope_type: 'PLATFORM', scope_id: null, effective_from: null, effective_to: null },
    { id: 'branch', metric: 'EXPERIENCE', scope_type: 'BRANCH', scope_id: 'branch-a', effective_from: '2026-08-01 00:00:00.000', effective_to: '2026-09-01 00:00:00.000' },
  ]
  assert.deepEqual(
    selectApplicableRules(rows, 'branch-a', '2026-08-20 00:00:00.000').map(row => row.id),
    ['branch'],
  )
  assert.deepEqual(
    selectApplicableRules(rows, 'branch-a', '2026-09-01 00:00:00.000').map(row => row.id),
    ['platform'],
  )
})

test('rejects two equally specific active rules for one event and metric', () => {
  assert.throws(() => selectApplicableRules([
    { id: 'branch-a', metric: 'EXPERIENCE', scope_type: 'BRANCH', scope_id: 'branch-a' },
    { id: 'branch-b', metric: 'EXPERIENCE', scope_type: 'BRANCH', scope_id: 'branch-a' },
  ], 'branch-a', '2026-08-20 00:00:00.000'), /GROWTH_RULE_CONFLICT/)
})

test('snapshot derives the active level from server thresholds', () => {
  const result = levelSnapshot({
    user_id: 'user-id',
    experience_balance: 120,
    contribution_balance: 8,
    coin_balance: 5,
    version: 3,
  }, [
    { id: 'one', level_key: 'one', name: '一级', minimum_experience: 0, benefits_json: '[]', status: 'ACTIVE' },
    { id: 'two', level_key: 'two', name: '二级', minimum_experience: 100, benefits_json: '["活动权益"]', status: 'ACTIVE' },
    { id: 'three', level_key: 'three', name: '三级', minimum_experience: 200, benefits_json: '[]', status: 'ACTIVE' },
  ], [{
    id: 'rule-one',
    rule_key: 'event_attended',
    name: '完成活动签到',
    metric: 'EXPERIENCE',
    delta_value: 100,
    daily_limit_value: 300,
    source_event_type: 'event.checked_in',
    status: 'ACTIVE',
  }, {
    id: 'rule-two',
    rule_key: 'case_published',
    name: '发布超级案例',
    metric: 'EXPERIENCE',
    delta_value: 50,
    daily_limit_value: null,
    source_event_type: 'super_case.published',
    status: 'ACTIVE',
  }])
  assert.equal(result.currentLevel.levelKey, 'two')
  assert.deepEqual(result.levels.map(level => level.levelKey), ['one', 'two', 'three'])
  // MIW-104：非 lvNN key（历史随机/演示数据）回退位置序数，旧口径不回归。
  assert.deepEqual(result.levels.map(level => level.levelNumber), [1, 2, 3])
  assert.equal(result.currentLevel.levelNumber, 2)
  assert.equal(result.nextLevel.levelNumber, 3)
  assert.deepEqual(result.earningRules, [{
    id: 'rule-one',
    ruleKey: 'event_attended',
    name: '完成活动签到',
    metric: 'EXPERIENCE',
    deltaValue: 100,
    dailyLimitValue: 300,
    sourceEventType: 'event.checked_in',
    status: 'ACTIVE',
  }, {
    id: 'rule-two',
    ruleKey: 'case_published',
    name: '发布超级案例',
    metric: 'EXPERIENCE',
    deltaValue: 50,
    dailyLimitValue: undefined,
    sourceEventType: 'super_case.published',
    status: 'ACTIVE',
  }])
  assert.equal(result.experienceToNextLevel, 80)
  assert.equal(result.levelProgressPercent, 20)
})


// MIW-104：等级号唯一事实 = level_key lvNN 约定；display_badge 次之；位置序数兜底。
test('snapshot levelNumber parses the lvNN convention for skip-numbered ladders', () => {
  const levels = [
    ['lv01', 'Lv.1', 0],
    ['lv03', 'Lv.3', 300],
    ['lv05', 'Lv.5', 500],
    ['lv08', 'Lv.8', 800],
    ['lv60', 'Lv.60', 6000],
  ].map(([level_key, name, minimum_experience]) => ({
    id: level_key, level_key, display_badge: name, name,
    minimum_experience, benefits_json: '[]', status: 'ACTIVE',
  }))
  const result = levelSnapshot({
    user_id: 'user-id', experience_balance: 600, contribution_balance: 0, coin_balance: 0, version: 1,
  }, levels, [])
  assert.deepEqual(result.levels.map(level => level.levelNumber), [1, 3, 5, 8, 60])
  // 600 经验落在 lv05（第 3 档），当前等级号显示业务号 5 而非位置序数 3。
  assert.equal(result.currentLevel.levelNumber, 5)
  assert.equal(result.nextLevel.levelNumber, 8)
})

test('snapshot levelNumber falls back to display_badge then position', () => {
  const result = levelSnapshot({
    user_id: 'user-id', experience_balance: 0, contribution_balance: 0, coin_balance: 0, version: 1,
  }, [
    { id: 'a', level_key: 'hex0af10c2e11ab30f', display_badge: '', name: '起步', minimum_experience: 0, benefits_json: '[]', status: 'ACTIVE' },
    { id: 'b', level_key: 'another-hex-key', display_badge: 'Lv.9 先锋', name: '先锋', minimum_experience: 100, benefits_json: '[]', status: 'ACTIVE' },
    { id: 'c', level_key: 'lv0', display_badge: 'Lv.0', name: '零号', minimum_experience: 200, benefits_json: '[]', status: 'ACTIVE' },
  ], [])
  // hex key 无 display_badge → 位置 1；hex key + "Lv.9" badge → 9；lv0/Lv.0 非法（<1）→ 位置 3。
  assert.deepEqual(result.levels.map(level => level.levelNumber), [1, 9, 3])
})
