'use strict'

const {
  CAPABILITIES,
  authorize,
  firstGrant,
  visibilityForCapability,
} = require('./capabilities')
const { decodeCursor } = require('./pagination')
const {
  AdminError,
  delta,
  expectedVersion,
  limit,
  metric,
  requiredId,
  stableKey,
  text,
} = require('./validation')

function createAdminGrowth({ repository, access }) {
  async function listGrowthLevels(caller) {
    const context = await access.session(caller)
    firstGrant(context.bindings, CAPABILITIES.GROWTH_READ)
    return { items: await repository.listGrowthLevelsV2(context.caller.appId) }
  }

  async function listGrowthBenefits(caller) {
    const context = await access.session(caller)
    firstGrant(context.bindings, CAPABILITIES.GROWTH_READ)
    return { items: await repository.listGrowthBenefits(context.caller.appId) }
  }

  async function saveGrowthBenefit(caller, input = {}) {
    const context = await access.session(caller)
    const grant = platformGrant(context, CAPABILITIES.GROWTH_CONFIGURE)
    const draft = normalizeGrowthBenefit(input.draft)
    const benefitId = input.benefitId ? requiredId(input.benefitId, '权益') : null
    const version = benefitId ? expectedVersion(input.expectedVersion) : 0
    return repository.saveGrowthBenefit({
      appId: context.caller.appId,
      actorUserId: context.caller.userId,
      benefitId,
      expectedVersion: version,
      draft,
      authorization: access.mutationAuthorization(grant, CAPABILITIES.GROWTH_CONFIGURE),
      audit: resourceId => access.audit(context, grant, {
        scopeType: 'PLATFORM',
        action: benefitId ? 'admin.growth.benefit.update' : 'admin.growth.benefit.create',
        resourceType: 'GROWTH_BENEFIT',
        resourceId,
        metadata: { status: draft.status, sortOrder: draft.sortOrder },
      }),
    })
  }

  async function saveGrowthLevel(caller, input) {
    const context = await access.session(caller)
    const grant = platformGrant(context, CAPABILITIES.GROWTH_CONFIGURE)
    const draft = normalizeLevel(input.draft)
    const version = input.levelId ? expectedVersion(input.expectedVersion) : 0
    const levelId = input.levelId ? requiredId(input.levelId, '等级') : null
    return repository.saveGrowthLevelV2({
      appId: context.caller.appId,
      actorUserId: context.caller.userId,
      levelId,
      expectedVersion: version,
      draft,
      authorization: access.mutationAuthorization(grant, CAPABILITIES.GROWTH_CONFIGURE),
      audit: resourceId => access.audit(context, grant, {
        scopeType: 'PLATFORM',
        action: levelId ? 'admin.growth.level.update' : 'admin.growth.level.create',
        resourceType: 'GROWTH_LEVEL',
        resourceId,
        metadata: { status: draft.status, minimumExperience: draft.minimumExperience },
      }),
    })
  }

  async function listGrowthRules(caller) {
    const context = await access.session(caller)
    firstGrant(context.bindings, CAPABILITIES.GROWTH_READ)
    return { items: await repository.listGrowthRules(context.caller.appId) }
  }

  async function saveGrowthRule(caller, input) {
    const context = await access.session(caller)
    const grant = platformGrant(context, CAPABILITIES.GROWTH_CONFIGURE)
    const draft = normalizeRule(input.draft)
    const ruleId = requiredId(input.ruleId, '规则')
    const version = expectedVersion(input.expectedVersion)
    return repository.saveGrowthRule({
      appId: context.caller.appId,
      actorUserId: context.caller.userId,
      ruleId,
      expectedVersion: version,
      draft,
      authorization: access.mutationAuthorization(grant, CAPABILITIES.GROWTH_CONFIGURE),
      audit: resourceId => access.audit(context, grant, {
        scopeType: 'PLATFORM',
        action: 'admin.growth.rule.update',
        resourceType: 'GROWTH_RULE',
        resourceId,
        metadata: { metric: draft.metric, deltaValue: draft.deltaValue, status: draft.status },
      }),
    })
  }

  async function listGrowthEntries(caller, input = {}) {
    const context = await access.session(caller)
    firstGrant(context.bindings, CAPABILITIES.GROWTH_READ)
    return pageResult(await repository.listGrowthEntries(
      context.caller.appId,
      visibilityForCapability(context.bindings, CAPABILITIES.GROWTH_READ),
      normalizeGrowthEntryFilters(input.filters),
      limit(input.limit),
      decodeCursor(input.cursor, ['createdAt', 'id']),
    ))
  }

  async function listGrowthLevelTransitions(caller, input = {}) {
    const context = await access.session(caller)
    firstGrant(context.bindings, CAPABILITIES.GROWTH_READ)
    return pageResult(await repository.listGrowthLevelTransitions(
      context.caller.appId,
      visibilityForCapability(context.bindings, CAPABILITIES.GROWTH_READ),
      normalizeGrowthLevelTransitionFilters(input.filters),
      limit(input.limit),
      decodeCursor(input.cursor, ['createdAt', 'id']),
    ))
  }

  async function adjustGrowth(caller, input) {
    const context = await access.session(caller)
    const userId = requiredId(input.userId, '用户')
    const { scope, grant } = await access.userAuthorization(
      context,
      userId,
      CAPABILITIES.GROWTH_ADJUST,
    )
    const growthMetric = metric(input.metric)
    const deltaValue = delta(input.deltaValue)
    const reason = text(input.reason, 300, { required: true, label: '调整原因' })
    const idempotencyKey = stableKey(input.idempotencyKey, '请求', 128)
    return repository.adjustGrowth({
      appId: context.caller.appId,
      actorUserId: context.caller.userId,
      userId,
      metric: growthMetric,
      deltaValue,
      reason,
      idempotencyKey,
      authorizedScope: scope,
      authorization: access.mutationAuthorization(grant, CAPABILITIES.GROWTH_ADJUST),
      audit: entryId => access.audit(context, grant, {
        scopeType: scope.scopeType,
        scopeId: scope.scopeId,
        action: 'admin.growth.adjust',
        resourceType: 'GROWTH_ENTRY',
        resourceId: entryId,
        metadata: { userId, metric: growthMetric, deltaValue, reasonLength: reason.length },
      }),
    })
  }

  async function listBadges(caller) {
    const context = await access.session(caller)
    platformGrant(context, CAPABILITIES.BADGES_MANAGE)
    return {
      items: (await repository.listBadges(context.caller.appId)).map(projectBadge),
    }
  }

  async function saveBadge(caller, input = {}) {
    const context = await access.session(caller)
    const grant = platformGrant(context, CAPABILITIES.BADGES_MANAGE)
    const badgeId = input.badgeId ? requiredId(input.badgeId, '勋章') : null
    const draft = normalizeBadge(input.draft)
    const version = badgeId ? expectedVersion(input.expectedVersion) : 0
    return repository.saveBadge({
      appId: context.caller.appId,
      actorUserId: context.caller.userId,
      badgeId,
      expectedVersion: version,
      draft,
      authorization: access.mutationAuthorization(grant, CAPABILITIES.BADGES_MANAGE),
      audit: resourceId => access.audit(context, grant, {
        scopeType: 'PLATFORM',
        action: badgeId ? 'admin.badge.update' : 'admin.badge.create',
        resourceType: 'BADGE',
        resourceId,
        metadata: { status: draft.status, sortOrder: draft.sortOrder },
      }),
    })
  }

  async function listBadgeAwards(caller, input = {}) {
    const context = await access.session(caller)
    platformGrant(context, CAPABILITIES.BADGES_MANAGE)
    const status = input.status === 'ACTIVE' || input.status === 'REVOKED' ? input.status : ''
    const query = text(input.query, 100)
    return {
      items: (await repository.listBadgeAwards(
        context.caller.appId,
        { status, query },
      )).map(projectBadgeAward),
    }
  }

  async function grantBadge(caller, input = {}) {
    const context = await access.session(caller)
    const grant = platformGrant(context, CAPABILITIES.BADGES_MANAGE)
    const userId = requiredId(input.userId, '用户')
    const badgeId = requiredId(input.badgeId, '勋章')
    const reason = text(input.reason, 300, { required: true, label: '授予原因' })
    return repository.grantBadge({
      appId: context.caller.appId,
      actorUserId: context.caller.userId,
      userId,
      badgeId,
      reason,
      authorization: access.mutationAuthorization(grant, CAPABILITIES.BADGES_MANAGE),
      audit: resourceId => access.audit(context, grant, {
        scopeType: 'PLATFORM',
        action: 'admin.badge.grant',
        resourceType: 'USER_BADGE',
        resourceId,
        metadata: { userId, badgeId, reasonLength: reason.length },
      }),
    })
  }

  async function revokeBadge(caller, input = {}) {
    const context = await access.session(caller)
    const grant = platformGrant(context, CAPABILITIES.BADGES_MANAGE)
    const awardId = requiredId(input.awardId, '获授记录')
    const version = expectedVersion(input.expectedVersion)
    const reason = text(input.reason, 300, { required: true, label: '撤销原因' })
    return repository.revokeBadge({
      appId: context.caller.appId,
      actorUserId: context.caller.userId,
      awardId,
      expectedVersion: version,
      reason,
      authorization: access.mutationAuthorization(grant, CAPABILITIES.BADGES_MANAGE),
      audit: resourceId => access.audit(context, grant, {
        scopeType: 'PLATFORM',
        action: 'admin.badge.revoke',
        resourceType: 'USER_BADGE',
        resourceId,
        metadata: { reasonLength: reason.length, expectedVersion: version },
      }),
    })
  }

  const api = {
    adjustGrowth,
    grantBadge,
    listBadgeAwards,
    listBadges,
    listGrowthBenefits,
    listGrowthEntries,
    listGrowthLevels,
    listGrowthRules,
    normalizeExportFilters: normalizeGrowthEntryFilters,
    revokeBadge,
    saveBadge,
    saveGrowthBenefit,
    saveGrowthLevel,
    saveGrowthRule,
  }
  Object.defineProperty(api, 'listGrowthLevelTransitions', {
    value: listGrowthLevelTransitions,
    enumerable: false,
  })
  return api
}

function platformGrant(context, capability) {
  return authorize(context.bindings, capability, { scopeType: 'PLATFORM', scopeId: null })
}

function pageResult(value) {
  if (Array.isArray(value)) {
    return { items: value, nextCursor: null }
  }
  return {
    items: Array.isArray(value?.items) ? value.items : [],
    nextCursor: typeof value?.nextCursor === 'string' ? value.nextCursor : null,
  }
}

function normalizeGrowthBenefit(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AdminError('VALIDATION_FAILED', '权益内容无效')
  }
  const sortOrder = Number(value.sortOrder)
  if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 1_000_000) {
    throw new AdminError('VALIDATION_FAILED', '权益排序无效')
  }
  return {
    name: text(value.name, 120, { required: true, label: '权益名称' }),
    description: text(value.description, 600),
    sortOrder,
    status: enumFilter(value.status, ['DRAFT', 'ACTIVE', 'INACTIVE'], '权益状态') || 'DRAFT',
  }
}

function normalizeGrowthEntryFilters(value) {
  const filters = normalizeFilters(value)
  const createdFrom = dateTimeFilter(filters.createdFrom, '开始时间')
  const createdTo = dateTimeFilter(filters.createdTo, '结束时间')
  if (createdFrom && createdTo && createdFrom > createdTo) {
    throw new AdminError('VALIDATION_FAILED', '成长流水开始时间不能晚于结束时间')
  }
  return {
    userId: filters.userId ? requiredId(filters.userId, '用户') : '',
    metric: filters.metric ? metric(filters.metric) : '',
    sourceEventType: filters.sourceEventType
      ? stableKey(filters.sourceEventType, '来源事件', 80)
      : '',
    createdFrom,
    createdTo,
  }
}

function normalizeGrowthLevelTransitionFilters(value) {
  const filters = normalizeFilters(value)
  const createdFrom = dateTimeFilter(filters.createdFrom, '开始时间')
  const createdTo = dateTimeFilter(filters.createdTo, '结束时间')
  if (createdFrom && createdTo && createdFrom > createdTo) {
    throw new AdminError('VALIDATION_FAILED', '等级变更开始时间不能晚于结束时间')
  }
  return {
    userId: filters.userId ? requiredId(filters.userId, '用户') : '',
    fromLevelId: filters.fromLevelId ? requiredId(filters.fromLevelId, '原等级') : '',
    toLevelId: filters.toLevelId ? requiredId(filters.toLevelId, '新等级') : '',
    createdFrom,
    createdTo,
  }
}

function normalizeLevel(value) {
  if (!value || typeof value !== 'object') {
    throw new AdminError('VALIDATION_FAILED', '等级内容无效')
  }
  const minimumExperience = Number(value.minimumExperience)
  if (!Number.isInteger(minimumExperience) || minimumExperience < 0) {
    throw new AdminError('VALIDATION_FAILED', '等级门槛无效')
  }
  const status = ['DRAFT', 'ACTIVE', 'INACTIVE'].includes(value.status) ? value.status : 'DRAFT'
  const sortOrder = Number(value.sortOrder ?? minimumExperience)
  if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 1_000_000) {
    throw new AdminError('VALIDATION_FAILED', '等级排序无效')
  }
  const benefitIds = Array.isArray(value.benefitIds)
    ? [...new Set(value.benefitIds.map(item => requiredId(item, '权益')))]
    : []
  if (benefitIds.length > 50) {
    throw new AdminError('VALIDATION_FAILED', '权益数量过多')
  }
  return {
    levelKey: stableKey(value.levelKey, '等级', 48),
    name: text(value.name, 80, { required: true, label: '等级名称' }),
    minimumExperience,
    displayBadge: text(value.displayBadge, 80),
    sortOrder,
    benefitIds,
    status,
  }
}

function normalizeBadge(value) {
  if (!value || typeof value !== 'object') {
    throw new AdminError('VALIDATION_FAILED', '勋章内容无效')
  }
  const imageUrl = text(value.imageUrl, 1024)
  if (imageUrl && !/^https:\/\//.test(imageUrl)) {
    throw new AdminError('VALIDATION_FAILED', '勋章图片地址无效')
  }
  const iconName = text(value.iconName, 64)
  if (iconName && !/^[a-z][a-z0-9-]{0,63}$/.test(iconName)) {
    throw new AdminError('VALIDATION_FAILED', '勋章图标无效')
  }
  const sortOrder = Number(value.sortOrder || 0)
  if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 1_000_000) {
    throw new AdminError('VALIDATION_FAILED', '勋章排序无效')
  }
  return {
    key: stableKey(value.key, '勋章', 80),
    name: text(value.name, 100, { required: true, label: '勋章名称' }),
    description: text(value.description, 500),
    iconName,
    imageUrl,
    placeholderShape: ['CIRCLE', 'DIAMOND', 'HEXAGON'].includes(value.placeholderShape)
      ? value.placeholderShape
      : 'CIRCLE',
    sortOrder,
    status: ['DRAFT', 'ACTIVE', 'INACTIVE'].includes(value.status) ? value.status : 'DRAFT',
  }
}

function normalizeRule(value) {
  if (!value || typeof value !== 'object') {
    throw new AdminError('VALIDATION_FAILED', '规则内容无效')
  }
  const deltaValue = delta(value.deltaValue)
  if (deltaValue < 1) {
    throw new AdminError('VALIDATION_FAILED', '奖励数值无效')
  }
  const dailyLimitValue = value.dailyLimitValue === null
    || value.dailyLimitValue === undefined
    || value.dailyLimitValue === ''
    ? null
    : Number(value.dailyLimitValue)
  if (dailyLimitValue !== null
    && (!Number.isInteger(dailyLimitValue) || dailyLimitValue < 0)) {
    throw new AdminError('VALIDATION_FAILED', '每日上限无效')
  }
  return {
    ruleKey: stableKey(value.ruleKey, '规则', 80),
    name: text(value.name, 100, { required: true, label: '规则名称' }),
    metric: metric(value.metric),
    deltaValue,
    dailyLimitValue,
    sourceEventType: stableKey(value.sourceEventType, '来源事件', 80),
    status: ['DRAFT', 'ACTIVE', 'INACTIVE'].includes(value.status) ? value.status : 'DRAFT',
  }
}

function projectBadge(item) {
  return {
    id: item.id,
    key: item.key,
    name: item.name,
    description: item.description,
    iconName: item.iconName,
    imageUrl: item.imageUrl,
    placeholderShape: item.placeholderShape,
    sortOrder: item.sortOrder,
    status: item.status,
    version: item.version,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  }
}

function projectBadgeAward(item) {
  return {
    id: item.id,
    userId: item.userId,
    nickname: item.nickname,
    badgeId: item.badgeId,
    badgeName: item.badgeName,
    status: item.status,
    awardReason: item.awardReason,
    awardedAt: item.awardedAt,
    revokeReason: item.revokeReason,
    revokedAt: item.revokedAt,
    equipped: item.equipped,
    version: item.version,
  }
}

function normalizeFilters(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? { ...value } : {}
}

function enumFilter(value, allowed, label) {
  if (value === null || value === undefined || value === '') {
    return ''
  }
  const normalized = typeof value === 'string' ? value.trim().toUpperCase() : ''
  if (!allowed.includes(normalized)) {
    throw new AdminError('VALIDATION_FAILED', `${label}无效`)
  }
  return normalized
}

function dateTimeFilter(value, label) {
  if (value === null || value === undefined || value === '') {
    return ''
  }
  if (typeof value !== 'string' || value.length > 40) {
    throw new AdminError('VALIDATION_FAILED', `${label}无效`)
  }
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) {
    throw new AdminError('VALIDATION_FAILED', `${label}无效`)
  }
  return date.toISOString().slice(0, 23).replace('T', ' ')
}

module.exports = { createAdminGrowth }
