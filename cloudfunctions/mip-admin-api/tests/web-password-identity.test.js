'use strict'
const assert = require('node:assert/strict')
const { it } = require('node:test')
const { createCipheriv, createHash, createHmac } = require('node:crypto')
const { createWebPasswordIdentity } = require('../lib/web-password-identity')
const { createWebBffRoute, signWebBffEnvelope } = require('../lib/web-bff-auth')
const secret = 'synthetic-secret-for-web-password-identity-tests'
const appId = 'wx-test'
const userId = 'test-user'
function ciphertext() {
  const key = createHmac('sha256', createHash('sha256').update(secret).digest()).update('mip-phone-encryption-v1').digest()
  const iv = Buffer.alloc(12, 1)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(Buffer.from(`${appId}\0${userId}`))
  const data = Buffer.concat([cipher.update('+86:13000000000'), cipher.final()])
  return Buffer.concat([Buffer.from([1]), iv, cipher.getAuthTag(), data])
}
it('resolves only the active authorized principal own verified phone', async () => {
  let allowed = true
  const repository = {
    resolveUser: async () => ({ id: userId, status: 'ACTIVE', phoneBound: true, profileComplete: true, agreementsAccepted: true }),
    listRoleBindings: async () => allowed ? [{ roleKey: 'PLATFORM_OWNER', scopeType: 'PLATFORM', scopeId: null, status: 'ACTIVE' }] : [],
  }
  const lookup = createWebPasswordIdentity({ repository, phoneEncryptionKey: secret, database: { one: async (sql, params) => {
    assert.match(sql, /phone_verified_at IS NOT NULL/)
    assert.deepEqual(params, [appId, userId])
    return { phone_ciphertext: ciphertext() }
  } } })
  assert.deepEqual(await lookup({ appId }), { phone: '+86 13000000000', userId })
  allowed = false
  await assert.rejects(lookup({ appId }))
})
it('private identity requires signature, empty input and replay protection without public dispatch', async () => {
  let calls = 0
  const seen = new Set()
  const route = createWebBffRoute({
    application: { execute: async () => { throw new Error('PUBLIC_DISPATCH_FORBIDDEN') } },
    issuePrincipal: input => ({ appId: input.APPID, identityKey: 'a'.repeat(64) }),
    replayGuard: { consume: async input => { if (seen.has(input.nonce)) throw new Error('WEB_BFF_REPLAYED'); seen.add(input.nonce) } },
    afterSuccessfulMutation: async () => {}, passwordIdentity: async () => { calls++; return { phone: '+86 13000000000', userId } }, secret, now: () => 1000,
  })
  const make = (input = {}, nonce = 'a'.repeat(24)) => signWebBffEnvelope({ transport: 'MIP_WEB_BFF_V1', timestamp: 1000, nonce, principal: { appId, openId: 'trusted' }, request: { contractVersion: 1, action: 'mip.admin.webAuth.identity', input } }, secret)
  assert.equal((await route({ ...make(), signature: '0'.repeat(64) })).ok, false)
  assert.equal((await route(make({ userId: 'forged' }, 'b'.repeat(24)))).ok, false)
  assert.equal((await route(make())).ok, true)
  assert.equal((await route(make())).ok, false)
  assert.equal(calls, 1)
})
