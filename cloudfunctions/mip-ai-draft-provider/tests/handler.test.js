'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const { FUNCTION_NAME, readConfig } = require('../lib/config')
const { createHandler } = require('../domain/handler')

test('reports liveness but fails readiness and business calls when configuration is absent', async () => {
  const runtime = {
    config: readConfig({}),
    provider: { async handle() { throw new Error('must not run') } },
    upstream: { async readiness() { throw new Error('must not run') } },
  }
  const handler = createHandler(() => runtime)
  assert.deepEqual(await handler({ action: 'health' }), {
    ok: true,
    data: { service: FUNCTION_NAME, persistence: 'none', configured: false },
  })
  assert.equal((await handler({ action: 'readiness' })).error.code, 'AI_DRAFT_PROVIDER_NOT_CONFIGURED')
  assert.equal((await handler({ action: 'structureText' })).error.code, 'AI_DRAFT_PROVIDER_NOT_CONFIGURED')
})

test('returns readiness only after the exact endpoint resolves', async () => {
  let checked = false
  const runtime = {
    config: readConfig({
      MIP_ALLOWED_APP_IDS: 'wx1234567890abcdef',
      MIP_AI_DRAFT_PROVIDER_HMAC_SECRET: 'h'.repeat(48),
      MIP_AI_DRAFT_UPSTREAM_ENDPOINT: 'https://provider.example.com/v1',
      MIP_AI_DRAFT_UPSTREAM_ALLOWED_HOSTS: 'provider.example.com',
      MIP_AI_DRAFT_UPSTREAM_SECRET: 's'.repeat(32),
    }),
    provider: {},
    upstream: { async readiness() { checked = true } },
  }
  const result = await createHandler(() => runtime)({ action: 'readiness' })
  assert.equal(checked, true)
  assert.equal(result.ok, true)
  assert.equal(result.data.ready, true)
  assert.deepEqual(result.data.capabilities, {
    textDrafts: true,
    voiceDrafts: true,
    refinementDrafts: true,
  })
})

test('reports DeepSeek-compatible mode as text-only', async () => {
  const runtime = {
    config: readConfig({
      MIP_ALLOWED_APP_IDS: 'wx1234567890abcdef',
      MIP_AI_DRAFT_PROVIDER_HMAC_SECRET: 'h'.repeat(48),
      OPENAI_BASE_URL: 'https://api.deepseek.com',
      OPENAI_MODEL: 'deepseek-v4-flash',
      OPENAI_API_KEY: 'k'.repeat(32),
    }),
    provider: {},
    upstream: { async readiness() {} },
  }
  const result = await createHandler(() => runtime)({ action: 'readiness' })
  assert.deepEqual(result.data.capabilities, {
    textDrafts: true,
    voiceDrafts: false,
    refinementDrafts: true,
  })
})
