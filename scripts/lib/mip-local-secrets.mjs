import { createHash } from 'node:crypto'

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

export function secretInventory(values, sources) {
  return Object.fromEntries(MIP_STABLE_SECRET_KEYS.map(key => [key, {
    source: sources[key],
    fingerprint: createHash('sha256').update(values[key]).digest('hex').slice(0, 16),
  }]))
}
