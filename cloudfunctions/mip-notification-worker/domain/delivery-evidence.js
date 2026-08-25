'use strict'

const { createHash } = require('node:crypto')

function deliveryEvidenceRevision(input) {
  return createHash('sha256').update(JSON.stringify([
    String(input.taskId || ''),
    String(input.status || ''),
    number(input.attempts),
    instant(input.availableAt),
    instant(input.leaseExpiresAt),
    instant(input.deliveredAt),
    nullable(input.lastErrorCode),
    String(input.lastOutcome || ''),
    String(input.retryDisposition || ''),
    instant(input.outcomeUpdatedAt),
    number(input.reservedGrantCount),
    instant(input.reservedGrantExpiresAt),
  ])).digest('hex')
}

function normalizedDeliveryEvidence(row, grant = null) {
  return {
    taskId: String(row.id),
    status: row.status,
    attempts: Number(row.attempts || 0),
    availableAt: row.available_at,
    leaseExpiresAt: row.lease_expires_at || null,
    deliveredAt: row.delivered_at || null,
    lastErrorCode: row.last_error_code || null,
    lastOutcome: row.last_outcome,
    retryDisposition: row.retry_disposition,
    outcomeUpdatedAt: row.outcome_updated_at,
    reservedGrantCount: grant ? 1 : 0,
    reservedGrantExpiresAt: grant?.reservation_expires_at || null,
  }
}

function instant(value) {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isFinite(date.getTime()) ? date.toISOString() : 'INVALID'
}

function nullable(value) {
  return value === null || value === undefined || value === '' ? null : String(value)
}

function number(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

module.exports = { deliveryEvidenceRevision, normalizedDeliveryEvidence }
