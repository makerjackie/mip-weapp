'use strict'

const { createHash, createHmac } = require('node:crypto')
const { stableJson } = require('./internal-auth')

function createInternalClients(options) {
  if (!options.cloud || typeof options.cloud.callFunction !== 'function') {
    throw new Error('INTERNAL_CLIENT_CONFIG_REQUIRED')
  }
  const now = options.now || Date.now

  return {
    async probeDependencies(appId) {
      assertFunctionName(options.notificationFunctionName)
      assertSecret(options.notificationSecret, 'NOTIFICATION_CLIENT_CONFIG_REQUIRED')
      assertFunctionName(options.growthFunctionName)
      assertSecret(options.growthSecret, 'GROWTH_CLIENT_CONFIG_REQUIRED')

      const notificationEvent = {
        action: 'publishMessage',
        appId,
        message: {},
        timestamp: Number(now()),
      }
      const notificationSignature = signNotificationEvent(notificationEvent, options.notificationSecret)
      const notificationAuthenticated = await invokeExpectingError(
        options.cloud,
        options.notificationFunctionName,
        { ...notificationEvent, signature: notificationSignature },
        'VALIDATION_FAILED',
      )

      const growthEvent = {
        action: 'recordConfirmedEvent',
        appId,
        userId: '',
        sourceEventType: '',
        sourceEventId: '',
        timestamp: Number(now()),
      }
      const growthSignature = signGrowthEvent(growthEvent, options.growthSecret)
      const growthAuthenticated = await invokeExpectingError(
        options.cloud,
        options.growthFunctionName,
        { ...growthEvent, signature: growthSignature },
        'VALIDATION_FAILED',
      )
      return { growthAuthenticated, notificationAuthenticated }
    },

    async publishMessage(appId, message) {
      assertFunctionName(options.notificationFunctionName)
      assertSecret(options.notificationSecret, 'NOTIFICATION_CLIENT_CONFIG_REQUIRED')
      const event = {
        action: 'publishMessage',
        appId,
        message,
        timestamp: Number(now()),
      }
      const signature = signNotificationEvent(event, options.notificationSecret)
      return invoke(options.cloud, options.notificationFunctionName, { ...event, signature })
    },

    async runNotificationBatch(appId, limit = 20) {
      assertFunctionName(options.notificationFunctionName)
      assertSecret(options.notificationSecret, 'NOTIFICATION_CLIENT_CONFIG_REQUIRED')
      const event = {
        action: 'runDeliveryBatch',
        appId,
        limit: Math.min(20, Math.max(1, Number(limit) || 20)),
        drain: true,
        maxBatches: 5,
        timestamp: Number(now()),
      }
      const signature = signNotificationEvent(event, options.notificationSecret)
      return invoke(options.cloud, options.notificationFunctionName, { ...event, signature })
    },

    async recordConfirmedEvent(appId, growth) {
      assertFunctionName(options.growthFunctionName)
      assertSecret(options.growthSecret, 'GROWTH_CLIENT_CONFIG_REQUIRED')
      const event = growth.action === 'applyCheckInTransition'
        ? {
            action: 'applyCheckInTransition',
            appId,
            transitionId: growth.transitionId,
            timestamp: Number(now()),
          }
        : {
            action: growth.action === 'grantGameCoins' || growth.action === 'spendGameCoins'
              ? growth.action
              : 'recordConfirmedEvent',
            appId,
            userId: growth.userId,
            sourceEventType: growth.sourceEventType,
            sourceEventId: growth.sourceEventId,
            timestamp: Number(now()),
          }
      const signature = signGrowthEvent(event, options.growthSecret)
      return invoke(options.cloud, options.growthFunctionName, { ...event, signature })
    },
  }
}

function signNotificationEvent(event, secret) {
  const body = Object.fromEntries(
    Object.entries(event).filter(([key]) => !['signature', 'timestamp'].includes(key)),
  )
  const canonical = [
    Number(event.timestamp),
    text(event.action),
    text(event.appId),
    createHash('sha256').update(stableJson(body)).digest('hex'),
  ].join('\n')
  return createHmac('sha256', secret).update(canonical).digest('hex')
}

function signGrowthEvent(event, secret) {
  const canonical = [
    Number(event.timestamp),
    text(event.action),
    text(event.appId),
    text(event.userId),
    text(event.sourceEventType),
    text(event.sourceEventId),
    text(event.transitionId),
  ].join('\n')
  return createHmac('sha256', secret).update(canonical).digest('hex')
}

async function invoke(cloud, functionName, data) {
  const response = await cloud.callFunction({ name: functionName, data })
  const envelope = response?.result
  if (!envelope || envelope.ok !== true) {
    const code = text(envelope?.error?.code)
    throw new Error(/^[A-Z][A-Z0-9_]{2,63}$/.test(code) ? code : 'INTERNAL_FUNCTION_FAILED')
  }
  return envelope.data
}

async function invokeExpectingError(cloud, functionName, data, expectedCode) {
  const response = await cloud.callFunction({ name: functionName, data })
  const envelope = response?.result
  return envelope?.ok === false && text(envelope?.error?.code) === expectedCode
}

function assertFunctionName(value) {
  if (!/^mip-[a-z0-9][a-z0-9-]{0,55}$/.test(text(value))) {
    throw new Error('INTERNAL_CLIENT_CONFIG_REQUIRED')
  }
}

function assertSecret(value, code) {
  if (typeof value !== 'string' || value.length < 32) {
    throw new Error(code)
  }
}

function text(value) {
  return typeof value === 'string' ? value.trim() : ''
}

module.exports = {
  createInternalClients,
  signGrowthEvent,
  signNotificationEvent,
}
