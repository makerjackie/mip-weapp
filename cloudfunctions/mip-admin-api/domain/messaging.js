'use strict'

const {
  CAPABILITIES,
  authorize,
  firstGrant,
  visibilityForCapability,
} = require('./capabilities')
const {
  normalizeAnnouncementDraft,
  normalizeAnnouncementFilters,
  normalizeAnnouncementReason,
} = require('./announcement-validation')
const {
  normalizeMessageCampaignDraft,
  normalizeMessageCampaignFilters,
  normalizePublishKey,
  normalizeRecipientSearch,
} = require('./message-campaign-validation')
const {
  normalizeMessageTemplateDraft,
  normalizeMessageTemplateFilters,
} = require('./message-template-validation')
const { createProfileRef, readProfileRef } = require('../lib/profile-ref')
const {
  AdminError,
  expectedVersion,
  limit,
  requiredId,
  text,
} = require('./validation')

function createAdminMessaging({
  repository,
  access,
  contentSafety = async () => 'ERROR',
  profileRefSecret = '',
}) {
  async function announcementAuthorization(context, announcementId) {
    const scope = await repository.getAnnouncementScope(
      context.caller.appId,
      requiredId(announcementId, '公告'),
    )
    if (!scope) throw new AdminError('NOT_FOUND', '公告不存在')
    return {
      scope,
      grant: authorize(context.bindings, CAPABILITIES.ANNOUNCEMENTS_MANAGE, scope),
    }
  }

  async function listAnnouncementScopes(caller) {
    const context = await access.session(caller)
    firstGrant(context.bindings, CAPABILITIES.ANNOUNCEMENTS_MANAGE)
    return repository.listAnnouncementScopes(
      context.caller.appId,
      visibilityForCapability(context.bindings, CAPABILITIES.ANNOUNCEMENTS_MANAGE),
    )
  }

  async function listAnnouncements(caller, input = {}) {
    const context = await access.session(caller)
    firstGrant(context.bindings, CAPABILITIES.ANNOUNCEMENTS_MANAGE)
    return {
      items: await repository.listAnnouncements(
        context.caller.appId,
        visibilityForCapability(context.bindings, CAPABILITIES.ANNOUNCEMENTS_MANAGE),
        normalizeAnnouncementFilters(input),
        limit(input.limit, 50),
      ),
      nextCursor: null,
    }
  }

  async function getAnnouncement(caller, input = {}) {
    const context = await access.session(caller)
    const announcementId = requiredId(input.announcementId, '公告')
    await announcementAuthorization(context, announcementId)
    const item = await repository.getAnnouncement(context.caller.appId, announcementId)
    if (!item) throw new AdminError('NOT_FOUND', '公告不存在')
    return item
  }

  async function saveAnnouncement(caller, input = {}) {
    const context = await access.session(caller)
    const draft = normalizeAnnouncementDraft(input)
    const requestedScope = announcementScope(draft)
    const announcementId = input.announcementId ? requiredId(input.announcementId, '公告') : null
    const existingAuthorization = announcementId
      ? await announcementAuthorization(context, announcementId)
      : null
    const grant = authorize(context.bindings, CAPABILITIES.ANNOUNCEMENTS_MANAGE, requestedScope)
    const version = announcementId ? expectedVersion(input.expectedVersion) : null
    const contentSafetyStatus = await contentSafety(draft, caller)
    return repository.saveAnnouncement({
      appId: context.caller.appId,
      actorUserId: context.caller.userId,
      announcementId,
      expectedVersion: version,
      draft,
      contentSafetyStatus,
      authorization: access.mutationAuthorization(grant, CAPABILITIES.ANNOUNCEMENTS_MANAGE),
      authorizedExistingScope: existingAuthorization?.scope || null,
      audit: (resourceId, action, metadata) => access.audit(context, grant, {
        ...requestedScope,
        action,
        resourceType: 'ANNOUNCEMENT',
        resourceId,
        metadata,
      }),
    })
  }

  async function publishAnnouncement(caller, input = {}) {
    const context = await access.session(caller)
    const announcementId = requiredId(input.announcementId, '公告')
    const { scope, grant } = await announcementAuthorization(context, announcementId)
    const version = expectedVersion(input.expectedVersion)
    return repository.publishAnnouncement({
      appId: context.caller.appId,
      actorUserId: context.caller.userId,
      announcementId,
      expectedVersion: version,
      authorization: access.mutationAuthorization(grant, CAPABILITIES.ANNOUNCEMENTS_MANAGE),
      authorizedScope: scope,
      audit: (resourceId, action, metadata) => access.audit(context, grant, {
        scopeType: scope.scopeType,
        scopeId: scope.scopeId,
        action,
        resourceType: 'ANNOUNCEMENT',
        resourceId,
        metadata,
      }),
    })
  }

  async function withdrawAnnouncement(caller, input = {}) {
    const context = await access.session(caller)
    const announcementId = requiredId(input.announcementId, '公告')
    const { scope, grant } = await announcementAuthorization(context, announcementId)
    const version = expectedVersion(input.expectedVersion)
    const reason = normalizeAnnouncementReason(input.reason)
    return repository.withdrawAnnouncement({
      appId: context.caller.appId,
      actorUserId: context.caller.userId,
      announcementId,
      expectedVersion: version,
      reason,
      authorization: access.mutationAuthorization(grant, CAPABILITIES.ANNOUNCEMENTS_MANAGE),
      authorizedScope: scope,
      audit: (resourceId, action, metadata) => access.audit(context, grant, {
        scopeType: scope.scopeType,
        scopeId: scope.scopeId,
        action,
        resourceType: 'ANNOUNCEMENT',
        resourceId,
        metadata,
      }),
    })
  }

  async function setAnnouncementPinned(caller, input = {}) {
    const context = await access.session(caller)
    const announcementId = requiredId(input.announcementId, '公告')
    const { scope, grant } = await announcementAuthorization(context, announcementId)
    const version = expectedVersion(input.expectedVersion)
    if (typeof input.pinned !== 'boolean') throw new AdminError('VALIDATION_FAILED', '置顶状态无效')
    return repository.setAnnouncementPinned({
      appId: context.caller.appId,
      actorUserId: context.caller.userId,
      announcementId,
      expectedVersion: version,
      pinned: input.pinned,
      authorization: access.mutationAuthorization(grant, CAPABILITIES.ANNOUNCEMENTS_MANAGE),
      authorizedScope: scope,
      audit: (resourceId, action, metadata) => access.audit(context, grant, {
        scopeType: scope.scopeType,
        scopeId: scope.scopeId,
        action,
        resourceType: 'ANNOUNCEMENT',
        resourceId,
        metadata,
      }),
    })
  }

  async function messageCampaignAuthorization(context, campaignId) {
    const scope = await repository.getCampaignScope(
      context.caller.appId,
      requiredId(campaignId, '消息活动'),
    )
    if (!scope) throw new AdminError('NOT_FOUND', '消息活动不存在')
    return {
      scope,
      grant: authorize(context.bindings, CAPABILITIES.MESSAGES_MANAGE, scope),
    }
  }

  async function messageTemplateAuthorization(context, templateId) {
    const scope = await repository.getTemplateScope(
      context.caller.appId,
      requiredId(templateId, '消息模板'),
    )
    if (!scope) throw new AdminError('NOT_FOUND', '消息模板不存在')
    return {
      scope,
      grant: authorize(context.bindings, CAPABILITIES.MESSAGES_MANAGE, scope),
    }
  }

  function publicCampaign(item, appId) {
    const {
      audienceUserIds = [],
      publishIdempotencyKey: _publishIdempotencyKey,
      publishRequestHash: _publishRequestHash,
      ...safe
    } = item
    return {
      ...safe,
      recipientRefs: audienceUserIds.map(userId => createProfileRef({ appId, userId }, profileRefSecret)),
    }
  }

  async function listMessageCampaignScopes(caller) {
    const context = await access.session(caller)
    firstGrant(context.bindings, CAPABILITIES.MESSAGES_MANAGE)
    return repository.listScopes(
      context.caller.appId,
      visibilityForCapability(context.bindings, CAPABILITIES.MESSAGES_MANAGE),
    )
  }

  async function listMessageCampaigns(caller, input = {}) {
    const context = await access.session(caller)
    firstGrant(context.bindings, CAPABILITIES.MESSAGES_MANAGE)
    const filters = normalizeMessageCampaignFilters(input)
    const items = await repository.listCampaigns(
      context.caller.appId,
      visibilityForCapability(context.bindings, CAPABILITIES.MESSAGES_MANAGE),
      filters,
      limit(input.limit, 50),
    )
    return { items: items.map(item => publicCampaign(item, context.caller.appId)), nextCursor: null }
  }

  async function getMessageCampaign(caller, input = {}) {
    const context = await access.session(caller)
    const campaignId = requiredId(input.campaignId, '消息活动')
    await messageCampaignAuthorization(context, campaignId)
    const item = await repository.getCampaign(context.caller.appId, campaignId)
    if (!item) throw new AdminError('NOT_FOUND', '消息活动不存在')
    return publicCampaign(item, context.caller.appId)
  }

  async function searchMessageRecipients(caller, input = {}) {
    const context = await access.session(caller)
    const request = normalizeRecipientSearch(input)
    const scope = request.branchId
      ? { scopeType: 'BRANCH', scopeId: request.branchId }
      : { scopeType: 'PLATFORM', scopeId: null }
    authorize(context.bindings, CAPABILITIES.MESSAGES_MANAGE, scope)
    const rows = await repository.searchRecipients(
      context.caller.appId,
      scope,
      request.query,
      limit(input.limit, 50),
    )
    return {
      items: rows.map(row => ({
        profileRef: createProfileRef({ appId: context.caller.appId, userId: row.id }, profileRefSecret),
        nickname: row.nickname,
        headline: row.headline,
        branchName: row.branch_name || '',
      })),
      nextCursor: null,
    }
  }

  async function saveMessageCampaign(caller, input = {}) {
    const context = await access.session(caller)
    const normalized = normalizeMessageCampaignDraft(input)
    const requestedScope = campaignScope(normalized)
    const campaignId = input.campaignId ? requiredId(input.campaignId, '消息活动') : null
    const existingAuthorization = campaignId
      ? await messageCampaignAuthorization(context, campaignId)
      : null
    const grant = authorize(context.bindings, CAPABILITIES.MESSAGES_MANAGE, requestedScope)
    const audienceUserIds = normalized.recipientRefs.map(profileRef => decodeRecipientRef(
      profileRef,
      context.caller.appId,
      profileRefSecret,
    ))
    const draft = { ...normalized, audienceUserIds }
    delete draft.recipientRefs
    const contentSafetyStatus = await contentSafety(draft, caller)
    const item = await repository.saveCampaign({
      appId: context.caller.appId,
      actorUserId: context.caller.userId,
      campaignId,
      expectedVersion: campaignId ? expectedVersion(input.expectedVersion) : null,
      draft,
      contentSafetyStatus,
      authorization: access.mutationAuthorization(grant, CAPABILITIES.MESSAGES_MANAGE),
      authorizedExistingScope: existingAuthorization?.scope || null,
      audit: (resourceId, action, metadata) => access.audit(context, grant, {
        scopeType: requestedScope.scopeType,
        scopeId: requestedScope.scopeId,
        action,
        resourceType: 'MESSAGE_CAMPAIGN',
        resourceId,
        metadata,
      }),
    })
    return publicCampaign(item, context.caller.appId)
  }

  async function snapshotMessageCampaign(caller, input = {}) {
    const context = await access.session(caller)
    const campaignId = requiredId(input.campaignId, '消息活动')
    const { scope, grant } = await messageCampaignAuthorization(context, campaignId)
    const item = await repository.snapshotCampaign({
      appId: context.caller.appId,
      actorUserId: context.caller.userId,
      campaignId,
      expectedVersion: expectedVersion(input.expectedVersion),
      authorization: access.mutationAuthorization(grant, CAPABILITIES.MESSAGES_MANAGE),
      authorizedScope: scope,
      audit: (resourceId, action, metadata) => access.audit(context, grant, {
        scopeType: scope.scopeType,
        scopeId: scope.scopeId,
        action,
        resourceType: 'MESSAGE_CAMPAIGN',
        resourceId,
        metadata,
      }),
    })
    return publicCampaign(item, context.caller.appId)
  }

  async function publishMessageCampaign(caller, input = {}) {
    const context = await access.session(caller)
    const campaignId = requiredId(input.campaignId, '消息活动')
    const { scope, grant } = await messageCampaignAuthorization(context, campaignId)
    return repository.publishCampaign({
      appId: context.caller.appId,
      actorUserId: context.caller.userId,
      campaignId,
      expectedVersion: expectedVersion(input.expectedVersion),
      idempotencyKey: normalizePublishKey(input.idempotencyKey),
      authorization: access.mutationAuthorization(grant, CAPABILITIES.MESSAGES_MANAGE),
      authorizedScope: scope,
      audit: (resourceId, action, metadata) => access.audit(context, grant, {
        scopeType: scope.scopeType,
        scopeId: scope.scopeId,
        action,
        resourceType: 'MESSAGE_CAMPAIGN',
        resourceId,
        metadata,
      }),
    })
  }

  async function withdrawMessageCampaign(caller, input = {}) {
    const context = await access.session(caller)
    const campaignId = requiredId(input.campaignId, '消息活动')
    const { scope, grant } = await messageCampaignAuthorization(context, campaignId)
    const item = await repository.withdrawCampaign({
      appId: context.caller.appId,
      actorUserId: context.caller.userId,
      campaignId,
      expectedVersion: expectedVersion(input.expectedVersion),
      reason: text(input.reason, 300, { required: true, label: '撤销原因' }),
      authorization: access.mutationAuthorization(grant, CAPABILITIES.MESSAGES_MANAGE),
      authorizedScope: scope,
      audit: (resourceId, action, metadata) => access.audit(context, grant, {
        scopeType: scope.scopeType,
        scopeId: scope.scopeId,
        action,
        resourceType: 'MESSAGE_CAMPAIGN',
        resourceId,
        metadata,
      }),
    })
    return publicCampaign(item, context.caller.appId)
  }

  async function listMessageTemplates(caller, input = {}) {
    const context = await access.session(caller)
    firstGrant(context.bindings, CAPABILITIES.MESSAGES_MANAGE)
    return {
      items: await repository.listTemplates(
        context.caller.appId,
        visibilityForCapability(context.bindings, CAPABILITIES.MESSAGES_MANAGE),
        normalizeMessageTemplateFilters(input),
        limit(input.limit, 50),
      ),
      nextCursor: null,
    }
  }

  async function getMessageTemplate(caller, input = {}) {
    const context = await access.session(caller)
    const templateId = requiredId(input.templateId, '消息模板')
    const { scope } = await messageTemplateAuthorization(context, templateId)
    const item = await repository.getTemplate(context.caller.appId, templateId)
    if (!item) throw new AdminError('NOT_FOUND', '消息模板不存在')
    if (!sameScope(scope, templateScope(item))) {
      throw new AdminError('CONFLICT', '消息模板状态已变化，请刷新后重试')
    }
    return item
  }

  async function saveMessageTemplate(caller, input = {}) {
    const context = await access.session(caller)
    const draft = normalizeMessageTemplateDraft(input)
    const requestedScope = templateScope(draft)
    const hasTemplateId = Object.hasOwn(input, 'templateId')
    const hasExpectedVersion = Object.hasOwn(input, 'expectedVersion')
    if (hasTemplateId !== hasExpectedVersion) {
      throw new AdminError('VALIDATION_FAILED', '消息模板更新信息无效')
    }
    const templateId = hasTemplateId ? requiredId(input.templateId, '消息模板') : null
    const existingAuthorization = templateId
      ? await messageTemplateAuthorization(context, templateId)
      : null
    const grant = authorize(context.bindings, CAPABILITIES.MESSAGES_MANAGE, requestedScope)
    const version = templateId ? expectedVersion(input.expectedVersion) : null
    const contentSafetyStatus = await contentSafety({
      name: draft.name,
      title: draft.title,
      body: draft.body,
    }, caller)
    return repository.saveTemplate({
      appId: context.caller.appId,
      actorUserId: context.caller.userId,
      templateId,
      expectedVersion: version,
      draft,
      contentSafetyStatus,
      authorization: access.mutationAuthorization(grant, CAPABILITIES.MESSAGES_MANAGE),
      authorizedExistingScope: existingAuthorization?.scope || null,
      audit: (resourceId, action, metadata) => access.audit(context, grant, {
        scopeType: requestedScope.scopeType,
        scopeId: requestedScope.scopeId,
        action,
        resourceType: 'MESSAGE_TEMPLATE',
        resourceId,
        metadata,
      }),
    })
  }

  async function activateMessageTemplate(caller, input = {}) {
    const context = await access.session(caller)
    const templateId = requiredId(input.templateId, '消息模板')
    const { scope, grant } = await messageTemplateAuthorization(context, templateId)
    return repository.activateTemplate({
      appId: context.caller.appId,
      actorUserId: context.caller.userId,
      templateId,
      expectedVersion: expectedVersion(input.expectedVersion),
      authorization: access.mutationAuthorization(grant, CAPABILITIES.MESSAGES_MANAGE),
      authorizedScope: scope,
      audit: (resourceId, action, metadata) => access.audit(context, grant, {
        scopeType: scope.scopeType,
        scopeId: scope.scopeId,
        action,
        resourceType: 'MESSAGE_TEMPLATE',
        resourceId,
        metadata,
      }),
    })
  }

  async function archiveMessageTemplate(caller, input = {}) {
    const context = await access.session(caller)
    const templateId = requiredId(input.templateId, '消息模板')
    const { scope, grant } = await messageTemplateAuthorization(context, templateId)
    return repository.archiveTemplate({
      appId: context.caller.appId,
      actorUserId: context.caller.userId,
      templateId,
      expectedVersion: expectedVersion(input.expectedVersion),
      authorization: access.mutationAuthorization(grant, CAPABILITIES.MESSAGES_MANAGE),
      authorizedScope: scope,
      audit: (resourceId, action, metadata) => access.audit(context, grant, {
        scopeType: scope.scopeType,
        scopeId: scope.scopeId,
        action,
        resourceType: 'MESSAGE_TEMPLATE',
        resourceId,
        metadata,
      }),
    })
  }

  return {
    activateMessageTemplate,
    archiveMessageTemplate,
    getAnnouncement,
    getMessageCampaign,
    getMessageTemplate,
    listAnnouncements,
    listAnnouncementScopes,
    listMessageCampaignScopes,
    listMessageCampaigns,
    listMessageTemplates,
    publishAnnouncement,
    publishMessageCampaign,
    saveAnnouncement,
    saveMessageCampaign,
    saveMessageTemplate,
    searchMessageRecipients,
    setAnnouncementPinned,
    snapshotMessageCampaign,
    withdrawAnnouncement,
    withdrawMessageCampaign,
  }
}

function announcementScope(draft) {
  return {
    scopeType: draft.scopeType,
    scopeId: draft.scopeType === 'BRANCH' ? draft.branchId : null,
  }
}

function campaignScope(draft) {
  return {
    scopeType: draft.scopeType,
    scopeId: draft.scopeType === 'BRANCH' ? draft.branchId : null,
  }
}

function templateScope(draft) {
  return {
    scopeType: draft.scopeType,
    scopeId: draft.scopeType === 'BRANCH' ? draft.branchId : null,
  }
}

function sameScope(left, right) {
  return left?.scopeType === right?.scopeType
    && (left?.scopeId || null) === (right?.scopeId || null)
}

function decodeRecipientRef(profileRef, appId, profileRefSecret) {
  try {
    return readProfileRef(profileRef, appId, profileRefSecret)
  }
  catch (error) {
    if (error?.message === 'IDENTITY_CONFIG_REQUIRED') throw error
    throw new AdminError('MESSAGE_RECIPIENT_INVALID', '收件人信息已失效')
  }
}

module.exports = { createAdminMessaging }
