'use strict'

const { EXPECTED_OPERATION_COUNT, operationCatalog } = require('./operation-registry')

const PUBLIC_OPERATION_CONTRACT_VERSION = 1
const ADMIN_WEB_OPERATION_CONTRACT_VERSION = 1
const EMPTY_INPUT_KEYS = Object.freeze([])

function webMutation(action, requiredInputKeys, optionalInputKeys = [], options = {}) {
  return Object.freeze({
    action,
    requiredInputKeys: Object.freeze([...requiredInputKeys]),
    optionalInputKeys: Object.freeze([...optionalInputKeys]),
    forwardIdempotencyKey: options.forwardIdempotencyKey === true,
    webRoute: options.webRoute === 'MEDIA' ? 'MEDIA' : 'ADMIN',
  })
}

function domainIdempotentWebMutation(action, requiredInputKeys, optionalInputKeys = []) {
  return webMutation(action, requiredInputKeys, optionalInputKeys, {
    forwardIdempotencyKey: true,
  })
}

const adminWebQueryActions = Object.freeze([
  'mip.admin.session',
  'mip.admin.branches.list',
  'mip.admin.roles.list',
  'mip.admin.roles.candidates',
  'mip.admin.rolePolicies.list',
  'mip.admin.audit.list',
  'mip.admin.users.list',
  'mip.admin.users.get',
  'mip.admin.users.influence.list',
  'mip.admin.communityReports.list',
  'mip.admin.memberships.get',
  'mip.admin.memberships.timeline',
  'mip.admin.events.list',
  'mip.admin.events.catalog.list',
  'mip.admin.events.tags.get',
  'mip.admin.events.recaps.list',
  'mip.admin.events.recaps.get',
  'mip.admin.events.policy.get',
  'mip.admin.events.get',
  'mip.admin.events.insights.get',
  'mip.admin.events.album.list',
  'mip.admin.events.comments.get',
  'mip.admin.events.roster',
  'mip.admin.events.rosterAll',
  'mip.admin.orders.list',
  'mip.admin.orders.get',
  'mip.admin.paymentAttempts.list',
  'mip.admin.announcements.scopes',
  'mip.admin.announcements.list',
  'mip.admin.announcements.get',
  'mip.admin.messageCampaigns.scopes',
  'mip.admin.messageCampaigns.list',
  'mip.admin.messageCampaigns.get',
  'mip.admin.messageCampaigns.recipients',
  'mip.admin.messageTemplates.list',
  'mip.admin.messageTemplates.get',
  'mip.admin.messageDeliveryReviews.list',
  'mip.admin.messageDeliveryReviews.get',
  'mip.admin.messageDeliveryRecords.list',
  'mip.admin.knowledge.list',
  'mip.admin.knowledge.get',
  'mip.admin.knowledge.schedules.list',
  'mip.admin.opportunities.list',
  'mip.admin.userContent.list',
  'mip.admin.userContent.get',
  'mip.admin.opportunities.get',
  'mip.admin.opportunities.options',
  'mip.admin.matching.get',
  'mip.admin.opportunityComments.get',
  'mip.admin.growth.levels',
  'mip.admin.growth.benefits',
  'mip.admin.growth.rules',
  'mip.admin.growth.entries',
  'mip.admin.benefits.ledger',
  'mip.admin.growth.levelTransitions',
  'mip.admin.badges.list',
  'mip.admin.badges.awards',
  'mip.admin.tasks.list',
  'mip.admin.tasks.get',
  'mip.admin.tasks.eligibleLevels.list',
  'mip.admin.tasks.assignableMembers.list',
  'mip.admin.tasks.completions.list',
  'mip.admin.tasks.completions.get',
  'mip.admin.tasks.completions.export',
  'mip.admin.banners.session',
  'mip.admin.banners.list',
  'mip.admin.banners.get',
  'mip.admin.game.session',
  'mip.admin.game.rankings.list',
  'mip.admin.game.seasons.list',
  'mip.admin.game.teams.list',
  'mip.admin.game.members.assignable.list',
  'mip.admin.game.matches.list',
  'mip.admin.game.blindBoxes.catalogs.list',
  'mip.admin.game.blindBoxes.cards.list',
  'mip.admin.dashboard',
  'mip.admin.dashboard.overview.get',
  'mip.admin.exports.status',
  'mip.admin.exceptions.list',
  'mip.admin.operations.queue.list',
])

const adminWebMutationPolicies = Object.freeze([
  domainIdempotentWebMutation('mip.admin.memberships.grant', ['durationMonths', 'expectedChainVersion', 'reason', 'userId']),
  domainIdempotentWebMutation('mip.admin.events.clone', ['expectedVersion', 'sourceEventId']),
  domainIdempotentWebMutation('mip.admin.events.changeStatus', ['eventId', 'expectedVersion', 'status']),
  domainIdempotentWebMutation('mip.admin.events.archive', ['eventId', 'expectedVersion', 'reason']),
  domainIdempotentWebMutation('mip.admin.communications.publishEventReminder', ['eventId', 'expectedVersion', 'sendWechatReminder']),
  domainIdempotentWebMutation('mip.admin.refunds.submit', ['orderId', 'reason']),

  webMutation('mip.admin.users.update', ['userId', 'expectedVersion', 'fields']),
  webMutation('mip.admin.users.changePrimaryBranch', ['userId', 'targetBranchId', 'expectedVersion', 'reason']),
  webMutation('mip.admin.users.setControl', ['userId', 'controlType', 'active', 'reason']),
  webMutation('mip.admin.roles.set', ['userId', 'roleKey', 'active'], ['scopeId', 'branchId']),
  webMutation('mip.admin.rolePolicies.update', ['roleKey', 'expectedVersion'], ['capabilities', 'reset']),
  webMutation('mip.admin.branches.create', ['branchKey', 'name', 'cityName', 'summary']),
  webMutation('mip.admin.branches.update', ['branchId', 'expectedVersion', 'name', 'cityName', 'summary']),
  webMutation('mip.admin.branches.changeStatus', ['branchId', 'expectedVersion', 'status']),

  webMutation('mip.admin.events.save', ['draft'], ['eventId', 'expectedVersion']),
  webMutation('mip.admin.events.registrations.review', ['eventId', 'registrationId', 'expectedVersion', 'decision']),
  webMutation('mip.admin.events.checkIn', ['eventId', 'registrationId', 'expectedVersion']),
  webMutation('mip.admin.events.undoCheckIn', ['eventId', 'registrationId', 'expectedVersion', 'reason']),
  webMutation('mip.admin.events.album.review', ['eventId', 'photoId', 'expectedVersion', 'decision', 'reason']),
  webMutation('mip.admin.events.policy.save', ['expectedVersion', 'cancellationHoursBeforeStart']),
  webMutation('mip.admin.events.tags.replace', ['eventId', 'expectedVersion', 'tagIds']),
  webMutation('mip.admin.events.catalog.save', ['kind', 'name', 'description', 'sortOrder'], ['key', 'catalogId', 'expectedVersion']),
  webMutation('mip.admin.events.catalog.changeStatus', ['kind', 'catalogId', 'expectedVersion', 'status']),
  webMutation('mip.admin.events.catalog.archive', ['kind', 'catalogId', 'expectedVersion', 'reason']),

  webMutation('mip.admin.announcements.save', ['scopeType', 'title', 'summary', 'body', 'visibleFrom'], ['announcementId', 'expectedVersion', 'branchId', 'targetType', 'targetId', 'visibleUntil']),
  webMutation('mip.admin.announcements.publish', ['announcementId', 'expectedVersion']),
  webMutation('mip.admin.announcements.withdraw', ['announcementId', 'expectedVersion', 'reason']),
  webMutation('mip.admin.announcements.pin', ['announcementId', 'expectedVersion', 'pinned']),
  webMutation('mip.admin.messageCampaigns.save', ['scopeType', 'audienceType', 'recipientRefs', 'name', 'title', 'body'], ['campaignId', 'expectedVersion', 'branchId']),
  webMutation('mip.admin.messageCampaigns.snapshot', ['campaignId', 'expectedVersion']),
  domainIdempotentWebMutation('mip.admin.messageCampaigns.schedule', ['campaignId', 'expectedVersion', 'scheduledFor'], ['expectedDispatchVersion']),
  domainIdempotentWebMutation('mip.admin.messageCampaigns.cancelSchedule', ['campaignId', 'expectedVersion', 'expectedDispatchVersion', 'reason']),
  domainIdempotentWebMutation('mip.admin.messageCampaigns.publish', ['campaignId', 'expectedVersion']),
  webMutation('mip.admin.messageCampaigns.withdraw', ['campaignId', 'expectedVersion', 'reason']),
  webMutation('mip.admin.messageTemplates.save', ['scopeType', 'name', 'title', 'body'], ['templateId', 'expectedVersion', 'branchId']),
  webMutation('mip.admin.messageTemplates.activate', ['templateId', 'expectedVersion']),
  webMutation('mip.admin.messageTemplates.archive', ['templateId', 'expectedVersion']),
  webMutation('mip.admin.communityReports.claim', ['reportId', 'expectedVersion', 'reason']),
  webMutation('mip.admin.communityReports.close', ['reportId', 'expectedVersion', 'outcome', 'reason']),
  webMutation('mip.admin.opportunities.save', ['draft'], ['opportunityId', 'expectedVersion']),
  webMutation('mip.admin.opportunities.publish', ['opportunityId', 'expectedVersion']),
  webMutation('mip.admin.opportunities.end', ['opportunityId', 'expectedVersion']),
  webMutation('mip.admin.opportunities.unpublish', ['opportunityId', 'expectedVersion', 'reason']),
  webMutation('mip.admin.opportunities.archive', ['opportunityId', 'expectedVersion', 'reason']),
  webMutation('mip.admin.userContent.save', ['kind', 'ownerUserId', 'draft'], ['contentId', 'expectedVersion']),
  webMutation('mip.admin.userContent.unpublish', ['kind', 'contentId', 'expectedVersion', 'reason']),
  webMutation('mip.admin.userContent.archive', ['kind', 'contentId', 'expectedVersion', 'reason']),
  webMutation('mip.admin.knowledge.contents.save', ['categoryId', 'contentType', 'title', 'summary', 'accessType', 'commentsEnabled', 'moderationMode'], ['contentId', 'expectedVersion', 'sourceId', 'bodyText', 'externalUrl', 'channelFinderUserName', 'channelFeedId', 'coverAssetId', 'authorName']),
  webMutation('mip.admin.knowledge.contents.review', ['contentId', 'expectedVersion', 'decision'], ['reason']),
  domainIdempotentWebMutation('mip.admin.knowledge.schedules.save', ['sourceId', 'categoryId', 'dailyTime', 'timeZone'], ['scheduleId', 'expectedVersion', 'status']),
  webMutation('mip.admin.badges.grant', ['userId', 'badgeId', 'reason']),
  webMutation('mip.admin.badges.revoke', ['awardId', 'expectedVersion', 'reason']),
  domainIdempotentWebMutation('mip.admin.growth.adjust', ['userId', 'metric', 'deltaValue', 'reason']),

  domainIdempotentWebMutation('mip.admin.tasks.save', ['task'], ['taskId', 'expectedVersion']),
  domainIdempotentWebMutation('mip.admin.tasks.publish', ['taskId', 'expectedVersion']),
  domainIdempotentWebMutation('mip.admin.tasks.unpublish', ['taskId', 'expectedVersion']),
  domainIdempotentWebMutation('mip.admin.tasks.delete', ['taskId', 'expectedVersion']),
  domainIdempotentWebMutation('mip.admin.tasks.assignMembers', ['taskId', 'memberRefs', 'expectedVersion']),
  domainIdempotentWebMutation('mip.admin.tasks.revokeMembers', ['taskId', 'memberRefs', 'expectedVersion']),

  domainIdempotentWebMutation('mip.admin.banners.save', ['banner'], ['bannerId', 'expectedVersion']),
  webMutation('mip.admin.banners.changeStatus', ['bannerId', 'expectedVersion', 'status']),
  webMutation('mip.admin.banners.move', ['bannerId', 'expectedVersion', 'direction']),
  webMutation('mip.admin.banners.delete', ['bannerId', 'expectedVersion']),

  domainIdempotentWebMutation('mip.admin.game.seasons.save', ['season'], ['seasonId', 'expectedVersion']),
  domainIdempotentWebMutation('mip.admin.game.seasons.changeStatus', ['seasonId', 'expectedVersion', 'status']),
  domainIdempotentWebMutation('mip.admin.game.teams.save', ['team'], ['teamId', 'expectedVersion']),
  domainIdempotentWebMutation('mip.admin.game.teams.changeStatus', ['seasonId', 'teamId', 'expectedVersion', 'status']),
  domainIdempotentWebMutation('mip.admin.game.teams.members.replace', ['seasonId', 'teamId', 'expectedVersion', 'members']),
  domainIdempotentWebMutation('mip.admin.game.matches.save', ['match']),
  domainIdempotentWebMutation('mip.admin.game.matches.finalize', ['matchId', 'expectedVersion']),
  domainIdempotentWebMutation('mip.admin.game.rankings.generate', ['seasonId', 'rankingType']),
  domainIdempotentWebMutation('mip.admin.game.blindBoxes.catalogs.save', ['catalog'], ['catalogId', 'expectedVersion']),
  domainIdempotentWebMutation('mip.admin.game.blindBoxes.catalogs.changeStatus', ['catalogId', 'expectedVersion', 'status']),
  domainIdempotentWebMutation('mip.admin.game.blindBoxes.cards.save', ['card'], ['cardId', 'expectedVersion']),
  domainIdempotentWebMutation('mip.admin.game.blindBoxes.cards.changeStatus', ['cardId', 'expectedVersion', 'status']),

  webMutation('mip.admin.media.uploadImage', ['purpose', 'imageBase64'], [], { webRoute: 'MEDIA' }),

  domainIdempotentWebMutation('mip.admin.exports.create', ['exportType', 'includesPhone', 'filters']),
  webMutation('mip.admin.exports.prepare', ['ticketId', 'token']),
  webMutation('mip.admin.exports.reserve', ['ticketId', 'token']),
  webMutation('mip.admin.exports.complete', ['ticketId', 'token']),
])

function createPublicOperationContract(operations = operationCatalog) {
  validateOperationSource(operations)

  const publicOperations = operations.map(operation => Object.freeze({
    action: operation.action,
    kind: operation.kind,
    authentication: 'REQUIRED',
    session: 'REQUIRED',
    // Read retries may append access-audit telemetry, but must not duplicate
    // business facts. Business writes remain MUTATION operations.
    safeToRetry: operation.kind === 'QUERY',
    idempotencyKeyRequired: null,
  }))

  return Object.freeze({
    version: PUBLIC_OPERATION_CONTRACT_VERSION,
    operationCount: publicOperations.length,
    operations: Object.freeze(publicOperations),
  })
}

function createAdminWebOperationContract(
  operations = operationCatalog,
  mutationPolicies = adminWebMutationPolicies,
  queryActions = adminWebQueryActions,
) {
  validateOperationSource(operations)
  if (!Array.isArray(mutationPolicies) || !Array.isArray(queryActions)) {
    throw new Error('ADMIN_WEB_OPERATION_CONTRACT_SOURCE_INVALID')
  }

  const operationByAction = new Map(operations.map(operation => [operation.action, operation]))
  const queryActionSet = new Set(queryActions)
  if (queryActionSet.size !== queryActions.length
    || queryActions.some(action => operationByAction.get(action)?.kind !== 'QUERY')) {
    throw new Error('ADMIN_WEB_OPERATION_CONTRACT_SOURCE_INVALID')
  }
  const mutationPolicyByAction = new Map()
  for (const policy of mutationPolicies) {
    const operation = operationByAction.get(policy?.action)
    if (!operation
      || operation.kind !== 'MUTATION'
      || mutationPolicyByAction.has(policy.action)
      || !validInputKeys(policy.requiredInputKeys, policy.optionalInputKeys)
      || typeof policy.forwardIdempotencyKey !== 'boolean'
      || !['ADMIN', 'MEDIA'].includes(policy.webRoute)) {
      throw new Error('ADMIN_WEB_OPERATION_CONTRACT_SOURCE_INVALID')
    }
    mutationPolicyByAction.set(policy.action, policy)
  }

  const webOperations = operations.map((operation) => {
    const mutationPolicy = mutationPolicyByAction.get(operation.action)
    if (operation.kind === 'QUERY' && queryActionSet.has(operation.action)) {
      return Object.freeze({
        action: operation.action,
        kind: operation.kind,
        webAllowed: true,
        webRoute: 'ADMIN',
        requiredInputKeys: EMPTY_INPUT_KEYS,
        optionalInputKeys: EMPTY_INPUT_KEYS,
        idempotencyKeyRequired: false,
        forwardIdempotencyKey: false,
      })
    }
    if (mutationPolicy) {
      return Object.freeze({
        action: operation.action,
        kind: operation.kind,
        webAllowed: true,
        webRoute: mutationPolicy.webRoute,
        requiredInputKeys: mutationPolicy.requiredInputKeys,
        optionalInputKeys: mutationPolicy.optionalInputKeys,
        idempotencyKeyRequired: true,
        forwardIdempotencyKey: mutationPolicy.forwardIdempotencyKey,
      })
    }
    return Object.freeze({
      action: operation.action,
      kind: operation.kind,
      webAllowed: false,
      webRoute: null,
      requiredInputKeys: EMPTY_INPUT_KEYS,
      optionalInputKeys: EMPTY_INPUT_KEYS,
      idempotencyKeyRequired: null,
      forwardIdempotencyKey: null,
    })
  })

  return Object.freeze({
    version: ADMIN_WEB_OPERATION_CONTRACT_VERSION,
    operationCount: webOperations.length,
    operations: Object.freeze(webOperations),
  })
}

function validateOperationSource(operations) {
  if (!Array.isArray(operations) || operations.length !== EXPECTED_OPERATION_COUNT) {
    throw new Error('PUBLIC_OPERATION_CONTRACT_SOURCE_INVALID')
  }
  const actions = new Set()
  for (const operation of operations) {
    if (!operation
      || typeof operation.action !== 'string'
      || actions.has(operation.action)
      || !['QUERY', 'MUTATION'].includes(operation.kind)
      || typeof operation.sessionFirst !== 'boolean') {
      throw new Error('PUBLIC_OPERATION_CONTRACT_SOURCE_INVALID')
    }
    actions.add(operation.action)
  }
}

function validInputKeys(requiredInputKeys, optionalInputKeys) {
  if (!Array.isArray(requiredInputKeys) || !Array.isArray(optionalInputKeys)) return false
  const keys = [...requiredInputKeys, ...optionalInputKeys]
  return new Set(keys).size === keys.length
    && keys.every(key => typeof key === 'string' && key.length > 0)
}

const publicOperationContract = createPublicOperationContract()
const adminWebOperationContract = createAdminWebOperationContract()

module.exports = {
  ADMIN_WEB_OPERATION_CONTRACT_VERSION,
  PUBLIC_OPERATION_CONTRACT_VERSION,
  adminWebOperationContract,
  createAdminWebOperationContract,
  createPublicOperationContract,
  publicOperationContract,
}
