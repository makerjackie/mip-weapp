'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const { identityKey, resolveMipUser, trustedWechatIdentity } = require('../lib/identity')

const vector = Object.freeze({
  appId: 'wx-mip-test',
  openId: 'openid-test-user',
  pepper: '0123456789abcdef0123456789abcdef',
  identityKey: '4cc7c9e18e134ea35d2870cad704c4bddbd8f59c85699ee72b441cad1ebc2799',
})

describe('MIP identity contract', () => {
  it('matches the mip-identity-api HMAC-SHA256 fixed vector', () => {
    assert.equal(identityKey(vector.appId, vector.openId, vector.pepper), vector.identityKey)
  })

  it('fails closed when MIP_IDENTITY_PEPPER is missing or shorter than 32 characters', () => {
    assert.throws(() => identityKey(vector.appId, vector.openId, ''), /IDENTITY_CONFIG_REQUIRED/)
    assert.throws(() => identityKey(vector.appId, vector.openId, 'x'.repeat(31)), /IDENTITY_CONFIG_REQUIRED/)
  })

  it('rejects unknown AppIDs before public or authenticated event actions', () => {
    const allowedAppIds = new Set([vector.appId])
    assert.deepEqual(
      trustedWechatIdentity({ APPID: vector.appId }, { allowedAppIds }),
      { appId: vector.appId, openId: null },
    )
    assert.throws(
      () => trustedWechatIdentity({ APPID: 'wx-other', OPENID: vector.openId }, { allowedAppIds }),
      error => error?.code === 'AUTH_REQUIRED',
    )
    assert.throws(
      () => trustedWechatIdentity({ APPID: vector.appId }, { allowedAppIds: new Set() }),
      error => error?.code === 'IDENTITY_CONFIG_REQUIRED',
    )
  })

  it('queries the MIP identity record with the app-scoped shared identity key', async () => {
    let parameters
    const db = {
      async one(_sql, values) {
        parameters = values
        return { id: 'user-1', status: 'ACTIVE', primary_branch_id: null }
      },
    }

    const user = await resolveMipUser(
      db,
      { appId: vector.appId, openId: vector.openId },
      { pepper: vector.pepper },
    )
    assert.equal(user.id, 'user-1')
    assert.deepEqual(parameters, [vector.appId, vector.identityKey])
  })
})
