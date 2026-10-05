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
const approvalFilterKeys = new Set(['status', 'userId'])
const approvalStatuses = new Set(['PENDING', 'APPROVED', 'REJECTED'])
const decideInputKeys = new Set(['decision', 'expectedChainVersion', 'reason', 'userId'])
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

  // MIW-27 第二轮：首次入会审核。队列读取走 MEMBERSHIPS_READ，审核决定是
  // 会员资格变更，复用 MEMBERSHIPS_ADJUST 并与运营开通一样走审计与链条版本。
  async function listMembershipApprovals(caller, input = {}) {
    const context = await access.session(caller)
    const grant = platformGrant(context, CAPABILITIES.MEMBERSHIPS_READ)
    const filters = normalizeApprovalFilters(input.filters)
    const page = await repository.listMembershipApprovals({
      appId: context.caller.appId,
      ...filters,
      pageLimit: limit(input.limit),
      cursor: decodeCursor(input.cursor, ['requestedAt', 'id']),
    })
    if (typeof repository.recordAudit === 'function') {
      await repository.recordAudit(access.audit(context, grant, {
        scopeType: 'PLATFORM',
        action: 'admin.memberships.approvals.view',
        resourceType: 'MEMBERSHIP_APPROVAL_LIST',
        metadata: { count: page?.items?.length || 0, filters, cursor: Boolean(input.cursor) },
      }))
    }
    return page
  }

  async function decideMembershipApproval(caller, input = {}) {
    const context = await access.session(caller)
    assertExactInput(input, decideInputKeys)
    const normalized = normalizeApprovalDecision(input)
    const grant = platformGrant(context, CAPABILITIES.MEMBERSHIPS_ADJUST)
    return repository.decideMembershipApproval({
      appId: context.caller.appId,
      actorUserId: context.caller.userId,
      ...normalized,
      authorization: access.mutationAuthorization(grant, CAPABILITIES.MEMBERSHIPS_ADJUST),
      audit: (approvalId, facts) => access.audit(context, grant, {
        scopeType: 'PLATFORM',
        action: 'admin.memberships.approval.decide',
        resourceType: 'MEMBERSHIP_APPROVAL',
        resourceId: approvalId,
        metadata: {
          userId: normalized.userId,
          decision: normalized.decision,
          reasonLength: normalized.reason.length,
          expectedChainVersion: normalized.expectedChainVersion,
          resultChainVersion: facts.resultChainVersion,
        },
      }),
    })
  }

  return {
    decideMembershipApproval,
    getMembership,
    grantMembership,
    listMembershipApprovals,
    listMembershipTimeline,
  }
}

function normalizeApprovalFilters(value) {
  const filters = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  if (Reflect.ownKeys(filters).some(key => typeof key !== 'string' || !approvalFilterKeys.has(key))) {
    throw validationError('审核筛选条件无效')
  }
  const status = filters.status || ''
  if (status && !approvalStatuses.has(status)) throw validationError('审核状态无效')
  return { status, userId: filters.userId ? strictUuid(filters.userId) : '' }
}

function normalizeApprovalDecision(input) {
  const decision = input.decision
  if (!['APPROVED', 'REJECTED'].includes(decision)) throw validationError('审核结论无效')
  const reason = typeof input.reason === 'string' ? input.reason.trim().slice(0, 300) : ''
  if (decision === 'REJECTED' && !reason) throw validationError('驳回时必须填写审核意见')
  const expectedChainVersion = Number(input.expectedChainVersion)
  if (!Number.isSafeInteger(expectedChainVersion) || expectedChainVersion < 1) {
    throw validationError('会员链条版本无效')
  }
  return {
    decision,
    expectedChainVersion,
    reason,
    userId: strictUuid(input.userId),
  }
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
