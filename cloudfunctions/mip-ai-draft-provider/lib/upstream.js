'use strict'

const { createHash } = require('node:crypto')

const UPSTREAM_VERSION = 'mip.ai.draft-upstream.v1'
const responseKeys = new Set(['version', 'requestId', 'operationKey', 'data'])

function createUpstreamAdapter(options) {
  const config = options.config
  const http = options.http
  const audioLoader = options.audioLoader

  return {
    async readiness() {
      const operationKey = createHash('sha256').update('MIP_AI_DRAFT_READINESS_V1').digest('hex')
      const requestId = createHash('sha256').update([
        'MIP_AI_DRAFT_READINESS_REQUEST_V1',
        config.endpoint.toString(),
      ].join('\0')).digest('hex')
      const body = { version: UPSTREAM_VERSION, action: 'readiness', requestId }
      const payloadDigest = createHash('sha256').update(JSON.stringify(body)).digest('hex')
      const response = await http.postJson(config.endpoint, body, {
        maximumRequestBytes: 1024,
        maximumResponseBytes: 1024,
        operationKey,
        payloadDigest,
        requestId,
        secret: config.upstreamSecret,
        timeoutMs: config.timeoutMs,
      })
      if (!exactKeys(response, new Set(['version', 'requestId', 'ready']))
        || response.version !== UPSTREAM_VERSION
        || response.requestId !== requestId
        || response.ready !== true) {
        throw new Error('AI_DRAFT_PROVIDER_UPSTREAM_UNAVAILABLE')
      }
      return true
    },

    async invoke(request) {
      let payload = request.payload
      if (request.action === 'transcribeAndStructure') {
        const audio = await audioLoader.load(request.payload)
        payload = {
          appId: request.payload.appId,
          draftId: request.payload.draftId,
          purpose: request.payload.purpose,
          expectedVersion: request.payload.expectedVersion,
          audio,
        }
      }
      const body = {
        version: UPSTREAM_VERSION,
        requestId: request.requestId,
        operationKey: request.operationKey,
        action: request.action,
        appId: request.appId,
        payloadDigest: request.payloadDigest,
        payload,
      }
      const response = await http.postJson(config.endpoint, body, {
        maximumRequestBytes: 3 * 1024 * 1024,
        maximumResponseBytes: 64 * 1024,
        operationKey: request.operationKey,
        payloadDigest: request.payloadDigest,
        requestId: request.requestId,
        secret: config.upstreamSecret,
        timeoutMs: config.timeoutMs,
      })
      if (!exactKeys(response, responseKeys)
        || response.version !== UPSTREAM_VERSION
        || response.requestId !== request.requestId
        || response.operationKey !== request.operationKey) {
        throw new Error('AI_DRAFT_PROVIDER_RESPONSE_INVALID')
      }
      return normalizeProviderData(request.action, response.data)
    },
  }
}

function normalizeProviderData(action, value) {
  if (!plainObject(value)) throw new Error('AI_DRAFT_PROVIDER_RESPONSE_INVALID')
  const allowedKeys = action === 'refineDraft'
    ? new Set(['structuredDraft', 'providerJobKey'])
    : new Set(['transcriptText', 'structuredDraft', 'providerJobKey'])
  if (!exactKeys(value, allowedKeys)) throw new Error('AI_DRAFT_PROVIDER_RESPONSE_INVALID')
  const providerJobKey = text(value.providerJobKey)
  const structuredDraft = value.structuredDraft
  const serializedDraft = safeJson(structuredDraft)
  if (!providerJobKey
    || providerJobKey.length > 256
    || !/^[\x21-\x7e]+$/.test(providerJobKey)
    || !plainObject(structuredDraft)
    || !Object.keys(structuredDraft).length
    || Buffer.byteLength(serializedDraft) > 30_000) {
    throw new Error('AI_DRAFT_PROVIDER_RESPONSE_INVALID')
  }
  if (action === 'refineDraft') return { structuredDraft, providerJobKey }
  const transcriptText = text(value.transcriptText)
  if (!transcriptText || transcriptText.length > 20_000) {
    throw new Error('AI_DRAFT_PROVIDER_RESPONSE_INVALID')
  }
  return { transcriptText, structuredDraft, providerJobKey }
}

function exactKeys(value, expected) {
  const keys = Object.keys(value)
  return keys.length === expected.size && keys.every(key => expected.has(key))
}

function plainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function safeJson(value) {
  try {
    return JSON.stringify(value)
  }
  catch {
    return ''
  }
}

function text(value) {
  return typeof value === 'string' ? value.trim() : ''
}

module.exports = {
  UPSTREAM_VERSION,
  createUpstreamAdapter,
  normalizeProviderData,
}
