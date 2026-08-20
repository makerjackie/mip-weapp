'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { describe, it } = require('node:test')

const helperUrl = pathToFileURL(
  path.join(__dirname, '..', '..', '..', 'scripts', 'lib', 'mysql-privilege-assert.mjs'),
).href

function fullRuntimeRows(privilegesMap) {
  const rows = []
  for (const [table, privileges] of Object.entries(privilegesMap)) {
    for (const privilegeType of privileges) {
      rows.push({ tableName: table, privilegeType })
    }
  }
  return rows
}

describe('assertTablePrivilegePairs', () => {
  it('deploy applies every runtime-account DCL statement individually', () => {
    const deploySource = fs.readFileSync(
      path.join(__dirname, '..', '..', '..', 'scripts', 'deploy-functions.mjs'),
      'utf8',
    )
    assert.match(deploySource, /function runMysqlStatements\(statements\)/)
    assert.match(deploySource, /action:\s*'runStatement'/)
    assert.doesNotMatch(deploySource, /action:\s*'initializeSchema'/)
  })

  it('passes when every exact table×privilege pair is present', async () => {
    const { assertTablePrivilegePairs, RUNTIME_TABLE_PRIVILEGES } = await import(helperUrl)
    const rows = fullRuntimeRows(RUNTIME_TABLE_PRIVILEGES)
    const result = assertTablePrivilegePairs(rows, RUNTIME_TABLE_PRIVILEGES)
    assert.equal(result.ok, true)
  })

  it('fails when a required privilege is missing', async () => {
    const { assertTablePrivilegePairs } = await import(helperUrl)
    const map = {
      member_export_tickets: ['SELECT', 'INSERT', 'UPDATE'],
      member_mutation_idempotency: ['SELECT', 'INSERT'],
    }
    const rows = [
      { tableName: 'member_export_tickets', privilegeType: 'SELECT' },
      { tableName: 'member_export_tickets', privilegeType: 'INSERT' },
      // missing UPDATE
      { tableName: 'member_mutation_idempotency', privilegeType: 'SELECT' },
      { tableName: 'member_mutation_idempotency', privilegeType: 'INSERT' },
    ]
    assert.throws(
      () => assertTablePrivilegePairs(rows, map),
      /missing grant on member_export_tickets for privilege UPDATE/,
    )
  })

  it('rejects schema-level ALL PRIVILEGES as a pass', async () => {
    const { assertTablePrivilegePairs } = await import(helperUrl)
    const map = {
      member_export_tickets: ['SELECT', 'INSERT', 'UPDATE'],
    }
    const rows = [
      { tableName: null, privilegeType: 'ALL PRIVILEGES' },
    ]
    assert.throws(
      () => assertTablePrivilegePairs(rows, map),
      /must not rely on schema-level ALL PRIVILEGES/,
    )
  })

  it('rejects cross-table false positives', async () => {
    const { assertTablePrivilegePairs } = await import(helperUrl)
    const map = {
      member_export_tickets: ['SELECT'],
      member_mutation_idempotency: ['SELECT'],
    }
    const rows = [
      { tableName: 'member_export_tickets', privilegeType: 'SELECT' },
    ]
    assert.throws(
      () => assertTablePrivilegePairs(rows, map),
      /member_mutation_idempotency/,
    )
  })

  it('forbids DELETE/UPDATE on audit when rejectExtra is set', async () => {
    const { assertTablePrivilegePairs } = await import(helperUrl)
    const map = {
      member_audit_logs: ['SELECT', 'INSERT'],
    }
    const rows = [
      { tableName: 'member_audit_logs', privilegeType: 'SELECT' },
      { tableName: 'member_audit_logs', privilegeType: 'INSERT' },
      { tableName: 'member_audit_logs', privilegeType: 'DELETE' },
    ]
    assert.throws(
      () => assertTablePrivilegePairs(rows, map, undefined, { rejectExtra: true }),
      /forbidden DELETE on member_audit_logs/,
    )
  })

  it('forbids extra DELETE on non-audit tables when rejectExtra is set', async () => {
    const { assertTablePrivilegePairs } = await import(helperUrl)
    const map = {
      member_export_tickets: ['SELECT', 'INSERT', 'UPDATE'],
    }
    const rows = [
      { tableName: 'member_export_tickets', privilegeType: 'SELECT' },
      { tableName: 'member_export_tickets', privilegeType: 'INSERT' },
      { tableName: 'member_export_tickets', privilegeType: 'UPDATE' },
      { tableName: 'member_export_tickets', privilegeType: 'DELETE' },
    ]
    assert.throws(
      () => assertTablePrivilegePairs(rows, map, undefined, { rejectExtra: true }),
      /forbidden DELETE on member_export_tickets/,
    )
  })

  it('buildRuntimeGrantStatements emits DELETE only for scoped relationship/lease tables', async () => {
    const { buildRuntimeGrantStatements } = await import(helperUrl)
    const statements = buildRuntimeGrantStatements('member_db', '`member_runtime`@\'%\'')
    assert.ok(statements.length > 0)
    for (const sql of statements) {
      assert.doesNotMatch(sql, /\bALL\b/)
      assert.match(sql, /^GRANT /)
      if (/\bDELETE\b/.test(sql)) {
        assert.match(sql, /member_follows|member_checkin_credentials|member_notifications|member_notification_subscriptions|member_notification_outbox|member_operational_failures|member_blocks/)
      }
    }
    assert.ok(statements.some(sql => sql.includes('member_audit_logs') && sql.includes('SELECT, INSERT')))
    assert.ok(statements.some(sql => sql.includes('member_media_cleanup_outbox')))
    assert.ok(statements.some(sql => sql.includes('member_event_reservations')))
    assert.ok(statements.some(sql => sql.includes('member_follows') && sql.includes('DELETE')))
    assert.ok(statements.some(sql => sql.includes('member_checkin_credentials') && sql.includes('DELETE')))
    assert.ok(statements.some(sql => sql.includes('member_notifications') && sql.includes('DELETE')))
    assert.ok(statements.some(sql => sql.includes('member_blocks') && sql.includes('DELETE')))
  })

  it('parsePrivilegeRows walks nested MCP envelopes and captures grantee/level', async () => {
    const { parsePrivilegeRows, assertTablePrivilegePairs } = await import(helperUrl)
    const envelope = {
      data: {
        resultSet: {
          rows: [
            { TABLE_NAME: 'member_export_tickets', PRIVILEGE_TYPE: 'SELECT', GRANTEE: '\'member_runtime\'@\'%\'' },
            { table_name: 'member_export_tickets', privilege_type: 'INSERT', grantee: '\'member_runtime\'@\'%\'' },
            { tableName: 'member_export_tickets', privilegeType: 'UPDATE', grantee: '\'member_runtime\'@\'%\'' },
            { tableName: 'member_mutation_idempotency', privilegeType: 'SELECT', grantee: '\'member_runtime\'@\'%\'' },
            { tableName: 'member_mutation_idempotency', privilegeType: 'INSERT', grantee: '\'member_runtime\'@\'%\'' },
          ],
        },
      },
    }
    const rows = parsePrivilegeRows(envelope)
    assert.equal(rows.length, 5)
    assert.equal(rows[0].grantee, '\'member_runtime\'@\'%\'')
    assert.equal(rows[0].level, 'table')
    assertTablePrivilegePairs(rows, {
      member_export_tickets: ['SELECT', 'INSERT', 'UPDATE'],
      member_mutation_idempotency: ['SELECT', 'INSERT'],
    })
  })
})

describe('parseGrantee and exact grantee matching', () => {
  it('builds exact MySQL grantee form', async () => {
    const { parseGrantee } = await import(helperUrl)
    assert.equal(parseGrantee('member_runtime', '%'), '\'member_runtime\'@\'%\'')
    assert.equal(parseGrantee('member_runtime', 'localhost'), '\'member_runtime\'@\'localhost\'')
  })

  it('rejects wrong host and similar account names', async () => {
    const { parseGrantee, granteesMatchExact } = await import(helperUrl)
    const expected = parseGrantee('member_runtime', '%')
    assert.equal(granteesMatchExact(expected, expected), true)
    assert.equal(granteesMatchExact(parseGrantee('member_runtime', 'localhost'), expected), false)
    assert.equal(granteesMatchExact(parseGrantee('member_runtime_extra', '%'), expected), false)
    assert.equal(granteesMatchExact(parseGrantee('member_runtim', '%'), expected), false)
    assert.equal(granteesMatchExact('member_runtime@%', expected), false)
    assert.equal(granteesMatchExact(null, expected), false)
  })

  it('does not treat similar grantee rows as satisfying exact required map', async () => {
    const { assertTablePrivilegePairs, parseGrantee } = await import(helperUrl)
    const expected = parseGrantee('member_runtime', '%')
    const map = {
      member_export_tickets: ['SELECT', 'INSERT', 'UPDATE'],
    }
    const rows = [
      {
        tableName: 'member_export_tickets',
        privilegeType: 'SELECT',
        grantee: parseGrantee('member_runtime_extra', '%'),
      },
      {
        tableName: 'member_export_tickets',
        privilegeType: 'INSERT',
        grantee: parseGrantee('member_runtime_extra', '%'),
      },
      {
        tableName: 'member_export_tickets',
        privilegeType: 'UPDATE',
        grantee: parseGrantee('member_runtime_extra', '%'),
      },
      {
        tableName: 'member_export_tickets',
        privilegeType: 'SELECT',
        grantee: parseGrantee('member_runtime', 'localhost'),
      },
      {
        tableName: 'member_export_tickets',
        privilegeType: 'INSERT',
        grantee: parseGrantee('member_runtime', 'localhost'),
      },
      {
        tableName: 'member_export_tickets',
        privilegeType: 'UPDATE',
        grantee: parseGrantee('member_runtime', 'localhost'),
      },
    ]
    assert.throws(
      () => assertTablePrivilegePairs(rows, map, undefined, { grantee: expected }),
      /missing grant on member_export_tickets/,
    )
  })
})

describe('assertRuntimePrivilegesExact', () => {
  it('passes full map with exact privileges and clean schema/global probes', async () => {
    const {
      assertRuntimePrivilegesExact,
      parseGrantee,
      RUNTIME_TABLE_PRIVILEGES,
    } = await import(helperUrl)
    const grantee = parseGrantee('member_runtime', '%')
    const tableRows = fullRuntimeRows(RUNTIME_TABLE_PRIVILEGES).map(row => ({
      ...row,
      grantee,
    }))
    const result = assertRuntimePrivilegesExact({
      tableRows,
      schemaRows: [],
      userRows: [{ privilegeType: 'USAGE', grantee }],
      requiredMap: RUNTIME_TABLE_PRIVILEGES,
      grantee,
    })
    assert.equal(result.ok, true)
  })

  it('fails when a required privilege is missing', async () => {
    const { assertRuntimePrivilegesExact, parseGrantee } = await import(helperUrl)
    const grantee = parseGrantee('member_runtime', '%')
    const map = {
      member_export_tickets: ['SELECT', 'INSERT', 'UPDATE'],
    }
    assert.throws(
      () => assertRuntimePrivilegesExact({
        tableRows: [
          { tableName: 'member_export_tickets', privilegeType: 'SELECT', grantee },
          { tableName: 'member_export_tickets', privilegeType: 'INSERT', grantee },
        ],
        schemaRows: [],
        userRows: [],
        requiredMap: map,
        grantee,
      }),
      /missing grant on member_export_tickets for privilege UPDATE/,
    )
  })

  it('fails on schema-level ALL', async () => {
    const { assertRuntimePrivilegesExact, parseGrantee } = await import(helperUrl)
    const grantee = parseGrantee('member_runtime', '%')
    const map = {
      member_export_tickets: ['SELECT', 'INSERT', 'UPDATE'],
    }
    assert.throws(
      () => assertRuntimePrivilegesExact({
        tableRows: [
          { tableName: 'member_export_tickets', privilegeType: 'SELECT', grantee },
          { tableName: 'member_export_tickets', privilegeType: 'INSERT', grantee },
          { tableName: 'member_export_tickets', privilegeType: 'UPDATE', grantee },
        ],
        schemaRows: [{ tableName: null, privilegeType: 'ALL PRIVILEGES', grantee, level: 'schema' }],
        userRows: [],
        requiredMap: map,
        grantee,
      }),
      /must not rely on schema-level ALL PRIVILEGES/,
    )
  })

  it('fails on global / user-level ALL', async () => {
    const { assertRuntimePrivilegesExact, parseGrantee } = await import(helperUrl)
    const grantee = parseGrantee('member_runtime', '%')
    const map = {
      member_export_tickets: ['SELECT', 'INSERT', 'UPDATE'],
    }
    assert.throws(
      () => assertRuntimePrivilegesExact({
        tableRows: [
          { tableName: 'member_export_tickets', privilegeType: 'SELECT', grantee },
          { tableName: 'member_export_tickets', privilegeType: 'INSERT', grantee },
          { tableName: 'member_export_tickets', privilegeType: 'UPDATE', grantee },
        ],
        schemaRows: [],
        userRows: [{ privilegeType: 'ALL PRIVILEGES', grantee, level: 'global' }],
        requiredMap: map,
        grantee,
      }),
      /must not have global ALL PRIVILEGES/,
    )
  })

  it('fails on extra DELETE for non-audit tables', async () => {
    const { assertRuntimePrivilegesExact, parseGrantee } = await import(helperUrl)
    const grantee = parseGrantee('member_runtime', '%')
    const map = {
      member_export_tickets: ['SELECT', 'INSERT', 'UPDATE'],
    }
    assert.throws(
      () => assertRuntimePrivilegesExact({
        tableRows: [
          { tableName: 'member_export_tickets', privilegeType: 'SELECT', grantee },
          { tableName: 'member_export_tickets', privilegeType: 'INSERT', grantee },
          { tableName: 'member_export_tickets', privilegeType: 'UPDATE', grantee },
          { tableName: 'member_export_tickets', privilegeType: 'DELETE', grantee },
        ],
        schemaRows: [],
        userRows: [],
        requiredMap: map,
        grantee,
      }),
      /forbidden DELETE on member_export_tickets/,
    )
  })

  it('ignores privileges belonging only to wrong host or similar accounts', async () => {
    const { assertRuntimePrivilegesExact, parseGrantee } = await import(helperUrl)
    const grantee = parseGrantee('member_runtime', '%')
    const map = {
      member_export_tickets: ['SELECT'],
    }
    assert.throws(
      () => assertRuntimePrivilegesExact({
        tableRows: [
          {
            tableName: 'member_export_tickets',
            privilegeType: 'SELECT',
            grantee: parseGrantee('member_runtime', 'localhost'),
          },
          {
            tableName: 'member_export_tickets',
            privilegeType: 'SELECT',
            grantee: parseGrantee('member_runtime_x', '%'),
          },
        ],
        schemaRows: [],
        userRows: [],
        requiredMap: map,
        grantee,
      }),
      /missing grant on member_export_tickets for privilege SELECT/,
    )
  })
})
