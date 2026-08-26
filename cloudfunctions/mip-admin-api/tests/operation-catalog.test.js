'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const { actions } = require('../domain/handler')
const {
  OPERATION_KINDS,
  OPERATION_OWNERS,
  healthOperation,
  operationByAction,
  operationCatalog,
} = require('../domain/operation-catalog')
const {
  createOperationRegistry,
  outboxMutationActions,
} = require('../domain/operation-registry')

const expectedOperations = Object.freeze({
  'mip.admin.session': ['ACCESS', 'QUERY', 'getSession'],
  'mip.admin.branches.list': ['ACCESS', 'QUERY', 'listBranches'],
  'mip.admin.roles.list': ['ACCESS', 'QUERY', 'listRoles'],
  'mip.admin.roles.candidates': ['ACCESS', 'QUERY', 'searchRoleCandidates'],
  'mip.admin.rolePolicies.list': ['ACCESS', 'QUERY', 'listRoleCapabilityPolicies'],
  'mip.admin.audit.list': ['ACCESS', 'QUERY', 'listAudit'],
  'mip.admin.branches.create': ['ACCESS', 'MUTATION', 'createBranch'],
  'mip.admin.branches.update': ['ACCESS', 'MUTATION', 'updateBranch'],
  'mip.admin.branches.changeStatus': ['ACCESS', 'MUTATION', 'changeBranchStatus'],
  'mip.admin.roles.set': ['ACCESS', 'MUTATION', 'setRole'],
  'mip.admin.rolePolicies.update': ['ACCESS', 'MUTATION', 'updateRoleCapabilityPolicy'],

  'mip.admin.users.list': ['USERS', 'QUERY', 'listUsers'],
  'mip.admin.users.get': ['USERS', 'QUERY', 'getUser'],
  'mip.admin.users.influence.list': ['USERS', 'QUERY', 'listUserInfluence'],
  'mip.admin.communityReports.list': ['USERS', 'QUERY', 'listCommunityReports'],
  'mip.admin.users.update': ['USERS', 'MUTATION', 'updateUser'],
  'mip.admin.users.changePrimaryBranch': ['USERS', 'MUTATION', 'changePrimaryBranch'],
  'mip.admin.users.setControl': ['USERS', 'MUTATION', 'setUserControl'],
  'mip.admin.communityReports.claim': ['USERS', 'MUTATION', 'claimCommunityReport'],
  'mip.admin.communityReports.close': ['USERS', 'MUTATION', 'closeCommunityReport'],

  'mip.admin.memberships.get': ['MEMBERSHIPS', 'QUERY', 'getMembership'],
  'mip.admin.memberships.timeline': ['MEMBERSHIPS', 'QUERY', 'listMembershipTimeline'],
  'mip.admin.memberships.grant': ['MEMBERSHIPS', 'MUTATION', 'grantMembership'],

  'mip.admin.events.list': ['EVENTS', 'QUERY', 'listEvents'],
  'mip.admin.events.catalog.list': ['EVENTS', 'QUERY', 'listEventCatalogs', 'SESSION_FIRST'],
  'mip.admin.events.tags.get': ['EVENTS', 'QUERY', 'getEventTagAssignments', 'SESSION_FIRST'],
  'mip.admin.events.recaps.list': ['EVENTS', 'QUERY', 'listEventVideoRecaps', 'SESSION_FIRST'],
  'mip.admin.events.recaps.get': ['EVENTS', 'QUERY', 'getEventVideoRecap', 'SESSION_FIRST'],
  'mip.admin.events.policy.get': ['EVENTS', 'QUERY', 'getEventPolicy'],
  'mip.admin.events.get': ['EVENTS', 'QUERY', 'getEvent'],
  'mip.admin.events.insights.get': ['EVENTS', 'QUERY', 'getEventInsights'],
  'mip.admin.events.album.list': ['EVENTS', 'QUERY', 'listEventAlbumPhotos'],
  'mip.admin.events.comments.get': ['EVENTS', 'QUERY', 'getEventCommentAdminState'],
  'mip.admin.events.roster': ['EVENTS', 'QUERY', 'listRoster'],
  'mip.admin.events.rosterAll': ['EVENTS', 'QUERY', 'listRosterAll'],
  'mip.admin.events.policy.save': ['EVENTS', 'MUTATION', 'saveEventPolicy'],
  'mip.admin.events.catalog.save': ['EVENTS', 'MUTATION', 'saveEventCatalog', 'SESSION_FIRST'],
  'mip.admin.events.catalog.changeStatus': ['EVENTS', 'MUTATION', 'changeEventCatalogStatus', 'SESSION_FIRST'],
  'mip.admin.events.catalog.archive': ['EVENTS', 'MUTATION', 'archiveEventCatalog', 'SESSION_FIRST'],
  'mip.admin.events.tags.replace': ['EVENTS', 'MUTATION', 'replaceEventTagAssignments', 'SESSION_FIRST'],
  'mip.admin.events.recaps.save': ['EVENTS', 'MUTATION', 'saveEventVideoRecap', 'SESSION_FIRST'],
  'mip.admin.events.recaps.changeStatus': ['EVENTS', 'MUTATION', 'changeEventVideoRecapStatus', 'SESSION_FIRST'],
  'mip.admin.events.recaps.archive': ['EVENTS', 'MUTATION', 'archiveEventVideoRecap', 'SESSION_FIRST'],
  'mip.admin.events.save': ['EVENTS', 'MUTATION', 'saveEvent'],
  'mip.admin.events.clone': ['EVENTS', 'MUTATION', 'cloneEvent'],
  'mip.admin.events.changeStatus': ['EVENTS', 'MUTATION', 'changeEventStatus'],
  'mip.admin.events.archive': ['EVENTS', 'MUTATION', 'archiveEvent'],
  'mip.admin.events.album.review': ['EVENTS', 'MUTATION', 'reviewEventAlbumPhoto'],
  'mip.admin.events.comments.settings.save': ['EVENTS', 'MUTATION', 'saveEventCommentSettings'],
  'mip.admin.events.comments.moderate': ['EVENTS', 'MUTATION', 'moderateEventComment'],
  'mip.admin.events.comments.reports.claim': ['EVENTS', 'MUTATION', 'claimEventCommentReport'],
  'mip.admin.events.comments.reports.close': ['EVENTS', 'MUTATION', 'closeEventCommentReport'],
  'mip.admin.communications.publishEventReminder': ['EVENTS', 'MUTATION', 'publishEventReminder'],
  'mip.admin.events.registrations.review': ['EVENTS', 'MUTATION', 'reviewRegistration'],
  'mip.admin.events.checkIn': ['EVENTS', 'MUTATION', 'checkIn'],
  'mip.admin.events.undoCheckIn': ['EVENTS', 'MUTATION', 'undoCheckIn'],

  'mip.admin.orders.list': ['ORDERS', 'QUERY', 'listOrders'],
  'mip.admin.orders.get': ['ORDERS', 'QUERY', 'getOrder'],
  'mip.admin.refunds.submit': ['ORDERS', 'MUTATION', 'submitRefund'],
  'mip.admin.refunds.retry': ['ORDERS', 'MUTATION', 'retryRefund'],

  'mip.admin.announcements.scopes': ['MESSAGING', 'QUERY', 'listAnnouncementScopes'],
  'mip.admin.announcements.list': ['MESSAGING', 'QUERY', 'listAnnouncements'],
  'mip.admin.announcements.get': ['MESSAGING', 'QUERY', 'getAnnouncement'],
  'mip.admin.messageCampaigns.scopes': ['MESSAGING', 'QUERY', 'listMessageCampaignScopes', 'NO_INPUT'],
  'mip.admin.messageCampaigns.list': ['MESSAGING', 'QUERY', 'listMessageCampaigns'],
  'mip.admin.messageCampaigns.get': ['MESSAGING', 'QUERY', 'getMessageCampaign'],
  'mip.admin.messageDeliveryReviews.list': ['MESSAGING', 'QUERY', 'listMessageDeliveryReviews'],
  'mip.admin.messageDeliveryReviews.get': ['MESSAGING', 'QUERY', 'getMessageDeliveryReview'],
  'mip.admin.messageCampaigns.recipients': ['MESSAGING', 'QUERY', 'searchMessageRecipients'],
  'mip.admin.messageTemplates.list': ['MESSAGING', 'QUERY', 'listMessageTemplates'],
  'mip.admin.messageTemplates.get': ['MESSAGING', 'QUERY', 'getMessageTemplate'],
  'mip.admin.announcements.save': ['MESSAGING', 'MUTATION', 'saveAnnouncement'],
  'mip.admin.announcements.publish': ['MESSAGING', 'MUTATION', 'publishAnnouncement'],
  'mip.admin.announcements.withdraw': ['MESSAGING', 'MUTATION', 'withdrawAnnouncement'],
  'mip.admin.announcements.pin': ['MESSAGING', 'MUTATION', 'setAnnouncementPinned'],
  'mip.admin.messageCampaigns.save': ['MESSAGING', 'MUTATION', 'saveMessageCampaign'],
  'mip.admin.messageCampaigns.snapshot': ['MESSAGING', 'MUTATION', 'snapshotMessageCampaign'],
  'mip.admin.messageCampaigns.schedule': ['MESSAGING', 'MUTATION', 'scheduleMessageCampaign'],
  'mip.admin.messageCampaigns.cancelSchedule': ['MESSAGING', 'MUTATION', 'cancelMessageCampaignSchedule'],
  'mip.admin.messageCampaigns.publish': ['MESSAGING', 'MUTATION', 'publishMessageCampaign'],
  'mip.admin.messageCampaigns.withdraw': ['MESSAGING', 'MUTATION', 'withdrawMessageCampaign'],
  'mip.admin.messageDeliveryReviews.claim': ['MESSAGING', 'MUTATION', 'claimMessageDeliveryReview'],
  'mip.admin.messageDeliveryReviews.reconcile': ['MESSAGING', 'MUTATION', 'reconcileMessageDeliveryReview'],
  'mip.admin.messageDeliveryReviews.resolve': ['MESSAGING', 'MUTATION', 'resolveMessageDeliveryReview'],
  'mip.admin.messageTemplates.save': ['MESSAGING', 'MUTATION', 'saveMessageTemplate'],
  'mip.admin.messageTemplates.activate': ['MESSAGING', 'MUTATION', 'activateMessageTemplate'],
  'mip.admin.messageTemplates.archive': ['MESSAGING', 'MUTATION', 'archiveMessageTemplate'],

  'mip.admin.knowledge.list': ['KNOWLEDGE', 'QUERY', 'listKnowledgeAdmin', 'SESSION_FIRST'],
  'mip.admin.knowledge.get': ['KNOWLEDGE', 'QUERY', 'getKnowledgeAdminContent', 'SESSION_FIRST'],
  'mip.admin.knowledge.sources.save': ['KNOWLEDGE', 'MUTATION', 'saveKnowledgeSource', 'SESSION_FIRST'],
  'mip.admin.knowledge.categories.save': ['KNOWLEDGE', 'MUTATION', 'saveKnowledgeCategory', 'SESSION_FIRST'],
  'mip.admin.knowledge.contents.save': ['KNOWLEDGE', 'MUTATION', 'saveKnowledgeContent', 'SESSION_FIRST'],
  'mip.admin.knowledge.contents.review': ['KNOWLEDGE', 'MUTATION', 'reviewKnowledgeContent', 'SESSION_FIRST'],
  'mip.admin.knowledge.products.save': ['KNOWLEDGE', 'MUTATION', 'saveKnowledgeProduct', 'SESSION_FIRST'],
  'mip.admin.knowledge.comments.moderate': ['KNOWLEDGE', 'MUTATION', 'moderateKnowledgeComment', 'SESSION_FIRST'],
  'mip.admin.knowledge.reports.close': ['KNOWLEDGE', 'MUTATION', 'closeKnowledgeCommentReport', 'SESSION_FIRST'],
  'mip.admin.knowledge.ingestion.run': ['KNOWLEDGE', 'MUTATION', 'runKnowledgeIngestion', 'SESSION_FIRST'],
  'mip.admin.knowledge.schedules.list': ['KNOWLEDGE', 'QUERY', 'listKnowledgeSchedules', 'SESSION_FIRST'],
  'mip.admin.knowledge.schedules.save': ['KNOWLEDGE', 'MUTATION', 'saveKnowledgeSchedule', 'SESSION_FIRST'],

  'mip.admin.opportunities.list': ['OPPORTUNITIES', 'QUERY', 'listOpportunities'],
  'mip.admin.userContent.list': ['OPPORTUNITIES', 'QUERY', 'listUserContent'],
  'mip.admin.userContent.get': ['OPPORTUNITIES', 'QUERY', 'getUserContent'],
  'mip.admin.opportunities.get': ['OPPORTUNITIES', 'QUERY', 'getOpportunity'],
  'mip.admin.opportunities.options': ['OPPORTUNITIES', 'QUERY', 'getOpportunityEditorOptions'],
  'mip.admin.matching.get': ['OPPORTUNITIES', 'QUERY', 'getMatchingAdminState'],
  'mip.admin.opportunityComments.get': ['OPPORTUNITIES', 'QUERY', 'getOpportunityCommentAdminState'],
  'mip.admin.opportunities.save': ['OPPORTUNITIES', 'MUTATION', 'saveOpportunity'],
  'mip.admin.opportunities.publish': ['OPPORTUNITIES', 'MUTATION', 'publishOpportunity'],
  'mip.admin.opportunities.end': ['OPPORTUNITIES', 'MUTATION', 'endOpportunity'],
  'mip.admin.opportunities.unpublish': ['OPPORTUNITIES', 'MUTATION', 'unpublishOpportunity'],
  'mip.admin.opportunities.archive': ['OPPORTUNITIES', 'MUTATION', 'archiveOpportunity'],
  'mip.admin.userContent.unpublish': ['OPPORTUNITIES', 'MUTATION', 'unpublishUserContent'],
  'mip.admin.userContent.save': ['OPPORTUNITIES', 'MUTATION', 'saveUserContent'],
  'mip.admin.userContent.archive': ['OPPORTUNITIES', 'MUTATION', 'archiveUserContent'],
  'mip.admin.matching.settings.save': ['OPPORTUNITIES', 'MUTATION', 'saveMatchingSettings'],
  'mip.admin.matching.recalculate': ['OPPORTUNITIES', 'MUTATION', 'recalculateOpportunityMatching'],
  'mip.admin.opportunityComments.settings.save': ['OPPORTUNITIES', 'MUTATION', 'saveOpportunityCommentSettings'],
  'mip.admin.opportunityComments.moderate': ['OPPORTUNITIES', 'MUTATION', 'moderateOpportunityComment'],
  'mip.admin.opportunityComments.reports.close': ['OPPORTUNITIES', 'MUTATION', 'closeOpportunityCommentReport'],

  'mip.admin.growth.levels': ['GROWTH', 'QUERY', 'listGrowthLevels'],
  'mip.admin.growth.benefits': ['GROWTH', 'QUERY', 'listGrowthBenefits'],
  'mip.admin.benefits.ledger': ['GROWTH', 'QUERY', 'listUnifiedBenefitLedger'],
  'mip.admin.growth.rules': ['GROWTH', 'QUERY', 'listGrowthRules'],
  'mip.admin.growth.entries': ['GROWTH', 'QUERY', 'listGrowthEntries'],
  'mip.admin.growth.levelTransitions': ['GROWTH', 'QUERY', 'listGrowthLevelTransitions'],
  'mip.admin.badges.list': ['GROWTH', 'QUERY', 'listBadges'],
  'mip.admin.badges.awards': ['GROWTH', 'QUERY', 'listBadgeAwards'],
  'mip.admin.growth.saveBenefit': ['GROWTH', 'MUTATION', 'saveGrowthBenefit'],
  'mip.admin.growth.saveLevel': ['GROWTH', 'MUTATION', 'saveGrowthLevel'],
  'mip.admin.growth.saveRule': ['GROWTH', 'MUTATION', 'saveGrowthRule'],
  'mip.admin.growth.adjust': ['GROWTH', 'MUTATION', 'adjustGrowth'],
  'mip.admin.badges.save': ['GROWTH', 'MUTATION', 'saveBadge'],
  'mip.admin.badges.grant': ['GROWTH', 'MUTATION', 'grantBadge'],
  'mip.admin.badges.revoke': ['GROWTH', 'MUTATION', 'revokeBadge'],

  'mip.admin.dashboard': ['APPLICATION_WORKFLOW', 'QUERY', 'getDashboard'],
  'mip.admin.dashboard.overview.get': ['APPLICATION_WORKFLOW', 'QUERY', 'getDashboardOverview'],
  'mip.admin.exports.status': ['APPLICATION_WORKFLOW', 'QUERY', 'getExportStatus'],
  'mip.admin.exceptions.list': ['APPLICATION_WORKFLOW', 'QUERY', 'listOperationalExceptions'],
  'mip.admin.operations.queue.list': ['APPLICATION_WORKFLOW', 'QUERY', 'listOperationsQueue'],
  'mip.admin.exports.create': ['APPLICATION_WORKFLOW', 'MUTATION', 'createExport'],
  'mip.admin.exports.prepare': ['APPLICATION_WORKFLOW', 'MUTATION', 'prepareExport'],
  'mip.admin.exports.reserve': ['APPLICATION_WORKFLOW', 'MUTATION', 'reserveExportDownload'],
  'mip.admin.exports.complete': ['APPLICATION_WORKFLOW', 'MUTATION', 'completeExportDownload'],
})
const expectedOutboxActions = Object.freeze([
  'mip.admin.announcements.publish',
  'mip.admin.announcements.withdraw',
  'mip.admin.messageCampaigns.publish',
  'mip.admin.events.save',
  'mip.admin.events.clone',
  'mip.admin.events.changeStatus',
  'mip.admin.events.comments.moderate',
  'mip.admin.communications.publishEventReminder',
  'mip.admin.events.registrations.review',
  'mip.admin.events.checkIn',
  'mip.admin.events.undoCheckIn',
  'mip.admin.growth.adjust',
  'mip.admin.memberships.grant',
  'mip.admin.refunds.submit',
  'mip.admin.knowledge.contents.review',
  'mip.admin.opportunityComments.moderate',
])

function sorted(values) {
  return [...values].sort()
}

function definition(action, kind = 'QUERY', options = {}) {
  return {
    action,
    kind,
    dispatch: options.dispatch || (() => undefined),
    sessionFirst: options.sessionFirst === true,
    wakesOutbox: options.wakesOutbox === true,
    ...options.extra,
  }
}

function manifest(owner, operations) {
  return { owner, operations }
}

describe('admin operation catalog', () => {
  it('freezes the exact 143 business actions, owners, and kinds while keeping health separate', () => {
    const handlerActions = Object.keys(actions).filter(action => action !== 'health')
    const expectedActions = Object.keys(expectedOperations)

    assert.equal(expectedActions.length, 143)
    assert.equal(operationCatalog.length, 143)
    assert.deepEqual(sorted(handlerActions), sorted(expectedActions))
    assert.deepEqual(sorted(Object.keys(operationByAction)), sorted(expectedActions))
    assert.equal(operationByAction.health, undefined)
    assert.equal(operationByAction.toString, undefined)
    assert.equal(actions.toString, undefined)
    assert.equal(Object.getPrototypeOf(operationByAction), null)
    assert.deepEqual(healthOperation, { action: 'health', owner: 'SYSTEM', kind: 'QUERY' })

    for (const operation of operationCatalog) {
      const [owner, kind, , mode] = expectedOperations[operation.action]
      assert.equal(operation.owner, owner, operation.action)
      assert.equal(operation.kind, kind, operation.action)
      assert.equal(operation.sessionFirst, mode === 'SESSION_FIRST', operation.action)
      assert.equal(operationByAction[operation.action], operation)
      assert.equal(Object.isFrozen(operation), true)
    }
  })

  it('dispatches every action to the exact legacy method and preserves special call ordering', async () => {
    const caller = { appId: 'wx-app', userId: 'user-a' }
    const input = { marker: 'input-a' }

    for (const [action, [, , expectedMethod, mode]] of Object.entries(expectedOperations)) {
      const calls = []
      const service = new Proxy({}, {
        get(_target, method) {
          return async (...args) => {
            calls.push({ method, args })
            return { method }
          }
        },
      })
      const result = await actions[action](service, caller, input)

      if (mode === 'SESSION_FIRST') {
        assert.deepEqual(calls.map(call => call.method), ['getSession', expectedMethod], action)
        assert.deepEqual(calls[0].args, [caller], action)
        assert.deepEqual(calls[1].args, [caller, input], action)
      }
      else {
        assert.deepEqual(calls.map(call => call.method), [expectedMethod], action)
        assert.deepEqual(calls[0].args, mode === 'NO_INPUT' ? [caller] : [caller, input], action)
      }
      assert.deepEqual(result, { method: expectedMethod }, action)
    }
  })

  it('freezes every registry surface and accepts only legal owner and kind values', () => {
    assert.equal(Object.isFrozen(operationCatalog), true)
    assert.equal(Object.isFrozen(operationByAction), true)
    assert.equal(Object.isFrozen(healthOperation), true)

    for (const operation of operationCatalog) {
      assert.equal(OPERATION_OWNERS.includes(operation.owner), true)
      assert.equal(OPERATION_KINDS.includes(operation.kind), true)
      assert.equal(typeof operation.dispatch, 'function')
      assert.equal(typeof operation.sessionFirst, 'boolean')
      assert.equal(typeof operation.wakesOutbox, 'boolean')
    }
  })

  it('derives the exact outbox wakeup set from mutation metadata', () => {
    assert.deepEqual(sorted(outboxMutationActions), sorted(expectedOutboxActions))
    for (const operation of operationCatalog) {
      assert.equal(outboxMutationActions.has(operation.action), operation.wakesOutbox, operation.action)
      if (operation.wakesOutbox) {
        assert.equal(operation.kind, 'MUTATION', operation.action)
      }
    }
  })

  it('fails closed for duplicate, incomplete, illegal, health, and malformed manifests', () => {
    const valid = definition('mip.admin.test')
    const options = { expectedCount: 1, expectedOwners: ['ACCESS'] }
    const cases = [
      {
        manifests: [manifest('UNKNOWN', [valid])],
        error: 'OPERATION_MANIFEST_INVALID',
      },
      {
        manifests: [manifest('ACCESS', [definition('mip.admin.test', 'READ')])],
        error: 'OPERATION_KIND_INVALID',
      },
      {
        manifests: [manifest('ACCESS', [definition('health')])],
        error: 'OPERATION_ACTION_INVALID',
      },
      {
        manifests: [manifest('ACCESS', [{ ...valid, dispatch: null }])],
        error: 'OPERATION_DISPATCH_INVALID',
      },
      {
        manifests: [manifest('ACCESS', [{ ...valid, sessionFirst: null }])],
        error: 'OPERATION_SESSION_INVALID',
      },
      {
        manifests: [manifest('ACCESS', [definition('mip.admin.test', 'QUERY', { wakesOutbox: true })])],
        error: 'OPERATION_OUTBOX_INVALID',
      },
      {
        manifests: [manifest('ACCESS', [definition('mip.admin.test', 'MUTATION', {
          extra: { capability: 'unproven' },
        })])],
        error: 'OPERATION_DEFINITION_INVALID',
      },
    ]

    for (const testCase of cases) {
      assert.throws(
        () => createOperationRegistry(testCase.manifests, options),
        new RegExp(testCase.error),
      )
    }

    assert.throws(
      () => createOperationRegistry([
        manifest('ACCESS', [definition('mip.admin.same')]),
        manifest('USERS', [definition('mip.admin.same')]),
      ], { expectedCount: 2, expectedOwners: ['ACCESS', 'USERS'] }),
      /OPERATION_ACTION_DUPLICATE/,
    )
    assert.throws(
      () => createOperationRegistry([
        manifest('ACCESS', [definition('mip.admin.one')]),
        manifest('ACCESS', [definition('mip.admin.two')]),
      ], { expectedCount: 2, expectedOwners: ['ACCESS'] }),
      /OPERATION_OWNER_DUPLICATE/,
    )
    assert.throws(
      () => createOperationRegistry([
        manifest('ACCESS', [definition('mip.admin.one')]),
      ], { expectedCount: 1, expectedOwners: ['ACCESS', 'USERS'] }),
      /OPERATION_OWNER_MISSING/,
    )
    assert.throws(
      () => createOperationRegistry([
        manifest('ACCESS', [definition('mip.admin.one')]),
      ], { expectedCount: 2, expectedOwners: ['ACCESS'] }),
      /OPERATION_COUNT_INVALID/,
    )
  })
})
