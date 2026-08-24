'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const {
  assertSameAttribution,
  resolveCheckoutAttribution,
} = require('../domain/repository')

const buyerUserId = '10000000-0000-4000-8000-000000000001'
const inviterUserId = '20000000-0000-4000-8000-000000000001'

describe('membership checkout attribution', () => {
  it('accepts platform traffic without looking up an inviter', async () => {
    const tx = { one: async () => assert.fail('unexpected inviter lookup') }
    assert.deepEqual(await resolveCheckoutAttribution(tx, 'app-1', buyerUserId, {
      sourceType: 'PLATFORM',
    }), { sourceType: 'PLATFORM' })
  })

  it('requires a distinct active player and preserves only the token hash', async () => {
    const calls = []
    const tx = {
      async one(sql, params) {
        calls.push({ sql, params })
        return { id: inviterUserId }
      },
    }
    const result = await resolveCheckoutAttribution(tx, 'app-1', buyerUserId, {
      sourceType: 'USER',
      invitedByUserId: inviterUserId,
      sourceTokenHash: 'a'.repeat(64),
    })
    assert.deepEqual(result, {
      sourceType: 'USER',
      invitedByUserId: inviterUserId,
      sourceTokenHash: 'a'.repeat(64),
    })
    assert.match(calls[0].sql, /mip_membership_entitlements/)
    assert.deepEqual(calls[0].params, ['app-1', inviterUserId])
    await assert.rejects(
      () => resolveCheckoutAttribution(tx, 'app-1', buyerUserId, {
        sourceType: 'USER',
        invitedByUserId: buyerUserId,
        sourceTokenHash: 'a'.repeat(64),
      }),
      /MEMBERSHIP_INVITATION_INVALID/,
    )
  })

  it('prevents an idempotency replay from changing the inviter', () => {
    const first = JSON.stringify({
      attribution: { sourceType: 'USER', invitedByUserId: inviterUserId, sourceTokenHash: 'a'.repeat(64) },
    })
    assert.doesNotThrow(() => assertSameAttribution(first, {
      sourceType: 'USER',
      invitedByUserId: inviterUserId,
      sourceTokenHash: 'b'.repeat(64),
    }))
    assert.throws(() => assertSameAttribution(first, { sourceType: 'PLATFORM' }), /IDEMPOTENCY_CONFLICT/)
  })
})
