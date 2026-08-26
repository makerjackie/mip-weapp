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
const STATUSES = new Set(['DRAFT', 'PUBLISHED', 'UNPUBLISHED', 'ARCHIVED', 'ALL'])
const SAFETY_STATUSES = new Set(['PENDING', 'APPROVED', 'REJECTED', 'ERROR'])
const ROLE_KEYS = new Set([
  'connector',
  'business_builder',
  'capital_operator',
  'strategist',
  'visual_designer',
  'delivery_lead',
])
const CARD_ROLE_FIELDS = {
  connector: ['circles', 'resources', 'target'],
  business_builder: ['industries', 'business_models', 'target'],
  capital_operator: ['investment_fields', 'capital_range', 'target'],
  strategist: ['planning_types', 'methods', 'target'],
  visual_designer: ['visual_types', 'portfolio_summary', 'target'],
  delivery_lead: ['project_types', 'delivery_experience', 'target'],
}
const ABILITY_KEYS = new Set([
  'business_development', 'resource_integration', 'capital_operation',
  'strategy_planning', 'visual_design', 'delivery_management',
])

function createAdminUserContentGovernance({ access, repository, contentSafety = async () => 'ERROR' }) {
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

  async function saveUserContent(caller, input = {}) {
    assertInput(input, ['kind', 'contentId', 'expectedVersion', 'ownerUserId', 'draft'])
    const context = await access.session(caller)
    firstGrant(context.bindings, CAPABILITIES.USER_CONTENT_MODERATE)
    const kind = contentKind(input.kind)
    const ownerUserId = requiredId(input.ownerUserId, '归属用户')
    const draft = normalizeDraft(kind, input.draft)
    const version = input.contentId ? expectedVersion(input.expectedVersion) : 0
    const visibility = visibilityForCapability(
      context.bindings,
      CAPABILITIES.USER_CONTENT_MODERATE,
    )
    const existing = input.contentId
      ? await repository.getUserContentScope(
          context.caller.appId,
          visibility,
          kind,
          requiredId(input.contentId, '用户内容'),
        )
      : null
    if (input.contentId && !existing) throw new AdminError('NOT_FOUND', '用户内容不存在')
    if (existing && existing.ownerUserId !== ownerUserId) {
      throw new AdminError('VALIDATION_FAILED', '编辑时不能变更内容归属')
    }
    const owner = existing || await repository.getUserContentOwnerScope(
      context.caller.appId,
      visibility,
      ownerUserId,
    )
    if (!owner) throw new AdminError('NOT_FOUND', '归属用户不存在或当前账号不可管理')
    const grant = authorize(context.bindings, CAPABILITIES.USER_CONTENT_MODERATE, owner.scope)
    const safety = await contentSafety(safetyDraft(kind, draft), caller)
    const contentSafetyStatus = safety === 'PASSED' || safety === 'APPROVED'
      ? 'APPROVED'
      : safety === 'REJECTED' ? 'REJECTED' : 'ERROR'
    if (draft.status === 'PUBLISHED' && contentSafetyStatus !== 'APPROVED') {
      throw new AdminError('CONTENT_SAFETY_REQUIRED', '内容安全检查未通过，暂不能发布')
    }
    return repository.saveUserContent({
      appId: context.caller.appId,
      actorUserId: context.caller.userId,
      ownerUserId,
      kind,
      contentId: input.contentId ? requiredId(input.contentId, '用户内容') : null,
      expectedVersion: version,
      draft,
      contentSafetyStatus,
      authorizedScope: owner.scope,
      authorization: access.mutationAuthorization(grant, CAPABILITIES.USER_CONTENT_MODERATE),
      audit: (resourceId, nextVersion, status) => access.audit(context, grant, {
        scopeType: owner.scope.scopeType,
        scopeId: owner.scope.scopeId,
        action: input.contentId ? 'admin.user_content.update' : 'admin.user_content.create',
        resourceType: kind,
        resourceId,
        metadata: {
          ownerUserId,
          expectedVersion: version,
          nextVersion,
          status,
        },
      }),
    })
  }

  async function archiveUserContent(caller, input = {}) {
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
      { required: true, label: '归档原因' },
    )
    const visibility = visibilityForCapability(context.bindings, CAPABILITIES.USER_CONTENT_MODERATE)
    const target = await repository.getUserContentScope(context.caller.appId, visibility, kind, contentId)
    if (!target) throw new AdminError('NOT_FOUND', '用户内容不存在')
    const grant = authorize(context.bindings, CAPABILITIES.USER_CONTENT_MODERATE, target.scope)
    return repository.archiveUserContent({
      appId: context.caller.appId,
      actorUserId: context.caller.userId,
      kind,
      contentId,
      expectedVersion: version,
      reason,
      authorizedScope: target.scope,
      authorization: access.mutationAuthorization(grant, CAPABILITIES.USER_CONTENT_MODERATE),
      audit: nextVersion => access.audit(context, grant, {
        scopeType: target.scope.scopeType,
        scopeId: target.scope.scopeId,
        action: 'admin.user_content.archive',
        resourceType: kind,
        resourceId: contentId,
        metadata: { reason, expectedVersion: version, nextVersion },
      }),
    })
  }

  return { archiveUserContent, getUserContent, listUserContent, saveUserContent, unpublishUserContent }
}

function normalizeDraft(kind, input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) invalid('内容草稿无效')
  if (kind === 'COOPERATION_CARD') {
    if (input.kind !== kind || !ROLE_KEYS.has(input.roleKey)
      || !exactKeysOptional(input, ['kind', 'roleKey', 'positioning', 'targetSummary', 'roleFields', 'abilityScores'], 'status')) invalid('合作卡草稿无效')
    const fields = input.roleFields
    const required = CARD_ROLE_FIELDS[input.roleKey]
    if (!fields || typeof fields !== 'object' || Array.isArray(fields)
      || Object.keys(fields).some(key => !required.includes(key))) invalid('合作卡信息无效')
    for (const key of required) {
      const value = fields[key]
      if (Array.isArray(value)
        ? !value.length || value.length > 12 || value.some(item => typeof item !== 'string' || !item.trim() || item.length > 80)
        : typeof value !== 'string' || !value.trim() || value.length > 1000) invalid('合作卡信息无效')
    }
    const scores = input.abilityScores
    if (!scores || typeof scores !== 'object' || Array.isArray(scores)
      || Object.keys(scores).some(key => !ABILITY_KEYS.has(key))
      || Object.keys(scores).length !== ABILITY_KEYS.size
      || Object.values(scores).some(score => !Number.isInteger(score) || score < 0 || score > 5)) invalid('能力评分无效')
    return {
      roleKey: input.roleKey,
      positioning: text(input.positioning, 500, { required: true, label: '合作定位' }),
      targetSummary: text(input.targetSummary, 500, { required: true, label: '合作目标' }),
      roleFields: fields,
      abilityScores: scores,
      status: contentStatus(input.status),
    }
  }
  if (input.kind !== kind || !exactKeysOptional(input, [
    'kind', 'projectName', 'summary', 'startedOn', 'endedOn', 'responsibility',
    'cityTagId', 'industryTagId', 'caseType', 'description', 'coverAssetId', 'mediaAssetIds',
  ], 'status')) invalid('案例草稿无效')
  const startedOn = optionalDate(input.startedOn)
  const endedOn = optionalDate(input.endedOn)
  if (startedOn && endedOn && endedOn < startedOn) invalid('案例日期无效')
  const uuidOrNull = value => value === null || value === undefined || /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  const mediaAssetIds = Array.isArray(input.mediaAssetIds) ? input.mediaAssetIds : []
  if (![input.cityTagId, input.industryTagId, input.coverAssetId].every(uuidOrNull)
    || mediaAssetIds.length > 12 || mediaAssetIds.some(id => !uuidOrNull(id) || id === null)) invalid('案例素材无效')
  return {
    projectName: text(input.projectName, 120, { required: true, label: '项目名称' }),
    summary: text(input.summary, 240, { required: true, label: '案例摘要' }),
    startedOn,
    endedOn,
    responsibility: text(input.responsibility, 500, { required: true, label: '项目责任' }),
    cityTagId: input.cityTagId || null,
    industryTagId: input.industryTagId || null,
    caseType: text(input.caseType, 80, { label: '案例类型' }) || null,
    description: text(input.description, 8000, { required: true, label: '案例说明' }),
    coverAssetId: input.coverAssetId || null,
    mediaAssetIds,
    status: contentStatus(input.status),
  }
}

function contentStatus(value) {
  const status = value === undefined || value === '' ? 'DRAFT' : value
  if (!['DRAFT', 'PUBLISHED', 'UNPUBLISHED'].includes(status)) invalid('内容状态无效')
  return status
}

function optionalDate(value) {
  if (value === null || value === undefined || value === '') return null
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) invalid('日期无效')
  return value
}

function safetyDraft(kind, draft) {
  return kind === 'COOPERATION_CARD'
    ? {
        title: draft.positioning,
        summary: draft.targetSummary,
        body: Object.values(draft.roleFields).flat().join('\n'),
      }
    : { title: draft.projectName, summary: draft.summary, description: draft.description, responsibility: draft.responsibility }
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

function exactKeys(value, keys) {
  const allowed = new Set(keys)
  return Reflect.ownKeys(value).length === allowed.size
    && Reflect.ownKeys(value).every(key => typeof key === 'string' && allowed.has(key))
}

function exactKeysOptional(value, required, optional) {
  return exactKeys(value, required) || exactKeys(value, [...required, optional])
}

module.exports = { createAdminUserContentGovernance }
