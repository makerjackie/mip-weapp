'use strict'

const { randomBytes } = require('node:crypto')
const { createTimerMessage, verifyTimerMessage } = require('./auth')

const CONTROL_PLANE_PROPAGATION_MS = 30_000
const MINIMUM_WAKE_DELAY_MS = 60_000
const MAX_REARM_ATTEMPTS = 3

function createTriggerController(options) {
  const { config, scf } = options
  const now = options.now || Date.now
  const generation = options.generation || (() => randomBytes(16).toString('hex'))
  if (!scf || typeof scf.ListTriggers !== 'function' || typeof scf.UpdateTrigger !== 'function') {
    throw new TypeError('SCF_TRIGGER_CLIENT_INVALID')
  }

  async function read() {
    const response = await scf.ListTriggers({
      FunctionName: config.functionName,
      Namespace: config.namespace,
      Limit: 100,
      Offset: 0,
    })
    const triggers = triggerList(response)
    if (triggers.length !== 1) throw new Error('SCHEDULER_TRIGGER_INVENTORY_INVALID')
    const trigger = triggers[0]
    if (trigger.TriggerName !== config.triggerName
      || String(trigger.Type || '').toLowerCase() !== 'timer'
      || trigger.Qualifier !== '$DEFAULT') {
      throw new Error('SCHEDULER_TRIGGER_IDENTITY_INVALID')
    }
    return trigger
  }

  async function currentMessage() {
    const trigger = await read()
    return { trigger, message: verifiedArgument(trigger) }
  }

  async function matches(message) {
    const current = await currentMessage()
    return current.message.generation === message.generation
      && current.message.fireAt === message.fireAt
      && current.message.activationGeneration === message.activationGeneration
      && current.message.purpose === message.purpose
      && normalizeEnable(current.trigger.Enable) === 'OPEN'
  }

  async function assertReconcileAllowed() {
    const current = await currentMessage()
    if (current.message.purpose === 'CANARY') {
      throw new Error('KNOWLEDGE_SCHEDULER_CANARY_LOCKED')
    }
    if (current.message.purpose !== 'DISPATCH') {
      throw new Error('SCHEDULER_TRIGGER_ARGUMENT_INVALID')
    }
    return current
  }

  async function setWake(requestedAt, purpose = 'DISPATCH') {
    if (purpose !== 'DISPATCH') throw new Error('SCHEDULER_TRIGGER_PURPOSE_INVALID')
    for (let attempt = 1; attempt <= MAX_REARM_ATTEMPTS; attempt += 1) {
      const current = await assertReconcileAllowed()
      const fireAt = boundedFireAt(requestedAt, Number(now()))
      const cron = oneShotCron(fireAt, config.cronUtcOffsetMinutes)
      const message = createTimerMessage({
        namespace: config.namespace,
        functionName: config.functionName,
        triggerName: config.triggerName,
        fireAt: fireAt.toISOString(),
        generation: generation(),
        activationGeneration: current.message.activationGeneration,
        purpose,
      }, config.secret)
      await scf.UpdateTrigger(updateRequest(config, {
        argument: JSON.stringify(message),
        cron,
        enable: 'OPEN',
      }))
      const readback = await currentMessage()
      if (normalizeEnable(readback.trigger.Enable) !== 'OPEN'
        || triggerDescription(readback.trigger) !== cron
        || readback.message.generation !== message.generation
        || readback.message.fireAt !== message.fireAt
        || readback.message.purpose !== purpose) {
        throw new Error('SCHEDULER_TRIGGER_READBACK_FAILED')
      }
      if (Date.parse(message.fireAt) - Number(now()) >= CONTROL_PLANE_PROPAGATION_MS) {
        return {
          state: 'OPEN',
          fireAt: message.fireAt,
          generation: message.generation,
          purpose,
          rearmAttempts: attempt,
        }
      }
    }
    throw new Error('SCHEDULER_TRIGGER_PROPAGATION_UNVERIFIED')
  }

  async function close(expectedMessage) {
    const current = await currentMessage()
    if (expectedMessage && (current.message.generation !== expectedMessage.generation
      || current.message.fireAt !== expectedMessage.fireAt
      || current.message.activationGeneration !== expectedMessage.activationGeneration
      || current.message.purpose !== expectedMessage.purpose)) {
      return { state: 'STALE', generation: current.message.generation }
    }
    if (!expectedMessage && current.message.purpose === 'CANARY') {
      throw new Error('KNOWLEDGE_SCHEDULER_CANARY_LOCKED')
    }
    await scf.UpdateTrigger(updateRequest(config, {
      argument: triggerArgument(current.trigger),
      cron: triggerDescription(current.trigger),
      enable: 'CLOSE',
    }))
    const readback = await currentMessage()
    if (normalizeEnable(readback.trigger.Enable) !== 'CLOSE'
      || readback.message.generation !== current.message.generation) {
      throw new Error('SCHEDULER_TRIGGER_READBACK_FAILED')
    }
    return { state: 'CLOSED', generation: current.message.generation }
  }

  async function activateCanary(expectedGeneration) {
    const current = await currentMessage()
    if (current.message.purpose === 'DISPATCH'
      && current.message.activationGeneration === expectedGeneration) {
      return {
        state: 'ACTIVE',
        generation: current.message.generation,
        resumed: true,
      }
    }
    if (normalizeEnable(current.trigger.Enable) !== 'CLOSE'
      || current.message.purpose !== 'CANARY'
      || current.message.generation !== expectedGeneration
      || current.message.activationGeneration !== expectedGeneration
      || Date.parse(current.message.fireAt) > Number(now())) {
      throw new Error('KNOWLEDGE_SCHEDULER_CANARY_NOT_VERIFIED')
    }
    const activeMessage = createTimerMessage({
      namespace: config.namespace,
      functionName: config.functionName,
      triggerName: config.triggerName,
      fireAt: current.message.fireAt,
      generation: generation(),
      activationGeneration: expectedGeneration,
      purpose: 'DISPATCH',
    }, config.secret)
    await scf.UpdateTrigger(updateRequest(config, {
      argument: JSON.stringify(activeMessage),
      cron: triggerDescription(current.trigger),
      enable: 'CLOSE',
    }))
    const readback = await currentMessage()
    if (normalizeEnable(readback.trigger.Enable) !== 'CLOSE'
      || readback.message.purpose !== 'DISPATCH'
      || readback.message.generation !== activeMessage.generation
      || readback.message.fireAt !== activeMessage.fireAt) {
      throw new Error('SCHEDULER_TRIGGER_READBACK_FAILED')
    }
    return { state: 'ACTIVE', generation: activeMessage.generation, resumed: false }
  }

  function verifiedArgument(trigger) {
    let parsed
    try { parsed = JSON.parse(triggerArgument(trigger)) }
    catch { throw new Error('SCHEDULER_TRIGGER_ARGUMENT_INVALID') }
    try {
      return verifyTimerMessage(parsed, config)
    }
    catch {
      throw new Error('SCHEDULER_TRIGGER_ARGUMENT_INVALID')
    }
  }

  return { activateCanary, assertReconcileAllowed, close, currentMessage, matches, read, setWake }
}

function oneShotCron(value, utcOffsetMinutes) {
  const date = value instanceof Date ? value : new Date(value)
  if (!Number.isFinite(date.getTime()) || date.getUTCFullYear() >= 2100) {
    throw new Error('SCHEDULER_WAKE_TIME_INVALID')
  }
  const wallClock = new Date(date.getTime() + utcOffsetMinutes * 60_000)
  if (wallClock.getUTCFullYear() >= 2100) throw new Error('SCHEDULER_WAKE_TIME_INVALID')
  return [
    wallClock.getUTCSeconds(),
    wallClock.getUTCMinutes(),
    wallClock.getUTCHours(),
    wallClock.getUTCDate(),
    wallClock.getUTCMonth() + 1,
    '?',
    wallClock.getUTCFullYear(),
  ].join(' ')
}

function boundedFireAt(value, now) {
  const requested = value instanceof Date ? value : new Date(value)
  if (!Number.isFinite(requested.getTime())) throw new Error('SCHEDULER_WAKE_TIME_INVALID')
  const earliest = Math.ceil((now + MINIMUM_WAKE_DELAY_MS) / 1000) * 1000
  const requestedSecond = Math.ceil(requested.getTime() / 1000) * 1000
  const fireAt = new Date(Math.max(earliest, requestedSecond))
  if (fireAt.getUTCFullYear() >= 2100) throw new Error('SCHEDULER_WAKE_TIME_INVALID')
  return fireAt
}

function updateRequest(config, value) {
  return {
    FunctionName: config.functionName,
    TriggerName: config.triggerName,
    Type: 'timer',
    TriggerDesc: value.cron,
    Qualifier: '$DEFAULT',
    Enable: value.enable,
    CustomArgument: value.argument,
    Namespace: config.namespace,
  }
}

function triggerList(value) {
  const candidates = [
    { list: value?.Triggers, total: value?.TotalCount },
    { list: value?.Response?.Triggers, total: value?.Response?.TotalCount },
    { list: value?.data?.Triggers, total: value?.data?.TotalCount },
    { list: value?.data?.triggers, total: value?.data?.totalCount },
  ]
  const inventory = candidates.find(item => Array.isArray(item.list) || item.total === 0)
  const list = Array.isArray(inventory?.list) ? inventory.list : []
  if (!inventory
    || !Number.isSafeInteger(inventory.total)
    || inventory.total !== list.length) {
    throw new Error('SCHEDULER_TRIGGER_READ_FAILED')
  }
  return list
}

function triggerArgument(trigger) {
  const value = trigger?.CustomArgument ?? trigger?.Argument ?? trigger?.Message
  if (typeof value !== 'string' || !value) throw new Error('SCHEDULER_TRIGGER_ARGUMENT_INVALID')
  return value
}

function triggerDescription(trigger) {
  const value = trigger?.TriggerDesc ?? trigger?.TriggerDescription
  if (typeof value !== 'string' || !value) throw new Error('SCHEDULER_TRIGGER_DESCRIPTION_INVALID')
  return value
}

function normalizeEnable(value) {
  if (value === 1 || value === '1') return 'OPEN'
  if (value === 0 || value === '0') return 'CLOSE'
  const normalized = String(value || '').trim().toUpperCase()
  return normalized === 'OPEN' || normalized === 'CLOSE' ? normalized : ''
}

module.exports = {
  CONTROL_PLANE_PROPAGATION_MS,
  MAX_REARM_ATTEMPTS,
  MINIMUM_WAKE_DELAY_MS,
  boundedFireAt,
  createTriggerController,
  oneShotCron,
  triggerList,
}
