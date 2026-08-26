'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const { createEventCatalogRepository } = require('../domain/repositories/event-catalogs')

const APP_ID = 'wx-event-catalog-repository'
const USER_ID = '11111111-1111-4111-8111-111111111111'
const CATALOG_ID = '22222222-2222-4222-8222-222222222222'
const EVENT_ID = '33333333-3333-4333-8333-333333333333'
const RECAP_ID = '44444444-4444-4444-8444-444444444444'
const TAG_A_ID = '55555555-5555-4555-8555-555555555555'
const TAG_B_ID = '66666666-6666-4666-8666-666666666666'
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

function tagAuthorization() {
  return {
    capability: 'events.catalog.manage',
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

  it('reads AppID-scoped tag options without exposing assignment actors', async () => {
    const calls = []
    const database = {
      async one(sql, params) {
        calls.push({ type: 'event', sql, params })
        return { id: EVENT_ID, version: 4 }
      },
      async query(sql, params) {
        calls.push({ type: 'tags', sql, params })
        return [{
          id: TAG_A_ID,
          tag_key: 'networking',
          name: '商务交流',
          description: '交流类活动',
          sort_order: 10,
          catalog_status: 'ACTIVE',
          assignment_selected: 1,
          assignment_version: 3,
          assigned_by_user_id: USER_ID,
        }]
      },
    }
    const repository = createEventCatalogRepository(database, dependencies())
    const result = await repository.getEventTagAssignments(APP_ID, EVENT_ID)

    assert.deepEqual(calls[0].params, [APP_ID, EVENT_ID])
    assert.match(calls[1].sql, /assignment\.event_id = \?/)
    assert.match(calls[1].sql, /tag\.app_id = \?/)
    assert.deepEqual(calls[1].params, [EVENT_ID, APP_ID])
    assert.deepEqual(result, {
      eventId: EVENT_ID,
      eventVersion: 4,
      tags: [{
        id: TAG_A_ID,
        key: 'networking',
        name: '商务交流',
        description: '交流类活动',
        sortOrder: 10,
        catalogStatus: 'ACTIVE',
        selectable: true,
        selected: true,
        assignmentVersion: 3,
      }],
    })
    assert.doesNotMatch(JSON.stringify(result), /assignedBy|removedBy|userId/i)
  })

  it('replaces tag assignments with event CAS, soft history, and stable-key audit', async () => {
    const calls = []
    const tx = {
      async one(sql, params) {
        calls.push({ type: sql.includes('FOR UPDATE') ? 'event-lock' : 'event-read', sql, params })
        return sql.includes('FOR UPDATE')
          ? { id: EVENT_ID, status: 'DRAFT', version: 4 }
          : { id: EVENT_ID, version: 5 }
      },
      async query(sql, params) {
        if (sql.includes('FROM mip_event_tag_assignments assignment')) {
          calls.push({ type: 'current-tags', sql, params })
          return [{ tag_id: TAG_A_ID, tag_key: 'legacy' }]
        }
        if (sql.includes('FROM mip_event_tags') && sql.includes('FOR UPDATE')) {
          calls.push({ type: 'selected-tags', sql, params })
          return [{ id: TAG_B_ID, tag_key: 'roundtable', status: 'ACTIVE' }]
        }
        if (sql.includes('FROM mip_event_tags tag')) {
          calls.push({ type: 'result-tags', sql, params })
          return [{
            id: TAG_B_ID,
            tag_key: 'roundtable',
            name: '圆桌交流',
            description: '',
            sort_order: 20,
            catalog_status: 'ACTIVE',
            assignment_selected: 1,
            assignment_version: 1,
          }]
        }
        const type = sql.includes('UPDATE mip_events')
          ? 'event-cas'
          : sql.includes('UPDATE mip_event_tag_assignments')
            ? 'soft-remove'
            : sql.includes('INSERT INTO mip_event_tag_assignments')
              ? 'upsert'
              : sql.includes('INSERT INTO mip_event_changes')
                ? 'event-change'
                : 'write'
        calls.push({ type, sql, params })
        return { affectedRows: 1 }
      },
    }
    const database = { async transaction(work) { return work(tx) } }
    const repository = createEventCatalogRepository(database, dependencies(calls))
    const result = await repository.replaceEventTagAssignments({
      appId: APP_ID,
      actorUserId: USER_ID,
      eventId: EVENT_ID,
      expectedVersion: 4,
      tagIds: [TAG_B_ID],
      authorization: tagAuthorization(),
      audit: (eventId, change) => ({ resourceId: eventId, metadata: change }),
    })

    assert.deepEqual(calls.map(call => call.type), [
      'reauthorize', 'scope', 'event-lock', 'current-tags', 'selected-tags',
      'event-cas', 'soft-remove', 'upsert', 'event-change', 'audit',
      'event-read', 'result-tags',
    ])
    assert.match(calls.find(call => call.type === 'soft-remove').sql, /status = 'INACTIVE'/)
    assert.doesNotMatch(calls.find(call => call.type === 'soft-remove').sql, /DELETE/i)
    const upsert = calls.find(call => call.type === 'upsert')
    assert.match(upsert.sql, /ON DUPLICATE KEY UPDATE/)
    assert.match(calls.find(call => call.type === 'event-cas').sql, /status IN \(\?, \?, \?\)/)
    assert.deepEqual(calls.find(call => call.type === 'event-cas').params, [
      APP_ID, EVENT_ID, 4, 'DRAFT', 'PUBLISHED', 'UNPUBLISHED',
    ])
    const eventChange = calls.find(call => call.type === 'event-change')
    assert.match(eventChange.sql, /mip_event_changes/)
    assert.deepEqual(eventChange.params, [
      RECAP_ID,
      APP_ID,
      EVENT_ID,
      5,
      '活动标签已更新',
      JSON.stringify(['tags']),
      USER_ID,
    ])
    assert.deepEqual(calls.find(call => call.type === 'audit').audit.metadata, {
      addedTagKeys: ['roundtable'],
      removedTagKeys: ['legacy'],
    })
    assert.equal(result.eventVersion, 5)
    assert.equal(result.idempotent, false)
    assert.equal(result.tags[0].selected, true)
  })

  it('reactivates a soft-removed assignment with a new actor and cleared removal state', async () => {
    const calls = []
    const tx = {
      async one(sql, params) {
        calls.push({ type: sql.includes('FOR UPDATE') ? 'event-lock' : 'event-read', sql, params })
        return sql.includes('FOR UPDATE')
          ? { id: EVENT_ID, status: 'PUBLISHED', version: 4 }
          : { id: EVENT_ID, version: 5 }
      },
      async query(sql, params) {
        if (sql.includes('FROM mip_event_tag_assignments assignment')) {
          calls.push({ type: 'current-tags', sql, params })
          return []
        }
        if (sql.includes('FROM mip_event_tags') && sql.includes('FOR UPDATE')) {
          calls.push({ type: 'selected-tags', sql, params })
          return [{ id: TAG_B_ID, tag_key: 'roundtable', status: 'ACTIVE' }]
        }
        if (sql.includes('FROM mip_event_tags tag')) {
          calls.push({ type: 'result-tags', sql, params })
          return [{
            id: TAG_B_ID,
            tag_key: 'roundtable',
            name: '圆桌交流',
            description: '',
            sort_order: 20,
            catalog_status: 'ACTIVE',
            assignment_selected: 1,
            assignment_version: 4,
          }]
        }
        const type = sql.includes('UPDATE mip_events')
          ? 'event-cas'
          : sql.includes('INSERT INTO mip_event_tag_assignments')
            ? 'upsert'
            : sql.includes('INSERT INTO mip_event_changes')
              ? 'event-change'
              : 'unexpected-write'
        calls.push({ type, sql, params })
        return { affectedRows: 1 }
      },
    }
    const database = { async transaction(work) { return work(tx) } }
    const repository = createEventCatalogRepository(database, dependencies(calls))

    const result = await repository.replaceEventTagAssignments({
      appId: APP_ID,
      actorUserId: USER_ID,
      eventId: EVENT_ID,
      expectedVersion: 4,
      tagIds: [TAG_B_ID],
      authorization: tagAuthorization(),
      audit: (eventId, change) => ({ resourceId: eventId, metadata: change }),
    })

    const upsert = calls.find(call => call.type === 'upsert')
    assert.match(upsert.sql, /status = 'ACTIVE', version = version \+ 1/)
    assert.match(upsert.sql, /assigned_by_user_id = VALUES\(assigned_by_user_id\)/)
    assert.match(upsert.sql, /removed_by_user_id = NULL/)
    assert.match(upsert.sql, /assigned_at = UTC_TIMESTAMP\(3\), removed_at = NULL/)
    assert.deepEqual(upsert.params, [APP_ID, EVENT_ID, TAG_B_ID, USER_ID])
    assert.deepEqual(calls.find(call => call.type === 'audit').audit.metadata, {
      addedTagKeys: ['roundtable'],
      removedTagKeys: [],
    })
    assert.equal(calls.some(call => call.type === 'unexpected-write'), false)
    assert.equal(result.eventVersion, 5)
    assert.equal(result.idempotent, false)
  })

  it('keeps the event version and audit log unchanged for an identical selection', async () => {
    const calls = []
    const tx = {
      async one(sql, params) {
        calls.push({ type: sql.includes('FOR UPDATE') ? 'event-lock' : 'event-read', sql, params })
        return { id: EVENT_ID, status: 'DRAFT', version: 4 }
      },
      async query(sql, params) {
        if (sql.includes('FROM mip_event_tag_assignments assignment')) {
          calls.push({ type: 'current-tags', sql, params })
          return [{ tag_id: TAG_A_ID, tag_key: 'networking' }]
        }
        if (sql.includes('FROM mip_event_tags') && sql.includes('FOR UPDATE')) {
          calls.push({ type: 'selected-tags', sql, params })
          return [{ id: TAG_A_ID, tag_key: 'networking', status: 'ACTIVE' }]
        }
        if (sql.includes('FROM mip_event_tags tag')) {
          calls.push({ type: 'result-tags', sql, params })
          return [{
            id: TAG_A_ID,
            tag_key: 'networking',
            name: '商务交流',
            description: '',
            sort_order: 10,
            catalog_status: 'ACTIVE',
            assignment_selected: 1,
            assignment_version: 3,
          }]
        }
        calls.push({ type: 'write', sql, params })
        return { affectedRows: 1 }
      },
    }
    const database = { async transaction(work) { return work(tx) } }
    const repository = createEventCatalogRepository(database, dependencies(calls))
    const result = await repository.replaceEventTagAssignments({
      appId: APP_ID,
      actorUserId: USER_ID,
      eventId: EVENT_ID,
      expectedVersion: 4,
      tagIds: [TAG_A_ID],
      authorization: tagAuthorization(),
      audit: () => ({ resourceId: EVENT_ID }),
    })

    assert.deepEqual(calls.map(call => call.type), [
      'reauthorize', 'scope', 'event-lock', 'current-tags', 'selected-tags',
      'event-read', 'result-tags',
    ])
    assert.equal(result.eventVersion, 4)
    assert.equal(result.idempotent, true)
  })

  it('rejects stale events and non-active selected tags before writes', async () => {
    for (const scenario of [
      { event: { id: EVENT_ID, status: 'DRAFT', version: 5 }, selected: [], code: 'CONFLICT' },
      {
        event: { id: EVENT_ID, status: 'DRAFT', version: 4 },
        selected: [{ id: TAG_B_ID, tag_key: 'retired', status: 'INACTIVE' }],
        code: 'CONFLICT',
      },
    ]) {
      const calls = []
      const tx = {
        async one() {
          calls.push('event-lock')
          return scenario.event
        },
        async query(sql) {
          if (sql.includes('FROM mip_event_tag_assignments assignment')) {
            calls.push('current-tags')
            return []
          }
          if (sql.includes('FROM mip_event_tags') && sql.includes('FOR UPDATE')) {
            calls.push('selected-tags')
            return scenario.selected
          }
          calls.push('write')
          return { affectedRows: 1 }
        },
      }
      const database = { async transaction(work) { return work(tx) } }
      const repository = createEventCatalogRepository(database, dependencies())

      await assert.rejects(() => repository.replaceEventTagAssignments({
        appId: APP_ID,
        actorUserId: USER_ID,
        eventId: EVENT_ID,
        expectedVersion: 4,
        tagIds: [TAG_B_ID],
        authorization: tagAuthorization(),
        audit: () => ({}),
      }), error => error?.code === scenario.code)
      assert.equal(calls.includes('write'), false)
    }
  })

  it('rejects cancelled and ended events before any assignment, version, change, or audit write', async () => {
    for (const status of ['CANCELLED', 'ENDED']) {
      const calls = []
      const tx = {
        async one(sql, params) {
          calls.push({ type: 'event-lock', sql, params })
          return { id: EVENT_ID, status, version: 4 }
        },
        async query(sql, params) {
          calls.push({ type: 'unexpected-query', sql, params })
          return { affectedRows: 1 }
        },
      }
      const database = { async transaction(work) { return work(tx) } }
      const repository = createEventCatalogRepository(database, dependencies(calls))

      await assert.rejects(() => repository.replaceEventTagAssignments({
        appId: APP_ID,
        actorUserId: USER_ID,
        eventId: EVENT_ID,
        expectedVersion: 4,
        tagIds: [TAG_B_ID],
        authorization: tagAuthorization(),
        audit: () => ({ resourceId: EVENT_ID }),
      }), error => error?.code === 'INVALID_STATE')

      assert.deepEqual(calls.map(call => call.type), [
        'reauthorize', 'scope', 'event-lock',
      ])
      assert.deepEqual(calls[2].params, [APP_ID, EVENT_ID])
    }
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
