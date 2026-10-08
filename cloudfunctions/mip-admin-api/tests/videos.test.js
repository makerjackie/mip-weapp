'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const { CAPABILITIES } = require('../domain/capabilities')
const { createVideos, videoDraft } = require('../domain/videos')
const { createVideoRepository } = require('../domain/repositories/videos')

const APP_ID = 'wx-videos-test'
const USER_ID = '11111111-1111-4111-8111-111111111111'
const VIDEO_ID = '42'
const COVER_ASSET_ID = 'asset-1'

function codeError(code) {
  return Object.assign(new Error(code), { code })
}

function access(calls = []) {
  return {
    async session(value) {
      calls.push('session')
      return {
        caller: value,
        bindings: [{ roleKey: 'PLATFORM_OPERATIONS', scopeType: 'PLATFORM', scopeId: null }],
      }
    },
    mutationAuthorization(grant, capability) {
      calls.push('authorize-mutation')
      assert.equal(capability, CAPABILITIES.EVENTS_RECAPS_MANAGE)
      return { capability, effectiveGrant: grant }
    },
    audit(context, grant, input) {
      return { appId: context.caller.appId, actorUserId: context.caller.userId, ...input }
    },
  }
}

function repository(overrides = {}) {
  return {
    async listVideos() { return { items: [], nextCursor: null } },
    async saveVideo() { throw new Error('unexpected saveVideo call') },
    async changeVideoStatus() { throw new Error('unexpected changeVideoStatus call') },
    ...overrides,
  }
}

describe('admin video recap destinations', () => {
  it('requires a sph finder user name and treats an empty feed id as profile jump', () => {
    const draft = videoDraft({ title: 'MIP 反人性早会', coverAssetId: COVER_ASSET_ID, finderUserName: 'sphMIP2026', feedId: '', status: 'PUBLISHED' })
    assert.deepEqual(draft, {
      title: 'MIP 反人性早会',
      coverAssetId: COVER_ASSET_ID,
      finderUserName: 'sphMIP2026',
      feedId: null,
      status: 'PUBLISHED',
    })
    for (const finderUserName of ['invalid-finder', 'sph has space', '']) {
      assert.throws(() => videoDraft({ title: 't', coverAssetId: COVER_ASSET_ID, finderUserName }), /VALIDATION_FAILED|视频号/)
    }
    assert.throws(() => videoDraft({ title: 't', coverAssetId: COVER_ASSET_ID, finderUserName: 'sphMIP2026', feedId: 'bad feed id' }), /VALIDATION_FAILED|动态/)
  })

  it('passes the channels draft through save with content safety on the title only', async () => {
    const calls = []
    const saved = []
    const safetyInputs = []
    const service = createVideos({
      access: access(calls),
      repository: repository({ async saveVideo(input) { saved.push(input); return { videoId: VIDEO_ID, status: input.draft.status, version: 1 } } }),
      contentSafety: async input => {
        safetyInputs.push(input)
        return input.title === 'MIP 反人性早会' ? 'PASSED' : 'REJECTED'
      },
    })
    const result = await service.saveVideo({ appId: APP_ID }, {
      title: 'MIP 反人性早会', coverAssetId: COVER_ASSET_ID, finderUserName: 'sphMIP2026', feedId: 'feed-token-1', status: 'PUBLISHED', idempotencyKey: 'req-1',
    })
    assert.equal(result.videoId, VIDEO_ID)
    assert.equal(saved[0].draft.feedId, 'feed-token-1')
    assert.equal(saved[0].contentSafetyStatus, 'APPROVED')
    assert.deepEqual(safetyInputs, [{ title: 'MIP 反人性早会' }])
    await assert.rejects(
      service.saveVideo({ appId: APP_ID }, { title: 't', coverAssetId: COVER_ASSET_ID, finderUserName: 'sphRejected', status: 'PUBLISHED', idempotencyKey: 'req-2' }),
      error => error.code === 'CONTENT_SAFETY_REQUIRED',
    )
  })

  it('writes finder/feed columns with CAS and keeps legacy rows unpublishable without a finder', async () => {
    const calls = []
    const tx = {
      async one(sql, params) {
        calls.push({ type: 'lock', sql, params })
        return sql.includes('mip_media_assets')
          ? { id: COVER_ASSET_ID }
          : { video_id: VIDEO_ID, title: '旧回顾', cover_asset_id: COVER_ASSET_ID, finder_user_name: 'sphMIP2026', feed_id: null, status: 'UNPUBLISHED', version: 3 }
      },
      async query(sql, params) {
        calls.push({ type: sql.includes('UPDATE') ? 'update' : 'insert', sql, params })
        return { affectedRows: 1 }
      },
    }
    const database = { async transaction(work) { return work(tx) } }
    const repository = createVideoRepository(database, {
      lockMutationAuthorization: async (tx, input) => input.authorization,
      assertMutationScope() {},
      writeAudit: async (tx, audit) => { calls.push({ type: 'audit', audit }) },
    })
    const result = await repository.saveVideo({
      appId: APP_ID,
      actorUserId: USER_ID,
      videoId: VIDEO_ID,
      expectedVersion: 3,
      idempotencyKey: '',
      contentSafetyStatus: 'APPROVED',
      authorization: { capability: CAPABILITIES.EVENTS_RECAPS_MANAGE },
      audit: () => ({ resourceId: VIDEO_ID }),
      draft: videoDraft({ title: '新回顾', coverAssetId: COVER_ASSET_ID, finderUserName: 'sphMIP2026', feedId: 'feed-token-1', status: 'PUBLISHED' }),
    })
    assert.equal(result.version, 4)
    const update = calls.find(call => call.type === 'update')
    assert.match(update.sql, /finder_user_name = \?, feed_id = \?/)
    assert.deepEqual(update.params, ['新回顾', COVER_ASSET_ID, 'sphMIP2026', 'feed-token-1', 'PUBLISHED', 'APPROVED', APP_ID, VIDEO_ID, 3])

    const legacyTx = {
      async one(sql) {
        return sql.includes('mip_media_assets')
          ? { id: COVER_ASSET_ID }
          : { video_id: '7', title: '旧数据', cover_asset_id: COVER_ASSET_ID, finder_user_name: null, feed_id: null, status: 'DRAFT', version: 1 }
      },
      async query() { return { affectedRows: 1 } },
    }
    const legacyRepository = createVideoRepository({ async transaction(work) { return work(legacyTx) } }, {
      lockMutationAuthorization: async (tx, input) => input.authorization,
      assertMutationScope() {},
      writeAudit: async () => {},
    })
    await assert.rejects(
      legacyRepository.changeVideoStatus({
        appId: APP_ID, actorUserId: USER_ID, videoId: '7', expectedVersion: 1, status: 'PUBLISHED', idempotencyKey: '',
        authorization: {}, audit: {},
      }),
      /视频号/,
    )
  })
})
