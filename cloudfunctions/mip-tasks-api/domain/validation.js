'use strict'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function requiredId(value) {
  const result = typeof value === 'string' ? value.trim() : ''
  if (!UUID_PATTERN.test(result)) throw new Error('VALIDATION_FAILED')
  return result
}

function expectedVersion(value) {
  const result = Number(value)
  if (!Number.isSafeInteger(result) || result < 1) throw new Error('VALIDATION_FAILED')
  return result
}

function normalizeTask(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('VALIDATION_FAILED')
  const name = boundedText(value.name, 100, true)
  const content = boundedText(value.content, 5000, true)
  const rewardExperience = Number(value.rewardExperience ?? (value.rewardConfig?.experience?.enabled ? value.rewardConfig.experience.amount : 0))
  if (!Number.isSafeInteger(rewardExperience) || rewardExperience < 0 || rewardExperience > 1_000_000) {
    throw new Error('VALIDATION_FAILED')
  }
  const assignmentMode = boundedText(value.assignmentMode || 'ALL', 16).toUpperCase()
  if (!['ALL', 'SELECTED'].includes(assignmentMode)) throw new Error('VALIDATION_FAILED')
  const eligibleLevelIds = Object.prototype.hasOwnProperty.call(value, 'eligibleLevelIds')
    ? normalizeEligibleLevelIds(value.eligibleLevelIds)
    : undefined
  const extensions = normalizeTaskExtensions(value)
  return {
    ...extensions,
    ...normalizeTaskAction(value),
    name,
    content,
    rewardExperience,
    attachmentRequired: value.attachmentRequired === true,
    assignmentMode,
    endsAt: optionalDate(value.endsAt),
    templateAssetId: value.templateAssetId ? requiredId(value.templateAssetId) : null,
    eligibleLevelIds,
  }
}

// MIW-84：任务点击动作（后台按任务配置玩家端「去完成」的行为）。
// PAGE_JUMP 必须带目标页路径（存储口径同 config/runtime-pages.json：剥前导 /、禁 query）；
// SHARE 不带目标；两者都缺省 = 未配置（玩家端整卡不可点）。
function normalizeTaskAction(value) {
  const actionType = boundedText(value.actionType || '', 16).toUpperCase()
  if (actionType && !['PAGE_JUMP', 'SHARE'].includes(actionType)) throw new Error('VALIDATION_FAILED')
  const actionTarget = boundedText(value.actionTarget || '', 128).replace(/^\/+/, '')
  if (actionTarget && actionTarget.includes('?')) throw new Error('VALIDATION_FAILED')
  if (actionType === 'PAGE_JUMP' && !actionTarget) throw new Error('VALIDATION_FAILED')
  if (actionTarget && actionType !== 'PAGE_JUMP') throw new Error('VALIDATION_FAILED')
  return { actionType: actionType || null, actionTarget: actionTarget || null }
}

function normalizeEligibleLevelIds(value) {
  if (!Array.isArray(value) || value.length > 50) throw new Error('VALIDATION_FAILED')
  return [...new Set(value.map(requiredId))]
}

function normalizeAssignmentInput(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('VALIDATION_FAILED')
  if (!Array.isArray(value.memberRefs) || value.memberRefs.length < 1 || value.memberRefs.length > 100) {
    throw new Error('VALIDATION_FAILED')
  }
  const memberRefs = [...new Set(value.memberRefs.map((item) => boundedText(item, 200, true)))]
  return { taskId: requiredId(value.taskId), memberRefs }
}

function normalizeMemberFilters(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('VALIDATION_FAILED')
  return {
    taskId: requiredId(value.taskId),
    query: boundedText(value.query, 80),
  }
}

function normalizeTaskFilters(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('VALIDATION_FAILED')
  const status = boundedText(value.status, 16).toUpperCase()
  if (status && !['DRAFT', 'PUBLISHED', 'UNPUBLISHED', 'DELETED'].includes(status)) {
    throw new Error('VALIDATION_FAILED')
  }
  return { status, query: boundedText(value.query, 80) }
}

function normalizeCompletionFilters(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('VALIDATION_FAILED')
  const resultStatus = boundedText(value.resultStatus, 16).toUpperCase()
  if (resultStatus && !['SUCCESS', 'FAILED'].includes(resultStatus)) throw new Error('VALIDATION_FAILED')
  return {
    taskId: value.taskId ? requiredId(value.taskId) : '',
    query: boundedText(value.query, 80),
    resultStatus,
    submissionStatus: boundedText(value.submissionStatus, 32),
    completedFrom: optionalDate(value.completedFrom),
    completedUntil: optionalDate(value.completedUntil),
  }
}

function boundedText(value, maximum, required = false) {
  const result = typeof value === 'string' ? value.trim() : ''
  if ((required && !result) || result.length > maximum) throw new Error('VALIDATION_FAILED')
  return result
}

function optionalDate(value) {
  if (value === undefined || value === null || value === '') return null
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) throw new Error('VALIDATION_FAILED')
  return date
}

function pageLimit(value, maximum = 50) {
  const result = Number(value || 20)
  if (!Number.isSafeInteger(result) || result < 1) throw new Error('VALIDATION_FAILED')
  return Math.min(maximum, result)
}

function encodeCursor(row) {
  if (!row) return undefined
  return Buffer.from(JSON.stringify({ at: new Date(row.updated_at || row.completed_at).toISOString(), id: row.id })).toString('base64url')
}

function decodeCursor(value) {
  if (!value) return null
  try {
    const cursor = JSON.parse(Buffer.from(String(value), 'base64url').toString('utf8'))
    if (!UUID_PATTERN.test(cursor.id) || !Number.isFinite(Date.parse(cursor.at))) throw new Error()
    return cursor
  }
  catch {
    throw new Error('VALIDATION_FAILED')
  }
}

function normalizeTaskExtensions(value) {
  const keys = ['starLevel', 'purpose', 'completionCriteria', 'periodStartAt', 'periodEndAt', 'weeklyDeliverAt', 'assignedOwnerId', 'applicableServers', 'rewardConfig']
  if (!keys.some(key => Object.hasOwn(value, key))) return {}
  const starLevel = Number(value.starLevel || 1)
  if (!Number.isInteger(starLevel) || starLevel < 1 || starLevel > 5) throw new Error('VALIDATION_FAILED')
  const periodStartAt = optionalDate(value.periodStartAt)
  const periodEndAt = optionalDate(value.periodEndAt || value.endsAt)
  if (periodStartAt && periodEndAt && periodStartAt > periodEndAt) throw new Error('VALIDATION_FAILED')
  const weeklyDeliverAt = boundedText(value.weeklyDeliverAt, 5)
  if (weeklyDeliverAt && !/^([01]\d|2[0-3]):[0-5]\d$/.test(weeklyDeliverAt)) throw new Error('VALIDATION_FAILED')
  return {
    starLevel,
    purpose: boundedText(value.purpose, 500, true),
    completionCriteria: boundedText(value.completionCriteria, 1000, true),
    periodStartAt,
    periodEndAt,
    weeklyDeliverAt: weeklyDeliverAt || null,
    assignedOwnerId: requiredId(value.assignedOwnerId),
    applicableServers: normalizeEligibleLevelIds(value.applicableServers || []),
    rewardConfig: normalizeRewardConfig(value.rewardConfig),
  }
}

function normalizeRewardConfig(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('VALIDATION_FAILED')
  const result = {}
  for (const key of ['experience', 'contribution', 'bonus']) {
    const entry = value[key] || {}
    const enabled = entry.enabled === true
    const amount = enabled ? Number(entry.amount) : 0
    if (!Number.isFinite(amount) || amount < 0 || amount > 1000000
      || (enabled && key !== 'bonus' && (!Number.isSafeInteger(amount) || amount < 1))
      || (key === 'bonus' && Math.abs(amount * 100 - Math.round(amount * 100)) > 0.00001)) throw new Error('VALIDATION_FAILED')
    result[key] = { enabled, amount }
  }
  if (!Object.values(result).some(entry => entry.enabled)) throw new Error('VALIDATION_FAILED')
  return result
}

module.exports = {
  boundedText,
  optionalDate,
  normalizeRewardConfig,
  decodeCursor,
  encodeCursor,
  expectedVersion,
  normalizeCompletionFilters,
  normalizeEligibleLevelIds,
  normalizeAssignmentInput,
  normalizeMemberFilters,
  normalizeTask,
  normalizeTaskAction,
  normalizeTaskFilters,
  pageLimit,
  requiredId,
}
