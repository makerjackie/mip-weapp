'use strict'

const { AdminError } = require('./validation')

const actions = Object.freeze({
  health: service => service.health(),
  'mip.admin.session': (service, caller, event) => service.getSession(caller, event),
  'mip.admin.dashboard': (service, caller, event) => service.getDashboard(caller, event),
  'mip.admin.branches.list': (service, caller, event) => service.listBranches(caller, event),
  'mip.admin.branches.create': (service, caller, event) => service.createBranch(caller, event),
  'mip.admin.branches.update': (service, caller, event) => service.updateBranch(caller, event),
  'mip.admin.branches.changeStatus': (service, caller, event) => service.changeBranchStatus(caller, event),
  'mip.admin.announcements.scopes': (service, caller, event) => service.listAnnouncementScopes(caller, event),
  'mip.admin.announcements.list': (service, caller, event) => service.listAnnouncements(caller, event),
  'mip.admin.announcements.get': (service, caller, event) => service.getAnnouncement(caller, event),
  'mip.admin.announcements.save': (service, caller, event) => service.saveAnnouncement(caller, event),
  'mip.admin.announcements.publish': (service, caller, event) => service.publishAnnouncement(caller, event),
  'mip.admin.announcements.withdraw': (service, caller, event) => service.withdrawAnnouncement(caller, event),
  'mip.admin.announcements.pin': (service, caller, event) => service.setAnnouncementPinned(caller, event),
  'mip.admin.messageCampaigns.scopes': (service, caller) => service.listMessageCampaignScopes(caller),
  'mip.admin.messageCampaigns.list': (service, caller, event) => service.listMessageCampaigns(caller, event),
  'mip.admin.messageCampaigns.get': (service, caller, event) => service.getMessageCampaign(caller, event),
  'mip.admin.messageCampaigns.recipients': (service, caller, event) => service.searchMessageRecipients(caller, event),
  'mip.admin.messageCampaigns.save': (service, caller, event) => service.saveMessageCampaign(caller, event),
  'mip.admin.messageCampaigns.snapshot': (service, caller, event) => service.snapshotMessageCampaign(caller, event),
  'mip.admin.messageCampaigns.publish': (service, caller, event) => service.publishMessageCampaign(caller, event),
  'mip.admin.messageCampaigns.withdraw': (service, caller, event) => service.withdrawMessageCampaign(caller, event),
  'mip.admin.users.list': (service, caller, event) => service.listUsers(caller, event),
  'mip.admin.users.get': (service, caller, event) => service.getUser(caller, event),
  'mip.admin.users.update': (service, caller, event) => service.updateUser(caller, event),
  'mip.admin.users.setControl': (service, caller, event) => service.setUserControl(caller, event),
  'mip.admin.exports.create': (service, caller, event) => service.createExport(caller, event),
  'mip.admin.exports.prepare': (service, caller, event) => service.prepareExport(caller, event),
  'mip.admin.exports.status': (service, caller, event) => service.getExportStatus(caller, event),
  'mip.admin.exports.reserve': (service, caller, event) => service.reserveExportDownload(caller, event),
  'mip.admin.exports.complete': (service, caller, event) => service.completeExportDownload(caller, event),
  'mip.admin.events.list': (service, caller, event) => service.listEvents(caller, event),
  'mip.admin.events.policy.get': (service, caller, event) => service.getEventPolicy(caller, event),
  'mip.admin.events.policy.save': (service, caller, event) => service.saveEventPolicy(caller, event),
  'mip.admin.events.get': (service, caller, event) => service.getEvent(caller, event),
  'mip.admin.events.save': (service, caller, event) => service.saveEvent(caller, event),
  'mip.admin.events.clone': (service, caller, event) => service.cloneEvent(caller, event),
  'mip.admin.events.changeStatus': (service, caller, event) => service.changeEventStatus(caller, event),
  'mip.admin.events.archive': (service, caller, event) => service.archiveEvent(caller, event),
  'mip.admin.events.album.list': (service, caller, event) => service.listEventAlbumPhotos(caller, event),
  'mip.admin.events.album.review': (service, caller, event) => service.reviewEventAlbumPhoto(caller, event),
  'mip.admin.communications.publishEventReminder': (service, caller, event) => service.publishEventReminder(caller, event),
  'mip.admin.communityReports.list': (service, caller, event) => service.listCommunityReports(caller, event),
  'mip.admin.communityReports.claim': (service, caller, event) => service.claimCommunityReport(caller, event),
  'mip.admin.communityReports.close': (service, caller, event) => service.closeCommunityReport(caller, event),
  'mip.admin.events.roster': (service, caller, event) => service.listRoster(caller, event),
  'mip.admin.events.rosterAll': (service, caller, event) => service.listRosterAll(caller, event),
  'mip.admin.events.registrations.review': (service, caller, event) => service.reviewRegistration(caller, event),
  'mip.admin.events.checkIn': (service, caller, event) => service.checkIn(caller, event),
  'mip.admin.events.undoCheckIn': (service, caller, event) => service.undoCheckIn(caller, event),
  'mip.admin.roles.list': (service, caller, event) => service.listRoles(caller, event),
  'mip.admin.roles.candidates': (service, caller, event) => service.searchRoleCandidates(caller, event),
  'mip.admin.roles.set': (service, caller, event) => service.setRole(caller, event),
  'mip.admin.rolePolicies.list': (service, caller, event) => service.listRoleCapabilityPolicies(caller, event),
  'mip.admin.rolePolicies.update': (service, caller, event) => service.updateRoleCapabilityPolicy(caller, event),
  'mip.admin.opportunities.list': (service, caller, event) => service.listOpportunities(caller, event),
  'mip.admin.opportunities.get': (service, caller, event) => service.getOpportunity(caller, event),
  'mip.admin.opportunities.options': (service, caller, event) => service.getOpportunityEditorOptions(caller, event),
  'mip.admin.opportunities.save': (service, caller, event) => service.saveOpportunity(caller, event),
  'mip.admin.opportunities.publish': (service, caller, event) => service.publishOpportunity(caller, event),
  'mip.admin.opportunities.end': (service, caller, event) => service.endOpportunity(caller, event),
  'mip.admin.opportunities.unpublish': (service, caller, event) => service.unpublishOpportunity(caller, event),
  'mip.admin.opportunities.archive': (service, caller, event) => service.archiveOpportunity(caller, event),
  'mip.admin.matching.get': (service, caller, event) => service.getMatchingAdminState(caller, event),
  'mip.admin.matching.settings.save': (service, caller, event) => service.saveMatchingSettings(caller, event),
  'mip.admin.matching.recalculate': (service, caller, event) => service.recalculateOpportunityMatching(caller, event),
  'mip.admin.opportunityComments.get': (service, caller, event) => service.getOpportunityCommentAdminState(caller, event),
  'mip.admin.opportunityComments.settings.save': (service, caller, event) => service.saveOpportunityCommentSettings(caller, event),
  'mip.admin.opportunityComments.moderate': (service, caller, event) => service.moderateOpportunityComment(caller, event),
  'mip.admin.opportunityComments.reports.close': (service, caller, event) => service.closeOpportunityCommentReport(caller, event),
  'mip.admin.growth.levels': (service, caller, event) => service.listGrowthLevels(caller, event),
  'mip.admin.growth.benefits': (service, caller, event) => service.listGrowthBenefits(caller, event),
  'mip.admin.growth.saveBenefit': (service, caller, event) => service.saveGrowthBenefit(caller, event),
  'mip.admin.growth.saveLevel': (service, caller, event) => service.saveGrowthLevel(caller, event),
  'mip.admin.growth.rules': (service, caller, event) => service.listGrowthRules(caller, event),
  'mip.admin.growth.saveRule': (service, caller, event) => service.saveGrowthRule(caller, event),
  'mip.admin.growth.entries': (service, caller, event) => service.listGrowthEntries(caller, event),
  'mip.admin.growth.adjust': (service, caller, event) => service.adjustGrowth(caller, event),
  'mip.admin.badges.list': (service, caller, event) => service.listBadges(caller, event),
  'mip.admin.badges.save': (service, caller, event) => service.saveBadge(caller, event),
  'mip.admin.badges.awards': (service, caller, event) => service.listBadgeAwards(caller, event),
  'mip.admin.badges.grant': (service, caller, event) => service.grantBadge(caller, event),
  'mip.admin.badges.revoke': (service, caller, event) => service.revokeBadge(caller, event),
  'mip.admin.orders.list': (service, caller, event) => service.listOrders(caller, event),
  'mip.admin.knowledge.list': (service, caller, event) => knowledgeAction(service, caller, event, 'listKnowledgeAdmin'),
  'mip.admin.knowledge.get': (service, caller, event) => knowledgeAction(service, caller, event, 'getKnowledgeAdminContent'),
  'mip.admin.knowledge.sources.save': (service, caller, event) => knowledgeAction(service, caller, event, 'saveKnowledgeSource'),
  'mip.admin.knowledge.categories.save': (service, caller, event) => knowledgeAction(service, caller, event, 'saveKnowledgeCategory'),
  'mip.admin.knowledge.contents.save': (service, caller, event) => knowledgeAction(service, caller, event, 'saveKnowledgeContent'),
  'mip.admin.knowledge.contents.review': (service, caller, event) => knowledgeAction(service, caller, event, 'reviewKnowledgeContent'),
  'mip.admin.knowledge.products.save': (service, caller, event) => knowledgeAction(service, caller, event, 'saveKnowledgeProduct'),
  'mip.admin.knowledge.comments.moderate': (service, caller, event) => knowledgeAction(service, caller, event, 'moderateKnowledgeComment'),
  'mip.admin.knowledge.reports.close': (service, caller, event) => knowledgeAction(service, caller, event, 'closeKnowledgeCommentReport'),
  'mip.admin.knowledge.ingestion.run': (service, caller, event) => knowledgeAction(service, caller, event, 'runKnowledgeIngestion'),
  'mip.admin.refunds.submit': (service, caller, event) => service.submitRefund(caller, event),
  'mip.admin.refunds.retry': (service, caller, event) => service.retryRefund(caller, event),
  'mip.admin.exceptions.list': (service, caller, event) => service.listOperationalExceptions(caller, event),
  'mip.admin.audit.list': (service, caller, event) => service.listAudit(caller, event),
})

async function knowledgeAction(service, caller, event, method) {
  await service.getSession(caller)
  return service[method](caller, event)
}

function createAdminApplication({ service, assertPrincipal } = {}) {
  if (!service || typeof assertPrincipal !== 'function') {
    throw new Error('APPLICATION_CONFIG_INVALID')
  }

  async function execute(principal, action, input = {}) {
    const dispatch = action === 'health' ? null : actions[action]
    if (!dispatch) throw new AdminError('NOT_FOUND', '运营操作不存在')
    const caller = assertPrincipal(principal)
    return dispatch(service, caller, input)
  }

  async function probe() {
    return actions.health(service)
  }

  return Object.freeze({ execute, probe })
}

module.exports = { actions, createAdminApplication }
