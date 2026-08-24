'use strict'

const { createHash, createHmac } = require('node:crypto')

function createOutboxWakeup(options = {}) {
  const now = options.now || Date.now
  const invocationTimeoutMs = boundedTimeout(options.invocationTimeoutMs)
  const functionName = text(options.functionName) || 'mip-outbox-worker'
  const sourceFunctionName = text(options.sourceFunctionName)
  const configured = Boolean(
    options.cloud
    && typeof options.cloud.callFunction === 'function'
    && typeof options.secret === 'string'
    && options.secret.length >= 32
    && /^mip-[a-z0-9][a-z0-9-]{0,55}$/.test(functionName)
    && functionName !== sourceFunctionName,
  )

  return {
    async afterSuccessfulMutation({ appId, action, mutationActions }) {
      if (!(mutationActions instanceof Set) || !mutationActions.has(action) || !configured) {
        return { status: 'SKIPPED' }
      }
      const request = {
        action: 'runBatch',
        appId: text(appId),
        drain: true,
        limit: 10,
        maxBatches: 100,
        timestamp: Number(now()),
      }
      if (!request.appId) {
        return { status: 'SKIPPED' }
      }
      request.signature = signOutboxWakeup(request, options.secret)
      try {
        const response = await invokeWithTimeout(
          options.cloud.callFunction({ name: functionName, data: request }),
          invocationTimeoutMs,
        )
        if (response?.result?.ok !== true) {
          throw new Error(publicErrorCode(response?.result?.error?.code))
        }
        return { status: 'INVOKED' }
      }
      catch (error) {
        safeWarn(options.logger, {
          event: 'outbox_wakeup_failed',
          sourceAction: safeAction(action),
          code: publicErrorCode(error?.message),
        })
        return { status: 'FAILED' }
      }
    },
  }
}

function boundedTimeout(value) {
  const requested = Number(value)
  return Number.isInteger(requested) && requested >= 250 && requested <= 5000 ? requested : 3000
}

async function invokeWithTimeout(invocation, timeoutMs) {
  let timer
  try {
    return await Promise.race([
      invocation,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('OUTBOX_WAKEUP_TIMEOUT')), timeoutMs)
        timer.unref?.()
      }),
    ])
  }
  finally {
    clearTimeout(timer)
  }
}

function signOutboxWakeup(event, secret) {
  const body = Object.fromEntries(
    Object.entries(event).filter(([key]) => !['signature', 'timestamp'].includes(key)),
  )
  const canonical = [
    Number(event.timestamp),
    text(event.action),
    text(event.appId),
    createHash('sha256').update(stableJson(body)).digest('hex'),
  ].join('\n')
  return createHmac('sha256', secret).update(canonical).digest('hex')
}

function trustedContextAppId(context = {}, allowedAppIds) {
  const fromAppId = text(context.FROM_APPID)
  const fromOpenId = text(context.FROM_OPENID)
  const directAppId = text(context.APPID)
  const directOpenId = text(context.OPENID)
  const delegated = Boolean(fromAppId || fromOpenId)
  const appId = delegated ? fromAppId : directAppId
  const openId = delegated ? fromOpenId : directOpenId
  if (!appId || !openId || (delegated && (!fromAppId || !fromOpenId))) {
    return ''
  }
  return allowedAppIds instanceof Set && allowedAppIds.has(appId) ? appId : ''
}

function stableJson(value) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(',')}]`
  }
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`
}

function publicErrorCode(value) {
  const code = text(value)
  return /^[A-Z][A-Z0-9_]{2,63}$/.test(code) ? code : 'INTERNAL_FUNCTION_FAILED'
}

function safeAction(value) {
  const action = text(value)
  return /^[\w.-]{1,80}$/.test(action) ? action : 'unknown'
}

function safeWarn(logger, detail) {
  try {
    if (logger && typeof logger.warn === 'function') {
      logger.warn('[mip-outbox-wakeup]', detail)
    }
  }
  catch {}
}

function text(value) {
  return typeof value === 'string' ? value.trim() : ''
}

module.exports = { createOutboxWakeup, signOutboxWakeup, trustedContextAppId }
