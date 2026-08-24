import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { applyCloudbaseManagementEnv } from './cloudbase-local-auth.mjs'

const CLOUD_BASE_CREDENTIAL_RELATIVE_PATHS = [
  ['.config', '.cloudbase', 'auth.json'],
  ['.mcporter', 'credentials.json'],
]

export function canonicalCloudbaseMcpConfig(projectRoot) {
  return path.join(projectRoot, 'config', 'mcporter.json')
}

function mcporterBinary(projectRoot) {
  const binary = path.join(projectRoot, 'node_modules', '.bin', process.platform === 'win32' ? 'mcporter.cmd' : 'mcporter')
  if (!fs.existsSync(binary)) {
    throw new Error('Pinned mcporter is missing. Run pnpm install at the project root.')
  }
  return binary
}

function sanitizedDiagnostic(value) {
  return String(value || '')
    .replace(/("(?:api[_-]?key|secret|token|password|private[_-]?key)"\s*:\s*")[^"]+("?)/gi, '$1[redacted]$2')
    .replace(/mysql:\/\/[^\s"']+/gi, 'mysql://[redacted]')
    .replace(/(Bearer\s+)[\w.~-]+/gi, '$1[redacted]')
    .replace(/wx[0-9a-f]{16}/gi, '[redacted-appid]')
    .replace(/\b[a-z][a-z0-9-]{1,31}-[a-z0-9]{16}\b/gi, '[redacted-env]')
    .slice(0, 4000)
}

export function cloudbaseCredentialPaths(homeDirectory = os.homedir()) {
  return CLOUD_BASE_CREDENTIAL_RELATIVE_PATHS.map(parts => path.join(homeDirectory, ...parts))
}

export function hardenCloudbaseCredentialFiles(
  homeDirectory = os.homedir(),
  {
    platform = process.platform,
    uid = typeof process.getuid === 'function' ? process.getuid() : undefined,
  } = {},
) {
  if (platform === 'win32') {
    return
  }
  for (const credentialPath of cloudbaseCredentialPaths(homeDirectory)) {
    let stat
    try {
      stat = fs.lstatSync(credentialPath)
    }
    catch (error) {
      if (error?.code === 'ENOENT') {
        continue
      }
      throw new Error(`CloudBase credential inspection failed for ${credentialPath}: ${error instanceof Error ? error.message : String(error)}`)
    }
    if (!stat.isFile()) {
      throw new Error(`CloudBase credential path must be a regular file: ${credentialPath}`)
    }
    if (uid !== undefined && stat.uid !== uid) {
      throw new Error(`CloudBase credential file owner does not match the current user: ${credentialPath}`)
    }
    try {
      fs.chmodSync(credentialPath, 0o600)
    }
    catch (error) {
      throw new Error(`CloudBase credential permission update failed for ${credentialPath}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}

export function shouldUseSecureDaemonUmask(args, platform = process.platform) {
  return platform !== 'win32' && args[0] === 'daemon' && ['start', 'restart'].includes(args[1])
}

export function parseMcpOutput(value) {
  const text = String(value || '').trim()
  let result
  try {
    result = JSON.parse(text)
  }
  catch (error) {
    // mcporter can emit one daemon-recovery diagnostic before the requested
    // JSON payload. Parse only a complete trailing object; never accept an
    // arbitrary substring or silently turn a malformed response into success.
    const starts = [...text.matchAll(/(?:^|\n)(?=\{)/g)].map(match => match.index + (match[0] === '\n' ? 1 : 0))
    for (const start of starts.reverse()) {
      try {
        result = JSON.parse(text.slice(start))
        break
      }
      catch { /* Continue looking for the complete trailing MCP payload. */ }
    }
    if (result === undefined) {
      throw error
    }
  }
  if (result?.isError === true) {
    const diagnostic = Array.isArray(result.content)
      ? result.content.filter(item => item?.type === 'text').map(item => item.text).join('\n')
      : ''
    if (/not found|not exist|resourcenotfound|不存在|未找到/i.test(diagnostic)) {
      throw new Error('MCP tool returned an error response: resource not found.')
    }
    if (/accessdenied|forbidden|unauthori[sz]ed|permission|没有权限|无权限|未授权/i.test(diagnostic)) {
      throw new Error('MCP tool returned an error response: permission denied.')
    }
    throw new Error('MCP tool returned an error response.')
  }
  if (Array.isArray(result?.content) && typeof result.content[0]?.text === 'string') {
    try {
      return JSON.parse(result.content[0].text)
    }
    catch {
      return result
    }
  }
  return result
}

export function runMcporter(projectRoot, args, timeout = 120000) {
  applyCloudbaseManagementEnv(projectRoot)
  const config = canonicalCloudbaseMcpConfig(projectRoot)
  if (!fs.existsSync(config)) {
    throw new Error('Canonical CloudBase MCP config is missing at config/mcporter.json')
  }
  const childUmaskRequired = shouldUseSecureDaemonUmask(args)
  let previousUmask
  let result
  try {
    if (childUmaskRequired) {
      previousUmask = process.umask(0o077)
    }
    result = spawnSync(mcporterBinary(projectRoot), ['--config', config, ...args], {
      cwd: projectRoot,
      encoding: 'utf8',
      maxBuffer: 20 * 1024 * 1024,
      timeout,
    })
  }
  finally {
    if (previousUmask !== undefined) {
      process.umask(previousUmask)
    }
    hardenCloudbaseCredentialFiles()
  }
  if (result.error) {
    throw result.error
  }
  if (result.status !== 0) {
    throw new Error(`mcporter failed: ${sanitizedDiagnostic(result.stderr || result.stdout).trim()}`)
  }
  return result.stdout
}

export function callCloudbaseMcp(projectRoot, tool, args, timeout = 120000) {
  return parseMcpOutput(runMcporter(projectRoot, [
    'call',
    `cloudbase.${tool}`,
    '--args',
    JSON.stringify(args),
    '--output',
    'json',
    '--timeout',
    String(timeout),
  ], timeout + 5000))
}

export function cloudbaseAuthStatus(projectRoot) {
  const value = callCloudbaseMcp(projectRoot, 'auth', { action: 'status' }, 30000)
  return {
    authStatus: String(value?.auth_status || ''),
    envStatus: String(value?.env_status || ''),
  }
}

export function restartCloudbaseMcp(projectRoot) {
  runMcporter(projectRoot, ['daemon', 'restart'], 30000)
}
