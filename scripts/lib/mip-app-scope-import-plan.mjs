import { createHash } from 'node:crypto'

const IDENTIFIER_PATTERN = /^[a-z][a-z0-9_]*$/
const APP_ID_COLUMN = 'app_id'

export const MIP_IMPORT_POINTER_RULES = Object.freeze([
  Object.freeze({
    constraintName: 'mip_users_primary_branch_fk',
    table: 'mip_users',
    parentTable: 'mip_branch_memberships',
    deferredColumns: Object.freeze(['primary_branch_id']),
  }),
  Object.freeze({
    constraintName: 'mip_message_campaigns_active_dispatch_fk',
    table: 'mip_message_campaigns',
    parentTable: 'mip_message_campaign_dispatches',
    deferredColumns: Object.freeze(['active_dispatch_id']),
  }),
])

export const MIP_IMPORT_SELF_REFERENCE_TABLES = Object.freeze([
  'mip_content_comments',
  'mip_event_checkin_transitions',
  'mip_tags',
])

/**
 * Build a data-only AppID import plan from information_schema inventories.
 * The returned plan contains no executable SQL and never relaxes referential integrity.
 */
export function buildMipAppScopeImportPlan({
  tableRows,
  columnRows,
  primaryKeyRows,
  foreignKeyRows,
  targetRowCounts,
}) {
  const columnsByTable = normalizeColumnRows(columnRows)
  const tables = normalizeAppScopedTables(tableRows, columnsByTable)
  const tableSet = new Set(tables)
  const foreignKeys = normalizeForeignKeyRows(foreignKeyRows)
    .filter(foreignKey => tableSet.has(foreignKey.childTable))

  assertForeignKeysStayInsideImport(foreignKeys, tableSet)
  assertTargetMipDataTablesEmpty({ tables, targetRowCounts })

  const primaryKeys = normalizePrimaryKeyRows(primaryKeyRows, tableSet)
  const pointerRestores = []
  const selfReferences = []
  const dependencyForeignKeys = []

  for (const foreignKey of foreignKeys) {
    if (foreignKey.childTable === foreignKey.parentTable) {
      selfReferences.push(buildSelfReferenceStrategy(foreignKey, primaryKeys))
      continue
    }

    const pointerRule = findPointerRule(foreignKey)
    if (pointerRule) {
      assertDeferredColumnsAreNullable(pointerRule, foreignKey, columnsByTable)
      pointerRestores.push(buildPointerRestore(pointerRule, foreignKey, primaryKeys))
      continue
    }

    dependencyForeignKeys.push(foreignKey)
  }

  const importOrder = topologicallyOrderTables(tables, dependencyForeignKeys)
  const importSteps = importOrder.map(table => Object.freeze({
    table,
    primaryKey: primaryKeys.get(table),
    mapColumns: Object.freeze({ [APP_ID_COLUMN]: 'TARGET_APP_ID' }),
    setNullColumns: Object.freeze(
      pointerRestores
        .filter(pointer => pointer.table === table)
        .flatMap(pointer => pointer.deferredColumns),
    ),
    rowOrder: selfReferences.find(reference => reference.table === table)
      ?? Object.freeze({ strategy: 'source-primary-key-order' }),
  }))

  return deepFreeze({
    version: 1,
    scope: 'MIP_APP_ID_ONLY',
    foreignKeyMode: 'ENFORCED_FOR_ALL_PHASES',
    tables,
    importOrder,
    phases: [
      {
        id: 'target-empty-precondition',
        kind: 'PRECONDITION',
        requirement: 'EVERY_TARGET_MIP_DATA_TABLE_EMPTY',
      },
      {
        id: 'parent-first-import',
        kind: 'INSERT',
        steps: importSteps,
      },
      {
        id: 'restore-deferred-pointers',
        kind: 'RESTORE_POINTERS',
        steps: orderPointerRestores(pointerRestores, importOrder),
      },
      {
        id: 'post-import-verification',
        kind: 'VERIFY',
        requirements: [
          'ROW_COUNTS_EQUAL',
          'PRIMARY_KEY_INVENTORIES_EQUAL_AFTER_APP_ID_MAPPING',
          'NO_FOREIGN_KEY_ORPHANS',
          'NO_SOURCE_APP_ID_ROWS_IN_TARGET',
        ],
      },
    ],
    selfReferences,
    pointerRestores: orderPointerRestores(pointerRestores, importOrder),
  })
}

export function normalizeForeignKeyRows(rows = []) {
  if (!Array.isArray(rows)) {
    throw new TypeError('Foreign-key metadata must be an array')
  }

  const grouped = new Map()
  for (const row of rows) {
    const childTable = metadataValue(row, [
      'childTable',
      'tableName',
      'table_name',
      'TABLE_NAME',
    ])
    const parentTable = metadataValue(row, [
      'parentTable',
      'referencedTableName',
      'referenced_table_name',
      'REFERENCED_TABLE_NAME',
    ])
    if (!childTable?.startsWith('mip_')) {
      continue
    }
    assertMipTable(childTable)
    if (parentTable === null || parentTable === undefined) {
      continue
    }
    assertMipTable(parentTable)

    const constraintName = metadataValue(row, [
      'constraintName',
      'constraint_name',
      'CONSTRAINT_NAME',
    ])
    const childColumn = metadataValue(row, [
      'childColumn',
      'columnName',
      'column_name',
      'COLUMN_NAME',
    ])
    const parentColumn = metadataValue(row, [
      'parentColumn',
      'referencedColumnName',
      'referenced_column_name',
      'REFERENCED_COLUMN_NAME',
    ])
    const ordinalPosition = Number(metadataValue(row, [
      'ordinalPosition',
      'ordinal_position',
      'ORDINAL_POSITION',
      'positionInUniqueConstraint',
    ]))

    assertIdentifier(constraintName, 'foreign-key constraint')
    assertIdentifier(childColumn, 'foreign-key child column')
    assertIdentifier(parentColumn, 'foreign-key parent column')
    if (!Number.isInteger(ordinalPosition) || ordinalPosition < 1) {
      throw new Error(`Foreign key ${constraintName} has an invalid column position`)
    }

    const key = `${childTable}\0${constraintName}`
    const entry = grouped.get(key) ?? {
      constraintName,
      childTable,
      parentTable,
      columns: [],
    }
    if (entry.parentTable !== parentTable) {
      throw new Error(`Foreign key ${constraintName} references multiple parent tables`)
    }
    entry.columns.push({ childColumn, parentColumn, ordinalPosition })
    grouped.set(key, entry)
  }

  return [...grouped.values()]
    .map((entry) => {
      entry.columns.sort((left, right) => left.ordinalPosition - right.ordinalPosition)
      const positions = entry.columns.map(column => column.ordinalPosition)
      if (new Set(positions).size !== positions.length
        || positions.some((position, index) => position !== index + 1)) {
        throw new Error(`Foreign key ${entry.constraintName} has incomplete column positions`)
      }
      return deepFreeze(entry)
    })
    .sort(compareForeignKeys)
}

export function assertTargetMipDataTablesEmpty({ tables, targetRowCounts }) {
  const counts = normalizeCountEvidence(targetRowCounts)
  for (const table of tables) {
    assertMipTable(table)
    if (!counts.has(table)) {
      throw new Error(`Target emptiness evidence is missing for ${table}`)
    }
    const count = counts.get(table)
    if (count !== 0) {
      throw new Error(`Target MIP data table is not empty: ${table}`)
    }
  }
  return true
}

export function buildMipImportValidationContract({
  tableRows,
  columnRows,
  primaryKeyRows,
  foreignKeyRows,
}) {
  const columnsByTable = normalizeColumnRows(columnRows)
  const tables = normalizeAppScopedTables(tableRows, columnsByTable)
  const tableSet = new Set(tables)
  const primaryKeys = normalizePrimaryKeyRows(primaryKeyRows, tableSet)
  const foreignKeys = normalizeForeignKeyRows(foreignKeyRows)
    .filter(foreignKey => tableSet.has(foreignKey.childTable))
  assertForeignKeysStayInsideImport(foreignKeys, tableSet)

  return deepFreeze({
    version: 1,
    scope: 'MIP_APP_ID_ONLY',
    rowCounts: tables.map(table => ({
      table,
      source: selectForAppScope(table, ['COUNT(*) AS row_count'], [], 'SOURCE_APP_ID'),
      target: selectForAppScope(table, ['COUNT(*) AS row_count'], [], 'TARGET_APP_ID'),
      assertion: 'SOURCE_EQUALS_TARGET',
    })),
    primaryKeys: tables.map((table) => {
      const logicalKey = primaryKeys.get(table).filter(column => column !== APP_ID_COLUMN)
      if (logicalKey.length === 0) {
        throw new Error(`${table} has no logical primary-key column after AppID mapping`)
      }
      return {
        table,
        columns: logicalKey,
        source: selectForAppScope(table, logicalKey, logicalKey, 'SOURCE_APP_ID'),
        target: selectForAppScope(table, logicalKey, logicalKey, 'TARGET_APP_ID'),
        assertion: 'SHA256_INVENTORY_EQUAL_AFTER_APP_ID_MAPPING',
      }
    }),
    orphans: foreignKeys.map(buildOrphanCheck),
    sourceAppIdResiduals: tables.map(table => ({
      table,
      target: selectForAppScope(
        table,
        ['COUNT(*) AS residual_count'],
        [],
        'SOURCE_APP_ID',
      ),
      expected: 0,
    })),
  })
}

export function assertMipImportValidationEvidence(contract, evidence) {
  const rowCounts = normalizeEvidenceMap(evidence?.rowCounts, 'row-count')
  const primaryKeys = normalizeEvidenceMap(evidence?.primaryKeys, 'primary-key')
  const orphans = normalizeEvidenceMap(evidence?.orphans, 'orphan')
  const residuals = normalizeEvidenceMap(
    evidence?.sourceAppIdResiduals,
    'source-AppID residual',
  )

  for (const check of contract.rowCounts) {
    const value = rowCounts.get(check.table)
    const source = exactNonNegativeInteger(value?.source, `${check.table} source row count`)
    const target = exactNonNegativeInteger(value?.target, `${check.table} target row count`)
    if (source !== target) {
      throw new Error(`Row-count verification failed for ${check.table}`)
    }
  }

  for (const check of contract.primaryKeys) {
    const value = primaryKeys.get(check.table)
    const sourceDigest = digestPrimaryKeyInventory(value?.source, check.columns)
    const targetDigest = digestPrimaryKeyInventory(value?.target, check.columns)
    if (sourceDigest !== targetDigest) {
      throw new Error(`Primary-key verification failed for ${check.table}`)
    }
  }

  for (const check of contract.orphans) {
    const count = exactNonNegativeInteger(
      orphans.get(check.constraintName),
      `${check.constraintName} orphan count`,
    )
    if (count !== 0) {
      throw new Error(`Orphan verification failed for ${check.constraintName}`)
    }
  }

  for (const check of contract.sourceAppIdResiduals) {
    const count = exactNonNegativeInteger(
      residuals.get(check.table),
      `${check.table} source-AppID residual count`,
    )
    if (count !== 0) {
      throw new Error(`Source AppID residue remains in ${check.table}`)
    }
  }

  return true
}

export function digestPrimaryKeyInventory(rows, columns) {
  if (!Array.isArray(rows)) {
    throw new TypeError('Primary-key inventory must be an array')
  }
  const keys = rows.map(row => columns.map((column) => {
    if (!Object.hasOwn(row, column) || row[column] === null || row[column] === undefined) {
      throw new Error(`Primary-key inventory is missing ${column}`)
    }
    return String(row[column])
  }))
  const serialized = keys
    .map(parts => JSON.stringify(parts))
    .sort()
  if (new Set(serialized).size !== serialized.length) {
    throw new Error('Primary-key inventory contains duplicate keys')
  }
  return createHash('sha256').update(serialized.join('\n')).digest('hex')
}

export function orderSelfReferentialRows({
  rows,
  childColumns,
  parentColumns,
}) {
  if (!Array.isArray(rows)) {
    throw new TypeError('Self-referential table rows must be an array')
  }
  if (childColumns.length !== parentColumns.length || childColumns.length === 0) {
    throw new Error('Self-reference columns must have matching non-empty arity')
  }

  const records = rows.map((row, index) => ({
    index,
    row,
    key: compositeKey(row, parentColumns, false),
    parentKey: compositeKey(row, childColumns, true),
  }))
  const byKey = new Map()
  for (const record of records) {
    if (byKey.has(record.key)) {
      throw new Error('Self-referential table contains duplicate referenced keys')
    }
    byKey.set(record.key, record)
  }

  const indegree = new Map(records.map(record => [record.key, 0]))
  const children = new Map(records.map(record => [record.key, []]))
  for (const record of records) {
    if (record.parentKey === null) {
      continue
    }
    if (!byKey.has(record.parentKey)) {
      throw new Error('Self-referential table contains an orphan parent pointer')
    }
    indegree.set(record.key, indegree.get(record.key) + 1)
    children.get(record.parentKey).push(record)
  }

  const ready = records
    .filter(record => indegree.get(record.key) === 0)
    .sort((left, right) => left.index - right.index)
  const ordered = []
  while (ready.length > 0) {
    const record = ready.shift()
    ordered.push(record.row)
    for (const child of children.get(record.key)) {
      indegree.set(child.key, indegree.get(child.key) - 1)
      if (indegree.get(child.key) === 0) {
        ready.push(child)
        ready.sort((left, right) => left.index - right.index)
      }
    }
  }
  if (ordered.length !== rows.length) {
    throw new Error('Self-referential table contains a cycle')
  }
  return ordered
}

export function assertImportSqlKeepsForeignKeysEnforced(sql) {
  if (/\bforeign_key_checks\b/i.test(String(sql))) {
    throw new Error('MIP import SQL must not change FOREIGN_KEY_CHECKS')
  }
  return true
}

function normalizeAppScopedTables(tableRows, columnsByTable) {
  if (!Array.isArray(tableRows)) {
    throw new TypeError('Table metadata must be an array')
  }
  const tables = [...new Set(tableRows
    .map(row => typeof row === 'string'
      ? row
      : metadataValue(row, ['tableName', 'table_name', 'TABLE_NAME']))
    .filter(table => table?.startsWith('mip_')))]
    .sort()
  if (tables.length === 0) {
    throw new Error('No MIP tables were found in the schema inventory')
  }
  const appScoped = tables.filter(table => columnsByTable.get(table)?.has(APP_ID_COLUMN))
  if (appScoped.length === 0) {
    throw new Error('No AppID-scoped MIP tables were found in the schema inventory')
  }
  return appScoped
}

function normalizeColumnRows(rows = []) {
  if (!Array.isArray(rows)) {
    throw new TypeError('Column metadata must be an array')
  }
  const result = new Map()
  for (const row of rows) {
    const table = metadataValue(row, ['tableName', 'table_name', 'TABLE_NAME'])
    if (!table?.startsWith('mip_')) {
      continue
    }
    assertMipTable(table)
    const column = metadataValue(row, ['columnName', 'column_name', 'COLUMN_NAME'])
    assertIdentifier(column, 'column')
    const nullable = String(metadataValue(row, [
      'isNullable',
      'is_nullable',
      'IS_NULLABLE',
    ]) ?? '').toUpperCase()
    const tableColumns = result.get(table) ?? new Map()
    tableColumns.set(column, Object.freeze({ nullable: nullable === 'YES' }))
    result.set(table, tableColumns)
  }
  return result
}

function normalizePrimaryKeyRows(rows, tableSet) {
  if (!Array.isArray(rows)) {
    throw new TypeError('Primary-key metadata must be an array')
  }
  const grouped = new Map([...tableSet].map(table => [table, []]))
  for (const row of rows) {
    const table = metadataValue(row, ['tableName', 'table_name', 'TABLE_NAME'])
    if (!tableSet.has(table)) {
      continue
    }
    const constraintName = metadataValue(row, [
      'constraintName',
      'constraint_name',
      'CONSTRAINT_NAME',
    ])
    const indexName = metadataValue(row, ['indexName', 'index_name', 'INDEX_NAME'])
    if (constraintName && constraintName !== 'PRIMARY') {
      continue
    }
    if (!constraintName && indexName && indexName !== 'PRIMARY') {
      continue
    }
    const column = metadataValue(row, ['columnName', 'column_name', 'COLUMN_NAME'])
    const ordinal = Number(metadataValue(row, [
      'ordinalPosition',
      'ordinal_position',
      'ORDINAL_POSITION',
      'seqInIndex',
      'seq_in_index',
      'SEQ_IN_INDEX',
    ]))
    assertIdentifier(column, 'primary-key column')
    if (!Number.isInteger(ordinal) || ordinal < 1) {
      throw new Error(`${table} has invalid primary-key metadata`)
    }
    grouped.get(table).push({ column, ordinal })
  }
  for (const [table, columns] of grouped) {
    columns.sort((left, right) => left.ordinal - right.ordinal)
    if (columns.length === 0
      || columns.some((column, index) => column.ordinal !== index + 1)) {
      throw new Error(`${table} has missing or incomplete primary-key metadata`)
    }
    grouped.set(table, Object.freeze(columns.map(column => column.column)))
  }
  return grouped
}

function buildSelfReferenceStrategy(foreignKey, primaryKeys) {
  if (!MIP_IMPORT_SELF_REFERENCE_TABLES.includes(foreignKey.childTable)) {
    throw new Error(`Unsupported self-referential MIP table ${foreignKey.childTable}`)
  }
  return deepFreeze({
    strategy: 'parent-row-first',
    table: foreignKey.childTable,
    constraintName: foreignKey.constraintName,
    primaryKey: primaryKeys.get(foreignKey.childTable),
    childColumns: foreignKey.columns.map(column => column.childColumn),
    parentColumns: foreignKey.columns.map(column => column.parentColumn),
    failureMode: 'REJECT_ORPHAN_OR_CYCLE',
  })
}

function findPointerRule(foreignKey) {
  return MIP_IMPORT_POINTER_RULES.find(rule => (
    rule.constraintName === foreignKey.constraintName
    && rule.table === foreignKey.childTable
    && rule.parentTable === foreignKey.parentTable
    && rule.deferredColumns.every(column => (
      foreignKey.columns.some(pair => pair.childColumn === column)
    ))
  ))
}

function assertDeferredColumnsAreNullable(rule, foreignKey, columnsByTable) {
  const columns = columnsByTable.get(rule.table)
  for (const column of rule.deferredColumns) {
    if (!foreignKey.columns.some(pair => pair.childColumn === column)) {
      throw new Error(`${foreignKey.constraintName} is missing deferred pointer ${column}`)
    }
    if (!columns?.get(column)?.nullable) {
      throw new Error(`${rule.table}.${column} must be nullable for staged import`)
    }
  }
}

function buildPointerRestore(rule, foreignKey, primaryKeys) {
  return deepFreeze({
    table: rule.table,
    parentTable: rule.parentTable,
    constraintName: foreignKey.constraintName,
    primaryKey: primaryKeys.get(rule.table),
    deferredColumns: [...rule.deferredColumns],
    capture: 'SOURCE_VALUE_BEFORE_INSERT',
    importValue: null,
    restore: 'UPDATE_BY_MAPPED_APP_ID_AND_PRIMARY_KEY_AFTER_PARENT_IMPORT',
  })
}

function orderPointerRestores(pointerRestores, importOrder) {
  const positions = new Map(importOrder.map((table, index) => [table, index]))
  return [...pointerRestores].sort((left, right) => (
    positions.get(left.parentTable) - positions.get(right.parentTable)
    || left.table.localeCompare(right.table)
  ))
}

function topologicallyOrderTables(tables, foreignKeys) {
  const dependencies = new Map(tables.map(table => [table, new Set()]))
  const children = new Map(tables.map(table => [table, new Set()]))
  for (const foreignKey of foreignKeys) {
    dependencies.get(foreignKey.childTable).add(foreignKey.parentTable)
    children.get(foreignKey.parentTable).add(foreignKey.childTable)
  }

  const ready = tables.filter(table => dependencies.get(table).size === 0).sort()
  const ordered = []
  while (ready.length > 0) {
    const table = ready.shift()
    ordered.push(table)
    for (const child of [...children.get(table)].sort()) {
      dependencies.get(child).delete(table)
      if (dependencies.get(child).size === 0 && !ordered.includes(child) && !ready.includes(child)) {
        ready.push(child)
        ready.sort()
      }
    }
  }

  if (ordered.length !== tables.length) {
    const unresolved = tables.filter(table => !ordered.includes(table)).sort()
    throw new Error(`Unresolved MIP foreign-key cycle: ${unresolved.join(', ')}`)
  }
  return ordered
}

function buildOrphanCheck(foreignKey) {
  const child = 'child_row'
  const parent = 'parent_row'
  const join = foreignKey.columns
    .map(column => `${quoted(parent)}.${quoted(column.parentColumn)} = ${quoted(child)}.${quoted(column.childColumn)}`)
    .join(' AND ')
  const optionalColumns = foreignKey.columns
    .map(column => column.childColumn)
    .filter(column => column !== APP_ID_COLUMN)
  const populated = optionalColumns.length === 0
    ? '1 = 1'
    : optionalColumns.map(column => `${quoted(child)}.${quoted(column)} IS NOT NULL`).join(' AND ')
  const parentMarker = foreignKey.columns[0].parentColumn
  return {
    constraintName: foreignKey.constraintName,
    childTable: foreignKey.childTable,
    parentTable: foreignKey.parentTable,
    target: {
      sql: `SELECT COUNT(*) AS orphan_count FROM ${quoted(foreignKey.childTable)} ${quoted(child)} LEFT JOIN ${quoted(foreignKey.parentTable)} ${quoted(parent)} ON ${join} WHERE ${quoted(child)}.${quoted(APP_ID_COLUMN)} = ? AND ${populated} AND ${quoted(parent)}.${quoted(parentMarker)} IS NULL`,
      bind: 'TARGET_APP_ID',
    },
    expected: 0,
  }
}

function selectForAppScope(table, expressions, orderBy = [], bind = 'APP_ID_FOR_SIDE') {
  return {
    sql: `SELECT ${expressions.map(expression => expression.includes(' ')
      ? expression
      : quoted(expression)).join(', ')} FROM ${quoted(table)} WHERE ${quoted(APP_ID_COLUMN)} = ?${orderBy.length > 0
      ? ` ORDER BY ${orderBy.map(quoted).join(', ')}`
      : ''}`,
    bind,
  }
}

function assertForeignKeysStayInsideImport(foreignKeys, tableSet) {
  for (const foreignKey of foreignKeys) {
    if (!tableSet.has(foreignKey.parentTable)) {
      throw new Error(
        `${foreignKey.constraintName} leaves the AppID-scoped MIP import set`,
      )
    }
  }
}

function normalizeCountEvidence(value) {
  if (value instanceof Map) {
    return new Map([...value].map(([table, count]) => [table, exactNonNegativeInteger(count, `${table} target row count`)]))
  }
  if (Array.isArray(value)) {
    return new Map(value.map((row) => {
      const table = metadataValue(row, [
        'table',
        'tableName',
        'table_name',
        'TABLE_NAME',
      ])
      const count = metadataValue(row, ['count', 'rowCount', 'row_count'])
      return [table, exactNonNegativeInteger(count, `${table} target row count`)]
    }))
  }
  if (value && typeof value === 'object') {
    return new Map(Object.entries(value).map(([table, count]) => (
      [table, exactNonNegativeInteger(count, `${table} target row count`)]
    )))
  }
  throw new TypeError('Target row-count evidence must be complete')
}

function normalizeEvidenceMap(value, label) {
  if (!value || typeof value !== 'object') {
    throw new Error(`Import validation is missing ${label} evidence`)
  }
  return value instanceof Map ? value : new Map(Object.entries(value))
}

function exactNonNegativeInteger(value, label) {
  const normalized = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value
  if (!Number.isSafeInteger(normalized) || normalized < 0) {
    throw new Error(`${label} must be an exact non-negative integer`)
  }
  return normalized
}

function compositeKey(row, columns, nullable) {
  const values = columns.map(column => row[column])
  if (nullable && values.some(value => value === null || value === undefined)) {
    return null
  }
  if (values.some(value => value === null || value === undefined)) {
    throw new Error('Self-referential row is missing a referenced-key value')
  }
  return JSON.stringify(values.map(String))
}

function metadataValue(row, names) {
  if (!row || typeof row !== 'object') {
    return undefined
  }
  for (const name of names) {
    if (Object.hasOwn(row, name)) {
      return row[name]
    }
  }
  return undefined
}

function assertMipTable(table) {
  assertIdentifier(table, 'table')
  if (!table.startsWith('mip_')) {
    throw new Error(`Import relation ${table} is outside the MIP namespace`)
  }
}

function assertIdentifier(identifier, label) {
  if (typeof identifier !== 'string' || !IDENTIFIER_PATTERN.test(identifier)) {
    throw new Error(`Invalid ${label} identifier`)
  }
}

function quoted(identifier) {
  assertIdentifier(identifier, 'SQL')
  return `\`${identifier}\``
}

function compareForeignKeys(left, right) {
  return left.childTable.localeCompare(right.childTable)
    || left.constraintName.localeCompare(right.constraintName)
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const nested of Object.values(value)) {
      deepFreeze(nested)
    }
  }
  return value
}
