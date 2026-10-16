#!/usr/bin/env node

// MIW-119：支付模式热切换。只更新云函数环境变量，不重发小程序与函数代码：
//
//   node scripts/switch-payment-mode.mjs --confirm-env=<EnvID> --mode=test
//   node scripts/switch-payment-mode.mjs --confirm-env=<EnvID> --mode=live --confirm-live
//   node scripts/switch-payment-mode.mjs --confirm-env=<EnvID> --dry-run
//
// 目标值与 cloud:deploy 完全同源：--mode 覆盖 env 目录的 MIP_PAYMENT_MODE；
// MIP_CATALOG_STAGE 恒取 env 目录（目录是 stage 的唯一权威）；省略 --mode 时按
// env 目录当前值收敛（漂移校正，幂等）。每个目标函数「读现网 env → 仅覆写支付
// 相关键 → UpdateFunctionConfiguration → 回读断言」，支付键之外逐字节不变；
// runtime/VPC/执行角色漂移时拒绝写入（复用部署规划器门禁）。
// 切换窗口内不同函数可能短暂处于混合模式（窗口为秒级）；期间跨界订单会被
// PAYMENT_MODE_MISMATCH 拒绝而非错配，建议在支付静默窗口执行。

import path from 'node:path'
import process from 'node:process'
import {
  existingFunctionConfigurationConverged,
  functionConfigurationSnapshot,
  planExistingFunctionConfigurationUpdate,
} from './lib/core-function-config-update.mjs'
import {
  bindAndRequireCloudbaseEnvironment,
  callCloudbase,
  loadCaseEnv,
} from './lib/example-cloudbase.mjs'
import { resolveMipDeploymentStage } from './lib/mip-deployment-stage.mjs'
import { resolveMipFunctionNames } from './lib/mip-function-names.mjs'
import {
  assertPaymentModeSwitchGates,
  PAYMENT_SWITCH_ROLES,
  planPaymentModeEnvironment,
} from './lib/payment-mode-switch.mjs'

const root = path.resolve(import.meta.dirname, '..')
const env = loadCaseEnv(root)

function argumentValue(name) {
  const found = process.argv.find(value => value.startsWith(name))
  return found ? found.slice(name.length) : ''
}

function delay(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds))
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

function changeLabel(change) {
  const mask = value => (change.key === 'MIP_TEST_MEMBERSHIP_HMAC_SECRET'
    ? (value === null ? '<absent>' : '<configured>')
    : String(value ?? '<absent>'))
  return `  ${change.key}: ${mask(change.from)} -> ${mask(change.to)}`
}

const envId = String(env.CLOUDBASE_ENV_ID || '').trim()
const confirmedEnv = argumentValue('--confirm-env=')
const requestedMode = argumentValue('--mode=')
const confirmLive = process.argv.includes('--confirm-live')
const dryRun = process.argv.includes('--dry-run')
const paymentMode = (requestedMode || env.MIP_PAYMENT_MODE || 'disabled').trim().toLowerCase()
const catalogStage = String(env.MIP_CATALOG_STAGE || 'TEST').trim().toUpperCase()
const deploymentStage = resolveMipDeploymentStage(env.MIP_DEPLOYMENT_STAGE, process.argv.slice(2))
const localTestMembershipHmac = String(env.MIP_TEST_MEMBERSHIP_HMAC_SECRET || '').trim()
const functionNames = resolveMipFunctionNames(env)

function functionDetail(value) {
  return value?.data?.functionDetail || value?.Response || value?.data || value
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

// 配置更新失败时不得透传控制面原始响应（Environment 回显包含密钥）。
function updateFunctionConfiguration(functionName, configurationCall) {
  try {
    callCloudbase(root, 'callCloudApi', configurationCall, 300000)
  }
  catch {
    throw new Error(`${functionName} configuration update failed`)
  }
}

if (!envId || confirmedEnv !== envId) {
  throw new Error('Payment mode switch requires --confirm-env=<exact CLOUDBASE_ENV_ID>')
}
assertPaymentModeSwitchGates({ paymentMode, catalogStage, confirmLive })

const envInfo = bindAndRequireCloudbaseEnvironment(root, envId)
const scfRegion = String(env.MIP_SCF_REGION || findString(envInfo, ['region']) || '').trim()

console.log(`[switch-payment] target mode=${paymentMode} stage=${catalogStage} stage-source=env-directory${dryRun ? ' (dry-run)' : ''}`)

const summary = { updated: [], planned: [], unchanged: [], skipped: [] }
for (const role of Object.keys(PAYMENT_SWITCH_ROLES)) {
  const functionName = functionNames[role]
  const detail = existingFunctionDetail(functionName)
  if (!detail) {
    if (['events', 'commerce', 'community', 'admin', 'ledger'].includes(role)) {
      throw new Error(`${functionName} is missing; run pnpm cloud:deploy before switching payment mode`)
    }
    console.log(`[switch-payment] skipped ${functionName} (not deployed; run cloud:deploy-payment when enabling payments)`)
    summary.skipped.push(functionName)
    continue
  }
  const current = functionConfigurationSnapshot(detail)
  const plan = planPaymentModeEnvironment({
    role,
    currentEnvironment: current.environment,
    paymentMode,
    catalogStage,
    deploymentStage,
    testMembershipHmac: localTestMembershipHmac,
  })
  if (!plan.changes.length) {
    console.log(`[switch-payment] already current ${functionName}`)
    summary.unchanged.push(functionName)
    continue
  }
  console.log(`[switch-payment] plan ${functionName}`)
  for (const change of plan.changes) {
    console.log(changeLabel(change))
  }
  if (dryRun) {
    summary.planned.push(functionName)
    continue
  }
  const expected = { ...current, environment: plan.environment }
  const updatePlan = planExistingFunctionConfigurationUpdate({
    current,
    expected,
    functionName,
    namespace: envId,
    region: scfRegion,
  })
  if (!updatePlan.configurationCall) {
    throw new Error(`${functionName} produced no configuration update despite environment changes`)
  }
  updateFunctionConfiguration(functionName, updatePlan.configurationCall)
  let verified = false
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const readback = existingFunctionDetail(functionName)
    const active = functionDetail(readback)?.Status === 'Active'
      && functionDetail(readback)?.AvailableStatus === 'Available'
    if (active
      && existingFunctionConfigurationConverged({
        actual: functionConfigurationSnapshot(readback),
        before: current,
        expected,
        functionName,
      })) {
      verified = true
      break
    }
    await delay(1000)
  }
  if (!verified) {
    throw new Error(`${functionName} environment readback did not converge`)
  }
  console.log(`[switch-payment] verified ${functionName}`)
  summary.updated.push(functionName)
}

console.log(`[switch-payment] done: updated=${summary.updated.length} planned=${summary.planned.length} unchanged=${summary.unchanged.length} skipped=${summary.skipped.length}`)
if (summary.updated.length) {
  console.log('[switch-payment] run pnpm cloud:verify to re-confirm the deployed environment matches the target directory')
}
