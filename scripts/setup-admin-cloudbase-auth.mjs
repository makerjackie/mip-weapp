import { createHash, randomBytes } from 'node:crypto'
/** Create the dedicated authentication schema. Never modifies the business schema. */
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { assertAuthGrants, assertAuthOwnership, AUTH_SCHEMA, AUTH_TABLES, readAuthMigrations, validateAuthJournal } from './lib/admin-auth-setup.mjs'
import { bindAndRequireMysqlEnvironment, callCloudbase, loadCaseEnv, sqlLiteral } from './lib/example-cloudbase.mjs'
import { resolveMipDeploymentStage } from './lib/mip-deployment-stage.mjs'

const root = path.resolve(import.meta.dirname, '..')
const env = loadCaseEnv(root)
resolveMipDeploymentStage(env.MIP_DEPLOYMENT_STAGE, process.argv.slice(2))
if (!env.CLOUDBASE_ENV_ID || !process.argv.includes(`--confirm-env=${env.CLOUDBASE_ENV_ID}`) || !process.argv.includes('--confirm-schema=mip_admin_auth')) {
  throw new Error('Exact environment and auth schema confirmation required')
}
const schema = AUTH_SCHEMA
const user = `mipauth_${createHash('sha256').update(env.CLOUDBASE_ENV_ID).digest('hex').slice(0, 12)}`
const migrationDirectory = path.join(root, 'admin-web/migrations/mysql')
const migrations = readAuthMigrations(fs.readdirSync(migrationDirectory).filter(name => name.endsWith('.sql')).map(name => ({ name, source: fs.readFileSync(path.join(migrationDirectory, name), 'utf8') })))
const tables = AUTH_TABLES
if (!process.argv.includes('--apply')) {
  console.log(JSON.stringify({ schema, tables, migrations: migrations.map(({ version, checksum }) => ({ version, checksum })), dryRun: true }))
  process.exit(0)
}
bindAndRequireMysqlEnvironment(root, env.CLOUDBASE_ENV_ID, { stage: env.MIP_DEPLOYMENT_STAGE })
function query(sql) {
  const r = callCloudbase(root, 'queryMysqlDatabase', { action: 'runQuery', sql })
  if (r.success !== true || !Array.isArray(r.data?.rows)) {
    throw new Error('Auth schema read failed')
  }
  return r.data.rows
}
function write(sql) {
  const r = callCloudbase(root, 'manageMysqlDatabase', { action: 'runStatement', sql })
  if (r.success !== true) {
    throw new Error('Auth schema write failed')
  }
}
const exists = query(`SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=${sqlLiteral(schema)}`).length > 0
const file = path.join(root, '.env.secrets.local')
let secretText = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
const identity = env.MIP_ADMIN_AUTH_SCHEMA_OWNER
const users = query(`SELECT User, Host FROM mysql.user WHERE User=${sqlLiteral(user)}`)
assertAuthOwnership({ exists, users, owner: identity, expectedOwner: `${env.CLOUDBASE_ENV_ID}:${schema}:${user}`, user, password: env.MIP_ADMIN_AUTH_DB_PASSWORD })
function grants() {
  const grantee = sqlLiteral(`'${user}'@'%'`)
  return {
    tables: query(`SELECT TABLE_SCHEMA,TABLE_NAME,PRIVILEGE_TYPE,IS_GRANTABLE FROM information_schema.TABLE_PRIVILEGES WHERE GRANTEE=${grantee}`),
    schemas: query(`SELECT TABLE_SCHEMA,PRIVILEGE_TYPE FROM information_schema.SCHEMA_PRIVILEGES WHERE GRANTEE=${grantee}`),
    globals: query(`SELECT PRIVILEGE_TYPE,IS_GRANTABLE FROM information_schema.USER_PRIVILEGES WHERE GRANTEE=${grantee}`),
    // SHOW GRANTS also detects role membership (not exposed by TABLE_PRIVILEGES).
    roles: query(`SHOW GRANTS FOR ${sqlLiteral(user)}@'%'`).flatMap(row => Object.values(row)).filter(value => typeof value !== 'string' || !/^GRANT (?:USAGE|SELECT|INSERT|UPDATE|DELETE)(?:,? (?:SELECT|INSERT|UPDATE|DELETE))* ON /i.test(value)),
  }
}
if (users.length) {
  assertAuthGrants({ ...grants(), exact: false })
}
function persist(key, value) {
  secretText = secretText.replace(new RegExp(`^${key}=.*(?:\\r?\\n|$)`, 'gm'), '')
  secretText += `\n${key}=${value}\n`
  fs.writeFileSync(file, secretText, { mode: 0o600 })
  fs.chmodSync(file, 0o600)
}
// Persist operation ownership and generated secret before cloud writes for safe resume.
const password = env.MIP_ADMIN_AUTH_DB_PASSWORD || randomBytes(32).toString('hex')
persist('MIP_ADMIN_AUTH_SCHEMA_OWNER', `${env.CLOUDBASE_ENV_ID}:${schema}:${user}`)
persist('MIP_ADMIN_AUTH_DB_PASSWORD', password)
if (!env.MIP_ADMIN_AUTH_SESSION_SECRET) {
  persist('MIP_ADMIN_AUTH_SESSION_SECRET', randomBytes(48).toString('hex'))
}
if (!exists) {
  write(`CREATE DATABASE \`${schema}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_bin`)
}
write(`CREATE TABLE IF NOT EXISTS \`${schema}\`.mip_admin_web_schema_migrations (version VARCHAR(32) PRIMARY KEY, checksum CHAR(64) NOT NULL, applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)`)
const applied = query(`SELECT version,checksum FROM \`${schema}\`.mip_admin_web_schema_migrations ORDER BY version`)
const pending = validateAuthJournal(migrations, applied)
for (const migration of pending) {
  // DDL commits implicitly. CREATE IF NOT EXISTS supports a resumable interruption;
  // append the immutable journal only after every statement succeeds.
  for (const statement of migration.statements) {
    write(statement.replace(/CREATE TABLE IF NOT EXISTS (mip_admin_web_\w+)/, `CREATE TABLE IF NOT EXISTS \`${schema}\`.$1`))
  }
  write(`INSERT INTO \`${schema}\`.mip_admin_web_schema_migrations (version,checksum) VALUES (${sqlLiteral(migration.version)},${sqlLiteral(migration.checksum)})`)
}
if (!users.length) {
  write(`CREATE USER ${sqlLiteral(user)}@'%' IDENTIFIED BY ${sqlLiteral(password)}`)
}
for (const table of tables) {
  const permissions = table.endsWith('_audit') ? 'SELECT,INSERT' : table.endsWith('_credentials') ? 'SELECT,INSERT,UPDATE' : 'SELECT,INSERT,UPDATE,DELETE'
  write(`GRANT ${permissions} ON \`${schema}\`.\`${table}\` TO ${sqlLiteral(user)}@'%'`)
}
assertAuthGrants(grants())
if (validateAuthJournal(migrations, query(`SELECT version,checksum FROM \`${schema}\`.mip_admin_web_schema_migrations ORDER BY version`)).length) {
  throw new Error('Auth migration journal readback is incomplete')
}
console.log(JSON.stringify({ schema, tables: tables.length, migrations: migrations.map(({ version, checksum }) => ({ version, checksum })), grantsVerified: true }))
