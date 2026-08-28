'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const { createAdminBanners } = require('../domain/banners')

const caller = {
  appId: 'wx-browser-value',
  openId: 'openid-from-trusted-principal',
  identityKey: 'untrusted-browser-value',
}

function accessWith(bindings) {
  return {
    async session(received) {
      assert.equal(received, caller)
      return {
        caller: {
          appId: 'wx-server-app',
          userId: '10000000-0000-4000-8000-000000000001',
        },
        bindings,
      }
    },
  }
}

describe('admin Banner adapter authorization', () => {
  it('rechecks platform banners.manage and forwards only resolved identity', async () => {
    const calls = []
    const adapter = createAdminBanners({
      access: accessWith([{
        roleKey: 'PLATFORM_OPERATIONS', scopeType: 'PLATFORM', scopeId: null,
        capabilities: ['banners.manage'],
      }]),
      client: { async execute(input) { calls.push(input); return { items: [] } } },
    })
    const result = await adapter.listBanners(caller, { filters: { query: '活动' } })

    assert.deepEqual(result, { items: [] })
    assert.deepEqual(calls, [{
      appId: 'wx-server-app',
      actorUserId: '10000000-0000-4000-8000-000000000001',
      actorOpenId: 'openid-from-trusted-principal',
      action: 'mip.admin.banners.list',
      input: { filters: { query: '活动' } },
    }])
  })

  it('rejects a branch grant or missing capability before invoking Banner service', async () => {
    for (const binding of [
      {
        roleKey: 'BRANCH_ADMIN', scopeType: 'BRANCH', scopeId: 'branch-a',
        capabilities: ['banners.manage'],
      },
      {
        roleKey: 'PLATFORM_OPERATIONS', scopeType: 'PLATFORM', scopeId: null,
        capabilities: ['events.read'],
      },
    ]) {
      let invoked = false
      const adapter = createAdminBanners({
        access: accessWith([binding]),
        client: { async execute() { invoked = true } },
      })
      await assert.rejects(
        () => adapter.deleteBanner(caller, { bannerId: 'banner-a', expectedVersion: 1 }),
        error => error.code === 'FORBIDDEN' && error.message === 'FORBIDDEN',
      )
      assert.equal(invoked, false)
    }
  })
})
