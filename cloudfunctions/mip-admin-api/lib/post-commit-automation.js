'use strict'

const { outboxMutationActions } = require('../domain/operation-registry')

const messageScheduleMutationActions = new Set([
  'mip.admin.messageCampaigns.schedule',
  'mip.admin.messageCampaigns.cancelSchedule',
])

function postCommitAutomationFor(action) {
  const messageSchedule = messageScheduleMutationActions.has(action)
  const outbox = outboxMutationActions.has(action)
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
