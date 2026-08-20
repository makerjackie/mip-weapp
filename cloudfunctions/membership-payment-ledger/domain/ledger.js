'use strict'

const { randomUUID } = require('node:crypto')

function assertPaymentMatches(order, value) {
  if (!order) throw new Error('MEMBERSHIP_ORDER_NOT_FOUND')
  if (order.user_id !== value.userId) throw new Error('PAYER_MISMATCH')
  if (order.out_trade_no !== value.outTradeNo) throw new Error('OUT_TRADE_NO_MISMATCH')
  if (Number(order.amount_cents) !== Number(value.amountCents)) throw new Error('AMOUNT_MISMATCH')
  if (order.currency !== (value.currency || 'CNY')) throw new Error('CURRENCY_MISMATCH')
}

async function recomputeEntitlement(tx, appId, userId) {
  const orders = await tx.query(
    `SELECT id, paid_at, created_at, duration_days FROM member_orders
     WHERE app_id = ? AND user_id = ? AND order_type = 'MEMBERSHIP'
       AND status = 'PAID' AND duration_days > 0
     ORDER BY COALESCE(paid_at, created_at), created_at, id
     FOR UPDATE`,
    [appId, userId],
  )
  let chainStart = null
  let entitlementEnd = null
  let sourceOrderId = null
  for (const order of orders) {
    const paidAt = new Date(order.paid_at || order.created_at)
    if (!entitlementEnd || entitlementEnd.getTime() < paidAt.getTime()) {
      chainStart = paidAt
      entitlementEnd = paidAt
    }
    entitlementEnd = new Date(entitlementEnd.getTime() + Number(order.duration_days) * 86400000)
    sourceOrderId = order.id
  }
  if (!sourceOrderId) {
    await tx.query(
      `UPDATE member_entitlements
       SET status = 'REVOKED', expires_at = LEAST(expires_at, UTC_TIMESTAMP(3)),
           source_order_id = NULL, updated_at = UTC_TIMESTAMP(3)
       WHERE app_id = ? AND user_id = ?`,
      [appId, userId],
    )
    return null
  }
  const status = entitlementEnd.getTime() > Date.now() ? 'ACTIVE' : 'EXPIRED'
  await tx.query(
    `INSERT INTO member_entitlements (
       id, app_id, user_id, status, starts_at, expires_at, source_order_id
     ) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       status = VALUES(status), starts_at = VALUES(starts_at), expires_at = VALUES(expires_at),
       source_order_id = VALUES(source_order_id), updated_at = UTC_TIMESTAMP(3)`,
    [randomUUID(), appId, userId, status, chainStart, entitlementEnd, sourceOrderId],
  )
  return { startsAt: chainStart, expiresAt: entitlementEnd, sourceOrderId, status }
}

/**
 * After a membership refund converges, free future member-included seats that
 * the user is no longer entitled to hold. ATTENDED history is never cancelled;
 * only future REGISTERED rows for member_free events are converged.
 *
 * Must run inside the same transaction as the refund status update + entitlement
 * recompute. Idempotent when the outer refund path early-returns on already-REFUNDED.
 */
async function convergeMemberFreeRegistrationsOnRefund(tx, { appId, userId, orderId, reason }) {
  const cancellationReason = typeof reason === 'string' && reason
    ? reason.slice(0, 500)
    : 'MEMBERSHIP_REFUNDED'

  // Only free seats when the member no longer holds an active entitlement after recompute.
  // Partial refunds that leave remaining PAID membership must not cancel valid seats.
  const entitlement = await tx.one(
    `SELECT id, status, expires_at FROM member_entitlements
     WHERE app_id = ? AND user_id = ?
     FOR UPDATE`,
    [appId, userId],
  )
  if (
    entitlement
    && entitlement.status === 'ACTIVE'
    && entitlement.expires_at
    && new Date(entitlement.expires_at).getTime() > Date.now()
  ) {
    return
  }

  const registrations = await tx.query(
    `SELECT r.id, r.version, r.event_id
     FROM member_registrations r
     INNER JOIN member_events e ON e.app_id = r.app_id AND e.id = r.event_id
     WHERE r.app_id = ?
       AND r.user_id = ?
       AND r.status = 'REGISTERED'
       AND e.member_free = 1
       AND e.starts_at > UTC_TIMESTAMP(3)
     FOR UPDATE`,
    [appId, userId],
  )

  for (const registration of registrations || []) {
    const previousVersion = Number(registration.version) || 1
    const cancelResult = await tx.query(
      `UPDATE member_registrations SET
         status = 'CANCELLED',
         cancelled_at = UTC_TIMESTAMP(3),
         cancelled_by_type = 'SYSTEM',
         cancellation_reason = ?,
         version = version + 1,
         updated_at = UTC_TIMESTAMP(3)
       WHERE id = ? AND app_id = ? AND status = 'REGISTERED'`,
      [cancellationReason, registration.id, appId],
    )
    // Concurrent cancel: skip audit when this UPDATE lost the race (affectedRows 0).
    if (!cancelResult || cancelResult.affectedRows !== 1) {
      continue
    }
    await tx.query(
      `INSERT INTO member_audit_logs (
         app_id, actor_id, actor_role, action, resource_type, resource_id, metadata
       ) VALUES (?, 'system:refund', 'system', 'REGISTRATION_CANCELLED_ON_MEMBERSHIP_REFUND', 'registration', ?, ?)`,
      [
        appId,
        registration.id,
        JSON.stringify({
          from: 'REGISTERED',
          to: 'CANCELLED',
          version: previousVersion + 1,
          eventId: registration.event_id,
          orderId,
        }),
      ],
    )
  }
}

async function getPayableOrder(db, input) {
  const order = await db.one(
    `SELECT o.*, p.environment, p.status AS plan_status,
            e.status AS event_status, e.starts_at AS event_starts_at
     FROM member_orders o
     LEFT JOIN member_plans p ON p.app_id = o.app_id AND p.id = o.product_id
     LEFT JOIN member_events e ON e.app_id = o.app_id AND e.id = o.product_id
     WHERE o.app_id = ? AND o.id = ? AND o.user_id = ?`,
    [input.appId, input.orderId, input.userId],
  )
  if (!order) throw new Error('MEMBERSHIP_ORDER_NOT_FOUND')
  if (!['PENDING', 'PAYMENT_CREATED'].includes(order.status)) throw new Error('MEMBERSHIP_ORDER_NOT_PAYABLE')
  if (order.order_type === 'MEMBERSHIP') {
    if (order.plan_status !== 'ACTIVE' || order.environment !== input.paymentMode) {
      throw new Error('MEMBERSHIP_PAYMENT_MODE_MISMATCH')
    }
  }
  else if (order.order_type === 'EVENT') {
    if (order.event_status !== 'PUBLISHED'
      || !order.event_starts_at
      || new Date(order.event_starts_at).getTime() <= Date.now()) {
      throw new Error('EVENT_ORDER_NOT_PAYABLE')
    }
    const reservation = await db.one(
      `SELECT status, expires_at FROM member_event_reservations
       WHERE app_id = ? AND order_id = ? AND user_id = ?`,
      [input.appId, order.id, input.userId],
    )
    if (!reservation || reservation.status !== 'ACTIVE'
      || (order.status === 'PENDING' && new Date(reservation.expires_at).getTime() <= Date.now())) {
      throw new Error('EVENT_RESERVATION_EXPIRED')
    }
  }
  else {
    throw new Error('MEMBERSHIP_ORDER_NOT_PAYABLE')
  }
  return {
    id: order.id,
    userId: order.user_id,
    description: order.description,
    outTradeNo: order.out_trade_no,
    amountCents: Number(order.amount_cents),
    currency: order.currency,
  }
}

async function markPaymentCreated(db, input) {
  await db.transaction(async (tx) => {
    const order = await tx.one(
      'SELECT * FROM member_orders WHERE app_id = ? AND id = ? FOR UPDATE',
      [input.appId, input.orderId],
    )
    assertPaymentMatches(order, input)
    if (['PAYMENT_CREATED', 'PAID'].includes(order.status)) return
    if (order.status !== 'PENDING') throw new Error('MEMBERSHIP_ORDER_NOT_PENDING')
    await tx.query(
      `UPDATE member_orders SET status = 'PAYMENT_CREATED', updated_at = UTC_TIMESTAMP(3)
       WHERE id = ?`,
      [order.id],
    )
    if (order.order_type === 'EVENT') {
      await tx.query(
        `UPDATE member_event_reservations
         SET expires_at = GREATEST(expires_at, UTC_TIMESTAMP(3) + INTERVAL 30 MINUTE),
             updated_at = UTC_TIMESTAMP(3)
         WHERE app_id = ? AND order_id = ? AND status = 'ACTIVE'`,
        [input.appId, order.id],
      )
    }
  })
}

async function applyPaymentCallback(db, input) {
  await db.transaction(async (tx) => {
    const order = await tx.one(
      'SELECT * FROM member_orders WHERE app_id = ? AND id = ? FOR UPDATE',
      [input.appId, input.orderId],
    )
    assertPaymentMatches(order, input)
    if (order.status === 'PAID') {
      if (order.transaction_id && order.transaction_id !== input.transactionId) {
        throw new Error('TRANSACTION_ID_MISMATCH')
      }
      return
    }
    if (!['PENDING', 'PAYMENT_CREATED'].includes(order.status)) {
      throw new Error('MEMBERSHIP_ORDER_INVALID_STATE')
    }
    if (order.order_type === 'EVENT') {
      const reservation = await tx.one(
        `SELECT * FROM member_event_reservations
         WHERE app_id = ? AND order_id = ? AND user_id = ?
         FOR UPDATE`,
        [input.appId, order.id, input.userId],
      )
      if (!reservation || reservation.status !== 'ACTIVE') {
        throw new Error('EVENT_RESERVATION_NOT_ACTIVE')
      }
      const event = await tx.one(
        `SELECT id, status, starts_at FROM member_events
         WHERE app_id = ? AND id = ?
         FOR UPDATE`,
        [input.appId, order.product_id],
      )
      if (!event || event.status !== 'PUBLISHED') {
        throw new Error('EVENT_ORDER_INVALID_STATE')
      }
      const existing = await tx.one(
        `SELECT id, status, version, ticket_code FROM member_registrations
         WHERE app_id = ? AND event_id = ? AND user_id = ?
         FOR UPDATE`,
        [input.appId, event.id, input.userId],
      )
      const ticketCode = existing?.ticket_code
        || `T${randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase()}`
      let registrationId = existing?.id || randomUUID()
      if (existing) {
        if (!['CANCELLED'].includes(existing.status)) {
          throw new Error('EVENT_REGISTRATION_CONFLICT')
        }
        const updated = await tx.query(
          `UPDATE member_registrations SET
           status = 'REGISTERED', ticket_code = ?, source_order_id = ?,
             form_version = ?, answer_snapshot = ?, share_profile = ?, cancelled_at = NULL,
             cancelled_by_type = NULL, cancellation_reason = NULL,
             version = version + 1, updated_at = UTC_TIMESTAMP(3)
           WHERE app_id = ? AND id = ? AND status = 'CANCELLED'`,
          [
            ticketCode,
            order.id,
            Number(reservation.form_version),
            reservation.answer_snapshot,
            Number(reservation.share_profile || 0),
            input.appId,
            existing.id,
          ],
        )
        if (!updated || updated.affectedRows !== 1) {
          throw new Error('EVENT_REGISTRATION_CONFLICT')
        }
      }
      else {
        await tx.query(
          `INSERT INTO member_registrations (
             id, app_id, event_id, user_id, status, ticket_code, source_order_id,
             form_version, answer_snapshot, share_profile, version
           ) VALUES (?, ?, ?, ?, 'REGISTERED', ?, ?, ?, ?, ?, 1)`,
          [
            registrationId,
            input.appId,
            event.id,
            input.userId,
            ticketCode,
            order.id,
            Number(reservation.form_version),
            reservation.answer_snapshot,
            Number(reservation.share_profile || 0),
          ],
        )
      }
      await tx.query(
        `UPDATE member_orders SET
           status = 'PAID', transaction_id = ?, paid_at = UTC_TIMESTAMP(3),
           updated_at = UTC_TIMESTAMP(3)
         WHERE id = ?`,
        [input.transactionId, order.id],
      )
      await tx.query(
        `UPDATE member_event_reservations SET
           status = 'CONVERTED', converted_at = UTC_TIMESTAMP(3),
           updated_at = UTC_TIMESTAMP(3)
         WHERE app_id = ? AND order_id = ? AND status = 'ACTIVE'`,
        [input.appId, order.id],
      )
      await tx.query(
        `INSERT INTO member_audit_logs (
           app_id, actor_id, actor_role, action, resource_type, resource_id, metadata
         ) VALUES (?, 'system:cloudpay', 'system', 'EVENT_PAYMENT_CONFIRMED', 'registration', ?, ?)`,
        [
          input.appId,
          registrationId,
          JSON.stringify({ orderId: order.id, eventId: event.id, callback: 'cloudpay' }),
        ],
      )
      return
    }
    if (order.order_type !== 'MEMBERSHIP') {
      throw new Error('MEMBERSHIP_ORDER_INVALID_STATE')
    }
    if (!Number.isInteger(Number(order.duration_days)) || Number(order.duration_days) <= 0) {
      throw new Error('MEMBERSHIP_DURATION_INVALID')
    }
    const entitlement = await tx.one(
      `SELECT expires_at FROM member_entitlements
       WHERE app_id = ? AND user_id = ? FOR UPDATE`,
      [input.appId, input.userId],
    )
    const currentEnd = entitlement?.expires_at ? new Date(entitlement.expires_at) : null
    const startsAt = currentEnd && currentEnd.getTime() > Date.now() ? currentEnd : new Date()
    const endsAt = new Date(startsAt.getTime() + Number(order.duration_days) * 86400000)
    await tx.query(
      `UPDATE member_orders SET
         status = 'PAID', transaction_id = ?, paid_at = UTC_TIMESTAMP(3),
         entitlement_start = ?, entitlement_end = ?, updated_at = UTC_TIMESTAMP(3)
       WHERE id = ?`,
      [input.transactionId, startsAt, endsAt, order.id],
    )
    await recomputeEntitlement(tx, input.appId, input.userId)
    await tx.query(
      `INSERT INTO member_audit_logs (
         app_id, actor_id, actor_role, action, resource_type, resource_id, metadata
       ) VALUES (?, 'system:cloudpay', 'system', 'PAYMENT_CONFIRMED', 'order', ?, ?)`,
      [input.appId, order.id, JSON.stringify({ callback: 'cloudpay' })],
    )
  })
}

async function getRefundRequest(db, input) {
  const row = await db.one(
    `SELECT r.*, o.status AS order_status, o.amount_cents AS order_amount_cents,
            o.transaction_id AS transaction_id, o.user_id AS order_user_id,
            o.order_type AS order_type,
            o.currency AS order_currency, a.role AS admin_role
     FROM member_refunds r
     JOIN member_orders o ON o.app_id = r.app_id AND o.id = r.order_id
     LEFT JOIN member_admin_roles a
       ON a.app_id = r.app_id AND a.user_id = ? AND a.status = 'ACTIVE'
     WHERE r.app_id = ? AND r.id = ?`,
    [input.userId, input.appId, input.refundId],
  )
  const eventOwner = row
    && row.order_type === 'EVENT'
    && row.order_user_id === input.userId
    && row.requested_by === input.userId
  if (!row || (!eventOwner && !['owner', 'manager', 'support'].includes(row.admin_role))) {
    throw new Error('REFUND_FORBIDDEN')
  }
  if (!['REFUND_PENDING', 'REFUND_CREATED'].includes(row.status)) throw new Error('REFUND_NOT_FOUND')
  if (row.order_status !== 'REFUND_PENDING') throw new Error('ORDER_NOT_REFUNDABLE')
  if (Number(row.amount_cents) !== Number(row.order_amount_cents) || row.currency !== row.order_currency) {
    throw new Error('REFUND_AMOUNT_MISMATCH')
  }
  return {
    adminRole: row.admin_role || (eventOwner ? 'member' : null),
    status: row.status,
    outTradeNo: row.out_trade_no,
    outRefundNo: row.out_refund_no,
    transactionId: row.transaction_id,
    reason: row.reason,
    amountCents: Number(row.amount_cents),
    totalCents: Number(row.order_amount_cents),
    currency: row.currency,
  }
}

async function markRefundFailed(db, input) {
  await db.transaction(async (tx) => {
    const refund = await tx.one(
      'SELECT * FROM member_refunds WHERE app_id = ? AND out_refund_no = ? FOR UPDATE',
      [input.appId, input.outRefundNo],
    )
    if (!refund || refund.out_trade_no !== input.outTradeNo) throw new Error('REFUND_REQUEST_NOT_FOUND')
    const order = await tx.one(
      'SELECT * FROM member_orders WHERE app_id = ? AND id = ? FOR UPDATE',
      [input.appId, refund.order_id],
    )
    if (!order) throw new Error('MEMBERSHIP_ORDER_NOT_FOUND')
    if (refund.status === 'REFUND_FAILED') return
    if (!['REFUND_PENDING', 'REFUND_CREATED'].includes(refund.status) || order.status !== 'REFUND_PENDING') {
      throw new Error('REFUND_INVALID_STATE')
    }
    const refundUpdate = await tx.query(
      `UPDATE member_refunds
       SET status = 'REFUND_FAILED', updated_at = UTC_TIMESTAMP(3)
       WHERE id = ? AND status IN ('REFUND_PENDING', 'REFUND_CREATED')`,
      [refund.id],
    )
    if (!refundUpdate || refundUpdate.affectedRows !== 1) {
      throw new Error('REFUND_INVALID_STATE')
    }
    const orderUpdate = await tx.query(
      `UPDATE member_orders SET status = 'PAID', updated_at = UTC_TIMESTAMP(3)
       WHERE id = ? AND status = 'REFUND_PENDING'`,
      [order.id],
    )
    if (!orderUpdate || orderUpdate.affectedRows !== 1) {
      throw new Error('ORDER_STATUS_CONFLICT')
    }
    if (order.order_type === 'EVENT') {
      const event = await tx.one(
        `SELECT status FROM member_events
         WHERE app_id = ? AND id = ? FOR SHARE`,
        [input.appId, order.product_id],
      )
      // A member-initiated refund failure restores the seat. When the event
      // itself is cancelled there is no valid seat to restore; keep the
      // registration pending so operations can retry the same refund.
      if (event?.status !== 'CANCELLED') {
        await tx.query(
          `UPDATE member_registrations SET
             status = 'REGISTERED', cancelled_at = NULL, cancelled_by_type = NULL,
             cancellation_reason = NULL, version = version + 1,
             updated_at = UTC_TIMESTAMP(3)
           WHERE app_id = ? AND source_order_id = ? AND status = 'CANCELLATION_PENDING'`,
          [input.appId, order.id],
        )
      }
    }
    await tx.query(
      `INSERT INTO member_audit_logs (
         app_id, actor_id, actor_role, action, resource_type, resource_id, metadata
       ) VALUES (?, 'system:cloudpay', 'system', 'REFUND_FAILED', 'order', ?, ?)`,
      [input.appId, order.id, JSON.stringify({ reasonCode: input.reasonCode || 'UNKNOWN' })],
    )
  })
}

async function markRefundCreated(db, input) {
  await db.transaction(async (tx) => {
    const refund = await tx.one(
      'SELECT * FROM member_refunds WHERE app_id = ? AND out_refund_no = ? FOR UPDATE',
      [input.appId, input.outRefundNo],
    )
    if (!refund || refund.out_trade_no !== input.outTradeNo) throw new Error('REFUND_REQUEST_NOT_FOUND')
    // Idempotent success path for already-submitted / already-refunded.
    if (['REFUND_CREATED', 'REFUNDED'].includes(refund.status)) return
    if (refund.status !== 'REFUND_PENDING') throw new Error('REFUND_INVALID_STATE')
    const refundUpdate = await tx.query(
      `UPDATE member_refunds
       SET status = 'REFUND_CREATED', submitted_at = UTC_TIMESTAMP(3), updated_at = UTC_TIMESTAMP(3)
       WHERE id = ? AND status = 'REFUND_PENDING'`,
      [refund.id],
    )
    // Concurrent status flip loses the race — fail closed, no success path.
    if (!refundUpdate || refundUpdate.affectedRows !== 1) {
      throw new Error('REFUND_STATUS_CONFLICT')
    }
  })
}

async function applyRefundCallback(db, input) {
  await db.transaction(async (tx) => {
    const refund = await tx.one(
      'SELECT * FROM member_refunds WHERE app_id = ? AND out_refund_no = ? FOR UPDATE',
      [input.appId, input.outRefundNo],
    )
    if (!refund || refund.out_trade_no !== input.outTradeNo) throw new Error('REFUND_REQUEST_NOT_FOUND')
    const order = await tx.one(
      'SELECT * FROM member_orders WHERE app_id = ? AND id = ? FOR UPDATE',
      [input.appId, refund.order_id],
    )
    if (!order) throw new Error('MEMBERSHIP_ORDER_NOT_FOUND')
    if (Number(refund.amount_cents) !== Number(order.amount_cents)
      || Number(input.refundAmountCents) !== Number(order.amount_cents)) {
      throw new Error('REFUND_AMOUNT_MISMATCH')
    }
    if (order.status === 'REFUNDED' && refund.status === 'REFUNDED') return
    if (order.status !== 'REFUND_PENDING') throw new Error('ORDER_NOT_REFUNDABLE')
    const refundUpdate = await tx.query(
      `UPDATE member_refunds SET
         status = 'REFUNDED', refund_id = ?, refunded_at = UTC_TIMESTAMP(3),
         updated_at = UTC_TIMESTAMP(3)
       WHERE id = ? AND status IN ('REFUND_PENDING', 'REFUND_CREATED')`,
      [input.refundId, refund.id],
    )
    if (!refundUpdate || refundUpdate.affectedRows !== 1) {
      throw new Error('REFUND_INVALID_STATE')
    }
    const orderUpdate = await tx.query(
      `UPDATE member_orders SET status = 'REFUNDED', updated_at = UTC_TIMESTAMP(3)
       WHERE id = ? AND status = 'REFUND_PENDING'`,
      [order.id],
    )
    if (!orderUpdate || orderUpdate.affectedRows !== 1) {
      throw new Error('ORDER_STATUS_CONFLICT')
    }
    if (order.order_type === 'MEMBERSHIP') {
      await recomputeEntitlement(tx, input.appId, order.user_id)
      await convergeMemberFreeRegistrationsOnRefund(tx, {
        appId: input.appId,
        userId: order.user_id,
        orderId: order.id,
        reason: 'MEMBERSHIP_REFUNDED',
      })
    }
    else if (order.order_type === 'EVENT') {
      const registration = await tx.one(
        `SELECT id, event_id, version FROM member_registrations
         WHERE app_id = ? AND source_order_id = ?
         FOR UPDATE`,
        [input.appId, order.id],
      )
      if (!registration) {
        throw new Error('EVENT_REGISTRATION_NOT_FOUND')
      }
      const result = await tx.query(
        `UPDATE member_registrations SET
           status = 'CANCELLED', version = version + 1, updated_at = UTC_TIMESTAMP(3)
         WHERE app_id = ? AND id = ? AND status = 'CANCELLATION_PENDING'`,
        [input.appId, registration.id],
      )
      if (!result || result.affectedRows !== 1) {
        throw new Error('EVENT_REGISTRATION_INVALID_STATE')
      }
      await tx.query(
        `INSERT INTO member_audit_logs (
           app_id, actor_id, actor_role, action, resource_type, resource_id, metadata
         ) VALUES (?, 'system:cloudpay', 'system', 'EVENT_REGISTRATION_REFUNDED', 'registration', ?, ?)`,
        [
          input.appId,
          registration.id,
          JSON.stringify({
            from: 'CANCELLATION_PENDING',
            to: 'CANCELLED',
            version: Number(registration.version || 1) + 1,
            eventId: registration.event_id,
            orderId: order.id,
          }),
        ],
      )
    }
    await tx.query(
      `INSERT INTO member_audit_logs (
         app_id, actor_id, actor_role, action, resource_type, resource_id, metadata
       ) VALUES (?, 'system:cloudpay', 'system', 'REFUND_CONFIRMED', 'order', ?, ?)`,
      [input.appId, order.id, JSON.stringify({ callback: 'cloudpay' })],
    )
  })
}

async function confirmRefundManually(db, input) {
  if (typeof input.operatorId !== 'string' || !input.operatorId || input.operatorId.length > 128
    || typeof input.reason !== 'string' || !input.reason || input.reason.length > 256) {
    throw new Error('REFUND_CONFIRMATION_INVALID')
  }
  await db.transaction(async (tx) => {
    const refund = await tx.one(
      'SELECT * FROM member_refunds WHERE app_id = ? AND id = ? FOR UPDATE',
      [input.appId, input.refundId],
    )
    if (!refund) throw new Error('REFUND_REQUEST_NOT_FOUND')
    const order = await tx.one(
      'SELECT * FROM member_orders WHERE app_id = ? AND id = ? FOR UPDATE',
      [input.appId, refund.order_id],
    )
    if (!order) throw new Error('MEMBERSHIP_ORDER_NOT_FOUND')
    if (Number(refund.amount_cents) !== Number(order.amount_cents)) {
      throw new Error('REFUND_AMOUNT_MISMATCH')
    }
    if (order.status === 'REFUNDED' && refund.status === 'REFUNDED') return
    if (!['REFUND_PENDING', 'REFUND_CREATED'].includes(refund.status) || order.status !== 'REFUND_PENDING') {
      throw new Error('REFUND_INVALID_STATE')
    }
    const refundUpdate = await tx.query(
      `UPDATE member_refunds SET
         status = 'REFUNDED', refunded_at = UTC_TIMESTAMP(3), updated_at = UTC_TIMESTAMP(3)
       WHERE id = ? AND status IN ('REFUND_PENDING', 'REFUND_CREATED')`,
      [refund.id],
    )
    if (!refundUpdate || refundUpdate.affectedRows !== 1) {
      throw new Error('REFUND_INVALID_STATE')
    }
    const orderUpdate = await tx.query(
      `UPDATE member_orders SET status = 'REFUNDED', updated_at = UTC_TIMESTAMP(3)
       WHERE id = ? AND status = 'REFUND_PENDING'`,
      [order.id],
    )
    if (!orderUpdate || orderUpdate.affectedRows !== 1) {
      throw new Error('ORDER_STATUS_CONFLICT')
    }
    if (order.order_type === 'MEMBERSHIP') {
      await recomputeEntitlement(tx, input.appId, order.user_id)
      await convergeMemberFreeRegistrationsOnRefund(tx, {
        appId: input.appId,
        userId: order.user_id,
        orderId: order.id,
        reason: 'MEMBERSHIP_REFUNDED',
      })
    }
    else if (order.order_type === 'EVENT') {
      const registration = await tx.one(
        `SELECT id, event_id, version FROM member_registrations
         WHERE app_id = ? AND source_order_id = ?
         FOR UPDATE`,
        [input.appId, order.id],
      )
      if (!registration) {
        throw new Error('EVENT_REGISTRATION_NOT_FOUND')
      }
      const result = await tx.query(
        `UPDATE member_registrations SET
           status = 'CANCELLED', version = version + 1, updated_at = UTC_TIMESTAMP(3)
         WHERE app_id = ? AND id = ? AND status = 'CANCELLATION_PENDING'`,
        [input.appId, registration.id],
      )
      if (!result || result.affectedRows !== 1) {
        throw new Error('EVENT_REGISTRATION_INVALID_STATE')
      }
    }
    await tx.query(
      `INSERT INTO member_audit_logs (
         app_id, actor_id, actor_role, action, resource_type, resource_id, metadata
       ) VALUES (?, ?, 'owner', 'REFUND_MANUALLY_CONFIRMED', 'order', ?, ?)`,
      [
        input.appId,
        input.operatorId,
        order.id,
        JSON.stringify({ reason: input.reason, source: 'external-provider-confirmation' }),
      ],
    )
  })
}

module.exports = {
  applyPaymentCallback,
  applyRefundCallback,
  assertPaymentMatches,
  confirmRefundManually,
  convergeMemberFreeRegistrationsOnRefund,
  getPayableOrder,
  getRefundRequest,
  markPaymentCreated,
  markRefundFailed,
  markRefundCreated,
  recomputeEntitlement,
}
