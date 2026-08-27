'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const { createAdminRepository } = require('../domain/repository')
const { createAdminPrdExtensions } = require('../domain/admin-prd-extensions')
const { withTestAuthorization } = require('./test-authorization')

function eventRow(status = 'PUBLISHED', version = 4) {
  return { id: 'event-a', branch_id: null, status, content_safety_status: 'PASSED',
    starts_at: new Date('2030-08-25T10:00:00.000Z'), version }
}

function eventDatabase(initialEvent, { archive = false } = {}) {
  const state = {
    event: { ...initialEvent },
    idempotency: new Map(),
    calls: [],
    sequence: 0,
  }
  const one = async (sql, params = []) => {
    state.calls.push({ sql, params })
    if (sql.includes('FROM mip_idempotency_keys')) {
      return state.idempotency.get(params[3]) || null
    }
    if (sql.includes('FROM mip_events')) return { ...state.event }
    if (archive && sql.includes('AS registrations')) {
      return { registrations: 0, orders: 0, checkins: 0, album_photos: 0 }
    }
    return null
  }
  const query = async (sql, params = []) => {
    state.calls.push({ sql, params })
    if (sql.includes('INSERT INTO mip_idempotency_keys')) {
      if (state.idempotency.has(params[4])) {
        const error = new Error('duplicate idempotency key')
        error.code = 'ER_DUP_ENTRY'
        throw error
      }
      state.idempotency.set(params[4], {
        request_hash: params[5], status: 'RUNNING', response_json: null,
      })
    }
    if (sql.includes('UPDATE mip_events SET status = ?')) {
      state.event.status = params[0]
      state.event.version += 1
    }
    if (sql.includes("UPDATE mip_events SET status = 'ARCHIVED'")) {
      state.event.status = 'ARCHIVED'
      state.event.version += 1
    }
    if (sql.includes('UPDATE mip_idempotency_keys SET status')) {
      const key = params[4]
      const stored = state.idempotency.get(key)
      if (stored) {
        stored.status = 'COMPLETED'
        stored.response_json = params[0]
      }
    }
    return { affectedRows: 1 }
  }
  const database = {
    one,
    query,
    transaction: work => work({ one, query }),
  }
  return { database, state }
}

function authorizationOptions() {
  return withTestAuthorization({
    id: () => '00000000-0000-4000-8000-000000000001',
  })
}

function statusInput(overrides = {}) {
  return {
    appId: 'wx-app', actorUserId: 'admin-user', eventId: 'event-a', expectedVersion: 4,
    status: 'ENDED', reason: '', authorizedScope: { scopeType: 'EVENT', scopeId: 'event-a', branchId: null },
    authorization: {}, audit: {
      appId: 'wx-app', actorUserId: 'admin-user', scopeType: 'EVENT', scopeId: 'event-a',
      action: 'admin.events.status.change', resourceType: 'EVENT', resourceId: 'event-a',
      effectiveRole: 'PLATFORM_OWNER', metadata: {},
    },
    ...overrides,
  }
}

function archiveInput(overrides = {}) {
  return {
    appId: 'wx-app', actorUserId: 'admin-user', eventId: 'event-a', expectedVersion: 4,
    reason: '内容重复', authorizedScope: { scopeType: 'EVENT', scopeId: 'event-a', branchId: null },
    authorization: {}, audit: {
      appId: 'wx-app', actorUserId: 'admin-user', scopeType: 'EVENT', scopeId: 'event-a',
      action: 'admin.events.archive', resourceType: 'EVENT', resourceId: 'event-a',
      effectiveRole: 'PLATFORM_OWNER', metadata: {},
    },
    ...overrides,
  }
}

describe('admin event optional idempotency', () => {
  it('keeps status changes compatible without a key and replays the same keyed request', async () => {
    const { database, state } = eventDatabase(eventRow())
    const repository = createAdminRepository(database, authorizationOptions())
    const first = await repository.changeEventStatus(statusInput({ idempotencyKey: 'status-request-0001' }))
    const replay = await repository.changeEventStatus(statusInput({ idempotencyKey: 'status-request-0001' }))
    assert.equal(first.version, 5)
    assert.equal(replay.idempotent, true)
    assert.equal(replay.version, first.version)
    assert.equal(state.calls.filter(call => call.sql.includes('UPDATE mip_events SET status')).length, 1)
    assert.equal(state.idempotency.get('status-request-0001').status, 'COMPLETED')

    const noKey = eventDatabase(eventRow())
    const noKeyRepository = createAdminRepository(noKey.database, authorizationOptions())
    await noKeyRepository.changeEventStatus(statusInput())
    assert.equal(noKey.state.calls.some(call => call.sql.includes('mip_idempotency_keys')), false)
  })

  it('rejects a different status request under the same key', async () => {
    const { database } = eventDatabase(eventRow())
    const repository = createAdminRepository(database, authorizationOptions())
    await repository.changeEventStatus(statusInput({ idempotencyKey: 'status-request-0002' }))
    await assert.rejects(
      () => repository.changeEventStatus(statusInput({ idempotencyKey: 'status-request-0002', status: 'UNPUBLISHED' })),
      error => error?.code === 'CONFLICT',
    )
  })

  it('replays and protects archived event requests with the same optional key', async () => {
    const { database, state } = eventDatabase(eventRow('DRAFT'), { archive: true })
    const repository = createAdminPrdExtensions(database, authorizationOptions())
    const first = await repository.archiveEvent(archiveInput({ idempotencyKey: 'archive-request-0001' }))
    const replay = await repository.archiveEvent(archiveInput({ idempotencyKey: 'archive-request-0001' }))
    assert.deepEqual(first, { id: 'event-a', status: 'ARCHIVED', version: 5 })
    assert.equal(replay.idempotent, true)
    assert.equal(replay.version, first.version)
    assert.equal(state.calls.filter(call => call.sql.includes("UPDATE mip_events SET status = 'ARCHIVED'")).length, 1)

    await assert.rejects(
      () => repository.archiveEvent(archiveInput({ idempotencyKey: 'archive-request-0001', reason: '其他原因' })),
      error => error?.code === 'CONFLICT',
    )
  })
})
