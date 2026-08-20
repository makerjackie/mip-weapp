import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import {
  callCloudbaseMcp,
  cloudbaseAuthStatus,
} from './cloudbase-mcp-runner.mjs'

export function parseEnv(filePath) {
  if (!fs.existsSync(filePath)) {
    return {}
  }
  return fs.readFileSync(filePath, 'utf8').split(/\r?\n/).reduce((result, line) => {
    const match = line.trim().match(/^([A-Z_]\w*)=(.*)$/i)
    if (match) {
      result[match[1]] = match[2].trim().replace(/^['"]|['"]$/g, '')
    }
    return result
  }, {})
}

export function loadCaseEnv(caseRoot) {
  return {
    ...parseEnv(path.join(caseRoot, '.env.local')),
    ...process.env,
  }
}

function workspaceRoot(caseRoot) {
  return caseRoot
}

function sanitizedDiagnostic(value) {
  let result = String(value || '')
    .replace(/("(?:api[_-]?key|secret|token|password|private[_-]?key)"\s*:\s*")[^"]+("?)/gi, '$1[redacted]$2')
    .replace(/("(?:MEMBERSHIP|SEWING)_(?:DB_CONNECTION_URI|(?:PREVIOUS_)?LEDGER_SECRET)"\s*:\s*")[^"]+("?)/gi, '$1[redacted]$2')
    .replace(/mysql:\/\/[^\s"']+/gi, 'mysql://[redacted]')
    .replace(/(IDENTIFIED\s+BY\s+')[^']+(')/gi, '$1[redacted]$2')
    .replace(/(Bearer\s+)[\w.~-]+/gi, '$1[redacted]')
  for (const identifier of [
    process.env.CLOUDBASE_ENV_ID,
    process.env.MINI_PROGRAM_APP_ID,
    process.env.CLOUDBASE_RESOURCE_APP_ID,
  ].filter(Boolean)) {
    result = result.replaceAll(identifier, '[redacted-id]')
  }
  return result
}

export function callCloudbase(caseRoot, tool, args, timeout = 120000) {
  let response
  try {
    response = callCloudbaseMcp(workspaceRoot(caseRoot), tool, args, timeout)
  }
  catch (error) {
    throw new Error(`CloudBase ${tool} failed: ${sanitizedDiagnostic(error instanceof Error ? error.message : error).trim()}`)
  }
  if (response?.isError) {
    throw new Error(`CloudBase ${tool} failed: ${sanitizedDiagnostic(JSON.stringify(response)).trim()}`)
  }
  return response
}

function findEnvInfo(value) {
  if (!value || typeof value !== 'object') {
    return null
  }
  if (
    ('EnvId' in value || 'envId' in value)
    && ('RuntimeMode' in value || 'RuntimeBackends' in value || 'Alias' in value)
  ) {
    return value
  }
  for (const child of Object.values(value)) {
    const found = findEnvInfo(child)
    if (found) {
      return found
    }
  }
  return null
}

export function bindAndRequireMysqlEnvironment(caseRoot, envId, { development = false, stage } = {}) {
  const status = cloudbaseAuthStatus(workspaceRoot(caseRoot))
  if (status.authStatus !== 'READY') {
    throw new Error('CloudBase MCP is not READY. Run pnpm cloud:auth once; this script will not start a second authorization flow.')
  }
  callCloudbase(caseRoot, 'auth', { action: 'set_env', envId })
  const boundStatus = cloudbaseAuthStatus(workspaceRoot(caseRoot))
  if (boundStatus.authStatus !== 'READY' || boundStatus.envStatus !== 'READY') {
    throw new Error('CloudBase MCP environment binding did not become READY')
  }
  const response = callCloudbase(caseRoot, 'queryEnv', { action: 'info', envId })
  const info = findEnvInfo(response)
  if (!info) {
    throw new Error('CloudBase environment details were not returned')
  }
  const resolvedId = info.EnvId || info.envId
  if (resolvedId !== envId) {
    throw new Error('Target CloudBase environment identity does not match')
  }
  const mysql = callCloudbase(caseRoot, 'queryMysqlDatabase', { action: 'getInstanceInfo' })
  if (!/mysql|cynosdb/i.test(JSON.stringify(mysql))) {
    throw new Error('Target CloudBase environment has no ready MySQL instance')
  }
  if (development && !['development', 'test'].includes(stage)) {
    throw new Error('Demo data requires a development or test deployment stage')
  }
  return { environment: info, mysql }
}

export function sqlLiteral(value) {
  if (value === null || value === undefined) {
    return 'null'
  }
  return `'${String(value).replaceAll('\\', '\\\\').replaceAll('\'', '\\\'')}'`
}

export function sqlJson(value) {
  return sqlLiteral(JSON.stringify(value ?? null))
}

export function cloudFunctionResult(response) {
  const value = response?.data?.invokeResult?.RetMsg ?? response?.data?.raw?.RetMsg
  if (value && typeof value === 'object') {
    return value
  }
  if (typeof value !== 'string' || !value.trim()) {
    return null
  }
  try {
    return JSON.parse(value)
  }
  catch {
    return null
  }
}

export { sanitizedDiagnostic }
