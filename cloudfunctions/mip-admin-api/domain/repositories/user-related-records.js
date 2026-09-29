'use strict'

const { createHash } = require('node:crypto')
const { cursorPredicateFor, decodeCursor, pageRows } = require('../pagination')
const { AdminError } = require('../validation')

// User-profile collections have independent cursors. Orders are scoped before
// LIMIT, so a page cannot lose rows when another account has fewer grants.
const definitions = {
  superCases: { sql: `SELECT x.id, x.project_name AS title, x.status, x.updated_at, x.started_on,
    COALESCE(CAST(x.started_on AS DATETIME), '1000-01-01 00:00:00') AS sort_time
    FROM mip_super_cases x WHERE x.app_id = ? AND x.owner_user_id = ?`, time: "COALESCE(CAST(x.started_on AS DATETIME), '1000-01-01 00:00:00')", map: row => ({ title: row.title, startedOn: row.started_on ? new Date(row.started_on).toISOString() : null }) },
  cooperationCards: { sql: `SELECT x.id, x.role_key, x.status, x.updated_at FROM mip_cooperation_cards x WHERE x.app_id = ? AND x.owner_user_id = ?`, map: row => ({ roleKey: row.role_key }) },
  opportunities: { sql: `SELECT x.id, x.title, x.scope_type, x.branch_id, x.status, x.updated_at FROM mip_opportunities x
    WHERE x.app_id = ? AND x.owner_user_id = ? AND NOT EXISTS (SELECT 1 FROM mip_opportunity_delete_snapshots deleted WHERE deleted.app_id = x.app_id AND deleted.opportunity_uid = x.id)`, map: row => ({ title: row.title, scopeType: row.scope_type, branchId: row.branch_id }) },
  registrations: { sql: `SELECT x.id, x.event_id, e.title, e.branch_id, x.status, x.created_at AS updated_at
    FROM mip_event_registrations x JOIN mip_events e ON e.app_id = x.app_id AND e.id = x.event_id
    WHERE x.app_id = ? AND x.user_id = ?`, time: 'x.created_at', map: row => ({ eventId: row.event_id, title: row.title, branchId: row.branch_id }) },
  orders: { sql: `SELECT x.id, x.order_type, x.resource_id, e.branch_id, x.status, x.created_at AS updated_at, COALESCE(e.title, p.name, '业务订单') AS title
    FROM mip_orders x LEFT JOIN mip_events e ON e.app_id = x.app_id AND x.order_type = 'EVENT' AND e.id = x.resource_id
    LEFT JOIN mip_membership_plans p ON p.app_id = x.app_id AND p.id = x.membership_plan_id
    WHERE x.app_id = ? AND x.user_id = ?`, time: 'x.created_at', map: row => ({ title: row.title, orderType: row.order_type, resourceId: row.resource_id, branchId: row.branch_id }) },
}

function createUserRelatedRecordsRepository(database) {
  async function getUserRelatedPage(appId, userId, section, pageLimit, cursorValue, orderVisibility) {
    const spec = definitions[section]
    if (!spec) throw new AdminError('VALIDATION_FAILED', '关联记录类型无效')
    const context = createHash('sha256').update(JSON.stringify([appId, userId, section, section === 'orders' ? orderVisibility : null])).digest('hex')
    const cursor = decodeCursor(cursorValue, ['updatedAt', 'id', 'context'])
    if (cursor && cursor.context !== context) throw new AdminError('VALIDATION_FAILED', '关联记录分页范围已变化，请返回最新记录')
    const scope = section === 'orders' ? orderScope(orderVisibility) : { sql: '1 = 1', params: [] }
    const after = cursorPredicateFor(spec.time || 'x.updated_at', cursor, 'updatedAt', 'x.id')
    const rows = await database.query(
      `${spec.sql} AND (${scope.sql}) ${after.sql}
       ORDER BY ${spec.time || 'x.updated_at'} DESC, x.id DESC LIMIT ?`,
      [appId, userId, ...scope.params, ...after.params, pageLimit + 1],
    )
    const page = pageRows(rows, pageLimit, row => ({ updatedAt: new Date(row.sort_time || row.updated_at).toISOString(), id: row.id, context }))
    return { [section]: page.items.map(row => ({ id: row.id, status: row.status, updatedAt: new Date(row.updated_at).toISOString(), ...spec.map(row) })), section, nextCursor: page.nextCursor }
  }
  return { getUserRelatedPage }
}

function orderScope(visibility) {
  if (visibility.platform) return { sql: '1 = 1', params: [] }
  const clauses = [], params = []
  for (const [ids, column] of [[visibility.branchIds, 'e.branch_id'], [visibility.eventIds, 'x.resource_id']]) {
    if (ids.length) { clauses.push(`${column} IN (${ids.map(() => '?').join(',')})`); params.push(...ids) }
  }
  return { sql: clauses.length ? `x.order_type = 'EVENT' AND (${clauses.join(' OR ')})` : '0 = 1', params }
}

module.exports = { createUserRelatedRecordsRepository }
