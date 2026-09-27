import { createHash } from 'node:crypto'

export const AUTH_SCHEMA = 'mip_admin_auth'
export const AUTH_TABLES = [
  'mip_admin_web_login_challenges',
  'mip_admin_web_login_principal_limits',
  'mip_admin_web_login_ip_limits',
  'mip_admin_web_credentials',
  'mip_admin_web_sessions',
  'mip_admin_web_password_limits',
  'mip_admin_web_credential_audit',
]
export function expectedAuthGrants() {
  return AUTH_TABLES.flatMap(table => (table.endsWith('_audit')
    ? ['SELECT', 'INSERT']
    : table.endsWith('_credentials')
      ? ['SELECT', 'INSERT', 'UPDATE']
      : ['SELECT', 'INSERT', 'UPDATE', 'DELETE']).map(privilege => `${AUTH_SCHEMA}.${table}:${privilege}`)).sort()
}
export function assertAuthOwnership({ exists, users, owner, expectedOwner, user, password }) {
  if (owner && owner !== expectedOwner) {
    throw new Error('Auth ownership belongs to another environment or identity')
  }
  if ((exists || users.length) && owner !== expectedOwner) {
    throw new Error('Existing auth resources ownership is unproven')
  }
  if (users.some(row => row.User !== user || row.Host !== '%')) {
    throw new Error('Unexpected auth runtime user host identity')
  }
  if (users.length > 1) {
    throw new Error('Ambiguous auth runtime user identity')
  }
  if (users.length && !password) {
    throw new Error('Existing auth runtime password is missing; refusing credential replacement')
  }
}
export function assertAuthGrants({ tables, schemas, globals, roles = [], exact = true }) {
  if (roles.length || schemas.length || globals.some(row => row.PRIVILEGE_TYPE !== 'USAGE' || row.IS_GRANTABLE === 'YES')) {
    throw new Error('Auth runtime has global, schema, or role privileges')
  }
  const expected = expectedAuthGrants()
  const actual = tables.map((row) => {
    if (row.IS_GRANTABLE === 'YES') {
      throw new Error('Auth runtime may grant privileges')
    }
    return `${row.TABLE_SCHEMA}.${row.TABLE_NAME}:${row.PRIVILEGE_TYPE}`
  }).sort()
  if (actual.some(grant => !expected.includes(grant)) || (exact && JSON.stringify(actual) !== JSON.stringify(expected))) {
    throw new Error('Auth runtime table grants do not match the exact allowlist')
  }
}
export function readAuthMigrations(files) {
  const migrations = files.map(({ name, source }) => {
    const match = /^(\d{4})_[a-z0-9_]+\.sql$/.exec(name)
    if (!match) {
      throw new Error('Invalid auth migration filename')
    }
    const statements = source.replace(/^\s*--.*$/gm, '').split(';').map(s => s.trim()).filter(Boolean)
    const tables = statements.map((statement) => {
      const table = /^CREATE TABLE IF NOT EXISTS (mip_admin_web_\w+)\s*\(/.exec(statement)?.[1]
      if (!table || !AUTH_TABLES.includes(table)) {
        throw new Error('Unreviewed auth migration statement or table')
      }
      return table
    })
    return { version: match[1], checksum: createHash('sha256').update(source).digest('hex'), statements, tables }
  }).sort((a, b) => a.version.localeCompare(b.version))
  if (!migrations.length || new Set(migrations.map(m => m.version)).size !== migrations.length) {
    throw new Error('Missing or duplicate auth migration versions')
  }
  if (new Set(migrations.flatMap(m => m.tables)).size !== AUTH_TABLES.length) {
    throw new Error('Unexpected auth table inventory')
  }
  return migrations
}
export function validateAuthJournal(migrations, applied) {
  const recorded = new Map()
  for (const row of applied) {
    const migration = migrations.find(m => m.version === row.version)
    if (!migration || migration.checksum !== row.checksum || recorded.has(row.version)) {
      throw new Error('Auth migration journal is unknown, duplicated, or checksum mismatched')
    }
    recorded.set(row.version, row.checksum)
  }
  let pending = false
  for (const migration of migrations) {
    if (!recorded.has(migration.version)) {
      pending = true
    }
    else if (pending) {
      throw new Error('Auth migration journal is not an applied prefix')
    }
  }
  return migrations.filter(m => !recorded.has(m.version))
}
