'use strict'

const { assertFullAccessUser, createFullAccessPolicy } = require('./full-access')

const USER_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const ORDER_SERVICE_STATUS_SQL = `CASE
  WHEN o.status IN ('PARTIALLY_REFUNDED', 'REFUNDED') THEN 'REFUNDED'
  WHEN o.status <> 'PAID' THEN 'UNAVAILABLE'
  WHEN o.order_type = 'EVENT' AND event_registration.status = 'ATTENDED' THEN 'COMPLETED'
  WHEN o.order_type = 'EVENT'
    AND event_registration.status = 'REGISTERED'
    AND (
      event_row.status = 'ENDED'
      OR (event_row.status = 'PUBLISHED' AND event_row.ends_at <= UTC_TIMESTAMP(3))
    )
    THEN 'COMPLETED'
  WHEN o.order_type = 'EVENT'
    AND event_registration.status = 'REGISTERED'
    AND event_row.status = 'PUBLISHED'
    AND event_row.ends_at > UTC_TIMESTAMP(3)
    THEN 'PENDING_USE'
  WHEN o.order_type = 'EVENT' THEN 'UNAVAILABLE'
  WHEN o.order_type = 'MEMBERSHIP' AND membership_entitlement.status = 'REFUNDED' THEN 'REFUNDED'
  WHEN o.order_type = 'MEMBERSHIP'
    AND membership_entitlement.status = 'ACTIVE'
    AND membership_entitlement.starts_at > UTC_TIMESTAMP(3)
    THEN 'PENDING_USE'
  WHEN o.order_type = 'MEMBERSHIP'
    AND membership_entitlement.status IN ('ACTIVE', 'EXPIRED', 'REVOKED')
    THEN 'COMPLETED'
  WHEN o.order_type = 'CONTENT' AND knowledge_entitlement.status = 'REFUNDED' THEN 'REFUNDED'
  WHEN o.order_type = 'CONTENT'
    AND knowledge_entitlement.status = 'ACTIVE'
    AND (knowledge_entitlement.ends_at IS NULL OR knowledge_entitlement.ends_at > UTC_TIMESTAMP(3))
    AND knowledge_entitlement.first_accessed_at IS NULL
    THEN 'PENDING_USE'
  WHEN o.order_type = 'CONTENT'
    AND knowledge_entitlement.status IN ('ACTIVE', 'EXPIRED', 'REVOKED')
    THEN 'COMPLETED'
  ELSE 'UNAVAILABLE'
END`

const ORDER_SERVICE_FACT_JOINS_SQL = `LEFT JOIN mip_event_registrations event_registration
         ON event_registration.app_id = o.app_id AND event_registration.order_id = o.id
        AND o.order_type = 'EVENT'
       LEFT JOIN mip_membership_entitlements membership_entitlement
         ON membership_entitlement.app_id = o.app_id AND membership_entitlement.order_id = o.id
        AND membership_entitlement.source_type = 'ORDER'
        AND o.order_type = 'MEMBERSHIP'
       LEFT JOIN mip_knowledge_entitlements knowledge_entitlement
         ON knowledge_entitlement.app_id = o.app_id AND knowledge_entitlement.order_id = o.id
        AND o.order_type = 'CONTENT'`

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
    const rows = await database.query(
      `SELECT e.id, e.status, e.starts_at, e.ends_at, e.version,
              e.source_type, e.order_id, e.plan_id,
              o.id AS source_order_id, p.id AS source_plan_id,
              p.name AS plan_name, p.description AS plan_description,
              p.benefits_json, o.amount_cents, o.currency, o.product_snapshot_json,
              attribution.source_type AS invitation_source_type,
              inviter_profile.nickname AS inviter_nickname,
              inviter_profile.visibility_json AS inviter_visibility_json,
              inviter_avatar.cloud_file_id AS inviter_avatar_file_id,
              CASE
                WHEN e.status = 'PENDING' THEN 'PENDING'
                WHEN e.status = 'REFUNDED' THEN 'REFUNDED'
                WHEN e.status = 'REVOKED' THEN 'REVOKED'
                WHEN e.status = 'ACTIVE'
                  AND e.starts_at <= UTC_TIMESTAMP(3) AND e.ends_at > UTC_TIMESTAMP(3)
                  THEN 'ACTIVE'
                WHEN e.status = 'ACTIVE' AND e.starts_at > UTC_TIMESTAMP(3)
                  THEN 'SCHEDULED'
                ELSE 'EXPIRED'
              END AS window_status,
              MAX(CASE
                WHEN e.status = 'ACTIVE' AND e.ends_at > UTC_TIMESTAMP(3) THEN e.ends_at
                ELSE NULL
              END) OVER (PARTITION BY e.app_id, e.user_id) AS membership_ends_at
       FROM mip_user_identities i
       INNER JOIN mip_users u
         ON u.app_id = i.app_id AND u.id = i.user_id AND u.status = 'ACTIVE'
       INNER JOIN mip_membership_entitlements e
         ON e.app_id = u.app_id AND e.user_id = u.id
        AND e.status IN ('PENDING', 'ACTIVE', 'EXPIRED', 'REVOKED', 'REFUNDED')
       LEFT JOIN mip_membership_plans p
         ON p.app_id = e.app_id AND p.id = e.plan_id
        AND e.source_type = 'ORDER'
       LEFT JOIN mip_orders o
         ON o.app_id = e.app_id AND o.id = e.order_id
        AND e.source_type = 'ORDER' AND o.order_type = 'MEMBERSHIP'
       LEFT JOIN mip_membership_attributions attribution
         ON attribution.app_id = e.app_id AND attribution.entitlement_id = e.id
        AND e.source_type = 'ORDER'
       LEFT JOIN mip_users inviter
         ON inviter.app_id = attribution.app_id AND inviter.id = attribution.invited_by_user_id
        AND inviter.status = 'ACTIVE'
       LEFT JOIN mip_profiles inviter_profile
         ON inviter_profile.app_id = inviter.app_id AND inviter_profile.user_id = inviter.id
       LEFT JOIN mip_media_assets inviter_avatar
         ON inviter_avatar.app_id = inviter_profile.app_id
        AND inviter_avatar.id = inviter_profile.avatar_asset_id AND inviter_avatar.status = 'READY'
       WHERE i.app_id = ? AND i.provider = 'WECHAT_MINIPROGRAM' AND i.identity_key = ?
       ORDER BY
         CASE
           WHEN e.status = 'ACTIVE'
             AND e.starts_at <= UTC_TIMESTAMP(3) AND e.ends_at > UTC_TIMESTAMP(3)
             THEN 0
           WHEN e.status = 'ACTIVE' AND e.starts_at > UTC_TIMESTAMP(3) THEN 1
           WHEN e.status = 'PENDING' THEN 2
           ELSE 3
         END,
         e.starts_at DESC, e.id DESC`,
      [caller.appId, caller.identityKey],
    )
    return membershipBenefitsDto(rows)
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
         LIMIT 1 FOR SHARE`,
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

  async function createKnowledgeCheckout(caller, input, ids) {
    return database.transaction(async (tx) => {
      const userId = await resolveUserId(tx, caller, true)
      const existing = await tx.one(
        `SELECT * FROM mip_orders
         WHERE app_id = ? AND user_id = ? AND order_type = 'CONTENT' AND idempotency_key = ?
         LIMIT 1 FOR UPDATE`,
        [caller.appId, userId, input.idempotencyKey],
      )
      if (existing) {
        if (existing.resource_id !== input.contentId) throw new Error('IDEMPOTENCY_CONFLICT')
        return orderDto(existing, 0)
      }
      assertFullAccessUser(await fullAccess.loadByUserId(
        tx,
        caller.appId,
        userId,
        { lock: true },
      ))
      const product = await tx.one(
        `SELECT product.*, content.title, content.access_type, content.status AS content_status
         FROM mip_knowledge_products product
         INNER JOIN mip_knowledge_contents content
           ON content.app_id = product.app_id AND content.id = product.content_id
         WHERE product.app_id = ? AND product.content_id = ?
           AND product.catalog_stage = ? AND product.status = 'ACTIVE'
         LIMIT 1 FOR UPDATE`,
        [caller.appId, input.contentId, input.catalogStage],
      )
      if (!product
        || product.content_status !== 'PUBLISHED'
        || product.access_type !== 'MEMBER_OR_PAID'
        || !Number.isInteger(Number(product.price_cents))
        || Number(product.price_cents) < 1
        || product.currency !== 'CNY') {
        throw new Error('KNOWLEDGE_PRODUCT_NOT_AVAILABLE')
      }
      const activeAccess = await tx.one(
        `SELECT
           EXISTS(
             SELECT 1 FROM mip_membership_entitlements membership
             WHERE membership.app_id = ? AND membership.user_id = ? AND membership.status = 'ACTIVE'
               AND membership.starts_at <= UTC_TIMESTAMP(3) AND membership.ends_at > UTC_TIMESTAMP(3)
           ) AS has_membership,
           EXISTS(
             SELECT 1 FROM mip_knowledge_entitlements entitlement
             WHERE entitlement.app_id = ? AND entitlement.user_id = ? AND entitlement.content_id = ?
               AND entitlement.status = 'ACTIVE'
               AND (entitlement.ends_at IS NULL OR entitlement.ends_at > UTC_TIMESTAMP(3))
           ) AS has_content_access`,
        [caller.appId, userId, caller.appId, userId, input.contentId],
      )
      if (Number(activeAccess?.has_membership) || Number(activeAccess?.has_content_access)) {
        throw new Error('KNOWLEDGE_ALREADY_UNLOCKED')
      }
      const pendingOrder = await tx.one(
        `SELECT * FROM mip_orders
         WHERE app_id = ? AND user_id = ? AND order_type = 'CONTENT' AND resource_id = ?
           AND status IN ('CREATED', 'PAYMENT_CREATED')
         ORDER BY created_at DESC, id DESC LIMIT 1 FOR UPDATE`,
        [caller.appId, userId, input.contentId],
      )
      if (pendingOrder) {
        return orderDto(pendingOrder, 0)
      }
      const snapshot = {
        productId: product.id,
        contentId: product.content_id,
        name: product.name,
        title: product.title,
        priceCents: Number(product.price_cents),
        currency: product.currency,
        catalogStage: product.catalog_stage,
        unlockDays: product.unlock_days === null ? null : Number(product.unlock_days),
        refundPolicy: product.refund_policy,
        refundWindowHours: Number(product.refund_window_hours),
        version: Number(product.version),
      }
      await tx.query(
        `INSERT INTO mip_orders (
          id, app_id, user_id, order_type, resource_id, merchant_order_no,
          idempotency_key, amount_cents, currency, status, product_snapshot_json
        ) VALUES (?, ?, ?, 'CONTENT', ?, ?, ?, ?, ?, 'CREATED', ?)`,
        [ids.orderId, caller.appId, userId, input.contentId, ids.merchantOrderNo,
          input.idempotencyKey, snapshot.priceCents, snapshot.currency, JSON.stringify(snapshot)],
      )
      await writeOutbox(tx, {
        id: ids.outboxId,
        appId: caller.appId,
        aggregateType: 'CONTENT_ORDER',
        aggregateId: ids.orderId,
        eventType: 'knowledge.order_created',
        sourceVersion: 1,
        payload: { orderId: ids.orderId, contentId: input.contentId, userId },
      })
      return orderDto({
        id: ids.orderId,
        user_id: userId,
        order_type: 'CONTENT',
        resource_id: input.contentId,
        membership_plan_id: null,
        amount_cents: snapshot.priceCents,
        currency: snapshot.currency,
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
              event_row.title AS event_title, event_row.starts_at AS event_starts_at,
              event_row.ends_at AS event_ends_at, event_row.city_name AS event_city_name,
              event_row.venue_name AS event_venue_name, event_row.address AS event_address,
              event_cover.cloud_file_id AS event_cover_file_id,
              ${ORDER_SERVICE_STATUS_SQL} AS service_status,
              (SELECT COALESCE(SUM(refund.amount_cents), 0)
               FROM mip_refunds refund
               WHERE refund.app_id = o.app_id AND refund.order_id = o.id
                 AND refund.status IN ('PENDING', 'PROVIDER_CREATED', 'PROCESSING', 'SUCCEEDED')) AS refunded_amount_cents
       FROM mip_orders o
       JOIN mip_user_identities i
         ON i.app_id = o.app_id AND i.user_id = o.user_id
        AND i.provider = 'WECHAT_MINIPROGRAM' AND i.identity_key = ?
       LEFT JOIN mip_events event_row
         ON event_row.app_id = o.app_id AND event_row.id = o.resource_id AND o.order_type = 'EVENT'
       LEFT JOIN mip_media_assets event_cover
         ON event_cover.app_id = event_row.app_id AND event_cover.id = event_row.cover_asset_id
        AND event_cover.status = 'READY'
       ${ORDER_SERVICE_FACT_JOINS_SQL}
       WHERE o.app_id = ? AND o.id = ?
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
              event_row.title AS event_title, event_row.starts_at AS event_starts_at,
              event_row.ends_at AS event_ends_at, event_row.city_name AS event_city_name,
              event_row.venue_name AS event_venue_name, event_row.address AS event_address,
              event_cover.cloud_file_id AS event_cover_file_id,
              ${ORDER_SERVICE_STATUS_SQL} AS service_status,
              (SELECT COALESCE(SUM(refund.amount_cents), 0)
               FROM mip_refunds refund
               WHERE refund.app_id = o.app_id AND refund.order_id = o.id
                 AND refund.status IN ('PENDING', 'PROVIDER_CREATED', 'PROCESSING', 'SUCCEEDED')) AS refunded_amount_cents
       FROM mip_orders o
       JOIN mip_user_identities i
         ON i.app_id = o.app_id AND i.user_id = o.user_id
        AND i.provider = 'WECHAT_MINIPROGRAM' AND i.identity_key = ?
       LEFT JOIN mip_events event_row
         ON event_row.app_id = o.app_id AND event_row.id = o.resource_id AND o.order_type = 'EVENT'
       LEFT JOIN mip_media_assets event_cover
         ON event_cover.app_id = event_row.app_id AND event_cover.id = event_row.cover_asset_id
        AND event_cover.status = 'READY'
       ${ORDER_SERVICE_FACT_JOINS_SQL}
       WHERE o.app_id = ?
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
        `SELECT refund.*, order_row.order_type
         FROM mip_refunds refund
         JOIN mip_orders order_row
           ON order_row.app_id = refund.app_id AND order_row.id = refund.order_id
          AND order_row.user_id = ?
         WHERE refund.app_id = ? AND refund.order_id = ? AND refund.idempotency_key = ?
         LIMIT 1 FOR UPDATE`,
        [userId, caller.appId, input.orderId, input.idempotencyKey],
      )
      if (existing?.order_type === 'EVENT') {
        throw new Error('EVENT_REFUND_REQUIRES_CANCELLATION')
      }
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
      if (order.order_type === 'EVENT') {
        throw new Error('EVENT_REFUND_REQUIRES_CANCELLATION')
      }
      const totals = await tx.one(
        `SELECT COALESCE(SUM(amount_cents), 0) AS reserved_cents
         FROM mip_refunds
         WHERE app_id = ? AND order_id = ?
           AND status IN ('PENDING', 'PROVIDER_CREATED', 'PROCESSING', 'SUCCEEDED')`,
        [caller.appId, input.orderId],
      )
      const amountCents = order.order_type === 'CONTENT'
        ? await contentRefundableAmount(tx, caller.appId, order, totals?.reserved_cents || 0)
        : amountResolver(order, totals?.reserved_cents || 0)
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
      const updated = await tx.query(
        `UPDATE mip_orders
         SET status = 'REFUND_PENDING', version = version + 1
         WHERE app_id = ? AND id = ? AND version = ?`,
        [caller.appId, input.orderId, order.version],
      )
      if (Number(updated.affectedRows) !== 1) {
        throw new Error('REFUND_NOT_AVAILABLE')
      }
      await writeOutbox(tx, {
        id: ids.outboxId,
        appId: caller.appId,
        aggregateType: 'REFUND',
        aggregateId: ids.refundId,
        eventType: order.order_type === 'CONTENT'
          ? 'knowledge.refund_requested'
          : order.order_type === 'EVENT'
            ? 'event.refund_requested'
            : 'membership.refund_requested',
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
    createKnowledgeCheckout,
    getMembershipBenefits,
    getOrder,
    listOrders,
    listPlans,
    requestRefund,
    resolveMembershipInviter,
  }
}

async function contentRefundableAmount(tx, appId, order, reservedCents) {
  if (order.status !== 'PAID') throw new Error('REFUND_NOT_AVAILABLE')
  const row = await tx.one(
    `SELECT entitlement.first_accessed_at
     FROM mip_orders order_row
     INNER JOIN mip_knowledge_entitlements entitlement
       ON entitlement.app_id = order_row.app_id AND entitlement.order_id = order_row.id
        AND entitlement.status = 'ACTIVE'
     WHERE order_row.app_id = ? AND order_row.id = ? FOR UPDATE`,
    [appId, order.id],
  )
  const snapshot = parseJson(order.product_snapshot_json)
  const refundWindowHours = Number(snapshot.refundWindowHours)
  const paidAt = new Date(order.paid_at)
  const refundDeadline = paidAt.getTime() + refundWindowHours * 3_600_000
  if (!row
    || snapshot.refundPolicy !== 'BEFORE_ACCESS'
    || !Number.isInteger(refundWindowHours)
    || refundWindowHours < 0
    || refundWindowHours > 720
    || !Number.isFinite(paidAt.getTime())
    || row.first_accessed_at
    || refundDeadline <= Date.now()) {
    throw new Error('CONTENT_REFUND_NOT_AVAILABLE')
  }
  const available = Number(order.amount_cents) - Number(reservedCents || 0)
  if (!Number.isInteger(available) || available < 1) throw new Error('REFUND_AMOUNT_INVALID')
  return available
}

function membershipBenefitsDto(rows) {
  const sourceRows = Array.isArray(rows) ? rows : rows ? [rows] : []
  const history = sourceRows.map(membershipHistoryItem)
  const row = sourceRows.find(item => item.window_status === 'ACTIVE')
  if (!row) return { kind: 'GUEST', status: 'NONE', benefits: [], history }

  const base = {
    kind: 'PLAYER',
    status: 'ACTIVE',
    entitlementId: row.id,
    sourceType: row.source_type,
    sourceLabel: membershipSourceLabel(row.source_type),
    startsAt: dateValue(row.starts_at),
    endsAt: dateValue(row.ends_at),
    membershipEndsAt: dateValue(row.membership_ends_at || row.ends_at),
    benefits: [],
    version: Number(row.version),
    history,
  }
  if (row.source_type === 'ADMIN_ADJUSTMENT') return base

  const snapshot = parseJson(row.product_snapshot_json)
  const benefits = benefitList(
    Array.isArray(snapshot.benefits) ? snapshot.benefits : parseJsonArray(row.benefits_json),
  )
  return {
    ...base,
    plan: {
      id: row.plan_id,
      name: row.plan_name,
      description: row.plan_description || undefined,
    },
    benefits,
    invitationAttribution: membershipInvitationAttribution(row),
  }
}

function membershipHistoryItem(row) {
  const sourceType = row.source_type
  if (!['ORDER', 'ADMIN_ADJUSTMENT'].includes(sourceType)
    || !['ACTIVE', 'SCHEDULED', 'PENDING', 'EXPIRED', 'REVOKED', 'REFUNDED'].includes(row.window_status)) {
    throw new Error('MEMBERSHIP_ENTITLEMENT_SOURCE_INVALID')
  }
  const item = {
    entitlementId: row.id,
    sourceType,
    sourceLabel: membershipSourceLabel(sourceType),
    status: row.window_status,
    startsAt: dateValue(row.starts_at),
    endsAt: dateValue(row.ends_at),
  }
  if (sourceType === 'ADMIN_ADJUSTMENT') return item
  if (!row.order_id || !row.plan_id || !row.plan_name
    || row.source_order_id !== row.order_id || row.source_plan_id !== row.plan_id) {
    throw new Error('MEMBERSHIP_ENTITLEMENT_SOURCE_INVALID')
  }
  const amountCents = Number(row.amount_cents)
  if (!Number.isSafeInteger(amountCents) || amountCents < 0 || row.currency !== 'CNY') {
    throw new Error('MEMBERSHIP_ENTITLEMENT_SOURCE_INVALID')
  }
  return {
    ...item,
    orderId: row.order_id,
    plan: {
      id: row.plan_id,
      name: row.plan_name,
      description: row.plan_description || undefined,
    },
    price: { amountCents, currency: 'CNY' },
    invitationAttribution: membershipInvitationAttribution(row),
  }
}

function membershipSourceLabel(sourceType) {
  return sourceType === 'ADMIN_ADJUSTMENT' ? '运营开通' : '会员购买'
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
  const snapshot = parseJson(row.product_snapshot_json)
  const event = eventOrderProjection(row, snapshot)
  const priceItems = orderPriceItems(snapshot, Number(row.amount_cents))
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
    serviceStatus: orderServiceStatus(row),
    paidAt: dateValue(row.paid_at),
    ...(event ? { event } : {}),
    ...(priceItems.length ? { priceItems } : {}),
    version: Number(row.version),
    createdAt: dateValue(row.created_at),
    updatedAt: dateValue(row.updated_at),
  }
}

function orderServiceStatus(row) {
  const projected = String(row.service_status || '').toUpperCase()
  if (['PENDING_USE', 'COMPLETED', 'REFUNDED', 'UNAVAILABLE'].includes(projected)) {
    return projected
  }
  if (['PARTIALLY_REFUNDED', 'REFUNDED'].includes(row.status)) return 'REFUNDED'
  if (row.status !== 'PAID') return 'UNAVAILABLE'
  if (row.order_type === 'EVENT') {
    if (row.registration_status === 'ATTENDED') return 'COMPLETED'
    if (row.registration_status !== 'REGISTERED') return 'UNAVAILABLE'
    if (row.event_has_ended === true) return 'COMPLETED'
    if (row.event_has_ended === false) return 'PENDING_USE'
    return 'UNAVAILABLE'
  }
  return 'UNAVAILABLE'
}

function eventOrderProjection(row, snapshot) {
  if (row.order_type !== 'EVENT') return undefined
  const title = boundedSnapshotText(snapshot.title, 120) || boundedSnapshotText(row.event_title, 120)
  if (!title) return undefined
  return {
    title,
    ...(row.event_cover_file_id ? { coverUrl: row.event_cover_file_id } : {}),
    ...optionalDateField('startsAt', snapshot.startsAt, row.event_starts_at),
    ...optionalDateField('endsAt', snapshot.endsAt, row.event_ends_at),
    ...optionalTextField('cityName', 80, snapshot.cityName, row.event_city_name),
    ...optionalTextField('venueName', 160, snapshot.venueName, row.event_venue_name),
    ...optionalTextField('address', 500, snapshot.address, row.event_address),
  }
}

function orderPriceItems(snapshot, totalAmountCents) {
  if (!Array.isArray(snapshot.priceItems) || !Number.isSafeInteger(totalAmountCents) || totalAmountCents < 0) {
    return []
  }
  const items = snapshot.priceItems.slice(0, 12).flatMap((item) => {
    const label = boundedSnapshotText(item?.label, 80)
    const amountCents = Number(item?.amountCents)
    return label && Number.isSafeInteger(amountCents) && amountCents >= 0
      ? [{ label, amountCents }]
      : []
  })
  return items.length && items.reduce((sum, item) => sum + item.amountCents, 0) === totalAmountCents
    ? items
    : []
}

function boundedSnapshotText(value, maxLength) {
  const normalized = typeof value === 'string' ? value.trim() : ''
  return normalized && normalized.length <= maxLength ? normalized : ''
}

function optionalTextField(key, maxLength, ...values) {
  const normalized = values.map(value => boundedSnapshotText(value, maxLength)).find(Boolean)
  return normalized ? { [key]: normalized } : {}
}

function optionalDateField(key, ...values) {
  const normalized = values
    .map(dateValue)
    .find(value => value && Number.isFinite(new Date(value).getTime()))
  return normalized ? { [key]: normalized } : {}
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
  contentRefundableAmount,
  membershipBenefitsDto,
  eventOrderProjection,
  orderDto,
  orderPriceItems,
  orderServiceStatus,
  refundDto,
  resolveCheckoutAttribution,
}
