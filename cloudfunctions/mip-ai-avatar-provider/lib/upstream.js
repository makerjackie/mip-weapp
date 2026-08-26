'use strict'

const { createHash } = require('node:crypto')
const { normalizeOutputImage } = require('./image')

const UPSTREAM_VERSION = 'mip.ai.avatar-upstream.v1'
const responseKeys = new Set(['version', 'requestId', 'operationKey', 'data'])

function createUpstreamAdapter(options) {
  const config = options.config
  const http = options.http
  const imageLoader = options.imageLoader

  return {
    async readiness() {
      const operationKey = createHash('sha256').update('MIP_AI_AVATAR_READINESS_V1').digest('hex')
      const requestId = createHash('sha256').update([
        'MIP_AI_AVATAR_READINESS_REQUEST_V1',
        config.endpoint.toString(),
      ].join('\0')).digest('hex')
      const body = { version: UPSTREAM_VERSION, action: 'readiness', requestId }
      const payloadDigest = createHash('sha256').update(JSON.stringify(body)).digest('hex')
      const response = await http.postJson(config.endpoint, body, {
        authSecret: config.upstreamAuthSecret,
        maximumRequestBytes: 1024,
        maximumResponseBytes: 1024,
        operationKey,
        payloadDigest,
        requestId,
        timeoutMs: config.timeoutMs,
      })
      if (!exactKeys(response, new Set(['version', 'requestId', 'ready']))
        || response.version !== UPSTREAM_VERSION
        || response.requestId !== requestId
        || response.ready !== true) {
        throw new Error('DIGITAL_AVATAR_PROVIDER_UPSTREAM_UNAVAILABLE')
      }
      return true
    },

    async invoke(request) {
      const sourceImage = await imageLoader.load(request.payload)
      const body = {
        version: UPSTREAM_VERSION,
        requestId: request.requestId,
        operationKey: request.operationKey,
        action: request.action,
        appId: request.appId,
        payloadDigest: request.payloadDigest,
        payload: {
          appId: request.payload.appId,
          generationId: request.payload.generationId,
          styleKey: request.payload.styleKey,
          sourceImage,
        },
      }
      const response = await http.postJson(config.endpoint, body, {
        authSecret: config.upstreamAuthSecret,
        maximumRequestBytes: 2 * 1024 * 1024,
        maximumResponseBytes: 3 * 1024 * 1024,
        operationKey: request.operationKey,
        payloadDigest: request.payloadDigest,
        requestId: request.requestId,
        timeoutMs: config.timeoutMs,
      })
      if (!exactKeys(response, responseKeys)
        || response.version !== UPSTREAM_VERSION
        || response.requestId !== request.requestId
        || response.operationKey !== request.operationKey) {
        throw new Error('DIGITAL_AVATAR_PROVIDER_RESPONSE_INVALID')
      }
      return normalizeProviderData(response.data)
    },
  }
}

function normalizeProviderData(value) {
  const allowedKeys = new Set(['contentType', 'imageBase64', 'providerJobKey'])
  if (!plainObject(value) || !exactKeys(value, allowedKeys)) {
    throw new Error('DIGITAL_AVATAR_PROVIDER_RESPONSE_INVALID')
  }
  const contentType = value.contentType
  const providerJobKey = text(value.providerJobKey)
  if (!['image/png', 'image/jpeg'].includes(contentType)
    || !providerJobKey
    || providerJobKey.length > 256
    || !/^[\x21-\x7e]+$/.test(providerJobKey)) {
    throw new Error('DIGITAL_AVATAR_PROVIDER_RESPONSE_INVALID')
  }
  const imageBase64 = normalizeOutputImage(value.imageBase64, contentType)
  return { contentType, imageBase64, providerJobKey }
}

function exactKeys(value, expected) {
  const keys = Object.keys(value || {})
  return keys.length === expected.size && keys.every(key => expected.has(key))
}

function plainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function text(value) {
  return typeof value === 'string' ? value.trim() : ''
}

module.exports = {
  UPSTREAM_VERSION,
  createUpstreamAdapter,
  normalizeProviderData,
}
