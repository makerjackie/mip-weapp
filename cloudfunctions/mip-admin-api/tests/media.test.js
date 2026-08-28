'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const {
  MEDIA_ADMIN_OPERATION,
  MEDIA_ADMIN_PURPOSE_CAPABILITIES,
  createAdminMedia,
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

  it('rejects weaker and branch-scoped grants before invoking the media service', async () => {
    const bindings = [
      platformBinding(['events.read']),
      {
        roleKey: 'BRANCH_ADMIN',
        scopeType: 'BRANCH',
        scopeId: 'branch-a',
        capabilities: ['events.write'],
      },
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
})
