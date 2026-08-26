'use strict'

const {
  GET_WAKE_PLAN_ACTION,
  verifyKnowledgeSchedulerRequest,
} = require('./knowledge-scheduler-auth')

function createKnowledgeSchedulerRoute(options = {}) {
  if (!options.service
    || typeof options.service.getWakePlan !== 'function'
    || typeof options.service.runDue !== 'function') {
    throw new TypeError('KNOWLEDGE_SCHEDULER_ROUTE_DEPENDENCIES_INVALID')
  }
  return async function route(event) {
    try {
      const trusted = verifyKnowledgeSchedulerRequest(event, {
        allowedAppIds: options.allowedAppIds,
        now: options.now,
        secret: options.secret,
      })
      const data = trusted.action === GET_WAKE_PLAN_ACTION
        ? await options.service.getWakePlan({ appId: trusted.appId })
        : await options.service.runDue({ appId: trusted.appId, limit: trusted.limit })
      return { ok: true, data }
    }
    catch (error) {
      const code = internalErrorCode(error)
      if (code === 'SERVICE_UNAVAILABLE') safeError(options.logger, error)
      return {
        ok: false,
        error: {
          code,
          message: code === 'FORBIDDEN'
            ? '内部热点调度请求未授权'
            : code === 'VALIDATION_FAILED'
              ? '内部热点调度请求无效'
              : '热点采集调度服务暂时不可用',
          retryable: code === 'SERVICE_UNAVAILABLE',
        },
      }
    }
  }
}

function internalErrorCode(error) {
  const code = error?.code || error?.message
  if (['FORBIDDEN', 'INTERNAL_AUTH_NOT_CONFIGURED'].includes(code)) return 'FORBIDDEN'
  if (code === 'VALIDATION_FAILED') return 'VALIDATION_FAILED'
  return 'SERVICE_UNAVAILABLE'
}

function safeError(logger, error) {
  try {
    logger?.error?.('[mip-admin-api] knowledge scheduler failed', publicErrorCode(error))
  }
  catch {}
}

function publicErrorCode(error) {
  const code = String(error?.code || error?.message || '').trim()
  return /^[A-Z][A-Z0-9_]{2,63}$/.test(code) ? code : 'KNOWLEDGE_SCHEDULER_FAILED'
}

module.exports = { createKnowledgeSchedulerRoute, internalErrorCode }
