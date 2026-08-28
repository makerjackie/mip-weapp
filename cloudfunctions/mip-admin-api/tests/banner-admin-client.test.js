'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const {
  DEFAULT_TIMEOUT_MS,
  OPERATION_SPECS,
  BANNER_ADMIN_TRANSPORT,
  boundedTimeout,
  createBannerAdminClient,
} = require('../lib/banner-admin-client')
const {
  verifyBannerAdminRequest,
} = require('../../mip-banners-api/lib/internal-admin-transport')

const SECRET = 'banner-admin-hmac-secret-with-at-least-32-characters'
const APP_ID = 'wx1234567890abcdef'
const USER_ID = '10000000-0000-4000-8000-000000000001'

function clientWith(cloud, extra = {}) {
  return createBannerAdminClient({
    cloud,
    secret: SECRET,
    now: () => 1_700_000_000_000,
    nonce: () => 'nonce-abcdefghijklmnopqrstuvwxyz',
    ...extra,
  })
}

describe('banner admin typed client', () => {
  it('exposes only the seven reviewed Banner operations', () => {
    assert.deepEqual(Object.keys(OPERATION_SPECS).sort(), [
      'mip.admin.banners.session',
      'mip.admin.banners.list',
      'mip.admin.banners.get',
      'mip.admin.banners.save',
      'mip.admin.banners.changeStatus',
      'mip.admin.banners.move',
      'mip.admin.banners.delete',
    ].sort())
  })

  it('signs a request authenticated by the Banner trusted adapter', async () => {
    let captured
    const client = clientWith({
      async callFunction(input) {
        captured = input
        const verified = verifyBannerAdminRequest(input.data, {
          secret: SECRET,
          allowedAppIds: new Set([APP_ID]),
          now: () => 1_700_000_000_000,
        })
        assert.equal(verified.action, 'admin.save')
        assert.deepEqual(verified.input, {
          bannerId: '20000000-0000-4000-8000-000000000001',
          expectedVersion: 2,
          idempotencyKey: 'banner-save-request-0001',
          banner: {
            title: '活动头图', accessibilityLabel: '活动信息',
            imageAssetId: '30000000-0000-4000-8000-000000000001',
            targetType: 'MINIPROGRAM_PATH', targetValue: '/pages/events/index',
          },
        })
        return { result: { ok: true, data: { version: 3 } } }
      },
    })
    const result = await client.execute({
      appId: APP_ID,
      actorUserId: USER_ID,
      action: 'mip.admin.banners.save',
      input: {
        bannerId: '20000000-0000-4000-8000-000000000001',
        expectedVersion: 2,
        idempotencyKey: 'banner-save-request-0001',
        banner: {
          title: '活动头图', accessibilityLabel: '活动信息',
          imageAssetId: '30000000-0000-4000-8000-000000000001',
          targetType: 'MINIPROGRAM_PATH', targetValue: '/pages/events/index',
        },
      },
    })

    assert.deepEqual(result, { version: 3 })
    assert.equal(captured.name, 'mip-banners-api')
    assert.equal(captured.data.transport, BANNER_ADMIN_TRANSPORT)
    assert.equal(captured.data.sourceFunction, 'mip-admin-api')
  })

  it('rejects unknown top-level and nested input fields before transport', async () => {
    let invoked = false
    const client = clientWith({ async callFunction() { invoked = true } })
    for (const request of [
      {
        action: 'mip.admin.banners.list',
        input: { filters: { query: '活动', hidden: true } },
      },
      {
        action: 'mip.admin.banners.save',
        input: { banner: { title: '活动', ownerUserId: 'forged' } },
      },
      {
        action: 'mip.admin.banners.get',
        input: { bannerId: 'banner', appId: 'forged' },
      },
    ]) {
      await assert.rejects(
        () => client.execute({ appId: APP_ID, actorUserId: USER_ID, ...request }),
        error => error.code === 'VALIDATION_FAILED',
      )
    }
    assert.equal(invoked, false)
  })

  it('fails closed for invalid identity, function configuration, action, and timeout bounds', async () => {
    const invalidTarget = clientWith({ async callFunction() {} }, { functionName: 'other-function' })
    await assert.rejects(
      () => invalidTarget.execute({
        appId: APP_ID, actorUserId: USER_ID,
        action: 'mip.admin.banners.list', input: {},
      }),
      error => error.code === 'BANNERS_DISPATCH_CONFIG_REQUIRED',
    )
    const client = clientWith({ async callFunction() {} })
    await assert.rejects(
      () => client.execute({
        appId: 'forged app', actorUserId: USER_ID,
        action: 'mip.admin.banners.list', input: {},
      }),
      error => error.code === 'AUTH_REQUIRED',
    )
    await assert.rejects(
      () => client.execute({
        appId: APP_ID, actorUserId: USER_ID,
        action: 'mip.admin.banners.dropAll', input: {},
      }),
      error => error.code === 'BANNERS_OPERATION_NOT_ALLOWED',
    )
    assert.equal(boundedTimeout(250), 250)
    assert.equal(boundedTimeout(50_000), 50_000)
    assert.equal(boundedTimeout(249), DEFAULT_TIMEOUT_MS)
    assert.equal(boundedTimeout(50_001), DEFAULT_TIMEOUT_MS)
  })

  it('fails closed when the configured Banner function exceeds its timeout', async () => {
    const client = clientWith({
      async callFunction() {
        await new Promise(resolve => setTimeout(resolve, 300))
        return { result: { ok: true, data: {} } }
      },
    }, { timeoutMs: 250 })
    await assert.rejects(
      () => client.execute({
        appId: APP_ID,
        actorUserId: USER_ID,
        action: 'mip.admin.banners.list',
        input: {},
      }),
      error => error.code === 'BANNERS_DISPATCH_UNAVAILABLE' && error.retryable === true,
    )
  })
})
