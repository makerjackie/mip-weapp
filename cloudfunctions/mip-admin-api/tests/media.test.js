'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const {
  MEDIA_ADMIN_OPERATION,
  MEDIA_ADMIN_PURPOSE_CAPABILITIES,
  MEDIA_ADMIN_TEMPURLS_OPERATION,
  TEMPURLS_MAX_FILE_IDS,
  createAdminMedia,
  normalizeTempUrlsInput,
} = require('../domain/media')
const {
  MEDIA_ADMIN_PURPOSE_CAPABILITIES: CLIENT_PURPOSE_CAPABILITIES,
} = require('../lib/media-admin-client')
const {
  MEDIA_ADMIN_PURPOSE_CAPABILITIES: TARGET_PURPOSE_CAPABILITIES,
} = require('../../mip-media-api/lib/internal-admin-transport')

const caller = { appId: 'wx-browser-value', identityKey: 'untrusted-browser-value' }
const actorUserId = '10000000-0000-4000-8000-000000000001'
const imageBase64 = 'image-content-is-validated-by-the-typed-client'

function accessWith(bindings) {
  return {
    async session(received) {
      assert.equal(received, caller)
      return {
        caller: { appId: 'wx-server-app', userId: actorUserId },
        bindings,
      }
    },
  }
}

function platformBinding(capabilities) {
  return {
    roleKey: 'PLATFORM_OPERATIONS',
    scopeType: 'PLATFORM',
    scopeId: null,
    capabilities,
  }
}

describe('admin media adapter authorization', () => {
  it('keeps the purpose capability map identical across both trusted transports', () => {
    assert.deepEqual(MEDIA_ADMIN_PURPOSE_CAPABILITIES, CLIENT_PURPOSE_CAPABILITIES)
    assert.deepEqual(MEDIA_ADMIN_PURPOSE_CAPABILITIES, TARGET_PURPOSE_CAPABILITIES)
  })

  it('maps every purpose to its exact platform capability and forwards only resolved identity', async () => {
    for (const [purpose, capability] of Object.entries(MEDIA_ADMIN_PURPOSE_CAPABILITIES)) {
      const calls = []
      const adapter = createAdminMedia({
        access: accessWith([platformBinding([capability])]),
        client: { async execute(input) { calls.push(input); return { assetId: `${purpose}-asset` } } },
      })
      const result = await adapter.uploadMediaImage(caller, { purpose, imageBase64 })

      assert.deepEqual(result, { assetId: `${purpose}-asset` })
      assert.deepEqual(calls, [{
        appId: 'wx-server-app',
        actorUserId,
        action: MEDIA_ADMIN_OPERATION,
        input: { purpose, imageBase64 },
      }])
    }
  })

  it('rejects weaker grants before invoking the media service', async () => {
    const bindings = [
      platformBinding(['events.read']),
    ]
    for (const binding of bindings) {
      let invoked = false
      const adapter = createAdminMedia({
        access: accessWith([binding]),
        client: { async execute() { invoked = true } },
      })
      await assert.rejects(
        () => adapter.uploadMediaImage(caller, { purpose: 'EVENT_COVER', imageBase64 }),
        error => error.code === 'FORBIDDEN' && error.message === 'FORBIDDEN',
      )
      assert.equal(invoked, false)
    }
  })

  it('does not accept caller-selected capability, unknown fields, or unknown purposes', async () => {
    let invoked = false
    const adapter = createAdminMedia({
      access: accessWith([platformBinding(['banners.manage'])]),
      client: { async execute() { invoked = true } },
    })
    await assert.rejects(
      () => adapter.uploadMediaImage(caller, {
        purpose: 'BANNER', imageBase64, capability: 'events.read',
      }),
      error => error.code === 'VALIDATION_FAILED',
    )
    await assert.rejects(
      () => adapter.uploadMediaImage(caller, { purpose: 'AVATAR', imageBase64 }),
      error => error.code === 'PURPOSE_INVALID',
    )
    assert.equal(invoked, false)
  })

  it('resolves temp urls for any single MEDIA capability and returns only https entries', async () => {
    const calls = []
    const adapter = createAdminMedia({
      access: accessWith([platformBinding(['users.fields.edit', 'events.write'])]),
      client: {
        async execute() {},
        async tempFileUrls(input) {
          calls.push(input)
          return { urls: {
            'cloud://a.png': 'https://tmp/a?sign=x',
            'cloud://b.png': 'http://tmp/insecure',
            'cloud://c.png': 'javascript:alert(1)',
          } }
        },
      },
    })
    const result = await adapter.tempMediaFileUrls(caller, {
      fileIds: [' cloud://a.png ', 'cloud://a.png', 'cloud://b.png'],
    })
    // 输入去重保序转发；输出双保险只留 https 临时地址。
    assert.deepEqual(calls, [{
      appId: 'wx-server-app',
      actorUserId,
      fileIds: ['cloud://a.png', 'cloud://b.png'],
    }])
    assert.deepEqual(result, { urls: { 'cloud://a.png': 'https://tmp/a?sign=x' } })
  })

  it('denies temp urls when no binding carries any MEDIA purpose capability', async () => {
    let invoked = false
    const adapter = createAdminMedia({
      access: accessWith([platformBinding(['events.read', 'users.fields.edit'])]),
      client: {
        async execute() {},
        async tempFileUrls() { invoked = true },
      },
    })
    await assert.rejects(
      () => adapter.tempMediaFileUrls(caller, { fileIds: ['cloud://a.png'] }),
      error => error.code === 'FORBIDDEN',
    )
    assert.equal(invoked, false)
  })

  it('rejects invalid temp-url input before capability and transport', async () => {
    let invoked = false
    const adapter = createAdminMedia({
      access: accessWith([platformBinding(['events.read'])]),
      client: {
        async execute() {},
        async tempFileUrls() { invoked = true },
      },
    })
    const cases = [
      {},
      { fileIds: [] },
      { fileIds: Array.from({ length: TEMPURLS_MAX_FILE_IDS + 1 }, (_, index) => `cloud://a${index}.png`) },
      { fileIds: ['https://tmp.example/a.png'] },
      { fileIds: ['cloud://a.png', 42] },
      { fileIds: ['cloud://a.png'], extra: true },
    ]
    for (const input of cases) {
      await assert.rejects(
        () => adapter.tempMediaFileUrls(caller, input),
        error => error.code === 'VALIDATION_FAILED',
      )
    }
    assert.equal(invoked, false)
    assert.equal(MEDIA_ADMIN_TEMPURLS_OPERATION, 'mip.admin.media.tempUrls')
    assert.deepEqual(
      normalizeTempUrlsInput({ fileIds: [' cloud://a.png ', 'cloud://a.png'] }),
      ['cloud://a.png'],
    )
  })
})
