'use strict'

const { createHash, randomBytes, randomUUID } = require('node:crypto')

function assertPaymentMatches(order, value) {
  if (!order) {
    throw new Error('ORDER_NOT_FOUND')
  }
  if (order.merchant_order_no !== value.merchantOrderNo) {
    throw new Error('MERCHANT_ORDER_NO_MISMATCH')
  }
  if (Number(order.amount_cents) !== Number(value.amountCents)) {
    throw new Error('AMOUNT_MISMATCH')
  }
  if (order.currency !== (value.currency || 'CNY')) {
    throw new Error('CURRENCY_MISMATCH')
  }
}

async function getPayableOrder(db, input, options = {}) {
  const now = options.now || (() => new Date())
  const order = await db.one(
    `SELECT o.*, p.catalog_stage, p.status AS plan_status,
       h.status AS hold_status, h.expires_at AS hold_expires_at
     FROM mip_orders o
     JOIN mip_user_identities i
       ON i.app_id = o.app_id AND i.user_id = o.user_id
      AND i.provider = 'WECHAT_MINIPROGRAM' AND i.identity_key = ?
     LEFT JOIN mip_membership_plans p
       ON p.app_id = o.app_id AND p.id = o.membership_plan_id
     LEFT JOIN mip_event_seat_holds h
       ON h.app_id = o.app_id AND h.order_id = o.id
     WHERE o.app_id = ? AND o.id = ?`,
    [input.identityKey, input.appId, input.orderId],
  )
  if (!order || !['CREATED', 'PAYMENT_CREATED', 'PAID'].includes(order.status)) {
    throw new Error('ORDER_NOT_PAYABLE')
  }
  if (order.status !== 'PAID' && order.order_type === 'MEMBERSHIP') {
    const expectedStage = input.paymentMode === 'live' ? 'LIVE' : 'TEST'
    if (order.plan_status !== 'ACTIVE' || order.catalog_stage !== expectedStage) {
      throw new Error('PAYMENT_MODE_MISMATCH')
    }
  }
  else if (order.status !== 'PAID' && order.order_type !== 'EVENT') {
    throw new Error('ORDER_NOT_PAYABLE')
  }
  if (order.status !== 'PAID' && order.order_type === 'EVENT') {
    const expiresAt = new Date(order.hold_expires_at)
    if (order.hold_status !== 'ACTIVE'
      || !Number.isFinite(expiresAt.getTime())
      || expiresAt.getTime() <= now().getTime()) {
      throw new Error('EVENT_SEAT_HOLD_EXPIRED')
    }
  }
  const snapshot = parseJson(order.product_snapshot_json)
  return {
    id: order.id,
    status: order.status,
    userId: order.user_id,
    orderType: order.order_type,
    description: String(snapshot.name || snapshot.title || 'MIP 订单').slice(0, 120),
    merchantOrderNo: order.merchant_order_no,
    amountCents: Number(order.amount_cents),
    currency: order.currency,
  }
}

async function markPaymentCreated(db, input) {
  return db.transaction(async (tx) => {
    const order = await tx.one(
      `SELECT o.* FROM mip_orders o
       JOIN mip_user_identities i
         ON i.app_id = o.app_id AND i.user_id = o.user_id
        AND i.provider = 'WECHAT_MINIPROGRAM' AND i.identity_key = ?
       WHERE o.app_id = ? AND o.id = ? FOR UPDATE`,
      [input.identityKey, input.appId, input.orderId],
    )
    assertPaymentMatches(order, input)
    if (order.status === 'PAID') {
      return { status: 'PAID' }
    }
    if (!['CREATED', 'PAYMENT_CREATED'].includes(order.status)) {
      throw new Error('ORDER_NOT_PAYABLE')
    }
    await tx.query(
      `INSERT INTO mip_payment_attempts (
        id, app_id, order_id, provider, prepay_id, request_hash, status
      ) VALUES (?, ?, ?, ?, ?, ?, 'PARAMETERS_ISSUED')
      ON DUPLICATE KEY UPDATE
        prepay_id = VALUES(prepay_id), status = 'PARAMETERS_ISSUED',
        last_error_code = NULL, version = version + 1`,
      [
        input.attemptId,
        input.appId,
        order.id,
        input.provider,
        input.prepayId || null,
        input.requestHash,
      ],
    )
    if (order.status === 'CREATED') {
      const updated = await tx.query(
        `UPDATE mip_orders
         SET status = 'PAYMENT_CREATED', version = version + 1
         WHERE app_id = ? AND id = ? AND status = 'CREATED' AND version = ?`,
        [input.appId, order.id, order.version],
      )
      assertAffected(updated, 'ORDER_STATUS_CONFLICT')
    }
    return { status: 'PAYMENT_CREATED' }
  })
}

async function applyPaymentCallback(db, input, options = {}) {
  const createId = options.createId || randomUUID
  const now = options.now || (() => new Date())
  return db.transaction(async (tx) => {
    const order = await tx.one(
      `SELECT o.* FROM mip_orders o
       JOIN mip_user_identities i
         ON i.app_id = o.app_id AND i.user_id = o.user_id
        AND i.provider = 'WECHAT_MINIPROGRAM' AND i.identity_key = ?
       WHERE o.app_id = ? AND o.id = ? FOR UPDATE`,
      [input.identityKey, input.appId, input.orderId],
    )
    assertPaymentMatches(order, input)
    const callback = await claimCallbackReceipt(tx, {
      appId: input.appId,
      callbackType: 'PAYMENT',
      callbackKey: input.providerTransactionId,
      resourceHash: callbackResourceHash('PAYMENT', input),
    })
    if (['PAID', 'REFUND_PENDING', 'PARTIALLY_REFUNDED', 'REFUNDED'].includes(order.status)) {
      if (order.provider_transaction_id !== input.providerTransactionId) {
        throw new Error('PROVIDER_TRANSACTION_MISMATCH')
      }
      await markCallbackProcessed(tx, callback, now())
      return { status: order.status, idempotent: true }
    }
    const payable = ['CREATED', 'PAYMENT_CREATED'].includes(order.status)
    const closedEventPayment = order.order_type === 'EVENT' && order.status === 'CLOSED'
    if (!payable && !closedEventPayment) {
      throw new Error('ORDER_INVALID_STATE')
    }
    const paidAt = now()
    if (order.order_type === 'EVENT') {
      const result = await applyEventPayment(tx, {
        appId: input.appId,
        createId,
        input,
        order,
        paidAt,
        payable,
      })
      await markCallbackProcessed(tx, callback, now())
      return result
    }
    const updated = await tx.query(
      `UPDATE mip_orders
       SET status = 'PAID', provider_transaction_id = ?, paid_at = ?, version = version + 1
       WHERE app_id = ? AND id = ? AND status IN ('CREATED', 'PAYMENT_CREATED') AND version = ?`,
      [input.providerTransactionId, paidAt, input.appId, order.id, order.version],
    )
    assertAffected(updated, 'ORDER_STATUS_CONFLICT')
    await tx.query(
      `UPDATE mip_payment_attempts
       SET provider_payment_id = ?, status = 'SUCCEEDED', version = version + 1
       WHERE app_id = ? AND order_id = ? AND status <> 'SUCCEEDED'`,
      [input.providerTransactionId, input.appId, order.id],
    )
    if (order.order_type === 'MEMBERSHIP') {
      await rebuildMembershipEntitlements(tx, input.appId, order.user_id, { createId, now })
    }
    await writeOutbox(tx, {
      id: createId(),
      appId: input.appId,
      aggregateType: 'ORDER',
      aggregateId: order.id,
      eventType: 'membership.payment_confirmed',
      sourceVersion: Number(order.version) + 1,
      payload: { orderId: order.id, userId: order.user_id, orderType: order.order_type },
    })
    await writeAudit(tx, {
      appId: input.appId,
      action: 'PAYMENT_CONFIRMED',
      resourceType: 'ORDER',
      resourceId: order.id,
      metadata: { orderType: order.order_type },
    })
    await markCallbackProcessed(tx, callback, now())
    return { status: 'PAID', idempotent: false }
  })
}

async function applyEventPayment(tx, {
  appId,
  createId,
  input,
  order,
  paidAt,
  payable,
}) {
  const fulfillment = await tx.one(
    `SELECT h.id AS hold_id, h.event_id, h.user_id, h.status AS hold_status,
       h.expires_at AS hold_expires_at, r.id AS registration_id,
       r.status AS registration_status, r.version AS registration_version
     FROM mip_event_seat_holds h
     JOIN mip_event_registrations r
       ON r.app_id = h.app_id AND r.order_id = h.order_id
     WHERE h.app_id = ? AND h.order_id = ? FOR UPDATE`,
    [appId, order.id],
  )
  if (!fulfillment
    || fulfillment.event_id !== order.resource_id
    || fulfillment.user_id !== order.user_id) {
    throw new Error('EVENT_ORDER_INVALID')
  }
  const holdExpiry = new Date(fulfillment.hold_expires_at)
  const seatAvailable = payable
    && fulfillment.hold_status === 'ACTIVE'
    && Number.isFinite(holdExpiry.getTime())
    && paidAt.getTime() <= holdExpiry.getTime()

  if (!seatAvailable) {
    const updated = await tx.query(
      `UPDATE mip_orders
       SET status = 'REFUND_PENDING', provider_transaction_id = ?, paid_at = ?, version = version + 1
       WHERE app_id = ? AND id = ? AND status IN ('CREATED', 'PAYMENT_CREATED', 'CLOSED') AND version = ?`,
      [input.providerTransactionId, paidAt, appId, order.id, order.version],
    )
    assertAffected(updated, 'ORDER_STATUS_CONFLICT')
    await markPaymentAttemptSucceeded(tx, appId, order.id, input.providerTransactionId)
    await tx.query(
      `UPDATE mip_event_seat_holds
       SET status = CASE WHEN status = 'ACTIVE' THEN 'EXPIRED' ELSE status END
       WHERE app_id = ? AND id = ?`,
      [appId, fulfillment.hold_id],
    )
    await tx.query(
      `UPDATE mip_event_registrations
       SET status = 'CANCELLATION_PENDING', version = version + 1
       WHERE app_id = ? AND id = ? AND status IN ('PAYMENT_PENDING', 'CANCELLED')`,
      [appId, fulfillment.registration_id],
    )
    const refundId = createId()
    await tx.query(
      `INSERT INTO mip_refunds (
        id, app_id, order_id, requested_by_user_id, merchant_refund_no,
        idempotency_key, amount_cents, reason, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, '活动名额保留已失效', 'PENDING')`,
      [
        refundId,
        appId,
        order.id,
        order.user_id,
        merchantRefundNumber(refundId),
        `event-late-payment:${fulfillment.registration_id}`,
        order.amount_cents,
      ],
    )
    await writeOutbox(tx, {
      id: createId(),
      appId,
      aggregateType: 'EVENT_REGISTRATION',
      aggregateId: fulfillment.registration_id,
      eventType: 'event.registration_refund_requested',
      sourceVersion: Number(fulfillment.registration_version) + 1,
      payload: {
        eventId: fulfillment.event_id,
        userId: order.user_id,
        orderId: order.id,
        refundId,
        reason: 'SEAT_HOLD_EXPIRED',
      },
    })
    await writeAudit(tx, {
      appId,
      action: 'EVENT_LATE_PAYMENT_REFUND_REQUESTED',
      resourceType: 'ORDER',
      resourceId: order.id,
      metadata: { registrationId: fulfillment.registration_id },
    })
    return { status: 'REFUND_PENDING', refundId, idempotent: false }
  }

  const updated = await tx.query(
    `UPDATE mip_orders
     SET status = 'PAID', provider_transaction_id = ?, paid_at = ?, version = version + 1
     WHERE app_id = ? AND id = ? AND status IN ('CREATED', 'PAYMENT_CREATED') AND version = ?`,
    [input.providerTransactionId, paidAt, appId, order.id, order.version],
  )
  assertAffected(updated, 'ORDER_STATUS_CONFLICT')
  await markPaymentAttemptSucceeded(tx, appId, order.id, input.providerTransactionId)
  await tx.query(
    `UPDATE mip_event_seat_holds SET status = 'CONSUMED', consumed_at = ?
     WHERE app_id = ? AND id = ? AND status = 'ACTIVE'`,
    [paidAt, appId, fulfillment.hold_id],
  )
  await tx.query(
    `UPDATE mip_event_registrations
     SET status = 'REGISTERED', ticket_hash = ?, registered_at = ?, version = version + 1
     WHERE app_id = ? AND id = ? AND status = 'PAYMENT_PENDING'`,
    [createHash('sha256').update(randomBytes(32)).digest('hex'), paidAt, appId, fulfillment.registration_id],
  )
  await writeOutbox(tx, {
    id: createId(),
    appId,
    aggregateType: 'EVENT_REGISTRATION',
    aggregateId: fulfillment.registration_id,
    eventType: 'event.registration_confirmed',
    sourceVersion: Number(fulfillment.registration_version) + 1,
    payload: {
      eventId: fulfillment.event_id,
      userId: order.user_id,
      orderId: order.id,
      status: 'REGISTERED',
    },
  })
  await writeAudit(tx, {
    appId,
    action: 'EVENT_PAYMENT_CONFIRMED',
    resourceType: 'ORDER',
    resourceId: order.id,
    metadata: { registrationId: fulfillment.registration_id },
  })
  return { status: 'PAID', registrationId: fulfillment.registration_id, idempotent: false }
}

async function markPaymentAttemptSucceeded(tx, appId, orderId, providerTransactionId) {
  await tx.query(
    `UPDATE mip_payment_attempts
     SET provider_payment_id = ?, status = 'SUCCEEDED', version = version + 1
     WHERE app_id = ? AND order_id = ? AND status <> 'SUCCEEDED'`,
    [providerTransactionId, appId, orderId],
  )
}

function merchantRefundNumber(refundId) {
  const compact = String(refundId || '').replace(/[^0-9A-Za-z]/g, '').slice(0, 56)
  if (!compact) throw new Error('REFUND_ID_INVALID')
  return `MIPR${compact}`
}

async function getRefundRequest(db, input) {
  const row = await db.one(
    `SELECT r.*, o.user_id, o.merchant_order_no, o.amount_cents AS order_amount_cents,
            o.currency, o.status AS order_status
     FROM mip_refunds r
     JOIN mip_orders o ON o.app_id = r.app_id AND o.id = r.order_id
     JOIN mip_user_identities i
       ON i.app_id = o.app_id AND i.user_id = o.user_id
      AND i.provider = 'WECHAT_MINIPROGRAM' AND i.identity_key = ?
     WHERE r.app_id = ? AND r.id = ? AND r.requested_by_user_id = o.user_id`,
    [input.identityKey, input.appId, input.refundId],
  )
  if (!row || !['PENDING', 'PROVIDER_CREATED', 'PROCESSING'].includes(row.status)) {
    throw new Error('REFUND_NOT_FOUND')
  }
  if (row.order_status !== 'REFUND_PENDING') {
    throw new Error('ORDER_NOT_REFUNDABLE')
  }
  return {
    id: row.id,
    orderId: row.order_id,
    userId: row.user_id,
    merchantOrderNo: row.merchant_order_no,
    merchantRefundNo: row.merchant_refund_no,
    providerRefundId: row.provider_refund_id || undefined,
    amountCents: Number(row.amount_cents),
    totalCents: Number(row.order_amount_cents),
    currency: row.currency,
    reason: row.reason || undefined,
    status: row.status,
  }
}

async function getRefundRequestForProvider(db, input) {
  const row = await db.one(
    `SELECT r.*, o.user_id, o.merchant_order_no, o.amount_cents AS order_amount_cents,
            o.currency, o.status AS order_status
     FROM mip_refunds r
     JOIN mip_orders o ON o.app_id = r.app_id AND o.id = r.order_id
     WHERE r.app_id = ? AND r.id = ?`,
    [input.appId, input.refundId],
  )
  if (!row || !['PENDING', 'PROVIDER_CREATED', 'PROCESSING'].includes(row.status)) {
    throw new Error('REFUND_NOT_FOUND')
  }
  if (row.order_status !== 'REFUND_PENDING') {
    throw new Error('ORDER_NOT_REFUNDABLE')
  }
  return {
    id: row.id,
    orderId: row.order_id,
    userId: row.user_id,
    merchantOrderNo: row.merchant_order_no,
    merchantRefundNo: row.merchant_refund_no,
    providerRefundId: row.provider_refund_id || undefined,
    amountCents: Number(row.amount_cents),
    totalCents: Number(row.order_amount_cents),
    currency: row.currency,
    reason: row.reason || undefined,
    status: row.status,
  }
}

async function listPendingRefunds(db, input) {
  const requested = Number(input.limit || 5)
  const limit = Number.isInteger(requested) ? Math.min(Math.max(requested, 1), 20) : 5
  const rows = await db.query(
    `SELECT r.id FROM mip_refunds r
     JOIN mip_orders o ON o.app_id = r.app_id AND o.id = r.order_id
     WHERE r.app_id = ? AND r.status IN ('PENDING', 'PROVIDER_CREATED', 'PROCESSING')
       AND o.status = 'REFUND_PENDING'
     ORDER BY r.updated_at ASC, r.id ASC LIMIT ?`,
    [input.appId, limit],
  )
  return { refundIds: rows.map(row => row.id) }
}

async function markRefundCreated(db, input) {
  return db.transaction(async (tx) => {
    const refund = await tx.one(
      'SELECT * FROM mip_refunds WHERE app_id = ? AND merchant_refund_no = ? FOR UPDATE',
      [input.appId, input.merchantRefundNo],
    )
    assertRefundIdentity(refund, input)
    if (['PROVIDER_CREATED', 'PROCESSING', 'SUCCEEDED'].includes(refund.status)) {
      if (refund.provider_refund_id && refund.provider_refund_id !== input.providerRefundId) {
        throw new Error('PROVIDER_REFUND_MISMATCH')
      }
      return { status: refund.status, idempotent: true }
    }
    if (refund.status !== 'PENDING') {
      throw new Error('REFUND_INVALID_STATE')
    }
    const updated = await tx.query(
      `UPDATE mip_refunds
       SET status = 'PROVIDER_CREATED', provider_refund_id = ?, version = version + 1
       WHERE app_id = ? AND id = ? AND status = 'PENDING' AND version = ?`,
      [input.providerRefundId || null, input.appId, refund.id, refund.version],
    )
    assertAffected(updated, 'REFUND_STATUS_CONFLICT')
    return { status: 'PROVIDER_CREATED', idempotent: false }
  })
}

async function markRefundFailed(db, input) {
  return db.transaction(async (tx) => {
    const refund = await tx.one(
      'SELECT * FROM mip_refunds WHERE app_id = ? AND merchant_refund_no = ? FOR UPDATE',
      [input.appId, input.merchantRefundNo],
    )
    assertRefundIdentity(refund, input)
    if (refund.status === 'FAILED') {
      return { status: 'FAILED', idempotent: true }
    }
    if (!['PENDING', 'PROVIDER_CREATED', 'PROCESSING'].includes(refund.status)) {
      throw new Error('REFUND_INVALID_STATE')
    }
    const updated = await tx.query(
      `UPDATE mip_refunds
       SET status = 'FAILED', last_error_code = ?, version = version + 1
       WHERE app_id = ? AND id = ? AND version = ?`,
      [String(input.reasonCode || 'UNKNOWN').slice(0, 64), input.appId, refund.id, refund.version],
    )
    assertAffected(updated, 'REFUND_STATUS_CONFLICT')
    const order = await tx.one(
      'SELECT * FROM mip_orders WHERE app_id = ? AND id = ? FOR UPDATE',
      [input.appId, refund.order_id],
    )
    const remaining = await reservedRefundTotal(tx, input.appId, refund.order_id)
    const nextStatus = remaining > 0 ? 'PARTIALLY_REFUNDED' : 'PAID'
    await tx.query(
      `UPDATE mip_orders SET status = ?, version = version + 1
       WHERE app_id = ? AND id = ? AND status = 'REFUND_PENDING'`,
      [nextStatus, input.appId, order.id],
    )
    return { status: 'FAILED', idempotent: false }
  })
}

async function applyRefundCallback(db, input, options = {}) {
  const createId = options.createId || randomUUID
  const now = options.now || (() => new Date())
  return db.transaction(async (tx) => {
    const refund = await tx.one(
      'SELECT * FROM mip_refunds WHERE app_id = ? AND merchant_refund_no = ? FOR UPDATE',
      [input.appId, input.merchantRefundNo],
    )
    assertRefundIdentity(refund, input)
    if (Number(refund.amount_cents) !== Number(input.amountCents)) {
      throw new Error('REFUND_AMOUNT_MISMATCH')
    }
    const callback = await claimCallbackReceipt(tx, {
      appId: input.appId,
      callbackType: 'REFUND',
      callbackKey: input.providerRefundId,
      resourceHash: callbackResourceHash('REFUND', input),
    })
    if (refund.status === 'SUCCEEDED') {
      if (refund.provider_refund_id !== input.providerRefundId) {
        throw new Error('PROVIDER_REFUND_MISMATCH')
      }
      await markCallbackProcessed(tx, callback, now())
      return { status: 'SUCCEEDED', idempotent: true }
    }
    if (!['PENDING', 'PROVIDER_CREATED', 'PROCESSING'].includes(refund.status)) {
      throw new Error('REFUND_INVALID_STATE')
    }
    const order = await tx.one(
      'SELECT * FROM mip_orders WHERE app_id = ? AND id = ? FOR UPDATE',
      [input.appId, refund.order_id],
    )
    if (!order || order.merchant_order_no !== input.merchantOrderNo) {
      throw new Error('ORDER_NOT_FOUND')
    }
    const updated = await tx.query(
      `UPDATE mip_refunds
       SET status = 'SUCCEEDED', provider_refund_id = ?, refunded_at = ?, version = version + 1
       WHERE app_id = ? AND id = ? AND version = ?`,
      [input.providerRefundId, now(), input.appId, refund.id, refund.version],
    )
    assertAffected(updated, 'REFUND_STATUS_CONFLICT')
    const refunded = await succeededRefundTotal(tx, input.appId, order.id)
    const nextStatus = refunded >= Number(order.amount_cents) ? 'REFUNDED' : 'PARTIALLY_REFUNDED'
    const orderUpdated = await tx.query(
      `UPDATE mip_orders SET status = ?, version = version + 1
       WHERE app_id = ? AND id = ? AND status = 'REFUND_PENDING' AND version = ?`,
      [nextStatus, input.appId, order.id, order.version],
    )
    assertAffected(orderUpdated, 'ORDER_STATUS_CONFLICT')
    if (order.order_type === 'MEMBERSHIP') {
      await rebuildMembershipEntitlements(tx, input.appId, order.user_id, { createId, now })
    }
    else if (order.order_type === 'EVENT' && nextStatus === 'REFUNDED') {
      const registration = await tx.one(
        `SELECT r.id, o.resource_id AS event_id, r.version
         FROM mip_orders o
         JOIN mip_event_registrations r
           ON r.app_id = o.app_id AND r.order_id = o.id
         WHERE o.app_id = ? AND o.id = ? FOR UPDATE`,
        [input.appId, order.id],
      )
      if (!registration) throw new Error('EVENT_ORDER_INVALID')
      await tx.query(
        `UPDATE mip_event_registrations
         SET status = 'CANCELLED', cancelled_at = ?, version = version + 1
         WHERE app_id = ? AND id = ? AND status = 'CANCELLATION_PENDING'`,
        [now(), input.appId, registration.id],
      )
      await writeOutbox(tx, {
        id: createId(),
        appId: input.appId,
        aggregateType: 'EVENT_REGISTRATION',
        aggregateId: registration.id,
        eventType: 'event.registration_cancelled',
        sourceVersion: Number(registration.version) + 1,
        payload: {
          eventId: registration.event_id,
          userId: order.user_id,
          orderId: order.id,
          refundId: refund.id,
          status: 'CANCELLED',
        },
      })
    }
    await writeOutbox(tx, {
      id: createId(),
      appId: input.appId,
      aggregateType: 'REFUND',
      aggregateId: refund.id,
      eventType: order.order_type === 'EVENT'
        ? 'event.refund_confirmed'
        : 'membership.refund_confirmed',
      sourceVersion: Number(refund.version) + 1,
      payload: { refundId: refund.id, orderId: order.id, userId: order.user_id, orderStatus: nextStatus },
    })
    await writeAudit(tx, {
      appId: input.appId,
      action: 'REFUND_CONFIRMED',
      resourceType: 'REFUND',
      resourceId: refund.id,
      metadata: { orderId: order.id, orderStatus: nextStatus },
    })
    await markCallbackProcessed(tx, callback, now())
    return { status: 'SUCCEEDED', orderStatus: nextStatus, idempotent: false }
  })
}

async function claimCallbackReceipt(tx, input) {
  const callbackKey = String(input.callbackKey || '')
  if (!callbackKey
    || callbackKey.length > 160
    || !/^[0-9A-Za-z_-]+$/.test(callbackKey)) {
    throw new Error('CALLBACK_KEY_INVALID')
  }
  await tx.query(
    `INSERT INTO mip_payment_callbacks (
      app_id, callback_key, callback_type, resource_hash,
      verification_status, processing_status
    ) VALUES (?, ?, ?, ?, 'VERIFIED', 'RECEIVED')
    ON DUPLICATE KEY UPDATE callback_key = VALUES(callback_key)`,
    [input.appId, callbackKey, input.callbackType, input.resourceHash],
  )
  const callback = await tx.one(
    `SELECT callback_key, callback_type, resource_hash, verification_status, processing_status
     FROM mip_payment_callbacks
     WHERE app_id = ? AND callback_type = ? AND callback_key = ? FOR UPDATE`,
    [input.appId, input.callbackType, callbackKey],
  )
  if (!callback
    || callback.verification_status !== 'VERIFIED'
    || callback.resource_hash !== input.resourceHash) {
    throw new Error('CALLBACK_RESOURCE_MISMATCH')
  }
  return { appId: input.appId, callbackKey, callbackType: input.callbackType }
}

async function markCallbackProcessed(tx, callback, processedAt) {
  await tx.query(
    `UPDATE mip_payment_callbacks
     SET processing_status = 'PROCESSED', processed_at = ?, last_error_code = NULL
     WHERE app_id = ? AND callback_type = ? AND callback_key = ?`,
    [processedAt, callback.appId, callback.callbackType, callback.callbackKey],
  )
}

function callbackResourceHash(callbackType, input) {
  const value = callbackType === 'PAYMENT'
    ? [input.orderId, input.merchantOrderNo, input.providerTransactionId, Number(input.amountCents), input.currency || 'CNY']
    : [input.merchantOrderNo, input.merchantRefundNo, input.providerRefundId, Number(input.amountCents)]
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

async function rebuildMembershipEntitlements(tx, appId, userId, options = {}) {
  const createId = options.createId || randomUUID
  const now = options.now || (() => new Date())
  const orders = await tx.query(
    `SELECT id, membership_plan_id, paid_at, product_snapshot_json
     FROM mip_orders
     WHERE app_id = ? AND user_id = ? AND order_type = 'MEMBERSHIP' AND status = 'PAID'
     ORDER BY paid_at ASC, created_at ASC, id ASC
     FOR UPDATE`,
    [appId, userId],
  )
  const existing = await tx.query(
    `SELECT id, order_id FROM mip_membership_entitlements
     WHERE app_id = ? AND user_id = ? FOR UPDATE`,
    [appId, userId],
  )
  const existingByOrder = new Map(existing.map(row => [row.order_id, row.id]))
  const paidOrderIds = new Set(orders.map(row => row.id))
  let chainEnd
  for (const order of orders) {
    const paidAt = new Date(order.paid_at)
    const snapshot = parseJson(order.product_snapshot_json)
    const durationDays = Number(snapshot.durationDays)
    if (!Number.isInteger(durationDays) || durationDays < 1 || !Number.isFinite(paidAt.getTime())) {
      throw new Error('ENTITLEMENT_SOURCE_INVALID')
    }
    const startsAt = chainEnd && chainEnd.getTime() > paidAt.getTime() ? chainEnd : paidAt
    chainEnd = new Date(startsAt.getTime() + durationDays * 86_400_000)
    const status = chainEnd.getTime() > now().getTime() ? 'ACTIVE' : 'EXPIRED'
    const entitlementId = existingByOrder.get(order.id) || createId()
    await tx.query(
      `INSERT INTO mip_membership_entitlements (
        id, app_id, user_id, order_id, plan_id, status, starts_at, ends_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        status = VALUES(status), starts_at = VALUES(starts_at), ends_at = VALUES(ends_at),
        revoked_at = NULL, revocation_reason = NULL, version = version + 1`,
      [
        entitlementId,
        appId,
        userId,
        order.id,
        order.membership_plan_id,
        status,
        startsAt,
        chainEnd,
      ],
    )
    const attribution = membershipAttribution(snapshot, userId)
    await tx.query(
      `INSERT IGNORE INTO mip_membership_attributions (
        app_id, entitlement_id, invited_by_user_id, source_type, source_token_hash, locked_at
      ) VALUES (?, ?, ?, ?, ?, ?)`,
      [
        appId,
        entitlementId,
        attribution.invitedByUserId,
        attribution.sourceType,
        attribution.sourceTokenHash,
        now(),
      ],
    )
  }
  for (const entitlement of existing) {
    if (!paidOrderIds.has(entitlement.order_id)) {
      await tx.query(
        `UPDATE mip_membership_entitlements
         SET status = 'REFUNDED', revoked_at = ?, revocation_reason = 'ORDER_REFUNDED',
             version = version + 1
         WHERE app_id = ? AND id = ? AND status <> 'REFUNDED'`,
        [now(), appId, entitlement.id],
      )
    }
  }
}

function membershipAttribution(snapshot, memberUserId) {
  const value = snapshot?.attribution
  if (!value || value.sourceType === 'PLATFORM') {
    return { sourceType: 'PLATFORM', invitedByUserId: null, sourceTokenHash: null }
  }
  if (value.sourceType !== 'USER'
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.invitedByUserId || '')
    || value.invitedByUserId === memberUserId
    || !/^[0-9a-f]{64}$/i.test(value.sourceTokenHash || '')) {
    throw new Error('ENTITLEMENT_SOURCE_INVALID')
  }
  return {
    sourceType: 'USER',
    invitedByUserId: value.invitedByUserId,
    sourceTokenHash: value.sourceTokenHash,
  }
}

async function succeededRefundTotal(tx, appId, orderId) {
  const row = await tx.one(
    `SELECT COALESCE(SUM(amount_cents), 0) AS total
     FROM mip_refunds WHERE app_id = ? AND order_id = ? AND status = 'SUCCEEDED'`,
    [appId, orderId],
  )
  return Number(row?.total || 0)
}

async function reservedRefundTotal(tx, appId, orderId) {
  const row = await tx.one(
    `SELECT COALESCE(SUM(amount_cents), 0) AS total
     FROM mip_refunds
     WHERE app_id = ? AND order_id = ?
       AND status IN ('PENDING', 'PROVIDER_CREATED', 'PROCESSING', 'SUCCEEDED')`,
    [appId, orderId],
  )
  return Number(row?.total || 0)
}

function assertRefundIdentity(refund, input) {
  if (!refund || refund.merchant_refund_no !== input.merchantRefundNo) {
    throw new Error('REFUND_NOT_FOUND')
  }
  if (refund.provider_refund_id
    && input.providerRefundId
    && refund.provider_refund_id !== input.providerRefundId) {
    throw new Error('PROVIDER_REFUND_MISMATCH')
  }
}

function assertAffected(result, code) {
  if (!result || result.affectedRows !== 1) {
    throw new Error(code)
  }
}

async function writeOutbox(tx, event) {
  await tx.query(
    `INSERT INTO mip_outbox_events (
      id, app_id, aggregate_type, aggregate_id, event_type, source_version, payload_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      event.id,
      event.appId,
      event.aggregateType,
      event.aggregateId,
      event.eventType,
      event.sourceVersion,
      JSON.stringify(event.payload),
    ],
  )
}

async function writeAudit(tx, audit) {
  await tx.query(
    `INSERT INTO mip_audit_logs (
      app_id, actor_type, scope_type, action, resource_type, resource_id, metadata_json
    ) VALUES (?, 'PAYMENT', 'PLATFORM', ?, ?, ?, ?)`,
    [
      audit.appId,
      audit.action,
      audit.resourceType,
      audit.resourceId,
      JSON.stringify(audit.metadata),
    ],
  )
}

function parseJson(value) {
  if (value && typeof value === 'object') {
    return value
  }
  try {
    return JSON.parse(value || '{}')
  }
  catch {
    return {}
  }
}

module.exports = {
  applyPaymentCallback,
  applyRefundCallback,
  assertPaymentMatches,
  getPayableOrder,
  getRefundRequest,
  getRefundRequestForProvider,
  listPendingRefunds,
  markPaymentCreated,
  markRefundCreated,
  markRefundFailed,
  membershipAttribution,
  rebuildMembershipEntitlements,
}
