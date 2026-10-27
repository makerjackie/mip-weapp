'use strict'

const { createWechatTextChecker } = require('../lib/wechat-content-checker')

function createContentSafety(cloudClient, options = {}) {
  const httpChecker = options.appId && options.appSecret
    ? createWechatTextChecker({ appId: options.appId, appSecret: options.appSecret, ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}) })
    : null
  return {
    async assertSafe(caller, values) {
      const content = values.map(value => String(value || '').trim()).filter(Boolean).join('\n').slice(0, 4000)
      if (!content) return
      if (options.allowInTests && process.env.NODE_ENV === 'test') return
      if (httpChecker && caller.appId !== options.appId) throw unavailable('APP_ID_MISMATCH')
      const checker = httpChecker || cloudClient?.openapi?.security?.msgSecCheck
      if (typeof checker !== 'function') {
        throw unavailable('CHECKER_UNAVAILABLE')
      }
      let response
      try {
        response = await checker({ content, version: 2, scene: 2, openid: caller.openId }, caller)
      }
      catch (error) {
        const providerCode = safeProviderCode(error?.errCode ?? error?.errcode ?? error?.code ?? error?.cause?.code)
        if (providerCode === 87014) throw new Error('CONTENT_REJECTED')
        throw unavailable(providerCode)
      }
      const errCode = Number(response?.errCode ?? response?.errcode)
      if (errCode !== 0 && errCode !== 87014) throw unavailable(errCode)
      if (errCode === 87014 || response?.result?.suggest !== 'pass') {
        throw new Error('CONTENT_REJECTED')
      }
    },
  }
}

const SAFE_PROVIDER_CODES = new Set([
  'CHECKER_UNAVAILABLE', 'APP_ID_MISMATCH', 'UPSTREAM_ERROR', 'ETIMEDOUT', 'ESOCKETTIMEDOUT',
  'ECONNRESET', 'ECONNREFUSED', 'ENETUNREACH', 'EHOSTUNREACH', 'ENOTFOUND', 'EAI_AGAIN',
])

function safeProviderCode(value) {
  if (typeof value === 'string' && SAFE_PROVIDER_CODES.has(value)) return value
  if ((typeof value === 'number' || (typeof value === 'string' && /^-?\d{1,10}$/.test(value)))
    && Number.isSafeInteger(Number(value)) && Math.abs(Number(value)) <= 2147483647) return Number(value)
  return 'UPSTREAM_ERROR'
}

function unavailable(providerCode) {
  const error = new Error('CONTENT_SAFETY_UNAVAILABLE')
  error.providerCode = safeProviderCode(providerCode)
  return error
}

function contentSafetyFailureDetails(error) {
  return error?.message === 'CONTENT_SAFETY_UNAVAILABLE'
    ? { providerCode: safeProviderCode(error.providerCode) }
    : {}
}

module.exports = { createContentSafety, contentSafetyFailureDetails }
