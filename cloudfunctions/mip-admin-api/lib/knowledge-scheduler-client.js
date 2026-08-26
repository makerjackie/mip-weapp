'use strict'

const { createHmac, randomBytes } = require('node:crypto')
const { stableJson } = require('./knowledge-scheduler-auth')

const RECONCILE_ACTION = 'reconcileKnowledgeIngestionSchedule'
const RECONCILE_PROTOCOL = 'mip-knowledge-scheduler/reconcile/v1'
const RECONCILE_DOMAIN = 'mip-knowledge-scheduler:reconcile:v1'
const DEFAULT_RECONCILE_TIMEOUT_MS = 45_000
const MAX_RECONCILE_TIMEOUT_MS = 50_000

function createKnowledgeSchedulerClient(options = {}) {
  const now = options.now || Date.now
  const functionName = text(options.functionName) || 'mip-knowledge-scheduler'
  const sourceFunction = text(options.sourceFunction) || 'mip-admin-api'
  const timeoutMs = boundedTimeout(options.timeoutMs)
  const configured = Boolean(
    options.cloud
    && typeof options.cloud.callFunction === 'function'
    && typeof options.secret === 'string'
    && options.secret.length >= 32
    && /^mip-[a-z0-9][a-z0-9-]{0,55}$/.test(functionName)
    && functionName !== sourceFunction,
  )

  return {
    configured,
    async reconcile({ action, appId, mutationActions }) {
      if (!(mutationActions instanceof Set) || !mutationActions.has(action)) {
        return { status: 'SKIPPED' }
      }
      if (!configured || !text(appId)) return { status: 'FAILED' }
      const request = {
        action: RECONCILE_ACTION,
        protocol: RECONCILE_PROTOCOL,
        appId: text(appId),
        sourceFunction,
        nonce: randomBytes(12).toString('hex'),
        timestamp: Number(now()),
      }
      request.signature = signSchedulerReconcile(request, options.secret)
      try {
        const response = await invokeWithTimeout(
          options.cloud.callFunction({ name: functionName, data: request }),
          timeoutMs,
        )
        if (response?.result?.ok !== true || response?.result?.data?.verified !== true) {
          throw new Error(publicErrorCode(response?.result?.error?.code))
        }
        return { status: 'VERIFIED' }
      }
      catch (error) {
        safeWarn(options.logger, action, error)
        return { status: 'FAILED' }
      }
    },
  }
}

function signSchedulerReconcile(value, secret) {
  if (typeof secret !== 'string' || secret.length < 32) {
    throw new Error('INTERNAL_AUTH_NOT_CONFIGURED')
  }
  const unsigned = Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'signature'))
  return createHmac('sha256', secret)
    .update(`${RECONCILE_DOMAIN}\0${stableJson(unsigned)}`)
    .digest('hex')
}

async function invokeWithTimeout(invocation, timeoutMs) {
  let timer
  try {
    return await Promise.race([
      invocation,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('KNOWLEDGE_SCHEDULER_TIMEOUT')), timeoutMs)
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
  return Number.isInteger(requested) && requested >= 250 && requested <= MAX_RECONCILE_TIMEOUT_MS
    ? requested
    : DEFAULT_RECONCILE_TIMEOUT_MS
}

function publicErrorCode(value) {
  const code = text(value)
  return /^[A-Z][A-Z0-9_]{2,63}$/.test(code) ? code : 'KNOWLEDGE_SCHEDULER_UNAVAILABLE'
}

function safeWarn(logger, action, error) {
  try {
    logger?.warn?.('[mip-knowledge-scheduler-client]', {
      code: publicErrorCode(error?.message),
      event: 'scheduler_reconcile_unverified',
      sourceAction: /^[\w.-]{1,80}$/.test(text(action)) ? text(action) : 'unknown',
    })
  }
  catch {}
}

function text(value) {
  return typeof value === 'string' ? value.trim() : ''
}

module.exports = {
  DEFAULT_RECONCILE_TIMEOUT_MS,
  MAX_RECONCILE_TIMEOUT_MS,
  RECONCILE_ACTION,
  RECONCILE_DOMAIN,
  RECONCILE_PROTOCOL,
  boundedTimeout,
  createKnowledgeSchedulerClient,
  signSchedulerReconcile,
}
