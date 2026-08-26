'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const { createUpstreamAdapter, UPSTREAM_VERSION } = require('../lib/upstream')

const request = {
  action: 'transcribeAndStructure',
  appId: 'wx1234567890abcdef',
  requestId: '1'.repeat(64),
  operationKey: '2'.repeat(64),
  payloadDigest: '3'.repeat(64),
  payload: {
    appId: 'wx1234567890abcdef',
    draftId: '20000000-0000-4000-8000-000000000001',
    purpose: 'PROFILE',
    expectedVersion: 1,
    audioFileId: 'cloud://private/file.mp3',
    audioContentSha256: 'a'.repeat(64),
    audioContentType: 'audio/mpeg',
    audioContentBytes: 1024,
  },
}

test('proves readiness through the authenticated upstream contract instead of DNS alone', async () => {
  let outbound
  let headers
  const adapter = createUpstreamAdapter({
    config: {
      endpoint: new URL('https://provider.example.com/v1'),
      upstreamSecret: 'private-key',
      timeoutMs: 5000,
    },
    audioLoader: {},
    http: {
      async postJson(_endpoint, body, options) {
        outbound = body
        headers = options
        return { version: UPSTREAM_VERSION, requestId: body.requestId, ready: true }
      },
    },
  })
  assert.equal(await adapter.readiness(), true)
  assert.equal(outbound.action, 'readiness')
  assert.equal(headers.secret, 'private-key')
  assert.match(headers.operationKey, /^[a-f0-9]{64}$/)
  assert.match(headers.payloadDigest, /^[a-f0-9]{64}$/)
})

test('sends verified audio bytes without exposing the CloudBase file ID and binds idempotency headers', async () => {
  let outbound
  let callOptions
  const adapter = createUpstreamAdapter({
    config: {
      endpoint: new URL('https://provider.example.com/v1'),
      upstreamSecret: 'private-key',
      timeoutMs: 5000,
    },
    audioLoader: {
      async load() {
        return {
          contentBase64: 'SUQzAA==',
          contentSha256: request.payload.audioContentSha256,
          contentType: 'audio/mpeg',
          contentBytes: 4,
        }
      },
    },
    http: {
      async postJson(_endpoint, body, options) {
        outbound = body
        callOptions = options
        return {
          version: UPSTREAM_VERSION,
          requestId: request.requestId,
          operationKey: request.operationKey,
          data: {
            transcriptText: '语音内容',
            structuredDraft: { headline: '产品负责人' },
            providerJobKey: 'job-voice-1',
          },
        }
      },
    },
  })
  const result = await adapter.invoke(request)
  assert.equal(result.transcriptText, '语音内容')
  assert.equal(JSON.stringify(outbound).includes('cloud://'), false)
  assert.equal(outbound.payload.audio.contentBase64, 'SUQzAA==')
  assert.equal(callOptions.operationKey, request.operationKey)
  assert.equal(callOptions.requestId, request.requestId)
  assert.equal(callOptions.payloadDigest, request.payloadDigest)
})

test('rejects mismatched response identity and extra result fields', async () => {
  const adapter = createUpstreamAdapter({
    config: { endpoint: new URL('https://provider.example.com'), upstreamSecret: 'key', timeoutMs: 1000 },
    audioLoader: { async load() { return { contentBase64: 'SUQzAA==' } } },
    http: {
      async postJson() {
        return {
          version: UPSTREAM_VERSION,
          requestId: '9'.repeat(64),
          operationKey: request.operationKey,
          data: {},
        }
      },
    },
  })
  await assert.rejects(() => adapter.invoke(request), /RESPONSE_INVALID/)
})
