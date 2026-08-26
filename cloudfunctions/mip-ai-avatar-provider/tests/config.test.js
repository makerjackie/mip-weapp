'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const {
  parseAllowedHosts,
  parseEndpoint,
  readConfig,
  requireReady,
} = require('../lib/config')

const configured = {
  MIP_ALLOWED_APP_IDS: 'wx1234567890abcdef',
  MIP_AI_AVATAR_PROVIDER_HMAC_SECRET: 'h'.repeat(48),
  MIP_AI_AVATAR_UPSTREAM_ENDPOINT: 'https://avatar.example.com/v1/generate',
  MIP_AI_AVATAR_UPSTREAM_ALLOWED_HOSTS: 'avatar.example.com',
  MIP_AI_AVATAR_UPSTREAM_AUTH_SECRET: 's'.repeat(32),
  MIP_AI_AVATAR_UPSTREAM_TIMEOUT_MS: '12000',
}

test('fails closed unless the endpoint, exact host, AppID, and both secrets are configured', () => {
  assert.equal(readConfig({}).configured, false)
  assert.throws(() => requireReady(readConfig({})), /NOT_CONFIGURED/)
  const config = readConfig(configured)
  assert.equal(config.configured, true)
  assert.equal(config.endpoint.hostname, 'avatar.example.com')
  assert.equal(config.timeoutMs, 12000)
})

test('fails closed when internal HMAC and upstream authentication reuse one secret', () => {
  const shared = 's'.repeat(48)
  const config = readConfig({
    MIP_ALLOWED_APP_IDS: 'wx1234567890abcdef',
    MIP_AI_AVATAR_PROVIDER_HMAC_SECRET: shared,
    MIP_AI_AVATAR_UPSTREAM_ENDPOINT: 'https://avatar.example.com/v1',
    MIP_AI_AVATAR_UPSTREAM_ALLOWED_HOSTS: 'avatar.example.com',
    MIP_AI_AVATAR_UPSTREAM_AUTH_SECRET: shared,
  })
  assert.equal(config.configured, false)
  assert.ok(config.errors.includes('TRUST_DOMAINS_NOT_ISOLATED'))
})

test('rejects wildcard, IP, insecure, credential, query, and non-standard-port endpoints', () => {
  for (const hosts of ['*.example.com', '127.0.0.1', 'localhost', 'avatar.example.com:443']) {
    assert.deepEqual(parseAllowedHosts(hosts), [])
  }
  for (const endpoint of [
    'http://avatar.example.com/v1',
    'https://user:pass@avatar.example.com/v1',
    'https://avatar.example.com:8443/v1',
    'https://avatar.example.com/v1?key=secret',
    'https://127.0.0.1/v1',
  ]) {
    assert.equal(parseEndpoint(endpoint), null)
  }
  assert.equal(readConfig({
    ...configured,
    MIP_AI_AVATAR_UPSTREAM_ALLOWED_HOSTS: 'other.example.com',
  }).configured, false)
})
