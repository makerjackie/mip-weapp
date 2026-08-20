/**
 * Exact table×privilege pairing for deploy-time grant readback.
 * Rejects loose JSON includes() false positives across tables.
 * Schema-level ALL PRIVILEGES is NEVER accepted as a pass.
 * Global ALL / fuzzy grantee LIKE matches are NEVER accepted.
 */

/**
 * Minimal runtime grants shared by membership-api / membership-admin-api /
 * membership-payment-ledger (one runtime account, documented union).
 *
 * Rules:
 * - DELETE is granted only to scoped, non-ledger relationship/credential/
 *   notification tables whose account-deletion workflows really remove rows.
 * - member_audit_logs is append-only: SELECT + INSERT only.
 * - member_plans is catalog-read for runtime; seed/admin DDL uses management account.
 * - member_admin_roles is role lookup only at runtime (bootstrap uses management account).
 */
export const RUNTIME_TABLE_PRIVILEGES = Object.freeze({
  member_media_assets: Object.freeze(['SELECT', 'INSERT', 'UPDATE']),
  member_profiles: Object.freeze(['SELECT', 'INSERT', 'UPDATE']),
  member_private_profiles: Object.freeze(['SELECT', 'INSERT', 'UPDATE']),
  member_plans: Object.freeze(['SELECT']),
  member_orders: Object.freeze(['SELECT', 'INSERT', 'UPDATE']),
  member_entitlements: Object.freeze(['SELECT', 'INSERT', 'UPDATE']),
  member_events: Object.freeze(['SELECT', 'INSERT', 'UPDATE']),
  member_event_changes: Object.freeze(['SELECT', 'INSERT']),
  member_registrations: Object.freeze(['SELECT', 'INSERT', 'UPDATE']),
  member_admin_roles: Object.freeze(['SELECT']),
  member_refunds: Object.freeze(['SELECT', 'INSERT', 'UPDATE']),
  member_audit_logs: Object.freeze(['SELECT', 'INSERT']),
  member_export_tickets: Object.freeze(['SELECT', 'INSERT', 'UPDATE']),
  member_mutation_idempotency: Object.freeze(['SELECT', 'INSERT']),
  member_media_cleanup_outbox: Object.freeze(['SELECT', 'INSERT', 'UPDATE']),
  member_follows: Object.freeze(['SELECT', 'INSERT', 'DELETE']),
  member_event_managers: Object.freeze(['SELECT', 'INSERT', 'UPDATE']),
  member_event_reservations: Object.freeze(['SELECT', 'INSERT', 'UPDATE']),
  member_event_photos: Object.freeze(['SELECT', 'INSERT', 'UPDATE']),
  member_checkin_credentials: Object.freeze(['SELECT', 'INSERT', 'UPDATE', 'DELETE']),
  member_notifications: Object.freeze(['SELECT', 'INSERT', 'UPDATE', 'DELETE']),
  member_notification_subscriptions: Object.freeze(['SELECT', 'INSERT', 'UPDATE', 'DELETE']),
  member_notification_outbox: Object.freeze(['SELECT', 'INSERT', 'UPDATE', 'DELETE']),
  member_operational_failures: Object.freeze(['SELECT', 'INSERT', 'UPDATE', 'DELETE']),
  member_announcements: Object.freeze(['SELECT', 'INSERT', 'UPDATE']),
  member_blocks: Object.freeze(['SELECT', 'INSERT', 'DELETE']),
  member_reports: Object.freeze(['SELECT', 'INSERT', 'UPDATE']),
})

const RUNTIME_DELETE_TABLES = new Set([
  'member_follows',
  'member_checkin_credentials',
  'member_notifications',
  'member_notification_subscriptions',
  'member_notification_outbox',
  'member_operational_failures',
  'member_blocks',
])

/** @deprecated use RUNTIME_TABLE_PRIVILEGES; kept for call sites that still pass flat lists */
const DEFAULT_PRIVILEGES = ['SELECT', 'INSERT', 'UPDATE']

const HARMLESS_PRIVILEGES = new Set(['USAGE', 'GRANT OPTION'])

/**
 * Build the exact MySQL grantee form stored in information_schema: `'user'@'host'`.
 * Never use LIKE fuzzy matching against this value.
 *
 * @param {string} user
 * @param {string} [host] MySQL host part; defaults to `%` when omitted
 * @returns {string} Exact grantee literal such as `'member_runtime'@'%'`
 */
export function parseGrantee(user, host) {
  if (host === undefined || host === null || host === '') {
    host = '%'
  }
  if (!user || typeof user !== 'string' || !/^[\w.-]+$/.test(user)) {
    throw new Error('Invalid MySQL user for exact grantee')
  }
  if (!host || typeof host !== 'string' || !/^[%\w.-]+$/.test(host)) {
    throw new Error('Invalid MySQL host for exact grantee')
  }
  return `'${user}'@'${host}'`
}

/**
 * Exact string equality for MySQL grantees (`'user'@'host'`).
 * Rejects similar names and wrong hosts.
 *
 * @param {string|null|undefined} actual
 * @param {string|null|undefined} expected
 * @returns {boolean} True only when both sides match after trim
 */
export function granteesMatchExact(actual, expected) {
  if (actual == null || expected == null) {
    return false
  }
  return String(actual).trim() === String(expected).trim()
}

function isAllPrivilege(privilegeType) {
  const actual = String(privilegeType || '').toUpperCase()
  return actual === 'ALL' || actual === 'ALL PRIVILEGES' || actual.includes('ALL PRIVILEGES')
}

/**
 * Normalize a privilege probe payload into row objects.
 * Captures tableName, privilegeType, grantee, host, and level when present.
 * Accepts arrays of row objects or nested CloudBase MCP envelopes.
 *
 * @param {unknown} value Probe payload or nested envelope
 * @param {Array<object>} [out] Optional accumulator
 * @returns {Array<{
 *   tableName: string|null,
 *   privilegeType: string,
 *   grantee?: string,
 *   host?: string,
 *   level?: string,
 *   tableSchema?: string,
 * }>} Normalized privilege rows
 */
export function parsePrivilegeRows(value, out = []) {
  if (!value || typeof value !== 'object') {
    return out
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      parsePrivilegeRows(item, out)
    }
    return out
  }

  const keys = Object.keys(value)
  const lower = new Map(keys.map(key => [key.toLowerCase(), key]))
  const tableKey = lower.get('tablename') || lower.get('table_name')
  const privKey = lower.get('privilegetype') || lower.get('privilege_type')
  const granteeKey = lower.get('grantee')
  const hostKey = lower.get('host') || lower.get('grantee_host')
  const levelKey = lower.get('level') || lower.get('privilege_level')
  const schemaKey = lower.get('tableschema') || lower.get('table_schema') || lower.get('schema_name')

  if (privKey) {
    /** @type {{ tableName: string|null, privilegeType: string, grantee?: string, host?: string, level?: string, tableSchema?: string }} */
    const row = {
      tableName: tableKey ? String(value[tableKey]) : null,
      privilegeType: String(value[privKey]),
    }
    if (granteeKey) {
      row.grantee = String(value[granteeKey])
    }
    if (hostKey) {
      row.host = String(value[hostKey])
    }
    if (levelKey) {
      row.level = String(value[levelKey])
    }
    else if (!tableKey && schemaKey) {
      row.level = 'schema'
    }
    else if (!tableKey && !schemaKey && granteeKey) {
      row.level = 'global'
    }
    else if (tableKey) {
      row.level = 'table'
    }
    if (schemaKey) {
      row.tableSchema = String(value[schemaKey])
    }
    // Only record rows that look like privilege rows (avoid double-pushing parent envelopes).
    out.push(row)
  }

  for (const child of Object.values(value)) {
    if (child && typeof child === 'object') {
      parsePrivilegeRows(child, out)
    }
  }
  return out
}

function privilegeExact(actualType, required) {
  const actual = String(actualType || '').toUpperCase()
  const need = String(required || '').toUpperCase()
  if (!actual || !need) {
    return false
  }
  // Exact match only. ALL / ALL PRIVILEGES intentionally rejected.
  return actual === need
}

function isSchemaAll(row) {
  if (!row || (row.tableName !== null && row.tableName !== undefined)) {
    return false
  }
  return isAllPrivilege(row.privilegeType)
}

function filterRowsByExactGrantee(rows, grantee) {
  if (!grantee) {
    return Array.isArray(rows) ? rows : []
  }
  return (Array.isArray(rows) ? rows : []).filter((row) => {
    // Rows without grantee are assumed pre-filtered by the caller SQL.
    if (row == null || row.grantee == null || row.grantee === '') {
      return true
    }
    return granteesMatchExact(row.grantee, grantee)
  })
}

/**
 * Assert every required table×privilege pair is present at table level.
 * Schema ALL is never accepted. When `rejectExtra` is true, ANY privilege
 * beyond the map for ANY mapped table fails (not only audit logs).
 *
 * @param {Array<{tableName: string|null, privilegeType: string, grantee?: string}>} rows
 * @param {Record<string, string[]> | string[]} tablePrivileges
 * @param {string[]} [flatPrivileges] when tablePrivileges is a string[] of tables
 * @param {{ rejectSchemaAll?: boolean, rejectExtra?: boolean, grantee?: string }} [options]
 */
export function assertTablePrivilegePairs(
  rows,
  tablePrivileges,
  flatPrivileges,
  options = {},
) {
  const rejectSchemaAll = options.rejectSchemaAll !== false
  const rejectExtra = options.rejectExtra === true
  const list = filterRowsByExactGrantee(
    Array.isArray(rows) ? rows : [],
    options.grantee,
  )

  if (rejectSchemaAll && list.some(isSchemaAll)) {
    throw new Error('Runtime account must not rely on schema-level ALL PRIVILEGES')
  }

  /** @type {Record<string, string[]>} */
  let requiredMap
  if (Array.isArray(tablePrivileges)) {
    const privileges = Array.isArray(flatPrivileges) && flatPrivileges.length
      ? flatPrivileges
      : DEFAULT_PRIVILEGES
    requiredMap = Object.fromEntries(
      tablePrivileges.map(table => [table, privileges]),
    )
  }
  else {
    requiredMap = tablePrivileges || RUNTIME_TABLE_PRIVILEGES
  }

  const tableRows = list.filter(row => row && row.tableName)
  const missing = []
  let checked = 0

  for (const [table, privileges] of Object.entries(requiredMap)) {
    for (const privilege of privileges) {
      checked += 1
      const tableHit = tableRows.some(
        row => String(row.tableName).toLowerCase() === String(table).toLowerCase()
          && privilegeExact(row.privilegeType, privilege),
      )
      if (!tableHit) {
        missing.push(`${table}.${privilege}`)
      }
    }

    if (rejectExtra) {
      const allowed = new Set(privileges.map(p => String(p).toUpperCase()))
      const extras = tableRows.filter(
        row => String(row.tableName).toLowerCase() === String(table).toLowerCase()
          && !allowed.has(String(row.privilegeType || '').toUpperCase())
          && !HARMLESS_PRIVILEGES.has(String(row.privilegeType || '').toUpperCase()),
      )
      // Fail closed on ANY extra privilege for ANY mapped table.
      if (extras.length > 0) {
        throw new Error(
          `Runtime account has forbidden ${extras[0].privilegeType} on ${table}`,
        )
      }
    }
  }

  if (missing.length) {
    const first = missing[0]
    const [table, privilege] = first.split('.')
    const more = missing.length > 1
      ? ` (and ${missing.length - 1} more: ${missing.slice(1).join(', ')})`
      : ''
    throw new Error(`Runtime account missing grant on ${table} for privilege ${privilege}${more}`)
  }

  return { ok: true, checked }
}

/**
 * Joint assertion over table / schema / global privilege probes for one exact grantee.
 * Fails closed on global ALL, schema ALL, missing required pairs, and any extra table privilege.
 *
 * @param {{
 *   tableRows?: Array<object>,
 *   schemaRows?: Array<object>,
 *   userRows?: Array<object>,
 *   requiredMap?: Record<string, string[]>,
 *   grantee: string,
 * }} input
 */
export function assertRuntimePrivilegesExact({
  tableRows = [],
  schemaRows = [],
  userRows = [],
  requiredMap = RUNTIME_TABLE_PRIVILEGES,
  grantee,
}) {
  if (!grantee || typeof grantee !== 'string') {
    throw new Error('Exact grantee is required for runtime privilege assertion')
  }

  const filteredUser = filterRowsByExactGrantee(userRows, grantee)
  const filteredSchema = filterRowsByExactGrantee(schemaRows, grantee)
  const filteredTable = filterRowsByExactGrantee(tableRows, grantee)

  for (const row of filteredUser) {
    if (isAllPrivilege(row.privilegeType)) {
      throw new Error('Runtime account must not have global ALL PRIVILEGES')
    }
    const privilege = String(row.privilegeType || '').toUpperCase()
    if (privilege && !HARMLESS_PRIVILEGES.has(privilege)) {
      throw new Error(`Runtime account has forbidden global privilege ${row.privilegeType}`)
    }
  }

  for (const row of filteredSchema) {
    if (isAllPrivilege(row.privilegeType)) {
      throw new Error('Runtime account must not rely on schema-level ALL PRIVILEGES')
    }
    const privilege = String(row.privilegeType || '').toUpperCase()
    if (privilege && !HARMLESS_PRIVILEGES.has(privilege)) {
      throw new Error(
        `Runtime account has forbidden schema-level privilege ${row.privilegeType}`,
      )
    }
  }

  return assertTablePrivilegePairs(filteredTable, requiredMap, undefined, {
    rejectSchemaAll: true,
    rejectExtra: true,
    grantee,
  })
}

/**
 * Expand RUNTIME_TABLE_PRIVILEGES into GRANT statements for a schema/account.
 * Never emits DELETE or schema ALL.
 */
export function buildRuntimeGrantStatements(schema, account) {
  if (!schema || !/^[\w-]+$/.test(schema)) {
    throw new Error('Invalid schema for runtime grants')
  }
  if (!account || !/^[`'@\w.%-]+$/.test(account)) {
    throw new Error('Invalid account for runtime grants')
  }
  const statements = []
  for (const [table, privileges] of Object.entries(RUNTIME_TABLE_PRIVILEGES)) {
    if (privileges.includes('DELETE') && !RUNTIME_DELETE_TABLES.has(table)) {
      throw new Error(`DELETE is not allowed in runtime grant map for durable table ${table}`)
    }
    statements.push(
      `GRANT ${privileges.join(', ')} ON \`${schema}\`.\`${table}\` TO ${account}`,
    )
  }
  return statements
}

export { DEFAULT_PRIVILEGES }
