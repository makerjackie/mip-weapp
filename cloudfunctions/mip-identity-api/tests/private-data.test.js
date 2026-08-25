'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const { hashPhone, protectPhone } = require('../lib/private-data')

describe('private phone data', () => {
  it('stores a stable hash and authenticated ciphertext instead of plaintext', () => {
    const secret = 'phone-encryption-secret-with-at-least-32-characters'
    const context = { appId: 'wx0000000000000001', userId: 'user-1' }
    const first = protectPhone(
      { countryCode: '86', purePhoneNumber: '13800138000' },
      secret,
      context,
    )
    const second = protectPhone(
      { countryCode: '86', purePhoneNumber: '13800138000' },
      secret,
      context,
    )

    assert.equal(first.phoneHash, second.phoneHash)
    assert.equal(first.phoneHash, '11a3ac4da069becebb56afbe467583ad259b3a253a24118a035a785a2f64dbb1')
    assert.equal(first.phoneHash, hashPhone(
      { countryCode: '86', purePhoneNumber: '13800138000' },
      secret,
      { appId: context.appId },
    ))
    assert.notDeepEqual(first.phoneCiphertext, second.phoneCiphertext)
    assert.equal(first.phoneCiphertext.includes(Buffer.from('13800138000')), false)
  })

  it('does not expose cross-AppID phone equality in the shared database', () => {
    const secret = 'phone-encryption-secret-with-at-least-32-characters'
    const phone = { countryCode: '86', purePhoneNumber: '13800138000' }

    const first = protectPhone(phone, secret, { appId: 'wx0000000000000001', userId: 'user-1' })
    const second = protectPhone(phone, secret, { appId: 'wx0000000000000002', userId: 'user-2' })

    assert.notEqual(first.phoneHash, second.phoneHash)
  })

  it('fails closed without encryption configuration', () => {
    assert.throws(
      () => protectPhone(
        { purePhoneNumber: '13800138000' },
        '',
        { appId: 'wx0000000000000001', userId: 'user-1' },
      ),
      /PHONE_ENCRYPTION_NOT_CONFIGURED/,
    )
  })
})
