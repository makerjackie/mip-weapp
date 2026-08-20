'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const { resolveTrustedIdentity } = require('../lib/identity')

describe('atomic trusted identity matrix', () => {
  it('accepts complete FROM_* pair', () => {
    const result = resolveTrustedIdentity({
      FROM_APPID: 'wxfromapp00000001',
      FROM_OPENID: 'from-openid',
      APPID: 'wxdirectapp0000001',
      OPENID: 'direct-openid',
    })
    assert.deepEqual(result, {
      appId: 'wxfromapp00000001',
      openId: 'from-openid',
      source: 'from',
    })
  })

  it('accepts complete direct APPID/OPENID pair when FROM_* absent', () => {
    const result = resolveTrustedIdentity({
      APPID: 'wxdirectapp0000001',
      OPENID: 'direct-openid',
    })
    assert.deepEqual(result, {
      appId: 'wxdirectapp0000001',
      openId: 'direct-openid',
      source: 'direct',
    })
  })

  it('rejects mixed FROM_APPID + OPENID', () => {
    assert.throws(
      () => resolveTrustedIdentity({
        FROM_APPID: 'wxfromapp00000001',
        OPENID: 'direct-openid',
      }),
      /IDENTITY_REQUIRED/,
    )
  })

  it('rejects mixed FROM_OPENID + APPID', () => {
    assert.throws(
      () => resolveTrustedIdentity({
        FROM_OPENID: 'from-openid',
        APPID: 'wxdirectapp0000001',
      }),
      /IDENTITY_REQUIRED/,
    )
  })

  it('rejects partial FROM_* pair', () => {
    assert.throws(
      () => resolveTrustedIdentity({ FROM_APPID: 'wxfromapp00000001' }),
      /IDENTITY_REQUIRED/,
    )
    assert.throws(
      () => resolveTrustedIdentity({ FROM_OPENID: 'from-openid' }),
      /IDENTITY_REQUIRED/,
    )
  })

  it('rejects missing direct pair', () => {
    assert.throws(() => resolveTrustedIdentity({ APPID: 'wxdirectapp0000001' }), /IDENTITY_REQUIRED/)
    assert.throws(() => resolveTrustedIdentity({ OPENID: 'direct-openid' }), /IDENTITY_REQUIRED/)
    assert.throws(() => resolveTrustedIdentity({}), /IDENTITY_REQUIRED/)
  })

  it('never accepts client ownership fields', () => {
    // Ownership-looking fields on the event are irrelevant; only WX context is trusted.
    const result = resolveTrustedIdentity({
      APPID: 'wxdirectapp0000001',
      OPENID: 'direct-openid',
      appId: 'client-forged',
      openId: 'client-forged',
      userId: 'client-forged',
    })
    assert.equal(result.appId, 'wxdirectapp0000001')
    assert.equal(result.openId, 'direct-openid')
  })
})
