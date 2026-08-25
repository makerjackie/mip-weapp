'use strict'

const messages = {
  AUTH_REQUIRED: '登录后可查看消息',
  CHANNEL_UNAVAILABLE: '当前通知渠道尚未配置',
  FORBIDDEN: '当前没有权限执行此操作',
  IDENTITY_CONFIG_REQUIRED: '身份服务尚未配置',
  NOT_FOUND: '消息不存在',
  NOTIFICATION_ENCRYPTION_NOT_CONFIGURED: '微信通知加密服务尚未配置',
  TEMPLATE_MISSING: '微信通知模板尚未配置',
  VALIDATION_FAILED: '提交内容格式不正确',
}

const CONTRACT_VERSION = 1

const actions = Object.freeze({
  listInbox: (service, caller, input) => service.listInbox(caller, input),
  markRead: (service, caller, input) => service.markRead(caller, input),
  recordCustomerServiceInteraction: (service, caller) => service.recordCustomerServiceInteraction(caller),
  recordSubscriptionDecision: (service, caller, input) => service.recordSubscriptionDecision(caller, input),
})

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function businessInput(value) {
  const {
    action: _action,
    contractVersion: _contractVersion,
    input: _input,
    ...input
  } = value
  return input
}

function normalizeRequest(event) {
  if (!isRecord(event)) throw new Error('VALIDATION_FAILED')
  const action = typeof event.action === 'string' ? event.action : ''
  if (event.contractVersion === undefined) {
    return { action, input: businessInput(event), legacy: true }
  }
  if (event.contractVersion !== CONTRACT_VERSION
    || !isRecord(event.input)
    || Object.keys(event).some(key => !['contractVersion', 'action', 'input'].includes(key))) {
    throw new Error('VALIDATION_FAILED')
  }
  return { action, input: businessInput(event.input), legacy: false }
}

function createHandler(options) {
  return async function main(event = {}) {
    try {
      const request = normalizeRequest(event)
      if (request.action === 'health') {
        return success(await options.health())
      }
      if (!Object.hasOwn(actions, request.action)) throw new Error('NOT_FOUND')
      const dispatch = actions[request.action]
      const caller = await options.resolveCaller()
      return success(await dispatch(options.service, caller, request.input))
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

module.exports = {
  CONTRACT_VERSION,
  actions,
  createHandler,
  failure,
  normalizeRequest,
  success,
}
