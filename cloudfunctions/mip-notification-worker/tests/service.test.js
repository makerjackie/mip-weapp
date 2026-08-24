'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const { createNotificationRepository } = require('../domain/repository')
const { createNotificationService } = require('../domain/service')
const { protectRecipient } = require('../lib/recipient-protection')

const key = 'notification-key-that-is-longer-than-thirty-two-bytes'
const appId = 'wx-app'
const userId = '10000000-0000-4000-8000-000000000001'
const grantId = '20000000-0000-4000-8000-000000000001'

test('delivers with one grant and returns only a sanitized task result', async () => {
  const context = { appId, userId, grantId, templateKey: 'EVENT_REMINDER' }
  const protectedValue = protectRecipient('openid-private', key, context, size => Buffer.alloc(size, 5))
  const task = {
    id: '30000000-0000-4000-8000-000000000001',
    app_id: appId,
    attempts: 1,
    lease_expires_at: new Date('2026-08-24T01:02:00.000Z'),
    leaseKey: '2026-08-24T01:02:00.000Z',
  }
  let sent
  const steps = []
  const repository = {
    async leaseTasks() {
      steps.push('lease')
      return [task]
    },
    async reserveTask() {
      steps.push('reserve')
      return {
        taskId: task.id,
        app_id: appId,
        channel: 'WECHAT_SUBSCRIPTION',
        template_key: 'EVENT_REMINDER',
        payload_json: JSON.stringify({ fields: { title: '活动提醒' } }),
        recipient_user_id: userId,
        target_route: '/packages/member/mip-events/detail/index?eventId=40000000-0000-4000-8000-000000000001',
        grant: {
          id: grantId,
          recipient_hash: protectedValue.recipientHash,
          recipient_ciphertext: protectedValue.recipientCiphertext,
        },
      }
    },
    async deliverReservedTask(_reservation, deliver) {
      steps.push('delivery-fence')
      await deliver()
      steps.push('finalize')
      return { taskId: task.id, status: 'DELIVERED' }
    },
    async failLeasedTask() { throw new Error('unexpected failure') },
    async failReservedTask() { throw new Error('unexpected failure') },
  }
  const service = createNotificationService({
    repository,
    encryptionKey: key,
    templates: {
      EVENT_REMINDER: { templateId: 'template-id', fields: { title: 'thing1' } },
    },
    miniprogramState: 'trial',
    async sender(request) {
      steps.push('send')
      sent = request
    },
  })
  const result = await service.runDeliveryBatch({ appId, limit: 10 })
  assert.equal(sent.touser, 'openid-private')
  assert.deepEqual(steps, ['lease', 'reserve', 'delivery-fence', 'send', 'finalize'])
  assert.deepEqual(result, {
    batches: 1,
    leased: 1,
    delivered: 1,
    failed: 0,
    pending: 0,
    terminal: 0,
    results: [{ taskId: task.id, status: 'DELIVERED' }],
  })
  assert.equal(JSON.stringify(result).includes('openid-private'), false)
})

test('releases a reservation when local request validation fails before sender invocation', async () => {
  const task = {
    id: '30000000-0000-4000-8000-000000000001',
    app_id: appId,
    leaseKey: '2026-08-24T01:02:00.000Z',
  }
  let senderCalls = 0
  let failureInput
  const service = createNotificationService({
    repository: {
      async leaseTasks() { return [task] },
      async reserveTask() {
        return {
          taskId: task.id,
          app_id: appId,
          channel: 'WECHAT_SUBSCRIPTION',
          template_key: 'EVENT_REMINDER',
          payload_json: '{}',
          recipient_user_id: userId,
          target_route: '/packages/member/mip-events/detail/index?eventId=40000000-0000-4000-8000-000000000001',
          grant: {
            id: grantId,
            recipient_hash: 'a'.repeat(64),
            recipient_ciphertext: Buffer.from('invalid'),
          },
        }
      },
      async failReservedTask(_reservation, code, input) {
        failureInput = { code, input }
        return { taskId: task.id, status: 'FAILED', errorCode: code }
      },
    },
    encryptionKey: key,
    templates: {
      EVENT_REMINDER: { templateId: 'template-id', fields: { title: 'thing1' } },
    },
    async sender() { senderCalls += 1 },
  })
  const result = await service.runDeliveryBatch({ appId })
  assert.equal(senderCalls, 0)
  assert.equal(failureInput.input.externalAttempted, false)
  assert.equal(result.failed, 1)
  assert.equal(JSON.stringify(result).includes('recipient_ciphertext'), false)
})

test('settles an external sender failure through the delivery fence', async () => {
  const context = { appId, userId, grantId, templateKey: 'EVENT_REMINDER' }
  const protectedValue = protectRecipient('openid-private', key, context, size => Buffer.alloc(size, 6))
  const task = {
    id: '30000000-0000-4000-8000-000000000001',
    app_id: appId,
    leaseKey: '2026-08-24T01:02:00.000Z',
  }
  let failureCode
  const service = createNotificationService({
    repository: {
      async leaseTasks() { return [task] },
      async reserveTask() {
        return {
          taskId: task.id,
          app_id: appId,
          channel: 'WECHAT_SUBSCRIPTION',
          template_key: 'EVENT_REMINDER',
          payload_json: JSON.stringify({ fields: { title: '活动提醒' } }),
          recipient_user_id: userId,
          target_route: '/packages/member/mip-events/detail/index?eventId=40000000-0000-4000-8000-000000000001',
          grant: {
            id: grantId,
            recipient_hash: protectedValue.recipientHash,
            recipient_ciphertext: protectedValue.recipientCiphertext,
          },
        }
      },
      async deliverReservedTask(_reservation, deliver) {
        try {
          await deliver()
        }
        catch (error) {
          failureCode = error.message
          return { taskId: task.id, status: 'FAILED', errorCode: failureCode }
        }
        throw new Error('unexpected success')
      },
    },
    encryptionKey: key,
    templates: {
      EVENT_REMINDER: { templateId: 'template-id', fields: { title: 'thing1' } },
    },
    async sender() { throw new Error('WECHAT_DELIVERY_FAILED') },
  })
  const result = await service.runDeliveryBatch({ appId })
  assert.equal(failureCode, 'WECHAT_DELIVERY_FAILED')
  assert.equal(result.failed, 1)
  assert.equal(JSON.stringify(result).includes('openid-private'), false)
})

test('drains a short retry to delivery in the same bounded invocation', async () => {
  const context = { appId, userId, grantId, templateKey: 'EVENT_REMINDER' }
  const protectedValue = protectRecipient('openid-private', key, context, size => Buffer.alloc(size, 9))
  const task = {
    id: '30000000-0000-4000-8000-000000000009',
    app_id: appId,
    leaseKey: '2026-08-24T01:02:00.000Z',
  }
  let currentTime = new Date('2026-08-24T01:00:00.000Z').getTime()
  let attempts = 0
  const waits = []
  const service = createNotificationService({
    repository: {
      async leaseTasks() { return [task] },
      async reserveTask() {
        return {
          taskId: task.id,
          app_id: appId,
          channel: 'WECHAT_SUBSCRIPTION',
          template_key: 'EVENT_REMINDER',
          payload_json: JSON.stringify({ fields: { title: '活动提醒' } }),
          recipient_user_id: userId,
          target_route: '/packages/member/mip-events/detail/index?eventId=40000000-0000-4000-8000-000000000001',
          grant: {
            id: grantId,
            recipient_hash: protectedValue.recipientHash,
            recipient_ciphertext: protectedValue.recipientCiphertext,
          },
        }
      },
      async deliverReservedTask() {
        attempts += 1
        return attempts === 1
          ? {
              taskId: task.id,
              status: 'FAILED',
              errorCode: 'WECHAT_DELIVERY_FAILED',
              retryAt: new Date(currentTime + 500).toISOString(),
            }
          : { taskId: task.id, status: 'DELIVERED' }
      },
    },
    encryptionKey: key,
    templates: {
      EVENT_REMINDER: { templateId: 'template-id', fields: { title: 'thing1' } },
    },
    clock: () => currentTime,
    async wait(delay) {
      waits.push(delay)
      currentTime += delay
    },
    async sender() {},
  })

  const result = await service.runDeliveryBatch({ appId, drain: true, limit: 2, maxBatches: 5 })
  assert.equal(attempts, 2)
  assert.deepEqual(waits, [500])
  assert.equal(result.delivered, 1)
  assert.equal(result.pending, 0)
  assert.equal(result.terminal, 0)
})

test('holds the active-user transaction across sender invocation and final state writes', async () => {
  const context = { appId, userId, grantId, templateKey: 'EVENT_REMINDER' }
  const protectedValue = protectRecipient('openid-private', key, context, size => Buffer.alloc(size, 7))
  const lease = new Date('2026-08-24T01:02:00.000Z')
  const task = {
    id: '30000000-0000-4000-8000-000000000001',
    app_id: appId,
    lease_expires_at: lease,
    leaseKey: lease.toISOString(),
  }
  let transactionActive = false
  let transactionNumber = 0
  const transactionAttempts = []
  const steps = []
  const database = {
    async transaction(work, attempts) {
      assert.equal(transactionActive, false)
      transactionActive = true
      transactionNumber += 1
      const currentTransaction = transactionNumber
      transactionAttempts.push(attempts)
      try {
        return await work({
          async one(sql) {
            if (sql.includes('FROM mip_users')) {
              steps.push('lock-user')
              return { id: userId, status: 'ACTIVE' }
            }
            if (sql.includes('INNER JOIN mip_inbox_messages')) {
              return {
                id: task.id,
                app_id: appId,
                channel: 'WECHAT_SUBSCRIPTION',
                template_key: 'EVENT_REMINDER',
                payload_json: JSON.stringify({ fields: { title: '活动提醒' } }),
                attempts: 1,
                lease_expires_at: lease,
                recipient_user_id: userId,
                target_route: '/packages/member/mip-events/detail/index?eventId=40000000-0000-4000-8000-000000000001',
              }
            }
            if (sql.includes("status = 'RESERVED' AND reservation_task_id")) return null
            if (sql.includes("status = 'AVAILABLE'")) {
              return {
                id: grantId,
                recipient_hash: protectedValue.recipientHash,
                recipient_ciphertext: protectedValue.recipientCiphertext,
              }
            }
            if (sql.includes('FROM mip_delivery_tasks')) {
              return {
                id: task.id,
                app_id: appId,
                status: 'PROCESSING',
                attempts: 1,
                lease_expires_at: lease,
              }
            }
            return {
              id: grantId,
              user_id: userId,
              channel: 'WECHAT_SUBSCRIPTION',
              template_key: 'EVENT_REMINDER',
              status: 'RESERVED',
              reservation_task_id: task.id,
              reservation_token: '50000000-0000-4000-8000-000000000001',
            }
          },
          async query(sql) {
            if (currentTransaction === 2 && sql.includes("status = 'CONSUMED'")) {
              steps.push('consume-grant')
            }
            if (currentTransaction === 2 && sql.includes("status = 'DELIVERED'")) {
              steps.push('deliver-task')
            }
            return { affectedRows: 1 }
          },
        })
      }
      finally {
        transactionActive = false
      }
    },
  }
  const repository = createNotificationRepository(database, {
    createId: () => '50000000-0000-4000-8000-000000000001',
  })
  repository.leaseTasks = async () => [task]
  const service = createNotificationService({
    repository,
    encryptionKey: key,
    templates: {
      EVENT_REMINDER: { templateId: 'template-id', fields: { title: 'thing1' } },
    },
    async sender() {
      assert.equal(transactionActive, true)
      steps.push('send')
    },
  })
  const result = await service.runDeliveryBatch({ appId })
  assert.equal(result.delivered, 1)
  assert.deepEqual(steps, ['lock-user', 'send', 'consume-grant', 'deliver-task'])
  assert.equal(transactionAttempts[1], 1)
})

test('keeps the inbox message and drops external delivery when its template is not configured', async () => {
  let captured
  const service = createNotificationService({
    repository: {
      async publishMessage(_appId, message) {
        captured = message
        return { id: 'stored-message' }
      },
    },
    templates: {},
  })
  const result = await service.publishMessage({
    appId,
    message: {
      recipientUserId: userId,
      messageType: 'OPERATIONS',
      title: '活动开始提醒',
      body: '活动将于明天开始。',
      targetType: 'EVENT',
      targetId: '40000000-0000-4000-8000-000000000001',
      dedupeKey: 'outbox:missing-template:operations',
      external: {
        channel: 'WECHAT_SUBSCRIPTION',
        templateKey: 'EVENT_REMINDER',
        fields: {
          title: '城市交流活动',
          startsAt: '2026-08-25 10:00',
          location: '广州活动中心',
        },
      },
    },
  })
  assert.deepEqual(result, { id: 'stored-message' })
  assert.equal(captured.external, null)
  assert.equal(captured.messageType, 'OPERATIONS')
})

test('retains external delivery only when the corresponding template is configured', async () => {
  let captured
  const service = createNotificationService({
    repository: {
      async publishMessage(_appId, message) {
        captured = message
        return { id: 'stored-message' }
      },
    },
    templates: {
      EVENT_REMINDER: {
        templateId: 'template-id',
        fields: { title: 'thing1', startsAt: 'time2', location: 'thing3' },
      },
    },
  })
  await service.publishMessage({
    appId,
    message: {
      recipientUserId: userId,
      messageType: 'OPERATIONS',
      title: '活动开始提醒',
      body: '活动将于明天开始。',
      targetType: 'EVENT',
      targetId: '40000000-0000-4000-8000-000000000001',
      dedupeKey: 'outbox:configured-template:operations',
      external: {
        channel: 'WECHAT_SUBSCRIPTION',
        templateKey: 'EVENT_REMINDER',
        fields: {
          title: '城市交流活动',
          startsAt: '2026-08-25 10:00',
          location: '广州活动中心',
        },
      },
    },
  })
  assert.equal(captured.external.templateKey, 'EVENT_REMINDER')
})
