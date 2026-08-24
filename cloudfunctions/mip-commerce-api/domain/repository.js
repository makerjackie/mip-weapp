'use strict'

const { assertFullAccessUser, createFullAccessPolicy } = require('./full-access')

const USER_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function createCommerceRepository(database, options = {}) {
  const fullAccess = options.fullAccessPolicy || createFullAccessPolicy({
    agreements: options.agreements,
  })

  async function resolveUserId(queryable, caller, lock = false) {
    const row = await queryable.one(
      `SELECT user_id
       FROM mip_user_identities
       WHERE app_id = ? AND provider = 'WECHAT_MINIPROGRAM' AND identity_key = ?
       LIMIT 1${lock ? ' FOR UPDATE' : ''}`,
      [caller.appId, caller.identityKey],
    )
    if (!row) {
      throw new Error('AUTH_REQUIRED')
    }
    return row.user_id
  }

  async function listPlans(appId, catalogStage) {
    return database.query(
      `SELECT id, plan_key, catalog_stage, name, description, duration_days, price_cents,
              currency, benefits_json, status, version
       FROM mip_membership_plans
       WHERE app_id = ? AND catalog_stage = ? AND status = 'ACTIVE'
       ORDER BY price_cents ASC, id ASC`,
      [appId, catalogStage],
    )
  }

  async function getMembershipBenefits(caller) {
    const row = await database.one(
      `SELECT e.id, e.status, e.starts_at, e.ends_at, e.version,
              e.plan_id, p.name AS plan_name, p.description AS plan_description,
              p.benefits_json, o.product_snapshot_json,
              attribution.source_type AS invitation_source_type,
              inviter_profile.nickname AS inviter_nickname,
              inviter_profile.visibility_json AS inviter_visibility_json,
              inviter_avatar.cloud_file_id AS inviter_avatar_file_id,
              (
                SELECT MAX(chain.ends_at)
                FROM mip_membership_entitlements chain
                WHERE chain.app_id = e.app_id AND chain.user_id = e.user_id
                  AND chain.status = 'ACTIVE' AND chain.ends_at > UTC_TIMESTAMP(3)
              ) AS membership_ends_at
       FROM mip_user_identities i
       INNER JOIN mip_users u
         ON u.app_id = i.app_id AND u.id = i.user_id AND u.status = 'ACTIVE'
       INNER JOIN mip_membership_entitlements e
         ON e.app_id = u.app_id AND e.user_id = u.id
        AND e.status = 'ACTIVE'
        AND e.starts_at <= UTC_TIMESTAMP(3) AND e.ends_at > UTC_TIMESTAMP(3)
       INNER JOIN mip_membership_plans p
         ON p.app_id = e.app_id AND p.id = e.plan_id
       INNER JOIN mip_orders o
         ON o.app_id = e.app_id AND o.id = e.order_id
       LEFT JOIN mip_membership_attributions attribution
         ON attribution.app_id = e.app_id AND attribution.entitlement_id = e.id
       LEFT JOIN mip_users inviter
         ON inviter.app_id = attribution.app_id AND inviter.id = attribution.invited_by_user_id
        AND inviter.status = 'ACTIVE'
       LEFT JOIN mip_profiles inviter_profile
         ON inviter_profile.app_id = inviter.app_id AND inviter_profile.user_id = inviter.id
       LEFT JOIN mip_media_assets inviter_avatar
         ON inviter_avatar.app_id = inviter_profile.app_id
        AND inviter_avatar.id = inviter_profile.avatar_asset_id AND inviter_avatar.status = 'READY'
       WHERE i.app_id = ? AND i.provider = 'WECHAT_MINIPROGRAM' AND i.identity_key = ?
       ORDER BY e.starts_at DESC, e.id DESC
       LIMIT 1`,
      [caller.appId, caller.identityKey],
    )
    return membershipBenefitsDto(row)
  }

  async function resolveMembershipInviter(caller) {
    const row = await database.one(
      `SELECT u.id
       FROM mip_user_identities i
       JOIN mip_users u
         ON u.app_id = i.app_id AND u.id = i.user_id AND u.status = 'ACTIVE'
       WHERE i.app_id = ? AND i.provider = 'WECHAT_MINIPROGRAM' AND i.identity_key = ?
         AND EXISTS (
           SELECT 1 FROM mip_membership_entitlements e
           WHERE e.app_id = u.app_id AND e.user_id = u.id AND e.status = 'ACTIVE'
             AND e.starts_at <= UTC_TIMESTAMP(3) AND e.ends_at > UTC_TIMESTAMP(3)
         )
       LIMIT 1`,
      [caller.appId, caller.identityKey],
    )
    if (!row) {
      throw new Error('MEMBERSHIP_INVITATION_FORBIDDEN')
    }
    return row.id
  }

  async function assertMembershipInviter(appId, userId) {
    const row = await database.one(
      `SELECT u.id
       FROM mip_users u
       WHERE u.app_id = ? AND u.id = ? AND u.status = 'ACTIVE'
         AND EXISTS (
           SELECT 1 FROM mip_membership_entitlements e
           WHERE e.app_id = u.app_id AND e.user_id = u.id AND e.status = 'ACTIVE'
             AND e.starts_at <= UTC_TIMESTAMP(3) AND e.ends_at > UTC_TIMESTAMP(3)
         )
       LIMIT 1`,
      [appId, userId],
    )
    if (!row) throw new Error('MEMBERSHIP_INVITATION_INVALID')
    return row.id
  }

  async function createCheckout(caller, input, ids, deriveCheckout) {
    return database.transaction(async (tx) => {
      const userId = await resolveUserId(tx, caller, true)
      const existing = await tx.one(
        `SELECT * FROM mip_orders
         WHERE app_id = ? AND user_id = ? AND order_type = 'MEMBERSHIP' AND idempotency_key = ?
         LIMIT 1 FOR UPDATE`,
        [caller.appId, userId, input.idempotencyKey],
      )
      if (existing) {
        if (existing.membership_plan_id !== input.planId) {
          throw new Error('IDEMPOTENCY_CONFLICT')
        }
        assertSameAttribution(existing.product_snapshot_json, input.attribution)
        return orderDto(existing, 0)
      }
      assertFullAccessUser(await fullAccess.loadByUserId(
        tx,
        caller.appId,
        userId,
        { lock: true },
      ))
      const plan = await tx.one(
        `SELECT * FROM mip_membership_plans
         WHERE app_id = ? AND id = ?
         LIMIT 1 FOR UPDATE`,
        [caller.appId, input.planId],
      )
      const checkout = deriveCheckout(plan, input.catalogStage)
      const attribution = await resolveCheckoutAttribution(tx, caller.appId, userId, input.attribution)
      checkout.productSnapshot.attribution = attribution
      await tx.query(
        `INSERT INTO mip_orders (
          id, app_id, user_id, order_type, membership_plan_id, merchant_order_no,
          idempotency_key, amount_cents, currency, status, product_snapshot_json
        ) VALUES (?, ?, ?, 'MEMBERSHIP', ?, ?, ?, ?, ?, 'CREATED', ?)`,
        [
          ids.orderId,
          caller.appId,
          userId,
          input.planId,
          ids.merchantOrderNo,
          input.idempotencyKey,
          checkout.amountCents,
          checkout.currency,
          JSON.stringify(checkout.productSnapshot),
        ],
      )
      await writeOutbox(tx, {
        id: ids.outboxId,
        appId: caller.appId,
        aggregateType: 'MEMBERSHIP_ORDER',
        aggregateId: ids.orderId,
        eventType: 'membership.order_created',
        sourceVersion: 1,
        payload: { orderId: ids.orderId, userId, planId: input.planId },
      })
      return orderDto({
        id: ids.orderId,
        user_id: userId,
        order_type: 'MEMBERSHIP',
        membership_plan_id: input.planId,
        amount_cents: checkout.amountCents,
        currency: checkout.currency,
        status: 'CREATED',
        version: 1,
        created_at: ids.createdAt,
        updated_at: ids.createdAt,
      }, 0)
    })
  }

  async function getOrder(caller, orderId) {
    const rows = await database.query(
      `SELECT o.*,
              COALESCE(SUM(CASE WHEN r.status IN ('PENDING', 'PROVIDER_CREATED', 'PROCESSING', 'SUCCEEDED') THEN r.amount_cents ELSE 0 END), 0) AS refunded_amount_cents
       FROM mip_orders o
       JOIN mip_user_identities i
         ON i.app_id = o.app_id AND i.user_id = o.user_id
        AND i.provider = 'WECHAT_MINIPROGRAM' AND i.identity_key = ?
       LEFT JOIN mip_refunds r ON r.app_id = o.app_id AND r.order_id = o.id
       WHERE o.app_id = ? AND o.id = ?
       GROUP BY o.id
       LIMIT 1`,
      [caller.identityKey, caller.appId, orderId],
    )
    if (!rows[0]) {
      throw new Error('NOT_FOUND')
    }
    return orderDto(rows[0], rows[0].refunded_amount_cents)
  }

  async function listOrders(caller, limit) {
    const rows = await database.query(
      `SELECT o.*,
              COALESCE(SUM(CASE WHEN r.status IN ('PENDING', 'PROVIDER_CREATED', 'PROCESSING', 'SUCCEEDED') THEN r.amount_cents ELSE 0 END), 0) AS refunded_amount_cents
       FROM mip_orders o
       JOIN mip_user_identities i
         ON i.app_id = o.app_id AND i.user_id = o.user_id
        AND i.provider = 'WECHAT_MINIPROGRAM' AND i.identity_key = ?
       LEFT JOIN mip_refunds r ON r.app_id = o.app_id AND r.order_id = o.id
       WHERE o.app_id = ?
       GROUP BY o.id
       ORDER BY o.created_at DESC, o.id DESC
       LIMIT ${limit}`,
      [caller.identityKey, caller.appId],
    )
    return rows.map(row => orderDto(row, row.refunded_amount_cents))
  }

  async function requestRefund(caller, input, ids, amountResolver) {
    return database.transaction(async (tx) => {
      const userId = await resolveUserId(tx, caller, true)
      const existing = await tx.one(
        `SELECT * FROM mip_refunds
         WHERE app_id = ? AND order_id = ? AND idempotency_key = ?
         LIMIT 1 FOR UPDATE`,
        [caller.appId, input.orderId, input.idempotencyKey],
      )
      if (existing) {
        return refundDto(existing, true)
      }
      const order = await tx.one(
        `SELECT * FROM mip_orders
         WHERE app_id = ? AND id = ? AND user_id = ?
         LIMIT 1 FOR UPDATE`,
        [caller.appId, input.orderId, userId],
      )
      if (!order) {
        throw new Error('NOT_FOUND')
      }
      const totals = await tx.one(
        `SELECT COALESCE(SUM(amount_cents), 0) AS reserved_cents
         FROM mip_refunds
         WHERE app_id = ? AND order_id = ?
           AND status IN ('PENDING', 'PROVIDER_CREATED', 'PROCESSING', 'SUCCEEDED')`,
        [caller.appId, input.orderId],
      )
      const amountCents = amountResolver(order, totals?.reserved_cents || 0)
      await tx.query(
        `INSERT INTO mip_refunds (
          id, app_id, order_id, requested_by_user_id, merchant_refund_no,
          idempotency_key, amount_cents, reason, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING')`,
        [
          ids.refundId,
          caller.appId,
          input.orderId,
          userId,
          ids.merchantRefundNo,
          input.idempotencyKey,
          amountCents,
          input.reason || null,
        ],
      )
      await tx.query(
        `UPDATE mip_orders
         SET status = 'REFUND_PENDING', version = version + 1
         WHERE app_id = ? AND id = ? AND version = ?`,
        [caller.appId, input.orderId, order.version],
      )
      await writeOutbox(tx, {
        id: ids.outboxId,
        appId: caller.appId,
        aggregateType: 'REFUND',
        aggregateId: ids.refundId,
        eventType: 'membership.refund_requested',
        sourceVersion: 1,
        payload: { refundId: ids.refundId, orderId: input.orderId, userId },
      })
      return refundDto({
        id: ids.refundId,
        order_id: input.orderId,
        amount_cents: amountCents,
        status: 'PENDING',
      }, false)
    })
  }

  return {
    assertMembershipInviter,
    createCheckout,
    getMembershipBenefits,
    getOrder,
    listOrders,
    listPlans,
    requestRefund,
    resolveMembershipInviter,
  }
}

function membershipBenefitsDto(row) {
  if (!row) {
    return {
      kind: 'GUEST',
      status: 'NONE',
      benefits: [],
    }
  }
  const snapshot = parseJson(row.product_snapshot_json)
  const benefits = benefitList(
    Array.isArray(snapshot.benefits) ? snapshot.benefits : parseJsonArray(row.benefits_json),
  )
  return {
    kind: 'PLAYER',
    status: row.status,
    entitlementId: row.id,
    plan: {
      id: row.plan_id,
      name: row.plan_name,
      description: row.plan_description || undefined,
    },
    startsAt: dateValue(row.starts_at),
    endsAt: dateValue(row.ends_at),
    membershipEndsAt: dateValue(row.membership_ends_at || row.ends_at),
    benefits,
    invitationAttribution: membershipInvitationAttribution(row),
    version: Number(row.version),
  }
}

function membershipInvitationAttribution(row) {
  if (row.invitation_source_type !== 'USER') {
    return { sourceType: 'PLATFORM', displayName: 'MIP 平台' }
  }
  const visibility = parseJson(row.inviter_visibility_json)
  return {
    sourceType: 'USER',
    displayName: visibility.nickname === false || !row.inviter_nickname
      ? 'MIP 用户'
      : row.inviter_nickname,
    ...(visibility.avatar === false || !row.inviter_avatar_file_id
      ? {}
      : { avatarUrl: row.inviter_avatar_file_id }),
  }
}

function benefitList(values) {
  return values.slice(0, 30).flatMap((value, index) => {
    const label = typeof value === 'string'
      ? value.trim()
      : typeof value?.label === 'string'
        ? value.label.trim()
        : ''
    if (!label || label.length > 160) return []
    const suppliedKey = typeof value?.key === 'string' ? value.key.trim() : ''
    const key = /^[a-z][a-z0-9_-]{1,63}$/i.test(suppliedKey) ? suppliedKey : `benefit-${index + 1}`
    return [{ key, label, status: 'ACTIVE' }]
  })
}

async function resolveCheckoutAttribution(tx, appId, buyerUserId, attribution) {
  if (!attribution || attribution.sourceType === 'PLATFORM') {
    return { sourceType: 'PLATFORM' }
  }
  if (attribution.sourceType !== 'USER'
    || attribution.invitedByUserId === buyerUserId
    || !USER_ID_PATTERN.test(attribution.invitedByUserId || '')
    || !/^[0-9a-f]{64}$/i.test(attribution.sourceTokenHash || '')) {
    throw new Error('MEMBERSHIP_INVITATION_INVALID')
  }
  const inviter = await tx.one(
    `SELECT u.id
     FROM mip_users u
     JOIN mip_membership_entitlements e
       ON e.app_id = u.app_id AND e.user_id = u.id AND e.status = 'ACTIVE'
      AND e.starts_at <= UTC_TIMESTAMP(3) AND e.ends_at > UTC_TIMESTAMP(3)
     WHERE u.app_id = ? AND u.id = ? AND u.status = 'ACTIVE'
     LIMIT 1 FOR UPDATE`,
    [appId, attribution.invitedByUserId],
  )
  if (!inviter) {
    throw new Error('MEMBERSHIP_INVITATION_INVALID')
  }
  return {
    sourceType: 'USER',
    invitedByUserId: inviter.id,
    sourceTokenHash: attribution.sourceTokenHash,
  }
}

function assertSameAttribution(snapshotValue, expected) {
  const snapshot = parseJson(snapshotValue)
  const actual = snapshot.attribution || { sourceType: 'PLATFORM' }
  const expectedSource = expected?.sourceType === 'USER' ? 'USER' : 'PLATFORM'
  if (actual.sourceType !== expectedSource
    || (expectedSource === 'USER' && actual.invitedByUserId !== expected.invitedByUserId)) {
    throw new Error('IDEMPOTENCY_CONFLICT')
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

function orderDto(row, refundedAmountCents) {
  return {
    id: row.id,
    userId: row.user_id,
    orderType: row.order_type,
    resourceId: row.resource_id || undefined,
    membershipPlanId: row.membership_plan_id || undefined,
    amountCents: Number(row.amount_cents),
    refundedAmountCents: Number(refundedAmountCents || 0),
    currency: row.currency,
    status: row.status,
    paidAt: dateValue(row.paid_at),
    version: Number(row.version),
    createdAt: dateValue(row.created_at),
    updatedAt: dateValue(row.updated_at),
  }
}

function refundDto(row, idempotent) {
  return {
    id: row.id,
    orderId: row.order_id,
    amountCents: Number(row.amount_cents),
    status: row.status,
    idempotent,
  }
}

function dateValue(value) {
  return value instanceof Date ? value.toISOString() : value || undefined
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

function parseJsonArray(value) {
  if (Array.isArray(value)) return value
  try {
    const parsed = JSON.parse(value || '[]')
    return Array.isArray(parsed) ? parsed : []
  }
  catch {
    return []
  }
}

module.exports = {
  assertSameAttribution,
  benefitList,
  createCommerceRepository,
  membershipBenefitsDto,
  orderDto,
  refundDto,
  resolveCheckoutAttribution,
}
