'use strict'

const OPERATION_KINDS = Object.freeze(['QUERY', 'MUTATION'])
const OPERATION_OWNERS = Object.freeze([
  'ACCESS',
  'USERS',
  'EVENTS',
  'ORDERS',
  'MESSAGING',
  'KNOWLEDGE',
  'OPPORTUNITIES',
  'GROWTH',
  'APPLICATION_WORKFLOW',
])

const groupedActions = Object.freeze({
  ACCESS: Object.freeze({
    QUERY: Object.freeze([
      'mip.admin.session',
      'mip.admin.branches.list',
      'mip.admin.roles.list',
      'mip.admin.roles.candidates',
      'mip.admin.rolePolicies.list',
      'mip.admin.audit.list',
    ]),
    MUTATION: Object.freeze([
      'mip.admin.branches.create',
      'mip.admin.branches.update',
      'mip.admin.branches.changeStatus',
      'mip.admin.roles.set',
      'mip.admin.rolePolicies.update',
    ]),
  }),
  USERS: Object.freeze({
    QUERY: Object.freeze([
      'mip.admin.users.list',
      'mip.admin.users.get',
      'mip.admin.communityReports.list',
    ]),
    MUTATION: Object.freeze([
      'mip.admin.users.update',
      'mip.admin.users.setControl',
      'mip.admin.communityReports.claim',
      'mip.admin.communityReports.close',
    ]),
  }),
  EVENTS: Object.freeze({
    QUERY: Object.freeze([
      'mip.admin.events.list',
      'mip.admin.events.policy.get',
      'mip.admin.events.get',
      'mip.admin.events.album.list',
      'mip.admin.events.roster',
      'mip.admin.events.rosterAll',
    ]),
    MUTATION: Object.freeze([
      'mip.admin.events.policy.save',
      'mip.admin.events.save',
      'mip.admin.events.clone',
      'mip.admin.events.changeStatus',
      'mip.admin.events.archive',
      'mip.admin.events.album.review',
      'mip.admin.communications.publishEventReminder',
      'mip.admin.events.registrations.review',
      'mip.admin.events.checkIn',
      'mip.admin.events.undoCheckIn',
    ]),
  }),
  ORDERS: Object.freeze({
    QUERY: Object.freeze([
      'mip.admin.orders.list',
    ]),
    MUTATION: Object.freeze([
      'mip.admin.refunds.submit',
      'mip.admin.refunds.retry',
    ]),
  }),
  MESSAGING: Object.freeze({
    QUERY: Object.freeze([
      'mip.admin.announcements.scopes',
      'mip.admin.announcements.list',
      'mip.admin.announcements.get',
      'mip.admin.messageCampaigns.scopes',
      'mip.admin.messageCampaigns.list',
      'mip.admin.messageCampaigns.get',
      'mip.admin.messageCampaigns.recipients',
    ]),
    MUTATION: Object.freeze([
      'mip.admin.announcements.save',
      'mip.admin.announcements.publish',
      'mip.admin.announcements.withdraw',
      'mip.admin.announcements.pin',
      'mip.admin.messageCampaigns.save',
      'mip.admin.messageCampaigns.snapshot',
      'mip.admin.messageCampaigns.publish',
      'mip.admin.messageCampaigns.withdraw',
    ]),
  }),
  KNOWLEDGE: Object.freeze({
    QUERY: Object.freeze([
      'mip.admin.knowledge.list',
      'mip.admin.knowledge.get',
    ]),
    MUTATION: Object.freeze([
      'mip.admin.knowledge.sources.save',
      'mip.admin.knowledge.categories.save',
      'mip.admin.knowledge.contents.save',
      'mip.admin.knowledge.contents.review',
      'mip.admin.knowledge.products.save',
      'mip.admin.knowledge.comments.moderate',
      'mip.admin.knowledge.reports.close',
      'mip.admin.knowledge.ingestion.run',
    ]),
  }),
  OPPORTUNITIES: Object.freeze({
    QUERY: Object.freeze([
      'mip.admin.opportunities.list',
      'mip.admin.opportunities.get',
      'mip.admin.opportunities.options',
      'mip.admin.matching.get',
      'mip.admin.opportunityComments.get',
    ]),
    MUTATION: Object.freeze([
      'mip.admin.opportunities.save',
      'mip.admin.opportunities.publish',
      'mip.admin.opportunities.end',
      'mip.admin.opportunities.unpublish',
      'mip.admin.opportunities.archive',
      'mip.admin.matching.settings.save',
      'mip.admin.matching.recalculate',
      'mip.admin.opportunityComments.settings.save',
      'mip.admin.opportunityComments.moderate',
      'mip.admin.opportunityComments.reports.close',
    ]),
  }),
  GROWTH: Object.freeze({
    QUERY: Object.freeze([
      'mip.admin.growth.levels',
      'mip.admin.growth.benefits',
      'mip.admin.growth.rules',
      'mip.admin.growth.entries',
      'mip.admin.badges.list',
      'mip.admin.badges.awards',
    ]),
    MUTATION: Object.freeze([
      'mip.admin.growth.saveBenefit',
      'mip.admin.growth.saveLevel',
      'mip.admin.growth.saveRule',
      'mip.admin.growth.adjust',
      'mip.admin.badges.save',
      'mip.admin.badges.grant',
      'mip.admin.badges.revoke',
    ]),
  }),
  APPLICATION_WORKFLOW: Object.freeze({
    QUERY: Object.freeze([
      'mip.admin.dashboard',
      'mip.admin.exports.status',
      'mip.admin.exceptions.list',
    ]),
    MUTATION: Object.freeze([
      'mip.admin.exports.create',
      'mip.admin.exports.prepare',
      'mip.admin.exports.reserve',
      'mip.admin.exports.complete',
    ]),
  }),
})

const operationCatalog = Object.freeze(
  Object.entries(groupedActions).flatMap(([owner, kinds]) => (
    OPERATION_KINDS.flatMap(kind => kinds[kind].map(action => Object.freeze({ action, owner, kind })))
  )),
)

const operationByAction = Object.freeze(Object.fromEntries(
  operationCatalog.map(operation => [operation.action, operation]),
))

const healthOperation = Object.freeze({ action: 'health', owner: 'SYSTEM', kind: 'QUERY' })

module.exports = {
  OPERATION_KINDS,
  OPERATION_OWNERS,
  healthOperation,
  operationByAction,
  operationCatalog,
}
