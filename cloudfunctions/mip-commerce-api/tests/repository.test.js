'use strict'

const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const path = require('node:path')
const { describe, it } = require('node:test')
const {
  assertSameAttribution,
  createCommerceRepository,
  orderDto,
  orderPriceItems,
  orderServiceStatus,
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

describe('event order projection', () => {
  it('rejects the generic refund path for event orders before creating a refund fact', async () => {
    const writes = []
    const repository = createCommerceRepository({
      async transaction(work) {
        return work({
          async one(sql) {
            if (sql.includes('FROM mip_user_identities')) return { user_id: buyerUserId }
            if (sql.includes('FROM mip_refunds refund')) return null
            if (sql.includes('FROM mip_orders')) {
              return {
                id: '50000000-0000-4000-8000-000000000001',
                user_id: buyerUserId,
                order_type: 'EVENT',
                status: 'PAID',
                version: 2,
              }
            }
            return null
          },
          async query(sql) { writes.push(sql); return { affectedRows: 1 } },
        })
      },
    })
    await assert.rejects(
      repository.requestRefund({ appId: 'app-1', identityKey: 'identity-1' }, {
        orderId: '50000000-0000-4000-8000-000000000001',
        idempotencyKey: 'event-refund',
      }, {
        refundId: '70000000-0000-4000-8000-000000000001',
        merchantRefundNo: 'MIPR70000000000040008000000000000001',
        outboxId: '80000000-0000-4000-8000-000000000001',
      }, () => 9900),
      /EVENT_REFUND_REQUIRES_CANCELLATION/,
    )
    assert.equal(writes.length, 0)
  })

  it('returns event presentation facts and only an exact snapshot price breakdown', () => {
    const row = {
      id: '50000000-0000-4000-8000-000000000001',
      user_id: buyerUserId,
      order_type: 'EVENT',
      resource_id: '60000000-0000-4000-8000-000000000001',
      amount_cents: 9900,
      currency: 'CNY',
      status: 'PAID',
      version: 2,
      product_snapshot_json: JSON.stringify({
        title: '活动下单快照标题',
        startsAt: '2026-09-10T10:00:00.000Z',
        endsAt: '2026-09-10T12:00:00.000Z',
        cityName: '深圳',
        venueName: 'MIP 空间',
        address: '南山区示例路 1 号',
        priceItems: [{ label: '活动报名', amountCents: 9900 }],
      }),
      event_title: '活动当前标题',
      event_cover_file_id: 'cloud://env.test/event.jpg',
      registration_status: 'REGISTERED',
      event_has_ended: false,
    }
    const result = orderDto(row, 0)
    assert.equal(result.serviceStatus, 'PENDING_USE')
    assert.deepEqual(result.event, {
      title: '活动下单快照标题',
      coverUrl: 'cloud://env.test/event.jpg',
      startsAt: '2026-09-10T10:00:00.000Z',
      endsAt: '2026-09-10T12:00:00.000Z',
      cityName: '深圳',
      venueName: 'MIP 空间',
      address: '南山区示例路 1 号',
    })
    assert.deepEqual(result.priceItems, [{ label: '活动报名', amountCents: 9900 }])
  })

  it('does not turn a legacy total price into invented line items', () => {
    assert.deepEqual(orderPriceItems({ priceCents: 9900 }, 9900), [])
    assert.deepEqual(orderPriceItems({
      priceItems: [{ label: '活动报名', amountCents: 8900 }],
    }, 9900), [])
  })

  it('joins the current event and cover while preserving ownership scoping', async () => {
    let query
    const repository = createCommerceRepository({
      async query(sql, params) {
        query = { sql, params }
        return [{
          id: '50000000-0000-4000-8000-000000000001',
          user_id: buyerUserId,
          order_type: 'EVENT',
          resource_id: '60000000-0000-4000-8000-000000000001',
          amount_cents: 9900,
          refunded_amount_cents: 0,
          currency: 'CNY',
          status: 'PAID',
          service_status: 'PENDING_USE',
          version: 2,
          product_snapshot_json: JSON.stringify({ title: '活动订单' }),
          event_cover_file_id: 'cloud://env.test/event.jpg',
        }]
      },
    })
    const result = await repository.getOrder({ appId: 'wx-app', identityKey: 'identity-1' }, 'order-1')
    assert.equal(result.event.coverUrl, 'cloud://env.test/event.jpg')
    assert.equal(result.serviceStatus, 'PENDING_USE')
    assert.match(query.sql, /LEFT JOIN mip_events event_row/)
    assert.match(query.sql, /LEFT JOIN mip_media_assets event_cover/)
    assert.match(query.sql, /event_registration\.app_id = o\.app_id AND event_registration\.order_id = o\.id/)
    assert.match(query.sql, /membership_entitlement\.app_id = o\.app_id AND membership_entitlement\.order_id = o\.id/)
    assert.match(query.sql, /knowledge_entitlement\.app_id = o\.app_id AND knowledge_entitlement\.order_id = o\.id/)
    assert.match(query.sql, /o\.status IN \('PARTIALLY_REFUNDED', 'REFUNDED'\) THEN 'REFUNDED'/)
    assert.match(query.sql, /o\.status <> 'PAID' THEN 'UNAVAILABLE'/)
    assert.match(query.sql, /event_registration\.status = 'ATTENDED' THEN 'COMPLETED'/)
    assert.match(query.sql, /event_registration\.status = 'REGISTERED'/)
    assert.match(query.sql, /event_row\.status = 'ENDED'/)
    assert.match(query.sql, /event_row\.status = 'PUBLISHED' AND event_row\.ends_at <= UTC_TIMESTAMP\(3\)/)
    assert.match(query.sql, /event_row\.status = 'PUBLISHED'[\s\S]*event_row\.ends_at > UTC_TIMESTAMP\(3\)[\s\S]*THEN 'PENDING_USE'/)
    assert.match(query.sql, /WHEN o\.order_type = 'EVENT' THEN 'UNAVAILABLE'/)
    assert.match(query.sql, /membership_entitlement\.starts_at > UTC_TIMESTAMP\(3\)/)
    assert.match(query.sql, /knowledge_entitlement\.first_accessed_at IS NULL/)
    assert.match(query.sql, /i\.identity_key = \?/)
    assert.deepEqual(query.params, ['identity-1', 'wx-app', 'order-1'])
  })

  it('keeps payment state separate from the server service projection', () => {
    for (const serviceStatus of ['PENDING_USE', 'COMPLETED', 'REFUNDED', 'UNAVAILABLE']) {
      assert.equal(orderServiceStatus({ service_status: serviceStatus }), serviceStatus)
    }
    assert.equal(orderServiceStatus({ status: 'REFUNDED', order_type: 'EVENT' }), 'REFUNDED')
    assert.equal(orderServiceStatus({ status: 'PARTIALLY_REFUNDED', order_type: 'MEMBERSHIP' }), 'REFUNDED')
    assert.equal(orderServiceStatus({ status: 'REFUND_PENDING', order_type: 'CONTENT' }), 'UNAVAILABLE')
    assert.equal(orderServiceStatus({ status: 'PAID', order_type: 'EVENT', registration_status: 'ATTENDED' }), 'COMPLETED')
    assert.equal(orderServiceStatus({
      status: 'PAID',
      order_type: 'EVENT',
      registration_status: 'REGISTERED',
      event_has_ended: true,
    }), 'COMPLETED')
    assert.equal(orderServiceStatus({
      status: 'PAID',
      order_type: 'EVENT',
      registration_status: 'REGISTERED',
      event_has_ended: false,
    }), 'PENDING_USE')
    for (const registrationStatus of [undefined, 'PAYMENT_PENDING', 'CANCELLATION_PENDING', 'CANCELLED', 'REJECTED']) {
      assert.equal(orderServiceStatus({
        status: 'PAID',
        order_type: 'EVENT',
        registration_status: registrationStatus,
        event_has_ended: true,
      }), 'UNAVAILABLE')
    }
  })

  it('joins only service facts that are unique per app and order', () => {
    const migrations = [
      ['002_events.sql', /UNIQUE KEY mip_event_registrations_order_uk \(app_id, order_id\)/],
      ['004_membership_commerce.sql', /UNIQUE KEY mip_membership_entitlements_order_uk \(app_id, order_id\)/],
      ['036_mip_knowledge_content.sql', /UNIQUE KEY mip_knowledge_entitlements_order_uk \(app_id, order_id\)/],
    ]
    for (const [file, uniqueConstraint] of migrations) {
      const sql = readFileSync(path.resolve(__dirname, '../../../database/mysql/mip', file), 'utf8')
      assert.match(sql, uniqueConstraint)
    }
  })
})
