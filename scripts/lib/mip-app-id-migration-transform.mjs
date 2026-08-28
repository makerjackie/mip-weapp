import { Buffer } from 'node:buffer'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

// Reusing the identity service primitive keeps the migration ciphertext format,
// key derivation and AAD byte-for-byte aligned with production reads.
const {
  hashPhone,
  protectContact,
  protectPhone,
  revealContact,
  revealPhone,
} = require('../../cloudfunctions/mip-identity-api/lib/private-data.js')

export const APP_ID_MIGRATION_ACTION = Object.freeze({
  EXCLUDE: 'EXCLUDE',
  MIGRATE: 'MIGRATE',
})

export const APP_ID_MIGRATION_EXCLUSIONS = Object.freeze({
  mip_admin_export_tickets: 'TEMPORARY_EXPORT_TICKET',
  mip_delivery_tasks: 'SOURCE_APP_EXTERNAL_DELIVERY',
  mip_event_checkin_credentials: 'SOURCE_APP_CHECKIN_CREDENTIAL',
  mip_event_invitation_links: 'SOURCE_APP_INVITATION_CREDENTIAL',
  mip_event_seat_holds: 'TEMPORARY_INVENTORY_HOLD',
  mip_idempotency_keys: 'TEMPORARY_IDEMPOTENCY_CLAIM',
  mip_message_campaign_dispatches: 'SOURCE_APP_DELIVERY_DISPATCH',
  mip_message_delivery_reviews: 'SOURCE_APP_DELIVERY_REVIEW',
  mip_notification_grants: 'SOURCE_APP_NOTIFICATION_GRANT',
  mip_outbox_events: 'OPERATIONAL_OUTBOX',
  mip_payment_attempts: 'SOURCE_APP_PAYMENT_ATTEMPT',
  mip_payment_callbacks: 'SOURCE_APP_PAYMENT_CALLBACK',
  mip_web_bff_requests: 'TEMPORARY_BFF_NONCE',
})

const APP_ID_PATTERN = /^wx[A-Za-z0-9]{16}$/
const MIP_TABLE_PATTERN = /^mip_[a-z0-9_]+$/
const CONTACT_CIPHERTEXT_FIELDS = Object.freeze([
  'wechat_ciphertext',
  'email_ciphertext',
  'address_ciphertext',
])
const TEMPORARY_FIELD_RESETS = Object.freeze({
  mip_event_checkins: Object.freeze(['credential_id']),
  mip_event_registrations: Object.freeze(['ticket_hash']),
  mip_knowledge_ingestion_schedules: Object.freeze([
    'lease_token',
    'lease_due_at',
    'leased_until',
  ]),
  mip_message_campaigns: Object.freeze([
    'active_dispatch_id',
    'publish_idempotency_key',
    'publish_request_hash',
  ]),
})

export function appIdMigrationPolicy(tableName) {
  assertMipTableName(tableName)
  const reason = APP_ID_MIGRATION_EXCLUSIONS[tableName]
  return Object.freeze(reason
    ? { action: APP_ID_MIGRATION_ACTION.EXCLUDE, reason }
    : { action: APP_ID_MIGRATION_ACTION.MIGRATE })
}

export function remapAppScopedRow(row, options) {
  assertPlainRow(row)
  const { sourceAppId, targetAppId } = normalizedMapping(options)
  if (row.app_id !== sourceAppId) {
    throw new Error('MIGRATION_SOURCE_APP_SCOPE_MISMATCH')
  }
  return {
    ...row,
    app_id: targetAppId,
  }
}

export function transformPrivateProfileRow(row, options) {
  assertPlainRow(row)
  const mapping = normalizedMapping(options)
  const remapped = remapAppScopedRow(row, mapping)
  const phoneState = phoneStateFor(row)

  if (phoneState === 'BOUND') {
    const phone = decryptPhoneForMigration(row.phone_ciphertext, options, mapping, row.user_id)
    const encrypted = encryptPhoneForMigration(phone, options, mapping, row.user_id)
    remapped.phone_hash = encrypted.phoneHash
    remapped.phone_ciphertext = encrypted.phoneCiphertext
  }

  for (const field of CONTACT_CIPHERTEXT_FIELDS) {
    if (row[field] === null || row[field] === undefined) {
      continue
    }
    remapped[field] = reencryptContactForMigration(row[field], options, mapping, row.user_id)
  }

  return remapped
}

export function transformAppScopedTable(input) {
  const tableName = input?.tableName
  const rows = input?.rows
  const policy = appIdMigrationPolicy(tableName)
  if (!Array.isArray(rows)) {
    throw new TypeError('MIGRATION_ROWS_INVALID')
  }

  if (policy.action === APP_ID_MIGRATION_ACTION.EXCLUDE) {
    return Object.freeze({
      action: policy.action,
      excludedCount: rows.length,
      reason: policy.reason,
      rows: Object.freeze([]),
      tableName,
    })
  }

  const transformedRows = rows.map((row) => {
    const transformed = tableName === 'mip_private_profiles'
      ? transformPrivateProfileRow(row, input)
      : remapAppScopedRow(row, input)
    return resetTemporaryFields(tableName, transformed)
  })

  return Object.freeze({
    action: policy.action,
    excludedCount: 0,
    rows: Object.freeze(transformedRows),
    tableName,
  })
}

export function assertNoAppIdMigrationResidue(input) {
  const { sourceAppId, targetAppId } = normalizedMapping(input)
  const tables = input?.tables
  if (!tables || typeof tables !== 'object' || Array.isArray(tables)) {
    throw new TypeError('MIGRATION_TABLES_INVALID')
  }

  let rowCount = 0
  const tableNames = Object.keys(tables).sort()
  for (const tableName of tableNames) {
    const rows = tables[tableName]
    const policy = appIdMigrationPolicy(tableName)
    if (!Array.isArray(rows)) {
      throw new TypeError('MIGRATION_ROWS_INVALID')
    }
    if (policy.action === APP_ID_MIGRATION_ACTION.EXCLUDE && rows.length > 0) {
      throw new Error(`MIGRATION_RESIDUE_EXCLUDED_TABLE:${tableName}`)
    }

    for (const row of rows) {
      assertPlainRow(row)
      rowCount += 1
      if (row.app_id !== targetAppId) {
        throw new Error(`MIGRATION_RESIDUE_APP_SCOPE:${tableName}`)
      }
      if (containsExactString(row, sourceAppId)) {
        throw new Error(`MIGRATION_RESIDUE_SOURCE_APP_ID:${tableName}`)
      }
      assertTemporaryFieldsCleared(tableName, row)
    }
  }

  return Object.freeze({ rowCount, tableCount: tableNames.length })
}

function normalizedMapping(options = {}) {
  const sourceAppId = normalizeAppId(options.sourceAppId, 'MIGRATION_SOURCE_APP_ID_INVALID')
  const targetAppId = normalizeAppId(options.targetAppId, 'MIGRATION_TARGET_APP_ID_INVALID')
  if (sourceAppId === targetAppId) {
    throw new Error('MIGRATION_APP_ID_MAPPING_MUST_CHANGE')
  }
  return { sourceAppId, targetAppId }
}

function normalizeAppId(value, errorCode) {
  if (typeof value !== 'string' || !APP_ID_PATTERN.test(value)) {
    throw new Error(errorCode)
  }
  return value
}

function assertMipTableName(tableName) {
  if (typeof tableName !== 'string' || !MIP_TABLE_PATTERN.test(tableName)) {
    throw new Error('MIGRATION_TABLE_NOT_ALLOWED')
  }
}

function assertPlainRow(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row) || Buffer.isBuffer(row)) {
    throw new TypeError('MIGRATION_ROW_INVALID')
  }
}

function phoneStateFor(row) {
  const phoneHashPresent = typeof row.phone_hash === 'string' && row.phone_hash.length > 0
  const phoneCiphertextPresent = row.phone_ciphertext !== null && row.phone_ciphertext !== undefined
  const phoneVerifiedAtPresent = row.phone_verified_at !== null && row.phone_verified_at !== undefined
  if (!phoneHashPresent && !phoneCiphertextPresent && !phoneVerifiedAtPresent) {
    return 'EMPTY'
  }
  if (phoneHashPresent && phoneCiphertextPresent && phoneVerifiedAtPresent) {
    return 'BOUND'
  }
  throw new Error('MIGRATION_PRIVATE_PROFILE_PHONE_STATE_INVALID')
}

function decryptPhoneForMigration(ciphertext, options, mapping, userId) {
  assertUserId(userId)
  const ciphertextBuffer = ciphertextBufferFor(
    ciphertext,
    'MIGRATION_PHONE_CIPHERTEXT_INVALID',
  )
  try {
    const normalizedPhone = revealPhone(ciphertextBuffer, options.sourcePhoneEncryptionKey, {
      appId: mapping.sourceAppId,
      userId,
    })
    if (!/^\+\d{1,4}:\d{6,20}$/.test(normalizedPhone)) {
      throw new Error('invalid normalized phone')
    }
    return normalizedPhone
  }
  catch {
    throw new Error('MIGRATION_PHONE_DECRYPTION_FAILED')
  }
}

function encryptPhoneForMigration(normalizedPhone, options, mapping, userId) {
  const match = /^\+(\d{1,4}):(\d{6,20})$/.exec(normalizedPhone)
  if (!match) {
    throw new Error('MIGRATION_PHONE_DECRYPTION_FAILED')
  }
  try {
    const phoneInfo = { countryCode: match[1], purePhoneNumber: match[2] }
    const encrypted = protectPhone(phoneInfo, options.targetPhoneEncryptionKey, {
      appId: mapping.targetAppId,
      userId,
    })
    const expectedHash = hashPhone(phoneInfo, options.targetPhoneEncryptionKey, {
      appId: mapping.targetAppId,
    })
    if (encrypted.phoneHash !== expectedHash) {
      throw new Error('hash mismatch')
    }
    return encrypted
  }
  catch {
    throw new Error('MIGRATION_PHONE_REENCRYPTION_FAILED')
  }
}

function reencryptContactForMigration(ciphertext, options, mapping, userId) {
  assertUserId(userId)
  const ciphertextBuffer = ciphertextBufferFor(
    ciphertext,
    'MIGRATION_CONTACT_CIPHERTEXT_INVALID',
  )
  try {
    const value = revealContact(ciphertextBuffer, options.sourcePhoneEncryptionKey, {
      appId: mapping.sourceAppId,
      userId,
    })
    return protectContact(value, options.targetPhoneEncryptionKey, {
      appId: mapping.targetAppId,
      userId,
    })
  }
  catch {
    throw new Error('MIGRATION_CONTACT_REENCRYPTION_FAILED')
  }
}

function ciphertextBufferFor(value, errorCode) {
  let buffer = value
  if (
    !Buffer.isBuffer(value)
    && value?.type === 'Buffer'
    && Array.isArray(value.data)
    && value.data.every(byte => Number.isInteger(byte) && byte >= 0 && byte <= 255)
  ) {
    buffer = Buffer.from(value.data)
  }
  if (!Buffer.isBuffer(buffer) || buffer.length < 29 || buffer[0] !== 1) {
    throw new Error(errorCode)
  }
  return buffer
}

function assertUserId(userId) {
  if (typeof userId !== 'string' || userId.length === 0) {
    throw new Error('MIGRATION_USER_ID_INVALID')
  }
}

function resetTemporaryFields(tableName, row) {
  const fields = TEMPORARY_FIELD_RESETS[tableName]
  if (!fields) {
    return row
  }
  const result = { ...row }
  for (const field of fields) {
    if (Object.hasOwn(result, field)) {
      result[field] = null
    }
  }
  return result
}

function assertTemporaryFieldsCleared(tableName, row) {
  const fields = TEMPORARY_FIELD_RESETS[tableName] || []
  for (const field of fields) {
    if (row[field] !== null && row[field] !== undefined) {
      throw new Error(`MIGRATION_RESIDUE_TEMPORARY_CREDENTIAL:${tableName}.${field}`)
    }
  }
}

function containsExactString(value, needle, seen = new Set()) {
  if (typeof value === 'string') {
    return value.includes(needle)
  }
  if (!value || typeof value !== 'object' || Buffer.isBuffer(value) || value instanceof Date) {
    return false
  }
  if (seen.has(value)) {
    return false
  }
  seen.add(value)
  if (Array.isArray(value)) {
    return value.some(item => containsExactString(item, needle, seen))
  }
  return Object.values(value).some(item => containsExactString(item, needle, seen))
}
