'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const { getPayableOrder, issueKnowledgeEntitlement } = require('../domain/ledger')

const order = {
  id: '10000000-0000-4000-8000-000000000001',
  user_id: '20000000-0000-4000-8000-000000000001',
  resource_id: '30000000-0000-4000-8000-000000000001',
  order_type: 'CONTENT',
  merchant_order_no: 'MIPK100',
  amount_cents: 990,
  currency: 'CNY',
  status: 'PAYMENT_CREATED',
  version: 2,
  content_catalog_stage: 'TEST',
  content_product_status: 'ACTIVE',
  content_status: 'PUBLISHED',
  product_snapshot_json: JSON.stringify({
    productId: '40000000-0000-4000-8000-000000000001',
    contentId: '30000000-0000-4000-8000-000000000001',
    name: '单内容解锁',
    priceCents: 990,
    currency: 'CNY',
    unlockDays: 7,
  }),
}

describe('knowledge content payment ledger', () => {
  it('accepts only a published active product in the current payment stage', async () => {
    const result = await getPayableOrder({ one: async () => order }, {
      appId: 'app', orderId: order.id, identityKey: 'identity', paymentMode: 'test',
    })
    assert.equal(result.orderType, 'CONTENT')
    await assert.rejects(() => getPayableOrder({ one: async () => order }, {
      appId: 'app', orderId: order.id, identityKey: 'identity', paymentMode: 'live',
    }), /PAYMENT_MODE_MISMATCH/)
  })

  it('issues the entitlement from the paid order snapshot rather than mutable duration', async () => {
    const writes = []
    const paidAt = new Date('2026-08-24T00:00:00.000Z')
    const tx = {
      async one() {
        return { id: '40000000-0000-4000-8000-000000000001', content_id: order.resource_id }
      },
      async query(sql, params) { writes.push({ sql, params }) },
    }
    await issueKnowledgeEntitlement(tx, 'app', order, paidAt, {
      createId: () => '50000000-0000-4000-8000-000000000001',
    })
    assert.match(writes[0].sql, /mip_knowledge_entitlements/)
    assert.equal(writes[0].params[4], '40000000-0000-4000-8000-000000000001')
    assert.equal(writes[0].params[7].toISOString(), '2026-08-31T00:00:00.000Z')
  })
})
