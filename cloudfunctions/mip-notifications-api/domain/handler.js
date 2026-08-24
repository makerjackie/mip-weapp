'use strict'

const messages = {
  AUTH_REQUIRED: '登录后可查看消息',
  FORBIDDEN: '当前没有权限执行此操作',
  IDENTITY_CONFIG_REQUIRED: '身份服务尚未配置',
  NOT_FOUND: '消息不存在',
  NOTIFICATION_ENCRYPTION_NOT_CONFIGURED: '微信通知加密服务尚未配置',
  TEMPLATE_MISSING: '微信通知模板尚未配置',
  VALIDATION_FAILED: '提交内容格式不正确',
}

const userActions = new Set(['listInbox', 'markRead', 'recordSubscriptionDecision'])

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
      if (!userActions.has(event.action)) throw new Error('NOT_FOUND')
      const caller = await options.resolveCaller()
      if (event.action === 'listInbox') {
        return success(await options.service.listInbox(caller, event))
      }
      if (event.action === 'markRead') {
        return success(await options.service.markRead(caller, event))
      }
      return success(await options.service.recordSubscriptionDecision(caller, event))
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
      retryable: code === 'SERVICE_UNAVAILABLE',
    },
  }
}

module.exports = { createHandler, failure, success }
