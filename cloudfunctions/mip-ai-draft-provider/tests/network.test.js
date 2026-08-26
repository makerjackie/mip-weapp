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
  const endpoint = new URL('https://provider.example.com/v1')
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

test('pins the verified address, sends strict identity JSON, and never follows redirects', async () => {
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
      outgoing.setTimeout = () => outgoing
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
    maximumRequestBytes: 1024,
    maximumResponseBytes: 1024,
    operationKey: 'o'.repeat(64),
    payloadDigest: 'd'.repeat(64),
    requestId: 'r'.repeat(64),
    secret: 'private',
    timeoutMs: 1000,
  }
  assert.deepEqual(await client.postJson(
    new URL('https://provider.example.com/v1'),
    { request: true },
    options,
  ), { ok: true })
  assert.equal(requestOptions.headers['accept-encoding'], 'identity')
  assert.equal(requestOptions.headers['idempotency-key'], options.operationKey)
  assert.equal(JSON.parse(requestBody).request, true)
  await new Promise((resolve, reject) => {
    requestOptions.lookup('provider.example.com', { all: false }, (error, address, family) => {
      if (error) reject(error)
      else {
        assert.equal(address, '8.8.8.8')
        assert.equal(family, 4)
        resolve()
      }
    })
  })
  await assert.rejects(
    () => client.postJson(new URL('https://provider.example.com/v1'), { request: true }, options),
    /REDIRECT_REJECTED/,
  )
  assert.equal(responses.length, 0)
})
