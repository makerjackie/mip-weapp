'use strict'

const { createHash, createHmac } = require('node:crypto')
const {
  createDraftProviderRequest,
  verifyDraftProviderResponse,
} = require('./draft-provider-contract')

function createCloudAiProvider(cloud, functionName, secret, options = {}) {
  const configured = typeof functionName === 'string'
    && /^mip-[a-z0-9-]{2,58}$/.test(functionName)
    && functionName !== 'mip-ai-api'
    && typeof secret === 'string'
    && secret.length >= 32
  const avatarFunctionName = options.avatarFunctionName
  const avatarSecret = typeof options.avatarSecret === 'string' ? options.avatarSecret : secret
  const avatarConfigured = typeof avatarFunctionName === 'string'
    && /^mip-[a-z0-9-]{2,58}$/.test(avatarFunctionName)
    && avatarFunctionName !== 'mip-ai-api'
    && avatarSecret.length >= 32
  const timeoutMs = normalizeTimeout(options.timeoutMs)
  let readinessCache

  async function call(action, input, options = {}) {
    const digitalAvatar = options.digitalAvatar === true
    if (digitalAvatar ? !avatarConfigured : !configured) throw new Error('AI_PROVIDER_UNAVAILABLE')
    const request = digitalAvatar
      ? legacyAvatarRequest(action, input, avatarSecret)
      : createDraftProviderRequest(action, input, secret)
    const result = await callProviderFunction({
      attempts: digitalAvatar ? 1 : 2,
      cloud,
      functionName: digitalAvatar ? avatarFunctionName : functionName,
      request,
      timeoutMs,
    })
    const envelope = result?.result
    if (!envelope || envelope.ok !== true) {
      throw new Error('AI_PROVIDER_UNAVAILABLE')
    }
    const data = digitalAvatar
      ? envelope.data
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
    timeoutMs: options.timeoutMs,
  })
}

function legacyAvatarRequest(action, input, secret) {
  const request = { action, timestamp: Date.now(), ...input }
  return {
    ...request,
    signature: createHmac('sha256', secret).update(providerPayload(request)).digest('hex'),
  }
}

function normalizeTimeout(value) {
  const timeout = Number(value ?? 8000)
  return Number.isInteger(timeout) && timeout >= 500 && timeout <= 15_000 ? timeout : 8000
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

function providerPayload(value) {
  const content = {
    audioFileId: String(value.audioFileId || ''),
    currentStructuredDraft: value.currentStructuredDraft || {},
    currentTranscript: String(value.currentTranscript || ''),
    supplementalText: String(value.supplementalText || ''),
    transcriptText: String(value.transcriptText || ''),
  }
  if (value.action === 'generateDigitalAvatar') {
    Object.assign(content, {
      sourceContentBytes: Number(value.sourceContentBytes || 0),
      sourceContentSha256: String(value.sourceContentSha256 || ''),
      sourceContentType: String(value.sourceContentType || ''),
      sourceHeight: Number(value.sourceHeight || 0),
      sourceImageFileId: String(value.sourceImageFileId || ''),
      sourceWidth: Number(value.sourceWidth || 0),
      styleKey: String(value.styleKey || ''),
    })
  }
  const contentDigest = createHash('sha256').update(stableJson(content)).digest('hex')
  return [
    Number(value.timestamp),
    String(value.action || ''),
    String(value.appId || ''),
    String(value.draftId || value.generationId || ''),
    String(value.purpose || ''),
    Number(value.expectedVersion || 0),
    contentDigest,
  ].join('\n')
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
    || !providerJobKey
    || providerJobKey.length > 256
    || !/^[\x21-\x7e]+$/.test(providerJobKey)) {
    throw new Error('DIGITAL_AVATAR_PROVIDER_RESPONSE_INVALID')
  }
  return { contentType, imageBase64, providerJobKey }
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
  normalizeTimeout,
  providerPayload,
  stableJson,
  withTimeout,
}
