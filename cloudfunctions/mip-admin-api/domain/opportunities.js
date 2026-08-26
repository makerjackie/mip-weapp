'use strict'

const { createProfileRef } = require('../lib/profile-ref')
const {
  CAPABILITIES,
  authorize,
  firstGrant,
  visibilityForCapability,
} = require('./capabilities')
const { createOpportunityArchiveService } = require('./opportunity-archive')
const { decodeCursor } = require('./pagination')
const { normalizeCommercialTerms } = require('./opportunity-commercial-terms')
const {
  AdminError,
  expectedVersion,
  limit,
  requiredId,
  text,
} = require('./validation')

const OPPORTUNITY_STATUSES = ['DRAFT', 'PUBLISHED', 'ENDED', 'UNPUBLISHED', 'ARCHIVED']
const COOPERATION_ROLE_KEYS = new Set([
  'connector',
  'business_builder',
  'capital_operator',
  'strategist',
  'visual_designer',
  'delivery_lead',
])

function createAdminOpportunities({
  repository,
  access,
  contentSafety = async () => 'ERROR',
  dispatchMatchingRecalculation = async () => {
    throw new AdminError('MATCHING_DISPATCH_CONFIG_REQUIRED', '机会撮合重算服务尚未配置')
  },
  profileRefSecret = '',
}) {
  async function opportunityAuthorization(context, opportunityId, capability) {
    const scope = await repository.getOpportunityScope(
      context.caller.appId,
      requiredId(opportunityId, '机会'),
    )
    if (!scope) {
      throw new AdminError('NOT_FOUND', '机会不存在')
    }
    return {
      scope,
      grant: authorize(context.bindings, capability, scope),
    }
  }

  async function listOpportunities(caller, input = {}) {
    const context = await access.session(caller)
    firstGrant(context.bindings, CAPABILITIES.OPPORTUNITIES_MODERATE)
    const readOpportunities = repository.listOpportunitiesV2 || repository.listOpportunities
    return pageResult(await readOpportunities(
      context.caller.appId,
      visibilityForCapability(context.bindings, CAPABILITIES.OPPORTUNITIES_MODERATE),
      normalizeOpportunityFilters(input.filters),
      limit(input.limit),
      decodeCursor(input.cursor, ['updatedAt', 'id']),
    ))
  }

  async function getOpportunity(caller, input = {}) {
    const context = await access.session(caller)
    const opportunityId = requiredId(input.opportunityId, '机会')
    await opportunityAuthorization(context, opportunityId, CAPABILITIES.OPPORTUNITIES_MODERATE)
    const item = await repository.getOpportunityDetail(context.caller.appId, opportunityId)
    if (!item) {
      throw new AdminError('NOT_FOUND', '机会不存在')
    }
    return item
  }

  async function getOpportunityEditorOptions(caller) {
    const context = await access.session(caller)
    firstGrant(context.bindings, CAPABILITIES.OPPORTUNITIES_MODERATE)
    return repository.getOpportunityEditorOptions(
      context.caller.appId,
      visibilityForCapability(context.bindings, CAPABILITIES.OPPORTUNITIES_MODERATE),
    )
  }

  async function saveOpportunity(caller, input = {}) {
    const context = await access.session(caller)
    const opportunityId = input.opportunityId ? requiredId(input.opportunityId, '机会') : null
    const existingAuthorization = opportunityId
      ? await opportunityAuthorization(context, opportunityId, CAPABILITIES.OPPORTUNITIES_MODERATE)
      : null
    const draft = normalizeOpportunityDraft(input.draft)
    const requestedScope = { scopeType: draft.scopeType, scopeId: draft.branchId }
    const requestedGrant = authorize(
      context.bindings,
      CAPABILITIES.OPPORTUNITIES_MODERATE,
      requestedScope,
    )
    const grant = existingAuthorization?.grant || requestedGrant
    const checked = await contentSafety({
      title: draft.title,
      summary: `${draft.valueSummary}\n${draft.targetSummary}`,
      description: draft.description,
    }, caller)
    const contentSafetyStatus = checked === 'PASSED' || checked === 'APPROVED'
      ? 'APPROVED'
      : checked === 'REJECTED' ? 'REJECTED' : 'ERROR'
    const version = opportunityId ? expectedVersion(input.expectedVersion) : 0
    return repository.saveOpportunity({
      appId: context.caller.appId,
      actorUserId: context.caller.userId,
      opportunityId,
      expectedVersion: version,
      draft,
      contentSafetyStatus,
      authorizedScope: existingAuthorization?.scope || null,
      authorization: access.mutationAuthorization(grant, CAPABILITIES.OPPORTUNITIES_MODERATE),
      audit: resourceId => access.audit(context, grant, {
        scopeType: draft.scopeType,
        scopeId: draft.branchId,
        action: opportunityId ? 'admin.opportunities.update' : 'admin.opportunities.create',
        resourceType: 'OPPORTUNITY',
        resourceId,
        metadata: { expectedVersion: version },
      }),
    })
  }

  async function publishOpportunity(caller, input = {}) {
    return changeOpportunityState(caller, input, {
      action: 'admin.opportunities.publish',
      mutate: mutation => repository.publishOpportunity(mutation),
    })
  }

  async function endOpportunity(caller, input = {}) {
    return changeOpportunityState(caller, input, {
      action: 'admin.opportunities.end',
      mutate: mutation => repository.endOpportunity(mutation),
    })
  }

  async function changeOpportunityState(caller, input, operation) {
    const context = await access.session(caller)
    const opportunityId = requiredId(input.opportunityId, '机会')
    const { scope, grant } = await opportunityAuthorization(
      context,
      opportunityId,
      CAPABILITIES.OPPORTUNITIES_MODERATE,
    )
    const version = expectedVersion(input.expectedVersion)
    return operation.mutate({
      appId: context.caller.appId,
      actorUserId: context.caller.userId,
      opportunityId,
      expectedVersion: version,
      authorizedScope: scope,
      authorization: access.mutationAuthorization(grant, CAPABILITIES.OPPORTUNITIES_MODERATE),
      audit: access.audit(context, grant, {
        scopeType: scope.scopeType,
        scopeId: scope.scopeId,
        action: operation.action,
        resourceType: 'OPPORTUNITY',
        resourceId: opportunityId,
        metadata: { expectedVersion: version },
      }),
    })
  }

  async function unpublishOpportunity(caller, input = {}) {
    const context = await access.session(caller)
    const opportunityId = requiredId(input.opportunityId, '机会')
    const { scope, grant } = await opportunityAuthorization(
      context,
      opportunityId,
      CAPABILITIES.OPPORTUNITIES_MODERATE,
    )
    const reason = text(input.reason, 240, { required: true, label: '下架原因' })
    const version = expectedVersion(input.expectedVersion)
    return repository.unpublishOpportunity({
      appId: context.caller.appId,
      actorUserId: context.caller.userId,
      opportunityId,
      expectedVersion: version,
      reason,
      authorization: access.mutationAuthorization(grant, CAPABILITIES.OPPORTUNITIES_MODERATE),
      authorizedScope: scope,
      audit: access.audit(context, grant, {
        scopeType: scope.scopeType,
        scopeId: scope.scopeId,
        action: 'admin.opportunities.unpublish',
        resourceType: 'OPPORTUNITY',
        resourceId: opportunityId,
        metadata: { reasonLength: reason.length, expectedVersion: version },
      }),
    })
  }

  async function archiveOpportunity(caller, input = {}) {
    const context = await access.session(caller)
    authorize(context.bindings, CAPABILITIES.OPPORTUNITIES_ARCHIVE, {
      scopeType: 'PLATFORM',
      scopeId: null,
    })
    return createOpportunityArchiveService({
      repository,
      authorize: archiveContext => authorize(
        archiveContext.bindings,
        CAPABILITIES.OPPORTUNITIES_ARCHIVE,
        { scopeType: 'PLATFORM', scopeId: null },
      ),
    }).archiveOpportunity(context, input)
  }

  async function getMatchingAdminState(caller, input = {}) {
    const context = await access.session(caller)
    const branchId = input.branchId ? requiredId(input.branchId, '城市分会') : null
    const scope = branchId
      ? { scopeType: 'BRANCH', scopeId: branchId }
      : { scopeType: 'PLATFORM', scopeId: null }
    authorize(context.bindings, CAPABILITIES.OPPORTUNITIES_MODERATE, scope)
    return repository.getMatchingAdminState(
      context.caller.appId,
      visibilityForCapability(context.bindings, CAPABILITIES.OPPORTUNITIES_MODERATE),
      { branchId },
    )
  }

  async function saveMatchingSettings(caller, input = {}) {
    const context = await access.session(caller)
    const branchId = input.branchId ? requiredId(input.branchId, '城市分会') : null
    const scope = branchId
      ? { scopeType: 'BRANCH', scopeId: branchId }
      : { scopeType: 'PLATFORM', scopeId: null }
    const grant = authorize(context.bindings, CAPABILITIES.OPPORTUNITIES_MODERATE, scope)
    const settings = normalizeMatchingSettings(input.settings)
    const version = nonNegativeVersion(input.expectedVersion)
    return repository.saveMatchingSettings({
      appId: context.caller.appId,
      actorUserId: context.caller.userId,
      scope,
      expectedVersion: version,
      settings,
      authorization: access.mutationAuthorization(grant, CAPABILITIES.OPPORTUNITIES_MODERATE),
      audit: nextVersion => access.audit(context, grant, {
        scopeType: scope.scopeType,
        scopeId: scope.scopeId,
        action: 'admin.matching.settings.update',
        resourceType: 'MATCHING_SETTINGS',
        resourceId: scope.scopeId,
        metadata: { expectedVersion: version, nextVersion, ...settings },
      }),
    })
  }

  async function recalculateOpportunityMatching(caller, input = {}) {
    const context = await access.session(caller)
    const opportunityId = requiredId(input.opportunityId, '机会')
    const target = await repository.getMatchingRecalculationTarget(
      context.caller.appId,
      opportunityId,
    )
    if (!target) {
      throw new AdminError('NOT_FOUND', '机会不存在')
    }
    const scope = target.branch_id
      ? { scopeType: 'BRANCH', scopeId: target.branch_id }
      : { scopeType: 'PLATFORM', scopeId: null }
    const grant = authorize(context.bindings, CAPABILITIES.OPPORTUNITIES_MODERATE, scope)
    if (target.status !== 'PUBLISHED') {
      throw new AdminError('INVALID_STATE', '只有已发布机会可以重算撮合结果')
    }
    const idempotencyKey = text(input.idempotencyKey, 128, {
      required: true,
      label: '幂等标识',
    })
    if (idempotencyKey.length < 12) {
      throw new AdminError('VALIDATION_FAILED', '幂等标识无效')
    }
    const authorizedTarget = await repository.authorizeMatchingRecalculation({
      appId: context.caller.appId,
      actorUserId: context.caller.userId,
      opportunityId,
      expectedVersion: Number(target.version),
      authorization: access.mutationAuthorization(grant, CAPABILITIES.OPPORTUNITIES_MODERATE),
    })
    try {
      return await dispatchMatchingRecalculation({
        appId: context.caller.appId,
        actorUserId: context.caller.userId,
        requesterUserId: authorizedTarget.owner_user_id,
        opportunityId,
        sourceVersion: Number(authorizedTarget.version),
        idempotencyKey,
      })
    }
    catch (error) {
      const code = String(error?.message || '')
      if (['MATCHING_DISPATCH_CONFIG_REQUIRED', 'MATCHING_DISPATCH_UNAVAILABLE'].includes(code)) {
        throw new AdminError(code, '机会撮合重算服务暂时不可用')
      }
      throw new AdminError('MATCHING_DISPATCH_UNAVAILABLE', '机会撮合重算服务暂时不可用')
    }
  }

  async function getOpportunityCommentAdminState(caller, input = {}) {
    const context = await access.session(caller)
    const opportunityId = requiredId(input.opportunityId, '机会')
    await opportunityAuthorization(context, opportunityId, CAPABILITIES.MESSAGES_MANAGE)
    const state = await repository.getOpportunityCommentAdminState(
      context.caller.appId,
      opportunityId,
    )
    return {
      settings: state.settings,
      comments: state.comments.map(comment => publicComment(
        comment,
        context.caller.appId,
        profileRefSecret,
      )),
      reports: state.reports.map(report => publicReport(
        report,
        context.caller.appId,
        profileRefSecret,
      )),
    }
  }

  async function saveOpportunityCommentSettings(caller, input = {}) {
    const context = await access.session(caller)
    const opportunityId = requiredId(input.opportunityId, '机会')
    const { scope, grant } = await opportunityAuthorization(
      context,
      opportunityId,
      CAPABILITIES.MESSAGES_MANAGE,
    )
    const settings = normalizeCommentSettings(input.settings)
    const version = nonNegativeVersion(input.expectedVersion)
    return repository.saveOpportunityCommentSettings({
      appId: context.caller.appId,
      actorUserId: context.caller.userId,
      opportunityId,
      expectedVersion: version,
      settings,
      authorization: access.mutationAuthorization(grant, CAPABILITIES.MESSAGES_MANAGE),
      audit: nextVersion => access.audit(context, grant, {
        scopeType: scope.scopeType,
        scopeId: scope.scopeId,
        action: 'admin.opportunity_comments.settings.update',
        resourceType: 'OPPORTUNITY_COMMENT_SETTINGS',
        resourceId: opportunityId,
        metadata: { expectedVersion: version, nextVersion },
      }),
    })
  }

  async function moderateOpportunityComment(caller, input = {}) {
    const context = await access.session(caller)
    const opportunityId = requiredId(input.opportunityId, '机会')
    const { scope, grant } = await opportunityAuthorization(
      context,
      opportunityId,
      CAPABILITIES.MESSAGES_MANAGE,
    )
    const commentId = requiredId(input.commentId, '评论')
    const action = ['PUBLISH', 'HIDE'].includes(input.action) ? input.action : null
    if (!action) {
      throw new AdminError('VALIDATION_FAILED', '审核操作无效')
    }
    const reason = text(input.reason, 300, { required: true, label: '审核原因' })
    const version = expectedVersion(input.expectedVersion)
    return repository.moderateOpportunityComment({
      appId: context.caller.appId,
      actorUserId: context.caller.userId,
      commentId,
      expectedVersion: version,
      action,
      reason,
      authorization: access.mutationAuthorization(grant, CAPABILITIES.MESSAGES_MANAGE),
      audit: (resourceOpportunityId, status) => {
        if (resourceOpportunityId !== opportunityId) {
          throw new AdminError('CONFLICT', '评论所属机会已变化')
        }
        return access.audit(context, grant, {
          scopeType: scope.scopeType,
          scopeId: scope.scopeId,
          action: action === 'PUBLISH'
            ? 'admin.opportunity_comments.publish'
            : 'admin.opportunity_comments.hide',
          resourceType: 'OPPORTUNITY_COMMENT',
          resourceId: commentId,
          metadata: {
            opportunityId,
            status,
            expectedVersion: version,
            reasonLength: reason.length,
          },
        })
      },
    })
  }

  async function closeOpportunityCommentReport(caller, input = {}) {
    const context = await access.session(caller)
    const opportunityId = requiredId(input.opportunityId, '机会')
    const { scope, grant } = await opportunityAuthorization(
      context,
      opportunityId,
      CAPABILITIES.MESSAGES_MANAGE,
    )
    const reportId = requiredId(input.reportId, '举报')
    const decision = ['RESOLVED', 'DISMISSED'].includes(input.decision) ? input.decision : null
    if (!decision) {
      throw new AdminError('VALIDATION_FAILED', '举报处理结果无效')
    }
    const reason = text(input.reason, 300, { required: true, label: '处理原因' })
    const version = expectedVersion(input.expectedVersion)
    return repository.closeOpportunityCommentReport({
      appId: context.caller.appId,
      actorUserId: context.caller.userId,
      opportunityId,
      reportId,
      expectedVersion: version,
      decision,
      reason,
      authorization: access.mutationAuthorization(grant, CAPABILITIES.MESSAGES_MANAGE),
      audit: (resourceOpportunityId, commentId, status) => {
        if (resourceOpportunityId !== opportunityId) {
          throw new AdminError('CONFLICT', '举报所属机会已变化')
        }
        return access.audit(context, grant, {
          scopeType: scope.scopeType,
          scopeId: scope.scopeId,
          action: 'admin.opportunity_comment_reports.close',
          resourceType: 'OPPORTUNITY_COMMENT_REPORT',
          resourceId: reportId,
          metadata: {
            opportunityId,
            commentId,
            status,
            expectedVersion: version,
            reasonLength: reason.length,
          },
        })
      },
    })
  }

  return {
    archiveOpportunity,
    closeOpportunityCommentReport,
    endOpportunity,
    getMatchingAdminState,
    getOpportunity,
    getOpportunityCommentAdminState,
    getOpportunityEditorOptions,
    listOpportunities,
    moderateOpportunityComment,
    normalizeExportFilters: normalizeOpportunityFilters,
    publishOpportunity,
    recalculateOpportunityMatching,
    saveMatchingSettings,
    saveOpportunity,
    saveOpportunityCommentSettings,
    unpublishOpportunity,
  }
}

function publicComment(comment, appId, profileRefSecret) {
  return {
    id: comment.id,
    authorNickname: comment.authorNickname,
    type: comment.type,
    body: comment.body,
    rating: comment.rating,
    participant: comment.participant,
    status: comment.status,
    callCount: comment.callCount,
    version: comment.version,
    createdAt: comment.createdAt,
    editedAt: comment.editedAt,
    authorProfileRef: createProfileRef(
      { appId, userId: comment.authorUserId },
      profileRefSecret,
    ),
  }
}

function publicReport(report, appId, profileRefSecret) {
  return {
    id: report.id,
    commentId: report.commentId,
    reporterNickname: report.reporterNickname,
    category: report.category,
    description: report.description,
    status: report.status,
    version: report.version,
    createdAt: report.createdAt,
    reporterProfileRef: createProfileRef(
      { appId, userId: report.reporterUserId },
      profileRefSecret,
    ),
  }
}

function normalizeOpportunityFilters(value) {
  const filters = normalizeFilters(value)
  const updatedFrom = dateTimeFilter(filters.updatedFrom, '开始时间')
  const updatedTo = dateTimeFilter(filters.updatedTo, '结束时间')
  const deadlineFrom = dateTimeFilter(filters.deadlineFrom, '截止开始时间')
  const deadlineTo = dateTimeFilter(filters.deadlineTo, '截止结束时间')
  const minAmountCents = filters.minAmountCents === undefined || filters.minAmountCents === '' ? undefined : Number(filters.minAmountCents)
  const maxAmountCents = filters.maxAmountCents === undefined || filters.maxAmountCents === '' ? undefined : Number(filters.maxAmountCents)
  if ((minAmountCents !== undefined && (!Number.isSafeInteger(minAmountCents) || minAmountCents < 0))
    || (maxAmountCents !== undefined && (!Number.isSafeInteger(maxAmountCents) || maxAmountCents < 0))
    || (minAmountCents !== undefined && maxAmountCents !== undefined && minAmountCents > maxAmountCents)) {
    throw new AdminError('VALIDATION_FAILED', '金额区间无效')
  }
  const locationTypes = Array.isArray(filters.locationTypes) ? [...new Set(filters.locationTypes)] : []
  if (locationTypes.length > 3 || locationTypes.some(item => !['CITY', 'NATIONAL', 'REMOTE'].includes(item))) throw new AdminError('VALIDATION_FAILED', '合作范围无效')
  const locationCityTagIds = Array.isArray(filters.locationCityTagIds)
    ? [...new Set(filters.locationCityTagIds.map(item => requiredId(item, '合作城市')))]
    : []
  if (locationCityTagIds.length > 16) throw new AdminError('VALIDATION_FAILED', '合作城市过多')
  if (updatedFrom && updatedTo && updatedFrom > updatedTo) {
    throw new AdminError('VALIDATION_FAILED', '机会开始时间不能晚于结束时间')
  }
  if (deadlineFrom && deadlineTo && deadlineFrom > deadlineTo) {
    throw new AdminError('VALIDATION_FAILED', '机会截止开始时间不能晚于结束时间')
  }
  return {
    query: text(filters.query, 80),
    ownerQuery: text(filters.ownerQuery, 80),
    cityQuery: text(filters.cityQuery, 80),
    status: enumFilter(filters.status, OPPORTUNITY_STATUSES, '机会状态'),
    updatedFrom,
    updatedTo,
    deadlineFrom,
    deadlineTo,
    ...(minAmountCents === undefined ? {} : { minAmountCents }),
    ...(maxAmountCents === undefined ? {} : { maxAmountCents }),
    ...(locationTypes.length ? { locationTypes } : {}),
    ...(locationCityTagIds.length ? { locationCityTagIds } : {}),
  }
}

function normalizeOpportunityDraft(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AdminError('VALIDATION_FAILED', '机会内容无效')
  }
  const scopeType = value.scopeType === 'BRANCH' ? 'BRANCH' : 'PLATFORM'
  const roleKeys = Array.isArray(value.roleKeys) ? [...new Set(value.roleKeys)] : []
  if (roleKeys.length > 6 || roleKeys.some(item => !COOPERATION_ROLE_KEYS.has(item))) {
    throw new AdminError('VALIDATION_FAILED', '合作角色无效')
  }
  const tagIds = Array.isArray(value.tagIds)
    ? [...new Set(value.tagIds.map(item => requiredId(item, '标签')))]
    : []
  if (tagIds.length > 20) {
    throw new AdminError('VALIDATION_FAILED', '标签数量过多')
  }
  return {
    ownerUserId: requiredId(value.ownerUserId, '发布人'),
    scopeType,
    branchId: scopeType === 'BRANCH' ? requiredId(value.branchId, '城市分会') : null,
    title: text(value.title, 120, { required: true, label: '机会标题' }),
    valueSummary: text(value.valueSummary, 300, { required: true, label: '机会价值' }),
    targetSummary: text(value.targetSummary, 300),
    description: text(value.description, 5_000),
    cityTagId: value.cityTagId ? requiredId(value.cityTagId, '城市') : null,
    commercialTerms: normalizeCommercialTerms(value.commercialTerms),
    roleKeys,
    tagIds,
    deadlineAt: value.deadlineAt ? dateTimeFilter(value.deadlineAt, '截止时间') : null,
  }
}

function normalizeMatchingSettings(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AdminError('VALIDATION_FAILED', '撮合设置无效')
  }
  const talentMinScore = Number(value.talentMinScore)
  const projectMinScore = Number(value.projectMinScore)
  const maximumCandidates = Number(value.maximumCandidates)
  if (!Number.isInteger(talentMinScore) || talentMinScore < 0 || talentMinScore > 100
    || !Number.isInteger(projectMinScore) || projectMinScore < 0 || projectMinScore > 100
    || !Number.isInteger(maximumCandidates) || maximumCandidates < 10 || maximumCandidates > 500
    || typeof value.externalProviderEnabled !== 'boolean') {
    throw new AdminError('VALIDATION_FAILED', '撮合设置无效')
  }
  return {
    talentMinScore,
    projectMinScore,
    maximumCandidates,
    externalProviderEnabled: value.externalProviderEnabled,
  }
}

function normalizeCommentSettings(value) {
  if (!value || typeof value !== 'object'
    || typeof value.commentsEnabled !== 'boolean'
    || typeof value.reviewsEnabled !== 'boolean'
    || typeof value.callsEnabled !== 'boolean'
    || !['AUTO', 'REVIEW'].includes(value.moderationMode)) {
    throw new AdminError('VALIDATION_FAILED', '评论设置无效')
  }
  return {
    commentsEnabled: value.commentsEnabled,
    reviewsEnabled: value.reviewsEnabled,
    callsEnabled: value.callsEnabled,
    moderationMode: value.moderationMode,
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

function nonNegativeVersion(value) {
  const version = Number(value)
  if (!Number.isInteger(version) || version < 0) {
    throw new AdminError('VALIDATION_FAILED', '记录版本无效')
  }
  return version
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

module.exports = { createAdminOpportunities }
