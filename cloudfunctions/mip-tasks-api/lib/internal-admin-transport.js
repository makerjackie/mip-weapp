'use strict'

const { createHmac, timingSafeEqual } = require('node:crypto')
const { failure } = require('../domain/handler')

const TASK_ADMIN_TRANSPORT = 'MIP_TASKS_ADMIN_V1'
const TASK_ADMIN_PROTOCOL = 'mip-tasks-admin/v1'
const MAX_CLOCK_SKEW_MS = 60_000
const ACTIONS = Object.freeze(new Set([
  'admin.listTasks', 'admin.getTask', 'admin.saveTask', 'admin.publishTask',
  'admin.unpublishTask', 'admin.deleteTask', 'admin.listEligibleLevels', 'admin.listAssignableMembers',
  'admin.assignMembers', 'admin.revokeMembers', 'admin.listCompletions',
  'admin.getCompletion', 'admin.exportCompletions',
]))
const MUTATION_INPUT_KEYS = Object.freeze({
  'admin.saveTask': Object.freeze(new Set(['taskId', 'expectedVersion', 'task', 'idempotencyKey'])),
  'admin.publishTask': Object.freeze(new Set(['taskId', 'expectedVersion', 'idempotencyKey'])),
  'admin.unpublishTask': Object.freeze(new Set(['taskId', 'expectedVersion', 'idempotencyKey'])),
  'admin.deleteTask': Object.freeze(new Set(['taskId', 'expectedVersion', 'idempotencyKey'])),
  'admin.assignMembers': Object.freeze(new Set(['taskId', 'memberRefs', 'expectedVersion', 'idempotencyKey'])),
  'admin.revokeMembers': Object.freeze(new Set(['taskId', 'memberRefs', 'expectedVersion', 'idempotencyKey'])),
})
const TASK_INPUT_KEYS = Object.freeze(new Set([
  'name', 'content', 'rewardExperience', 'attachmentRequired', 'assignmentMode',
  'endsAt', 'templateAssetId', 'eligibleLevelIds',
]))
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_.:-]{12,128}$/
const SIGNED_KEYS = new Set([
  'transport', 'protocol', 'timestamp', 'nonce', 'appId', 'actorUserId',
  'action', 'input', 'sourceFunction',
])
const FRAMEWORK_KEYS = new Set(['userInfo', 'tcbContext', 'frameworkContext'])

function verifyTaskAdminRequest(value, { secret, allowedAppIds, sourceFunction = 'mip-admin-api', now = Date.now } = {}) {
  if (typeof secret !== 'string' || secret.length < 32) throw new Error('TASKS_INTERNAL_AUTH_CONFIG_REQUIRED')
  if (!isPlainRecord(value)) throw new Error('AUTH_REQUIRED')
  const signed = {}
  for (const [key, item] of Object.entries(value)) {
    if (key === 'signature') continue
    if (FRAMEWORK_KEYS.has(key)) continue
    if (!SIGNED_KEYS.has(key)) throw new Error('AUTH_REQUIRED')
    signed[key] = item
  }
  if (!hasExactKeys(signed, SIGNED_KEYS)
    || value.signature === undefined
    || typeof value.signature !== 'string'
    || !/^[a-f0-9]{64}$/.test(value.signature)
    || signed.transport !== TASK_ADMIN_TRANSPORT
    || signed.protocol !== TASK_ADMIN_PROTOCOL
    || !Number.isSafeInteger(signed.timestamp)
    || typeof now !== 'function'
    || Math.abs(Number(now()) - signed.timestamp) > MAX_CLOCK_SKEW_MS
    || typeof signed.nonce !== 'string'
    || !/^[A-Za-z0-9_-]{24,128}$/.test(signed.nonce)
    || !(allowedAppIds instanceof Set)
    || !allowedAppIds.has(signed.appId)
    || !uuid(signed.actorUserId)
    || !ACTIONS.has(signed.action)
    || !isPlainRecord(signed.input)
    || !validMutationInput(signed.action, signed.input)
    || !trustedFunctionName(signed.sourceFunction)
    || signed.sourceFunction !== sourceFunction) {
    throw new Error('AUTH_REQUIRED')
  }
  const expected = createHmac('sha256', secret)
    .update(`${TASK_ADMIN_PROTOCOL}\0${stableJson(signed)}`)
    .digest()
  const supplied = Buffer.from(value.signature, 'hex')
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    throw new Error('AUTH_REQUIRED')
  }
  return signed
}

function validMutationInput(action, input) {
  const allowed = MUTATION_INPUT_KEYS[action]
  if (!allowed) return true
  if (!IDEMPOTENCY_KEY_PATTERN.test(text(input.idempotencyKey))
    || Reflect.ownKeys(input).some(key => typeof key !== 'string' || !allowed.has(key))) {
    return false
  }
  if (action === 'admin.saveTask') {
    return isPlainRecord(input.task)
      && Reflect.ownKeys(input.task).every(key => typeof key === 'string' && TASK_INPUT_KEYS.has(key))
  }
  return true
}

function createInternalTaskHandler({
  service,
  secret,
  allowedAppIds,
  assertAdminReady,
  afterSuccessfulMutation,
  profileRefSecret,
  sourceFunction = 'mip-admin-api',
  now = Date.now,
} = {}) {
  if (!service || typeof assertAdminReady !== 'function') throw new Error('TASKS_INTERNAL_HANDLER_CONFIG_INVALID')
  const dispatch = Object.freeze({
    'admin.listTasks': (caller, input) => service.listAdminTasks(caller, input),
    'admin.getTask': (caller, input) => service.getAdminTask(caller, input),
    'admin.listEligibleLevels': caller => service.listEligibleLevels(caller),
    'admin.saveTask': (caller, input) => service.saveTask(caller, input),
    'admin.publishTask': (caller, input) => service.transitionTask(caller, input, 'PUBLISHED'),
    'admin.unpublishTask': (caller, input) => service.transitionTask(caller, input, 'UNPUBLISHED'),
    'admin.deleteTask': (caller, input) => service.transitionTask(caller, input, 'DELETED'),
    'admin.listAssignableMembers': (caller, input) => service.listAssignableMembers(caller, input),
    'admin.assignMembers': (caller, input) => service.assignMembers(caller, input),
    'admin.revokeMembers': (caller, input) => service.revokeMembers(caller, input),
    'admin.listCompletions': (caller, input) => service.listCompletions(caller, input),
    'admin.getCompletion': (caller, input) => service.getCompletion(caller, input),
    'admin.exportCompletions': (caller, input) => service.exportCompletions(caller, input),
  })
  return async function handle(event = {}) {
    try {
      const request = verifyTaskAdminRequest(event, { secret, allowedAppIds, sourceFunction, now })
      const caller = {
        appId: request.appId,
        userId: request.actorUserId,
        profileRefSecret,
      }
      await assertAdminReady(caller)
      const run = dispatch[request.action]
      if (!run) throw new Error('NOT_FOUND')
      const data = await run(caller, request.input)
      if (typeof afterSuccessfulMutation === 'function') {
        await afterSuccessfulMutation({ request, data })
      }
      return { ok: true, data }
    }
    catch (error) {
      return failure(error)
    }
  }
}

function signTaskAdminRequest(value, secret) {
  if (typeof secret !== 'string' || secret.length < 32) throw new Error('TASKS_INTERNAL_AUTH_CONFIG_REQUIRED')
  const unsigned = Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'signature'))
  return createHmac('sha256', secret).update(`${TASK_ADMIN_PROTOCOL}\0${stableJson(unsigned)}`).digest('hex')
}

function hasExactKeys(value, allowed) {
  const keys = Reflect.ownKeys(value)
  return keys.length === allowed.size && keys.every(key => typeof key === 'string' && allowed.has(key))
}

function trustedFunctionName(value) {
  return typeof value === 'string' && /^mip-[a-z0-9][a-z0-9-]{0,55}$/.test(value)
}

function uuid(value) {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function isPlainRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function stableJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`
}

function text(value) {
  return typeof value === 'string' ? value.trim() : ''
}

module.exports = {
  ACTIONS,
  MUTATION_INPUT_KEYS,
  MAX_CLOCK_SKEW_MS,
  TASK_ADMIN_PROTOCOL,
  TASK_ADMIN_TRANSPORT,
  createInternalTaskHandler,
  signTaskAdminRequest,
  verifyTaskAdminRequest,
}
