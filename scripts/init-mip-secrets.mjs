#!/usr/bin/env node

import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { callCloudbase, loadCaseEnv, parseEnv } from './lib/example-cloudbase.mjs'
import { createMipCoreFunctionManifest } from './lib/mip-function-manifest.mjs'
import { resolveMipFunctionNames } from './lib/mip-function-names.mjs'
import {
  resolveMipStableSecrets,
  secretInventory,
  updateEnvDocument,
} from './lib/mip-local-secrets.mjs'

const root = path.resolve(import.meta.dirname, '..')
const envPath = path.join(root, '.env.local')
const env = loadCaseEnv(root)
const localEnv = parseEnv(envPath)
const envId = String(env.CLOUDBASE_ENV_ID || '').trim()
const confirmedEnv = process.argv.find(value => value.startsWith('--confirm-env='))?.slice('--confirm-env='.length)

if (!envId || confirmedEnv !== envId) {
  throw new Error('Secret initialization requires --confirm-env=<exact CLOUDBASE_ENV_ID>')
}

const functionNames = resolveMipFunctionNames(env)
const names = new Set(createMipCoreFunctionManifest(functionNames).map(item => item.name))
for (const key of ['pay', 'callback', 'refund']) {
  if (functionNames[key]) {
    names.add(functionNames[key])
  }
}

const deployedEnvironments = []
for (const functionName of names) {
  const detail = existingFunctionDetail(functionName)
  if (detail) {
    deployedEnvironments.push(environmentVariables(detail))
  }
}

const resolved = resolveMipStableSecrets({
  localEnv,
  deployedEnvironments,
  generate: () => randomBytes(48).toString('base64url'),
})
const nextDocument = updateEnvDocument(
  fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '',
  resolved.values,
)
const temporaryPath = `${envPath}.tmp-${process.pid}`
try {
  fs.writeFileSync(temporaryPath, nextDocument, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
  fs.renameSync(temporaryPath, envPath)
  fs.chmodSync(envPath, 0o600)
}
finally {
  if (fs.existsSync(temporaryPath)) {
    fs.rmSync(temporaryPath)
  }
}

const inventoryPath = path.join(root, '.tmp', 'mip-secret-inventory.json')
fs.mkdirSync(path.dirname(inventoryPath), { recursive: true })
fs.writeFileSync(inventoryPath, `${JSON.stringify({
  schemaVersion: 1,
  environmentConfigured: true,
  deployedFunctionCount: deployedEnvironments.length,
  secrets: secretInventory(resolved.values, resolved.sources),
  generatedAt: new Date().toISOString(),
}, null, 2)}\n`, { mode: 0o600 })

const counts = Object.values(resolved.sources).reduce((result, source) => {
  result[source] = (result[source] || 0) + 1
  return result
}, {})
console.log(`[mip-secrets] local secret set ready; local=${counts.local || 0}, recovered=${counts.deployed || 0}, generated=${counts.generated || 0}`)
console.log('[mip-secrets] values were not printed; keep .env.local and its backup private')

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
