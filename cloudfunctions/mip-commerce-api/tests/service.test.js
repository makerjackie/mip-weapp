'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const { createMembershipInvitation } = require('../lib/membership-invitation')
const { createCommerceService } = require('../domain/service')

function idFactory() {
  let sequence = 0
  return () => `10000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}`
}

describe('mip commerce service', () => {
  it('reads the current membership benefit fact without client eligibility input', async () => {
    let captured
    const service = createCommerceService({
      catalogStage: 'TEST',
      repository: {
        async getMembershipBenefits(caller) {
          captured = caller
          return { kind: 'GUEST', status: 'NONE', benefits: [] }
        },
      },
      createInvitationCode: async ({ scene }) => ({ codeUrl: `cloud://env.test/${scene}.png` }),
    })
    const caller = { appId: 'app', identityKey: 'identity' }
    assert.deepEqual(await service.getMembershipBenefits(caller, { userId: 'client-user' }), {
      kind: 'GUEST',
      status: 'NONE',
      benefits: [],
    })
    assert.deepEqual(captured, caller)
  })

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

  it('creates a player-only membership code and resolves its scene only while the inviter is active', async () => {
    let generatedScene = ''
    let assertedInviter = ''
    const repository = {
      async resolveMembershipInviter() {
        return '20000000-0000-4000-8000-000000000001'
      },
      async claimMembershipInvitationCode(appId, userId, input) {
        assert.equal(appId, 'app-1')
        assert.equal(userId, '20000000-0000-4000-8000-000000000001')
        assert.match(input.sceneHash, /^[0-9a-f]{64}$/)
        return {
          state: 'CLAIMED',
          invitationId: '30000000-0000-4000-8000-000000000001',
          leaseToken: '40000000-0000-4000-8000-000000000001',
          allocationId: '50000000-0000-4000-8000-000000000001',
          allocationAssetId: '60000000-0000-4000-8000-000000000001',
          expiresAt: input.expiresAt,
        }
      },
      async assertMembershipInviter(appId, userId) {
        assert.equal(appId, 'app-1')
        assertedInviter = userId
      },
    }
    const service = createCommerceService({
      catalogStage: 'TEST',
      invitationSecret: 'membership-invitation-secret-with-more-than-32-characters',
      now: () => new Date('2026-08-24T00:00:00.000Z'),
      repository,
      async createInvitationCode({
        scene,
        invitationId,
        leaseToken,
        allocationId,
        assetId,
        inviterUserId,
      }) {
        generatedScene = scene
        assert.equal(invitationId, '30000000-0000-4000-8000-000000000001')
        assert.equal(leaseToken, '40000000-0000-4000-8000-000000000001')
        assert.equal(allocationId, '50000000-0000-4000-8000-000000000001')
        assert.equal(assetId, '60000000-0000-4000-8000-000000000001')
        assert.equal(inviterUserId, '20000000-0000-4000-8000-000000000001')
        return { codeUrl: 'cloud://env.test/membership-code.png' }
      },
    })
    const caller = { appId: 'app-1', identityKey: 'identity' }
    const code = await service.createMembershipInvitationCode(caller)
    assert.equal(generatedScene.length, 32)
    assert.equal(code.codeUrl, 'cloud://env.test/membership-code.png')
    const resolved = await service.resolveMembershipInvitationScene(caller, { scene: generatedScene })
    assert.equal(assertedInviter, '20000000-0000-4000-8000-000000000001')
    assert.match(resolved.token, /^m1\./)
    assert.equal(resolved.expiresAt, '2026-09-23T00:00:00.000Z')
  })

  it('reuses a ready membership code without calling the upload adapter', async () => {
    const service = createCommerceService({
      catalogStage: 'TEST',
      invitationSecret: 'membership-invitation-secret-with-more-than-32-characters',
      now: () => new Date('2026-08-24T00:00:00.000Z'),
      repository: {
        async resolveMembershipInviter() {
          return '20000000-0000-4000-8000-000000000001'
        },
        async claimMembershipInvitationCode() {
          return {
            state: 'READY',
            codeUrl: 'cloud://env.test/existing-code.png',
            expiresAt: '2026-09-23T00:00:00.000Z',
          }
        },
      },
      async createInvitationCode() {
        assert.fail('ready claims must not upload again')
      },
    })
    assert.deepEqual(
      await service.createMembershipInvitationCode({ appId: 'app-1', identityKey: 'identity' }),
      {
        codeUrl: 'cloud://env.test/existing-code.png',
        expiresAt: '2026-09-23T00:00:00.000Z',
      },
    )
  })

  it('records the guest invitation relationship only from a valid member invitation', async () => {
    const invitationSecret = 'membership-invitation-secret-with-more-than-32-characters'
    const inviter = '20000000-0000-4000-8000-000000000001'
    const guest = '30000000-0000-4000-8000-000000000001'
    const token = createMembershipInvitation({
      appId: 'app-1',
      inviterUserId: inviter,
      expiresAt: new Date('2026-09-23T00:00:00.000Z'),
    }, invitationSecret)
    let captured
    const service = createCommerceService({
      catalogStage: 'TEST',
      invitationSecret,
      now: () => new Date('2026-08-24T00:00:00.000Z'),
      repository: {
        async recordMembershipInvitationGuest(caller, input) {
          captured = { caller, input }
          return { recorded: true, inviterUserId: input.inviterUserId }
        },
      },
    })

    // MIW-27 第二轮：受邀嘉宾进入会员页即上报邀请凭证，关系与幂等由服务端落库。
    assert.deepEqual(
      await service.recordMembershipInvitationGuest({ appId: 'app-1', userId: guest }, { invitationToken: token }),
      { recorded: true, inviterUserId: inviter },
    )
    assert.equal(captured.caller.userId, guest)
    assert.equal(captured.input.inviterUserId, inviter)
    assert.match(captured.input.sourceTokenHash, /^[0-9a-f]{64}$/)
    assert.equal(captured.input.capturedAt, '2026-08-24T00:00:00.000Z')

    // 自己邀请自己、缺少凭证：在触达存储前直接拒绝。
    await assert.rejects(
      () => service.recordMembershipInvitationGuest({ appId: 'app-1', userId: inviter }, { invitationToken: token }),
      /MEMBERSHIP_INVITATION_INVALID/,
    )
    await assert.rejects(
      () => service.recordMembershipInvitationGuest({ appId: 'app-1', userId: guest }, {}),
      /MEMBERSHIP_INVITATION_INVALID/,
    )
    assert.equal(captured.caller.userId, guest)
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
