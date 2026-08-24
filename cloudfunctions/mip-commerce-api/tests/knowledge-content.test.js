'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const { contentRefundableAmount } = require('../domain/repository')
const { createCommerceService } = require('../domain/service')

const contentId = '20000000-0000-4000-8000-000000000001'

function ids() {
  let value = 0
  return () => `10000000-0000-4000-8000-${String(++value).padStart(12, '0')}`
}

describe('knowledge content commerce', () => {
  it('does not create a pretend checkout while payment is disabled', async () => {
    const service = createCommerceService({
      catalogStage: 'TEST',
      paymentMode: 'disabled',
      repository: {},
    })
    assert.throws(() => service.createKnowledgeCheckout({ appId: 'app' }, {
      contentId,
      idempotencyKey: 'knowledge-checkout-1',
    }), /PAYMENT_UNAVAILABLE/)
  })

  it('passes only content intent and server catalog stage to the repository', async () => {
    let captured
    const service = createCommerceService({
      catalogStage: 'TEST',
      paymentMode: 'test',
      createId: ids(),
      now: () => new Date('2026-08-24T00:00:00.000Z'),
      repository: {
        async createKnowledgeCheckout(caller, input, generated) {
          captured = { caller, input, generated }
          return { id: generated.orderId }
        },
      },
    })
    await service.createKnowledgeCheckout({ appId: 'app', identityKey: 'identity' }, {
      contentId,
      idempotencyKey: 'knowledge-checkout-1',
      amountCents: 1,
    })
    assert.deepEqual(captured.input, {
      contentId,
      idempotencyKey: 'knowledge-checkout-1',
      catalogStage: 'TEST',
    })
    assert.match(captured.generated.merchantOrderNo, /^MIPK/)
  })

  it('uses the immutable order snapshot and first-access fact for refunds', async () => {
    const calls = []
    const tx = {
      async one(sql, params) {
        calls.push({ sql, params })
        return { first_accessed_at: null }
      },
    }
    const order = {
      id: '30000000-0000-4000-8000-000000000001',
      status: 'PAID',
      amount_cents: 990,
      paid_at: new Date(Date.now() - 60_000),
      product_snapshot_json: JSON.stringify({ refundPolicy: 'BEFORE_ACCESS', refundWindowHours: 24 }),
    }
    assert.equal(await contentRefundableAmount(tx, 'app', order, 0), 990)
    assert.doesNotMatch(calls[0].sql, /mip_knowledge_products/)
    await assert.rejects(() => contentRefundableAmount(tx, 'app', {
      ...order,
      product_snapshot_json: JSON.stringify({ refundPolicy: 'NON_REFUNDABLE', refundWindowHours: 24 }),
    }, 0), /CONTENT_REFUND_NOT_AVAILABLE/)
  })

  it('reuses an existing payable content order before inserting another one', () => {
    const source = fs.readFileSync(path.join(__dirname, '../domain/repository.js'), 'utf8')
    const checkout = source.slice(
      source.indexOf('async function createKnowledgeCheckout'),
      source.indexOf('async function listOrders'),
    )
    const pendingLookup = checkout.indexOf("status IN ('CREATED', 'PAYMENT_CREATED')")
    const pendingReturn = checkout.indexOf('return orderDto(pendingOrder, 0)')
    const insert = checkout.indexOf('INSERT INTO mip_orders', pendingLookup)
    assert.ok(pendingLookup > checkout.indexOf('assertFullAccessUser'))
    assert.ok(pendingReturn > pendingLookup)
    assert.ok(insert > pendingReturn)
  })
})
