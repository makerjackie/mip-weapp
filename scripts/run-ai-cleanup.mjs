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
const { signMaintenanceRequest } = require('../cloudfunctions/mip-ai-api/lib/internal-auth')

const root = path.resolve(import.meta.dirname, '..')
const env = loadCaseEnv(root)
const envId = String(env.CLOUDBASE_ENV_ID || '').trim()
const appId = String(env.MINI_PROGRAM_APP_ID || '').trim()
const confirmedEnv = argumentValue('--confirm-env=')
const confirmedFunction = argumentValue('--confirm-ai=')
const limit = Number(argumentValue('--limit=') || 10)
const functionName = resolveMipFunctionNames(env).ai

if (!envId
  || confirmedEnv !== envId
  || confirmedFunction !== functionName
  || !/^wx[0-9a-f]{16}$/i.test(appId)) {
  throw new Error('AI cleanup requires configured EnvID/AppID and exact --confirm-env / --confirm-ai')
}
if (!Number.isInteger(limit) || limit < 1 || limit > 20) {
  throw new Error('--limit must be an integer between 1 and 20')
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
const secret = String(variables.MIP_AI_HMAC_SECRET || '')
if (!allowedAppIds.includes(appId) || secret.length < 32) {
  throw new Error('Deployed AI function does not match the configured AppID or internal authentication')
}

const request = {
  action: 'cleanupExpiredAudio',
  appId,
  limit,
  timestamp: Date.now(),
}
const response = callCloudbase(root, 'manageFunctions', {
  action: 'invokeFunction',
  functionName,
  params: { ...request, signature: signMaintenanceRequest(request, secret) },
}, 120000)
const result = cloudFunctionResult(response)
if (result?.ok !== true) {
  throw new Error(result?.error?.code || 'AI cleanup invocation failed')
}
const summary = result.data || {}
const output = {
  status: summary.status === 'PARTIAL' ? 'PARTIAL' : 'COMPLETED',
  expired: Number(summary.expired || 0),
  scanned: Number(summary.scanned || 0),
  deleted: Number(summary.deleted || 0),
  failed: Number(summary.failed || 0),
}
console.log(JSON.stringify(output, null, 2))
if (output.failed > 0) {
  process.exitCode = 1
}

function argumentValue(prefix) {
  return process.argv.find(value => value.startsWith(prefix))?.slice(prefix.length)
}

function environmentVariables(value) {
  const detail = value?.data?.functionDetail || value?.Response || value?.data || value
  const entries = detail?.Environment?.Variables
  if (!Array.isArray(entries)) {
    return {}
  }
  return Object.fromEntries(entries
    .filter(item => typeof item?.Key === 'string' && typeof item?.Value === 'string')
    .map(item => [item.Key, item.Value]))
}
