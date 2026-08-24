'use strict'

const { createHmac, timingSafeEqual } = require('node:crypto')

function stableJson(value) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(',')}]`
  }
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`
}

function unsignedBody(event) {
  return Object.fromEntries(
    Object.entries(event || {}).filter(([key]) => key !== 'signature'),
  )
}

function signMaintenanceRequest(event, secret) {
  if (typeof secret !== 'string' || secret.length < 32) {
    throw new Error('INTERNAL_AUTH_NOT_CONFIGURED')
  }
  return createHmac('sha256', secret).update(stableJson(unsignedBody(event))).digest('hex')
}

function verifyMaintenanceRequest(event, options = {}) {
  const timestamp = event?.timestamp
  const now = typeof options.now === 'function' ? options.now() : Date.now()
  const appId = text(event?.appId)
  const signature = text(event?.signature)
  if (event?.action !== 'cleanupExpiredAudio'
    || !Number.isSafeInteger(timestamp)
    || Math.abs(now - timestamp) > 5 * 60 * 1000
    || !(options.allowedAppIds instanceof Set)
    || !options.allowedAppIds.has(appId)
    || !/^[a-f0-9]{64}$/i.test(signature)) {
    throw new Error('FORBIDDEN')
  }
  const expected = signMaintenanceRequest(event, options.secret)
  const actualBuffer = Buffer.from(signature, 'hex')
  const expectedBuffer = Buffer.from(expected, 'hex')
  if (actualBuffer.length !== expectedBuffer.length
    || !timingSafeEqual(actualBuffer, expectedBuffer)) {
    throw new Error('FORBIDDEN')
  }
  return { ...unsignedBody(event), appId, timestamp }
}

function text(value) {
  return typeof value === 'string' ? value.trim() : ''
}

module.exports = {
  signMaintenanceRequest,
  stableJson,
  unsignedBody,
  verifyMaintenanceRequest,
}
