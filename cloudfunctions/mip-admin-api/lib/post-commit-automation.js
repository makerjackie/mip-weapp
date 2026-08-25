'use strict'

const { outboxMutationActions } = require('../domain/operation-registry')

const EVENT_COMMENT_MODERATION_ACTION = 'mip.admin.events.comments.moderate'
const messageScheduleMutationActions = new Set([
  'mip.admin.messageCampaigns.schedule',
  'mip.admin.messageCampaigns.cancelSchedule',
  'mip.admin.messageDeliveryReviews.reconcile',
])

function postCommitAutomationFor(action, resultData = null) {
  const messageSchedule = messageScheduleMutationActions.has(action)
    && (action !== 'mip.admin.messageDeliveryReviews.reconcile'
      || resultData?.schedulerReconcileRequired === true)
  const outbox = outboxMutationActions.has(action)
    && (action !== EVENT_COMMENT_MODERATION_ACTION || resultData?.status === 'PUBLISHED')
  return Object.freeze({
    messageSchedule,
    outbox,
    requiresTrustedAppId: messageSchedule || outbox,
  })
}

module.exports = {
  messageScheduleMutationActions,
  outboxMutationActions,
  postCommitAutomationFor,
}
