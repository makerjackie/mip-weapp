'use strict'

const { randomUUID } = require('node:crypto')
const { protectRecipient } = require('../lib/recipient-protection')
const { normalizeSubscriptionDecision } = require('./validation')

function createNotificationsService(options) {
  const repository = options.repository
  const createId = options.createId || randomUUID

  return {
    listInbox(caller, event) {
      return repository.listInbox(caller.appId, caller.userId, event)
    },

    markRead(caller, event) {
      return repository.markRead(caller.appId, caller.userId, event.messageId)
    },

    async recordSubscriptionDecision(caller, event) {
      const decision = normalizeSubscriptionDecision(event.templateKey, event.decision)
      if (decision.decision === 'BANNED') {
        await repository.revokeGrants(caller.appId, caller.userId, decision.templateKey)
        return { ...decision, grantAvailable: false }
      }
      if (decision.decision !== 'ACCEPTED') {
        return { ...decision, grantAvailable: false }
      }
      if (!options.templates?.[decision.templateKey]) {
        throw new Error('TEMPLATE_MISSING')
      }
      const id = createId()
      const protectedRecipient = protectRecipient(
        caller.openId,
        options.encryptionKey,
        {
          appId: caller.appId,
          userId: caller.userId,
          grantId: id,
          templateKey: decision.templateKey,
        },
        options.randomBytes,
      )
      return repository.createGrant({
        id,
        appId: caller.appId,
        userId: caller.userId,
        templateKey: decision.templateKey,
        ...protectedRecipient,
      })
    },
  }
}

module.exports = { createNotificationsService }
