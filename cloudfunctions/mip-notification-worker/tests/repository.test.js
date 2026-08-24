'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const { createNotificationRepository } = require('../domain/repository')

const appId = 'wx-app'
const userId = '10000000-0000-4000-8000-000000000001'
const messageId = '20000000-0000-4000-8000-000000000001'

describe('notification repository', () => {
  it('deduplicates inbox and external delivery writes by server keys', async () => {
    const writes = []
    const database = {
      transaction: async callback => callback({
        async one(sql) {
          if (sql.includes('FROM mip_users')) return { id: userId, status: 'ACTIVE' }
          return {
            id: messageId,
            recipient_user_id: userId,
            message_type: 'OPERATIONS',
            title: '活动开始提醒',
            body: '活动将于明天开始。',
            target_type: 'EVENT',
            target_id: '30000000-0000-4000-8000-000000000001',
            target_route: '/packages/member/mip-events/detail/index?eventId=30000000-0000-4000-8000-000000000001',
            read_at: null,
            created_at: new Date('2026-08-24T00:00:00.000Z'),
          }
        },
        async query(sql, params) {
          writes.push({ sql, params })
          return { affectedRows: 1 }
        },
      }),
    }
    const ids = [messageId, '40000000-0000-4000-8000-000000000001']
    const repository = createNotificationRepository(database, { createId: () => ids.shift() })
    await repository.publishMessage(appId, {
      recipientUserId: userId,
      messageType: 'OPERATIONS',
      title: '活动开始提醒',
      body: '活动将于明天开始。',
      target: {
        type: 'EVENT',
        id: '30000000-0000-4000-8000-000000000001',
        route: '/packages/member/mip-events/detail/index?eventId=30000000-0000-4000-8000-000000000001',
      },
      dedupeKey: 'outbox:event:operations',
      external: {
        channel: 'WECHAT_SUBSCRIPTION',
        templateKey: 'EVENT_REMINDER',
        payload: { fields: { title: '城市交流活动' } },
      },
    })
    assert.match(writes[0].sql, /ON DUPLICATE KEY UPDATE dedupe_key = VALUES\(dedupe_key\)/)
    assert.match(writes[1].sql, /ON DUPLICATE KEY UPDATE inbox_message_id = VALUES\(inbox_message_id\)/)
    assert.equal(writes[0].params.at(-1), 'outbox:event:operations')
  })

  it('reserves one app-scoped authorization before any external work', async () => {
    const lease = new Date('2026-08-24T01:02:00.000Z')
    const reads = []
    const writes = []
    const database = {
      transaction: async callback => callback({
        async one(sql, params) {
          reads.push({ sql, params })
          if (sql.includes('FROM mip_delivery_tasks')) {
            return {
              id: '50000000-0000-4000-8000-000000000001',
              app_id: appId,
              channel: 'WECHAT_SUBSCRIPTION',
              template_key: 'EVENT_REMINDER',
              payload_json: '{}',
              lease_expires_at: lease,
              recipient_user_id: userId,
              target_route: '/packages/member/mip-events/detail/index?eventId=30000000-0000-4000-8000-000000000001',
            }
          }
          if (sql.includes("status = 'RESERVED'")) return null
          return {
            id: '60000000-0000-4000-8000-000000000001',
            recipient_hash: 'a'.repeat(64),
            recipient_ciphertext: Buffer.from('ciphertext'),
          }
        },
        async query(sql, params) {
          writes.push({ sql, params })
          return { affectedRows: 1 }
        },
      }),
    }
    const repository = createNotificationRepository(database, {
      createId: () => '70000000-0000-4000-8000-000000000001',
    })
    const task = {
      id: '50000000-0000-4000-8000-000000000001',
      app_id: appId,
      leaseKey: lease.toISOString(),
    }
    const result = await repository.reserveTask(task)
    assert.match(reads[0].sql, /status = 'PROCESSING' FOR UPDATE/)
    assert.match(reads[0].sql, /u\.status = 'ACTIVE'/)
    assert.match(reads[1].sql, /status = 'RESERVED'/)
    assert.match(reads[2].sql, /status = 'AVAILABLE'/)
    assert.match(reads[2].sql, /FOR UPDATE/)
    assert.deepEqual(reads[2].params.slice(0, 4), [
      appId,
      userId,
      'WECHAT_SUBSCRIPTION',
      'EVENT_REMINDER',
    ])
    assert.match(writes[0].sql, /status = 'RESERVED'/)
    assert.match(writes[0].sql, /reservation_task_id IS NULL/)
    assert.equal(result.taskId, task.id)
    assert.equal(result.reservationToken, '70000000-0000-4000-8000-000000000001')
    assert.equal(result.grant.recipient_ciphertext.toString(), 'ciphertext')
  })

  it('refreshes the same task reservation instead of consuming another grant on retry', async () => {
    const lease = new Date('2026-08-24T01:12:00.000Z')
    const reads = []
    const writes = []
    const grant = {
      id: '60000000-0000-4000-8000-000000000001',
      recipient_hash: 'a'.repeat(64),
      recipient_ciphertext: Buffer.from('ciphertext'),
    }
    const database = {
      transaction: async callback => callback({
        async one(sql, params) {
          reads.push({ sql, params })
          if (sql.includes('FROM mip_delivery_tasks')) {
            return {
              id: '50000000-0000-4000-8000-000000000001',
              app_id: appId,
              channel: 'WECHAT_SUBSCRIPTION',
              template_key: 'EVENT_REMINDER',
              payload_json: '{}',
              attempts: 2,
              lease_expires_at: lease,
              recipient_user_id: userId,
              target_route: '/packages/member/mip-events/detail/index?eventId=30000000-0000-4000-8000-000000000001',
            }
          }
          return grant
        },
        async query(sql, params) {
          writes.push({ sql, params })
          return { affectedRows: 1 }
        },
      }),
    }
    const repository = createNotificationRepository(database, {
      createId: () => '70000000-0000-4000-8000-000000000002',
    })
    await repository.reserveTask({
      id: '50000000-0000-4000-8000-000000000001',
      app_id: appId,
      leaseKey: lease.toISOString(),
    })
    assert.equal(reads.length, 2)
    assert.match(reads[1].sql, /reservation_task_id = \?/)
    assert.match(writes[0].sql, /SET reservation_token = \?/)
    assert.doesNotMatch(writes[0].sql, /status = 'AVAILABLE'/)
  })

  it('locks the active recipient, task, and exact grant while sending and finalizing', async () => {
    const lease = new Date('2026-08-24T01:02:00.000Z')
    const reads = []
    const writes = []
    let transactionActive = false
    let configuredAttempts
    const database = {
      async transaction(callback, attempts) {
        configuredAttempts = attempts
        transactionActive = true
        try {
          return await callback({
            async one(sql, params) {
              reads.push({ sql, params })
              if (sql.includes('FROM mip_users')) return { id: userId, status: 'ACTIVE' }
              if (sql.includes('FROM mip_delivery_tasks')) {
                return {
                  id: 'task-id', app_id: appId, status: 'PROCESSING', attempts: 1,
                  lease_expires_at: lease,
                }
              }
              return {
                id: 'grant-id', user_id: userId, channel: 'WECHAT_SUBSCRIPTION',
                template_key: 'EVENT_REMINDER', status: 'RESERVED',
                reservation_task_id: 'task-id', reservation_token: 'reservation-id',
              }
            },
            async query(sql, params) {
              assert.equal(transactionActive, true)
              writes.push({ sql, params })
              return { affectedRows: 1 }
            },
          })
        }
        finally {
          transactionActive = false
        }
      },
    }
    const repository = createNotificationRepository(database)
    const result = await repository.deliverReservedTask({
      taskId: 'task-id', app_id: appId, channel: 'WECHAT_SUBSCRIPTION',
      template_key: 'EVENT_REMINDER', recipient_user_id: userId,
      leaseKey: lease.toISOString(), lease_expires_at: lease,
      reservationToken: 'reservation-id', grant: { id: 'grant-id' },
    }, async () => {
      assert.equal(transactionActive, true)
    })
    assert.deepEqual(result, { taskId: 'task-id', status: 'DELIVERED' })
    assert.equal(configuredAttempts, 1)
    assert.match(reads[0].sql, /FROM mip_users[\s\S]*FOR UPDATE/)
    assert.match(reads[1].sql, /FROM mip_delivery_tasks[\s\S]*FOR UPDATE/)
    assert.match(reads[2].sql, /FROM mip_notification_grants[\s\S]*FOR UPDATE/)
    assert.match(writes[0].sql, /status = 'CONSUMED'/)
    assert.match(writes[1].sql, /status = 'DELIVERED'/)
  })

  it('does not invoke the sender after account closure has committed', async () => {
    let senderCalls = 0
    let reads = 0
    const database = {
      async transaction(callback, attempts) {
        assert.equal(attempts, 1)
        return callback({
          async one(sql) {
            reads += 1
            assert.match(sql, /FROM mip_users[\s\S]*FOR UPDATE/)
            return { id: userId, status: 'CLOSED' }
          },
          async query() { throw new Error('unexpected write') },
        })
      },
    }
    const repository = createNotificationRepository(database)
    const result = await repository.deliverReservedTask({
      taskId: 'task-id', app_id: appId, recipient_user_id: userId, grant: { id: 'grant-id' },
    }, async () => { senderCalls += 1 })
    assert.deepEqual(result, {
      taskId: 'task-id',
      status: 'CANCELLED',
      errorCode: 'DELIVERY_RECIPIENT_INACTIVE',
    })
    assert.equal(reads, 1)
    assert.equal(senderCalls, 0)
  })

  it('keeps account closure behind the delivery commit once sending starts', async () => {
    const lease = new Date('2026-08-24T01:02:00.000Z')
    const order = []
    let userLocked = false
    let releaseSender
    let announceSender
    let announceUnlock
    const senderStarted = new Promise(resolve => { announceSender = resolve })
    const senderRelease = new Promise(resolve => { releaseSender = resolve })
    const userUnlocked = new Promise(resolve => { announceUnlock = resolve })
    const database = {
      async transaction(callback, attempts) {
        assert.equal(attempts, 1)
        try {
          const result = await callback({
            async one(sql) {
              if (sql.includes('FROM mip_users')) {
                userLocked = true
                order.push('user-locked')
                return { id: userId, status: 'ACTIVE' }
              }
              if (sql.includes('FROM mip_delivery_tasks')) {
                return {
                  id: 'task-id', app_id: appId, status: 'PROCESSING', attempts: 1,
                  lease_expires_at: lease,
                }
              }
              return {
                id: 'grant-id', user_id: userId, channel: 'WECHAT_SUBSCRIPTION',
                template_key: 'EVENT_REMINDER', status: 'RESERVED',
                reservation_task_id: 'task-id', reservation_token: 'reservation-id',
              }
            },
            async query(sql) {
              if (sql.includes("status = 'DELIVERED'")) order.push('final-state-written')
              return { affectedRows: 1 }
            },
          })
          order.push('delivery-committed')
          return result
        }
        finally {
          userLocked = false
          announceUnlock()
        }
      },
    }
    const repository = createNotificationRepository(database)
    const delivery = repository.deliverReservedTask({
      taskId: 'task-id', app_id: appId, channel: 'WECHAT_SUBSCRIPTION',
      template_key: 'EVENT_REMINDER', recipient_user_id: userId,
      leaseKey: lease.toISOString(), lease_expires_at: lease,
      reservationToken: 'reservation-id', grant: { id: 'grant-id' },
    }, async () => {
      order.push('sender-started')
      announceSender()
      await senderRelease
      order.push('sender-finished')
    })
    await senderStarted
    const closure = (async () => {
      order.push('closure-waiting')
      if (userLocked) await userUnlocked
      order.push('closure-committed')
    })()
    await Promise.resolve()
    assert.equal(order.includes('closure-committed'), false)
    releaseSender()
    await Promise.all([delivery, closure])
    assert.deepEqual(order, [
      'user-locked',
      'sender-started',
      'closure-waiting',
      'sender-finished',
      'final-state-written',
      'delivery-committed',
      'closure-committed',
    ])
  })

  it('pins the reservation and records retry state before releasing the user lock on sender failure', async () => {
    const lease = new Date('2026-08-24T01:02:00.000Z')
    const writes = []
    let transactionActive = false
    const database = {
      async transaction(callback, attempts) {
        assert.equal(attempts, 1)
        transactionActive = true
        try {
          return await callback({
            async one(sql) {
              if (sql.includes('FROM mip_users')) return { id: userId, status: 'ACTIVE' }
              if (sql.includes('FROM mip_delivery_tasks')) {
                return {
                  id: 'task-id', app_id: appId, status: 'PROCESSING', attempts: 2,
                  lease_expires_at: lease,
                }
              }
              return {
                id: 'grant-id', user_id: userId, channel: 'WECHAT_SUBSCRIPTION',
                template_key: 'EVENT_REMINDER', status: 'RESERVED',
                reservation_task_id: 'task-id', reservation_token: 'reservation-id',
              }
            },
            async query(sql, params) {
              assert.equal(transactionActive, true)
              writes.push({ sql, params })
              return { affectedRows: 1 }
            },
          })
        }
        finally {
          transactionActive = false
        }
      },
    }
    const repository = createNotificationRepository(database)
    const result = await repository.deliverReservedTask({
      taskId: 'task-id', app_id: appId, channel: 'WECHAT_SUBSCRIPTION',
      template_key: 'EVENT_REMINDER', recipient_user_id: userId,
      leaseKey: lease.toISOString(), lease_expires_at: lease,
      reservationToken: 'reservation-id', grant: { id: 'grant-id' },
    }, async () => {
      assert.equal(transactionActive, true)
      throw new Error('WECHAT_DELIVERY_FAILED')
    }, { now: new Date('2026-08-24T01:00:00.000Z') })
    assert.deepEqual(result, {
      taskId: 'task-id', status: 'FAILED', errorCode: 'WECHAT_DELIVERY_FAILED',
    })
    assert.equal(writes.length, 1)
    assert.match(writes[0].sql, /SET status = 'FAILED'/)
    assert.equal(writes[0].params.at(-1), lease)
  })

  it('releases a reservation only when external delivery was not attempted', async () => {
    const lease = new Date('2026-08-24T01:02:00.000Z')
    const writes = []
    let read = 0
    const database = {
      transaction: async callback => callback({
        async one() {
          read += 1
          if (read === 1) {
            return {
              id: 'task-id', app_id: appId, status: 'PROCESSING', attempts: 1,
              lease_expires_at: lease,
            }
          }
          return {
            id: 'grant-id', status: 'RESERVED', reservation_task_id: 'task-id',
            reservation_token: 'reservation-id',
          }
        },
        async query(sql, params) {
          writes.push({ sql, params })
          return { affectedRows: 1 }
        },
      }),
    }
    const repository = createNotificationRepository(database)
    const result = await repository.failReservedTask({
      taskId: 'task-id', app_id: appId, leaseKey: lease.toISOString(), lease_expires_at: lease,
      reservationToken: 'reservation-id', grant: { id: 'grant-id' },
    }, 'DELIVERY_PAYLOAD_INVALID', { externalAttempted: false, now: new Date('2026-08-24T01:00:00.000Z') })
    assert.equal(result.status, 'FAILED')
    assert.equal(writes[0].params[0], 'AVAILABLE')
    assert.match(writes[0].sql, /reservation_task_id = NULL/)
  })

  it('pins an attempted grant to the same task until retry or terminal expiry', async () => {
    const lease = new Date('2026-08-24T01:02:00.000Z')
    const writes = []
    let read = 0
    const database = {
      transaction: async callback => callback({
        async one() {
          read += 1
          if (read === 1) {
            return {
              id: 'task-id', app_id: appId, status: 'PROCESSING', attempts: 2,
              lease_expires_at: lease,
            }
          }
          return {
            id: 'grant-id', status: 'RESERVED', reservation_task_id: 'task-id',
            reservation_token: 'reservation-id',
          }
        },
        async query(sql, params) {
          writes.push({ sql, params })
          return { affectedRows: 1 }
        },
      }),
    }
    const repository = createNotificationRepository(database)
    const result = await repository.failReservedTask({
      taskId: 'task-id', app_id: appId, leaseKey: lease.toISOString(), lease_expires_at: lease,
      reservationToken: 'reservation-id', grant: { id: 'grant-id' },
    }, 'WECHAT_DELIVERY_FAILED', { externalAttempted: true, now: new Date('2026-08-24T01:00:00.000Z') })
    assert.equal(result.status, 'FAILED')
    assert.equal(writes.length, 1)
    assert.match(writes[0].sql, /UPDATE mip_delivery_tasks/)
  })

  it('expires an attempted grant instead of releasing it after the final failure', async () => {
    const lease = new Date('2026-08-24T01:02:00.000Z')
    const writes = []
    let read = 0
    const database = {
      transaction: async callback => callback({
        async one() {
          read += 1
          if (read === 1) {
            return {
              id: 'task-id', app_id: appId, status: 'PROCESSING', attempts: 5,
              lease_expires_at: lease,
            }
          }
          return {
            id: 'grant-id', status: 'RESERVED', reservation_task_id: 'task-id',
            reservation_token: 'reservation-id',
          }
        },
        async query(sql, params) {
          writes.push({ sql, params })
          return { affectedRows: 1 }
        },
      }),
    }
    const repository = createNotificationRepository(database)
    const result = await repository.failReservedTask({
      taskId: 'task-id', app_id: appId, leaseKey: lease.toISOString(), lease_expires_at: lease,
      reservationToken: 'reservation-id', grant: { id: 'grant-id' },
    }, 'WECHAT_DELIVERY_FAILED', { externalAttempted: true, now: new Date('2026-08-24T01:00:00.000Z') })
    assert.equal(result.status, 'FAILED')
    assert.equal(writes[0].params[0], 'EXPIRED')
    assert.match(writes[1].sql, /UPDATE mip_delivery_tasks/)
  })

  it('reaps a crashed final attempt without making its reserved grant available', async () => {
    const now = new Date('2026-08-24T01:10:00.000Z')
    const writes = []
    const database = {
      transaction: async callback => callback({
        async one() { return null },
        async query(sql, params) {
          if (/SELECT id FROM mip_delivery_tasks/.test(sql) && /attempts >=/.test(sql)) {
            return [{ id: 'task-id' }]
          }
          if (/SELECT id FROM mip_delivery_tasks/.test(sql) && /attempts </.test(sql)) {
            return []
          }
          writes.push({ sql, params })
          return { affectedRows: 1 }
        },
      }),
    }
    const repository = createNotificationRepository(database)
    assert.deepEqual(await repository.leaseTasks(appId, 10, now), [])
    assert.match(writes[0].sql, /status = 'EXPIRED'/)
    assert.doesNotMatch(writes[0].sql, /status = 'AVAILABLE'/)
    assert.match(writes[1].sql, /status = 'FAILED'/)
    assert.match(writes[1].sql, /DELIVERY_OUTCOME_UNKNOWN/)
  })

  it('expires an unknown reservation when the final lease cannot be reserved', async () => {
    const lease = new Date('2026-08-24T01:02:00.000Z')
    const writes = []
    const database = {
      transaction: async callback => callback({
        async one() {
          return {
            id: 'task-id', app_id: appId, status: 'PROCESSING', attempts: 5,
            lease_expires_at: lease,
          }
        },
        async query(sql, params) {
          writes.push({ sql, params })
          return { affectedRows: 1 }
        },
      }),
    }
    const repository = createNotificationRepository(database)
    const result = await repository.failLeasedTask({
      id: 'task-id', app_id: appId, leaseKey: lease.toISOString(),
    }, 'DELIVERY_RESERVATION_LOST', new Date('2026-08-24T01:00:00.000Z'))
    assert.equal(result.status, 'FAILED')
    assert.match(writes[0].sql, /status = 'EXPIRED'/)
    assert.match(writes[1].sql, /status = \?/)
  })
})
