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

function balanceField(metric) {
  if (metric === 'EXPERIENCE') return 'experience_balance'
  if (metric === 'CONTRIBUTION') return 'contribution_balance'
  if (metric === 'COIN') return 'coin_balance'
  throw new Error('GROWTH_RULE_NOT_AVAILABLE')
}

function levelSnapshot(account, levels) {
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
    currentLevel: levelDto(current),
    levelProgressPercent: 100,
  }
  if (next) {
    const span = Number(next.minimum_experience) - Number(current.minimum_experience)
    dto.nextLevel = levelDto(next)
    dto.experienceToNextLevel = Math.max(0, Number(next.minimum_experience) - experience)
    dto.levelProgressPercent = Math.max(0, Math.min(100, Math.floor(
      (experience - Number(current.minimum_experience)) / span * 100,
    )))
  }
  return dto
}

function accountDto(row) {
  return {
    userId: row.user_id,
    experienceBalance: Number(row.experience_balance),
    contributionBalance: Number(row.contribution_balance),
    coinBalance: Number(row.coin_balance),
    version: Number(row.version),
  }
}

function levelDto(row) {
  return {
    id: row.id,
    levelKey: row.level_key,
    name: row.name,
    minimumExperience: Number(row.minimum_experience),
    benefits: jsonArray(row.benefits_json),
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

module.exports = { accountDto, balanceField, levelDto, levelSnapshot, projectAward }
