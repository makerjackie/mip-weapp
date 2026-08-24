'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const jpeg = require('jpeg-js')
const { PNG } = require('pngjs')
const {
  decodeAndSanitizeImage,
  openApiChecker,
} = require('../domain/image')
const { assertOwnedMipFile, buildObjectKey, createMediaService } = require('../domain/service')
const { trustedWechatIdentity } = require('../lib/identity')
const { signMaintenanceRequest, verifyMaintenanceRequest } = require('../lib/internal-auth')

const APP_ID = 'wx1111111111111111'
const USER_ID = '11111111-1111-4111-8111-111111111111'
const ASSET_ID = '22222222-2222-4222-8222-222222222222'
const SECRET = 's'.repeat(48)

function pngBase64(width = 96, height = 96) {
  const png = new PNG({ width, height })
  png.data.fill(255)
  return PNG.sync.write(png).toString('base64')
}

function jpegBase64(width = 96, height = 96) {
  const data = Buffer.alloc(width * height * 4, 255)
  return jpeg.encode({ data, width, height }, 82).data.toString('base64')
}

function environment(stage = 'development') {
  return {
    MIP_DEPLOYMENT_STAGE: stage,
    MIP_MEDIA_SCOPE_SECRET: SECRET,
  }
}

describe('MIP media image boundary', () => {
  it('proves MySQL persistence before reporting healthy', async () => {
    const healthy = createMediaService({
      database: { one: async () => ({ ok: 1 }) },
      cloud: {},
    })
    await assert.doesNotReject(() => healthy.health())
    const unavailable = createMediaService({
      database: { one: async () => null },
      cloud: {},
    })
    await assert.rejects(() => unavailable.health(), /SERVICE_UNAVAILABLE/)
  })

  it('restricts Banner and task template uploads to current platform owner or operations accounts', async () => {
    const queries = []
    const service = createMediaService({
      database: {
        async one(sql, params) {
          queries.push({ sql, params })
          return null
        },
      },
      cloud: {},
      env: environment(),
    })
    await assert.rejects(() => service.uploadImage(
      { appId: APP_ID, userId: USER_ID },
      { purpose: 'BANNER', imageBase64: pngBase64(750, 300) },
    ), /FORBIDDEN/)
    assert.equal(queries.length, 1)
    assert.match(queries[0].sql, /PLATFORM_OWNER.*PLATFORM_OPERATIONS/s)
    assert.deepEqual(queries[0].params, [APP_ID, USER_ID])
    await assert.rejects(() => service.uploadImage(
      { appId: APP_ID, userId: USER_ID },
      { purpose: 'TASK_TEMPLATE', imageBase64: pngBase64(750, 300) },
    ), /FORBIDDEN/)
    assert.equal(queries.length, 2)
  })

  it('rejects an admin upload when the effective role policy removes its capability', async () => {
    const service = createMediaService({
      database: {
        async one(sql) {
          assert.match(sql, /LEFT JOIN mip_role_capability_policies/)
          return { role_key: 'PLATFORM_OPERATIONS', policy_capabilities_json: '[]' }
        },
      },
      cloud: {},
      env: environment(),
    })
    await assert.rejects(() => service.uploadImage(
      { appId: APP_ID, userId: USER_ID },
      { purpose: 'BANNER', imageBase64: pngBase64(750, 300) },
    ), /FORBIDDEN/)
  })

  it('rejects malformed and truncated image payloads', () => {
    assert.throws(() => decodeAndSanitizeImage('not-base64', 'AVATAR'), /IMAGE_INVALID/)
    const truncated = Buffer.from(pngBase64(), 'base64').subarray(0, 48).toString('base64')
    assert.throws(() => decodeAndSanitizeImage(truncated, 'AVATAR'), /IMAGE_INVALID/)
    assert.throws(() => decodeAndSanitizeImage(pngBase64(32, 32), 'AVATAR'), /IMAGE_DIMENSIONS_INVALID/)
    const truncatedJpeg = Buffer.from(jpegBase64(), 'base64').subarray(0, 64).toString('base64')
    assert.throws(() => decodeAndSanitizeImage(truncatedJpeg, 'AVATAR'), /IMAGE_INVALID/)
  })

  it('fully decodes and re-encodes a bounded JPEG', () => {
    const image = decodeAndSanitizeImage(jpegBase64(), 'AVATAR')
    assert.equal(image.contentType, 'image/jpeg')
    assert.equal(image.width, 96)
    assert.equal(image.height, 96)
    assert.equal(image.buffer[0], 0xff)
    assert.equal(image.buffer[1], 0xd8)
  })

  it('fails closed when WeChat image safety rejects or is unavailable', async () => {
    const image = decodeAndSanitizeImage(pngBase64(), 'AVATAR')
    await assert.rejects(
      () => openApiChecker({ openapi: { security: { imgSecCheck: async () => ({ errCode: 87014 }) } } })(image),
      /IMAGE_CONTENT_REJECTED/,
    )
    await assert.rejects(() => openApiChecker({})(image), /IMAGE_SAFETY_UNAVAILABLE/)
    await assert.rejects(
      () => openApiChecker({ openapi: { security: { imgSecCheck: async () => ({ errCode: '0' }) } } })(image),
      /IMAGE_CONTENT_REJECTED/,
    )
  })

  it('builds generated object keys inside the exact MIP stage and app scope', () => {
    const development = buildObjectKey({
      appId: APP_ID,
      userId: USER_ID,
      purpose: 'EVENT_COVER',
      assetId: ASSET_ID,
      extension: 'png',
      env: environment('development'),
    })
    const production = buildObjectKey({
      appId: APP_ID,
      userId: USER_ID,
      purpose: 'EVENT_COVER',
      assetId: ASSET_ID,
      extension: 'png',
      env: environment('production'),
    })
    const otherApp = buildObjectKey({
      appId: 'wx2222222222222222',
      userId: USER_ID,
      purpose: 'EVENT_COVER',
      assetId: ASSET_ID,
      extension: 'png',
      env: environment('development'),
    })
    assert.match(development, /^mip\/development\/[0-9a-f]{24}\/event-covers\/[0-9a-f]{24}\//)
    assert.match(production, /^mip\/production\/[0-9a-f]{24}\/event-covers\/[0-9a-f]{24}\//)
    assert.notEqual(development, production)
    assert.notEqual(development, otherApp)
    assert.equal(development.includes(APP_ID), false)
    assert.equal(development.includes(USER_ID), false)

    const eventAlbum = buildObjectKey({
      appId: APP_ID,
      userId: USER_ID,
      purpose: 'EVENT_ALBUM',
      assetId: ASSET_ID,
      extension: 'jpg',
      env: environment('test'),
    })
    assert.match(eventAlbum, /^mip\/test\/[0-9a-f]{24}\/event-album\/[0-9a-f]{24}\//)
  })

  it('removes the exact uploaded object when the initial tombstone insert is known to be absent', async () => {
    const uploads = []
    const deletes = []
    const database = {
      one: async () => null,
      async query(sql) {
        assert.match(sql, /INSERT INTO mip_media_assets/)
        throw new Error('DB_FAILED')
      },
      async transaction() {
        throw new Error('unexpected transaction')
      },
    }
    const cloud = {
      async uploadFile(input) {
        uploads.push(input)
        return { fileID: `cloud://env.mip/${input.cloudPath}` }
      },
      async deleteFile(input) {
        deletes.push(input)
        return { fileList: [{ fileID: input.fileList[0], status: 0 }] }
      },
    }
    const service = createMediaService({
      database,
      cloud,
      checker: async image => ({ ok: image.contentType === 'image/png' }),
      env: environment(),
      id: () => ASSET_ID,
    })
    await assert.rejects(
      () => service.uploadImage({ appId: APP_ID, userId: USER_ID }, {
        purpose: 'OPPORTUNITY_COVER',
        imageBase64: pngBase64(),
      }),
      /DB_FAILED/,
    )
    assert.equal(uploads.length, 1)
    assert.match(uploads[0].cloudPath, /^mip\/development\//)
    assert.equal(deletes.length, 1)
    assert.deepEqual(deletes[0].fileList, [`cloud://env.mip/${uploads[0].cloudPath}`])
  })

  it('keeps a PENDING cleanup fact when account closure wins and storage deletion fails', async () => {
    const events = []
    let status = null
    const database = {
      async query(sql) {
        if (sql.includes('INSERT INTO mip_media_assets')) {
          events.push('pending')
          status = 'PENDING'
          return { affectedRows: 1 }
        }
        if (sql.includes("SET status = 'DELETED'")) {
          status = 'DELETED'
          return { affectedRows: 1 }
        }
        throw new Error(`unexpected query: ${sql}`)
      },
      async one(sql) {
        assert.match(sql, /SELECT owner_user_id, status FROM mip_media_assets/)
        return { owner_user_id: null, status }
      },
      async transaction(work) {
        return work({
          async one(sql, params) {
            events.push('lock-user')
            assert.match(sql, /SELECT id, status FROM mip_users[\s\S]*FOR UPDATE/)
            assert.deepEqual(params, [APP_ID, USER_ID])
            return { id: USER_ID, status: 'CLOSED' }
          },
          async query() {
            throw new Error('unexpected activation')
          },
        })
      },
    }
    const cloud = {
      async uploadFile(input) {
        events.push('upload')
        return { fileID: `cloud://env.mip/${input.cloudPath}` }
      },
      async deleteFile() {
        events.push('delete')
        throw new Error('STORAGE_TIMEOUT')
      },
    }
    const service = createMediaService({
      database,
      cloud,
      checker: async () => ({ ok: true }),
      env: environment(),
      id: () => ASSET_ID,
    })
    await assert.rejects(
      () => service.uploadImage({ appId: APP_ID, userId: USER_ID }, {
        purpose: 'AVATAR',
        imageBase64: pngBase64(),
      }),
      /FORBIDDEN/,
    )
    assert.deepEqual(events, ['upload', 'pending', 'lock-user', 'delete'])
    assert.equal(status, 'PENDING')
  })

  it('marks the PENDING cleanup fact DELETED only after an exact delete response', async () => {
    let status = null
    const service = createMediaService({
      database: {
        async query(sql) {
          if (sql.includes('INSERT INTO mip_media_assets')) status = 'PENDING'
          if (sql.includes("SET status = 'DELETED'")) status = 'DELETED'
          return { affectedRows: 1 }
        },
        async one() { return { owner_user_id: null, status } },
        async transaction(work) {
          return work({
            async one() { return { id: USER_ID, status: 'CLOSED' } },
          })
        },
      },
      cloud: {
        async uploadFile(input) { return { fileID: `cloud://env.mip/${input.cloudPath}` } },
        async deleteFile({ fileList }) {
          return { fileList: [{ fileID: fileList[0], status: 0 }] }
        },
      },
      checker: async () => ({ ok: true }),
      env: environment(),
      id: () => ASSET_ID,
    })
    await assert.rejects(() => service.uploadImage({ appId: APP_ID, userId: USER_ID }, {
      purpose: 'AVATAR',
      imageBase64: pngBase64(),
    }), /FORBIDDEN/)
    assert.equal(status, 'DELETED')
  })

  it('activates a PENDING asset under the trusted owner before returning it', async () => {
    const writes = []
    const service = createMediaService({
      database: {
        async query(sql, params) {
          writes.push({ sql, params })
          return { affectedRows: 1 }
        },
        async transaction(work) {
          return work({
            async one(sql, params) {
              assert.match(sql, /SELECT id, status FROM mip_users[\s\S]*FOR UPDATE/)
              assert.deepEqual(params, [APP_ID, USER_ID])
              return { id: USER_ID, status: 'ACTIVE' }
            },
            async query(sql, params) {
              writes.push({ sql, params })
              return { affectedRows: 1 }
            },
          })
        },
      },
      cloud: {
        async uploadFile(input) { return { fileID: `cloud://env.mip/${input.cloudPath}` } },
        async deleteFile() { throw new Error('unexpected cleanup') },
      },
      checker: async () => ({ ok: true }),
      env: environment(),
      id: () => ASSET_ID,
    })
    const result = await service.uploadImage({ appId: APP_ID, userId: USER_ID }, {
      purpose: 'AVATAR',
      imageBase64: pngBase64(),
    })
    assert.match(writes[0].sql, /owner_user_id[\s\S]*'PENDING'/)
    assert.equal(writes[0].params[1], APP_ID)
    assert.equal(writes[0].params[2], 'AVATAR')
    assert.match(writes[1].sql, /SET owner_user_id = \?, status = 'READY'/)
    assert.deepEqual(writes[1].params, [USER_ID, APP_ID, ASSET_ID])
    assert.equal(result.assetId, ASSET_ID)
    assert.equal(result.imageUrl, `cloud://env.mip/${writes[0].params[3]}`)
  })

  it('recovers a committed READY upload instead of deleting it after an uncertain commit result', async () => {
    let deleteCalls = 0
    const service = createMediaService({
      database: {
        async query() { return { affectedRows: 1 } },
        async transaction(work) {
          await work({
            async one() { return { id: USER_ID, status: 'ACTIVE' } },
            async query() { return { affectedRows: 1 } },
          })
          throw new Error('COMMIT_RESULT_UNKNOWN')
        },
        async one() { return { owner_user_id: USER_ID, status: 'READY' } },
      },
      cloud: {
        async uploadFile(input) { return { fileID: `cloud://env.mip/${input.cloudPath}` } },
        async deleteFile() { deleteCalls += 1 },
      },
      checker: async () => ({ ok: true }),
      env: environment(),
      id: () => ASSET_ID,
    })
    const result = await service.uploadImage({ appId: APP_ID, userId: USER_ID }, {
      purpose: 'AVATAR',
      imageBase64: pngBase64(),
    })
    assert.equal(result.assetId, ASSET_ID)
    assert.equal(deleteCalls, 0)
  })
})

describe('MIP media trusted identity', () => {
  it('uses the shared-environment FROM identity and rejects non-allowlisted AppIDs', () => {
    const env = {
      MIP_ALLOWED_APP_IDS: APP_ID,
      MIP_IDENTITY_PEPPER: 'p'.repeat(48),
    }
    const identity = trustedWechatIdentity({
      FROM_APPID: APP_ID,
      FROM_OPENID: 'openid-a',
      APPID: 'wx2222222222222222',
      OPENID: 'openid-b',
    }, env)
    assert.equal(identity.appId, APP_ID)
    assert.equal(identity.identityKey.length, 64)
    assert.throws(() => trustedWechatIdentity({
      FROM_APPID: 'wx2222222222222222',
      FROM_OPENID: 'openid-b',
    }, env), /AUTH_REQUIRED/)
  })
})

describe('MIP media orphan maintenance', () => {
  it('leases only old unreferenced image assets and deletes them with an exact storage result', async () => {
    const calls = []
    const objectKey = buildObjectKey({
      appId: APP_ID,
      userId: USER_ID,
      purpose: 'OPPORTUNITY_COVER',
      assetId: ASSET_ID,
      extension: 'png',
      env: environment(),
    })
    const fileId = `cloud://env.mip/${objectKey}`
    const database = {
      async transaction(work) {
        return work({
          async query(sql, params) {
            calls.push({ sql, params })
            if (sql.includes('SELECT asset.id')) {
              assert.match(sql, /NOT EXISTS \(\s*SELECT 1 FROM mip_profiles/)
              assert.match(sql, /NOT EXISTS \(\s*SELECT 1 FROM mip_events/)
              assert.match(sql, /NOT EXISTS \(\s*SELECT 1 FROM mip_event_album_photos/)
              assert.match(sql, /photo\.status IN \('PENDING', 'PUBLISHED'\)/)
              assert.match(sql, /NOT EXISTS \(\s*SELECT 1 FROM mip_opportunities/)
              assert.match(sql, /NOT EXISTS \(\s*SELECT 1 FROM mip_super_cases/)
              assert.match(sql, /NOT EXISTS \(\s*SELECT 1 FROM mip_super_case_media/)
              assert.match(sql, /NOT EXISTS \(\s*SELECT 1 FROM mip_task_completions/)
              assert.match(sql, /NOT EXISTS \(\s*SELECT 1 FROM mip_task_cards/)
              assert.match(sql, /NOT EXISTS \(\s*SELECT 1 FROM mip_banners/)
              assert.match(sql, /mip_event_checkin_credentials credential/)
              assert.match(sql, /credential\.valid_until > UTC_TIMESTAMP/)
              assert.match(sql, /FOR UPDATE SKIP LOCKED/)
              assert.equal(params.at(-2), 48)
              assert.equal(params.at(-1), 5)
              return [{ id: ASSET_ID, object_key: objectKey, cloud_file_id: fileId }]
            }
            return { affectedRows: 1 }
          },
        })
      },
      async query(sql, params) {
        calls.push({ sql, params })
        return { affectedRows: 1 }
      },
    }
    const service = createMediaService({
      database,
      cloud: {
        async deleteFile() {
          return { fileList: [{ fileID: fileId, status: 0 }] }
        },
      },
      env: environment(),
    })
    assert.deepEqual(
      await service.cleanupOrphans(APP_ID, { limit: 5, minimumAgeHours: 48 }),
      { scanned: 1, deleted: 1, failed: 0 },
    )
    assert.equal(calls.some(call => call.sql.includes("SET status = 'PENDING'")), true)
    assert.equal(calls.some(call => call.sql.includes("SET status = 'DELETED'")), true)
  })

  it('keeps a deletion lease private without touching storage when the object leaves the owned MIP scope', async () => {
    const updates = []
    let deleteCalls = 0
    const database = {
      async transaction(work) {
        return work({
          async query(sql) {
            if (sql.includes('SELECT asset.id')) {
              return [{
                id: ASSET_ID,
                object_key: 'other-project/orphan.png',
                cloud_file_id: 'cloud://env.mip/other-project/orphan.png',
              }]
            }
            return { affectedRows: 1 }
          },
        })
      },
      async query(sql) {
        updates.push(sql)
        return { affectedRows: 1 }
      },
    }
    const service = createMediaService({
      database,
      cloud: {
        async deleteFile() {
          deleteCalls += 1
          return { fileList: [{ status: 0 }] }
        },
      },
      env: environment(),
    })
    assert.deepEqual(
      await service.cleanupOrphans(APP_ID, { limit: 1, minimumAgeHours: 24 }),
      { scanned: 1, deleted: 0, failed: 1 },
    )
    assert.equal(deleteCalls, 0)
    assert.equal(updates.some(sql => sql.includes("SET status = 'READY'")), false)
  })

  it('keeps a failed or ambiguous storage deletion retryable and never restores READY', async () => {
    const updates = []
    const events = []
    const objectKey = buildObjectKey({
      appId: APP_ID,
      userId: USER_ID,
      purpose: 'OPPORTUNITY_COVER',
      assetId: ASSET_ID,
      extension: 'png',
      env: environment(),
    })
    const fileId = `cloud://env.mip/${objectKey}`
    let deleteCalls = 0
    const database = {
      async transaction(work) {
        return work({
          async query(sql) {
            if (sql.includes('SELECT asset.id')) {
              return [{ id: ASSET_ID, object_key: objectKey, cloud_file_id: fileId }]
            }
            if (sql.includes("SET status = 'PENDING'")) events.push('lease')
            return { affectedRows: 1 }
          },
        })
      },
      async query(sql) {
        updates.push(sql)
        return { affectedRows: 1 }
      },
    }
    const service = createMediaService({
      database,
      cloud: {
        async deleteFile() {
          deleteCalls += 1
          events.push('storage')
          throw new Error('STORAGE_TIMEOUT')
        },
      },
      env: environment(),
    })
    assert.deepEqual(
      await service.cleanupOrphans(APP_ID, { limit: 1, minimumAgeHours: 24 }),
      { scanned: 1, deleted: 0, failed: 1 },
    )
    assert.equal(deleteCalls, 1)
    assert.deepEqual(events, ['lease', 'storage'])
    assert.equal(updates.some(sql => sql.includes("SET status = 'READY'")), false)
    assert.equal(updates.some(sql => sql.includes("SET status = 'DELETED'")), false)
  })

  it('requires the CloudBase file ID to contain the exact owned object key', () => {
    const objectKey = buildObjectKey({
      appId: APP_ID,
      userId: USER_ID,
      purpose: 'AVATAR',
      assetId: ASSET_ID,
      extension: 'png',
      env: environment(),
    })
    assert.equal(assertOwnedMipFile({
      appId: APP_ID,
      objectKey,
      fileId: `cloud://env.mip/${objectKey}`,
      env: environment(),
    }), true)
    assert.throws(() => assertOwnedMipFile({
      appId: APP_ID,
      objectKey,
      fileId: 'cloud://env.mip/other-project/file.png',
      env: environment(),
    }), /MEDIA_FILE_INVALID/)
  })

  it('requires a current app-scoped HMAC before cleanup can run', () => {
    const secret = 'media-maintenance-secret-with-at-least-32-characters'
    const request = {
      action: 'cleanupOrphans',
      appId: APP_ID,
      limit: 10,
      minimumAgeHours: 24,
      timestamp: 1_800_000_000_000,
    }
    const signature = signMaintenanceRequest(request, secret)
    assert.doesNotThrow(() => verifyMaintenanceRequest({ ...request, signature }, {
      allowedAppIds: new Set([APP_ID]),
      secret,
      now: () => request.timestamp,
    }))
    assert.throws(() => verifyMaintenanceRequest({ ...request, limit: 20, signature }, {
      allowedAppIds: new Set([APP_ID]),
      secret,
      now: () => request.timestamp,
    }), /MEDIA_CLEANUP_FORBIDDEN/)
  })
})
