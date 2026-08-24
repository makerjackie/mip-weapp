'use strict'

const { timingSafeEqual } = require('node:crypto')
const { hashRecipient, revealRecipient } = require('../lib/recipient-protection')
const { buildWechatRequest } = require('../lib/templates')
const { normalizeMessage } = require('./validation')

function createNotificationService(options) {
  const repository = options.repository

  return {
    publishMessage(input) {
      const message = normalizeMessage(input.message)
      if (message.external && !options.templates?.[message.external.templateKey]) {
        message.external = null
      }
      return repository.publishMessage(input.appId, message)
    },

    async runDeliveryBatch(input) {
      const tasks = await repository.leaseTasks(input.appId, input.limit)
      const results = []
      for (const task of tasks) {
        let reservation
        try {
          reservation = await repository.reserveTask(task)
        }
        catch (error) {
          results.push(await settleFailure(
            () => repository.failLeasedTask(task, safeDeliveryError(error)),
            task.id,
          ))
          continue
        }

        let request
        try {
          request = buildDeliveryRequest(reservation, options)
        }
        catch (error) {
          results.push(await settleFailure(
            () => repository.failReservedTask(reservation, safeDeliveryError(error), {
              externalAttempted: false,
            }),
            task.id,
          ))
          continue
        }

        try {
          results.push(await repository.deliverReservedTask(
            reservation,
            () => options.sender(request),
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
        delivered: results.filter(item => item.status === 'DELIVERED').length,
        failed: results.filter(item => item.status !== 'DELIVERED').length,
        results,
      }
    },
  }
}

function buildDeliveryRequest(delivery, options) {
  if (delivery.channel !== 'WECHAT_SUBSCRIPTION') {
    throw new Error('CHANNEL_UNSUPPORTED')
  }
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
  return buildWechatRequest(
    options.templates[delivery.template_key],
    delivery,
    recipient,
    { miniprogramState: options.miniprogramState },
  )
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
}
