'use strict'

const { createHash, createHmac, timingSafeEqual } = require('node:crypto')

const transportMetadataKeys = new Set(['frameworkContext', 'tcbContext', 'userInfo'])

function stableJson(value) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(',')}]`
  }
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`
}

function businessPayload(event) {
  const body = businessBody(event)
  return [
    Number(event.timestamp),
    text(event.action),
    text(event.appId),
    createHash('sha256').update(stableJson(body)).digest('hex'),
  ].join('\n')
}

function businessBody(event) {
  if (!isPlainObject(event)) throw new Error('FORBIDDEN')
  const body = {}
  for (const [key, value] of Object.entries(event)) {
    if (key === 'signature' || key === 'timestamp') continue
    if (transportMetadataKeys.has(key)) {
      if (!isPlainObject(value)) throw new Error('FORBIDDEN')
      continue
    }
    body[key] = value
  }
  return body
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
  const left = Buffer.from(signature, 'hex')
  const right = Buffer.from(expected, 'hex')
  if (left.length !== right.length || !timingSafeEqual(left, right)) {
    throw new Error('FORBIDDEN')
  }
  return { ...businessBody(event), appId, timestamp }
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function text(value) {
  return typeof value === 'string' ? value.trim() : ''
}

module.exports = { businessBody, businessPayload, signInternalEvent, stableJson, verifyInternalEvent }
