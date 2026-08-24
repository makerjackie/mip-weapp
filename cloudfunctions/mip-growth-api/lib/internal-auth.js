'use strict'

const { createHmac, timingSafeEqual } = require('node:crypto')

function canonicalPayload(event) {
  return [
    Number(event.timestamp),
    text(event.action),
    text(event.appId),
    text(event.userId),
    text(event.sourceEventType),
    text(event.sourceEventId),
    text(event.transitionId),
  ].join('\n')
}

function signInternalEvent(event, secret) {
  return createHmac('sha256', secret).update(canonicalPayload(event)).digest('hex')
}

function verifyInternalEvent(event, options = {}) {
  const secret = options.secret
  const now = options.now || Date.now()
  const timestamp = Number(event.timestamp)
  if (typeof secret !== 'string' || secret.length < 32) {
    throw new Error('INTERNAL_AUTH_NOT_CONFIGURED')
  }
  if (!Number.isFinite(timestamp) || Math.abs(now - timestamp) > 5 * 60 * 1000) {
    throw new Error('FORBIDDEN')
  }
  if (!(options.allowedAppIds instanceof Set) || !options.allowedAppIds.has(text(event.appId))) {
    throw new Error('FORBIDDEN')
  }
  const signature = text(event.signature)
  const expected = signInternalEvent(event, secret)
  if (!/^[a-f0-9]{64}$/i.test(signature)) {
    throw new Error('FORBIDDEN')
  }
  const left = Buffer.from(signature, 'hex')
  const right = Buffer.from(expected, 'hex')
  if (left.length !== right.length || !timingSafeEqual(left, right)) {
    throw new Error('FORBIDDEN')
  }
  const action = text(event.action)
  if (action === 'applyCheckInTransition') {
    return { appId: text(event.appId), transitionId: text(event.transitionId) }
  }
  if (action === 'recordConfirmedEvent') {
    return {
      appId: text(event.appId),
      userId: text(event.userId),
      sourceEventType: text(event.sourceEventType),
      sourceEventId: text(event.sourceEventId),
    }
  }
  throw new Error('FORBIDDEN')
}

function text(value) {
  return typeof value === 'string' ? value.trim() : ''
}

module.exports = { canonicalPayload, signInternalEvent, verifyInternalEvent }
