import assert from 'node:assert/strict'
import fs from 'node:fs'
import { it } from 'vitest'
import { assertAuthGrants, assertAuthOwnership, expectedAuthGrants, readAuthMigrations, validateAuthJournal } from '../scripts/lib/admin-auth-setup.mjs'

const own = { exists: true, users: [{ User: 'runtime', Host: '%' }], user: 'runtime', owner: 'env:schema:runtime', expectedOwner: 'env:schema:runtime', password: 'synthetic-only' }
function grants() {
  return { tables: expectedAuthGrants().map((value) => {
    const [target, PRIVILEGE_TYPE] = value.split(':')
    const [TABLE_SCHEMA, TABLE_NAME] = target.split('.')
    return { TABLE_SCHEMA, TABLE_NAME, PRIVILEGE_TYPE, IS_GRANTABLE: 'NO' }
  }), schemas: [], globals: [{ PRIVILEGE_TYPE: 'USAGE', IS_GRANTABLE: 'NO' }] }
}
it('existing schema or runtime identity requires exact bound ownership and saved password', () => {
  assert.doesNotThrow(() => assertAuthOwnership(own))
  assert.throws(() => assertAuthOwnership({ ...own, exists: false, owner: 'another-env:schema:runtime' }))
  assert.throws(() => assertAuthOwnership({ ...own, owner: undefined }))
  assert.throws(() => assertAuthOwnership({ ...own, password: undefined }))
  assert.throws(() => assertAuthOwnership({ ...own, users: [{ User: 'runtime', Host: 'localhost' }] }))
  assert.doesNotThrow(() => assertAuthOwnership({ ...own, owner: undefined, exists: false, users: [], password: undefined }))
})
it('grants require the complete exact table privilege set with no broader authority', () => {
  assert.doesNotThrow(() => assertAuthGrants(grants()))
  const missing = grants()
  missing.tables.pop()
  assert.throws(() => assertAuthGrants(missing))
  assert.doesNotThrow(() => assertAuthGrants({ ...missing, exact: false }))
  for (const privilege of ['UPDATE', 'DELETE']) {
    const audit = grants()
    audit.tables.push({ TABLE_SCHEMA: 'mip_admin_auth', TABLE_NAME: 'mip_admin_web_credential_audit', PRIVILEGE_TYPE: privilege, IS_GRANTABLE: 'NO' })
    assert.throws(() => assertAuthGrants(audit))
  }
  assert.throws(() => assertAuthGrants({ ...grants(), globals: [{ PRIVILEGE_TYPE: 'SELECT', IS_GRANTABLE: 'NO' }] }))
  assert.throws(() => assertAuthGrants({ ...grants(), schemas: [{ TABLE_SCHEMA: 'mip_admin_auth', PRIVILEGE_TYPE: 'SELECT' }] }))
  assert.throws(() => assertAuthGrants({ ...grants(), roles: ['GRANT `admin` TO runtime'] }))
  const grantable = grants()
  grantable.tables[0].IS_GRANTABLE = 'YES'
  assert.throws(() => assertAuthGrants(grantable))
})
it('migration journal rejects historical edits, unknown versions and holes', () => {
  const source = fs.readFileSync(new URL('../admin-web/migrations/mysql/0001_admin_auth.sql', import.meta.url), 'utf8')
  const migrations = readAuthMigrations([{ name: '0001_admin_auth.sql', source }])
  assert.equal(validateAuthJournal(migrations, []).length, 1)
  assert.equal(validateAuthJournal(migrations, migrations).length, 0)
  assert.throws(() => validateAuthJournal(migrations, [{ version: '0001', checksum: 'tampered' }]))
  assert.throws(() => validateAuthJournal(migrations, [{ version: '9999', checksum: 'unknown' }]))
  assert.throws(() => validateAuthJournal([...migrations, { version: '0002', checksum: 'later' }], [{ version: '0002', checksum: 'later' }]))
  assert.throws(() => readAuthMigrations([{ name: '0001_admin_auth.sql', source: `${source}\nDROP DATABASE production;` }]))
  assert.throws(() => readAuthMigrations([{ name: '0001_admin_auth.sql', source }, { name: '0001_changed.sql', source }]))
})
it('refuses broad grants even while resuming partially granted setup', () => {
  for (const extra of [
    { globals: [{ PRIVILEGE_TYPE: 'SELECT', IS_GRANTABLE: 'NO' }] },
    { globals: [{ PRIVILEGE_TYPE: 'USAGE', IS_GRANTABLE: 'YES' }] },
    { schemas: [{ TABLE_SCHEMA: 'mip_admin_auth', PRIVILEGE_TYPE: 'INSERT' }] },
    { schemas: [{ TABLE_SCHEMA: 'business', PRIVILEGE_TYPE: 'SELECT' }] },
    { roles: ['GRANT `administrator` TO `runtime`@`%`'] },
  ]) {
    assert.throws(() => assertAuthGrants({ ...grants(), ...extra, exact: false }))
  }
})
it('denies cross-schema, migration-journal and credential-delete table permissions', () => {
  for (const extra of [
    { TABLE_SCHEMA: 'business', TABLE_NAME: 'mip_admin_web_sessions', PRIVILEGE_TYPE: 'SELECT' },
    { TABLE_SCHEMA: 'mip_admin_auth', TABLE_NAME: 'mip_admin_web_schema_migrations', PRIVILEGE_TYPE: 'INSERT' },
    { TABLE_SCHEMA: 'mip_admin_auth', TABLE_NAME: 'mip_admin_web_credentials', PRIVILEGE_TYPE: 'DELETE' },
  ]) {
    const bad = grants()
    bad.tables.push({ ...extra, IS_GRANTABLE: 'NO' })
    assert.throws(() => assertAuthGrants({ ...bad, exact: false }))
  }
})
