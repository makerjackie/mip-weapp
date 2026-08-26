'use strict'

function schedulerConfig(env = process.env) {
  const functionName = functionValue(env.MIP_KNOWLEDGE_SCHEDULER_FUNCTION_NAME, 'mip-knowledge-scheduler')
  const adminFunctionName = functionValue(env.MIP_ADMIN_FUNCTION_NAME, 'mip-admin-api')
  const triggerName = triggerValue(env.MIP_KNOWLEDGE_SCHEDULER_TRIGGER_NAME, 'mip-knowledge-ingestion-next')
  const namespace = identifier(env.MIP_SCF_NAMESPACE, 'MIP_SCF_NAMESPACE')
  const region = regionValue(env.MIP_SCF_REGION)
  const cronUtcOffsetMinutes = integer(env.MIP_SCF_TIMER_UTC_OFFSET_MINUTES, -840, 840)
  const secret = String(env.MIP_KNOWLEDGE_SCHEDULER_HMAC_SECRET || '')
  const allowedAppIds = new Set(
    String(env.MIP_ALLOWED_APP_IDS || '').split(',').map(value => value.trim()).filter(Boolean),
  )
  if (secret.length < 32) throw new Error('INTERNAL_AUTH_NOT_CONFIGURED')
  if (!allowedAppIds.size || [...allowedAppIds].some(value => !/^wx[0-9a-f]{16}$/i.test(value))) {
    throw new Error('MIP_ALLOWED_APP_IDS_INVALID')
  }
  if (functionName === adminFunctionName) throw new Error('SCHEDULER_FUNCTION_BOUNDARY_INVALID')
  return Object.freeze({
    adminFunctionName,
    allowedAppIds,
    cronUtcOffsetMinutes,
    functionName,
    namespace,
    region,
    secret,
    sourceFunction: 'mip-admin-api',
    triggerName,
  })
}

function runtimeCredentials(context = {}, env = process.env) {
  const candidates = [
    {
      secretId: context.TENCENTCLOUD_SECRETID,
      secretKey: context.TENCENTCLOUD_SECRETKEY,
      token: context.TENCENTCLOUD_SESSIONTOKEN,
    },
    context.credentials,
    context.Credentials,
    context.credential,
    {
      secretId: env.TENCENTCLOUD_SECRETID,
      secretKey: env.TENCENTCLOUD_SECRETKEY,
      token: env.TENCENTCLOUD_SESSIONTOKEN || env.TENCENTCLOUD_TOKEN,
    },
    {
      secretId: env.SCF_SECRETID,
      secretKey: env.SCF_SECRETKEY,
      token: env.SCF_TOKEN,
    },
  ]
  for (const candidate of candidates) {
    const secretId = text(candidate?.secretId || candidate?.SecretId)
    const secretKey = text(candidate?.secretKey || candidate?.SecretKey)
    const token = text(candidate?.token || candidate?.Token)
    if (secretId && secretKey && token) return { secretId, secretKey, token }
  }
  throw new Error('SCF_TEMPORARY_CREDENTIALS_UNAVAILABLE')
}

function functionValue(value, fallback) {
  const name = text(value) || fallback
  if (!/^mip-[a-z0-9][a-z0-9-]{0,55}$/.test(name)) throw new Error('FUNCTION_NAME_INVALID')
  return name
}

function triggerValue(value, fallback) {
  const name = text(value) || fallback
  if (!/^mip-[a-z0-9][a-z0-9-]{0,95}$/.test(name)) throw new Error('TRIGGER_NAME_INVALID')
  return name
}

function identifier(value, key) {
  const result = text(value)
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(result)) throw new Error(`${key}_INVALID`)
  return result
}

function regionValue(value) {
  const result = text(value)
  if (!/^[a-z]{2,12}-[a-z0-9]{2,20}(?:-[a-z0-9]{1,20}){0,2}$/.test(result)) throw new Error('MIP_SCF_REGION_INVALID')
  return result
}

function integer(value, minimum, maximum) {
  const source = text(value)
  const result = Number(source)
  if (!/^-?\d{1,4}$/.test(source)
    || !Number.isInteger(result)
    || result < minimum
    || result > maximum) {
    throw new Error('MIP_SCF_TIMER_UTC_OFFSET_MINUTES_INVALID')
  }
  return result
}

function text(value) {
  return typeof value === 'string' ? value.trim() : ''
}

module.exports = { runtimeCredentials, schedulerConfig }
