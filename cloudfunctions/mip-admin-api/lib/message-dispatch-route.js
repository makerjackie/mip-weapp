'use strict'

const {
  RUN_DUE_ACTION,
  verifyMessageDispatchRequest,
} = require('./message-dispatch-auth')

function createMessageDispatchRoute(options = {}) {
  if (!options.repository || typeof options.repository.runDueMessageCampaigns !== 'function'
    || !options.outboxWakeup || typeof options.outboxWakeup.afterSuccessfulMutation !== 'function') {
    throw new TypeError('Message dispatch route dependencies are invalid')
  }
  return async function runDueMessageCampaigns(event) {
    try {
      const trusted = verifyMessageDispatchRequest(event, {
        secret: options.secret,
        allowedAppIds: options.allowedAppIds,
        now: options.now,
      })
      const input = normalizeDispatchRun(trusted)
      const data = await options.repository.runDueMessageCampaigns(input)
      const wakeup = await options.outboxWakeup.afterSuccessfulMutation({
        appId: trusted.appId,
        action: RUN_DUE_ACTION,
        mutationActions: new Set([RUN_DUE_ACTION]),
      })
      return { ok: true, data: { ...data, outboxWakeup: wakeup.status } }
    }
    catch (error) {
      const code = error?.message === 'FORBIDDEN' || error?.message === 'INTERNAL_AUTH_NOT_CONFIGURED'
        ? 'FORBIDDEN'
        : error?.message === 'VALIDATION_FAILED'
          ? 'VALIDATION_FAILED'
          : 'SERVICE_UNAVAILABLE'
      if (code === 'SERVICE_UNAVAILABLE') {
        safeError(options.logger, error)
      }
      return {
        ok: false,
        error: {
          code,
          message: code === 'FORBIDDEN'
            ? '内部调度请求未授权'
            : code === 'VALIDATION_FAILED'
              ? '内部调度请求无效'
              : '定时发布服务暂时不可用',
          retryable: code === 'SERVICE_UNAVAILABLE',
        },
      }
    }
  }
}

function normalizeDispatchRun(input) {
  const limit = Number(input.limit)
  const drain = input.drain === true
  const maxBatches = Number(input.maxBatches)
  if (!Number.isInteger(limit) || limit < 1 || limit > 10
    || typeof input.drain !== 'boolean'
    || !Number.isInteger(maxBatches) || maxBatches < 1 || maxBatches > 100
    || (!drain && maxBatches !== 1)) {
    throw new Error('VALIDATION_FAILED')
  }
  return { appId: input.appId, limit, drain, maxBatches }
}

function safeError(logger, error) {
  try {
    logger?.error?.(
      '[mip-admin-api] scheduled dispatch failed',
      error?.code || error?.name || 'UNKNOWN',
    )
  }
  catch {}
}

module.exports = { createMessageDispatchRoute, normalizeDispatchRun }
