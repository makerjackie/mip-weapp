'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const { createEventCatalogRepository } = require('../domain/repositories/event-catalogs')

const APP_ID = 'wx-event-catalog-repository'
const USER_ID = '11111111-1111-4111-8111-111111111111'
const CATALOG_ID = '22222222-2222-4222-8222-222222222222'
const EVENT_ID = '33333333-3333-4333-8333-333333333333'
const RECAP_ID = '44444444-4444-4444-8444-444444444444'
const NOW = new Date('2030-08-26T08:00:00.000Z')

function codeError(code) {
  return Object.assign(new Error(code), { code })
}

function dependencies(calls = []) {
  return {
    createId: () => RECAP_ID,
    async lockMutationAuthorization(tx, input) {
      calls.push({ type: 'reauthorize', tx, appId: input.appId })
      return input.authorization
    },
    assertMutationScope(authorization, scope) {
      calls.push({ type: 'scope', authorization, scope })
      if (scope.scopeType !== 'PLATFORM' || scope.scopeId !== null) throw codeError('FORBIDDEN')
    },
    async writeAudit(tx, audit) {
      calls.push({ type: 'audit', tx, audit })
    },
    repositorySupport: {
      codeError,
      escapeLike(value) { return value.replace(/[\\%_]/g, '\\$&') },
      iso(value) { return value ? new Date(value).toISOString() : null },
    },
  }
}

function recapRow(overrides = {}) {
  return {
    id: RECAP_ID,
    event_id: EVENT_ID,
    event_title: '城市交流会',
    title: '活动视频回顾',
    summary: '活动内容摘要',
    destination_provider: 'WECHAT_CHANNELS',
    destination_kind: 'ACTIVITY',
    finder_user_name: 'sph6Rngt56a0grn',
    feed_id: 'feed-token',
    sort_order: 10,
    status: 'INACTIVE',
    version: 5,
    activated_at: null,
    archived_at: null,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  }
}

function authorization() {
  return {
    capability: 'events.recaps.manage',
    effectiveGrant: { roleKey: 'PLATFORM_OPERATIONS', scopeType: 'PLATFORM', scopeId: null },
  }
}

describe('event catalog repository', () => {
  it('lists only AppID-scoped catalogs and strips internal cursor data', async () => {
    let query
    const database = {
      async query(sql, params) {
        query = { sql, params }
        return [{
          id: CATALOG_ID,
          catalog_key: 'workshop',
          name: '工作坊',
          description: '互动活动',
          sort_order: 10,
          status: 'ACTIVE',
          version: 2,
          usage_count: 3,
          archived_at: null,
          created_at: NOW,
          updated_at: NOW,
        }]
      },
    }
    const repository = createEventCatalogRepository(database, dependencies())
    const result = await repository.listEventCatalogs(APP_ID, 'TYPE', {
      status: '',
      query: 'work_%',
      cursor: null,
      cursorContext: { kind: 'TYPE', status: '-', query: 'work_%' },
    }, 20)

    assert.match(query.sql, /FROM mip_event_types catalog/)
    assert.match(query.sql, /catalog\.app_id = \?/)
    assert.deepEqual(query.params, [APP_ID, '%work\\_\\%%', '%work\\_\\%%', '%work\\_\\%%', 21])
    assert.deepEqual(result, {
      items: [{
        id: CATALOG_ID,
        kind: 'TYPE',
        key: 'workshop',
        name: '工作坊',
        description: '互动活动',
        sortOrder: 10,
        status: 'ACTIVE',
        usageCount: 3,
        version: 2,
        archivedAt: null,
        createdAt: NOW.toISOString(),
        updatedAt: NOW.toISOString(),
      }],
      nextCursor: null,
    })
    assert.equal(JSON.stringify(result).includes('cursorUpdatedAt'), false)
  })

  it('reauthorizes inside the transaction before locking, CAS updating, and auditing', async () => {
    const calls = []
    const tx = {
      async one(sql, params) {
        if (sql.includes('SELECT id FROM mip_events')) {
          calls.push({ type: 'event-read', sql, params })
          return { id: EVENT_ID }
        }
        if (sql.includes('FOR UPDATE')) {
          calls.push({ type: 'resource-lock', sql, params })
          return { id: RECAP_ID, status: 'INACTIVE', version: 4 }
        }
        calls.push({ type: 'result-read', sql, params })
        return recapRow()
      },
      async query(sql, params) {
        calls.push({ type: 'update', sql, params })
        return { affectedRows: 1 }
      },
    }
    const database = { async transaction(work) { return work(tx) } }
    const repository = createEventCatalogRepository(database, dependencies(calls))
    const result = await repository.saveEventVideoRecap({
      appId: APP_ID,
      actorUserId: USER_ID,
      recapId: RECAP_ID,
      expectedVersion: 4,
      eventId: EVENT_ID,
      title: '活动视频回顾',
      summary: '活动内容摘要',
      destination: {
        provider: 'WECHAT_CHANNELS', type: 'ACTIVITY',
        finderUserName: 'sph6Rngt56a0grn', feedId: 'feed-token',
      },
      sortOrder: 10,
      authorization: authorization(),
      audit: id => ({ resourceId: id, metadata: { destinationType: 'ACTIVITY' } }),
    })

    assert.deepEqual(calls.map(call => call.type), [
      'reauthorize', 'scope', 'event-read', 'resource-lock', 'update', 'audit', 'result-read',
    ])
    assert.deepEqual(calls[1].scope, { scopeType: 'PLATFORM', scopeId: null })
    assert.deepEqual(calls[2].params, [APP_ID, EVENT_ID])
    assert.deepEqual(calls[3].params, [APP_ID, RECAP_ID])
    assert.match(calls[4].sql, /version = version \+ 1/)
    assert.match(calls[4].sql, /app_id = \? AND id = \? AND version = \? AND status <> 'ARCHIVED'/)
    assert.equal(calls[4].params.includes(APP_ID), true)
    assert.equal(calls[4].params.includes(4), true)
    assert.equal(calls[5].audit.resourceId, RECAP_ID)
    assert.equal(result.id, RECAP_ID)
    assert.equal(result.version, 5)
  })

  it('fails closed on stale versions and terminal archives before any write or audit', async () => {
    for (const current of [
      { id: RECAP_ID, status: 'INACTIVE', version: 5, code: 'CONFLICT' },
      { id: RECAP_ID, status: 'ARCHIVED', version: 4, code: 'INVALID_STATE' },
    ]) {
      const calls = []
      const tx = {
        async one(sql) {
          calls.push(sql.includes('FOR UPDATE') ? { type: 'resource-lock' } : { type: 'unexpected-read' })
          return current
        },
        async query() {
          calls.push({ type: 'write' })
          return { affectedRows: 1 }
        },
      }
      const database = { async transaction(work) { return work(tx) } }
      const repository = createEventCatalogRepository(database, dependencies(calls))

      await assert.rejects(() => repository.archiveEventVideoRecap({
        appId: APP_ID,
        actorUserId: USER_ID,
        recapId: RECAP_ID,
        expectedVersion: 4,
        authorization: authorization(),
        audit: () => ({ resourceId: RECAP_ID }),
      }), error => error?.code === current.code)
      assert.deepEqual(calls.map(call => call.type), ['reauthorize', 'scope', 'resource-lock'])
    }
  })
})
