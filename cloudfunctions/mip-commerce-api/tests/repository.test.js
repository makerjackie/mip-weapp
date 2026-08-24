'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const {
  assertSameAttribution,
  createCommerceRepository,
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

describe('membership benefit projection', () => {
  it('reads the current entitlement and immutable order benefit snapshot for the caller', async () => {
    const calls = []
    const repository = createCommerceRepository({
      async one(sql, params) {
        calls.push({ sql, params })
        return {
          id: '30000000-0000-4000-8000-000000000001',
          status: 'ACTIVE',
          starts_at: '2026-08-01T00:00:00.000Z',
          ends_at: '2026-09-01T00:00:00.000Z',
          membership_ends_at: '2026-10-01T00:00:00.000Z',
          version: 2,
          plan_id: '40000000-0000-4000-8000-000000000001',
          plan_name: '年度会员',
          plan_description: '会员说明',
          benefits_json: '["已修改的权益"]',
          product_snapshot_json: JSON.stringify({ benefits: ['玩家身份', '会员活动权益'] }),
          invitation_source_type: 'USER',
          inviter_nickname: '邀请会员',
          inviter_visibility_json: JSON.stringify({ nickname: true, avatar: true }),
          inviter_avatar_file_id: 'cloud://env.test/avatar.png',
        }
      },
    })
    const result = await repository.getMembershipBenefits({ appId: 'app-1', identityKey: 'identity-1' })
    assert.equal(result.kind, 'PLAYER')
    assert.equal(result.status, 'ACTIVE')
    assert.equal(result.membershipEndsAt, '2026-10-01T00:00:00.000Z')
    assert.deepEqual(result.benefits, [
      { key: 'benefit-1', label: '玩家身份', status: 'ACTIVE' },
      { key: 'benefit-2', label: '会员活动权益', status: 'ACTIVE' },
    ])
    assert.deepEqual(result.invitationAttribution, {
      sourceType: 'USER',
      displayName: '邀请会员',
      avatarUrl: 'cloud://env.test/avatar.png',
    })
    assert.match(calls[0].sql, /mip_membership_entitlements/)
    assert.match(calls[0].sql, /mip_orders/)
    assert.match(calls[0].sql, /mip_membership_attributions/)
    assert.match(calls[0].sql, /e\.starts_at <= UTC_TIMESTAMP\(3\)/)
    assert.deepEqual(calls[0].params, ['app-1', 'identity-1'])
  })

  it('returns a guest fact when no effective entitlement exists', async () => {
    const repository = createCommerceRepository({ one: async () => null })
    assert.deepEqual(
      await repository.getMembershipBenefits({ appId: 'app-1', identityKey: 'identity-1' }),
      { kind: 'GUEST', status: 'NONE', benefits: [] },
    )
  })
})
