import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  assertMembershipChainInvariant,
  assertMembershipChainReconcileConfirmation,
  MIP_MEMBERSHIP_CHAIN_INVARIANT_SQL,
  MIP_MEMBERSHIP_CHAIN_RECONCILE_SQL,
  parseMembershipChainInvariant,
} from '../scripts/lib/membership-chain-reconcile.mjs'
import { RUNTIME_TABLE_PRIVILEGES } from '../scripts/lib/mysql-privilege-assert.mjs'

const root = path.resolve(import.meta.dirname, '..')
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), 'utf8')
const migration = read('database/mysql/mip/046_membership_adjustments.sql')
const rollback = read('database/mysql/mip/rollback/046_membership_adjustments.sql')

describe('membership chains and manual adjustments foundation', () => {
  it('locks migration 046 with the fixed identity and checksums', () => {
    const lock = JSON.parse(read('database/mysql/mip/migrations.lock.json')) as {
      migrations: Array<Record<string, unknown>>
    }
    const entry = lock.migrations.find(item => item.name === 'mip_membership_adjustments')
    const sha256 = (value: string) => createHash('sha256').update(value).digest('hex')

    expect(entry).toMatchObject({
      version: '20260826460000',
      createsTables: ['mip_membership_chains', 'mip_membership_adjustments'],
      altersTables: ['mip_membership_entitlements'],
      sqlSha256: sha256(migration),
      rollbackSha256: sha256(rollback),
    })
  })

  it('creates an app-scoped version chain and backfills every existing user', () => {
    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS mip_membership_chains/)
    expect(migration).toMatch(/PRIMARY KEY \(app_id, user_id\)/)
    expect(migration).toMatch(/mip_membership_chains_user_fk[\s\S]*REFERENCES mip_users \(app_id, id\)/)
    expect(migration).toMatch(/version BIGINT UNSIGNED NOT NULL DEFAULT 1/)
    expect(migration).toMatch(/mip_membership_chains_version_ck CHECK \(version >= 1\)/)
    expect(migration).toMatch(/created_at DATETIME\(3\)[\s\S]*updated_at DATETIME\(3\)/)
    expect(migration).toMatch(/INSERT INTO mip_membership_chains[\s\S]*SELECT[\s\S]*FROM mip_users membership_user/)
    expect(migration).not.toMatch(/membership_user\.status/)
    expect(migration).toContain('ON DUPLICATE KEY UPDATE user_id = mip_membership_chains.user_id')
    expect(migration).not.toMatch(/INSERT\s+IGNORE/i)
  })

  it('keeps adjustments immutable, constrained, and linked to one target chain', () => {
    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS mip_membership_adjustments/)
    expect(migration).toMatch(/duration_months TINYINT UNSIGNED NOT NULL/)
    expect(migration).toContain('duration_months IN (1, 3, 6, 12)')
    expect(migration).toContain('CHAR_LENGTH(TRIM(reason)) BETWEEN 1 AND 300')
    expect(migration).toContain(`request_hash REGEXP '^[0-9a-f]{64}$'`)
    expect(migration).toContain('result_chain_version = expected_chain_version + 1')
    expect(migration).toMatch(/UNIQUE KEY mip_membership_adjustments_request_uk \(app_id, actor_user_id, idempotency_key\)/)
    expect(migration).toMatch(/UNIQUE KEY mip_membership_adjustments_user_id_uk \(app_id, user_id, id\)/)
    expect(migration).toMatch(/mip_membership_adjustments_chain_fk[\s\S]*REFERENCES mip_membership_chains \(app_id, user_id\)/)
    expect(migration).toMatch(/mip_membership_adjustments_actor_fk[\s\S]*REFERENCES mip_users \(app_id, id\)/)
    expect(migration).not.toMatch(/CREATE\s+TRIGGER/i)
  })

  it('enforces mutually exclusive order and admin-adjustment entitlement sources', () => {
    expect(migration).toMatch(/MODIFY COLUMN order_id[\s\S]*NULL/)
    expect(migration).toMatch(/MODIFY COLUMN plan_id[\s\S]*NULL/)
    expect(migration).toContain(`NOT NULL DEFAULT 'ORDER'`)
    expect(migration).toContain(`source_type IN ('ORDER', 'ADMIN_ADJUSTMENT')`)
    expect(migration).toMatch(/source_type = 'ORDER'[\s\S]*order_id IS NOT NULL[\s\S]*plan_id IS NOT NULL[\s\S]*source_adjustment_id IS NULL/)
    expect(migration).toMatch(/source_type = 'ADMIN_ADJUSTMENT'[\s\S]*order_id IS NULL[\s\S]*plan_id IS NULL[\s\S]*source_adjustment_id IS NOT NULL/)
    expect(migration).toMatch(/FOREIGN KEY \(app_id, user_id, source_adjustment_id\)[\s\S]*REFERENCES mip_membership_adjustments \(app_id, user_id, id\)/)
    expect(migration).toMatch(/UNIQUE KEY mip_membership_entitlements_adjustment_uk \(app_id, source_adjustment_id\)/)
  })

  it('fails rollback closed on every manual fact while allowing auto-chain removal', () => {
    expect(rollback).toContain('mip_membership_adjustments_rollback_guard')
    expect(rollback).toMatch(/SELECT 1 FROM mip_membership_adjustments LIMIT 1/)
    expect(rollback).toContain(`WHERE source_type <> 'ORDER'`)
    expect(rollback).toContain('WHERE order_id IS NULL OR plan_id IS NULL')
    expect(rollback).toContain('WHERE source_adjustment_id IS NOT NULL')
    expect(rollback).not.toMatch(/SELECT 1 FROM mip_membership_chains/)
    expect(rollback).toMatch(/DROP TABLE IF EXISTS mip_membership_adjustments;\s*DROP TABLE IF EXISTS mip_membership_chains;/)
  })

  it('grants only the minimum runtime privileges and no adjustment mutation privilege', () => {
    expect(RUNTIME_TABLE_PRIVILEGES.mip_membership_chains).toEqual(['SELECT', 'INSERT', 'UPDATE'])
    expect(RUNTIME_TABLE_PRIVILEGES.mip_membership_adjustments).toEqual(['SELECT', 'INSERT'])
    expect(RUNTIME_TABLE_PRIVILEGES.mip_membership_adjustments).not.toContain('UPDATE')
    expect(RUNTIME_TABLE_PRIVILEGES.mip_membership_adjustments).not.toContain('DELETE')
  })

  it('puts chain creation directly after user creation and keeps lazy catch-up idempotent', () => {
    const repository = read('cloudfunctions/mip-identity-api/domain/repository.js')
    const userInsert = repository.indexOf('INSERT INTO mip_users (id, app_id, status)')
    const directChainInsert = repository.indexOf('INSERT INTO mip_membership_chains (', userInsert)
    const identityInsert = repository.indexOf('INSERT INTO mip_user_identities (', userInsert)

    expect(userInsert).toBeGreaterThan(-1)
    expect(directChainInsert).toBeGreaterThan(userInsert)
    expect(directChainInsert).toBeLessThan(identityInsert)
    expect(repository).toMatch(/async function ensureMembershipChain[\s\S]*INSERT INTO mip_membership_chains[\s\S]*SELECT[\s\S]*ON DUPLICATE KEY UPDATE/)
    expect(repository).not.toMatch(/INSERT\s+IGNORE/i)
  })

  it('adds demo chains without a new fixture group and verifies their records', () => {
    const seed = read('scripts/seed-demo.mjs')
    expect(seed).toContain(`'mip_membership_chains'`)
    expect(seed).toMatch(/userStatement\(seed\.users\),\s*membershipChainStatement\(seed\.users\)/)
    expect(seed).toContain('AS membershipChains')
    expect(seed).toContain('membershipChains: seed.users.length')
    expect(seed).toContain('membershipChainUserIds: value.users.map(item => item.id)')
    expect(seed).toContain('mip_membership_chains: value.users.map(item => ({ userId: item.id }))')
    expect(seed).toContain(`'ORDER', NULL, 'ACTIVE'`)
    expect(seed).not.toMatch(/INSERT\s+IGNORE/i)
  })

  it('requires exact reconcile confirmations and converges only the two MIP tables', () => {
    expect(() => assertMembershipChainReconcileConfirmation({
      envId: 'env-1',
      confirmedEnv: 'env-2',
      confirmedPrefix: 'mip_',
    })).toThrow('--confirm-env')
    expect(() => assertMembershipChainReconcileConfirmation({
      envId: 'env-1',
      confirmedEnv: 'env-1',
      confirmedPrefix: 'member_',
    })).toThrow('--confirm-prefix=mip_')
    expect(assertMembershipChainReconcileConfirmation({
      envId: 'env-1',
      confirmedEnv: 'env-1',
      confirmedPrefix: 'mip_',
    })).toEqual({ envId: 'env-1', tablePrefix: 'mip_' })

    const relations = [...MIP_MEMBERSHIP_CHAIN_RECONCILE_SQL.matchAll(/\b(?:INTO|FROM)\s+(\w+)/gi)]
      .map(match => match[1])
    expect(new Set(relations)).toEqual(new Set(['mip_membership_chains', 'mip_users']))
    expect(MIP_MEMBERSHIP_CHAIN_RECONCILE_SQL).toContain('ON DUPLICATE KEY UPDATE')
    expect(MIP_MEMBERSHIP_CHAIN_RECONCILE_SQL).not.toMatch(/INSERT\s+IGNORE|DELETE\s+FROM/i)
    expect(MIP_MEMBERSHIP_CHAIN_INVARIANT_SQL).not.toMatch(/\bINSERT\b|\bUPDATE\b|\bDELETE\b/i)
  })

  it('parses and fails closed on missing or orphan membership chains', () => {
    const response = { data: [{ userCount: '3', chainCount: '3', missingChains: '0', orphanChains: '0' }] }
    expect(parseMembershipChainInvariant(response)).toEqual({
      userCount: 3,
      chainCount: 3,
      missingChains: 0,
      orphanChains: 0,
    })
    expect(assertMembershipChainInvariant(response).chainCount).toBe(3)
    expect(() => assertMembershipChainInvariant({
      userCount: 3,
      chainCount: 2,
      missingChains: 1,
      orphanChains: 0,
    })).toThrow('1:1')
    expect(() => assertMembershipChainInvariant({
      userCount: 3,
      chainCount: 4,
      missingChains: 0,
      orphanChains: 1,
    })).toThrow('1:1')
  })

  it('keeps cloud verification read-only and exposes the explicit operation command', () => {
    const verifyCloud = read('scripts/verify-cloud.mjs')
    const packageJson = JSON.parse(read('package.json')) as { scripts: Record<string, string> }
    expect(verifyCloud).toContain('assertMembershipChainInvariant')
    expect(verifyCloud).toContain('MIP_MEMBERSHIP_CHAIN_INVARIANT_SQL')
    expect(verifyCloud).not.toContain('manageMysqlDatabase')
    expect(packageJson.scripts['membership:chains:reconcile'])
      .toBe('node scripts/reconcile-membership-chains.mjs')
  })
})
