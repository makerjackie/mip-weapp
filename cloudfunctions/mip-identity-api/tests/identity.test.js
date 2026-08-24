'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const { resolveTrustedIdentity } = require('../lib/identity')

const allowedAppIds = new Set(['wx0000000000000001'])
const pepper = 'identity-pepper-with-at-least-32-characters'
const unionPepper = 'union-identity-pepper-with-at-least-32-characters'

describe('trusted MIP identity', () => {
  it('prefers a complete FROM pair and never returns raw OpenID', () => {
    const caller = resolveTrustedIdentity({
      FROM_APPID: 'wx0000000000000001',
      FROM_OPENID: 'from-open-id',
      FROM_UNIONID: 'from-union-id',
      APPID: 'wx0000000000000002',
      OPENID: 'direct-open-id',
      UNIONID: 'direct-union-id',
    }, { allowedAppIds, pepper, unionPepper })

    assert.equal(caller.appId, 'wx0000000000000001')
    assert.match(caller.identityKey, /^[0-9a-f]{64}$/)
    assert.match(caller.unionIdentityKey, /^[0-9a-f]{64}$/)
    assert.equal(JSON.stringify(caller).includes('from-open-id'), false)
    assert.equal(JSON.stringify(caller).includes('from-union-id'), false)
    assert.notEqual(
      caller.unionIdentityKey,
      resolveTrustedIdentity({
        APPID: 'wx0000000000000001',
        OPENID: 'from-open-id',
        UNIONID: 'direct-union-id',
      }, { allowedAppIds, pepper, unionPepper }).unionIdentityKey,
    )
  })

  it('keeps UnionID support optional until a stable migration pepper is configured', () => {
    const caller = resolveTrustedIdentity({
      APPID: 'wx0000000000000001',
      OPENID: 'open-id',
      UNIONID: 'union-id',
    }, { allowedAppIds, pepper })
    assert.equal(caller.unionIdentityKey, undefined)

    assert.throws(
      () => resolveTrustedIdentity({
        APPID: 'wx0000000000000001',
        OPENID: 'open-id',
        UNIONID: 'union-id',
      }, { allowedAppIds, pepper, unionPepper: 'too-short' }),
      /UNION_IDENTITY_CONFIG_REQUIRED/,
    )
  })

  it('rejects partial, unlisted and unconfigured identities', () => {
    assert.throws(
      () => resolveTrustedIdentity({ FROM_APPID: 'wx0000000000000001' }, { allowedAppIds, pepper }),
      /AUTH_REQUIRED/,
    )
    assert.throws(
      () => resolveTrustedIdentity({
        APPID: 'wx0000000000000002',
        OPENID: 'open-id',
      }, { allowedAppIds, pepper }),
      /AUTH_REQUIRED/,
    )
    assert.throws(
      () => resolveTrustedIdentity({
        APPID: 'wx0000000000000001',
        OPENID: 'open-id',
      }, { allowedAppIds, pepper: '' }),
      /IDENTITY_CONFIG_REQUIRED/,
    )
    assert.throws(
      () => resolveTrustedIdentity({
        APPID: 'wx0000000000000001',
        OPENID: 'open-id',
      }, { allowedAppIds: new Set(), pepper }),
      /IDENTITY_CONFIG_REQUIRED/,
    )
  })
})
