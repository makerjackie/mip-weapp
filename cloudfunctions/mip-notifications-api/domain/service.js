'use strict'

const { randomUUID } = require('node:crypto')
const { protectRecipient } = require('../lib/recipient-protection')
const { normalizeSubscriptionDecision } = require('./validation')

const CUSTOMER_SERVICE_TEMPLATE_KEY = 'CUSTOMER_SERVICE_TEXT'
const CUSTOMER_SERVICE_WINDOW_MS = 48 * 60 * 60 * 1000

function createNotificationsService(options) {
  const repository = options.repository
  const createId = options.createId || randomUUID
  const clock = options.clock || Date.now

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

    async recordCustomerServiceInteraction(caller) {
      if (options.customerServiceEnabled !== true) throw new Error('CHANNEL_UNAVAILABLE')
      const id = createId()
      const expiresAt = new Date(Number(clock()) + CUSTOMER_SERVICE_WINDOW_MS)
      const protectedRecipient = protectRecipient(
        caller.openId,
        options.encryptionKey,
        {
          appId: caller.appId,
          userId: caller.userId,
          grantId: id,
          templateKey: CUSTOMER_SERVICE_TEMPLATE_KEY,
        },
        options.randomBytes,
      )
      await repository.createCustomerServiceGrant({
        id,
        appId: caller.appId,
        userId: caller.userId,
        templateKey: CUSTOMER_SERVICE_TEMPLATE_KEY,
        expiresAt,
        ...protectedRecipient,
      })
      return {
        channel: 'WECHAT_CUSTOMER_SERVICE',
        availableUntil: expiresAt.toISOString(),
      }
    },
  }
}

module.exports = {
  CUSTOMER_SERVICE_TEMPLATE_KEY,
  CUSTOMER_SERVICE_WINDOW_MS,
  createNotificationsService,
}
