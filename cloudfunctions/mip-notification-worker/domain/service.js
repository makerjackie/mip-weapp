'use strict'

const { timingSafeEqual } = require('node:crypto')
const { hashRecipient, revealRecipient } = require('../lib/recipient-protection')
const {
  buildCustomerServiceRequest,
  buildServiceAccountRequest,
} = require('../lib/channel-adapters')
const { buildWechatRequest } = require('../lib/templates')
const { normalizeMessage } = require('./validation')

function createNotificationService(options) {
  const repository = options.repository
  const clock = options.clock || Date.now
  const wait = options.wait || (delay => new Promise(resolve => setTimeout(resolve, delay)))

  return {
    publishMessage(input) {
      const message = normalizeMessage(input.message)
      if (message.external && !isChannelConfigured(message.external, options)) {
        message.external = null
      }
      return repository.publishMessage(input.appId, message)
    },

    reconcileDeliveryTask(input) {
      return repository.reconcileDeliveryTask({
        appId: input.appId,
        actorUserId: uuid(input.actorUserId),
        taskId: uuid(input.taskId),
        expectedEvidenceRevision: evidenceRevision(input.expectedEvidenceRevision),
        idempotencyKey: idempotencyKey(input.idempotencyKey),
        now: new Date(Number(clock())),
      })
    },

    async runDeliveryBatch(input) {
      const limit = normalizeLimit(input.limit)
      const maxBatches = input.drain === true ? normalizeMaxBatches(input.maxBatches) : 1
      const deadline = Number(clock()) + 30_000
      const batches = []
      const latestResults = new Map()
      for (let batch = 0; batch < maxBatches && Number(clock()) < deadline; batch += 1) {
        const result = await runSingleBatch(input.appId, limit)
        batches.push(result)
        for (const item of result.results) latestResults.set(item.taskId, item)
        const retryAt = earliestRetryAt(result.results)
        if (retryAt && input.drain === true && batch + 1 < maxBatches) {
          const delay = Math.max(0, retryAt - Number(clock()))
          if (Number(clock()) + delay >= deadline) break
          await wait(delay)
          continue
        }
        if (result.leased < limit) break
      }
      const results = batches.flatMap(batch => batch.results)
      const latest = [...latestResults.values()]
      const pending = latest.filter(item => item.status === 'FAILED').length
      const terminal = latest.filter(item => ['CANCELLED', 'LEASE_LOST'].includes(item.status)).length
      return {
        batches: batches.length,
        leased: batches.reduce((total, batch) => total + batch.leased, 0),
        delivered: latest.filter(item => item.status === 'DELIVERED').length,
        failed: pending,
        pending,
        terminal,
        results,
      }
    },
  }

  async function runSingleBatch(appId, limit) {
    const currentTime = new Date(Number(clock()))
    const tasks = await repository.leaseTasks(appId, limit, currentTime)
    const results = []
    for (const task of tasks) {
      let reservation
      try {
        reservation = await repository.reserveTask(task)
      }
      catch (error) {
        results.push(await settleFailure(
          () => repository.failLeasedTask(task, safeDeliveryError(error), currentTime),
          task.id,
        ))
        continue
      }

      let request
      let sender
      try {
        request = buildDeliveryRequest(reservation, options)
        sender = resolveSender(reservation.channel, options)
      }
      catch (error) {
        results.push(await settleFailure(
          () => repository.failReservedTask(reservation, safeDeliveryError(error), {
            now: currentTime,
          }),
          task.id,
        ))
        continue
      }

      try {
        results.push(await repository.deliverReservedTask(
          reservation,
          () => sender(request),
          { now: currentTime },
        ))
      }
      catch {
        results.push({
          taskId: task.id,
          status: 'LEASE_LOST',
          errorCode: 'DELIVERY_OUTCOME_UNKNOWN',
        })
      }
    }
    return {
      leased: tasks.length,
      results,
    }
  }
}

function uuid(value) {
  const normalized = typeof value === 'string' ? value.trim() : ''
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalized)) {
    throw new Error('VALIDATION_FAILED')
  }
  return normalized
}

function evidenceRevision(value) {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (!/^[0-9a-f]{64}$/.test(normalized)) throw new Error('VALIDATION_FAILED')
  return normalized
}

function idempotencyKey(value) {
  const normalized = typeof value === 'string' ? value.trim() : ''
  if (normalized.length < 12 || normalized.length > 128 || !/^[A-Za-z0-9_.:-]+$/.test(normalized)) {
    throw new Error('VALIDATION_FAILED')
  }
  return normalized
}

function earliestRetryAt(results) {
  const times = results
    .filter(item => item.status === 'FAILED')
    .map(item => new Date(item.retryAt).getTime())
    .filter(Number.isFinite)
  return times.length ? Math.min(...times) : 0
}

function normalizeLimit(value) {
  const limit = value === undefined ? 10 : Number(value)
  if (!Number.isInteger(limit) || limit < 1 || limit > 20) throw new Error('VALIDATION_FAILED')
  return limit
}

function normalizeMaxBatches(value) {
  const maxBatches = value === undefined ? 5 : Number(value)
  if (!Number.isInteger(maxBatches) || maxBatches < 1 || maxBatches > 5) {
    throw new Error('VALIDATION_FAILED')
  }
  return maxBatches
}

function buildDeliveryRequest(delivery, options) {
  if (delivery.channel === 'WECHAT_SERVICE_ACCOUNT') {
    return buildServiceAccountRequest(options.serviceAccountConfig, delivery)
  }
  if (!['WECHAT_SUBSCRIPTION', 'WECHAT_CUSTOMER_SERVICE'].includes(delivery.channel)) {
    throw new Error('CHANNEL_UNSUPPORTED')
  }
  if (!delivery.grant) throw new Error('GRANT_UNAVAILABLE')
  const recipient = revealRecipient(
    delivery.grant.recipient_ciphertext,
    options.encryptionKey,
    {
      appId: delivery.app_id,
      userId: delivery.recipient_user_id,
      grantId: delivery.grant.id,
      templateKey: delivery.template_key,
    },
  )
  assertRecipientHash(
    delivery.grant.recipient_hash,
    hashRecipient(recipient, options.encryptionKey, delivery.app_id),
  )
  if (delivery.channel === 'WECHAT_CUSTOMER_SERVICE') {
    return buildCustomerServiceRequest(delivery, recipient)
  }
  return buildWechatRequest(options.templates[delivery.template_key], delivery, recipient, {
    miniprogramState: options.miniprogramState,
  })
}

function isChannelConfigured(external, options) {
  if (external.channel === 'WECHAT_SUBSCRIPTION') {
    return Boolean(options.templates?.[external.templateKey])
  }
  if (external.channel === 'WECHAT_CUSTOMER_SERVICE') {
    return options.customerServiceEnabled === true
  }
  if (external.channel === 'WECHAT_SERVICE_ACCOUNT') {
    return Boolean(options.serviceAccountConfig?.templates?.[external.templateKey])
  }
  return false
}

function resolveSender(channel, options) {
  const sender = options.senders?.[channel]
    || (channel === 'WECHAT_SUBSCRIPTION' ? options.sender : null)
  if (typeof sender !== 'function') throw new Error('CHANNEL_UNAVAILABLE')
  return sender
}

async function settleFailure(work, taskId) {
  try {
    return await work()
  }
  catch (error) {
    const code = safeDeliveryError(error)
    if (code === 'DELIVERY_LEASE_LOST' || code === 'DELIVERY_RESERVATION_LOST') {
      return { taskId, status: 'LEASE_LOST', errorCode: 'DELIVERY_OUTCOME_UNKNOWN' }
    }
    throw error
  }
}

function assertRecipientHash(stored, expected) {
  if (!/^[a-f0-9]{64}$/i.test(String(stored || '')) || !/^[a-f0-9]{64}$/i.test(expected)) {
    throw new Error('NOTIFICATION_RECIPIENT_INVALID')
  }
  const left = Buffer.from(stored, 'hex')
  const right = Buffer.from(expected, 'hex')
  if (left.length !== right.length || !timingSafeEqual(left, right)) {
    throw new Error('NOTIFICATION_RECIPIENT_INVALID')
  }
}

function safeDeliveryError(error) {
  const code = error instanceof Error ? error.message : ''
  return /^[A-Z][A-Z0-9_]{2,63}$/.test(code) ? code : 'DELIVERY_FAILED'
}

module.exports = {
  assertRecipientHash,
  buildDeliveryRequest,
  createNotificationService,
  safeDeliveryError,
  settleFailure,
  earliestRetryAt,
  normalizeLimit,
  normalizeMaxBatches,
  isChannelConfigured,
  resolveSender,
  evidenceRevision,
  idempotencyKey,
  uuid,
}
