'use strict'

const { createHash } = require('node:crypto')
const { CAPABILITIES, authorize } = require('./capabilities')
const { decodeCursor } = require('./pagination')
const { limit } = require('./validation')
const { AdminError } = require('./validation')

const durationMonths = new Set([1, 3, 6, 12])
const getInputKeys = new Set(['userId'])
const grantInputKeys = new Set([
  'durationMonths',
  'expectedChainVersion',
  'idempotencyKey',
  'reason',
  'userId',
])
const timelineStatuses = new Set(['PENDING', 'ACTIVE', 'EXPIRED', 'REVOKED', 'REFUNDED'])
const timelineSources = new Set(['ORDER', 'ADMIN_ADJUSTMENT'])
const timelineFilterKeys = new Set([
  'createdFrom',
  'createdTo',
  'sourceType',
  'status',
  'userId',
  'userQuery',
])
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function createAdminMemberships({ repository, access }) {
  async function getMembership(caller, input = {}) {
    const context = await access.session(caller)
    assertExactInput(input, getInputKeys)
    platformGrant(context, CAPABILITIES.MEMBERSHIPS_READ)
    return repository.getMembership({
      appId: context.caller.appId,
      userId: strictUuid(input.userId),
    })
  }

  async function grantMembership(caller, input = {}) {
    const context = await access.session(caller)
    assertExactInput(input, grantInputKeys)
    const normalized = normalizeGrant(input)
    const grant = platformGrant(context, CAPABILITIES.MEMBERSHIPS_ADJUST)
    const requestHash = membershipGrantRequestHash({
      appId: context.caller.appId,
      actorUserId: context.caller.userId,
      ...normalized,
    })
    return repository.grantMembership({
      appId: context.caller.appId,
      actorUserId: context.caller.userId,
      ...normalized,
      requestHash,
      authorization: access.mutationAuthorization(grant, CAPABILITIES.MEMBERSHIPS_ADJUST),
      audit: (adjustmentId, facts) => access.audit(context, grant, {
        scopeType: 'PLATFORM',
        action: 'admin.memberships.grant',
        resourceType: 'MEMBERSHIP_ADJUSTMENT',
        resourceId: adjustmentId,
        metadata: {
          userId: normalized.userId,
          durationMonths: normalized.durationMonths,
          reasonLength: normalized.reason.length,
          startsAt: facts.startsAt,
          endsAt: facts.endsAt,
          expectedChainVersion: normalized.expectedChainVersion,
          resultChainVersion: facts.resultChainVersion,
        },
      }),
    })
  }

  async function listMembershipTimeline(caller, input = {}) {
    const context = await access.session(caller)
    const grant = platformGrant(context, CAPABILITIES.MEMBERSHIPS_READ)
    const filters = normalizeTimelineFilters(input.filters)
    const page = await repository.listMembershipTimeline({
      appId: context.caller.appId,
      ...filters,
      pageLimit: limit(input.limit),
      cursor: decodeCursor(input.cursor, ['createdAt', 'id']),
    })
    if (typeof repository.recordAudit === 'function') {
      await repository.recordAudit(access.audit(context, grant, {
        scopeType: 'PLATFORM',
        action: 'admin.memberships.timeline.view',
        resourceType: 'MEMBERSHIP_ENTITLEMENT_LIST',
        metadata: { count: page?.items?.length || 0, filters, cursor: Boolean(input.cursor) },
      }))
    }
    return page
  }

  return { getMembership, grantMembership, listMembershipTimeline }
}

function normalizeTimelineFilters(value) {
  const filters = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  if (Reflect.ownKeys(filters).some(key => typeof key !== 'string' || !timelineFilterKeys.has(key))) {
    throw validationError('会员筛选条件无效')
  }
  const userId = filters.userId ? strictUuid(filters.userId) : ''
  const userQuery = timelineUserQuery(filters.userQuery)
  const status = filters.status || ''
  const sourceType = filters.sourceType || ''
  if (status && !timelineStatuses.has(status)) throw validationError('会员状态无效')
  if (sourceType && !timelineSources.has(sourceType)) throw validationError('会员来源无效')
  const createdFrom = timelineDateFilter(filters.createdFrom, '开始时间')
  const createdTo = timelineDateFilter(filters.createdTo, '结束时间')
  if (createdFrom && createdTo && createdFrom > createdTo) {
    throw validationError('会员时间范围无效')
  }
  return { userId, userQuery, status, sourceType, createdFrom, createdTo }
}

function timelineUserQuery(value) {
  if (value === null || value === undefined || value === '') return ''
  const normalized = typeof value === 'string' ? value.trim() : ''
  if (!normalized || normalized.length > 64 || /[\u0000-\u001f\u007f]/.test(normalized)) {
    throw validationError('用户搜索条件无效')
  }
  return normalized
}

function timelineDateFilter(value, label) {
  if (value === null || value === undefined || value === '') return ''
  if (typeof value !== 'string' || value.length > 40) throw validationError(`${label}无效`)
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) throw validationError(`${label}无效`)
  return date.toISOString().slice(0, 23).replace('T', ' ')
}

function assertExactInput(value, allowedKeys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw validationError('会员请求格式无效')
  }
  const prototype = Object.getPrototypeOf(value)
  const keys = Reflect.ownKeys(value)
  if ((prototype !== Object.prototype && prototype !== null)
    || keys.length !== allowedKeys.size
    || keys.some(key => typeof key !== 'string' || !allowedKeys.has(key))) {
    throw validationError('会员请求格式无效')
  }
}

function normalizeGrant(input) {
  if (!durationMonths.has(input.durationMonths)) {
    throw validationError('会员时长无效')
  }
  const reason = typeof input.reason === 'string' ? input.reason.trim() : ''
  if (!reason || reason.length > 300) {
    throw validationError('调整原因格式无效')
  }
  const expectedChainVersion = input.expectedChainVersion
  if (!Number.isSafeInteger(expectedChainVersion) || expectedChainVersion < 1) {
    throw validationError('会员版本无效')
  }
  const idempotencyKey = typeof input.idempotencyKey === 'string'
    ? input.idempotencyKey.trim()
    : ''
  if (!idempotencyKey
    || idempotencyKey.length > 128
    || !/^[A-Za-z0-9_.:-]+$/.test(idempotencyKey)) {
    throw validationError('请求标识无效')
  }
  return {
    userId: strictUuid(input.userId),
    durationMonths: input.durationMonths,
    reason,
    expectedChainVersion,
    idempotencyKey,
  }
}

function membershipGrantRequestHash(input) {
  const canonical = [
    input.appId,
    input.actorUserId,
    input.userId,
    input.durationMonths,
    input.reason,
    input.expectedChainVersion,
  ]
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex')
}

function strictUuid(value) {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (!uuidPattern.test(normalized)) throw validationError('用户标识无效')
  return normalized
}

function platformGrant(context, capability) {
  return authorize(context.bindings, capability, { scopeType: 'PLATFORM', scopeId: null })
}

function validationError(message) {
  return new AdminError('VALIDATION_FAILED', message)
}

module.exports = { createAdminMemberships }
