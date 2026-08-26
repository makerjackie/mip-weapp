'use strict'

const {
  createDraftProviderRequest,
  verifyDraftProviderResponse,
} = require('./draft-provider-contract')
const {
  createAvatarProviderRequest,
  verifyAvatarProviderResponse,
} = require('./avatar-provider-contract')

function createCloudAiProvider(cloud, functionName, secret, options = {}) {
  const configured = typeof functionName === 'string'
    && /^mip-[a-z0-9-]{2,58}$/.test(functionName)
    && functionName !== 'mip-ai-api'
    && typeof secret === 'string'
    && secret.length >= 32
  const avatarFunctionName = options.avatarFunctionName
  const avatarSecret = typeof options.avatarSecret === 'string' ? options.avatarSecret : ''
  const avatarConfigured = avatarFunctionName === 'mip-ai-avatar-provider'
    && avatarSecret.length >= 32
  const timeoutMs = normalizeTimeout(options.timeoutMs)
  const avatarTimeoutMs = normalizeAvatarTimeout(options.avatarTimeoutMs)
  let readinessCache
  let avatarReadinessCache

  async function call(action, input, options = {}) {
    const digitalAvatar = options.digitalAvatar === true
    if (digitalAvatar ? !avatarConfigured : !configured) throw new Error('AI_PROVIDER_UNAVAILABLE')
    const request = digitalAvatar
      ? createAvatarProviderRequest(input, avatarSecret)
      : createDraftProviderRequest(action, input, secret)
    const result = await callProviderFunction({
      attempts: digitalAvatar ? 1 : 2,
      cloud,
      functionName: digitalAvatar ? avatarFunctionName : functionName,
      request,
      timeoutMs: digitalAvatar ? avatarTimeoutMs : timeoutMs,
    })
    const envelope = result?.result
    if (!envelope || envelope.ok !== true) {
      throw new Error('AI_PROVIDER_UNAVAILABLE')
    }
    const data = digitalAvatar
      ? verifyAvatarProviderResponse(envelope, request, avatarSecret)
      : verifyDraftProviderResponse(envelope, request, secret)
    return normalizeProviderResult(data, options)
  }

  return {
    async readiness() {
      if (!configured) return false
      const now = Date.now()
      if (readinessCache?.expiresAt > now) return readinessCache.promise
      const promise = Promise.resolve().then(() => withTimeout(cloud.callFunction({
        name: functionName,
        data: { action: 'readiness' },
      }), timeoutMs)).then((result) => (
        result?.result?.ok === true && result?.result?.data?.ready === true
      )).catch(() => false)
      readinessCache = { expiresAt: now + 60_000, promise }
      return promise
    },
    async avatarReadiness() {
      if (!avatarConfigured) return false
      const now = Date.now()
      if (avatarReadinessCache?.expiresAt > now) return avatarReadinessCache.promise
      const promise = Promise.resolve().then(() => withTimeout(cloud.callFunction({
        name: avatarFunctionName,
        data: { action: 'readiness' },
      }), avatarTimeoutMs)).then((result) => (
        result?.result?.ok === true && result?.result?.data?.ready === true
      )).catch(() => false)
      avatarReadinessCache = { expiresAt: now + 60_000, promise }
      return promise
    },
    capability() {
      return {
        voiceDrafts: configured,
        textDrafts: configured,
        refinementDrafts: configured,
        digitalAvatars: avatarConfigured,
        reason: configured ? undefined : 'PROVIDER_NOT_CONFIGURED',
      }
    },
    structureText(input) {
      return call('structureText', input)
    },
    transcribeAndStructure(input) {
      return call('transcribeAndStructure', input)
    },
    refineDraft(input) {
      return call('refineDraft', input, { requireTranscript: false })
    },
    generateDigitalAvatar(input) {
      return call('generateDigitalAvatar', input, { digitalAvatar: true })
    },
  }
}

function createUnavailableAiProvider() {
  const unavailable = async () => { throw new Error('AI_PROVIDER_UNAVAILABLE') }
  return {
    readiness: async () => false,
    avatarReadiness: async () => false,
    capability() {
      return {
        voiceDrafts: false,
        textDrafts: false,
        refinementDrafts: false,
        digitalAvatars: false,
        reason: 'PROVIDER_NOT_CONFIGURED',
      }
    },
    structureText: unavailable,
    transcribeAndStructure: unavailable,
    refineDraft: unavailable,
    generateDigitalAvatar: unavailable,
  }
}

function createAiProviderAdapter(options = {}) {
  const adapter = typeof options.adapter === 'string' ? options.adapter.trim() : 'cloud_function'
  if (adapter !== 'cloud_function') return createUnavailableAiProvider()
  return createCloudAiProvider(options.cloud, options.functionName, options.secret, {
    avatarFunctionName: options.avatarFunctionName,
    avatarSecret: options.avatarSecret,
    avatarTimeoutMs: options.avatarTimeoutMs,
    timeoutMs: options.timeoutMs,
  })
}

function normalizeTimeout(value) {
  const timeout = Number(value ?? 8000)
  return Number.isInteger(timeout) && timeout >= 500 && timeout <= 15_000 ? timeout : 8000
}

function normalizeAvatarTimeout(value) {
  const timeout = Number(value ?? 45_000)
  return Number.isInteger(timeout) && timeout >= 1000 && timeout <= 50_000 ? timeout : 45_000
}

async function withTimeout(promise, timeoutMs) {
  let timer
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('AI_PROVIDER_UNAVAILABLE')), timeoutMs)
      }),
    ])
  }
  finally {
    clearTimeout(timer)
  }
}

async function callProviderFunction(options) {
  let lastError
  for (let attempt = 0; attempt < options.attempts; attempt += 1) {
    try {
      const result = await withTimeout(Promise.resolve().then(() => options.cloud.callFunction({
        name: options.functionName,
        data: options.request,
      })), options.timeoutMs)
      if (result?.result?.ok === false
        && result?.result?.error?.retryable === true
        && attempt + 1 < options.attempts) {
        continue
      }
      return result
    }
    catch (error) {
      lastError = error
      if (attempt + 1 >= options.attempts) throw error
    }
  }
  throw lastError || new Error('AI_PROVIDER_UNAVAILABLE')
}

function normalizeProviderResult(value, options = {}) {
  if (options.digitalAvatar === true) {
    return normalizeDigitalAvatarProviderResult(value)
  }
  const expectedKeys = options.requireTranscript === false
    ? new Set(['structuredDraft', 'providerJobKey'])
    : new Set(['transcriptText', 'structuredDraft', 'providerJobKey'])
  const keys = value && typeof value === 'object' && !Array.isArray(value)
    ? Object.keys(value)
    : []
  const transcriptText = typeof value?.transcriptText === 'string' ? value.transcriptText.trim() : ''
  const structuredDraft = value?.structuredDraft
  const providerJobKey = typeof value?.providerJobKey === 'string' ? value.providerJobKey.trim() : ''
  let serializedDraft = ''
  try {
    serializedDraft = JSON.stringify(structuredDraft)
  }
  catch {}
  if (keys.length !== expectedKeys.size
    || !keys.every(key => expectedKeys.has(key))
    || (options.requireTranscript !== false && !transcriptText)
    || transcriptText.length > 20_000
    || !structuredDraft || typeof structuredDraft !== 'object' || Array.isArray(structuredDraft)
    || !serializedDraft || serializedDraft.length > 30_000
    || !providerJobKey || providerJobKey.length > 256 || !/^[\x21-\x7e]+$/.test(providerJobKey)) {
    throw new Error('AI_PROVIDER_RESPONSE_INVALID')
  }
  return {
    ...(transcriptText ? { transcriptText } : {}),
    structuredDraft,
    providerJobKey,
  }
}

function normalizeDigitalAvatarProviderResult(value) {
  const keys = value && typeof value === 'object' && !Array.isArray(value)
    ? Object.keys(value)
    : []
  if (keys.length !== 3
    || !keys.every(key => ['contentType', 'imageBase64', 'providerJobKey'].includes(key))) {
    throw new Error('DIGITAL_AVATAR_PROVIDER_RESPONSE_INVALID')
  }
  const contentType = value.contentType
  const imageBase64 = value.imageBase64
  const providerJobKey = typeof value.providerJobKey === 'string' ? value.providerJobKey.trim() : ''
  if (!['image/png', 'image/jpeg'].includes(contentType)
    || typeof imageBase64 !== 'string'
    || imageBase64.length < 32
    || imageBase64.length % 4 !== 0
    || imageBase64.length > Math.ceil((2 * 1024 * 1024) / 3) * 4 + 4
    || !/^[A-Za-z0-9+/]+={0,2}$/.test(imageBase64)
    || !canonicalImageBase64(imageBase64, contentType)
    || !providerJobKey
    || providerJobKey.length > 256
    || !/^[\x21-\x7e]+$/.test(providerJobKey)) {
    throw new Error('DIGITAL_AVATAR_PROVIDER_RESPONSE_INVALID')
  }
  return { contentType, imageBase64, providerJobKey }
}

function canonicalImageBase64(value, contentType) {
  try {
    const buffer = Buffer.from(value, 'base64')
    if (!buffer.length || buffer.length > 2 * 1024 * 1024 || buffer.toString('base64') !== value) {
      return false
    }
    return contentType === 'image/png'
      ? buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
      : buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xd8
  }
  catch {
    return false
  }
}

function stableJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`
}

module.exports = {
  createAiProviderAdapter,
  callProviderFunction,
  createCloudAiProvider,
  createUnavailableAiProvider,
  normalizeDigitalAvatarProviderResult,
  normalizeProviderResult,
  normalizeAvatarTimeout,
  normalizeTimeout,
  stableJson,
  withTimeout,
}
