'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const { createAdminPaymentAttemptRepository } = require('../domain/repositories/payment-attempts')

const APP_ID = 'wx-mip'

describe('admin payment attempt persistence adapter', () => {
  it('returns bounded safe rows and binds scope, filters, and stable cursor ordering', async () => {
    let captured
    const database = {
      async query(sql, params) {
        captured = { sql, params }
        return [{
          attempt_id: 'attempt-001', order_id: 'order-001', provider: 'WECHAT_PAY',
          provider_payment_id: 'provider-secret-1234', status: 'FAILED', last_error_code: 'RAW_INTERNAL_ERROR',
          created_at: new Date('2030-08-01T00:00:00Z'), updated_at: new Date('2030-08-01T00:01:00Z'),
          order_type: 'MEMBERSHIP', merchant_order_no: 'MIP-ORDER-0001', amount_cents: 660000,
          currency: 'CNY', nickname: '小明', player_number: 12, membership_plan_name: '年度会员',
          event_title: null, knowledge_title: null,
        }]
      },
    }
    const adapter = createAdminPaymentAttemptRepository(database)
    const page = await adapter.listPaymentAttempts(
      APP_ID,
      { platform: false, branchIds: ['branch-a'], eventIds: [] },
      { query: '12', provider: 'WECHAT_PAY', status: 'FAILED', createdFrom: '', createdTo: '' },
      10,
      { createdAt: '2030-08-02 00:00:00.000', id: 'attempt-002' },
    )
    assert.equal(page.items.length, 1)
    assert.deepEqual(page.items[0], {
      id: 'attempt-001', orderId: 'order-001', orderNumberMasked: 'MIP-…0001', nickname: '小明',
      playerNumber: 12, provider: 'WECHAT_PAY', status: 'FAILED',
      providerPaymentIdMasked: 'prov…1234', requiresAttention: true, orderType: 'MEMBERSHIP',
      orderTitle: '年度会员', amountCents: 660000, currency: 'CNY',
      createdAt: '2030-08-01T00:00:00.000Z', updatedAt: '2030-08-01T00:01:00.000Z',
    })
    assert.equal(page.nextCursor, null)
    assert.match(captured.sql, /FROM mip_payment_attempts attempt/)
    assert.match(captured.sql, /attempt\.app_id = \?/)
    assert.match(captured.sql, /mip_player_lifecycles lifecycle/)
    assert.match(captured.sql, /CAST\(lifecycle\.player_number AS CHAR\)/)
    assert.match(captured.sql, /ORDER BY attempt\.created_at DESC, attempt\.id DESC/)
    assert.equal(captured.params.at(-1), 11)
    assert.doesNotMatch(JSON.stringify(page), /RAW_INTERNAL_ERROR|provider-secret-1234/)
  })

  it('fails closed for non-platform visibility without event scope', async () => {
    let capturedSql = ''
    const adapter = createAdminPaymentAttemptRepository({
      async query(sql) { capturedSql = sql; return [] },
    })
    await adapter.listPaymentAttempts(
      APP_ID,
      { platform: false, branchIds: [], eventIds: [] },
      { query: '', provider: '', status: '', createdFrom: '', createdTo: '' },
      20,
    )
    assert.match(capturedSql, /0 = 1/)
  })
})
