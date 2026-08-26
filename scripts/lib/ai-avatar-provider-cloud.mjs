import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

export const AI_AVATAR_PROVIDER_FUNCTION_NAME = 'mip-ai-avatar-provider'
export const AI_AVATAR_PROVIDER_RUNTIME = 'Nodejs20.19'
export const AI_AVATAR_PROVIDER_TIMEOUT_SECONDS = 55
export const AI_AVATAR_PROVIDER_DEPLOYABLE_SOURCE_FILES = Object.freeze([
  'config.json',
  'domain/handler.js',
  'domain/provider.js',
  'index.js',
  'lib/config.js',
  'lib/contract.js',
  'lib/image.js',
  'lib/network.js',
  'lib/operation-cache.js',
  'lib/upstream.js',
  'package.json',
])
export const AI_AVATAR_PROVIDER_ENVIRONMENT_KEYS = Object.freeze([
  'MIP_AI_AVATAR_PROVIDER_CODE_MARKER',
  'MIP_AI_AVATAR_PROVIDER_FUNCTION_NAME',
  'MIP_AI_AVATAR_PROVIDER_HMAC_SECRET',
  'MIP_AI_AVATAR_UPSTREAM_ALLOWED_HOSTS',
  'MIP_AI_AVATAR_UPSTREAM_AUTH_SECRET',
  'MIP_AI_AVATAR_UPSTREAM_ENDPOINT',
  'MIP_AI_AVATAR_UPSTREAM_TIMEOUT_MS',
  'MIP_ALLOWED_APP_IDS',
])

export function providerSourceFingerprint(sourceRoot) {
  const hash = createHash('sha256')
  for (const relative of AI_AVATAR_PROVIDER_DEPLOYABLE_SOURCE_FILES) {
    const file = regularSourceFile(sourceRoot, relative)
    hash.update(relative)
    hash.update('\0')
    hash.update(fs.readFileSync(file))
    hash.update('\0')
  }
  return hash.digest('hex')
}

export function providerBootstrapEnvironment(sourceMarker) {
  if (!/^[a-f0-9]{64}$/.test(sourceMarker)) {
    throw new Error('AI avatar Provider bootstrap source marker is invalid')
  }
  return Object.freeze({
    MIP_AI_AVATAR_PROVIDER_CODE_MARKER: sourceMarker,
    MIP_AI_AVATAR_PROVIDER_FUNCTION_NAME: AI_AVATAR_PROVIDER_FUNCTION_NAME,
  })
}

export function stageProviderSources(sourceRoot, destinationRoot) {
  for (const relative of AI_AVATAR_PROVIDER_DEPLOYABLE_SOURCE_FILES) {
    const source = regularSourceFile(sourceRoot, relative)
    const destination = path.join(destinationRoot, ...relative.split('/'))
    fs.mkdirSync(path.dirname(destination), { recursive: true })
    fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL)
  }
}

export function providerEnvironment({ aiEnvironment, env, sourceMarker }) {
  const allowedAppIds = String(aiEnvironment.MIP_ALLOWED_APP_IDS || '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean)
  const hmacSecret = text(aiEnvironment.MIP_AI_AVATAR_PROVIDER_HMAC_SECRET)
  const endpoint = endpointUrl(env.MIP_AI_AVATAR_UPSTREAM_ENDPOINT)
  const allowedHosts = exactHosts(env.MIP_AI_AVATAR_UPSTREAM_ALLOWED_HOSTS)
  const upstreamAuthSecret = text(env.MIP_AI_AVATAR_UPSTREAM_AUTH_SECRET)
  const timeoutMs = Number(env.MIP_AI_AVATAR_UPSTREAM_TIMEOUT_MS || 30_000)
  if (!allowedAppIds.length
    || allowedAppIds.some(value => !/^wx[0-9a-f]{16}$/i.test(value))
    || hmacSecret.length < 32) {
    throw new Error('Deploy mip-ai-api with a valid AppID allowlist and dedicated avatar Provider HMAC before the Provider')
  }
  assertProviderTrustDomainsIsolated({ aiEnvironment, env, upstreamAuthSecret })
  if (!endpoint
    || !allowedHosts.length
    || !allowedHosts.includes(endpoint.hostname)
    || upstreamAuthSecret.length < 16
    || !Number.isInteger(timeoutMs)
    || timeoutMs < 1000
    || timeoutMs > 45_000
    || !/^[a-f0-9]{64}$/.test(sourceMarker)) {
    throw new Error('AI avatar Provider upstream endpoint, exact host allowlist, auth, timeout, or source marker is invalid')
  }
  return Object.freeze({
    MIP_ALLOWED_APP_IDS: [...new Set(allowedAppIds)].join(','),
    MIP_AI_AVATAR_PROVIDER_HMAC_SECRET: hmacSecret,
    MIP_AI_AVATAR_PROVIDER_FUNCTION_NAME: AI_AVATAR_PROVIDER_FUNCTION_NAME,
    MIP_AI_AVATAR_PROVIDER_CODE_MARKER: sourceMarker,
    MIP_AI_AVATAR_UPSTREAM_ENDPOINT: endpoint.toString(),
    MIP_AI_AVATAR_UPSTREAM_ALLOWED_HOSTS: allowedHosts.join(','),
    MIP_AI_AVATAR_UPSTREAM_AUTH_SECRET: upstreamAuthSecret,
    MIP_AI_AVATAR_UPSTREAM_TIMEOUT_MS: String(timeoutMs),
  })
}

export function assertAiApiProviderLink(aiEnvironment, functionName = AI_AVATAR_PROVIDER_FUNCTION_NAME) {
  if (functionName !== AI_AVATAR_PROVIDER_FUNCTION_NAME
    || text(aiEnvironment?.MIP_AI_AVATAR_PROVIDER_FUNCTION_NAME) !== functionName
    || text(aiEnvironment?.MIP_AI_AVATAR_PROVIDER_HMAC_SECRET).length < 32) {
    throw new Error('mip-ai-api must be linked to mip-ai-avatar-provider with a dedicated HMAC before any Provider write')
  }
  assertProviderTrustDomainsIsolated({ aiEnvironment })
  return true
}

export function assertProviderTrustDomainsIsolated({ aiEnvironment = {}, env = {}, upstreamAuthSecret = '' }) {
  const maintenanceHmac = text(aiEnvironment.MIP_AI_HMAC_SECRET)
  const avatarHmac = text(aiEnvironment.MIP_AI_AVATAR_PROVIDER_HMAC_SECRET)
  const draftHmac = text(aiEnvironment.MIP_AI_DRAFT_PROVIDER_HMAC_SECRET)
    || text(env.MIP_AI_DRAFT_PROVIDER_HMAC_SECRET)
  const upstreamAuth = text(upstreamAuthSecret)
  if (maintenanceHmac.length < 32 || avatarHmac.length < 32) {
    throw new Error('AI maintenance and avatar Provider HMAC trust domains must be configured')
  }
  const activeSecrets = [maintenanceHmac, avatarHmac, ...(draftHmac ? [draftHmac] : [])]
  if (new Set(activeSecrets).size !== activeSecrets.length
    || (upstreamAuth && activeSecrets.includes(upstreamAuth))) {
    throw new Error('AI maintenance, Provider, and upstream authentication must use separate trust domains')
  }
  return true
}

export function assertProviderFunctionReadback(detailValue, expectedEnvironment) {
  const detail = functionDetail(detailValue)
  if (!detail
    || detail.FunctionName !== AI_AVATAR_PROVIDER_FUNCTION_NAME
    || detail.Runtime !== AI_AVATAR_PROVIDER_RUNTIME
    || detail.Handler !== 'index.main'
    || Number(detail.Timeout) !== AI_AVATAR_PROVIDER_TIMEOUT_SECONDS
    || detail.Status !== 'Active'
    || detail.AvailableStatus !== 'Available') {
    throw new Error('AI avatar Provider function runtime readback failed')
  }
  assertNoVpc(detail)
  const actual = environmentVariables(detail)
  const actualKeys = Object.keys(actual).sort()
  const expectedKeys = [...AI_AVATAR_PROVIDER_ENVIRONMENT_KEYS].sort()
  if (JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys)) {
    throw new Error('AI avatar Provider environment contains missing or unexpected keys')
  }
  for (const [key, value] of Object.entries(expectedEnvironment)) {
    if (actual[key] !== value) {
      throw new Error(`AI avatar Provider environment readback failed for ${key}`)
    }
  }
  for (const forbidden of [
    'MIP_AI_HMAC_SECRET',
    'MIP_AI_DRAFT_PROVIDER_HMAC_SECRET',
    'MIP_DB_CONNECTION_URI',
    'MIP_DB_POOL_SIZE',
    'MYSQL_URI',
  ]) {
    if (Object.hasOwn(actual, forbidden)) {
      throw new Error('AI avatar Provider received a forbidden database or cross-domain secret')
    }
  }
  return actual
}

export function assertNoVpc(detailValue) {
  const detail = functionDetail(detailValue)
  const vpc = detail?.VpcConfig || detail?.Vpc || {}
  const vpcId = text(vpc.VpcId || vpc.vpcId)
  const subnetId = text(vpc.SubnetId || vpc.subnetId)
  if (vpcId || subnetId) {
    throw new Error('AI avatar Provider must not join a VPC')
  }
}

export function environmentVariables(detailValue) {
  const entries = functionDetail(detailValue)?.Environment?.Variables
  if (!Array.isArray(entries)) {
    return {}
  }
  return Object.fromEntries(entries
    .filter(item => typeof item?.Key === 'string' && typeof item?.Value === 'string')
    .map(item => [item.Key, item.Value]))
}

export function functionDetail(value) {
  return value?.data?.functionDetail || value?.Response || value?.data || value || null
}

export function endpointUrl(value) {
  try {
    const endpoint = new URL(text(value))
    if (endpoint.protocol !== 'https:'
      || endpoint.username
      || endpoint.password
      || endpoint.hash
      || endpoint.search
      || (endpoint.port && endpoint.port !== '443')
      || /^\d+(?:\.\d+){3}$/.test(endpoint.hostname)
      || endpoint.hostname.includes(':')) {
      return null
    }
    endpoint.hostname = endpoint.hostname.toLowerCase()
    return endpoint
  }
  catch {
    return null
  }
}

export function exactHosts(value) {
  const hosts = text(value).split(',').map(item => item.trim().toLowerCase()).filter(Boolean)
  if (hosts.some(host => host.includes('*')
    || host.includes('/')
    || host.includes(':')
    || /^\d+(?:\.\d+){3}$/.test(host)
    || !validHostname(host))) {
    return []
  }
  return [...new Set(hosts)]
}

function validHostname(host) {
  const labels = host.split('.')
  return host.length <= 253
    && labels.length >= 2
    && labels.every(label => /^[a-z0-9]$|^[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$/.test(label))
}

function regularSourceFile(sourceRoot, relative) {
  const source = path.join(sourceRoot, ...relative.split('/'))
  let stat
  try {
    stat = fs.lstatSync(source)
  }
  catch {
    throw new Error(`AI avatar Provider deployable source is missing: ${relative}`)
  }
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`AI avatar Provider deployable source must be a regular file: ${relative}`)
  }
  return source
}

function text(value) {
  return typeof value === 'string' ? value.trim() : ''
}
