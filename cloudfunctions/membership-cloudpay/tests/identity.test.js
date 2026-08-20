'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const { resolveTrustedIdentity } = require('../lib/identity')

describe('payment atomic trusted identity matrix', () => {
  it('accepts atomic pairs and rejects mixed ownership', () => {
    const from = resolveTrustedIdentity({
      FROM_APPID: 'wxpayfrom',
      FROM_OPENID: 'pay-from-user',
    })
    assert.equal(from.userId, 'pay-from-user')
    assert.equal(from.appId, 'wxpayfrom')

    const direct = resolveTrustedIdentity({
      APPID: 'wxpaydirect',
      OPENID: 'pay-direct-user',
    })
    assert.equal(direct.userId, 'pay-direct-user')

    assert.throws(
      () => resolveTrustedIdentity({ FROM_APPID: 'wxpayfrom', OPENID: 'mixed' }),
      /IDENTITY_REQUIRED/,
    )
  })
})
