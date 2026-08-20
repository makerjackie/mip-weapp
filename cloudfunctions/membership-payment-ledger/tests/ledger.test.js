'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const {
  applyRefundCallback,
  assertPaymentMatches,
  confirmRefundManually,
  convergeMemberFreeRegistrationsOnRefund,
  markRefundCreated,
  markRefundFailed,
  recomputeEntitlement,
} = require('../domain/ledger')

describe('payment ledger invariants', () => {
  const order = {
    user_id: 'openid-1',
    out_trade_no: 'MORDER123',
    amount_cents: 10,
    currency: 'CNY',
  }
  const exact = {
    userId: 'openid-1',
    outTradeNo: 'MORDER123',
    amountCents: 10,
    currency: 'CNY',
  }

  it('rejects identity, amount, currency, and merchant-order mismatches', () => {
    assert.doesNotThrow(() => assertPaymentMatches(order, exact))
    assert.throws(() => assertPaymentMatches(order, { ...exact, userId: 'other' }), /PAYER_MISMATCH/)
    assert.throws(() => assertPaymentMatches(order, { ...exact, amountCents: 1 }), /AMOUNT_MISMATCH/)
    assert.throws(() => assertPaymentMatches(order, { ...exact, currency: 'USD' }), /CURRENCY_MISMATCH/)
    assert.throws(() => assertPaymentMatches(order, { ...exact, outTradeNo: 'OTHER' }), /OUT_TRADE_NO_MISMATCH/)
  })

  it('rebuilds entitlement from remaining paid orders after a refund', async () => {
    const writes = []
    const tx = {
      async query(sql) {
        if (sql.includes('SELECT id, paid_at')) {
          return [
            { id: 'o1', paid_at: new Date('2026-01-01T00:00:00Z'), duration_days: 30 },
            { id: 'o2', paid_at: new Date('2026-01-10T00:00:00Z'), duration_days: 30 },
          ]
        }
        writes.push(sql)
        return { affectedRows: 1 }
      },
    }
    const result = await recomputeEntitlement(tx, 'app', 'user')
    assert.equal(result.sourceOrderId, 'o2')
    assert.equal(result.expiresAt.toISOString(), '2026-03-02T00:00:00.000Z')
    assert.equal(writes.length, 1)
  })

  it('records an externally confirmed refund without inventing a provider refund id', async () => {
    const writes = []
    const tx = {
      async one(sql) {
        if (sql.includes('FROM member_refunds')) {
          return { id: 'refund-1', order_id: 'order-1', status: 'REFUND_CREATED', amount_cents: 10 }
        }
        if (sql.includes('FROM member_orders')) {
          return {
            id: 'order-1',
            user_id: 'user-1',
            status: 'REFUND_PENDING',
            amount_cents: 10,
            order_type: 'MEMBERSHIP',
          }
        }
        return null
      },
      async query(sql, values) {
        if (sql.includes('SELECT id, paid_at')) return []
        if (sql.includes('FROM member_registrations') && sql.includes('member_free')) return []
        writes.push([sql, values])
        return { affectedRows: 1 }
      },
    }
    // Entitlement probe for converge (no remaining active membership).
    const originalOne = tx.one.bind(tx)
    tx.one = async (sql) => {
      if (sql.includes('FROM member_entitlements')) {
        return { id: 'ent-1', status: 'REVOKED', expires_at: new Date('2020-01-01T00:00:00Z') }
      }
      return originalOne(sql)
    }
    const db = { transaction: callback => callback(tx) }
    await confirmRefundManually(db, {
      appId: 'app-1',
      refundId: 'refund-1',
      operatorId: 'owner-confirmation',
      reason: 'WeChat refund receipt verified by the owner',
    })
    assert.equal(writes.some(([sql]) => sql.includes("status = 'REFUNDED'")), true)
    assert.equal(writes.some(([sql]) => sql.includes('REFUND_MANUALLY_CONFIRMED')), true)
    assert.equal(writes.some(([sql]) => sql.includes('refund_id =')), false)
  })
})

describe('member_free registration convergence on membership refund', () => {
  function createRefundTx({
    refundStatus = 'REFUND_CREATED',
    orderStatus = 'REFUND_PENDING',
    orderType = 'MEMBERSHIP',
    alreadyRefunded = false,
    registrations = [],
    // After recompute, remaining ACTIVE entitlement skips seat cancel (partial refund).
    remainingEntitlement = null,
  } = {}) {
    const writes = []
    let refund = {
      id: 'refund-1',
      order_id: 'order-1',
      out_trade_no: 'MORDER123',
      out_refund_no: 'RREFUND1',
      status: alreadyRefunded ? 'REFUNDED' : refundStatus,
      amount_cents: 10,
    }
    let order = {
      id: 'order-1',
      user_id: 'user-1',
      status: alreadyRefunded ? 'REFUNDED' : orderStatus,
      amount_cents: 10,
      order_type: orderType,
    }
    const regState = registrations.map(item => ({ ...item }))

    const tx = {
      async one(sql) {
        if (sql.includes('FROM member_refunds')) return refund
        if (sql.includes('FROM member_orders')) return order
        if (sql.includes('FROM member_entitlements')) return remainingEntitlement
        if (sql.includes('FROM member_registrations') && orderType === 'EVENT') {
          return regState[0] || null
        }
        return null
      },
      async query(sql, values) {
        if (sql.includes('SELECT id, paid_at')) return []
        if (sql.includes('FROM member_registrations') && sql.includes('member_free') && sql.includes('FOR UPDATE')) {
          // Only REGISTERED future rows are returned by the real query.
          return regState.filter(item => item.status === 'REGISTERED')
        }
        if (
          sql.includes('UPDATE member_registrations')
          && sql.includes("status = 'CANCELLED'")
          && sql.includes("status = 'CANCELLATION_PENDING'")
        ) {
          const target = regState.find(item => item.id === values[1])
          if (!target || target.status !== 'CANCELLATION_PENDING') {
            return { affectedRows: 0 }
          }
          target.status = 'CANCELLED'
          target.version = Number(target.version) + 1
          writes.push({ kind: 'event-cancel', sql, values })
          return { affectedRows: 1 }
        }
        if (sql.includes('UPDATE member_registrations') && sql.includes("status = 'CANCELLED'")) {
          const regId = values[1]
          const target = regState.find(item => item.id === regId)
          if (target && target.status === 'REGISTERED') {
            target.status = 'CANCELLED'
            target.version = Number(target.version) + 1
            target.cancelled_by_type = 'SYSTEM'
            target.cancellation_reason = values[0]
          }
          writes.push({ kind: 'cancel', sql, values })
          return { affectedRows: 1 }
        }
        if (sql.includes('REGISTRATION_CANCELLED_ON_MEMBERSHIP_REFUND')) {
          writes.push({ kind: 'reg-audit', sql, values })
          return { affectedRows: 1 }
        }
        if (sql.includes("status = 'REFUNDED'") || sql.includes('REFUND_CONFIRMED') || sql.includes('REFUND_MANUALLY_CONFIRMED')
          || sql.includes('member_entitlements') || sql.includes('refund_id =')) {
          if (sql.includes('UPDATE member_refunds') && sql.includes("status = 'REFUNDED'")) {
            refund = { ...refund, status: 'REFUNDED' }
          }
          if (sql.includes('UPDATE member_orders') && sql.includes("status = 'REFUNDED'")) {
            order = { ...order, status: 'REFUNDED' }
          }
          writes.push({ kind: 'ledger', sql, values })
          return { affectedRows: 1 }
        }
        writes.push({ kind: 'other', sql, values })
        return { affectedRows: 1 }
      },
    }

    return {
      db: { transaction: callback => callback(tx) },
      writes,
      regState,
      getOrder: () => order,
      getRefund: () => refund,
    }
  }

  it('applyRefundCallback cancels future REGISTERED member_free with full metadata + audit', async () => {
    const { db, writes, regState } = createRefundTx({
      refundStatus: 'REFUND_PENDING',
      registrations: [
        { id: 'reg-future', version: 2, event_id: 'event-future', status: 'REGISTERED' },
      ],
    })

    await applyRefundCallback(db, {
      appId: 'app-1',
      outTradeNo: 'MORDER123',
      outRefundNo: 'RREFUND1',
      refundId: 'wx-refund-1',
      refundAmountCents: 10,
    })

    const cancel = writes.find(item => item.kind === 'cancel')
    assert.ok(cancel, 'expected registration cancel UPDATE')
    assert.match(cancel.sql, /cancelled_at = UTC_TIMESTAMP\(3\)/)
    assert.match(cancel.sql, /cancelled_by_type = 'SYSTEM'/)
    assert.match(cancel.sql, /cancellation_reason = \?/)
    assert.match(cancel.sql, /version = version \+ 1/)
    assert.equal(cancel.values[0], 'MEMBERSHIP_REFUNDED')
    assert.equal(cancel.values[1], 'reg-future')

    const audit = writes.find(item => item.kind === 'reg-audit')
    assert.ok(audit, 'expected registration cancel audit')
    assert.equal(audit.values[1], 'reg-future')
    const metadata = JSON.parse(audit.values[2])
    assert.deepEqual(metadata, {
      from: 'REGISTERED',
      to: 'CANCELLED',
      version: 3,
      eventId: 'event-future',
      orderId: 'order-1',
    })

    assert.equal(regState[0].status, 'CANCELLED')
    assert.equal(regState[0].version, 3)
    assert.equal(regState[0].cancellation_reason, 'MEMBERSHIP_REFUNDED')
  })

  it('applyRefundCallback does not touch ATTENDED member_free registrations', async () => {
    const { db, writes, regState } = createRefundTx({
      refundStatus: 'REFUND_PENDING',
      // Fake SELECT only returns REGISTERED; ATTENDED would not appear.
      registrations: [
        { id: 'reg-attended', version: 1, event_id: 'event-past', status: 'ATTENDED' },
      ],
    })

    await applyRefundCallback(db, {
      appId: 'app-1',
      outTradeNo: 'MORDER123',
      outRefundNo: 'RREFUND1',
      refundId: 'wx-refund-1',
      refundAmountCents: 10,
    })

    assert.equal(writes.filter(item => item.kind === 'cancel').length, 0)
    assert.equal(writes.filter(item => item.kind === 'reg-audit').length, 0)
    assert.equal(regState[0].status, 'ATTENDED')
    assert.equal(regState[0].version, 1)
  })

  it('second applyRefundCallback is idempotent and does not double-cancel', async () => {
    const fixture = createRefundTx({
      refundStatus: 'REFUND_PENDING',
      registrations: [
        { id: 'reg-future', version: 1, event_id: 'event-future', status: 'REGISTERED' },
      ],
    })

    await applyRefundCallback(fixture.db, {
      appId: 'app-1',
      outTradeNo: 'MORDER123',
      outRefundNo: 'RREFUND1',
      refundId: 'wx-refund-1',
      refundAmountCents: 10,
    })
    const cancelCountAfterFirst = fixture.writes.filter(item => item.kind === 'cancel').length
    assert.equal(cancelCountAfterFirst, 1)
    assert.equal(fixture.regState[0].version, 2)

    // Simulate already-REFUNDED early return path.
    const second = createRefundTx({
      alreadyRefunded: true,
      registrations: [
        { id: 'reg-future', version: 2, event_id: 'event-future', status: 'CANCELLED' },
      ],
    })
    await applyRefundCallback(second.db, {
      appId: 'app-1',
      outTradeNo: 'MORDER123',
      outRefundNo: 'RREFUND1',
      refundId: 'wx-refund-1',
      refundAmountCents: 10,
    })
    assert.equal(second.writes.filter(item => item.kind === 'cancel').length, 0)
    assert.equal(second.writes.filter(item => item.kind === 'reg-audit').length, 0)
    assert.equal(second.regState[0].version, 2)
    assert.equal(second.regState[0].status, 'CANCELLED')
  })

  it('confirmRefundManually uses the same member_free convergence helper', async () => {
    const { db, writes, regState } = createRefundTx({
      refundStatus: 'REFUND_CREATED',
      registrations: [
        { id: 'reg-manual', version: 4, event_id: 'event-2', status: 'REGISTERED' },
      ],
    })

    await confirmRefundManually(db, {
      appId: 'app-1',
      refundId: 'refund-1',
      operatorId: 'owner-1',
      reason: 'External provider receipt verified',
    })

    assert.equal(writes.filter(item => item.kind === 'cancel').length, 1)
    assert.equal(writes.filter(item => item.kind === 'reg-audit').length, 1)
    assert.equal(regState[0].status, 'CANCELLED')
    assert.equal(regState[0].version, 5)
    assert.equal(writes.some(item => item.kind === 'ledger' && item.sql.includes('REFUND_MANUALLY_CONFIRMED')), true)
  })

  it('convergeMemberFreeRegistrationsOnRefund only cancels REGISTERED rows', async () => {
    const writes = []
    const tx = {
      async one(sql) {
        if (sql.includes('FROM member_entitlements')) {
          return { id: 'ent-1', status: 'REVOKED', expires_at: new Date('2020-01-01T00:00:00Z') }
        }
        return null
      },
      async query(sql, values) {
        if (sql.includes('FROM member_registrations') && sql.includes('FOR UPDATE')) {
          return [
            { id: 'reg-1', version: 1, event_id: 'ev-1' },
          ]
        }
        writes.push([sql, values])
        return { affectedRows: 1 }
      },
    }

    await convergeMemberFreeRegistrationsOnRefund(tx, {
      appId: 'app-1',
      userId: 'user-1',
      orderId: 'order-1',
      reason: 'MEMBERSHIP_REFUNDED',
    })

    assert.equal(writes.length, 2)
    assert.match(writes[0][0], /cancelled_by_type = 'SYSTEM'/)
    assert.match(writes[1][0], /REGISTRATION_CANCELLED_ON_MEMBERSHIP_REFUND/)
  })

  it('skips seat cancel when remaining entitlement is still ACTIVE', async () => {
    const { db, writes, regState } = createRefundTx({
      refundStatus: 'REFUND_PENDING',
      remainingEntitlement: {
        id: 'ent-active',
        status: 'ACTIVE',
        expires_at: new Date(Date.now() + 7 * 86400000),
      },
      registrations: [
        { id: 'reg-future', version: 1, event_id: 'event-future', status: 'REGISTERED' },
      ],
    })

    await applyRefundCallback(db, {
      appId: 'app-1',
      outTradeNo: 'MORDER123',
      outRefundNo: 'RREFUND1',
      refundId: 'wx-refund-1',
      refundAmountCents: 10,
    })

    assert.equal(writes.filter(item => item.kind === 'cancel').length, 0)
    assert.equal(regState[0].status, 'REGISTERED')
    assert.equal(regState[0].version, 1)
  })

  it('converges an event registration only through its paid cancellation state', async () => {
    const { db, writes, regState } = createRefundTx({
      refundStatus: 'REFUND_PENDING',
      orderType: 'EVENT',
      registrations: [
        { id: 'reg-future', version: 1, event_id: 'event-future', status: 'CANCELLATION_PENDING' },
      ],
    })

    await applyRefundCallback(db, {
      appId: 'app-1',
      outTradeNo: 'MORDER123',
      outRefundNo: 'RREFUND1',
      refundId: 'wx-refund-1',
      refundAmountCents: 10,
    })

    assert.equal(writes.filter(item => item.kind === 'cancel').length, 0)
    assert.equal(writes.filter(item => item.kind === 'event-cancel').length, 1)
    assert.equal(regState[0].status, 'CANCELLED')
    assert.equal(regState[0].version, 2)
  })

  it('skips REGISTRATION_CANCELLED audit when cancel UPDATE affectedRows is 0', async () => {
    const writes = []
    const tx = {
      async one(sql) {
        if (sql.includes('FROM member_entitlements')) {
          return { id: 'ent-1', status: 'REVOKED', expires_at: new Date('2020-01-01T00:00:00Z') }
        }
        return null
      },
      async query(sql, values) {
        if (sql.includes('FROM member_registrations') && sql.includes('FOR UPDATE')) {
          return [{ id: 'reg-1', version: 1, event_id: 'ev-1' }]
        }
        if (sql.includes('UPDATE member_registrations') && sql.includes("status = 'CANCELLED'")) {
          writes.push({ kind: 'cancel', sql, values })
          return { affectedRows: 0 }
        }
        if (sql.includes('REGISTRATION_CANCELLED_ON_MEMBERSHIP_REFUND')) {
          writes.push({ kind: 'reg-audit', sql, values })
          return { affectedRows: 1 }
        }
        writes.push({ kind: 'other', sql, values })
        return { affectedRows: 1 }
      },
    }

    await convergeMemberFreeRegistrationsOnRefund(tx, {
      appId: 'app-1',
      userId: 'user-1',
      orderId: 'order-1',
      reason: 'MEMBERSHIP_REFUNDED',
    })

    assert.equal(writes.filter(item => item.kind === 'cancel').length, 1)
    assert.equal(writes.filter(item => item.kind === 'reg-audit').length, 0)
  })
})

describe('refund status UPDATE affectedRows before audit', () => {
  function createStatusConflictTx({ refundStatus = 'REFUND_PENDING', orderStatus = 'REFUND_PENDING', zeroOn } = {}) {
    const writes = []
    const refund = {
      id: 'refund-1',
      order_id: 'order-1',
      out_trade_no: 'MORDER123',
      out_refund_no: 'RREFUND1',
      status: refundStatus,
      amount_cents: 10,
    }
    const order = {
      id: 'order-1',
      user_id: 'user-1',
      status: orderStatus,
      amount_cents: 10,
      order_type: 'MEMBERSHIP',
    }
    const tx = {
      async one(sql) {
        if (sql.includes('FROM member_refunds')) return refund
        if (sql.includes('FROM member_orders')) return order
        if (sql.includes('FROM member_entitlements')) {
          return { id: 'ent-1', status: 'REVOKED', expires_at: new Date('2020-01-01T00:00:00Z') }
        }
        return null
      },
      async query(sql, values) {
        if (sql.includes('SELECT id, paid_at')) return []
        if (sql.includes('FROM member_registrations')) return []
        if (sql.includes('UPDATE member_refunds')) {
          writes.push({ kind: 'refund-update', sql, values })
          return { affectedRows: zeroOn === 'refund' ? 0 : 1 }
        }
        if (sql.includes('UPDATE member_orders')) {
          writes.push({ kind: 'order-update', sql, values })
          return { affectedRows: zeroOn === 'order' ? 0 : 1 }
        }
        if (sql.includes('INSERT INTO member_audit_logs')) {
          writes.push({ kind: 'audit', sql, values })
          return { affectedRows: 1 }
        }
        writes.push({ kind: 'other', sql, values })
        return { affectedRows: 1 }
      },
    }
    return { db: { transaction: callback => callback(tx) }, writes }
  }

  it('applyRefundCallback rejects when order UPDATE affectedRows is 0 and does not audit', async () => {
    const { db, writes } = createStatusConflictTx({ zeroOn: 'order' })
    await assert.rejects(
      () => applyRefundCallback(db, {
        appId: 'app-1',
        outTradeNo: 'MORDER123',
        outRefundNo: 'RREFUND1',
        refundId: 'wx-refund-1',
        refundAmountCents: 10,
      }),
      /ORDER_STATUS_CONFLICT/,
    )
    assert.equal(writes.filter(item => item.kind === 'audit').length, 0)
  })

  it('confirmRefundManually rejects when refund UPDATE affectedRows is 0 and does not audit', async () => {
    const { db, writes } = createStatusConflictTx({ refundStatus: 'REFUND_CREATED', zeroOn: 'refund' })
    await assert.rejects(
      () => confirmRefundManually(db, {
        appId: 'app-1',
        refundId: 'refund-1',
        operatorId: 'owner-1',
        reason: 'External provider receipt verified',
      }),
      /REFUND_INVALID_STATE/,
    )
    assert.equal(writes.filter(item => item.kind === 'audit').length, 0)
  })

  it('markRefundFailed rejects when order UPDATE affectedRows is 0 and does not audit', async () => {
    const { db, writes } = createStatusConflictTx({ zeroOn: 'order' })
    await assert.rejects(
      () => markRefundFailed(db, {
        appId: 'app-1',
        outTradeNo: 'MORDER123',
        outRefundNo: 'RREFUND1',
        reasonCode: 'USER_ABORT',
      }),
      /ORDER_STATUS_CONFLICT/,
    )
    assert.equal(writes.filter(item => item.kind === 'audit').length, 0)
  })

  function createEventRefundFailureTx(eventStatus) {
    const writes = []
    const tx = {
      async one(sql) {
        if (sql.includes('FROM member_refunds')) {
          return {
            id: 'refund-event-1',
            order_id: 'order-event-1',
            out_trade_no: 'EORDER123',
            out_refund_no: 'EREFUND123',
            status: 'REFUND_PENDING',
          }
        }
        if (sql.includes('FROM member_orders')) {
          return {
            id: 'order-event-1',
            product_id: 'event-1',
            order_type: 'EVENT',
            status: 'REFUND_PENDING',
          }
        }
        if (sql.includes('FROM member_events')) {
          return { status: eventStatus }
        }
        return null
      },
      async query(sql, values) {
        writes.push({ sql, values })
        return { affectedRows: 1 }
      },
    }
    return {
      db: { transaction: callback => callback(tx) },
      writes,
    }
  }

  it('markRefundFailed restores an event registration when the event remains active', async () => {
    const { db, writes } = createEventRefundFailureTx('PUBLISHED')
    await markRefundFailed(db, {
      appId: 'app-1',
      outTradeNo: 'EORDER123',
      outRefundNo: 'EREFUND123',
      reasonCode: 'PROVIDER_REJECTED',
    })

    const restore = writes.find(item =>
      item.sql.includes('UPDATE member_registrations')
      && item.sql.includes("status = 'REGISTERED'"))
    assert.ok(restore)
    assert.match(restore.sql, /status = 'CANCELLATION_PENDING'/)
  })

  it('markRefundFailed keeps the registration pending when the event is cancelled', async () => {
    const { db, writes } = createEventRefundFailureTx('CANCELLED')
    await markRefundFailed(db, {
      appId: 'app-1',
      outTradeNo: 'EORDER123',
      outRefundNo: 'EREFUND123',
      reasonCode: 'PROVIDER_REJECTED',
    })

    assert.equal(writes.some(item => item.sql.includes('UPDATE member_registrations')), false)
    assert.equal(writes.some(item => item.sql.includes("'REFUND_FAILED'")), true)
  })

  it('markRefundCreated requires status=REFUND_PENDING and affectedRows===1', async () => {
    const writes = []
    let refundStatus = 'REFUND_PENDING'
    const refund = {
      id: 'refund-1',
      order_id: 'order-1',
      out_trade_no: 'MORDER123',
      out_refund_no: 'RREFUND1',
      get status() {
        return refundStatus
      },
    }
    const tx = {
      async one(sql) {
        if (sql.includes('FROM member_refunds')) return refund
        return null
      },
      async query(sql, values) {
        writes.push({ sql, values })
        if (sql.includes('UPDATE member_refunds') && sql.includes("status = 'REFUND_CREATED'")) {
          assert.match(sql, /WHERE id = \? AND status = 'REFUND_PENDING'/)
          refundStatus = 'REFUND_CREATED'
          return { affectedRows: 1 }
        }
        return { affectedRows: 1 }
      },
    }
    const db = { transaction: callback => callback(tx) }
    await markRefundCreated(db, {
      appId: 'app-1',
      outTradeNo: 'MORDER123',
      outRefundNo: 'RREFUND1',
    })
    assert.equal(writes.length, 1)
    assert.match(writes[0].sql, /AND status = 'REFUND_PENDING'/)
  })

  it('markRefundCreated fails closed when concurrent UPDATE affectedRows is 0', async () => {
    const writes = []
    const refund = {
      id: 'refund-1',
      order_id: 'order-1',
      out_trade_no: 'MORDER123',
      out_refund_no: 'RREFUND1',
      status: 'REFUND_PENDING',
    }
    const tx = {
      async one(sql) {
        if (sql.includes('FROM member_refunds')) return refund
        return null
      },
      async query(sql, values) {
        writes.push({ sql, values })
        if (sql.includes('UPDATE member_refunds')) {
          assert.match(sql, /AND status = 'REFUND_PENDING'/)
          return { affectedRows: 0 }
        }
        return { affectedRows: 1 }
      },
    }
    const db = { transaction: callback => callback(tx) }
    await assert.rejects(
      () => markRefundCreated(db, {
        appId: 'app-1',
        outTradeNo: 'MORDER123',
        outRefundNo: 'RREFUND1',
      }),
      /REFUND_STATUS_CONFLICT/,
    )
    assert.equal(writes.length, 1)
  })

  it('markRefundCreated is idempotent for already REFUND_CREATED without UPDATE', async () => {
    const writes = []
    const tx = {
      async one() {
        return {
          id: 'refund-1',
          out_trade_no: 'MORDER123',
          out_refund_no: 'RREFUND1',
          status: 'REFUND_CREATED',
        }
      },
      async query(sql, values) {
        writes.push({ sql, values })
        return { affectedRows: 1 }
      },
    }
    const db = { transaction: callback => callback(tx) }
    await markRefundCreated(db, {
      appId: 'app-1',
      outTradeNo: 'MORDER123',
      outRefundNo: 'RREFUND1',
    })
    assert.equal(writes.length, 0)
  })
})
