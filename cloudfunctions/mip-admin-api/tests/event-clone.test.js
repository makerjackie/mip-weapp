'use strict'

const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const { describe, it } = require('node:test')
const { createAdminRepository: createProductionAdminRepository } = require('../domain/repository')
const { withTestAuthorization } = require('./test-authorization')

function createAdminRepository(database, options) {
  return createProductionAdminRepository(database, withTestAuthorization(options))
}

function sourceEvent() {
  return {
    id: 'event-source',
    scope_type: 'BRANCH',
    branch_id: 'branch-a',
    title: '周末交流会',
    summary: '活动摘要',
    description: '活动介绍',
    notices: '参与须知',
    cover_asset_id: 'cover-a',
    cover_status: 'READY',
    event_type_key: 'general',
    event_mode: 'HYBRID',
    access_type: 'FREE',
    registration_policy: 'APPROVAL',
    album_enabled: 1,
    album_submission_policy: 'REVIEW',
    starts_at: new Date('2026-08-01T06:00:00.000Z'),
    ends_at: new Date('2026-08-01T08:00:00.000Z'),
    registration_opens_at: new Date('2026-07-01T00:00:00.000Z'),
    registration_deadline: new Date('2026-07-31T06:00:00.000Z'),
    cancellation_deadline: new Date('2026-07-30T06:00:00.000Z'),
    venue_name: '活动空间',
    address: '详细地址',
    city_name: '广州',
    latitude: '23.1234567',
    longitude: '113.1234567',
    online_url: 'https://example.test/event',
    capacity: 80,
    waitlist_enabled: 1,
    price_cents: 0,
    currency: 'CNY',
    registration_schema_json: JSON.stringify([{ key: 'company', type: 'TEXT' }]),
    version: 4,
    branch_status: 'ACTIVE',
  }
}

function input() {
  return {
    appId: 'wx-app',
    actorUserId: 'admin-user',
    sourceEventId: 'event-source',
    expectedVersion: 4,
    idempotencyKey: 'clone-request-0001',
    title: '周末交流会（副本）',
    contentSafetyStatus: 'PASSED',
    audit: eventId => ({
      appId: 'wx-app', actorUserId: 'admin-user', scopeType: 'EVENT', scopeId: eventId,
      action: 'admin.events.clone', resourceType: 'EVENT', resourceId: eventId,
      effectiveRole: 'PLATFORM_OWNER', metadata: { sourceEventId: 'event-source', sourceVersion: 4 },
    }),
  }
}

describe('admin event clone persistence', () => {
  it('creates an independent draft and shifts only reusable event definition dates', async () => {
    const calls = []
    let sequence = 0
    const query = async (sql, params) => {
      calls.push({ sql, params })
      return { affectedRows: 1 }
    }
    const one = async (sql) => sql.includes('FROM mip_events e') ? sourceEvent() : null
    const repository = createAdminRepository({
      one,
      query,
      transaction: work => work({ one, query }),
    }, {
      id: () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}`,
      now: () => new Date('2026-08-24T00:00:00.000Z'),
    })

    const result = await repository.cloneEvent(input())

    assert.equal(result.status, 'DRAFT')
    assert.equal(result.version, 1)
    assert.equal(result.idempotent, false)
    assert.equal(result.startsAt, '2026-09-05T06:00:00.000Z')
    const insert = calls.find(call => call.sql.includes('INSERT INTO mip_events'))
    assert.ok(insert)
    assert.equal(insert.params[4], 'admin-user')
    assert.equal(insert.params[5], '周末交流会（副本）')
    assert.equal(insert.params[9], 'cover-a')
    assert.equal(insert.params[14], 1)
    assert.equal(insert.params[15], 'REVIEW')
    assert.equal(insert.params[16], 'PASSED')
    assert.equal(insert.params[17].toISOString(), '2026-09-05T06:00:00.000Z')
    assert.equal(insert.params[18].toISOString(), '2026-09-05T08:00:00.000Z')
    assert.equal(insert.params[20].toISOString(), '2026-09-04T06:00:00.000Z')
    assert.equal(insert.params[32], JSON.stringify([{ key: 'company', type: 'TEXT' }]))
    assert.ok(calls.some(call => call.sql.includes('INSERT INTO mip_event_changes')))
    assert.ok(calls.some(call => call.sql.includes('INSERT INTO mip_audit_logs')))
    assert.ok(calls.some(call => call.sql.includes('INSERT INTO mip_outbox_events')))
    assert.ok(calls.some(call => call.sql.includes("status = 'COMPLETED'")))
    const source = calls.map(call => call.sql).join('\n')
    assert.doesNotMatch(source, /INSERT INTO mip_event_registrations/)
    assert.doesNotMatch(source, /INSERT INTO mip_orders/)
    assert.doesNotMatch(source, /INSERT INTO mip_event_(?:album|photos)/)
  })

  it('replays a completed clone request after the source version changes', async () => {
    const stored = {
      id: 'new-event', status: 'DRAFT', version: 1,
      startsAt: '2026-09-05T06:00:00.000Z', idempotent: false,
    }
    let queriedSource = false
    const query = async (sql) => {
      if (sql.includes('INSERT INTO mip_idempotency_keys')) {
        const error = new Error('duplicate')
        error.code = 'ER_DUP_ENTRY'
        throw error
      }
      throw new Error(`unexpected query: ${sql}`)
    }
    const one = async (sql) => {
      if (sql.includes('FROM mip_events e')) {
        queriedSource = true
        return { ...sourceEvent(), version: 5 }
      }
      if (sql.includes('FROM mip_idempotency_keys')) {
        return {
          request_hash: require('node:crypto').createHash('sha256').update(['event-source', '4'].join('\0')).digest('hex'),
          status: 'COMPLETED',
          response_json: JSON.stringify(stored),
        }
      }
      return null
    }
    const repository = createAdminRepository({
      one,
      query,
      transaction: work => work({ one, query }),
    })

    const result = await repository.cloneEvent(input())

    assert.deepEqual(result, { ...stored, idempotent: true })
    assert.equal(queriedSource, true)
  })

  it('rejects a reused clone key with a different request hash before stale-version handling', async () => {
    let eventInsertAttempted = false
    const query = async (sql) => {
      if (sql.includes('INSERT INTO mip_idempotency_keys')) {
        const error = new Error('duplicate')
        error.code = 'ER_DUP_ENTRY'
        throw error
      }
      if (sql.includes('INSERT INTO mip_events')) eventInsertAttempted = true
      throw new Error(`unexpected query: ${sql}`)
    }
    const one = async (sql) => {
      if (sql.includes('FROM mip_events e')) return { ...sourceEvent(), version: 5 }
      if (sql.includes('FROM mip_idempotency_keys')) {
        return {
          request_hash: createHash('sha256').update(['another-event', '4'].join('\0')).digest('hex'),
          status: 'COMPLETED',
          response_json: JSON.stringify({
            id: 'another-copy', status: 'DRAFT', version: 1,
            startsAt: '2026-09-05T06:00:00.000Z', idempotent: false,
          }),
        }
      }
      return null
    }
    const repository = createAdminRepository({
      one,
      query,
      transaction: work => work({ one, query }),
    })

    await assert.rejects(() => repository.cloneEvent(input()), error => error?.code === 'CONFLICT')
    assert.equal(eventInsertAttempted, false)
  })

  it('rejects a fresh clone request when the source version is stale', async () => {
    let idempotencyReserved = false
    let eventInsertAttempted = false
    const query = async (sql) => {
      if (sql.includes('INSERT INTO mip_idempotency_keys')) {
        idempotencyReserved = true
        return { affectedRows: 1 }
      }
      if (sql.includes('INSERT INTO mip_events')) eventInsertAttempted = true
      throw new Error(`unexpected query: ${sql}`)
    }
    const one = async (sql) => {
      if (sql.includes('FROM mip_events e')) return { ...sourceEvent(), version: 5 }
      return null
    }
    const repository = createAdminRepository({
      one,
      query,
      transaction: work => work({ one, query }),
    })

    await assert.rejects(() => repository.cloneEvent({
      ...input(),
      idempotencyKey: 'clone-request-0002',
    }), error => error?.code === 'CONFLICT')
    assert.equal(idempotencyReserved, true)
    assert.equal(eventInsertAttempted, false)
  })

  it('rechecks the current role before reading a completed clone result', async () => {
    let idempotencyRead = false
    const one = async (sql) => {
      if (sql.includes('FROM mip_users')) return { id: 'admin-user', status: 'ACTIVE' }
      if (sql.includes('FROM mip_admin_role_bindings')) {
        return {
          scope_type: 'BRANCH', scope_id: 'branch-a', role_key: 'BRANCH_ADMIN', status: 'REVOKED',
        }
      }
      if (sql.includes('FROM mip_idempotency_keys')) idempotencyRead = true
      throw new Error(`unexpected read: ${sql}`)
    }
    const query = async (sql) => {
      throw new Error(`unexpected write: ${sql}`)
    }
    const repository = createProductionAdminRepository({
      one,
      query,
      transaction: work => work({ one, query }),
    })

    await assert.rejects(() => repository.cloneEvent({
      ...input(),
      authorization: {
        capability: 'events.write',
        effectiveGrant: { roleKey: 'BRANCH_ADMIN', scopeType: 'BRANCH', scopeId: 'branch-a' },
      },
      authorizedScope: {
        scopeType: 'EVENT', scopeId: 'event-source', branchId: 'branch-a',
      },
    }), error => error?.code === 'FORBIDDEN')
    assert.equal(idempotencyRead, false)
  })

  it('rejects an event-scoped grant before reading the source or idempotency result', async () => {
    let sourceRead = false
    let idempotencyRead = false
    const one = async (sql) => {
      if (sql.includes('FROM mip_users')) return { id: 'admin-user', status: 'ACTIVE' }
      if (sql.includes('FROM mip_admin_role_bindings')) {
        return {
          scope_type: 'EVENT', scope_id: 'event-source', role_key: 'EVENT_OWNER', status: 'ACTIVE',
        }
      }
      if (sql.includes('FROM mip_events e')) sourceRead = true
      if (sql.includes('FROM mip_idempotency_keys')) idempotencyRead = true
      throw new Error(`unexpected read: ${sql}`)
    }
    const query = async (sql) => {
      throw new Error(`unexpected write: ${sql}`)
    }
    const repository = createProductionAdminRepository({
      one,
      query,
      transaction: work => work({ one, query }),
    })

    await assert.rejects(() => repository.cloneEvent({
      ...input(),
      authorization: {
        capability: 'events.write',
        effectiveGrant: { roleKey: 'EVENT_OWNER', scopeType: 'EVENT', scopeId: 'event-source' },
      },
      authorizedScope: {
        scopeType: 'EVENT', scopeId: 'event-source', branchId: 'branch-a',
      },
    }), error => error?.code === 'FORBIDDEN')
    assert.equal(sourceRead, false)
    assert.equal(idempotencyRead, false)
  })
})
