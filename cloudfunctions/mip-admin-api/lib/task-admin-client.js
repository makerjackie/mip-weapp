'use strict'

const { createHmac, randomBytes } = require('node:crypto')

const TASK_ADMIN_TRANSPORT = 'MIP_TASKS_ADMIN_V1'
const TASK_ADMIN_PROTOCOL = 'mip-tasks-admin/v1'
const DEFAULT_TIMEOUT_MS = 45_000
const MAX_TIMEOUT_MS = 50_000
const TASK_ADMIN_MUTATION_ACTIONS = Object.freeze(new Set([
  'mip.admin.tasks.save',
  'mip.admin.tasks.publish',
  'mip.admin.tasks.unpublish',
  'mip.admin.tasks.delete',
  'mip.admin.tasks.assignMembers',
  'mip.admin.tasks.revokeMembers',
]))
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_.:-]{12,128}$/

const OPERATION_SPECS = Object.freeze({
  'mip.admin.tasks.list': spec('admin.listTasks', ['filters', 'limit', 'cursor'], { filters: ['status', 'query'] }),
  'mip.admin.tasks.get': spec('admin.getTask', ['taskId']),
  'mip.admin.tasks.save': spec('admin.saveTask', ['taskId', 'expectedVersion', 'task', 'idempotencyKey'], {
    task: ['name', 'content', 'rewardExperience', 'attachmentRequired', 'assignmentMode', 'endsAt', 'templateAssetId', 'eligibleLevelIds'],
  }),
  'mip.admin.tasks.publish': spec('admin.publishTask', ['taskId', 'expectedVersion', 'idempotencyKey']),
  'mip.admin.tasks.unpublish': spec('admin.unpublishTask', ['taskId', 'expectedVersion', 'idempotencyKey']),
  'mip.admin.tasks.delete': spec('admin.deleteTask', ['taskId', 'expectedVersion', 'idempotencyKey']),
  'mip.admin.tasks.assignableMembers.list': spec('admin.listAssignableMembers', ['filters', 'limit', 'cursor'], { filters: ['taskId', 'query'] }),
  'mip.admin.tasks.assignMembers': spec('admin.assignMembers', ['taskId', 'memberRefs', 'expectedVersion', 'idempotencyKey']),
  'mip.admin.tasks.revokeMembers': spec('admin.revokeMembers', ['taskId', 'memberRefs', 'expectedVersion', 'idempotencyKey']),
  'mip.admin.tasks.completions.list': spec('admin.listCompletions', ['filters', 'limit', 'cursor'], { filters: ['taskId', 'query', 'resultStatus', 'completedFrom', 'completedUntil'] }),
  'mip.admin.tasks.completions.get': spec('admin.getCompletion', ['completionId']),
  'mip.admin.tasks.completions.export': spec('admin.exportCompletions', ['filters'], { filters: ['taskId', 'query', 'resultStatus', 'completedFrom', 'completedUntil'] }),
})

function spec(internalAction, inputKeys, nestedKeys = {}) {
  return Object.freeze({
    internalAction,
    inputKeys: Object.freeze([...inputKeys]),
    nestedKeys: Object.freeze(Object.fromEntries(
      Object.entries(nestedKeys).map(([key, keys]) => [key, Object.freeze([...keys])]),
    )),
  })
}

function createTaskAdminClient(options = {}) {
  const functionName = text(options.functionName) || 'mip-tasks-api'
  const sourceFunction = text(options.sourceFunction) || 'mip-admin-api'
  const timeoutMs = boundedTimeout(options.timeoutMs)
  const configured = Boolean(
    options.cloud
    && typeof options.cloud.callFunction === 'function'
    && typeof options.secret === 'string'
    && options.secret.length >= 32
    && validFunctionName(functionName)
    && validFunctionName(sourceFunction)
    && functionName !== sourceFunction,
  )
  const now = options.now || Date.now
  const nonce = options.nonce || (() => randomBytes(18).toString('base64url'))

  return Object.freeze({
    configured,
    async execute({ appId, actorUserId, action, input = {} } = {}) {
      const operation = OPERATION_SPECS[action]
      if (!operation) throw codedError('TASKS_OPERATION_NOT_ALLOWED')
      assertInput(operation, input)
      if (TASK_ADMIN_MUTATION_ACTIONS.has(action)
        && !IDEMPOTENCY_KEY_PATTERN.test(text(input.idempotencyKey))) {
        throw codedError('VALIDATION_FAILED')
      }
      if (!configured || typeof now !== 'function' || typeof nonce !== 'function') {
        throw codedError('TASKS_DISPATCH_CONFIG_REQUIRED')
      }
      if (!trustedIdentifier(appId, 64) || !uuid(actorUserId)) {
        throw codedError('AUTH_REQUIRED')
      }
      const timestamp = Number(now())
      const requestNonce = nonce()
      if (!Number.isSafeInteger(timestamp) || !/^[A-Za-z0-9_-]{24,128}$/.test(requestNonce)) {
        throw codedError('TASKS_DISPATCH_CONFIG_REQUIRED')
      }
      const request = {
        transport: TASK_ADMIN_TRANSPORT,
        protocol: TASK_ADMIN_PROTOCOL,
        timestamp,
        nonce: requestNonce,
        appId,
        actorUserId,
        action: operation.internalAction,
        input: { ...input },
        sourceFunction,
      }
      request.signature = signTaskAdminRequest(request, options.secret)
      let response
      try {
        response = await invokeWithTimeout(
          options.cloud.callFunction({ name: functionName, data: request }),
          timeoutMs,
        )
      }
      catch {
        throw codedError('TASKS_DISPATCH_UNAVAILABLE')
      }
      if (response?.result?.ok !== true) {
        throw codedError(publicErrorCode(response?.result?.error?.code))
      }
      return response.result.data
    },
  })
}

function assertInput(operation, input) {
  if (!isPlainRecord(input)) throw codedError('VALIDATION_FAILED')
  assertKeys(input, operation.inputKeys)
  for (const [key, allowed] of Object.entries(operation.nestedKeys)) {
    if (Object.hasOwn(input, key)) {
      if (!isPlainRecord(input[key])) throw codedError('VALIDATION_FAILED')
      assertKeys(input[key], allowed)
    }
  }
}

function assertKeys(value, allowedKeys) {
  const allowed = new Set(allowedKeys)
  if (Reflect.ownKeys(value).some(key => typeof key !== 'string' || !allowed.has(key))) {
    throw codedError('VALIDATION_FAILED')
  }
}

function signTaskAdminRequest(value, secret) {
  if (typeof secret !== 'string' || secret.length < 32) {
    throw codedError('TASKS_DISPATCH_CONFIG_REQUIRED')
  }
  const unsigned = Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'signature'))
  return createHmac('sha256', secret).update(`${TASK_ADMIN_PROTOCOL}\0${stableJson(unsigned)}`).digest('hex')
}

async function invokeWithTimeout(invocation, timeoutMs) {
  let timer
  try {
    return await Promise.race([
      invocation,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('TASKS_DISPATCH_TIMEOUT')), timeoutMs)
        timer.unref?.()
      }),
    ])
  }
  finally {
    clearTimeout(timer)
  }
}

function boundedTimeout(value) {
  const requested = Number(value)
  return Number.isInteger(requested) && requested >= 250 && requested <= MAX_TIMEOUT_MS
    ? requested
    : DEFAULT_TIMEOUT_MS
}

function validFunctionName(value) {
  return /^mip-[a-z0-9][a-z0-9-]{0,55}$/.test(value)
}

function trustedIdentifier(value, maximum) {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum
    && /^[A-Za-z0-9_-]+$/.test(value)
}

function uuid(value) {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function publicErrorCode(value) {
  const code = text(value)
  return /^[A-Z][A-Z0-9_]{2,63}$/.test(code) ? code : 'TASKS_DISPATCH_UNAVAILABLE'
}

function codedError(code) {
  const error = new Error(code)
  error.code = code
  return error
}

function stableJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`
}

function isPlainRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function text(value) {
  return typeof value === 'string' ? value.trim() : ''
}

module.exports = {
  DEFAULT_TIMEOUT_MS,
  MAX_TIMEOUT_MS,
  OPERATION_SPECS,
  TASK_ADMIN_MUTATION_ACTIONS,
  TASK_ADMIN_PROTOCOL,
  TASK_ADMIN_TRANSPORT,
  boundedTimeout,
  createTaskAdminClient,
  signTaskAdminRequest,
}
