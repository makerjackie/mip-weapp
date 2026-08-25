'use strict'

const { createHash, createHmac, randomBytes } = require('node:crypto')

const DEFAULT_TIMEOUT_MS = 15_000

function createNotificationReconcileClient(options = {}) {
  const configured = Boolean(
    options.cloud
    && typeof options.cloud.callFunction === 'function'
    && /^mip-[a-z0-9][a-z0-9-]{0,55}$/.test(String(options.functionName || ''))
    && typeof options.secret === 'string'
    && options.secret.length >= 32,
  )
  const now = options.now || Date.now
  const timeoutMs = boundedTimeout(options.timeoutMs)

  return {
    configured,
    async reconcile(input) {
      if (!configured) throw publicError('DELIVERY_RECONCILE_CONFIG_REQUIRED', false)
      const request = {
        action: 'reconcileDeliveryTask',
        appId: input.appId,
        actorUserId: input.actorUserId,
        taskId: input.taskId,
        expectedEvidenceRevision: input.expectedEvidenceRevision,
        idempotencyKey: input.idempotencyKey,
        nonce: randomBytes(12).toString('hex'),
        timestamp: Number(now()),
      }
      request.signature = createHmac('sha256', options.secret)
        .update(canonical(request))
        .digest('hex')
      let response
      try {
        response = await withTimeout(options.cloud.callFunction({
          name: options.functionName,
          data: request,
        }), timeoutMs)
      }
      catch {
        throw publicError('DELIVERY_RECONCILE_UNAVAILABLE', true)
      }
      if (response?.result?.ok !== true) {
        const code = safeCode(response?.result?.error?.code)
        throw publicError(code, response?.result?.error?.retryable === true)
      }
      return parseResponse(response.result.data, input.taskId)
    },
  }
}

function canonical(event) {
  const body = Object.fromEntries(
    Object.entries(event).filter(([key]) => !['signature', 'timestamp'].includes(key)),
  )
  return [
    Number(event.timestamp),
    String(event.action || '').trim(),
    String(event.appId || '').trim(),
    createHash('sha256').update(stableJson(body)).digest('hex'),
  ].join('\n')
}

function stableJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`
}

function parseResponse(value, taskId) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || value.taskId !== taskId
    || !['QUARANTINED', 'UNCHANGED', 'RETRYABLE_UNCHANGED'].includes(value.effect)
    || !/^[0-9a-f]{64}$/.test(value.beforeEvidenceRevision || '')
    || !/^[0-9a-f]{64}$/.test(value.afterEvidenceRevision || '')
    || !value.source || typeof value.source !== 'object' || Array.isArray(value.source)) {
    throw publicError('DELIVERY_RECONCILE_RESPONSE_INVALID', true)
  }
  return value
}

async function withTimeout(invocation, timeoutMs) {
  let timer
  try {
    return await Promise.race([
      invocation,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('DELIVERY_RECONCILE_TIMEOUT')), timeoutMs)
        timer.unref?.()
      }),
    ])
  }
  finally {
    clearTimeout(timer)
  }
}

function boundedTimeout(value) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= 250 && parsed <= 20_000
    ? parsed
    : DEFAULT_TIMEOUT_MS
}

function publicError(code, retryable) {
  const error = new Error(code)
  error.code = code
  error.retryable = retryable
  return error
}

function safeCode(value) {
  const code = typeof value === 'string' ? value.trim() : ''
  return /^[A-Z][A-Z0-9_]{2,63}$/.test(code) ? code : 'DELIVERY_RECONCILE_UNAVAILABLE'
}

module.exports = {
  DEFAULT_TIMEOUT_MS,
  canonical,
  createNotificationReconcileClient,
  parseResponse,
  stableJson,
}
