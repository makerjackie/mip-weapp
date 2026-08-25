'use strict'

const assert = require('node:assert/strict')
const { createCipheriv, createHash, createHmac, randomBytes } = require('node:crypto')
const { describe, it } = require('node:test')
const { createTrustedPrincipalIssuer, resolveTrustedIdentity } = require('../lib/identity')
const { decryptPhone, maskPhone } = require('../lib/phone')

function encryptPhone(phone, secret, context) {
  const master = createHash('sha256').update(secret).digest()
  const key = createHmac('sha256', master).update('mip-phone-encryption-v1').digest()
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(Buffer.from(`${context.appId}\0${context.userId}`))
  const ciphertext = Buffer.concat([cipher.update(phone), cipher.final()])
  return Buffer.concat([Buffer.from([1]), iv, cipher.getAuthTag(), ciphertext])
}

describe('trusted identity and private phone', () => {
  it('uses HMAC-SHA256(appId NUL openId) and ignores event identity fields', () => {
    const pepper = 'identity-pepper-with-at-least-thirty-two-characters'
    const caller = resolveTrustedIdentity({
      FROM_APPID: 'wx-trusted',
      FROM_OPENID: 'openid-trusted',
      APPID: 'wx-fallback',
      OPENID: 'openid-fallback',
    }, { allowedAppIds: new Set(['wx-trusted']), pepper })
    const expected = createHmac('sha256', pepper).update('wx-trusted\0openid-trusted').digest('hex')
    assert.deepEqual(caller, { appId: 'wx-trusted', openId: 'openid-trusted', identityKey: expected })
    assert.throws(() => resolveTrustedIdentity({ FROM_APPID: 'wx-other', FROM_OPENID: 'openid' }, {
      allowedAppIds: new Set(['wx-trusted']), pepper,
    }), /AUTH_REQUIRED/)
  })

  it('preserves the resolver contract while issuing an authority-scoped principal', () => {
    const options = {
      allowedAppIds: new Set(['wx-trusted']),
      pepper: 'identity-pepper-with-at-least-thirty-two-characters',
    }
    const context = { APPID: 'wx-trusted', OPENID: 'openid-trusted' }
    const resolved = resolveTrustedIdentity(context, options)
    const issuer = createTrustedPrincipalIssuer(options)
    const principal = issuer.issue(context)

    assert.deepEqual(principal, resolved)
    assert.equal(Object.isFrozen(resolved), false)
    assert.equal(Object.isFrozen(principal), true)
    assert.equal(issuer.assert(principal), principal)
    assert.throws(() => issuer.assert({ ...principal }), /AUTH_REQUIRED/)
  })

  it('decrypts only with the dedicated key and matching app/user AAD', () => {
    const secret = 'phone-encryption-secret-with-at-least-32-characters'
    const context = { appId: 'wx-trusted', userId: 'user-a' }
    const encrypted = encryptPhone('+86:13800138000', secret, context)
    assert.equal(decryptPhone(encrypted, secret, context), '+86 13800138000')
    assert.equal(maskPhone('+86 13800138000'), '861****8000')
    assert.throws(() => decryptPhone(encrypted, secret, { ...context, userId: 'user-b' }))
    assert.throws(() => decryptPhone(encrypted, '', context), /PHONE_ENCRYPTION_NOT_CONFIGURED/)
  })
})
