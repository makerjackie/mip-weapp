#!/usr/bin/env node

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import {
  AI_AVATAR_PROVIDER_FUNCTION_NAME,
  AI_AVATAR_PROVIDER_RUNTIME,
  AI_AVATAR_PROVIDER_TIMEOUT_SECONDS,
  assertAiApiProviderLink,
  assertNoVpc,
  assertProviderFunctionReadback,
  environmentVariables,
  functionDetail,
  providerBootstrapEnvironment,
  providerEnvironment,
  providerSourceFingerprint,
  stageProviderSources,
} from './lib/ai-avatar-provider-cloud.mjs'
import {
  assertFunctionSecurityRulesConverged,
  assertNoTriggers,
  parseFunctionSecurityRules,
  updateMipFunctionInvocationRule,
} from './lib/cloud-function-safety.mjs'
import { assertScfRegion } from './lib/core-function-config-update.mjs'
import {
  bindAndRequireCloudbaseEnvironment,
  callCloudbase,
  cloudFunctionResult,
  loadCaseEnv,
} from './lib/example-cloudbase.mjs'
import { resolveMipDeploymentStage } from './lib/mip-deployment-stage.mjs'
import { resolveMipFunctionNames } from './lib/mip-function-names.mjs'

const root = path.resolve(import.meta.dirname, '..')
const env = loadCaseEnv(root)
const envId = String(env.CLOUDBASE_ENV_ID || '').trim()
const functionName = String(env.MIP_AI_AVATAR_PROVIDER_FUNCTION_NAME || '').trim()
const confirmedEnv = argumentValue('--confirm-env=')
const confirmedFunction = argumentValue('--confirm-function=')
const stage = resolveMipDeploymentStage(env.MIP_DEPLOYMENT_STAGE, process.argv.slice(2))
const aiFunctionName = resolveMipFunctionNames(env).ai
const sourceRoot = path.join(root, 'cloudfunctions', AI_AVATAR_PROVIDER_FUNCTION_NAME)

if (!envId
  || confirmedEnv !== envId
  || confirmedFunction !== AI_AVATAR_PROVIDER_FUNCTION_NAME
  || functionName !== AI_AVATAR_PROVIDER_FUNCTION_NAME) {
  throw new Error('AI avatar Provider deployment requires exact EnvID/function confirmations and MIP_AI_AVATAR_PROVIDER_FUNCTION_NAME=mip-ai-avatar-provider')
}
if (!fs.existsSync(path.join(sourceRoot, 'index.js'))
  || !fs.existsSync(path.join(sourceRoot, 'package.json'))) {
  throw new Error('AI avatar Provider source is incomplete')
}

const targetEnvironment = bindAndRequireCloudbaseEnvironment(root, envId)
const scfRegion = String(env.MIP_SCF_REGION || findString(targetEnvironment, ['region']) || '').trim()
assertScfRegion(scfRegion)
const aiDetail = existingFunctionDetail(aiFunctionName)
if (!aiDetail) {
  throw new Error('Deploy mip-ai-api before the AI avatar Provider')
}
const aiEnvironment = environmentVariables(aiDetail)
assertAiApiProviderLink(aiEnvironment, functionName)
const sourceMarker = providerSourceFingerprint(sourceRoot)
const bootstrapEnvironment = providerBootstrapEnvironment(sourceMarker)
const expectedEnvironment = providerEnvironment({ aiEnvironment, env, sourceMarker })

const existing = existingFunctionDetail(functionName)
if (existing) {
  const detail = functionDetail(existing)
  if (detail.Runtime !== AI_AVATAR_PROVIDER_RUNTIME || detail.Handler !== 'index.main') {
    throw new Error('Existing AI avatar Provider runtime is incompatible; refusing to recreate it implicitly')
  }
  assertNoVpc(detail)
  assertNoFunctionTriggers(functionName)
  disableClientInvocation(functionName)
}

const stagingRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mip-ai-avatar-provider-'))
let detail
try {
  stageProviderSources(sourceRoot, path.join(stagingRoot, functionName))
  if (!existing) {
    callCloudbase(root, 'manageFunctions', {
      action: 'createFunction',
      functionRootPath: stagingRoot,
      force: true,
      func: {
        name: functionName,
        type: 'Event',
        runtime: AI_AVATAR_PROVIDER_RUNTIME,
        handler: 'index.main',
        timeout: AI_AVATAR_PROVIDER_TIMEOUT_SECONDS,
        envVariables: bootstrapEnvironment,
        isWaitInstall: true,
      },
    }, 300000)
    await waitForActive(functionName)
    disableClientInvocation(functionName)
    assertNoFunctionTriggers(functionName)
  }
  callCloudbase(root, 'manageFunctions', {
    action: 'updateFunctionCode',
    functionName,
    functionRootPath: stagingRoot,
    force: true,
  }, 300000)
  await waitForActive(functionName)
  updateProviderConfiguration(functionName, expectedEnvironment)
  detail = await waitForConfiguration(functionName, expectedEnvironment)
}
finally {
  fs.rmSync(stagingRoot, { recursive: true, force: true })
}

assertProviderFunctionReadback(detail, expectedEnvironment)
assertNoFunctionTriggers(functionName)
disableClientInvocation(functionName)
assertHealth(functionName)

console.log(JSON.stringify({
  status: 'verified',
  function: functionName,
  runtime: AI_AVATAR_PROVIDER_RUNTIME,
  contract: 'mip.ai.avatar-provider.v1',
  persistence: 'none',
  vpc: 'none',
  triggers: 'none',
  clientInvocation: 'disabled',
  readiness: 'passed',
  stage,
  aiApiLinked: true,
}, null, 2))

function argumentValue(prefix) {
  return process.argv.find(value => value.startsWith(prefix))?.slice(prefix.length)
}

function existingFunctionDetail(name) {
  try {
    return callCloudbase(root, 'callCloudApi', {
      service: 'scf',
      action: 'GetFunction',
      params: { FunctionName: name, Namespace: envId, ShowCode: 'FALSE' },
    })
  }
  catch (error) {
    if (/not found|not exist|resourcenotfound|不存在|未找到/i.test(String(error?.message || error))) {
      return null
    }
    throw error
  }
}

const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))

async function waitForActive(name) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const detail = existingFunctionDetail(name)
    const value = functionDetail(detail)
    if (value?.Status === 'Active' && value?.AvailableStatus === 'Available') {
      return detail
    }
    await delay(1000)
  }
  throw new Error(`${name} did not become active after deployment`)
}

function assertNoFunctionTriggers(name) {
  const response = callCloudbase(root, 'callCloudApi', {
    service: 'scf',
    action: 'ListTriggers',
    params: { FunctionName: name, Namespace: envId, Limit: 100, Offset: 0 },
  })
  assertNoTriggers(name, response)
}

function updateProviderConfiguration(name, environment) {
  try {
    callCloudbase(root, 'callCloudApi', {
      service: 'scf',
      action: 'UpdateFunctionConfiguration',
      region: scfRegion,
      params: {
        FunctionName: name,
        Namespace: envId,
        Timeout: AI_AVATAR_PROVIDER_TIMEOUT_SECONDS,
        Environment: {
          Variables: Object.entries(environment)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([Key, Value]) => ({ Key, Value })),
        },
      },
    }, 300000)
  }
  catch {
    throw new Error('AI avatar Provider configuration update failed')
  }
}

async function waitForConfiguration(name, expectedEnvironment) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const current = existingFunctionDetail(name)
    try {
      assertProviderFunctionReadback(current, expectedEnvironment)
      return current
    }
    catch {}
    await delay(1000)
  }
  throw new Error(`${name} configuration did not converge after deployment`)
}

function disableClientInvocation(name) {
  const current = callCloudbase(root, 'queryPermissions', {
    action: 'getResourcePermission',
    resourceType: 'function',
    resourceId: name,
  })
  const rules = parseFunctionSecurityRules(current?.data?.permissions?.[0]?.SecurityRule)
  const updated = updateMipFunctionInvocationRule(rules, name, false)
  callCloudbase(root, 'managePermissions', {
    action: 'updateResourcePermission',
    resourceType: 'function',
    resourceId: name,
    permission: 'CUSTOM',
    securityRule: JSON.stringify(updated),
  })
  const readback = callCloudbase(root, 'queryPermissions', {
    action: 'getResourcePermission',
    resourceType: 'function',
    resourceId: name,
  })
  const verified = parseFunctionSecurityRules(readback?.data?.permissions?.[0]?.SecurityRule)
  assertFunctionSecurityRulesConverged({
    before: rules,
    after: verified,
    functionName: name,
    invoke: false,
  })
}

function assertHealth(name) {
  const health = cloudFunctionResult(callCloudbase(root, 'manageFunctions', {
    action: 'invokeFunction',
    functionName: name,
    params: { action: 'health' },
  }, 120000))
  if (health?.ok !== true
    || health?.data?.service !== name
    || health?.data?.persistence !== 'none'
    || health?.data?.configured !== true) {
    throw new Error('AI avatar Provider health contract failed')
  }
  const readiness = cloudFunctionResult(callCloudbase(root, 'manageFunctions', {
    action: 'invokeFunction',
    functionName: name,
    params: { action: 'readiness' },
  }, 120000))
  if (readiness?.ok !== true || readiness?.data?.ready !== true) {
    throw new Error('AI avatar Provider readiness contract failed')
  }
}

function findString(value, names) {
  if (!value || typeof value !== 'object') {
    return undefined
  }
  const expected = new Set(names.map(name => name.toLowerCase()))
  for (const [key, child] of Object.entries(value)) {
    if (expected.has(key.toLowerCase()) && typeof child === 'string' && child.trim()) {
      return child
    }
  }
  for (const child of Object.values(value)) {
    const found = findString(child, names)
    if (found) {
      return found
    }
  }
  return undefined
}
