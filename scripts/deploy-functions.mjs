#!/usr/bin/env node

import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import { isIP } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import {
  assertFunctionSecurityRulesConverged,
  assertNoTimerTriggers,
  parseFunctionSecurityRules,
  updateMipFunctionInvocationRule,
} from './lib/cloud-function-safety.mjs'
import {
  assertExistingFunctionAfterCode,
  assertExistingFunctionAfterConfiguration,
  assertScfRegion,
  existingFunctionCodeConverged,
  existingFunctionConfigurationConverged,
  functionConfigurationSnapshot,
  planExistingFunctionConfigurationUpdate,
} from './lib/core-function-config-update.mjs'
import {
  bindAndRequireMysqlEnvironment,
  callCloudbase,
  cloudFunctionResult,
  loadCaseEnv,
} from './lib/example-cloudbase.mjs'
import { resolveMipDeploymentStage } from './lib/mip-deployment-stage.mjs'
import { createMipCoreFunctionManifest } from './lib/mip-function-manifest.mjs'
import { resolveMipFunctionNames } from './lib/mip-function-names.mjs'
import { resolvePhoneMigrationRebindEnabled } from './lib/mip-identity-rebind-policy.mjs'
import {
  assertMipSchedulerHmacSecretsIsolated,
  assertMipTaskAdminHmacSecretsIsolated,
  resolveMipStableSecrets,
} from './lib/mip-local-secrets.mjs'
import {
  assertRuntimeAccountClaimable,
  assertRuntimePrivilegesExact,
  buildRuntimeGrantStatements,
  buildRuntimeRevokeStatements,
  parseGrantee,
  RUNTIME_TABLE_PRIVILEGES,
  runtimeUserForEnvironment,
} from './lib/mysql-privilege-assert.mjs'
import { loadRuntimeAccountSnapshot } from './lib/mysql-runtime-account-snapshot.mjs'

const root = path.resolve(import.meta.dirname, '..')
const env = loadCaseEnv(root)
const envId = String(env.CLOUDBASE_ENV_ID || '').trim()
const appId = String(env.MINI_PROGRAM_APP_ID || '').trim()
const functionNames = resolveMipFunctionNames(env)
const manifest = createMipCoreFunctionManifest(functionNames)
const requestedFunction = argumentValue('--only=')
const deploymentManifest = requestedFunction
  ? manifest.filter(spec => spec.name === requestedFunction)
  : manifest
const confirmedEnv = argumentValue('--confirm-env=')
const replaceLegacyRuntime = process.argv.includes('--replace-legacy-runtime')
const deploymentStage = resolveMipDeploymentStage(env.MIP_DEPLOYMENT_STAGE, process.argv.slice(2))
const paymentMode = String(env.MIP_PAYMENT_MODE || 'disabled').trim().toLowerCase()
const catalogStage = String(env.MIP_CATALOG_STAGE || 'TEST').trim().toUpperCase()
const configuredTestMembershipHmac = String(env.MIP_TEST_MEMBERSHIP_HMAC_SECRET || '').trim()
const knowledgeTestPriceCents = Number(env.MIP_KNOWLEDGE_TEST_PRICE_CENTS || 990)
const knowledgeSourceAllowedHosts = exactHostnameList(env.MIP_KNOWLEDGE_SOURCE_ALLOWED_HOSTS)
const knowledgeWebviewAllowedHosts = exactHostnameList(env.MIP_KNOWLEDGE_WEBVIEW_ALLOWED_HOSTS)
const unionIdRebindEnabled = String(env.MIP_UNION_ID_REBIND_ENABLED || 'false').trim().toLowerCase() === 'true'
const phoneMigrationRebindEnabled = resolvePhoneMigrationRebindEnabled(
  env.MIP_PHONE_MIGRATION_REBIND_ENABLED,
  deploymentStage,
)
const exportMaxRows = Number(env.MIP_EXPORT_MAX_ROWS || 5_000)
const exportMaxBytes = Number(env.MIP_EXPORT_MAX_BYTES || 8 * 1024 * 1024)
const adminWebLoginConfirmUrl = exactHttpsEndpoint(
  env.MIP_ADMIN_WEB_LOGIN_CONFIRM_URL
  || 'https://mipmini.01mvp.com/api/internal/auth/challenge/confirm',
  'MIP_ADMIN_WEB_LOGIN_CONFIRM_URL',
)
const databaseRuntimeUser = String(env.MIP_DB_RUNTIME_USER || runtimeUserForEnvironment(envId)).trim()
const confirmedRuntimeUser = argumentValue('--confirm-runtime-user=')
const allowedAppIds = String(env.MIP_ALLOWED_APP_IDS || appId)
  .split(',')
  .map(value => value.trim())
  .filter(Boolean)
const legacyTimerNames = Object.freeze({
  notification: 'mip-notification-every-5m',
  outbox: 'mip-outbox-every-5m',
  refund: 'mip-refund-every-5m',
})

if (!envId || confirmedEnv !== envId || !appId) {
  throw new Error('MIP deployment requires AppID and --confirm-env=<exact CLOUDBASE_ENV_ID>')
}
if (requestedFunction && deploymentManifest.length !== 1) {
  throw new Error('--only must name exactly one function from the MIP core deployment manifest')
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
if (!Number.isInteger(knowledgeTestPriceCents)
  || knowledgeTestPriceCents < 1
  || knowledgeTestPriceCents > 10_000_000) {
  throw new Error('MIP_KNOWLEDGE_TEST_PRICE_CENTS must be an integer from 1 to 10000000')
}
if (!knowledgeSourceAllowedHosts.length || !knowledgeWebviewAllowedHosts.length) {
  throw new Error('Knowledge source and web-view exact hostname allowlists are required')
}
if ((paymentMode === 'live' || catalogStage === 'LIVE') && !process.argv.includes('--confirm-live')) {
  throw new Error('Live payment or catalog deployment requires --confirm-live')
}
if (catalogStage === 'LIVE' && paymentMode !== 'live') {
  throw new Error('LIVE catalog requires MIP_PAYMENT_MODE=live')
}
if (deploymentStage === 'staging'
  && catalogStage === 'TEST'
  && ['disabled', 'test'].includes(paymentMode)
  && (configuredTestMembershipHmac.length < 32 || /[\r\n]/.test(configuredTestMembershipHmac))) {
  throw new Error('Staging TEST membership maintenance requires a configured MIP_TEST_MEMBERSHIP_HMAC_SECRET with at least 32 single-line characters')
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
const scfRegion = String(env.MIP_SCF_REGION || findString(target.environment, ['region']) || '').trim()
const existingDetails = new Map(manifest.map(spec => [spec.role, existingFunctionDetail(spec.name)]))
const stableSecretValues = resolveMipStableSecrets({
  localEnv: env,
  deployedEnvironments: [...existingDetails.values()].filter(Boolean).map(environmentVariables),
  generate: () => randomBytes(48).toString('base64url'),
}).values
assertMipSchedulerHmacSecretsIsolated(stableSecretValues)
assertMipTaskAdminHmacSecretsIsolated(stableSecretValues)

let vpcId = String(env.MIP_DB_VPC_ID || findString(target.mysql, ['vpcid', 'vpc_id']) || '').trim()
let subnetId = String(env.MIP_DB_SUBNET_ID || findString(target.mysql, ['subnetid', 'subnet_id']) || '').trim()
let mysqlConnectionInfo = null
if (!vpcId || !subnetId) {
  // Current MCP lifecycle responses omit network metadata; request the explicit TCP payload only when deployment needs it.
  mysqlConnectionInfo = callCloudbase(root, 'queryMysqlDatabase', { action: 'getConnectionInfo' })
  vpcId ||= String(findString(mysqlConnectionInfo, ['vpcid', 'vpc_id']) || '').trim()
  subnetId ||= String(findString(mysqlConnectionInfo, ['subnetid', 'subnet_id']) || '').trim()
}
if (!vpcId || !subnetId) {
  throw new Error('CloudBase MySQL VPC/subnet is unavailable; configure MIP_DB_VPC_ID and MIP_DB_SUBNET_ID')
}

for (const spec of deploymentManifest) {
  const detail = existingDetails.get(spec.role)
  if (detail) {
    assertScfRegion(scfRegion)
    preflightExistingFunction(spec.name, detail, { runtime: 'Nodejs20.19', subnetId, vpcId })
  }
}
for (const spec of deploymentManifest) {
  if (!existingDetails.get(spec.role)) {
    continue
  }
  if (legacyTimerNames[spec.role]) {
    removeOwnedLegacyTimer(spec.name, legacyTimerNames[spec.role])
  }
  assertNoFunctionTimers(spec.name)
}
const disabledPaymentFunctionsProtected = []
if (paymentMode === 'disabled') {
  for (const spec of deploymentManifest.filter(item => ['pay', 'callback', 'refund'].includes(item.role))) {
    const { name: functionName, role } = spec
    if (!existingFunctionDetail(functionName)) {
      continue
    }
    disableClientInvocation(functionName)
    if (legacyTimerNames[role]) {
      removeOwnedLegacyTimer(functionName, legacyTimerNames[role])
    }
    assertNoFunctionTimers(functionName)
    disabledPaymentFunctionsProtected.push(functionName)
  }
}

const requiredTables = Object.keys(RUNTIME_TABLE_PRIVILEGES)
assertRequiredTablesExist(requiredTables)

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
const accountSnapshot = loadRuntimeAccountSnapshot(root, runtimeAccount)
const accountClaim = assertRuntimeAccountClaimable({
  ...accountSnapshot,
  schema: configuredSchema,
  grantee: runtimeAccount,
  allowExisting: Boolean(connectionUri),
})

if (!connectionUri) {
  mysqlConnectionInfo ||= callCloudbase(root, 'queryMysqlDatabase', { action: 'getConnectionInfo' })
  const address = String(
    findString(target.mysql, ['privatenetaddress', 'private_net_address'])
    || findString(mysqlConnectionInfo, ['privatenetaddress', 'private_net_address'])
    || '',
  ).trim()
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
  assertExactRuntimePrivileges(runtimeAccount)
}
console.log(`[mip-cloud-deploy] exact mip_* runtime grants verified (${existingRuntimeGrantsExact ? 'reused' : 'converged'})`)

const secrets = Object.freeze({
  identityPepper: stableSecretValues.MIP_IDENTITY_PEPPER,
  unionIdentityPepper: stableSecretValues.MIP_UNION_IDENTITY_PEPPER,
  mediaScope: stableSecretValues.MIP_MEDIA_SCOPE_SECRET,
  mediaMaintenanceHmac: stableSecretValues.MIP_MEDIA_MAINTENANCE_HMAC_SECRET,
  phoneEncryption: stableSecretValues.MIP_PHONE_ENCRYPTION_KEY,
  eventToken: stableSecretValues.MIP_EVENT_TOKEN_SECRET,
  ledger: stableSecretValues.MIP_LEDGER_SECRET,
  testMembershipHmac: stableSecretValues.MIP_TEST_MEMBERSHIP_HMAC_SECRET,
  growthHmac: stableSecretValues.MIP_GROWTH_HMAC_SECRET,
  notificationHmac: stableSecretValues.MIP_NOTIFICATION_HMAC_SECRET,
  outboxHmac: stableSecretValues.MIP_OUTBOX_HMAC_SECRET,
  messageDispatchHmac: stableSecretValues.MIP_MESSAGE_DISPATCH_HMAC_SECRET,
  adminWebBffHmac: stableSecretValues.MIP_ADMIN_WEB_BFF_HMAC_SECRET,
  adminWebLoginHmac: stableSecretValues.MIP_ADMIN_WEB_LOGIN_HMAC_SECRET,
  tasksAdminHmac: stableSecretValues.MIP_TASKS_ADMIN_HMAC_SECRET,
  bannersAdminHmac: stableSecretValues.MIP_BANNERS_ADMIN_HMAC_SECRET,
  gameAdminHmac: stableSecretValues.MIP_GAME_ADMIN_HMAC_SECRET,
  mediaAdminHmac: stableSecretValues.MIP_MEDIA_ADMIN_HMAC_SECRET,
  knowledgeSchedulerHmac: stableSecretValues.MIP_KNOWLEDGE_SCHEDULER_HMAC_SECRET,
  refundWorkerHmac: stableSecretValues.MIP_REFUND_WORKER_HMAC_SECRET,
  notificationEncryption: stableSecretValues.MIP_NOTIFICATION_ENCRYPTION_KEY,
  aiHmac: stableSecretValues.MIP_AI_HMAC_SECRET,
  aiDraftProviderHmac: stableSecretValues.MIP_AI_DRAFT_PROVIDER_HMAC_SECRET,
  aiAvatarProviderHmac: stableSecretValues.MIP_AI_AVATAR_PROVIDER_HMAC_SECRET,
  aiStorage: stableSecretValues.MIP_AI_STORAGE_KEY,
  matchingInternalHmac: stableSecretValues.MIP_MATCHING_INTERNAL_HMAC_SECRET,
  matchingReference: stableSecretValues.MIP_MATCHING_REFERENCE_SECRET,
})

const subscribeTemplatesJson = normalizedJsonObject(env.MIP_SUBSCRIBE_TEMPLATES_JSON, 'MIP_SUBSCRIBE_TEMPLATES_JSON')
const customerServiceSetting = String(
  env.MIP_CUSTOMER_SERVICE_ENABLED
  || configuredOrExistingValue('MIP_CUSTOMER_SERVICE_ENABLED', existingDetails)
  || 'false',
).trim().toLowerCase()
if (!['true', 'false'].includes(customerServiceSetting)) {
  throw new Error('MIP_CUSTOMER_SERVICE_ENABLED must be true or false')
}
const customerServiceEnabled = customerServiceSetting === 'true'
const serviceAccountAdapterJson = normalizedServiceAccountConfig(
  configuredOrExistingValue('MIP_SERVICE_ACCOUNT_ADAPTER_JSON', existingDetails),
)
const serviceAccountAdapterSecret = configuredOrExistingValue(
  'MIP_SERVICE_ACCOUNT_ADAPTER_SECRET',
  existingDetails,
)
if (Boolean(serviceAccountAdapterJson) !== Boolean(serviceAccountAdapterSecret)) {
  throw new Error('Service-account adapter configuration and secret must be configured together')
}
if (serviceAccountAdapterSecret && serviceAccountAdapterSecret.length < 32) {
  throw new Error('MIP_SERVICE_ACCOUNT_ADAPTER_SECRET must contain at least 32 characters')
}
const agreementsJson = normalizedOptionalJsonArray(env.MIP_AGREEMENTS_JSON, 'MIP_AGREEMENTS_JSON')
const miniprogramState = ['formal', 'trial', 'developer'].includes(env.MIP_MINIPROGRAM_STATE)
  ? env.MIP_MINIPROGRAM_STATE
  : 'trial'
const aiProviderFunction = String(env.MIP_AI_PROVIDER_FUNCTION_NAME || '').trim()
if (aiProviderFunction && !/^[a-z][a-z0-9-]{0,59}$/.test(aiProviderFunction)) {
  throw new Error('MIP_AI_PROVIDER_FUNCTION_NAME is invalid')
}
const aiProviderTimeoutMs = Number(env.MIP_AI_PROVIDER_TIMEOUT_MS || 8000)
if (!Number.isInteger(aiProviderTimeoutMs)
  || aiProviderTimeoutMs < 500
  || aiProviderTimeoutMs > 15_000) {
  throw new Error('MIP_AI_PROVIDER_TIMEOUT_MS must be an integer from 500 to 15000')
}
const aiAvatarProviderFunction = String(env.MIP_AI_AVATAR_PROVIDER_FUNCTION_NAME || '').trim()
if (aiAvatarProviderFunction && aiAvatarProviderFunction !== 'mip-ai-avatar-provider') {
  throw new Error('MIP_AI_AVATAR_PROVIDER_FUNCTION_NAME must be mip-ai-avatar-provider when enabled')
}
const aiAvatarProviderTimeoutMs = Number(env.MIP_AI_AVATAR_PROVIDER_TIMEOUT_MS || 45_000)
if (!Number.isInteger(aiAvatarProviderTimeoutMs)
  || aiAvatarProviderTimeoutMs < 1000
  || aiAvatarProviderTimeoutMs > 50_000) {
  throw new Error('MIP_AI_AVATAR_PROVIDER_TIMEOUT_MS must be an integer from 1000 to 50000')
}
const aiDraftTtlHours = Number(env.MIP_AI_DRAFT_TTL_HOURS || 72)
if (!Number.isInteger(aiDraftTtlHours) || aiDraftTtlHours < 1 || aiDraftTtlHours > 168) {
  throw new Error('MIP_AI_DRAFT_TTL_HOURS must be an integer from 1 to 168')
}
const matchingProviderFunction = String(env.MIP_MATCHING_PROVIDER_FUNCTION_NAME || '').trim()
if (matchingProviderFunction && !/^[a-z][a-z0-9-]{0,59}$/.test(matchingProviderFunction)) {
  throw new Error('MIP_MATCHING_PROVIDER_FUNCTION_NAME is invalid')
}
const matchingProviderTimeoutMs = Number(env.MIP_MATCHING_PROVIDER_TIMEOUT_MS || 3000)
if (!Number.isInteger(matchingProviderTimeoutMs)
  || matchingProviderTimeoutMs < 500
  || matchingProviderTimeoutMs > 10_000) {
  throw new Error('MIP_MATCHING_PROVIDER_TIMEOUT_MS must be an integer from 500 to 10000')
}

const stagingRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mip-core-functions-'))
const deployed = []
try {
  for (const spec of deploymentManifest) {
    fs.cpSync(path.join(sourceRoot, spec.source), path.join(stagingRoot, spec.name), {
      recursive: true,
      filter: source => path.basename(source) !== 'node_modules',
    })
    fs.writeFileSync(
      path.join(stagingRoot, spec.name, 'mip-deployment-marker.json'),
      `${JSON.stringify({ deploymentId: randomBytes(24).toString('base64url') })}\n`,
    )
  }

  for (const spec of deploymentManifest) {
    const envVariables = environmentForRole(spec.role, {
      agreementsJson,
      aiAvatarProviderFunction,
      aiAvatarProviderTimeoutMs,
      aiDraftTtlHours,
      aiProviderFunction,
      aiProviderTimeoutMs,
      allowedAppIds,
      catalogStage,
      connectionUri,
      customerServiceEnabled,
      deploymentStage,
      exportMaxBytes,
      exportMaxRows,
      functionNames,
      knowledgeTestPriceCents,
      knowledgeSourceAllowedHosts,
      knowledgeWebviewAllowedHosts,
      miniprogramState,
      matchingProviderFunction,
      matchingProviderTimeoutMs,
      paymentMode,
      phoneMigrationRebindEnabled,
      secrets,
      serviceAccountAdapterJson,
      serviceAccountAdapterSecret,
      subscribeTemplatesJson,
      unionIdRebindEnabled,
    })
    const expectedConfiguration = {
      envVariables,
      handler: 'index.main',
      runtime: 'Nodejs20.19',
      subnetId,
      timeout: spec.timeout,
      vpcId,
    }
    await ensureCompatibleRuntime(spec.name, expectedConfiguration)
    const currentDetail = existingFunctionDetail(spec.name)
    let existingUpdatePlan = null
    let expectedExistingConfiguration = null
    if (!currentDetail) {
      const creation = callCloudbase(root, 'manageFunctions', {
        action: 'createFunction',
        functionRootPath: stagingRoot,
        force: true,
        func: {
          name: spec.name,
          type: 'Event',
          runtime: expectedConfiguration.runtime,
          handler: expectedConfiguration.handler,
          timeout: expectedConfiguration.timeout,
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
    }
    else {
      const currentConfiguration = functionConfigurationSnapshot(currentDetail)
      expectedExistingConfiguration = {
        environment: envVariables,
        handler: expectedConfiguration.handler,
        role: currentConfiguration.role,
        runtime: expectedConfiguration.runtime,
        subnetId: expectedConfiguration.subnetId,
        timeout: expectedConfiguration.timeout,
        vpcId: expectedConfiguration.vpcId,
      }
      existingUpdatePlan = planExistingFunctionConfigurationUpdate({
        current: currentConfiguration,
        expected: expectedExistingConfiguration,
        functionName: spec.name,
        namespace: envId,
        region: scfRegion,
      })
      if (existingUpdatePlan.configurationCall) {
        updateExistingFunctionConfiguration(spec.name, existingUpdatePlan.configurationCall)
        const configuredDetail = await waitForExistingFunctionConfiguration({
          before: existingUpdatePlan.before,
          expected: expectedExistingConfiguration,
          functionName: spec.name,
        })
        assertExistingFunctionAfterConfiguration({
          actual: functionConfigurationSnapshot(configuredDetail),
          before: existingUpdatePlan.before,
          expected: expectedExistingConfiguration,
          functionName: spec.name,
        })
        console.log(`[mip-cloud-deploy] configuration verified ${spec.name}`)
      }
      else {
        console.log(`[mip-cloud-deploy] configuration already current ${spec.name}`)
      }
    }
    if (spec.role === 'admin') {
      await ensureAdminWebPublicNetwork(spec.name)
    }
    const codeUpdate = {
      action: 'updateFunctionCode',
      functionName: spec.name,
      functionRootPath: stagingRoot,
      force: true,
      ...(existingUpdatePlan?.handlerChanged ? { handler: expectedConfiguration.handler } : {}),
    }
    const codeBaselineDetail = existingUpdatePlan ? existingFunctionDetail(spec.name) : null
    const codeBaselineConfiguration = codeBaselineDetail
      ? functionConfigurationSnapshot(codeBaselineDetail)
      : null
    const codeBaselineSha256 = codeBaselineDetail
      ? existingFunctionCodeSha256(spec.name)
      : ''
    const codeUpdateResponse = callCloudbase(root, 'manageFunctions', codeUpdate, 300000)
    const codeUpdateSummary = managementResponseSummary(codeUpdateResponse)
    if (managementRequestRejected(codeUpdateResponse)) {
      throw new Error(`${spec.name} code update request was rejected: ${codeUpdateSummary}`)
    }
    if (existingUpdatePlan) {
      const detail = await waitForExistingFunctionCode({
        baselineSha256: codeBaselineSha256,
        before: codeBaselineConfiguration,
        expected: expectedExistingConfiguration,
        functionName: spec.name,
      })
      assertExistingFunctionAfterCode({
        actual: functionConfigurationSnapshot(detail),
        before: codeBaselineConfiguration,
        expected: expectedExistingConfiguration,
        functionName: spec.name,
      })
    }
    else {
      const detail = await waitForFunctionActive(spec.name)
      assertFunctionConfigurationReadback(spec.name, expectedConfiguration, detail)
    }
    assertHealthy(spec.name)
    deployed.push(spec.name)
    console.log(`[mip-cloud-deploy] verified ${spec.name}`)
  }
}
finally {
  fs.rmSync(stagingRoot, { recursive: true, force: true })
}

for (const spec of deploymentManifest) {
  if (legacyTimerNames[spec.role]) {
    removeOwnedLegacyTimer(spec.name, legacyTimerNames[spec.role])
  }
  assertNoFunctionTimers(spec.name)
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
  deploymentScope: requestedFunction ? 'single-function' : 'all-core-functions',
  deployed,
  protectedFunctions: deploymentManifest.filter(item => !item.clientInvokable).map(item => item.name),
  disabledPaymentFunctionsProtected,
  functionTimersVerifiedAbsent: true,
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

function managementRequestRejected(value) {
  return value?.success === false
    || value?.data?.success === false
    || value?.structuredContent?.success === false
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

function assertExactRuntimePrivileges(account) {
  assertRuntimePrivilegesExact({
    ...loadRuntimeAccountSnapshot(root, account),
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

function existingFunctionCodeSha256(functionName) {
  const response = callCloudbase(root, 'callCloudApi', {
    service: 'scf',
    action: 'GetFunctionAddress',
    region: scfRegion,
    params: { FunctionName: functionName, Namespace: envId },
  })
  const sha256 = String(
    response?.CodeSha256
    || response?.Response?.CodeSha256
    || response?.data?.CodeSha256
    || '',
  ).trim().toLowerCase()
  if (!/^[a-f0-9]{64}$/.test(sha256)) {
    throw new Error(`${functionName} code SHA-256 readback is unavailable`)
  }
  return sha256
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

function exactHttpsEndpoint(value, key) {
  try {
    const endpoint = new URL(String(value || '').trim())
    if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.hash) {
      throw new Error('invalid')
    }
    return endpoint.toString()
  }
  catch {
    throw new Error(`${key} must be an absolute HTTPS URL without credentials or fragment`)
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

function normalizedServiceAccountConfig(value) {
  if (!String(value || '').trim()) {
    return undefined
  }
  const parsed = JSON.parse(value)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('MIP_SERVICE_ACCOUNT_ADAPTER_JSON must be a JSON object')
  }
  let endpoint
  try {
    endpoint = new URL(String(parsed.endpoint || '').trim())
  }
  catch {
    throw new Error('MIP_SERVICE_ACCOUNT_ADAPTER_JSON endpoint is invalid')
  }
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.hash) {
    throw new Error('MIP_SERVICE_ACCOUNT_ADAPTER_JSON endpoint must use HTTPS')
  }
  if (!parsed.templates || typeof parsed.templates !== 'object' || Array.isArray(parsed.templates)
    || Object.keys(parsed.templates).length < 1 || Object.keys(parsed.templates).length > 10) {
    throw new Error('MIP_SERVICE_ACCOUNT_ADAPTER_JSON templates are invalid')
  }
  return JSON.stringify(parsed)
}

function exactHostnameList(value) {
  const hosts = String(value || '').split(',').map(item => item.trim().toLowerCase()).filter(Boolean)
  if (hosts.some(host => host.includes('*') || host.includes('/') || host.includes(':')
    || isIP(host)
    || !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(host))) {
    throw new Error('Knowledge hostname allowlists accept exact DNS hostnames only')
  }
  return [...new Set(hosts)]
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
    'community',
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
      MIP_MEDIA_SCOPE_SECRET: options.secrets.mediaScope,
      ...agreementEnvironment,
      MIP_UNION_IDENTITY_PEPPER: options.secrets.unionIdentityPepper,
      MIP_UNION_ID_REBIND_ENABLED: options.unionIdRebindEnabled ? 'true' : 'false',
      MIP_PHONE_MIGRATION_REBIND_ENABLED: options.phoneMigrationRebindEnabled ? 'true' : 'false',
    },
    media: {
      MIP_MEDIA_SCOPE_SECRET: options.secrets.mediaScope,
      MIP_MEDIA_MAINTENANCE_HMAC_SECRET: options.secrets.mediaMaintenanceHmac,
      MIP_MEDIA_ADMIN_HMAC_SECRET: options.secrets.mediaAdminHmac,
    },
    events: {
      ...agreementEnvironment,
      MIP_EVENT_TOKEN_SECRET: options.secrets.eventToken,
      MIP_MEDIA_SCOPE_SECRET: options.secrets.mediaScope,
      MIP_PAYMENT_MODE: options.paymentMode,
    },
    opportunities: {
      ...agreementEnvironment,
      MIP_MATCHING_INTERNAL_HMAC_SECRET: options.secrets.matchingInternalHmac,
      MIP_MATCHING_REFERENCE_SECRET: options.secrets.matchingReference,
      ...(options.matchingProviderFunction
        ? { MIP_MATCHING_PROVIDER_FUNCTION_NAME: options.matchingProviderFunction }
        : {}),
      MIP_MATCHING_PROVIDER_TIMEOUT_MS: String(options.matchingProviderTimeoutMs),
    },
    community: {
      ...agreementEnvironment,
      MIP_CATALOG_STAGE: options.catalogStage,
    },
    commerce: {
      ...agreementEnvironment,
      MIP_CATALOG_STAGE: options.catalogStage,
      MIP_MEDIA_SCOPE_SECRET: options.secrets.mediaScope,
      MIP_PAYMENT_MODE: options.paymentMode,
    },
    admin: {
      ...agreementEnvironment,
      MIP_TASKS_FUNCTION_NAME: options.functionNames.tasks,
      MIP_BANNERS_FUNCTION_NAME: options.functionNames.banners,
      MIP_GAME_FUNCTION_NAME: options.functionNames.game,
      MIP_MEDIA_FUNCTION_NAME: options.functionNames.media,
      MIP_PHONE_ENCRYPTION_KEY: options.secrets.phoneEncryption,
      MIP_REFUND_FUNCTION_NAME: options.functionNames.refund,
      MIP_REFUND_WORKER_HMAC_SECRET: options.secrets.refundWorkerHmac,
      MIP_EXPORT_MAX_ROWS: String(options.exportMaxRows),
      MIP_EXPORT_MAX_BYTES: String(options.exportMaxBytes),
      MIP_MATCHING_INTERNAL_HMAC_SECRET: options.secrets.matchingInternalHmac,
      MIP_MESSAGE_DISPATCH_HMAC_SECRET: options.secrets.messageDispatchHmac,
      MIP_ADMIN_WEB_BFF_HMAC_SECRET: options.secrets.adminWebBffHmac,
      MIP_ADMIN_WEB_LOGIN_HMAC_SECRET: options.secrets.adminWebLoginHmac,
      MIP_TASKS_ADMIN_HMAC_SECRET: options.secrets.tasksAdminHmac,
      MIP_BANNERS_ADMIN_HMAC_SECRET: options.secrets.bannersAdminHmac,
      MIP_GAME_ADMIN_HMAC_SECRET: options.secrets.gameAdminHmac,
      MIP_MEDIA_ADMIN_HMAC_SECRET: options.secrets.mediaAdminHmac,
      MIP_ADMIN_WEB_LOGIN_CONFIRM_URL: adminWebLoginConfirmUrl,
      MIP_MESSAGE_SCHEDULER_FUNCTION_NAME: options.functionNames.scheduler,
      MIP_KNOWLEDGE_SCHEDULER_FUNCTION_NAME: options.functionNames.knowledgeScheduler,
      MIP_KNOWLEDGE_SCHEDULER_HMAC_SECRET: options.secrets.knowledgeSchedulerHmac,
      MIP_OPPORTUNITIES_FUNCTION_NAME: options.functionNames.opportunities,
      MIP_CATALOG_STAGE: options.catalogStage,
      MIP_KNOWLEDGE_TEST_PRICE_CENTS: String(options.knowledgeTestPriceCents),
      MIP_KNOWLEDGE_SOURCE_ALLOWED_HOSTS: options.knowledgeSourceAllowedHosts.join(','),
      MIP_KNOWLEDGE_WEBVIEW_ALLOWED_HOSTS: options.knowledgeWebviewAllowedHosts.join(','),
    },
    growth: { MIP_GROWTH_HMAC_SECRET: options.secrets.growthHmac },
    game: {
      ...agreementEnvironment,
      MIP_GAME_ADMIN_HMAC_SECRET: options.secrets.gameAdminHmac,
    },
    tasks: {
      ...agreementEnvironment,
      MIP_TASKS_ADMIN_HMAC_SECRET: options.secrets.tasksAdminHmac,
    },
    banners: {
      ...agreementEnvironment,
      MIP_BANNERS_ADMIN_HMAC_SECRET: options.secrets.bannersAdminHmac,
    },
    ai: {
      MIP_AI_HMAC_SECRET: options.secrets.aiHmac,
      MIP_AI_STORAGE_KEY: options.secrets.aiStorage,
      MIP_AI_DRAFT_TTL_HOURS: String(options.aiDraftTtlHours),
      ...(options.aiProviderFunction
        ? {
            MIP_AI_PROVIDER_FUNCTION_NAME: options.aiProviderFunction,
            MIP_AI_PROVIDER_TIMEOUT_MS: String(options.aiProviderTimeoutMs),
            MIP_AI_DRAFT_PROVIDER_HMAC_SECRET: options.secrets.aiDraftProviderHmac,
          }
        : {}),
      ...(options.aiAvatarProviderFunction
        ? {
            MIP_AI_AVATAR_PROVIDER_FUNCTION_NAME: options.aiAvatarProviderFunction,
            MIP_AI_AVATAR_PROVIDER_HMAC_SECRET: options.secrets.aiAvatarProviderHmac,
            MIP_AI_AVATAR_PROVIDER_TIMEOUT_MS: String(options.aiAvatarProviderTimeoutMs),
          }
        : {}),
    },
    notifications: {
      MIP_NOTIFICATION_ENCRYPTION_KEY: options.secrets.notificationEncryption,
      MIP_SUBSCRIBE_TEMPLATES_JSON: options.subscribeTemplatesJson,
      MIP_CUSTOMER_SERVICE_ENABLED: String(options.customerServiceEnabled),
    },
    ledger: {
      MIP_LEDGER_SECRET: options.secrets.ledger,
      MIP_CATALOG_STAGE: options.catalogStage,
      MIP_PAYMENT_MODE: options.paymentMode,
      ...(['development', 'test', 'staging'].includes(options.deploymentStage)
        && options.catalogStage === 'TEST'
        && ['disabled', 'test'].includes(options.paymentMode)
        ? { MIP_TEST_MEMBERSHIP_HMAC_SECRET: options.secrets.testMembershipHmac }
        : {}),
    },
    notification: {
      MIP_NOTIFICATION_HMAC_SECRET: options.secrets.notificationHmac,
      MIP_NOTIFICATION_ENCRYPTION_KEY: options.secrets.notificationEncryption,
      MIP_SUBSCRIBE_TEMPLATES_JSON: options.subscribeTemplatesJson,
      MIP_CUSTOMER_SERVICE_ENABLED: String(options.customerServiceEnabled),
      MIP_MINIPROGRAM_STATE: options.miniprogramState,
      ...(options.serviceAccountAdapterJson
        ? {
            MIP_SERVICE_ACCOUNT_ADAPTER_JSON: options.serviceAccountAdapterJson,
            MIP_SERVICE_ACCOUNT_ADAPTER_SECRET: options.serviceAccountAdapterSecret,
          }
        : {}),
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
    identity: ['phonenumber.getPhoneNumber', 'wxacode.getUnlimited'],
    media: ['security.imgSecCheck'],
    events: ['security.msgSecCheck', 'wxacode.getUnlimited'],
    opportunities: ['security.msgSecCheck'],
    community: ['security.msgSecCheck'],
    tasks: ['security.msgSecCheck'],
    banners: ['security.msgSecCheck'],
    ai: ['security.imgSecCheck'],
    notification: ['customerServiceMessage.send', 'subscribeMessage.send'],
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

async function waitForExistingFunctionConfiguration({ before, expected, functionName }) {
  return waitForExistingFunctionConvergence({
    before,
    expected,
    functionName,
    phase: 'configuration',
    converged: existingFunctionConfigurationConverged,
  })
}

async function waitForExistingFunctionCode({ baselineSha256, before, expected, functionName }) {
  return waitForExistingFunctionConvergence({
    baselineSha256,
    before,
    expected,
    functionName,
    phase: 'code',
    converged: existingFunctionCodeConverged,
  })
}

async function waitForExistingFunctionConvergence({ baselineSha256 = '', before, expected, functionName, phase, converged }) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const detail = existingFunctionDetail(functionName)
    const value = functionDetail(detail)
    const readbackConverged = converged({
      actual: functionConfigurationSnapshot(detail),
      before,
      expected,
      functionName,
    })
    const active = value?.Status === 'Active' && value?.AvailableStatus === 'Available'
    let deploymentAdvanced = phase !== 'code'
    if (active && phase === 'code') {
      try {
        deploymentAdvanced = existingFunctionCodeSha256(functionName) !== baselineSha256
      }
      catch {
        // SCF can briefly reject GetFunctionAddress while the updated function becomes readable.
      }
    }
    if (active
      && deploymentAdvanced
      && readbackConverged) {
      return detail
    }
    await delay(1000)
  }
  throw new Error(`${functionName} ${phase} readback did not converge`)
}

async function ensureAdminWebPublicNetwork(functionName) {
  const beforeDetail = existingFunctionDetail(functionName)
  const before = functionConfigurationSnapshot(beforeDetail)
  if (functionDetail(beforeDetail)?.PublicNetConfig?.PublicNetStatus === 'ENABLE') {
    return
  }
  let updateResponse
  try {
    updateResponse = callCloudbase(root, 'callCloudApi', {
      service: 'scf',
      action: 'UpdateFunctionConfiguration',
      region: scfRegion,
      params: {
        FunctionName: functionName,
        Namespace: envId,
        PublicNetConfig: {
          PublicNetStatus: 'ENABLE',
          EipConfig: { EipStatus: 'DISABLE' },
        },
      },
    }, 300000)
  }
  catch (error) {
    throw new Error(`${functionName} public network update failed: ${sanitizedManagementMessage(error instanceof Error ? error.message : error)}`)
  }
  if (managementRequestRejected(updateResponse)) {
    throw new Error(`${functionName} public network update was rejected: ${managementResponseSummary(updateResponse)}`)
  }
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const detail = existingFunctionDetail(functionName)
    const value = functionDetail(detail)
    if (value?.Status === 'Active'
      && value?.AvailableStatus === 'Available'
      && value?.PublicNetConfig?.PublicNetStatus === 'ENABLE') {
      assertExistingFunctionAfterConfiguration({
        actual: functionConfigurationSnapshot(detail),
        before,
        expected: before,
        functionName,
      })
      console.log(`[mip-cloud-deploy] public network verified ${functionName}`)
      return
    }
    await delay(1000)
  }
  throw new Error(`${functionName} public network readback did not converge`)
}

async function ensureCompatibleRuntime(functionName, expected) {
  const detail = existingFunctionDetail(functionName)
  if (!detail) {
    return
  }
  const current = validatedExistingFunctionConfiguration(functionName, detail)
  if (current.vpcId !== expected.vpcId || current.subnetId !== expected.subnetId) {
    throw new Error(`${functionName} VPC configuration drift; refusing runtime replacement`)
  }
  if (current.runtime === expected.runtime) {
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

function preflightExistingFunction(functionName, detail, expected) {
  const current = validatedExistingFunctionConfiguration(functionName, detail)
  if (current.vpcId !== expected.vpcId || current.subnetId !== expected.subnetId) {
    throw new Error(`${functionName} VPC configuration drift; refusing deployment writes`)
  }
  if (current.runtime !== expected.runtime && !replaceLegacyRuntime) {
    throw new Error(`${functionName} uses an incompatible runtime; pass --replace-legacy-runtime to recreate only this mip-* function`)
  }
}

function validatedExistingFunctionConfiguration(functionName, detail) {
  const current = functionConfigurationSnapshot(detail)
  planExistingFunctionConfigurationUpdate({
    current,
    expected: current,
    functionName,
    namespace: envId,
    region: scfRegion,
  })
  return current
}

function updateExistingFunctionConfiguration(functionName, configurationCall) {
  try {
    callCloudbase(root, 'callCloudApi', configurationCall, 300000)
  }
  catch {
    // The raw control-plane response can echo Environment; never propagate it into deployment logs.
    throw new Error(`${functionName} configuration update failed`)
  }
}

function assertEnvironmentReadback(functionName, expected, detail) {
  const actual = environmentVariables(detail)
  for (const [key, value] of Object.entries(expected)) {
    if (actual[key] !== value) {
      throw new Error(`${functionName} environment readback failed for ${key}`)
    }
  }
}

function functionConfigurationMatches(detail, expected) {
  const value = functionDetail(detail)
  if (!value) {
    return false
  }
  const actualEnvironment = environmentVariables(detail)
  const expectedEnvironmentEntries = Object.entries(expected.envVariables).sort(([a], [b]) => a.localeCompare(b))
  const actualEnvironmentEntries = Object.entries(actualEnvironment).sort(([a], [b]) => a.localeCompare(b))
  return value.Runtime === expected.runtime
    && value.Handler === expected.handler
    && Number(value.Timeout) === Number(expected.timeout)
    && value.VpcConfig?.VpcId === expected.vpcId
    && value.VpcConfig?.SubnetId === expected.subnetId
    && JSON.stringify(actualEnvironmentEntries) === JSON.stringify(expectedEnvironmentEntries)
}

function assertFunctionConfigurationReadback(functionName, expected, detail) {
  assertEnvironmentReadback(functionName, expected.envVariables, detail)
  if (!functionConfigurationMatches(detail, expected)) {
    throw new Error(`${functionName} configuration readback did not match runtime, handler, timeout, VPC, or exact environment`)
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

function removeOwnedLegacyTimer(functionName, triggerName) {
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
}

function assertNoFunctionTimers(functionName) {
  const readback = callCloudbase(root, 'callCloudApi', {
    service: 'scf',
    action: 'ListTriggers',
    params: { FunctionName: functionName, Namespace: envId, Limit: 100, Offset: 0 },
  })
  assertNoTimerTriggers(functionName, readback)
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
  const rules = parseFunctionSecurityRules(text)
  const updatedRules = updateMipFunctionInvocationRule(rules, functionName, invoke)
  callCloudbase(root, 'managePermissions', {
    action: 'updateResourcePermission',
    resourceType: 'function',
    resourceId: functionName,
    permission: 'CUSTOM',
    securityRule: JSON.stringify(updatedRules),
  })
  const readback = callCloudbase(root, 'queryPermissions', {
    action: 'getResourcePermission',
    resourceType: 'function',
    resourceId: functionName,
  })
  const verified = parseFunctionSecurityRules(
    readback?.data?.permissions?.[0]?.SecurityRule,
  )
  assertFunctionSecurityRulesConverged({
    before: rules,
    after: verified,
    functionName,
    invoke,
  })
}
