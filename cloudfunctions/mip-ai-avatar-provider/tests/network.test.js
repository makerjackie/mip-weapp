'use strict'

const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { PassThrough } = require('node:stream')
const test = require('node:test')
const { createHttpsJsonClient, isPublicAddress } = require('../lib/network')

test('rejects private, loopback, link-local, documentation, mapped-private, and reserved addresses', () => {
  for (const address of [
    '0.0.0.0',
    '10.0.0.1',
    '100.64.0.1',
    '127.0.0.1',
    '169.254.1.1',
    '172.16.0.1',
    '192.168.1.1',
    '198.51.100.1',
    '203.0.113.1',
    '192.88.99.1',
    '::1',
    'fc00::1',
    'fe80::1',
    '2001:db8::1',
    '2002:0a00:0001::1',
    '::ffff:10.0.0.1',
  ]) {
    assert.equal(isPublicAddress(address), false, address)
  }
  assert.equal(isPublicAddress('8.8.8.8'), true)
  assert.equal(isPublicAddress('2606:4700:4700::1111'), true)
})

test('rejects DNS rebinding when any answer is private and pins an all-public answer', async () => {
  const endpoint = new URL('https://avatar.example.com/v1')
  const rejected = createHttpsJsonClient({
    async lookup() {
      return [{ address: '8.8.8.8', family: 4 }, { address: '10.0.0.1', family: 4 }]
    },
  })
  await assert.rejects(() => rejected.preflight(endpoint), /UPSTREAM_UNAVAILABLE/)
  const accepted = createHttpsJsonClient({
    async lookup() {
      return [{ address: '8.8.8.8', family: 4 }, { address: '1.1.1.1', family: 4 }]
    },
  })
  assert.equal(await accepted.preflight(endpoint), true)
  assert.deepEqual(await accepted.resolveEndpoint(endpoint), { address: '8.8.8.8', family: 4 })
})

test('includes DNS resolution in the configured upstream timeout', async () => {
  const client = createHttpsJsonClient({
    lookup() { return new Promise(() => {}) },
  })
  await assert.rejects(() => client.postJson(
    new URL('https://avatar.example.com/v1'),
    { request: true },
    {
      authSecret: 'private',
      maximumRequestBytes: 1024,
      maximumResponseBytes: 1024,
      operationKey: 'o'.repeat(64),
      payloadDigest: 'd'.repeat(64),
      requestId: 'r'.repeat(64),
      timeoutMs: 20,
    },
  ), /UPSTREAM_UNAVAILABLE/)
})

test('pins the verified address, sends bounded identity JSON, and never follows redirects', async () => {
  let requestOptions
  let requestBody
  const responses = [
    {
      statusCode: 200,
      headers: { 'content-type': 'application/json', 'content-length': '11' },
      body: '{"ok":true}',
    },
    {
      statusCode: 302,
      headers: { location: 'https://127.0.0.1/private' },
      body: '',
    },
  ]
  const client = createHttpsJsonClient({
    async lookup() { return [{ address: '8.8.8.8', family: 4 }] },
    request(_endpoint, options, callback) {
      requestOptions = options
      const outgoing = new EventEmitter()
      outgoing.destroy = () => outgoing.emit('error', new Error('destroyed'))
      outgoing.end = (body) => {
        requestBody = body
        const current = responses.shift()
        const response = new PassThrough()
        response.statusCode = current.statusCode
        response.headers = current.headers
        callback(response)
        response.end(current.body)
      }
      return outgoing
    },
  })
  const options = {
    authSecret: 'private-upstream-auth',
    maximumRequestBytes: 1024,
    maximumResponseBytes: 1024,
    operationKey: 'o'.repeat(64),
    payloadDigest: 'd'.repeat(64),
    requestId: 'r'.repeat(64),
    timeoutMs: 1000,
  }
  assert.deepEqual(await client.postJson(
    new URL('https://avatar.example.com/v1'),
    { request: true },
    options,
  ), { ok: true })
  assert.equal(requestOptions.headers.authorization, 'Bearer private-upstream-auth')
  assert.equal(requestOptions.headers['accept-encoding'], 'identity')
  assert.equal(requestOptions.headers['idempotency-key'], options.operationKey)
  assert.equal(JSON.parse(requestBody).request, true)
  await new Promise((resolve, reject) => {
    requestOptions.lookup('avatar.example.com', { all: false }, (error, address, family) => {
      if (error) reject(error)
      else {
        assert.equal(address, '8.8.8.8')
        assert.equal(family, 4)
        resolve()
      }
    })
  })
  await assert.rejects(
    () => client.postJson(new URL('https://avatar.example.com/v1'), { request: true }, options),
    /REDIRECT_REJECTED/,
  )
  assert.equal(responses.length, 0)
})

test('enforces one wall-clock deadline even while the upstream keeps dripping bytes', async () => {
  let responseDestroyed = false
  const client = createHttpsJsonClient({
    async lookup() { return [{ address: '8.8.8.8', family: 4 }] },
    request(_endpoint, _options, callback) {
      const outgoing = new EventEmitter()
      outgoing.destroy = () => outgoing.emit('error', new Error('destroyed'))
      outgoing.end = () => {
        const response = new PassThrough()
        response.statusCode = 200
        response.headers = { 'content-type': 'application/json' }
        const interval = setInterval(() => response.write(' '), 5)
        response.on('close', () => {
          responseDestroyed = true
          clearInterval(interval)
        })
        callback(response)
      }
      return outgoing
    },
  })
  const startedAt = Date.now()
  await assert.rejects(() => client.postJson(
    new URL('https://avatar.example.com/v1'),
    { request: true },
    {
      authSecret: 'private',
      maximumRequestBytes: 1024,
      maximumResponseBytes: 1024,
      operationKey: 'o'.repeat(64),
      payloadDigest: 'd'.repeat(64),
      requestId: 'r'.repeat(64),
      timeoutMs: 30,
    },
  ), /UPSTREAM_UNAVAILABLE/)
  assert.equal(responseDestroyed, true)
  assert.ok(Date.now() - startedAt < 250)
})
