#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import {
  assertFunctionSecurityRulesConverged,
  parseFunctionSecurityRules,
  updateMipFunctionInvocationRule,
} from './lib/cloud-function-safety.mjs'
import {
  bindAndRequireCloudbaseEnvironment,
  callCloudbase,
  cloudFunctionResult,
  loadCaseEnv,
} from './lib/example-cloudbase.mjs'
import {
  assertExistingSchedulerFunctionIdentity,
  assertRollingSchedulerEnvironmentContract,
  assertRollingSchedulerFunctionReadback,
  assertSingleSchedulerTrigger,
  asyncEventRetryConfig,
  camPolicyDocument,
  camRoleInfo,
  canonicalJson,
  environmentVariables,
  functionDetail,
  normalizeTriggerEnable,
  parsePolicyDocument,
  preflightSchedulerTriggerInventory,
  reservedConcurrency,
  resolveSchedulerOperationsSpec,
  rollingSchedulerAdminRuntimeContract,
  rollingSchedulerCloudConfig,
  rollingSchedulerCreateFunctionRequest,
  SCHEDULER_ASYNC_MSG_TTL_SECONDS,
  SCHEDULER_ASYNC_RETRY_NUM,
  SCHEDULER_DEPLOYABLE_SOURCE_FILES,
  SCHEDULER_MEMORY_MB,
  SCHEDULER_RESERVED_CONCURRENCY_MB,
  SCHEDULER_TIMEOUT_SECONDS,
  schedulerRuntimePolicy,
  schedulerScfCloudApiRequest,
  schedulerSourceFingerprint,
  schedulerTrustPolicy,
  triggerList,
} from './lib/message-scheduler-cloud.mjs'
import { resolveMipDeploymentStage } from './lib/mip-deployment-stage.mjs'
import { resolveMipFunctionNames } from './lib/mip-function-names.mjs'

const require = createRequire(import.meta.url)
const root = path.resolve(import.meta.dirname, '..')
const env = loadCaseEnv(root)
const functionNames = resolveMipFunctionNames(env)
const spec = resolveSchedulerOperationsSpec(process.argv.slice(2))
const config = rollingSchedulerCloudConfig(env, functionNames, spec)
const schedulerSourceDirectory = path.join(root, 'cloudfunctions', spec.sourceDirectory)
const {
  createSchedulerActivation,
  createTimerMessage,
  verifyTimerMessage,
} = require(path.join(schedulerSourceDirectory, 'lib', 'auth.js'))
const { oneShotCron } = require(path.join(schedulerSourceDirectory, 'lib', 'trigger-controller.js'))
const appId = String(env.MINI_PROGRAM_APP_ID || '').trim()
const stage = resolveMipDeploymentStage(env.MIP_DEPLOYMENT_STAGE, process.argv.slice(2))
const startCanary = process.argv.includes('--start-canary')
const activateGeneration = argumentValue('--activate-after-canary=')
const resumeMissingTrigger = argumentValue('--confirm-resume-missing-trigger=')

assertConfirmations()
if (startCanary === Boolean(activateGeneration)) {
  throw new Error('Choose exactly one of --start-canary or --activate-after-canary=<generation>')
}
if (activateGeneration && !/^[a-f0-9]{32}$/i.test(activateGeneration)) {
  throw new Error('--activate-after-canary must contain the exact canary generation')
}
if (resumeMissingTrigger
  && (resumeMissingTrigger !== config.functionName || !startCanary)) {
  throw new Error('Missing-trigger recovery requires --start-canary and the exact function confirmation')
}
if (!/^wx[0-9a-f]{16}$/i.test(appId)) {
  throw new Error('Configured AppID is invalid')
}

bindAndRequireCloudbaseEnvironment(root, config.envId)
assertDedicatedRoleReady()

const adminDetail = getFunction(config.adminFunctionName)
if (!adminDetail) {
  throw new Error(`Deploy mip-admin-api before the ${spec.kind} scheduler`)
}
const adminEnvironment = environmentVariables(adminDetail)
const adminContract = rollingSchedulerAdminRuntimeContract(adminEnvironment, {
  requiredAppId: appId,
  schedulerFunctionName: config.functionName,
  outboxFunctionName: functionNames.outbox,
}, spec)
const allowedAppIds = adminContract.allowedAppIds
const secret = adminContract.secret

const expectedEnvironment = {
  MIP_ALLOWED_APP_IDS: allowedAppIds.join(','),
  MIP_ADMIN_FUNCTION_NAME: config.adminFunctionName,
  [spec.secretEnvKey]: secret,
  [spec.functionEnvKey]: config.functionName,
  [spec.markerEnvKey]: schedulerSourceFingerprint(schedulerSourceDirectory),
  [spec.triggerEnvKey]: config.triggerName,
  MIP_SCF_NAMESPACE: config.envId,
  MIP_SCF_REGION: config.region,
  MIP_SCF_TIMER_UTC_OFFSET_MINUTES: String(config.cronUtcOffsetMinutes),
  MIP_DEPLOYMENT_STAGE: stage,
}
assertRollingSchedulerEnvironmentContract(expectedEnvironment, config, spec)

const existingSchedulerDetail = getFunction(config.functionName)
assertExistingSchedulerFunctionIdentity(existingSchedulerDetail, config)
const schedulerPreflight = preflightSchedulerTriggerInventory(
  existingSchedulerDetail,
  existingSchedulerDetail ? rawTriggerInventory() : null,
  config,
  { allowMissingExisting: resumeMissingTrigger === config.functionName },
)
if (schedulerPreflight.resumingMissingTrigger) {
  assertRollingSchedulerFunctionReadback(existingSchedulerDetail, config, expectedEnvironment, spec)
}

const stagingRoot = fs.mkdtempSync(path.join(os.tmpdir(), `${config.functionName}-`))
try {
  const sourceDirectory = path.join(stagingRoot, config.functionName)
  stageFunctionSources(schedulerSourceDirectory, sourceDirectory)
  const zipFile = createFunctionArchive(sourceDirectory, stagingRoot)
  if (!schedulerPreflight.exists) {
    // Raw SCF creation is required: CloudBase MCP 2.32.0 otherwise injects TCB_QcsRole.
    callScf(
      'CreateFunction',
      rollingSchedulerCreateFunctionRequest(config, expectedEnvironment, zipFile, spec),
    )
    const detail = await waitForActive()
    assertRollingSchedulerFunctionReadback(detail, config, expectedEnvironment, spec)
  }
  else {
    callScf('UpdateFunctionConfiguration', {
      FunctionName: config.functionName,
      Namespace: config.envId,
      Description: spec.functionDescription,
      MemorySize: SCHEDULER_MEMORY_MB,
      Timeout: SCHEDULER_TIMEOUT_SECONDS,
      Role: config.roleName,
      Environment: {
        Variables: Object.entries(expectedEnvironment).map(([Key, Value]) => ({ Key, Value })),
      },
    })
    await waitForActive()
    callScf('UpdateFunctionCode', {
      FunctionName: config.functionName,
      Namespace: config.envId,
      Handler: 'index.main',
      ZipFile: zipFile,
      InstallDependency: 'TRUE',
      CodeSource: 'ZipFile',
    })
    const detail = await waitForActive()
    assertRollingSchedulerFunctionReadback(detail, config, expectedEnvironment, spec)
  }
}
finally {
  fs.rmSync(stagingRoot, { recursive: true, force: true })
}

// A new function can only be inventoried after its one unavoidable CreateFunction write.
const currentTriggers = listTriggers()
let trigger = assertSingleSchedulerTrigger(currentTriggers, config, {
  allowMissing: !schedulerPreflight.exists || schedulerPreflight.resumingMissingTrigger,
})

configureAsyncEventRetry()
callScf('PutReservedConcurrencyConfig', {
  FunctionName: config.functionName,
  Namespace: config.envId,
  ReservedConcurrencyMem: SCHEDULER_RESERVED_CONCURRENCY_MB,
})
const reserved = callScf('GetReservedConcurrencyConfig', {
  FunctionName: config.functionName,
  Namespace: config.envId,
})
if (reservedConcurrency(reserved) !== SCHEDULER_RESERVED_CONCURRENCY_MB) {
  throw new Error('Scheduler reserved concurrency readback failed')
}
disableClientInvocation()
if (startCanary) {
  const fireAt = new Date(Math.ceil((Date.now() + 120_000) / 1000) * 1000)
  const generation = randomBytes(16).toString('hex')
  const message = createTimerMessage({
    namespace: config.envId,
    functionName: config.functionName,
    triggerName: config.triggerName,
    fireAt: fireAt.toISOString(),
    generation,
    activationGeneration: generation,
    purpose: 'CANARY',
  }, secret)
  const request = {
    FunctionName: config.functionName,
    TriggerName: config.triggerName,
    Type: 'timer',
    TriggerDesc: oneShotCron(fireAt, config.cronUtcOffsetMinutes),
    Qualifier: '$DEFAULT',
    Enable: 'OPEN',
    CustomArgument: JSON.stringify(message),
    Namespace: config.envId,
  }
  callScf(trigger ? 'UpdateTrigger' : 'CreateTrigger', request)
  trigger = assertSingleSchedulerTrigger(listTriggers(), config)
  const readback = verifiedTriggerMessage(trigger, secret)
  if (normalizeTriggerEnable(trigger.Enable) !== 'OPEN'
    || readback.generation !== generation
    || readback.activationGeneration !== generation
    || readback.purpose !== 'CANARY') {
    throw new Error('Scheduler canary trigger readback failed')
  }
  console.log(JSON.stringify({
    mode: 'canary-started',
    function: config.functionName,
    trigger: config.triggerName,
    fireAt: readback.fireAt,
    generation,
    next: 'wait for fireAt, then rerun with --activate-after-canary=<generation>',
  }, null, 2))
}
else {
  if (!trigger) {
    throw new Error('Start and verify the scheduler canary before activation')
  }
  const activationState = verifiedTriggerMessage(trigger, secret)
  const verifiedCanary = normalizeTriggerEnable(trigger.Enable) === 'CLOSE'
    && activationState.purpose === 'CANARY'
    && activationState.generation === activateGeneration
    && activationState.activationGeneration === activateGeneration
    && Date.parse(activationState.fireAt) <= Date.now()
  const resumableDispatch = activationState.purpose === 'DISPATCH'
    && activationState.activationGeneration === activateGeneration
  if (!verifiedCanary && !resumableDispatch) {
    throw new Error('Scheduler canary has not produced a closed, matching readback')
  }
  const request = createSchedulerActivation({
    namespace: config.envId,
    functionName: config.functionName,
    triggerName: config.triggerName,
    sourceFunction: 'mip-admin-api',
    generation: activateGeneration,
    nonce: randomBytes(12).toString('hex'),
    timestamp: Date.now(),
  }, secret)
  const invocation = callCloudbase(root, 'manageFunctions', {
    action: 'invokeFunction',
    functionName: config.functionName,
    params: request,
  }, 120000)
  const result = cloudFunctionResult(invocation)
  if (result?.ok !== true || result?.data?.verified !== true) {
    throw new Error(result?.error?.code || 'Scheduler activation reconciliation failed')
  }
  const activeTrigger = assertSingleSchedulerTrigger(listTriggers(), config)
  const activeMessage = verifiedTriggerMessage(activeTrigger, secret)
  if (activeMessage.purpose !== 'DISPATCH'
    || activeMessage.activationGeneration !== activateGeneration) {
    throw new Error('Scheduler activation mode readback failed')
  }
  console.log(JSON.stringify({
    mode: 'activated',
    function: config.functionName,
    trigger: config.triggerName,
    triggerState: normalizeTriggerEnable(activeTrigger.Enable),
    nextWakeConfigured: Boolean(result.data.nextWakeAt),
    reservedConcurrencyMb: SCHEDULER_RESERVED_CONCURRENCY_MB,
  }, null, 2))
}

function assertConfirmations() {
  if (argumentValue('--confirm-env=') !== config.envId
    || argumentValue('--confirm-function=') !== config.functionName
    || argumentValue('--confirm-trigger=') !== config.triggerName
    || argumentValue('--confirm-role=') !== config.roleName
    || Number(argumentValue('--confirm-timer-offset-minutes=')) !== config.cronUtcOffsetMinutes) {
    throw new Error('Scheduler deploy requires exact environment, function, trigger, role, and canaried timer-offset confirmations')
  }
}

function assertDedicatedRoleReady() {
  const role = camRoleInfo(callCam('GetRole', { RoleName: config.roleName }))
  const trust = parsePolicyDocument(role?.PolicyDocument)
  if (role?.RoleName !== config.roleName
    || String(role?.RoleName).toLowerCase() === 'tcb_qcsrole'
    || !trust
    || canonicalJson(trust) !== canonicalJson(schedulerTrustPolicy())) {
    throw new Error('Dedicated scheduler role is not ready')
  }
  const policies = response(callCam('ListAttachedRolePolicies', {
    RoleName: config.roleName,
    Page: 1,
    Rp: 200,
  }))
  const list = policies?.List || policies?.PolicyList || []
  if (list.length !== 1) {
    throw new Error('Dedicated scheduler role must contain exactly one attached policy')
  }
  const policy = list.find(item => item.PolicyName === config.policyName)
  if (!policy || !Number.isSafeInteger(Number(policy.PolicyId))) {
    throw new Error('Dedicated scheduler role does not contain the expected minimum policy')
  }
  const document = camPolicyDocument(callCam('GetPolicy', {
    PolicyId: Number(policy.PolicyId),
  }))
  if (!document || canonicalJson(document) !== canonicalJson(schedulerRuntimePolicy(config))) {
    throw new Error('Dedicated scheduler policy does not match the minimum runtime contract')
  }
}

function createFunctionArchive(sourceDirectory, stagingDirectory) {
  const archivePath = path.join(stagingDirectory, `${config.functionName}.zip`)
  const result = spawnSync('/usr/bin/zip', [
    '-q',
    '-r',
    '-y',
    archivePath,
    '.',
    '-x',
    'node_modules/*',
    'tests/*',
    '.DS_Store',
  ], {
    cwd: sourceDirectory,
    encoding: 'utf8',
  })
  if (result.status !== 0) {
    throw new Error('Scheduler source package creation failed')
  }
  const archive = fs.readFileSync(archivePath)
  if (archive.length === 0 || archive.length > 20 * 1024 * 1024) {
    throw new Error('Scheduler source package is outside the raw SCF limit')
  }
  return archive.toString('base64')
}

function stageFunctionSources(sourceDirectory, targetDirectory) {
  for (const relative of SCHEDULER_DEPLOYABLE_SOURCE_FILES) {
    const source = path.join(sourceDirectory, ...relative.split('/'))
    const target = path.join(targetDirectory, ...relative.split('/'))
    const stat = fs.lstatSync(source)
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error('Scheduler deployable source allowlist is invalid')
    }
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.copyFileSync(source, target)
  }
}

function configureAsyncEventRetry() {
  // Timer delivery is asynchronous; user-code retries must be explicit and read back.
  // https://cloud.tencent.com/document/api/583/53639
  callScf('UpdateFunctionEventInvokeConfig', {
    FunctionName: config.functionName,
    Namespace: config.envId,
    AsyncTriggerConfig: {
      MsgTTL: SCHEDULER_ASYNC_MSG_TTL_SECONDS,
      RetryConfig: [{ RetryNum: SCHEDULER_ASYNC_RETRY_NUM }],
    },
  })
  const actual = asyncEventRetryConfig(callScf('GetFunctionEventInvokeConfig', {
    FunctionName: config.functionName,
    Namespace: config.envId,
    Qualifier: '$LATEST',
  }))
  if (actual.msgTtl !== SCHEDULER_ASYNC_MSG_TTL_SECONDS
    || actual.retryNum !== SCHEDULER_ASYNC_RETRY_NUM) {
    throw new Error('Scheduler async event retry readback failed')
  }
}

function disableClientInvocation() {
  const current = callCloudbase(root, 'queryPermissions', {
    action: 'getResourcePermission',
    resourceType: 'function',
    resourceId: config.functionName,
  })
  const rules = parseFunctionSecurityRules(current?.data?.permissions?.[0]?.SecurityRule)
  const updated = updateMipFunctionInvocationRule(rules, config.functionName, false)
  callCloudbase(root, 'managePermissions', {
    action: 'updateResourcePermission',
    resourceType: 'function',
    resourceId: config.functionName,
    permission: 'CUSTOM',
    securityRule: JSON.stringify(updated),
  })
  const readback = callCloudbase(root, 'queryPermissions', {
    action: 'getResourcePermission',
    resourceType: 'function',
    resourceId: config.functionName,
  })
  assertFunctionSecurityRulesConverged({
    before: rules,
    after: parseFunctionSecurityRules(readback?.data?.permissions?.[0]?.SecurityRule),
    functionName: config.functionName,
    invoke: false,
  })
}

function listTriggers() {
  return triggerList(rawTriggerInventory())
}

function rawTriggerInventory() {
  return callScf('ListTriggers', {
    FunctionName: config.functionName,
    Namespace: config.envId,
    Limit: 100,
    Offset: 0,
  })
}

function verifiedTriggerMessage(value, secretValue) {
  let parsed
  try {
    parsed = JSON.parse(value?.CustomArgument ?? value?.Argument ?? '')
  }
  catch {
    throw new Error('Scheduler trigger argument is invalid')
  }
  return verifyTimerMessage(parsed, {
    namespace: config.envId,
    functionName: config.functionName,
    triggerName: config.triggerName,
    secret: secretValue,
  })
}

function getFunction(functionName) {
  try {
    return callScf('GetFunction', {
      FunctionName: functionName,
      Namespace: config.envId,
      ShowCode: 'FALSE',
    })
  }
  catch (error) {
    if (/not found|not exist|resourcenotfound|不存在|未找到/i.test(String(error?.message || error))) {
      return null
    }
    throw error
  }
}

async function waitForActive() {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const detail = getFunction(config.functionName)
    const value = functionDetail(detail)
    if (value?.Status === 'Active' && value?.AvailableStatus === 'Available') {
      return detail
    }
    await new Promise(resolve => setTimeout(resolve, 1000))
  }
  throw new Error('Scheduler function did not become active')
}

function callScf(action, params) {
  return callCloudbase(root, 'callCloudApi', schedulerScfCloudApiRequest(config, action, params))
}

function callCam(action, params) {
  return callCloudbase(root, 'callCloudApi', { service: 'cam', action, params })
}

function response(value) {
  return value?.Response || value?.data || value
}

function argumentValue(prefix) {
  return process.argv.find(value => value.startsWith(prefix))?.slice(prefix.length)
}
