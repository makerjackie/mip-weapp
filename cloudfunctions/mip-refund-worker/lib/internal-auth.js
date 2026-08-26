'use strict'

const { createHash, createHmac, timingSafeEqual } = require('node:crypto')

const transportMetadataKeys = new Set(['frameworkContext', 'tcbContext', 'userInfo'])
const eventKeysByAction = new Map([
  ['dispatchRefund', new Set(['action', 'appId', 'refundId', 'nonce', 'timestamp', 'signature'])],
  ['dispatchRefunds', new Set(['action', 'appId', 'refundIds', 'nonce', 'timestamp', 'signature'])],
  ['runBatch', new Set(['action', 'appId', 'limit', 'timestamp', 'signature'])],
])

function stableJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`
}

function businessPayload(event) {
  const body = Object.fromEntries(
    Object.entries(event).filter(([key]) => !['signature', 'timestamp'].includes(key)),
  )
  return [
    Number(event.timestamp),
    text(event.action),
    text(event.appId),
    createHash('sha256').update(stableJson(body)).digest('hex'),
  ].join('\n')
}

function signInternalEvent(event, secret) {
  return createHmac('sha256', secret).update(businessPayload(event)).digest('hex')
}

function verifyInternalEvent(event, options = {}) {
  const verifiedEvent = eventForVerification(event)
  const expectedKeys = eventKeysByAction.get(verifiedEvent.action)
  if (!expectedKeys || !hasExactKeys(verifiedEvent, expectedKeys)) {
    throw new Error('FORBIDDEN')
  }
  const timestamp = Number(verifiedEvent.timestamp)
  const now = options.now || Date.now()
  if (typeof options.secret !== 'string' || options.secret.length < 32) {
    throw new Error('INTERNAL_AUTH_NOT_CONFIGURED')
  }
  if (!Number.isFinite(timestamp) || Math.abs(now - timestamp) > 5 * 60 * 1000) {
    throw new Error('FORBIDDEN')
  }
  const appId = text(verifiedEvent.appId)
  if (!(options.allowedAppIds instanceof Set) || !options.allowedAppIds.has(appId)) {
    throw new Error('FORBIDDEN')
  }
  const signature = text(verifiedEvent.signature)
  const expected = signInternalEvent(verifiedEvent, options.secret)
  if (!/^[a-f0-9]{64}$/i.test(signature)) throw new Error('FORBIDDEN')
  const received = Buffer.from(signature, 'hex')
  const expectedBytes = Buffer.from(expected, 'hex')
  if (received.length !== expectedBytes.length || !timingSafeEqual(received, expectedBytes)) {
    throw new Error('FORBIDDEN')
  }
  return { ...verifiedEvent, appId, signature: undefined }
}

function eventForVerification(event) {
  if (!isPlainObject(event)) throw new Error('FORBIDDEN')
  const verifiedEvent = Object.create(null)
  for (const key of Reflect.ownKeys(event)) {
    if (typeof key === 'string' && transportMetadataKeys.has(key)) {
      if (!isPlainObject(event[key])) throw new Error('FORBIDDEN')
      continue
    }
    verifiedEvent[key] = event[key]
  }
  return verifiedEvent
}

function hasExactKeys(value, expectedKeys) {
  const keys = Reflect.ownKeys(value)
  return keys.length === expectedKeys.size
    && keys.every(key => typeof key === 'string' && expectedKeys.has(key))
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function text(value) {
  return typeof value === 'string' ? value.trim() : ''
}

module.exports = { businessPayload, signInternalEvent, stableJson, verifyInternalEvent }
