'use strict'

const { createHmac, timingSafeEqual } = require('node:crypto')

const signedFieldsByAction = Object.freeze({
  getPayableOrder: ['action', 'appId', 'signedAt', 'nonce', 'orderId', 'identityKey', 'paymentMode'],
  markPaymentCreated: [
    'action', 'appId', 'signedAt', 'nonce', 'orderId', 'identityKey', 'merchantOrderNo',
    'amountCents', 'currency', 'attemptId', 'requestHash', 'prepayId', 'provider',
  ],
  applyPaymentCallback: [
    'action', 'appId', 'signedAt', 'nonce', 'orderId', 'identityKey', 'merchantOrderNo',
    'providerTransactionId', 'amountCents', 'currency',
  ],
  getRefundRequest: ['action', 'appId', 'signedAt', 'nonce', 'refundId', 'identityKey'],
  getRefundRequestForProvider: ['action', 'appId', 'signedAt', 'nonce', 'refundId'],
  listPendingRefunds: ['action', 'appId', 'signedAt', 'nonce', 'limit'],
  markRefundCreated: [
    'action', 'appId', 'signedAt', 'nonce', 'refundId', 'merchantRefundNo', 'providerRefundId',
  ],
  markRefundFailed: [
    'action', 'appId', 'signedAt', 'nonce', 'refundId', 'merchantRefundNo', 'reasonCode',
  ],
  markRefundManualReview: [
    'action', 'appId', 'signedAt', 'nonce', 'refundId', 'merchantRefundNo', 'reasonCode',
  ],
  applyRefundCallback: [
    'action', 'appId', 'signedAt', 'nonce', 'refundId', 'merchantOrderNo',
    'merchantRefundNo', 'providerRefundId', 'amountCents',
  ],
})

function canonical(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonical).join(',')}]`
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function signedPayload(event) {
  const fields = signedFieldsByAction[event.action]
  if (!fields) {
    throw new Error('FORBIDDEN')
  }
  return Object.fromEntries(fields
    .filter(field => event[field] !== undefined)
    .map(field => [field, event[field]]))
}

function assertInternalRequest(event, options = {}) {
  const appId = typeof event.appId === 'string' ? event.appId.trim() : ''
  if (!appId || !(options.allowedAppIds instanceof Set) || !options.allowedAppIds.has(appId)) {
    throw new Error('FORBIDDEN')
  }
  const secrets = options.secrets?.filter(secret => typeof secret === 'string' && secret.length >= 32) || []
  const signedAt = Number(event.signedAt)
  const signature = typeof event.signature === 'string' ? event.signature : ''
  const now = options.now?.() ?? Date.now()
  if (!secrets.length || !Number.isFinite(signedAt) || Math.abs(now - signedAt) > 5 * 60 * 1000) {
    throw new Error('FORBIDDEN')
  }
  const received = /^[0-9a-f]{64}$/i.test(signature) ? Buffer.from(signature, 'hex') : Buffer.alloc(0)
  const payload = signedPayload(event)
  const valid = secrets.some((secret) => {
    const expected = createHmac('sha256', secret).update(canonical(payload)).digest()
    return received.length === expected.length && timingSafeEqual(received, expected)
  })
  if (!valid) {
    throw new Error('FORBIDDEN')
  }
  return appId
}

module.exports = { assertInternalRequest, canonical, signedPayload }
