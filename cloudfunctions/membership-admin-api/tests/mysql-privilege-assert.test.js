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
    assert.doesNotMatch(deploySource, /ALTER USER/)
    assert.doesNotMatch(deploySource, /REVOKE ALL PRIVILEGES, GRANT OPTION FROM/)
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

  it('forbids every privilege on an unmapped shared table when rejectExtra is set', async () => {
    const { assertTablePrivilegePairs } = await import(helperUrl)
    const map = {
      mip_users: ['SELECT'],
    }
    const rows = [
      { tableName: 'mip_users', privilegeType: 'SELECT' },
      { tableName: 'member_profiles', privilegeType: 'SELECT' },
    ]
    assert.throws(
      () => assertTablePrivilegePairs(rows, map, undefined, { rejectExtra: true }),
      /forbidden SELECT on unmapped table member_profiles/,
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
        assert.match(sql, /mip_profile_tags|mip_opportunity_roles|mip_opportunity_tags|mip_super_case_media/)
      }
    }
    assert.ok(statements.some(sql => sql.includes('mip_audit_logs') && sql.includes('SELECT, INSERT')))
    assert.ok(statements.some(sql => sql.includes('mip_outbox_events')))
    assert.ok(statements.some(sql => sql.includes('mip_event_seat_holds')))
    assert.ok(statements.some(sql => sql.includes('mip_profile_tags') && sql.includes('DELETE')))
    assert.ok(statements.some(sql => sql.includes('mip_opportunity_roles') && sql.includes('DELETE')))
    assert.ok(statements.some(sql => sql.includes('mip_opportunity_tags') && sql.includes('DELETE')))
    assert.ok(statements.some(sql => sql.includes('mip_super_case_media') && sql.includes('DELETE')))
    const byTable = Object.fromEntries(statements.map(sql => {
      const match = sql.match(/^GRANT ([A-Z, ]+) ON `member_db`\.`([^`]+)`/)
      return match ? [match[2], match[1].split(', ')] : []
    }).filter(entry => entry.length))
    assert.deepEqual(byTable.mip_agreement_acceptances, ['SELECT', 'INSERT'])
    assert.deepEqual(byTable.mip_membership_attributions, ['SELECT', 'INSERT'])
    assert.deepEqual(byTable.mip_tags, ['SELECT'])
    assert.deepEqual(byTable.mip_membership_plans, ['SELECT'])
    assert.deepEqual(byTable.mip_event_checkin_transitions, ['SELECT', 'INSERT'])
    assert.equal('mip_app_settings' in byTable, false)
  })

  it('derives a stable environment-unique account and revokes only observed owned-table grants', async () => {
    const {
      buildRuntimeRevokeStatements,
      parseGrantee,
      runtimeUserForEnvironment,
    } = await import(helperUrl)
    const first = runtimeUserForEnvironment('environment-one')
    const second = runtimeUserForEnvironment('environment-two')
    assert.match(first, /^mip_[0-9a-f]{12}$/)
    assert.notEqual(first, second)
    assert.equal(runtimeUserForEnvironment('environment-one'), first)
    const account = parseGrantee(first, '%')
    const statements = buildRuntimeRevokeStatements('mip_schema', account, [
      { tableSchema: 'mip_schema', tableName: 'mip_users', privilegeType: 'UPDATE' },
      { tableSchema: 'mip_schema', tableName: 'mip_users', privilegeType: 'SELECT' },
      { tableSchema: 'other_schema', tableName: 'mip_users', privilegeType: 'SELECT' },
    ])
    assert.deepEqual(statements, [
      `REVOKE SELECT, UPDATE ON \`mip_schema\`.\`mip_users\` FROM ${account}`,
    ])
  })

  it('refuses existing or cross-schema runtime account ownership that cannot be proved', async () => {
    const { assertRuntimeAccountClaimable, parseGrantee } = await import(helperUrl)
    const grantee = parseGrantee('mip_deadbeef0000', '%')
    const usage = [{ tableName: null, privilegeType: 'USAGE', grantee }]
    assert.throws(() => assertRuntimeAccountClaimable({
      userRows: usage, schema: 'mip_schema', grantee, allowExisting: false,
    }), /already exists/)
    assert.throws(() => assertRuntimeAccountClaimable({
      tableRows: [{
        tableSchema: 'other_schema', tableName: 'mip_users', privilegeType: 'SELECT', grantee,
      }],
      userRows: usage,
      schema: 'mip_schema',
      grantee,
      allowExisting: true,
    }), /outside the owned MIP table set/)
    assert.throws(() => assertRuntimeAccountClaimable({
      schema: 'mip_schema', grantee, allowExisting: true,
    }), /could not be verified/)
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
