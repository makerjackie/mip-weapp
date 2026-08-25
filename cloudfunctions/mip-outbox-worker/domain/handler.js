'use strict'

const messages = {
  FORBIDDEN: '当前没有权限执行此操作',
  INTERNAL_AUTH_NOT_CONFIGURED: 'Outbox 内部调用尚未配置',
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
      if (event.action === 'probeDependencies') {
        return success(await options.probeDependencies(options.verifyInternal(event)))
      }
      if (event.action === 'runBatch') {
        return success(await options.service.runBatch(options.verifyInternal(event)))
      }
      throw new Error('FORBIDDEN')
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
      message: messages[code] || 'Outbox 服务暂时不可用',
      retryable: code === 'SERVICE_UNAVAILABLE',
    },
  }
}

module.exports = { createHandler, failure, success }
