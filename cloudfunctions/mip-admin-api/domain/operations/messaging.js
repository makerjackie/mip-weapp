'use strict'

const { defineManifest, serviceOperation } = require('./manifest')

module.exports = defineManifest('MESSAGING', [
  serviceOperation('mip.admin.announcements.scopes', 'QUERY', 'listAnnouncementScopes'),
  serviceOperation('mip.admin.announcements.list', 'QUERY', 'listAnnouncements'),
  serviceOperation('mip.admin.announcements.get', 'QUERY', 'getAnnouncement'),
  serviceOperation('mip.admin.messageCampaigns.scopes', 'QUERY', 'listMessageCampaignScopes', { usesInput: false }),
  serviceOperation('mip.admin.messageCampaigns.list', 'QUERY', 'listMessageCampaigns'),
  serviceOperation('mip.admin.messageCampaigns.get', 'QUERY', 'getMessageCampaign'),
  serviceOperation('mip.admin.messageCampaigns.recipients', 'QUERY', 'searchMessageRecipients'),
  serviceOperation('mip.admin.messageTemplates.list', 'QUERY', 'listMessageTemplates'),
  serviceOperation('mip.admin.messageTemplates.get', 'QUERY', 'getMessageTemplate'),
  serviceOperation('mip.admin.messageDeliveryReviews.list', 'QUERY', 'listMessageDeliveryReviews'),
  serviceOperation('mip.admin.messageDeliveryReviews.get', 'QUERY', 'getMessageDeliveryReview'),
  serviceOperation('mip.admin.announcements.save', 'MUTATION', 'saveAnnouncement'),
  serviceOperation('mip.admin.announcements.publish', 'MUTATION', 'publishAnnouncement', { wakesOutbox: true }),
  serviceOperation('mip.admin.announcements.withdraw', 'MUTATION', 'withdrawAnnouncement', { wakesOutbox: true }),
  serviceOperation('mip.admin.announcements.pin', 'MUTATION', 'setAnnouncementPinned'),
  serviceOperation('mip.admin.messageCampaigns.save', 'MUTATION', 'saveMessageCampaign'),
  serviceOperation('mip.admin.messageCampaigns.snapshot', 'MUTATION', 'snapshotMessageCampaign'),
  serviceOperation('mip.admin.messageCampaigns.schedule', 'MUTATION', 'scheduleMessageCampaign'),
  serviceOperation('mip.admin.messageCampaigns.cancelSchedule', 'MUTATION', 'cancelMessageCampaignSchedule'),
  serviceOperation('mip.admin.messageCampaigns.publish', 'MUTATION', 'publishMessageCampaign', { wakesOutbox: true }),
  serviceOperation('mip.admin.messageCampaigns.withdraw', 'MUTATION', 'withdrawMessageCampaign'),
  serviceOperation('mip.admin.messageTemplates.save', 'MUTATION', 'saveMessageTemplate'),
  serviceOperation('mip.admin.messageTemplates.activate', 'MUTATION', 'activateMessageTemplate'),
  serviceOperation('mip.admin.messageTemplates.archive', 'MUTATION', 'archiveMessageTemplate'),
  serviceOperation('mip.admin.messageDeliveryReviews.claim', 'MUTATION', 'claimMessageDeliveryReview'),
  serviceOperation('mip.admin.messageDeliveryReviews.reconcile', 'MUTATION', 'reconcileMessageDeliveryReview'),
  serviceOperation('mip.admin.messageDeliveryReviews.resolve', 'MUTATION', 'resolveMessageDeliveryReview'),
])
