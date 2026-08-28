import { describe, expect, it } from 'vitest'
import {
  assertImportSqlKeepsForeignKeysEnforced,
  assertMipImportValidationEvidence,
  assertTargetMipDataTablesEmpty,
  buildMipAppScopeImportPlan,
  buildMipImportValidationContract,
  digestPrimaryKeyInventory,
  MIP_IMPORT_SELF_REFERENCE_TABLES,
  normalizeForeignKeyRows,
  orderSelfReferentialRows,
} from '../scripts/lib/mip-app-scope-import-plan.mjs'

const tables = [
  'mip_users',
  'mip_city_branches',
  'mip_branch_memberships',
  'mip_message_campaigns',
  'mip_message_campaign_dispatches',
  'mip_content_comments',
  'mip_event_checkin_transitions',
  'mip_tags',
]

const primaryKeys: Record<string, string[]> = {
  mip_users: ['id'],
  mip_city_branches: ['id'],
  mip_branch_memberships: ['app_id', 'branch_id', 'user_id'],
  mip_message_campaigns: ['id'],
  mip_message_campaign_dispatches: ['id'],
  mip_content_comments: ['app_id', 'id'],
  mip_event_checkin_transitions: ['id'],
  mip_tags: ['id'],
}

const pointerNullability: Record<string, Record<string, boolean>> = {
  mip_users: { primary_branch_id: true },
  mip_message_campaigns: { active_dispatch_id: true },
}

function fk(
  constraintName: string,
  childTable: string,
  parentTable: string,
  pairs: string[][],
) {
  return pairs.map(([childColumn, parentColumn], index) => ({
    constraintName,
    childTable,
    childColumn,
    parentTable,
    parentColumn,
    ordinalPosition: index + 1,
  }))
}

function metadata() {
  return {
    tableRows: [...tables.map(TABLE_NAME => ({ TABLE_NAME })), { TABLE_NAME: 'other_project_users' }],
    columnRows: tables.flatMap(tableName => [
      { tableName, columnName: 'app_id', isNullable: 'NO' },
      ...primaryKeys[tableName]
        .filter(columnName => columnName !== 'app_id')
        .map(columnName => ({ tableName, columnName, isNullable: 'NO' })),
      ...Object.entries(pointerNullability[tableName] ?? {})
        .map(([columnName, nullable]) => ({
          tableName,
          columnName,
          isNullable: nullable ? 'YES' : 'NO',
        })),
    ]),
    primaryKeyRows: tables.flatMap(tableName => primaryKeys[tableName].map(
      (columnName, index) => ({
        tableName,
        constraintName: 'PRIMARY',
        columnName,
        ordinalPosition: index + 1,
      }),
    )),
    foreignKeyRows: [
      ...fk('mip_users_primary_branch_fk', 'mip_users', 'mip_branch_memberships', [
        ['app_id', 'app_id'],
        ['primary_branch_id', 'branch_id'],
        ['id', 'user_id'],
      ]),
      ...fk('mip_city_branches_creator_fk', 'mip_city_branches', 'mip_users', [
        ['app_id', 'app_id'],
        ['created_by_user_id', 'id'],
      ]),
      ...fk('mip_branch_memberships_branch_fk', 'mip_branch_memberships', 'mip_city_branches', [
        ['app_id', 'app_id'],
        ['branch_id', 'id'],
      ]),
      ...fk('mip_branch_memberships_user_fk', 'mip_branch_memberships', 'mip_users', [
        ['app_id', 'app_id'],
        ['user_id', 'id'],
      ]),
      ...fk('mip_message_campaigns_creator_fk', 'mip_message_campaigns', 'mip_users', [
        ['app_id', 'app_id'],
        ['created_by_user_id', 'id'],
      ]),
      ...fk('mip_message_campaigns_active_dispatch_fk', 'mip_message_campaigns', 'mip_message_campaign_dispatches', [
        ['app_id', 'app_id'],
        ['id', 'campaign_id'],
        ['active_dispatch_id', 'id'],
      ]),
      ...fk('mip_message_campaign_dispatches_campaign_fk', 'mip_message_campaign_dispatches', 'mip_message_campaigns', [
        ['app_id', 'app_id'],
        ['campaign_id', 'id'],
      ]),
      ...fk('mip_content_comments_parent_fk', 'mip_content_comments', 'mip_content_comments', [
        ['app_id', 'app_id'],
        ['parent_comment_id', 'id'],
      ]),
      ...fk('mip_event_checkin_transitions_reversal_fk', 'mip_event_checkin_transitions', 'mip_event_checkin_transitions', [
        ['app_id', 'app_id'],
        ['reversal_of_transition_id', 'id'],
      ]),
      ...fk('mip_tags_parent_fk', 'mip_tags', 'mip_tags', [
        ['app_id', 'app_id'],
        ['parent_id', 'id'],
      ]),
    ],
  }
}

function zeroCounts() {
  return Object.fromEntries(tables.map(table => [table, 0]))
}

describe('MIP AppID import planning', () => {
  it('accepts raw information_schema snake-case rows and skips non-FK key inventory rows', () => {
    expect(normalizeForeignKeyRows([
      {
        constraint_name: 'PRIMARY',
        table_name: 'mip_users',
        column_name: 'id',
        ordinal_position: 1,
        referenced_table_name: null,
        referenced_column_name: null,
      },
      {
        constraint_name: 'mip_profiles_user_fk',
        table_name: 'mip_profiles',
        column_name: 'app_id',
        ordinal_position: 1,
        referenced_table_name: 'mip_users',
        referenced_column_name: 'app_id',
      },
      {
        constraint_name: 'mip_profiles_user_fk',
        table_name: 'mip_profiles',
        column_name: 'user_id',
        ordinal_position: 2,
        referenced_table_name: 'mip_users',
        referenced_column_name: 'id',
      },
    ])).toMatchObject([{
      childTable: 'mip_profiles',
      parentTable: 'mip_users',
      columns: [
        { childColumn: 'app_id', parentColumn: 'app_id' },
        { childColumn: 'user_id', parentColumn: 'id' },
      ],
    }])
  })

  it('derives parent-first table order and staged pointer restores without disabling foreign keys', () => {
    const plan = buildMipAppScopeImportPlan({
      ...metadata(),
      targetRowCounts: zeroCounts(),
    })

    expect(plan.scope).toBe('MIP_APP_ID_ONLY')
    expect(plan.foreignKeyMode).toBe('ENFORCED_FOR_ALL_PHASES')
    expect(plan.tables).not.toContain('other_project_users')
    expect(plan.importOrder.indexOf('mip_users'))
      .toBeLessThan(plan.importOrder.indexOf('mip_city_branches'))
    expect(plan.importOrder.indexOf('mip_city_branches'))
      .toBeLessThan(plan.importOrder.indexOf('mip_branch_memberships'))
    expect(plan.importOrder.indexOf('mip_message_campaigns'))
      .toBeLessThan(plan.importOrder.indexOf('mip_message_campaign_dispatches'))

    expect(plan.pointerRestores).toMatchObject([
      {
        table: 'mip_users',
        deferredColumns: ['primary_branch_id'],
        importValue: null,
      },
      {
        table: 'mip_message_campaigns',
        deferredColumns: ['active_dispatch_id'],
        importValue: null,
      },
    ])
    expect(plan.phases.map(phase => phase.kind)).toEqual([
      'PRECONDITION',
      'INSERT',
      'RESTORE_POINTERS',
      'VERIFY',
    ])
    expect(plan.phases[0].requirement).toBe('EVERY_TARGET_MIP_DATA_TABLE_EMPTY')
    expect(plan.selfReferences.map(item => item.table).sort())
      .toEqual([...MIP_IMPORT_SELF_REFERENCE_TABLES])
    expect(plan.selfReferences.every(item => item.strategy === 'parent-row-first')).toBe(true)
  })

  it('refuses a non-empty or incompletely attested target AppID scope', () => {
    expect(() => assertTargetMipDataTablesEmpty({
      tables,
      targetRowCounts: { ...zeroCounts(), mip_users: 1 },
    })).toThrow('not empty: mip_users')

    const incomplete = zeroCounts()
    delete incomplete.mip_users
    expect(() => buildMipAppScopeImportPlan({
      ...metadata(),
      targetRowCounts: incomplete,
    })).toThrow('evidence is missing for mip_users')
  })

  it('rejects unmodelled cycles, cross-project parents and attempts to change FOREIGN_KEY_CHECKS', () => {
    const base = metadata()
    const unresolvedCycle = [
      ...base.foreignKeyRows,
      ...fk('mip_users_unexpected_campaign_fk', 'mip_users', 'mip_message_campaigns', [
        ['app_id', 'app_id'],
        ['campaign_id', 'id'],
      ]),
    ]
    expect(() => buildMipAppScopeImportPlan({
      ...base,
      foreignKeyRows: unresolvedCycle,
      targetRowCounts: zeroCounts(),
    })).toThrow('Unresolved MIP foreign-key cycle')

    expect(() => normalizeForeignKeyRows(fk(
      'mip_users_legacy_fk',
      'mip_users',
      'member_users',
      [['legacy_id', 'id']],
    ))).toThrow('outside the MIP namespace')
    expect(() => assertImportSqlKeepsForeignKeysEnforced('SET FOREIGN_KEY_CHECKS = 0'))
      .toThrow('must not change FOREIGN_KEY_CHECKS')
    expect(() => assertImportSqlKeepsForeignKeysEnforced('INSERT INTO mip_users VALUES (?)'))
      .not
      .toThrow()
  })

  it('orders each supported self-reference parent-first and rejects orphan or cyclic rows', () => {
    const ordered = orderSelfReferentialRows({
      rows: [
        { app_id: 'target', id: 'grandchild', parent_id: 'child' },
        { app_id: 'target', id: 'root', parent_id: null },
        { app_id: 'target', id: 'child', parent_id: 'root' },
      ],
      childColumns: ['app_id', 'parent_id'],
      parentColumns: ['app_id', 'id'],
    })
    expect(ordered.map(row => row.id)).toEqual(['root', 'child', 'grandchild'])

    expect(() => orderSelfReferentialRows({
      rows: [{ app_id: 'target', id: 'child', parent_id: 'missing' }],
      childColumns: ['app_id', 'parent_id'],
      parentColumns: ['app_id', 'id'],
    })).toThrow('orphan parent pointer')
    expect(() => orderSelfReferentialRows({
      rows: [
        { app_id: 'target', id: 'a', parent_id: 'b' },
        { app_id: 'target', id: 'b', parent_id: 'a' },
      ],
      childColumns: ['app_id', 'parent_id'],
      parentColumns: ['app_id', 'id'],
    })).toThrow('contains a cycle')
  })
})

describe('MIP import verification contract', () => {
  it('covers row counts, logical primary keys, every foreign key and source-AppID residue', () => {
    const contract = buildMipImportValidationContract(metadata())

    expect(contract.rowCounts).toHaveLength(tables.length)
    expect(contract.primaryKeys).toHaveLength(tables.length)
    expect(contract.orphans).toHaveLength(10)
    expect(contract.sourceAppIdResiduals).toHaveLength(tables.length)
    expect(contract.primaryKeys.find(item => item.table === 'mip_branch_memberships')?.columns)
      .toEqual(['branch_id', 'user_id'])
    expect(contract.orphans[0].target.sql).toContain('LEFT JOIN')
    expect(contract.orphans[0].target.sql).toContain('orphan_count')
    expect(contract.sourceAppIdResiduals.every(item => item.target.bind === 'SOURCE_APP_ID'))
      .toBe(true)
  })

  it('accepts only complete matching evidence and detects every verification failure class', () => {
    const contract = buildMipImportValidationContract(metadata())
    const evidence = {
      rowCounts: Object.fromEntries(tables.map(table => [table, { source: 1, target: 1 }])),
      primaryKeys: Object.fromEntries(contract.primaryKeys.map(check => [
        check.table,
        {
          source: [Object.fromEntries(check.columns.map(column => [column, `${column}-1`]))],
          target: [Object.fromEntries(check.columns.map(column => [column, `${column}-1`]))],
        },
      ])),
      orphans: Object.fromEntries(contract.orphans.map(check => [check.constraintName, 0])),
      sourceAppIdResiduals: Object.fromEntries(tables.map(table => [table, 0])),
    }

    expect(() => assertMipImportValidationEvidence(contract, evidence)).not.toThrow()
    expect(() => assertMipImportValidationEvidence(contract, {
      ...evidence,
      rowCounts: { ...evidence.rowCounts, mip_users: { source: 1, target: 0 } },
    })).toThrow('Row-count verification failed for mip_users')
    expect(() => assertMipImportValidationEvidence(contract, {
      ...evidence,
      primaryKeys: {
        ...evidence.primaryKeys,
        mip_users: { source: [{ id: 'one' }], target: [{ id: 'two' }] },
      },
    })).toThrow('Primary-key verification failed for mip_users')
    expect(() => assertMipImportValidationEvidence(contract, {
      ...evidence,
      orphans: { ...evidence.orphans, mip_tags_parent_fk: 1 },
    })).toThrow('Orphan verification failed for mip_tags_parent_fk')
    expect(() => assertMipImportValidationEvidence(contract, {
      ...evidence,
      sourceAppIdResiduals: { ...evidence.sourceAppIdResiduals, mip_users: 1 },
    })).toThrow('Source AppID residue remains in mip_users')
  })

  it('builds stable order-independent primary-key digests and rejects duplicate evidence', () => {
    expect(digestPrimaryKeyInventory([
      { id: 'b' },
      { id: 'a' },
    ], ['id'])).toBe(digestPrimaryKeyInventory([
      { id: 'a' },
      { id: 'b' },
    ], ['id']))
    expect(() => digestPrimaryKeyInventory([{ id: 'a' }, { id: 'a' }], ['id']))
      .toThrow('duplicate keys')
  })
})
