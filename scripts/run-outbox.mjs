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
const { signInternalEvent } = require('../cloudfunctions/mip-outbox-worker/lib/internal-auth')

const root = path.resolve(import.meta.dirname, '..')
const env = loadCaseEnv(root)
const envId = String(env.CLOUDBASE_ENV_ID || '').trim()
const appId = String(env.MINI_PROGRAM_APP_ID || '').trim()
const confirmedEnv = argumentValue('--confirm-env=')
const limit = Number(argumentValue('--limit=') || 5)
const functionName = resolveMipFunctionNames(env).outbox

if (!envId || confirmedEnv !== envId || !/^wx[0-9a-f]{16}$/i.test(appId)) {
  throw new Error('Outbox recovery requires configured EnvID/AppID and --confirm-env=<exact EnvID>')
}
if (!Number.isInteger(limit) || limit < 1 || limit > 10) {
  throw new Error('--limit must be an integer between 1 and 10')
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
const secret = String(variables.MIP_OUTBOX_HMAC_SECRET || '')
if (!allowedAppIds.includes(appId) || secret.length < 32) {
  throw new Error('Deployed outbox worker does not match the configured AppID or internal authentication')
}

const request = {
  action: 'runBatch',
  appId,
  limit,
  timestamp: Date.now(),
}
const response = callCloudbase(root, 'manageFunctions', {
  action: 'invokeFunction',
  functionName,
  params: { ...request, signature: signInternalEvent(request, secret) },
}, 120000)
const result = cloudFunctionResult(response)
if (result?.ok !== true) {
  throw new Error(result?.error?.code || 'Outbox recovery invocation failed')
}
const summary = result.data || {}
console.log(JSON.stringify({
  leased: Number(summary.leased || 0),
  reaped: Number(summary.reaped || 0),
  delivered: Number(summary.delivered || 0),
  retried: Number(summary.retried || 0),
  dead: Number(summary.dead || 0),
  ignored: Number(summary.ignored || 0),
}, null, 2))

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
