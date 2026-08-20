import fs from 'node:fs'

const fatalLevels = new Set(['assert', 'error', 'exception', 'rejection'])
const forbiddenPatterns = new Set(['.*', '^.*$', '.+', '^.+$'])

function stringify(value) {
  if (typeof value === 'string') {
    return value
  }
  try {
    const serialized = JSON.stringify(value)
    return serialized === undefined ? String(value) : serialized
  }
  catch {
    return String(value)
  }
}

export function sanitizeRuntimeValue(value, explicitSecrets = []) {
  let message = stringify(value)
  for (const secret of explicitSecrets) {
    if (typeof secret === 'string' && secret.length >= 4) {
      message = message.replaceAll(secret, '[redacted]')
    }
  }
  return message
    .replace(/wx[0-9a-f]{16}/gi, '[redacted-appid]')
    .replace(/\bo[\w-]{27}\b/g, '[redacted-openid]')
    .replace(/\b1[3-9]\d{9}\b/g, '[redacted-phone]')
    .replace(/\b[a-z][a-z0-9-]{1,31}-[a-z0-9]{16}\b/gi, '[redacted-env]')
    .slice(0, 2000)
}

export function runtimeConsoleLevel(payload) {
  if (!payload || typeof payload !== 'object') {
    return 'log'
  }
  const raw = String(payload.type || payload.level || payload.method || 'log').toLowerCase()
  if (raw === 'warning') {
    return 'warn'
  }
  if (raw === 'assert') {
    return 'assert'
  }
  if (raw === 'error') {
    return 'error'
  }
  if (raw === 'info' || raw === 'warn' || raw === 'debug') {
    return raw
  }
  return 'log'
}

function runtimePayloadMessage(payload) {
  if (!payload || typeof payload !== 'object') {
    return payload
  }
  if (Array.isArray(payload.args)) {
    return payload.args.map(stringify).join(' ')
  }
  if ('message' in payload) {
    return payload.message
  }
  if ('text' in payload) {
    return payload.text
  }
  return payload
}

function validateAllowlistEntry(entry, today) {
  if (!entry || typeof entry !== 'object') {
    throw new Error('Runtime warning allowlist entry must be an object')
  }
  for (const key of ['id', 'pattern', 'source', 'reason', 'owner', 'expiresAt']) {
    if (typeof entry[key] !== 'string' || entry[key].trim() === '') {
      throw new Error(`Runtime warning allowlist entry is missing ${key}`)
    }
  }
  if (entry.pattern.length < 12 || forbiddenPatterns.has(entry.pattern.trim())) {
    throw new Error(`Runtime warning allowlist pattern is too broad: ${entry.id}`)
  }
  const expiresAt = new Date(`${entry.expiresAt}T23:59:59.999Z`)
  if (Number.isNaN(expiresAt.getTime())) {
    throw new TypeError(`Invalid runtime warning expiry: ${entry.id}`)
  }
  if (expiresAt < today) {
    throw new Error(`Expired runtime warning allowlist entry: ${entry.id}`)
  }
  return { ...entry, matcher: new RegExp(entry.pattern, 'u') }
}

export function readRuntimeWarningAllowlist(filePath, today = new Date()) {
  const value = JSON.parse(fs.readFileSync(filePath, 'utf8'))
  if (!value || !Array.isArray(value.entries)) {
    throw new Error('Runtime warning allowlist must contain entries[]')
  }
  const ids = new Set()
  return value.entries.map((entry) => {
    const result = validateAllowlistEntry(entry, today)
    if (ids.has(result.id)) {
      throw new Error(`Duplicate runtime warning allowlist id: ${result.id}`)
    }
    ids.add(result.id)
    return result
  })
}

function warningAllowlistId(message, entries) {
  return entries.find(entry => entry.matcher.test(message))?.id || null
}

export function createRuntimeDiagnostics(options = {}) {
  const allowlist = options.allowlist || []
  const explicitSecrets = options.explicitSecrets || []
  const entries = []

  function capture(source, level, payload) {
    const message = sanitizeRuntimeValue(runtimePayloadMessage(payload), explicitSecrets)
    const allowlistId = level === 'warn' ? warningAllowlistId(message, allowlist) : null
    const entry = {
      sequence: entries.length + 1,
      source,
      level,
      message,
      allowlistId,
    }
    entries.push(entry)
    return entry
  }

  return {
    captureConsole(payload) {
      return capture('console', runtimeConsoleLevel(payload), payload)
    },
    captureException(payload) {
      return capture('runtime', 'exception', payload)
    },
    captureRejection(payload) {
      return capture('runtime', 'rejection', payload)
    },
    entries() {
      return entries.map(entry => ({ ...entry }))
    },
    failures() {
      return entries.filter(entry => fatalLevels.has(entry.level) || (entry.level === 'warn' && !entry.allowlistId))
    },
    summary() {
      const counts = { log: 0, info: 0, debug: 0, warn: 0, assert: 0, error: 0, exception: 0, rejection: 0 }
      for (const entry of entries) {
        counts[entry.level] = (counts[entry.level] || 0) + 1
      }
      return {
        counts,
        total: entries.length,
        allowlistedWarnings: entries.filter(entry => entry.level === 'warn' && entry.allowlistId).length,
        unknownWarnings: entries.filter(entry => entry.level === 'warn' && !entry.allowlistId).length,
        failures: entries.filter(entry => fatalLevels.has(entry.level) || (entry.level === 'warn' && !entry.allowlistId)).length,
      }
    },
  }
}

export function isRecoverableRuntimeConnectionError(error) {
  const message = sanitizeRuntimeValue(error instanceof Error ? error.message : error).toLowerCase()
  return message.includes('devtools_protocol_timeout')
    || message.includes('did not respond to protocol method')
    || message.includes('automator transport')
    || message.includes('websocket')
    || message.includes('wait timed out after')
    || message.includes('timed out waiting')
    || message.includes('extension context invalidated')
}
