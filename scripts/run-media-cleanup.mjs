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
const { signMaintenanceRequest } = require('../cloudfunctions/mip-media-api/lib/internal-auth')

const root = path.resolve(import.meta.dirname, '..')
const env = loadCaseEnv(root)
const envId = String(env.CLOUDBASE_ENV_ID || '').trim()
const appId = String(env.MINI_PROGRAM_APP_ID || '').trim()
const confirmedEnv = argumentValue('--confirm-env=')
const confirmedFunction = argumentValue('--confirm-media=')
const limit = Number(argumentValue('--limit=') || 10)
const minimumAgeHours = Number(argumentValue('--minimum-age-hours=') || 24)
const functionName = resolveMipFunctionNames(env).media

if (!envId
  || confirmedEnv !== envId
  || confirmedFunction !== functionName
  || !/^wx[0-9a-f]{16}$/i.test(appId)) {
  throw new Error('Media cleanup requires configured EnvID/AppID and exact --confirm-env / --confirm-media')
}
if (!Number.isInteger(limit) || limit < 1 || limit > 20) {
  throw new Error('--limit must be an integer between 1 and 20')
}
if (!Number.isInteger(minimumAgeHours) || minimumAgeHours < 24 || minimumAgeHours > 2160) {
  throw new Error('--minimum-age-hours must be an integer between 24 and 2160')
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
const secret = String(variables.MIP_MEDIA_MAINTENANCE_HMAC_SECRET || '')
if (!allowedAppIds.includes(appId) || secret.length < 32) {
  throw new Error('Deployed media function does not match the configured AppID or maintenance authentication')
}

const request = {
  action: 'cleanupOrphans',
  appId,
  limit,
  minimumAgeHours,
  timestamp: Date.now(),
}
const response = callCloudbase(root, 'manageFunctions', {
  action: 'invokeFunction',
  functionName,
  params: { ...request, signature: signMaintenanceRequest(request, secret) },
}, 120000)
const result = cloudFunctionResult(response)
if (result?.ok !== true) {
  throw new Error(result?.error?.code || 'Media cleanup invocation failed')
}
const summary = result.data || {}
const output = {
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
