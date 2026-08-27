'use strict'

const { randomBytes, randomUUID } = require('node:crypto')
const { assertMutationScope, lockMutationAuthorization } = require('../mutation-authorization')
const { cursorPredicateFor, pageRows } = require('../pagination')

function createAdminOrderRepository(database, options = {}) {
  const id = options.createId || randomUUID
  const bytes = options.randomBytes || randomBytes
  const now = options.now || (() => new Date())
  const lockMutation = options.lockMutationAuthorization || lockMutationAuthorization
  const assertScope = options.assertMutationScope || assertMutationScope

  async function getOrderScope(appId, orderId) {
    const row = await database.one(
      `SELECT o.id, o.order_type, o.resource_id, e.branch_id
       FROM mip_orders o
       LEFT JOIN mip_events e
         ON e.app_id = o.app_id AND e.id = o.resource_id AND o.order_type = 'EVENT'
       WHERE o.app_id = ? AND o.id = ?`,
      [appId, orderId],
    )
    if (!row) return null
    if (row.order_type === 'EVENT') {
      return { scopeType: 'EVENT', scopeId: row.resource_id, branchId: row.branch_id || null }
    }
    return { scopeType: 'PLATFORM', scopeId: null, branchId: null }
  }

  async function getRefundScope(appId, refundId) {
    const row = await database.one(
      `SELECT r.id, r.status AS refund_status, o.order_type, o.resource_id, e.branch_id
       FROM mip_refunds r
       JOIN mip_orders o ON o.app_id = r.app_id AND o.id = r.order_id
       LEFT JOIN mip_events e
         ON e.app_id = o.app_id AND e.id = o.resource_id AND o.order_type = 'EVENT'
       WHERE r.app_id = ? AND r.id = ?`,
      [appId, refundId],
    )
    if (!row) return null
    return {
      scopeType: row.order_type === 'EVENT' ? 'EVENT' : 'PLATFORM',
      scopeId: row.order_type === 'EVENT' ? row.resource_id : null,
      branchId: row.branch_id || null,
      refundStatus: row.refund_status,
    }
  }

  function orderVisibilityWhere(visibility) {
    if (visibility.platform) return { sql: '1 = 1', params: [] }
    const clauses = []
    const params = []
    if (visibility.branchIds.length) {
      clauses.push(`EXISTS (SELECT 1 FROM mip_events e WHERE e.app_id = o.app_id
        AND e.id = o.resource_id AND e.branch_id IN (${placeholders(visibility.branchIds)}))`)
      params.push(...visibility.branchIds)
    }
    if (visibility.eventIds.length) {
      clauses.push(`o.resource_id IN (${placeholders(visibility.eventIds)})`)
      params.push(...visibility.eventIds)
    }
    return { sql: clauses.length ? `(o.order_type = 'EVENT' AND (${clauses.join(' OR ')}))` : '0 = 1', params }
  }

  function orderFilterWhere(appId, visibility, filters) {
    const scope = orderVisibilityWhere(visibility)
    const clauses = ['o.app_id = ?', scope.sql]
    const params = [appId, ...scope.params]
    if (filters.status) { clauses.push('o.status = ?'); params.push(filters.status) }
    if (filters.orderType) { clauses.push('o.order_type = ?'); params.push(filters.orderType) }
    if (filters.eventId) { clauses.push("o.order_type = 'EVENT' AND o.resource_id = ?"); params.push(filters.eventId) }
    if (filters.refundStatus === 'NONE') {
      clauses.push('NOT EXISTS (SELECT 1 FROM mip_refunds rf WHERE rf.app_id = o.app_id AND rf.order_id = o.id)')
    }
    else if (filters.refundStatus) {
      clauses.push(`(SELECT rf.status FROM mip_refunds rf
        WHERE rf.app_id = o.app_id AND rf.order_id = o.id
        ORDER BY rf.created_at DESC, rf.id DESC LIMIT 1) = ?`)
      params.push(filters.refundStatus)
    }
    if (filters.createdFrom) { clauses.push('o.created_at >= ?'); params.push(filters.createdFrom) }
    if (filters.createdTo) { clauses.push('o.created_at <= ?'); params.push(filters.createdTo) }
    if (filters.query) {
      clauses.push(`(o.id LIKE ? ESCAPE '\\\\' OR o.merchant_order_no LIKE ? ESCAPE '\\\\'
        OR p.nickname LIKE ? ESCAPE '\\\\' OR mp.name LIKE ? ESCAPE '\\\\'
        OR e.title LIKE ? ESCAPE '\\\\' OR knowledge.title LIKE ? ESCAPE '\\\\')`)
      const query = `%${escapeLike(filters.query)}%`
      params.push(query, query, query, query, query, query)
    }
    return { clauses, params }
  }

  async function listOrders(appId, visibility, filters, pageLimit, cursor = null) {
    const { clauses, params } = orderFilterWhere(appId, visibility, filters)
    const cursorWhere = cursorPredicateFor('o.created_at', cursor, 'createdAt', 'o.id')
    const rows = await database.query(
      `SELECT o.id, o.user_id, p.nickname, o.order_type, o.resource_id, o.membership_plan_id,
        mp.name AS membership_plan_name, e.title AS event_title, e.branch_id, eb.name AS event_branch_name,
        knowledge.title AS knowledge_title,
        o.merchant_order_no, o.provider_transaction_id, o.amount_cents, o.currency, o.status, o.paid_at,
        o.product_snapshot_json, o.version, o.created_at, entitlement.status AS entitlement_status,
        entitlement.starts_at AS entitlement_starts_at, entitlement.ends_at AS entitlement_ends_at,
        knowledge_entitlement.first_accessed_at AS knowledge_first_accessed_at,
        COALESCE((SELECT SUM(r.amount_cents) FROM mip_refunds r
          WHERE r.app_id = o.app_id AND r.order_id = o.id AND r.status = 'SUCCEEDED'), 0) AS refunded_amount,
        (SELECT r.status FROM mip_refunds r WHERE r.app_id = o.app_id AND r.order_id = o.id
          ORDER BY r.created_at DESC, r.id DESC LIMIT 1) AS refund_status,
        (SELECT r.id FROM mip_refunds r WHERE r.app_id = o.app_id AND r.order_id = o.id
          ORDER BY r.created_at DESC, r.id DESC LIMIT 1) AS refund_id
       FROM mip_orders o
       LEFT JOIN mip_profiles p ON p.app_id = o.app_id AND p.user_id = o.user_id
       LEFT JOIN mip_membership_plans mp ON mp.app_id = o.app_id AND mp.id = o.membership_plan_id
       LEFT JOIN mip_events e
         ON e.app_id = o.app_id AND e.id = o.resource_id AND o.order_type = 'EVENT'
       LEFT JOIN mip_knowledge_contents knowledge
         ON knowledge.app_id = o.app_id AND knowledge.id = o.resource_id AND o.order_type = 'CONTENT'
       LEFT JOIN mip_city_branches eb ON eb.app_id = e.app_id AND eb.id = e.branch_id
       LEFT JOIN mip_membership_entitlements entitlement
         ON entitlement.app_id = o.app_id AND entitlement.order_id = o.id
        AND entitlement.source_type = 'ORDER'
       LEFT JOIN mip_knowledge_entitlements knowledge_entitlement
         ON knowledge_entitlement.app_id = o.app_id AND knowledge_entitlement.order_id = o.id
       WHERE ${clauses.join(' AND ')}${cursorWhere.sql} ORDER BY o.created_at DESC, o.id DESC LIMIT ?`,
      [...params, ...cursorWhere.params, pageLimit + 1],
    )
    const items = rows.map(orderFromRow)
    return pageRows(items, pageLimit, row => ({ createdAt: row.createdAt, id: row.id }))
  }

  async function getOrderDetail(appId, visibility, orderId) {
    const scope = orderVisibilityWhere(visibility)
    const row = await database.one(
      `SELECT o.id, p.nickname, o.order_type, o.resource_id, o.membership_plan_id,
        mp.name AS membership_plan_name, e.title AS event_title, e.branch_id,
        eb.name AS event_branch_name, knowledge.title AS knowledge_title,
        o.merchant_order_no, o.provider_transaction_id, o.amount_cents, o.currency,
        o.status, o.paid_at, o.closed_at, o.product_snapshot_json, o.version,
        o.created_at, o.updated_at, buyer.status AS buyer_status,
        buyer_branch.name AS buyer_branch_name, buyer_branch.city_name AS buyer_city_name,
        EXISTS (
          SELECT 1 FROM mip_membership_entitlements current_membership
          WHERE current_membership.app_id = o.app_id
            AND current_membership.user_id = o.user_id
            AND current_membership.status = 'ACTIVE'
            AND current_membership.starts_at <= UTC_TIMESTAMP(3)
            AND current_membership.ends_at > UTC_TIMESTAMP(3)
        ) AS buyer_is_player,
        entitlement.id AS membership_entitlement_id,
        entitlement.status AS entitlement_status,
        entitlement.starts_at AS entitlement_starts_at,
        entitlement.ends_at AS entitlement_ends_at,
        entitlement.revoked_at AS entitlement_revoked_at,
        entitlement.created_at AS entitlement_created_at,
        entitlement.updated_at AS entitlement_updated_at,
        knowledge_entitlement.id AS knowledge_entitlement_id,
        knowledge_entitlement.status AS knowledge_entitlement_status,
        knowledge_entitlement.starts_at AS knowledge_entitlement_starts_at,
        knowledge_entitlement.ends_at AS knowledge_entitlement_ends_at,
        knowledge_entitlement.first_accessed_at AS knowledge_first_accessed_at,
        knowledge_entitlement.revoked_at AS knowledge_entitlement_revoked_at,
        knowledge_entitlement.created_at AS knowledge_entitlement_created_at,
        knowledge_entitlement.updated_at AS knowledge_entitlement_updated_at,
        registration.status AS event_registration_status,
        registration.registered_at AS event_registered_at,
        registration.cancelled_at AS event_cancelled_at,
        registration.updated_at AS event_registration_updated_at,
        COALESCE((SELECT SUM(r.amount_cents) FROM mip_refunds r
          WHERE r.app_id = o.app_id AND r.order_id = o.id AND r.status = 'SUCCEEDED'), 0) AS refunded_amount,
        (SELECT r.status FROM mip_refunds r WHERE r.app_id = o.app_id AND r.order_id = o.id
          ORDER BY r.created_at DESC, r.id DESC LIMIT 1) AS refund_status,
        (SELECT r.id FROM mip_refunds r WHERE r.app_id = o.app_id AND r.order_id = o.id
          ORDER BY r.created_at DESC, r.id DESC LIMIT 1) AS refund_id
       FROM mip_orders o
       INNER JOIN mip_users buyer ON buyer.app_id = o.app_id AND buyer.id = o.user_id
       LEFT JOIN mip_profiles p ON p.app_id = o.app_id AND p.user_id = o.user_id
       LEFT JOIN mip_city_branches buyer_branch
         ON buyer_branch.app_id = buyer.app_id AND buyer_branch.id = buyer.primary_branch_id
       LEFT JOIN mip_membership_plans mp ON mp.app_id = o.app_id AND mp.id = o.membership_plan_id
       LEFT JOIN mip_events e
         ON e.app_id = o.app_id AND e.id = o.resource_id AND o.order_type = 'EVENT'
       LEFT JOIN mip_city_branches eb ON eb.app_id = e.app_id AND eb.id = e.branch_id
       LEFT JOIN mip_knowledge_contents knowledge
         ON knowledge.app_id = o.app_id AND knowledge.id = o.resource_id AND o.order_type = 'CONTENT'
       LEFT JOIN mip_membership_entitlements entitlement
         ON entitlement.app_id = o.app_id AND entitlement.order_id = o.id
        AND entitlement.source_type = 'ORDER'
       LEFT JOIN mip_knowledge_entitlements knowledge_entitlement
         ON knowledge_entitlement.app_id = o.app_id AND knowledge_entitlement.order_id = o.id
       LEFT JOIN mip_event_registrations registration
         ON registration.app_id = o.app_id AND registration.order_id = o.id
        AND registration.event_id = o.resource_id AND o.order_type = 'EVENT'
       WHERE o.app_id = ? AND o.id = ? AND ${scope.sql}`,
      [appId, orderId, ...scope.params],
    )
    if (!row) return null

    const [paymentAttemptRows, paymentCallbackRows, refundRows] = await Promise.all([
      database.query(
        `SELECT provider, provider_payment_id, status, last_error_code, created_at, updated_at
         FROM mip_payment_attempts
         WHERE app_id = ? AND order_id = ?
         ORDER BY created_at ASC, id ASC`,
        [appId, orderId],
      ),
      database.query(
        `SELECT callback.callback_type, callback.verification_status,
                callback.processing_status, callback.processed_at,
                callback.last_error_code, callback.created_at, callback.updated_at
         FROM mip_orders order_row
         INNER JOIN mip_payment_callbacks callback
           ON callback.app_id = order_row.app_id
          AND callback.callback_type = 'PAYMENT'
          AND callback.callback_key = order_row.provider_transaction_id
         WHERE order_row.app_id = ? AND order_row.id = ?
         ORDER BY callback.created_at ASC, callback.id ASC`,
        [appId, orderId],
      ),
      database.query(
        `SELECT refund.id, refund.requested_by_user_id, order_row.user_id AS buyer_user_id,
                refund.merchant_refund_no, refund.provider_refund_id,
                refund.amount_cents, order_row.currency, refund.reason, refund.status,
                refund.refunded_at, refund.last_error_code, refund.created_at, refund.updated_at,
                callback.callback_type, callback.verification_status,
                callback.processing_status, callback.processed_at,
                callback.last_error_code AS callback_last_error_code,
                callback.created_at AS callback_created_at,
                callback.updated_at AS callback_updated_at
         FROM mip_refunds refund
         INNER JOIN mip_orders order_row
           ON order_row.app_id = refund.app_id AND order_row.id = refund.order_id
         LEFT JOIN mip_payment_callbacks callback
           ON callback.app_id = refund.app_id
          AND callback.callback_type = 'REFUND'
          AND callback.callback_key = refund.provider_refund_id
         WHERE refund.app_id = ? AND refund.order_id = ?
         ORDER BY refund.created_at ASC, refund.id ASC`,
        [appId, orderId],
      ),
    ])

    const order = {
      ...orderFromRow(row),
      closedAt: iso(row.closed_at),
      updatedAt: iso(row.updated_at),
    }
    return {
      scope: order.orderType === 'EVENT'
        ? { scopeType: 'EVENT', scopeId: order.resourceId, branchId: order.branchId || null }
        : { scopeType: 'PLATFORM', scopeId: null, branchId: null },
      order,
      buyer: {
        nickname: row.nickname || '未填写昵称',
        kind: Number(row.buyer_is_player) === 1 ? 'PLAYER' : 'GUEST',
        accountStatus: row.buyer_status,
        branchName: row.buyer_branch_name || '',
        cityName: row.buyer_city_name || '',
      },
      productSnapshot: safeProductSnapshot(row.product_snapshot_json),
      paymentAttempts: paymentAttemptRows.map(paymentAttemptFromRow),
      paymentCallbacks: paymentCallbackRows.map(paymentCallbackFromRow),
      refunds: refundRows.map(refundFromRow),
      entitlementTimeline: entitlementTimelineFromRow(row),
      statusTimeline: orderStatusTimeline(order),
    }
  }

  async function summarizeOrders(appId, visibility, filters) {
    const { clauses, params } = orderFilterWhere(appId, visibility, filters)
    const row = await database.one(
      `SELECT COUNT(*) AS order_count,
        SUM(CASE WHEN o.paid_at IS NOT NULL THEN 1 ELSE 0 END) AS paid_order_count,
        SUM(CASE WHEN o.paid_at IS NOT NULL AND o.order_type = 'EVENT' THEN o.amount_cents ELSE 0 END) AS event_gross_amount,
        SUM(CASE WHEN o.paid_at IS NOT NULL AND o.order_type = 'MEMBERSHIP' THEN o.amount_cents ELSE 0 END) AS membership_gross_amount,
        SUM(CASE WHEN o.paid_at IS NOT NULL THEN o.amount_cents ELSE 0 END) AS gross_amount,
        SUM(COALESCE((SELECT SUM(r.amount_cents) FROM mip_refunds r
          WHERE r.app_id = o.app_id AND r.order_id = o.id AND r.status = 'SUCCEEDED'), 0)) AS refunded_amount
       FROM mip_orders o
       LEFT JOIN mip_profiles p ON p.app_id = o.app_id AND p.user_id = o.user_id
       LEFT JOIN mip_membership_plans mp ON mp.app_id = o.app_id AND mp.id = o.membership_plan_id
       LEFT JOIN mip_events e
         ON e.app_id = o.app_id AND e.id = o.resource_id AND o.order_type = 'EVENT'
       WHERE ${clauses.join(' AND ')}`,
      params,
    )
    const grossAmountCents = Number(row?.gross_amount || 0)
    const refundedAmountCents = Number(row?.refunded_amount || 0)
    return {
      currency: 'CNY',
      orderCount: Number(row?.order_count || 0),
      paidOrderCount: Number(row?.paid_order_count || 0),
      eventGrossAmountCents: Number(row?.event_gross_amount || 0),
      membershipGrossAmountCents: Number(row?.membership_gross_amount || 0),
      grossAmountCents,
      refundedAmountCents,
      netAmountCents: Math.max(0, grossAmountCents - refundedAmountCents),
    }
  }

  async function listOrderSummary(appId, visibility) {
    const scope = orderVisibilityWhere(visibility)
    const row = await database.one(
      `SELECT SUM(CASE WHEN o.status = 'PAID' THEN 1 ELSE 0 END) AS paid_orders,
        SUM(CASE WHEN o.status = 'REFUND_PENDING' THEN 1 ELSE 0 END) AS pending_refunds
       FROM mip_orders o WHERE o.app_id = ? AND ${scope.sql}`,
      [appId, ...scope.params],
    )
    return { paidOrders: Number(row?.paid_orders || 0), pendingRefunds: Number(row?.pending_refunds || 0) }
  }

  async function submitRefund(input) {
    return database.transaction(async (tx) => {
      const authorization = await lockMutation(tx, input)
      const orderReference = await tx.one(
        `SELECT order_type, resource_id FROM mip_orders
         WHERE app_id = ? AND id = ?`,
        [input.appId, input.orderId],
      )
      if (!orderReference) throw codeError('NOT_FOUND')
      let event = null
      if (orderReference.order_type === 'EVENT') {
        event = await tx.one(
          `SELECT id, branch_id FROM mip_events
           WHERE app_id = ? AND id = ? FOR UPDATE`,
          [input.appId, orderReference.resource_id],
        )
        if (!event) throw codeError('NOT_FOUND')
      }
      const order = await tx.one(
        `SELECT id, user_id, order_type, resource_id, amount_cents, status, version,
                paid_at, product_snapshot_json
         FROM mip_orders
         WHERE app_id = ? AND id = ? FOR UPDATE`,
        [input.appId, input.orderId],
      )
      if (!order) throw codeError('NOT_FOUND')
      if (json(order.product_snapshot_json, {}).demo === true) throw codeError('DEMO_ORDER')
      if (order.order_type !== orderReference.order_type
        || order.resource_id !== orderReference.resource_id) throw codeError('CONFLICT')
      let currentScope = { scopeType: 'PLATFORM', scopeId: null, branchId: null }
      let eventRegistration = null
      let activeEventCheckin = null
      if (order.order_type === 'EVENT') {
        currentScope = eventScopeFromRow(event, order.resource_id)
        eventRegistration = await tx.one(
          `SELECT id, user_id, status, version FROM mip_event_registrations
           WHERE app_id = ? AND event_id = ? AND order_id = ? AND user_id = ? FOR UPDATE`,
          [input.appId, order.resource_id, order.id, order.user_id],
        )
        if (!eventRegistration) throw codeError('INVALID_STATE')
        activeEventCheckin = await tx.one(
          `SELECT id, version FROM mip_event_checkins
           WHERE app_id = ? AND event_id = ? AND registration_id = ? AND status = 'ACTIVE' FOR UPDATE`,
          [input.appId, order.resource_id, eventRegistration.id],
        )
        if (activeEventCheckin) throw codeError('INVALID_STATE')
      }
      assertScope(authorization, currentScope)
      if (input.authorizedScope && !sameScope(currentScope, input.authorizedScope)) {
        throw codeError('CONFLICT')
      }
      const existing = await tx.one(
        `SELECT id, amount_cents, status, version, reason FROM mip_refunds
         WHERE app_id = ? AND order_id = ? AND idempotency_key = ? FOR UPDATE`,
        [input.appId, input.orderId, input.idempotencyKey],
      )
      if (existing) {
        if (existing.reason !== input.reason) throw codeError('IDEMPOTENCY_CONFLICT')
        if (order.order_type === 'EVENT') {
          if (existing.status === 'FAILED') {
            if (eventRegistration.status !== 'CANCELLATION_PENDING'
              || !['PAID', 'PARTIALLY_REFUNDED'].includes(order.status)) {
              throw codeError('INVALID_STATE')
            }
            const latest = await tx.one(
              `SELECT id, amount_cents, status FROM mip_refunds
               WHERE app_id = ? AND order_id = ?
               ORDER BY created_at DESC, id DESC LIMIT 1 FOR UPDATE`,
              [input.appId, input.orderId],
            )
            if (latest && ['PENDING', 'PROVIDER_CREATED', 'PROCESSING'].includes(latest.status)) {
              return {
                id: latest.id,
                orderId: input.orderId,
                amountCents: Number(latest.amount_cents),
                status: latest.status,
                idempotent: true,
              }
            }
            const totals = await tx.one(
              `SELECT COALESCE(SUM(amount_cents), 0) AS refunded FROM mip_refunds
               WHERE app_id = ? AND order_id = ?
                 AND status IN ('PENDING', 'PROVIDER_CREATED', 'PROCESSING', 'SUCCEEDED')`,
              [input.appId, input.orderId],
            )
            const amount = Number(order.amount_cents) - Number(totals?.refunded || 0)
            if (amount <= 0) throw codeError('INVALID_STATE')
            const refundId = id()
            const merchantRefundNo = `MIPR${Date.now()}${bytes(5).toString('hex').toUpperCase()}`.slice(0, 64)
            await tx.query(
              `INSERT INTO mip_refunds (
                id, app_id, order_id, requested_by_user_id, merchant_refund_no,
                idempotency_key, amount_cents, reason, status
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING')`,
              [refundId, input.appId, input.orderId, input.actorUserId, merchantRefundNo,
                `admin-refund-retry:${latest?.id || existing.id}`, amount, input.reason],
            )
            const orderUpdated = await tx.query(
              `UPDATE mip_orders SET status = 'REFUND_PENDING', version = version + 1
               WHERE app_id = ? AND id = ? AND version = ?
                 AND status IN ('PAID', 'PARTIALLY_REFUNDED')`,
              [input.appId, order.id, order.version],
            )
            if (Number(orderUpdated.affectedRows) !== 1) throw codeError('CONFLICT')
            await writeAudit(tx, input.audit(refundId, amount))
            await writeOutbox(tx, {
              id: id(),
              appId: input.appId,
              aggregateType: 'REFUND',
              aggregateId: refundId,
              eventType: 'admin.refund_requested',
              sourceVersion: 1,
              payload: { refundId, orderId: input.orderId, requestedByUserId: input.actorUserId, retried: true },
            })
            return {
              id: refundId,
              orderId: input.orderId,
              amountCents: amount,
              status: 'PENDING',
              idempotent: false,
            }
          }
          const expectedRegistrationStatus = existing.status === 'SUCCEEDED' ? 'CANCELLED' : 'CANCELLATION_PENDING'
          if (eventRegistration.status !== expectedRegistrationStatus) throw codeError('INVALID_STATE')
        }
        return {
          id: existing.id,
          orderId: input.orderId,
          amountCents: Number(existing.amount_cents),
          status: existing.status,
          idempotent: true,
        }
      }
      if (!['PAID', 'PARTIALLY_REFUNDED'].includes(order.status)) throw codeError('INVALID_STATE')
      if (order.order_type === 'EVENT'
        && !['REGISTERED', 'CANCELLATION_PENDING'].includes(eventRegistration.status)) {
        throw codeError('INVALID_STATE')
      }
      if (order.order_type === 'CONTENT') {
        const entitlement = await tx.one(
          `SELECT first_accessed_at FROM mip_knowledge_entitlements
           WHERE app_id = ? AND order_id = ? AND status = 'ACTIVE' FOR UPDATE`,
          [input.appId, order.id],
        )
        if (!contentRefundEligible({
          ...order,
          knowledge_first_accessed_at: entitlement?.first_accessed_at,
        })) {
          throw codeError('CONTENT_REFUND_NOT_AVAILABLE')
        }
      }
      const totals = await tx.one(
        `SELECT COALESCE(SUM(amount_cents), 0) AS refunded FROM mip_refunds
         WHERE app_id = ? AND order_id = ? AND status IN ('PENDING', 'PROVIDER_CREATED', 'PROCESSING', 'SUCCEEDED')`,
        [input.appId, input.orderId],
      )
      const amount = Number(order.amount_cents) - Number(totals?.refunded || 0)
      if (amount <= 0) throw codeError('INVALID_STATE')
      const refundId = id()
      const merchantRefundNo = `MIPR${Date.now()}${bytes(5).toString('hex').toUpperCase()}`.slice(0, 64)
      try {
        await tx.query(
          `INSERT INTO mip_refunds (
            id, app_id, order_id, requested_by_user_id, merchant_refund_no,
            idempotency_key, amount_cents, reason, status
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING')`,
          [refundId, input.appId, input.orderId, input.actorUserId, merchantRefundNo,
            input.idempotencyKey, amount, input.reason],
        )
      }
      catch (error) {
        if (error?.code === 'ER_DUP_ENTRY') throw codeError('CONFLICT')
        throw error
      }
      const updated = await tx.query(
        `UPDATE mip_orders SET status = 'REFUND_PENDING', version = version + 1
         WHERE app_id = ? AND id = ? AND version = ?
           AND status IN ('PAID', 'PARTIALLY_REFUNDED')`,
        [input.appId, input.orderId, order.version],
      )
      if (Number(updated.affectedRows) !== 1) throw codeError('CONFLICT')
      if (order.order_type === 'EVENT' && eventRegistration.status === 'REGISTERED') {
        const registrationUpdated = await tx.query(
          `UPDATE mip_event_registrations SET
             status = 'CANCELLATION_PENDING', cancelled_at = ?, cancelled_by_type = 'ADMIN',
             cancellation_reason = ?, version = version + 1
           WHERE app_id = ? AND id = ? AND version = ? AND status = 'REGISTERED'`,
          [now(), input.reason, input.appId, eventRegistration.id, eventRegistration.version],
        )
        if (Number(registrationUpdated.affectedRows) !== 1) throw codeError('CONFLICT')
        await writeOutbox(tx, {
          id: id(),
          appId: input.appId,
          aggregateType: 'EVENT_REGISTRATION',
          aggregateId: eventRegistration.id,
          eventType: 'event.registration_refund_requested',
          sourceVersion: Number(eventRegistration.version) + 1,
          payload: {
            eventId: order.resource_id,
            orderId: order.id,
            refundId,
            userId: eventRegistration.user_id,
            status: 'CANCELLATION_PENDING',
            requestedByAdmin: true,
          },
        })
      }
      await writeAudit(tx, input.audit(refundId, amount))
      await writeOutbox(tx, {
        id: id(),
        appId: input.appId,
        aggregateType: 'REFUND',
        aggregateId: refundId,
        eventType: 'admin.refund_requested',
        sourceVersion: 1,
        payload: { refundId, orderId: input.orderId, requestedByUserId: input.actorUserId },
      })
      return {
        id: refundId,
        orderId: input.orderId,
        amountCents: amount,
        status: 'PENDING',
        idempotent: false,
      }
    })
  }

  async function authorizeRefundRetry(input) {
    return database.transaction(async (tx) => {
      const authorization = await lockMutation(tx, input)
      const refund = await tx.one(
        `SELECT id, order_id, status FROM mip_refunds
         WHERE app_id = ? AND id = ? FOR UPDATE`,
        [input.appId, input.refundId],
      )
      if (!refund) throw codeError('NOT_FOUND')
      const order = await tx.one(
        `SELECT id, order_type, resource_id FROM mip_orders
         WHERE app_id = ? AND id = ? FOR UPDATE`,
        [input.appId, refund.order_id],
      )
      if (!order) throw codeError('NOT_FOUND')
      let currentScope = { scopeType: 'PLATFORM', scopeId: null, branchId: null }
      if (order.order_type === 'EVENT') {
        const event = await tx.one(
          `SELECT id, branch_id FROM mip_events
           WHERE app_id = ? AND id = ? FOR UPDATE`,
          [input.appId, order.resource_id],
        )
        if (!event) throw codeError('NOT_FOUND')
        currentScope = eventScopeFromRow(event, order.resource_id)
      }
      assertScope(authorization, currentScope)
      if (input.authorizedScope && !sameScope(currentScope, input.authorizedScope)) {
        throw codeError('CONFLICT')
      }
      if (!['PENDING', 'PROVIDER_CREATED', 'PROCESSING'].includes(refund.status)) {
        throw codeError('INVALID_STATE')
      }
      await writeAudit(tx, input.audit)
      return { id: input.refundId, status: refund.status }
    })
  }

  return {
    authorizeRefundRetry,
    getOrderDetail,
    getOrderScope,
    getRefundScope,
    listOrders,
    listOrderSummary,
    submitRefund,
    summarizeOrders,
  }
}

function placeholders(values) {
  return values.map(() => '?').join(', ')
}

function escapeLike(value) {
  return value.replace(/[\\%_]/g, '\\$&')
}

function orderFromRow(row) {
  return {
    id: row.id,
    nickname: row.nickname || '未填写昵称',
    orderType: row.order_type,
    resourceId: row.order_type === 'MEMBERSHIP' ? row.membership_plan_id : row.resource_id,
    resourceType: row.order_type === 'MEMBERSHIP'
      ? 'MEMBERSHIP_PLAN'
      : row.order_type === 'CONTENT' ? 'KNOWLEDGE_CONTENT' : 'EVENT',
    resourceTitle: row.order_type === 'MEMBERSHIP'
      ? row.membership_plan_name || '会员方案'
      : row.order_type === 'CONTENT' ? row.knowledge_title || '单内容解锁' : row.event_title || '活动',
    resourceBranchName: row.event_branch_name || '',
    merchantOrderNoMasked: maskIdentifier(row.merchant_order_no),
    amountCents: Number(row.amount_cents),
    refundedAmountCents: Number(row.refunded_amount || 0),
    currency: row.currency,
    status: row.status,
    refundStatus: row.refund_status || null,
    refundId: row.refund_id || null,
    paidAt: iso(row.paid_at),
    ...(row.order_type === 'MEMBERSHIP' ? {
      entitlementStartsAt: iso(row.entitlement_starts_at),
      entitlementEndsAt: iso(row.entitlement_ends_at),
      entitlementStatus: row.entitlement_status || null,
    } : {}),
    createdAt: iso(row.created_at),
    version: Number(row.version),
    providerTransactionIdMasked: row.provider_transaction_id ? maskIdentifier(row.provider_transaction_id) : null,
    branchId: row.branch_id || null,
    demoOrder: json(row.product_snapshot_json, {}).demo === true,
    ...(row.order_type === 'CONTENT' ? { contentRefundEligible: contentRefundEligible(row) } : {}),
  }
}

function safeProductSnapshot(value) {
  const snapshot = json(value, {})
  return {
    title: safeText(snapshot.title || snapshot.name, 120),
    catalogStage: ['TEST', 'LIVE'].includes(snapshot.catalogStage) ? snapshot.catalogStage : null,
    version: integer(snapshot.version ?? snapshot.eventVersion, 1, Number.MAX_SAFE_INTEGER),
    durationDays: integer(snapshot.durationDays, 1, 3660),
    unlockDays: integer(snapshot.unlockDays, 1, 3660),
    benefits: Array.isArray(snapshot.benefits)
      ? snapshot.benefits
          .slice(0, 30)
          .map(item => safeText(item, 160))
          .filter(Boolean)
      : [],
    refundPolicy: ['BEFORE_ACCESS', 'NON_REFUNDABLE'].includes(snapshot.refundPolicy)
      ? snapshot.refundPolicy
      : null,
    refundWindowHours: integer(snapshot.refundWindowHours, 0, 720),
    eventStartsAt: iso(snapshot.startsAt),
    eventEndsAt: iso(snapshot.endsAt),
    cityName: safeText(snapshot.cityName, 80),
    venueName: safeText(snapshot.venueName, 120),
  }
}

function paymentAttemptFromRow(row) {
  return {
    provider: row.provider,
    status: row.status,
    providerPaymentIdMasked: row.provider_payment_id ? maskIdentifier(row.provider_payment_id) : null,
    requiresAttention: Boolean(row.last_error_code),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  }
}

function paymentCallbackFromRow(row) {
  return {
    callbackType: row.callback_type,
    verificationStatus: row.verification_status,
    processingStatus: row.processing_status,
    requiresAttention: Boolean(row.last_error_code),
    processedAt: iso(row.processed_at),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  }
}

function refundFromRow(row) {
  const createdAt = iso(row.created_at)
  const updatedAt = iso(row.updated_at)
  const refundedAt = iso(row.refunded_at)
  const statusTimeline = [{
    status: 'PENDING',
    occurredAt: createdAt,
    evidence: 'REFUND_CREATED',
  }]
  if (row.status === 'SUCCEEDED' && refundedAt) {
    statusTimeline.push({
      status: 'SUCCEEDED',
      occurredAt: refundedAt,
      evidence: 'REFUND_COMPLETED',
    })
  }
  return {
    id: row.id,
    requestedBy: row.requested_by_user_id === null
      ? 'SYSTEM'
      : row.requested_by_user_id === row.buyer_user_id ? 'BUYER' : 'OPERATOR',
    merchantRefundNoMasked: maskIdentifier(row.merchant_refund_no),
    providerRefundIdMasked: row.provider_refund_id ? maskIdentifier(row.provider_refund_id) : null,
    amountCents: Number(row.amount_cents),
    currency: row.currency,
    reason: safeText(row.reason, 300),
    status: row.status,
    requiresAttention: Boolean(row.last_error_code),
    refundedAt,
    createdAt,
    updatedAt,
    callback: row.callback_type ? paymentCallbackFromRow({
      callback_type: row.callback_type,
      verification_status: row.verification_status,
      processing_status: row.processing_status,
      processed_at: row.processed_at,
      last_error_code: row.callback_last_error_code,
      created_at: row.callback_created_at,
      updated_at: row.callback_updated_at,
    }) : null,
    statusTimeline,
  }
}

function entitlementTimelineFromRow(row) {
  const items = []
  if (row.membership_entitlement_id) {
    items.push({
      kind: 'MEMBERSHIP',
      status: row.entitlement_status,
      startsAt: iso(row.entitlement_starts_at),
      endsAt: iso(row.entitlement_ends_at),
      firstAccessedAt: null,
      revokedAt: iso(row.entitlement_revoked_at),
      createdAt: iso(row.entitlement_created_at),
      updatedAt: iso(row.entitlement_updated_at),
    })
  }
  if (row.knowledge_entitlement_id) {
    items.push({
      kind: 'CONTENT',
      status: row.knowledge_entitlement_status,
      startsAt: iso(row.knowledge_entitlement_starts_at),
      endsAt: iso(row.knowledge_entitlement_ends_at),
      firstAccessedAt: iso(row.knowledge_first_accessed_at),
      revokedAt: iso(row.knowledge_entitlement_revoked_at),
      createdAt: iso(row.knowledge_entitlement_created_at),
      updatedAt: iso(row.knowledge_entitlement_updated_at),
    })
  }
  return items.sort((left, right) => String(left.startsAt).localeCompare(String(right.startsAt)))
}

function orderStatusTimeline(order) {
  const items = [{
    status: 'CREATED',
    occurredAt: order.createdAt,
    evidence: 'ORDER_CREATED',
  }]
  if (order.paidAt) {
    items.push({ status: 'PAID', occurredAt: order.paidAt, evidence: 'PAYMENT_CONFIRMED' })
  }
  if (order.closedAt) {
    items.push({ status: 'CLOSED', occurredAt: order.closedAt, evidence: 'ORDER_CLOSED' })
  }
  return items
    .filter(item => item.occurredAt)
    .sort((left, right) => String(left.occurredAt).localeCompare(String(right.occurredAt)))
}

function integer(value, minimum, maximum) {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  return Number.isSafeInteger(number) && number >= minimum && number <= maximum ? number : null
}

function safeText(value, maximum) {
  if (typeof value !== 'string') return ''
  const normalized = value.trim()
  return normalized.length <= maximum ? normalized : normalized.slice(0, maximum)
}

function iso(value) {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isFinite(date.getTime()) ? date.toISOString() : null
}

function json(value, fallback = {}) {
  if (value === null || value === undefined) return fallback
  if (typeof value === 'object') return value
  try { return JSON.parse(value) }
  catch { return fallback }
}

function eventScopeFromRow(row, eventId = row.id) {
  return {
    scopeType: 'EVENT',
    scopeId: eventId,
    branchId: row.branch_id || null,
  }
}

function sameScope(left, right) {
  return left?.scopeType === right?.scopeType
    && (left?.scopeId || null) === (right?.scopeId || null)
    && (left?.scopeType !== 'EVENT'
      || (left?.branchId || null) === (right?.branchId || null))
}

function maskIdentifier(value) {
  const text = String(value || '')
  if (!text) return ''
  if (text.length <= 4) return '…'
  if (text.length <= 8) return `${text.slice(0, 1)}…${text.slice(-1)}`
  return `${text.slice(0, 4)}…${text.slice(-4)}`
}

function contentRefundEligible(row) {
  if (row.order_type !== 'CONTENT') return true
  const snapshot = json(row.product_snapshot_json, {})
  const windowHours = Number(snapshot.refundWindowHours)
  const paidAt = new Date(row.paid_at)
  return snapshot.refundPolicy === 'BEFORE_ACCESS'
    && !row.knowledge_first_accessed_at
    && Number.isInteger(windowHours)
    && windowHours >= 0
    && windowHours <= 720
    && Number.isFinite(paidAt.getTime())
    && paidAt.getTime() + windowHours * 3_600_000 > Date.now()
}

async function writeOutbox(tx, event) {
  await tx.query(
    `INSERT INTO mip_outbox_events (
      id, app_id, aggregate_type, aggregate_id, event_type, source_version, payload_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [event.id, event.appId, event.aggregateType, event.aggregateId, event.eventType,
      event.sourceVersion, JSON.stringify(event.payload || {})],
  )
}

async function writeAudit(tx, audit) {
  await tx.query(
    `INSERT INTO mip_audit_logs (
      app_id, actor_user_id, actor_type, scope_type, scope_id, action,
      resource_type, resource_id, effective_role, metadata_json
    ) VALUES (?, ?, 'ADMIN', ?, ?, ?, ?, ?, ?, ?)`,
    [audit.appId, audit.actorUserId, audit.scopeType, audit.scopeId || null,
      audit.action, audit.resourceType, audit.resourceId || null,
      audit.effectiveRole || null, JSON.stringify(audit.metadata || {})],
  )
}

function codeError(code) {
  const error = new Error(code)
  error.code = code
  return error
}

module.exports = { createAdminOrderRepository }
