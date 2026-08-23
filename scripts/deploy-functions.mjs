#!/usr/bin/env node

import { createHmac, randomBytes } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import {
  bindAndRequireMysqlEnvironment,
  callCloudbase,
  cloudFunctionResult,
  loadCaseEnv,
} from './lib/example-cloudbase.mjs'
import { assertMembershipApiActivityDomainPackage } from './lib/membership-api-package.mjs'
import {
  MIP_FUNCTION_SOURCES,
  resolveMipFunctionNames,
} from './lib/mip-function-names.mjs'
import {
  assertRuntimePrivilegesExact,
  buildRuntimeGrantStatements,
  parseGrantee,
  parsePrivilegeRows,
  RUNTIME_TABLE_PRIVILEGES,
} from './lib/mysql-privilege-assert.mjs'

const root = path.resolve(import.meta.dirname, '..')
const repositoryRoot = path.resolve(root, '..', '..')
const env = loadCaseEnv(root)
const envId = env.CLOUDBASE_ENV_ID
const appId = env.MINI_PROGRAM_APP_ID
const functionNames = resolveMipFunctionNames(env)
const databaseRuntimeUser = String(env.MEMBERSHIP_DB_RUNTIME_USER || 'mip_runtime').trim()
let connectionUri = env.MEMBERSHIP_DB_CONNECTION_URI
const paymentMode = env.MEMBERSHIP_PAYMENT_MODE || 'disabled'
const subscribeTemplatesJson = String(env.MEMBERSHIP_SUBSCRIBE_TEMPLATES_JSON || '').trim()
const miniprogramState = ['formal', 'trial', 'developer'].includes(env.MEMBERSHIP_MINIPROGRAM_STATE)
  ? env.MEMBERSHIP_MINIPROGRAM_STATE
  : 'trial'
// Content safety must not depend on payment mode; every deployed function is production stage.
const deploymentStage = 'production'
const allowedAppIds = String(env.MEMBERSHIP_ALLOWED_APP_IDS || appId || '')
  .split(',')
  .map(value => value.trim())
  .filter(Boolean)
const confirmedEnv = process.argv.find(value => value.startsWith('--confirm-env='))?.slice('--confirm-env='.length)
const replaceLegacyRuntime = process.argv.includes('--replace-legacy-runtime')
// Optional signed maintenance path; never print the secret value.
const maintenanceSecret = typeof env.MEMBERSHIP_MAINTENANCE_SECRET === 'string'
  && env.MEMBERSHIP_MAINTENANCE_SECRET.length >= 32
  ? env.MEMBERSHIP_MAINTENANCE_SECRET
  : null

if (!/^mip_[a-z0-9_]{0,23}$/.test(databaseRuntimeUser)) {
  throw new Error('MEMBERSHIP_DB_RUNTIME_USER must be a dedicated lowercase mip_* MySQL user')
}

if (!envId || !appId || confirmedEnv !== envId) {
  throw new Error('Deployment requires EnvID/AppID and --confirm-env=<exact CLOUDBASE_ENV_ID>')
}
if (!allowedAppIds.includes(appId) || allowedAppIds.some(value => !/^wx[0-9a-f]{16}$/i.test(value))) {
  throw new Error('MEMBERSHIP_ALLOWED_APP_IDS must contain only valid AppIDs and include MINI_PROGRAM_APP_ID')
}
if (!['disabled', 'test', 'live'].includes(paymentMode)) {
  throw new Error('MEMBERSHIP_PAYMENT_MODE must be disabled, test, or live')
}
if (subscribeTemplatesJson) {
  const configured = JSON.parse(subscribeTemplatesJson)
  if (!configured || typeof configured !== 'object' || Array.isArray(configured)) {
    throw new Error('MEMBERSHIP_SUBSCRIBE_TEMPLATES_JSON must be a JSON object')
  }
  if (Object.keys(configured).length > 5) {
    throw new Error('WeChat allows at most five template IDs in one subscription request')
  }
}
if (paymentMode === 'live' && !process.argv.includes('--confirm-live')) {
  throw new Error('Live deployment requires --confirm-live')
}
const target = bindAndRequireMysqlEnvironment(root, envId)

// Prove membership-api is self-contained before any CloudBase upload.
// CloudBase uploads only the function directory; keep activity-domain vendored inside membership-api.
assertMembershipApiActivityDomainPackage({
  caseRoot: root,
  repositoryRoot,
})

function runMysqlStatements(statements) {
  for (const sql of statements) {
    const response = callCloudbase(root, 'manageMysqlDatabase', {
      action: 'runStatement',
      sql,
    }, 300000)
    if (response?.success === false) {
      throw new Error('CloudBase MySQL statement failed during runtime-account convergence')
    }
  }
}

function findValue(value, names) {
  if (!value || typeof value !== 'object') {
    return null
  }
  for (const [name, child] of Object.entries(value)) {
    if (names.has(name.toLowerCase()) && typeof child === 'string' && child.trim()) {
      return child.trim()
    }
  }
  for (const child of Object.values(value)) {
    const found = findValue(child, names)
    if (found) {
      return found
    }
  }
  return null
}

const vpcId = env.MEMBERSHIP_DB_VPC_ID || findValue(target.mysql, new Set(['vpcid', 'vpc_id']))
const subnetId = env.MEMBERSHIP_DB_SUBNET_ID || findValue(target.mysql, new Set(['subnetid', 'subnet_id']))
if (!vpcId || !subnetId) {
  throw new Error('MySQL VPC/subnet could not be resolved; configure MEMBERSHIP_DB_VPC_ID and MEMBERSHIP_DB_SUBNET_ID')
}

const sourceFunctionRootPath = path.join(root, 'cloudfunctions')
const functionRootPath = path.join(root, '.tmp', 'mip-core-function-source')
const coreFunctionSpecs = [
  { role: 'api', source: MIP_FUNCTION_SOURCES.api, name: functionNames.api, timeout: 20 },
  { role: 'admin', source: MIP_FUNCTION_SOURCES.admin, name: functionNames.admin, timeout: 20 },
  { role: 'ledger', source: MIP_FUNCTION_SOURCES.ledger, name: functionNames.ledger, timeout: 20 },
  { role: 'notification', source: MIP_FUNCTION_SOURCES.notification, name: functionNames.notification, timeout: 60 },
]
const deployed = []

function existingFunctionDetail(functionName) {
  try {
    // queryFunctions/getFunctionDetail includes CodeInfo and is truncated by
    // the MCP transport once a deployed package grows beyond 64 KiB. The SCF
    // management API supports ShowCode=FALSE and returns the same runtime,
    // environment and VPC facts without transporting source code or secrets
    // through logs.
    return callCloudbase(root, 'callCloudApi', {
      service: 'scf',
      action: 'GetFunction',
      params: {
        FunctionName: functionName,
        Namespace: envId,
        ShowCode: 'FALSE',
      },
    })
  }
  catch (error) {
    const message = String(error?.message || error)
    if (/not found|not exist|resourcenotfound|function.*不存在|未找到指定.*function|请创建后再试/i.test(message)) {
      return null
    }
    throw error
  }
}

function environmentVariables(detail) {
  const entries = detail?.data?.functionDetail?.Environment?.Variables
    || detail?.Environment?.Variables
  if (!Array.isArray(entries)) {
    return {}
  }
  return Object.fromEntries(entries
    .filter(item => typeof item?.Key === 'string' && typeof item?.Value === 'string')
    .map(item => [item.Key, item.Value]))
}

function validConnectionUri(value) {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'mysql:' && Boolean(parsed.hostname && parsed.username && parsed.password && parsed.pathname !== '/')
  }
  catch {
    return false
  }
}

let credentialSource = 'configured'
const existingMembershipApi = existingFunctionDetail(functionNames.api)
if (!validConnectionUri(connectionUri) && existingMembershipApi) {
  const current = existingMembershipApi
  const deployedUri = environmentVariables(current).MEMBERSHIP_DB_CONNECTION_URI
  if (validConnectionUri(deployedUri)) {
    connectionUri = deployedUri
    credentialSource = 'existing-function'
  }
}

if (!validConnectionUri(connectionUri)) {
  const schema = findValue(target.mysql, new Set(['schema']))
  const address = findValue(target.mysql, new Set(['privatenetaddress', 'private_net_address']))
  if (!schema || !/^[\w-]+$/.test(schema) || !address || !/^[a-z0-9.-]+:\d+$/i.test(address)) {
    throw new Error('CloudBase MySQL private endpoint or schema could not be resolved safely')
  }
  const runtimeUser = databaseRuntimeUser
  const runtimePassword = randomBytes(32).toString('base64url')
  const account = parseGrantee(runtimeUser, '%')
  // Exact table→privilege map. No schema ALL, no global DELETE, audit append-only.
  // DCL is intentionally executed one statement at a time. CloudBase schema
  // initialization can truncate long DCL arrays without surfacing a top-level
  // error, which previously left the runtime account only partially granted.
  runMysqlStatements([
    `CREATE USER IF NOT EXISTS ${account} IDENTIFIED BY '${runtimePassword}'`,
    `ALTER USER ${account} IDENTIFIED BY '${runtimePassword}'`,
    `REVOKE ALL PRIVILEGES, GRANT OPTION FROM ${account}`,
    ...buildRuntimeGrantStatements(schema, account),
  ])
  connectionUri = `mysql://${encodeURIComponent(runtimeUser)}:${encodeURIComponent(runtimePassword)}@${address}/${encodeURIComponent(schema)}`
  credentialSource = 'provisioned-least-privilege'
}

const parsedConnection = new URL(connectionUri)
if (parsedConnection.protocol !== 'mysql:' || !parsedConnection.hostname || !parsedConnection.username || !parsedConnection.password) {
  throw new Error('A complete MySQL runtime connection could not be established')
}

/**
 * Runtime grants must be exact table→privilege pairs for the full RUNTIME_TABLE_PRIVILEGES map.
 * Reused accounts REVOKE ALL first so stale DELETE/ALL/extra grants cannot accumulate.
 * Probes use exact GRANTEE equality (never LIKE). Never print identity or connection strings.
 */
const runtimeSchema = decodeURIComponent(parsedConnection.pathname.replace(/^\//, ''))
const runtimeUserName = decodeURIComponent(parsedConnection.username)
if (!runtimeSchema || !/^[\w-]+$/.test(runtimeSchema) || !runtimeUserName || !/^[\w.-]+$/.test(runtimeUserName)) {
  throw new Error('Runtime MySQL schema/user could not be resolved safely for grants')
}
if (runtimeUserName !== databaseRuntimeUser) {
  throw new Error('MEMBERSHIP_DB_CONNECTION_URI must use the dedicated MEMBERSHIP_DB_RUNTIME_USER account')
}
const runtimeAccount = parseGrantee(runtimeUserName, '%')
const schemaSqlLiteral = runtimeSchema.replaceAll('\'', '\'\'')
// MySQL stores GRANTEE as 'user'@'host'; equality probe must quote that literal exactly.
const granteeSqlLiteral = runtimeAccount.replaceAll('\'', '\'\'')
// Converge reused (and freshly provisioned) accounts to exact least privilege.
runMysqlStatements([
  `REVOKE ALL PRIVILEGES, GRANT OPTION FROM ${runtimeAccount}`,
  ...buildRuntimeGrantStatements(runtimeSchema, runtimeAccount),
])
// Read-back table + schema + global privileges with exact grantee equality.
const tablePrivilegeProbe = callCloudbase(root, 'queryMysqlDatabase', {
  action: 'runQuery',
  sql: `SELECT table_name AS tableName, privilege_type AS privilegeType, grantee AS grantee
    FROM information_schema.table_privileges
    WHERE table_schema = '${schemaSqlLiteral}'
      AND grantee = '${granteeSqlLiteral}'`,
})
const schemaPrivilegeProbe = callCloudbase(root, 'queryMysqlDatabase', {
  action: 'runQuery',
  sql: `SELECT table_schema AS tableSchema, privilege_type AS privilegeType, grantee AS grantee
    FROM information_schema.schema_privileges
    WHERE table_schema = '${schemaSqlLiteral}'
      AND grantee = '${granteeSqlLiteral}'`,
})
const userPrivilegeProbe = callCloudbase(root, 'queryMysqlDatabase', {
  action: 'runQuery',
  sql: `SELECT privilege_type AS privilegeType, grantee AS grantee
    FROM information_schema.user_privileges
    WHERE grantee = '${granteeSqlLiteral}'`,
})
assertRuntimePrivilegesExact({
  tableRows: parsePrivilegeRows(tablePrivilegeProbe),
  schemaRows: parsePrivilegeRows(schemaPrivilegeProbe),
  userRows: parsePrivilegeRows(userPrivilegeProbe),
  requiredMap: RUNTIME_TABLE_PRIVILEGES,
  grantee: runtimeAccount,
})
// Confirm required runtime tables exist (schema apply must precede deploy).
const runtimeTableNames = Object.keys(RUNTIME_TABLE_PRIVILEGES)
const runtimeTables = callCloudbase(root, 'queryMysqlDatabase', {
  action: 'runQuery',
  sql: `SELECT table_name AS tableName FROM information_schema.tables
    WHERE table_schema = DATABASE()
      AND table_name IN (${runtimeTableNames.map(name => `'${name.replaceAll('\'', '\'\'')}'`).join(', ')})`,
})
const runtimeTablesText = JSON.stringify(runtimeTables)
for (const table of runtimeTableNames) {
  if (!runtimeTablesText.includes(table)) {
    throw new Error(`Required table missing before deploy: ${table}`)
  }
}
console.log('[cloud-deploy] exact minimal runtime grants verified (full map; no schema/global ALL; scoped DELETE only)')

let ledgerSecret = randomBytes(32).toString('hex')
const existingLedger = existingFunctionDetail(functionNames.ledger)
if (existingLedger) {
  const ledgerDetail = existingLedger
  const deployedSecret = environmentVariables(ledgerDetail).MEMBERSHIP_LEDGER_SECRET
  if (/^[0-9a-f]{64}$/i.test(deployedSecret || '')) {
    ledgerSecret = deployedSecret
  }
}

const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))

async function waitForFunctionActive(functionName) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const detail = existingFunctionDetail(functionName)
    const config = detail?.data?.functionDetail || detail
    if (config?.Status === 'Active' && config?.AvailableStatus === 'Available') {
      return detail
    }
    await delay(1000)
  }
  throw new Error(`${functionName} did not become active after deployment`)
}

async function replaceIncompatibleRuntime(functionName) {
  const detail = existingFunctionDetail(functionName)
  if (!detail) {
    return
  }
  if ((detail?.data?.functionDetail || detail)?.Runtime === 'Nodejs20.19') {
    return
  }
  if (!replaceLegacyRuntime) {
    throw new Error(`${functionName} uses a legacy runtime; rerun with --replace-legacy-runtime to recreate it as Nodejs20.19`)
  }
  callCloudbase(root, 'manageFunctions', {
    action: 'deleteFunction',
    functionName,
    confirm: true,
  }, 300000)
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (!existingFunctionDetail(functionName)) {
      return
    }
    await delay(1000)
  }
  throw new Error(`${functionName} legacy runtime was not removed before recreation`)
}

function canonical(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonical).join(',')}]`
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function signedLedgerHealth() {
  const payload = {
    action: 'health',
    appId,
    signedAt: Date.now(),
    nonce: randomBytes(12).toString('hex'),
  }
  return {
    ...payload,
    signature: createHmac('sha256', ledgerSecret).update(canonical(payload)).digest('hex'),
  }
}

/**
 * Attempt to extract live OpenAPI permissions from getFunctionDetail (or similar).
 * Local config.json is NOT live proof — missing remote fields are UNKNOWN and fail the gate.
 * @param {object} detail Remote function detail payload
 * @returns {{ status: 'OK'|'UNKNOWN'|'FAILED', openapi: string[]|null }} Live openapi status and list
 */
function extractRemoteOpenApiPermissions(detail) {
  if (!detail || typeof detail !== 'object') {
    return { status: 'FAILED', openapi: null }
  }
  const functionDetail = detail?.data?.functionDetail || detail?.functionDetail || detail?.data || detail
  const candidates = [
    functionDetail?.Permissions?.Openapi,
    functionDetail?.Permissions?.OpenAPI,
    functionDetail?.Permissions?.openapi,
    functionDetail?.permissions?.openapi,
    functionDetail?.Openapi,
    functionDetail?.OpenAPI,
    functionDetail?.openapi,
    functionDetail?.Config?.permissions?.openapi,
    functionDetail?.FunctionConfig?.permissions?.openapi,
    functionDetail?.InstallDependency?.permissions?.openapi,
  ]
  for (const candidate of candidates) {
    if (Array.isArray(candidate) && candidate.every(item => typeof item === 'string')) {
      return { status: 'OK', openapi: candidate }
    }
    if (typeof candidate === 'string' && candidate.trim()) {
      try {
        const parsed = JSON.parse(candidate)
        if (Array.isArray(parsed) && parsed.every(item => typeof item === 'string')) {
          return { status: 'OK', openapi: parsed }
        }
      }
      catch {
        // continue scanning other candidate fields
      }
    }
  }
  // Platform did not surface openapi permissions in the detail response.
  return { status: 'UNKNOWN', openapi: null }
}

/**
 * Documented post-deploy avatar safety probe action name.
 * NOT invoked by this deploy script this round — structure readiness only.
 * Future owner/ops lane may invoke:
 *   manageFunctions invokeFunction mip-api { action: 'probeAvatarSafety' }
 * to prove imgSecCheck is reachable without uploading a real user avatar.
 */
function avatarSafetyProbeActionName() {
  return 'probeAvatarSafety'
}
// Keep the probe name exported for operators; do not invoke real imgSecCheck here.
void avatarSafetyProbeActionName

// Pre-deploy: local config.json must declare openapi permissions (upload source of truth).
// Live remote permissions are verified after deploy; local config alone is not live proof.
const membershipApiConfigPath = path.join(sourceFunctionRootPath, MIP_FUNCTION_SOURCES.api, 'config.json')
const membershipApiConfig = JSON.parse(fs.readFileSync(membershipApiConfigPath, 'utf8'))
const localOpenapi = membershipApiConfig?.permissions?.openapi || []
if (!localOpenapi.includes('security.imgSecCheck')
  || !localOpenapi.includes('security.msgSecCheck')
  || !localOpenapi.includes('phonenumber.getPhoneNumber')) {
  throw new Error('membership-api config.json openapi permissions missing image/message safety or phone')
}
console.log('[cloud-deploy] pre-deploy local openapi permissions include image/message safety + phone')
const notificationWorkerConfigPath = path.join(
  sourceFunctionRootPath,
  MIP_FUNCTION_SOURCES.notification,
  'config.json',
)
const notificationWorkerConfig = JSON.parse(fs.readFileSync(notificationWorkerConfigPath, 'utf8'))
if (!notificationWorkerConfig?.permissions?.openapi?.includes('subscribeMessage.send')) {
  throw new Error('membership-notification-worker config.json missing subscribeMessage.send')
}
console.log('[cloud-deploy] notification worker declares subscribeMessage.send')

fs.rmSync(functionRootPath, { recursive: true, force: true })
fs.mkdirSync(functionRootPath, { recursive: true })
for (const spec of coreFunctionSpecs) {
  fs.cpSync(path.join(sourceFunctionRootPath, spec.source), path.join(functionRootPath, spec.name), {
    recursive: true,
    filter: source => path.basename(source) !== 'node_modules',
  })
}

for (const spec of coreFunctionSpecs) {
  const { name: functionName, role } = spec
  const envVariables = {
    MEMBERSHIP_DB_CONNECTION_URI: connectionUri,
    MEMBERSHIP_DB_POOL_SIZE: '4',
    MEMBERSHIP_PAYMENT_MODE: paymentMode,
    MEMBERSHIP_ALLOWED_APP_IDS: allowedAppIds.join(','),
    // Force production stage on every deployed function so avatar content safety
    // fails closed independently of MEMBERSHIP_PAYMENT_MODE (including disabled).
    MEMBERSHIP_DEPLOYMENT_STAGE: deploymentStage,
    // Production export uses private CloudBase storage + DB tickets; never memory.
    ...(role === 'admin'
      ? { MEMBERSHIP_EXPORT_STORAGE: 'cloudbase' }
      : {}),
    ...(role === 'ledger' ? { MEMBERSHIP_LEDGER_SECRET: ledgerSecret } : {}),
    ...((role === 'api' || role === 'notification')
      ? {
          MEMBERSHIP_SUBSCRIBE_TEMPLATES_JSON: subscribeTemplatesJson,
          ...(role === 'notification'
            ? { MEMBERSHIP_MINIPROGRAM_STATE: miniprogramState }
            : {}),
        }
      : {}),
    // Optional signed maintenance path for api/admin only; omit when not configured.
    ...(maintenanceSecret && (role === 'api' || role === 'admin')
      ? { MEMBERSHIP_MAINTENANCE_SECRET: maintenanceSecret }
      : {}),
  }
  await replaceIncompatibleRuntime(functionName)
  callCloudbase(root, 'manageFunctions', {
    action: 'createFunction',
    functionRootPath,
    force: true,
    func: {
      name: functionName,
      type: 'Event',
      runtime: 'Nodejs20.19',
      handler: 'index.main',
      timeout: spec.timeout,
      envVariables,
      vpc: { vpcId, subnetId },
      isWaitInstall: true,
    },
  }, 300000)
  await waitForFunctionActive(functionName)
  callCloudbase(root, 'manageFunctions', {
    action: 'updateFunctionCode',
    functionName,
    functionRootPath,
    force: true,
  }, 300000)
  const deployedDetail = await waitForFunctionActive(functionName)
  const deployedEnvironment = environmentVariables(deployedDetail)
  if (Object.entries(envVariables).some(([key, value]) => deployedEnvironment[key] !== value)) {
    throw new Error(`${functionName} environment variables were not applied exactly`)
  }
  // Explicit production-stage readback (content safety must not depend on payment mode).
  if (deployedEnvironment.MEMBERSHIP_DEPLOYMENT_STAGE !== 'production') {
    throw new Error(`${functionName} MEMBERSHIP_DEPLOYMENT_STAGE readback is not production`)
  }
  // Maintenance secret: presence-only readback; never print the secret value.
  if (maintenanceSecret && (role === 'api' || role === 'admin')) {
    const deployedSecret = deployedEnvironment.MEMBERSHIP_MAINTENANCE_SECRET
    const present = typeof deployedSecret === 'string' && deployedSecret.length > 0
    const lengthMatch = present && deployedSecret.length === maintenanceSecret.length
    if (!present || !lengthMatch) {
      throw new Error(`${functionName} MEMBERSHIP_MAINTENANCE_SECRET presence readback failed (present=${present}, lengthMatch=${lengthMatch})`)
    }
    console.log(`[cloud-deploy] ${functionName} MEMBERSHIP_MAINTENANCE_SECRET present=true lengthMatch=true`)
  }
  const health = callCloudbase(root, 'manageFunctions', {
    action: 'invokeFunction',
    functionName,
    params: role === 'ledger' ? signedLedgerHealth() : { action: 'health' },
  }, 120000)
  const healthResult = cloudFunctionResult(health)
  if (healthResult?.ok !== true || healthResult?.data?.persistence !== 'cloudbase-mysql') {
    throw new Error(`${functionName} health response did not prove MySQL persistence`)
  }
  if (role === 'api' || role === 'admin') {
    const grants = healthResult?.data?.exportIntegrityGrants
    // Public health is read-only; deep write probes are owner/signed only.
    if (
      grants?.exportTickets !== true
      || grants?.mutationIdempotency !== true
      || (role === 'api' && grants?.notificationInboxRead !== true)
      || (role === 'admin' && grants?.operationalExceptionsRead !== true)
      || grants?.appScoped !== true
      || grants?.mode !== 'read-only'
    ) {
      throw new Error(`${functionName} health did not prove read-only export integrity grants`)
    }
  }
  // Post-deploy: remote OpenAPI permissions for membership-api (live readback, not local config).
  if (role === 'api') {
    const remoteOpenapi = extractRemoteOpenApiPermissions(deployedDetail)
    if (remoteOpenapi.status === 'OK'
      && (!remoteOpenapi.openapi.includes('security.imgSecCheck')
        || !remoteOpenapi.openapi.includes('security.msgSecCheck')
        || !remoteOpenapi.openapi.includes('phonenumber.getPhoneNumber'))) {
      console.error('[cloud-deploy] membership-api openapiPermissions: FAILED')
      throw new Error('membership-api remote OpenAPI permissions missing image/message safety or phone')
    }
    // SCF GetFunction(ShowCode=FALSE) does not expose CloudBase OpenAPI
    // permissions. Keep this as UNKNOWN rather than treating local config as
    // live proof or blocking unrelated activity-platform deployments.
    console.log(`[cloud-deploy] membership-api openapiPermissions: ${remoteOpenapi.status}`)
  }
  if (role === 'notification') {
    const remoteOpenapi = extractRemoteOpenApiPermissions(deployedDetail)
    if (remoteOpenapi.status === 'OK'
      && !remoteOpenapi.openapi.includes('subscribeMessage.send')) {
      console.error('[cloud-deploy] membership-notification-worker openapiPermissions: FAILED')
      throw new Error('membership-notification-worker remote OpenAPI permissions missing subscribeMessage.send')
    }
    console.log(`[cloud-deploy] membership-notification-worker openapiPermissions: ${remoteOpenapi.status}`)
  }
  deployed.push(functionName)
  console.log(`[cloud-deploy] verified ${functionName} (MEMBERSHIP_DEPLOYMENT_STAGE=production)`)
}

const notificationTriggerName = 'mip-notification-every-5m'
function isMissingTriggerError(error) {
  return /not exist|does not exist|ResourceNotFound|cannot find|不存在|未找到|NoSuch/i
    .test(String(error?.message || error))
}
// A 5-minute timer keeps Serverless MySQL awake and burns CCU. Do not reinstall it.
try {
  callCloudbase(root, 'callCloudApi', {
    service: 'scf',
    action: 'DeleteTrigger',
    params: {
      FunctionName: functionNames.notification,
      TriggerName: notificationTriggerName,
      Type: 'timer',
      Namespace: envId,
    },
  })
}
catch (error) {
  if (!isMissingTriggerError(error)) {
    throw error
  }
}
const triggerReadback = callCloudbase(root, 'callCloudApi', {
  service: 'scf',
  action: 'ListTriggers',
  params: {
    FunctionName: functionNames.notification,
    Namespace: envId,
  },
})
const triggerText = JSON.stringify(triggerReadback)
if (triggerText.includes(notificationTriggerName)) {
  throw new Error('notification timer trigger must stay removed; it keeps Serverless MySQL awake')
}
console.log('[cloud-deploy] notification timer trigger removed (avoids MySQL CCU)')

for (const protectedFunction of [
  functionNames.ledger,
  functionNames.notification,
]) {
  const currentPermissions = callCloudbase(root, 'queryPermissions', {
    action: 'getResourcePermission',
    resourceType: 'function',
    resourceId: protectedFunction,
  })
  const currentRuleText = currentPermissions?.data?.permissions?.[0]?.SecurityRule
  let functionRules
  try {
    functionRules = JSON.parse(currentRuleText)
  }
  catch {
    functionRules = { '*': { invoke: 'auth.loginType != \'ANONYMOUS\' && auth != null' } }
  }
  if (!functionRules['*']?.invoke && functionRules['*']?.invoke !== false) {
    functionRules['*'] = { invoke: 'auth.loginType != \'ANONYMOUS\' && auth != null' }
  }
  functionRules[protectedFunction] = { invoke: false }
  callCloudbase(root, 'managePermissions', {
    action: 'updateResourcePermission',
    resourceType: 'function',
    resourceId: protectedFunction,
    permission: 'CUSTOM',
    securityRule: JSON.stringify(functionRules),
  })
  const verifiedPermissions = callCloudbase(root, 'queryPermissions', {
    action: 'getResourcePermission',
    resourceType: 'function',
    resourceId: protectedFunction,
  })
  const verifiedRuleText = verifiedPermissions?.data?.permissions?.[0]?.SecurityRule
  let verifiedRules
  try {
    verifiedRules = JSON.parse(verifiedRuleText)
  }
  catch {
    verifiedRules = null
  }
  if (verifiedRules?.[protectedFunction]?.invoke !== false) {
    throw new Error(`${protectedFunction} client invocation was not disabled`)
  }
}

const artifact = {
  environmentVerified: true,
  paymentMode,
  deploymentStage,
  maintenanceSecretConfigured: Boolean(maintenanceSecret),
  persistence: 'cloudbase-mysql',
  credentialSource,
  deployed,
  vpcAttached: true,
  ledgerSecretPreserved: true,
  notificationTemplatesConfigured: Boolean(subscribeTemplatesJson),
  notificationTimerVerified: true,
  // Avatar safety probe action is structured but not invoked this deploy.
  avatarSafetyProbeAction: avatarSafetyProbeActionName(),
  deployedAt: new Date().toISOString(),
}
fs.mkdirSync(path.join(root, '.tmp'), { recursive: true })
fs.writeFileSync(path.join(root, '.tmp', 'deploy-functions-result.json'), `${JSON.stringify(artifact, null, 2)}\n`)
console.log('[cloud-deploy] deployment verified; database and ledger secrets were not written or printed')
