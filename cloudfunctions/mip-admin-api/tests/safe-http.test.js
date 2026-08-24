'use strict'

const assert = require('node:assert/strict')
const { gzipSync } = require('node:zlib')
const { Readable } = require('node:stream')
const { describe, it } = require('node:test')
const {
  isPublicAddress,
  pinnedLookup,
  readLimitedDecodedBody,
  resolvePublicAddresses,
} = require('../lib/safe-http')

describe('knowledge source network boundary', () => {
  it('rejects loopback, ULA, link-local, CGNAT and unspecified addresses', () => {
    for (const address of ['::1', 'fc00::1', 'fd00::1', 'fe80::1', '100.64.0.1', '0.0.0.0']) {
      assert.equal(isPublicAddress(address), false, address)
    }
    assert.equal(isPublicAddress('8.8.8.8'), true)
    assert.equal(isPublicAddress('2606:4700:4700::1111'), true)
  })

  it('rejects a hostname when any DNS answer is private', async () => {
    await assert.rejects(() => resolvePublicAddresses('feed.example.com', async () => [
      { address: '8.8.8.8', family: 4 },
      { address: '10.0.0.8', family: 4 },
    ]), /KNOWLEDGE_SOURCE_URL_INVALID/)
  })

  it('pins the validated address so a later DNS rebind is not consulted', async () => {
    let resolutions = 0
    const addresses = await resolvePublicAddresses('feed.example.com', async () => {
      resolutions += 1
      return [{ address: '8.8.8.8', family: 4 }]
    })
    const lookup = pinnedLookup('feed.example.com', addresses[0])
    const selected = await new Promise((resolve, reject) => lookup(
      'feed.example.com', {}, (error, address, family) => error ? reject(error) : resolve({ address, family }),
    ))
    assert.deepEqual(selected, { address: '8.8.8.8', family: 4 })
    assert.equal(resolutions, 1)
  })

  it('aborts a chunked response after the decompressed byte limit', async () => {
    await assert.rejects(() => readLimitedDecodedBody(
      Readable.from([Buffer.alloc(700), Buffer.alloc(400)]),
      { maxBytes: 1_000 },
    ), /KNOWLEDGE_SOURCE_RESPONSE_INVALID/)
  })

  it('enforces the byte limit after gzip expansion', async () => {
    const compressed = gzipSync(Buffer.alloc(2_001, 97))
    await assert.rejects(() => readLimitedDecodedBody(
      Readable.from([compressed]),
      { contentEncoding: 'gzip', maxBytes: 2_000 },
    ), /KNOWLEDGE_SOURCE_RESPONSE_INVALID/)
  })
})
