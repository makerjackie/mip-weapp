'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const {
  assertMembershipRefundAllowed,
  decideMembershipRefundEligibility,
  evaluateMembershipRefundEligibility,
  orderCoverageWindow,
} = require('../domain/refunds')

describe('decideMembershipRefundEligibility', () => {
  it('blocks only when refund invalidates entitlement and attendance is in coverage', () => {
    assert.deepEqual(decideMembershipRefundEligibility({
      orderType: 'MEMBERSHIP',
      orderStatus: 'PAID',
      hasRefund: false,
      roleCanRefund: true,
      coverage: { start: new Date('2026-01-01'), end: new Date('2026-02-01') },
      remainingActiveWithoutOrder: false,
      attendedInCoverage: true,
    }), {
      canRefund: false,
      refundBlockReason: 'REFUND_BLOCKED_ATTENDED_MEMBER_EVENT',
    })
  })

  it('allows refund when remaining paid membership keeps entitlement active', () => {
    assert.deepEqual(decideMembershipRefundEligibility({
      orderType: 'MEMBERSHIP',
      orderStatus: 'PAID',
      hasRefund: false,
      roleCanRefund: true,
      coverage: { start: new Date('2026-01-01'), end: new Date('2026-02-01') },
      remainingActiveWithoutOrder: true,
      attendedInCoverage: true,
    }), {
      canRefund: true,
      refundBlockReason: null,
    })
  })

  it('allows refund when attendance is outside this order coverage', () => {
    assert.deepEqual(decideMembershipRefundEligibility({
      orderType: 'MEMBERSHIP',
      orderStatus: 'PAID',
      hasRefund: false,
      roleCanRefund: true,
      coverage: { start: new Date('2026-01-01'), end: new Date('2026-02-01') },
      remainingActiveWithoutOrder: false,
      attendedInCoverage: false,
    }), {
      canRefund: true,
      refundBlockReason: null,
    })
  })
})

describe('assertMembershipRefundAllowed', () => {
  it('blocks membership refund when an ATTENDED member_free registration exists (single order)', async () => {
    const tx = {
      async one(sql, params) {
        assert.match(sql, /member_registrations/)
        assert.match(sql, /ATTENDED/)
        assert.match(sql, /member_free = 1/)
        assert.deepEqual(params.slice(0, 2), ['app-1', 'user-1'])
        return { id: 'reg-attended' }
      },
    }

    await assert.rejects(
      () => assertMembershipRefundAllowed(tx, {
        appId: 'app-1',
        userId: 'user-1',
        orderType: 'MEMBERSHIP',
        orderId: 'order-1',
        order: {
          id: 'order-1',
          status: 'PAID',
          // no coverage fields → conservative single-order path
        },
      }),
      /REFUND_BLOCKED_ATTENDED_MEMBER_EVENT/,
    )
  })

  it('allows membership refund when no ATTENDED member_free registration exists', async () => {
    const tx = {
      async one() {
        return null
      },
      async query() {
        return []
      },
    }

    await assert.doesNotReject(() => assertMembershipRefundAllowed(tx, {
      appId: 'app-1',
      userId: 'user-1',
      orderType: 'MEMBERSHIP',
      orderId: 'order-1',
      order: { id: 'order-1', status: 'PAID', paid_at: '2026-01-01', duration_days: 30 },
    }))
  })

  it('skips the gate for non-membership order types', async () => {
    let called = false
    const tx = {
      async one() {
        called = true
        return { id: 'should-not-query' }
      },
    }

    await assertMembershipRefundAllowed(tx, {
      appId: 'app-1',
      userId: 'user-1',
      orderType: 'EVENT',
      orderId: 'order-1',
      order: { id: 'order-1' },
    })
    assert.equal(called, false)
  })

  it('does not permanently block a later order when remaining entitlement covers attendance', async () => {
    const future = new Date(Date.now() + 60 * 86400000)
    const tx = {
      async query(sql) {
        if (/FROM member_orders/i.test(sql)) {
          // Another PAID membership still active after refunding the target order.
          return [{
            id: 'order-keep',
            paid_at: new Date().toISOString(),
            created_at: new Date().toISOString(),
            duration_days: 365,
          }]
        }
        return []
      },
      async one() {
        // Would be attended, but remaining entitlement means no block.
        return { id: 'reg-attended' }
      },
    }

    await assert.doesNotReject(() => assertMembershipRefundAllowed(tx, {
      appId: 'app-1',
      userId: 'user-1',
      orderType: 'MEMBERSHIP',
      orderId: 'order-old',
      order: {
        id: 'order-old',
        status: 'PAID',
        paid_at: '2025-01-01T00:00:00.000Z',
        duration_days: 30,
        entitlement_start: '2025-01-01T00:00:00.000Z',
        entitlement_end: '2025-01-31T00:00:00.000Z',
      },
      now: future,
    }))
  })

  it('blocks only attendance inside the order coverage window', async () => {
    const calls = []
    const tx = {
      async query() {
        return []
      },
      async one(sql, params) {
        calls.push({ sql, params })
        // Coverage-scoped query should run with window bounds.
        if (params.length >= 4) {
          return { id: 'reg-in-window' }
        }
        return null
      },
    }

    await assert.rejects(
      () => assertMembershipRefundAllowed(tx, {
        appId: 'app-1',
        userId: 'user-1',
        orderType: 'MEMBERSHIP',
        orderId: 'order-1',
        order: {
          id: 'order-1',
          status: 'PAID',
          paid_at: '2026-03-01T00:00:00.000Z',
          duration_days: 30,
          entitlement_start: '2026-03-01T00:00:00.000Z',
          entitlement_end: '2026-03-31T00:00:00.000Z',
        },
      }),
      /REFUND_BLOCKED_ATTENDED_MEMBER_EVENT/,
    )
    assert.ok(calls.some(call => call.params.length >= 4))
  })
})

describe('orderCoverageWindow', () => {
  it('prefers entitlement_start/end then paid_at + duration_days', () => {
    const window = orderCoverageWindow({
      entitlement_start: '2026-01-01T00:00:00.000Z',
      entitlement_end: '2026-02-01T00:00:00.000Z',
    })
    assert.equal(window.start.toISOString(), '2026-01-01T00:00:00.000Z')
    assert.equal(window.end.toISOString(), '2026-02-01T00:00:00.000Z')

    const derived = orderCoverageWindow({
      paid_at: '2026-01-01T00:00:00.000Z',
      duration_days: 10,
    })
    assert.equal(derived.end.toISOString(), '2026-01-11T00:00:00.000Z')
  })
})

describe('evaluateMembershipRefundEligibility list/write parity', () => {
  it('returns refundBlockReason for listOrders alignment', async () => {
    const tx = {
      async query() {
        return []
      },
      async one() {
        return { id: 'reg' }
      },
    }
    const decision = await evaluateMembershipRefundEligibility(tx, {
      appId: 'app-1',
      userId: 'user-1',
      orderType: 'MEMBERSHIP',
      orderId: 'order-1',
      order: { id: 'order-1', status: 'PAID' },
      roleCanRefund: true,
      hasRefund: false,
    })
    assert.equal(decision.canRefund, false)
    assert.equal(decision.refundBlockReason, 'REFUND_BLOCKED_ATTENDED_MEMBER_EVENT')
  })
})
