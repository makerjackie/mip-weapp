'use strict'

const { createHash, createHmac, timingSafeEqual } = require('node:crypto')

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
  const timestamp = Number(event.timestamp)
  const now = options.now || Date.now()
  if (typeof options.secret !== 'string' || options.secret.length < 32) {
    throw new Error('INTERNAL_AUTH_NOT_CONFIGURED')
  }
  if (!Number.isFinite(timestamp) || Math.abs(now - timestamp) > 5 * 60 * 1000) {
    throw new Error('FORBIDDEN')
  }
  const appId = text(event.appId)
  if (!(options.allowedAppIds instanceof Set) || !options.allowedAppIds.has(appId)) {
    throw new Error('FORBIDDEN')
  }
  const signature = text(event.signature)
  const expected = signInternalEvent(event, options.secret)
  if (!/^[a-f0-9]{64}$/i.test(signature)) throw new Error('FORBIDDEN')
  const received = Buffer.from(signature, 'hex')
  const expectedBytes = Buffer.from(expected, 'hex')
  if (received.length !== expectedBytes.length || !timingSafeEqual(received, expectedBytes)) {
    throw new Error('FORBIDDEN')
  }
  return { ...event, appId, signature: undefined }
}

function text(value) {
  return typeof value === 'string' ? value.trim() : ''
}

module.exports = { businessPayload, signInternalEvent, stableJson, verifyInternalEvent }
