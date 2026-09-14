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
    repository => repository.markAllRead(appId, userId),
    repository => repository.markRead(appId, userId, messageId),
    repository => repository.createGrant({
      id: '30000000-0000-4000-8000-000000000001',
      appId,
      userId,
      templateKey: 'EVENT_REMINDER',
      recipientHash: 'hash',
      recipientCiphertext: Buffer.from('ciphertext'),
    }),
    repository => repository.createCustomerServiceGrant({
      id: '30000000-0000-4000-8000-000000000002',
      appId,
      userId,
      templateKey: 'CUSTOMER_SERVICE_TEXT',
      recipientHash: 'hash',
      recipientCiphertext: Buffer.from('ciphertext'),
      expiresAt: new Date('2026-08-26T00:00:00.000Z'),
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

test('inbox unread count excludes profile visitors', async () => {
  const repository = createNotificationsRepository({
    async query() { return [] },
    async one(sql, params) {
      assert.doesNotMatch(sql, /mip_profile_visits/)
      assert.match(sql, /FROM mip_inbox_messages[\s\S]*read_at IS NULL/)
      assert.deepEqual(params, [appId, userId])
      return { count: 0 }
    },
  })
  assert.equal((await repository.listInbox(appId, userId)).unreadCount, 0)
})

test('bulk read scopes all unread pages to the active caller and preserves existing read times', async () => {
  const calls = []
  const readAt = new Date('2026-09-14T01:00:00.000Z')
  const repository = createNotificationsRepository({
    async transaction(work) {
      return work({
        async one(sql) {
          return sql.includes('mip_users') ? { status: 'ACTIVE' } : { read_at: readAt }
        },
        async query(sql, params) { calls.push({ sql, params }) },
      })
    },
  })
  assert.deepEqual(await repository.markAllRead(appId, userId), { readAt: readAt.toISOString() })
  assert.equal(calls.length, 1)
  assert.match(calls[0].sql, /WHERE app_id = \? AND recipient_user_id = \? AND read_at IS NULL/)
  assert.doesNotMatch(calls[0].sql, /LIMIT|mip_profile_visits/)
  assert.deepEqual(calls[0].params, [readAt, appId, userId])
})
