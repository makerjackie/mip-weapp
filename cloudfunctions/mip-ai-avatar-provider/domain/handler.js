'use strict'

const { requireReady } = require('../lib/config')

const publicErrorCodes = new Set([
  'DIGITAL_AVATAR_PROVIDER_IMAGE_INVALID',
  'DIGITAL_AVATAR_PROVIDER_IMAGE_UNAVAILABLE',
  'DIGITAL_AVATAR_PROVIDER_NOT_CONFIGURED',
  'DIGITAL_AVATAR_PROVIDER_REDIRECT_REJECTED',
  'DIGITAL_AVATAR_PROVIDER_REQUEST_INVALID',
  'DIGITAL_AVATAR_PROVIDER_RESPONSE_INVALID',
  'DIGITAL_AVATAR_PROVIDER_UPSTREAM_UNAVAILABLE',
  'FORBIDDEN',
  'IDEMPOTENCY_CONFLICT',
])

function createHandler(resolveRuntime) {
  return async (event = {}) => {
    const runtime = resolveRuntime()
    if (event?.action === 'health') {
      return success({
        service: runtime.config.functionName,
        persistence: 'none',
        configured: runtime.config.configured,
      })
    }
    if (event?.action === 'readiness') {
      try {
        requireReady(runtime.config)
        await runtime.upstream.readiness()
        return success({
          service: runtime.config.functionName,
          persistence: 'none',
          ready: true,
        })
      }
      catch (error) {
        safeWarn(error, 'readiness')
        return failure(error)
      }
    }
    try {
      requireReady(runtime.config)
      return await runtime.provider.handle(event)
    }
    catch (error) {
      safeWarn(error, event?.action)
      return failure(error)
    }
  }
}

function success(data) {
  return { ok: true, data }
}

function failure(error) {
  const raw = error instanceof Error ? error.message : ''
  const code = publicErrorCodes.has(raw) ? raw : 'DIGITAL_AVATAR_PROVIDER_UNAVAILABLE'
  return {
    ok: false,
    error: {
      code,
      message: code === 'FORBIDDEN' ? '内部调用未授权' : '数字分身服务暂时不可用',
      retryable: ![
        'FORBIDDEN',
        'IDEMPOTENCY_CONFLICT',
        'DIGITAL_AVATAR_PROVIDER_REQUEST_INVALID',
      ].includes(code),
    },
  }
}

function safeWarn(error, action) {
  try {
    console.warn('[mip-ai-avatar-provider]', {
      event: 'provider_invocation_failed',
      action: action === 'generateDigitalAvatar' || action === 'readiness' ? action : 'unknown',
      code: publicErrorCode(error),
    })
  }
  catch {}
}

function publicErrorCode(error) {
  const code = error instanceof Error ? error.message : ''
  return publicErrorCodes.has(code) ? code : 'DIGITAL_AVATAR_PROVIDER_UNAVAILABLE'
}

module.exports = { createHandler, failure, publicErrorCode, safeWarn, success }
