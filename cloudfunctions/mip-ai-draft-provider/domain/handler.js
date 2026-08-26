'use strict'

const { requireReady } = require('../lib/config')

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
  const allowed = new Set([
    'AI_DRAFT_PROVIDER_AUDIO_INVALID',
    'AI_DRAFT_PROVIDER_AUDIO_UNAVAILABLE',
    'AI_DRAFT_PROVIDER_NOT_CONFIGURED',
    'AI_DRAFT_PROVIDER_REDIRECT_REJECTED',
    'AI_DRAFT_PROVIDER_REQUEST_INVALID',
    'AI_DRAFT_PROVIDER_RESPONSE_INVALID',
    'AI_DRAFT_PROVIDER_UPSTREAM_UNAVAILABLE',
    'FORBIDDEN',
    'IDEMPOTENCY_CONFLICT',
  ])
  const code = allowed.has(raw) ? raw : 'AI_DRAFT_PROVIDER_UNAVAILABLE'
  return {
    ok: false,
    error: {
      code,
      message: code === 'FORBIDDEN' ? '内部调用未授权' : 'AI 草稿服务暂时不可用',
      retryable: !['FORBIDDEN', 'IDEMPOTENCY_CONFLICT', 'AI_DRAFT_PROVIDER_REQUEST_INVALID'].includes(code),
    },
  }
}

function safeWarn(error, action) {
  try {
    console.warn('[mip-ai-draft-provider]', {
      event: 'provider_invocation_failed',
      action: typeof action === 'string' && /^[a-zA-Z]+$/.test(action) ? action : 'unknown',
      code: publicErrorCode(error),
    })
  }
  catch {}
}

function publicErrorCode(error) {
  const code = error instanceof Error ? error.message : ''
  return /^[A-Z][A-Z0-9_]{2,63}$/.test(code) ? code : 'AI_DRAFT_PROVIDER_UNAVAILABLE'
}

module.exports = { createHandler, failure, publicErrorCode, safeWarn, success }
