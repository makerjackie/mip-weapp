'use strict'

const { createHash, createHmac, timingSafeEqual } = require('node:crypto')

const CONTRACT_VERSION = 'mip.ai.draft-provider.v1'
const ACTIONS = new Set(['structureText', 'transcribeAndStructure', 'refineDraft'])
const maximumRequestBytes = 64 * 1024
const transportMetadataKeys = new Set(['frameworkContext', 'tcbContext', 'userInfo'])
const requestKeys = new Set([
  'version',
  'action',
  'timestamp',
  'appId',
  'requestId',
  'operationKey',
  'payloadDigest',
  'payload',
  'signature',
])
const commonPayloadKeys = ['appId', 'draftId', 'purpose', 'expectedVersion']
const payloadKeys = Object.freeze({
  structureText: new Set([...commonPayloadKeys, 'transcriptText']),
  transcribeAndStructure: new Set([
    ...commonPayloadKeys,
    'audioFileId',
    'audioContentSha256',
    'audioContentType',
    'audioContentBytes',
  ]),
  refineDraft: new Set([
    ...commonPayloadKeys,
    'currentTranscript',
    'currentStructuredDraft',
    'supplementalText',
  ]),
})

function verifyProviderRequest(event, options = {}) {
  const now = typeof options.now === 'function' ? options.now() : Date.now()
  if (!plainObject(event)) throw new Error('FORBIDDEN')
  const serialized = safeStableJson(event)
  const request = withoutTransportMetadata(event)
  if (Buffer.byteLength(serialized) > maximumRequestBytes
    || !exactKeys(request, requestKeys)
    || request.version !== CONTRACT_VERSION
    || !ACTIONS.has(request.action)
    || !Number.isSafeInteger(request.timestamp)
    || Math.abs(now - request.timestamp) > 5 * 60 * 1000
    || !(options.allowedAppIds instanceof Set)
    || !options.allowedAppIds.has(request.appId)
    || !/^[a-f0-9]{64}$/.test(String(request.requestId || ''))
    || !/^[a-f0-9]{64}$/.test(String(request.operationKey || ''))
    || !/^[a-f0-9]{64}$/.test(String(request.payloadDigest || ''))
    || digest(request.payload) !== request.payloadDigest
    || !validSignature(request, options.secret)) {
    throw new Error('FORBIDDEN')
  }
  validatePayload(request.action, request.payload, request.appId)
  return request
}

function withoutTransportMetadata(event) {
  const request = { ...event }
  for (const key of transportMetadataKeys) {
    if (!Object.hasOwn(request, key)) continue
    if (!plainTransportObject(request[key])) throw new Error('FORBIDDEN')
    delete request[key]
  }
  return request
}

function validatePayload(action, value, appId) {
  if (!plainObject(value)
    || !exactKeys(value, payloadKeys[action])
    || value.appId !== appId
    || !/^wx[0-9a-f]{16}$/i.test(value.appId)
    || !uuid(value.draftId)
    || !['PROFILE', 'COOPERATION_CARD', 'SUPER_CASE', 'OPPORTUNITY'].includes(value.purpose)
    || !Number.isInteger(value.expectedVersion)
    || value.expectedVersion < 1
    || value.expectedVersion > 1_000_000) {
    throw new Error('AI_DRAFT_PROVIDER_REQUEST_INVALID')
  }
  if (action === 'structureText') {
    if (!exactText(value.transcriptText, 8000)) {
      throw new Error('AI_DRAFT_PROVIDER_REQUEST_INVALID')
    }
    return value
  }
  if (action === 'transcribeAndStructure') {
    if (value.audioContentType !== 'audio/mpeg'
      || !Number.isInteger(value.audioContentBytes)
      || value.audioContentBytes < 1
      || value.audioContentBytes > 2 * 1024 * 1024
      || !/^[a-f0-9]{64}$/.test(value.audioContentSha256)
      || !validAudioFileId(value.audioFileId)) {
      throw new Error('AI_DRAFT_PROVIDER_REQUEST_INVALID')
    }
    return value
  }
  if (!exactText(value.supplementalText, 4000)
    || !optionalExactText(value.currentTranscript, 20_000)
    || !plainObject(value.currentStructuredDraft)
    || Buffer.byteLength(safeStableJson(value.currentStructuredDraft)) > 30_000) {
    throw new Error('AI_DRAFT_PROVIDER_REQUEST_INVALID')
  }
  return value
}

function createProviderResponse(request, data, secret, now = Date.now()) {
  if (!Number.isSafeInteger(now)) throw new Error('AI_DRAFT_PROVIDER_RESPONSE_INVALID')
  const unsignedResponse = {
    version: CONTRACT_VERSION,
    timestamp: now,
    requestId: request.requestId,
    operationKey: request.operationKey,
    ok: true,
    data,
    dataDigest: digest(data),
  }
  return { ...unsignedResponse, signature: sign(unsignedResponse, secret) }
}

function sign(value, secret) {
  if (typeof secret !== 'string' || secret.length < 32) {
    throw new Error('AI_DRAFT_PROVIDER_NOT_CONFIGURED')
  }
  return createHmac('sha256', secret).update(stableJson(unsigned(value))).digest('hex')
}

function validSignature(value, secret) {
  const actual = String(value?.signature || '')
  if (typeof secret !== 'string' || secret.length < 32 || !/^[a-f0-9]{64}$/.test(actual)) {
    return false
  }
  const expected = sign(value, secret)
  const actualBuffer = Buffer.from(actual, 'hex')
  const expectedBuffer = Buffer.from(expected, 'hex')
  return actualBuffer.length === expectedBuffer.length
    && timingSafeEqual(actualBuffer, expectedBuffer)
}

function validAudioFileId(value) {
  return typeof value === 'string'
    && value.length <= 1024
    && /^cloud:\/\/[^/\s]{1,128}\/mip\/(?:development|test|staging|production)\/[0-9a-f]{24}\/ai\/[0-9a-f]{24}\/[0-9a-f-]{36}\.mp3$/i.test(value)
    && !value.includes('..')
    && !value.includes('\\')
}

function digest(value) {
  return createHash('sha256').update(stableJson(value)).digest('hex')
}

function unsigned(value) {
  return Object.fromEntries(Object.entries(value || {}).filter(([key]) => key !== 'signature'))
}

function stableJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`
}

function safeStableJson(value) {
  try {
    const result = stableJson(value)
    return typeof result === 'string' ? result : ''
  }
  catch {
    return ''
  }
}

function exactKeys(value, expected) {
  const keys = Object.keys(value)
  return keys.length === expected.size && keys.every(key => expected.has(key))
}

function exactText(value, maximumLength) {
  return typeof value === 'string'
    && value === value.trim()
    && value.length > 0
    && value.length <= maximumLength
}

function optionalExactText(value, maximumLength) {
  return typeof value === 'string'
    && value === value.trim()
    && value.length <= maximumLength
}

function plainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function plainTransportObject(value) {
  if (!plainObject(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function uuid(value) {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

module.exports = {
  ACTIONS,
  CONTRACT_VERSION,
  createProviderResponse,
  digest,
  maximumRequestBytes,
  sign,
  stableJson,
  unsigned,
  validatePayload,
  verifyProviderRequest,
}
