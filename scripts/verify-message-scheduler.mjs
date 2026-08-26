#!/usr/bin/env node

import { createRequire } from 'node:module'
import path from 'node:path'
import process from 'node:process'
import {
  bindAndRequireCloudbaseEnvironment,
  callCloudbase,
  cloudFunctionResult,
  loadCaseEnv,
} from './lib/example-cloudbase.mjs'
import {
  assertRollingSchedulerEnvironmentContract,
  assertSingleSchedulerTrigger,
  asyncEventRetryConfig,
  camPolicyDocument,
  camRoleInfo,
  canonicalJson,
  environmentVariables,
  functionDetail,
  normalizeTriggerEnable,
  parsePolicyDocument,
  reservedConcurrency,
  resolveSchedulerOperationsSpec,
  rollingSchedulerAdminRuntimeContract,
  rollingSchedulerCloudConfig,
  SCHEDULER_ASYNC_MSG_TTL_SECONDS,
  SCHEDULER_ASYNC_RETRY_NUM,
  SCHEDULER_MEMORY_MB,
  SCHEDULER_RESERVED_CONCURRENCY_MB,
  SCHEDULER_RUNTIME,
  SCHEDULER_TIMEOUT_SECONDS,
  schedulerRuntimePolicy,
  schedulerScfCloudApiRequest,
  schedulerSourceFingerprint,
  schedulerTrustPolicy,
  triggerList,
} from './lib/message-scheduler-cloud.mjs'
import { resolveMipFunctionNames } from './lib/mip-function-names.mjs'

const require = createRequire(import.meta.url)
const root = path.resolve(import.meta.dirname, '..')
const env = loadCaseEnv(root)
const functionNames = resolveMipFunctionNames(env)
const spec = resolveSchedulerOperationsSpec(process.argv.slice(2))
const config = rollingSchedulerCloudConfig(env, functionNames, spec)
const schedulerSourceDirectory = path.join(root, 'cloudfunctions', spec.sourceDirectory)
const { verifyTimerMessage } = require(path.join(schedulerSourceDirectory, 'lib', 'auth.js'))
const { oneShotCron } = require(path.join(schedulerSourceDirectory, 'lib', 'trigger-controller.js'))
const expectedCanary = argumentValue('--expect-canary=')
const expectedCodeMarker = schedulerSourceFingerprint(schedulerSourceDirectory)

assertConfirmations()
if (expectedCanary && !/^[a-f0-9]{32}$/i.test(expectedCanary)) {
  throw new Error('--expect-canary must contain the exact canary generation')
}
bindAndRequireCloudbaseEnvironment(root, config.envId)

const detail = callScf('GetFunction', {
  FunctionName: config.functionName,
  Namespace: config.envId,
  ShowCode: 'FALSE',
})
const value = functionDetail(detail)
const variables = environmentVariables(detail)
const expectedKeys = [
  'MIP_ADMIN_FUNCTION_NAME',
  'MIP_ALLOWED_APP_IDS',
  'MIP_DEPLOYMENT_STAGE',
  spec.secretEnvKey,
  spec.markerEnvKey,
  spec.functionEnvKey,
  spec.triggerEnvKey,
  'MIP_SCF_NAMESPACE',
  'MIP_SCF_REGION',
  'MIP_SCF_TIMER_UTC_OFFSET_MINUTES',
]
assertRollingSchedulerEnvironmentContract(variables, config, spec)
if (value?.Status !== 'Active'
  || value?.AvailableStatus !== 'Available'
  || value?.Runtime !== SCHEDULER_RUNTIME
  || value?.Handler !== 'index.main'
  || value?.Type !== 'Event'
  || Number(value?.MemorySize) !== SCHEDULER_MEMORY_MB
  || Number(value?.Timeout) !== SCHEDULER_TIMEOUT_SECONDS
  || value?.Role !== config.roleName
  || String(value?.Role || '').toLowerCase() === 'tcb_qcsrole'
  || Object.keys(variables).sort().join(',') !== expectedKeys.sort().join(',')
  || variables.MIP_ADMIN_FUNCTION_NAME !== config.adminFunctionName
  || variables[spec.functionEnvKey] !== config.functionName
  || variables[spec.markerEnvKey] !== expectedCodeMarker
  || variables[spec.triggerEnvKey] !== config.triggerName
  || variables.MIP_SCF_NAMESPACE !== config.envId
  || variables.MIP_SCF_REGION !== config.region
  || Number(variables.MIP_SCF_TIMER_UTC_OFFSET_MINUTES) !== config.cronUtcOffsetMinutes
  || String(variables[spec.secretEnvKey] || '').length < 32
  || Object.keys(variables).some(key => /(?:^|_)(?:DB|MYSQL|DATABASE)(?:_|$)/i.test(key))) {
  throw new Error('Scheduler function configuration verification failed')
}
const vpc = value?.VpcConfig
if (vpc && (String(vpc.VpcId || '').trim() || String(vpc.SubnetId || '').trim())) {
  throw new Error('Scheduler function is unexpectedly attached to a VPC')
}

const adminVariables = environmentVariables(callScf('GetFunction', {
  FunctionName: config.adminFunctionName,
  Namespace: config.envId,
  ShowCode: 'FALSE',
}))
rollingSchedulerAdminRuntimeContract(adminVariables, {
  schedulerFunctionName: config.functionName,
  outboxFunctionName: functionNames.outbox,
}, spec)
if (adminVariables[spec.functionEnvKey] !== config.functionName
  || adminVariables[spec.secretEnvKey] !== variables[spec.secretEnvKey]
  || adminVariables.MIP_ALLOWED_APP_IDS !== variables.MIP_ALLOWED_APP_IDS) {
  throw new Error('Admin and scheduler internal contract verification failed')
}

const reserved = reservedConcurrency(callScf('GetReservedConcurrencyConfig', {
  FunctionName: config.functionName,
  Namespace: config.envId,
}))
if (reserved !== SCHEDULER_RESERVED_CONCURRENCY_MB) {
  throw new Error('Scheduler reserved concurrency verification failed')
}
const asyncRetry = asyncEventRetryConfig(callScf('GetFunctionEventInvokeConfig', {
  FunctionName: config.functionName,
  Namespace: config.envId,
  Qualifier: '$LATEST',
}))
if (asyncRetry.msgTtl !== SCHEDULER_ASYNC_MSG_TTL_SECONDS
  || asyncRetry.retryNum !== SCHEDULER_ASYNC_RETRY_NUM) {
  throw new Error('Scheduler async event retry verification failed')
}

assertDedicatedRoleAndPolicy()
assertClientInvocationDisabled()
const trigger = assertSingleSchedulerTrigger(triggerList(callScf('ListTriggers', {
  FunctionName: config.functionName,
  Namespace: config.envId,
  Limit: 100,
  Offset: 0,
})), config)
const timer = verifiedTriggerMessage(trigger)
if (String(trigger.TriggerDesc || '') !== oneShotCron(timer.fireAt, config.cronUtcOffsetMinutes)) {
  throw new Error('Scheduler timer cron does not match its signed UTC instant')
}
const enable = normalizeTriggerEnable(trigger.Enable)
if (!['OPEN', 'CLOSE'].includes(enable)) {
  throw new Error('Scheduler timer enable state is invalid')
}
if (expectedCanary
  && (enable !== 'CLOSE' || timer.purpose !== 'CANARY' || timer.generation !== expectedCanary)) {
  throw new Error('Scheduler canary has not been received and closed')
}
if (!expectedCanary && timer.purpose !== 'DISPATCH') {
  throw new Error('Scheduler is still canary-locked; verify it with the exact canary generation')
}

const health = cloudFunctionResult(callCloudbase(root, 'manageFunctions', {
  action: 'invokeFunction',
  functionName: config.functionName,
  params: { action: 'health' },
}, 120000))
if (health?.ok !== true
  || health?.data?.persistence !== 'none'
  || health?.data?.triggerMode !== 'single-rolling-one-shot') {
  throw new Error('Scheduler health contract verification failed')
}

console.log(JSON.stringify({
  verified: true,
  function: config.functionName,
  trigger: config.triggerName,
  triggerState: enable,
  triggerPurpose: timer.purpose,
  singleConcurrency: true,
  databaseConnection: false,
  clientInvocation: false,
  runtimePermissions: ['UpdateTrigger', 'ListTriggers', 'InvokeFunction'],
  asyncEventRetry: asyncRetry,
}, null, 2))

function assertConfirmations() {
  if (argumentValue('--confirm-env=') !== config.envId
    || argumentValue('--confirm-function=') !== config.functionName
    || argumentValue('--confirm-trigger=') !== config.triggerName
    || argumentValue('--confirm-role=') !== config.roleName
    || Number(argumentValue('--confirm-timer-offset-minutes=')) !== config.cronUtcOffsetMinutes) {
    throw new Error('Scheduler verification requires exact environment, function, trigger, role, and timer-offset confirmations')
  }
}

function assertDedicatedRoleAndPolicy() {
  const role = camRoleInfo(callCam('GetRole', { RoleName: config.roleName }))
  const trust = parsePolicyDocument(role?.PolicyDocument)
  if (role?.RoleName !== config.roleName
    || !trust
    || canonicalJson(trust) !== canonicalJson(schedulerTrustPolicy())) {
    throw new Error('Scheduler role trust verification failed')
  }
  const attached = response(callCam('ListAttachedRolePolicies', {
    RoleName: config.roleName,
    Page: 1,
    Rp: 200,
  }))
  const policies = attached?.List || attached?.PolicyList || []
  if (policies.length !== 1) {
    throw new Error('Scheduler role must contain exactly one attached policy')
  }
  const policy = policies.find(item => item.PolicyName === config.policyName)
  if (!policy || !Number.isSafeInteger(Number(policy.PolicyId))) {
    throw new Error('Scheduler minimum policy is not attached')
  }
  const document = camPolicyDocument(callCam('GetPolicy', {
    PolicyId: Number(policy.PolicyId),
  }))
  if (!document || canonicalJson(document) !== canonicalJson(schedulerRuntimePolicy(config))) {
    throw new Error('Scheduler runtime policy verification failed')
  }
}

function assertClientInvocationDisabled() {
  const permission = callCloudbase(root, 'queryPermissions', {
    action: 'getResourcePermission',
    resourceType: 'function',
    resourceId: config.functionName,
  })
  let rules
  try {
    rules = JSON.parse(permission?.data?.permissions?.[0]?.SecurityRule)
  }
  catch {
    rules = null
  }
  if (rules?.[config.functionName]?.invoke !== false) {
    throw new Error('Scheduler client invocation is not disabled')
  }
}

function verifiedTriggerMessage(value) {
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
    secret: variables[spec.secretEnvKey],
  })
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
