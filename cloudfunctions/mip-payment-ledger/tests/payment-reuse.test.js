'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const { getReusablePayment, markPaymentCreated } = require('../domain/ledger')

const orderId = '10000000-0000-4000-8000-000000000001'
const issuedPayment = {
  timeStamp: '1777000000',
  nonceStr: 'provider-nonce',
  package: 'prepay_id=provider-prepay',
  signType: 'RSA',
  paySign: 'provider-signature',
}
const storedPaymentJson = JSON.stringify({ merchantId: '1739928668', payment: issuedPayment })

function order(overrides = {}) {
  return {
    id: orderId,
    app_id: 'app-1',
    user_id: '20000000-0000-4000-8000-000000000001',
    order_type: 'EVENT',
    merchant_order_no: 'MIPEVENT100',
    amount_cents: 9900,
    currency: 'CNY',
    status: 'PAYMENT_CREATED',
    version: 2,
    ...overrides,
  }
}

function reuseDatabase({ orderRow, attemptRow } = {}) {
  const calls = []
  return {
    calls,
    async one(sql, params) {
      const normalized = String(sql).replace(/\s+/g, ' ').trim()
      calls.push({ sql: normalized, params })
      if (normalized.includes('FROM mip_payment_attempts')) return attemptRow ?? null
      return orderRow ?? null
    },
  }
}

describe('reusable payment parameters (MIW-123)', () => {
  it('returns the latest in-window issued parameters for the order owner', async () => {
    const now = new Date('2026-10-19T07:30:00.000Z')
    const issuedAt = new Date('2026-10-19T07:19:46.000Z')
    const db = reuseDatabase({
      orderRow: order(),
      attemptRow: { payment_json: storedPaymentJson, provider: 'WECHAT_PAY', created_at: issuedAt },
    })
    const result = await getReusablePayment(db, {
      appId: 'app-1', orderId, identityKey: 'identity-1',
    }, { now: () => now })
    assert.deepEqual(result.payment, issuedPayment)
    assert.equal(result.merchantId, '1739928668')
    assert.equal(result.provider, 'WECHAT_PAY')
    // 窗口过滤以数据库时间为准：110 分钟前之前的签发不可见。
    const cutoff = db.calls[1].params[2]
    assert.equal(cutoff.toISOString(), '2026-10-19T05:40:00.000Z')
  })

  it('returns null unless the order is still awaiting payment', async () => {
    for (const status of ['CREATED', 'PAID', 'CLOSED']) {
      const db = reuseDatabase({ orderRow: order({ status }) })
      assert.equal(await getReusablePayment(db, {
        appId: 'app-1', orderId, identityKey: 'identity-1',
      }), null)
    }
    assert.equal(await getReusablePayment(reuseDatabase(), {
      appId: 'app-1', orderId, identityKey: 'identity-1',
    }), null)
  })

  it('returns null when no in-window issued attempt exists', async () => {
    const db = reuseDatabase({ orderRow: order(), attemptRow: null })
    assert.equal(await getReusablePayment(db, {
      appId: 'app-1', orderId, identityKey: 'identity-1',
    }, { now: () => new Date('2026-10-19T07:30:00.000Z') }), null)
  })

  it('returns null when the stored payload is unusable', async () => {
    const db = reuseDatabase({
      orderRow: order(),
      attemptRow: {
        payment_json: JSON.stringify({ merchantId: '', payment: issuedPayment }),
        provider: 'WECHAT_PAY',
        created_at: new Date('2026-10-19T07:19:46.000Z'),
      },
    })
    assert.equal(await getReusablePayment(db, {
      appId: 'app-1', orderId, identityKey: 'identity-1',
    }, { now: () => new Date('2026-10-19T07:30:00.000Z') }), null)
  })

  it('persists the issued parameters with the signing merchant id', async () => {
    const writes = []
    const db = {
      async one() {
        return order({ status: 'CREATED', version: 1 })
      },
      transaction: work => work({
        async one() {
          return order({ status: 'CREATED', version: 1 })
        },
        async query(sql, params) {
          writes.push({ sql: String(sql).replace(/\s+/g, ' ').trim(), params })
          return { affectedRows: 1 }
        },
      }),
    }
    const result = await markPaymentCreated(db, {
      appId: 'app-1',
      orderId,
      identityKey: 'identity-1',
      merchantOrderNo: 'MIPEVENT100',
      amountCents: 9900,
      currency: 'CNY',
      attemptId: '60000000-0000-4000-8000-000000000001',
      requestHash: 'a'.repeat(64),
      prepayId: 'provider-prepay',
      provider: 'WECHAT_PAY',
      merchantId: '1739928668',
      payment: issuedPayment,
    })
    assert.equal(result.status, 'PAYMENT_CREATED')
    const insert = writes.find(({ sql }) => sql.includes('INSERT INTO mip_payment_attempts'))
    assert.ok(insert, 'attempt insert expected')
    assert.equal(insert.params[5], storedPaymentJson)
  })

  it('refuses to persist malformed payment parameters', async () => {
    const db = {
      async one() { return order({ status: 'CREATED', version: 1 }) },
      transaction: async () => {
        throw new Error('must not open a transaction')
      },
    }
    await assert.rejects(() => markPaymentCreated(db, {
      appId: 'app-1',
      orderId,
      identityKey: 'identity-1',
      merchantOrderNo: 'MIPEVENT100',
      amountCents: 9900,
      currency: 'CNY',
      attemptId: '60000000-0000-4000-8000-000000000001',
      requestHash: 'a'.repeat(64),
      prepayId: 'provider-prepay',
      provider: 'WECHAT_PAY',
      merchantId: '1739928668',
      payment: { ...issuedPayment, paySign: '' },
    }), /PAYMENT_PARAMS_INVALID/)
  })
})
