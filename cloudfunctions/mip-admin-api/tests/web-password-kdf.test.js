'use strict'
const assert = require('node:assert/strict')
const { it } = require('node:test')
const { createHmac, webcrypto } = require('node:crypto')
const { createWebPasswordKdfRoute } = require('../lib/web-password-kdf')
const { canonicalJson } = require('../lib/web-bff-auth')
const secret = 'synthetic-kdf-transport-test-secret-not-production'
function envelope(overrides = {}) {
  const value = { transport: 'MIP_WEB_PASSWORD_KDF_V1', appId: 'wx-test', nonce: 'a'.repeat(32), timestamp: 1000, pepperedPassword: 'c'.repeat(64), salt: 'd'.repeat(32), ...overrides }
  return { ...value, signature: createHmac('sha256', secret).update(canonicalJson(value)).digest('hex') }
}
function setup(replay = { consume: async () => {} }) {
  return createWebPasswordKdfRoute({ allowedAppIds: new Set(['wx-test']), replayGuard: replay, secret, now: () => 1000 })
}
it('derives exactly standard PBKDF2 SHA256 600k without raw password or user principal', async () => {
  const calls = []
  const result = await setup({ consume: async input => calls.push(input) })(envelope())
  const key = await webcrypto.subtle.importKey('raw', Buffer.from('c'.repeat(64)), 'PBKDF2', false, ['deriveBits'])
  const expected = await webcrypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: Buffer.from('d'.repeat(32)), iterations: 600_000 }, key, 256)
  assert.deepEqual(result, { ok: true, data: { derivedKey: Buffer.from(expected).toString('hex') } })
  assert.equal(calls[0].action, 'mip.internal.webPassword.derive')
  assert.equal(calls[0].principalIdentityKey.length, 64)
  assert.ok(!JSON.stringify(calls).includes('c'.repeat(64)))
})
it('rejects signature tampering, spoofed app, stale envelope, extra fields and cost manipulation', async () => {
  let consumed = 0
  const run = setup({ consume: async () => { consumed++ } })
  for (const event of [
    { ...envelope(), signature: '0'.repeat(64) }, envelope({ appId: 'wx-other' }),
    envelope({ timestamp: -100000 }), envelope({ password: 'must-not-be-accepted' }),
    envelope({ iterations: 1 }), envelope({ pepperedPassword: 'not-peppered' }), envelope({ salt: ['d'.repeat(32)] }),
  ]) {
    assert.equal((await run(event)).error.code, 'AUTH_REQUIRED')
  }
  assert.equal(consumed, 0)
})
it('fails closed on replay and unavailable replay store without returning hash', async () => {
  for (const message of ['WEB_BFF_REPLAYED', 'WEB_BFF_REPLAY_GUARD_UNAVAILABLE']) {
    const response = await setup({ consume: async () => { throw new Error(message) } })(envelope())
    assert.equal(response.ok, false)
    assert.equal(response.data, undefined)
  }
})
