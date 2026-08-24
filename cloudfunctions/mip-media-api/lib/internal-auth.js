'use strict'

const { createHmac, timingSafeEqual } = require('node:crypto')

function canonical(input) {
  return JSON.stringify({
    action: input.action,
    appId: input.appId,
    limit: input.limit,
    minimumAgeHours: input.minimumAgeHours,
    timestamp: input.timestamp,
  })
}

function signMaintenanceRequest(input, secret) {
  if (typeof secret !== 'string' || secret.length < 32) {
    throw new Error('MEDIA_CLEANUP_CONFIG_REQUIRED')
  }
  return createHmac('sha256', secret).update(canonical(input)).digest('hex')
}

function verifyMaintenanceRequest(input, options = {}) {
  if (input?.action !== 'cleanupOrphans'
    || !(options.allowedAppIds instanceof Set)
    || !options.allowedAppIds.has(input.appId)
    || !Number.isSafeInteger(input.timestamp)
    || Math.abs((options.now || Date.now)() - input.timestamp) > 5 * 60 * 1000
    || !/^[a-f0-9]{64}$/i.test(String(input.signature || ''))) {
    throw new Error('MEDIA_CLEANUP_FORBIDDEN')
  }
  const expected = signMaintenanceRequest(input, options.secret)
  const actualBuffer = Buffer.from(input.signature, 'hex')
  const expectedBuffer = Buffer.from(expected, 'hex')
  if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) {
    throw new Error('MEDIA_CLEANUP_FORBIDDEN')
  }
}

module.exports = { signMaintenanceRequest, verifyMaintenanceRequest }
