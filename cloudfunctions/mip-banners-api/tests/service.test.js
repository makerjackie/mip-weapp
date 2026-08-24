'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const { createBannerService } = require('../domain/service')

const caller = {
  appId: 'wx-app',
  userId: '10000000-0000-4000-8000-000000000001',
  openId: 'openid',
}

test('save authorizes Banner capability before checking public text', async () => {
  let safetyCalled = false
  const service = createBannerService({
    getAdminSession: async () => { throw new Error('FORBIDDEN') },
    save: async () => { throw new Error('unexpected save') },
  }, {
    async assertSafe() { safetyCalled = true },
  })
  await assert.rejects(
    service.save(caller, { banner: { title: '活动头图', accessibilityLabel: '活动信息' } }),
    /FORBIDDEN/,
  )
  assert.equal(safetyCalled, false)
})

test('activation checks the current persisted public text before changing status', async () => {
  const calls = []
  const service = createBannerService({
    getAdmin: async () => ({ title: '活动头图', accessibilityLabel: '活动信息' }),
    changeStatus: async () => {
      calls.push('change')
      return { status: 'ACTIVE' }
    },
  }, {
    async assertSafe(received, values) {
      assert.equal(received, caller)
      assert.deepEqual(values, ['活动头图', '活动信息'])
      calls.push('safety')
    },
  })
  assert.deepEqual(await service.changeStatus(caller, { status: 'ACTIVE' }), { status: 'ACTIVE' })
  assert.deepEqual(calls, ['safety', 'change'])
})
