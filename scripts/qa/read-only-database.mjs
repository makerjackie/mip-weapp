import assert from 'node:assert/strict'
import { callCloudbase, sqlLiteral } from '../lib/example-cloudbase.mjs'

export function createReadOnlyDatabase(root, { readQuery = args => callCloudbase(root, 'queryMysqlDatabase', args) } = {}) {
  const queries = []
  const cache = new Map()
  const db = {
    clearCache() {
      cache.clear()
    },
    async query(sql, values = []) {
      const readOnlyStart = /^\s*(?:SELECT\b|WITH\s+(?:mip_ranked_guest_facts|co_attendance|snapshot)\s+AS\s*\()/i.test(sql)
      assert(readOnlyStart && !/;|\b(?:INSERT|UPDATE|DELETE|REPLACE|DROP|ALTER|CREATE|TRUNCATE)\b|\bINTO\s+OUTFILE\b/i.test(sql), 'Read-only SQL required')
      assert(/\bapp_id\b/i.test(sql) || /^\s*SELECT\s+UTC_TIMESTAMP/i.test(sql), 'App scope required')
      let index = 0
      const bound = sql.replace(/\?/g, () => {
        const value = values[index++]
        return typeof value === 'number' ? String(value) : sqlLiteral(value instanceof Date ? value.toISOString().slice(0, 23).replace('T', ' ') : value)
      })
      assert.equal(index, values.length)
      if (cache.has(bound)) {
        return structuredClone(cache.get(bound))
      }
      // The MCP transport truncates large catalog payloads. Page only unbounded tag catalogs.
      const pagedCatalog = sql.match(/\bFROM\s+(\w+)/i)?.[1] === 'mip_tags'
        && /\bORDER BY\b/i.test(sql) && !/\bLIMIT\b/i.test(sql)
      const rows = []
      for (let offset = 0; ; offset += 100) {
        const boundedStatement = pagedCatalog ? `${bound} LIMIT 100 OFFSET ${offset}` : bound
        // MCP accepts SELECT entrypoints; MySQL permits the existing CTE in a derived table.
        const statement = /^\s*WITH\b/i.test(bound) ? `SELECT * FROM (${boundedStatement}) AS qa_readonly_cte` : boundedStatement
        const response = await readQuery({ action: 'runQuery', sql: statement })
        assert.equal(response.success, true, 'Database read failed')
        assert(Array.isArray(response.data?.rows), 'Expected database rows')
        // MCP serializes SQL timestamps without a timezone; production mysql2 uses timezone Z.
        const dateColumns = (response.data.columns || []).filter(column => /^(?:DATETIME|TIMESTAMP)$/i.test(column.databaseType)).map(column => column.name)
        rows.push(...response.data.rows.map((row) => {
          const normalized = { ...row }
          for (const key of dateColumns) {
            if (typeof normalized[key] === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(normalized[key])) {
              normalized[key] = new Date(`${normalized[key].replace(' ', 'T')}Z`)
            }
          }
          return normalized
        }))
        if (!pagedCatalog || response.data.rows.length < 100) {
          break
        }
        assert(offset < 9900, 'Catalog exceeds QA read limit')
      }
      queries.push({ query: sql, rows: rows.length })
      cache.set(bound, rows)
      return structuredClone(rows)
    },
    async one(sql, values) {
      return (await this.query(sql, values))[0] || null
    },
    async transaction() {
      throw new Error('Mutations forbidden in readback QA')
    },
  }
  return { db, queries }
}
