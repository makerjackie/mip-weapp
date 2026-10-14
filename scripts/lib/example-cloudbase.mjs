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

// MIP_ENV_DIR selects a target-configuration directory (e.g. envs/test or envs/prod)
// that owns both env files for this run. Process env wins so orchestrators stay
// explicit; the repo-root .env.local value is a convenience for humans only.
export function resolveEnvDir(caseRoot) {
  const configured = String(
    process.env.MIP_ENV_DIR
    || parseEnv(path.join(caseRoot, '.env.local')).MIP_ENV_DIR
    || '',
  ).trim()
  if (!configured) {
    return caseRoot
  }
  const resolved = path.isAbsolute(configured) ? configured : path.resolve(caseRoot, configured)
  if (!fs.existsSync(path.join(resolved, '.env.local'))) {
    throw new Error(`MIP_ENV_DIR target has no .env.local: ${configured}`)
  }
  return resolved
}

export function loadCaseEnv(caseRoot) {
  const envDir = resolveEnvDir(caseRoot)
  const secrets = parseEnv(path.join(envDir, '.env.secrets.local'))
  const local = parseEnv(path.join(envDir, '.env.local'))
  for (const [key, value] of Object.entries(secrets)) {
    if (String(value).trim() && String(local[key] || '').trim() && String(value).trim() !== String(local[key]).trim()) {
      throw new Error(`${key} differs between .env.secrets.local and .env.local`)
    }
  }
  return {
    ...secrets,
    ...local,
    ...process.env,
  }
}

// CloudBase MCP MySQL tools accept dbInstance.schema; passing it routes runQuery
// and runStatement to an explicit logical database instead of the instance default.
export function mysqlDbInstanceArg(schema) {
  const schemaName = String(schema || '').trim()
  if (!schemaName) {
    return {}
  }
  if (!/^[\w-]{1,64}$/.test(schemaName)) {
    throw new Error('CloudBase MySQL schema must be a plain identifier')
  }
  return { dbInstance: { schema: schemaName } }
}

function workspaceRoot(caseRoot) {
  return caseRoot
}

function sanitizedDiagnostic(value) {
  let result = String(value || '')
    .replace(/("(?:api[_-]?key|secret|token|password|private[_-]?key)"\s*:\s*")[^"]+("?)/gi, '$1[redacted]$2')
    .replace(/("(?:MIP|MEMBERSHIP|SEWING)_\w*(?:SECRET(?:_ID|_KEY)?|PEPPER|ENCRYPTION_KEY|DB_CONNECTION_URI)"\s*:\s*")[^"]+("?)/gi, '$1[redacted]$2')
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

// Auto-routing source for MIP_DB_SCHEMA: same precedence as loadCaseEnv
// (process env wins, then the MIP_ENV_DIR target's .env.local). Cached per
// process; schema names are not secrets so .env.local is the canonical home.
let routedTargetSchemaCache
function routedTargetSchema(caseRoot) {
  if (routedTargetSchemaCache !== undefined) {
    return routedTargetSchemaCache
  }
  const rootLocal = parseEnv(path.join(caseRoot, '.env.local'))
  const dirSetting = String(process.env.MIP_ENV_DIR || rootLocal.MIP_ENV_DIR || '').trim()
  const dir = dirSetting
    ? (path.isAbsolute(dirSetting) ? dirSetting : path.resolve(caseRoot, dirSetting))
    : caseRoot
  const local = dir === caseRoot ? rootLocal : parseEnv(path.join(dir, '.env.local'))
  routedTargetSchemaCache = String(process.env.MIP_DB_SCHEMA || local.MIP_DB_SCHEMA || '').trim()
  return routedTargetSchemaCache
}

// When MIP_DB_SCHEMA is configured, every unqualified mip_* query or statement
// is routed to that logical database. Instance-scoped probes (information_schema
// privileges, VERSION()) keep instance-wide visibility; an explicit dbInstance
// argument from the caller always wins.
function autoSchemaArgs(caseRoot, tool, args) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    return args
  }
  if (tool !== 'queryMysqlDatabase' && tool !== 'manageMysqlDatabase') {
    return args
  }
  if (args.action !== 'runQuery' && args.action !== 'runStatement') {
    return args
  }
  if (args.dbInstance) {
    return args
  }
  const schemaName = routedTargetSchema(caseRoot)
  if (!schemaName) {
    return args
  }
  if (!/^[\w-]{1,64}$/.test(schemaName)) {
    throw new Error('MIP_DB_SCHEMA must be a plain schema identifier')
  }
  const sql = String(args.sql || '')
  if (/information_schema\s*\./i.test(sql) || /SELECT\s+VERSION\(\)/i.test(sql)) {
    return args
  }
  return { ...args, dbInstance: { schema: schemaName } }
}

export function callCloudbase(caseRoot, tool, args, timeout = 120000) {
  const routedArgs = autoSchemaArgs(caseRoot, tool, args)
  let response
  try {
    response = callCloudbaseMcp(workspaceRoot(caseRoot), tool, routedArgs, timeout)
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
    'EnvId' in value || 'envId' in value
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
  const environment = bindAndRequireCloudbaseEnvironment(caseRoot, envId)
  const mysql = callCloudbase(caseRoot, 'queryMysqlDatabase', { action: 'getInstanceInfo' })
  if (!/mysql|cynosdb/i.test(JSON.stringify(mysql))) {
    throw new Error('Target CloudBase environment has no ready MySQL instance')
  }
  if (development && !['development', 'test'].includes(stage)) {
    throw new Error('Demo data requires a development or test deployment stage')
  }
  return { environment, mysql }
}

export function bindAndRequireCloudbaseEnvironment(caseRoot, envId) {
  const status = cloudbaseAuthStatus(workspaceRoot(caseRoot))
  if (status.authStatus !== 'READY') {
    throw new Error('CloudBase MCP is not READY. Set the environment-level CLOUDBASE_API_KEY and CLOUDBASE_ENV_ID in .env.local, then run pnpm cloud:auth; normal commands never start device authorization.')
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
  return info
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
