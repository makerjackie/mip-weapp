'use strict'

const { createHash, randomUUID } = require('node:crypto')
const { rebuildMembershipEntitlements } = require('./ledger')
const { lockMembershipChain } = require('./membership-locks')

const ownerTestMembershipSource = 'OWNER_TEST_MEMBERSHIP'
const platformScopeId = '00000000-0000-0000-0000-000000000000'

async function grantOwnerTestMembership(db, input, options = {}) {
  assertOwnerTestMembershipEnvironment(input)
  const createId = options.createId || randomUUID
  const now = options.now || (() => new Date())
  return db.transaction(async (tx) => {
    const operationAt = now()
    if (!Number.isFinite(operationAt.getTime())) throw new Error('TEST_MEMBERSHIP_TIME_INVALID')
    const { owner, plan } = await storageStep(
      'TEST_MEMBERSHIP_CONTEXT_STORAGE_ERROR',
      () => ownerTestMembershipContext(tx, input, { requireActivePlan: true }),
    )
    const membershipChain = await storageStep(
      'TEST_MEMBERSHIP_CHAIN_STORAGE_ERROR',
      () => lockMembershipChain(tx, membershipRoute(input.appId, owner.id)),
    )
    const state = await storageStep(
      'TEST_MEMBERSHIP_MANAGED_READ_STORAGE_ERROR',
      () => lockOwnerTestMembershipState(tx, input.appId, owner.id),
    )
    const managed = managedOwnerTestMembershipOrders(state)
    const membershipActive = activeMembership(state, operationAt)
    if (managed.length > 1) throw new Error('TEST_MEMBERSHIP_STATE_CONFLICT')
    if (managed.length === 1) {
      assertManagedTestMembershipOrder(managed[0], plan)
      return result('GRANT', membershipActive, true, true)
    }
    if (membershipActive) return result('GRANT', true, false, true)

    const paidAt = operationAt
    const orderId = createId()
    const attemptId = createId()
    const providerTransactionId = testProviderNumber('TESTPAY', orderId)
    const requestHash = createHash('sha256').update(JSON.stringify({
      appId: input.appId,
      operation: 'GRANT',
      orderId,
      planKey: plan.plan_key,
      userId: owner.id,
    })).digest('hex')
    await storageStep('TEST_MEMBERSHIP_ORDER_WRITE_STORAGE_ERROR', () => tx.query(
      `INSERT INTO mip_orders (
        id, app_id, user_id, order_type, membership_plan_id, merchant_order_no,
        provider_transaction_id, idempotency_key, amount_cents, currency, status,
        product_snapshot_json, paid_at
      ) VALUES (?, ?, ?, 'MEMBERSHIP', ?, ?, NULL, ?, ?, 'CNY', 'PAYMENT_CREATED', ?, NULL)`,
      [
        orderId,
        input.appId,
        owner.id,
        plan.id,
        testProviderNumber('MIPT', orderId),
        `owner-test-membership:${orderId}`,
        Number(plan.price_cents),
        JSON.stringify(ownerTestMembershipSnapshot(plan)),
      ],
    ))
    await storageStep('TEST_MEMBERSHIP_ATTEMPT_WRITE_STORAGE_ERROR', () => tx.query(
      `INSERT INTO mip_payment_attempts (
        id, app_id, order_id, provider, provider_payment_id, prepay_id,
        request_hash, status
      ) VALUES (?, ?, ?, 'TEST', NULL, NULL, ?, 'PARAMETERS_ISSUED')`,
      [attemptId, input.appId, orderId, requestHash],
    ))
    assertAffected(await storageStep('TEST_MEMBERSHIP_ORDER_TRANSITION_STORAGE_ERROR', () => tx.query(
      `UPDATE mip_orders
       SET status = 'PAID', provider_transaction_id = ?, paid_at = ?, version = version + 1
       WHERE app_id = ? AND id = ? AND status = 'PAYMENT_CREATED' AND version = 1`,
      [providerTransactionId, paidAt, input.appId, orderId],
    )), 'ORDER_STATUS_CONFLICT')
    assertAffected(await storageStep('TEST_MEMBERSHIP_ATTEMPT_TRANSITION_STORAGE_ERROR', () => tx.query(
      `UPDATE mip_payment_attempts
       SET provider_payment_id = ?, status = 'SUCCEEDED', version = version + 1
       WHERE app_id = ? AND id = ? AND order_id = ?
         AND provider = 'TEST' AND status = 'PARAMETERS_ISSUED' AND version = 1`,
      [providerTransactionId, input.appId, attemptId, orderId],
    )), 'PAYMENT_ATTEMPT_STATUS_CONFLICT')
    await storageStep(
      'TEST_MEMBERSHIP_ENTITLEMENT_WRITE_STORAGE_ERROR',
      () => rebuildMembershipEntitlements(tx, input.appId, owner.id, {
        chain: membershipChain,
        createId,
        now: () => operationAt,
      }),
    )
    await storageStep('TEST_MEMBERSHIP_OUTBOX_WRITE_STORAGE_ERROR', () => writeOutbox(tx, {
      id: createId(),
      appId: input.appId,
      aggregateType: 'ORDER',
      aggregateId: orderId,
      eventType: 'membership.payment_confirmed',
      sourceVersion: 2,
      payload: { orderId, userId: owner.id, orderType: 'MEMBERSHIP' },
    }))
    await storageStep('TEST_MEMBERSHIP_AUDIT_WRITE_STORAGE_ERROR', () => writeAudit(tx, {
      appId: input.appId,
      action: 'OWNER_TEST_MEMBERSHIP_GRANTED',
      resourceType: 'ORDER',
      resourceId: orderId,
      metadata: { catalogStage: 'TEST', planKey: plan.plan_key, source: ownerTestMembershipSource },
    }))
    return result('GRANT', true, true, false)
  })
}

async function revokeOwnerTestMembership(db, input, options = {}) {
  assertOwnerTestMembershipEnvironment(input)
  const createId = options.createId || randomUUID
  const now = options.now || (() => new Date())
  return db.transaction(async (tx) => {
    const operationAt = now()
    if (!Number.isFinite(operationAt.getTime())) throw new Error('TEST_MEMBERSHIP_TIME_INVALID')
    const { owner, plan } = await storageStep(
      'TEST_MEMBERSHIP_CONTEXT_STORAGE_ERROR',
      () => ownerTestMembershipContext(tx, input, { requireActivePlan: false }),
    )
    const membershipChain = await storageStep(
      'TEST_MEMBERSHIP_CHAIN_STORAGE_ERROR',
      () => lockMembershipChain(tx, membershipRoute(input.appId, owner.id)),
    )
    const state = await storageStep(
      'TEST_MEMBERSHIP_MANAGED_READ_STORAGE_ERROR',
      () => lockOwnerTestMembershipState(tx, input.appId, owner.id),
    )
    const managed = managedOwnerTestMembershipOrders(state)
    const membershipActive = activeMembership(state, operationAt)
    if (managed.length > 1) throw new Error('TEST_MEMBERSHIP_STATE_CONFLICT')
    if (managed.length === 0) {
      return result('REVOKE', membershipActive, false, true)
    }
    const order = managed[0]
    assertManagedTestMembershipOrder(order, plan)
    if (order.status === 'REFUND_PENDING') {
      return result('REVOKE', membershipActive, true, true)
    }
    const revokedAt = operationAt
    const refundId = createId()
    const providerRefundId = testProviderNumber('TESTREFUND', refundId)
    await storageStep('TEST_MEMBERSHIP_REFUND_WRITE_STORAGE_ERROR', () => tx.query(
      `INSERT INTO mip_refunds (
        id, app_id, order_id, requested_by_user_id, provider_refund_id,
        merchant_refund_no, idempotency_key, amount_cents, reason, status, refunded_at
      ) VALUES (?, ?, ?, NULL, NULL, ?, ?, ?, '撤销 Owner 测试会员', 'PENDING', NULL)`,
      [
        refundId,
        input.appId,
        order.id,
        testProviderNumber('MIPTR', refundId),
        `owner-test-membership-revoke:${order.id}`,
        Number(order.amount_cents),
      ],
    ))
    assertAffected(await storageStep('TEST_MEMBERSHIP_REFUND_ORDER_TRANSITION_STORAGE_ERROR', () => tx.query(
      `UPDATE mip_orders
       SET status = 'REFUND_PENDING', version = version + 1
       WHERE app_id = ? AND id = ? AND status = 'PAID' AND version = ?`,
      [input.appId, order.id, order.version],
    )), 'ORDER_STATUS_CONFLICT')
    assertAffected(await storageStep('TEST_MEMBERSHIP_REFUND_TRANSITION_STORAGE_ERROR', () => tx.query(
      `UPDATE mip_refunds
       SET status = 'SUCCEEDED', provider_refund_id = ?, refunded_at = ?, version = version + 1
       WHERE app_id = ? AND id = ? AND order_id = ? AND status = 'PENDING' AND version = 1`,
      [providerRefundId, revokedAt, input.appId, refundId, order.id],
    )), 'REFUND_STATUS_CONFLICT')
    assertAffected(await storageStep('TEST_MEMBERSHIP_REFUND_ORDER_FINALIZE_STORAGE_ERROR', () => tx.query(
      `UPDATE mip_orders
       SET status = 'REFUNDED', version = version + 1
       WHERE app_id = ? AND id = ? AND status = 'REFUND_PENDING' AND version = ?`,
      [input.appId, order.id, Number(order.version) + 1],
    )), 'ORDER_STATUS_CONFLICT')
    const rebuilt = await storageStep(
      'TEST_MEMBERSHIP_ENTITLEMENT_WRITE_STORAGE_ERROR',
      () => rebuildMembershipEntitlements(tx, input.appId, owner.id, {
        chain: membershipChain,
        createId,
        now: () => operationAt,
      }),
    )
    await storageStep('TEST_MEMBERSHIP_OUTBOX_WRITE_STORAGE_ERROR', () => writeOutbox(tx, {
      id: createId(),
      appId: input.appId,
      aggregateType: 'REFUND',
      aggregateId: refundId,
      eventType: 'membership.refund_confirmed',
      sourceVersion: 2,
      payload: { refundId, orderId: order.id, userId: owner.id, orderStatus: 'REFUNDED' },
    }))
    await storageStep('TEST_MEMBERSHIP_AUDIT_WRITE_STORAGE_ERROR', () => writeAudit(tx, {
      appId: input.appId,
      action: 'OWNER_TEST_MEMBERSHIP_REVOKED',
      resourceType: 'REFUND',
      resourceId: refundId,
      metadata: { catalogStage: 'TEST', orderId: order.id, planKey: plan.plan_key, source: ownerTestMembershipSource },
    }))
    return result('REVOKE', rebuilt.membershipActive, true, false)
  })
}

function assertOwnerTestMembershipEnvironment(input) {
  const deploymentStage = String(input.deploymentStage || '').trim().toLowerCase()
  const catalogStage = String(input.catalogStage || '').trim().toUpperCase()
  const paymentMode = String(input.paymentMode || '').trim().toLowerCase()
  if (!['development', 'test', 'staging'].includes(deploymentStage)
    || catalogStage !== 'TEST'
    || !['disabled', 'test'].includes(paymentMode)) {
    throw new Error('TEST_MEMBERSHIP_DISABLED')
  }
  if (!/^[a-z0-9][a-z0-9_-]{1,63}$/.test(String(input.planKey || ''))) {
    throw new Error('TEST_MEMBERSHIP_PLAN_INVALID')
  }
}

async function ownerTestMembershipContext(tx, input, options = {}) {
  const owners = await tx.query(
    `SELECT user_row.id
     FROM mip_users user_row
     INNER JOIN mip_user_identities identity
       ON identity.app_id = user_row.app_id AND identity.user_id = user_row.id
        AND identity.provider = 'WECHAT_MINIPROGRAM'
     INNER JOIN mip_admin_role_bindings binding
       ON binding.app_id = user_row.app_id AND binding.user_id = user_row.id
        AND binding.scope_type = 'PLATFORM' AND binding.scope_id = ?
        AND binding.role_key = 'PLATFORM_OWNER' AND binding.status = 'ACTIVE'
     WHERE user_row.app_id = ? AND user_row.status = 'ACTIVE'
       AND NOT EXISTS (
         SELECT 1 FROM mip_app_settings demo_manifest
         WHERE demo_manifest.app_id = user_row.app_id
           AND demo_manifest.setting_key LIKE 'demo_seed_manifest%'
           AND JSON_UNQUOTE(JSON_EXTRACT(demo_manifest.value_json, '$.is_demo')) = '1'
           AND JSON_SEARCH(
             JSON_EXTRACT(demo_manifest.value_json, '$.recordIds.users'),
             'one', user_row.id
           ) IS NOT NULL
       )
     ORDER BY user_row.id LIMIT 2 FOR UPDATE`,
    [platformScopeId, input.appId],
  )
  if (owners.length !== 1) throw new Error('OWNER_NOT_UNIQUE')
  const plan = await tx.one(
    `SELECT id, plan_key, catalog_stage, name, duration_days, price_cents,
            currency, benefits_json, status, version
     FROM mip_membership_plans
     WHERE app_id = ? AND catalog_stage = 'TEST' AND plan_key = ?
     LIMIT 1`,
    [input.appId, input.planKey],
  )
  if (!plan || (options.requireActivePlan && plan.status !== 'ACTIVE')) {
    throw new Error('TEST_MEMBERSHIP_PLAN_NOT_AVAILABLE')
  }
  const durationDays = Number(plan.duration_days)
  const amountCents = Number(plan.price_cents)
  if (!Number.isInteger(durationDays)
    || durationDays < 1
    || !Number.isInteger(amountCents)
    || amountCents < 1
    || plan.currency !== 'CNY') {
    throw new Error('TEST_MEMBERSHIP_PLAN_INVALID')
  }
  return { owner: owners[0], plan }
}

async function lockOwnerTestMembershipState(tx, appId, userId) {
  const orders = await tx.query(
    `SELECT order_row.id, order_row.membership_plan_id, order_row.amount_cents,
            order_row.status, order_row.version, order_row.product_snapshot_json,
            order_row.paid_at, order_row.created_at
     FROM mip_orders order_row
     WHERE order_row.app_id = ? AND order_row.user_id = ?
       AND order_row.order_type = 'MEMBERSHIP'
     ORDER BY order_row.created_at ASC, order_row.id ASC FOR UPDATE`,
    [appId, userId],
  )
  const refunds = await tx.query(
    `SELECT refund.id, refund.order_id, refund.status, refund.created_at
     FROM mip_refunds refund
     INNER JOIN mip_orders order_row
       ON order_row.app_id = refund.app_id AND order_row.id = refund.order_id
     WHERE order_row.app_id = ? AND order_row.user_id = ?
       AND order_row.order_type = 'MEMBERSHIP'
     ORDER BY refund.order_id ASC, refund.created_at ASC, refund.id ASC FOR UPDATE`,
    [appId, userId],
  )
  const entitlements = await tx.query(
    `SELECT id, order_id, plan_id, source_type, source_adjustment_id,
            status, starts_at, ends_at, revoked_at, revocation_reason, version
     FROM mip_membership_entitlements
     WHERE app_id = ? AND user_id = ?
     ORDER BY starts_at ASC, id ASC FOR UPDATE`,
    [appId, userId],
  )
  return { orders, refunds, entitlements }
}

function managedOwnerTestMembershipOrders(state) {
  return state.orders.flatMap((order) => {
    if (!['PAID', 'REFUND_PENDING'].includes(order.status)) return []
    const snapshot = parseJson(order.product_snapshot_json)
    if (snapshot.operationSource !== ownerTestMembershipSource) return []
    if (succeededRefundExists(state, order.id)) return []
    return [{ ...order, snapshot_catalog_stage: snapshot.catalogStage }]
  })
}

function assertManagedTestMembershipOrder(order, plan) {
  if (!order
    || !['PAID', 'REFUND_PENDING'].includes(order.status)
    || order.snapshot_catalog_stage !== 'TEST'
    || order.membership_plan_id !== plan.id
    || plan.catalog_stage !== 'TEST') {
    throw new Error('TEST_MEMBERSHIP_STATE_CONFLICT')
  }
}

function activeMembership(state, now) {
  return state.entitlements.some((entitlement) => {
    if (!activeEntitlement(entitlement, now)) return false
    if (entitlement.source_type === 'ADMIN_ADJUSTMENT') {
      return entitlement.order_id === null
        && entitlement.plan_id === null
        && Boolean(entitlement.source_adjustment_id)
    }
    if (entitlement.source_type !== 'ORDER' || !entitlement.order_id) return false
    const order = state.orders.find(item => item.id === entitlement.order_id)
    return Boolean(order
      && ['PAID', 'REFUND_PENDING'].includes(order.status)
      && !succeededRefundExists(state, order.id))
  })
}

function activeEntitlement(entitlement, now) {
  const startsAt = new Date(entitlement.starts_at)
  const endsAt = new Date(entitlement.ends_at)
  return entitlement.status === 'ACTIVE'
    && Number.isFinite(startsAt.getTime())
    && Number.isFinite(endsAt.getTime())
    && startsAt.getTime() <= now.getTime()
    && endsAt.getTime() > now.getTime()
}

function succeededRefundExists(state, orderId) {
  return state.refunds.some(refund => refund.order_id === orderId && refund.status === 'SUCCEEDED')
}

function membershipRoute(appId, userId) {
  return { appId, userId, orderType: 'MEMBERSHIP' }
}

function ownerTestMembershipSnapshot(plan) {
  const benefits = parseJson(plan.benefits_json)
  return {
    planKey: plan.plan_key,
    name: plan.name,
    durationDays: Number(plan.duration_days),
    priceCents: Number(plan.price_cents),
    currency: 'CNY',
    catalogStage: 'TEST',
    benefits: Array.isArray(benefits)
      ? benefits.filter(value => typeof value === 'string').slice(0, 30)
      : [],
    version: Number(plan.version),
    attribution: { sourceType: 'PLATFORM' },
    operationSource: ownerTestMembershipSource,
  }
}

function result(operation, membershipActive, managed, idempotent) {
  return {
    operation,
    status: membershipActive ? 'ACTIVE' : 'INACTIVE',
    membershipActive,
    managed,
    idempotent,
  }
}

function testProviderNumber(prefix, id) {
  const compact = String(id || '').replace(/[^0-9A-Za-z]/g, '').toUpperCase()
  if (!compact) throw new Error('TEST_MEMBERSHIP_ID_INVALID')
  return `${prefix}${compact}`.slice(0, 64)
}

function assertAffected(value, code) {
  if (!value || value.affectedRows !== 1) throw new Error(code)
}

async function storageStep(code, work) {
  try {
    return await work()
  }
  catch (error) {
    if (error instanceof Error && /^[A-Z][A-Z0-9_:]+$/.test(error.message)) {
      throw error
    }
    const storageCode = typeof error?.code === 'string' && /^[A-Z][A-Z0-9_]+$/.test(error.code)
      ? error.code
      : 'UNKNOWN'
    console.error('[owner-test-membership]', code, storageCode)
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
  if (value && typeof value === 'object') return value
  try {
    return JSON.parse(value || '{}')
  }
  catch {
    return {}
  }
}

module.exports = {
  assertOwnerTestMembershipEnvironment,
  grantOwnerTestMembership,
  revokeOwnerTestMembership,
}
