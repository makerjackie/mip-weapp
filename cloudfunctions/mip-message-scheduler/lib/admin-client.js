'use strict'

const { createHmac } = require('node:crypto')
const { stableJson } = require('./auth')

function createAdminClient(options) {
  const { config, scf } = options
  const now = options.now || Date.now
  if (!scf || typeof scf.InvokeFunction !== 'function') throw new TypeError('SCF_INVOKE_CLIENT_INVALID')

  async function invoke(action, appId, body = {}) {
    const request = { action, appId, ...body, timestamp: Number(now()) }
    request.signature = signAdminRequest(request, config.secret)
    const response = await scf.InvokeFunction({
      FunctionName: config.adminFunctionName,
      Namespace: config.namespace,
      Qualifier: '$DEFAULT',
      LogType: 'None',
      Event: JSON.stringify(request),
    })
    const result = parseInvocationResult(response)
    if (result?.ok !== true) {
      const error = new Error(publicErrorCode(result?.error?.code))
      error.retryable = result?.error?.retryable === true
      throw error
    }
    return result.data || {}
  }

  return {
    getWakePlan(appId) {
      return invoke('getMessageCampaignWakePlan', appId)
    },
    runDue(appId) {
      return invoke('runDueMessageCampaigns', appId, {
        limit: 10,
        drain: false,
        maxBatches: 1,
      })
    },
  }
}

function signAdminRequest(event, secret) {
  if (typeof secret !== 'string' || secret.length < 32) throw new Error('INTERNAL_AUTH_NOT_CONFIGURED')
  const unsigned = Object.fromEntries(Object.entries(event).filter(([key]) => key !== 'signature'))
  return createHmac('sha256', secret).update(stableJson(unsigned)).digest('hex')
}

function parseInvocationResult(response) {
  const result = response?.Result || response?.Response?.Result || response?.data?.Result
  const invokeCode = result?.InvokeResult ?? result?.RetCode
  if (!result
    || (invokeCode !== undefined && Number(invokeCode) !== 0)
    || result.FunctionError
    || result.ErrMsg) {
    throw new Error('ADMIN_FUNCTION_INVOCATION_FAILED')
  }
  const value = result.RetMsg
  if (value && typeof value === 'object') return value
  if (typeof value !== 'string' || !value.trim()) throw new Error('ADMIN_FUNCTION_RESPONSE_INVALID')
  try { return JSON.parse(value) }
  catch { throw new Error('ADMIN_FUNCTION_RESPONSE_INVALID') }
}

function publicErrorCode(value) {
  const code = typeof value === 'string' ? value.trim() : ''
  return /^[A-Z][A-Z0-9_]{2,63}$/.test(code) ? code : 'ADMIN_FUNCTION_FAILED'
}

module.exports = { createAdminClient, parseInvocationResult, signAdminRequest }
