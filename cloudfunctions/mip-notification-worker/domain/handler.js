'use strict'

const messages = {
  FORBIDDEN: '当前没有权限执行此操作',
  EVIDENCE_CHANGED: '投递证据已变化，请刷新后重试',
  IDEMPOTENCY_CONFLICT: '重复请求的内容不一致',
  INBOX_TARGET_INVALID: '消息目标不可用',
  INTERNAL_AUTH_NOT_CONFIGURED: '通知内部调用尚未配置',
  NOT_FOUND: '操作不存在',
  NOT_ACTIONABLE: '当前投递状态不需要人工处理',
  REQUEST_IN_PROGRESS: '相同投递复核正在处理中',
  NOTIFICATION_ENCRYPTION_NOT_CONFIGURED: '微信通知加密服务尚未配置',
  TEMPLATE_MISSING: '微信通知模板尚未配置',
  VALIDATION_FAILED: '提交内容格式不正确',
}

function createHandler(options) {
  return async function main(event = {}) {
    if (event.action === 'health') {
      try {
        return success(await options.health())
      }
      catch (error) {
        return failure(error)
      }
    }
    try {
      if (!['publishMessage', 'reconcileDeliveryTask', 'runDeliveryBatch'].includes(event.action)) {
        throw new Error('NOT_FOUND')
      }
      const input = options.verifyInternal(event)
      if (event.action === 'publishMessage') {
        return success(await options.service.publishMessage(input))
      }
      if (event.action === 'reconcileDeliveryTask') {
        return success(await options.service.reconcileDeliveryTask(input))
      }
      return success(await options.service.runDeliveryBatch(input))
    }
    catch (error) {
      return failure(error)
    }
  }
}

function success(data) {
  return { ok: true, data }
}

function failure(error) {
  const raw = error instanceof Error ? error.message : ''
  const code = /^[A-Z][A-Z0-9_]+$/.test(raw) ? raw : 'SERVICE_UNAVAILABLE'
  return {
    ok: false,
    error: {
      code,
      message: messages[code] || '消息服务暂时不可用',
      retryable: ['REQUEST_IN_PROGRESS', 'SERVICE_UNAVAILABLE'].includes(code),
    },
  }
}

module.exports = { createHandler, failure, success }
