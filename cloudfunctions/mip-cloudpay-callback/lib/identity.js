'use strict'

const { createHmac } = require('node:crypto')

function identityKey(appId, openId, pepper) {
  if (typeof pepper !== 'string' || pepper.length < 32) {
    throw new Error('IDENTITY_CONFIG_REQUIRED')
  }
  return createHmac('sha256', pepper).update(`${appId}\0${openId}`).digest('hex')
}

module.exports = { identityKey }
