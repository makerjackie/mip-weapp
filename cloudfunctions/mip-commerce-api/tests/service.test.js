'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const { createCommerceService } = require('../domain/service')

function idFactory() {
  let sequence = 0
  return () => `10000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}`
}

describe('mip commerce service', () => {
  it('passes only plan and idempotency intent to the repository', async () => {
    let captured
    const service = createCommerceService({
      catalogStage: 'TEST',
      createId: idFactory(),
      now: () => new Date('2026-08-24T00:00:00.000Z'),
      repository: {
        async createCheckout(caller, input, generated, derive) {
          captured = { caller, input, generated, derive }
          return { id: generated.orderId, status: 'CREATED' }
        },
      },
    })
    await service.createCheckout({ appId: 'app', identityKey: 'identity' }, {
      planId: '20000000-0000-4000-8000-000000000001',
      idempotencyKey: 'checkout-1',
      amountCents: 1,
    })
    assert.deepEqual(captured.input, {
      planId: '20000000-0000-4000-8000-000000000001',
      idempotencyKey: 'checkout-1',
      invitationToken: undefined,
      attribution: { sourceType: 'PLATFORM' },
      catalogStage: 'TEST',
    })
    assert.equal(captured.generated.createdAt, '2026-08-24T00:00:00.000Z')
    assert.equal(typeof captured.derive, 'function')
  })

  it('creates an opaque invitation only for a repository-confirmed player', async () => {
    const service = createCommerceService({
      catalogStage: 'TEST',
      invitationSecret: 'membership-invitation-secret-with-more-than-32-characters',
      now: () => new Date('2026-08-24T00:00:00.000Z'),
      repository: {
        async resolveMembershipInviter() {
          return '20000000-0000-4000-8000-000000000001'
        },
      },
    })
    const result = await service.createMembershipInvitation({ appId: 'app-1', identityKey: 'identity' })
    assert.match(result.token, /^m1\./)
    assert.equal(result.token.includes('20000000-0000-4000-8000-000000000001'), false)
    assert.equal(result.expiresAt, '2026-09-23T00:00:00.000Z')
  })

  it('passes no client amount when requesting a refund', async () => {
    let captured
    const service = createCommerceService({
      catalogStage: 'TEST',
      createId: idFactory(),
      repository: {
        async requestRefund(caller, input, generated, amountResolver) {
          captured = { caller, input, generated, amountResolver }
          return { id: generated.refundId, status: 'PENDING' }
        },
      },
    })
    await service.requestRefund({ appId: 'app', identityKey: 'identity' }, {
      orderId: '30000000-0000-4000-8000-000000000001',
      idempotencyKey: 'refund-1',
      reason: '取消购买',
      amountCents: 1,
    })
    assert.deepEqual(captured.input, {
      orderId: '30000000-0000-4000-8000-000000000001',
      idempotencyKey: 'refund-1',
      reason: '取消购买',
    })
    assert.equal(typeof captured.amountResolver, 'function')
  })
})
