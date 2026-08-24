'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const { CAPABILITIES, roleCapabilities } = require('../domain/capabilities')
const { actions } = require('../domain/handler')
const { createAdminRepository: createProductionAdminRepository } = require('../domain/repository')
const { withTestAuthorization } = require('./test-authorization')

function createAdminRepository(database, options) {
  return createProductionAdminRepository(database, withTestAuthorization(options))
}
const { createAdminService } = require('../domain/service')

const APP_ID = 'wx-app'
const EVENT_ID = 'event-a'
const BRANCH_ID = 'branch-a'
const PHOTO_ID = 'photo-a'
const caller = { appId: APP_ID, identityKey: 'identity-key' }

function transactionDatabase({ one = async () => null, query = async () => ({ affectedRows: 1 }) } = {}) {
  return {
    one,
    query,
    async transaction(work) {
      return work({ one, query })
    },
  }
}

function albumRow(overrides = {}) {
  return {
    id: PHOTO_ID,
    caption: '现场照片',
    status: 'PENDING',
    moderation_reason: null,
    version: 2,
    created_at: '2026-08-24T08:00:00.000Z',
    reviewed_at: null,
    published_at: null,
    asset_status: 'READY',
    asset_purpose: 'EVENT_ALBUM',
    asset_object_key: 'mip/production/wx-app/event-album/photo.jpg',
    asset_cloud_file_id: 'cloud://env.mip/production/wx-app/event-album/photo.jpg',
    asset_content_sha256: 'a'.repeat(64),
    asset_content_type: 'image/jpeg',
    asset_content_bytes: 1024,
    asset_width_px: 1200,
    asset_height_px: 800,
    cloud_file_id: 'cloud://env.mip/prod/wx-app/event-album/photo.jpg',
    nickname: '参与者',
    visibility_json: '{}',
    avatar_file_id: 'cloud://env.mip/prod/wx-app/avatar/user.jpg',
    ...overrides,
  }
}

function albumDto(overrides = {}) {
  return {
    id: PHOTO_ID,
    caption: '现场照片',
    imageUrl: 'cloud://env.mip/prod/wx-app/event-album/photo.jpg',
    nickname: '参与者',
    avatarUrl: 'cloud://env.mip/prod/wx-app/avatar/user.jpg',
    status: 'PENDING',
    moderationReason: '',
    version: 2,
    createdAt: '2026-08-24T08:00:00.000Z',
    reviewedAt: null,
    publishedAt: null,
    ...overrides,
  }
}

function audit(overrides = {}) {
  return {
    appId: APP_ID,
    actorUserId: 'admin-user',
    scopeType: 'EVENT',
    scopeId: EVENT_ID,
    action: 'admin.events.album.approve',
    resourceType: 'EVENT_ALBUM_PHOTO',
    resourceId: PHOTO_ID,
    effectiveRole: 'EVENT_MANAGER',
    metadata: { expectedVersion: 2, reason: '照片内容清晰' },
    ...overrides,
  }
}

function serviceRepository({
  roleKey = 'EVENT_MANAGER',
  scopeType = 'EVENT',
  scopeId = EVENT_ID,
  branchId = 'branch-a',
} = {}) {
  const captured = {}
  return {
    captured,
    resolveUser: async () => ({
      id: 'admin-user', status: 'ACTIVE', agreementsAccepted: true,
      phoneBound: true, profileComplete: true,
    }),
    listRoleBindings: async () => [{ roleKey, scopeType, scopeId }],
    getEventScope: async (appId, eventId) => {
      captured.scope = { appId, eventId }
      return { scopeType: 'EVENT', scopeId: eventId, branchId }
    },
    listEventAlbumPhotos: async (appId, eventId, status, pageLimit) => {
      captured.list = { appId, eventId, status, pageLimit }
      return [albumDto({ status })]
    },
    reviewEventAlbumPhoto: async (input) => {
      captured.review = input
      return albumDto({
        status: input.status,
        moderationReason: input.reason,
        version: input.expectedVersion + 1,
      })
    },
  }
}

describe('admin event album capability and scope', () => {
  it('grants the dedicated capability only to event-managing roles', () => {
    for (const role of [
      'PLATFORM_OWNER', 'PLATFORM_OPERATIONS', 'BRANCH_ADMIN', 'EVENT_OWNER', 'EVENT_MANAGER',
    ]) {
      assert.equal(roleCapabilities[role].includes(CAPABILITIES.EVENTS_ALBUM_MANAGE), true)
    }
    for (const role of ['PLATFORM_FINANCE', 'EVENT_STAFF']) {
      assert.equal(roleCapabilities[role].includes(CAPABILITIES.EVENTS_ALBUM_MANAGE), false)
    }
    assert.equal(typeof actions['mip.admin.events.album.list'], 'function')
    assert.equal(typeof actions['mip.admin.events.album.review'], 'function')
  })

  it('allows matching event or branch grants and rejects unrelated scopes before repository access', async () => {
    const eventRepository = serviceRepository()
    const eventService = createAdminService({ repository: eventRepository })
    const page = await eventService.listEventAlbumPhotos(caller, {
      eventId: EVENT_ID,
      status: 'PENDING',
      limit: 150,
    })
    assert.equal(page.items.length, 1)
    assert.deepEqual(eventRepository.captured.scope, { appId: APP_ID, eventId: EVENT_ID })
    assert.deepEqual(eventRepository.captured.list, {
      appId: APP_ID,
      eventId: EVENT_ID,
      status: 'PENDING',
      pageLimit: 100,
    })

    const branchRepository = serviceRepository({
      roleKey: 'BRANCH_ADMIN', scopeType: 'BRANCH', scopeId: 'branch-a', branchId: 'branch-a',
    })
    await createAdminService({ repository: branchRepository }).listEventAlbumPhotos(caller, {
      eventId: EVENT_ID, status: 'REJECTED',
    })
    assert.equal(branchRepository.captured.list.status, 'REJECTED')

    const deniedRepositories = [
      serviceRepository({ scopeId: 'event-b' }),
      serviceRepository({ roleKey: 'BRANCH_ADMIN', scopeType: 'BRANCH', scopeId: 'branch-b' }),
      serviceRepository({ roleKey: 'EVENT_STAFF' }),
      serviceRepository({ roleKey: 'PLATFORM_FINANCE', scopeType: 'PLATFORM', scopeId: null }),
    ]
    for (const repository of deniedRepositories) {
      const service = createAdminService({ repository })
      await assert.rejects(() => service.listEventAlbumPhotos(caller, {
        eventId: EVENT_ID, status: 'PENDING',
      }), error => error.code === 'FORBIDDEN')
      assert.equal(repository.captured.list, undefined)
    }
  })

  it('normalizes review input and creates a versioned event-scoped audit', async () => {
    const repository = serviceRepository()
    const service = createAdminService({ repository })
    const result = await service.reviewEventAlbumPhoto(caller, {
      eventId: EVENT_ID,
      photoId: PHOTO_ID,
      expectedVersion: 2,
      decision: 'APPROVE',
      reason: '  照片内容清晰  ',
    })

    assert.equal(result.status, 'PUBLISHED')
    assert.equal(result.version, 3)
    assert.equal(repository.captured.review.status, 'PUBLISHED')
    assert.equal(repository.captured.review.reason, '照片内容清晰')
    assert.deepEqual(repository.captured.review.audit, audit())

    await service.reviewEventAlbumPhoto(caller, {
      eventId: EVENT_ID,
      photoId: PHOTO_ID,
      expectedVersion: 3,
      decision: 'REJECT',
      reason: '不符合公开要求',
    })
    assert.equal(repository.captured.review.status, 'REJECTED')
    assert.equal(repository.captured.review.audit.action, 'admin.events.album.reject')
  })

  it('rejects invalid filters, decisions, versions and required reasons before mutation', async () => {
    const repository = serviceRepository()
    const service = createAdminService({ repository })
    await assert.rejects(() => service.listEventAlbumPhotos(caller, {
      eventId: EVENT_ID, status: 'WITHDRAWN',
    }), error => error.code === 'VALIDATION_FAILED')
    for (const input of [
      { expectedVersion: 2, decision: 'PUBLISH', reason: '审核完成' },
      { expectedVersion: 0, decision: 'APPROVE', reason: '审核完成' },
      { expectedVersion: 2, decision: 'REJECT', reason: '   ' },
      { expectedVersion: 2, decision: 'REJECT', reason: 'a'.repeat(301) },
    ]) {
      repository.captured.review = undefined
      await assert.rejects(() => service.reviewEventAlbumPhoto(caller, {
        eventId: EVENT_ID, photoId: PHOTO_ID, ...input,
      }), error => error.code === 'VALIDATION_FAILED')
      assert.equal(repository.captured.review, undefined)
    }
  })
})

describe('admin event album persistence', () => {
  it('lists app/event/status-scoped rows and returns only visibility-controlled display fields', async () => {
    const calls = []
    const repository = createAdminRepository(transactionDatabase({
      async query(sql, params) {
        calls.push({ sql, params })
        return [albumRow({
          visibility_json: JSON.stringify({ nickname: false, avatar: false }),
          uploader_user_id: 'must-not-leak',
          media_asset_id: 'must-not-leak',
          reviewed_by_user_id: 'must-not-leak',
          openid: 'must-not-leak',
          phone_ciphertext: 'must-not-leak',
        })]
      },
    }))

    const result = await repository.listEventAlbumPhotos(APP_ID, EVENT_ID, 'PENDING', 20)

    assert.deepEqual(calls[0].params, [APP_ID, EVENT_ID, 'PENDING', 20])
    assert.match(calls[0].sql, /WHERE photo\.app_id = \? AND photo\.event_id = \? AND photo\.status = \?/)
    const projection = calls[0].sql.slice(0, calls[0].sql.indexOf('FROM mip_event_album_photos'))
    assert.doesNotMatch(projection, /uploader_user_id|media_asset_id|reviewed_by_user_id|openid|phone/i)
    assert.deepEqual(result, [albumDto({
      nickname: '活动参与者',
      avatarUrl: '',
    })])
    assert.doesNotMatch(JSON.stringify(result), /must-not-leak|user_id|media_asset_id|reviewed_by/i)
  })

  it('approves only PENDING at expectedVersion after rechecking READY EVENT_ALBUM media', async () => {
    const queryCalls = []
    const oneCalls = []
    let readCount = 0
    const repository = createAdminRepository(transactionDatabase({
      async one(sql, params) {
        oneCalls.push({ sql, params })
        if (sql.includes('FROM mip_events')) return { id: EVENT_ID, branch_id: BRANCH_ID }
        readCount += 1
        if (readCount === 1) return albumRow()
        return albumRow({
          status: 'PUBLISHED',
          moderation_reason: '照片内容清晰',
          version: 3,
          reviewed_at: '2026-08-24T09:00:00.000Z',
          published_at: '2026-08-24T09:00:00.000Z',
        })
      },
      async query(sql, params) {
        queryCalls.push({ sql, params })
        return { affectedRows: 1 }
      },
    }))

    const result = await repository.reviewEventAlbumPhoto({
      appId: APP_ID,
      actorUserId: 'admin-user',
      eventId: EVENT_ID,
      photoId: PHOTO_ID,
      expectedVersion: 2,
      status: 'PUBLISHED',
      reason: '照片内容清晰',
      audit: audit(),
    })

    assert.equal(result.status, 'PUBLISHED')
    assert.equal(result.version, 3)
    assert.equal(result.moderationReason, '照片内容清晰')
    const lockedPhoto = oneCalls.find(call => call.sql.includes('FROM mip_event_album_photos photo'))
    assert.match(lockedPhoto.sql, /asset\.status AS asset_status, asset\.purpose AS asset_purpose/)
    assert.match(lockedPhoto.sql, /WHERE photo\.app_id = \? AND photo\.event_id = \? AND photo\.id = \? FOR UPDATE/)
    assert.deepEqual(lockedPhoto.params, [APP_ID, EVENT_ID, PHOTO_ID])
    const update = queryCalls.find(call => call.sql.includes('UPDATE mip_event_album_photos'))
    assert.match(update.sql, /status = 'PENDING' AND version = \?/)
    assert.match(update.sql, /moderation_reason = \?/)
    assert.deepEqual(update.params, [
      'PUBLISHED', '照片内容清晰', 'admin-user', 'PUBLISHED', APP_ID, EVENT_ID, PHOTO_ID, 2,
    ])
    const auditCall = queryCalls.find(call => call.sql.includes('INSERT INTO mip_audit_logs'))
    assert.ok(queryCalls.indexOf(auditCall) > queryCalls.indexOf(update))
    assert.ok(auditCall.params.includes('admin.events.album.approve'))
    assert.deepEqual(JSON.parse(auditCall.params.at(-1)), {
      expectedVersion: 2,
      reason: '照片内容清晰',
    })
    assert.equal(queryCalls.some(call => /\bDELETE\s+FROM\b/i.test(call.sql)), false)
  })

  it('allows a reasoned rejection without treating invalid media as publishable', async () => {
    const queryCalls = []
    let readCount = 0
    const repository = createAdminRepository(transactionDatabase({
      async one(sql) {
        if (sql.includes('FROM mip_events')) return { id: EVENT_ID, branch_id: BRANCH_ID }
        readCount += 1
        if (readCount === 1) return albumRow({ asset_status: 'REJECTED', asset_purpose: null })
        return albumRow({
          status: 'REJECTED',
          asset_status: 'REJECTED',
          cloud_file_id: null,
          moderation_reason: '内容安全检查未通过',
          version: 3,
          reviewed_at: '2026-08-24T09:00:00.000Z',
        })
      },
      async query(sql, params) {
        queryCalls.push({ sql, params })
        return { affectedRows: 1 }
      },
    }))

    const result = await repository.reviewEventAlbumPhoto({
      appId: APP_ID,
      actorUserId: 'admin-user',
      eventId: EVENT_ID,
      photoId: PHOTO_ID,
      expectedVersion: 2,
      status: 'REJECTED',
      reason: '内容安全检查未通过',
      audit: audit({ action: 'admin.events.album.reject' }),
    })

    assert.equal(result.status, 'REJECTED')
    assert.equal(result.imageUrl, '')
    const update = queryCalls.find(call => call.sql.includes('UPDATE mip_event_album_photos'))
    assert.equal(update.params[0], 'REJECTED')
    assert.equal(update.params[1], '内容安全检查未通过')
    assert.ok(queryCalls.some(call => call.sql.includes('INSERT INTO mip_audit_logs')))
  })

  it('rejects stale or non-PENDING rows and failed conditional writes without an audit', async () => {
    const scenarios = [
      { row: albumRow({ version: 3 }), expectedVersion: 2, code: 'CONFLICT' },
      { row: albumRow({ status: 'PUBLISHED' }), expectedVersion: 2, code: 'INVALID_STATE' },
      { row: albumRow({ status: 'REJECTED' }), expectedVersion: 2, code: 'INVALID_STATE' },
      { row: albumRow({ status: 'WITHDRAWN' }), expectedVersion: 2, code: 'INVALID_STATE' },
    ]
    for (const scenario of scenarios) {
      const calls = []
      const repository = createAdminRepository(transactionDatabase({
        one: async () => scenario.row,
        async query(sql, params) {
          calls.push({ sql, params })
          return { affectedRows: 1 }
        },
      }))
      await assert.rejects(() => repository.reviewEventAlbumPhoto({
        appId: APP_ID, actorUserId: 'admin-user', eventId: EVENT_ID, photoId: PHOTO_ID,
        expectedVersion: scenario.expectedVersion, status: 'PUBLISHED', reason: '审核完成', audit: audit(),
      }), error => error.code === scenario.code)
      assert.equal(calls.some(call => call.sql.includes('UPDATE mip_event_album_photos')), false)
      assert.equal(calls.some(call => call.sql.includes('INSERT INTO mip_audit_logs')), false)
    }

    const racedCalls = []
    const raced = createAdminRepository(transactionDatabase({
      one: async () => albumRow(),
      async query(sql, params) {
        racedCalls.push({ sql, params })
        return { affectedRows: 0 }
      },
    }))
    await assert.rejects(() => raced.reviewEventAlbumPhoto({
      appId: APP_ID, actorUserId: 'admin-user', eventId: EVENT_ID, photoId: PHOTO_ID,
      expectedVersion: 2, status: 'PUBLISHED', reason: '审核完成', audit: audit(),
    }), error => error.code === 'CONFLICT')
    assert.equal(racedCalls.some(call => call.sql.includes('INSERT INTO mip_audit_logs')), false)
  })

  it('refuses approval when the locked media is no longer READY or EVENT_ALBUM', async () => {
    for (const row of [
      albumRow({ asset_status: 'REJECTED' }),
      albumRow({ asset_status: 'PROCESSING' }),
      albumRow({ asset_purpose: 'PROFILE_AVATAR' }),
      albumRow({ asset_status: null, asset_purpose: null }),
    ]) {
      const calls = []
      const repository = createAdminRepository(transactionDatabase({
        one: async () => row,
        async query(sql, params) {
          calls.push({ sql, params })
          return { affectedRows: 1 }
        },
      }))
      await assert.rejects(() => repository.reviewEventAlbumPhoto({
        appId: APP_ID, actorUserId: 'admin-user', eventId: EVENT_ID, photoId: PHOTO_ID,
        expectedVersion: 2, status: 'PUBLISHED', reason: '审核完成', audit: audit(),
      }), error => error.code === 'EVENT_ALBUM_MEDIA_INVALID')
      assert.equal(calls.some(call => call.sql.includes('UPDATE mip_event_album_photos')), false)
      assert.equal(calls.some(call => call.sql.includes('INSERT INTO mip_audit_logs')), false)
    }
  })
})
