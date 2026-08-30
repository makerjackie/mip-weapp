'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const { createHandler } = require('../domain/handler')
const { createAiRepository } = require('../domain/repository')
const { createAiService } = require('../domain/service')
const { signMaintenanceRequest, verifyMaintenanceRequest } = require('../lib/internal-auth')

const APP_ID = 'wx1111111111111111'
const OTHER_APP_ID = 'wx2222222222222222'
const USER_ID = '11111111-1111-4111-8111-111111111111'
const SECRET = 'ai-maintenance-secret-with-at-least-32-characters'

describe('AI audio maintenance', () => {
  it('binds the timestamp and complete unsigned body to an allowed AppID', () => {
    const request = {
      action: 'cleanupExpiredAudio',
      appId: APP_ID,
      limit: 10,
      policy: { terminalOnly: true },
      timestamp: 1_800_000_000_000,
    }
    const signature = signMaintenanceRequest(request, SECRET)
    assert.doesNotThrow(() => verifyMaintenanceRequest({ ...request, signature }, {
      allowedAppIds: new Set([APP_ID]),
      secret: SECRET,
      now: () => request.timestamp,
    }))
    assert.throws(() => verifyMaintenanceRequest({
      ...request,
      policy: { terminalOnly: false },
      signature,
    }, {
      allowedAppIds: new Set([APP_ID]),
      secret: SECRET,
      now: () => request.timestamp,
    }), /FORBIDDEN/)
    assert.throws(() => verifyMaintenanceRequest({
      ...request,
      appId: OTHER_APP_ID,
      signature,
    }, {
      allowedAppIds: new Set([APP_ID]),
      secret: SECRET,
      now: () => request.timestamp,
    }), /FORBIDDEN/)
    assert.throws(() => verifyMaintenanceRequest({ ...request, signature }, {
      allowedAppIds: new Set([APP_ID]),
      secret: SECRET,
      now: () => request.timestamp + 5 * 60 * 1000 + 1,
    }), /FORBIDDEN/)
  })

  it('expires overdue drafts in a bounded locked batch', async () => {
    const calls = []
    const repository = createAiRepository({
      async transaction(work) {
        return work({
          async query(sql, params) {
            calls.push({ sql, params })
            if (sql.includes('SELECT id FROM mip_ai_draft_requests')) {
              return [{ id: 'request-1' }, { id: 'request-2' }]
            }
            if (sql.includes('SELECT id FROM mip_ai_drafts')) {
              return [{ id: 'draft-1' }, { id: 'draft-2' }]
            }
            return { affectedRows: 1 }
          },
        })
      },
    })
    assert.equal(await repository.expireDraftsForApp(APP_ID, 2), 2)
    assert.match(calls[0].sql, /SELECT id FROM mip_ai_draft_requests/)
    assert.match(calls[0].sql, /LIMIT \? FOR UPDATE SKIP LOCKED/)
    assert.deepEqual(calls[0].params, [APP_ID, 2])
    assert.match(calls[1].sql, /UPDATE mip_ai_draft_requests/)
    assert.match(calls[1].sql, /response_json = NULL/)
    assert.deepEqual(calls[1].params, [APP_ID, 'request-1'])
    assert.deepEqual(calls[2].params, [APP_ID, 'request-2'])
    assert.match(calls[3].sql, /SELECT id FROM mip_ai_drafts/)
    assert.match(calls[3].sql, /LIMIT \? FOR UPDATE SKIP LOCKED/)
    assert.deepEqual(calls[3].params, [APP_ID, 2])
    assert.equal(calls.length, 6)
  })

  it('leases terminal audio across users while preserving the owner and lease timestamp', async () => {
    const calls = []
    const repository = createAiRepository({
      async transaction(work) {
        return work({
          async query(sql, params) {
            calls.push({ sql, params })
            if (sql.includes('SELECT DISTINCT asset.id')) {
              return [{
                id: 'asset-1',
                owner_user_id: USER_ID,
                object_key: 'mip/development/app/ai/user/audio.mp3',
                cloud_file_id: 'cloud://env/mip/development/app/ai/user/audio.mp3',
              }]
            }
            return { affectedRows: 1 }
          },
        })
      },
    })
    const assets = await repository.leaseAppAudioCleanup(APP_ID, 5)
    assert.doesNotMatch(calls[0].sql, /draft\.user_id = \?/)
    assert.match(calls[0].sql, /draft\.status IN \('CONFIRMED', 'EXPIRED', 'DELETED'\)/)
    assert.match(calls[0].sql, /LEFT JOIN mip_ai_draft_requests ai_request/)
    assert.match(calls[0].sql, /ai_request\.status = 'PROCESSING'/)
    assert.match(calls[0].sql, /ai_request\.expires_at > UTC_TIMESTAMP\(3\)/)
    assert.match(calls[0].sql, /ai_request\.id IS NULL/)
    assert.match(calls[0].sql, /FOR UPDATE SKIP LOCKED/)
    assert.deepEqual(calls[0].params, [APP_ID, 5])
    assert.equal(calls[1].params[0] instanceof Date, true)
    assert.deepEqual(calls[1].params.slice(1), [APP_ID, USER_ID, 'asset-1'])
    assert.equal(assets[0].lease_updated_at instanceof Date, true)
  })

  it('leases an ownerless PENDING upload without a draft for app-scoped cleanup', async () => {
    const calls = []
    const repository = createAiRepository({
      async transaction(work) {
        return work({
          async query(sql, params) {
            calls.push({ sql, params })
            if (sql.includes('SELECT DISTINCT asset.id')) {
              assert.match(sql, /LEFT JOIN mip_ai_drafts/)
              assert.match(sql, /draft\.id IS NULL/)
              assert.match(sql, /asset\.status IN \('READY', 'PENDING'\)/)
              return [{
                id: 'asset-pending',
                owner_user_id: null,
                object_key: 'mip/development/app/ai/user/audio.mp3',
                cloud_file_id: 'cloud://env/mip/development/app/ai/user/audio.mp3',
              }]
            }
            assert.match(sql, /owner_user_id IS NULL/)
            assert.match(sql, /status = 'PENDING'/)
            return { affectedRows: 1 }
          },
        })
      },
    })
    const assets = await repository.leaseAppAudioCleanup(APP_ID, 1)
    assert.equal(assets.length, 1)
    assert.equal(assets[0].owner_user_id, null)
    assert.deepEqual(calls[1].params.slice(1), [APP_ID, 'asset-pending'])
  })

  it('does not expose an asset when the deletion lease update is uncertain', async () => {
    const repository = createAiRepository({
      async transaction(work) {
        return work({
          async query(sql) {
            if (sql.includes('SELECT DISTINCT asset.id')) {
              return [{
                id: 'asset-1',
                owner_user_id: USER_ID,
                object_key: 'mip/development/app/ai/user/audio.mp3',
                cloud_file_id: 'cloud://env/mip/development/app/ai/user/audio.mp3',
              }]
            }
            return { affectedRows: 0 }
          },
        })
      },
    })
    assert.deepEqual(await repository.leaseAppAudioCleanup(APP_ID, 1), [])
  })

  it('returns only bounded counts and keeps failed deletions in PENDING for retry', async () => {
    let marked = false
    const service = createAiService({
      repository: {
        async expireDraftsForApp(appId, limit) {
          assert.equal(appId, APP_ID)
          assert.equal(limit, 10)
          return 3
        },
        async leaseAppAudioCleanup() {
          return [{
            id: 'asset-private',
            owner_user_id: USER_ID,
            object_key: 'mip/development/app/ai/user/audio.mp3',
            cloud_file_id: 'cloud://env/mip/development/app/ai/user/audio.mp3',
            lease_updated_at: new Date('2026-08-24T00:00:00.000Z'),
          }]
        },
        async markAudioDeleted() {
          marked = true
          return true
        },
      },
      provider: { capability: () => ({ textDrafts: false, voiceDrafts: false }) },
      audioStore: { configured: true, async remove() { return false } },
    })
    const result = await service.cleanupExpiredAudioForApp(APP_ID, { limit: 10 })
    assert.deepEqual(result, {
      status: 'PARTIAL',
      expired: 3,
      scanned: 1,
      deleted: 0,
      failed: 1,
    })
    assert.equal(marked, false)
    assert.equal(JSON.stringify(result).includes('asset-private'), false)
    assert.equal(JSON.stringify(result).includes(USER_ID), false)

    const uncertainDatabase = createAiService({
      repository: {
        async expireDraftsForApp() { return 0 },
        async leaseAppAudioCleanup() {
          return [{
            id: 'asset-private',
            owner_user_id: USER_ID,
            object_key: 'mip/development/app/ai/user/audio.mp3',
            cloud_file_id: 'cloud://env/mip/development/app/ai/user/audio.mp3',
            lease_updated_at: new Date('2026-08-24T00:00:00.000Z'),
          }]
        },
        async markAudioDeleted() { return false },
      },
      provider: { capability: () => ({ textDrafts: false, voiceDrafts: false }) },
      audioStore: { configured: true, async remove() { return true } },
    })
    assert.deepEqual(await uncertainDatabase.cleanupExpiredAudioForApp(APP_ID, { limit: 1 }), {
      status: 'PARTIAL',
      expired: 0,
      scanned: 1,
      deleted: 0,
      failed: 1,
    })
  })

  it('runs maintenance without resolving a client caller', async () => {
    let resolvedCaller = false
    const handler = createHandler({
      async resolveCaller() {
        resolvedCaller = true
        throw new Error('unexpected caller')
      },
      verifyMaintenance(event) {
        assert.equal(event.signature, 'signed')
        return { appId: APP_ID, limit: 4 }
      },
      service: {
        async cleanupExpiredAudioForApp(appId, request) {
          assert.equal(appId, APP_ID)
          assert.equal(request.limit, 4)
          return { status: 'COMPLETED', expired: 1, scanned: 1, deleted: 1, failed: 0 }
        },
      },
    })
    assert.deepEqual(await handler({ action: 'cleanupExpiredAudio', signature: 'signed' }), {
      ok: true,
      data: { status: 'COMPLETED', expired: 1, scanned: 1, deleted: 1, failed: 0 },
    })
    assert.equal(resolvedCaller, false)
  })
})
