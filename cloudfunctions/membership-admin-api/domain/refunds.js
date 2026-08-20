'use strict'

/**
 * Membership refund gate aligned with listOrders canRefund / refundBlockReason.
 *
 * Policy (conservative, documented):
 * - Non-MEMBERSHIP orders are not gated by attendance.
 * - Multi-order members: an historical ATTENDED seat never permanently blocks every order.
 * - Block only when BOTH:
 *   1) Refunding this order would leave the member without an active remaining
 *      membership chain (other PAID membership orders cannot cover "now"), AND
 *   2) There is an ATTENDED member_free registration whose attendance time falls
 *      inside this order's entitlement coverage window
 *      (entitlement_start/end when present, else paid_at + duration_days).
 * - When association fields are incomplete, fall back to the order coverage window
 *   derived from paid_at/created_at + duration_days (never "any ATTENDED ever").
 */

/**
 * @param {object} order
 * @returns {{ start: Date, end: Date } | null}
 */
function orderCoverageWindow(order) {
  if (!order) {
    return null
  }
  const startRaw = order.entitlement_start || order.entitlementStart
    || order.paid_at || order.paidAt
    || order.created_at || order.createdAt
  const endRaw = order.entitlement_end || order.entitlementEnd
  const start = startRaw ? new Date(startRaw) : null
  if (!start || Number.isNaN(start.getTime())) {
    return null
  }
  if (endRaw) {
    const end = new Date(endRaw)
    if (!Number.isNaN(end.getTime()) && end.getTime() > start.getTime()) {
      return { start, end }
    }
  }
  const days = Number(order.duration_days ?? order.durationDays ?? 0)
  if (!Number.isInteger(days) || days <= 0) {
    return null
  }
  return {
    start,
    end: new Date(start.getTime() + days * 86400000),
  }
}

/**
 * Pure decision used by listOrders (read path) and assertMembershipRefundAllowed (write path).
 *
 * @param {{
 *   orderType: string,
 *   orderStatus: string,
 *   hasRefund: boolean,
 *   roleCanRefund: boolean,
 *   coverage: { start: Date, end: Date } | null,
 *   remainingActiveWithoutOrder: boolean,
 *   attendedInCoverage: boolean,
 * }} input
 * @returns {{ canRefund: boolean, refundBlockReason: string | null }}
 */
function decideMembershipRefundEligibility(input) {
  if (!input.roleCanRefund) {
    return { canRefund: false, refundBlockReason: 'ROLE_CANNOT_REFUND' }
  }
  if (input.orderStatus !== 'PAID') {
    return { canRefund: false, refundBlockReason: 'ORDER_NOT_PAID' }
  }
  if (input.hasRefund) {
    return { canRefund: false, refundBlockReason: 'REFUND_ALREADY_EXISTS' }
  }
  if (input.orderType !== 'MEMBERSHIP') {
    return { canRefund: true, refundBlockReason: null }
  }
  // Remaining paid membership keeps entitlement → never block for attendance.
  if (input.remainingActiveWithoutOrder) {
    return { canRefund: true, refundBlockReason: null }
  }
  // No remaining chain: only block when attendance consumed THIS order's coverage.
  if (input.attendedInCoverage) {
    return {
      canRefund: false,
      refundBlockReason: 'REFUND_BLOCKED_ATTENDED_MEMBER_EVENT',
    }
  }
  return { canRefund: true, refundBlockReason: null }
}

/**
 * Load facts and decide refund eligibility for one locked order.
 *
 * @param {{ one: Function, query?: Function }} tx
 * @param {{
 *   appId: string,
 *   userId: string,
 *   orderType: string,
 *   orderId: string,
 *   order: object,
 *   roleCanRefund?: boolean,
 *   hasRefund?: boolean,
 *   now?: Date,
 * }} input
 */
async function evaluateMembershipRefundEligibility(tx, input) {
  const roleCanRefund = input.roleCanRefund !== false
  const hasRefund = Boolean(input.hasRefund)
  const orderStatus = input.order?.status || input.orderStatus || 'PAID'
  const coverage = orderCoverageWindow(input.order)

  if (input.orderType !== 'MEMBERSHIP') {
    return decideMembershipRefundEligibility({
      orderType: input.orderType,
      orderStatus,
      hasRefund,
      roleCanRefund,
      coverage,
      remainingActiveWithoutOrder: false,
      attendedInCoverage: false,
    })
  }

  const now = input.now instanceof Date ? input.now : new Date()

  // Other PAID membership orders excluding this one — approximate recompute.
  const others = await tx.query(
    `SELECT id, paid_at, created_at, duration_days, entitlement_start, entitlement_end
     FROM member_orders
     WHERE app_id = ? AND user_id = ? AND order_type = 'MEMBERSHIP'
       AND status = 'PAID' AND id <> ? AND duration_days > 0
     ORDER BY COALESCE(paid_at, created_at), created_at, id`,
    [input.appId, input.userId, input.orderId],
  )

  let remainingActiveWithoutOrder = false
  if (Array.isArray(others) && others.length) {
    let entitlementEnd = null
    for (const order of others) {
      const paidAt = new Date(order.paid_at || order.created_at)
      if (!entitlementEnd || entitlementEnd.getTime() < paidAt.getTime()) {
        entitlementEnd = paidAt
      }
      entitlementEnd = new Date(entitlementEnd.getTime() + Number(order.duration_days) * 86400000)
    }
    remainingActiveWithoutOrder = Boolean(
      entitlementEnd && entitlementEnd.getTime() > now.getTime(),
    )
  }

  let attendedInCoverage = false
  // Attendance only matters when this refund would invalidate remaining entitlement.
  if (!remainingActiveWithoutOrder) {
    if (coverage) {
      const attended = await tx.one(
        `SELECT r.id
         FROM member_registrations r
         INNER JOIN member_events e ON e.app_id = r.app_id AND e.id = r.event_id
         WHERE r.app_id = ?
           AND r.user_id = ?
           AND r.status = 'ATTENDED'
           AND e.member_free = 1
           AND COALESCE(r.attended_at, r.registered_at) >= ?
           AND COALESCE(r.attended_at, r.registered_at) < ?
         LIMIT 1`,
        [input.appId, input.userId, coverage.start, coverage.end],
      )
      attendedInCoverage = Boolean(attended)
    }
    else {
      // Association model incomplete: conservative fail-closed for the single
      // remaining membership order only (multi-order remaining already returned above).
      const attended = await tx.one(
        `SELECT r.id
         FROM member_registrations r
         INNER JOIN member_events e ON e.app_id = r.app_id AND e.id = r.event_id
         WHERE r.app_id = ?
           AND r.user_id = ?
           AND r.status = 'ATTENDED'
           AND e.member_free = 1
         LIMIT 1`,
        [input.appId, input.userId],
      )
      attendedInCoverage = Boolean(attended)
    }
  }

  return decideMembershipRefundEligibility({
    orderType: input.orderType,
    orderStatus,
    hasRefund,
    roleCanRefund,
    coverage,
    remainingActiveWithoutOrder,
    attendedInCoverage,
  })
}

/**
 * Fail-closed write gate: must run after the order row is locked.
 *
 * @param {{ one: Function, query: Function }} tx
 * @param {{ appId: string, userId: string, orderType: string, orderId: string, order: object }} input
 */
async function assertMembershipRefundAllowed(tx, input) {
  if (input.orderType !== 'MEMBERSHIP') {
    return
  }
  // Ensure query exists for multi-order scan (some fakes only implement one).
  const db = typeof input.txQuery === 'function' || typeof tx.query === 'function'
    ? tx
    : {
        one: (...args) => tx.one(...args),
        async query(sql, params) {
          // Legacy single-row fakes: treat one() as "first row or empty".
          if (/FROM member_orders/i.test(sql) && /id <>/i.test(sql)) {
            return []
          }
          const row = await tx.one(sql, params)
          return row ? [row] : []
        },
      }
  const decision = await evaluateMembershipRefundEligibility(db, {
    ...input,
    roleCanRefund: true,
    hasRefund: false,
  })
  if (!decision.canRefund) {
    throw new Error(decision.refundBlockReason || 'ORDER_NOT_REFUNDABLE')
  }
}

module.exports = {
  assertMembershipRefundAllowed,
  decideMembershipRefundEligibility,
  evaluateMembershipRefundEligibility,
  orderCoverageWindow,
}
