'use strict'

const { createHmac, timingSafeEqual } = require('node:crypto')

const GET_WAKE_PLAN_ACTION = 'getKnowledgeIngestionWakePlan'
const RUN_DUE_ACTION = 'runDueKnowledgeIngestionSchedules'
const KNOWLEDGE_SCHEDULER_ACTIONS = new Set([GET_WAKE_PLAN_ACTION, RUN_DUE_ACTION])
const SIGNATURE_DOMAIN = 'mip-knowledge-scheduler:admin:v1'
const keysByAction = Object.freeze({
  [GET_WAKE_PLAN_ACTION]: new Set([
    'action', 'appId', 'nonce', 'timestamp', 'signature',
  ]),
  [RUN_DUE_ACTION]: new Set([
    'action', 'appId', 'limit', 'nonce', 'timestamp', 'signature',
  ]),
})

function stableJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`
}

function unsignedBody(value) {
  return Object.fromEntries(Object.entries(value || {}).filter(([key]) => key !== 'signature'))
}

function signKnowledgeSchedulerRequest(value, secret) {
  if (typeof secret !== 'string' || secret.length < 32) {
    throw new Error('INTERNAL_AUTH_NOT_CONFIGURED')
  }
  return createHmac('sha256', secret)
    .update(`${SIGNATURE_DOMAIN}\0${stableJson(unsignedBody(value))}`)
    .digest('hex')
}

function verifyKnowledgeSchedulerRequest(value, options = {}) {
  const action = typeof value?.action === 'string' ? value.action : ''
  const allowedKeys = keysByAction[action]
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || !KNOWLEDGE_SCHEDULER_ACTIONS.has(action)
    || !allowedKeys
    || Reflect.ownKeys(value).length !== allowedKeys.size
    || Reflect.ownKeys(value).some(key => typeof key !== 'string' || !allowedKeys.has(key))) {
    throw forbidden()
  }
  const appId = text(value.appId)
  const nonce = text(value.nonce)
  const signature = text(value.signature)
  const timestamp = value.timestamp
  const now = Number(typeof options.now === 'function' ? options.now() : Date.now())
  if (!(options.allowedAppIds instanceof Set)
    || !options.allowedAppIds.has(appId)
    || !/^[a-f0-9]{24}$/i.test(nonce)
    || !Number.isSafeInteger(timestamp)
    || Math.abs(now - timestamp) > 5 * 60 * 1000
    || !/^[a-f0-9]{64}$/i.test(signature)) {
    throw forbidden()
  }
  const expected = signKnowledgeSchedulerRequest(value, options.secret)
  const receivedBytes = Buffer.from(signature, 'hex')
  const expectedBytes = Buffer.from(expected, 'hex')
  if (receivedBytes.length !== expectedBytes.length
    || !timingSafeEqual(receivedBytes, expectedBytes)) {
    throw forbidden()
  }
  return { ...unsignedBody(value), appId, nonce, timestamp }
}

function forbidden() {
  const error = new Error('FORBIDDEN')
  error.code = 'FORBIDDEN'
  return error
}

function text(value) {
  return typeof value === 'string' ? value.trim() : ''
}

module.exports = {
  GET_WAKE_PLAN_ACTION,
  KNOWLEDGE_SCHEDULER_ACTIONS,
  RUN_DUE_ACTION,
  SIGNATURE_DOMAIN,
  signKnowledgeSchedulerRequest,
  stableJson,
  unsignedBody,
  verifyKnowledgeSchedulerRequest,
}
