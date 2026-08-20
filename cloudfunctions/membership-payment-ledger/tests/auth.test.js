'use strict'

const assert = require('node:assert/strict')
const { createHmac } = require('node:crypto')
const { describe, it } = require('node:test')

process.env.MEMBERSHIP_ALLOWED_APP_IDS = 'wx0000000000000000'
process.env.MEMBERSHIP_LEDGER_SECRET = 'a'.repeat(64)
process.env.MEMBERSHIP_LEDGER_PREVIOUS_SECRET = 'b'.repeat(64)

const { assertInternalRequest, canonical } = require('../index')._test

function signed(secret) {
  const payload = {
    action: 'getPayableOrder',
    appId: 'wx0000000000000000',
    nonce: 'test-nonce',
    orderId: 'e0b268a3-d2e5-4e1c-9db7-2878f0fd7864',
    paymentMode: 'test',
    signedAt: Date.now(),
    userId: 'trusted-user',
  }
  return {
    ...payload,
    signature: createHmac('sha256', secret).update(canonical(payload)).digest('hex'),
  }
}

describe('internal ledger authentication', () => {
  it('accepts the current secret', () => {
    assert.equal(assertInternalRequest(signed('a'.repeat(64))), 'wx0000000000000000')
  })

  it('accepts the previous secret during zero-downtime rotation', () => {
    assert.equal(assertInternalRequest(signed('b'.repeat(64))), 'wx0000000000000000')
  })

  it('ignores CloudBase transport metadata injected after signing', () => {
    const event = {
      ...signed('a'.repeat(64)),
      userInfo: { appId: 'platform-injected' },
      wxContext: { SOURCE: 'wx_devtools' },
    }
    assert.equal(assertInternalRequest(event), 'wx0000000000000000')
  })

  it('rejects changes to any signed business field', () => {
    const event = { ...signed('a'.repeat(64)), orderId: 'client-tampered' }
    assert.throws(() => assertInternalRequest(event), /FORBIDDEN/)
  })

  it('rejects an unrelated secret', () => {
    assert.throws(() => assertInternalRequest(signed('c'.repeat(64))), /FORBIDDEN/)
  })
})
