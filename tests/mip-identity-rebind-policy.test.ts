import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolvePhoneMigrationRebindEnabled } from '../scripts/lib/mip-identity-rebind-policy.mjs'

const root = path.resolve(import.meta.dirname, '..')

describe('phone migration rebind deployment policy', () => {
  it('allows the explicit switch only in test and staging', () => {
    expect(resolvePhoneMigrationRebindEnabled('true', 'test')).toBe(true)
    expect(resolvePhoneMigrationRebindEnabled(' TRUE ', 'staging')).toBe(true)
    expect(() => resolvePhoneMigrationRebindEnabled('true', 'development')).toThrow('test or staging')
    expect(() => resolvePhoneMigrationRebindEnabled('true', 'production')).toThrow('test or staging')
  })

  it('defaults to disabled in every deployment stage', () => {
    for (const stage of ['development', 'test', 'staging', 'production']) {
      expect(resolvePhoneMigrationRebindEnabled('', stage)).toBe(false)
      expect(resolvePhoneMigrationRebindEnabled('false', stage)).toBe(false)
    }
  })

  it('injects the switch into the identity role only', async () => {
    const source = await import('node:fs/promises').then(fs => fs.readFile(
      new URL('../scripts/deploy-functions.mjs', import.meta.url),
      'utf8',
    ))
    const identityBlock = source.slice(source.indexOf('identity: {'), source.indexOf('media: {'))
    expect(identityBlock).toContain('MIP_PHONE_MIGRATION_REBIND_ENABLED')
    expect(source.match(/MIP_PHONE_MIGRATION_REBIND_ENABLED/g)).toHaveLength(2)
  })

  it('keeps the finite static pristine-user scan aligned with every locked user reference column', () => {
    const repository = fs.readFileSync(
      path.join(root, 'cloudfunctions/mip-identity-api/domain/repository.js'),
      'utf8',
    )
    const bootstrap = new Set([
      'mip_agreement_acceptances.user_id',
      'mip_membership_chains.user_id',
      'mip_private_profiles.user_id',
      'mip_user_identities.user_id',
    ])
    const references = new Set<string>()
    const migrationDirectory = path.join(root, 'database/mysql/mip')
    for (const file of fs.readdirSync(migrationDirectory).filter(name => name.endsWith('.sql'))) {
      const sql = fs.readFileSync(path.join(migrationDirectory, file), 'utf8')
      for (const match of sql.matchAll(/CREATE TABLE IF NOT EXISTS (mip_[a-z0-9_]+) \(([\s\S]*?)\n\) ENGINE/g)) {
        for (const column of match[2].matchAll(/^\s+([a-z0-9_]*user_id) CHAR\(36\)/gm)) {
          references.add(`${match[1]}.${column[1]}`)
        }
      }
      for (const statement of sql.split(';')) {
        const table = statement.match(/ALTER TABLE (mip_[a-z0-9_]+)/)?.[1]
        if (!table) {
          continue
        }
        for (const column of statement.matchAll(/ADD COLUMN ([a-z0-9_]*user_id) CHAR\(36\)/g)) {
          references.add(`${table}.${column[1]}`)
        }
      }
    }
    for (const reference of references) {
      if (bootstrap.has(reference)) {
        continue
      }
      const [table, column] = reference.split('.')
      expect(repository, reference).toMatch(new RegExp(
        `SELECT 1 AS found FROM ${table} WHERE app_id = \\? AND \\? IN \\([^)]*${column}`,
      ))
    }
  })
})
