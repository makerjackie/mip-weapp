'use strict'
const assert = require('node:assert/strict')
const test = require('node:test')
const { createContentSafety, contentSafetyFailureDetails } = require('../domain/content-safety')
const caller = { openId: 'test-private-openid' }
const client = checker => ({ openapi: { security: { msgSecCheck: checker } } })

test('content checks fail closed with a distinct error when the provider is unavailable', async () => {
  await assert.rejects(createContentSafety({}).assertSafe(caller, ['demo']), error => {
    assert.equal(error.message, 'CONTENT_SAFETY_UNAVAILABLE')
    assert.deepEqual(contentSafetyFailureDetails(error), { providerCode: 'CHECKER_UNAVAILABLE' })
    return true
  })
  for (const code of [-604102, '40003', 'ETIMEDOUT']) {
    const safety = createContentSafety(client(async () => { throw Object.assign(new Error('private content and URL'), { errCode: code, openid: caller.openId }) }))
    await assert.rejects(safety.assertSafe(caller, ['private body']), error => {
      assert.equal(error.message, 'CONTENT_SAFETY_UNAVAILABLE')
      assert.deepEqual(contentSafetyFailureDetails(error), { providerCode: code === '40003' ? 40003 : code })
      assert.equal(JSON.stringify(contentSafetyFailureDetails(error)).includes('private'), false)
      return true
    })
  }
})

test('only numeric or allowlisted provider codes are exposed, never raw errors or identity', () => {
  for (const code of ['https://private.example/token', 'test-private-openid', '40003 trailing private text', {}, Infinity, 2147483648]) {
    assert.deepEqual(contentSafetyFailureDetails({ message: 'CONTENT_SAFETY_UNAVAILABLE', providerCode: code }), { providerCode: 'UPSTREAM_ERROR' })
  }
  assert.deepEqual(contentSafetyFailureDetails(new Error('another private error')), {})
})

test('provider failure is distinguished from rejected content and only pass is accepted', async () => {
  await assert.rejects(createContentSafety(client(async () => { throw Object.assign(new Error('provider rejection'), { errCode: 87014 }) })).assertSafe(caller, ['demo']), /CONTENT_REJECTED/)
  for (const result of [undefined, { errCode: 40003 }, { errCode: -1 }]) {
    await assert.rejects(createContentSafety(client(async () => result)).assertSafe(caller, ['demo']), /CONTENT_SAFETY_UNAVAILABLE/)
  }
  for (const result of [{ errCode: 87014 }, { errCode: 0, result: { suggest: 'risky' } }, { errCode: 0 }]) {
    await assert.rejects(createContentSafety(client(async () => result)).assertSafe(caller, ['demo']), /CONTENT_REJECTED/)
  }
  await assert.doesNotReject(createContentSafety(client(async () => ({ errCode: 0, result: { suggest: 'pass' } }))).assertSafe(caller, ['demo']))
})
