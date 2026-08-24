'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const {
  buildCheckInCodeKey,
  buildInvitationCodeKey,
  createCheckInCodeAsset,
  createInvitationCodeAsset,
} = require('../lib/checkin-poster')

const env = {
  MIP_DEPLOYMENT_STAGE: 'test',
  MIP_MEDIA_SCOPE_SECRET: 'checkin-poster-media-scope-secret-more-than-32-characters',
}
const input = {
  appId: 'wx-app',
  eventId: '10000000-0000-4000-8000-000000000001',
  credentialId: '20000000-0000-4000-8000-000000000001',
  ownerUserId: '30000000-0000-4000-8000-000000000001',
  scene: 's1.abcdefghijk.lmnopqrstuv',
}

function pngBuffer() {
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(32),
  ])
}

function posterCloud(deleteFile) {
  return {
    openapi: { wxacode: { async getUnlimited() { return { buffer: pngBuffer() } } } },
    async uploadFile(options) { return { fileID: `cloud://env.test/${options.cloudPath}` } },
    ...(deleteFile ? { deleteFile } : {}),
  }
}

describe('MIP check-in mini-program code asset', () => {
  it('uses the isolated MIP stage and opaque AppID scope', () => {
    const key = buildCheckInCodeKey({ ...input, env })
    assert.match(key, /^mip\/test\/[0-9a-f]{24}\/checkin-posters\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.png$/)
    assert.equal(key.includes(input.appId), false)
  })

  it('uses a separate invitation object prefix and media purpose', async () => {
    const invitationId = '50000000-0000-4000-8000-000000000001'
    const key = buildInvitationCodeKey({
      appId: input.appId,
      eventId: input.eventId,
      invitationId,
      env,
    })
    assert.match(key, /^mip\/test\/[0-9a-f]{24}\/event-invitations\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.png$/)
    const calls = []
    const result = await createInvitationCodeAsset({
      appId: input.appId,
      eventId: input.eventId,
      invitationId,
      ownerUserId: input.ownerUserId,
      scene: 'i1.abcdefghijk.lmnopqrstuv',
      env,
      createId: () => '60000000-0000-4000-8000-000000000001',
      cloud: posterCloud(),
      database: {
        async query(sql, params) {
          calls.push({ sql, params })
          return { affectedRows: 1 }
        },
        async transaction(work) {
          return work({
            async one() { return { id: input.ownerUserId, status: 'ACTIVE' } },
            async query(sql, params) {
              calls.push({ sql, params })
              return { affectedRows: 1 }
            },
          })
        },
      },
    })
    assert.match(result.objectKey, /\/event-invitations\//)
    assert.ok(calls.some(call => call.params.includes('EVENT_INVITATION_CODE')))
  })

  it('generates, uploads, and records a bounded PNG', async () => {
    const png = pngBuffer()
    const calls = []
    const result = await createCheckInCodeAsset({
      ...input,
      env,
      createId: () => '40000000-0000-4000-8000-000000000001',
      cloud: {
        openapi: {
          wxacode: {
            async getUnlimited(options) {
              calls.push({ kind: 'code', options })
              return { buffer: png }
            },
          },
        },
        async uploadFile(options) {
          calls.push({ kind: 'upload', options })
          return { fileID: `cloud://env.test/${options.cloudPath}` }
        },
      },
      database: {
        async query(sql, params) {
          calls.push({ kind: 'pending', sql, params })
          return { affectedRows: 1 }
        },
        async transaction(work) {
          return work({
            async one(sql, params) {
              calls.push({ kind: 'user-lock', sql, params })
              return { id: input.ownerUserId, status: 'ACTIVE' }
            },
            async query(sql, params) {
              calls.push({ kind: 'database', sql, params })
              return { affectedRows: 1 }
            },
          })
        },
      },
    })
    assert.equal(result.codeUrl, `cloud://env.test/${result.objectKey}`)
    assert.deepEqual(calls[0].options, {
      scene: input.scene,
      page: 'packages/member/mip-events/detail/index',
      width: 430,
      checkPath: false,
      envVersion: 'develop',
    })
    assert.match(calls[1].options.cloudPath, /^mip\/test\//)
    assert.match(calls.find(call => call.kind === 'user-lock').sql, /FROM mip_users[\s\S]*FOR UPDATE/)
    assert.match(calls.find(call => call.kind === 'pending').sql, /owner_user_id[\s\S]*'PENDING'/)
    assert.match(calls.find(call => call.kind === 'database').sql, /status = 'READY'/)
  })

  it('keeps a PENDING cleanup fact when closure wins and the exact delete is uncertain', async () => {
    let status = null
    const database = {
      async query(sql) {
        if (sql.includes('INSERT INTO mip_media_assets')) status = 'PENDING'
        if (sql.includes("SET status = 'DELETED'")) status = 'DELETED'
        return { affectedRows: 1 }
      },
      async one() { return { owner_user_id: null, status } },
      async transaction(work) {
        return work({ async one() { return { id: input.ownerUserId, status: 'CLOSED' } } })
      },
    }
    await assert.rejects(() => createCheckInCodeAsset({
      ...input,
      env,
      createId: () => '40000000-0000-4000-8000-000000000001',
      cloud: posterCloud(async () => { throw new Error('STORAGE_TIMEOUT') }),
      database,
    }), /当前账号不能生成签到海报/)
    assert.equal(status, 'PENDING')
  })

  it('marks a failed poster upload DELETED only after an exact storage response', async () => {
    let status = null
    const database = {
      async query(sql) {
        if (sql.includes('INSERT INTO mip_media_assets')) status = 'PENDING'
        if (sql.includes("SET status = 'DELETED'")) status = 'DELETED'
        return { affectedRows: 1 }
      },
      async one() { return { owner_user_id: null, status } },
      async transaction(work) {
        return work({ async one() { return { id: input.ownerUserId, status: 'CLOSED' } } })
      },
    }
    await assert.rejects(() => createCheckInCodeAsset({
      ...input,
      env,
      createId: () => '40000000-0000-4000-8000-000000000001',
      cloud: posterCloud(async ({ fileList }) => ({
        fileList: [{ fileID: fileList[0], status: 0 }],
      })),
      database,
    }), /当前账号不能生成签到海报/)
    assert.equal(status, 'DELETED')
  })

  it('keeps a committed READY poster when the transaction result is uncertain', async () => {
    let status = null
    let deleteCalls = 0
    const database = {
      async query() {
        status = 'PENDING'
        return { affectedRows: 1 }
      },
      async one() { return { owner_user_id: input.ownerUserId, status } },
      async transaction(work) {
        await work({
          async one() { return { id: input.ownerUserId, status: 'ACTIVE' } },
          async query() {
            status = 'READY'
            return { affectedRows: 1 }
          },
        })
        throw new Error('COMMIT_RESULT_UNKNOWN')
      },
    }
    const result = await createCheckInCodeAsset({
      ...input,
      env,
      createId: () => '40000000-0000-4000-8000-000000000001',
      cloud: posterCloud(async () => { deleteCalls += 1 }),
      database,
    })
    assert.equal(result.assetId, '40000000-0000-4000-8000-000000000001')
    assert.equal(deleteCalls, 0)
  })
})
