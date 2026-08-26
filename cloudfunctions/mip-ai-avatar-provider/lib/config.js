'use strict'

const { isIP } = require('node:net')

const FUNCTION_NAME = 'mip-ai-avatar-provider'

function readConfig(env = process.env) {
  const allowedAppIds = parseAppIds(env.MIP_ALLOWED_APP_IDS)
  const allowedHosts = parseAllowedHosts(env.MIP_AI_AVATAR_UPSTREAM_ALLOWED_HOSTS)
  const endpoint = parseEndpoint(env.MIP_AI_AVATAR_UPSTREAM_ENDPOINT)
  const secret = text(env.MIP_AI_AVATAR_PROVIDER_HMAC_SECRET)
  const upstreamAuthSecret = text(env.MIP_AI_AVATAR_UPSTREAM_AUTH_SECRET)
  const timeoutMs = normalizeTimeout(env.MIP_AI_AVATAR_UPSTREAM_TIMEOUT_MS)
  const errors = []
  if (!allowedAppIds.size) errors.push('APP_ID_ALLOWLIST_MISSING')
  if (secret.length < 32) errors.push('INTERNAL_HMAC_MISSING')
  if (upstreamAuthSecret.length < 16) errors.push('UPSTREAM_AUTH_MISSING')
  if (secret && upstreamAuthSecret && secret === upstreamAuthSecret) {
    errors.push('TRUST_DOMAINS_NOT_ISOLATED')
  }
  if (!endpoint) errors.push('UPSTREAM_ENDPOINT_INVALID')
  if (!allowedHosts.length) errors.push('UPSTREAM_HOST_ALLOWLIST_MISSING')
  if (endpoint && !allowedHosts.includes(endpoint.hostname)) {
    errors.push('UPSTREAM_ENDPOINT_NOT_ALLOWED')
  }
  return Object.freeze({
    functionName: FUNCTION_NAME,
    allowedAppIds,
    allowedHosts,
    endpoint,
    secret,
    upstreamAuthSecret,
    timeoutMs,
    configured: errors.length === 0,
    errors: Object.freeze(errors),
  })
}

function requireReady(config) {
  if (!config?.configured) throw new Error('DIGITAL_AVATAR_PROVIDER_NOT_CONFIGURED')
  return config
}

function parseAppIds(value) {
  const values = split(value)
  if (values.some(item => !/^wx[0-9a-f]{16}$/i.test(item))) return new Set()
  return new Set(values)
}

function parseAllowedHosts(value) {
  const hosts = split(value).map(item => item.toLowerCase())
  if (hosts.some(host => host.includes('*')
    || host.includes('/')
    || host.includes(':')
    || isIP(host)
    || !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])$/.test(host))) {
    return []
  }
  return [...new Set(hosts)]
}

function parseEndpoint(value) {
  try {
    const endpoint = new URL(text(value))
    if (endpoint.protocol !== 'https:'
      || endpoint.username
      || endpoint.password
      || endpoint.hash
      || endpoint.search
      || endpoint.port && endpoint.port !== '443'
      || isIP(endpoint.hostname)) {
      return null
    }
    endpoint.hostname = endpoint.hostname.toLowerCase()
    return endpoint
  }
  catch {
    return null
  }
}

function normalizeTimeout(value) {
  const timeout = Number(value || 30_000)
  return Number.isInteger(timeout) && timeout >= 1000 && timeout <= 45_000 ? timeout : 30_000
}

function split(value) {
  return text(value).split(',').map(item => item.trim()).filter(Boolean)
}

function text(value) {
  return typeof value === 'string' ? value.trim() : ''
}

module.exports = {
  FUNCTION_NAME,
  normalizeTimeout,
  parseAllowedHosts,
  parseAppIds,
  parseEndpoint,
  readConfig,
  requireReady,
}
