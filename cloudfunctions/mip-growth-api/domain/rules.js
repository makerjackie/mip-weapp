'use strict'

function projectAward(account, rule, awardedToday) {
  const requested = Number(rule.delta_value)
  if (rule.status !== 'ACTIVE' || !Number.isSafeInteger(requested) || requested === 0) {
    throw new Error('GROWTH_RULE_NOT_AVAILABLE')
  }
  if (!Number.isSafeInteger(awardedToday) || awardedToday < 0) {
    throw new Error('GROWTH_DAILY_TOTAL_INVALID')
  }
  const dailyLimit = rule.daily_limit_value === null || rule.daily_limit_value === undefined
    ? null
    : Number(rule.daily_limit_value)
  let applied = requested
  if (requested > 0 && dailyLimit !== null) {
    applied = Math.min(requested, Math.max(0, dailyLimit - awardedToday))
  }
  const field = balanceField(rule.metric)
  const balanceAfter = Number(account[field]) + applied
  if (!Number.isSafeInteger(balanceAfter) || balanceAfter < 0) {
    throw new Error('GROWTH_BALANCE_INVALID')
  }
  return { field, requested, applied, balanceAfter, capped: applied !== requested }
}

function selectApplicableRules(rows, branchId, occurredAt) {
  const timestamp = new Date(occurredAt || Date.now())
  if (!Number.isFinite(timestamp.getTime())) throw new Error('GROWTH_EVENT_TIME_INVALID')
  const applicable = rows.filter((rule) => {
    const scopeType = rule.scope_type || 'PLATFORM'
    const scopeMatches = scopeType === 'PLATFORM'
      ? !rule.scope_id
      : scopeType === 'BRANCH' && Boolean(branchId) && rule.scope_id === branchId
    if (!scopeMatches) return false
    const from = rule.effective_from ? new Date(rule.effective_from) : null
    const to = rule.effective_to ? new Date(rule.effective_to) : null
    return (!from || timestamp >= from) && (!to || timestamp < to)
  })
  const selected = new Map()
  for (const rule of applicable.sort((left, right) => (
    (left.scope_type === 'BRANCH' ? 0 : 1) - (right.scope_type === 'BRANCH' ? 0 : 1)
      || String(left.id).localeCompare(String(right.id))
  ))) {
    const prior = selected.get(rule.metric)
    if (!prior) {
      selected.set(rule.metric, rule)
      continue
    }
    const priorSpecific = prior.scope_type === 'BRANCH' ? 0 : 1
    const currentSpecific = rule.scope_type === 'BRANCH' ? 0 : 1
    if (priorSpecific === currentSpecific) throw new Error('GROWTH_RULE_CONFLICT')
  }
  return [...selected.values()]
}

function balanceField(metric) {
  if (metric === 'EXPERIENCE') return 'experience_balance'
  if (metric === 'CONTRIBUTION') return 'contribution_balance'
  if (metric === 'COIN') return 'coin_balance'
  throw new Error('GROWTH_RULE_NOT_AVAILABLE')
}

// MIW-104：等级号唯一事实 = level_key 的 lvNN 约定（admin-web 新建等级按此生成）；
// display_badge（"Lv.N"）次之；两者都解析不出（历史随机 key/演示数据）回退快照位置序数。
// 与 mip-events-api / mip-opportunities-api 的 public-person-details 同口径，三处同步维护。
function parseLevelNumber(levelKey, displayBadge) {
  const key = typeof levelKey === 'string' ? /^lv0*(\d{1,4})$/i.exec(levelKey.trim()) : null
  if (key && Number(key[1]) >= 1) return Number(key[1])
  const badge = typeof displayBadge === 'string'
    ? /^lv\.?\s*0*(\d{1,4})(?:\s|$)/i.exec(displayBadge.trim())
    : null
  if (badge && Number(badge[1]) >= 1) return Number(badge[1])
  return null
}

function levelSnapshot(account, levels, rules = []) {
  const active = levels
    .filter(level => level.status === 'ACTIVE')
    .sort((left, right) => Number(left.minimum_experience) - Number(right.minimum_experience))
  if (!active.length || Number(active[0].minimum_experience) !== 0) {
    throw new Error('GROWTH_LEVEL_BASE_REQUIRED')
  }
  const experience = Number(account.experience_balance)
  const currentIndex = active.reduce((result, level, index) => (
    Number(level.minimum_experience) <= experience ? index : result
  ), 0)
  const current = active[currentIndex]
  const next = active[currentIndex + 1]
  const dto = {
    account: accountDto(account),
    currentLevel: levelDto(current, currentIndex),
    levels: active.map((level, index) => levelDto(level, index)),
    earningRules: rules.filter(rule => supportedMetric(rule.metric)).map(ruleDto),
    levelProgressPercent: 100,
  }
  if (next) {
    const span = Number(next.minimum_experience) - Number(current.minimum_experience)
    dto.nextLevel = levelDto(next, currentIndex + 1)
    dto.experienceToNextLevel = Math.max(0, Number(next.minimum_experience) - experience)
    dto.levelProgressPercent = Math.max(0, Math.min(100, Math.floor(
      (experience - Number(current.minimum_experience)) / span * 100,
    )))
  }
  return dto
}

function ruleDto(row) {
  if (!supportedMetric(row.metric)) throw new Error('GROWTH_RULE_NOT_AVAILABLE')
  return {
    id: row.id,
    ruleKey: row.rule_key,
    name: row.name,
    metric: row.metric,
    deltaValue: Number(row.delta_value),
    dailyLimitValue: row.daily_limit_value === null || row.daily_limit_value === undefined
      ? undefined
      : Number(row.daily_limit_value),
    sourceEventType: row.source_event_type,
    status: row.status,
  }
}

function accountDto(row) {
  return {
    userId: row.user_id,
    experienceBalance: Number(row.experience_balance),
    contributionBalance: Number(row.contribution_balance),
    coinBalance: Number(row.coin_balance || 0),
    version: Number(row.version),
  }
}

function supportedMetric(metric) {
  return metric === 'EXPERIENCE' || metric === 'CONTRIBUTION' || metric === 'COIN'
}

// MIW-83：权益统一为 { name, description? } 对象；legacy 内联字符串与关联表对象双态归一。
function benefitsDto(value) {
  return jsonArray(value)
    .map((entry) => {
      if (typeof entry === 'string' && entry) return { name: entry }
      if (entry && typeof entry === 'object' && typeof entry.name === 'string' && entry.name) {
        return typeof entry.description === 'string' && entry.description
          ? { name: entry.name, description: entry.description }
          : { name: entry.name }
      }
      return null
    })
    .filter(Boolean)
}

function levelDto(row, position = 0) {
  return {
    id: row.id,
    levelKey: row.level_key,
    // MIW-104：等级号随快照下发（跳号等级如 1/3/5/8/…/60），客户端不再按位置派生。
    levelNumber: parseLevelNumber(row.level_key, row.display_badge) ?? position + 1,
    name: row.name,
    minimumExperience: Number(row.minimum_experience),
    benefits: benefitsDto(row.benefits_json),
    status: row.status,
  }
}

function jsonArray(value) {
  if (Array.isArray(value)) return value
  try {
    const parsed = JSON.parse(value || '[]')
    return Array.isArray(parsed) ? parsed : []
  }
  catch {
    return []
  }
}

module.exports = {
  accountDto,
  balanceField,
  benefitsDto,
  levelDto,
  levelSnapshot,
  projectAward,
  ruleDto,
  selectApplicableRules,
  supportedMetric,
}
