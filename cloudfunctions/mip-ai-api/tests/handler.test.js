'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const { createHandler, failure } = require('../domain/handler')

test('health checks persistence without resolving a user or provider', async () => {
  const handler = createHandler({
    async health() {
      return { service: 'mip-ai-api', persistence: 'cloudbase-mysql' }
    },
    async resolveCaller() { throw new Error('unexpected caller') },
    service: {},
  })
  assert.deepEqual(await handler({ action: 'health' }), {
    ok: true,
    data: { service: 'mip-ai-api', persistence: 'cloudbase-mysql' },
  })
})

test('exposes unknown provider and upload results as retryable without claiming failure', () => {
  assert.deepEqual(failure(new Error('AI_PROVIDER_RESULT_UNKNOWN')), {
    ok: false,
    error: {
      code: 'AI_PROVIDER_RESULT_UNKNOWN',
      message: 'AI 草稿结果暂未确认，请稍后重试',
      retryable: true,
    },
  })
  assert.equal(failure(new Error('AI_AUDIO_UPLOAD_RESULT_UNKNOWN')).error.retryable, true)
  assert.equal(failure(new Error('AI_PROVIDER_REJECTED')).error.retryable, false)
})
