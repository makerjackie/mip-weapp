import type {
  GrowthAccount,
  GrowthEntryProjection,
  GrowthLevel,
  GrowthMetric,
  GrowthRule,
  GrowthSnapshot,
} from './types'

function balanceFor(account: GrowthAccount, metric: GrowthMetric) {
  if (metric === 'EXPERIENCE') {
    return account.experienceBalance
  }
  return account.contributionBalance
}

export function validateGrowthLevels(levels: readonly GrowthLevel[]) {
  const active = levels
    .filter(level => level.status === 'ACTIVE')
    .sort((left, right) => left.minimumExperience - right.minimumExperience)
  if (!active.length || active[0]?.minimumExperience !== 0) {
    throw new Error('GROWTH_LEVEL_BASE_REQUIRED')
  }
  for (let index = 1; index < active.length; index += 1) {
    if (active[index].minimumExperience <= active[index - 1].minimumExperience) {
      throw new Error('GROWTH_LEVEL_THRESHOLDS_INVALID')
    }
  }
  return active
}

export function resolveGrowthLevel(levels: readonly GrowthLevel[], experience: number) {
  if (!Number.isSafeInteger(experience) || experience < 0) {
    throw new Error('GROWTH_EXPERIENCE_INVALID')
  }
  return validateGrowthLevels(levels)
    .filter(level => level.minimumExperience <= experience)
    .at(-1) as GrowthLevel
}

export function projectGrowthEntry(
  account: GrowthAccount,
  rule: GrowthRule,
  awardedToday: number,
): GrowthEntryProjection {
  if (rule.status !== 'ACTIVE' || !Number.isSafeInteger(rule.deltaValue) || rule.deltaValue === 0) {
    throw new Error('GROWTH_RULE_NOT_AVAILABLE')
  }
  if (!Number.isSafeInteger(awardedToday) || awardedToday < 0) {
    throw new Error('GROWTH_DAILY_TOTAL_INVALID')
  }
  let appliedDelta = rule.deltaValue
  if (rule.deltaValue > 0 && rule.dailyLimitValue !== undefined) {
    const remaining = Math.max(0, rule.dailyLimitValue - awardedToday)
    appliedDelta = Math.min(rule.deltaValue, remaining)
  }
  const balanceAfter = balanceFor(account, rule.metric) + appliedDelta
  if (!Number.isSafeInteger(balanceAfter) || balanceAfter < 0) {
    throw new Error('GROWTH_BALANCE_INVALID')
  }
  return {
    metric: rule.metric,
    requestedDelta: rule.deltaValue,
    appliedDelta,
    balanceAfter,
    capped: appliedDelta !== rule.deltaValue,
  }
}

export function applyGrowthProjection(
  account: GrowthAccount,
  projection: GrowthEntryProjection,
): GrowthAccount {
  const next = { ...account, version: account.version + 1 }
  if (projection.metric === 'EXPERIENCE') {
    next.experienceBalance = projection.balanceAfter
  }
  else {
    next.contributionBalance = projection.balanceAfter
  }
  return next
}

export function buildGrowthSnapshot(
  account: GrowthAccount,
  levels: readonly GrowthLevel[],
): GrowthSnapshot {
  const active = validateGrowthLevels(levels)
  const currentLevel = resolveGrowthLevel(active, account.experienceBalance)
  const currentIndex = active.findIndex(level => level.id === currentLevel.id)
  const nextLevel = active[currentIndex + 1]
  if (!nextLevel) {
    return {
      account,
      currentLevel,
      levels: active,
      earningRules: [],
      levelProgressPercent: 100,
    }
  }
  const levelSpan = nextLevel.minimumExperience - currentLevel.minimumExperience
  const earnedWithinLevel = account.experienceBalance - currentLevel.minimumExperience
  return {
    account,
    currentLevel,
    levels: active,
    earningRules: [],
    nextLevel,
    experienceToNextLevel: Math.max(0, nextLevel.minimumExperience - account.experienceBalance),
    levelProgressPercent: Math.max(0, Math.min(100, Math.floor(earnedWithinLevel / levelSpan * 100))),
  }
}
