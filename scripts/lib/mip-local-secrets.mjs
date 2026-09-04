import { createHash } from 'node:crypto'
import fs from 'node:fs'
import process from 'node:process'

export const MIP_STABLE_SECRET_KEYS = Object.freeze([
  'MIP_IDENTITY_PEPPER',
  'MIP_UNION_IDENTITY_PEPPER',
  'MIP_MEDIA_SCOPE_SECRET',
  'MIP_MEDIA_MAINTENANCE_HMAC_SECRET',
  'MIP_PHONE_ENCRYPTION_KEY',
  'MIP_EVENT_TOKEN_SECRET',
  'MIP_LEDGER_SECRET',
  'MIP_TEST_MEMBERSHIP_HMAC_SECRET',
  'MIP_GROWTH_HMAC_SECRET',
  'MIP_NOTIFICATION_HMAC_SECRET',
  'MIP_OUTBOX_HMAC_SECRET',
  'MIP_MESSAGE_DISPATCH_HMAC_SECRET',
  'MIP_ADMIN_WEB_BFF_HMAC_SECRET',
  'MIP_ADMIN_WEB_LOGIN_HMAC_SECRET',
  'MIP_TASKS_ADMIN_HMAC_SECRET',
  'MIP_BANNERS_ADMIN_HMAC_SECRET',
  'MIP_GAME_ADMIN_HMAC_SECRET',
  'MIP_MEDIA_ADMIN_HMAC_SECRET',
  'MIP_KNOWLEDGE_SCHEDULER_HMAC_SECRET',
  'MIP_REFUND_WORKER_HMAC_SECRET',
  'MIP_NOTIFICATION_ENCRYPTION_KEY',
  'MIP_AI_HMAC_SECRET',
  'MIP_AI_DRAFT_PROVIDER_HMAC_SECRET',
  'MIP_AI_AVATAR_PROVIDER_HMAC_SECRET',
  'MIP_AI_STORAGE_KEY',
  'MIP_MATCHING_INTERNAL_HMAC_SECRET',
  'MIP_MATCHING_REFERENCE_SECRET',
])

export const MIP_LOCAL_SECRET_KEYS = Object.freeze([
  ...MIP_STABLE_SECRET_KEYS,
  'MIP_DB_CONNECTION_URI',
  'OPENAI_API_KEY',
  'MIP_AI_DRAFT_UPSTREAM_SECRET',
  'MIP_AI_AVATAR_UPSTREAM_AUTH_SECRET',
  'MIP_SERVICE_ACCOUNT_ADAPTER_SECRET',
])

export const REQUIRED_LOCAL_KEYS = Object.freeze([
  'MIP_WECHAT_APP_SECRET',
  'MIP_WECHAT_CODE_UPLOAD_KEY_PATH',
])

export function assertMipSchedulerHmacSecretsIsolated(values = {}) {
  const messageSecret = normalized(values.MIP_MESSAGE_DISPATCH_HMAC_SECRET)
  const knowledgeSecret = normalized(values.MIP_KNOWLEDGE_SCHEDULER_HMAC_SECRET)
  if (messageSecret.length < 32 || knowledgeSecret.length < 32) {
    throw new Error('Message and knowledge scheduler HMAC secrets must both be configured')
  }
  if (messageSecret === knowledgeSecret) {
    throw new Error('MIP_KNOWLEDGE_SCHEDULER_HMAC_SECRET must differ from MIP_MESSAGE_DISPATCH_HMAC_SECRET')
  }
  return true
}

export function assertMipAiProviderHmacSecretsIsolated(values = {}) {
  const secrets = [
    normalized(values.MIP_AI_HMAC_SECRET),
    normalized(values.MIP_AI_DRAFT_PROVIDER_HMAC_SECRET),
    normalized(values.MIP_AI_AVATAR_PROVIDER_HMAC_SECRET),
  ]
  if (secrets.some(value => value.length < 32)) {
    throw new Error('AI maintenance, draft Provider, and avatar Provider HMAC secrets must be configured')
  }
  if (new Set(secrets).size !== secrets.length) {
    throw new Error('AI maintenance and Provider HMAC secrets must use separate trust domains')
  }
  return true
}

export function assertMipWebAdminHmacSecretsIsolated(values = {}) {
  const querySecret = normalized(values.MIP_ADMIN_WEB_BFF_HMAC_SECRET)
  const loginSecret = normalized(values.MIP_ADMIN_WEB_LOGIN_HMAC_SECRET)
  if (querySecret.length < 32 || loginSecret.length < 32) {
    throw new Error('Web admin query and login HMAC secrets must both be configured')
  }
  if (querySecret === loginSecret) {
    throw new Error('MIP_ADMIN_WEB_LOGIN_HMAC_SECRET must differ from MIP_ADMIN_WEB_BFF_HMAC_SECRET')
  }
  return true
}

export function assertMipTaskAdminHmacSecretsIsolated(values = {}) {
  const taskSecret = normalized(values.MIP_TASKS_ADMIN_HMAC_SECRET)
  if (taskSecret.length < 32) {
    throw new Error('Task admin HMAC secret must be configured')
  }
  const reused = Object.entries(values).some(([key, value]) => key !== 'MIP_TASKS_ADMIN_HMAC_SECRET'
    && key.endsWith('_HMAC_SECRET')
    && normalized(value) === taskSecret)
  if (reused) {
    throw new Error('MIP_TASKS_ADMIN_HMAC_SECRET must use a separate trust domain')
  }
  return true
}

export function assertMipDomainAdminHmacSecretsIsolated(values = {}) {
  const keys = [
    'MIP_TASKS_ADMIN_HMAC_SECRET',
    'MIP_BANNERS_ADMIN_HMAC_SECRET',
    'MIP_GAME_ADMIN_HMAC_SECRET',
    'MIP_MEDIA_ADMIN_HMAC_SECRET',
  ]
  const secrets = keys.map(key => normalized(values[key]))
  if (secrets.some(value => value.length < 32)) {
    throw new Error('Task, Banner, Game, and media admin HMAC secrets must all be configured')
  }
  if (new Set(secrets).size !== secrets.length) {
    throw new Error('Task, Banner, Game, and media admin HMAC secrets must use separate trust domains')
  }
  for (const [index, value] of secrets.entries()) {
    const ownKey = keys[index]
    const reused = Object.entries(values).some(([key, candidate]) => key !== ownKey
      && key.endsWith('_HMAC_SECRET')
      && normalized(candidate) === value)
    if (reused) {
      throw new Error(`${ownKey} must use a separate trust domain`)
    }
  }
  return true
}

function normalized(value) {
  return typeof value === 'string' ? value.trim() : ''
}

export function resolveMipStableSecrets({ localEnv = {}, deployedEnvironments = [], generate }) {
  if (typeof generate !== 'function') {
    throw new TypeError('Secret generator is required')
  }
  const values = {}
  const sources = {}
  for (const key of MIP_STABLE_SECRET_KEYS) {
    const localValue = normalized(localEnv[key])
    const deployedValues = new Set(deployedEnvironments
      .map(environment => normalized(environment?.[key]))
      .filter(Boolean))
    if (deployedValues.size > 1) {
      throw new Error(`Existing MIP functions disagree on ${key}`)
    }
    const deployedValue = [...deployedValues][0] || ''
    if (localValue && deployedValue && localValue !== deployedValue) {
      throw new Error(`${key} differs from the deployed MIP value`)
    }
    const value = localValue || deployedValue || normalized(generate(key))
    if (value.length < 32 || /[\r\n]/.test(value)) {
      throw new Error(`${key} must contain at least 32 single-line characters`)
    }
    values[key] = value
    sources[key] = localValue ? 'local' : deployedValue ? 'deployed' : 'generated'
  }
  assertMipSchedulerHmacSecretsIsolated(values)
  assertMipAiProviderHmacSecretsIsolated(values)
  assertMipWebAdminHmacSecretsIsolated(values)
  assertMipTaskAdminHmacSecretsIsolated(values)
  assertMipDomainAdminHmacSecretsIsolated(values)
  return { values, sources }
}

export function updateEnvDocument(source, values) {
  const lines = String(source || '').split(/\r?\n/)
  const managed = new Set(Object.keys(values))
  const found = new Set()
  const updated = []
  for (const line of lines) {
    const match = line.match(/^([A-Z_]\w*)=/)
    const key = match?.[1]
    if (!key || !managed.has(key)) {
      updated.push(line)
      continue
    }
    if (found.has(key)) {
      throw new Error(`Duplicate ${key} entry in .env.local`)
    }
    found.add(key)
    updated.push(`${key}=${values[key]}`)
  }
  const missing = MIP_STABLE_SECRET_KEYS.filter(key => !found.has(key) && values[key])
  if (missing.length) {
    while (updated.length && updated[updated.length - 1] === '') {
      updated.pop()
    }
    updated.push('')
    updated.push('# Stable MIP server secrets. Never commit or rotate without a migration.')
    updated.push(...missing.map(key => `${key}=${values[key]}`))
  }
  return `${updated.join('\n').replace(/\n+$/, '')}\n`
}

export function removeEnvKeys(source, keys) {
  const managed = new Set(keys)
  return `${String(source || '').split(/\r?\n/).filter((line) => {
    const key = line.match(/^([A-Z_]\w*)=/)?.[1]
    return !key || !managed.has(key)
  }).join('\n').replace(/\n+$/, '')}\n`
}

export function writeEnvFileAtomic(filePath, contents) {
  const temporaryPath = `${filePath}.tmp-${process.pid}`
  fs.writeFileSync(temporaryPath, contents, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
  try {
    fs.renameSync(temporaryPath, filePath)
    fs.chmodSync(filePath, 0o600)
  }
  finally {
    if (fs.existsSync(temporaryPath)) {
      fs.rmSync(temporaryPath)
    }
  }
}

export function envDocumentFromValues(values) {
  return `${Object.entries(values)
    .filter(([, value]) => String(value ?? '').trim())
    .map(([key, value]) => `${key}=${value}`)
    .join('\n')}\n`
}

export function compactEnvDocuments(localSource, secretsSource = '') {
  const localLines = String(localSource || '').split(/\r?\n/)
  const secretsLines = String(secretsSource || '').split(/\r?\n/)
  const moved = {}
  const retained = []
  const secretSet = new Set(MIP_LOCAL_SECRET_KEYS)
  const defaults = new Map([
    ['BUILD_SHA', 'development'],
    ['MIP_MINIPROGRAM_STATE', 'trial'],
    ['MIP_CUSTOMER_SERVICE_ENABLED', 'false'],
    ['MIP_AI_PROVIDER_TIMEOUT_MS', '8000'],
    ['MIP_AI_DRAFT_UPSTREAM_TIMEOUT_MS', '8000'],
    ['MIP_AI_AVATAR_PROVIDER_TIMEOUT_MS', '45000'],
    ['MIP_AI_AVATAR_UPSTREAM_TIMEOUT_MS', '30000'],
    ['MIP_MATCHING_PROVIDER_TIMEOUT_MS', '3000'],
    ['MIP_AI_DRAFT_TTL_HOURS', '72'],
    ['MIP_EXPORT_MAX_ROWS', '5000'],
    ['MIP_EXPORT_MAX_BYTES', '8388608'],
    ['MIP_UNION_ID_REBIND_ENABLED', 'false'],
    ['MIP_ADMIN_WEB_LOGIN_CONFIRM_URL', 'https://mipmini.01mvp.com/api/internal/auth/challenge/confirm'],
  ])
  const functionDefaults = new Map([
    ['MIP_IDENTITY_FUNCTION_NAME', 'mip-identity-api'],
    ['MIP_MEDIA_FUNCTION_NAME', 'mip-media-api'],
    ['MIP_EVENTS_FUNCTION_NAME', 'mip-events-api'],
    ['MIP_OPPORTUNITIES_FUNCTION_NAME', 'mip-opportunities-api'],
    ['MIP_COMMUNITY_FUNCTION_NAME', 'mip-community-api'],
    ['MIP_COMMERCE_FUNCTION_NAME', 'mip-commerce-api'],
    ['MIP_ADMIN_FUNCTION_NAME', 'mip-admin-api'],
    ['MIP_GROWTH_FUNCTION_NAME', 'mip-growth-api'],
    ['MIP_GAME_FUNCTION_NAME', 'mip-game-api'],
    ['MIP_TASKS_FUNCTION_NAME', 'mip-tasks-api'],
    ['MIP_BANNERS_FUNCTION_NAME', 'mip-banners-api'],
    ['MIP_AI_FUNCTION_NAME', 'mip-ai-api'],
    ['MIP_NOTIFICATIONS_FUNCTION_NAME', 'mip-notifications-api'],
    ['MIP_LEDGER_FUNCTION_NAME', 'mip-payment-ledger'],
    ['MIP_NOTIFICATION_FUNCTION_NAME', 'mip-notification-worker'],
    ['MIP_OUTBOX_FUNCTION_NAME', 'mip-outbox-worker'],
    ['MIP_MESSAGE_SCHEDULER_FUNCTION_NAME', 'mip-message-scheduler'],
    ['MIP_MESSAGE_SCHEDULER_TRIGGER_NAME', 'mip-message-campaign-next'],
    ['MIP_KNOWLEDGE_SCHEDULER_FUNCTION_NAME', 'mip-knowledge-scheduler'],
    ['MIP_KNOWLEDGE_SCHEDULER_TRIGGER_NAME', 'mip-knowledge-ingestion-next'],
    ['MIP_MESSAGE_SCHEDULER_ROLE_NAME', 'MIPMessageSchedulerRole'],
    ['MIP_KNOWLEDGE_SCHEDULER_ROLE_NAME', 'MIPKnowledgeSchedulerRole'],
    ['MIP_PAY_FUNCTION_NAME', 'mip-cloudpay'],
    ['MIP_PAY_CALLBACK_FUNCTION', 'mip-cloudpay-callback'],
    ['MIP_REFUND_FUNCTION_NAME', 'mip-refund-worker'],
  ])
  const isDefault = (key, value) => defaults.get(key) === value || functionDefaults.get(key) === value
  const processLine = (line, sourceIsSecrets) => {
    const match = line.match(/^([A-Z_]\w*)=(.*)$/)
    if (!match) {
      if (!sourceIsSecrets && line.trim()) {
        retained.push(line)
      }
      return
    }
    const [, key, raw] = match
    const value = raw.trim().replace(/^['"]|['"]$/g, '')
    if (secretSet.has(key)) {
      if (value && moved[key] && moved[key] !== value) {
        throw new Error(`${key} differs between local secret files`)
      }
      if (value) {
        moved[key] = value
      }
      return
    }
    if (sourceIsSecrets) {
      if (value) {
        moved[key] = value
      }
      return
    }
    if (!value || isDefault(key, value)) {
      return
    }
    retained.push(`${key}=${raw}`)
  }
  secretsLines.forEach(line => processLine(line, true))
  localLines.forEach(line => processLine(line, false))
  for (const key of REQUIRED_LOCAL_KEYS) {
    const match = localLines.find(line => line.startsWith(`${key}=`))
    if (match && !retained.some(line => line.startsWith(`${key}=`))) {
      retained.push(match)
    }
  }
  return {
    local: `${retained.filter(Boolean).join('\n')}\n`,
    secrets: envDocumentFromValues(moved),
    movedKeys: Object.keys(moved),
  }
}

export function secretInventory(values, sources) {
  return Object.fromEntries(MIP_STABLE_SECRET_KEYS.map(key => [key, {
    source: sources[key],
    fingerprint: createHash('sha256').update(values[key]).digest('hex').slice(0, 16),
  }]))
}
