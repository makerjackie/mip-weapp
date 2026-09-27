import { describe, expect, it } from 'vitest'
import { demoUserId, requireTestEnvironment } from '../scripts/qa/demo-role-policy.mjs'
import { createReadOnlyDatabase } from '../scripts/qa/read-only-database.mjs'

describe('local demo role QA boundaries', () => {
  it('rejects production, non-test catalogs and real payments', () => {
    const env = { MIP_DEPLOYMENT_STAGE: 'staging', MIP_CATALOG_STAGE: 'TEST', MIP_PAYMENT_MODE: 'test' }
    expect(() => requireTestEnvironment(env)).not.toThrow()
    for (const override of [{ MIP_DEPLOYMENT_STAGE: 'production' }, { MIP_CATALOG_STAGE: 'LIVE' }, { MIP_PAYMENT_MODE: 'live' }]) {
      expect(() => requireTestEnvironment({ ...env, ...override })).toThrow()
    }
    expect(() => demoUserId('owner')).toThrow('QA_UNSUPPORTED_ROLE')
    expect(() => demoUserId('toString')).toThrow('QA_UNSUPPORTED_ROLE')
    expect(demoUserId('visitor')).toBeUndefined()
    expect(demoUserId('ordinary')).toMatch(/^50000000-/)
  })

  it('blocks mutations and unscoped reads before contacting the database', async () => {
    let calls = 0
    const { db } = createReadOnlyDatabase('/unused', { readQuery: async () => {
      calls++
      throw new Error('Must not reach transport')
    } })
    for (const sql of [
      'UPDATE mip_users SET status = ? WHERE app_id = ?',
      'INSERT INTO mip_users (app_id) VALUES (?)',
      'DELETE FROM mip_users WHERE app_id = ?',
      'SELECT id FROM mip_users WHERE app_id = ? FOR UPDATE',
      'SELECT id FROM mip_users WHERE app_id = ?; DELETE FROM mip_users',
      'SELECT id FROM mip_users',
      'WITH co_attendance AS (SELECT id FROM mip_users WHERE app_id = ?) DELETE FROM mip_users',
    ]) {
      await expect(db.query(sql, [])).rejects.toThrow()
    }
    await expect(db.transaction()).rejects.toThrow('Mutations forbidden')
    expect(calls).toBe(0)
  })

  it('allows the existing read-only interaction CTE while rejecting CTE writes', async () => {
    const statements: string[] = []
    const { db } = createReadOnlyDatabase('/unused', {
      readQuery: async ({ sql }: { sql: string }) => {
        statements.push(sql)
        return { success: true, data: { rows: [{ count: 1 }] } }
      },
    })
    const rows = await db.query('WITH co_attendance AS (SELECT id FROM mip_users WHERE app_id = ?) SELECT COUNT(*) AS count FROM co_attendance', ['test-app'])
    expect(rows).toEqual([{ count: 1 }])
    expect(statements).toHaveLength(1)
  })

  it('preserves UTC SQL timestamps like the production mysql2 connection', async () => {
    const { db } = createReadOnlyDatabase('/unused', { readQuery: async () => ({ success: true, data: {
      columns: [{ name: 'starts_at', databaseType: 'DATETIME' }, { name: 'title', databaseType: 'VARCHAR' }],
      rows: [{ starts_at: '2030-12-12 02:00:00.000', title: '2030-12-12 02:00:00.000' }],
    } }) })
    const row = await db.one('SELECT starts_at, title FROM mip_events WHERE app_id = ?', ['test-app'])
    expect(row.starts_at.toISOString()).toBe('2030-12-12T02:00:00.000Z')
    expect(row.title).toBe('2030-12-12 02:00:00.000')
  })

  it('refreshes cached reads after a fixture mutation', async () => {
    let unread = 1
    let calls = 0
    const { db } = createReadOnlyDatabase('/unused', { readQuery: async () => {
      calls++
      return { success: true, data: { rows: [{ unread }] } }
    } })
    const query = 'SELECT COUNT(*) AS unread FROM mip_inbox_messages WHERE app_id = ?'
    expect(await db.one(query, ['test-app'])).toEqual({ unread: 1 })
    unread = 0
    expect(await db.one(query, ['test-app'])).toEqual({ unread: 1 })
    db.clearCache()
    expect(await db.one(query, ['test-app'])).toEqual({ unread: 0 })
    expect(calls).toBe(2)
  })

  it('pages large tag catalogs without changing existing bounded queries', async () => {
    const statements: string[] = []
    const { db } = createReadOnlyDatabase('/unused', {
      readQuery: async ({ sql }: { sql: string }) => {
        statements.push(sql)
        return { success: true, data: { rows: sql.endsWith('OFFSET 0') ? Array.from({ length: 100 }, (_, id) => ({ id })) : [{ id: 100 }] } }
      },
    })
    const rows = await db.query('SELECT id FROM mip_tags WHERE app_id = ? ORDER BY id', ['test-app'])
    expect(rows).toHaveLength(101)
    expect(statements).toHaveLength(2)
    expect(statements[0]).toContain('ORDER BY id LIMIT 100 OFFSET 0')
    expect(statements[1]).toContain('ORDER BY id LIMIT 100 OFFSET 100')
    await db.query('SELECT id FROM mip_tags WHERE app_id = ? ORDER BY id LIMIT 5', ['test-app'])
    expect(statements[2]).toMatch(/LIMIT 5$/)
    rows[0].id = 999
    const cached = await db.query('SELECT id FROM mip_tags WHERE app_id = ? ORDER BY id', ['test-app'])
    expect(cached[0].id).toBe(0)
    expect(statements).toHaveLength(3)
  })
})
