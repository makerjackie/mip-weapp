'use strict'

const { createHash, createHmac, timingSafeEqual } = require('node:crypto')
const { errorResponse, normalizeAdminRequest } = require('../domain/handler')
const { publicOperationContract } = require('../domain/public-operation-contract')

const WEB_BFF_TRANSPORT = 'MIP_WEB_BFF_V1'
const WEB_BFF_MAX_CLOCK_SKEW_MS = 60_000
const WEB_BFF_FIRST_QUERY_ACTIONS = Object.freeze([
  'mip.admin.session',
  'mip.admin.dashboard.overview.get',
  'mip.admin.users.list',
  'mip.admin.events.list',
  'mip.admin.orders.list',
  'mip.admin.branches.list',
  'mip.admin.roles.list',
  'mip.admin.rolePolicies.list',
  'mip.admin.audit.list',
  'mip.admin.messageCampaigns.list',
  'mip.admin.messageTemplates.list',
  'mip.admin.knowledge.list',
])
const WEB_BFF_SECOND_QUERY_ACTIONS = Object.freeze([
  'mip.admin.users.get',
  'mip.admin.users.influence.list',
  'mip.admin.events.get',
  'mip.admin.events.insights.get',
  'mip.admin.events.roster',
  'mip.admin.events.rosterAll',
  'mip.admin.events.policy.get',
  'mip.admin.orders.get',
  'mip.admin.paymentAttempts.list',
  'mip.admin.memberships.get',
  'mip.admin.memberships.timeline',
  'mip.admin.benefits.ledger',
  'mip.admin.roles.candidates',
  'mip.admin.messageCampaigns.get',
  'mip.admin.messageCampaigns.recipients',
  'mip.admin.messageTemplates.get',
  'mip.admin.messageDeliveryReviews.list',
  'mip.admin.messageDeliveryReviews.get',
  'mip.admin.messageDeliveryRecords.list',
  'mip.admin.knowledge.get',
  'mip.admin.knowledge.schedules.list',
])
const WEB_BFF_THIRD_QUERY_ACTIONS = Object.freeze([
  'mip.admin.communityReports.list',
  'mip.admin.announcements.scopes',
  'mip.admin.announcements.list',
  'mip.admin.announcements.get',
  'mip.admin.opportunities.list',
  'mip.admin.opportunities.get',
  'mip.admin.opportunities.options',
  'mip.admin.userContent.list',
  'mip.admin.userContent.get',
  'mip.admin.matching.get',
  'mip.admin.opportunityComments.get',
  'mip.admin.growth.levels',
  'mip.admin.growth.benefits',
  'mip.admin.growth.rules',
  'mip.admin.growth.entries',
  'mip.admin.growth.levelTransitions',
  'mip.admin.badges.list',
  'mip.admin.badges.awards',
  'mip.admin.exceptions.list',
  'mip.admin.operations.queue.list',
])
const WEB_BFF_FOURTH_QUERY_ACTIONS = Object.freeze([
  'mip.admin.events.catalog.list',
  'mip.admin.events.tags.get',
  'mip.admin.events.recaps.list',
  'mip.admin.events.recaps.get',
  'mip.admin.events.album.list',
  'mip.admin.events.comments.get',
  'mip.admin.messageCampaigns.scopes',
  'mip.admin.exports.status',
  'mip.admin.dashboard',
])
const WEB_BFF_FIFTH_QUERY_ACTIONS = Object.freeze([
  'mip.admin.tasks.list',
  'mip.admin.tasks.get',
  'mip.admin.tasks.assignableMembers.list',
  'mip.admin.tasks.completions.list',
  'mip.admin.tasks.completions.get',
  'mip.admin.tasks.completions.export',
])
const WEB_BFF_REVIEWED_MUTATION_MANIFEST = Object.freeze([
  domainIdempotentMutation('mip.admin.memberships.grant', ['durationMonths', 'expectedChainVersion', 'reason', 'userId']),
  domainIdempotentMutation('mip.admin.events.clone', ['expectedVersion', 'sourceEventId']),
  domainIdempotentMutation('mip.admin.events.changeStatus', ['eventId', 'expectedVersion', 'status']),
  domainIdempotentMutation('mip.admin.events.archive', ['eventId', 'expectedVersion', 'reason']),
  domainIdempotentMutation('mip.admin.communications.publishEventReminder', ['eventId', 'expectedVersion', 'sendWechatReminder']),
  domainIdempotentMutation('mip.admin.refunds.submit', ['orderId', 'reason']),

  reviewedMutation('mip.admin.users.update', ['userId', 'expectedVersion', 'fields']),
  reviewedMutation('mip.admin.users.changePrimaryBranch', ['userId', 'targetBranchId', 'expectedVersion', 'reason']),
  reviewedMutation('mip.admin.users.setControl', ['userId', 'controlType', 'active', 'reason']),
  reviewedMutation('mip.admin.roles.set', ['userId', 'roleKey', 'active'], ['scopeId', 'branchId']),
  reviewedMutation('mip.admin.rolePolicies.update', ['roleKey', 'expectedVersion'], ['capabilities', 'reset']),
  reviewedMutation('mip.admin.branches.create', ['branchKey', 'name', 'cityName', 'summary']),
  reviewedMutation('mip.admin.branches.update', ['branchId', 'expectedVersion', 'name', 'cityName', 'summary']),
  reviewedMutation('mip.admin.branches.changeStatus', ['branchId', 'expectedVersion', 'status']),

  reviewedMutation('mip.admin.events.save', ['draft'], ['eventId', 'expectedVersion']),
  reviewedMutation('mip.admin.events.registrations.review', ['eventId', 'registrationId', 'expectedVersion', 'decision']),
  reviewedMutation('mip.admin.events.checkIn', ['eventId', 'registrationId', 'expectedVersion']),
  reviewedMutation('mip.admin.events.undoCheckIn', ['eventId', 'registrationId', 'expectedVersion', 'reason']),
  reviewedMutation('mip.admin.events.album.review', ['eventId', 'photoId', 'expectedVersion', 'decision', 'reason']),
  reviewedMutation('mip.admin.events.policy.save', ['expectedVersion', 'cancellationHoursBeforeStart']),
  reviewedMutation('mip.admin.events.tags.replace', ['eventId', 'expectedVersion', 'tagIds']),
  reviewedMutation('mip.admin.events.catalog.save', ['kind', 'name', 'description', 'sortOrder'], ['key', 'catalogId', 'expectedVersion']),
  reviewedMutation('mip.admin.events.catalog.changeStatus', ['kind', 'catalogId', 'expectedVersion', 'status']),
  reviewedMutation('mip.admin.events.catalog.archive', ['kind', 'catalogId', 'expectedVersion', 'reason']),

  reviewedMutation('mip.admin.announcements.save', ['scopeType', 'title', 'summary', 'body', 'visibleFrom'], ['announcementId', 'expectedVersion', 'branchId', 'targetType', 'targetId', 'visibleUntil']),
  reviewedMutation('mip.admin.announcements.publish', ['announcementId', 'expectedVersion']),
  reviewedMutation('mip.admin.announcements.withdraw', ['announcementId', 'expectedVersion', 'reason']),
  reviewedMutation('mip.admin.announcements.pin', ['announcementId', 'expectedVersion', 'pinned']),
  reviewedMutation('mip.admin.messageCampaigns.save', ['scopeType', 'audienceType', 'recipientRefs', 'name', 'title', 'body'], ['campaignId', 'expectedVersion', 'branchId']),
  reviewedMutation('mip.admin.messageCampaigns.snapshot', ['campaignId', 'expectedVersion']),
  domainIdempotentMutation('mip.admin.messageCampaigns.schedule', ['campaignId', 'expectedVersion', 'scheduledFor'], ['expectedDispatchVersion']),
  domainIdempotentMutation('mip.admin.messageCampaigns.cancelSchedule', ['campaignId', 'expectedVersion', 'expectedDispatchVersion', 'reason']),
  domainIdempotentMutation('mip.admin.messageCampaigns.publish', ['campaignId', 'expectedVersion']),
  reviewedMutation('mip.admin.messageCampaigns.withdraw', ['campaignId', 'expectedVersion', 'reason']),
  reviewedMutation('mip.admin.messageTemplates.save', ['scopeType', 'name', 'title', 'body'], ['templateId', 'expectedVersion', 'branchId']),
  reviewedMutation('mip.admin.messageTemplates.activate', ['templateId', 'expectedVersion']),
  reviewedMutation('mip.admin.messageTemplates.archive', ['templateId', 'expectedVersion']),
  reviewedMutation('mip.admin.communityReports.claim', ['reportId', 'expectedVersion', 'reason']),
  reviewedMutation('mip.admin.communityReports.close', ['reportId', 'expectedVersion', 'outcome', 'reason']),
  reviewedMutation('mip.admin.opportunities.save', ['draft'], ['opportunityId', 'expectedVersion']),
  reviewedMutation('mip.admin.opportunities.publish', ['opportunityId', 'expectedVersion']),
  reviewedMutation('mip.admin.opportunities.end', ['opportunityId', 'expectedVersion']),
  reviewedMutation('mip.admin.opportunities.unpublish', ['opportunityId', 'expectedVersion', 'reason']),
  reviewedMutation('mip.admin.opportunities.archive', ['opportunityId', 'expectedVersion', 'reason']),
  reviewedMutation('mip.admin.userContent.save', ['kind', 'ownerUserId', 'draft'], ['contentId', 'expectedVersion']),
  reviewedMutation('mip.admin.userContent.unpublish', ['kind', 'contentId', 'expectedVersion', 'reason']),
  reviewedMutation('mip.admin.userContent.archive', ['kind', 'contentId', 'expectedVersion', 'reason']),
  reviewedMutation('mip.admin.knowledge.contents.save', ['categoryId', 'contentType', 'title', 'summary', 'accessType', 'commentsEnabled', 'moderationMode'], ['contentId', 'expectedVersion', 'sourceId', 'bodyText', 'externalUrl', 'channelFinderUserName', 'channelFeedId', 'coverAssetId', 'authorName']),
  reviewedMutation('mip.admin.knowledge.contents.review', ['contentId', 'expectedVersion', 'decision'], ['reason']),
  domainIdempotentMutation('mip.admin.knowledge.schedules.save', ['sourceId', 'categoryId', 'dailyTime', 'timeZone'], ['scheduleId', 'expectedVersion', 'status']),
  reviewedMutation('mip.admin.badges.grant', ['userId', 'badgeId', 'reason']),
  reviewedMutation('mip.admin.badges.revoke', ['awardId', 'expectedVersion', 'reason']),
  domainIdempotentMutation('mip.admin.growth.adjust', ['userId', 'metric', 'deltaValue', 'reason']),

  domainIdempotentMutation('mip.admin.tasks.save', ['task'], ['taskId', 'expectedVersion']),
  domainIdempotentMutation('mip.admin.tasks.publish', ['taskId', 'expectedVersion']),
  domainIdempotentMutation('mip.admin.tasks.unpublish', ['taskId', 'expectedVersion']),
  domainIdempotentMutation('mip.admin.tasks.delete', ['taskId', 'expectedVersion']),
  domainIdempotentMutation('mip.admin.tasks.assignMembers', ['taskId', 'memberRefs', 'expectedVersion']),
  domainIdempotentMutation('mip.admin.tasks.revokeMembers', ['taskId', 'memberRefs', 'expectedVersion']),
])
const WEB_BFF_QUERY_ACTIONS = createQueryActionAllowlist(
  [
    ...WEB_BFF_FIRST_QUERY_ACTIONS,
    ...WEB_BFF_SECOND_QUERY_ACTIONS,
    ...WEB_BFF_THIRD_QUERY_ACTIONS,
    ...WEB_BFF_FOURTH_QUERY_ACTIONS,
    ...WEB_BFF_FIFTH_QUERY_ACTIONS,
  ],
  publicOperationContract,
)
const WEB_BFF_MUTATION_ACTIONS = createReviewedMutationActionAllowlist(
  WEB_BFF_REVIEWED_MUTATION_MANIFEST,
  publicOperationContract,
)
const envelopeKeys = new Set(['nonce', 'principal', 'request', 'signature', 'timestamp', 'transport'])
const principalKeys = new Set(['appId', 'openId'])
const requestKeys = new Set(['action', 'contractVersion', 'idempotencyKey', 'input'])

function createQueryActionAllowlist(actions, contract) {
  if (!Array.isArray(actions)
    || new Set(actions).size !== actions.length
    || !contract
    || !Array.isArray(contract.operations)) {
    throw new Error('WEB_BFF_QUERY_CONTRACT_INVALID')
  }
  const operationByAction = new Map(contract.operations.map(operation => [operation.action, operation]))
  const allowlist = new Set()
  for (const action of actions) {
    const operation = operationByAction.get(action)
    if (!operation
      || operation.kind !== 'QUERY'
      || operation.safeToRetry !== true
      || operation.authentication !== 'REQUIRED'
      || operation.session !== 'REQUIRED') {
      throw new Error('WEB_BFF_QUERY_CONTRACT_INVALID')
    }
    allowlist.add(action)
  }
  return allowlist
}

function reviewedMutation(action, requiredInputKeys, optionalInputKeys = [], options = {}) {
  return Object.freeze({
    action,
    kind: 'MUTATION',
    authentication: 'REQUIRED',
    session: 'REQUIRED',
    safeToRetry: false,
    idempotencyKeyRequired: true,
    requiredInputKeys: Object.freeze([...requiredInputKeys]),
    optionalInputKeys: Object.freeze([...optionalInputKeys]),
    forwardIdempotencyKey: options.forwardIdempotencyKey === true,
  })
}

function domainIdempotentMutation(action, requiredInputKeys, optionalInputKeys = []) {
  return reviewedMutation(action, requiredInputKeys, optionalInputKeys, {
    forwardIdempotencyKey: true,
  })
}

function createReviewedMutationActionAllowlist(manifest, contract) {
  if (!Array.isArray(manifest)
    || new Set(manifest.map(item => item?.action)).size !== manifest.length
    || !contract
    || !Array.isArray(contract.operations)) {
    throw new Error('WEB_BFF_MUTATION_CONTRACT_INVALID')
  }
  const operationByAction = new Map(contract.operations.map(operation => [operation.action, operation]))
  const allowlist = new Set()
  for (const expected of manifest) {
    if (!expected || typeof expected.action !== 'string'
      || expected.kind !== 'MUTATION'
      || expected.authentication !== 'REQUIRED'
      || expected.session !== 'REQUIRED'
      || expected.safeToRetry !== false
      || expected.idempotencyKeyRequired !== true
      || typeof expected.forwardIdempotencyKey !== 'boolean'
      || !validReviewedInputKeys(expected.requiredInputKeys, expected.optionalInputKeys)) {
      throw new Error('WEB_BFF_MUTATION_CONTRACT_INVALID')
    }
    const operation = operationByAction.get(expected.action)
    if (!operation
      || operation.action !== expected.action
      || operation.kind !== expected.kind
      || operation.authentication !== expected.authentication
      || operation.session !== expected.session
      || operation.safeToRetry !== expected.safeToRetry
      // The generated public contract keeps this field nullable for backward
      // compatibility; the reviewed manifest supplies the Web write policy.
      || operation.idempotencyKeyRequired !== null) {
      throw new Error('WEB_BFF_MUTATION_CONTRACT_INVALID')
    }
    allowlist.add(expected.action)
  }
  return allowlist
}

function createWebBffRoute({
  application,
  issuePrincipal,
  replayGuard,
  afterSuccessfulMutation,
  secret,
  now = Date.now,
} = {}) {
  if (!application || typeof application.execute !== 'function'
    || typeof issuePrincipal !== 'function'
    || !replayGuard || typeof replayGuard.consume !== 'function'
    || typeof afterSuccessfulMutation !== 'function'
    || typeof now !== 'function') {
    throw new Error('WEB_BFF_ROUTE_CONFIG_INVALID')
  }

  return async function runWebBff(event = {}) {
    try {
      const verified = verifyWebBffEnvelope(event, { secret, now: now() })
      const principal = issuePrincipal({
        APPID: verified.principal.appId,
        OPENID: verified.principal.openId,
      })
      const normalized = normalizeAdminRequest(verified.request)
      const { action } = normalized
      const input = applicationInput(action, normalized.input)
      await replayGuard.consume({
        appId: verified.principal.appId,
        nonce: verified.nonce,
        principalIdentityKey: principal.identityKey,
        action,
        requestHash: createHash('sha256').update(canonicalJson(verified)).digest('hex'),
      })
      const data = await application.execute(principal, action, input)
      if (WEB_BFF_MUTATION_ACTIONS.has(action)) {
        const postCommit = await afterSuccessfulMutation({
          action,
          principal,
          resultData: data,
        })
        if (postCommit && postCommit.ok === false) return postCommit
      }
      return { ok: true, data }
    }
    catch (error) {
      if (error?.message === 'WEB_BFF_CONFIG_REQUIRED') {
        return {
          ok: false,
          error: { code: 'SERVICE_UNAVAILABLE', message: '运营服务暂时不可用', retryable: true },
        }
      }
      if (error?.message === 'WEB_BFF_REPLAY_GUARD_UNAVAILABLE') {
        return {
          ok: false,
          error: { code: 'SERVICE_UNAVAILABLE', message: '运营服务暂时不可用', retryable: true },
        }
      }
      if (error?.message === 'WEB_BFF_REPLAYED') {
        return errorResponse(new Error('AUTH_REQUIRED'))
      }
      return errorResponse(error)
    }
  }
}

function isWebBffEvent(value) {
  return Boolean(value && typeof value === 'object' && value.transport === WEB_BFF_TRANSPORT)
}

function verifyWebBffEnvelope(value, { secret, now = Date.now() } = {}) {
  if (typeof secret !== 'string' || secret.length < 32) {
    throw new Error('WEB_BFF_CONFIG_REQUIRED')
  }
  if (!isPlainRecord(value) || !hasExactKeys(value, envelopeKeys)) {
    throw new Error('AUTH_REQUIRED')
  }
  if (value.transport !== WEB_BFF_TRANSPORT
    || !Number.isSafeInteger(value.timestamp)
    || Math.abs(now - value.timestamp) > WEB_BFF_MAX_CLOCK_SKEW_MS
    || typeof value.nonce !== 'string'
    || !/^[A-Za-z0-9_-]{24,128}$/.test(value.nonce)
    || typeof value.signature !== 'string'
    || !/^[a-f0-9]{64}$/.test(value.signature)) {
    throw new Error('AUTH_REQUIRED')
  }
  if (!isPlainRecord(value.principal)
    || !hasExactKeys(value.principal, principalKeys)
    || !trustedIdentifier(value.principal.appId, 64)
    || !trustedIdentifier(value.principal.openId, 128)) {
    throw new Error('AUTH_REQUIRED')
  }
  if (!isPlainRecord(value.request)
    || !hasAllowedKeys(value.request, requestKeys)
    || value.request.contractVersion !== 1
    || typeof value.request.action !== 'string'
    || (!WEB_BFF_QUERY_ACTIONS.has(value.request.action)
      && !WEB_BFF_MUTATION_ACTIONS.has(value.request.action))
    || !isPlainRecord(value.request.input)) {
    throw new Error('FORBIDDEN')
  }
  if (WEB_BFF_MUTATION_ACTIONS.has(value.request.action)
    && !validMutationIdempotencyKey(value.request.idempotencyKey)) {
    throw new Error('VALIDATION_FAILED')
  }
  const inputSchema = reviewedMutationInputSchema(value.request.action)
  if (inputSchema && !hasReviewedInputKeys(value.request.input, inputSchema)) {
    throw new Error('VALIDATION_FAILED')
  }

  const unsigned = unsignedEnvelope(value)
  const expected = createHmac('sha256', secret).update(canonicalJson(unsigned)).digest()
  const supplied = Buffer.from(value.signature, 'hex')
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    throw new Error('AUTH_REQUIRED')
  }
  return unsigned
}

function signWebBffEnvelope(value, secret) {
  if (typeof secret !== 'string' || secret.length < 32) {
    throw new Error('WEB_BFF_CONFIG_REQUIRED')
  }
  const unsigned = unsignedEnvelope(value)
  return {
    ...unsigned,
    signature: createHmac('sha256', secret).update(canonicalJson(unsigned)).digest('hex'),
  }
}

function unsignedEnvelope(value) {
  return {
    transport: value.transport,
    timestamp: value.timestamp,
    nonce: value.nonce,
    principal: value.principal,
    request: value.request,
  }
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (isPlainRecord(value)) {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function hasExactKeys(value, expected) {
  const keys = Reflect.ownKeys(value)
  return keys.length === expected.size
    && keys.every(key => typeof key === 'string' && expected.has(key))
}

function hasAllowedKeys(value, allowed) {
  const keys = Reflect.ownKeys(value)
  return keys.every(key => typeof key === 'string' && allowed.has(key))
    && ['action', 'contractVersion', 'input'].every(key => Object.hasOwn(value, key))
}

function isPlainRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function trustedIdentifier(value, maximum) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= maximum
    && /^[A-Za-z0-9_-]+$/.test(value)
}

function validMutationIdempotencyKey(value) {
  return typeof value === 'string'
    && /^[A-Za-z0-9_.:-]{1,128}$/.test(value.trim())
}

function validReviewedInputKeys(required, optional) {
  if (!Array.isArray(required) || !Array.isArray(optional)) return false
  const all = [...required, ...optional]
  return new Set(all).size === all.length
    && all.every(key => typeof key === 'string' && key.length > 0)
}

function reviewedMutationInputSchema(action) {
  const entry = WEB_BFF_REVIEWED_MUTATION_MANIFEST.find(item => item.action === action)
  return entry
    ? { required: entry.requiredInputKeys, optional: entry.optionalInputKeys }
    : null
}

function hasReviewedInputKeys(value, schema) {
  if (!isPlainRecord(value)) return false
  const keys = Reflect.ownKeys(value)
  const allowed = new Set([...schema.required, ...schema.optional])
  return keys.every(key => typeof key === 'string' && allowed.has(key))
    && schema.required.every(key => Object.hasOwn(value, key))
}

function applicationInput(action, input) {
  const manifest = WEB_BFF_REVIEWED_MUTATION_MANIFEST.find(item => item.action === action)
  if (manifest?.forwardIdempotencyKey === true || !Object.hasOwn(input, 'idempotencyKey')) {
    return input
  }
  const output = { ...input }
  delete output.idempotencyKey
  return output
}

module.exports = {
  WEB_BFF_MAX_CLOCK_SKEW_MS,
  WEB_BFF_FIRST_QUERY_ACTIONS,
  WEB_BFF_FIFTH_QUERY_ACTIONS,
  WEB_BFF_FOURTH_QUERY_ACTIONS,
  WEB_BFF_MUTATION_ACTIONS,
  WEB_BFF_REVIEWED_MUTATION_MANIFEST,
  WEB_BFF_QUERY_ACTIONS,
  WEB_BFF_SECOND_QUERY_ACTIONS,
  WEB_BFF_THIRD_QUERY_ACTIONS,
  WEB_BFF_TRANSPORT,
  canonicalJson,
  createQueryActionAllowlist,
  createReviewedMutationActionAllowlist,
  createWebBffRoute,
  isWebBffEvent,
  signWebBffEnvelope,
  verifyWebBffEnvelope,
}
