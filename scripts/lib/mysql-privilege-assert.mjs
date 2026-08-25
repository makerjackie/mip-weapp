import { createHash } from 'node:crypto'

/**
 * Exact table×privilege pairing for deploy-time grant readback.
 * Rejects loose JSON includes() false positives across tables.
 * Schema-level ALL PRIVILEGES is NEVER accepted as a pass.
 * Global ALL / fuzzy grantee LIKE matches are NEVER accepted.
 */

export const RUNTIME_TABLE_PRIVILEGES = Object.freeze({
  mip_users: Object.freeze(['SELECT', 'INSERT', 'UPDATE']),
  mip_user_identities: Object.freeze(['SELECT', 'INSERT', 'UPDATE']),
  mip_media_assets: Object.freeze(['SELECT', 'INSERT', 'UPDATE']),
  mip_city_branches: Object.freeze(['SELECT', 'INSERT', 'UPDATE']),
  mip_branch_memberships: Object.freeze(['SELECT', 'INSERT', 'UPDATE']),
  mip_profiles: Object.freeze(['SELECT', 'INSERT', 'UPDATE']),
  mip_private_profiles: Object.freeze(['SELECT', 'INSERT', 'UPDATE']),
  mip_agreement_acceptances: Object.freeze(['SELECT', 'INSERT']),
  mip_tags: Object.freeze(['SELECT']),
  mip_profile_tags: Object.freeze(['SELECT', 'INSERT', 'DELETE']),
  mip_admin_role_bindings: Object.freeze(['SELECT', 'INSERT', 'UPDATE']),
  mip_app_settings: Object.freeze(['SELECT', 'INSERT', 'UPDATE']),
  mip_idempotency_keys: Object.freeze(['SELECT', 'INSERT', 'UPDATE']),
  mip_outbox_events: Object.freeze(['SELECT', 'INSERT', 'UPDATE']),
  mip_audit_logs: Object.freeze(['SELECT', 'INSERT']),
  mip_events: Object.freeze(['SELECT', 'INSERT', 'UPDATE']),
  mip_event_content_media: Object.freeze(['SELECT', 'INSERT', 'UPDATE']),
  mip_event_changes: Object.freeze(['SELECT', 'INSERT']),
  mip_event_seat_holds: Object.freeze(['SELECT', 'INSERT', 'UPDATE']),
  mip_event_registrations: Object.freeze(['SELECT', 'INSERT', 'UPDATE']),
  mip_event_invitation_attributions: Object.freeze(['SELECT', 'INSERT']),
  mip_event_invitation_links: Object.freeze(['SELECT', 'INSERT', 'UPDATE']),
  mip_event_checkin_credentials: Object.freeze(['SELECT', 'INSERT', 'UPDATE']),
  mip_event_checkins: Object.freeze(['SELECT', 'INSERT', 'UPDATE']),
  mip_event_checkin_transitions: Object.freeze(['SELECT', 'INSERT']),
  mip_event_hearts: Object.freeze(['SELECT', 'INSERT', 'UPDATE']),
  mip_event_feedback: Object.freeze(['SELECT', 'INSERT', 'UPDATE']),
  mip_event_album_photos: Object.freeze(['SELECT', 'INSERT', 'UPDATE']),
  mip_opportunities: Object.freeze(['SELECT', 'INSERT', 'UPDATE']),
  mip_opportunity_roles: Object.freeze(['SELECT', 'INSERT', 'DELETE']),
  mip_opportunity_tags: Object.freeze(['SELECT', 'INSERT', 'DELETE']),
  mip_opportunity_team_members: Object.freeze(['SELECT', 'INSERT', 'UPDATE']),
  mip_referral_intents: Object.freeze(['SELECT', 'INSERT', 'UPDATE']),
  mip_profile_interests: Object.freeze(['SELECT', 'INSERT', 'UPDATE']),
  mip_profile_visits: Object.freeze(['SELECT', 'INSERT', 'UPDATE']),
  mip_user_blocks: Object.freeze(['SELECT', 'INSERT', 'UPDATE']),
  mip_reports: Object.freeze(['SELECT', 'INSERT', 'UPDATE']),
  mip_cooperation_cards: Object.freeze(['SELECT', 'INSERT', 'UPDATE']),
  mip_super_cases: Object.freeze(['SELECT', 'INSERT', 'UPDATE']),
  mip_super_case_media: Object.freeze(['SELECT', 'INSERT', 'DELETE']),
  mip_membership_plans: Object.freeze(['SELECT']),
  mip_orders: Object.freeze(['SELECT', 'INSERT', 'UPDATE']),
  mip_payment_attempts: Object.freeze(['SELECT', 'INSERT', 'UPDATE']),
  mip_refunds: Object.freeze(['SELECT', 'INSERT', 'UPDATE']),
  mip_membership_entitlements: Object.freeze(['SELECT', 'INSERT', 'UPDATE']),
  mip_membership_attributions: Object.freeze(['INSERT']),
  mip_payment_callbacks: Object.freeze(['SELECT', 'INSERT', 'UPDATE']),
  mip_growth_levels: Object.freeze(['SELECT', 'INSERT', 'UPDATE']),
  mip_growth_benefits: Object.freeze(['SELECT', 'INSERT', 'UPDATE']),
  mip_growth_level_benefits: Object.freeze(['SELECT', 'INSERT', 'DELETE']),
  mip_growth_rules: Object.freeze(['SELECT', 'UPDATE']),
  mip_growth_accounts: Object.freeze(['SELECT', 'INSERT', 'UPDATE']),
  mip_growth_entries: Object.freeze(['SELECT', 'INSERT']),
  mip_badges: Object.freeze(['SELECT', 'INSERT', 'UPDATE']),
  mip_user_badges: Object.freeze(['SELECT', 'INSERT', 'UPDATE']),
  mip_user_badge_profiles: Object.freeze(['SELECT', 'INSERT', 'UPDATE']),
  mip_user_badge_equipment: Object.freeze(['SELECT', 'INSERT', 'DELETE']),
  mip_game_seasons: Object.freeze(['SELECT', 'INSERT', 'UPDATE']),
  mip_game_teams: Object.freeze(['SELECT', 'INSERT', 'UPDATE']),
  mip_game_team_memberships: Object.freeze(['SELECT', 'INSERT', 'UPDATE']),
  mip_game_weekly_matches: Object.freeze(['SELECT', 'INSERT', 'UPDATE']),
  mip_game_ranking_snapshots: Object.freeze(['SELECT', 'INSERT', 'UPDATE']),
  mip_game_ranking_entries: Object.freeze(['SELECT', 'INSERT']),
  mip_blind_box_catalogs: Object.freeze(['SELECT', 'INSERT', 'UPDATE']),
  mip_blind_box_cards: Object.freeze(['SELECT', 'INSERT', 'UPDATE']),
  mip_blind_box_user_states: Object.freeze(['SELECT', 'INSERT', 'UPDATE']),
  mip_blind_box_draws: Object.freeze(['SELECT', 'INSERT']),
  mip_blind_box_inventory: Object.freeze(['SELECT', 'INSERT', 'UPDATE']),
  mip_task_cards: Object.freeze(['SELECT', 'INSERT', 'UPDATE']),
  mip_task_level_rules: Object.freeze(['SELECT', 'INSERT', 'DELETE']),
  mip_task_assignments: Object.freeze(['SELECT', 'INSERT', 'UPDATE']),
  mip_task_completions: Object.freeze(['SELECT', 'INSERT']),
  mip_banners: Object.freeze(['SELECT', 'INSERT', 'UPDATE']),
  mip_inbox_messages: Object.freeze(['SELECT', 'INSERT', 'UPDATE']),
  mip_notification_grants: Object.freeze(['SELECT', 'INSERT', 'UPDATE']),
  mip_delivery_tasks: Object.freeze(['SELECT', 'INSERT', 'UPDATE']),
  mip_operations_messages: Object.freeze(['SELECT', 'INSERT']),
  mip_announcements: Object.freeze(['SELECT', 'INSERT', 'UPDATE']),
  mip_ai_drafts: Object.freeze(['SELECT', 'INSERT', 'UPDATE']),
  mip_digital_avatar_generations: Object.freeze(['SELECT', 'INSERT', 'UPDATE']),
  mip_message_campaigns: Object.freeze(['SELECT', 'INSERT', 'UPDATE']),
  mip_message_campaign_recipients: Object.freeze(['SELECT', 'INSERT']),
  mip_message_templates: Object.freeze(['SELECT', 'INSERT', 'UPDATE']),
  mip_message_template_revisions: Object.freeze(['SELECT', 'INSERT']),
  mip_role_capability_policies: Object.freeze(['SELECT', 'INSERT', 'UPDATE']),
  mip_opportunity_comment_settings: Object.freeze(['SELECT', 'INSERT', 'UPDATE']),
  mip_opportunity_comments: Object.freeze(['SELECT', 'INSERT', 'UPDATE']),
  mip_opportunity_comment_calls: Object.freeze(['SELECT', 'INSERT', 'UPDATE']),
  mip_opportunity_comment_reports: Object.freeze(['SELECT', 'INSERT', 'UPDATE']),
  mip_knowledge_sources: Object.freeze(['SELECT', 'INSERT', 'UPDATE']),
  mip_knowledge_categories: Object.freeze(['SELECT', 'INSERT', 'UPDATE']),
  mip_knowledge_contents: Object.freeze(['SELECT', 'INSERT', 'UPDATE']),
  mip_knowledge_products: Object.freeze(['SELECT', 'INSERT', 'UPDATE']),
  mip_knowledge_entitlements: Object.freeze(['SELECT', 'INSERT', 'UPDATE']),
  mip_content_comment_settings: Object.freeze(['SELECT', 'INSERT', 'UPDATE']),
  mip_content_comments: Object.freeze(['SELECT', 'INSERT', 'UPDATE']),
  mip_content_comment_reports: Object.freeze(['SELECT', 'INSERT', 'UPDATE']),
  mip_knowledge_ingestion_runs: Object.freeze(['SELECT', 'INSERT', 'UPDATE']),
  mip_knowledge_ingestion_items: Object.freeze(['SELECT', 'INSERT', 'UPDATE']),
  mip_user_notification_preferences: Object.freeze(['SELECT', 'INSERT', 'UPDATE']),
  mip_user_opportunity_preferences: Object.freeze(['SELECT', 'INSERT', 'UPDATE']),
  mip_matching_settings: Object.freeze(['SELECT', 'INSERT', 'UPDATE']),
  mip_matching_requests: Object.freeze(['SELECT', 'INSERT']),
  mip_matching_results: Object.freeze(['SELECT', 'INSERT']),
  mip_matching_feedback: Object.freeze(['SELECT', 'INSERT']),
  mip_user_access_controls: Object.freeze(['SELECT', 'INSERT', 'UPDATE']),
  mip_admin_export_tickets: Object.freeze(['SELECT', 'INSERT', 'UPDATE']),
})

const RUNTIME_DELETE_TABLES = new Set([
  'mip_profile_tags',
  'mip_opportunity_roles',
  'mip_opportunity_tags',
  'mip_growth_level_benefits',
  'mip_user_badge_equipment',
  'mip_super_case_media',
  'mip_task_level_rules',
])

/** @deprecated use RUNTIME_TABLE_PRIVILEGES; kept for call sites that still pass flat lists */
const DEFAULT_PRIVILEGES = ['SELECT', 'INSERT', 'UPDATE']

const HARMLESS_PRIVILEGES = new Set(['USAGE'])

export function runtimeUserForEnvironment(envId) {
  const normalized = String(envId || '').trim()
  if (!/^[\w-]{3,128}$/.test(normalized)) {
    throw new Error('Invalid environment for runtime MySQL user')
  }
  const fingerprint = createHash('sha256').update(normalized).digest('hex').slice(0, 12)
  return `mip_${fingerprint}`
}

export function assertRuntimeAccountClaimable({
  tableRows = [],
  schemaRows = [],
  userRows = [],
  schema,
  grantee,
  allowExisting,
}) {
  const ownedTables = new Set(Object.keys(RUNTIME_TABLE_PRIVILEGES))
  const exactTableRows = filterRowsByExactGrantee(tableRows, grantee)
  const exactSchemaRows = filterRowsByExactGrantee(schemaRows, grantee)
  const exactUserRows = filterRowsByExactGrantee(userRows, grantee)
  const exists = [...exactTableRows, ...exactSchemaRows, ...exactUserRows].length > 0
  if (exists && !allowExisting) {
    throw new Error('Runtime MySQL account already exists without MIP function ownership evidence')
  }
  if (!exists && allowExisting) {
    throw new Error('Runtime MySQL account ownership could not be verified')
  }
  const globalPrivilege = exactUserRows.find(
    row => !HARMLESS_PRIVILEGES.has(String(row.privilegeType || '').toUpperCase()),
  )
  if (globalPrivilege) {
    throw new Error(`Runtime MySQL account has forbidden global privilege ${globalPrivilege.privilegeType}`)
  }
  const schemaPrivilege = exactSchemaRows.find(
    row => !HARMLESS_PRIVILEGES.has(String(row.privilegeType || '').toUpperCase()),
  )
  if (schemaPrivilege) {
    throw new Error(`Runtime MySQL account has schema-level privilege on ${schemaPrivilege.tableSchema || 'unknown schema'}`)
  }
  const external = exactTableRows.find(row => row.tableSchema !== schema || !ownedTables.has(row.tableName))
  if (external) {
    throw new Error(`Runtime MySQL account has a grant outside the owned MIP table set: ${external.tableSchema || 'unknown'}.${external.tableName || 'unknown'}`)
  }
  return { exists, tableRows: exactTableRows }
}

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
  if (rejectExtra) {
    const allowedTables = new Set(Object.keys(requiredMap).map(table => table.toLowerCase()))
    const unexpected = tableRows.find(
      row => !allowedTables.has(String(row.tableName).toLowerCase())
        && !HARMLESS_PRIVILEGES.has(String(row.privilegeType || '').toUpperCase()),
    )
    if (unexpected) {
      throw new Error(
        `Runtime account has forbidden ${unexpected.privilegeType} on unmapped table ${unexpected.tableName}`,
      )
    }
  }
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
 * Emits DELETE only for the explicit replaceable-relation allowlist and never emits schema ALL.
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

export function buildRuntimeRevokeStatements(schema, account, rows) {
  if (!schema || !/^[\w-]+$/.test(schema)) {
    throw new Error('Invalid schema for runtime revokes')
  }
  if (!account || !/^[`'@\w.%-]+$/.test(account)) {
    throw new Error('Invalid account for runtime revokes')
  }
  const byTable = new Map()
  for (const row of rows || []) {
    const table = String(row?.tableName || '')
    const privilege = String(row?.privilegeType || '').toUpperCase()
    if (!Object.hasOwn(RUNTIME_TABLE_PRIVILEGES, table)
      || row?.tableSchema !== schema
      || !/^[A-Z ]+$/.test(privilege)
      || privilege === 'USAGE') {
      continue
    }
    const privileges = byTable.get(table) || new Set()
    privileges.add(privilege)
    byTable.set(table, privileges)
  }
  return [...byTable.entries()].map(([table, privileges]) => (
    `REVOKE ${[...privileges].sort().join(', ')} ON \`${schema}\`.\`${table}\` FROM ${account}`
  ))
}

export { DEFAULT_PRIVILEGES }
