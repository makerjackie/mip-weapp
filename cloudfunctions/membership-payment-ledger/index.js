'use strict'

const { createHmac, timingSafeEqual } = require('node:crypto')
const { mysqlDatabase } = require('./lib/mysql')
const ledger = require('./domain/ledger')

const allowedAppIds = new Set(String(process.env.MEMBERSHIP_ALLOWED_APP_IDS || '')
  .split(',')
  .map(value => value.trim())
  .filter(Boolean))

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

const signedFieldsByAction = {
  getPayableOrder: ['action', 'appId', 'signedAt', 'nonce', 'orderId', 'userId', 'paymentMode'],
  markPaymentCreated: ['action', 'appId', 'signedAt', 'nonce', 'orderId', 'userId', 'outTradeNo', 'amountCents', 'currency'],
  applyPaymentCallback: ['action', 'appId', 'signedAt', 'nonce', 'orderId', 'userId', 'outTradeNo', 'transactionId', 'amountCents', 'currency'],
  getRefundRequest: ['action', 'appId', 'signedAt', 'nonce', 'refundId', 'userId'],
  markRefundCreated: ['action', 'appId', 'signedAt', 'nonce', 'outTradeNo', 'outRefundNo'],
  markRefundFailed: ['action', 'appId', 'signedAt', 'nonce', 'outTradeNo', 'outRefundNo', 'reasonCode'],
  applyRefundCallback: ['action', 'appId', 'signedAt', 'nonce', 'outTradeNo', 'outRefundNo', 'refundId', 'refundAmountCents'],
  confirmRefundManually: ['action', 'appId', 'signedAt', 'nonce', 'refundId', 'operatorId', 'reason'],
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

function assertInternalRequest(event) {
  const appId = typeof event.appId === 'string' ? event.appId.trim() : ''
  if (!appId || !allowedAppIds.has(appId)) {
    throw new Error('FORBIDDEN')
  }
  const secrets = [
    process.env.MEMBERSHIP_LEDGER_SECRET,
    process.env.MEMBERSHIP_LEDGER_PREVIOUS_SECRET,
  ].filter(secret => typeof secret === 'string' && secret.length >= 32)
  const signedAt = Number(event.signedAt)
  const signature = typeof event.signature === 'string' ? event.signature : ''
  if (!secrets.length || !Number.isFinite(signedAt) || Math.abs(Date.now() - signedAt) > 5 * 60 * 1000) {
    throw new Error('FORBIDDEN')
  }
  // CloudBase injects trusted caller metadata into Event Function payloads.
  // Verify only the explicit business fields the caller signed; injected
  // transport fields must never change the HMAC input.
  const payload = signedPayload(event)
  const received = /^[0-9a-f]{64}$/i.test(signature) ? Buffer.from(signature, 'hex') : Buffer.alloc(0)
  const valid = secrets.some((secret) => {
    const expected = createHmac('sha256', secret).update(canonical(payload)).digest()
    return received.length === expected.length && timingSafeEqual(received, expected)
  })
  if (!valid) {
    throw new Error('FORBIDDEN')
  }
  return appId
}

const handlers = {
  getPayableOrder: (db, event, appId) => ledger.getPayableOrder(db, {
    appId,
    orderId: event.orderId,
    userId: event.userId,
    paymentMode: event.paymentMode,
  }),
  markPaymentCreated: (db, event, appId) => ledger.markPaymentCreated(db, { ...event, appId }),
  applyPaymentCallback: (db, event, appId) => ledger.applyPaymentCallback(db, { ...event, appId }),
  getRefundRequest: (db, event, appId) => ledger.getRefundRequest(db, {
    appId,
    refundId: event.refundId,
    userId: event.userId,
  }),
  markRefundCreated: (db, event, appId) => ledger.markRefundCreated(db, { ...event, appId }),
  markRefundFailed: (db, event, appId) => ledger.markRefundFailed(db, { ...event, appId }),
  applyRefundCallback: (db, event, appId) => ledger.applyRefundCallback(db, { ...event, appId }),
  confirmRefundManually: (db, event, appId) => ledger.confirmRefundManually(db, { ...event, appId }),
}

exports.main = async (event = {}) => {
  try {
    if (event.action === 'health') {
      await mysqlDatabase().one('SELECT 1 AS ok')
      return { ok: true, data: { service: 'membership-payment-ledger', persistence: 'cloudbase-mysql', contractVersion: 2 } }
    }
    const appId = assertInternalRequest(event)
    const handler = handlers[event.action]
    if (!handler) throw new Error('UNSUPPORTED_ACTION')
    const data = await handler(mysqlDatabase(), event, appId)
    return { ok: true, data: data ?? null }
  }
  catch (error) {
    const code = error instanceof Error && /^[A-Z][A-Z0-9_]+$/.test(error.message)
      ? error.message
      : 'INTERNAL_ERROR'
    console.error('[membership-payment-ledger]', event.action, code)
    return { ok: false, error: { code } }
  }
}

module.exports._test = { assertInternalRequest, canonical, signedPayload }
