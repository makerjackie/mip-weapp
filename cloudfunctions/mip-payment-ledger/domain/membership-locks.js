'use strict'

const lockedChain = Symbol('lockedMembershipChain')

async function readPaymentRoute(db, input) {
  const row = await db.one(
    `SELECT order_row.id AS order_id, order_row.app_id, order_row.user_id,
            order_row.order_type, order_row.merchant_order_no,
            order_row.amount_cents, order_row.currency,
            identity.id AS identity_id, identity.identity_key,
            identity.closed_identity_key
     FROM mip_orders order_row
     INNER JOIN mip_user_identities identity
       ON identity.app_id = order_row.app_id AND identity.user_id = order_row.user_id
        AND identity.provider = 'WECHAT_MINIPROGRAM' AND identity.identity_key = ?
     WHERE order_row.app_id = ? AND order_row.id = ?`,
    [input.identityKey, input.appId, input.orderId],
  )
  if (!row) throw new Error('ORDER_NOT_FOUND')
  return paymentRoute(row)
}

async function lockPaymentIdentity(tx, route) {
  const identity = await tx.one(
    `SELECT id, app_id, user_id, provider, identity_key, closed_identity_key
     FROM mip_user_identities
     WHERE app_id = ? AND id = ? FOR UPDATE`,
    [route.appId, route.identityId],
  )
  if (!identity
    || identity.id !== route.identityId
    || identity.app_id !== route.appId
    || identity.user_id !== route.userId
    || identity.provider !== 'WECHAT_MINIPROGRAM'
    || identity.identity_key !== route.identityKey
    || nullableIdentityKey(identity.closed_identity_key) !== route.closedIdentityKey) {
    throw new Error('PAYMENT_IDENTITY_CHANGED')
  }
  return identity
}

async function readRefundRoute(db, input) {
  const row = await db.one(
    `SELECT refund.id AS refund_id, refund.order_id, refund.app_id,
            refund.merchant_refund_no,
            refund.amount_cents AS refund_amount_cents,
            order_row.user_id, order_row.order_type, order_row.merchant_order_no,
            order_row.amount_cents AS order_amount_cents,
            order_row.currency
     FROM mip_refunds refund
     INNER JOIN mip_orders order_row
       ON order_row.app_id = refund.app_id AND order_row.id = refund.order_id
     WHERE refund.app_id = ? AND refund.merchant_refund_no = ?`,
    [input.appId, input.merchantRefundNo],
  )
  if (!row || (input.refundId && row.refund_id !== input.refundId)) {
    throw new Error('REFUND_NOT_FOUND')
  }
  return refundRoute(row)
}

async function lockMembershipChain(tx, route) {
  if (!route || route.orderType !== 'MEMBERSHIP') {
    throw new Error('MEMBERSHIP_CHAIN_ROUTE_INVALID')
  }
  let row = await tx.one(
    `SELECT app_id, user_id, version
     FROM mip_membership_chains
     WHERE app_id = ? AND user_id = ? FOR UPDATE`,
    [route.appId, route.userId],
  )
  if (!row) {
    await tx.query(
      `INSERT INTO mip_membership_chains (app_id, user_id)
       SELECT user_row.app_id, user_row.id
       FROM mip_users user_row
       WHERE user_row.app_id = ? AND user_row.id = ?
       ON DUPLICATE KEY UPDATE version = mip_membership_chains.version`,
      [route.appId, route.userId],
    )
    row = await tx.one(
      `SELECT app_id, user_id, version
       FROM mip_membership_chains
       WHERE app_id = ? AND user_id = ? FOR UPDATE`,
      [route.appId, route.userId],
    )
  }
  if (!row || row.app_id !== route.appId || row.user_id !== route.userId) {
    throw new Error('MEMBERSHIP_CHAIN_NOT_FOUND')
  }
  const version = Number(row.version)
  if (!Number.isSafeInteger(version) || version < 1) {
    throw new Error('MEMBERSHIP_CHAIN_INVALID')
  }
  return {
    appId: row.app_id,
    userId: row.user_id,
    version,
    [lockedChain]: true,
  }
}

async function incrementMembershipChain(tx, chain) {
  assertLockedMembershipChain(chain, chain.appId, chain.userId)
  const updated = await tx.query(
    `UPDATE mip_membership_chains
     SET version = version + 1
     WHERE app_id = ? AND user_id = ? AND version = ?`,
    [chain.appId, chain.userId, chain.version],
  )
  if (!updated || updated.affectedRows !== 1) {
    throw new Error('MEMBERSHIP_CHAIN_VERSION_CONFLICT')
  }
  chain.version += 1
  return chain.version
}

function assertLockedMembershipChain(chain, appId, userId) {
  if (!chain
    || chain[lockedChain] !== true
    || chain.appId !== appId
    || chain.userId !== userId
    || !Number.isSafeInteger(chain.version)
    || chain.version < 1) {
    throw new Error('MEMBERSHIP_CHAIN_LOCK_REQUIRED')
  }
}

function assertPaymentRoute(route, order) {
  if (!order
    || route.appId !== order.app_id
    || route.orderId !== order.id
    || route.userId !== order.user_id
    || route.orderType !== order.order_type
    || route.merchantOrderNo !== order.merchant_order_no
    || route.amountCents !== Number(order.amount_cents)
    || route.currency !== order.currency) {
    throw new Error('PAYMENT_ROUTE_CHANGED')
  }
}

function assertRefundRoute(route, order, refund) {
  if (!order
    || route.appId !== order.app_id
    || route.orderId !== order.id
    || route.userId !== order.user_id
    || route.orderType !== order.order_type
    || route.merchantOrderNo !== order.merchant_order_no
    || route.orderAmountCents !== Number(order.amount_cents)
    || route.currency !== order.currency) {
    throw new Error('REFUND_ROUTE_CHANGED')
  }
  if (!refund
    || route.appId !== refund.app_id
    || route.refundId !== refund.id
    || route.orderId !== refund.order_id
    || route.merchantRefundNo !== refund.merchant_refund_no
    || route.refundAmountCents !== Number(refund.amount_cents)) {
    throw new Error('REFUND_ROUTE_CHANGED')
  }
}

function paymentRoute(row) {
  return {
    appId: row.app_id,
    orderId: row.order_id,
    userId: row.user_id,
    orderType: row.order_type,
    merchantOrderNo: row.merchant_order_no,
    amountCents: Number(row.amount_cents),
    currency: row.currency,
    identityId: row.identity_id,
    identityKey: row.identity_key,
    closedIdentityKey: nullableIdentityKey(row.closed_identity_key),
  }
}

function refundRoute(row) {
  return {
    appId: row.app_id,
    orderId: row.order_id,
    refundId: row.refund_id,
    userId: row.user_id,
    orderType: row.order_type,
    merchantOrderNo: row.merchant_order_no,
    merchantRefundNo: row.merchant_refund_no,
    refundAmountCents: Number(row.refund_amount_cents),
    orderAmountCents: Number(row.order_amount_cents),
    currency: row.currency,
  }
}

function nullableIdentityKey(value) {
  return value === null || value === undefined || value === '' ? null : value
}

module.exports = {
  assertLockedMembershipChain,
  assertPaymentRoute,
  assertRefundRoute,
  incrementMembershipChain,
  lockPaymentIdentity,
  lockMembershipChain,
  readPaymentRoute,
  readRefundRoute,
}
