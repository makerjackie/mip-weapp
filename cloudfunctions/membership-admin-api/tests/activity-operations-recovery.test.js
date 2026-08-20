'use strict'

const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { describe, it } = require('node:test')

const schemaUrl = pathToFileURL(path.join(__dirname, '..', '..', '..', 'scripts', 'lib', 'activity-operations-schema.mjs')).href

describe('002 activity operations object contract', () => {
  it('exposes exactly 18 expected object keys and 18 ensure statements', async () => {
    const {
      ACTIVITY_OPERATION_ENSURE_STATEMENTS,
      expectedObjectKeys,
      normalizeCheckClause,
    } = await import(schemaUrl)
    const keys = expectedObjectKeys()
    assert.equal(keys.length, 18)
    assert.equal(ACTIVITY_OPERATION_ENSURE_STATEMENTS.length, 18)
    assert.ok(keys.includes('column:member_events.venue_name'))
    assert.ok(keys.includes('index:member_registrations.member_registrations_ticket_uk'))
    assert.ok(keys.includes('check:member_registrations_cancelled_by_type_ck'))
    assert.equal(
      normalizeCheckClause(
        '((`cancelled_by_type` is null) or (`cancelled_by_type` in (_utf8mb4\\\'MEMBER\\\',_utf8mb4\\\'EVENT\\\',_utf8mb4\\\'SYSTEM\\\')))',
      ).replace(/[()]/g, '').replace(/\s+/g, ''),
      normalizeCheckClause(
        '(cancelled_by_type is null or cancelled_by_type in (\'member\',\'event\',\'system\'))',
      ).replace(/[()]/g, '').replace(/\s+/g, ''),
    )
  })

  it('recovers partial 002 objects and fails incompatible definitions', async () => {
    const {
      ACTIVITY_OPERATION_CHECK_CLAUSES,
      ensureActivityOperations,
      inspectActivityOperations,
    } = await import(schemaUrl)

    const presentColumns = new Map([
      ['member_events', new Map([
        ['venue_name', {
          name: 'venue_name',
          dataType: 'varchar',
          characterMaximumLength: 120,
          isNullable: 'NO',
          columnDefault: '',
        }],
      ])],
      ['member_registrations', new Map()],
    ])
    const presentIndexes = new Map()
    const presentChecks = new Map()
    const applied = []

    const connection = {
      async execute(sql, params = []) {
        if (sql.includes('information_schema.columns')) {
          const table = params[0]
          const rows = [...(presentColumns.get(table)?.values() || [])]
          return [rows]
        }
        if (sql.includes('information_schema.statistics')) {
          const key = `${params[0]}.${params[1]}`
          return [presentIndexes.get(key) || []]
        }
        if (sql.includes('information_schema.table_constraints') || sql.includes('check_constraints')) {
          return [[...presentChecks.entries()].map(([name, checkClause]) => ({ name, checkClause }))]
        }
        return [[]]
      },
      async query(sql) {
        applied.push(sql)
        if (sql.includes('ADD COLUMN venue_name')) {
          presentColumns.get('member_events').set('venue_name', {
            name: 'venue_name', dataType: 'varchar', characterMaximumLength: 120, isNullable: 'NO', columnDefault: '',
          })
        }
        if (sql.includes('ADD COLUMN cancellation_policy')) {
          presentColumns.get('member_events').set('cancellation_policy', {
            name: 'cancellation_policy', dataType: 'varchar', characterMaximumLength: 1000, isNullable: 'NO', columnDefault: '',
          })
        }
        if (sql.includes('ADD COLUMN cancelled_at') && sql.includes('member_events')) {
          presentColumns.get('member_events').set('cancelled_at', {
            name: 'cancelled_at', dataType: 'datetime', characterMaximumLength: null, isNullable: 'YES', columnDefault: null,
          })
        }
        if (sql.includes('ADD COLUMN cancelled_by') && sql.includes('member_events')) {
          presentColumns.get('member_events').set('cancelled_by', {
            name: 'cancelled_by', dataType: 'varchar', characterMaximumLength: 128, isNullable: 'YES', columnDefault: null,
          })
        }
        if (sql.includes('ADD COLUMN cancellation_reason') && sql.includes('member_events')) {
          presentColumns.get('member_events').set('cancellation_reason', {
            name: 'cancellation_reason', dataType: 'varchar', characterMaximumLength: 500, isNullable: 'YES', columnDefault: null,
          })
        }
        if (sql.includes('ADD COLUMN version') && sql.includes('member_events')) {
          presentColumns.get('member_events').set('version', {
            name: 'version', dataType: 'int', characterMaximumLength: null, isNullable: 'NO', columnDefault: '1',
          })
        }
        if (sql.includes('member_events_version_ck')) {
          presentChecks.set('member_events_version_ck', ACTIVITY_OPERATION_CHECK_CLAUSES.member_events_version_ck)
        }
        if (sql.includes('ADD COLUMN ticket_code')) {
          presentColumns.get('member_registrations').set('ticket_code', {
            name: 'ticket_code', dataType: 'varchar', characterMaximumLength: 32, isNullable: 'YES', columnDefault: null,
          })
        }
        if (sql.includes('ADD COLUMN attended_at')) {
          presentColumns.get('member_registrations').set('attended_at', {
            name: 'attended_at', dataType: 'datetime', characterMaximumLength: null, isNullable: 'YES', columnDefault: null,
          })
        }
        if (sql.includes('ADD COLUMN attended_by')) {
          presentColumns.get('member_registrations').set('attended_by', {
            name: 'attended_by', dataType: 'varchar', characterMaximumLength: 128, isNullable: 'YES', columnDefault: null,
          })
        }
        if (sql.includes('ADD COLUMN cancelled_at') && sql.includes('member_registrations')) {
          presentColumns.get('member_registrations').set('cancelled_at', {
            name: 'cancelled_at', dataType: 'datetime', characterMaximumLength: null, isNullable: 'YES', columnDefault: null,
          })
        }
        if (sql.includes('ADD COLUMN cancelled_by_type')) {
          presentColumns.get('member_registrations').set('cancelled_by_type', {
            name: 'cancelled_by_type', dataType: 'varchar', characterMaximumLength: 16, isNullable: 'YES', columnDefault: null,
          })
        }
        if (sql.includes('ADD COLUMN cancellation_reason') && sql.includes('member_registrations')) {
          presentColumns.get('member_registrations').set('cancellation_reason', {
            name: 'cancellation_reason', dataType: 'varchar', characterMaximumLength: 500, isNullable: 'YES', columnDefault: null,
          })
        }
        if (sql.includes('ADD COLUMN version') && sql.includes('member_registrations')) {
          presentColumns.get('member_registrations').set('version', {
            name: 'version', dataType: 'int', characterMaximumLength: null, isNullable: 'NO', columnDefault: '1',
          })
        }
        if (sql.includes('member_registrations_version_ck')) {
          presentChecks.set(
            'member_registrations_version_ck',
            ACTIVITY_OPERATION_CHECK_CLAUSES.member_registrations_version_ck,
          )
        }
        if (sql.includes('member_registrations_cancelled_by_type_ck')) {
          presentChecks.set(
            'member_registrations_cancelled_by_type_ck',
            ACTIVITY_OPERATION_CHECK_CLAUSES.member_registrations_cancelled_by_type_ck,
          )
        }
        if (sql.includes('member_registrations_ticket_uk')) {
          presentIndexes.set('member_registrations.member_registrations_ticket_uk', [
            { name: 'member_registrations_ticket_uk', nonUnique: 0, columnName: 'app_id', seq: 1 },
            { name: 'member_registrations_ticket_uk', nonUnique: 0, columnName: 'ticket_code', seq: 2 },
          ])
        }
        if (sql.includes('member_registrations_roster_idx')) {
          presentIndexes.set('member_registrations.member_registrations_roster_idx', [
            { name: 'member_registrations_roster_idx', nonUnique: 1, columnName: 'app_id', seq: 1 },
            { name: 'member_registrations_roster_idx', nonUnique: 1, columnName: 'event_id', seq: 2 },
            { name: 'member_registrations_roster_idx', nonUnique: 1, columnName: 'status', seq: 3 },
            { name: 'member_registrations_roster_idx', nonUnique: 1, columnName: 'registered_at', seq: 4 },
            { name: 'member_registrations_roster_idx', nonUnique: 1, columnName: 'id', seq: 5 },
          ])
        }
        return [{ affectedRows: 1 }]
      },
    }

    const before = await inspectActivityOperations(connection)
    assert.equal(before.partial, true)
    assert.ok(before.missing.length > 0)

    const recovery = await ensureActivityOperations(connection)
    assert.equal(recovery.action, 'recovered')
    assert.ok(recovery.applied.length >= 10)
    assert.equal(recovery.state.complete, true)
    assert.equal(applied.length, recovery.applied.length)

    presentColumns.get('member_events').set('venue_name', {
      name: 'venue_name', dataType: 'text', characterMaximumLength: null, isNullable: 'YES', columnDefault: '',
    })
    await assert.rejects(
      () => ensureActivityOperations(connection),
      /incompatible definitions/,
    )
  })
})
