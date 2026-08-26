'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const { PNG } = require('pngjs')
const { createUpstreamAdapter, UPSTREAM_VERSION } = require('../lib/upstream')

function pngBase64(width = 256, height = 256) {
  const image = new PNG({ width, height })
  image.data.fill(180)
  return PNG.sync.write(image).toString('base64')
}

const request = {
  action: 'generateDigitalAvatar',
  appId: 'wx1234567890abcdef',
  requestId: '1'.repeat(64),
  operationKey: '2'.repeat(64),
  payloadDigest: '3'.repeat(64),
  payload: {
    appId: 'wx1234567890abcdef',
    generationId: '20000000-0000-4000-8000-000000000001',
    styleKey: 'PROFESSIONAL',
    sourceImageFileId: 'cloud://private/source.png',
    sourceContentSha256: 'a'.repeat(64),
    sourceContentType: 'image/png',
    sourceContentBytes: 1024,
    sourceWidth: 512,
    sourceHeight: 512,
  },
}

test('proves readiness through the authenticated upstream contract instead of DNS alone', async () => {
  let outbound
  let options
  const adapter = createUpstreamAdapter({
    config: {
      endpoint: new URL('https://avatar.example.com/v1'),
      upstreamAuthSecret: 'private-key',
      timeoutMs: 12000,
    },
    imageLoader: {},
    http: {
      async postJson(_endpoint, body, requestOptions) {
        outbound = body
        options = requestOptions
        return { version: UPSTREAM_VERSION, requestId: body.requestId, ready: true }
      },
    },
  })
  assert.equal(await adapter.readiness(), true)
  assert.equal(outbound.action, 'readiness')
  assert.equal(options.authSecret, 'private-key')
  assert.match(options.operationKey, /^[a-f0-9]{64}$/)
  assert.match(options.payloadDigest, /^[a-f0-9]{64}$/)
})

test('sends verified bytes without exposing the CloudBase file ID and validates strict output', async () => {
  let outbound
  let callOptions
  const output = pngBase64()
  const adapter = createUpstreamAdapter({
    config: {
      endpoint: new URL('https://avatar.example.com/v1'),
      upstreamAuthSecret: 'private-key',
      timeoutMs: 12000,
    },
    imageLoader: {
      async load() {
        return {
          contentBase64: pngBase64(512, 512),
          contentSha256: request.payload.sourceContentSha256,
          contentType: 'image/png',
          contentBytes: 1024,
          width: 512,
          height: 512,
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
            contentType: 'image/png',
            imageBase64: output,
            providerJobKey: 'avatar-job-1',
          },
        }
      },
    },
  })
  const result = await adapter.invoke(request)
  assert.equal(result.imageBase64, output)
  assert.equal(JSON.stringify(outbound).includes('cloud://'), false)
  assert.equal(outbound.payload.sourceImage.width, 512)
  assert.equal(callOptions.operationKey, request.operationKey)
  assert.equal(callOptions.requestId, request.requestId)
  assert.equal(callOptions.payloadDigest, request.payloadDigest)
})

test('rejects response identity drift, output URLs, malformed base64, and invalid content types', async () => {
  const responses = [
    {
      version: UPSTREAM_VERSION,
      requestId: '9'.repeat(64),
      operationKey: request.operationKey,
      data: {},
    },
    {
      version: UPSTREAM_VERSION,
      requestId: request.requestId,
      operationKey: request.operationKey,
      data: {
        contentType: 'image/png',
        imageBase64: pngBase64(),
        providerJobKey: 'job',
        outputUrl: 'https://untrusted.example/avatar.png',
      },
    },
    {
      version: UPSTREAM_VERSION,
      requestId: request.requestId,
      operationKey: request.operationKey,
      data: { contentType: 'image/webp', imageBase64: 'invalid', providerJobKey: 'job' },
    },
  ]
  const adapter = createUpstreamAdapter({
    config: { endpoint: new URL('https://avatar.example.com'), upstreamAuthSecret: 'key', timeoutMs: 1000 },
    imageLoader: { async load() { return {} } },
    http: { async postJson() { return responses.shift() } },
  })
  await assert.rejects(() => adapter.invoke(request), /RESPONSE_INVALID/)
  await assert.rejects(() => adapter.invoke(request), /RESPONSE_INVALID/)
  await assert.rejects(() => adapter.invoke(request), /RESPONSE_INVALID/)
})
