'use strict'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const RANKING_TYPES = new Set(['TEAM_HALF_YEAR', 'TEAM_YEAR', 'INDIVIDUAL_SEASON', 'INDIVIDUAL_ALL_TIME'])
const MAX_ASSIGNABLE_MEMBER_PAGE_SIZE = 100
const MAX_TEAM_MEMBERS = 100

function requiredId(value) {
  const result = typeof value === 'string' ? value.trim() : ''
  if (!UUID_PATTERN.test(result)) throw new Error('VALIDATION_FAILED')
  return result
}

function optionalId(value) {
  return value ? requiredId(value) : null
}

function expectedVersion(value) {
  const result = Number(value)
  if (!Number.isSafeInteger(result) || result < 1) throw new Error('VALIDATION_FAILED')
  return result
}

function boundedText(value, maximum, required = false) {
  const result = typeof value === 'string' ? value.trim() : ''
  if ((required && !result) || result.length > maximum) throw new Error('VALIDATION_FAILED')
  return result
}

function dateTime(value) {
  const result = boundedText(value, 40, true)
  const parsed = new Date(result)
  if (!Number.isFinite(parsed.getTime())) throw new Error('VALIDATION_FAILED')
  return parsed.toISOString().slice(0, 23).replace('T', ' ')
}

function dateOnly(value) {
  const result = boundedText(value, 10, true)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result) || !Number.isFinite(new Date(`${result}T00:00:00Z`).getTime())) {
    throw new Error('VALIDATION_FAILED')
  }
  return result
}

function normalizeSeason(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('VALIDATION_FAILED')
  const periodKind = boundedText(value.periodKind, 16, true).toUpperCase()
  if (!['HALF_YEAR', 'YEAR', 'CUSTOM'].includes(periodKind)) throw new Error('VALIDATION_FAILED')
  const startsAt = dateTime(value.startsAt)
  const endsAt = dateTime(value.endsAt)
  if (new Date(startsAt).getTime() >= new Date(endsAt).getTime()) throw new Error('VALIDATION_FAILED')
  return {
    seasonKey: boundedText(value.seasonKey, 64, true),
    name: boundedText(value.name, 100, true),
    summary: boundedText(value.summary, 500),
    rulesText: boundedText(value.rulesText, 4000, true),
    rules: normalizeRules(value.rules),
    periodKind,
    startsAt,
    endsAt,
  }
}

function normalizeRules(value) {
  const defaults = [
    { level: 1, minimumExperience: 0, label: '一级大本营' },
    { level: 2, minimumExperience: 500, label: '二级大本营' },
    { level: 3, minimumExperience: 1500, label: '三级大本营' },
    { level: 4, minimumExperience: 3000, label: '四级大本营' },
  ]
  if (value === undefined || value === null) return { scoreMetric: 'EXPERIENCE', headquartersThresholds: defaults }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('VALIDATION_FAILED')
  const thresholds = Array.isArray(value.headquartersThresholds) ? value.headquartersThresholds : defaults
  if (thresholds.length < 1 || thresholds.length > 8) throw new Error('VALIDATION_FAILED')
  let previous = -1
  const normalized = thresholds.map((item, index) => {
    const minimumExperience = Number(item?.minimumExperience)
    const level = Number(item?.level ?? index + 1)
    if (!Number.isSafeInteger(minimumExperience) || minimumExperience < 0 || minimumExperience <= previous
      || !Number.isSafeInteger(level) || level !== index + 1) throw new Error('VALIDATION_FAILED')
    previous = minimumExperience
    return { level, minimumExperience, label: boundedText(item?.label, 80, true) }
  })
  if (normalized[0].minimumExperience !== 0) throw new Error('VALIDATION_FAILED')
  return { scoreMetric: 'EXPERIENCE', headquartersThresholds: normalized }
}

function normalizeTeam(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('VALIDATION_FAILED')
  const memberLimit = value.memberLimit === undefined ? undefined : Number(value.memberLimit)
  if (memberLimit !== undefined
    && (!Number.isSafeInteger(memberLimit) || memberLimit < 1 || memberLimit > MAX_TEAM_MEMBERS)) {
    throw new Error('VALIDATION_FAILED')
  }
  return {
    seasonId: requiredId(value.seasonId),
    branchId: optionalId(value.branchId),
    name: boundedText(value.name, 100, true),
    summary: boundedText(value.summary, 500),
    memberLimit,
  }
}

function normalizeMembers(value) {
  if (!Array.isArray(value)) throw new Error('VALIDATION_FAILED')
  if (value.length > MAX_TEAM_MEMBERS) throw new Error('MEMBER_LIMIT_EXCEEDED')
  const seen = new Set()
  return value.map((item) => {
    const memberRef = boundedText(item?.memberRef, 200, true)
    const role = boundedText(item?.role, 16, true).toUpperCase()
    if (!['CAPTAIN', 'MEMBER'].includes(role) || seen.has(memberRef)) throw new Error('VALIDATION_FAILED')
    seen.add(memberRef)
    return { memberRef, role }
  })
}

function memberPageLimit(value) {
  if (value === undefined || value === null) throw new Error('PAGINATION_REQUIRED')
  const result = Number(value)
  if (!Number.isSafeInteger(result) || result < 1 || result > MAX_ASSIGNABLE_MEMBER_PAGE_SIZE) {
    throw new Error('VALIDATION_FAILED')
  }
  return result
}

function normalizeMatch(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('VALIDATION_FAILED')
  const firstTeamId = requiredId(value.teamAId)
  const secondTeamId = requiredId(value.teamBId)
  const weekStart = dateOnly(value.weekStart)
  const weekEnd = dateOnly(value.weekEnd)
  const durationDays = (new Date(`${weekEnd}T00:00:00Z`).getTime()
    - new Date(`${weekStart}T00:00:00Z`).getTime()) / 86_400_000
  if (firstTeamId === secondTeamId || durationDays !== 6) throw new Error('VALIDATION_FAILED')
  const [teamAId, teamBId] = [firstTeamId, secondTeamId].sort()
  return { seasonId: requiredId(value.seasonId), teamAId, teamBId, weekStart, weekEnd }
}

function rankingType(value) {
  const result = boundedText(value, 32, true).toUpperCase()
  if (!RANKING_TYPES.has(result)) throw new Error('VALIDATION_FAILED')
  return result
}

function assertNoClientScore(value, depth = 0) {
  if (!value || typeof value !== 'object' || depth > 5) return
  for (const [key, child] of Object.entries(value)) {
    if (/(^|_)(score|points?)$/i.test(key) || /Score$/.test(key)) throw new Error('SCORE_NOT_ACCEPTED')
    assertNoClientScore(child, depth + 1)
  }
}

module.exports = {
  MAX_ASSIGNABLE_MEMBER_PAGE_SIZE,
  MAX_TEAM_MEMBERS,
  assertNoClientScore,
  boundedText,
  dateTime,
  expectedVersion,
  memberPageLimit,
  normalizeMatch,
  normalizeMembers,
  normalizeSeason,
  normalizeTeam,
  optionalId,
  rankingType,
  requiredId,
}
