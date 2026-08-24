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
  const rewardExperience = Number(value.rewardExperience)
  if (!Number.isSafeInteger(rewardExperience) || rewardExperience < 0 || rewardExperience > 1_000_000) {
    throw new Error('VALIDATION_FAILED')
  }
  const assignmentMode = boundedText(value.assignmentMode || 'ALL', 16).toUpperCase()
  if (!['ALL', 'SELECTED'].includes(assignmentMode)) throw new Error('VALIDATION_FAILED')
  return {
    name,
    content,
    rewardExperience,
    attachmentRequired: value.attachmentRequired === true,
    assignmentMode,
    endsAt: optionalDate(value.endsAt),
    templateAssetId: value.templateAssetId ? requiredId(value.templateAssetId) : null,
  }
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

module.exports = {
  decodeCursor,
  encodeCursor,
  expectedVersion,
  normalizeCompletionFilters,
  normalizeAssignmentInput,
  normalizeMemberFilters,
  normalizeTask,
  normalizeTaskFilters,
  pageLimit,
  requiredId,
}
