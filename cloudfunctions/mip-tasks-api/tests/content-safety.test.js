'use strict'
const assert = require('node:assert/strict')
const { it } = require('node:test')
const { createContentSafety } = require('../domain/content-safety')
const caller = { appId: 'wx-trusted', openId: 'authenticated-wechat-user' }
it('uses the configured HTTP checker for internal calls without a cloud-call token', async () => {
  const seen = []
  const safety = createContentSafety({ openapi: { security: { msgSecCheck: async () => { throw new Error('native token absent') } } } }, { appId: caller.appId, checker: async input => { seen.push(input); return { errcode: 0, result: { suggest: 'pass' } } } })
  await safety.assertSafe(caller, ['task', 'purpose'])
  assert.equal(seen[0].openid, caller.openId)
  assert.equal(seen[0].content, 'task\npurpose')
  await assert.rejects(safety.assertSafe({ appId: 'other', openId: caller.openId }, ['task']), /SERVICE_UNAVAILABLE/)
  await assert.rejects(safety.assertSafe({ appId: caller.appId }, ['task']), /AUTH_REQUIRED/)
})
it('checks text beyond the old 4000-character truncation and fails closed on rejection', async () => {
  const seen = []
  const safety = createContentSafety(null, { appId: caller.appId, checker: async input => { seen.push(input.content); return { errcode: 0, result: { suggest: input.content.includes('rejected-tail') ? 'risky' : 'pass' } } } })
  await assert.rejects(safety.assertSafe(caller, ['a'.repeat(4500) + 'rejected-tail']), /CONTENT_REJECTED/)
  assert.equal(seen.some(text => text.includes('rejected-tail')), true)
  assert.equal(seen.every(text => Array.from(text).length <= 2000), true)
})
it('does not fall back to an unchecked write if the provider fails', async () => {
  const safety = createContentSafety(null, { appId: caller.appId, checker: async () => { throw new Error('provider transport failed') } })
  await assert.rejects(safety.assertSafe(caller, ['task']), /SERVICE_UNAVAILABLE/)
})
