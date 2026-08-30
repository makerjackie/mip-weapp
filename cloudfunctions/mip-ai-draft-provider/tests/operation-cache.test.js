'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const { createOperationCache } = require('../lib/operation-cache')

test('coalesces duplicate operations and rejects a reused key with changed content', async () => {
  const cache = createOperationCache()
  let calls = 0
  const operation = async () => {
    calls += 1
    await Promise.resolve()
    return { ok: true }
  }
  const [first, second] = await Promise.all([
    cache.run('operation', 'digest', operation),
    cache.run('operation', 'digest', operation),
  ])
  assert.deepEqual(first, { ok: true })
  assert.equal(second, first)
  assert.equal(calls, 1)
  await assert.rejects(
    () => cache.run('operation', 'different-digest', operation),
    /IDEMPOTENCY_CONFLICT/,
  )
})

test('fails closed instead of evicting a different in-flight draft operation', async () => {
  const cache = createOperationCache({ maximumEntries: 1 })
  let calls = 0
  let release
  const pending = new Promise(resolve => { release = resolve })
  const operation = async () => {
    calls += 1
    await pending
    return { ok: true }
  }
  const first = cache.run('first', 'digest-1', operation)
  const replay = cache.run('first', 'digest-1', operation)
  await assert.rejects(
    () => cache.run('second', 'digest-2', async () => ({ ok: true })),
    /UPSTREAM_UNAVAILABLE/,
  )
  release()
  assert.deepEqual(await first, { ok: true })
  assert.deepEqual(await replay, { ok: true })
  assert.equal(calls, 1)
})
