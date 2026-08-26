'use strict'

const {
  CAPABILITIES,
  authorize,
  firstGrant,
  visibilityForCapability,
} = require('./capabilities')
const {
  AdminError,
  expectedVersion,
  limit,
  requiredId,
  text,
} = require('./validation')

const KINDS = new Set(['COOPERATION_CARD', 'SUPER_CASE'])
const STATUSES = new Set(['PUBLISHED', 'UNPUBLISHED', 'ARCHIVED', 'ALL'])
const SAFETY_STATUSES = new Set(['PENDING', 'APPROVED', 'REJECTED', 'ERROR'])
const ROLE_KEYS = new Set([
  'connector',
  'business_builder',
  'capital_operator',
  'strategist',
  'visual_designer',
  'delivery_lead',
])

function createAdminUserContentGovernance({ access, repository }) {
  async function listUserContent(caller, input = {}) {
    assertInput(input, [
      'kind', 'status', 'contentSafetyStatus', 'branchId', 'ownerUserId',
      'roleKey', 'query', 'cursor', 'limit',
    ])
    const context = await access.session(caller)
    firstGrant(context.bindings, CAPABILITIES.USER_CONTENT_MODERATE)
    return repository.listUserContent(
      context.caller.appId,
      visibilityForCapability(context.bindings, CAPABILITIES.USER_CONTENT_MODERATE),
      normalizeList(input),
      limit(input.limit, 50),
    )
  }

  async function getUserContent(caller, input = {}) {
    assertInput(input, ['kind', 'contentId'])
    const context = await access.session(caller)
    firstGrant(context.bindings, CAPABILITIES.USER_CONTENT_MODERATE)
    const kind = contentKind(input.kind)
    const contentId = requiredId(input.contentId, '用户内容')
    const item = await repository.getUserContent(
      context.caller.appId,
      visibilityForCapability(context.bindings, CAPABILITIES.USER_CONTENT_MODERATE),
      kind,
      contentId,
    )
    if (!item) throw new AdminError('NOT_FOUND', '用户内容不存在')
    return item
  }

  async function unpublishUserContent(caller, input = {}) {
    assertInput(input, ['kind', 'contentId', 'expectedVersion', 'reason'])
    const context = await access.session(caller)
    firstGrant(context.bindings, CAPABILITIES.USER_CONTENT_MODERATE)
    const kind = contentKind(input.kind)
    const contentId = requiredId(input.contentId, '用户内容')
    const version = expectedVersion(input.expectedVersion)
    const reason = text(
      typeof input.reason === 'string'
        ? input.reason.normalize('NFKC').trim().replace(/\s+/g, ' ')
        : input.reason,
      300,
      { required: true, label: '下架原因' },
    )
    const visibility = visibilityForCapability(
      context.bindings,
      CAPABILITIES.USER_CONTENT_MODERATE,
    )
    const target = await repository.getUserContentScope(
      context.caller.appId,
      visibility,
      kind,
      contentId,
    )
    if (!target) throw new AdminError('NOT_FOUND', '用户内容不存在')
    const grant = authorize(
      context.bindings,
      CAPABILITIES.USER_CONTENT_MODERATE,
      target.scope,
    )
    return repository.unpublishUserContent({
      appId: context.caller.appId,
      actorUserId: context.caller.userId,
      kind,
      contentId,
      expectedVersion: version,
      reason,
      authorizedScope: target.scope,
      authorization: access.mutationAuthorization(
        grant,
        CAPABILITIES.USER_CONTENT_MODERATE,
      ),
      audit: nextVersion => access.audit(context, grant, {
        scopeType: target.scope.scopeType,
        scopeId: target.scope.scopeId,
        action: 'admin.user_content.unpublish',
        resourceType: kind,
        resourceId: contentId,
        metadata: {
          reason,
          expectedVersion: version,
          nextVersion,
        },
      }),
    })
  }

  return { getUserContent, listUserContent, unpublishUserContent }
}

function normalizeList(input) {
  const kind = input.kind === undefined || input.kind === '' ? 'ALL' : input.kind
  if (kind !== 'ALL' && !KINDS.has(kind)) invalid('内容类型无效')
  const status = input.status === undefined || input.status === '' ? 'PUBLISHED' : input.status
  if (!STATUSES.has(status)) invalid('内容状态无效')
  const contentSafetyStatus = input.contentSafetyStatus === undefined || input.contentSafetyStatus === ''
    ? ''
    : input.contentSafetyStatus
  if (contentSafetyStatus && !SAFETY_STATUSES.has(contentSafetyStatus)) invalid('内容安全状态无效')
  const roleKey = input.roleKey === undefined || input.roleKey === '' ? '' : input.roleKey
  if (roleKey && !ROLE_KEYS.has(roleKey)) invalid('合作角色无效')
  const cursor = input.cursor === undefined || input.cursor === ''
    ? null
    : text(input.cursor, 512, { required: true, label: '分页游标' })
  return {
    kind,
    status,
    contentSafetyStatus,
    branchId: optionalId(input.branchId, '分会'),
    ownerUserId: optionalId(input.ownerUserId, '用户'),
    roleKey,
    query: text(input.query, 100, { label: '搜索词' }),
    cursor,
  }
}

function contentKind(value) {
  if (!KINDS.has(value)) invalid('内容类型无效')
  return value
}

function optionalId(value, label) {
  return value === undefined || value === '' || value === null
    ? null
    : requiredId(value, label)
}

function assertInput(value, allowedKeys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid('用户内容请求无效')
  const allowed = new Set(allowedKeys)
  if (Reflect.ownKeys(value).some(key => typeof key !== 'string' || !allowed.has(key))) {
    invalid('用户内容请求无效')
  }
}

function invalid(message) {
  throw new AdminError('VALIDATION_FAILED', message)
}

module.exports = { createAdminUserContentGovernance }
