#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import {
  ACTIVITY_OPERATION_CHECK_CLAUSES,
  ACTIVITY_OPERATION_CHECKS,
  ACTIVITY_OPERATION_COLUMNS,
  ACTIVITY_OPERATION_ENSURE_STATEMENTS,
  ACTIVITY_OPERATION_INDEXES,
  ACTIVITY_OPERATIONS_NAME,
  ACTIVITY_OPERATIONS_VERSION,
  expectedObjectKeys,
  normalizeCheckClause,
  normalizeDefault,
} from './lib/activity-operations-schema.mjs'
import {
  bindAndRequireMysqlEnvironment,
  callCloudbase,
  loadCaseEnv,
  sqlLiteral,
} from './lib/example-cloudbase.mjs'
import {
  buildEnsureStatementPlan,
  evaluateExportIntegrityCatalog,
  EXPORT_INTEGRITY_FOREIGN_KEYS,
  EXPORT_INTEGRITY_INDEXES,
  EXPORT_INTEGRITY_NAME,
  EXPORT_INTEGRITY_TABLE_META,
  EXPORT_INTEGRITY_TABLES,
  EXPORT_INTEGRITY_UNIQUE_KEYS,
  EXPORT_INTEGRITY_VERSION,
} from './lib/export-integrity-schema.mjs'
import { loadVerifiedMigrations } from './lib/migrations.mjs'

const root = path.resolve(import.meta.dirname, '..')
const env = loadCaseEnv(root)
const envId = env.CLOUDBASE_ENV_ID
const confirmedEnv = process.argv.find(value => value.startsWith('--confirm-env='))?.slice('--confirm-env='.length)

if (!envId || confirmedEnv !== envId) {
  throw new Error('MySQL schema application requires --confirm-env=<exact CLOUDBASE_ENV_ID>')
}

bindAndRequireMysqlEnvironment(root, envId)

function splitStatements(sql) {
  const statements = []
  let current = ''
  let quote = null
  let lineComment = false
  let blockComment = false
  for (let index = 0; index < sql.length; index += 1) {
    const char = sql[index]
    const next = sql[index + 1]
    if (lineComment) {
      if (char === '\n') {
        lineComment = false
      }
      current += char
      continue
    }
    if (blockComment) {
      if (char === '*' && next === '/') {
        blockComment = false
        current += '*/'
        index += 1
      }
      else {
        current += char
      }
      continue
    }
    if (!quote && char === '-' && next === '-') {
      lineComment = true
      current += '--'
      index += 1
      continue
    }
    if (!quote && char === '/' && next === '*') {
      blockComment = true
      current += '/*'
      index += 1
      continue
    }
    if (quote) {
      current += char
      if (char === '\\') {
        current += next || ''
        index += 1
      }
      else if (char === quote) {
        quote = null
      }
      continue
    }
    if (char === '\'' || char === '"' || char === '`') {
      quote = char
      current += char
      continue
    }
    if (char === ';') {
      if (current.trim()) {
        statements.push(current.trim())
      }
      current = ''
      continue
    }
    current += char
  }
  if (current.trim()) {
    statements.push(current.trim())
  }
  return statements
}

/**
 * Walk nested MCP payloads and collect row-like objects.
 * `fieldMap` maps canonical output keys → accepted source key aliases (lowercase).
 * Exact structure compare must not rely on token includes().
 */
function collectRows(value, fieldMap, out = []) {
  if (!value || typeof value !== 'object') {
    return out
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectRows(item, fieldMap, out)
    }
    return out
  }
  const keys = Object.keys(value)
  const lower = new Map(keys.map(key => [key.toLowerCase(), key]))
  const resolved = {}
  let matched = 0
  for (const [canonical, aliases] of Object.entries(fieldMap)) {
    let has = false
    let found
    for (const alias of aliases) {
      const actualKey = lower.get(alias.toLowerCase())
      if (actualKey) {
        found = value[actualKey]
        has = true
        break
      }
    }
    // Preserve explicit NULL values from information_schema (e.g. length for INT).
    if (has) {
      resolved[canonical] = found
      matched += 1
    }
  }
  if (matched === Object.keys(fieldMap).length) {
    out.push(resolved)
  }
  for (const child of Object.values(value)) {
    if (child && typeof child === 'object') {
      collectRows(child, fieldMap, out)
    }
  }
  return out
}

const COLUMN_FIELD_MAP = {
  name: ['name', 'column_name', 'columnname', 'COLUMN_NAME'],
  dataType: ['dataType', 'data_type', 'datatype', 'DATA_TYPE'],
  characterMaximumLength: [
    'characterMaximumLength',
    'character_maximum_length',
    'charactermaximumlength',
    'CHARACTER_MAXIMUM_LENGTH',
  ],
  isNullable: ['isNullable', 'is_nullable', 'isnullable', 'IS_NULLABLE'],
  columnDefault: ['columnDefault', 'column_default', 'columndefault', 'COLUMN_DEFAULT'],
  columnType: ['columnType', 'column_type', 'columntype', 'COLUMN_TYPE'],
}

const INDEX_FIELD_MAP = {
  name: ['name', 'index_name', 'indexname', 'INDEX_NAME'],
  nonUnique: ['nonUnique', 'non_unique', 'nonunique', 'NON_UNIQUE'],
  columnName: ['columnName', 'column_name', 'columnname', 'COLUMN_NAME'],
  seq: ['seq', 'seq_in_index', 'seqinindex', 'SEQ_IN_INDEX'],
}

const CHECK_FIELD_MAP = {
  name: ['name', 'constraint_name', 'constraintname', 'CONSTRAINT_NAME'],
  checkClause: ['checkClause', 'check_clause', 'checkclause', 'CHECK_CLAUSE'],
}

const TABLE_FIELD_MAP = {
  name: ['name', 'table_name', 'tablename', 'TABLE_NAME'],
}

const FK_FIELD_MAP = {
  columnName: ['columnName', 'column_name', 'columnname', 'COLUMN_NAME'],
  seq: ['seq', 'ordinal_position', 'ordinalposition', 'ORDINAL_POSITION'],
  referencedTable: [
    'referencedTable',
    'referenced_table_name',
    'referencedtablename',
    'REFERENCED_TABLE_NAME',
  ],
  referencedColumn: [
    'referencedColumn',
    'referenced_column_name',
    'referencedcolumnname',
    'REFERENCED_COLUMN_NAME',
  ],
  deleteRule: ['deleteRule', 'delete_rule', 'deleterule', 'DELETE_RULE'],
  name: ['name', 'constraint_name', 'constraintname', 'CONSTRAINT_NAME'],
}

/**
 * Object-level 002 inspection via CloudBase MySQL query surface.
 * Exact local-helper parity: column type/length/nullability/default,
 * index unique+order, CHECK normalized expression — never includes-token only.
 */
function inspectActivityOperationsRemote() {
  const present = new Set()
  const incompatible = []

  for (const [table, columns] of Object.entries(ACTIVITY_OPERATION_COLUMNS)) {
    const result = callCloudbase(root, 'queryMysqlDatabase', {
      action: 'runQuery',
      sql: `SELECT column_name AS name, data_type AS dataType,
              character_maximum_length AS characterMaximumLength,
              is_nullable AS isNullable,
              column_default AS columnDefault,
              column_type AS columnType
       FROM information_schema.columns
       WHERE table_schema = DATABASE() AND table_name = ${sqlLiteral(table)}`,
    })
    const rows = collectRows(result, COLUMN_FIELD_MAP)
    const byName = new Map(rows.map(row => [String(row.name), row]))
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
      if (expected.isNullable && String(actual.isNullable).toUpperCase() !== expected.isNullable) {
        incompatible.push(`${table}.${expected.name} nullable=${actual.isNullable}`)
      }
      if (Object.hasOwn(expected, 'columnDefault')) {
        const actualDefault = normalizeDefault(actual.columnDefault)
        const expectedDefault = normalizeDefault(expected.columnDefault)
        if (actualDefault !== expectedDefault) {
          incompatible.push(`${table}.${expected.name} default=${actual.columnDefault}`)
        }
      }
    }
  }

  for (const index of ACTIVITY_OPERATION_INDEXES) {
    const result = callCloudbase(root, 'queryMysqlDatabase', {
      action: 'runQuery',
      sql: `SELECT index_name AS name, non_unique AS nonUnique, column_name AS columnName, seq_in_index AS seq
       FROM information_schema.statistics
       WHERE table_schema = DATABASE()
         AND table_name = ${sqlLiteral(index.table)}
         AND index_name = ${sqlLiteral(index.name)}
       ORDER BY seq_in_index`,
    })
    let rows = collectRows(result, INDEX_FIELD_MAP)
    rows = rows
      .filter(row => String(row.name) === index.name)
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
  }

  const checksResult = callCloudbase(root, 'queryMysqlDatabase', {
    action: 'runQuery',
    sql: `SELECT tc.constraint_name AS name, cc.check_clause AS checkClause
     FROM information_schema.table_constraints tc
     JOIN information_schema.check_constraints cc
       ON cc.constraint_schema = tc.constraint_schema
      AND cc.constraint_name = tc.constraint_name
     WHERE tc.table_schema = DATABASE()
       AND tc.constraint_type = 'CHECK'
       AND tc.table_name IN ('member_events', 'member_registrations')`,
  })
  const checkRows = collectRows(checksResult, CHECK_FIELD_MAP)
  const byCheck = new Map(checkRows.map(row => [String(row.name), row.checkClause]))
  for (const name of ACTIVITY_OPERATION_CHECKS) {
    if (!byCheck.has(name)) {
      continue
    }
    present.add(`check:${name}`)
    const expectedClause = ACTIVITY_OPERATION_CHECK_CLAUSES[name]
    if (expectedClause) {
      const actual = normalizeCheckClause(byCheck.get(name))
      const expected = normalizeCheckClause(expectedClause)
      const compactActual = actual.replace(/[()]/g, '').replace(/\s+/g, '')
      const compactExpected = expected.replace(/[()]/g, '').replace(/\s+/g, '')
      if (compactActual !== compactExpected) {
        incompatible.push(`${name} check_clause=${byCheck.get(name)}`)
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

const ENSURE_STATEMENT_PLAN = [
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

function ensureActivityOperationsRemote() {
  const state = inspectActivityOperationsRemote()
  if (state.incompatible.length) {
    throw new Error(`002 activity operations incompatible definitions: ${state.incompatible.join('; ')}`)
  }
  if (state.complete) {
    return { action: 'noop', state }
  }

  const missing = new Set(state.missing)
  const applied = []
  for (const step of ENSURE_STATEMENT_PLAN) {
    if (!missing.has(step.key)) {
      continue
    }
    try {
      callCloudbase(root, 'manageMysqlDatabase', {
        action: 'runStatement',
        sql: step.sql,
      }, 120000)
      applied.push(step.key)
    }
    catch (error) {
      const message = String(error?.message || error)
      if (!/Duplicate column|Duplicate key|already exists|check that column/i.test(message)) {
        throw error
      }
      applied.push(step.key)
    }
  }

  const after = inspectActivityOperationsRemote()
  if (!after.complete) {
    throw new Error(`002 recovery incomplete; still missing: ${after.missing.join(', ')}`)
  }
  return { action: 'recovered', applied, state: after }
}

/**
 * Best-effort attach of optional information_schema fields that CloudBase may omit
 * when NULL. Does not require the optional keys for base row collection.
 */
function attachOptionalColumnFields(payload, rows, optionalFieldMap) {
  const byName = new Map(rows.map(row => [String(row.name), row]))
  function walk(value) {
    if (!value || typeof value !== 'object') {
      return
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        walk(item)
      }
      return
    }
    const keys = Object.keys(value)
    const lower = new Map(keys.map(key => [key.toLowerCase(), key]))
    const nameKey = lower.get('name')
      || lower.get('column_name')
      || lower.get('columnname')
    if (nameKey) {
      const row = byName.get(String(value[nameKey]))
      if (row) {
        for (const [canonical, aliases] of Object.entries(optionalFieldMap)) {
          for (const alias of aliases) {
            const actualKey = lower.get(alias.toLowerCase())
            if (actualKey) {
              row[canonical] = value[actualKey]
              break
            }
          }
        }
      }
    }
    for (const child of Object.values(value)) {
      if (child && typeof child === 'object') {
        walk(child)
      }
    }
  }
  walk(payload)
}

/**
 * Object-level 003 inspection via CloudBase MySQL query surface.
 * Loads the same catalog shape as the local inspector, then evaluates through
 * evaluateExportIntegrityCatalog so PRIMARY KEY / datetime_precision=3 /
 * CURRENT_TIMESTAMP(3) / unsigned / collation / index DESC / FK+oldFK / CHECK
 * cannot drift between remote and local paths.
 */
function loadExportIntegrityCatalogRemote() {
  const indexes = new Map()
  const foreignKeys = new Map()
  const tables = new Map()
  const checks = new Map()

  const indexFieldMap = {
    ...INDEX_FIELD_MAP,
    collation: ['collation', 'COLLATION'],
  }
  const allIndexes = [...EXPORT_INTEGRITY_UNIQUE_KEYS, ...EXPORT_INTEGRITY_INDEXES]
  for (const index of allIndexes) {
    const result = callCloudbase(root, 'queryMysqlDatabase', {
      action: 'runQuery',
      sql: `SELECT index_name AS name, non_unique AS nonUnique, column_name AS columnName,
              seq_in_index AS seq, collation AS collation
       FROM information_schema.statistics
       WHERE table_schema = DATABASE()
         AND table_name = ${sqlLiteral(index.table)}
         AND index_name = ${sqlLiteral(index.name)}
       ORDER BY seq_in_index`,
    })
    const rows = collectRows(result, indexFieldMap)
      .filter(row => String(row.name) === index.name)
      .sort((a, b) => Number(a.seq) - Number(b.seq))
    if (rows.length) {
      indexes.set(`${index.table}.${index.name}`, rows)
    }
  }

  for (const fk of EXPORT_INTEGRITY_FOREIGN_KEYS) {
    const result = callCloudbase(root, 'queryMysqlDatabase', {
      action: 'runQuery',
      sql: `SELECT tc.constraint_name AS name,
              kcu.column_name AS columnName,
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
         AND tc.table_name = ${sqlLiteral(fk.table)}
         AND tc.constraint_name = ${sqlLiteral(fk.name)}
         AND tc.constraint_type = 'FOREIGN KEY'
       ORDER BY kcu.ordinal_position`,
    })
    const rows = collectRows(result, FK_FIELD_MAP).sort((a, b) => Number(a.seq) - Number(b.seq))
    if (!rows.length) {
      continue
    }
    const oldPresent = fk.oldName ? foreignKeyExistsRemote(fk.table, fk.oldName) : false
    foreignKeys.set(`${fk.table}.${fk.name}`, { rows, oldPresent })
  }

  const tableFieldMap = {
    ...TABLE_FIELD_MAP,
    engine: ['engine', 'ENGINE'],
    tableCollation: ['tableCollation', 'table_collation', 'tablecollation', 'TABLE_COLLATION'],
  }
  const columnFieldMap = {
    ...COLUMN_FIELD_MAP,
    extra: ['extra', 'EXTRA'],
  }

  for (const table of EXPORT_INTEGRITY_TABLES) {
    const tableResult = callCloudbase(root, 'queryMysqlDatabase', {
      action: 'runQuery',
      sql: `SELECT table_name AS name, engine AS engine, table_collation AS tableCollation
       FROM information_schema.tables
       WHERE table_schema = DATABASE() AND table_name = ${sqlLiteral(table)}
       LIMIT 1`,
    })
    const tableRows = collectRows(tableResult, tableFieldMap)
    if (!tableRows.length) {
      continue
    }

    const meta = EXPORT_INTEGRITY_TABLE_META[table]
    let pkColumns = []
    if (meta?.primaryKey) {
      const pkResult = callCloudbase(root, 'queryMysqlDatabase', {
        action: 'runQuery',
        sql: `SELECT column_name AS columnName, seq_in_index AS seq
         FROM information_schema.statistics
         WHERE table_schema = DATABASE()
           AND table_name = ${sqlLiteral(table)}
           AND index_name = 'PRIMARY'
         ORDER BY seq_in_index`,
      })
      const pkRows = collectRows(pkResult, {
        columnName: ['columnName', 'column_name', 'columnname', 'COLUMN_NAME'],
        seq: ['seq', 'seq_in_index', 'seqinindex', 'SEQ_IN_INDEX'],
      }).sort((a, b) => Number(a.seq) - Number(b.seq))
      pkColumns = pkRows.map(row => row.columnName)
    }

    let createSql = ''
    try {
      const createResult = callCloudbase(root, 'queryMysqlDatabase', {
        action: 'runQuery',
        sql: `SHOW CREATE TABLE \`${table}\``,
      })
      // CloudBase may nest Create Table under various key casings.
      const createText = JSON.stringify(createResult)
      const match = createText.match(/"Create Table"\s*:\s*"((?:\\.|[^"\\])*)"/i)
        || createText.match(/"CreateTable"\s*:\s*"((?:\\.|[^"\\])*)"/i)
      if (match) {
        createSql = match[1]
          .replace(/\\n/g, '\n')
          .replace(/\\"/g, '"')
          .replace(/\\\\/g, '\\')
      }
    }
    catch {
      // information_schema path remains authoritative when SHOW CREATE is unavailable.
    }

    const colResult = callCloudbase(root, 'queryMysqlDatabase', {
      action: 'runQuery',
      sql: `SELECT column_name AS name, data_type AS dataType,
              character_maximum_length AS characterMaximumLength,
              is_nullable AS isNullable,
              column_default AS columnDefault,
              column_type AS columnType,
              extra AS extra,
              datetime_precision AS datetimePrecision
       FROM information_schema.columns
       WHERE table_schema = DATABASE() AND table_name = ${sqlLiteral(table)}`,
    })
    const columnRows = collectRows(colResult, columnFieldMap)
    // datetime_precision is optional on CloudBase payloads (NULLs may be omitted).
    // Attach when present; otherwise evaluateExportIntegrityCatalog falls back to column_type.
    attachOptionalColumnFields(colResult, columnRows, {
      datetimePrecision: [
        'datetimePrecision',
        'datetime_precision',
        'datetimeprecision',
        'DATETIME_PRECISION',
      ],
    })
    tables.set(table, {
      engine: tableRows[0].engine,
      tableCollation: tableRows[0].tableCollation,
      pkColumns,
      createSql,
      columns: new Map(columnRows.map(row => [String(row.name), row])),
    })
  }

  const checksResult = callCloudbase(root, 'queryMysqlDatabase', {
    action: 'runQuery',
    sql: `SELECT tc.constraint_name AS name, cc.check_clause AS checkClause
     FROM information_schema.table_constraints tc
     JOIN information_schema.check_constraints cc
       ON cc.constraint_schema = tc.constraint_schema
      AND cc.constraint_name = tc.constraint_name
     WHERE tc.table_schema = DATABASE()
       AND tc.constraint_type = 'CHECK'
       AND tc.table_name IN ('member_export_tickets', 'member_mutation_idempotency')`,
  })
  for (const row of collectRows(checksResult, CHECK_FIELD_MAP)) {
    checks.set(String(row.name), row.checkClause)
  }

  return { indexes, foreignKeys, tables, checks }
}

function inspectExportIntegrityRemote() {
  return evaluateExportIntegrityCatalog(loadExportIntegrityCatalogRemote())
}

function foreignKeyExistsRemote(table, name) {
  const result = callCloudbase(root, 'queryMysqlDatabase', {
    action: 'runQuery',
    sql: `SELECT constraint_name AS name
     FROM information_schema.table_constraints
     WHERE table_schema = DATABASE()
       AND table_name = ${sqlLiteral(table)}
       AND constraint_name = ${sqlLiteral(name)}
       AND constraint_type = 'FOREIGN KEY'
     LIMIT 1`,
  })
  const rows = collectRows(result, { name: ['name', 'constraint_name', 'constraintname', 'CONSTRAINT_NAME'] })
  return rows.some(row => String(row.name) === name)
}

function ensureExportIntegrityRemote() {
  const state = inspectExportIntegrityRemote()
  if (state.incompatible.length) {
    throw new Error(
      `003 export integrity incompatible definitions: ${state.incompatible.join('; ')}`,
    )
  }
  // Never no-op-complete on a weak inspect: complete requires shared evaluator parity.
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
  const ordered = [
    ...plan.filter(step => step.kind === 'unique'),
    ...plan.filter(step => step.kind === 'fk' && step.table !== 'member_export_tickets'),
    ...plan.filter(step => step.kind === 'table'),
    ...plan.filter(step => step.kind === 'fk' && step.table === 'member_export_tickets'),
    ...plan.filter(step => step.kind === 'index' || step.kind === 'check'),
  ]

  for (const step of ordered) {
    if (!missing.has(step.key)) {
      continue
    }
    try {
      if (step.kind === 'fk' && step.oldName && foreignKeyExistsRemote(step.table, step.oldName)) {
        callCloudbase(root, 'manageMysqlDatabase', {
          action: 'runStatement',
          sql: `ALTER TABLE ${step.table} DROP FOREIGN KEY ${step.oldName}`,
        }, 120000)
      }
      if (!step.sql) {
        continue
      }
      callCloudbase(root, 'manageMysqlDatabase', {
        action: 'runStatement',
        sql: step.sql,
      }, 120000)
      applied.push(step.key)
      if (step.kind === 'table') {
        for (const nested of step.nestedKeys || []) {
          missing.delete(nested)
        }
      }
    }
    catch (error) {
      const message = String(error?.message || error)
      if (!/Duplicate column|Duplicate key|already exists|check that column|Cannot add foreign key|errno: 121|1826/i.test(message)) {
        // Missing old FK on DROP is recoverable.
        if (step.kind === 'fk' && /Unknown|check that|Can't DROP|Cannot drop|doesn't exist/i.test(message)) {
          // Retry ADD only path when DROP failed because old FK already gone.
          try {
            callCloudbase(root, 'manageMysqlDatabase', {
              action: 'runStatement',
              sql: step.sql,
            }, 120000)
            applied.push(step.key)
            continue
          }
          catch (addError) {
            const addMessage = String(addError?.message || addError)
            if (/Duplicate|already exists/i.test(addMessage)) {
              applied.push(step.key)
              continue
            }
            throw addError
          }
        }
        throw error
      }
      applied.push(step.key)
      if (step.kind === 'table') {
        for (const nested of step.nestedKeys || []) {
          missing.delete(nested)
        }
      }
    }
  }

  const after = inspectExportIntegrityRemote()
  if (!after.complete) {
    const details = [
      after.missing.length ? `still missing: ${after.missing.join(', ')}` : null,
      after.incompatible.length ? `incompatible: ${after.incompatible.join('; ')}` : null,
    ].filter(Boolean).join('; ')
    throw new Error(`003 recovery incomplete; ${details || 'inspect incomplete'}`)
  }
  return { action: 'recovered', applied, state: after }
}

function isExportIntegrityMigration(migration) {
  return migration.name === EXPORT_INTEGRITY_NAME && migration.version === EXPORT_INTEGRITY_VERSION
}

function isActivityOperationsMigration(migration) {
  return migration.name === ACTIVITY_OPERATIONS_NAME && migration.version === ACTIVITY_OPERATIONS_VERSION
}

callCloudbase(root, 'manageMysqlDatabase', {
  action: 'runStatement',
  sql: `CREATE TABLE IF NOT EXISTS member_schema_migrations (
    version VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
    name VARCHAR(128) NOT NULL,
    checksum CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`,
})

for (const migration of loadVerifiedMigrations(root)) {
  const existing = callCloudbase(root, 'queryMysqlDatabase', {
    action: 'runQuery',
    sql: `SELECT version, name, checksum FROM member_schema_migrations
      WHERE version = ${sqlLiteral(migration.version)} LIMIT 1`,
  })
  const existingText = JSON.stringify(existing)
  const hasMigrationRow = existingText.includes(migration.version)

  if (hasMigrationRow) {
    if (!existingText.includes(migration.sqlSha256)) {
      throw new Error(`MySQL migration checksum mismatch: ${migration.version}`)
    }

    // 002 DDL auto-commits: a recorded row can still leave partial objects after a crash.
    // Always re-inspect all 18 objects; recover missing; fail on incompatible definitions.
    if (isActivityOperationsMigration(migration)) {
      const recovery = ensureActivityOperationsRemote()
      if (recovery.action === 'recovered') {
        console.log(`[mysql-schema] 002 migration row present; recovered objects: ${recovery.applied.join(', ')}`)
      }
      else {
        console.log('[mysql-schema] 002 migration row present; all 18 objects complete')
      }
    }

    // 003 same class: migration row present does not prove composite FKs/tables complete.
    if (isExportIntegrityMigration(migration)) {
      const recovery = ensureExportIntegrityRemote()
      if (recovery.action === 'recovered') {
        console.log(`[mysql-schema] 003 migration row present; recovered objects: ${recovery.applied.join(', ')}`)
      }
      else {
        console.log(
          `[mysql-schema] 003 migration row present; all ${recovery.state.expectedCount} objects complete`,
        )
      }
    }

    console.log(`[mysql-schema] already applied: ${migration.name} ${migration.version}`)
    continue
  }

  // First apply of 002: recover any partial objects before inserting the migration row.
  if (isActivityOperationsMigration(migration)) {
    const state = inspectActivityOperationsRemote()
    // A previous run can auto-commit every DDL statement and stop before the
    // checksum row is inserted. In that state the schema is already complete;
    // record it instead of replaying the ALTER TABLE statements.
    if (state.complete) {
      callCloudbase(root, 'manageMysqlDatabase', {
        action: 'runStatement',
        sql: `INSERT INTO member_schema_migrations (version, name, checksum)
          VALUES (${sqlLiteral(migration.version)}, ${sqlLiteral(migration.name)}, ${sqlLiteral(migration.sqlSha256)})`,
      })
      console.log(`[mysql-schema] verified and recorded: ${migration.name} ${migration.version}`)
      continue
    }
    if (state.partial || (state.empty === false && !state.complete)) {
      console.log('[mysql-schema] detected incomplete 002 objects; recovering before checksum insert')
      ensureActivityOperationsRemote()
      callCloudbase(root, 'manageMysqlDatabase', {
        action: 'runStatement',
        sql: `INSERT INTO member_schema_migrations (version, name, checksum)
          VALUES (${sqlLiteral(migration.version)}, ${sqlLiteral(migration.name)}, ${sqlLiteral(migration.sqlSha256)})`,
      })
      // Re-verify after insert — only write was already done after complete recovery.
      const verified = inspectActivityOperationsRemote()
      if (!verified.complete) {
        throw new Error(`002 still incomplete after recovery: ${verified.missing.join(', ')}`)
      }
      console.log(`[mysql-schema] recovered and recorded: ${migration.name} ${migration.version}`)
      continue
    }
  }

  // First apply of 003: recover any partial objects before inserting the migration row.
  if (isExportIntegrityMigration(migration)) {
    const state = inspectExportIntegrityRemote()
    if (state.partial || (state.empty === false && !state.complete)) {
      console.log('[mysql-schema] detected incomplete 003 objects; recovering before checksum insert')
      ensureExportIntegrityRemote()
      callCloudbase(root, 'manageMysqlDatabase', {
        action: 'runStatement',
        sql: `INSERT INTO member_schema_migrations (version, name, checksum)
          VALUES (${sqlLiteral(migration.version)}, ${sqlLiteral(migration.name)}, ${sqlLiteral(migration.sqlSha256)})`,
      })
      const verified = inspectExportIntegrityRemote()
      if (!verified.complete) {
        throw new Error(`003 still incomplete after recovery: ${verified.missing.join(', ')}`)
      }
      console.log(`[mysql-schema] recovered and recorded: ${migration.name} ${migration.version}`)
      continue
    }
  }

  const sql = fs.readFileSync(path.join(root, migration.sql), 'utf8')
  const statements = splitStatements(sql)

  // For 002, only record the migration row after full object completeness.
  if (isActivityOperationsMigration(migration)) {
    for (const statement of statements) {
      try {
        callCloudbase(root, 'manageMysqlDatabase', {
          action: 'runStatement',
          sql: statement,
        }, 120000)
      }
      catch (error) {
        const message = String(error?.message || error)
        if (!/Duplicate column|Duplicate key|already exists|check that column/i.test(message)) {
          throw error
        }
      }
    }
    const verified = ensureActivityOperationsRemote()
    if (!verified.state.complete && verified.action === 'noop' && !inspectActivityOperationsRemote().complete) {
      throw new Error('002 apply did not reach complete object state')
    }
    const finalState = inspectActivityOperationsRemote()
    if (!finalState.complete) {
      throw new Error(`002 apply incomplete; missing: ${finalState.missing.join(', ')}`)
    }
    callCloudbase(root, 'manageMysqlDatabase', {
      action: 'runStatement',
      sql: `INSERT INTO member_schema_migrations (version, name, checksum)
        VALUES (${sqlLiteral(migration.version)}, ${sqlLiteral(migration.name)}, ${sqlLiteral(migration.sqlSha256)})`,
    })
    console.log(`[mysql-schema] applied: ${migration.name} ${migration.version}`)
    continue
  }

  // For 003, only record the migration row after full object completeness.
  if (isExportIntegrityMigration(migration)) {
    for (const statement of statements) {
      try {
        callCloudbase(root, 'manageMysqlDatabase', {
          action: 'runStatement',
          sql: statement,
        }, 120000)
      }
      catch (error) {
        const message = String(error?.message || error)
        // Multi-clause ALTER may partially succeed; recoverable duplicates are ignored.
        if (!/Duplicate column|Duplicate key|already exists|check that column|Can't DROP|Cannot drop|Unknown|doesn't exist/i.test(message)) {
          throw error
        }
      }
    }
    const verified = ensureExportIntegrityRemote()
    const finalState = inspectExportIntegrityRemote()
    if (!finalState.complete) {
      throw new Error(`003 apply incomplete; missing: ${finalState.missing.join(', ')}`)
    }
    callCloudbase(root, 'manageMysqlDatabase', {
      action: 'runStatement',
      sql: `INSERT INTO member_schema_migrations (version, name, checksum)
        VALUES (${sqlLiteral(migration.version)}, ${sqlLiteral(migration.name)}, ${sqlLiteral(migration.sqlSha256)})`,
    })
    console.log(
      `[mysql-schema] applied: ${migration.name} ${migration.version} (${finalState.expectedCount} objects; ensure=${verified.action})`,
    )
    continue
  }

  statements.push(`INSERT INTO member_schema_migrations (version, name, checksum)
    VALUES (${sqlLiteral(migration.version)}, ${sqlLiteral(migration.name)}, ${sqlLiteral(migration.sqlSha256)})`)
  callCloudbase(root, 'manageMysqlDatabase', {
    action: 'initializeSchema',
    statements,
    requireReady: true,
  }, 300000)
  console.log(`[mysql-schema] applied: ${migration.name} ${migration.version}`)
}

const verification = callCloudbase(root, 'queryMysqlDatabase', {
  action: 'runQuery',
  sql: `SELECT table_name FROM information_schema.tables
    WHERE table_schema = DATABASE() AND table_name LIKE 'member\\_%'
    ORDER BY table_name`,
})
const verificationText = JSON.stringify(verification)
const requiredTables = [
  'member_profiles',
  'member_private_profiles',
  'member_media_assets',
  'member_plans',
  'member_entitlements',
  'member_events',
  'member_event_changes',
  'member_orders',
  'member_registrations',
  'member_admin_roles',
  'member_refunds',
  'member_audit_logs',
  'member_export_tickets',
  'member_mutation_idempotency',
  'member_media_cleanup_outbox',
  'member_notifications',
  'member_notification_subscriptions',
  'member_notification_outbox',
  'member_operational_failures',
  'member_announcements',
  'member_blocks',
  'member_reports',
]
for (const table of requiredTables) {
  if (!verificationText.includes(table)) {
    throw new Error(`MySQL schema verification missed ${table}`)
  }
}
console.log('[mysql-schema] schema verified')

export {
  ENSURE_STATEMENT_PLAN,
  ensureActivityOperationsRemote,
  ensureExportIntegrityRemote,
  inspectActivityOperationsRemote,
  inspectExportIntegrityRemote,
  splitStatements,
}
