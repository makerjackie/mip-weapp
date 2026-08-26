'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const { createOperationCache } = require('../lib/operation-cache')

test('coalesces duplicate operations and rejects a reused key with changed content', async () => {
  const cache = createOperationCache()
  let calls = 0
  let release
  const pending = new Promise(resolve => { release = resolve })
  const operation = async () => {
    calls += 1
    await pending
    return { ok: true }
  }
  const firstPromise = cache.run('operation', 'digest', operation)
  const secondPromise = cache.run('operation', 'digest', operation)
  await assert.rejects(() => cache.run('operation', 'changed', operation), /IDEMPOTENCY_CONFLICT/)
  release()
  const [first, second] = await Promise.all([firstPromise, secondPromise])
  assert.deepEqual(first, { ok: true })
  assert.equal(second, first)
  assert.equal(calls, 1)
  assert.deepEqual(await cache.run('operation', 'changed', operation), { ok: true })
  assert.equal(calls, 2)
})

test('fails closed instead of evicting a different in-flight image operation', async () => {
  const cache = createOperationCache({ maximumEntries: 1 })
  let release
  const pending = new Promise(resolve => { release = resolve })
  const first = cache.run('first', 'digest-1', async () => {
    await pending
    return { ok: true }
  })
  await assert.rejects(
    () => cache.run('second', 'digest-2', async () => ({ ok: true })),
    /UPSTREAM_UNAVAILABLE/,
  )
  release()
  assert.deepEqual(await first, { ok: true })
})
