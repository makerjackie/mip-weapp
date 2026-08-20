#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import {
  bindAndRequireMysqlEnvironment,
  callCloudbase,
  cloudFunctionResult,
  loadCaseEnv,
} from './lib/example-cloudbase.mjs'

const root = path.resolve(import.meta.dirname, '..')
const env = loadCaseEnv(root)
const envId = env.CLOUDBASE_ENV_ID
const appId = env.MINI_PROGRAM_APP_ID
const merchantId = env.WECHAT_PAY_MERCHANT_ID
const functionName = env.MEMBERSHIP_PAY_FUNCTION_NAME || 'membership-cloudpay'
const callbackFunction = env.MEMBERSHIP_PAY_CALLBACK_FUNCTION || 'membership-cloudpay-callback'
const ledgerFunction = env.MEMBERSHIP_LEDGER_FUNCTION_NAME || 'membership-payment-ledger'
const paymentMode = env.MEMBERSHIP_PAYMENT_MODE
const confirmedEnv = process.argv.find(value => value.startsWith('--confirm-env='))?.slice('--confirm-env='.length)
const confirmedFunction = process.argv.find(value => value.startsWith('--confirm-function='))?.slice('--confirm-function='.length)
const confirmedCallback = process.argv.find(value => value.startsWith('--confirm-callback='))?.slice('--confirm-callback='.length)

if (!envId || !appId || !merchantId || confirmedEnv !== envId
  || confirmedFunction !== functionName || confirmedCallback !== callbackFunction) {
  throw new Error('Payment deploy requires EnvID/AppID/merchant and exact --confirm-env / --confirm-function / --confirm-callback')
}
if (!/^wx[0-9a-f]{16}$/i.test(appId) || !/^\d{6,32}$/.test(merchantId)) {
  throw new Error('Payment AppID or merchant ID format is invalid')
}
if (!['test', 'live'].includes(paymentMode)) {
  throw new Error('Payment deploy requires MEMBERSHIP_PAYMENT_MODE=test or live')
}
if (paymentMode === 'live' && !process.argv.includes('--confirm-live')) {
  throw new Error('Live payment deployment requires --confirm-live')
}

bindAndRequireMysqlEnvironment(root, envId)
const ledgerDetail = callCloudbase(root, 'queryFunctions', {
  action: 'getFunctionDetail',
  functionName: ledgerFunction,
})

function environmentVariables(detailResponse) {
  const entries = detailResponse?.data?.functionDetail?.Environment?.Variables
  if (!Array.isArray(entries)) {
    return {}
  }
  return Object.fromEntries(entries
    .filter(item => typeof item?.Key === 'string' && typeof item?.Value === 'string')
    .map(item => [item.Key, item.Value]))
}

const ledgerEnvironment = environmentVariables(ledgerDetail)
const ledgerSecret = ledgerEnvironment.MEMBERSHIP_LEDGER_SECRET
if (!/^[0-9a-f]{64}$/i.test(ledgerSecret || '')
  || ledgerEnvironment.MEMBERSHIP_PAYMENT_MODE !== paymentMode
  || !String(ledgerEnvironment.MEMBERSHIP_ALLOWED_APP_IDS || '').split(',').includes(appId)) {
  throw new Error('Run cloud:deploy with the same payment mode and AppID before payment deployment')
}

const functionRootPath = path.join(root, '.tmp', 'cloudpay-function-source')
fs.rmSync(functionRootPath, { recursive: true, force: true })
fs.mkdirSync(functionRootPath, { recursive: true })
for (const [sourceName, targetName] of [
  ['membership-cloudpay', functionName],
  ['membership-cloudpay-callback', callbackFunction],
]) {
  fs.cpSync(path.join(root, 'cloudfunctions', sourceName), path.join(functionRootPath, targetName), {
    recursive: true,
    filter: source => path.basename(source) !== 'node_modules',
  })
}
const commonEnvironment = {
  CLOUDBASE_ENV_ID: envId,
  MEMBERSHIP_APP_ID: appId,
  MEMBERSHIP_ALLOWED_APP_IDS: appId,
  MEMBERSHIP_PAYMENT_MODE: paymentMode,
  MEMBERSHIP_LEDGER_FUNCTION: ledgerFunction,
  MEMBERSHIP_LEDGER_SECRET: ledgerSecret,
  MEMBERSHIP_CALLBACK_FUNCTION: callbackFunction,
  WECHAT_PAY_MERCHANT_ID: merchantId,
}
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))

async function waitForFunction(functionToWait) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const detail = callCloudbase(root, 'queryFunctions', {
      action: 'getFunctionDetail',
      functionName: functionToWait,
    })
    const value = detail?.data?.functionDetail
    if (value?.Status === 'Active' && value?.AvailableStatus === 'Available') {
      return detail
    }
    await delay(1000)
  }
  throw new Error(`${functionToWait} did not become active after deployment`)
}

for (const currentFunction of [callbackFunction, functionName]) {
  callCloudbase(root, 'manageFunctions', {
    action: 'createFunction',
    functionRootPath,
    force: true,
    func: {
      name: currentFunction,
      type: 'Event',
      runtime: 'Nodejs20.19',
      handler: 'index.main',
      timeout: 30,
      envVariables: commonEnvironment,
      isWaitInstall: true,
    },
  }, 300000)
  await waitForFunction(currentFunction)
  callCloudbase(root, 'manageFunctions', {
    action: 'updateFunctionCode',
    functionName: currentFunction,
    functionRootPath,
    force: true,
  }, 300000)
  const detail = await waitForFunction(currentFunction)
  const deployed = detail?.data?.functionDetail
  const deployedEnvironment = environmentVariables(detail)
  if (deployed?.Runtime !== 'Nodejs20.19' || deployed?.Type !== 'Event'
    || Object.entries(commonEnvironment).some(([key, value]) => deployedEnvironment[key] !== value)) {
    throw new Error(`${currentFunction} runtime or environment did not deploy exactly`)
  }
  const health = callCloudbase(root, 'manageFunctions', {
    action: 'invokeFunction',
    functionName: currentFunction,
    params: { action: 'health' },
  }, 120000)
  const result = cloudFunctionResult(health)
  const healthy = currentFunction === functionName
    ? result?.ok === true && result?.data?.configReady === true && result?.data?.provider === 'cloudbase-native-cloudpay'
    : result?.errcode === 0 && result?.provider === 'cloudbase-native-cloudpay'
  if (!healthy) {
    throw new Error(`${currentFunction} health contract failed`)
  }
  console.log(`[payment-deploy] verified ${currentFunction}`)
}

const currentPermissions = callCloudbase(root, 'queryPermissions', {
  action: 'getResourcePermission',
  resourceType: 'function',
  resourceId: callbackFunction,
})
let functionRules
try {
  functionRules = JSON.parse(currentPermissions?.data?.permissions?.[0]?.SecurityRule)
}
catch {
  functionRules = { '*': { invoke: 'auth.loginType != \'ANONYMOUS\' && auth != null' } }
}
if (!functionRules['*']?.invoke && functionRules['*']?.invoke !== false) {
  functionRules['*'] = { invoke: 'auth.loginType != \'ANONYMOUS\' && auth != null' }
}
functionRules[ledgerFunction] = { invoke: false }
functionRules[callbackFunction] = { invoke: false }
callCloudbase(root, 'managePermissions', {
  action: 'updateResourcePermission',
  resourceType: 'function',
  resourceId: callbackFunction,
  permission: 'CUSTOM',
  securityRule: JSON.stringify(functionRules),
})
const verifiedPermissions = callCloudbase(root, 'queryPermissions', {
  action: 'getResourcePermission',
  resourceType: 'function',
  resourceId: callbackFunction,
})
let verifiedRules
try {
  verifiedRules = JSON.parse(verifiedPermissions?.data?.permissions?.[0]?.SecurityRule)
}
catch {
  verifiedRules = null
}
if (verifiedRules?.[ledgerFunction]?.invoke !== false || verifiedRules?.[callbackFunction]?.invoke !== false) {
  throw new Error('Payment callback and ledger must reject direct Mini Program invocation')
}

fs.mkdirSync(path.join(root, '.tmp'), { recursive: true })
fs.writeFileSync(path.join(root, '.tmp', 'deploy-payment-result.json'), `${JSON.stringify({
  environmentVerified: true,
  provider: 'cloudbase-native-cloudpay',
  paymentMode,
  functionsVerified: 2,
  callbackClientInvocationDisabled: true,
  ledgerClientInvocationDisabled: true,
  deployedAt: new Date().toISOString(),
}, null, 2)}\n`)
console.log('[payment-deploy] native CloudPay adapter deployed; merchant and ledger secrets were not written or printed')
