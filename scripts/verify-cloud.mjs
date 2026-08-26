#!/usr/bin/env node

import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import process from 'node:process'
import { assertNoTimerTriggers } from './lib/cloud-function-safety.mjs'
import {
  bindAndRequireMysqlEnvironment,
  callCloudbase,
  cloudFunctionResult,
  loadCaseEnv,
  sqlLiteral,
} from './lib/example-cloudbase.mjs'
import { createMipCoreFunctionManifest } from './lib/mip-function-manifest.mjs'
import { resolveMipFunctionNames } from './lib/mip-function-names.mjs'
import {
  assertRuntimeAccountClaimable,
  assertRuntimePrivilegesExact,
  parseGrantee,
  parsePrivilegeRows,
  RUNTIME_TABLE_PRIVILEGES,
  runtimeUserForEnvironment,
} from './lib/mysql-privilege-assert.mjs'
import { assertSupportedMySqlVersion } from './lib/mysql-version.mjs'

const require = createRequire(import.meta.url)
const { signInternalEvent: signOutboxInternalEvent } = require('../cloudfunctions/mip-outbox-worker/lib/internal-auth')

const root = path.resolve(import.meta.dirname, '..')
const env = loadCaseEnv(root)
const envId = String(env.CLOUDBASE_ENV_ID || '').trim()
const appId = String(env.MINI_PROGRAM_APP_ID || '').trim()
const paymentMode = String(env.MIP_PAYMENT_MODE || 'disabled').trim().toLowerCase()
const catalogStage = String(env.MIP_CATALOG_STAGE || 'TEST').trim().toUpperCase()
const deploymentStage = String(env.MIP_DEPLOYMENT_STAGE || '').trim().toLowerCase()
const functionNames = resolveMipFunctionNames(env)
const coreManifest = createMipCoreFunctionManifest(functionNames)
const confirmedEnv = process.argv.find(value => value.startsWith('--confirm-env='))?.slice('--confirm-env='.length)

if (!envId || confirmedEnv !== envId || !/^wx[0-9a-f]{16}$/i.test(appId)) {
  throw new Error('MIP cloud verification requires configured EnvID/AppID and --confirm-env=<exact EnvID>')
}
if (!['disabled', 'test', 'live'].includes(paymentMode)) {
  throw new Error('MIP_PAYMENT_MODE must be disabled, test, or live')
}
if (!['TEST', 'LIVE'].includes(catalogStage)
  || !['development', 'test', 'staging', 'production'].includes(deploymentStage)) {
  throw new Error('MIP catalog or deployment stage is invalid')
}

bindAndRequireMysqlEnvironment(root, envId)
const mysqlVersion = assertMysqlVersion()

const requiredTables = Object.keys(RUNTIME_TABLE_PRIVILEGES)
const tableNamesSql = requiredTables.map(sqlLiteral).join(', ')
const tableInventory = callCloudbase(root, 'queryMysqlDatabase', {
  action: 'runQuery',
  sql: `SELECT table_name AS tableName FROM information_schema.tables
    WHERE table_schema = DATABASE() AND table_name IN (${tableNamesSql})`,
})
const foundTables = new Set(collectFieldValues(tableInventory, ['tableName', 'table_name']))
const missingTables = requiredTables.filter(table => !foundTables.has(table))
if (missingTables.length) {
  throw new Error(`MIP schema verification failed; missing table ${missingTables[0]}`)
}

const coreDetails = new Map()
const verifiedFunctions = []
const protectedFunctions = coreManifest.filter(item => !item.clientInvokable).map(item => item.name)
for (const spec of coreManifest) {
  const detail = existingFunctionDetail(spec.name)
  assertActiveFunction(spec.name, detail)
  const variables = environmentVariables(detail)
  const allowedAppIds = String(variables.MIP_ALLOWED_APP_IDS || '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean)
  if (!allowedAppIds.includes(appId)) {
    throw new Error(`${spec.name} does not include the configured AppID in MIP_ALLOWED_APP_IDS`)
  }
  assertMysqlHealth(spec.name)
  assertNoFunctionTimers(spec.name)
  coreDetails.set(spec.role, detail)
  verifiedFunctions.push(spec.name)
}

assertRuntimeAccount(coreDetails.get('identity'))
assertOutboxEnvironment(
  coreDetails.get('outbox'),
  coreDetails.get('growth'),
  coreDetails.get('notification'),
)
assertOutboxDependencies(coreDetails.get('outbox'))
assertNotificationEnvironment(coreDetails.get('notifications'), coreDetails.get('notification'))
assertRefundDispatchEnvironment(coreDetails.get('admin'))
assertKnowledgeEnvironment(coreDetails.get('admin'))
assertOwnerTestMembershipEnvironment(coreDetails.get('ledger'))
for (const spec of coreManifest) {
  if (spec.clientInvokable) {
    assertClientInvocationEnabled(spec.name)
  }
  else {
    assertClientInvocationDisabled(spec.name)
  }
}
const disabledPaymentFunctionsProtected = []
if (paymentMode === 'test' || paymentMode === 'live') {
  for (const functionName of [functionNames.pay, functionNames.callback, functionNames.refund]) {
    const detail = existingFunctionDetail(functionName)
    assertActiveFunction(functionName, detail)
    const variables = environmentVariables(detail)
    if (variables.MIP_APP_ID !== appId
      || variables.MIP_PAYMENT_MODE !== paymentMode
      || variables.MIP_LEDGER_FUNCTION !== functionNames.ledger
      || variables.MIP_PAYMENT_CALLBACK_FUNCTION !== functionNames.callback) {
      throw new Error(`${functionName} payment environment does not match the verified MIP deployment`)
    }
    assertPaymentHealth(functionName)
    assertNoFunctionTimers(functionName)
    verifiedFunctions.push(functionName)
  }
  assertRefundWorkerEnvironment(
    existingFunctionDetail(functionNames.refund),
    coreDetails.get('admin'),
  )
  assertClientInvocationEnabled(functionNames.pay)
  assertClientInvocationDisabled(functionNames.callback)
  assertClientInvocationDisabled(functionNames.refund)
  assertClientInvocationDisabled(functionNames.ledger)
  protectedFunctions.push(functionNames.callback, functionNames.refund)
}
else {
  for (const functionName of [functionNames.pay, functionNames.callback, functionNames.refund]) {
    if (!existingFunctionDetail(functionName)) {
      continue
    }
    assertClientInvocationDisabled(functionName)
    assertNoFunctionTimers(functionName)
    disabledPaymentFunctionsProtected.push(functionName)
    protectedFunctions.push(functionName)
  }
}

fs.mkdirSync(path.join(root, '.tmp'), { recursive: true })
fs.writeFileSync(path.join(root, '.tmp', 'verify-cloud-result.json'), `${JSON.stringify({
  environmentVerified: true,
  directMipFunctionsOnly: true,
  persistence: 'cloudbase-mysql',
  mysqlVersion: mysqlVersion.raw,
  mysqlVersionGate: '8.0.22+',
  paymentMode,
  functionsVerified: verifiedFunctions,
  tablesVerified: requiredTables.length,
  runtimeAccountLeastPrivilege: true,
  protectedFunctionsVerified: protectedFunctions,
  disabledPaymentFunctionsProtected,
  functionTimersVerifiedAbsent: true,
  workerTimersVerifiedAbsent: true,
  ownerTestMembershipRestricted: true,
  verifiedAt: new Date().toISOString(),
}, null, 2)}\n`)
console.log('[mip-cloud-verify] schema, least-privilege grants, functions, health, and protected invocation rules verified')

function assertMysqlVersion() {
  const response = callCloudbase(root, 'queryMysqlDatabase', {
    action: 'runQuery',
    sql: 'SELECT VERSION() AS serverVersion',
  })
  const versions = collectFieldValues(response, ['serverVersion', 'server_version'])
  if (versions.length !== 1) {
    throw new Error('CloudBase MySQL version probe did not return exactly one server version')
  }
  return assertSupportedMySqlVersion(versions[0])
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

function assertActiveFunction(functionName, detail) {
  const value = functionDetail(detail)
  if (!value
    || value.Status !== 'Active'
    || value.AvailableStatus !== 'Available'
    || value.Runtime !== 'Nodejs20.19') {
    throw new Error(`${functionName} is not an active Nodejs20.19 function`)
  }
}

function invokeHealth(functionName) {
  const response = callCloudbase(root, 'manageFunctions', {
    action: 'invokeFunction',
    functionName,
    params: { action: 'health' },
  }, 120000)
  const invocation = response?.data?.invokeResult || response?.data?.raw
  if (typeof invocation?.RequestId !== 'string'
    || !invocation.RequestId
    || typeof invocation?.Log !== 'string') {
    throw new Error(`${functionName} did not return Cloud Function invocation evidence`)
  }
  return cloudFunctionResult(response)
}

function assertMysqlHealth(functionName) {
  const result = invokeHealth(functionName)
  if (result?.ok !== true || result?.data?.persistence !== 'cloudbase-mysql') {
    throw new Error(`${functionName} health check did not prove CloudBase MySQL persistence`)
  }
}

function assertPaymentHealth(functionName) {
  const result = invokeHealth(functionName)
  const healthy = functionName === functionNames.pay || functionName === functionNames.refund
    ? result?.ok === true
    && result?.data?.configReady === true
    && result?.data?.paymentMode === paymentMode
    && result?.data?.provider === 'cloudbase-native-cloudpay'
    : result?.errcode === 0 && result?.provider === 'cloudbase-native-cloudpay'
  if (!healthy) {
    throw new Error(`${functionName} payment health contract failed`)
  }
}

function assertRuntimeAccount(referenceDetail) {
  const variables = environmentVariables(referenceDetail)
  const connectionUri = String(variables.MIP_DB_CONNECTION_URI || '').trim()
  let parsed
  try {
    parsed = new URL(connectionUri)
  }
  catch {
    throw new Error('Deployed MIP functions do not contain a valid runtime MySQL connection')
  }
  const user = decodeURIComponent(parsed.username)
  const schema = decodeURIComponent(parsed.pathname.replace(/^\//, ''))
  const expectedUser = String(env.MIP_DB_RUNTIME_USER || runtimeUserForEnvironment(envId)).trim()
  if (parsed.protocol !== 'mysql:'
    || !parsed.hostname
    || !parsed.password
    || user !== expectedUser
    || !/^[\w-]+$/.test(schema)) {
    throw new Error('Deployed MIP functions do not use the dedicated runtime MySQL account')
  }
  const grantee = parseGrantee(user, '%')
  const tableProbe = callCloudbase(root, 'queryMysqlDatabase', {
    action: 'runQuery',
    sql: `SELECT table_schema AS tableSchema, table_name AS tableName,
      privilege_type AS privilegeType, grantee
      FROM information_schema.table_privileges
      WHERE grantee = ${sqlLiteral(grantee)}`,
  })
  const schemaProbe = callCloudbase(root, 'queryMysqlDatabase', {
    action: 'runQuery',
    sql: `SELECT table_schema AS tableSchema, privilege_type AS privilegeType, grantee
      FROM information_schema.schema_privileges
      WHERE grantee = ${sqlLiteral(grantee)}`,
  })
  const userProbe = callCloudbase(root, 'queryMysqlDatabase', {
    action: 'runQuery',
    sql: `SELECT privilege_type AS privilegeType, grantee
      FROM information_schema.user_privileges WHERE grantee = ${sqlLiteral(grantee)}`,
  })
  const tableRows = parsePrivilegeRows(tableProbe)
  const schemaRows = parsePrivilegeRows(schemaProbe)
  const userRows = parsePrivilegeRows(userProbe)
  assertRuntimeAccountClaimable({
    tableRows,
    schemaRows,
    userRows,
    schema,
    grantee,
    allowExisting: true,
  })
  assertRuntimePrivilegesExact({
    tableRows,
    schemaRows,
    userRows,
    requiredMap: RUNTIME_TABLE_PRIVILEGES,
    grantee,
  })
}

function assertOwnerTestMembershipEnvironment(detail) {
  const variables = environmentVariables(detail)
  if (variables.MIP_DEPLOYMENT_STAGE !== deploymentStage
    || variables.MIP_CATALOG_STAGE !== catalogStage
    || variables.MIP_PAYMENT_MODE !== paymentMode) {
    throw new Error('Payment ledger test-membership environment does not match the verified deployment')
  }
  const shouldEnable = ['development', 'test'].includes(deploymentStage)
    && catalogStage === 'TEST'
    && ['disabled', 'test'].includes(paymentMode)
  const configured = String(variables.MIP_TEST_MEMBERSHIP_HMAC_SECRET || '').length >= 32
  if (configured !== shouldEnable) {
    throw new Error('Payment ledger test-membership maintenance boundary is not converged')
  }
}

function assertOutboxEnvironment(detail, growthDetail, notificationDetail) {
  const variables = environmentVariables(detail)
  const growthVariables = environmentVariables(growthDetail)
  const notificationVariables = environmentVariables(notificationDetail)
  if (variables.MIP_NOTIFICATION_FUNCTION_NAME !== functionNames.notification
    || variables.MIP_GROWTH_FUNCTION_NAME !== functionNames.growth
    || String(variables.MIP_OUTBOX_HMAC_SECRET || '').length < 32
    || String(variables.MIP_NOTIFICATION_HMAC_SECRET || '').length < 32
    || String(variables.MIP_GROWTH_HMAC_SECRET || '').length < 32
    || variables.MIP_NOTIFICATION_HMAC_SECRET !== notificationVariables.MIP_NOTIFICATION_HMAC_SECRET
    || variables.MIP_GROWTH_HMAC_SECRET !== growthVariables.MIP_GROWTH_HMAC_SECRET) {
    throw new Error('Outbox worker internal function links or HMAC configuration are incomplete')
  }
}

function assertOutboxDependencies(detail) {
  const variables = environmentVariables(detail)
  const request = {
    action: 'probeDependencies',
    appId,
    timestamp: Date.now(),
  }
  const response = callCloudbase(root, 'manageFunctions', {
    action: 'invokeFunction',
    functionName: functionNames.outbox,
    params: {
      ...request,
      signature: signOutboxInternalEvent(request, variables.MIP_OUTBOX_HMAC_SECRET),
    },
  }, 120000)
  const result = cloudFunctionResult(response)
  if (result?.ok !== true
    || result?.data?.notificationAuthenticated !== true
    || result?.data?.growthAuthenticated !== true) {
    throw new Error('Outbox worker internal function authentication probe failed')
  }
}

function assertRefundDispatchEnvironment(detail) {
  const variables = environmentVariables(detail)
  if (variables.MIP_REFUND_FUNCTION_NAME !== functionNames.refund
    || variables.MIP_MESSAGE_SCHEDULER_FUNCTION_NAME !== functionNames.scheduler
    || String(variables.MIP_REFUND_WORKER_HMAC_SECRET || '').length < 32
    || String(variables.MIP_MESSAGE_DISPATCH_HMAC_SECRET || '').length < 32) {
    throw new Error('Admin worker links or internal HMAC configuration are incomplete')
  }
}

function assertKnowledgeEnvironment(detail) {
  const variables = environmentVariables(detail)
  if (variables.MIP_KNOWLEDGE_SCHEDULER_FUNCTION_NAME !== functionNames.knowledgeScheduler
    || String(variables.MIP_KNOWLEDGE_SCHEDULER_HMAC_SECRET || '').length < 32) {
    throw new Error('Admin knowledge scheduler link or internal HMAC configuration is incomplete')
  }
  for (const key of ['MIP_KNOWLEDGE_SOURCE_ALLOWED_HOSTS', 'MIP_KNOWLEDGE_WEBVIEW_ALLOWED_HOSTS']) {
    const expected = normalizedHostnames(env[key])
    const actual = normalizedHostnames(variables[key])
    if (!expected.length || expected.join(',') !== actual.join(',')) {
      throw new Error(`mip-admin-api ${key} does not match the deployment contract`)
    }
  }
}

function normalizedHostnames(value) {
  return [...new Set(String(value || '').split(',').map(item => item.trim().toLowerCase()).filter(Boolean))].sort()
}

function assertNotificationEnvironment(apiDetail, workerDetail) {
  const api = environmentVariables(apiDetail)
  const worker = environmentVariables(workerDetail)
  const serviceAccountConfigured = Boolean(worker.MIP_SERVICE_ACCOUNT_ADAPTER_JSON)
  if (String(api.MIP_IDENTITY_PEPPER || '').length < 32
    || String(api.MIP_NOTIFICATION_ENCRYPTION_KEY || '').length < 32
    || api.MIP_NOTIFICATION_HMAC_SECRET
    || api.MIP_SERVICE_ACCOUNT_ADAPTER_SECRET
    || String(worker.MIP_NOTIFICATION_HMAC_SECRET || '').length < 32
    || String(worker.MIP_NOTIFICATION_ENCRYPTION_KEY || '').length < 32
    || worker.MIP_IDENTITY_PEPPER
    || api.MIP_CUSTOMER_SERVICE_ENABLED !== worker.MIP_CUSTOMER_SERVICE_ENABLED
    || (serviceAccountConfigured
      ? String(worker.MIP_SERVICE_ACCOUNT_ADAPTER_SECRET || '').length < 32
      : Boolean(worker.MIP_SERVICE_ACCOUNT_ADAPTER_SECRET))) {
    throw new Error('Notification API and worker environment boundaries are incomplete')
  }
}

function assertRefundWorkerEnvironment(refundDetail, adminDetail) {
  const refund = environmentVariables(refundDetail)
  const admin = environmentVariables(adminDetail)
  if (String(refund.MIP_REFUND_WORKER_HMAC_SECRET || '').length < 32
    || refund.MIP_REFUND_WORKER_HMAC_SECRET !== admin.MIP_REFUND_WORKER_HMAC_SECRET) {
    throw new Error('Refund worker HMAC does not match the admin dispatcher')
  }
}

function assertClientInvocationDisabled(functionName) {
  const rule = clientInvocationRule(functionName)
  if (rule !== false) {
    throw new Error(`${functionName} client invocation is not disabled`)
  }
}

function assertClientInvocationEnabled(functionName) {
  const rule = clientInvocationRule(functionName)
  if (rule !== 'auth.loginType != \'ANONYMOUS\' && auth != null') {
    throw new Error(`${functionName} authenticated client invocation is not enabled`)
  }
}

function clientInvocationRule(functionName) {
  const permissions = callCloudbase(root, 'queryPermissions', {
    action: 'getResourcePermission',
    resourceType: 'function',
    resourceId: functionName,
  })
  let rules
  try {
    rules = JSON.parse(permissions?.data?.permissions?.[0]?.SecurityRule)
  }
  catch {
    rules = null
  }
  return rules?.[functionName]?.invoke
}

function assertNoFunctionTimers(functionName) {
  const response = callCloudbase(root, 'callCloudApi', {
    service: 'scf',
    action: 'ListTriggers',
    params: { FunctionName: functionName, Namespace: envId, Limit: 100, Offset: 0 },
  })
  assertNoTimerTriggers(functionName, response)
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
