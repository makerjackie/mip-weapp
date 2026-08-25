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

function normalizedDeliveryEvidence(row) {
  return {
    taskId: String(row.source_id || row.id),
    status: row.source_status || row.status,
    attempts: Number(row.source_attempts ?? row.attempts ?? 0),
    availableAt: row.source_available_at ?? row.available_at,
    leaseExpiresAt: row.source_lease_expires_at ?? row.lease_expires_at ?? null,
    deliveredAt: row.source_delivered_at ?? row.delivered_at ?? null,
    lastErrorCode: row.source_last_error_code ?? row.last_error_code ?? null,
    lastOutcome: row.source_last_outcome || row.last_outcome,
    retryDisposition: row.source_retry_disposition || row.retry_disposition,
    outcomeUpdatedAt: row.source_outcome_updated_at ?? row.outcome_updated_at,
    reservedGrantCount: Number(row.reserved_grant_count || 0),
    reservedGrantExpiresAt: row.reserved_grant_expires_at || null,
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
