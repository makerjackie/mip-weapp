'use strict'

const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { describe, it, before } = require('node:test')

const schemaUrl = pathToFileURL(
  path.join(__dirname, '..', '..', '..', 'scripts', 'lib', 'export-integrity-schema.mjs'),
).href

/** @type {any} */
let catalog

function columnRow(spec) {
  let columnType = spec.dataType || 'varchar'
  if (spec.dataType === 'datetime' && Object.hasOwn(spec, 'datetimePrecision')) {
    columnType = `datetime(${spec.datetimePrecision})`
  }
  if (spec.unsigned) {
    columnType = `${columnType} unsigned`
  }
  let extra = ''
  if (Array.isArray(spec.extraIncludes)) {
    extra = spec.extraIncludes.join(' ')
  }
  return {
    name: spec.name,
    dataType: spec.dataType,
    characterMaximumLength: spec.characterMaximumLength ?? null,
    isNullable: spec.isNullable,
    columnDefault: Object.hasOwn(spec, 'columnDefault') ? spec.columnDefault : null,
    columnType,
    extra,
    datetimePrecision: Object.hasOwn(spec, 'datetimePrecision') ? spec.datetimePrecision : null,
  }
}

function indexRows(index) {
  return index.columns.map((columnName, offset) => ({
    name: index.name,
    nonUnique: index.unique ? 0 : 1,
    columnName,
    seq: offset + 1,
    collation: (index.collations && index.collations[offset]) || 'A',
  }))
}

function fkRows(fk) {
  return fk.columns.map((columnName, offset) => ({
    columnName,
    seq: offset + 1,
    referencedTable: fk.referencedTable,
    referencedColumn: fk.referencedColumns[offset],
    deleteRule: fk.deleteRule,
  }))
}

/**
 * Fake MySQL connection that backs inspect/ensure without a live server.
 * Mutates state from ensure SQL so re-runs are idempotent.
 */
function createFakeConnection(seed = {}) {
  const presentIndexes = new Map(seed.indexes || [])
  const presentFks = new Map(seed.fks || [])
  const presentTables = new Set(seed.tables || [])
  const presentColumns = new Map(seed.columns || [])
  const presentChecks = new Map(seed.checks || [])
  const oldFks = new Set(seed.oldFks || [])
  const applied = []
  let failAfter = seed.failAfter ?? null
  let runCount = 0

  const fkByName = new Map(catalog.EXPORT_INTEGRITY_FOREIGN_KEYS.map(fk => [fk.name, fk]))
  const uniqueByName = new Map(
    catalog.EXPORT_INTEGRITY_UNIQUE_KEYS.map(index => [index.name, index]),
  )
  const tableIndexByName = new Map(
    catalog.EXPORT_INTEGRITY_INDEXES.map(index => [index.name, index]),
  )

  function materializeTable(table) {
    presentTables.add(table)
    const cols = new Map()
    for (const column of catalog.EXPORT_INTEGRITY_TABLE_COLUMNS[table]) {
      cols.set(column.name, columnRow(column))
    }
    presentColumns.set(table, cols)
    for (const index of catalog.EXPORT_INTEGRITY_INDEXES) {
      if (index.table === table) {
        presentIndexes.set(`${index.table}.${index.name}`, indexRows(index))
      }
    }
    // PRIMARY KEY rows for exact PK order checks.
    const meta = catalog.EXPORT_INTEGRITY_TABLE_META[table]
    if (meta?.primaryKey) {
      presentIndexes.set(`${table}.PRIMARY`, meta.primaryKey.map((columnName, offset) => ({
        name: 'PRIMARY',
        nonUnique: 0,
        columnName,
        seq: offset + 1,
        collation: 'A',
      })))
    }
    for (const name of catalog.EXPORT_INTEGRITY_CHECKS) {
      if (name.startsWith(table)) {
        presentChecks.set(name, catalog.EXPORT_INTEGRITY_CHECK_CLAUSES[name])
      }
    }
    for (const fk of catalog.EXPORT_INTEGRITY_FOREIGN_KEYS) {
      if (fk.table === table) {
        presentFks.set(`${fk.table}.${fk.name}`, fkRows(fk))
      }
    }
  }

  return {
    applied,
    presentIndexes,
    presentFks,
    presentTables,
    presentColumns,
    presentChecks,
    oldFks,
    setFailAfter(n) {
      failAfter = n
      runCount = 0
    },
    async execute(sql, params = []) {
      if (sql.includes('information_schema.statistics')) {
        const table = params[0]
        const name = params[1]
        // PRIMARY key query uses index_name = 'PRIMARY'
        if (String(name) === 'PRIMARY' || sql.includes("index_name = 'PRIMARY'")) {
          return [presentIndexes.get(`${table}.PRIMARY`) || []]
        }
        const key = `${table}.${name}`
        return [presentIndexes.get(key) || []]
      }
      if (sql.includes('key_column_usage') && sql.includes('FOREIGN KEY')) {
        const table = params[0]
        const name = params[1]
        return [presentFks.get(`${table}.${name}`) || []]
      }
      if (sql.includes('constraint_type = \'FOREIGN KEY\'') && sql.includes('LIMIT 1')) {
        const table = params[0]
        const name = params[1]
        if (presentFks.has(`${table}.${name}`) || oldFks.has(`${table}.${name}`)) {
          return [[{ name }]]
        }
        return [[]]
      }
      if (sql.includes('information_schema.tables')) {
        const table = params[0]
        if (!presentTables.has(table)) {
          return [[]]
        }
        return [[{
          name: table,
          engine: 'InnoDB',
          tableCollation: 'utf8mb4_0900_ai_ci',
        }]]
      }
      if (sql.includes('information_schema.columns')) {
        const table = params[0]
        return [[...(presentColumns.get(table)?.values() || [])]]
      }
      if (sql.includes('check_constraints') || sql.includes('constraint_type = \'CHECK\'')) {
        return [[...presentChecks.entries()].map(([name, checkClause]) => ({ name, checkClause }))]
      }
      return [[]]
    },
    async query(sql) {
      // SHOW CREATE TABLE is a read path used by inspect — do not count as ensure apply.
      if (/SHOW CREATE TABLE/i.test(sql)) {
        const match = sql.match(/SHOW CREATE TABLE `?(\w+)`?/i)
        const table = match?.[1]
        if (!table || !presentTables.has(table)) {
          return [[]]
        }
        const meta = catalog.EXPORT_INTEGRITY_TABLE_META[table]
        const pk = meta?.primaryKey?.map(col => `\`${col}\``).join(', ') || '`id`'
        const create = `CREATE TABLE \`${table}\` (\n  PRIMARY KEY (${pk})\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`
        return [[{ 'Create Table': create, Table: table }]]
      }

      runCount += 1
      if (failAfter !== null && runCount > failAfter) {
        // Do not record failed statements as applied — mirrors ensure only counting success.
        throw new Error(`simulated ensure fault after ${failAfter} statements`)
      }
      applied.push(sql)

      if (sql.includes('CREATE TABLE IF NOT EXISTS member_export_tickets')) {
        materializeTable('member_export_tickets')
        return [{ affectedRows: 0 }]
      }
      if (sql.includes('CREATE TABLE IF NOT EXISTS member_mutation_idempotency')) {
        materializeTable('member_mutation_idempotency')
        return [{ affectedRows: 0 }]
      }

      const dropMatch = sql.match(/DROP FOREIGN KEY (\w+)/)
      if (dropMatch) {
        const name = dropMatch[1]
        for (const key of [...oldFks]) {
          if (key.endsWith(`.${name}`)) {
            oldFks.delete(key)
          }
        }
        return [{ affectedRows: 1 }]
      }

      const addFk = sql.match(/ADD CONSTRAINT (\w+) FOREIGN KEY/)
      if (addFk) {
        const fk = fkByName.get(addFk[1])
        if (fk) {
          presentFks.set(`${fk.table}.${fk.name}`, fkRows(fk))
        }
        return [{ affectedRows: 1 }]
      }

      const addCheck = sql.match(/ADD CONSTRAINT (\w+) CHECK/)
      if (addCheck) {
        const name = addCheck[1]
        if (catalog.EXPORT_INTEGRITY_CHECK_CLAUSES[name]) {
          presentChecks.set(name, catalog.EXPORT_INTEGRITY_CHECK_CLAUSES[name])
        }
        return [{ affectedRows: 1 }]
      }

      const uniqueMatch = sql.match(/ADD UNIQUE KEY (\w+)/)
      if (uniqueMatch) {
        const index = uniqueByName.get(uniqueMatch[1]) || tableIndexByName.get(uniqueMatch[1])
        if (index) {
          presentIndexes.set(`${index.table}.${index.name}`, indexRows(index))
        }
        return [{ affectedRows: 1 }]
      }

      const keyMatch = sql.match(/ADD KEY (\w+)/)
      if (keyMatch) {
        const index = tableIndexByName.get(keyMatch[1])
        if (index) {
          presentIndexes.set(`${index.table}.${index.name}`, indexRows(index))
        }
        return [{ affectedRows: 1 }]
      }

      return [{ affectedRows: 1 }]
    },
  }
}

describe('003 export integrity object contract', () => {
  before(async () => {
    catalog = await import(schemaUrl)
  })

  it('exposes a stable expected object key count and version/name from lock', () => {
    const {
      EXPORT_INTEGRITY_NAME,
      EXPORT_INTEGRITY_VERSION,
      EXPORT_INTEGRITY_UNIQUE_KEYS,
      EXPORT_INTEGRITY_FOREIGN_KEYS,
      EXPORT_INTEGRITY_TABLES,
      EXPORT_INTEGRITY_INDEXES,
      EXPORT_INTEGRITY_CHECKS,
      EXPORT_INTEGRITY_TABLE_COLUMNS,
      expectedObjectKeys,
    } = catalog

    assert.equal(EXPORT_INTEGRITY_NAME, 'export_integrity')
    assert.equal(EXPORT_INTEGRITY_VERSION, '20260723230000')

    const keys = expectedObjectKeys()
    const expectedCount = EXPORT_INTEGRITY_UNIQUE_KEYS.length
      + EXPORT_INTEGRITY_FOREIGN_KEYS.length
      + EXPORT_INTEGRITY_TABLES.length
      + Object.values(EXPORT_INTEGRITY_TABLE_COLUMNS).reduce((n, cols) => n + cols.length, 0)
      + EXPORT_INTEGRITY_INDEXES.length
      + EXPORT_INTEGRITY_CHECKS.length

    assert.equal(keys.length, expectedCount)
    assert.equal(keys.length, 51)
    assert.ok(keys.includes('index:member_events.member_events_app_id_uk'))
    assert.ok(keys.includes('fk:member_profiles.member_profiles_avatar_app_fk'))
    assert.ok(keys.includes('table:member_export_tickets'))
    assert.ok(keys.includes('column:member_export_tickets.token_hash'))
    assert.ok(keys.includes('check:member_mutation_idempotency_scope_ck'))
  })

  it('recovers partial 003 objects (uniques present, tables missing) and is idempotent', async () => {
    const {
      EXPORT_INTEGRITY_UNIQUE_KEYS,
      EXPORT_INTEGRITY_FOREIGN_KEYS,
      ensureExportIntegrity,
      inspectExportIntegrity,
    } = catalog

    const indexes = new Map()
    for (const index of EXPORT_INTEGRITY_UNIQUE_KEYS) {
      indexes.set(`${index.table}.${index.name}`, indexRows(index))
    }
    const oldFks = new Set(
      EXPORT_INTEGRITY_FOREIGN_KEYS
        .filter(fk => fk.oldName)
        .map(fk => `${fk.table}.${fk.oldName}`),
    )

    const connection = createFakeConnection({ indexes, oldFks })
    const before = await inspectExportIntegrity(connection)
    assert.equal(before.partial, true)
    assert.ok(before.presentCount >= 4)
    assert.ok(before.missing.includes('table:member_export_tickets'))
    assert.ok(before.missing.some(key => key.startsWith('fk:')))

    const recovery = await ensureExportIntegrity(connection)
    assert.equal(recovery.action, 'recovered')
    assert.equal(recovery.state.complete, true)
    assert.ok(recovery.applied.length > 0)
    // Uniques already present must not be re-added.
    assert.ok(!recovery.applied.some(key => key.includes('member_events_app_id_uk')))

    const second = await ensureExportIntegrity(connection)
    assert.equal(second.action, 'noop')
    assert.equal(second.state.complete, true)
  })

  it('fails closed on incompatible unique index columns', async () => {
    const { EXPORT_INTEGRITY_UNIQUE_KEYS, ensureExportIntegrity } = catalog

    const indexes = new Map()
    for (const index of EXPORT_INTEGRITY_UNIQUE_KEYS) {
      if (index.name === 'member_events_app_id_uk') {
        indexes.set(`${index.table}.${index.name}`, [
          { name: index.name, nonUnique: 0, columnName: 'id', seq: 1 },
          { name: index.name, nonUnique: 0, columnName: 'app_id', seq: 2 },
        ])
      }
      else {
        indexes.set(`${index.table}.${index.name}`, indexRows(index))
      }
    }

    const connection = createFakeConnection({ indexes })
    await assert.rejects(
      () => ensureExportIntegrity(connection),
      /incompatible definitions/,
    )
  })

  it('statement-level fault mid-ensure recovers on re-run without migration row until complete', async () => {
    const {
      EXPORT_INTEGRITY_UNIQUE_KEYS,
      ensureExportIntegrity,
      inspectExportIntegrity,
      EXPORT_INTEGRITY_VERSION,
      EXPORT_INTEGRITY_NAME,
    } = catalog

    const connection = createFakeConnection({ failAfter: 2 })
    const migrationRows = []

    async function applyWithMigrationGate() {
      try {
        const result = await ensureExportIntegrity(connection)
        if (result.state.complete) {
          migrationRows.push({
            version: EXPORT_INTEGRITY_VERSION,
            name: EXPORT_INTEGRITY_NAME,
          })
        }
        return result
      }
      catch (error) {
        assert.equal(migrationRows.length, 0)
        throw error
      }
    }

    await assert.rejects(() => applyWithMigrationGate(), /simulated ensure fault/)
    assert.equal(migrationRows.length, 0)

    const mid = await inspectExportIntegrity(connection)
    assert.equal(mid.complete, false)
    assert.ok(mid.presentCount > 0)

    connection.setFailAfter(null)
    const recovered = await applyWithMigrationGate()
    assert.equal(recovered.action, 'recovered')
    assert.equal(recovered.state.complete, true)
    assert.equal(migrationRows.length, 1)
    assert.equal(migrationRows[0].version, '20260723230000')
    assert.equal(migrationRows[0].name, 'export_integrity')

    const again = await ensureExportIntegrity(connection)
    assert.equal(again.action, 'noop')
    assert.equal(migrationRows.length, 1)

    for (const index of EXPORT_INTEGRITY_UNIQUE_KEYS) {
      const count = connection.applied.filter(
        sql => sql.includes(index.name) && sql.includes('ADD UNIQUE'),
      ).length
      assert.ok(count <= 1, `${index.name} applied ${count} times`)
    }
  })

  it('FK recovery drops old single-column FK when composite is missing', async () => {
    const {
      EXPORT_INTEGRITY_UNIQUE_KEYS,
      EXPORT_INTEGRITY_FOREIGN_KEYS,
      EXPORT_INTEGRITY_TABLE_COLUMNS,
      EXPORT_INTEGRITY_INDEXES,
      EXPORT_INTEGRITY_CHECKS,
      EXPORT_INTEGRITY_CHECK_CLAUSES,
      EXPORT_INTEGRITY_TABLE_META,
      ensureExportIntegrity,
    } = catalog

    const indexes = new Map()
    for (const index of EXPORT_INTEGRITY_UNIQUE_KEYS) {
      indexes.set(`${index.table}.${index.name}`, indexRows(index))
    }
    for (const index of EXPORT_INTEGRITY_INDEXES) {
      indexes.set(`${index.table}.${index.name}`, indexRows(index))
    }
    for (const [table, meta] of Object.entries(EXPORT_INTEGRITY_TABLE_META)) {
      indexes.set(`${table}.PRIMARY`, meta.primaryKey.map((columnName, offset) => ({
        name: 'PRIMARY',
        nonUnique: 0,
        columnName,
        seq: offset + 1,
        collation: 'A',
      })))
    }

    const tables = new Set(['member_export_tickets', 'member_mutation_idempotency'])
    const columns = new Map()
    for (const table of tables) {
      const map = new Map()
      for (const column of EXPORT_INTEGRITY_TABLE_COLUMNS[table]) {
        map.set(column.name, columnRow(column))
      }
      columns.set(table, map)
    }
    const checks = new Map(
      EXPORT_INTEGRITY_CHECKS.map(name => [name, EXPORT_INTEGRITY_CHECK_CLAUSES[name]]),
    )
    const fks = new Map()
    const exportFk = EXPORT_INTEGRITY_FOREIGN_KEYS.find(
      fk => fk.name === 'member_export_tickets_event_app_fk',
    )
    fks.set(`${exportFk.table}.${exportFk.name}`, fkRows(exportFk))

    const oldFks = new Set(
      EXPORT_INTEGRITY_FOREIGN_KEYS
        .filter(fk => fk.oldName)
        .map(fk => `${fk.table}.${fk.oldName}`),
    )

    const connection = createFakeConnection({ indexes, tables, columns, checks, fks, oldFks })
    const recovery = await ensureExportIntegrity(connection)
    assert.equal(recovery.action, 'recovered')
    assert.equal(recovery.state.complete, true)
    assert.ok(
      connection.applied.some(sql => sql.includes('DROP FOREIGN KEY member_profiles_avatar_fk')),
    )
    assert.ok(connection.applied.some(sql => sql.includes('member_profiles_avatar_app_fk')))
    assert.equal(connection.oldFks.size, 0)
  })

  it('fails closed on wrong index DESC collation', async () => {
    const {
      EXPORT_INTEGRITY_UNIQUE_KEYS,
      EXPORT_INTEGRITY_INDEXES,
      EXPORT_INTEGRITY_FOREIGN_KEYS,
      EXPORT_INTEGRITY_TABLE_COLUMNS,
      EXPORT_INTEGRITY_CHECKS,
      EXPORT_INTEGRITY_CHECK_CLAUSES,
      EXPORT_INTEGRITY_TABLE_META,
      ensureExportIntegrity,
    } = catalog

    const indexes = new Map()
    for (const index of EXPORT_INTEGRITY_UNIQUE_KEYS) {
      indexes.set(`${index.table}.${index.name}`, indexRows(index))
    }
    for (const index of EXPORT_INTEGRITY_INDEXES) {
      const rows = indexRows(index)
      if (index.name === 'member_export_tickets_event_idx') {
        // Force ASC on created_at instead of DESC.
        rows[2].collation = 'A'
      }
      indexes.set(`${index.table}.${index.name}`, rows)
    }
    for (const [table, meta] of Object.entries(EXPORT_INTEGRITY_TABLE_META)) {
      indexes.set(`${table}.PRIMARY`, meta.primaryKey.map((columnName, offset) => ({
        name: 'PRIMARY',
        nonUnique: 0,
        columnName,
        seq: offset + 1,
        collation: 'A',
      })))
    }
    const tables = new Set(['member_export_tickets', 'member_mutation_idempotency'])
    const columns = new Map()
    for (const table of tables) {
      const map = new Map()
      for (const column of EXPORT_INTEGRITY_TABLE_COLUMNS[table]) {
        map.set(column.name, columnRow(column))
      }
      columns.set(table, map)
    }
    const checks = new Map(
      EXPORT_INTEGRITY_CHECKS.map(name => [name, EXPORT_INTEGRITY_CHECK_CLAUSES[name]]),
    )
    const fks = new Map(
      EXPORT_INTEGRITY_FOREIGN_KEYS.map(fk => [`${fk.table}.${fk.name}`, fkRows(fk)]),
    )
    const connection = createFakeConnection({ indexes, tables, columns, checks, fks })
    await assert.rejects(
      () => ensureExportIntegrity(connection),
      /incompatible definitions|collations=/,
    )
  })

  it('fails closed on missing unsigned and old FK still present with composite', async () => {
    const {
      EXPORT_INTEGRITY_UNIQUE_KEYS,
      EXPORT_INTEGRITY_INDEXES,
      EXPORT_INTEGRITY_FOREIGN_KEYS,
      EXPORT_INTEGRITY_TABLE_COLUMNS,
      EXPORT_INTEGRITY_CHECKS,
      EXPORT_INTEGRITY_CHECK_CLAUSES,
      EXPORT_INTEGRITY_TABLE_META,
      ensureExportIntegrity,
    } = catalog

    const indexes = new Map()
    for (const index of [...EXPORT_INTEGRITY_UNIQUE_KEYS, ...EXPORT_INTEGRITY_INDEXES]) {
      indexes.set(`${index.table}.${index.name}`, indexRows(index))
    }
    for (const [table, meta] of Object.entries(EXPORT_INTEGRITY_TABLE_META)) {
      indexes.set(`${table}.PRIMARY`, meta.primaryKey.map((columnName, offset) => ({
        name: 'PRIMARY',
        nonUnique: 0,
        columnName,
        seq: offset + 1,
        collation: 'A',
      })))
    }
    const tables = new Set(['member_export_tickets', 'member_mutation_idempotency'])
    const columns = new Map()
    for (const table of tables) {
      const map = new Map()
      for (const column of EXPORT_INTEGRITY_TABLE_COLUMNS[table]) {
        const row = columnRow(column)
        if (column.name === 'content_bytes') {
          row.columnType = 'int' // missing unsigned
        }
        map.set(column.name, row)
      }
      columns.set(table, map)
    }
    const checks = new Map(
      EXPORT_INTEGRITY_CHECKS.map(name => [name, EXPORT_INTEGRITY_CHECK_CLAUSES[name]]),
    )
    const fks = new Map(
      EXPORT_INTEGRITY_FOREIGN_KEYS.map(fk => [`${fk.table}.${fk.name}`, fkRows(fk)]),
    )
    const oldFks = new Set(['member_profiles.member_profiles_avatar_fk'])
    const connection = createFakeConnection({ indexes, tables, columns, checks, fks, oldFks })
    await assert.rejects(
      () => ensureExportIntegrity(connection),
      /incompatible definitions/,
    )
  })

  it('never returns complete via noop when objects are still missing', async () => {
    const { ensureExportIntegrity, inspectExportIntegrity } = catalog
    const connection = createFakeConnection({})
    const before = await inspectExportIntegrity(connection)
    assert.equal(before.complete, false)
    // ensure must recover or throw — never claim noop complete on empty.
    const recovery = await ensureExportIntegrity(connection)
    assert.notEqual(recovery.action, 'noop')
    assert.equal(recovery.state.complete, true)
  })

  it('fails closed on datetime without (3) / datetime_precision=0', async () => {
    const {
      EXPORT_INTEGRITY_UNIQUE_KEYS,
      EXPORT_INTEGRITY_INDEXES,
      EXPORT_INTEGRITY_FOREIGN_KEYS,
      EXPORT_INTEGRITY_TABLE_COLUMNS,
      EXPORT_INTEGRITY_CHECKS,
      EXPORT_INTEGRITY_CHECK_CLAUSES,
      EXPORT_INTEGRITY_TABLE_META,
      ensureExportIntegrity,
    } = catalog

    const indexes = new Map()
    for (const index of [...EXPORT_INTEGRITY_UNIQUE_KEYS, ...EXPORT_INTEGRITY_INDEXES]) {
      indexes.set(`${index.table}.${index.name}`, indexRows(index))
    }
    for (const [table, meta] of Object.entries(EXPORT_INTEGRITY_TABLE_META)) {
      indexes.set(`${table}.PRIMARY`, meta.primaryKey.map((columnName, offset) => ({
        name: 'PRIMARY',
        nonUnique: 0,
        columnName,
        seq: offset + 1,
        collation: 'A',
      })))
    }
    const tables = new Set(['member_export_tickets', 'member_mutation_idempotency'])
    const columns = new Map()
    for (const table of tables) {
      const map = new Map()
      for (const column of EXPORT_INTEGRITY_TABLE_COLUMNS[table]) {
        const row = columnRow(column)
        if (column.name === 'expires_at') {
          // Wrong: bare datetime without fractional seconds.
          row.columnType = 'datetime'
          row.datetimePrecision = 0
        }
        map.set(column.name, row)
      }
      columns.set(table, map)
    }
    const checks = new Map(
      EXPORT_INTEGRITY_CHECKS.map(name => [name, EXPORT_INTEGRITY_CHECK_CLAUSES[name]]),
    )
    const fks = new Map(
      EXPORT_INTEGRITY_FOREIGN_KEYS.map(fk => [`${fk.table}.${fk.name}`, fkRows(fk)]),
    )
    const connection = createFakeConnection({ indexes, tables, columns, checks, fks })
    await assert.rejects(
      () => ensureExportIntegrity(connection),
      /incompatible definitions|datetime_precision=/,
    )
  })

  it('fails closed on wrong default for status/version or created_at', async () => {
    const {
      EXPORT_INTEGRITY_UNIQUE_KEYS,
      EXPORT_INTEGRITY_INDEXES,
      EXPORT_INTEGRITY_FOREIGN_KEYS,
      EXPORT_INTEGRITY_TABLE_COLUMNS,
      EXPORT_INTEGRITY_CHECKS,
      EXPORT_INTEGRITY_CHECK_CLAUSES,
      EXPORT_INTEGRITY_TABLE_META,
      ensureExportIntegrity,
    } = catalog

    const indexes = new Map()
    for (const index of [...EXPORT_INTEGRITY_UNIQUE_KEYS, ...EXPORT_INTEGRITY_INDEXES]) {
      indexes.set(`${index.table}.${index.name}`, indexRows(index))
    }
    for (const [table, meta] of Object.entries(EXPORT_INTEGRITY_TABLE_META)) {
      indexes.set(`${table}.PRIMARY`, meta.primaryKey.map((columnName, offset) => ({
        name: 'PRIMARY',
        nonUnique: 0,
        columnName,
        seq: offset + 1,
        collation: 'A',
      })))
    }
    const tables = new Set(['member_export_tickets', 'member_mutation_idempotency'])
    const columns = new Map()
    for (const table of tables) {
      const map = new Map()
      for (const column of EXPORT_INTEGRITY_TABLE_COLUMNS[table]) {
        const row = columnRow(column)
        if (column.name === 'status') {
          row.columnDefault = 'PENDING' // wrong default
        }
        if (column.name === 'created_at') {
          // bare CURRENT_TIMESTAMP without (3) must fail closed
          row.columnDefault = 'CURRENT_TIMESTAMP'
        }
        if (column.name === 'updated_at') {
          // missing (3) on update clause
          row.extra = 'DEFAULT_GENERATED on update CURRENT_TIMESTAMP'
        }
        map.set(column.name, row)
      }
      columns.set(table, map)
    }
    const checks = new Map(
      EXPORT_INTEGRITY_CHECKS.map(name => [name, EXPORT_INTEGRITY_CHECK_CLAUSES[name]]),
    )
    const fks = new Map(
      EXPORT_INTEGRITY_FOREIGN_KEYS.map(fk => [`${fk.table}.${fk.name}`, fkRows(fk)]),
    )
    const connection = createFakeConnection({ indexes, tables, columns, checks, fks })
    await assert.rejects(
      () => ensureExportIntegrity(connection),
      /incompatible definitions|default=|extra_missing=/,
    )
  })

  it('fails closed when PRIMARY KEY is missing', async () => {
    const {
      EXPORT_INTEGRITY_UNIQUE_KEYS,
      EXPORT_INTEGRITY_INDEXES,
      EXPORT_INTEGRITY_FOREIGN_KEYS,
      EXPORT_INTEGRITY_TABLE_COLUMNS,
      EXPORT_INTEGRITY_CHECKS,
      EXPORT_INTEGRITY_CHECK_CLAUSES,
      ensureExportIntegrity,
    } = catalog

    const indexes = new Map()
    for (const index of [...EXPORT_INTEGRITY_UNIQUE_KEYS, ...EXPORT_INTEGRITY_INDEXES]) {
      indexes.set(`${index.table}.${index.name}`, indexRows(index))
    }
    // Intentionally omit PRIMARY key statistics for both tables.
    const tables = new Set(['member_export_tickets', 'member_mutation_idempotency'])
    const columns = new Map()
    for (const table of tables) {
      const map = new Map()
      for (const column of EXPORT_INTEGRITY_TABLE_COLUMNS[table]) {
        map.set(column.name, columnRow(column))
      }
      columns.set(table, map)
    }
    const checks = new Map(
      EXPORT_INTEGRITY_CHECKS.map(name => [name, EXPORT_INTEGRITY_CHECK_CLAUSES[name]]),
    )
    const fks = new Map(
      EXPORT_INTEGRITY_FOREIGN_KEYS.map(fk => [`${fk.table}.${fk.name}`, fkRows(fk)]),
    )
    const connection = createFakeConnection({ indexes, tables, columns, checks, fks })
    await assert.rejects(
      () => ensureExportIntegrity(connection),
      /incompatible definitions|primary_key=missing/,
    )
  })

  it('buildEnsureStatementPlan emits created_at DESC for event_idx and resource_idx', () => {
    const { buildEnsureStatementPlan, EXPORT_INTEGRITY_ENSURE_STATEMENTS } = catalog
    const plan = buildEnsureStatementPlan()

    const eventIdx = plan.find(step => step.key === 'index:member_export_tickets.member_export_tickets_event_idx')
    assert.ok(eventIdx, 'event_idx plan step')
    assert.match(eventIdx.sql, /ADD KEY member_export_tickets_event_idx \(app_id, event_id, created_at DESC\)/)

    const resourceIdx = plan.find(
      step => step.key === 'index:member_mutation_idempotency.member_mutation_idempotency_resource_idx',
    )
    assert.ok(resourceIdx, 'resource_idx plan step')
    assert.match(
      resourceIdx.sql,
      /ADD KEY member_mutation_idempotency_resource_idx \(app_id, resource_type, resource_id, created_at DESC\)/,
    )

    // Static ensure fragment catalog must also retain DESC.
    assert.ok(EXPORT_INTEGRITY_ENSURE_STATEMENTS.some(
      sql => sql.includes('member_export_tickets_event_idx') && sql.includes('created_at DESC'),
    ))
    assert.ok(EXPORT_INTEGRITY_ENSURE_STATEMENTS.some(
      sql => sql.includes('member_mutation_idempotency_resource_idx') && sql.includes('created_at DESC'),
    ))
  })

  it('fails closed when table is present but a required column is missing (not noop complete)', async () => {
    const {
      EXPORT_INTEGRITY_UNIQUE_KEYS,
      EXPORT_INTEGRITY_INDEXES,
      EXPORT_INTEGRITY_FOREIGN_KEYS,
      EXPORT_INTEGRITY_TABLE_COLUMNS,
      EXPORT_INTEGRITY_CHECKS,
      EXPORT_INTEGRITY_CHECK_CLAUSES,
      EXPORT_INTEGRITY_TABLE_META,
      ensureExportIntegrity,
      inspectExportIntegrity,
    } = catalog

    const indexes = new Map()
    for (const index of [...EXPORT_INTEGRITY_UNIQUE_KEYS, ...EXPORT_INTEGRITY_INDEXES]) {
      indexes.set(`${index.table}.${index.name}`, indexRows(index))
    }
    for (const [table, meta] of Object.entries(EXPORT_INTEGRITY_TABLE_META)) {
      indexes.set(`${table}.PRIMARY`, meta.primaryKey.map((columnName, offset) => ({
        name: 'PRIMARY',
        nonUnique: 0,
        columnName,
        seq: offset + 1,
        collation: 'A',
      })))
    }
    const tables = new Set(['member_export_tickets', 'member_mutation_idempotency'])
    const columns = new Map()
    for (const table of tables) {
      const map = new Map()
      for (const column of EXPORT_INTEGRITY_TABLE_COLUMNS[table]) {
        // Drop token_hash so the table is present but incomplete.
        if (table === 'member_export_tickets' && column.name === 'token_hash') {
          continue
        }
        map.set(column.name, columnRow(column))
      }
      columns.set(table, map)
    }
    const checks = new Map(
      EXPORT_INTEGRITY_CHECKS.map(name => [name, EXPORT_INTEGRITY_CHECK_CLAUSES[name]]),
    )
    const fks = new Map(
      EXPORT_INTEGRITY_FOREIGN_KEYS.map(fk => [`${fk.table}.${fk.name}`, fkRows(fk)]),
    )
    const connection = createFakeConnection({ indexes, tables, columns, checks, fks })
    const before = await inspectExportIntegrity(connection)
    assert.equal(before.complete, false)
    assert.ok(before.missing.includes('column:member_export_tickets.token_hash'))
    await assert.rejects(
      () => ensureExportIntegrity(connection),
      /cannot recover missing column|recovery incomplete|still missing/,
    )
    // Must never claim complete after a missing-column path.
    const after = await inspectExportIntegrity(connection)
    assert.equal(after.complete, false)
  })
})

/**
 * Pure shared-evaluator probes: remote adapter and local path must feed the same catalog
 * contract. No live MySQL/CloudBase required.
 */
describe('evaluateExportIntegrityCatalog shared contract', () => {
  function buildCompleteCatalog(overrides = {}) {
    const {
      EXPORT_INTEGRITY_UNIQUE_KEYS,
      EXPORT_INTEGRITY_INDEXES,
      EXPORT_INTEGRITY_FOREIGN_KEYS,
      EXPORT_INTEGRITY_TABLE_COLUMNS,
      EXPORT_INTEGRITY_TABLE_META,
      EXPORT_INTEGRITY_CHECKS,
      EXPORT_INTEGRITY_CHECK_CLAUSES,
    } = catalog

    const indexes = new Map()
    for (const index of [...EXPORT_INTEGRITY_UNIQUE_KEYS, ...EXPORT_INTEGRITY_INDEXES]) {
      indexes.set(`${index.table}.${index.name}`, indexRows(index))
    }

    const foreignKeys = new Map()
    for (const fk of EXPORT_INTEGRITY_FOREIGN_KEYS) {
      foreignKeys.set(`${fk.table}.${fk.name}`, {
        rows: fkRows(fk),
        oldPresent: false,
      })
    }

    const tables = new Map()
    for (const table of Object.keys(EXPORT_INTEGRITY_TABLE_COLUMNS)) {
      const meta = EXPORT_INTEGRITY_TABLE_META[table]
      const columns = new Map()
      for (const column of EXPORT_INTEGRITY_TABLE_COLUMNS[table]) {
        columns.set(column.name, columnRow(column))
      }
      const pk = meta.primaryKey.map(col => `\`${col}\``).join(', ')
      tables.set(table, {
        engine: meta.engine,
        tableCollation: meta.tableCollation,
        pkColumns: [...meta.primaryKey],
        createSql: `CREATE TABLE \`${table}\` (\n  PRIMARY KEY (${pk})\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`,
        columns,
      })
    }

    const checks = new Map(
      EXPORT_INTEGRITY_CHECKS.map(name => [name, EXPORT_INTEGRITY_CHECK_CLAUSES[name]]),
    )

    return {
      indexes: overrides.indexes || indexes,
      foreignKeys: overrides.foreignKeys || foreignKeys,
      tables: overrides.tables || tables,
      checks: overrides.checks || checks,
    }
  }

  it('complete catalog is complete with zero missing/incompatible', () => {
    const { evaluateExportIntegrityCatalog } = catalog
    const state = evaluateExportIntegrityCatalog(buildCompleteCatalog())
    assert.equal(state.complete, true)
    assert.equal(state.missing.length, 0)
    assert.equal(state.incompatible.length, 0)
    assert.equal(state.partial, false)
  })

  it('accepts MySQL 8 information_schema charset and regexp_like serialization', () => {
    const { checkClausesCompatible } = catalog
    assert.equal(
      checkClausesCompatible(
        '(`status` in (_utf8mb4\\\'ACTIVE\\\',_utf8mb4\\\'RESERVED\\\',_utf8mb4\\\'CONSUMED\\\',_utf8mb4\\\'ORPHAN\\\',_utf8mb4\\\'EXPIRED\\\'))',
        '(status in (\'active\',\'reserved\',\'consumed\',\'orphan\',\'expired\'))',
      ),
      true,
    )
    assert.equal(
      checkClausesCompatible(
        'regexp_like(`token_hash`,_utf8mb4\\\'^[0-9a-f]{64}$\\\')',
        '(token_hash regexp \'^[0-9a-f]{64}$\')',
      ),
      true,
    )
  })

  it('fails closed on missing PRIMARY KEY columns', () => {
    const { evaluateExportIntegrityCatalog, EXPORT_INTEGRITY_TABLE_COLUMNS, EXPORT_INTEGRITY_TABLE_META } = catalog
    const base = buildCompleteCatalog()
    for (const table of Object.keys(EXPORT_INTEGRITY_TABLE_COLUMNS)) {
      const entry = base.tables.get(table)
      entry.pkColumns = []
      entry.createSql = `CREATE TABLE \`${table}\` () ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=${EXPORT_INTEGRITY_TABLE_META[table].tableCollation}`
    }
    const state = evaluateExportIntegrityCatalog(base)
    assert.equal(state.complete, false)
    assert.ok(state.incompatible.some(item => item.includes('primary_key=missing')))
  })

  it('fails closed on datetime_precision != 3 and bare CURRENT_TIMESTAMP default', () => {
    const { evaluateExportIntegrityCatalog } = catalog
    const base = buildCompleteCatalog()
    const tickets = base.tables.get('member_export_tickets')
    const expires = tickets.columns.get('expires_at')
    expires.datetimePrecision = 0
    expires.columnType = 'datetime'
    const created = tickets.columns.get('created_at')
    created.columnDefault = 'CURRENT_TIMESTAMP'
    const updated = tickets.columns.get('updated_at')
    updated.extra = 'DEFAULT_GENERATED on update CURRENT_TIMESTAMP'
    const state = evaluateExportIntegrityCatalog(base)
    assert.equal(state.complete, false)
    assert.ok(state.incompatible.some(item => item.includes('datetime_precision=')))
    assert.ok(state.incompatible.some(item => item.includes('default=') || item.includes('extra_missing=')))
  })

  it('fails closed when old single-column FK still present', () => {
    const { evaluateExportIntegrityCatalog, EXPORT_INTEGRITY_FOREIGN_KEYS } = catalog
    const base = buildCompleteCatalog()
    const withOld = EXPORT_INTEGRITY_FOREIGN_KEYS.find(fk => fk.oldName)
    base.foreignKeys.set(`${withOld.table}.${withOld.name}`, {
      rows: fkRows(withOld),
      oldPresent: true,
    })
    const state = evaluateExportIntegrityCatalog(base)
    assert.equal(state.complete, false)
    assert.ok(state.incompatible.some(item => item.includes(`${withOld.oldName} still_present`)))
  })

  it('fails closed on index DESC collation drift', () => {
    const { evaluateExportIntegrityCatalog } = catalog
    const base = buildCompleteCatalog()
    const key = 'member_export_tickets.member_export_tickets_event_idx'
    const rows = base.indexes.get(key)
    rows[2].collation = 'A' // expected D
    const state = evaluateExportIntegrityCatalog(base)
    assert.equal(state.complete, false)
    assert.ok(state.incompatible.some(item => item.includes('collations=')))
  })

  it('incompatible alone is partial and never complete (migration-row weak path)', () => {
    const { evaluateExportIntegrityCatalog } = catalog
    const base = buildCompleteCatalog()
    const tickets = base.tables.get('member_export_tickets')
    tickets.columns.get('version').columnType = 'int' // drop unsigned
    const state = evaluateExportIntegrityCatalog(base)
    assert.equal(state.complete, false)
    assert.equal(state.partial, true)
    assert.ok(state.incompatible.some(item => item.includes('not_unsigned')))
    // missing may be empty while still incomplete — weak "all present" must not complete.
    assert.equal(state.missing.length, 0)
  })
})
