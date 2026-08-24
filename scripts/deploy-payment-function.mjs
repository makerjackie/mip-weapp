#!/usr/bin/env node

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
import {
  MIP_FUNCTION_SOURCES,
  resolveMipFunctionNames,
} from './lib/mip-function-names.mjs'

const root = path.resolve(import.meta.dirname, '..')
const env = loadCaseEnv(root)
const envId = String(env.CLOUDBASE_ENV_ID || '').trim()
const appId = String(env.MINI_PROGRAM_APP_ID || '').trim()
const merchantId = String(env.WECHAT_PAY_MERCHANT_ID || '').trim()
const paymentMode = String(env.MIP_PAYMENT_MODE || 'disabled').trim().toLowerCase()
const functionNames = resolveMipFunctionNames(env)
const paymentFunction = functionNames.pay
const callbackFunction = functionNames.callback
const refundFunction = functionNames.refund
const ledgerFunction = functionNames.ledger
const confirmedEnv = argumentValue('--confirm-env=')
const confirmedFunction = argumentValue('--confirm-function=')
const confirmedCallback = argumentValue('--confirm-callback=')
const confirmedRefund = argumentValue('--confirm-refund=')
const replaceLegacyRuntime = process.argv.includes('--replace-legacy-runtime')

if (!envId || !appId || !merchantId
  || confirmedEnv !== envId
  || confirmedFunction !== paymentFunction
  || confirmedCallback !== callbackFunction
  || confirmedRefund !== refundFunction) {
  throw new Error('MIP payment deploy requires EnvID/AppID/merchant and exact --confirm-env / --confirm-function / --confirm-callback / --confirm-refund')
}
if (!/^wx[0-9a-f]{16}$/i.test(appId) || !/^\d{6,32}$/.test(merchantId)) {
  throw new Error('MIP payment AppID or merchant ID format is invalid')
}
if (!['test', 'live'].includes(paymentMode)) {
  throw new Error('MIP payment deploy requires MIP_PAYMENT_MODE=test or live')
}
if (paymentMode === 'live' && !process.argv.includes('--confirm-live')) {
  throw new Error('Live MIP payment deployment requires --confirm-live')
}
if (![paymentFunction, callbackFunction, refundFunction, ledgerFunction].every(name => name.startsWith('mip-'))) {
  throw new Error('Payment deployment may target only mip-* Cloud Functions')
}

for (const sourceName of [MIP_FUNCTION_SOURCES.pay, MIP_FUNCTION_SOURCES.callback, MIP_FUNCTION_SOURCES.refund]) {
  const source = path.join(root, 'cloudfunctions', sourceName)
  if (!sourceName.startsWith('mip-')
    || !fs.existsSync(path.join(source, 'index.js'))
    || !fs.existsSync(path.join(source, 'package.json'))) {
    throw new Error(`Direct MIP payment source is incomplete: ${sourceName}`)
  }
}

bindAndRequireMysqlEnvironment(root, envId)
const ledgerDetail = existingFunctionDetail(ledgerFunction)
const adminDetail = existingFunctionDetail(functionNames.admin)
if (!ledgerDetail || !adminDetail) {
  throw new Error('Deploy the MIP core functions before the payment adapter')
}
const ledgerEnvironment = environmentVariables(ledgerDetail)
const adminEnvironment = environmentVariables(adminDetail)
const ledgerSecret = String(ledgerEnvironment.MIP_LEDGER_SECRET || '').trim()
const identityPepper = String(ledgerEnvironment.MIP_IDENTITY_PEPPER || '').trim()
const refundWorkerHmac = String(adminEnvironment.MIP_REFUND_WORKER_HMAC_SECRET || '').trim()
const allowedAppIds = String(ledgerEnvironment.MIP_ALLOWED_APP_IDS || '')
  .split(',')
  .map(value => value.trim())
  .filter(Boolean)
if (ledgerSecret.length < 32
  || identityPepper.length < 32
  || refundWorkerHmac.length < 32
  || adminEnvironment.MIP_REFUND_FUNCTION_NAME !== refundFunction
  || !allowedAppIds.includes(appId)) {
  throw new Error('Run cloud:deploy for the same MIP AppID before payment deployment')
}

const commonEnvironment = {
  CLOUDBASE_ENV_ID: envId,
  MIP_APP_ID: appId,
  MIP_ALLOWED_APP_IDS: allowedAppIds.join(','),
  MIP_PAYMENT_MODE: paymentMode,
  MIP_LEDGER_FUNCTION: ledgerFunction,
  MIP_LEDGER_SECRET: ledgerSecret,
  MIP_IDENTITY_PEPPER: identityPepper,
  MIP_PAYMENT_CALLBACK_FUNCTION: callbackFunction,
  WECHAT_PAY_MERCHANT_ID: merchantId,
}
const refundEnvironment = {
  ...commonEnvironment,
  MIP_REFUND_WORKER_HMAC_SECRET: refundWorkerHmac,
}

const paymentFunctions = [
  { source: MIP_FUNCTION_SOURCES.callback, target: callbackFunction, timeout: 30, environment: commonEnvironment },
  { source: MIP_FUNCTION_SOURCES.refund, target: refundFunction, timeout: 60, environment: refundEnvironment },
  { source: MIP_FUNCTION_SOURCES.pay, target: paymentFunction, timeout: 30, environment: commonEnvironment },
]

const stagingRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mip-payment-functions-'))
const deployed = []
try {
  for (const spec of paymentFunctions) {
    fs.cpSync(path.join(root, 'cloudfunctions', spec.source), path.join(stagingRoot, spec.target), {
      recursive: true,
      filter: source => path.basename(source) !== 'node_modules',
    })
  }

  for (const spec of paymentFunctions) {
    await ensureCompatibleRuntime(spec.target)
    callCloudbase(root, 'manageFunctions', {
      action: 'createFunction',
      functionRootPath: stagingRoot,
      force: true,
      func: {
        name: spec.target,
        type: 'Event',
        runtime: 'Nodejs20.19',
        handler: 'index.main',
        timeout: spec.timeout,
        envVariables: spec.environment,
        isWaitInstall: true,
      },
    }, 300000)
    await waitForFunctionActive(spec.target)
    callCloudbase(root, 'manageFunctions', {
      action: 'updateFunctionCode',
      functionName: spec.target,
      functionRootPath: stagingRoot,
      force: true,
    }, 300000)
    const detail = await waitForFunctionActive(spec.target)
    assertEnvironmentReadback(spec.target, spec.environment, detail)
    assertHealthy(spec.target)
    deployed.push(spec.target)
    console.log(`[mip-payment-deploy] verified ${spec.target}`)
  }
}
finally {
  fs.rmSync(stagingRoot, { recursive: true, force: true })
}

removeForbiddenTimer(refundFunction, 'mip-refund-every-5m')
enableAuthenticatedClientInvocation(paymentFunction)
disableClientInvocation(callbackFunction)
disableClientInvocation(refundFunction)
disableClientInvocation(ledgerFunction)

fs.mkdirSync(path.join(root, '.tmp'), { recursive: true })
fs.writeFileSync(path.join(root, '.tmp', 'deploy-payment-result.json'), `${JSON.stringify({
  environmentVerified: true,
  directMipSourcesOnly: true,
  provider: 'cloudbase-native-cloudpay',
  paymentMode,
  deployed,
  paymentClientInvocationEnabled: true,
  callbackClientInvocationDisabled: true,
  refundClientInvocationDisabled: true,
  refundTimerVerifiedAbsent: true,
  ledgerClientInvocationDisabled: true,
  deployedAt: new Date().toISOString(),
}, null, 2)}\n`)
console.log('[mip-payment-deploy] payment adapter verified; no AppID, environment ID, merchant ID, or secret was persisted')

function argumentValue(prefix) {
  return process.argv.find(value => value.startsWith(prefix))?.slice(prefix.length)
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

const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))

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
  const healthy = functionName === paymentFunction || functionName === refundFunction
    ? result?.ok === true
    && result?.data?.configReady === true
    && result?.data?.paymentMode === paymentMode
    && result?.data?.provider === 'cloudbase-native-cloudpay'
    : result?.errcode === 0 && result?.provider === 'cloudbase-native-cloudpay'
  if (!healthy) {
    throw new Error(`${functionName} health contract failed`)
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
