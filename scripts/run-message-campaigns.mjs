#!/usr/bin/env node

import { createRequire } from 'node:module'
import path from 'node:path'
import process from 'node:process'
import {
  bindAndRequireMysqlEnvironment,
  callCloudbase,
  cloudFunctionResult,
  loadCaseEnv,
} from './lib/example-cloudbase.mjs'
import { resolveMipFunctionNames } from './lib/mip-function-names.mjs'

const require = createRequire(import.meta.url)
const { signMessageDispatchRequest } = require('../cloudfunctions/mip-admin-api/lib/message-dispatch-auth')

const root = path.resolve(import.meta.dirname, '..')
const env = loadCaseEnv(root)
const envId = String(env.CLOUDBASE_ENV_ID || '').trim()
const appId = String(env.MINI_PROGRAM_APP_ID || '').trim()
const confirmedEnv = argumentValue('--confirm-env=')
const confirmedFunction = argumentValue('--confirm-message-dispatch=')
const limit = Number(argumentValue('--limit=') || 5)
const drain = process.argv.includes('--drain')
const maxBatches = Number(argumentValue('--max-batches=') || (drain ? 100 : 1))
const functionNames = resolveMipFunctionNames(env)
const functionName = functionNames.admin

if (!envId
  || confirmedEnv !== envId
  || confirmedFunction !== functionName
  || !/^wx[0-9a-f]{16}$/i.test(appId)) {
  throw new Error('Message dispatch requires configured EnvID/AppID and exact --confirm-env / --confirm-message-dispatch')
}
if (!Number.isInteger(limit) || limit < 1 || limit > 10) {
  throw new Error('--limit must be an integer between 1 and 10')
}
if (!Number.isInteger(maxBatches) || maxBatches < 1 || maxBatches > 100
  || (!drain && maxBatches !== 1)) {
  throw new Error('--max-batches must be 1 without --drain, or an integer between 1 and 100 with --drain')
}

bindAndRequireMysqlEnvironment(root, envId)
const detail = callCloudbase(root, 'callCloudApi', {
  service: 'scf',
  action: 'GetFunction',
  params: { FunctionName: functionName, Namespace: envId, ShowCode: 'FALSE' },
})
const variables = environmentVariables(detail)
const allowedAppIds = String(variables.MIP_ALLOWED_APP_IDS || '')
  .split(',')
  .map(value => value.trim())
  .filter(Boolean)
const secret = String(variables.MIP_MESSAGE_DISPATCH_HMAC_SECRET || '')
if (!allowedAppIds.includes(appId)
  || secret.length < 32
  || variables.MIP_OUTBOX_FUNCTION_NAME !== functionNames.outbox
  || String(variables.MIP_OUTBOX_HMAC_SECRET || '').length < 32) {
  throw new Error('Deployed admin function does not match the configured AppID or controlled worker authentication')
}

const request = {
  action: 'runDueMessageCampaigns',
  appId,
  limit,
  drain,
  maxBatches,
  timestamp: Date.now(),
}
const response = callCloudbase(root, 'manageFunctions', {
  action: 'invokeFunction',
  functionName,
  params: { ...request, signature: signMessageDispatchRequest(request, secret) },
}, 120000)
const result = cloudFunctionResult(response)
if (result?.ok !== true) {
  throw new Error(result?.error?.code || 'Message dispatch invocation failed')
}
const summary = result.data || {}
const output = {
  batches: count(summary.batches),
  leased: count(summary.leased),
  reconciled: count(summary.reconciled),
  completed: count(summary.completed),
  retryable: count(summary.retryable),
  terminal: count(summary.terminal),
  manualReview: count(summary.manualReview),
  pendingReconciliation: count(summary.pendingReconciliation),
  outboxWakeup: ['INVOKED', 'FAILED', 'SKIPPED'].includes(summary.outboxWakeup)
    ? summary.outboxWakeup
    : 'FAILED',
}
console.log(JSON.stringify(output, null, 2))
if (output.terminal > 0
  || output.manualReview > 0
  || output.pendingReconciliation > 0
  || output.outboxWakeup === 'FAILED') {
  process.exitCode = 1
}

function argumentValue(prefix) {
  return process.argv.find(value => value.startsWith(prefix))?.slice(prefix.length)
}

function count(value) {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0
}

function environmentVariables(value) {
  const functionDetail = value?.data?.functionDetail || value?.Response || value?.data || value
  const entries = functionDetail?.Environment?.Variables
  if (!Array.isArray(entries)) {
    return {}
  }
  return Object.fromEntries(entries
    .filter(item => typeof item?.Key === 'string' && typeof item?.Value === 'string')
    .map(item => [item.Key, item.Value]))
}
