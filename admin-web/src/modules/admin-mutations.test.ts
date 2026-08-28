import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createIdempotencyKey, createMutationIntent } from './admin-mutations.ts'

describe('admin mutation intents', () => {
  it('creates a transport-ready input with a stable business key', () => {
    const intent = createMutationIntent('mip.admin.events.clone', { sourceEventId: 'event-1', expectedVersion: 2 }, 'web-event-clone-20300101')
    assert.equal(intent.action, 'mip.admin.events.clone')
    assert.equal(intent.idempotencyKey, 'web-event-clone-20300101')
    assert.deepEqual(intent.input, {
      sourceEventId: 'event-1', expectedVersion: 2, idempotencyKey: 'web-event-clone-20300101',
    })
  })

  it('rejects keys that the server cannot safely accept', () => {
    assert.throws(() => createMutationIntent('mip.admin.refunds.submit', {}, 'short'), /Invalid admin mutation/)
    assert.throws(() => createMutationIntent('mip.admin.refunds.submit', {}, 'web key with spaces'), /Invalid admin mutation/)
  })

  it('generates a key long enough for all reviewed server mutations', () => {
    const key = createIdempotencyKey('mip.admin.memberships.grant')
    assert.match(key, /^[A-Za-z0-9_.:-]{12,128}$/)
  })
})
