'use strict'

// Schema-accurate guard for the projector's hand-written SQL. The stubbed projector
// tests cannot catch a SELECT that references a column the live schema does not have
// (MIW-107: `actor.nickname` against mip_users shipped in f32b1026 and every
// cooperation/interest projection failed in staging with Error 1054). This test
// parses the migration DDL into table->column sets and verifies every
// `alias.column` reference in projector.js resolves against the mapped table.

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { describe, it } = require('node:test')

const root = path.resolve(__dirname, '..', '..', '..')
const migrationDir = path.join(root, 'database', 'mysql', 'mip')
const projectorSource = fs.readFileSync(path.join(__dirname, '..', 'domain', 'projector.js'), 'utf8')

function loadSchemaColumns() {
  const columns = new Map()
  const addColumn = (table, column) => {
    if (!columns.has(table)) columns.set(table, new Set())
    columns.get(table).add(column)
  }
  for (const file of fs.readdirSync(migrationDir).filter(name => name.endsWith('.sql')).sort()) {
    const sql = fs.readFileSync(path.join(migrationDir, file), 'utf8')
    for (const create of sql.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)\s*\(([\s\S]*?)\n\)/g)) {
      for (const line of create[2].split('\n')) {
        const column = line.trim().match(/^(\w+)\s+(?:CHAR|VARCHAR|ASCII|BIGINT|INT|JSON|DATETIME|TEXT|DECIMAL|TINYINT)/)
        if (column) addColumn(create[1], column[1])
      }
    }
    for (const alter of sql.matchAll(/ALTER TABLE (\w+)[\s\S]*?;/g)) {
      for (const added of alter[0].matchAll(/ADD COLUMN (\w+)/g)) {
        addColumn(alter[1], added[1])
      }
    }
  }
  return columns
}

describe('projector SQL resolves against the migration schema', () => {
  const schema = loadSchemaColumns()

  const queries = [...projectorSource.matchAll(/`(\s*SELECT[\s\S]*?)`/g)].map(match => match[1])
  assert.ok(queries.length >= 20, `expected projector queries, found ${queries.length}`)

  it('collected schema tables all have parsed columns', () => {
    assert.ok(schema.has('mip_users'), 'mip_users missing from parsed schema')
    assert.ok(schema.get('mip_users').has('id'), 'mip_users.id missing from parsed schema')
    assert.ok(schema.has('mip_profiles') && schema.get('mip_profiles').has('nickname'),
      'mip_profiles.nickname missing from parsed schema')
    assert.ok(!schema.get('mip_users').has('nickname'),
      'precondition: mip_users has no nickname column; nickname lives on mip_profiles')
  })

  for (const [index, sql] of queries.entries()) {
    it(`query #${index + 1} only references existing columns`, () => {
      const aliases = new Map()
      for (const match of sql.matchAll(/\b(?:FROM|JOIN)\s+(mip_\w+)(?:\s+AS\s+)?(\s+\w+)?/g)) {
        const alias = (match[2] || '').trim()
        if (alias && alias !== 'AS') aliases.set(alias, match[1])
      }
      const unknown = []
      for (const match of sql.matchAll(/\b(mip_\w+)\.(\w+)\b/g)) {
        const columns = schema.get(match[1])
        if (!columns || !columns.has(match[2])) unknown.push(`${match[1]}.${match[2]}`)
      }
      for (const match of sql.matchAll(/\b([a-z_][a-z0-9_]*)\.(\w+)\b(?!\s*\()/g)) {
        const table = aliases.get(match[1])
        if (!table) continue
        if (!schema.get(table)?.has(match[2])) unknown.push(`${match[1]}.${match[2]} (${table})`)
      }
      assert.deepEqual(unknown, [], `unknown column references: ${unknown.join(', ')}\nSQL: ${sql.slice(0, 200)}`)
    })
  }
})
