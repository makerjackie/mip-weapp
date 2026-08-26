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
