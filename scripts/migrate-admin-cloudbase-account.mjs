import { createHash, createHmac, pbkdf2Sync, randomBytes } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { bindAndRequireMysqlEnvironment, callCloudbase, loadCaseEnv, sqlLiteral } from './lib/example-cloudbase.mjs'
import { resolveMipDeploymentStage } from './lib/mip-deployment-stage.mjs'

const root = path.resolve(import.meta.dirname, '..')
const env = loadCaseEnv(root)
resolveMipDeploymentStage(env.MIP_DEPLOYMENT_STAGE, process.argv.slice(2))
if (!env.CLOUDBASE_ENV_ID || !process.argv.includes(`--confirm-env=${env.CLOUDBASE_ENV_ID}`) || !process.argv.includes('--confirm-account=configured-administrator')) {
  throw new Error('Exact environment and administrator confirmation required')
}
const user = `mipauth_${createHash('sha256').update(env.CLOUDBASE_ENV_ID).digest('hex').slice(0, 12)}`
if (env.MIP_ADMIN_AUTH_SCHEMA_OWNER !== `${env.CLOUDBASE_ENV_ID}:mip_admin_auth:${user}`) {
  throw new Error('Destination auth schema ownership missing')
}
const sourceOrigin = new URL(env.MIP_ADMIN_TEST_ORIGIN).origin
if (sourceOrigin !== 'https://mipmini.01mvp.com') {
  throw new Error('Expected existing administrator source origin')
}
const account = env.CLOUDFLARE_ACCOUNT_ID
const headers = { 'Authorization': `Bearer ${env.CLOUDFLARE_API_TOKEN}`, 'Content-Type': 'application/json' }
async function cf(url, body) {
  const r2 = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}${url}`, { headers, signal: AbortSignal.timeout(30000), redirect: 'error', method: body ? 'POST' : 'GET', ...body ? { body: JSON.stringify(body) } : {} })
  const j = await r2.json()
  if (!r2.ok || !j.success) {
    throw new Error('Source auth database read failed')
  }
  return j.result
}
const project = await cf('/pages/projects/mip-admin-web')
const databases = Object.values(project.deployment_configs.production.d1_databases)
if (databases.length !== 1) {
  throw new Error('Source auth database ambiguous')
}
const exported = await cf(`/d1/database/${databases[0].id}/query`, { sql: 'SELECT * FROM mip_admin_web_credentials' })
const rows = exported[0].results
if (rows.length !== 1) {
  throw new Error('Account migration needs a complete credential plan for all source accounts')
}
const jar = /* @__PURE__ */ new Map()
async function sourceApi(route, body) {
  const r2 = await fetch(sourceOrigin + route, { method: 'POST', signal: AbortSignal.timeout(30000), redirect: 'error', headers: { 'Origin': sourceOrigin, 'Content-Type': 'application/json', 'Cookie': [...jar].map(([k, v]) => `${k}=${v}`).join('; ') }, body: JSON.stringify(body || {}) })
  for (const c of r2.headers.getSetCookie()) {
    const p = c.split(';')[0]
    const i = p.indexOf('=')
    jar.set(p.slice(0, i), p.slice(i + 1))
  }
  const j = await r2.json()
  if (!r2.ok) {
    throw new Error(`Existing administrator verification failed (${r2.status})`)
  }
  return j
}
let verified
try {
  await sourceApi('/api/auth/password/login', { phone: env.MIP_ADMIN_TEST_PHONE, password: env.MIP_ADMIN_TEST_PASSWORD })
  verified = await sourceApi('/api/admin', { contractVersion: 1, action: 'mip.admin.session', input: {} })
}
finally {
  if (jar.size) {
    await sourceApi('/api/auth/logout')
  }
}
const readback = await cf(`/d1/database/${databases[0].id}/query`, { sql: 'SELECT * FROM mip_admin_web_credentials' })
if (JSON.stringify(readback[0].results) !== JSON.stringify(rows)) {
  throw new Error('Source credentials changed during migration')
}
const row = rows[0]
if (!verified.ok || !verified.data?.enabled || row.app_id !== env.MINI_PROGRAM_APP_ID) {
  throw new Error('Source credential does not match verified administrator')
}
const pepper = env.MIP_ADMIN_AUTH_SESSION_SECRET
if (!pepper || pepper.length < 32) {
  throw new Error('Run auth schema setup first')
}
const keyed = value => createHmac('sha256', pepper).update(`password-auth-v1\0${value}`).digest('hex')
const phone = env.MIP_ADMIN_TEST_PHONE.replace(/[\s()-]/g, '').replace(/^(1\d{10})$/, '+86$1')
const key = keyed(`principal\0${row.app_id}\0${row.open_id}`)
const phoneKey = keyed(`phone\0${phone}`)
const salt = randomBytes(16).toString('hex')
const hash = `pbkdf2-sha256$600000$${salt}$${pbkdf2Sync(keyed(`password\0${env.MIP_ADMIN_TEST_PASSWORD}`), salt, 6e5, 32, 'sha256').toString('hex')}`
bindAndRequireMysqlEnvironment(root, env.CLOUDBASE_ENV_ID, { stage: env.MIP_DEPLOYMENT_STAGE })
function query(sql) {
  const r2 = callCloudbase(root, 'queryMysqlDatabase', { action: 'runQuery', sql })
  if (!r2.success || !Array.isArray(r2.data?.rows)) {
    throw new Error('Auth read failed')
  }
  return r2.data.rows
}
const existing = query('SELECT principal_key,phone_key,app_id,open_id,user_id,password_hash,updated_at FROM mip_admin_auth.mip_admin_web_credentials')
if (existing.length) {
  if (existing.length !== 1 || existing[0].principal_key !== key || existing[0].user_id !== row.user_id) {
    throw new Error('Destination auth ownership mismatch')
  }
  const current = existing[0]
  const parts = String(current.password_hash).split('$')
  if (current.phone_key !== phoneKey || current.app_id !== row.app_id || current.open_id !== row.open_id || parts.length !== 4 || parts[0] !== 'pbkdf2-sha256' || parts[1] !== '600000' || pbkdf2Sync(keyed(`password\0${env.MIP_ADMIN_TEST_PASSWORD}`), parts[2], 600000, 32, 'sha256').toString('hex') !== parts[3]) {
    throw new Error('Destination credential changed; refuse to overwrite')
  }
  ensureAudit(current.updated_at)
  console.log(JSON.stringify({ accounts: 1, alreadyMigrated: true, passwordUnchanged: true }))
  process.exit(0)
}
const backupDirectory = path.join(process.env.HOME, `Backups/mip-weapp/admin-auth-cloudbase-${Date.now()}`)
fs.mkdirSync(backupDirectory, { recursive: true, mode: 448 })
fs.writeFileSync(path.join(backupDirectory, 'source-credentials.json'), JSON.stringify(rows), { mode: 384 })
const values = [key, phoneKey, row.app_id, row.open_id, row.user_id, hash, 1, Date.now()].map(sqlLiteral).join(',')
const r = callCloudbase(root, 'manageMysqlDatabase', { action: 'runStatement', sql: `INSERT INTO mip_admin_auth.mip_admin_web_credentials (principal_key,phone_key,app_id,open_id,user_id,password_hash,version,updated_at) VALUES (${values})` })
if (r.success !== true) {
  throw new Error('Credential import failed')
}
const count = query(`SELECT COUNT(*) AS n FROM mip_admin_auth.mip_admin_web_credentials WHERE principal_key=${sqlLiteral(key)} AND password_hash=${sqlLiteral(hash)}`)[0]
if (Number(count.n) !== 1) {
  throw new Error('Credential readback failed')
}
ensureAudit(query(`SELECT updated_at FROM mip_admin_auth.mip_admin_web_credentials WHERE principal_key=${sqlLiteral(key)}`)[0].updated_at)
console.log(JSON.stringify({ accounts: 1, passwordUnchanged: true, oldSessionsCopied: false, sourceBackup: backupDirectory, sourceSha256: createHash('sha256').update(JSON.stringify(rows)).digest('hex') }))

// Migration is resumable: repair a missing audit after an interrupted initial import.
function ensureAudit(timestamp) {
  const r = callCloudbase(root, 'manageMysqlDatabase', { action: 'runStatement', sql: `INSERT INTO mip_admin_auth.mip_admin_web_credential_audit (principal_key,operation,created_at) SELECT ${sqlLiteral(key)},'PASSWORD_CONFIGURED',${sqlLiteral(timestamp)} WHERE NOT EXISTS (SELECT 1 FROM mip_admin_auth.mip_admin_web_credential_audit WHERE principal_key=${sqlLiteral(key)} AND operation='PASSWORD_CONFIGURED' AND created_at=${sqlLiteral(timestamp)})` })
  if (r.success !== true) {
    throw new Error('Credential migration audit failed')
  }
}
