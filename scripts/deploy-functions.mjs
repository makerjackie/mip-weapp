#!/usr/bin/env node

import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import {
  bindAndRequireMysqlEnvironment,
  callCloudbase,
  cloudFunctionResult,
  loadCaseEnv,
} from './lib/example-cloudbase.mjs'
import { resolveMipDeploymentStage } from './lib/mip-deployment-stage.mjs'
import { createMipCoreFunctionManifest } from './lib/mip-function-manifest.mjs'
import { resolveMipFunctionNames } from './lib/mip-function-names.mjs'
import { resolveMipStableSecrets } from './lib/mip-local-secrets.mjs'
import {
  assertRuntimeAccountClaimable,
  assertRuntimePrivilegesExact,
  buildRuntimeGrantStatements,
  buildRuntimeRevokeStatements,
  parseGrantee,
  parsePrivilegeRows,
  RUNTIME_TABLE_PRIVILEGES,
  runtimeUserForEnvironment,
} from './lib/mysql-privilege-assert.mjs'

const root = path.resolve(import.meta.dirname, '..')
const env = loadCaseEnv(root)
const envId = String(env.CLOUDBASE_ENV_ID || '').trim()
const appId = String(env.MINI_PROGRAM_APP_ID || '').trim()
const functionNames = resolveMipFunctionNames(env)
const manifest = createMipCoreFunctionManifest(functionNames)
const confirmedEnv = argumentValue('--confirm-env=')
const replaceLegacyRuntime = process.argv.includes('--replace-legacy-runtime')
const deploymentStage = resolveMipDeploymentStage(env.MIP_DEPLOYMENT_STAGE, process.argv.slice(2))
const paymentMode = String(env.MIP_PAYMENT_MODE || 'disabled').trim().toLowerCase()
const catalogStage = String(env.MIP_CATALOG_STAGE || 'TEST').trim().toUpperCase()
const unionIdRebindEnabled = String(env.MIP_UNION_ID_REBIND_ENABLED || 'false').trim().toLowerCase() === 'true'
const exportMaxRows = Number(env.MIP_EXPORT_MAX_ROWS || 5_000)
const exportMaxBytes = Number(env.MIP_EXPORT_MAX_BYTES || 8 * 1024 * 1024)
const databaseRuntimeUser = String(env.MIP_DB_RUNTIME_USER || runtimeUserForEnvironment(envId)).trim()
const confirmedRuntimeUser = argumentValue('--confirm-runtime-user=')
const allowedAppIds = String(env.MIP_ALLOWED_APP_IDS || appId)
  .split(',')
  .map(value => value.trim())
  .filter(Boolean)

if (!envId || confirmedEnv !== envId || !appId) {
  throw new Error('MIP deployment requires AppID and --confirm-env=<exact CLOUDBASE_ENV_ID>')
}
if (!allowedAppIds.includes(appId) || allowedAppIds.some(value => !/^wx[0-9a-f]{16}$/i.test(value))) {
  throw new Error('MIP_ALLOWED_APP_IDS must contain valid AppIDs and include MINI_PROGRAM_APP_ID')
}
if (!['disabled', 'test', 'live'].includes(paymentMode)) {
  throw new Error('MIP_PAYMENT_MODE must be disabled, test, or live')
}
if (!['TEST', 'LIVE'].includes(catalogStage)) {
  throw new Error('MIP_CATALOG_STAGE must be TEST or LIVE')
}
if ((paymentMode === 'live' || catalogStage === 'LIVE') && !process.argv.includes('--confirm-live')) {
  throw new Error('Live payment or catalog deployment requires --confirm-live')
}
if (catalogStage === 'LIVE' && paymentMode !== 'live') {
  throw new Error('LIVE catalog requires MIP_PAYMENT_MODE=live')
}
if (databaseRuntimeUser !== runtimeUserForEnvironment(envId)
  || confirmedRuntimeUser !== databaseRuntimeUser) {
  throw new Error('MIP deployment requires the environment-scoped runtime user and --confirm-runtime-user=<exact user>')
}
if (unionIdRebindEnabled && String(env.MIP_UNION_IDENTITY_PEPPER || '').length < 32) {
  throw new Error('MIP_UNION_ID_REBIND_ENABLED requires the migration source MIP_UNION_IDENTITY_PEPPER')
}
if (!Number.isInteger(exportMaxRows) || exportMaxRows < 100 || exportMaxRows > 20_000) {
  throw new Error('MIP_EXPORT_MAX_ROWS must be an integer from 100 to 20000')
}
if (!Number.isInteger(exportMaxBytes) || exportMaxBytes < 1_048_576 || exportMaxBytes > 10_485_760) {
  throw new Error('MIP_EXPORT_MAX_BYTES must be an integer from 1048576 to 10485760')
}

const sourceRoot = path.join(root, 'cloudfunctions')
for (const spec of manifest) {
  const source = path.join(sourceRoot, spec.source)
  if (!fs.existsSync(path.join(source, 'index.js')) || !fs.existsSync(path.join(source, 'package.json'))) {
    throw new Error(`Direct MIP Cloud Function source is incomplete: ${spec.source}`)
  }
  if (!spec.source.startsWith('mip-') || !spec.name.startsWith('mip-')) {
    throw new Error('Only direct mip-* sources and targets may be deployed')
  }
}

verifyLocalOpenApiDeclarations()
const target = bindAndRequireMysqlEnvironment(root, envId)
const existingDetails = new Map(manifest.map(spec => [spec.role, existingFunctionDetail(spec.name)]))

const requiredTables = Object.keys(RUNTIME_TABLE_PRIVILEGES)
assertRequiredTablesExist(requiredTables)

let vpcId = String(env.MIP_DB_VPC_ID || findString(target.mysql, ['vpcid', 'vpc_id']) || '').trim()
let subnetId = String(env.MIP_DB_SUBNET_ID || findString(target.mysql, ['subnetid', 'subnet_id']) || '').trim()
if (!vpcId || !subnetId) {
  // Current MCP lifecycle responses omit network metadata; request the explicit TCP payload only when deployment needs it.
  const connectionInfo = callCloudbase(root, 'queryMysqlDatabase', { action: 'getConnectionInfo' })
  vpcId ||= String(findString(connectionInfo, ['vpcid', 'vpc_id']) || '').trim()
  subnetId ||= String(findString(connectionInfo, ['subnetid', 'subnet_id']) || '').trim()
}
if (!vpcId || !subnetId) {
  throw new Error('CloudBase MySQL VPC/subnet is unavailable; configure MIP_DB_VPC_ID and MIP_DB_SUBNET_ID')
}

let connectionUri = configuredOrExistingValue('MIP_DB_CONNECTION_URI', existingDetails)
let credentialSource = connectionUri ? (env.MIP_DB_CONNECTION_URI ? 'configured' : 'existing-mip-function') : ''
if (connectionUri && !validMysqlUri(connectionUri)) {
  throw new Error('MIP_DB_CONNECTION_URI is not a complete MySQL URI')
}

const targetSchema = String(findString(target.mysql, ['schema', 'database', 'dbname']) || '').trim()
if (!/^[\w-]+$/.test(targetSchema)) {
  throw new Error('CloudBase MySQL schema could not be resolved safely')
}
const configuredSchema = connectionUri
  ? decodeURIComponent(new URL(connectionUri).pathname.replace(/^\//, ''))
  : targetSchema
if (configuredSchema !== targetSchema) {
  throw new Error('MIP runtime connection must use the confirmed CloudBase MySQL schema')
}
const runtimeAccount = parseGrantee(databaseRuntimeUser, '%')
const accountSnapshot = loadRuntimeAccountSnapshot(runtimeAccount)
const accountClaim = assertRuntimeAccountClaimable({
  ...accountSnapshot,
  schema: configuredSchema,
  grantee: runtimeAccount,
  allowExisting: Boolean(connectionUri),
})

if (!connectionUri) {
  const address = String(findString(target.mysql, ['privatenetaddress', 'private_net_address']) || '').trim()
  if (!/^[a-z0-9.-]+:\d+$/i.test(address)) {
    throw new Error('CloudBase MySQL private endpoint could not be resolved safely')
  }
  const password = randomBytes(32).toString('base64url')
  runMysqlStatements([
    `CREATE USER ${runtimeAccount} IDENTIFIED BY '${password}'`,
  ])
  connectionUri = `mysql://${encodeURIComponent(databaseRuntimeUser)}:${encodeURIComponent(password)}@${address}/${encodeURIComponent(targetSchema)}`
  persistLocalRuntimeConnection(connectionUri)
  credentialSource = 'provisioned-least-privilege'
}

const parsedConnection = new URL(connectionUri)
const runtimeSchema = decodeURIComponent(parsedConnection.pathname.replace(/^\//, ''))
const runtimeUserName = decodeURIComponent(parsedConnection.username)
if (parsedConnection.protocol !== 'mysql:'
  || !parsedConnection.hostname
  || !parsedConnection.password
  || !/^[\w-]+$/.test(runtimeSchema)
  || !/^[\w.-]+$/.test(runtimeUserName)) {
  throw new Error('MIP runtime MySQL connection is incomplete')
}
if (runtimeUserName !== databaseRuntimeUser) {
  throw new Error('MIP_DB_CONNECTION_URI must use the dedicated MIP_DB_RUNTIME_USER account')
}

let existingRuntimeGrantsExact = false
if (accountClaim.exists) {
  try {
    assertRuntimePrivilegesExact({
      ...accountSnapshot,
      requiredMap: RUNTIME_TABLE_PRIVILEGES,
      grantee: runtimeAccount,
    })
    existingRuntimeGrantsExact = true
  }
  catch {}
}
if (!existingRuntimeGrantsExact) {
  runMysqlStatements([
    ...buildRuntimeRevokeStatements(runtimeSchema, runtimeAccount, accountClaim.tableRows),
    ...buildRuntimeGrantStatements(runtimeSchema, runtimeAccount),
  ])
  assertExactRuntimePrivileges(runtimeSchema, runtimeAccount)
}
console.log(`[mip-cloud-deploy] exact mip_* runtime grants verified (${existingRuntimeGrantsExact ? 'reused' : 'converged'})`)

const stableSecretValues = resolveMipStableSecrets({
  localEnv: env,
  deployedEnvironments: [...existingDetails.values()].filter(Boolean).map(environmentVariables),
  generate: () => randomBytes(48).toString('base64url'),
}).values
const secrets = Object.freeze({
  identityPepper: stableSecretValues.MIP_IDENTITY_PEPPER,
  unionIdentityPepper: stableSecretValues.MIP_UNION_IDENTITY_PEPPER,
  mediaScope: stableSecretValues.MIP_MEDIA_SCOPE_SECRET,
  mediaMaintenanceHmac: stableSecretValues.MIP_MEDIA_MAINTENANCE_HMAC_SECRET,
  phoneEncryption: stableSecretValues.MIP_PHONE_ENCRYPTION_KEY,
  eventToken: stableSecretValues.MIP_EVENT_TOKEN_SECRET,
  ledger: stableSecretValues.MIP_LEDGER_SECRET,
  growthHmac: stableSecretValues.MIP_GROWTH_HMAC_SECRET,
  notificationHmac: stableSecretValues.MIP_NOTIFICATION_HMAC_SECRET,
  outboxHmac: stableSecretValues.MIP_OUTBOX_HMAC_SECRET,
  refundWorkerHmac: stableSecretValues.MIP_REFUND_WORKER_HMAC_SECRET,
  notificationEncryption: stableSecretValues.MIP_NOTIFICATION_ENCRYPTION_KEY,
  aiHmac: stableSecretValues.MIP_AI_HMAC_SECRET,
  aiStorage: stableSecretValues.MIP_AI_STORAGE_KEY,
})

const subscribeTemplatesJson = normalizedJsonObject(env.MIP_SUBSCRIBE_TEMPLATES_JSON, 'MIP_SUBSCRIBE_TEMPLATES_JSON')
const agreementsJson = normalizedOptionalJsonArray(env.MIP_AGREEMENTS_JSON, 'MIP_AGREEMENTS_JSON')
const miniprogramState = ['formal', 'trial', 'developer'].includes(env.MIP_MINIPROGRAM_STATE)
  ? env.MIP_MINIPROGRAM_STATE
  : 'trial'
const aiProviderFunction = String(env.MIP_AI_PROVIDER_FUNCTION_NAME || '').trim()
if (aiProviderFunction && !/^[a-z][a-z0-9-]{0,59}$/.test(aiProviderFunction)) {
  throw new Error('MIP_AI_PROVIDER_FUNCTION_NAME is invalid')
}
const aiAvatarProviderFunction = String(env.MIP_AI_AVATAR_PROVIDER_FUNCTION_NAME || '').trim()
if (aiAvatarProviderFunction && !/^[a-z][a-z0-9-]{0,59}$/.test(aiAvatarProviderFunction)) {
  throw new Error('MIP_AI_AVATAR_PROVIDER_FUNCTION_NAME is invalid')
}
const aiDraftTtlHours = Number(env.MIP_AI_DRAFT_TTL_HOURS || 72)
if (!Number.isInteger(aiDraftTtlHours) || aiDraftTtlHours < 1 || aiDraftTtlHours > 168) {
  throw new Error('MIP_AI_DRAFT_TTL_HOURS must be an integer from 1 to 168')
}

const stagingRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mip-core-functions-'))
const deployed = []
try {
  for (const spec of manifest) {
    fs.cpSync(path.join(sourceRoot, spec.source), path.join(stagingRoot, spec.name), {
      recursive: true,
      filter: source => path.basename(source) !== 'node_modules',
    })
  }

  for (const spec of manifest) {
    const envVariables = environmentForRole(spec.role, {
      agreementsJson,
      aiAvatarProviderFunction,
      aiDraftTtlHours,
      aiProviderFunction,
      allowedAppIds,
      catalogStage,
      connectionUri,
      deploymentStage,
      exportMaxBytes,
      exportMaxRows,
      functionNames,
      miniprogramState,
      paymentMode,
      secrets,
      subscribeTemplatesJson,
      unionIdRebindEnabled,
    })
    await ensureCompatibleRuntime(spec.name)
    const creation = callCloudbase(root, 'manageFunctions', {
      action: 'createFunction',
      functionRootPath: stagingRoot,
      force: true,
      func: {
        name: spec.name,
        type: 'Event',
        runtime: 'Nodejs20.19',
        handler: 'index.main',
        timeout: spec.timeout,
        envVariables,
        vpc: { vpcId, subnetId },
        isWaitInstall: true,
      },
    }, 300000)
    const creationSummary = managementResponseSummary(creation)
    console.log(`[mip-cloud-deploy] create response ${spec.name}: ${creationSummary}`)
    if (creation?.success === false) {
      throw new Error(`${spec.name} create request was rejected: ${creationSummary}`)
    }
    await waitForFunctionActive(spec.name)
    callCloudbase(root, 'manageFunctions', {
      action: 'updateFunctionCode',
      functionName: spec.name,
      functionRootPath: stagingRoot,
      force: true,
    }, 300000)
    const detail = await waitForFunctionActive(spec.name)
    assertEnvironmentReadback(spec.name, envVariables, detail)
    assertHealthy(spec.name)
    deployed.push(spec.name)
    console.log(`[mip-cloud-deploy] verified ${spec.name}`)
  }
}
finally {
  fs.rmSync(stagingRoot, { recursive: true, force: true })
}

removeForbiddenTimer(functionNames.notification, 'mip-notification-every-5m')
removeForbiddenTimer(functionNames.outbox, 'mip-outbox-every-5m')
for (const spec of manifest) {
  if (spec.clientInvokable) {
    enableAuthenticatedClientInvocation(spec.name)
  }
  else {
    disableClientInvocation(spec.name)
  }
}

const artifact = {
  environmentVerified: true,
  directMipSourcesOnly: true,
  persistence: 'cloudbase-mysql',
  credentialSource,
  paymentMode,
  catalogStage,
  deploymentStage,
  deployed,
  protectedFunctions: manifest.filter(item => !item.clientInvokable).map(item => item.name),
  workerTimersVerifiedAbsent: true,
  deployedAt: new Date().toISOString(),
}
fs.mkdirSync(path.join(root, '.tmp'), { recursive: true })
fs.writeFileSync(
  path.join(root, '.tmp', 'deploy-functions-result.json'),
  `${JSON.stringify(artifact, null, 2)}\n`,
)
console.log('[mip-cloud-deploy] deployment verified; no AppID, environment ID, database URI, or secret was persisted')

function argumentValue(prefix) {
  return process.argv.find(value => value.startsWith(prefix))?.slice(prefix.length)
}

function findString(value, names) {
  if (!value || typeof value !== 'object') {
    return null
  }
  const expected = new Set(names.map(name => name.toLowerCase()))
  for (const [key, child] of Object.entries(value)) {
    if (expected.has(key.toLowerCase()) && typeof child === 'string' && child.trim()) {
      return child.trim()
    }
  }
  for (const child of Object.values(value)) {
    const found = findString(child, names)
    if (found) {
      return found
    }
  }
  return null
}

function collectFieldValues(value, names, output = []) {
  if (!value || typeof value !== 'object') {
    return output
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectFieldValues(item, names, output)
    }
    return output
  }
  const expected = new Set(names.map(name => name.toLowerCase()))
  for (const [key, child] of Object.entries(value)) {
    if (expected.has(key.toLowerCase()) && typeof child === 'string') {
      output.push(child)
    }
    else if (child && typeof child === 'object') {
      collectFieldValues(child, names, output)
    }
  }
  return output
}

function runMysqlStatements(statements) {
  for (const sql of statements) {
    const result = callCloudbase(root, 'manageMysqlDatabase', {
      action: 'runStatement',
      sql,
    }, 300000)
    if (result?.success === false) {
      throw new Error('CloudBase MySQL statement failed while converging the MIP runtime account')
    }
  }
}

function persistLocalRuntimeConnection(value) {
  if (!validMysqlUri(value) || /[\r\n]/.test(value)) {
    throw new Error('Generated MIP runtime connection is invalid')
  }
  const envPath = path.join(root, '.env.local')
  if (!fs.existsSync(envPath)) {
    throw new Error('.env.local is required before provisioning the MIP runtime account')
  }
  const current = fs.readFileSync(envPath, 'utf8')
  const line = `MIP_DB_CONNECTION_URI=${value}`
  const next = /^MIP_DB_CONNECTION_URI=.*$/m.test(current)
    ? current.replace(/^MIP_DB_CONNECTION_URI=.*$/m, line)
    : `${current.replace(/\n?$/, '\n')}${line}\n`
  const temporaryPath = `${envPath}.mip-runtime-${process.pid}`
  fs.writeFileSync(temporaryPath, next, { mode: 0o600 })
  fs.renameSync(temporaryPath, envPath)
  fs.chmodSync(envPath, 0o600)
}

function managementResponseSummary(value) {
  const summary = {
    topLevelKeys: value && typeof value === 'object' ? Object.keys(value).sort() : [],
    success: typeof value?.success === 'boolean' ? value.success : undefined,
    isError: value?.isError === true,
    dataKeys: value?.data && typeof value.data === 'object' ? Object.keys(value.data).sort() : [],
    structuredKeys: value?.structuredContent && typeof value.structuredContent === 'object'
      ? Object.keys(value.structuredContent).sort()
      : [],
    message: sanitizedManagementMessage(value?.message),
    signals: [],
  }
  const messages = []
  collectDiagnosticStrings(value, messages)
  const signalPatterns = [
    'success',
    'created',
    'exists',
    'quota',
    'limit',
    'runtime',
    'vpc',
    'failed',
    'error',
    'invalid',
  ]
  summary.signals = signalPatterns.filter(signal => messages.some(message => message.includes(signal)))
  return JSON.stringify(summary)
}

function sanitizedManagementMessage(value) {
  let result = String(value || '').slice(0, 1000)
  result = result.replace(/mysql:\/\/[^\s"']+/gi, 'mysql://[redacted]')
  result = result.replace(/wx[0-9a-f]{16}/gi, '[redacted-appid]')
  for (const sensitive of [envId, appId, vpcId, subnetId, databaseRuntimeUser].filter(Boolean)) {
    result = result.replaceAll(sensitive, '[redacted-id]')
  }
  return result
}

function collectDiagnosticStrings(value, output) {
  if (typeof value === 'string') {
    output.push(value.toLowerCase())
    return
  }
  if (Array.isArray(value)) {
    value.forEach(item => collectDiagnosticStrings(item, output))
    return
  }
  if (value && typeof value === 'object') {
    Object.values(value).forEach(item => collectDiagnosticStrings(item, output))
  }
}

function assertRequiredTablesExist(tableNames) {
  const quoted = tableNames.map(name => `'${name.replaceAll('\'', '\'\'')}'`).join(', ')
  const result = callCloudbase(root, 'queryMysqlDatabase', {
    action: 'runQuery',
    sql: `SELECT table_name AS tableName FROM information_schema.tables
      WHERE table_schema = DATABASE() AND table_name IN (${quoted})`,
  })
  const found = new Set(collectFieldValues(result, ['tableName', 'table_name']))
  const missing = tableNames.filter(name => !found.has(name))
  if (missing.length) {
    throw new Error(`Apply the append-only MIP migrations before deploy; missing table ${missing[0]}`)
  }
}

function loadRuntimeAccountSnapshot(account) {
  const grantee = account.replaceAll('\'', '\'\'')
  const tableRows = parsePrivilegeRows(callCloudbase(root, 'queryMysqlDatabase', {
    action: 'runQuery',
    sql: `SELECT table_schema AS tableSchema, table_name AS tableName,
      privilege_type AS privilegeType, grantee
      FROM information_schema.table_privileges
      WHERE grantee = '${grantee}'`,
  }))
  const schemaRows = parsePrivilegeRows(callCloudbase(root, 'queryMysqlDatabase', {
    action: 'runQuery',
    sql: `SELECT table_schema AS tableSchema, privilege_type AS privilegeType, grantee
      FROM information_schema.schema_privileges
      WHERE grantee = '${grantee}'`,
  }))
  const userRows = parsePrivilegeRows(callCloudbase(root, 'queryMysqlDatabase', {
    action: 'runQuery',
    sql: `SELECT privilege_type AS privilegeType, grantee
      FROM information_schema.user_privileges
      WHERE grantee = '${grantee}'`,
  }))
  return { tableRows, schemaRows, userRows }
}

function assertExactRuntimePrivileges(schema, account) {
  const schemaLiteral = schema.replaceAll('\'', '\'\'')
  const granteeLiteral = account.replaceAll('\'', '\'\'')
  const tableProbe = callCloudbase(root, 'queryMysqlDatabase', {
    action: 'runQuery',
    sql: `SELECT table_name AS tableName, privilege_type AS privilegeType, grantee
      FROM information_schema.table_privileges
      WHERE table_schema = '${schemaLiteral}' AND grantee = '${granteeLiteral}'`,
  })
  const schemaProbe = callCloudbase(root, 'queryMysqlDatabase', {
    action: 'runQuery',
    sql: `SELECT table_schema AS tableSchema, privilege_type AS privilegeType, grantee
      FROM information_schema.schema_privileges
      WHERE table_schema = '${schemaLiteral}' AND grantee = '${granteeLiteral}'`,
  })
  const userProbe = callCloudbase(root, 'queryMysqlDatabase', {
    action: 'runQuery',
    sql: `SELECT privilege_type AS privilegeType, grantee
      FROM information_schema.user_privileges WHERE grantee = '${granteeLiteral}'`,
  })
  assertRuntimePrivilegesExact({
    tableRows: parsePrivilegeRows(tableProbe),
    schemaRows: parsePrivilegeRows(schemaProbe),
    userRows: parsePrivilegeRows(userProbe),
    requiredMap: RUNTIME_TABLE_PRIVILEGES,
    grantee: account,
  })
}

function existingFunctionDetail(functionName) {
  try {
    return callCloudbase(root, 'callCloudApi', {
      service: 'scf',
      action: 'GetFunction',
      params: { FunctionName: functionName, Namespace: envId, ShowCode: 'FALSE' },
    })
  }
  catch (error) {
    if (/not found|not exist|resourcenotfound|不存在|未找到/i.test(String(error?.message || error))) {
      return null
    }
    throw error
  }
}

function functionDetail(value) {
  return value?.data?.functionDetail || value?.Response || value?.data || value
}

function environmentVariables(detail) {
  const entries = functionDetail(detail)?.Environment?.Variables
  if (!Array.isArray(entries)) {
    return {}
  }
  return Object.fromEntries(entries
    .filter(item => typeof item?.Key === 'string' && typeof item?.Value === 'string')
    .map(item => [item.Key, item.Value]))
}

function configuredOrExistingValue(key, details) {
  const configured = typeof env[key] === 'string' ? env[key].trim() : ''
  if (configured) {
    return configured
  }
  const values = new Set([...details.values()]
    .filter(Boolean)
    .map(detail => environmentVariables(detail)[key])
    .filter(value => typeof value === 'string' && value.trim()))
  if (values.size > 1) {
    throw new Error(`Existing MIP functions disagree on ${key}; configure it explicitly before deployment`)
  }
  return [...values][0] || ''
}

function validMysqlUri(value) {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'mysql:'
      && Boolean(parsed.hostname && parsed.username && parsed.password && parsed.pathname !== '/')
  }
  catch {
    return false
  }
}

function normalizedJsonObject(value, key) {
  if (!String(value || '').trim()) {
    return '{}'
  }
  const parsed = JSON.parse(value)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${key} must be a JSON object`)
  }
  if (Object.keys(parsed).length > 5) {
    throw new Error(`${key} may contain at most five subscription templates`)
  }
  return JSON.stringify(parsed)
}

function normalizedOptionalJsonArray(value, key) {
  if (!String(value || '').trim()) {
    return undefined
  }
  const parsed = JSON.parse(value)
  if (!Array.isArray(parsed)) {
    throw new TypeError(`${key} must be a JSON array`)
  }
  if (parsed.length === 0) {
    return undefined
  }
  return JSON.stringify(parsed)
}

function environmentForRole(role, options) {
  const shared = {
    MIP_DB_CONNECTION_URI: options.connectionUri,
    MIP_DB_POOL_SIZE: '4',
    MIP_ALLOWED_APP_IDS: options.allowedAppIds.join(','),
    ...(role === 'notification' ? {} : { MIP_IDENTITY_PEPPER: options.secrets.identityPepper }),
    MIP_DEPLOYMENT_STAGE: options.deploymentStage,
  }
  const agreementEnvironment = options.agreementsJson
    ? { MIP_AGREEMENTS_JSON: options.agreementsJson }
    : {}
  const outboxWakeEnvironment = [
    'identity',
    'events',
    'opportunities',
    'commerce',
    'admin',
    'game',
    'tasks',
    'ledger',
  ].includes(role)
    ? {
        MIP_OUTBOX_FUNCTION_NAME: options.functionNames.outbox,
        MIP_OUTBOX_HMAC_SECRET: options.secrets.outboxHmac,
      }
    : {}
  const extra = {
    identity: {
      MIP_PHONE_ENCRYPTION_KEY: options.secrets.phoneEncryption,
      ...agreementEnvironment,
      MIP_UNION_IDENTITY_PEPPER: options.secrets.unionIdentityPepper,
      MIP_UNION_ID_REBIND_ENABLED: options.unionIdRebindEnabled ? 'true' : 'false',
    },
    media: {
      MIP_MEDIA_SCOPE_SECRET: options.secrets.mediaScope,
      MIP_MEDIA_MAINTENANCE_HMAC_SECRET: options.secrets.mediaMaintenanceHmac,
    },
    events: {
      MIP_EVENT_TOKEN_SECRET: options.secrets.eventToken,
      MIP_MEDIA_SCOPE_SECRET: options.secrets.mediaScope,
      MIP_PAYMENT_MODE: options.paymentMode,
    },
    opportunities: agreementEnvironment,
    community: {},
    commerce: {
      ...agreementEnvironment,
      MIP_CATALOG_STAGE: options.catalogStage,
      MIP_MEDIA_SCOPE_SECRET: options.secrets.mediaScope,
      MIP_PAYMENT_MODE: options.paymentMode,
    },
    admin: {
      ...agreementEnvironment,
      MIP_PHONE_ENCRYPTION_KEY: options.secrets.phoneEncryption,
      MIP_REFUND_FUNCTION_NAME: options.functionNames.refund,
      MIP_REFUND_WORKER_HMAC_SECRET: options.secrets.refundWorkerHmac,
      MIP_EXPORT_MAX_ROWS: String(options.exportMaxRows),
      MIP_EXPORT_MAX_BYTES: String(options.exportMaxBytes),
    },
    growth: { MIP_GROWTH_HMAC_SECRET: options.secrets.growthHmac },
    game: agreementEnvironment,
    tasks: agreementEnvironment,
    banners: agreementEnvironment,
    ai: {
      MIP_AI_HMAC_SECRET: options.secrets.aiHmac,
      MIP_AI_STORAGE_KEY: options.secrets.aiStorage,
      MIP_AI_DRAFT_TTL_HOURS: String(options.aiDraftTtlHours),
      ...(options.aiProviderFunction ? { MIP_AI_PROVIDER_FUNCTION_NAME: options.aiProviderFunction } : {}),
      ...(options.aiAvatarProviderFunction
        ? { MIP_AI_AVATAR_PROVIDER_FUNCTION_NAME: options.aiAvatarProviderFunction }
        : {}),
    },
    notifications: {
      MIP_NOTIFICATION_ENCRYPTION_KEY: options.secrets.notificationEncryption,
      MIP_SUBSCRIBE_TEMPLATES_JSON: options.subscribeTemplatesJson,
    },
    ledger: { MIP_LEDGER_SECRET: options.secrets.ledger },
    notification: {
      MIP_NOTIFICATION_HMAC_SECRET: options.secrets.notificationHmac,
      MIP_NOTIFICATION_ENCRYPTION_KEY: options.secrets.notificationEncryption,
      MIP_SUBSCRIBE_TEMPLATES_JSON: options.subscribeTemplatesJson,
      MIP_MINIPROGRAM_STATE: options.miniprogramState,
    },
    outbox: {
      MIP_OUTBOX_HMAC_SECRET: options.secrets.outboxHmac,
      MIP_NOTIFICATION_FUNCTION_NAME: options.functionNames.notification,
      MIP_NOTIFICATION_HMAC_SECRET: options.secrets.notificationHmac,
      MIP_GROWTH_FUNCTION_NAME: options.functionNames.growth,
      MIP_GROWTH_HMAC_SECRET: options.secrets.growthHmac,
    },
  }
  return { ...shared, ...outboxWakeEnvironment, ...extra[role] }
}

function verifyLocalOpenApiDeclarations() {
  const expected = {
    identity: ['phonenumber.getPhoneNumber'],
    media: ['security.imgSecCheck'],
    events: ['security.msgSecCheck', 'wxacode.getUnlimited'],
    opportunities: ['security.msgSecCheck'],
    tasks: ['security.msgSecCheck'],
    banners: ['security.msgSecCheck'],
    ai: ['security.imgSecCheck'],
    notification: ['subscribeMessage.send'],
  }
  for (const [role, permissions] of Object.entries(expected)) {
    const configPath = path.join(sourceRoot, manifest.find(item => item.role === role).source, 'config.json')
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
    for (const permission of permissions) {
      if (!config?.permissions?.openapi?.includes(permission)) {
        throw new Error(`${role} config.json is missing ${permission}`)
      }
    }
  }
}

function delay(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds))
}

async function waitForFunctionActive(functionName) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const detail = existingFunctionDetail(functionName)
    const value = functionDetail(detail)
    if (value?.Status === 'Active' && value?.AvailableStatus === 'Available') {
      return detail
    }
    await delay(1000)
  }
  throw new Error(`${functionName} did not become active after deployment`)
}

async function ensureCompatibleRuntime(functionName) {
  const detail = existingFunctionDetail(functionName)
  if (!detail || functionDetail(detail)?.Runtime === 'Nodejs20.19') {
    return
  }
  if (!replaceLegacyRuntime) {
    throw new Error(`${functionName} uses an incompatible runtime; pass --replace-legacy-runtime to recreate only this mip-* function`)
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
  throw new Error(`${functionName} was not removed before runtime recreation`)
}

function assertEnvironmentReadback(functionName, expected, detail) {
  const actual = environmentVariables(detail)
  for (const [key, value] of Object.entries(expected)) {
    if (actual[key] !== value) {
      throw new Error(`${functionName} environment readback failed for ${key}`)
    }
  }
}

function assertHealthy(functionName) {
  const response = callCloudbase(root, 'manageFunctions', {
    action: 'invokeFunction',
    functionName,
    params: { action: 'health' },
  }, 120000)
  const result = cloudFunctionResult(response)
  if (result?.ok !== true || result?.data?.persistence !== 'cloudbase-mysql') {
    throw new Error(`${functionName} health check did not prove CloudBase MySQL persistence`)
  }
}

function removeForbiddenTimer(functionName, triggerName) {
  try {
    callCloudbase(root, 'callCloudApi', {
      service: 'scf',
      action: 'DeleteTrigger',
      params: {
        FunctionName: functionName,
        TriggerName: triggerName,
        Type: 'timer',
        Namespace: envId,
      },
    })
  }
  catch (error) {
    if (!/not exist|resourcenotfound|不存在|未找到/i.test(String(error?.message || error))) {
      throw error
    }
  }
  const readback = callCloudbase(root, 'callCloudApi', {
    service: 'scf',
    action: 'ListTriggers',
    params: { FunctionName: functionName, Namespace: envId },
  })
  if (JSON.stringify(readback).includes(triggerName)) {
    throw new Error(`${triggerName} must stay absent because it keeps Serverless MySQL awake`)
  }
}

function disableClientInvocation(functionName) {
  setClientInvocationRule(functionName, false)
}

function enableAuthenticatedClientInvocation(functionName) {
  setClientInvocationRule(functionName, 'auth.loginType != \'ANONYMOUS\' && auth != null')
}

function setClientInvocationRule(functionName, invoke) {
  const current = callCloudbase(root, 'queryPermissions', {
    action: 'getResourcePermission',
    resourceType: 'function',
    resourceId: functionName,
  })
  const text = current?.data?.permissions?.[0]?.SecurityRule
  let rules
  try {
    rules = JSON.parse(text)
  }
  catch {
    rules = { '*': { invoke: 'auth.loginType != \'ANONYMOUS\' && auth != null' } }
  }
  rules[functionName] = { invoke }
  callCloudbase(root, 'managePermissions', {
    action: 'updateResourcePermission',
    resourceType: 'function',
    resourceId: functionName,
    permission: 'CUSTOM',
    securityRule: JSON.stringify(rules),
  })
  const readback = callCloudbase(root, 'queryPermissions', {
    action: 'getResourcePermission',
    resourceType: 'function',
    resourceId: functionName,
  })
  let verified
  try {
    verified = JSON.parse(readback?.data?.permissions?.[0]?.SecurityRule)
  }
  catch {
    verified = null
  }
  if (verified?.[functionName]?.invoke !== invoke) {
    throw new Error(`${functionName} client invocation rule did not converge`)
  }
}
