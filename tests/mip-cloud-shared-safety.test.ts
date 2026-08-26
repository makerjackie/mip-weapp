import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  assertFunctionSecurityRulesConverged,
  assertNoTimerTriggers,
  assertNoTriggers,
  collectTimerTriggers,
  parseFunctionSecurityRules,
  updateMipFunctionInvocationRule,
} from '../scripts/lib/cloud-function-safety.mjs'
import {
  findLockingReadPrivilegeViolations,
  findUnsafeMipSqlRelations,
} from '../scripts/lib/mip-sql-isolation.mjs'
import { RUNTIME_TABLE_PRIVILEGES } from '../scripts/lib/mysql-privilege-assert.mjs'

const root = path.resolve(import.meta.dirname, '..')
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), 'utf8')
const lockingReadDynamicRelationsByFile = {
  'cloudfunctions/mip-opportunities-api/domain/opportunities.js': {
    tableName: ['mip_opportunities', 'mip_cooperation_cards', 'mip_super_cases'],
  },
  'cloudfunctions/mip-admin-api/domain/knowledge.js': {
    table: [
      'mip_knowledge_sources',
      'mip_knowledge_categories',
      'mip_knowledge_contents',
      'mip_knowledge_products',
      'mip_content_comments',
      'mip_content_comment_reports',
    ],
  },
}

describe('shared CloudBase safety', () => {
  it('fails closed when the environment-level function rule cannot be read exactly', () => {
    expect(() => parseFunctionSecurityRules(undefined)).toThrow('unavailable')
    expect(() => parseFunctionSecurityRules('{')).toThrow('invalid')
    expect(() => parseFunctionSecurityRules(JSON.stringify({
      'another-project-api': { invoke: true },
    }))).toThrow('wildcard')
  })

  it('changes only the named MIP function rule and proves unrelated entries are unchanged', () => {
    const before = parseFunctionSecurityRules(JSON.stringify({
      '*': { invoke: 'auth != null' },
      'another-project-api': { invoke: false, metadata: { owner: 'other' } },
      'mip-outbox-worker': { invoke: false },
    }))
    const after = updateMipFunctionInvocationRule(
      before,
      'mip-identity-api',
      'auth.loginType != \'ANONYMOUS\' && auth != null',
    )

    expect(after['another-project-api']).toEqual(before['another-project-api'])
    expect(after['*']).toEqual(before['*'])
    expect(() => assertFunctionSecurityRulesConverged({
      before,
      after,
      functionName: 'mip-identity-api',
      invoke: 'auth.loginType != \'ANONYMOUS\' && auth != null',
    })).not.toThrow()

    expect(() => assertFunctionSecurityRulesConverged({
      before,
      after: {
        ...after,
        'another-project-api': { invoke: true },
      },
      functionName: 'mip-identity-api',
      invoke: 'auth.loginType != \'ANONYMOUS\' && auth != null',
    })).toThrow('unrelated shared entry')
  })

  it('rejects every timer trigger regardless of its name or nesting', () => {
    const response = {
      Response: {
        TotalCount: 2,
        Triggers: [
          { Type: 'timer', TriggerName: 'renamed-hourly-job' },
          { Type: 'cmq', TriggerName: 'queue-job' },
        ],
      },
    }
    expect(collectTimerTriggers(response)).toEqual([{ name: 'renamed-hourly-job' }])
    expect(() => assertNoTimerTriggers('mip-events-api', response)).toThrow('must not have timer')
    expect(() => assertNoTimerTriggers('mip-events-api', {
      Response: { TotalCount: 1, Triggers: [{ Type: 'cmq', TriggerName: 'queue-job' }] },
    })).not.toThrow()
    expect(() => assertNoTimerTriggers('mip-events-api', {})).toThrow('inventory is unavailable')
    expect(() => assertNoTimerTriggers('mip-events-api', {
      Response: { TotalCount: 2, Triggers: [{ Type: 'cmq', TriggerName: 'queue-job' }] },
    })).toThrow('inventory is incomplete')
  })

  it('can require an isolated Provider to have no trigger of any type', () => {
    expect(() => assertNoTriggers('mip-ai-avatar-provider', {
      Response: { TotalCount: 0, Triggers: [] },
    })).not.toThrow()
    expect(() => assertNoTriggers('mip-ai-avatar-provider', {
      Response: {
        TotalCount: 1,
        Triggers: [{ Type: 'apigw', TriggerName: 'public-provider' }],
      },
    })).toThrow('must not have triggers')
  })

  it('allows only MIP and information_schema SQL relations by default', () => {
    const dynamicSql = ['const sql = `SELECT * FROM $', '{tableName}`'].join('')
    const safe = [
      'const sql = `SELECT * FROM mip_users`',
      'const sql = `SELECT * FROM information_schema.tables`',
    ]
    for (const source of safe) {
      expect(findUnsafeMipSqlRelations(source)).toEqual([])
    }
    expect(findUnsafeMipSqlRelations('const sql = `SELECT * FROM oimvp_users`'))
      .toEqual([{ kind: 'static', relation: 'oimvp_users' }])
    expect(findUnsafeMipSqlRelations('const sql = `SELECT * FROM shared.mip_users`'))
      .toEqual([{ kind: 'static', relation: 'shared.mip_users' }])
    expect(findUnsafeMipSqlRelations('const sql = `REPLACE INTO oimvp_users (id) VALUES (?)`'))
      .toEqual([{ kind: 'static', relation: 'oimvp_users' }])
    expect(findUnsafeMipSqlRelations(dynamicSql))
      .toEqual([{ kind: 'dynamic', relation: 'tableName' }])
    expect(findUnsafeMipSqlRelations(dynamicSql, {
      allowedDynamicRelations: { tableName: ['mip_users', 'mip_profiles'] },
    })).toEqual([])
  })

  it.each([
    {
      allowedDynamicRelations: { schema: ['mip_users'] },
      label: 'dynamic schema and static table',
      relation: 'schema.mip_users',
      source: ['const sql = `SELECT * FROM $', '{schema}.mip_users`'].join(''),
    },
    {
      allowedDynamicRelations: { tableName: ['mip_users'] },
      label: 'static schema and dynamic table',
      relation: 'mip_schema.tableName',
      source: ['const sql = `SELECT * FROM mip_schema.$', '{tableName}`'].join(''),
    },
    {
      allowedDynamicRelations: { schema: ['mip_users'], tableName: ['mip_users'] },
      label: 'dynamic schema and dynamic table',
      relation: 'schema.tableName',
      source: ['const sql = `SELECT * FROM $', '{schema}.$', '{tableName}`'].join(''),
    },
    {
      allowedDynamicRelations: { 'tableFactory()': ['mip_users'] },
      label: 'dynamic table factory',
      relation: 'tableFactory()',
      source: ['const sql = `SELECT * FROM $', '{tableFactory()}`'].join(''),
    },
    {
      allowedDynamicRelations: { 'schemaFactory()': ['mip_users'] },
      label: 'dynamic schema factory and static table',
      relation: 'schemaFactory().mip_users',
      source: ['const sql = `SELECT * FROM $', '{schemaFactory()}.mip_users`'].join(''),
    },
    {
      allowedDynamicRelations: { 'tableFactory()': ['mip_users'] },
      label: 'static schema and dynamic table factory',
      relation: 'mip_schema.tableFactory()',
      source: ['const sql = `SELECT * FROM mip_schema.$', '{tableFactory()}`'].join(''),
    },
    {
      allowedDynamicRelations: { 'condition ? tableA : tableB': ['mip_users'] },
      label: 'conditional dynamic table',
      relation: 'condition ? tableA : tableB',
      source: ['const sql = `SELECT * FROM $', '{condition ? tableA : tableB}`'].join(''),
    },
    {
      allowedDynamicRelations: {
        [['tableFactory({ fallback: `mip_$', '{suffix}` })'].join('')]: ['mip_users'],
      },
      label: 'nested dynamic table expression',
      relation: ['tableFactory({ fallback: `mip_$', '{suffix}` })'].join(''),
      source: [
        'const sql = `SELECT * FROM $',
        '{tableFactory({ fallback: `mip_$',
        '{suffix}` })}`',
      ].join(''),
    },
    {
      allowedDynamicRelations: { 'schemaFactory()': ['mip_users'] },
      label: 'grant with dynamic schema factory',
      relation: 'schemaFactory().mip_users',
      source: ['const sql = `GRANT SELECT ON $', '{schemaFactory()}.mip_users TO app_user`'].join(''),
    },
  ])('rejects $label even when every variable has an allowlist', ({ allowedDynamicRelations, relation, source }) => {
    expect(findUnsafeMipSqlRelations(source, {
      allowedDynamicRelations,
    })).toEqual([{ kind: 'dynamic', relation }])
  })

  it('checks grouped relations without treating derived queries as physical tables', () => {
    const groupedDynamic = ['SELECT * FROM ($', '{tableName})'].join('')
    expect(findUnsafeMipSqlRelations(groupedDynamic, { sqlDocument: true }))
      .toEqual([{ kind: 'dynamic', relation: 'tableName' }])
    expect(findUnsafeMipSqlRelations(groupedDynamic, {
      allowedDynamicRelations: { tableName: ['mip_users'] },
      sqlDocument: true,
    })).toEqual([])
    expect(findUnsafeMipSqlRelations(['SELECT * FROM (($', '{tableName}))'].join(''), { sqlDocument: true }))
      .toEqual([{ kind: 'dynamic', relation: 'tableName' }])

    expect(findUnsafeMipSqlRelations('SELECT * FROM (oimvp_users)', { sqlDocument: true }))
      .toEqual([{ kind: 'static', relation: 'oimvp_users' }])
    for (const safeRelation of ['mip_users', 'information_schema.tables']) {
      expect(findUnsafeMipSqlRelations(`SELECT * FROM (${safeRelation})`, { sqlDocument: true }))
        .toEqual([])
    }

    expect(findUnsafeMipSqlRelations(
      'SELECT * FROM (SELECT * FROM oimvp_users) derived',
      { sqlDocument: true },
    )).toEqual([{ kind: 'static', relation: 'oimvp_users' }])
    expect(findUnsafeMipSqlRelations(
      'SELECT * FROM (WITH scoped AS (SELECT * FROM oimvp_users) SELECT * FROM scoped) derived',
      { sqlDocument: true },
    )).toEqual([{ kind: 'static', relation: 'oimvp_users' }])
  })

  it('checks comma-separated FROM relations only inside the active query block', () => {
    for (const source of [
      'SELECT * FROM mip_users, oimvp_users',
      'SELECT * FROM (mip_users, oimvp_users)',
    ]) {
      expect(findUnsafeMipSqlRelations(source, { sqlDocument: true }))
        .toEqual([{ kind: 'static', relation: 'oimvp_users' }])
    }

    for (const source of [
      'SELECT * FROM mip_users, mip_profiles',
      'SELECT * FROM (mip_users, mip_profiles)',
      'SELECT id, status FROM mip_users',
      'SELECT * FROM mip_users WHERE id IN (?, ?)',
      'SELECT \'FROM oimvp_users\' AS sample FROM mip_users',
    ]) {
      expect(findUnsafeMipSqlRelations(source, { sqlDocument: true })).toEqual([])
    }
  })

  it('strips only real MySQL comments without hiding relations inside quoted data', () => {
    for (const source of [
      'SELECT \'--\' AS marker FROM oimvp_users',
      'SELECT * FROM mip_users WHERE label = \'-- ignore\' UNION SELECT * FROM oimvp_users',
      'SELECT \'/* ignore */\' AS marker FROM oimvp_users',
      'SELECT \'#\' AS marker FROM oimvp_users',
      'SELECT 1--1 FROM oimvp_users',
    ]) {
      expect(findUnsafeMipSqlRelations(source, { sqlDocument: true }))
        .toEqual([{ kind: 'static', relation: 'oimvp_users' }])
    }

    for (const source of [
      'SELECT * FROM mip_users -- FROM oimvp_users',
      'SELECT * FROM mip_users /* FROM oimvp_users */',
      'SELECT 1 # FROM oimvp_users\nFROM mip_users',
    ]) {
      expect(findUnsafeMipSqlRelations(source, { sqlDocument: true })).toEqual([])
    }
  })

  it('keeps CTE names scoped to their own query block', () => {
    const shadowedOuterTable = `SELECT * FROM oimvp_users WHERE EXISTS (
      WITH oimvp_users AS (SELECT * FROM mip_users)
      SELECT * FROM oimvp_users
    )`
    expect(findUnsafeMipSqlRelations(shadowedOuterTable, { sqlDocument: true }))
      .toEqual([{ kind: 'static', relation: 'oimvp_users' }])

    const nestedCteOnly = `SELECT * FROM (
      WITH oimvp_users AS (SELECT * FROM mip_users)
      SELECT * FROM oimvp_users
    ) derived`
    expect(findUnsafeMipSqlRelations(nestedCteOnly, { sqlDocument: true })).toEqual([])
    expect(findUnsafeMipSqlRelations(
      'WITH scoped AS (SELECT * FROM mip_users) SELECT * FROM (SELECT * FROM scoped) derived',
      { sqlDocument: true },
    )).toEqual([])
  })

  it('fails closed on missing and split-concatenated relation targets', () => {
    const missingRelation = [{ kind: 'dynamic', relation: '<missing-relation>' }]
    for (const source of [
      'SELECT * FROM ',
      'const sql = \'SELECT * FROM\' + \' oimvp_users\'',
      'const tableName = \'oimvp_users\'; const sql = \'SELECT * FROM \' + tableName',
      'const sql = \'UPDATE \' + table + \' SET id = 1\'',
      'const sql = \'INSERT INTO \' + table + \' VALUES (?)\'',
      'const sql = \'DELETE FROM \' + table',
    ]) {
      const options = source.startsWith('SELECT') ? { sqlDocument: true } : undefined
      expect(findUnsafeMipSqlRelations(source, options)).toEqual(missingRelation)
    }

    expect(findUnsafeMipSqlRelations('const sql = \'SELECT * \' + \'FROM oimvp_users\''))
      .toEqual([{ kind: 'static', relation: 'oimvp_users' }])
    expect(findUnsafeMipSqlRelations('const sql = \'SELECT * FROM mip_users \' + \'JOIN oimvp_users legacy ON legacy.id = mip_users.id\''))
      .toEqual([{ kind: 'static', relation: 'oimvp_users' }])
    expect(findUnsafeMipSqlRelations('const sql = \'INSERT \' + \'INTO oimvp_users (id) VALUES (?)\''))
      .toEqual([{ kind: 'static', relation: 'oimvp_users' }])
  })

  it('limits GRANT, REVOKE, and trigger declarations to their ON relation', () => {
    expect(findUnsafeMipSqlRelations(
      'REVOKE SELECT ON mip_users FROM oimvp_runtime',
      { sqlDocument: true },
    )).toEqual([])
    for (const source of [
      'GRANT SELECT ON oimvp_users TO app_user',
      'REVOKE SELECT ON oimvp_users FROM app_user',
      'CREATE TRIGGER mip_trigger AFTER INSERT ON oimvp_users FOR EACH ROW SET @seen = 1',
    ]) {
      expect(findUnsafeMipSqlRelations(source, { sqlDocument: true }))
        .toEqual([{ kind: 'static', relation: 'oimvp_users' }])
    }

    expect(findUnsafeMipSqlRelations(
      'CREATE TRIGGER mip_trigger AFTER INSERT ON mip_users FOR EACH ROW BEGIN SELECT * FROM oimvp_users; END',
      { sqlDocument: true },
    )).toEqual([{ kind: 'static', relation: 'oimvp_users' }])
    expect(findUnsafeMipSqlRelations(
      'CREATE TRIGGER mip_trigger AFTER INSERT ON mip_users FOR EACH ROW UPDATE oimvp_users SET seen = 1',
      { sqlDocument: true },
    )).toEqual([{ kind: 'static', relation: 'oimvp_users' }])
    expect(findUnsafeMipSqlRelations(
      'CREATE TRIGGER mip_trigger AFTER INSERT ON mip_users FOR EACH ROW INSERT INTO mip_growth_entries SELECT user.id FROM mip_users user JOIN mip_profiles oimvp_alias ON oimvp_alias.user_id = user.id',
      { sqlDocument: true },
    )).toEqual([])
    expect(findUnsafeMipSqlRelations(
      'CREATE DEFINER=CURRENT_USER TRIGGER mip_trigger AFTER INSERT ON mip_users FOR EACH ROW UPDATE oimvp_users SET seen = 1',
      { sqlDocument: true },
    )).toEqual([{ kind: 'static', relation: 'oimvp_users' }])
    expect(findUnsafeMipSqlRelations(
      'GRANT SELECT ON TABLE mip_users TO app_user',
      { sqlDocument: true },
    )).toEqual([])
    expect(findUnsafeMipSqlRelations(
      'GRANT EXECUTE ON PROCEDURE mip_rebuild TO app_user',
      { sqlDocument: true },
    )).toEqual([])
    expect(findUnsafeMipSqlRelations(
      'GRANT EXECUTE ON PROCEDURE oimvp_rebuild TO app_user',
      { sqlDocument: true },
    )).toEqual([{ kind: 'static', relation: 'oimvp_rebuild' }])
  })

  it('checks DDL source and destination relations', () => {
    for (const source of [
      'CREATE TABLE mip_copy LIKE oimvp_users',
      'CREATE TABLE oimvp_copy LIKE mip_users',
      'CREATE TEMPORARY TABLE oimvp_temp (id BIGINT)',
      'CREATE TEMPORARY TABLE mip_copy LIKE oimvp_users',
      'ALTER TABLE mip_users RENAME TO oimvp_users',
      'ALTER TABLE oimvp_users RENAME TO mip_users',
      'ALTER TABLE mip_users EXCHANGE PARTITION p0 WITH TABLE oimvp_users',
      'DROP INDEX mip_index ON oimvp_users',
    ]) {
      expect(findUnsafeMipSqlRelations(source, { sqlDocument: true }))
        .toEqual([expect.objectContaining({ kind: 'static', relation: expect.stringContaining('oimvp_') })])
    }

    const dynamicFactory = ['$', '{tableFactory()}'].join('')
    for (const source of [
      `CREATE TABLE mip_copy LIKE ${dynamicFactory}`,
      `ALTER TABLE mip_users RENAME TO ${dynamicFactory}`,
    ]) {
      expect(findUnsafeMipSqlRelations(source, {
        allowedDynamicRelations: { 'tableFactory()': ['mip_users'] },
        sqlDocument: true,
      })).toEqual([{ kind: 'dynamic', relation: 'tableFactory()' }])
    }

    for (const source of [
      'CREATE TABLE mip_copy LIKE mip_users',
      'CREATE TEMPORARY TABLE mip_temp LIKE mip_users',
      'ALTER TABLE mip_users RENAME TO mip_users_archive',
      'ALTER TABLE mip_users EXCHANGE PARTITION p0 WITH TABLE mip_users_archive',
      'DROP INDEX mip_index ON mip_users',
      'RENAME TABLE mip_users TO mip_users_archive, mip_profiles TO mip_profiles_archive',
    ]) {
      expect(findUnsafeMipSqlRelations(source, { sqlDocument: true })).toEqual([])
    }
  })

  it('checks CREATE, ALTER, and DROP VIEW targets', () => {
    for (const source of [
      'CREATE VIEW oimvp_view AS SELECT * FROM mip_users',
      'ALTER VIEW shared.mip_view AS SELECT * FROM mip_users',
      'DROP VIEW mip_view, oimvp_view',
    ]) {
      expect(findUnsafeMipSqlRelations(source, { sqlDocument: true }))
        .toEqual([expect.objectContaining({ relation: expect.stringMatching(/^(?:oimvp_|shared\.)/) })])
    }

    const dynamicView = ['CREATE VIEW $', '{viewFactory()} AS SELECT * FROM mip_users'].join('')
    expect(findUnsafeMipSqlRelations(dynamicView, {
      allowedDynamicRelations: { 'viewFactory()': ['mip_view'] },
      sqlDocument: true,
    })).toEqual([{ kind: 'dynamic', relation: 'viewFactory()' }])
    for (const source of [
      'CREATE VIEW mip_view AS SELECT * FROM mip_users',
      'ALTER VIEW mip_view AS SELECT * FROM mip_users',
      'DROP VIEW mip_view, mip_legacy_view',
    ]) {
      expect(findUnsafeMipSqlRelations(source, { sqlDocument: true })).toEqual([])
    }
  })

  it.each([
    {
      relations: ['oimvp_users'],
      source: 'UPDATE mip_users, oimvp_users SET mip_users.updated_at = NOW()',
    },
    {
      relations: ['oimvp_users'],
      source: 'DELETE user, legacy FROM mip_users user, oimvp_users legacy WHERE user.id = legacy.id',
    },
    {
      relations: ['oimvp_users'],
      source: 'DROP TABLE mip_users, oimvp_users',
    },
    {
      relations: ['oimvp_users', 'oimvp_users_old'],
      source: 'RENAME TABLE mip_users TO mip_users_old, oimvp_users TO oimvp_users_old',
    },
    {
      relations: ['oimvp_users'],
      source: 'LOCK TABLES mip_users READ, oimvp_users WRITE',
    },
  ])('checks every physical relation in multi-target SQL: $source', ({ relations, source }) => {
    expect(findUnsafeMipSqlRelations(source, { sqlDocument: true }))
      .toEqual(relations.map(relation => ({ kind: 'static', relation })))
  })

  it('allows multi-target statements when every physical relation is MIP-owned', () => {
    for (const source of [
      'UPDATE mip_users, mip_profiles SET mip_users.updated_at = NOW()',
      'DELETE user, profile FROM mip_users user, mip_profiles profile WHERE user.id = profile.user_id',
      'DROP TABLE mip_users, mip_profiles',
      'RENAME TABLE mip_users TO mip_users_old, mip_profiles TO mip_profiles_old',
      'LOCK TABLES mip_users READ, mip_profiles WRITE',
    ]) {
      expect(findUnsafeMipSqlRelations(source, { sqlDocument: true })).toEqual([])
    }
  })

  it('treats CTE names as statement-local relations and still checks their sources', () => {
    const safeCte = `const sql = \`WITH comment_fact AS (
      SELECT * FROM mip_content_comments
    ), responsible_users AS (
      SELECT * FROM comment_fact
    ) SELECT * FROM responsible_users\``
    expect(findUnsafeMipSqlRelations(safeCte)).toEqual([])

    const unsafeSource = 'const sql = `WITH comment_fact AS (SELECT * FROM oimvp_users) SELECT * FROM comment_fact`'
    expect(findUnsafeMipSqlRelations(unsafeSource))
      .toEqual([{ kind: 'static', relation: 'oimvp_users' }])

    const quotedWith = 'const sql = `SELECT \'WITH oimvp_users AS (SELECT 1)\' FROM oimvp_users`'
    expect(findUnsafeMipSqlRelations(quotedWith))
      .toEqual([{ kind: 'static', relation: 'oimvp_users' }])

    const separateStatement = `const sql = \`WITH comment_fact AS (
      SELECT * FROM mip_content_comments
    ) SELECT * FROM comment_fact; SELECT * FROM comment_fact\``
    expect(findUnsafeMipSqlRelations(separateStatement))
      .toEqual([{ kind: 'static', relation: 'comment_fact' }])
  })

  it('checks locking reads against direct query-block relations and exact runtime grants', () => {
    const auditedFactTables = [
      'mip_agreement_acceptances',
      'mip_blind_box_draws',
      'mip_event_checkin_transitions',
      'mip_growth_entries',
      'mip_matching_feedback',
      'mip_matching_requests',
      'mip_message_campaign_recipients',
    ]
    const violations = auditedFactTables.flatMap(relation => findLockingReadPrivilegeViolations(
      `SELECT id FROM ${relation} WHERE app_id = ? FOR UPDATE`,
      RUNTIME_TABLE_PRIVILEGES,
      { sqlDocument: true },
    ))
    expect(violations.map(item => item.relation).sort()).toEqual([...auditedFactTables].sort())
    expect(violations.every(item => item.missingPrivileges.includes('UPDATE|DELETE'))).toBe(true)

    for (const relation of ['mip_user_badge_equipment', 'mip_task_level_rules']) {
      expect(findLockingReadPrivilegeViolations(
        `SELECT id FROM ${relation} FOR UPDATE`,
        RUNTIME_TABLE_PRIVILEGES,
        { sqlDocument: true },
      )).toEqual([])
    }
    expect(findLockingReadPrivilegeViolations(
      'SELECT user.id FROM mip_users user JOIN mip_task_completions completion ON completion.user_id = user.id FOR UPDATE',
      RUNTIME_TABLE_PRIVILEGES,
      { sqlDocument: true },
    ).map(item => item.relation)).toEqual(['mip_task_completions'])
    expect(findLockingReadPrivilegeViolations(
      'SELECT id FROM mip_synthetic_lock FOR SHARE',
      { mip_synthetic_lock: ['SELECT'] },
      { sqlDocument: true },
    )).toEqual([])
    expect(findLockingReadPrivilegeViolations(
      'SELECT id FROM mip_synthetic_lock FOR UPDATE',
      { mip_synthetic_lock: ['SELECT', 'LOCK TABLES'] },
      { sqlDocument: true },
    )[0]?.missingPrivileges).toEqual(['UPDATE|DELETE'])
    expect(findLockingReadPrivilegeViolations(
      'SELECT id FROM mip_synthetic_lock LOCK IN SHARE MODE',
      { mip_synthetic_lock: ['UPDATE'] },
      { sqlDocument: true },
    )[0]?.missingPrivileges).toEqual(['SELECT'])
    expect(findLockingReadPrivilegeViolations(
      'SELECT id FROM mip_synthetic_lock LOCK IN SHARE MODE',
      { mip_synthetic_lock: ['SELECT'] },
      { sqlDocument: true },
    )).toEqual([])
    expect(Object.values(RUNTIME_TABLE_PRIVILEGES).flat()).not.toContain('LOCK TABLES')

    const nestedDynamicTemplate = [
      'const sql = `SELECT id FROM mip_task_completions WHERE $',
      '{condition ? `id = $',
      '{value}` : \'1 = 1\'} FOR UPDATE`',
    ].join('')
    expect(findLockingReadPrivilegeViolations(
      nestedDynamicTemplate,
      RUNTIME_TABLE_PRIVILEGES,
    ).map(item => item.relation)).toEqual(['mip_task_completions'])
  })

  it('fails closed on detached, concatenated, and escaped locking clauses without treating SQL data as a lock', () => {
    const detachedClause = 'const lockClause = lock ? \' FOR UPDATE\' : \'\''
    expect(findLockingReadPrivilegeViolations(
      detachedClause,
      RUNTIME_TABLE_PRIVILEGES,
    )).toEqual([expect.objectContaining({
      clause: 'FOR UPDATE',
      missingPrivileges: ['LOCKING_READ_QUERY_CONTEXT'],
      relation: '<unbound-locking-clause>',
    })])

    const concatenatedSuffix = 'const sql = \'SELECT id FROM mip_users\' + \' FOR UPDATE\''
    expect(findLockingReadPrivilegeViolations(
      concatenatedSuffix,
      RUNTIME_TABLE_PRIVILEGES,
    )).toEqual([expect.objectContaining({
      missingPrivileges: ['LOCKING_READ_QUERY_CONTEXT'],
    })])

    const escapedLock = [
      'const sql = \'SELECT id FROM mip_growth_entries FOR',
      '\\u0020',
      'UPDATE\'',
    ].join('')
    expect(findLockingReadPrivilegeViolations(
      escapedLock,
      RUNTIME_TABLE_PRIVILEGES,
    )).toEqual([expect.objectContaining({
      relation: 'mip_growth_entries',
      missingPrivileges: ['UPDATE|DELETE'],
    })])

    const sqlDataLiteral = 'const sql = "SELECT id FROM mip_growth_entries WHERE label = \'FOR UPDATE\'"'
    expect(findLockingReadPrivilegeViolations(
      sqlDataLiteral,
      RUNTIME_TABLE_PRIVILEGES,
    )).toEqual([])
    expect(findLockingReadPrivilegeViolations(
      'SELECT `FOR UPDATE` AS label FROM mip_users',
      RUNTIME_TABLE_PRIVILEGES,
      { sqlDocument: true },
    )).toEqual([])
  })

  it('keeps grouped joins in the outer block and supports alias-scoped locking reads', () => {
    const groupedQueries = [
      `SELECT user.id FROM mip_users user
       STRAIGHT_JOIN mip_growth_entries fact ON fact.user_id = user.id
       FOR UPDATE`,
      `SELECT user.id FROM (mip_users user
       JOIN mip_growth_entries fact ON fact.user_id = user.id)
       FOR UPDATE`,
      `SELECT user.id FROM mip_users user
       LEFT JOIN (mip_growth_entries fact, mip_matching_feedback feedback)
         ON fact.user_id = user.id
       FOR UPDATE`,
    ]
    expect(groupedQueries.map(query => findLockingReadPrivilegeViolations(
      query,
      RUNTIME_TABLE_PRIVILEGES,
      { sqlDocument: true },
    ).map(item => item.relation).sort())).toEqual([
      ['mip_growth_entries'],
      ['mip_growth_entries'],
      ['mip_growth_entries', 'mip_matching_feedback'],
    ])

    const scopedQuery = `SELECT user.id FROM mip_users user
      JOIN mip_growth_entries fact ON fact.user_id = user.id
      FOR UPDATE OF user`
    expect(findLockingReadPrivilegeViolations(
      scopedQuery,
      RUNTIME_TABLE_PRIVILEGES,
      { sqlDocument: true },
    )).toEqual([])
    expect(findLockingReadPrivilegeViolations(
      scopedQuery.replace('OF user', 'OF fact'),
      RUNTIME_TABLE_PRIVILEGES,
      { sqlDocument: true },
    )).toEqual([expect.objectContaining({ relation: 'mip_growth_entries' })])
    expect(findLockingReadPrivilegeViolations(
      scopedQuery.replace('FOR UPDATE OF user', 'FOR SHARE OF fact'),
      RUNTIME_TABLE_PRIVILEGES,
      { sqlDocument: true },
    )).toEqual([])
    expect(findLockingReadPrivilegeViolations(
      scopedQuery.replace('OF user', 'OF missing_alias'),
      RUNTIME_TABLE_PRIVILEGES,
      { sqlDocument: true },
    )).toEqual([expect.objectContaining({
      missingPrivileges: ['LOCKING_READ_ALIAS'],
      relation: 'OF missing_alias',
    })])

    const dynamicScopedLock = [
      'const sql = `SELECT user.id FROM mip_users user ',
      'JOIN mip_growth_entries fact ON fact.user_id = user.id$',
      '{lock ? \' FOR UPDATE OF user\' : \'\'}`',
    ].join('')
    expect(findLockingReadPrivilegeViolations(
      dynamicScopedLock,
      RUNTIME_TABLE_PRIVILEGES,
    )).toEqual([])
    expect(findLockingReadPrivilegeViolations(
      dynamicScopedLock.replace('OF user', 'OF fact'),
      RUNTIME_TABLE_PRIVILEGES,
    )).toEqual([expect.objectContaining({ relation: 'mip_growth_entries' })])
    const alternativeDynamicLocks = dynamicScopedLock.replace(
      'lock ? \' FOR UPDATE OF user\' : \'\'',
      'lock ? \' FOR SHARE OF user\' : \' FOR UPDATE OF fact\'',
    )
    expect(findLockingReadPrivilegeViolations(
      alternativeDynamicLocks,
      RUNTIME_TABLE_PRIVILEGES,
    )).toEqual([expect.objectContaining({
      clause: 'FOR UPDATE',
      relation: 'mip_growth_entries',
    })])

    const mixedLockingClauses = `SELECT fact.id
      FROM mip_growth_entries fact, mip_users user
      FOR UPDATE OF fact FOR SHARE OF user`
    expect(findLockingReadPrivilegeViolations(
      mixedLockingClauses,
      RUNTIME_TABLE_PRIVILEGES,
      { sqlDocument: true },
    )).toEqual([expect.objectContaining({
      clause: 'FOR UPDATE',
      missingPrivileges: ['UPDATE|DELETE'],
      relation: 'mip_growth_entries',
    })])
    expect(findLockingReadPrivilegeViolations(
      mixedLockingClauses.replace('FOR UPDATE OF fact FOR SHARE OF user', 'FOR SHARE OF user FOR UPDATE OF fact'),
      RUNTIME_TABLE_PRIVILEGES,
      { sqlDocument: true },
    )).toEqual([expect.objectContaining({
      clause: 'FOR UPDATE',
      relation: 'mip_growth_entries',
    })])
  })

  it('fails closed on qualified dynamic relations and unsupported locking CTEs', () => {
    const qualifiedDynamicRelation = [
      'const sql = `SELECT id FROM tenant.$',
      '{tableName} FOR UPDATE`',
    ].join('')
    expect(findLockingReadPrivilegeViolations(
      qualifiedDynamicRelation,
      RUNTIME_TABLE_PRIVILEGES,
      { allowedDynamicRelations: { tableName: ['mip_users'] } },
    )).toEqual([expect.objectContaining({
      missingPrivileges: ['DYNAMIC_RELATION_ALLOWLIST'],
      relation: ['tenant.$', '{tableName}'].join(''),
    })])

    const lockingCte = `WITH locked_users AS (
      SELECT id FROM mip_users
    )
    SELECT id FROM locked_users FOR UPDATE`
    expect(findLockingReadPrivilegeViolations(
      lockingCte,
      RUNTIME_TABLE_PRIVILEGES,
      { sqlDocument: true },
    )).toEqual([expect.objectContaining({
      missingPrivileges: ['LOCKING_READ_CTE'],
      relation: '<cte>',
    })])

    const derivedLock = `SELECT derived.id FROM (
      SELECT id FROM mip_users
    ) derived FOR UPDATE`
    expect(findLockingReadPrivilegeViolations(
      derivedLock,
      RUNTIME_TABLE_PRIVILEGES,
      { sqlDocument: true },
    )).toEqual([expect.objectContaining({
      missingPrivileges: ['LOCKING_READ_DERIVED_RELATION'],
      relation: '<derived-relation>',
    })])
  })

  it('does not project an outer locking clause into nested query blocks', () => {
    const mediaSource = read('cloudfunctions/mip-media-api/domain/service.js')
    expect(findLockingReadPrivilegeViolations(
      mediaSource,
      RUNTIME_TABLE_PRIVILEGES,
    )).toEqual([])

    const mediaShape = `SELECT asset.id FROM mip_media_assets asset
      WHERE NOT EXISTS (
        SELECT 1 FROM mip_task_completions completion
        WHERE completion.app_id = asset.app_id
      )
      FOR UPDATE SKIP LOCKED`
    expect(findLockingReadPrivilegeViolations(
      mediaShape,
      RUNTIME_TABLE_PRIVILEGES,
      { sqlDocument: true },
    )).toEqual([])

    const nestedLock = mediaShape.replace(
      'WHERE completion.app_id = asset.app_id',
      'WHERE completion.app_id = asset.app_id FOR UPDATE',
    )
    expect(findLockingReadPrivilegeViolations(
      nestedLock,
      RUNTIME_TABLE_PRIVILEGES,
      { sqlDocument: true },
    ).map(item => item.relation)).toEqual(['mip_task_completions'])
  })

  it('expands direct dynamic locking-read relations through file-scoped allowlists', () => {
    const dynamicLockingRead = [
      'const sql = `SELECT id FROM $',
      '{table} WHERE app_id = ? FOR UPDATE`',
    ].join('')
    const violations = findLockingReadPrivilegeViolations(
      dynamicLockingRead,
      RUNTIME_TABLE_PRIVILEGES,
      {
        allowedDynamicRelations: {
          table: ['mip_users', 'mip_growth_entries'],
        },
      },
    )
    expect(violations.map(item => item.relation)).toEqual(['mip_growth_entries'])
    expect(violations[0]?.dynamicRelation).toBe('table')

    expect(findLockingReadPrivilegeViolations(
      dynamicLockingRead,
      RUNTIME_TABLE_PRIVILEGES,
    )).toEqual([expect.objectContaining({
      dynamicRelation: 'table',
      missingPrivileges: ['DYNAMIC_RELATION_ALLOWLIST'],
      relation: ['$', '{table}'].join(''),
    })])

    const conditionalRelation = [
      'const sql = `SELECT id FROM $',
      '{condition ? tableA : tableB} WHERE app_id = ? FOR UPDATE`',
    ].join('')
    expect(findLockingReadPrivilegeViolations(
      conditionalRelation,
      RUNTIME_TABLE_PRIVILEGES,
      {
        allowedDynamicRelations: {
          'condition ? tableA : tableB': ['mip_users'],
        },
      },
    )).toEqual([expect.objectContaining({
      dynamicRelation: 'condition ? tableA : tableB',
      missingPrivileges: ['DYNAMIC_RELATION_ALLOWLIST'],
    })])

    const factoryJoin = [
      'const sql = `SELECT user.id FROM mip_users user JOIN $',
      '{tableFactory()} fact ON fact.user_id = user.id FOR UPDATE`',
    ].join('')
    expect(findLockingReadPrivilegeViolations(
      factoryJoin,
      RUNTIME_TABLE_PRIVILEGES,
    )).toEqual([expect.objectContaining({
      dynamicRelation: 'tableFactory()',
      missingPrivileges: ['DYNAMIC_RELATION_ALLOWLIST'],
    })])

    for (const [file, allowedDynamicRelations] of Object.entries(lockingReadDynamicRelationsByFile)) {
      expect(findLockingReadPrivilegeViolations(
        read(file),
        RUNTIME_TABLE_PRIVILEGES,
        { allowedDynamicRelations },
      )).toEqual([])
    }
  })

  it('wires full timer checks, disabled-payment retirement, and fail-closed permission updates', () => {
    const coreDeploy = read('scripts/deploy-functions.mjs')
    const paymentDeploy = read('scripts/deploy-payment-function.mjs')
    const cloudVerify = read('scripts/verify-cloud.mjs')
    const isolation = read('scripts/mip-isolation-check.mjs')
    const sourceVerification = read('scripts/verify-source.mjs')

    for (const source of [coreDeploy, paymentDeploy]) {
      expect(source).toContain('parseFunctionSecurityRules(text)')
      expect(source).toContain('assertFunctionSecurityRulesConverged')
      expect(source).toContain('assertNoFunctionTimers')
      expect(source).toContain('Limit: 100, Offset: 0')
      expect(source).not.toContain('rules = { \'*\':')
    }
    expect(coreDeploy).toMatch(/paymentMode === 'disabled'[\s\S]*disableClientInvocation\(functionName\)/)
    expect(coreDeploy.indexOf('paymentMode === \'disabled\''))
      .toBeLessThan(coreDeploy.indexOf('const requiredTables'))
    expect(coreDeploy).toContain('planExistingFunctionConfigurationUpdate({')
    expect(coreDeploy).toMatch(/configuration already current[\s\S]*action: 'updateFunctionCode'/)
    expect(coreDeploy).toContain('assertExistingFunctionAfterConfiguration({')
    expect(coreDeploy).toContain('assertExistingFunctionAfterCode({')
    expect(coreDeploy).toContain('assertFunctionConfigurationReadback(spec.name, expectedConfiguration, detail)')
    expect(cloudVerify).toMatch(/else \{[\s\S]*assertClientInvocationDisabled\(functionName\)[\s\S]*assertNoFunctionTimers\(functionName\)/)
    expect(cloudVerify).toContain('assertNoFunctionTimers(spec.name)')
    expect(cloudVerify).toContain('coreDetails.get(\'growth\')')
    expect(cloudVerify).toContain('coreDetails.get(\'notification\')')
    expect(cloudVerify).toContain('variables.MIP_NOTIFICATION_HMAC_SECRET !== notificationVariables.MIP_NOTIFICATION_HMAC_SECRET')
    expect(cloudVerify).toContain('variables.MIP_GROWTH_HMAC_SECRET !== growthVariables.MIP_GROWTH_HMAC_SECRET')
    expect(cloudVerify).toContain('assertOutboxDependencies(coreDetails.get(\'outbox\'))')
    expect(cloudVerify).toContain('action: \'probeDependencies\'')
    expect(cloudVerify).toContain('notificationAuthenticated !== true')
    expect(cloudVerify).toContain('growthAuthenticated !== true')
    expect(isolation).toContain('findUnsafeMipSqlRelations')
    expect(sourceVerification).toContain('findLockingReadPrivilegeViolations')
    expect(sourceVerification).toContain('for (const sourceFile of functionSourceFiles)')
    expect(sourceVerification).toContain('allowedDynamicRelations: lockingReadDynamicRelationAllowlist[normalizedSourceFile]')
    for (const [file, variables] of Object.entries(lockingReadDynamicRelationsByFile)) {
      for (const source of [isolation, sourceVerification]) {
        expect(source).toContain(`'${file}'`)
        for (const [variable, tables] of Object.entries(variables)) {
          expect(source).toContain(`${variable}:`)
          for (const table of tables) {
            expect(source).toContain(`'${table}'`)
          }
        }
      }
    }
  })
})
