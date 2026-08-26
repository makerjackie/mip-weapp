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
  MIP_AI_DRAFT_PROVIDER_HMAC_SECRET: 'h'.repeat(48),
  MIP_AI_DRAFT_UPSTREAM_ENDPOINT: 'https://provider.example.com/v1/drafts',
  MIP_AI_DRAFT_UPSTREAM_ALLOWED_HOSTS: 'provider.example.com',
  MIP_AI_DRAFT_UPSTREAM_SECRET: 's'.repeat(32),
  MIP_AI_DRAFT_UPSTREAM_TIMEOUT_MS: '5000',
}

test('fails closed unless the endpoint, exact host, AppID, and both secrets are configured', () => {
  assert.equal(readConfig({}).configured, false)
  assert.throws(() => requireReady(readConfig({})), /NOT_CONFIGURED/)
  const config = readConfig(configured)
  assert.equal(config.configured, true)
  assert.equal(config.endpoint.hostname, 'provider.example.com')
  assert.equal(config.timeoutMs, 5000)
})

test('rejects wildcard, IP, insecure, credential, query, and non-standard-port endpoints', () => {
  for (const hosts of ['*.example.com', '127.0.0.1', 'localhost', 'provider.example.com:443']) {
    assert.deepEqual(parseAllowedHosts(hosts), [])
  }
  for (const endpoint of [
    'http://provider.example.com/v1',
    'https://user:pass@provider.example.com/v1',
    'https://provider.example.com:8443/v1',
    'https://provider.example.com/v1?key=secret',
    'https://127.0.0.1/v1',
  ]) {
    assert.equal(parseEndpoint(endpoint), null)
  }
  assert.equal(readConfig({
    ...configured,
    MIP_AI_DRAFT_UPSTREAM_ALLOWED_HOSTS: 'other.example.com',
  }).configured, false)
})
