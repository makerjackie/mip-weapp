'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const { levelSnapshot, projectAward } = require('../domain/rules')

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
  assert.throws(() => projectAward({ coin_balance: 3 }, {
    metric: 'COIN',
    delta_value: -4,
    daily_limit_value: null,
    status: 'ACTIVE',
  }, 0), /GROWTH_BALANCE_INVALID/)
})

test('snapshot derives the active level from server thresholds', () => {
  const result = levelSnapshot({
    user_id: 'user-id',
    experience_balance: 120,
    contribution_balance: 8,
    coin_balance: 2,
    version: 3,
  }, [
    { id: 'one', level_key: 'one', name: '一级', minimum_experience: 0, benefits_json: '[]', status: 'ACTIVE' },
    { id: 'two', level_key: 'two', name: '二级', minimum_experience: 100, benefits_json: '["活动权益"]', status: 'ACTIVE' },
    { id: 'three', level_key: 'three', name: '三级', minimum_experience: 200, benefits_json: '[]', status: 'ACTIVE' },
  ])
  assert.equal(result.currentLevel.levelKey, 'two')
  assert.equal(result.experienceToNextLevel, 80)
  assert.equal(result.levelProgressPercent, 20)
})
