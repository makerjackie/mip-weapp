'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const { resolveTrustedIdentity } = require('../lib/identity')

describe('admin atomic trusted identity matrix', () => {
  it('accepts complete FROM_* or direct pairs only', () => {
    assert.equal(resolveTrustedIdentity({
      FROM_APPID: 'wxfrom',
      FROM_OPENID: 'from-user',
    }).source, 'from')
    assert.equal(resolveTrustedIdentity({
      APPID: 'wxdirect',
      OPENID: 'direct-user',
    }).source, 'direct')
  })

  it('rejects mixed and partial pairs with FORBIDDEN', () => {
    assert.throws(
      () => resolveTrustedIdentity({ FROM_APPID: 'wxfrom', OPENID: 'x' }, { errorCode: 'FORBIDDEN' }),
      /FORBIDDEN/,
    )
    assert.throws(
      () => resolveTrustedIdentity({ FROM_OPENID: 'from', APPID: 'wx' }, { errorCode: 'FORBIDDEN' }),
      /FORBIDDEN/,
    )
    assert.throws(
      () => resolveTrustedIdentity({ APPID: 'wx' }, { errorCode: 'FORBIDDEN' }),
      /FORBIDDEN/,
    )
  })
})
