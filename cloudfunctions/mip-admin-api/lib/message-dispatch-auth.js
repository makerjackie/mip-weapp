'use strict'

const { createHmac, timingSafeEqual } = require('node:crypto')

const RUN_DUE_ACTION = 'runDueMessageCampaigns'
const GET_WAKE_PLAN_ACTION = 'getMessageCampaignWakePlan'
const MESSAGE_DISPATCH_ACTIONS = new Set([RUN_DUE_ACTION, GET_WAKE_PLAN_ACTION])
const requestKeysByAction = Object.freeze({
  [RUN_DUE_ACTION]: new Set([
    'action',
    'appId',
    'limit',
    'drain',
    'maxBatches',
    'timestamp',
    'signature',
  ]),
  [GET_WAKE_PLAN_ACTION]: new Set([
    'action',
    'appId',
    'timestamp',
    'signature',
  ]),
})

function stableJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`
}

function unsignedBody(event) {
  return Object.fromEntries(
    Object.entries(event || {}).filter(([key]) => key !== 'signature'),
  )
}

function signMessageDispatchRequest(event, secret) {
  if (typeof secret !== 'string' || secret.length < 32) {
    throw new Error('INTERNAL_AUTH_NOT_CONFIGURED')
  }
  return createHmac('sha256', secret)
    .update(stableJson(unsignedBody(event)))
    .digest('hex')
}

function verifyMessageDispatchRequest(event, options = {}) {
  const action = typeof event?.action === 'string' ? event.action : ''
  const requestKeys = requestKeysByAction[action]
  if (!event || typeof event !== 'object' || Array.isArray(event)
    || !MESSAGE_DISPATCH_ACTIONS.has(action)
    || Reflect.ownKeys(event).length !== requestKeys.size
    || Reflect.ownKeys(event).some(key => typeof key !== 'string' || !requestKeys.has(key))) {
    throw new Error('FORBIDDEN')
  }
  const timestamp = event.timestamp
  const now = typeof options.now === 'function' ? options.now() : Date.now()
  const appId = text(event.appId)
  const signature = text(event.signature)
  if (!Number.isSafeInteger(timestamp)
    || Math.abs(Number(now) - timestamp) > 5 * 60 * 1000
    || !(options.allowedAppIds instanceof Set)
    || !options.allowedAppIds.has(appId)
    || !/^[a-f0-9]{64}$/i.test(signature)) {
    throw new Error('FORBIDDEN')
  }
  const expected = signMessageDispatchRequest(event, options.secret)
  const receivedBytes = Buffer.from(signature, 'hex')
  const expectedBytes = Buffer.from(expected, 'hex')
  if (receivedBytes.length !== expectedBytes.length
    || !timingSafeEqual(receivedBytes, expectedBytes)) {
    throw new Error('FORBIDDEN')
  }
  return { ...unsignedBody(event), appId, timestamp }
}

function text(value) {
  return typeof value === 'string' ? value.trim() : ''
}

module.exports = {
  GET_WAKE_PLAN_ACTION,
  MESSAGE_DISPATCH_ACTIONS,
  RUN_DUE_ACTION,
  signMessageDispatchRequest,
  stableJson,
  unsignedBody,
  verifyMessageDispatchRequest,
}
