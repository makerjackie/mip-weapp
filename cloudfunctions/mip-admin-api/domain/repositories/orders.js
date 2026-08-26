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
       LEFT JOIN mip_events e ON e.app_id = o.app_id AND e.id = o.resource_id
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
       LEFT JOIN mip_events e ON e.app_id = o.app_id AND e.id = o.resource_id
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
       LEFT JOIN mip_events e ON e.app_id = o.app_id AND e.id = o.resource_id
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
    const items = rows.map(row => ({
      id: row.id,
      userId: row.user_id,
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
    }))
    return pageRows(items, pageLimit, row => ({ createdAt: row.createdAt, id: row.id }))
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
       LEFT JOIN mip_events e ON e.app_id = o.app_id AND e.id = o.resource_id
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
        `SELECT id, amount_cents, status, version FROM mip_refunds
         WHERE app_id = ? AND order_id = ? AND idempotency_key = ? FOR UPDATE`,
        [input.appId, input.orderId, input.idempotencyKey],
      )
      if (existing) {
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
  return text.length <= 8 ? text : `${text.slice(0, 4)}…${text.slice(-4)}`
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
