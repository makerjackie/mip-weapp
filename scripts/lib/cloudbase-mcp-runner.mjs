import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

export function canonicalCloudbaseMcpConfig(workspaceRoot) {
  return path.join(workspaceRoot, 'config', 'mcporter.json')
}

function mcporterBinary(workspaceRoot) {
  const binary = path.join(workspaceRoot, 'node_modules', '.bin', process.platform === 'win32' ? 'mcporter.cmd' : 'mcporter')
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

export function runMcporter(workspaceRoot, args, timeout = 120000) {
  const config = canonicalCloudbaseMcpConfig(workspaceRoot)
  if (!fs.existsSync(config)) {
    throw new Error('Canonical CloudBase MCP config is missing at config/mcporter.json')
  }
  const result = spawnSync(mcporterBinary(workspaceRoot), ['--config', config, ...args], {
    cwd: workspaceRoot,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
    timeout,
  })
  if (result.error) {
    throw result.error
  }
  if (result.status !== 0) {
    throw new Error(`mcporter failed: ${sanitizedDiagnostic(result.stderr || result.stdout).trim()}`)
  }
  return result.stdout
}

export function callCloudbaseMcp(workspaceRoot, tool, args, timeout = 120000) {
  return parseMcpOutput(runMcporter(workspaceRoot, [
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

export function cloudbaseAuthStatus(workspaceRoot) {
  const value = callCloudbaseMcp(workspaceRoot, 'auth', { action: 'status' }, 30000)
  return {
    authStatus: String(value?.auth_status || ''),
    envStatus: String(value?.env_status || ''),
  }
}

export function restartCloudbaseMcp(workspaceRoot) {
  runMcporter(workspaceRoot, ['daemon', 'restart'], 30000)
}
