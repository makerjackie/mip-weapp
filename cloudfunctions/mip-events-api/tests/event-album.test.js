'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const {
  listEventAlbum,
  submitEventAlbumPhoto,
  withdrawEventAlbumPhoto,
} = require('../domain/event-service')

const APP_ID = 'wx-app'
const EVENT_ID = '20000000-0000-4000-8000-000000000001'
const USER_ID = '10000000-0000-4000-8000-000000000001'
const VIEWER_ID = '10000000-0000-4000-8000-000000000002'
const ASSET_ID = '30000000-0000-4000-8000-000000000001'
const PHOTO_ID = '40000000-0000-4000-8000-000000000001'

function eventRow(overrides = {}) {
  return {
    id: EVENT_ID,
    status: 'PUBLISHED',
    published_at: '2026-08-20T00:00:00.000Z',
    album_enabled: 1,
    album_submission_policy: 'REVIEW',
    ...overrides,
  }
}

function readyAsset(overrides = {}) {
  return {
    id: ASSET_ID,
    purpose: 'EVENT_ALBUM',
    status: 'READY',
    content_sha256: 'a'.repeat(64),
    content_type: 'image/jpeg',
    cloud_file_id: 'cloud://env.mip/production/wx-app/event-album/photo.jpg',
    object_key: 'mip/production/wx-app/event-album/photo.jpg',
    content_bytes: 1024,
    width_px: 1200,
    height_px: 800,
    ...overrides,
  }
}

function albumRow(overrides = {}) {
  return {
    id: PHOTO_ID,
    uploader_user_id: USER_ID,
    caption: '现场照片',
    status: 'PUBLISHED',
    version: 2,
    moderation_reason: null,
    created_at: '2026-08-24T08:00:00.000Z',
    asset_status: 'READY',
    cloud_file_id: 'cloud://env.mip/prod/wx-app/event-album/photo.jpg',
    nickname: '参与者',
    visibility_json: '{}',
    avatar_file_id: 'cloud://env.mip/prod/wx-app/avatar/user.jpg',
    ...overrides,
  }
}

function submitDatabase({
  event = eventRow(),
  registration = { status: 'REGISTERED' },
  asset = readyAsset(),
  existing = null,
} = {}) {
  const calls = []
  const tx = {
    async one(sql, params) {
      calls.push({ kind: 'one', sql, params })
      if (sql.includes('FROM mip_users')) return { id: USER_ID, status: 'ACTIVE' }
      if (sql.includes('FROM mip_events')) return event
      if (sql.includes('FROM mip_event_registrations')) return registration
      if (sql.includes('FROM mip_media_assets')) return asset
      if (sql.includes('FROM mip_event_album_photos')) return existing
      throw new Error(`unexpected one query: ${sql}`)
    },
    async query(sql, params) {
      calls.push({ kind: 'query', sql, params })
      return { affectedRows: 1 }
    },
  }
  return {
    calls,
    database: { transaction: work => work(tx) },
  }
}

function withdrawDatabase({
  photo = { id: PHOTO_ID, event_id: EVENT_ID, status: 'PUBLISHED', version: 3 },
  affectedRows = 1,
} = {}) {
  const calls = []
  const tx = {
    async one(sql, params) {
      calls.push({ kind: 'one', sql, params })
      if (sql.includes('FROM mip_users')) return { id: USER_ID, status: 'ACTIVE' }
      return photo
    },
    async query(sql, params) {
      calls.push({ kind: 'query', sql, params })
      if (sql.includes('UPDATE mip_event_album_photos')) return { affectedRows }
      return { affectedRows: 1 }
    },
  }
  return {
    calls,
    database: { transaction: work => work(tx) },
  }
}

async function rejectsCode(work, code, retryable) {
  await assert.rejects(work, (error) => {
    assert.equal(error?.code, code)
    if (retryable !== undefined) assert.equal(error?.retryable, retryable)
    return true
  })
}

describe('MIP public event album', () => {
  it('lists only app-scoped PUBLISHED photos backed by READY EVENT_ALBUM media', async () => {
    const calls = []
    const database = {
      async one(sql, params) {
        calls.push({ kind: 'one', sql, params })
        return eventRow()
      },
      async query(sql, params) {
        calls.push({ kind: 'query', sql, params })
        return [
          albumRow({ uploader_user_id: VIEWER_ID }),
          albumRow({
            id: '40000000-0000-4000-8000-000000000002',
            created_at: '2026-08-23T08:00:00.000Z',
          }),
        ]
      },
    }

    const result = await listEventAlbum(database, {
      appId: APP_ID,
      userId: VIEWER_ID,
      eventId: EVENT_ID,
      limit: 1,
    })

    const eventCall = calls.find(call => call.kind === 'one')
    assert.match(eventCall.sql, /WHERE app_id = \? AND id = \?/)
    assert.match(eventCall.sql, /status = 'PUBLISHED'/)
    assert.deepEqual(eventCall.params, [APP_ID, EVENT_ID])

    const listCall = calls.find(call => call.kind === 'query')
    assert.match(listCall.sql, /photo\.app_id = \?/)
    assert.match(listCall.sql, /photo\.event_id = \?/)
    assert.match(listCall.sql, /photo\.status = 'PUBLISHED'/)
    assert.match(listCall.sql, /asset\.status = 'READY'/)
    assert.match(listCall.sql, /asset\.purpose = 'EVENT_ALBUM'/)
    assert.match(listCall.sql, /FROM mip_user_blocks visibility_block/)
    assert.deepEqual(listCall.params, [APP_ID, EVENT_ID, VIEWER_ID, VIEWER_ID, 2])
    assert.equal(result.items.length, 1)
    assert.equal(result.items[0].mine, true)
    assert.equal(result.items[0].status, 'PUBLISHED')
    assert.equal(result.items[0].imageUrl.startsWith('cloud://'), true)
    assert.equal(typeof result.nextCursor, 'string')
    assert.deepEqual(
      JSON.parse(Buffer.from(result.nextCursor, 'base64url').toString('utf8')),
      { createdAt: '2026-08-24T08:00:00.000Z', id: PHOTO_ID },
    )
    assert.doesNotMatch(JSON.stringify(result), /uploader_user_id|media_asset_id|owner_user_id/i)
  })

  it('returns a disabled fact without querying album rows', async () => {
    let queried = false
    const result = await listEventAlbum({
      one: async () => eventRow({ album_enabled: 0 }),
      query: async () => {
        queried = true
        return []
      },
    }, { appId: APP_ID, eventId: EVENT_ID })

    assert.deepEqual(result, {
      eventId: EVENT_ID,
      albumEnabled: false,
      submissionPolicy: 'REVIEW',
      items: [],
    })
    assert.equal(queried, false)
  })
})

describe('MIP event album submission', () => {
  it('accepts confirmed participants and derives AUTO or REVIEW state from the locked event', async () => {
    const scenarios = [
      { registrationStatus: 'REGISTERED', policy: 'REVIEW', expectedStatus: 'PENDING' },
      { registrationStatus: 'ATTENDED', policy: 'AUTO', expectedStatus: 'PUBLISHED' },
    ]
    for (const scenario of scenarios) {
      const { database, calls } = submitDatabase({
        event: eventRow({ album_submission_policy: scenario.policy }),
        registration: { status: scenario.registrationStatus },
      })
      const result = await submitEventAlbumPhoto(database, {
        appId: APP_ID,
        userId: USER_ID,
        eventId: EVENT_ID,
        mediaAssetId: ASSET_ID,
        caption: '  现场照片  ',
      })

      assert.equal(result.status, scenario.expectedStatus)
      assert.equal(result.version, 1)
      assert.equal(result.idempotent, false)
      const eventLock = calls.find(call => call.kind === 'one' && call.sql.includes('FROM mip_events'))
      const registrationLock = calls.find(call => call.kind === 'one'
        && call.sql.includes('FROM mip_event_registrations'))
      const assetLock = calls.find(call => call.kind === 'one' && call.sql.includes('FROM mip_media_assets'))
      assert.match(eventLock.sql, /WHERE app_id = \? AND id = \? FOR UPDATE/)
      assert.deepEqual(eventLock.params, [APP_ID, EVENT_ID])
      assert.match(registrationLock.sql, /WHERE app_id = \? AND event_id = \? AND user_id = \? FOR UPDATE/)
      assert.deepEqual(registrationLock.params, [APP_ID, EVENT_ID, USER_ID])
      assert.match(assetLock.sql, /WHERE app_id = \? AND id = \? AND owner_user_id = \? FOR UPDATE/)
      assert.deepEqual(assetLock.params, [APP_ID, ASSET_ID, USER_ID])

      const insert = calls.find(call => call.kind === 'query'
        && call.sql.includes('INSERT INTO mip_event_album_photos'))
      assert.equal(insert.params[5], '现场照片')
      assert.equal(insert.params[6], scenario.expectedStatus)
      assert.equal(insert.params[7] instanceof Date, scenario.expectedStatus === 'PUBLISHED')
      const audit = calls.find(call => call.kind === 'query' && call.sql.includes('INSERT INTO mip_audit_logs'))
      assert.ok(audit)
      assert.ok(calls.indexOf(audit) > calls.indexOf(insert))
      assert.ok(audit.params.includes('event.album.photo.submit'))
      assert.deepEqual(JSON.parse(audit.params.at(-1)), {
        status: scenario.expectedStatus,
        submissionPolicy: scenario.policy,
      })
      assert.equal(calls.some(call => /\bDELETE\s+FROM\b/i.test(call.sql)), false)
    }
  })

  it('rejects every unconfirmed registration before reading media or writing facts', async () => {
    for (const registration of [null, { status: 'PENDING_REVIEW' }, { status: 'WAITLISTED' },
      { status: 'PAYMENT_PENDING' }, { status: 'CANCELLED' }, { status: 'REJECTED' }]) {
      const { database, calls } = submitDatabase({ registration })
      await rejectsCode(() => submitEventAlbumPhoto(database, {
        appId: APP_ID,
        userId: USER_ID,
        eventId: EVENT_ID,
        mediaAssetId: ASSET_ID,
      }), 'EVENT_ALBUM_PARTICIPATION_REQUIRED')
      assert.equal(calls.some(call => call.sql.includes('FROM mip_media_assets')), false)
      assert.equal(calls.some(call => call.kind === 'query'), false)
    }
  })

  it('rechecks READY ownership, purpose, image metadata and content-safety completion', async () => {
    const invalidAssets = [
      null,
      readyAsset({ status: 'PROCESSING' }),
      readyAsset({ status: 'REJECTED' }),
      readyAsset({ purpose: 'PROFILE_AVATAR' }),
      readyAsset({ content_type: 'image/gif' }),
      readyAsset({ content_sha256: 'invalid' }),
      readyAsset({ cloud_file_id: 'https://example.test/photo.jpg' }),
      readyAsset({ object_key: 'other/production/photo.jpg' }),
      readyAsset({ object_key: 'mip/production/../photo.jpg' }),
      readyAsset({ content_bytes: 0 }),
      readyAsset({ width_px: 0 }),
      readyAsset({ height_px: 0 }),
    ]
    for (const asset of invalidAssets) {
      const { database, calls } = submitDatabase({ asset })
      await rejectsCode(() => submitEventAlbumPhoto(database, {
        appId: APP_ID,
        userId: USER_ID,
        eventId: EVENT_ID,
        mediaAssetId: ASSET_ID,
      }), 'EVENT_ALBUM_MEDIA_INVALID')
      const assetLock = calls.find(call => call.sql.includes('FROM mip_media_assets'))
      assert.match(assetLock.sql, /owner_user_id = \? FOR UPDATE/)
      assert.deepEqual(assetLock.params, [APP_ID, ASSET_ID, USER_ID])
      assert.equal(calls.some(call => call.sql.includes('INSERT INTO mip_event_album_photos')), false)
      assert.equal(calls.some(call => call.sql.includes('INSERT INTO mip_audit_logs')), false)
    }
  })
})

describe('MIP event album withdrawal', () => {
  it('soft-withdraws only the uploader row at expectedVersion and audits after the write', async () => {
    const { database, calls } = withdrawDatabase()
    const result = await withdrawEventAlbumPhoto(database, {
      appId: APP_ID,
      userId: USER_ID,
      photoId: PHOTO_ID,
      expectedVersion: 3,
    })

    assert.deepEqual(result, { id: PHOTO_ID, status: 'WITHDRAWN', version: 4 })
    const lock = calls.find(call => call.sql.includes('FROM mip_event_album_photos'))
    assert.match(lock.sql, /WHERE app_id = \? AND id = \? AND uploader_user_id = \? FOR UPDATE/)
    assert.deepEqual(lock.params, [APP_ID, PHOTO_ID, USER_ID])
    const update = calls.find(call => call.sql.includes('UPDATE mip_event_album_photos'))
    assert.match(update.sql, /status = 'WITHDRAWN'/)
    assert.match(update.sql, /uploader_user_id = \? AND version = \?/)
    assert.match(update.sql, /status IN \('PENDING', 'PUBLISHED', 'REJECTED'\)/)
    assert.deepEqual(update.params, [APP_ID, PHOTO_ID, USER_ID, 3])
    const audit = calls.find(call => call.sql.includes('INSERT INTO mip_audit_logs'))
    assert.ok(calls.indexOf(audit) > calls.indexOf(update))
    assert.ok(audit.params.includes('event.album.photo.withdraw'))
    assert.deepEqual(JSON.parse(audit.params.at(-1)), {
      previousStatus: 'PUBLISHED',
      expectedVersion: 3,
    })
    assert.equal(calls.some(call => /\bDELETE\s+FROM\b/i.test(call.sql)), false)
  })

  it('rejects stale versions, terminal states and lost conditional updates without auditing', async () => {
    const stale = withdrawDatabase({
      photo: { id: PHOTO_ID, event_id: EVENT_ID, status: 'PENDING', version: 4 },
    })
    await rejectsCode(() => withdrawEventAlbumPhoto(stale.database, {
      appId: APP_ID, userId: USER_ID, photoId: PHOTO_ID, expectedVersion: 3,
    }), 'CONFLICT', true)
    assert.equal(stale.calls.some(call => call.kind === 'query'), false)

    const terminal = withdrawDatabase({
      photo: { id: PHOTO_ID, event_id: EVENT_ID, status: 'WITHDRAWN', version: 4 },
    })
    await rejectsCode(() => withdrawEventAlbumPhoto(terminal.database, {
      appId: APP_ID, userId: USER_ID, photoId: PHOTO_ID, expectedVersion: 4,
    }), 'INVALID_STATE')
    assert.equal(terminal.calls.some(call => call.kind === 'query'), false)

    const raced = withdrawDatabase({ affectedRows: 0 })
    await rejectsCode(() => withdrawEventAlbumPhoto(raced.database, {
      appId: APP_ID, userId: USER_ID, photoId: PHOTO_ID, expectedVersion: 3,
    }), 'CONFLICT', true)
    assert.equal(raced.calls.some(call => call.sql.includes('INSERT INTO mip_audit_logs')), false)
  })
})
