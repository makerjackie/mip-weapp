/**
 * Case-local contract for 002_activity_operations objects.
 * MySQL DDL auto-commits, so a partial 002 must be recoverable via information_schema
 * without rewriting locked 001 SQL.
 */

export const ACTIVITY_OPERATIONS_VERSION = '20260723220000'
export const ACTIVITY_OPERATIONS_NAME = 'activity_operations'

/** Explicit reset token required before verify:mysql may wipe/reseed a test database. */
export const MEMBERSHIP_TEST_RESET_TOKEN = 'membership-test-reset'

export const ACTIVITY_OPERATION_COLUMNS = {
  member_events: [
    { name: 'venue_name', dataType: 'varchar', characterMaximumLength: 120, isNullable: 'NO', columnDefault: '' },
    { name: 'cancellation_policy', dataType: 'varchar', characterMaximumLength: 1000, isNullable: 'NO', columnDefault: '' },
    { name: 'cancelled_at', dataType: 'datetime', isNullable: 'YES' },
    { name: 'cancelled_by', dataType: 'varchar', characterMaximumLength: 128, isNullable: 'YES' },
    { name: 'cancellation_reason', dataType: 'varchar', characterMaximumLength: 500, isNullable: 'YES' },
    { name: 'version', dataType: 'int', isNullable: 'NO', columnDefault: '1' },
  ],
  member_registrations: [
    { name: 'ticket_code', dataType: 'varchar', characterMaximumLength: 32, isNullable: 'YES' },
    { name: 'attended_at', dataType: 'datetime', isNullable: 'YES' },
    { name: 'attended_by', dataType: 'varchar', characterMaximumLength: 128, isNullable: 'YES' },
    { name: 'cancelled_at', dataType: 'datetime', isNullable: 'YES' },
    { name: 'cancelled_by_type', dataType: 'varchar', characterMaximumLength: 16, isNullable: 'YES' },
    { name: 'cancellation_reason', dataType: 'varchar', characterMaximumLength: 500, isNullable: 'YES' },
    { name: 'version', dataType: 'int', isNullable: 'NO', columnDefault: '1' },
  ],
}

/** Normalized CHECK expressions (whitespace/case-insensitive compare). */
export const ACTIVITY_OPERATION_CHECK_CLAUSES = {
  member_events_version_ck: '(version > 0)',
  member_registrations_version_ck: '(version > 0)',
  member_registrations_cancelled_by_type_ck:
    '(cancelled_by_type is null or cancelled_by_type in (\'member\',\'event\',\'system\'))',
}

export function normalizeCheckClause(value) {
  return String(value || '')
    .toLowerCase()
    // information_schema may serialize string literals with a character-set
    // introducer and CloudBase may preserve the escaped quote in its envelope.
    // These variants do not change the CHECK expression semantics.
    .replace(/_(?:utf8mb4|utf8|ascii)\\?'/g, '\'')
    .replace(/\\'/g, '\'')
    .replace(/`/g, '')
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
  // MySQL may quote string defaults.
  if (
    (text.startsWith('\'') && text.endsWith('\''))
    || (text.startsWith('"') && text.endsWith('"'))
  ) {
    text = text.slice(1, -1)
  }
  return text
}

export const ACTIVITY_OPERATION_INDEXES = [
  {
    table: 'member_registrations',
    name: 'member_registrations_ticket_uk',
    unique: true,
    columns: ['app_id', 'ticket_code'],
  },
  {
    table: 'member_registrations',
    name: 'member_registrations_roster_idx',
    unique: false,
    columns: ['app_id', 'event_id', 'status', 'registered_at', 'id'],
  },
]

export const ACTIVITY_OPERATION_CHECKS = [
  'member_events_version_ck',
  'member_registrations_version_ck',
  'member_registrations_cancelled_by_type_ck',
]

/**
 * Recoverable ALTER fragments for each 002 object.
 * Used only when information_schema reports a partial 002 apply.
 */
export const ACTIVITY_OPERATION_ENSURE_STATEMENTS = [
  `ALTER TABLE member_events ADD COLUMN venue_name VARCHAR(120) NOT NULL DEFAULT '' AFTER location`,
  `ALTER TABLE member_events ADD COLUMN cancellation_policy VARCHAR(1000) NOT NULL DEFAULT '' AFTER address`,
  `ALTER TABLE member_events ADD COLUMN cancelled_at DATETIME(3) NULL AFTER status`,
  `ALTER TABLE member_events ADD COLUMN cancelled_by VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER cancelled_at`,
  `ALTER TABLE member_events ADD COLUMN cancellation_reason VARCHAR(500) NULL AFTER cancelled_by`,
  `ALTER TABLE member_events ADD COLUMN version INT UNSIGNED NOT NULL DEFAULT 1 AFTER cancellation_reason`,
  `ALTER TABLE member_events ADD CONSTRAINT member_events_version_ck CHECK (version > 0)`,
  `ALTER TABLE member_registrations ADD COLUMN ticket_code VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER status`,
  `ALTER TABLE member_registrations ADD COLUMN attended_at DATETIME(3) NULL AFTER registered_at`,
  `ALTER TABLE member_registrations ADD COLUMN attended_by VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER attended_at`,
  `ALTER TABLE member_registrations ADD COLUMN cancelled_at DATETIME(3) NULL AFTER attended_by`,
  `ALTER TABLE member_registrations ADD COLUMN cancelled_by_type VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER cancelled_at`,
  `ALTER TABLE member_registrations ADD COLUMN cancellation_reason VARCHAR(500) NULL AFTER cancelled_by_type`,
  `ALTER TABLE member_registrations ADD COLUMN version INT UNSIGNED NOT NULL DEFAULT 1 AFTER cancellation_reason`,
  `ALTER TABLE member_registrations ADD CONSTRAINT member_registrations_version_ck CHECK (version > 0)`,
  `ALTER TABLE member_registrations ADD CONSTRAINT member_registrations_cancelled_by_type_ck CHECK (
    cancelled_by_type IS NULL OR cancelled_by_type IN ('MEMBER', 'EVENT', 'SYSTEM')
  )`,
  `ALTER TABLE member_registrations ADD UNIQUE KEY member_registrations_ticket_uk (app_id, ticket_code)`,
  `ALTER TABLE member_registrations ADD KEY member_registrations_roster_idx (app_id, event_id, status, registered_at, id)`,
]

export function expectedObjectKeys() {
  const keys = []
  for (const [table, columns] of Object.entries(ACTIVITY_OPERATION_COLUMNS)) {
    for (const column of columns) {
      keys.push(`column:${table}.${column.name}`)
    }
  }
  for (const index of ACTIVITY_OPERATION_INDEXES) {
    keys.push(`index:${index.table}.${index.name}`)
  }
  for (const name of ACTIVITY_OPERATION_CHECKS) {
    keys.push(`check:${name}`)
  }
  return keys
}

export async function inspectActivityOperations(connection) {
  const present = new Set()
  const incompatible = []

  for (const [table, columns] of Object.entries(ACTIVITY_OPERATION_COLUMNS)) {
    const [rows] = await connection.execute(
      `SELECT column_name AS name, data_type AS dataType,
              character_maximum_length AS characterMaximumLength,
              is_nullable AS isNullable,
              column_default AS columnDefault,
              column_type AS columnType
       FROM information_schema.columns
       WHERE table_schema = DATABASE() AND table_name = ?`,
      [table],
    )
    const byName = new Map(rows.map(row => [row.name, row]))
    for (const expected of columns) {
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
      if (expected.isNullable && actual.isNullable !== expected.isNullable) {
        incompatible.push(`${table}.${expected.name} nullable=${actual.isNullable}`)
      }
      if (Object.hasOwn(expected, 'columnDefault')) {
        const actualDefault = normalizeDefault(actual.columnDefault)
        const expectedDefault = normalizeDefault(expected.columnDefault)
        if (actualDefault !== expectedDefault) {
          incompatible.push(
            `${table}.${expected.name} default=${actual.columnDefault}`,
          )
        }
      }
    }
  }

  for (const index of ACTIVITY_OPERATION_INDEXES) {
    const [rows] = await connection.execute(
      `SELECT index_name AS name, non_unique AS nonUnique, column_name AS columnName, seq_in_index AS seq
       FROM information_schema.statistics
       WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ?
       ORDER BY seq_in_index`,
      [index.table, index.name],
    )
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
  }

  const [checks] = await connection.execute(
    `SELECT tc.constraint_name AS name, cc.check_clause AS checkClause
     FROM information_schema.table_constraints tc
     JOIN information_schema.check_constraints cc
       ON cc.constraint_schema = tc.constraint_schema
      AND cc.constraint_name = tc.constraint_name
     WHERE tc.table_schema = DATABASE()
       AND tc.constraint_type = 'CHECK'
       AND tc.table_name IN ('member_events', 'member_registrations')`,
  )
  const byCheck = new Map(checks.map(row => [row.name, row.checkClause]))
  for (const name of ACTIVITY_OPERATION_CHECKS) {
    if (!byCheck.has(name)) {
      continue
    }
    present.add(`check:${name}`)
    const expectedClause = ACTIVITY_OPERATION_CHECK_CLAUSES[name]
    if (expectedClause) {
      const actual = normalizeCheckClause(byCheck.get(name))
      const expected = normalizeCheckClause(expectedClause)
      if (actual !== expected && !actual.includes(expected.replace(/[()]/g, ''))) {
        // Accept MySQL wrapping variants when normalized bodies match after paren strip.
        const compactActual = actual.replace(/[()]/g, '').replace(/\s+/g, '')
        const compactExpected = expected.replace(/[()]/g, '').replace(/\s+/g, '')
        if (compactActual !== compactExpected) {
          incompatible.push(`${name} check_clause=${byCheck.get(name)}`)
        }
      }
    }
  }

  const expected = expectedObjectKeys()
  const missing = expected.filter(key => !present.has(key))
  return {
    expectedCount: expected.length,
    presentCount: present.size,
    missing,
    incompatible,
    complete: missing.length === 0 && incompatible.length === 0,
    partial: present.size > 0 && missing.length > 0,
    empty: present.size === 0,
  }
}

/**
 * Complete a partial 002 by applying only missing objects.
 * Incompatible definitions fail hard so operators can reset the test DB.
 */
export async function ensureActivityOperations(connection, { query } = {}) {
  const run = query || (sql => connection.query(sql))
  const state = await inspectActivityOperations(connection)
  if (state.incompatible.length) {
    throw new Error(`002 activity operations incompatible definitions: ${state.incompatible.join('; ')}`)
  }
  if (state.complete) {
    return { action: 'noop', state }
  }

  // Map ensure statements to the object key they create, then run only missing ones.
  const statementPlan = [
    { key: 'column:member_events.venue_name', sql: ACTIVITY_OPERATION_ENSURE_STATEMENTS[0] },
    { key: 'column:member_events.cancellation_policy', sql: ACTIVITY_OPERATION_ENSURE_STATEMENTS[1] },
    { key: 'column:member_events.cancelled_at', sql: ACTIVITY_OPERATION_ENSURE_STATEMENTS[2] },
    { key: 'column:member_events.cancelled_by', sql: ACTIVITY_OPERATION_ENSURE_STATEMENTS[3] },
    { key: 'column:member_events.cancellation_reason', sql: ACTIVITY_OPERATION_ENSURE_STATEMENTS[4] },
    { key: 'column:member_events.version', sql: ACTIVITY_OPERATION_ENSURE_STATEMENTS[5] },
    { key: 'check:member_events_version_ck', sql: ACTIVITY_OPERATION_ENSURE_STATEMENTS[6] },
    { key: 'column:member_registrations.ticket_code', sql: ACTIVITY_OPERATION_ENSURE_STATEMENTS[7] },
    { key: 'column:member_registrations.attended_at', sql: ACTIVITY_OPERATION_ENSURE_STATEMENTS[8] },
    { key: 'column:member_registrations.attended_by', sql: ACTIVITY_OPERATION_ENSURE_STATEMENTS[9] },
    { key: 'column:member_registrations.cancelled_at', sql: ACTIVITY_OPERATION_ENSURE_STATEMENTS[10] },
    { key: 'column:member_registrations.cancelled_by_type', sql: ACTIVITY_OPERATION_ENSURE_STATEMENTS[11] },
    { key: 'column:member_registrations.cancellation_reason', sql: ACTIVITY_OPERATION_ENSURE_STATEMENTS[12] },
    { key: 'column:member_registrations.version', sql: ACTIVITY_OPERATION_ENSURE_STATEMENTS[13] },
    { key: 'check:member_registrations_version_ck', sql: ACTIVITY_OPERATION_ENSURE_STATEMENTS[14] },
    { key: 'check:member_registrations_cancelled_by_type_ck', sql: ACTIVITY_OPERATION_ENSURE_STATEMENTS[15] },
    { key: 'index:member_registrations.member_registrations_ticket_uk', sql: ACTIVITY_OPERATION_ENSURE_STATEMENTS[16] },
    { key: 'index:member_registrations.member_registrations_roster_idx', sql: ACTIVITY_OPERATION_ENSURE_STATEMENTS[17] },
  ]

  const missing = new Set(state.missing)
  const applied = []
  for (const step of statementPlan) {
    if (!missing.has(step.key)) {
      continue
    }
    await run(step.sql)
    applied.push(step.key)
  }

  const after = await inspectActivityOperations(connection)
  if (!after.complete) {
    throw new Error(`002 recovery incomplete; still missing: ${after.missing.join(', ')}`)
  }
  return { action: 'recovered', applied, state: after }
}
