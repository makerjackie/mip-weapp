'use strict'

const { createHash, createHmac, timingSafeEqual } = require('node:crypto')

const CONTRACT_VERSION = 'mip.ai.draft-provider.v1'
const ACTIONS = new Set(['structureText', 'transcribeAndStructure', 'refineDraft'])
const responseKeys = new Set([
  'version',
  'timestamp',
  'requestId',
  'operationKey',
  'ok',
  'data',
  'dataDigest',
  'signature',
])

function createDraftProviderRequest(action, input, secret, now = Date.now()) {
  assertSecret(secret)
  if (!ACTIONS.has(action) || !Number.isSafeInteger(now)) {
    throw new Error('AI_PROVIDER_REQUEST_INVALID')
  }
  const payload = draftPayload(action, input)
  const payloadDigest = digest(payload)
  const operationKey = createHash('sha256').update([
    'MIP_AI_DRAFT_OPERATION_V1',
    payload.appId,
    payload.draftId,
    action,
    String(payload.expectedVersion),
  ].join('\0')).digest('hex')
  const requestId = createHash('sha256').update([
    'MIP_AI_DRAFT_REQUEST_V1',
    operationKey,
    payloadDigest,
  ].join('\0')).digest('hex')
  const unsigned = {
    version: CONTRACT_VERSION,
    action,
    timestamp: now,
    appId: payload.appId,
    requestId,
    operationKey,
    payloadDigest,
    payload,
  }
  return { ...unsigned, signature: sign(unsigned, secret) }
}

function verifyDraftProviderResponse(value, request, secret, now = Date.now()) {
  assertSecret(secret)
  if (!plainObject(value)
    || !exactKeys(value, responseKeys)
    || value.version !== CONTRACT_VERSION
    || value.ok !== true
    || value.requestId !== request.requestId
    || value.operationKey !== request.operationKey
    || !Number.isSafeInteger(value.timestamp)
    || Math.abs(now - value.timestamp) > 5 * 60 * 1000
    || !/^[a-f0-9]{64}$/.test(String(value.dataDigest || ''))
    || digest(value.data) !== value.dataDigest
    || !validSignature(value, secret)) {
    throw new Error('AI_PROVIDER_RESPONSE_INVALID')
  }
  return value.data
}

function draftPayload(action, input = {}) {
  const common = {
    appId: text(input.appId),
    draftId: text(input.draftId),
    purpose: text(input.purpose),
    expectedVersion: Number(input.expectedVersion),
  }
  if (action === 'structureText') {
    return { ...common, transcriptText: text(input.transcriptText) }
  }
  if (action === 'transcribeAndStructure') {
    return {
      ...common,
      audioFileId: text(input.audioFileId),
      audioContentSha256: text(input.audioContentSha256).toLowerCase(),
      audioContentType: text(input.audioContentType || input.contentType),
      audioContentBytes: Number(input.audioContentBytes ?? input.contentBytes),
    }
  }
  if (action === 'refineDraft') {
    return {
      ...common,
      currentTranscript: text(input.currentTranscript),
      currentStructuredDraft: plainObject(input.currentStructuredDraft)
        ? input.currentStructuredDraft
        : {},
      supplementalText: text(input.supplementalText),
    }
  }
  throw new Error('AI_PROVIDER_REQUEST_INVALID')
}

function sign(value, secret) {
  assertSecret(secret)
  return createHmac('sha256', secret).update(stableJson(unsigned(value))).digest('hex')
}

function validSignature(value, secret) {
  const actual = String(value?.signature || '')
  if (!/^[a-f0-9]{64}$/.test(actual)) return false
  const expected = sign(value, secret)
  const actualBuffer = Buffer.from(actual, 'hex')
  const expectedBuffer = Buffer.from(expected, 'hex')
  return actualBuffer.length === expectedBuffer.length
    && timingSafeEqual(actualBuffer, expectedBuffer)
}

function unsigned(value) {
  return Object.fromEntries(Object.entries(value || {}).filter(([key]) => key !== 'signature'))
}

function digest(value) {
  return createHash('sha256').update(stableJson(value)).digest('hex')
}

function stableJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`
}

function exactKeys(value, expected) {
  const keys = Object.keys(value)
  return keys.length === expected.size && keys.every(key => expected.has(key))
}

function plainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function text(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function assertSecret(secret) {
  if (typeof secret !== 'string' || secret.length < 32) {
    throw new Error('AI_PROVIDER_UNAVAILABLE')
  }
}

module.exports = {
  ACTIONS,
  CONTRACT_VERSION,
  createDraftProviderRequest,
  digest,
  draftPayload,
  sign,
  stableJson,
  unsigned,
  verifyDraftProviderResponse,
}
