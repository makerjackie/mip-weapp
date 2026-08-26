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
  assert.equal((await handler({ action: 'readiness' })).error.code, 'DIGITAL_AVATAR_PROVIDER_NOT_CONFIGURED')
  assert.equal((await handler({ action: 'generateDigitalAvatar' })).error.code, 'DIGITAL_AVATAR_PROVIDER_NOT_CONFIGURED')
})

test('returns readiness only after the authenticated upstream contract passes', async () => {
  let checked = false
  const runtime = {
    config: readConfig({
      MIP_ALLOWED_APP_IDS: 'wx1234567890abcdef',
      MIP_AI_AVATAR_PROVIDER_HMAC_SECRET: 'h'.repeat(48),
      MIP_AI_AVATAR_UPSTREAM_ENDPOINT: 'https://avatar.example.com/v1',
      MIP_AI_AVATAR_UPSTREAM_ALLOWED_HOSTS: 'avatar.example.com',
      MIP_AI_AVATAR_UPSTREAM_AUTH_SECRET: 's'.repeat(32),
    }),
    provider: {},
    upstream: { async readiness() { checked = true } },
  }
  const result = await createHandler(() => runtime)({ action: 'readiness' })
  assert.equal(checked, true)
  assert.equal(result.ok, true)
  assert.equal(result.data.ready, true)
})

test('normalizes private upstream failures and unknown uppercase codes without logging user material', async () => {
  const warnings = []
  const originalWarn = console.warn
  console.warn = (...values) => warnings.push(values)
  try {
    const runtime = {
      config: { configured: true },
      provider: { async handle() { throw new Error('PRIVATE_USER_MATERIAL') } },
      upstream: {},
    }
    const result = await createHandler(() => runtime)({
      action: 'generateDigitalAvatar',
      imageBase64: 'private-user-material',
    })
    assert.equal(result.error.code, 'DIGITAL_AVATAR_PROVIDER_UNAVAILABLE')
    assert.equal(JSON.stringify(warnings).includes('PRIVATE_USER_MATERIAL'), false)
    assert.equal(JSON.stringify(warnings).includes('private-user-material'), false)
  }
  finally {
    console.warn = originalWarn
  }
})
