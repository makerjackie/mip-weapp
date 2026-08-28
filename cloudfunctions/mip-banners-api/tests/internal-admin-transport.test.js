'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const {
  ACTION_SPECS,
  BANNER_ADMIN_PROTOCOL,
  BANNER_ADMIN_TRANSPORT,
  createInternalBannerHandler,
  signBannerAdminRequest,
  verifyBannerAdminRequest,
} = require('../lib/internal-admin-transport')

const SECRET = 'banner-admin-hmac-secret-with-at-least-32-characters'
const APP_ID = 'wx1234567890abcdef'
const USER_ID = '10000000-0000-4000-8000-000000000001'
const NOW = 1_700_000_000_000

function signed(overrides = {}) {
  const request = {
    transport: BANNER_ADMIN_TRANSPORT,
    protocol: BANNER_ADMIN_PROTOCOL,
    timestamp: NOW,
    nonce: 'nonce-abcdefghijklmnopqrstuvwxyz',
    appId: APP_ID,
    actorUserId: USER_ID,
    action: 'admin.list',
    input: { filters: { status: 'ACTIVE', query: '活动' } },
    sourceFunction: 'mip-admin-api',
    ...overrides,
  }
  request.signature = signBannerAdminRequest(request, SECRET)
  return request
}

describe('Banner internal admin transport', () => {
  it('accepts only the seven trusted internal actions', () => {
    assert.deepEqual(Object.keys(ACTION_SPECS).sort(), [
      'admin.getSession', 'admin.list', 'admin.get', 'admin.save',
      'admin.changeStatus', 'admin.move', 'admin.delete',
    ].sort())
  })

  it('authenticates AppID and caller facts before rechecking admin readiness', async () => {
    const calls = []
    const handler = createInternalBannerHandler({
      secret: SECRET,
      allowedAppIds: new Set([APP_ID]),
      now: () => NOW,
      async assertAdminReady(caller) { calls.push({ gate: caller }) },
      service: {
        async listAdmin(caller, input) {
          calls.push({ service: { caller, input } })
          return { items: [], truncated: false }
        },
      },
    })
    const result = await handler({
      ...signed(),
      userInfo: { openId: 'framework-only' },
      tcbContext: { requestId: 'framework-only' },
    })

    assert.deepEqual(result, { ok: true, data: { items: [], truncated: false } })
    assert.deepEqual(calls, [
      { gate: { appId: APP_ID, userId: USER_ID } },
      {
        service: {
          caller: { appId: APP_ID, userId: USER_ID },
          input: { filters: { status: 'ACTIVE', query: '活动' } },
        },
      },
    ])
  })

  it('rejects signed AppID, source, time, action, and input drift before service dispatch', async () => {
    let gated = false
    let dispatched = false
    const handler = createInternalBannerHandler({
      secret: SECRET,
      allowedAppIds: new Set([APP_ID]),
      now: () => NOW,
      async assertAdminReady() { gated = true },
      service: new Proxy({}, {
        get() { return async () => { dispatched = true } },
      }),
    })
    const cases = [
      signed({ appId: 'wx-other' }),
      signed({ sourceFunction: 'mip-other-api' }),
      signed({ timestamp: NOW - 60_001 }),
      signed({ action: 'admin.dropAll', input: {} }),
      signed({ input: { filters: { status: 'ACTIVE', hidden: true } } }),
      signed({ action: 'admin.save', input: { banner: { title: '活动', ownerUserId: 'forged' } } }),
      signed({ browserControlledField: true }),
    ]

    for (const request of cases) {
      const result = await handler(request)
      assert.equal(result.ok, false)
      assert.equal(result.error.code, 'AUTH_REQUIRED')
    }
    assert.equal(gated, false)
    assert.equal(dispatched, false)
  })

  it('rejects tampering and a missing allowlist or HMAC configuration', () => {
    const tampered = signed()
    tampered.input.filters.query = '篡改'
    for (const [request, options, error] of [
      [tampered, { secret: SECRET, allowedAppIds: new Set([APP_ID]), now: () => NOW }, 'AUTH_REQUIRED'],
      [signed(), { secret: SECRET, allowedAppIds: new Set(), now: () => NOW }, 'AUTH_REQUIRED'],
      [signed(), { secret: '', allowedAppIds: new Set([APP_ID]), now: () => NOW }, 'BANNERS_INTERNAL_AUTH_CONFIG_REQUIRED'],
    ]) {
      assert.throws(() => verifyBannerAdminRequest(request, options), new RegExp(error))
    }
  })

  it('never accepts an unsigned internal-shaped request as a trusted administrator', async () => {
    let gated = false
    const handler = createInternalBannerHandler({
      service: {},
      secret: SECRET,
      allowedAppIds: new Set([APP_ID]),
      now: () => NOW,
      async assertAdminReady() { gated = true },
    })
    const request = signed()
    delete request.signature
    const result = await handler(request)

    assert.equal(result.ok, false)
    assert.equal(result.error.code, 'AUTH_REQUIRED')
    assert.equal(gated, false)
  })
})
