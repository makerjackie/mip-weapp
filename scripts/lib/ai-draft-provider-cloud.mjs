import { createHash } from 'node:crypto'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

// Flash ASR 凭据格式校验与函数内同一份实现（lib 只依赖 node 内置模块，可安全跨引）。
const require = createRequire(import.meta.url)
const { isValidAsrAppId, isValidAsrSecretId, isValidAsrSecretKey } = require('../../cloudfunctions/mip-ai-draft-provider/lib/flash-asr')

export const AI_DRAFT_PROVIDER_FUNCTION_NAME = 'mip-ai-draft-provider'
export const AI_DRAFT_PROVIDER_RUNTIME = 'Nodejs20.19'
export const AI_DRAFT_PROVIDER_TIMEOUT_SECONDS = 15
export const AI_DRAFT_PROVIDER_DEPLOYABLE_SOURCE_FILES = Object.freeze([
  'config.json',
  'domain/handler.js',
  'domain/provider.js',
  'index.js',
  'lib/audio.js',
  'lib/config.js',
  'lib/contract.js',
  'lib/network.js',
  'lib/openai-compatible.js',
  'lib/operation-cache.js',
  'lib/upstream.js',
  'package.json',
])
export const AI_DRAFT_PROVIDER_ENVIRONMENT_KEYS = Object.freeze([
  'MIP_AI_DRAFT_PROVIDER_CODE_MARKER',
  'MIP_AI_DRAFT_PROVIDER_FUNCTION_NAME',
  'MIP_AI_DRAFT_UPSTREAM_ALLOWED_HOSTS',
  'MIP_AI_DRAFT_UPSTREAM_ENDPOINT',
  'MIP_AI_DRAFT_UPSTREAM_SECRET',
  'MIP_AI_DRAFT_UPSTREAM_TIMEOUT_MS',
  'OPENAI_API_KEY',
  'OPENAI_BASE_URL',
  'OPENAI_MODEL',
  'MIP_AI_DRAFT_PROVIDER_HMAC_SECRET',
  'MIP_ALLOWED_APP_IDS',
  'TENCENT_ASR_APPID',
  'TENCENT_ASR_SECRET_ID',
  'TENCENT_ASR_SECRET_KEY',
  'TENCENT_ASR_TIMEOUT_MS',
])

export function providerSourceFingerprint(sourceRoot) {
  const hash = createHash('sha256')
  for (const relative of AI_DRAFT_PROVIDER_DEPLOYABLE_SOURCE_FILES) {
    const file = regularSourceFile(sourceRoot, relative)
    hash.update(relative)
    hash.update('\0')
    hash.update(fs.readFileSync(file))
    hash.update('\0')
  }
  return hash.digest('hex')
}

export function stageProviderSources(sourceRoot, destinationRoot) {
  for (const relative of AI_DRAFT_PROVIDER_DEPLOYABLE_SOURCE_FILES) {
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
  const hmacSecret = text(aiEnvironment.MIP_AI_DRAFT_PROVIDER_HMAC_SECRET)
  const openAiBaseUrl = endpointUrl(env.OPENAI_BASE_URL)
  const openAiModel = text(env.OPENAI_MODEL)
  const openAiApiKey = text(env.OPENAI_API_KEY)
  const openAiSupplied = [env.OPENAI_BASE_URL, env.OPENAI_MODEL, env.OPENAI_API_KEY].some(value => text(value))
  const endpoint = endpointUrl(env.MIP_AI_DRAFT_UPSTREAM_ENDPOINT)
  const allowedHosts = exactHosts(env.MIP_AI_DRAFT_UPSTREAM_ALLOWED_HOSTS)
  const upstreamSecret = text(env.MIP_AI_DRAFT_UPSTREAM_SECRET)
  const timeoutMs = Number(env.MIP_AI_DRAFT_UPSTREAM_TIMEOUT_MS || 8000)
  // MIW-56:语音转写凭据随部署注入,不配置时语音能力保持关闭;配置则三者缺一或格式不符直接拒绝部署。
  const asrEnvironment = asrEnvironmentFrom(env)
  if (!allowedAppIds.length
    || allowedAppIds.some(value => !/^wx[0-9a-f]{16}$/i.test(value))
    || hmacSecret.length < 32) {
    throw new Error('Deploy mip-ai-api with a valid AppID allowlist and dedicated draft Provider HMAC before the Provider')
  }
  const baseEnvironment = {
    MIP_ALLOWED_APP_IDS: [...new Set(allowedAppIds)].join(','),
    MIP_AI_DRAFT_PROVIDER_HMAC_SECRET: hmacSecret,
    MIP_AI_DRAFT_PROVIDER_FUNCTION_NAME: AI_DRAFT_PROVIDER_FUNCTION_NAME,
    MIP_AI_DRAFT_PROVIDER_CODE_MARKER: sourceMarker,
  }
  if (!/^[a-f0-9]{64}$/.test(sourceMarker)) {
    throw new Error('AI draft Provider source marker is invalid')
  }
  if (openAiSupplied) {
    if (!openAiBaseUrl
      || !validHostname(openAiBaseUrl.hostname)
      || !/^\w[\w.:-]{1,127}$/.test(openAiModel)
      || openAiApiKey.length < 16
      || openAiApiKey.length > 512
      || !/^[\x21-\x7E]+$/.test(openAiApiKey)
      || !Number.isInteger(timeoutMs)
      || timeoutMs < 500
      || timeoutMs > 10_000) {
      throw new Error('AI draft Provider OpenAI-compatible base URL, model, API key, or timeout is invalid')
    }
    return Object.freeze({
      ...baseEnvironment,
      ...asrEnvironment,
      OPENAI_BASE_URL: openAiBaseUrl.toString(),
      OPENAI_MODEL: openAiModel,
      OPENAI_API_KEY: openAiApiKey,
      MIP_AI_DRAFT_UPSTREAM_TIMEOUT_MS: String(timeoutMs),
    })
  }
  if (!endpoint
    || !allowedHosts.length
    || !allowedHosts.includes(endpoint.hostname)
    || upstreamSecret.length < 16
    || !Number.isInteger(timeoutMs)
    || timeoutMs < 500
    || timeoutMs > 10_000) {
    throw new Error('AI draft Provider upstream endpoint, exact host allowlist, secret, timeout, or source marker is invalid')
  }
  return Object.freeze({
    ...baseEnvironment,
    ...asrEnvironment,
    MIP_AI_DRAFT_UPSTREAM_ENDPOINT: endpoint.toString(),
    MIP_AI_DRAFT_UPSTREAM_ALLOWED_HOSTS: allowedHosts.join(','),
    MIP_AI_DRAFT_UPSTREAM_SECRET: upstreamSecret,
    MIP_AI_DRAFT_UPSTREAM_TIMEOUT_MS: String(timeoutMs),
  })
}

// 腾讯云 Flash ASR 凭据:三件套要么全空(能力关闭),要么齐全且通过函数内同一格式校验。
function asrEnvironmentFrom(env) {
  const secretId = text(env.TENCENT_ASR_SECRET_ID)
  const secretKey = text(env.TENCENT_ASR_SECRET_KEY)
  const appId = text(env.TENCENT_ASR_APPID)
  const timeoutValue = text(env.TENCENT_ASR_TIMEOUT_MS)
  if (!secretId && !secretKey && !appId && !timeoutValue) {
    return {}
  }
  if (!secretId || !secretKey || !appId) {
    throw new Error('TENCENT_ASR_SECRET_ID, TENCENT_ASR_SECRET_KEY, and TENCENT_ASR_APPID must be configured together')
  }
  if (!isValidAsrSecretId(secretId) || !isValidAsrSecretKey(secretKey) || !isValidAsrAppId(appId)) {
    throw new Error('TENCENT_ASR_SECRET_ID (AKID…), TENCENT_ASR_SECRET_KEY (16-64 chars), or TENCENT_ASR_APPID (4-12 digits) format is invalid')
  }
  const environment = {
    TENCENT_ASR_SECRET_ID: secretId,
    TENCENT_ASR_SECRET_KEY: secretKey,
    TENCENT_ASR_APPID: appId,
  }
  if (timeoutValue) {
    const timeout = Number(timeoutValue)
    if (!Number.isInteger(timeout) || timeout < 1000 || timeout > 45_000) {
      throw new Error('TENCENT_ASR_TIMEOUT_MS must be an integer between 1000 and 45000')
    }
    environment.TENCENT_ASR_TIMEOUT_MS = String(timeout)
  }
  return environment
}

export function assertAiApiProviderLink(aiEnvironment, functionName = AI_DRAFT_PROVIDER_FUNCTION_NAME) {
  if (functionName !== AI_DRAFT_PROVIDER_FUNCTION_NAME
    || text(aiEnvironment?.MIP_AI_PROVIDER_FUNCTION_NAME) !== functionName) {
    throw new Error('mip-ai-api must be linked to mip-ai-draft-provider before any Provider write')
  }
  return true
}

export function assertProviderFunctionReadback(detailValue, expectedEnvironment) {
  const detail = functionDetail(detailValue)
  if (!detail
    || detail.FunctionName !== AI_DRAFT_PROVIDER_FUNCTION_NAME
    || detail.Runtime !== AI_DRAFT_PROVIDER_RUNTIME
    || detail.Handler !== 'index.main'
    || Number(detail.Timeout) !== AI_DRAFT_PROVIDER_TIMEOUT_SECONDS
    || detail.Status !== 'Active'
    || detail.AvailableStatus !== 'Available') {
    throw new Error('AI draft Provider function runtime readback failed')
  }
  assertNoVpc(detail)
  const actual = environmentVariables(detail)
  const actualKeys = Object.keys(actual).sort()
  const expectedKeys = Object.keys(expectedEnvironment).sort()
  if (JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys)
    || actualKeys.some(key => !AI_DRAFT_PROVIDER_ENVIRONMENT_KEYS.includes(key))) {
    throw new Error('AI draft Provider environment contains missing or unexpected keys')
  }
  for (const [key, value] of Object.entries(expectedEnvironment)) {
    if (actual[key] !== value) {
      throw new Error(`AI draft Provider environment readback failed for ${key}`)
    }
  }
  for (const forbidden of ['MIP_DB_CONNECTION_URI', 'MIP_DB_POOL_SIZE', 'MYSQL_URI']) {
    if (Object.hasOwn(actual, forbidden)) {
      throw new Error('AI draft Provider must not receive MySQL configuration')
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
    throw new Error('AI draft Provider must not join a VPC')
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
    throw new Error(`AI draft Provider deployable source is missing: ${relative}`)
  }
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`AI draft Provider deployable source must be a regular file: ${relative}`)
  }
  return source
}

function text(value) {
  return typeof value === 'string' ? value.trim() : ''
}
