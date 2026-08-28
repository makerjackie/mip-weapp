'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const { PNG } = require('pngjs')
const {
  MEDIA_ADMIN_ACTION,
  MEDIA_ADMIN_PROTOCOL,
  MEDIA_ADMIN_PURPOSE_CAPABILITIES,
  MEDIA_ADMIN_TRANSPORT,
  assertMediaAdminCapability,
  createInternalMediaHandler,
  inspectAdminImageInput,
  signMediaAdminRequest,
  verifyMediaAdminRequest,
} = require('../lib/internal-admin-transport')

const SECRET = 'media-admin-hmac-secret-with-at-least-32-characters'
const APP_ID = 'wx1234567890abcdef'
const USER_ID = '10000000-0000-4000-8000-000000000001'
const NOW = 1_700_000_000_000

function pngBase64(width = 96, height = 96) {
  const png = new PNG({ width, height })
  png.data.fill(255)
  return PNG.sync.write(png).toString('base64')
}

function request(input = { purpose: 'EVENT_COVER', imageBase64: pngBase64() }) {
  const value = {
    transport: MEDIA_ADMIN_TRANSPORT,
    protocol: MEDIA_ADMIN_PROTOCOL,
    timestamp: NOW,
    nonce: 'nonce-abcdefghijklmnopqrstuvwxyz',
    appId: APP_ID,
    actorUserId: USER_ID,
    capability: MEDIA_ADMIN_PURPOSE_CAPABILITIES[input.purpose],
    action: MEDIA_ADMIN_ACTION,
    input,
    sourceFunction: 'mip-admin-api',
  }
  return { ...value, signature: signMediaAdminRequest(value, SECRET) }
}

function verify(value) {
  return verifyMediaAdminRequest(value, {
    secret: SECRET,
    allowedAppIds: new Set([APP_ID]),
    now: () => NOW,
  })
}

describe('MIP media internal admin transport', () => {
  it('accepts only the reviewed image purposes and binds each purpose to one capability', () => {
    assert.deepEqual(MEDIA_ADMIN_PURPOSE_CAPABILITIES, {
      BANNER: 'banners.manage',
      EVENT_ALBUM: 'events.album.manage',
      EVENT_CONTENT: 'events.write',
      EVENT_COVER: 'events.write',
      OPPORTUNITY_COVER: 'opportunities.moderate',
      SUPER_CASE_COVER: 'userContent.moderate',
      SUPER_CASE_MEDIA: 'userContent.moderate',
      TASK_TEMPLATE: 'tasks.manage',
    })
    assert.deepEqual(inspectAdminImageInput(request().input), {
      width: 96,
      height: 96,
      capability: 'events.write',
    })
    for (const purpose of ['AVATAR', 'TASK_ATTACHMENT', 'CHECKIN_POSTER']) {
      assert.throws(
        () => inspectAdminImageInput({ purpose, imageBase64: pngBase64() }),
        /PURPOSE_INVALID/,
      )
    }
  })

  it('authenticates exact signed identity, capability, source, image bytes, MIME, and dimensions', () => {
    const valid = request()
    assert.equal(verify(valid).actorUserId, USER_ID)
    for (const forged of [
      { ...valid, appId: 'wx0000000000000000' },
      { ...valid, capability: 'users.fields.edit' },
      { ...valid, sourceFunction: 'mip-tasks-api' },
      { ...valid, unexpected: true },
      { ...valid, timestamp: NOW - 60_001 },
    ]) {
      assert.throws(() => verify(forged), /AUTH_REQUIRED/)
    }
    assert.throws(
      () => inspectAdminImageInput({ purpose: 'EVENT_COVER', imageBase64: Buffer.from('not an image').toString('base64') }),
      /IMAGE_INVALID/,
    )
    assert.throws(
      () => inspectAdminImageInput({ purpose: 'EVENT_COVER', imageBase64: pngBase64(32, 32) }),
      /IMAGE_DIMENSIONS_INVALID/,
    )
  })

  it('requires an active platform owner or operations binding with the signed capability', async () => {
    const queries = []
    await assert.doesNotReject(() => assertMediaAdminCapability({
      async query(sql, params) {
        queries.push({ sql, params })
        return [{
          role_key: 'PLATFORM_OPERATIONS',
          policy_capabilities_json: JSON.stringify(['events.write']),
        }]
      },
    }, verify(request())))
    assert.match(queries[0].sql, /u\.status = 'ACTIVE'/)
    assert.match(queries[0].sql, /scope_type = 'PLATFORM'/)
    assert.match(queries[0].sql, /PLATFORM_OWNER.*PLATFORM_OPERATIONS/s)
    assert.deepEqual(queries[0].params, [APP_ID, USER_ID])

    await assert.rejects(() => assertMediaAdminCapability({
      async query() {
        return [{ role_key: 'PLATFORM_OPERATIONS', policy_capabilities_json: '[]' }]
      },
    }, verify(request())), /FORBIDDEN/)
  })

  it('dispatches the verified actor to the existing upload service without changing its input', async () => {
    const calls = []
    const handler = createInternalMediaHandler({
      service: {
        async uploadImage(caller, input) {
          calls.push({ caller, input })
          return { assetId: 'asset-a', purpose: input.purpose }
        },
      },
      database: {
        async query() {
          return [{ role_key: 'PLATFORM_OWNER', policy_capabilities_json: null }]
        },
      },
      secret: SECRET,
      allowedAppIds: new Set([APP_ID]),
      now: () => NOW,
      failure(error) { return { ok: false, error: { code: error.message } } },
    })
    const value = request({ purpose: 'TASK_TEMPLATE', imageBase64: pngBase64(750, 300) })
    const result = await handler({ ...value, tcbContext: { injected: true } })
    assert.deepEqual(result, { ok: true, data: { assetId: 'asset-a', purpose: 'TASK_TEMPLATE' } })
    assert.deepEqual(calls, [{
      caller: { appId: APP_ID, userId: USER_ID },
      input: value.input,
    }])
  })
})
