'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const { createAdminEventRepository } = require('../domain/repositories/events')

const APP_ID = 'wx1111111111111111'
const USER_ID = '11111111-1111-4111-8111-111111111111'
const EVENT_ID = '22222222-2222-4222-8222-222222222222'
const COVER_ID = '33333333-3333-4333-8333-333333333333'
const MEDIA_IDS = [
  '44444444-4444-4444-8444-444444444444',
  '55555555-5555-4555-8555-555555555555',
]

function codeError(code) {
  return Object.assign(new Error(code), { code })
}

function eventDraft(overrides = {}) {
  return {
    scopeType: 'BRANCH',
    branchId: 'branch-a',
    title: '城市交流会',
    summary: '活动摘要',
    description: '活动介绍',
    notices: '',
    coverAssetId: null,
    contentMedia: [],
    startsAt: new Date('2030-08-26T10:00:00.000Z'),
    endsAt: new Date('2030-08-26T12:00:00.000Z'),
    registrationDeadline: null,
    cancellationDeadline: null,
    venueName: '活动场地',
    address: '广州市',
    cityName: '广州',
    latitude: null,
    longitude: null,
    capacity: null,
    eventTypeKey: 'general',
    eventMode: 'OFFLINE',
    accessType: 'FREE',
    registrationPolicy: 'AUTO',
    albumEnabled: false,
    albumSubmissionPolicy: 'REVIEW',
    onlineUrl: '',
    waitlistEnabled: false,
    priceCents: 0,
    registrationSchema: [],
    ...overrides,
  }
}

function repository(database, overrides = {}) {
  let sequence = 0
  return createAdminEventRepository(database, {
    assertAuthorizedScope() {},
    assertMutationScope() {},
    async authorizeMutation() {},
    createId() {
      sequence += 1
      return `generated-${sequence}`
    },
    eventScopeFromRow(row, eventId = row.id) {
      return { scopeType: 'EVENT', scopeId: eventId, branchId: row.branch_id || null }
    },
    async lockMutationAuthorization() {
      return {
        capability: 'events.write',
        effectiveGrant: { roleKey: 'PLATFORM_OWNER', scopeType: 'PLATFORM', scopeId: null },
      }
    },
    now: () => new Date('2030-08-25T00:00:00.000Z'),
    randomBytes: size => Buffer.alloc(size, 7),
    repositorySupport: {
      codeError,
      duplicateConstraint(error) {
        return error?.code === 'ER_DUP_ENTRY' ? error.message || 'duplicate' : ''
      },
      escapeLike(value) {
        return value.replace(/[\\%_]/g, '\\$&')
      },
      iso(value) {
        if (!value) return null
        return new Date(value).toISOString()
      },
      json(value, fallback = {}) {
        if (value === null || value === undefined) return fallback
        if (typeof value === 'object') return value
        try { return JSON.parse(value) }
        catch { return fallback }
      },
    },
    sameScope(left, right) {
      return left?.scopeType === right?.scopeType
        && (left?.scopeId || null) === (right?.scopeId || null)
    },
    visibleEventsWhere() {
      return { sql: '1 = 1', params: [] }
    },
    async writeAudit() {},
    async writeOutbox() {},
    ...overrides,
  })
}

function saveInput(draft) {
  return {
    appId: APP_ID,
    actorUserId: USER_ID,
    eventId: EVENT_ID,
    expectedVersion: 2,
    authorizedScope: { scopeType: 'EVENT', scopeId: EVENT_ID, branchId: 'branch-a' },
    contentSafetyStatus: 'PASSED',
    draft,
    audit: eventId => ({ resourceId: eventId }),
  }
}

describe('admin event repository module', () => {
  it('keeps the extracted seam limited to the existing event persistence methods', () => {
    const adapter = repository({
      async one() { return null },
      async query() { return [] },
      async transaction(work) { return work(this) },
    })
    assert.deepEqual(Object.keys(adapter).sort(), [
      'changeEventStatus',
      'checkIn',
      'cloneEvent',
      'getEvent',
      'getEventPolicy',
      'getEventScope',
      'listEventAlbumPhotos',
      'listEvents',
      'listRoster',
      'publishEventReminder',
      'reviewEventAlbumPhoto',
      'reviewRegistration',
      'saveEvent',
      'saveEventPolicy',
      'undoCheckIn',
    ])
  })

  it('preserves scoped list aggregation, projection, and cursor pagination', async () => {
    let captured
    const startsAt = new Date('2030-08-26T10:00:00.000Z')
    const database = {
      async query(sql, params) {
        captured = { sql, params }
        return [{
          id: EVENT_ID,
          title: '城市交流会',
          summary: '活动摘要',
          scope_type: 'BRANCH',
          branch_id: 'branch-a',
          branch_name: '广州分会',
          status: 'PUBLISHED',
          content_safety_status: 'PASSED',
          starts_at: startsAt,
          ends_at: new Date('2030-08-26T12:00:00.000Z'),
          city_name: '广州',
          access_type: 'FREE',
          registration_policy: 'AUTO',
          album_enabled: 1,
          album_submission_policy: 'REVIEW',
          capacity: 50,
          registration_count: 12,
          attended_count: 3,
          version: 4,
        }]
      },
    }
    const adapter = repository(database, {
      visibleEventsWhere(visibility) {
        assert.deepEqual(visibility, { platform: false, branchIds: ['branch-a'], eventIds: [] })
        return { sql: 'e.branch_id IN (?)', params: ['branch-a'] }
      },
    })
    const page = await adapter.listEvents(
      APP_ID,
      { platform: false, branchIds: ['branch-a'], eventIds: [] },
      { status: 'PUBLISHED', query: '交流_%' },
      20,
    )

    assert.match(captured.sql, /e\.branch_id IN \(\?\)/)
    assert.match(captured.sql, /SUM\(CASE WHEN r\.status IN \('REGISTERED', 'CANCELLATION_PENDING', 'ATTENDED'\)/)
    assert.match(captured.sql, /ORDER BY e\.starts_at DESC, e\.id DESC LIMIT \?/)
    assert.deepEqual(captured.params, [APP_ID, 'branch-a', 'PUBLISHED', '%交流\\_\\%%', 21])
    assert.deepEqual(page, {
      items: [{
        id: EVENT_ID,
        title: '城市交流会',
        summary: '活动摘要',
        scopeType: 'BRANCH',
        branchId: 'branch-a',
        branchName: '广州分会',
        status: 'PUBLISHED',
        contentSafetyStatus: 'PASSED',
        startsAt: startsAt.toISOString(),
        endsAt: '2030-08-26T12:00:00.000Z',
        cityName: '广州',
        accessType: 'FREE',
        registrationPolicy: 'AUTO',
        albumEnabled: true,
        albumSubmissionPolicy: 'REVIEW',
        capacity: 50,
        registrationCount: 12,
        attendedCount: 3,
        version: 4,
      }],
      nextCursor: null,
    })
  })

  it('checks a newly selected cover against the operator inside the save transaction', async () => {
    const calls = []
    const tx = {
      async one(sql, params) {
        calls.push({ method: 'one', sql, params })
        if (sql.includes('FROM mip_events')) {
          return {
            id: EVENT_ID, scope_type: 'BRANCH', branch_id: 'branch-a',
            status: 'DRAFT', version: 2, cover_asset_id: null,
          }
        }
        if (sql.includes('FROM mip_media_assets')) return { id: COVER_ID }
        return null
      },
      async query(sql, params) {
        calls.push({ method: 'query', sql, params })
        return { affectedRows: 1 }
      },
    }
    const database = {
      async transaction(work) {
        calls.push({ method: 'transaction' })
        return work(tx)
      },
    }
    const result = await repository(database).saveEvent(saveInput(eventDraft({ coverAssetId: COVER_ID })))

    const coverRead = calls.find(call => call.sql?.includes("purpose = 'EVENT_COVER'"))
    assert.match(coverRead.sql, /owner_user_id = \?/)
    assert.deepEqual(coverRead.params, [APP_ID, COVER_ID, USER_ID])
    assert.deepEqual(result, { id: EVENT_ID, version: 3, status: 'DRAFT' })
    assert.equal(calls[0].method, 'transaction')
  })

  it('retains an already-bound cover and replaces ordered content media atomically', async () => {
    const calls = []
    const tx = {
      async one(sql, params) {
        calls.push({ method: 'one', sql, params })
        if (sql.includes('FROM mip_events')) {
          return {
            id: EVENT_ID, scope_type: 'BRANCH', branch_id: 'branch-a',
            status: 'DRAFT', version: 2, cover_asset_id: COVER_ID,
          }
        }
        if (sql.includes('FROM mip_media_assets')) return { id: COVER_ID }
        return null
      },
      async query(sql, params) {
        calls.push({ method: 'query', sql, params })
        if (sql.includes('SELECT asset.id')) return MEDIA_IDS.map(id => ({ id }))
        return { affectedRows: 1 }
      },
    }
    const database = { async transaction(work) { return work(tx) } }
    const contentMedia = MEDIA_IDS.map((assetId, index) => ({
      assetId,
      caption: `图片 ${index + 1}`,
    }))
    await repository(database).saveEvent(saveInput(eventDraft({
      coverAssetId: COVER_ID,
      contentMedia,
    })))

    const coverRead = calls.find(call => call.sql?.includes("purpose = 'EVENT_COVER'"))
    assert.doesNotMatch(coverRead.sql, /owner_user_id = \?/)
    assert.deepEqual(coverRead.params, [APP_ID, COVER_ID])
    const mediaRead = calls.find(call => call.sql?.includes('SELECT asset.id'))
    assert.match(mediaRead.sql, /asset\.owner_user_id = \? OR current_media\.event_id IS NOT NULL/)
    assert.deepEqual(mediaRead.params, [EVENT_ID, APP_ID, ...MEDIA_IDS, USER_ID])
    const relationWrites = calls.filter(call => call.sql?.includes('mip_event_content_media'))
    assert.match(relationWrites[1].sql, /status = 'REMOVED'/)
    assert.deepEqual(relationWrites[1].params, [APP_ID, EVENT_ID])
    assert.deepEqual(relationWrites[2].params, [APP_ID, EVENT_ID, MEDIA_IDS[0], 0, '图片 1'])
    assert.deepEqual(relationWrites[3].params, [APP_ID, EVENT_ID, MEDIA_IDS[1], 1, '图片 2'])
  })

  it('rejects a partial content-asset lookup before changing event or relationship facts', async () => {
    const calls = []
    const tx = {
      async one(sql) {
        calls.push(sql)
        if (sql.includes('FROM mip_events')) {
          return {
            id: EVENT_ID, scope_type: 'BRANCH', branch_id: 'branch-a',
            status: 'DRAFT', version: 2, cover_asset_id: null,
          }
        }
        return null
      },
      async query(sql) {
        calls.push(sql)
        if (sql.includes('SELECT asset.id')) return [{ id: MEDIA_IDS[0] }]
        return { affectedRows: 1 }
      },
    }
    const database = { async transaction(work) { return work(tx) } }
    await assert.rejects(
      () => repository(database).saveEvent(saveInput(eventDraft({
        contentMedia: MEDIA_IDS.map(assetId => ({ assetId, caption: '' })),
      }))),
      error => error.code === 'VALIDATION_FAILED',
    )
    assert.equal(calls.some(sql => sql.includes('UPDATE mip_events SET')), false)
    assert.equal(calls.some(sql => sql.includes("SET status = 'REMOVED'")), false)
  })
})
