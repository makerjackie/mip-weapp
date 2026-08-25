'use strict'

const { createHmac, timingSafeEqual } = require('node:crypto')

const RECONCILE_ACTION = 'reconcileMessageCampaignSchedule'
const RECONCILE_PROTOCOL = 'mip-message-scheduler/reconcile/v1'
const RECONCILE_DOMAIN = 'mip-message-scheduler:reconcile:v1'
const ACTIVATE_ACTION = 'activateMessageCampaignSchedule'
const ACTIVATE_PROTOCOL = 'mip-message-scheduler/activate/v1'
const ACTIVATE_DOMAIN = 'mip-message-scheduler:activate:v1'
const TIMER_PROTOCOL = 'mip-message-scheduler/timer/v1'
const TIMER_DOMAIN = 'mip-message-scheduler:timer:v1'
const TIMER_PURPOSES = new Set(['DISPATCH', 'CANARY'])
const reconcileKeys = new Set([
  'action', 'protocol', 'appId', 'sourceFunction', 'nonce', 'timestamp', 'signature',
])
const activateKeys = new Set([
  'action', 'protocol', 'namespace', 'function', 'trigger', 'sourceFunction',
  'generation', 'nonce', 'timestamp', 'signature',
])
const timerKeys = new Set([
  'protocol', 'namespace', 'function', 'trigger', 'fireAt', 'generation',
  'activationGeneration', 'purpose', 'signature',
])

function stableJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`
}

function unsigned(value) {
  return Object.fromEntries(Object.entries(value || {}).filter(([key]) => key !== 'signature'))
}

function signDomain(value, secret, domain) {
  requireSecret(secret)
  return createHmac('sha256', secret)
    .update(`${domain}\0${stableJson(unsigned(value))}`)
    .digest('hex')
}

function signSchedulerReconcile(value, secret) {
  return signDomain(value, secret, RECONCILE_DOMAIN)
}

function signSchedulerActivation(value, secret) {
  return signDomain(value, secret, ACTIVATE_DOMAIN)
}

function createSchedulerActivation(input, secret) {
  const request = {
    action: ACTIVATE_ACTION,
    protocol: ACTIVATE_PROTOCOL,
    namespace: text(input.namespace),
    function: text(input.functionName),
    trigger: text(input.triggerName),
    sourceFunction: text(input.sourceFunction),
    generation: text(input.generation),
    nonce: text(input.nonce),
    timestamp: input.timestamp,
  }
  validateActivationFields(request)
  return { ...request, signature: signSchedulerActivation(request, secret) }
}

function signTimerMessage(value, secret) {
  return signDomain(value, secret, TIMER_DOMAIN)
}

function createTimerMessage(input, secret) {
  const message = {
    protocol: TIMER_PROTOCOL,
    namespace: text(input.namespace),
    function: text(input.functionName),
    trigger: text(input.triggerName),
    fireAt: strictUtcInstant(input.fireAt),
    generation: text(input.generation),
    activationGeneration: text(input.activationGeneration),
    purpose: text(input.purpose),
  }
  validateTimerFields(message)
  return { ...message, signature: signTimerMessage(message, secret) }
}

function verifySchedulerReconcile(value, options = {}) {
  if (!plainObjectWithKeys(value, reconcileKeys)) throw forbidden()
  const now = Number(typeof options.now === 'function' ? options.now() : Date.now())
  if (value.action !== RECONCILE_ACTION
    || value.protocol !== RECONCILE_PROTOCOL
    || value.sourceFunction !== options.sourceFunction
    || !options.allowedAppIds?.has(text(value.appId))
    || !/^[a-f0-9]{24}$/i.test(text(value.nonce))
    || !Number.isSafeInteger(value.timestamp)
    || Math.abs(now - value.timestamp) > 5 * 60 * 1000) {
    throw forbidden()
  }
  verifySignature(value, signSchedulerReconcile(value, options.secret))
  return { ...unsigned(value), appId: text(value.appId) }
}

function verifySchedulerActivation(value, options = {}) {
  if (!plainObjectWithKeys(value, activateKeys)) throw forbidden()
  validateActivationFields(value)
  const now = Number(typeof options.now === 'function' ? options.now() : Date.now())
  if (value.action !== ACTIVATE_ACTION
    || value.protocol !== ACTIVATE_PROTOCOL
    || value.namespace !== options.namespace
    || value.function !== options.functionName
    || value.trigger !== options.triggerName
    || value.sourceFunction !== options.sourceFunction
    || Math.abs(now - value.timestamp) > 5 * 60 * 1000) {
    throw forbidden()
  }
  verifySignature(value, signSchedulerActivation(value, options.secret))
  return { ...unsigned(value), generation: text(value.generation) }
}

function verifyTimerMessage(value, options = {}) {
  if (!plainObjectWithKeys(value, timerKeys)) throw forbidden()
  validateTimerFields(value)
  if (value.protocol !== TIMER_PROTOCOL
    || value.namespace !== options.namespace
    || value.function !== options.functionName
    || value.trigger !== options.triggerName) {
    throw forbidden()
  }
  verifySignature(value, signTimerMessage(value, options.secret))
  return { ...unsigned(value), fireAt: strictUtcInstant(value.fireAt) }
}

function parseTimerEvent(event, options = {}) {
  if (!event || typeof event !== 'object' || Array.isArray(event)
    || text(event.Type).toLowerCase() !== 'timer'
    || text(event.TriggerName) !== options.triggerName
    || typeof event.Message !== 'string') {
    throw forbidden()
  }
  let message
  try { message = JSON.parse(event.Message) }
  catch { throw forbidden() }
  const verified = verifyTimerMessage(message, options)
  const outerTime = Date.parse(text(event.Time))
  const fireTime = Date.parse(verified.fireAt)
  if (!Number.isFinite(outerTime) || Math.abs(outerTime - fireTime) > 5 * 60 * 1000) {
    throw forbidden()
  }
  return { event, message: verified }
}

function validateTimerFields(value) {
  if (!/^mip-[a-z0-9][a-z0-9-]{0,55}$/.test(text(value.function))
    || !/^mip-[a-z0-9][a-z0-9-]{0,95}$/.test(text(value.trigger))
    || !/^[A-Za-z0-9_-]{1,64}$/.test(text(value.namespace))
    || !/^[a-f0-9]{32}$/i.test(text(value.generation))
    || !/^[a-f0-9]{32}$/i.test(text(value.activationGeneration))
    || (text(value.purpose) === 'CANARY'
      && text(value.activationGeneration) !== text(value.generation))
    || !TIMER_PURPOSES.has(text(value.purpose))) {
    throw forbidden()
  }
  strictUtcInstant(value.fireAt)
}

function validateActivationFields(value) {
  if (!/^mip-[a-z0-9][a-z0-9-]{0,55}$/.test(text(value.function))
    || !/^mip-[a-z0-9][a-z0-9-]{0,95}$/.test(text(value.trigger))
    || !/^[A-Za-z0-9_-]{1,64}$/.test(text(value.namespace))
    || !/^mip-[a-z0-9][a-z0-9-]{0,55}$/.test(text(value.sourceFunction))
    || !/^[a-f0-9]{32}$/i.test(text(value.generation))
    || !/^[a-f0-9]{24}$/i.test(text(value.nonce))
    || !Number.isSafeInteger(value.timestamp)) {
    throw forbidden()
  }
}

function strictUtcInstant(value) {
  const source = text(value)
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.000Z$/.test(source)) throw forbidden()
  const date = new Date(source)
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== source || date.getUTCFullYear() >= 2100) {
    throw forbidden()
  }
  return source
}

function plainObjectWithKeys(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const own = Reflect.ownKeys(value)
  return own.length === keys.size
    && own.every(key => typeof key === 'string' && keys.has(key))
}

function verifySignature(value, expected) {
  const signature = text(value.signature)
  if (!/^[a-f0-9]{64}$/i.test(signature)) throw forbidden()
  const received = Buffer.from(signature, 'hex')
  const expectedBytes = Buffer.from(expected, 'hex')
  if (received.length !== expectedBytes.length || !timingSafeEqual(received, expectedBytes)) {
    throw forbidden()
  }
}

function requireSecret(secret) {
  if (typeof secret !== 'string' || secret.length < 32) {
    throw new Error('INTERNAL_AUTH_NOT_CONFIGURED')
  }
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
  ACTIVATE_ACTION,
  ACTIVATE_DOMAIN,
  ACTIVATE_PROTOCOL,
  RECONCILE_ACTION,
  RECONCILE_DOMAIN,
  RECONCILE_PROTOCOL,
  TIMER_DOMAIN,
  TIMER_PROTOCOL,
  createSchedulerActivation,
  createTimerMessage,
  parseTimerEvent,
  signSchedulerActivation,
  signSchedulerReconcile,
  signTimerMessage,
  stableJson,
  verifySchedulerActivation,
  verifySchedulerReconcile,
  verifyTimerMessage,
}
