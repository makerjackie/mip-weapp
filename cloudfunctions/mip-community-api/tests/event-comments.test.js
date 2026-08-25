'use strict'

const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const { describe, it } = require('node:test')
const { createEventCommentsService, visibleEvent } = require('../domain/event-comments')
const { createProfileRef } = require('../lib/profile-ref')

const appId = 'wx-event-comments'
const userId = '10000000-0000-4000-8000-000000000001'
const authorId = '20000000-0000-4000-8000-000000000002'
const eventId = '30000000-0000-4000-8000-000000000003'
const commentId = '40000000-0000-4000-8000-000000000004'
const pepper = 'event-comment-profile-ref-pepper-over-32'
const caller = { appId, userId, primaryBranchId: 'branch-1' }
const agreements = [{ key: 'SERVICE_AGREEMENT', version: 'service-v2' }]

function eventRow(overrides = {}) {
  return {
    id: eventId,
    title: '2030 城市交流活动',
    status: 'PUBLISHED',
    published_at: '2026-08-25T00:00:00.000Z',
    comments_enabled: 1,
    moderation_mode: 'AUTO',
    settings_version: 2,
    ...overrides,
  }
}

function service(database, options = {}) {
  return createEventCommentsService(database, {
    agreementRequirements: agreements,
    assertReady: options.assertReady || (async () => undefined),
    assertSafe: options.assertSafe || (async () => undefined),
    createProfileRef,
    id: options.id || (() => commentId),
    profileRefSecret: pepper,
  })
}

function mutationDatabase({ stored, event = eventRow(), updateAffectedRows = 1 } = {}) {
  const reads = []
  const writes = []
  const tx = {
    async one(sql, params) {
      reads.push({ sql, params })
      if (sql.includes('mip_idempotency_keys')) return null
      if (sql.includes('FROM mip_events')) return event
      if (sql.includes('FROM mip_content_comments')) return stored
      throw new Error(`unexpected query: ${sql}`)
    },
    async query(sql, params) {
      writes.push({ sql, params })
      return { affectedRows: sql.includes('UPDATE mip_content_comments') ? updateAffectedRows : 1 }
    },
  }
  return {
    database: {
      async one() { return null },
      async transaction(work) { return work(tx) },
    },
    tx,
    reads,
    writes,
  }
}

describe('event comment service', () => {
  it('lists a server-visible event with cursor pagination and mutual block filtering', async () => {
    const calls = []
    const database = {
      async one(sql, params) {
        calls.push({ sql, params })
        return eventRow()
      },
      async query(sql, params) {
        calls.push({ sql, params })
        return [
          {
            id: commentId,
            author_user_id: userId,
            body: '活动组织清晰。',
            status: 'PUBLISHED',
            version: 2,
            created_at: '2026-08-25T08:00:00.000Z',
            edited_at: null,
            nickname: '当前用户',
            headline: '产品经理',
            visibility_json: '{}',
            avatar_file_id: null,
            within_edit_window: 1,
          },
          {
            id: '50000000-0000-4000-8000-000000000005',
            author_user_id: authorId,
            body: '期待下一场。',
            status: 'PUBLISHED',
            version: 1,
            created_at: '2026-08-25T07:00:00.000Z',
            edited_at: null,
            nickname: '另一位用户',
            headline: '',
            visibility_json: '{}',
            avatar_file_id: null,
            within_edit_window: 0,
          },
          {
            id: '60000000-0000-4000-8000-000000000006',
            author_user_id: authorId,
            body: '下一页',
            status: 'PUBLISHED',
            version: 1,
            created_at: '2026-08-25T06:00:00.000Z',
            visibility_json: '{}',
            within_edit_window: 0,
          },
        ]
      },
    }
    const result = await service(database).listEventComments(caller, { eventId, limit: 2 })
    assert.equal(result.items.length, 2)
    assert.equal(result.items[0].mine, true)
    assert.equal(result.items[0].canEdit, true)
    assert.match(result.items[0].author.profileRef, /^p1\./)
    assert.equal(result.nextCursor.length > 12, true)
    assert.equal(JSON.stringify(result).includes(authorId), false)
    assert.match(calls[0].sql, /event\.status = 'PUBLISHED'/)
    assert.match(calls[0].sql, /event\.published_at IS NOT NULL[\s\S]*'CANCELLED', 'ENDED'/)
    assert.deepEqual(calls[0].params, [appId, eventId])
    assert.match(calls[1].sql, /target_type = 'EVENT'/)
    assert.match(calls[1].sql, /mip_user_blocks/)
    assert.match(calls[1].sql, /blocker_user_id = \?[\s\S]*blocked_user_id = comment\.author_user_id/)
    assert.deepEqual(calls[1].params, [appId, eventId, userId, userId, userId])
  })

  it('rejects a cancelled or ended event unless it has a server-side published fact', async () => {
    const calls = []
    await assert.rejects(visibleEvent({
      async one(sql, params) {
        calls.push({ sql, params })
        return null
      },
    }, appId, eventId), /EVENT_NOT_FOUND/)
    assert.match(calls[0].sql, /published_at IS NOT NULL/)
    assert.match(calls[0].sql, /status IN \('CANCELLED', 'ENDED'\)/)
    assert.deepEqual(calls[0].params, [appId, eventId])
  })

  it('creates a safe comment after current access and event settings are rechecked', async () => {
    const order = []
    const { database, writes } = mutationDatabase()
    const result = await service(database, {
      async assertReady(_tx, current, requirements) {
        order.push('access')
        assert.equal(current, caller)
        assert.deepEqual(requirements, agreements)
      },
      async assertSafe(current, body) {
        order.push('safety')
        assert.equal(current, caller)
        assert.equal(body, '活动信息明确。')
      },
    }).saveEventComment(caller, {
      eventId,
      body: ' 活动信息明确。 ',
      idempotencyKey: 'event-comment-create-0001',
    })
    assert.deepEqual(result, { id: commentId, status: 'PUBLISHED', version: 1 })
    assert.deepEqual(order, ['access', 'safety', 'access'])
    assert.match(writes[0].sql, /INSERT INTO mip_idempotency_keys/)
    assert.match(writes[1].sql, /INSERT INTO mip_content_comments/)
    assert.match(writes[1].sql, /'EVENT'/)
    assert.deepEqual(writes[1].params.slice(0, 5), [commentId, appId, eventId, userId, '活动信息明确。'])
  })

  it('replays an existing successful create before content safety and current access checks', async () => {
    const request = {
      eventId,
      commentId: null,
      expectedVersion: null,
      body: '活动信息明确。',
    }
    const requestHash = createHash('sha256').update(JSON.stringify(request)).digest('hex')
    const database = {
      async one() {
        return {
          request_hash: requestHash,
          status: 'COMPLETED',
          response_json: JSON.stringify({ id: commentId, status: 'PUBLISHED', version: 1 }),
        }
      },
      async transaction() { assert.fail('completed replay opened a mutation transaction') },
    }
    const result = await service(database, {
      async assertReady() { assert.fail('completed replay rechecked access') },
      async assertSafe() { assert.fail('completed replay rechecked content safety') },
    }).saveEventComment(caller, {
      eventId,
      body: request.body,
      idempotencyKey: 'event-comment-create-0002',
    })
    assert.deepEqual(result, { id: commentId, status: 'PUBLISHED', version: 1 })
  })

  it('does not call content safety before an unauthorized caller is rejected', async () => {
    const database = {
      async one() { return null },
      async transaction() { assert.fail('unauthorized request opened a mutation transaction') },
    }
    await assert.rejects(service(database, {
      async assertReady() { throw new Error('PHONE_REQUIRED') },
      async assertSafe() { assert.fail('unauthorized request consumed content safety') },
    }).saveEventComment(caller, {
      eventId,
      body: '活动信息明确。',
      idempotencyKey: 'event-comment-create-unauthorized',
    }), /PHONE_REQUIRED/)
  })

  it('converges a concurrent first-write duplicate to the committed replay', async () => {
    const request = {
      eventId,
      commentId: null,
      expectedVersion: null,
      body: '活动信息明确。',
    }
    const requestHash = createHash('sha256').update(JSON.stringify(request)).digest('hex')
    let readCount = 0
    const database = {
      async one() {
        readCount += 1
        return readCount === 1
          ? null
          : {
              request_hash: requestHash,
              status: 'COMPLETED',
              response_json: JSON.stringify({ id: commentId, status: 'PUBLISHED', version: 1 }),
            }
      },
      async transaction(work) {
        return work({
          async one() { return null },
          async query(sql) {
            assert.match(sql, /INSERT INTO mip_idempotency_keys/)
            const error = new Error('duplicate')
            error.code = 'ER_DUP_ENTRY'
            throw error
          },
        })
      },
    }
    const result = await service(database).saveEventComment(caller, {
      eventId,
      body: request.body,
      idempotencyKey: 'event-comment-create-concurrent',
    })
    assert.deepEqual(result, { id: commentId, status: 'PUBLISHED', version: 1 })
    assert.equal(readCount, 2)
  })

  it('edits only an owned current-version comment inside the 30 minute window', async () => {
    const { database, writes } = mutationDatabase({
      stored: { author_user_id: userId, status: 'PUBLISHED', version: 3 },
    })
    const result = await service(database).saveEventComment(caller, {
      eventId,
      commentId,
      expectedVersion: 3,
      body: '更新后的评论',
      idempotencyKey: 'event-comment-edit-0001',
    })
    assert.deepEqual(result, { id: commentId, status: 'PUBLISHED', version: 4 })
    const update = writes.find(item => item.sql.includes('UPDATE mip_content_comments'))
    assert.match(update.sql, /target_type = 'EVENT'/)
    assert.match(update.sql, /target_id = \?/)
    assert.match(update.sql, /INTERVAL 30 MINUTE/)
    assert.deepEqual(update.params, ['更新后的评论', appId, commentId, eventId, 3])
  })

  it('soft deletes only the event-scoped owner version after current access is rechecked', async () => {
    const order = []
    const { database, writes } = mutationDatabase({
      stored: { author_user_id: userId, status: 'PUBLISHED', version: 2 },
    })
    const result = await service(database, {
      async assertReady() { order.push('access') },
    }).deleteEventComment(caller, {
      eventId,
      commentId,
      expectedVersion: 2,
      idempotencyKey: 'event-comment-delete-0001',
    })
    assert.deepEqual(result, { id: commentId, status: 'DELETED', version: 3 })
    assert.deepEqual(order, ['access', 'access'])
    const update = writes.find(item => item.sql.includes('UPDATE mip_content_comments'))
    assert.match(update.sql, /status = 'DELETED'/)
    assert.match(update.sql, /body = '\[已删除\]'/)
    assert.match(update.sql, /target_type = 'EVENT'/)
    assert.deepEqual(update.params, [appId, commentId, eventId, 2])
  })

  it('reports only a visible unblocked event comment without returning user identifiers', async () => {
    const { database, reads, writes } = mutationDatabase({
      stored: { author_user_id: authorId, status: 'PUBLISHED', version: 4 },
    })
    const result = await service(database).reportEventComment(caller, {
      eventId,
      commentId,
      expectedVersion: 4,
      category: 'SPAM',
      requestId: 'event-comment-report-request-0001',
      idempotencyKey: 'event-comment-report-0001',
    })
    assert.deepEqual(result, { reportId: commentId, status: 'PENDING' })
    assert.equal(JSON.stringify(result).includes(authorId), false)
    const reportRead = reads.find(item => item.sql.includes('FROM mip_content_comments comment'))
    assert.match(reportRead.sql, /mip_user_blocks/)
    assert.deepEqual(reportRead.params, [appId, commentId, eventId, userId, userId])
    const insert = writes.find(item => item.sql.includes('INSERT INTO mip_content_comment_reports'))
    assert.deepEqual(insert.params, [commentId, appId, commentId, userId, 'SPAM', null, 'event-comment-report-request-0001'])
    assert.match(insert.sql, /mip_content_comment_reports/)
  })
})
