'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const {
  parseAllowedHosts,
  parseEndpoint,
  parseOpenAiApiKey,
  parseOpenAiBaseUrl,
  parseOpenAiModel,
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

const openAiConfigured = {
  MIP_ALLOWED_APP_IDS: 'wx1234567890abcdef',
  MIP_AI_DRAFT_PROVIDER_HMAC_SECRET: 'h'.repeat(48),
  MIP_AI_DRAFT_UPSTREAM_TIMEOUT_MS: '5000',
  OPENAI_BASE_URL: 'https://api.deepseek.com',
  OPENAI_MODEL: 'deepseek-v4-flash',
  OPENAI_API_KEY: `sk-${'k'.repeat(32)}`,
}

test('fails closed unless the endpoint, exact host, AppID, and both secrets are configured', () => {
  assert.equal(readConfig({}).configured, false)
  assert.throws(() => requireReady(readConfig({})), /NOT_CONFIGURED/)
  const config = readConfig(configured)
  assert.equal(config.configured, true)
  assert.equal(config.endpoint.hostname, 'provider.example.com')
  assert.equal(config.timeoutMs, 5000)
})

test('accepts a complete OpenAI-compatible configuration without the legacy upstream secret', () => {
  const config = readConfig(openAiConfigured)
  assert.equal(config.configured, true)
  assert.equal(config.mode, 'openai_compatible')
  assert.equal(config.openAiBaseUrl.hostname, 'api.deepseek.com')
  assert.equal(config.openAiChatEndpoint.toString(), 'https://api.deepseek.com/chat/completions')
  assert.equal(config.openAiModel, 'deepseek-v4-flash')
  assert.equal(readConfig({ ...openAiConfigured, OPENAI_API_KEY: '' }).configured, false)
})

test('validates OpenAI-compatible values without exposing the API key', () => {
  assert.equal(parseOpenAiBaseUrl('https://api.deepseek.com').hostname, 'api.deepseek.com')
  assert.equal(parseOpenAiBaseUrl('http://api.deepseek.com'), null)
  assert.equal(parseOpenAiBaseUrl('https://127.0.0.1'), null)
  assert.equal(parseOpenAiModel('deepseek-v4-flash'), 'deepseek-v4-flash')
  assert.equal(parseOpenAiModel('bad model'), '')
  assert.equal(parseOpenAiApiKey(`sk-${'k'.repeat(32)}`).length > 16, true)
  assert.equal(parseOpenAiApiKey('short'), '')
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
