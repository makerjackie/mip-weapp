'use strict'

const { AdminError, limit, requiredId, text } = require('./validation')

const SOURCE_TYPES = Object.freeze(['CAMPAIGN_DISPATCH', 'DELIVERY_TASK'])
const WORKFLOW_FILTERS = Object.freeze(['ACTIVE', 'RESOLVED', 'ALL'])
const RESOLUTION_CODES = Object.freeze(['TERMINAL_ACCEPTED', 'UNKNOWN_NO_REPLAY'])

function normalizeReviewListInput(input = {}) {
  assertObject(input, ['sourceType', 'workflowStatus', 'cursor', 'limit'])
  const sourceType = input.sourceType === undefined || input.sourceType === ''
    ? null
    : enumValue(input.sourceType, SOURCE_TYPES, '投递来源')
  const workflowStatus = input.workflowStatus === undefined || input.workflowStatus === ''
    ? 'ACTIVE'
    : enumValue(input.workflowStatus, WORKFLOW_FILTERS, '复核状态')
  const cursor = input.cursor === undefined || input.cursor === null || input.cursor === ''
    ? null
    : text(input.cursor, 512, { required: true, label: '分页游标' })
  return { sourceType, workflowStatus, cursor, limit: limit(input.limit || 20, 50) }
}

function normalizeReviewGetInput(input = {}) {
  assertObject(input, ['resourceRef'])
  return { resourceRef: normalizeResourceRef(input.resourceRef) }
}

function normalizeReviewClaimInput(input = {}) {
  assertObject(input, ['resourceRef', 'evidenceRevision', 'reviewVersion', 'idempotencyKey'])
  return normalizeMutation(input)
}

function normalizeReviewReconcileInput(input = {}) {
  assertObject(input, ['resourceRef', 'evidenceRevision', 'reviewVersion', 'idempotencyKey'])
  return normalizeMutation(input)
}

function normalizeReviewResolveInput(input = {}) {
  assertObject(input, [
    'resourceRef',
    'evidenceRevision',
    'reviewVersion',
    'resolutionCode',
    'note',
    'evidenceReference',
    'idempotencyKey',
  ])
  const normalized = normalizeMutation(input)
  const resolutionCode = enumValue(input.resolutionCode, RESOLUTION_CODES, '处理结果')
  const note = text(input.note, 500, {
    required: resolutionCode === 'UNKNOWN_NO_REPLAY',
    label: '处理说明',
  })
  return {
    ...normalized,
    resolutionCode,
    note: note || null,
    evidenceReference: normalizeEvidenceReference(input.evidenceReference),
  }
}

function normalizeMutation(input) {
  return {
    resourceRef: normalizeResourceRef(input.resourceRef),
    evidenceRevision: normalizeEvidenceRevision(input.evidenceRevision),
    reviewVersion: normalizeReviewVersion(input.reviewVersion),
    idempotencyKey: normalizeIdempotencyKey(input.idempotencyKey),
  }
}

function normalizeResourceRef(value) {
  assertObject(value, ['type', 'id'])
  return {
    type: enumValue(value.type, SOURCE_TYPES, '投递来源'),
    id: requiredId(value.id, '投递记录'),
  }
}

function normalizeEvidenceRevision(value) {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (!/^[0-9a-f]{64}$/.test(normalized)) {
    throw new AdminError('VALIDATION_FAILED', '投递证据版本无效')
  }
  return normalized
}

function normalizeReviewVersion(value) {
  const version = Number(value)
  if (!Number.isInteger(version) || version < 0) {
    throw new AdminError('VALIDATION_FAILED', '复核版本无效')
  }
  return version
}

function normalizeIdempotencyKey(value) {
  const normalized = typeof value === 'string' ? value.trim() : ''
  if (normalized.length < 12 || normalized.length > 128
    || !/^[A-Za-z0-9_.:-]+$/.test(normalized)) {
    throw new AdminError('VALIDATION_FAILED', '重复请求标识无效')
  }
  return normalized
}

function normalizeEvidenceReference(value) {
  const normalized = text(value, 300, { label: '证据引用' })
  if (!normalized) return null
  if (/[\u0000-\u001f\u007f<>{}\[\]?&=\\]/u.test(normalized)) {
    throw new AdminError('VALIDATION_FAILED', '证据引用格式无效')
  }
  return normalized
}

function enumValue(value, allowed, label) {
  const normalized = typeof value === 'string' ? value.trim().toUpperCase() : ''
  if (!allowed.includes(normalized)) {
    throw new AdminError('VALIDATION_FAILED', `${label}无效`)
  }
  return normalized
}

function assertObject(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AdminError('VALIDATION_FAILED', '投递复核请求格式无效')
  }
  const allowed = new Set(keys)
  if (Reflect.ownKeys(value).some(key => typeof key !== 'string' || !allowed.has(key))) {
    throw new AdminError('VALIDATION_FAILED', '投递复核请求格式无效')
  }
}

module.exports = {
  RESOLUTION_CODES,
  SOURCE_TYPES,
  WORKFLOW_FILTERS,
  normalizeEvidenceReference,
  normalizeReviewClaimInput,
  normalizeReviewGetInput,
  normalizeReviewListInput,
  normalizeReviewReconcileInput,
  normalizeReviewResolveInput,
  normalizeResourceRef,
}
