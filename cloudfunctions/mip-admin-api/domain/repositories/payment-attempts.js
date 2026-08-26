'use strict'

const { cursorPredicateFor, pageRows } = require('../pagination')

function createAdminPaymentAttemptRepository(database, options = {}) {
  const iso = options.iso || (value => {
    if (!value) return null
    const date = value instanceof Date ? value : new Date(value)
    return Number.isFinite(date.getTime()) ? date.toISOString() : null
  })
  const escapeLike = options.escapeLike || (value => value.replace(/[\\%_]/g, '\\$&'))

  async function listPaymentAttempts(appId, visibility, filters, pageLimit, cursor = null) {
    const scope = paymentVisibilityWhere(visibility)
    const clauses = ['attempt.app_id = ?', scope.sql]
    const params = [appId, ...scope.params]
    if (filters.provider) {
      clauses.push('attempt.provider = ?')
      params.push(filters.provider)
    }
    if (filters.status) {
      clauses.push('attempt.status = ?')
      params.push(filters.status)
    }
    if (filters.createdFrom) {
      clauses.push('attempt.created_at >= ?')
      params.push(filters.createdFrom)
    }
    if (filters.createdTo) {
      clauses.push('attempt.created_at <= ?')
      params.push(filters.createdTo)
    }
    if (filters.query) {
      const query = `%${escapeLike(filters.query)}%`
      clauses.push(`(p.nickname LIKE ? ESCAPE '\\\\'
        OR CAST(lifecycle.player_number AS CHAR) LIKE ? ESCAPE '\\\\'
        OR attempt.order_id LIKE ? ESCAPE '\\\\'
        OR o.merchant_order_no LIKE ? ESCAPE '\\\\')`)
      params.push(query, query, query, query)
    }
    const cursorWhere = cursorPredicateFor('attempt.created_at', cursor, 'createdAt', 'attempt.id')
    const rows = await database.query(
      `SELECT attempt.id AS attempt_id, attempt.order_id, attempt.provider,
        attempt.provider_payment_id, attempt.status, attempt.last_error_code,
        attempt.created_at, attempt.updated_at, o.order_type, o.merchant_order_no,
        o.amount_cents, o.currency, p.nickname, lifecycle.player_number,
        mp.name AS membership_plan_name, e.title AS event_title,
        knowledge.title AS knowledge_title
       FROM mip_payment_attempts attempt
       INNER JOIN mip_orders o
         ON o.app_id = attempt.app_id AND o.id = attempt.order_id
       INNER JOIN mip_users u
         ON u.app_id = o.app_id AND u.id = o.user_id
       LEFT JOIN mip_profiles p
         ON p.app_id = u.app_id AND p.user_id = u.id
       LEFT JOIN mip_player_lifecycles lifecycle
         ON lifecycle.app_id = u.app_id AND lifecycle.user_id = u.id
       LEFT JOIN mip_membership_plans mp
         ON mp.app_id = o.app_id AND mp.id = o.membership_plan_id
       LEFT JOIN mip_events e
         ON e.app_id = o.app_id AND e.id = o.resource_id AND o.order_type = 'EVENT'
       LEFT JOIN mip_knowledge_contents knowledge
         ON knowledge.app_id = o.app_id AND knowledge.id = o.resource_id AND o.order_type = 'CONTENT'
       WHERE ${clauses.join(' AND ')}${cursorWhere.sql}
       ORDER BY attempt.created_at DESC, attempt.id DESC
       LIMIT ?`,
      [...params, ...cursorWhere.params, pageLimit + 1],
    )
    const items = rows.map(row => ({
      id: String(row.attempt_id),
      orderId: String(row.order_id),
      orderNumberMasked: maskIdentifier(row.merchant_order_no || row.order_id),
      nickname: row.nickname || '未填写昵称',
      playerNumber: row.player_number === null || row.player_number === undefined
        ? null
        : Number(row.player_number),
      provider: row.provider,
      status: row.status,
      providerPaymentIdMasked: row.provider_payment_id ? maskIdentifier(row.provider_payment_id) : null,
      requiresAttention: Boolean(row.last_error_code),
      orderType: row.order_type,
      orderTitle: orderTitle(row),
      amountCents: Number(row.amount_cents),
      currency: row.currency,
      createdAt: iso(row.created_at),
      updatedAt: iso(row.updated_at),
    }))
    return pageRows(items, pageLimit, row => ({ createdAt: row.createdAt, id: row.id }))
  }

  return { listPaymentAttempts }
}

function paymentVisibilityWhere(visibility) {
  if (visibility.platform) return { sql: '1 = 1', params: [] }
  const clauses = []
  const params = []
  if (visibility.branchIds.length) {
    clauses.push(`EXISTS (
      SELECT 1 FROM mip_events visible_event
      WHERE visible_event.app_id = o.app_id
        AND visible_event.id = o.resource_id
        AND visible_event.branch_id IN (${placeholders(visibility.branchIds)})
    )`)
    params.push(...visibility.branchIds)
  }
  if (visibility.eventIds.length) {
    clauses.push(`(o.order_type = 'EVENT' AND o.resource_id IN (${placeholders(visibility.eventIds)}))`)
    params.push(...visibility.eventIds)
  }
  return {
    sql: clauses.length ? `(o.order_type = 'EVENT' AND (${clauses.join(' OR ')}))` : '0 = 1',
    params,
  }
}

function orderTitle(row) {
  if (row.order_type === 'MEMBERSHIP') return row.membership_plan_name || '会员方案'
  if (row.order_type === 'CONTENT') return row.knowledge_title || '单内容解锁'
  return row.event_title || '活动'
}

function placeholders(values) {
  return values.map(() => '?').join(', ')
}

function maskIdentifier(value) {
  const text = String(value || '')
  if (!text) return ''
  if (text.length <= 4) return '…'
  if (text.length <= 8) return `${text.slice(0, 1)}…${text.slice(-1)}`
  return `${text.slice(0, 4)}…${text.slice(-4)}`
}

module.exports = { createAdminPaymentAttemptRepository }
