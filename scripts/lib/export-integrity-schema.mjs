/**
 * Case-local contract for 003_export_integrity objects.
 * MySQL DDL auto-commits, so a partial 003 must be recoverable via information_schema
 * without rewriting locked 001/002/003 SQL content.
 */

export const EXPORT_INTEGRITY_VERSION = '20260723230000'
export const EXPORT_INTEGRITY_NAME = 'export_integrity'

export function normalizeCheckClause(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/_(?:utf8mb4|utf8|ascii)\\?'/g, '\'')
    .replace(/\\'/g, '\'')
    .replace(/`/g, '')
    // MySQL 8 serializes the REGEXP operator in information_schema as
    // regexp_like(left, pattern). Normalize it back to the migration form.
    .replace(/regexp_like\(([^,]+),([^)]+)\)/g, '$1 regexp $2')
    .replace(/\s+/g, ' ')
    .replace(/\( /g, '(')
    .replace(/ \)/g, ')')
    .trim()
}

export function normalizeDefault(value) {
  if (value === null || value === undefined) {
    return null
  }
  let text = String(value).trim()
  if (/^null$/i.test(text)) {
    return null
  }
  if (
    (text.startsWith('\'') && text.endsWith('\''))
    || (text.startsWith('"') && text.endsWith('"'))
  ) {
    text = text.slice(1, -1)
  }
  return text
}

/** Parent-table (app_id, id) uniqueness required before composite FKs. */
export const EXPORT_INTEGRITY_UNIQUE_KEYS = [
  {
    table: 'member_media_assets',
    name: 'member_media_assets_app_id_uk',
    unique: true,
    columns: ['app_id', 'id'],
  },
  {
    table: 'member_events',
    name: 'member_events_app_id_uk',
    unique: true,
    columns: ['app_id', 'id'],
  },
  {
    table: 'member_orders',
    name: 'member_orders_app_id_uk',
    unique: true,
    columns: ['app_id', 'id'],
  },
  {
    table: 'member_registrations',
    name: 'member_registrations_app_id_uk',
    unique: true,
    columns: ['app_id', 'id'],
  },
]

/**
 * Composite app-scoped FKs that replace single-column 001 FKs.
 * oldName is the 001 constraint dropped during first apply / recovery.
 */
export const EXPORT_INTEGRITY_FOREIGN_KEYS = [
  {
    table: 'member_profiles',
    name: 'member_profiles_avatar_app_fk',
    oldName: 'member_profiles_avatar_fk',
    columns: ['app_id', 'avatar_asset_id'],
    referencedTable: 'member_media_assets',
    referencedColumns: ['app_id', 'id'],
    deleteRule: 'RESTRICT',
  },
  {
    table: 'member_events',
    name: 'member_events_cover_app_fk',
    oldName: 'member_events_cover_fk',
    columns: ['app_id', 'cover_asset_id'],
    referencedTable: 'member_media_assets',
    referencedColumns: ['app_id', 'id'],
    deleteRule: 'RESTRICT',
  },
  {
    table: 'member_registrations',
    name: 'member_registrations_event_app_fk',
    oldName: 'member_registrations_event_fk',
    columns: ['app_id', 'event_id'],
    referencedTable: 'member_events',
    referencedColumns: ['app_id', 'id'],
    deleteRule: 'RESTRICT',
  },
  {
    table: 'member_registrations',
    name: 'member_registrations_order_app_fk',
    oldName: 'member_registrations_order_fk',
    columns: ['app_id', 'source_order_id'],
    referencedTable: 'member_orders',
    referencedColumns: ['app_id', 'id'],
    deleteRule: 'RESTRICT',
  },
  {
    table: 'member_entitlements',
    name: 'member_entitlements_source_order_app_fk',
    oldName: 'member_entitlements_source_order_fk',
    columns: ['app_id', 'source_order_id'],
    referencedTable: 'member_orders',
    referencedColumns: ['app_id', 'id'],
    deleteRule: 'RESTRICT',
  },
  {
    table: 'member_refunds',
    name: 'member_refunds_order_app_fk',
    oldName: 'member_refunds_order_fk',
    columns: ['app_id', 'order_id'],
    referencedTable: 'member_orders',
    referencedColumns: ['app_id', 'id'],
    deleteRule: 'RESTRICT',
  },
  {
    table: 'member_export_tickets',
    name: 'member_export_tickets_event_app_fk',
    oldName: null,
    columns: ['app_id', 'event_id'],
    referencedTable: 'member_events',
    referencedColumns: ['app_id', 'id'],
    deleteRule: 'RESTRICT',
  },
]

/** Key columns for 003 tables (full contract used by inspect). */
export const EXPORT_INTEGRITY_TABLE_COLUMNS = {
  member_export_tickets: [
    { name: 'id', dataType: 'char', characterMaximumLength: 36, isNullable: 'NO' },
    { name: 'app_id', dataType: 'varchar', characterMaximumLength: 64, isNullable: 'NO' },
    { name: 'event_id', dataType: 'char', characterMaximumLength: 36, isNullable: 'NO' },
    { name: 'operator_id', dataType: 'varchar', characterMaximumLength: 128, isNullable: 'NO' },
    { name: 'token_hash', dataType: 'char', characterMaximumLength: 64, isNullable: 'NO' },
    { name: 'file_id', dataType: 'varchar', characterMaximumLength: 512, isNullable: 'NO' },
    { name: 'object_key', dataType: 'varchar', characterMaximumLength: 512, isNullable: 'NO' },
    { name: 'file_name', dataType: 'varchar', characterMaximumLength: 255, isNullable: 'NO' },
    { name: 'content_type', dataType: 'varchar', characterMaximumLength: 128, isNullable: 'NO' },
    { name: 'content_bytes', dataType: 'int', isNullable: 'NO', unsigned: true },
    { name: 'content_sha256', dataType: 'char', characterMaximumLength: 64, isNullable: 'NO' },
    { name: 'row_count', dataType: 'int', isNullable: 'NO', unsigned: true },
    { name: 'expires_at', dataType: 'datetime', isNullable: 'NO', datetimePrecision: 3 },
    { name: 'reserved_until', dataType: 'datetime', isNullable: 'YES', datetimePrecision: 3 },
    { name: 'consumed_at', dataType: 'datetime', isNullable: 'YES', datetimePrecision: 3 },
    { name: 'status', dataType: 'varchar', characterMaximumLength: 16, isNullable: 'NO', columnDefault: 'ACTIVE' },
    { name: 'version', dataType: 'int', isNullable: 'NO', columnDefault: '1', unsigned: true },
    {
      name: 'created_at',
      dataType: 'datetime',
      isNullable: 'NO',
      datetimePrecision: 3,
      columnDefault: 'CURRENT_TIMESTAMP(3)',
      extraIncludes: ['DEFAULT_GENERATED'],
    },
    {
      name: 'updated_at',
      dataType: 'datetime',
      isNullable: 'NO',
      datetimePrecision: 3,
      columnDefault: 'CURRENT_TIMESTAMP(3)',
      // Require the (3) precision form so bare ON UPDATE CURRENT_TIMESTAMP fails closed.
      extraIncludes: ['DEFAULT_GENERATED', 'on update CURRENT_TIMESTAMP(3)'],
    },
  ],
  member_mutation_idempotency: [
    { name: 'app_id', dataType: 'varchar', characterMaximumLength: 64, isNullable: 'NO' },
    { name: 'scope', dataType: 'varchar', characterMaximumLength: 32, isNullable: 'NO' },
    { name: 'idempotency_key', dataType: 'varchar', characterMaximumLength: 128, isNullable: 'NO' },
    { name: 'payload_hash', dataType: 'char', characterMaximumLength: 64, isNullable: 'NO' },
    { name: 'resource_type', dataType: 'varchar', characterMaximumLength: 64, isNullable: 'NO' },
    { name: 'resource_id', dataType: 'varchar', characterMaximumLength: 128, isNullable: 'NO' },
    { name: 'response_json', dataType: 'json', isNullable: 'NO' },
    {
      name: 'created_at',
      dataType: 'datetime',
      isNullable: 'NO',
      datetimePrecision: 3,
      columnDefault: 'CURRENT_TIMESTAMP(3)',
      extraIncludes: ['DEFAULT_GENERATED'],
    },
  ],
}

/** Table-level contract: engine, charset/collation, primary key columns. */
export const EXPORT_INTEGRITY_TABLE_META = {
  member_export_tickets: {
    engine: 'InnoDB',
    tableCollation: 'utf8mb4_0900_ai_ci',
    primaryKey: ['id'],
  },
  member_mutation_idempotency: {
    engine: 'InnoDB',
    tableCollation: 'utf8mb4_0900_ai_ci',
    primaryKey: ['app_id', 'scope', 'idempotency_key'],
  },
}

export const EXPORT_INTEGRITY_TABLES = Object.keys(EXPORT_INTEGRITY_TABLE_COLUMNS)

export const EXPORT_INTEGRITY_INDEXES = [
  {
    table: 'member_export_tickets',
    name: 'member_export_tickets_token_uk',
    unique: true,
    columns: ['app_id', 'token_hash'],
    collations: ['A', 'A'],
  },
  {
    table: 'member_export_tickets',
    name: 'member_export_tickets_event_idx',
    unique: false,
    columns: ['app_id', 'event_id', 'created_at'],
    // created_at DESC → information_schema.statistics.collation = 'D'
    collations: ['A', 'A', 'D'],
  },
  {
    table: 'member_export_tickets',
    name: 'member_export_tickets_status_idx',
    unique: false,
    columns: ['app_id', 'status', 'expires_at'],
    collations: ['A', 'A', 'A'],
  },
  {
    table: 'member_mutation_idempotency',
    name: 'member_mutation_idempotency_resource_idx',
    unique: false,
    columns: ['app_id', 'resource_type', 'resource_id', 'created_at'],
    collations: ['A', 'A', 'A', 'D'],
  },
]

export const EXPORT_INTEGRITY_CHECK_CLAUSES = {
  member_export_tickets_status_ck:
    '(status in (\'active\',\'reserved\',\'consumed\',\'orphan\',\'expired\'))',
  member_export_tickets_version_ck: '(version > 0)',
  member_export_tickets_token_ck: '(token_hash regexp \'^[0-9a-f]{64}$\')',
  member_export_tickets_sha_ck: '(content_sha256 regexp \'^[0-9a-f]{64}$\')',
  member_export_tickets_bytes_ck: '(content_bytes > 0)',
  member_mutation_idempotency_scope_ck:
    '(scope in (\'checkin\',\'undo_checkin\'))',
  member_mutation_idempotency_hash_ck: '(payload_hash regexp \'^[0-9a-f]{64}$\')',
}

export const EXPORT_INTEGRITY_CHECKS = Object.keys(EXPORT_INTEGRITY_CHECK_CLAUSES)

const CHECK_TABLES = ['member_export_tickets', 'member_mutation_idempotency']

/** Full CREATE TABLE statements (safe IF NOT EXISTS). */
export const EXPORT_INTEGRITY_CREATE_TABLE_SQL = {
  member_export_tickets: `CREATE TABLE IF NOT EXISTS member_export_tickets (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  app_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  event_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  operator_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  file_id VARCHAR(512) NOT NULL,
  object_key VARCHAR(512) NOT NULL,
  file_name VARCHAR(255) NOT NULL,
  content_type VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  content_bytes INT UNSIGNED NOT NULL,
  content_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  row_count INT UNSIGNED NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  reserved_until DATETIME(3) NULL,
  consumed_at DATETIME(3) NULL,
  status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'ACTIVE',
  version INT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT member_export_tickets_status_ck CHECK (
    status IN ('ACTIVE', 'RESERVED', 'CONSUMED', 'ORPHAN', 'EXPIRED')
  ),
  CONSTRAINT member_export_tickets_version_ck CHECK (version > 0),
  CONSTRAINT member_export_tickets_token_ck CHECK (token_hash REGEXP '^[0-9a-f]{64}$'),
  CONSTRAINT member_export_tickets_sha_ck CHECK (content_sha256 REGEXP '^[0-9a-f]{64}$'),
  CONSTRAINT member_export_tickets_bytes_ck CHECK (content_bytes > 0),
  CONSTRAINT member_export_tickets_event_app_fk
    FOREIGN KEY (app_id, event_id) REFERENCES member_events (app_id, id) ON DELETE RESTRICT,
  UNIQUE KEY member_export_tickets_token_uk (app_id, token_hash),
  KEY member_export_tickets_event_idx (app_id, event_id, created_at DESC),
  KEY member_export_tickets_status_idx (app_id, status, expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`,
  member_mutation_idempotency: `CREATE TABLE IF NOT EXISTS member_mutation_idempotency (
  app_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  scope VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  idempotency_key VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  payload_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  resource_type VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  resource_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  response_json JSON NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (app_id, scope, idempotency_key),
  CONSTRAINT member_mutation_idempotency_scope_ck CHECK (
    scope IN ('checkin', 'undo_checkin')
  ),
  CONSTRAINT member_mutation_idempotency_hash_ck CHECK (payload_hash REGEXP '^[0-9a-f]{64}$'),
  KEY member_mutation_idempotency_resource_idx (app_id, resource_type, resource_id, created_at DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`,
}

/**
 * Recoverable ensure fragments keyed by object identity.
 * Tables use CREATE TABLE IF NOT EXISTS; unique keys ADD UNIQUE; FKs DROP old + ADD composite.
 */
export const EXPORT_INTEGRITY_ENSURE_STATEMENTS = [
  `ALTER TABLE member_media_assets ADD UNIQUE KEY member_media_assets_app_id_uk (app_id, id)`,
  `ALTER TABLE member_events ADD UNIQUE KEY member_events_app_id_uk (app_id, id)`,
  `ALTER TABLE member_orders ADD UNIQUE KEY member_orders_app_id_uk (app_id, id)`,
  `ALTER TABLE member_registrations ADD UNIQUE KEY member_registrations_app_id_uk (app_id, id)`,
  `ALTER TABLE member_profiles DROP FOREIGN KEY member_profiles_avatar_fk`,
  `ALTER TABLE member_profiles ADD CONSTRAINT member_profiles_avatar_app_fk FOREIGN KEY (app_id, avatar_asset_id) REFERENCES member_media_assets (app_id, id) ON DELETE RESTRICT`,
  `ALTER TABLE member_events DROP FOREIGN KEY member_events_cover_fk`,
  `ALTER TABLE member_events ADD CONSTRAINT member_events_cover_app_fk FOREIGN KEY (app_id, cover_asset_id) REFERENCES member_media_assets (app_id, id) ON DELETE RESTRICT`,
  `ALTER TABLE member_registrations DROP FOREIGN KEY member_registrations_event_fk`,
  `ALTER TABLE member_registrations ADD CONSTRAINT member_registrations_event_app_fk FOREIGN KEY (app_id, event_id) REFERENCES member_events (app_id, id) ON DELETE RESTRICT`,
  `ALTER TABLE member_registrations DROP FOREIGN KEY member_registrations_order_fk`,
  `ALTER TABLE member_registrations ADD CONSTRAINT member_registrations_order_app_fk FOREIGN KEY (app_id, source_order_id) REFERENCES member_orders (app_id, id) ON DELETE RESTRICT`,
  `ALTER TABLE member_entitlements DROP FOREIGN KEY member_entitlements_source_order_fk`,
  `ALTER TABLE member_entitlements ADD CONSTRAINT member_entitlements_source_order_app_fk FOREIGN KEY (app_id, source_order_id) REFERENCES member_orders (app_id, id) ON DELETE RESTRICT`,
  `ALTER TABLE member_refunds DROP FOREIGN KEY member_refunds_order_fk`,
  `ALTER TABLE member_refunds ADD CONSTRAINT member_refunds_order_app_fk FOREIGN KEY (app_id, order_id) REFERENCES member_orders (app_id, id) ON DELETE RESTRICT`,
  EXPORT_INTEGRITY_CREATE_TABLE_SQL.member_export_tickets,
  EXPORT_INTEGRITY_CREATE_TABLE_SQL.member_mutation_idempotency,
  `ALTER TABLE member_export_tickets ADD UNIQUE KEY member_export_tickets_token_uk (app_id, token_hash)`,
  `ALTER TABLE member_export_tickets ADD KEY member_export_tickets_event_idx (app_id, event_id, created_at DESC)`,
  `ALTER TABLE member_export_tickets ADD KEY member_export_tickets_status_idx (app_id, status, expires_at)`,
  `ALTER TABLE member_export_tickets ADD CONSTRAINT member_export_tickets_event_app_fk FOREIGN KEY (app_id, event_id) REFERENCES member_events (app_id, id) ON DELETE RESTRICT`,
  `ALTER TABLE member_export_tickets ADD CONSTRAINT member_export_tickets_status_ck CHECK (status IN ('ACTIVE', 'RESERVED', 'CONSUMED', 'ORPHAN', 'EXPIRED'))`,
  `ALTER TABLE member_export_tickets ADD CONSTRAINT member_export_tickets_version_ck CHECK (version > 0)`,
  `ALTER TABLE member_export_tickets ADD CONSTRAINT member_export_tickets_token_ck CHECK (token_hash REGEXP '^[0-9a-f]{64}$')`,
  `ALTER TABLE member_export_tickets ADD CONSTRAINT member_export_tickets_sha_ck CHECK (content_sha256 REGEXP '^[0-9a-f]{64}$')`,
  `ALTER TABLE member_export_tickets ADD CONSTRAINT member_export_tickets_bytes_ck CHECK (content_bytes > 0)`,
  `ALTER TABLE member_mutation_idempotency ADD KEY member_mutation_idempotency_resource_idx (app_id, resource_type, resource_id, created_at DESC)`,
  `ALTER TABLE member_mutation_idempotency ADD CONSTRAINT member_mutation_idempotency_scope_ck CHECK (scope IN ('checkin', 'undo_checkin'))`,
  `ALTER TABLE member_mutation_idempotency ADD CONSTRAINT member_mutation_idempotency_hash_ck CHECK (payload_hash REGEXP '^[0-9a-f]{64}$')`,
]

function nestedKeysForTable(table) {
  const keys = []
  for (const column of EXPORT_INTEGRITY_TABLE_COLUMNS[table] || []) {
    keys.push(`column:${table}.${column.name}`)
  }
  for (const index of EXPORT_INTEGRITY_INDEXES) {
    if (index.table === table) {
      keys.push(`index:${index.table}.${index.name}`)
    }
  }
  for (const name of EXPORT_INTEGRITY_CHECKS) {
    // Checks are named member_export_tickets_* / member_mutation_idempotency_*.
    if (name.startsWith(`${table}_`) || name.startsWith(table)) {
      keys.push(`check:${name}`)
    }
  }
  for (const fk of EXPORT_INTEGRITY_FOREIGN_KEYS) {
    if (fk.table === table) {
      keys.push(`fk:${fk.table}.${fk.name}`)
    }
  }
  return keys
}

export function expectedObjectKeys() {
  const keys = []
  for (const index of EXPORT_INTEGRITY_UNIQUE_KEYS) {
    keys.push(`index:${index.table}.${index.name}`)
  }
  for (const fk of EXPORT_INTEGRITY_FOREIGN_KEYS) {
    // Table-owned FKs on export tables counted with table nested; parent FKs listed here.
    // All FKs (including export tickets) appear exactly once.
    keys.push(`fk:${fk.table}.${fk.name}`)
  }
  for (const table of EXPORT_INTEGRITY_TABLES) {
    keys.push(`table:${table}`)
    for (const column of EXPORT_INTEGRITY_TABLE_COLUMNS[table]) {
      keys.push(`column:${table}.${column.name}`)
    }
  }
  for (const index of EXPORT_INTEGRITY_INDEXES) {
    keys.push(`index:${index.table}.${index.name}`)
  }
  for (const name of EXPORT_INTEGRITY_CHECKS) {
    keys.push(`check:${name}`)
  }
  return keys
}

export function checkClausesCompatible(actualRaw, expectedRaw) {
  const actual = normalizeCheckClause(actualRaw)
  const expected = normalizeCheckClause(expectedRaw)
  if (actual === expected) {
    return true
  }
  const compactActual = actual.replace(/[()]/g, '').replace(/\s+/g, '')
  const compactExpected = expected.replace(/[()]/g, '').replace(/\s+/g, '')
  return compactActual === compactExpected
}

/**
 * Format index column list with ASC/DESC from contract collations.
 * information_schema.statistics: A → ASC (omit), D → DESC.
 */
export function formatIndexColumnList(index) {
  return index.columns.map((column, offset) => {
    const collation = Array.isArray(index.collations) ? index.collations[offset] : 'A'
    if (String(collation || 'A').toUpperCase() === 'D') {
      return `${column} DESC`
    }
    return column
  }).join(', ')
}

export function datetimePrecisionMatches(actual, expectedPrecision) {
  if (expectedPrecision === undefined || expectedPrecision === null) {
    return true
  }
  const expected = Number(expectedPrecision)
  if (actual.datetimePrecision !== undefined && actual.datetimePrecision !== null) {
    return Number(actual.datetimePrecision) === expected
  }
  // Fallback when fakes / drivers omit datetime_precision: require column_type datetime(3).
  const columnType = String(actual.columnType || '').toLowerCase()
  return columnType.includes(`datetime(${expected})`)
}

/**
 * Pure shared evaluator used by local MySQL inspector and CloudBase remote adapter.
 * Prevents two-path contract drift. Catalog shape:
 * {
 *   indexes: Map<"table.name", rows[]>,
 *   foreignKeys: Map<"table.name", { rows, oldPresent }>,
 *   tables: Map<table, { engine, tableCollation, columns: Map, pkColumns, createSql }>,
 *   checks: Map<name, checkClause>,
 * }
 */
export function evaluateExportIntegrityCatalog(catalog) {
  const present = new Set()
  const incompatible = []

  const allIndexes = [...EXPORT_INTEGRITY_UNIQUE_KEYS, ...EXPORT_INTEGRITY_INDEXES]
  for (const index of allIndexes) {
    const key = `${index.table}.${index.name}`
    const rows = [...(catalog.indexes?.get(key) || [])]
      .sort((a, b) => Number(a.seq) - Number(b.seq))
    if (!rows.length) {
      continue
    }
    present.add(`index:${index.table}.${index.name}`)
    const isUnique = Number(rows[0].nonUnique) === 0
    if (isUnique !== index.unique) {
      incompatible.push(`${index.name} unique=${isUnique}`)
    }
    const columns = rows.map(row => row.columnName).join(',')
    if (columns !== index.columns.join(',')) {
      incompatible.push(`${index.name} columns=${columns}`)
    }
    if (Array.isArray(index.collations) && index.collations.length) {
      const actualCollations = rows.map(row => String(row.collation || 'A').toUpperCase())
      const expectedCollations = index.collations.map(value => String(value).toUpperCase())
      if (actualCollations.join(',') !== expectedCollations.join(',')) {
        incompatible.push(
          `${index.name} collations=${actualCollations.join(',')} expected=${expectedCollations.join(',')}`,
        )
      }
    }
  }

  for (const fk of EXPORT_INTEGRITY_FOREIGN_KEYS) {
    const key = `${fk.table}.${fk.name}`
    const entry = catalog.foreignKeys?.get(key)
    const rows = [...(entry?.rows || [])].sort((a, b) => Number(a.seq) - Number(b.seq))
    if (!rows.length) {
      continue
    }
    present.add(`fk:${fk.table}.${fk.name}`)
    const columns = rows.map(row => row.columnName).join(',')
    const referencedColumns = rows.map(row => row.referencedColumn).join(',')
    const referencedTable = String(rows[0].referencedTable || '')
    const deleteRule = String(rows[0].deleteRule || '').toUpperCase()
    if (columns !== fk.columns.join(',')) {
      incompatible.push(`${fk.name} columns=${columns}`)
    }
    if (referencedTable !== fk.referencedTable) {
      incompatible.push(`${fk.name} referenced_table=${referencedTable}`)
    }
    if (referencedColumns !== fk.referencedColumns.join(',')) {
      incompatible.push(`${fk.name} referenced_columns=${referencedColumns}`)
    }
    if (deleteRule !== fk.deleteRule) {
      incompatible.push(`${fk.name} delete_rule=${deleteRule}`)
    }
    if (fk.oldName && entry?.oldPresent) {
      incompatible.push(`${fk.table}.${fk.oldName} still_present`)
    }
  }

  for (const table of EXPORT_INTEGRITY_TABLES) {
    const tableEntry = catalog.tables?.get(table)
    if (!tableEntry) {
      continue
    }
    present.add(`table:${table}`)

    const meta = EXPORT_INTEGRITY_TABLE_META[table]
    if (meta) {
      if (meta.engine && tableEntry.engine && String(tableEntry.engine) !== meta.engine) {
        incompatible.push(`${table} engine=${tableEntry.engine}`)
      }
      if (meta.tableCollation && tableEntry.tableCollation
        && String(tableEntry.tableCollation) !== meta.tableCollation) {
        incompatible.push(`${table} collation=${tableEntry.tableCollation}`)
      }
    }

    // PRIMARY KEY exact column order — empty/missing is fail-closed.
    if (meta?.primaryKey) {
      const pkColumns = Array.isArray(tableEntry.pkColumns) ? tableEntry.pkColumns : []
      if (!pkColumns.length || pkColumns.join(',') !== meta.primaryKey.join(',')) {
        incompatible.push(`${table} primary_key=${pkColumns.join(',') || 'missing'}`)
      }
    }

    // SHOW CREATE TABLE cross-check when available.
    const createSql = String(tableEntry.createSql || '')
    if (createSql) {
      if (meta?.engine && !new RegExp(`ENGINE\\s*=\\s*${meta.engine}`, 'i').test(createSql)) {
        incompatible.push(`${table} show_create_engine`)
      }
      if (meta?.tableCollation && !createSql.includes(meta.tableCollation)) {
        incompatible.push(`${table} show_create_collation`)
      }
      if (meta?.primaryKey?.length === 1) {
        if (!new RegExp(`PRIMARY KEY\\s*\\(\\s*\`${meta.primaryKey[0]}\`\\s*\\)`, 'i').test(createSql)
          && !new RegExp(`\`${meta.primaryKey[0]}\`[^,\\n]*PRIMARY KEY`, 'i').test(createSql)) {
          incompatible.push(`${table} show_create_primary_key`)
        }
      }
      else if (meta?.primaryKey?.length > 1) {
        const pkPattern = meta.primaryKey.map(col => `\`${col}\``).join('\\s*,\\s*')
        if (!new RegExp(`PRIMARY KEY\\s*\\(\\s*${pkPattern}\\s*\\)`, 'i').test(createSql)) {
          incompatible.push(`${table} show_create_primary_key`)
        }
      }
    }

    const byName = tableEntry.columns instanceof Map
      ? tableEntry.columns
      : new Map(Object.entries(tableEntry.columns || {}))
    for (const expected of EXPORT_INTEGRITY_TABLE_COLUMNS[table]) {
      const actual = byName.get(expected.name)
      if (!actual) {
        continue
      }
      present.add(`column:${table}.${expected.name}`)
      if (expected.dataType && String(actual.dataType).toLowerCase() !== expected.dataType) {
        incompatible.push(`${table}.${expected.name} data_type=${actual.dataType}`)
      }
      if (
        expected.characterMaximumLength
        && Number(actual.characterMaximumLength) !== expected.characterMaximumLength
      ) {
        incompatible.push(
          `${table}.${expected.name} length=${actual.characterMaximumLength}`,
        )
      }
      if (expected.isNullable && String(actual.isNullable).toUpperCase() !== expected.isNullable) {
        incompatible.push(`${table}.${expected.name} nullable=${actual.isNullable}`)
      }
      if (expected.unsigned === true) {
        const columnType = String(actual.columnType || '').toLowerCase()
        if (!columnType.includes('unsigned')) {
          incompatible.push(`${table}.${expected.name} not_unsigned`)
        }
      }
      if (Object.hasOwn(expected, 'datetimePrecision')) {
        if (!datetimePrecisionMatches(actual, expected.datetimePrecision)) {
          const observed = actual.datetimePrecision ?? String(actual.columnType || 'missing')
          incompatible.push(
            `${table}.${expected.name} datetime_precision=${observed}`,
          )
        }
      }
      if (Array.isArray(expected.extraIncludes)) {
        const extra = String(actual.extra || '')
        for (const fragment of expected.extraIncludes) {
          if (!extra.toLowerCase().includes(String(fragment).toLowerCase())) {
            incompatible.push(`${table}.${expected.name} extra_missing=${fragment}`)
          }
        }
      }
      if (Object.hasOwn(expected, 'columnDefault')) {
        const actualDefault = normalizeDefault(actual.columnDefault)
        const expectedDefault = normalizeDefault(expected.columnDefault)
        // Enforce exact contract defaults, including CURRENT_TIMESTAMP(3).
        if (actualDefault !== expectedDefault) {
          if (expectedDefault !== null) {
            incompatible.push(
              `${table}.${expected.name} default=${actual.columnDefault}`,
            )
          }
        }
      }
    }
  }

  const byCheck = catalog.checks instanceof Map
    ? catalog.checks
    : new Map(Object.entries(catalog.checks || {}))
  for (const name of EXPORT_INTEGRITY_CHECKS) {
    if (!byCheck.has(name)) {
      continue
    }
    present.add(`check:${name}`)
    const expectedClause = EXPORT_INTEGRITY_CHECK_CLAUSES[name]
    if (expectedClause && !checkClausesCompatible(byCheck.get(name), expectedClause)) {
      incompatible.push(`${name} check_clause=${byCheck.get(name)}`)
    }
  }

  const expected = expectedObjectKeys()
  const missing = expected.filter(key => !present.has(key))
  // complete requires zero missing AND zero incompatible — never no-op complete on drift.
  return {
    expectedCount: expected.length,
    presentCount: present.size,
    missing,
    incompatible,
    complete: missing.length === 0 && incompatible.length === 0,
    partial: present.size > 0 && (missing.length > 0 || incompatible.length > 0),
    empty: present.size === 0,
  }
}

async function loadForeignKeyRows(connection, table, name) {
  const [rows] = await connection.execute(
    `SELECT kcu.column_name AS columnName,
            kcu.ordinal_position AS seq,
            kcu.referenced_table_name AS referencedTable,
            kcu.referenced_column_name AS referencedColumn,
            rc.delete_rule AS deleteRule
     FROM information_schema.table_constraints tc
     JOIN information_schema.key_column_usage kcu
       ON kcu.constraint_schema = tc.constraint_schema
      AND kcu.constraint_name = tc.constraint_name
      AND kcu.table_name = tc.table_name
     JOIN information_schema.referential_constraints rc
       ON rc.constraint_schema = tc.constraint_schema
      AND rc.constraint_name = tc.constraint_name
     WHERE tc.table_schema = DATABASE()
       AND tc.table_name = ?
       AND tc.constraint_name = ?
       AND tc.constraint_type = 'FOREIGN KEY'
     ORDER BY kcu.ordinal_position`,
    [table, name],
  )
  return rows
}

async function foreignKeyExists(connection, table, name) {
  const [rows] = await connection.execute(
    `SELECT constraint_name AS name
     FROM information_schema.table_constraints
     WHERE table_schema = DATABASE()
       AND table_name = ?
       AND constraint_name = ?
       AND constraint_type = 'FOREIGN KEY'
     LIMIT 1`,
    [table, name],
  )
  return rows.length > 0
}

/**
 * Load a pure catalog snapshot from a mysql2 connection (local exact path).
 */
export async function loadExportIntegrityCatalog(connection) {
  const indexes = new Map()
  const foreignKeys = new Map()
  const tables = new Map()
  const checks = new Map()

  const allIndexes = [...EXPORT_INTEGRITY_UNIQUE_KEYS, ...EXPORT_INTEGRITY_INDEXES]
  for (const index of allIndexes) {
    const [rows] = await connection.execute(
      `SELECT index_name AS name, non_unique AS nonUnique, column_name AS columnName,
              seq_in_index AS seq, collation AS collation
       FROM information_schema.statistics
       WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ?
       ORDER BY seq_in_index`,
      [index.table, index.name],
    )
    if (rows.length) {
      indexes.set(`${index.table}.${index.name}`, rows)
    }
  }

  for (const fk of EXPORT_INTEGRITY_FOREIGN_KEYS) {
    const rows = await loadForeignKeyRows(connection, fk.table, fk.name)
    if (!rows.length) {
      continue
    }
    let oldPresent = false
    if (fk.oldName) {
      oldPresent = await foreignKeyExists(connection, fk.table, fk.oldName)
    }
    foreignKeys.set(`${fk.table}.${fk.name}`, { rows, oldPresent })
  }

  for (const table of EXPORT_INTEGRITY_TABLES) {
    const [tableRows] = await connection.execute(
      `SELECT table_name AS name, engine AS engine, table_collation AS tableCollation
       FROM information_schema.tables
       WHERE table_schema = DATABASE() AND table_name = ?
       LIMIT 1`,
      [table],
    )
    if (!tableRows.length) {
      continue
    }

    const meta = EXPORT_INTEGRITY_TABLE_META[table]
    let pkColumns = []
    if (meta?.primaryKey) {
      const [pkRows] = await connection.execute(
        `SELECT column_name AS columnName, seq_in_index AS seq
         FROM information_schema.statistics
         WHERE table_schema = DATABASE() AND table_name = ? AND index_name = 'PRIMARY'
         ORDER BY seq_in_index`,
        [table],
      )
      pkColumns = (pkRows || []).map(row => row.columnName)
    }

    let createSql = ''
    try {
      const [createRows] = await connection.query(`SHOW CREATE TABLE \`${table}\``)
      createSql = String(
        createRows?.[0]?.['Create Table']
        || createRows?.[0]?.CreateTable
        || createRows?.[0]?.['CREATE TABLE']
        || '',
      )
    }
    catch {
      // Some fakes omit SHOW CREATE TABLE; information_schema path remains authoritative.
    }

    const [columnRows] = await connection.execute(
      `SELECT column_name AS name, data_type AS dataType,
              character_maximum_length AS characterMaximumLength,
              is_nullable AS isNullable,
              column_default AS columnDefault,
              column_type AS columnType,
              extra AS extra,
              datetime_precision AS datetimePrecision
       FROM information_schema.columns
       WHERE table_schema = DATABASE() AND table_name = ?`,
      [table],
    )
    tables.set(table, {
      engine: tableRows[0].engine,
      tableCollation: tableRows[0].tableCollation,
      pkColumns,
      createSql,
      columns: new Map(columnRows.map(row => [row.name, row])),
    })
  }

  const [checkRows] = await connection.execute(
    `SELECT tc.constraint_name AS name, cc.check_clause AS checkClause
     FROM information_schema.table_constraints tc
     JOIN information_schema.check_constraints cc
       ON cc.constraint_schema = tc.constraint_schema
      AND cc.constraint_name = tc.constraint_name
     WHERE tc.table_schema = DATABASE()
       AND tc.constraint_type = 'CHECK'
       AND tc.table_name IN (${CHECK_TABLES.map(() => '?').join(', ')})`,
    CHECK_TABLES,
  )
  for (const row of checkRows || []) {
    checks.set(row.name, row.checkClause)
  }

  return { indexes, foreignKeys, tables, checks }
}

export async function inspectExportIntegrity(connection) {
  const catalog = await loadExportIntegrityCatalog(connection)
  return evaluateExportIntegrityCatalog(catalog)
}

/**
 * Statement plan: only missing objects are applied.
 * FK recovery drops the old single-column constraint when still present.
 * CREATE TABLE IF NOT EXISTS covers a missing table and its nested objects.
 */
export function buildEnsureStatementPlan() {
  const plan = []

  for (const index of EXPORT_INTEGRITY_UNIQUE_KEYS) {
    plan.push({
      key: `index:${index.table}.${index.name}`,
      kind: 'unique',
      sql: `ALTER TABLE ${index.table} ADD UNIQUE KEY ${index.name} (${formatIndexColumnList(index)})`,
    })
  }

  for (const fk of EXPORT_INTEGRITY_FOREIGN_KEYS) {
    if (fk.table === 'member_export_tickets') {
      // Created with the table; also recoverable via ADD CONSTRAINT if table exists bare.
      plan.push({
        key: `fk:${fk.table}.${fk.name}`,
        kind: 'fk',
        table: fk.table,
        name: fk.name,
        oldName: null,
        sql: `ALTER TABLE ${fk.table} ADD CONSTRAINT ${fk.name} FOREIGN KEY (${fk.columns.join(', ')}) REFERENCES ${fk.referencedTable} (${fk.referencedColumns.join(', ')}) ON DELETE ${fk.deleteRule}`,
      })
      continue
    }
    plan.push({
      key: `fk:${fk.table}.${fk.name}`,
      kind: 'fk',
      table: fk.table,
      name: fk.name,
      oldName: fk.oldName,
      sql: `ALTER TABLE ${fk.table} ADD CONSTRAINT ${fk.name} FOREIGN KEY (${fk.columns.join(', ')}) REFERENCES ${fk.referencedTable} (${fk.referencedColumns.join(', ')}) ON DELETE ${fk.deleteRule}`,
    })
  }

  for (const table of EXPORT_INTEGRITY_TABLES) {
    plan.push({
      key: `table:${table}`,
      kind: 'table',
      table,
      nestedKeys: nestedKeysForTable(table),
      sql: EXPORT_INTEGRITY_CREATE_TABLE_SQL[table],
    })
  }

  // Partial recovery when table exists but nested objects are missing.
  // Index SQL must preserve DESC from contract collations (A omit, D → DESC).
  for (const index of EXPORT_INTEGRITY_INDEXES) {
    const columnList = formatIndexColumnList(index)
    plan.push({
      key: `index:${index.table}.${index.name}`,
      kind: 'index',
      sql: index.unique
        ? `ALTER TABLE ${index.table} ADD UNIQUE KEY ${index.name} (${columnList})`
        : `ALTER TABLE ${index.table} ADD KEY ${index.name} (${columnList})`,
    })
  }

  for (const name of EXPORT_INTEGRITY_CHECKS) {
    const table = name.startsWith('member_export_tickets')
      ? 'member_export_tickets'
      : 'member_mutation_idempotency'
    const clause = EXPORT_INTEGRITY_CHECK_CLAUSES[name]
    // Reconstruct a reasonable CHECK for recovery; clause body matches contract.
    let sqlClause
    if (name === 'member_export_tickets_status_ck') {
      sqlClause = `status IN ('ACTIVE', 'RESERVED', 'CONSUMED', 'ORPHAN', 'EXPIRED')`
    }
    else if (name === 'member_mutation_idempotency_scope_ck') {
      sqlClause = `scope IN ('checkin', 'undo_checkin')`
    }
    else if (name.endsWith('_version_ck')) {
      sqlClause = 'version > 0'
    }
    else if (name.endsWith('_bytes_ck')) {
      sqlClause = 'content_bytes > 0'
    }
    else if (name.endsWith('_token_ck')) {
      sqlClause = `token_hash REGEXP '^[0-9a-f]{64}$'`
    }
    else if (name.endsWith('_sha_ck') || name.endsWith('_hash_ck')) {
      const col = name.includes('payload') ? 'payload_hash' : 'content_sha256'
      sqlClause = `${col} REGEXP '^[0-9a-f]{64}$'`
    }
    else {
      sqlClause = clause
    }
    plan.push({
      key: `check:${name}`,
      kind: 'check',
      sql: `ALTER TABLE ${table} ADD CONSTRAINT ${name} CHECK (${sqlClause})`,
    })
  }

  // Columns only recoverable when table already exists without them (rare after atomic CREATE).
  for (const [table, columns] of Object.entries(EXPORT_INTEGRITY_TABLE_COLUMNS)) {
    for (const column of columns) {
      plan.push({
        key: `column:${table}.${column.name}`,
        kind: 'column',
        // Column-level recovery is intentionally unsupported as a full type rewrite;
        // missing columns after a present table are reported via re-inspect failure
        // unless CREATE TABLE ran. Keep a no-op marker for plan completeness tests.
        sql: null,
        table,
        column: column.name,
      })
    }
  }

  return plan
}

/**
 * Complete a partial 003 by applying only missing objects.
 * Incompatible definitions fail hard so operators can reset the test DB.
 * Does NOT write the migration row — apply-mysql-schema owns that.
 */
export async function ensureExportIntegrity(connection, { query } = {}) {
  const run = query || (sql => connection.query(sql))
  const state = await inspectExportIntegrity(connection)
  if (state.incompatible.length) {
    throw new Error(
      `003 export integrity incompatible definitions: ${state.incompatible.join('; ')}`,
    )
  }
  // Never return noop when incomplete — only complete may no-op.
  if (state.complete) {
    return { action: 'noop', state }
  }
  if (state.missing.length === 0 && !state.complete) {
    throw new Error(
      `003 export integrity incomplete without missing keys (incompatible or inspect gap): ${state.incompatible.join('; ')}`,
    )
  }

  const missing = new Set(state.missing)
  const applied = []
  const plan = buildEnsureStatementPlan()

  // Prefer CREATE TABLE before nested table objects so one statement can satisfy many keys.
  const ordered = [
    ...plan.filter(step => step.kind === 'unique'),
    ...plan.filter(step => step.kind === 'fk' && step.table !== 'member_export_tickets'),
    ...plan.filter(step => step.kind === 'table'),
    ...plan.filter(step => step.kind === 'fk' && step.table === 'member_export_tickets'),
    ...plan.filter(step => step.kind === 'index' || step.kind === 'check'),
    ...plan.filter(step => step.kind === 'column'),
  ]

  for (const step of ordered) {
    if (!missing.has(step.key)) {
      continue
    }

    if (step.kind === 'table') {
      await run(step.sql)
      applied.push(step.key)
      for (const nested of step.nestedKeys || []) {
        missing.delete(nested)
      }
      continue
    }

    if (step.kind === 'fk') {
      if (step.oldName) {
        const hasOld = await foreignKeyExists(connection, step.table, step.oldName)
        if (hasOld) {
          await run(`ALTER TABLE ${step.table} DROP FOREIGN KEY ${step.oldName}`)
        }
      }
      await run(step.sql)
      applied.push(step.key)
      continue
    }

    if (step.kind === 'column') {
      // No safe typed ADD COLUMN recovery for full 003 column contracts (precision,
      // defaults, charset). Fail closed — never mark complete or no-op when columns missing.
      throw new Error(
        `003 export integrity cannot recover missing column ${step.table}.${step.column}; reset the test DB or recreate the table`,
      )
    }

    if (!step.sql) {
      continue
    }

    await run(step.sql)
    applied.push(step.key)
  }

  const after = await inspectExportIntegrity(connection)
  if (!after.complete) {
    const details = [
      after.missing.length ? `still missing: ${after.missing.join(', ')}` : null,
      after.incompatible.length ? `incompatible: ${after.incompatible.join('; ')}` : null,
    ].filter(Boolean).join('; ')
    throw new Error(`003 recovery incomplete; ${details || 'inspect incomplete'}`)
  }
  return { action: 'recovered', applied, state: after }
}

// Expose nested helper for tests that assert CREATE TABLE covers nested keys.
export { nestedKeysForTable }
