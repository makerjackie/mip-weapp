#!/usr/bin/env node

import path from 'node:path'
import process from 'node:process'
import {
  AI_DRAFT_PROVIDER_FUNCTION_NAME,
  AI_DRAFT_PROVIDER_RUNTIME,
  assertAiApiProviderLink,
  assertProviderFunctionReadback,
  environmentVariables,
  providerEnvironment,
  providerSourceFingerprint,
} from './lib/ai-draft-provider-cloud.mjs'
import {
  assertNoTimerTriggers,
  parseFunctionSecurityRules,
} from './lib/cloud-function-safety.mjs'
import {
  bindAndRequireCloudbaseEnvironment,
  callCloudbase,
  cloudFunctionResult,
  loadCaseEnv,
} from './lib/example-cloudbase.mjs'
import { resolveMipFunctionNames } from './lib/mip-function-names.mjs'

const root = path.resolve(import.meta.dirname, '..')
const env = loadCaseEnv(root)
const envId = String(env.CLOUDBASE_ENV_ID || '').trim()
const functionName = String(env.MIP_AI_PROVIDER_FUNCTION_NAME || '').trim()
const confirmedEnv = argumentValue('--confirm-env=')
const confirmedFunction = argumentValue('--confirm-function=')
const aiFunctionName = resolveMipFunctionNames(env).ai

if (!envId
  || confirmedEnv !== envId
  || confirmedFunction !== AI_DRAFT_PROVIDER_FUNCTION_NAME
  || functionName !== AI_DRAFT_PROVIDER_FUNCTION_NAME) {
  throw new Error('AI draft Provider verification requires exact EnvID/function confirmations and MIP_AI_PROVIDER_FUNCTION_NAME=mip-ai-draft-provider')
}

bindAndRequireCloudbaseEnvironment(root, envId)
const aiDetail = getFunction(aiFunctionName)
const providerDetail = getFunction(functionName)
const aiEnvironment = environmentVariables(aiDetail)
assertAiApiProviderLink(aiEnvironment, functionName)
const expectedEnvironment = providerEnvironment({
  aiEnvironment,
  env,
  sourceMarker: providerSourceFingerprint(path.join(root, 'cloudfunctions', functionName)),
})
assertProviderFunctionReadback(providerDetail, expectedEnvironment)

const triggers = callCloudbase(root, 'callCloudApi', {
  service: 'scf',
  action: 'ListTriggers',
  params: { FunctionName: functionName, Namespace: envId, Limit: 100, Offset: 0 },
})
assertNoTimerTriggers(functionName, triggers)

const permission = callCloudbase(root, 'queryPermissions', {
  action: 'getResourcePermission',
  resourceType: 'function',
  resourceId: functionName,
})
const rules = parseFunctionSecurityRules(permission?.data?.permissions?.[0]?.SecurityRule)
if (rules?.[functionName]?.invoke !== false) {
  throw new Error('AI draft Provider client invocation must be disabled')
}

const health = invoke({ action: 'health' })
if (health?.ok !== true
  || health?.data?.configured !== true
  || health?.data?.persistence !== 'none') {
  throw new Error('AI draft Provider health contract failed')
}
const readiness = invoke({ action: 'readiness' })
if (readiness?.ok !== true || readiness?.data?.ready !== true) {
  throw new Error('AI draft Provider readiness contract failed')
}

console.log(JSON.stringify({
  status: 'verified',
  function: functionName,
  runtime: AI_DRAFT_PROVIDER_RUNTIME,
  aiApiLinked: true,
  contract: 'mip.ai.draft-provider.v1',
  persistence: 'none',
  vpc: 'none',
  timers: 'none',
  clientInvocation: 'disabled',
  readiness: 'passed',
}, null, 2))

function argumentValue(prefix) {
  return process.argv.find(value => value.startsWith(prefix))?.slice(prefix.length)
}

function getFunction(name) {
  const detail = callCloudbase(root, 'callCloudApi', {
    service: 'scf',
    action: 'GetFunction',
    params: { FunctionName: name, Namespace: envId, ShowCode: 'FALSE' },
  })
  if (!detail) {
    throw new Error(`${name} is not deployed`)
  }
  return detail
}

function invoke(params) {
  return cloudFunctionResult(callCloudbase(root, 'manageFunctions', {
    action: 'invokeFunction',
    functionName,
    params,
  }, 120000))
}
