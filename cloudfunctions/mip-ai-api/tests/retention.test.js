'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const { createAiRepository, normalizeDraftTtlHours } = require('../domain/repository')
const { createAiService } = require('../domain/service')

const APP_ID = 'wx1111111111111111'
const USER_ID = '11111111-1111-4111-8111-111111111111'

describe('AI draft retention', () => {
  it('uses a bounded configurable expiry instead of a permanent audio record', async () => {
    let insertSql = ''
    const calls = []
    const repository = createAiRepository({
      async transaction(work) {
        return work({
          async query(sql) {
            calls.push(sql)
            insertSql = sql
            return { affectedRows: 1 }
          },
          async one(sql) {
            calls.push(sql)
            if (sql.includes('FROM mip_users')) {
              return { id: USER_ID, status: 'ACTIVE' }
            }
            return {
              id: '22222222-2222-4222-8222-222222222222',
              user_id: USER_ID,
              purpose: 'PROFILE',
              status: 'STRUCTURING',
              expires_at: '2099-01-01T00:00:00.000Z',
              version: 1,
            }
          },
        })
      },
    }, {
      createId: () => '22222222-2222-4222-8222-222222222222',
      draftTtlHours: 24,
    })
    await repository.createTextDraft(APP_ID, USER_ID, { purpose: 'PROFILE', transcriptText: '资料' })
    assert.match(insertSql, /INTERVAL 24 HOUR/)
    assert.match(calls[0], /FROM mip_users[\s\S]*FOR UPDATE/)
    assert.equal(calls.findIndex(sql => sql.includes('INSERT INTO mip_ai_drafts')) > 0, true)
    assert.equal(normalizeDraftTtlHours(undefined), 72)
    assert.throws(() => normalizeDraftTtlHours(0), /AI_DRAFT_TTL_INVALID/)
    assert.throws(() => normalizeDraftTtlHours(169), /AI_DRAFT_TTL_INVALID/)
  })

  it('does not recreate a private draft after account closure wins the user lock', async () => {
    let inserted = false
    const repository = createAiRepository({
      async transaction(work) {
        return work({
          async one(sql) {
            if (sql.includes('FROM mip_users')) {
              return { id: USER_ID, status: 'CLOSED' }
            }
            throw new Error(`unexpected query: ${sql}`)
          },
          async query() {
            inserted = true
            return { affectedRows: 1 }
          },
        })
      },
    })
    await assert.rejects(
      () => repository.createTextDraft(APP_ID, USER_ID, { purpose: 'PROFILE', transcriptText: '资料' }),
      /FORBIDDEN/,
    )
    assert.equal(inserted, false)
  })

  it('stages uploaded audio as PENDING before the ACTIVE transaction promotes it to READY', async () => {
    const calls = []
    const repository = createAiRepository({
      async query(sql, params) {
        calls.push({ phase: 'pending', sql, params })
        return { affectedRows: 1 }
      },
      async transaction(work) {
        return work({
          async one(sql) {
            calls.push({ phase: 'one', sql })
            if (sql.includes('FROM mip_users')) return { id: USER_ID, status: 'ACTIVE' }
            return {
              id: '22222222-2222-4222-8222-222222222222',
              user_id: USER_ID,
              purpose: 'PROFILE',
              status: 'TRANSCRIBING',
              expires_at: '2099-01-01T00:00:00.000Z',
              version: 1,
            }
          },
          async query(sql, params) {
            calls.push({ phase: 'transaction', sql, params })
            return { affectedRows: 1 }
          },
        })
      },
    }, { createId: () => '22222222-2222-4222-8222-222222222222' })
    await repository.createVoiceDraftFromUpload(APP_ID, USER_ID, {
      assetId: '33333333-3333-4333-8333-333333333333',
      objectKey: 'mip/development/app/ai/user/33333333-3333-4333-8333-333333333333.mp3',
      cloudFileId: 'cloud://env/mip/development/app/ai/user/33333333-3333-4333-8333-333333333333.mp3',
      contentSha256: 'a'.repeat(64),
      contentType: 'audio/mpeg',
      contentBytes: 10,
    }, 'PROFILE')
    assert.match(calls[0].sql, /owner_user_id[\s\S]*'PENDING'/)
    assert.match(calls.find(call => call.phase === 'one').sql, /FROM mip_users[\s\S]*FOR UPDATE/)
    const activation = calls.find(call => call.phase === 'transaction')
    assert.match(activation.sql, /SET owner_user_id = \?, status = 'READY'/)
    assert.deepEqual(activation.params, [USER_ID, APP_ID, '33333333-3333-4333-8333-333333333333'])
  })

  it('retries physical cleanup and marks metadata deleted only after storage succeeds', async () => {
    let marked = false
    const repository = {
      async expireDrafts() {},
      async leaseAudioCleanup() {
        return [{
          id: 'asset-1',
          object_key: 'mip/development/app/ai/user/audio.mp3',
          cloud_file_id: 'cloud://env/mip/development/app/ai/user/audio.mp3',
          lease_updated_at: new Date('2026-08-24T00:00:00.000Z'),
        }]
      },
      async markAudioDeleted(appId, userId, assetId, leaseUpdatedAt) {
        assert.equal(appId, APP_ID)
        assert.equal(userId, USER_ID)
        assert.equal(assetId, 'asset-1')
        assert.equal(leaseUpdatedAt.toISOString(), '2026-08-24T00:00:00.000Z')
        marked = true
      },
      async listDrafts() { return { items: [] } },
    }
    const failedCleanup = createAiService({
      repository,
      provider: { capability: () => ({ textDrafts: false, voiceDrafts: false }) },
      audioStore: { configured: true, async remove() { return false } },
    })
    await failedCleanup.listDrafts({ appId: APP_ID, userId: USER_ID }, {})
    assert.equal(marked, false)

    const successfulCleanup = createAiService({
      repository,
      provider: { capability: () => ({ textDrafts: false, voiceDrafts: false }) },
      audioStore: { configured: true, async remove() { return true } },
    })
    await successfulCleanup.listDrafts({ appId: APP_ID, userId: USER_ID }, {})
    assert.equal(marked, true)
  })

  it('leases audio metadata before storage deletion and keeps the lease on failure', async () => {
    const events = []
    const repository = {
      async expireDrafts() {},
      async leaseAudioCleanup() {
        events.push('lease')
        return [{
          id: 'asset-1',
          object_key: 'mip/development/app/ai/user/audio.mp3',
          cloud_file_id: 'cloud://env/mip/development/app/ai/user/audio.mp3',
          lease_updated_at: new Date('2026-08-24T00:00:00.000Z'),
        }]
      },
      async markAudioDeleted() {
        events.push('deleted')
        throw new Error('DB_UPDATE_FAILED')
      },
      async listDrafts() { return { items: [] } },
    }
    const service = createAiService({
      repository,
      provider: { capability: () => ({ textDrafts: false, voiceDrafts: false }) },
      audioStore: {
        configured: true,
        async remove(input) {
          assert.equal(input.appId, APP_ID)
          assert.equal(input.userId, USER_ID)
          events.push('storage')
          return true
        },
      },
    })
    await service.listDrafts({ appId: APP_ID, userId: USER_ID }, {})
    assert.deepEqual(events, ['lease', 'storage', 'deleted'])
  })

  it('selects only terminal drafts owned by the caller and marks the lease before returning', async () => {
    const calls = []
    const repository = createAiRepository({
      async transaction(work) {
        return work({
          async query(sql, params) {
            calls.push({ sql, params })
            if (sql.includes('SELECT DISTINCT asset.id')) {
              assert.match(sql, /asset\.app_id = \?[\s\S]*draft\.user_id = \?/)
              assert.match(sql, /asset\.purpose = 'AI_AUDIO'[\s\S]*asset\.owner_user_id = \?/)
              assert.match(sql, /asset\.status = 'PENDING'/)
              assert.match(sql, /FOR UPDATE SKIP LOCKED/)
              return [{
                id: 'asset-1',
                object_key: 'mip/development/app/ai/user/audio.mp3',
                cloud_file_id: 'cloud://env/mip/development/app/ai/user/audio.mp3',
              }]
            }
            assert.match(sql, /SET status = 'PENDING', updated_at = \?/)
            assert.equal(params[0] instanceof Date, true)
            assert.deepEqual(params.slice(1), [APP_ID, USER_ID, 'asset-1'])
            return { affectedRows: 1 }
          },
        })
      },
    })
    const assets = await repository.leaseAudioCleanup(APP_ID, USER_ID, 3)
    assert.equal(assets.length, 1)
    assert.equal(calls.length, 2)
    assert.equal(assets[0].lease_updated_at instanceof Date, true)
  })

  it('marks metadata deleted only while the same cleanup lease is held', async () => {
    const calls = []
    const repository = createAiRepository({
      async query(sql, params) {
        calls.push({ sql, params })
        return { affectedRows: 1 }
      },
    })
    const leaseUpdatedAt = new Date('2026-08-24T00:00:00.000Z')
    assert.equal(await repository.markAudioDeleted(APP_ID, USER_ID, 'asset-1', leaseUpdatedAt), true)
    assert.match(calls[0].sql, /status = 'PENDING' AND updated_at = \?/)
    assert.deepEqual(calls[0].params, [APP_ID, USER_ID, 'asset-1', leaseUpdatedAt])
    await assert.rejects(
      () => repository.markAudioDeleted(APP_ID, USER_ID, 'asset-1', 'stale'),
      /VALIDATION_FAILED/,
    )
  })
})
