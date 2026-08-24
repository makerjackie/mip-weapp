'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const { createNotificationsRepository } = require('../domain/repository')

const appId = 'wx-app'
const userId = '10000000-0000-4000-8000-000000000001'
const messageId = '20000000-0000-4000-8000-000000000001'

test('scopes inbox reads and unread count to the trusted app and user', async () => {
  const calls = []
  const repository = createNotificationsRepository({
    async query(sql, params) {
      calls.push({ sql, params })
      return []
    },
    async one(sql, params) {
      calls.push({ sql, params })
      return { count: 0 }
    },
  })
  assert.deepEqual(await repository.listInbox(appId, userId), {
    items: [],
    unreadCount: 0,
    nextCursor: undefined,
  })
  for (const call of calls) {
    assert.match(call.sql, /app_id = \? AND recipient_user_id = \?/)
    assert.deepEqual(call.params.slice(0, 2), [appId, userId])
  }
})

test('marks only the trusted user message as read', async () => {
  const calls = []
  const repository = createNotificationsRepository({
    async transaction(work) {
      return work({
        async query(sql, params) {
          calls.push({ sql, params })
          return { affectedRows: 1 }
        },
        async one(sql, params) {
          calls.push({ sql, params })
          if (sql.includes('FROM mip_users')) return { id: userId, status: 'ACTIVE' }
          return { id: messageId, read_at: new Date('2026-08-24T00:00:00.000Z') }
        },
      })
    },
  })
  assert.deepEqual(await repository.markRead(appId, userId, messageId), {
    messageId,
    readAt: '2026-08-24T00:00:00.000Z',
  })
  assert.match(calls[0].sql, /SELECT id, status FROM mip_users[\s\S]*FOR UPDATE/)
  assert.deepEqual(calls[0].params, [appId, userId])
  for (const call of calls.slice(1)) {
    assert.deepEqual(call.params, [appId, userId, messageId])
  }
})

test('rejects notification writes for closed callers before changing user data', async () => {
  const operations = [
    repository => repository.markRead(appId, userId, messageId),
    repository => repository.createGrant({
      id: '30000000-0000-4000-8000-000000000001',
      appId,
      userId,
      templateKey: 'EVENT_REMINDER',
      recipientHash: 'hash',
      recipientCiphertext: Buffer.from('ciphertext'),
    }),
    repository => repository.revokeGrants(appId, userId, 'EVENT_REMINDER'),
  ]
  for (const operation of operations) {
    const reads = []
    const writes = []
    const repository = createNotificationsRepository({
      async transaction(work) {
        return work({
          async one(sql, params) {
            reads.push({ sql, params })
            return { id: userId, status: 'CLOSED' }
          },
          async query(sql, params) {
            writes.push({ sql, params })
            return { affectedRows: 1 }
          },
        })
      },
    })
    await assert.rejects(operation(repository), /FORBIDDEN/)
    assert.equal(reads.length, 1)
    assert.match(reads[0].sql, /SELECT id, status FROM mip_users[\s\S]*FOR UPDATE/)
    assert.deepEqual(reads[0].params, [appId, userId])
    assert.equal(writes.length, 0)
  }
})
