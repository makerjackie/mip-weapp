'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const { hashRecipient, protectRecipient, revealRecipient } = require('../lib/recipient-protection')

const key = 'notification-key-that-is-longer-than-thirty-two-bytes'
const context = {
  appId: 'wx-app',
  userId: '10000000-0000-4000-8000-000000000001',
  grantId: '20000000-0000-4000-8000-000000000001',
  templateKey: 'EVENT_REMINDER',
}

test('encrypts an OpenID with versioned AES-GCM and a keyed recipient hash', () => {
  const protectedValue = protectRecipient('openid-private', key, context, size => Buffer.alloc(size, 7))
  assert.equal(protectedValue.recipientHash, hashRecipient('openid-private', key, context.appId))
  assert.equal(revealRecipient(protectedValue.recipientCiphertext, key, context), 'openid-private')
  assert.equal(protectedValue.recipientCiphertext.subarray(0, 4).toString('ascii'), 'MIPN')
  assert.equal(protectedValue.recipientCiphertext.includes(Buffer.from('openid-private')), false)
})

test('rejects ciphertext tampering, wrong AAD and wrong keys', () => {
  const protectedValue = protectRecipient('openid-private', key, context, size => Buffer.alloc(size, 9))
  const tampered = Buffer.from(protectedValue.recipientCiphertext)
  tampered[tampered.length - 1] ^= 1
  assert.throws(() => revealRecipient(tampered, key, context), /NOTIFICATION_RECIPIENT_INVALID/)
  assert.throws(() => revealRecipient(protectedValue.recipientCiphertext, key, {
    ...context,
    templateKey: 'REFUND_RESULT',
  }), /NOTIFICATION_RECIPIENT_INVALID/)
  assert.throws(() => revealRecipient(
    protectedValue.recipientCiphertext,
    'different-notification-key-longer-than-thirty-two-bytes',
    context,
  ), /NOTIFICATION_RECIPIENT_INVALID/)
})
