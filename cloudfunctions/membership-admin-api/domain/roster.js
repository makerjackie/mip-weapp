'use strict'

const { createHash, randomBytes } = require('node:crypto')

const ROSTER_STATUS = Object.freeze({
  ALL: 'ALL',
  PENDING_REVIEW: 'PENDING_REVIEW',
  WAITLISTED: 'WAITLISTED',
  REGISTERED: 'REGISTERED',
  CANCELLATION_PENDING: 'CANCELLATION_PENDING',
  ATTENDED: 'ATTENDED',
  REJECTED: 'REJECTED',
  CANCELLED: 'CANCELLED',
})

const ROSTER_EXPORT_COLUMNS = Object.freeze([
  'nickname',
  'city',
  'status',
  'registeredAt',
  'attendedAt',
  'ticketCodeMasked',
])

const ROSTER_STATUS_LABELS = Object.freeze({
  PENDING_REVIEW: '待审核',
  WAITLISTED: '候补中',
  REGISTERED: '已报名',
  CANCELLATION_PENDING: '退款中',
  ATTENDED: '已签到',
  REJECTED: '未通过',
  CANCELLED: '已取消',
})

/** Effective-status sort rank: active first, then attended, then cancelled. */
const STATUS_SORT_RANK = Object.freeze({
  PENDING_REVIEW: 0,
  WAITLISTED: 1,
  REGISTERED: 2,
  CANCELLATION_PENDING: 3,
  ATTENDED: 4,
  REJECTED: 5,
  CANCELLED: 6,
})

const UNDO_REASON_CATEGORIES = Object.freeze([
  'MISTAP',
  'WRONG_PERSON',
  'OPERATOR_ERROR',
  'OTHER',
])

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
/** Ticket codes are T + hex (server generateTicketCode). Prefix search requires the T prefix. */
const TICKET_CODE_RE = /^T[0-9A-F]{4,31}$/i
const PHONE_RE = /^\d{11}$/
const CSV_FORMULA_RE = /^[=+\-@\t\r]/
const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9._:-]{8,128}$/

function clampLimit(value, { min = 1, max = 50, fallback = 20 } = {}) {
  const number = Number(value)
  if (!Number.isInteger(number)) {
    return fallback
  }
  return Math.min(max, Math.max(min, number))
}

function normalizeRosterStatus(value) {
  if (value === null || value === undefined || value === '') {
    return ROSTER_STATUS.ALL
  }
  if (typeof value !== 'string' || !Object.values(ROSTER_STATUS).includes(value)) {
    throw new Error('INVALID_ROSTER_STATUS')
  }
  return value
}

function normalizeRosterQuery(value) {
  if (value === null || value === undefined || value === '') {
    return ''
  }
  if (typeof value !== 'string') {
    throw new Error('INVALID_ROSTER_QUERY')
  }
  const query = value.trim()
  if (!query) {
    return ''
  }
  if (query.length < 2) {
    throw new Error('INVALID_ROSTER_QUERY')
  }
  if (query.length > 64) {
    throw new Error('INVALID_ROSTER_QUERY')
  }
  return query
}

/**
 * Classify operator search intent.
 * Ticket matches only T+hex format so ordinary alphabetic nicknames stay profile search.
 * Phone exact match stays server-side only.
 */
function classifyRosterQuery(query) {
  if (!query) {
    return { kind: 'none' }
  }
  if (PHONE_RE.test(query)) {
    return { kind: 'phone', value: query }
  }
  if (TICKET_CODE_RE.test(query)) {
    return { kind: 'ticket', value: query.toUpperCase() }
  }
  return { kind: 'profile', value: query }
}

/** Escape LIKE wildcards so user input cannot broaden the pattern. */
function escapeLikePattern(value) {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/%/g, '\\%')
    .replace(/_/g, '\\_')
}

function maskPhone(value) {
  if (typeof value !== 'string' || !value) {
    return null
  }
  const digits = value.replace(/\D/g, '')
  if (digits.length < 7) {
    return '****'
  }
  if (digits.length === 11) {
    return `${digits.slice(0, 3)}****${digits.slice(-4)}`
  }
  return `${digits.slice(0, 2)}****${digits.slice(-2)}`
}

function maskTicketCode(value) {
  if (typeof value !== 'string' || !value) {
    return ''
  }
  const compact = value.replace(/[^A-Za-z0-9]/g, '').toUpperCase()
  if (!compact) {
    return ''
  }
  if (compact.length <= 8) {
    return `${compact.slice(0, 2)}****`
  }
  return `${compact.slice(0, 4)}****${compact.slice(-4)}`
}

function rosterCursorSignature({ appId, eventId, status, query }) {
  return createHash('sha256')
    .update([
      String(appId || ''),
      String(eventId || ''),
      String(status || 'ALL'),
      String(query || ''),
      'statusRank,registeredAtDesc,idDesc',
    ].join('|'))
    .digest('hex')
    .slice(0, 16)
}

function statusRank(status) {
  return Object.prototype.hasOwnProperty.call(STATUS_SORT_RANK, status)
    ? STATUS_SORT_RANK[status]
    : 9
}

function encodeRosterCursor({ registeredAt, id, status, signature }) {
  if (!(registeredAt instanceof Date) || Number.isNaN(registeredAt.getTime()) || !UUID_RE.test(id)) {
    throw new Error('INVALID_ROSTER_CURSOR')
  }
  if (typeof signature !== 'string' || !/^[a-f0-9]{16}$/i.test(signature)) {
    throw new Error('INVALID_ROSTER_CURSOR')
  }
  return Buffer.from(JSON.stringify({
    t: registeredAt.toISOString(),
    i: id,
    r: statusRank(status),
    s: signature,
  }), 'utf8').toString('base64url')
}

function decodeRosterCursor(value, expectedSignature) {
  if (value === null || value === undefined || value === '') {
    return null
  }
  if (typeof value !== 'string' || value.length > 256) {
    throw new Error('INVALID_ROSTER_CURSOR')
  }
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
    if (!parsed || typeof parsed !== 'object') {
      throw new Error('INVALID_ROSTER_CURSOR')
    }
    if (typeof parsed.t !== 'string' || !UUID_RE.test(parsed.i)) {
      throw new Error('INVALID_ROSTER_CURSOR')
    }
    if (typeof parsed.s !== 'string' || !/^[a-f0-9]{16}$/i.test(parsed.s)) {
      throw new Error('INVALID_ROSTER_CURSOR')
    }
    if (expectedSignature && parsed.s !== expectedSignature) {
      throw new Error('INVALID_ROSTER_CURSOR')
    }
    const registeredAt = new Date(parsed.t)
    if (Number.isNaN(registeredAt.getTime())) {
      throw new Error('INVALID_ROSTER_CURSOR')
    }
    const rank = Number(parsed.r)
    if (!Number.isInteger(rank) || rank < 0 || rank > 9) {
      throw new Error('INVALID_ROSTER_CURSOR')
    }
    return { registeredAt, id: parsed.i, rank, signature: parsed.s }
  }
  catch (error) {
    if (error instanceof Error && error.message === 'INVALID_ROSTER_CURSOR') {
      throw error
    }
    throw new Error('INVALID_ROSTER_CURSOR')
  }
}

function escapeCsvCell(value) {
  let text = value === null || value === undefined ? '' : String(value)
  text = text.replace(/[\r\n\t]+/g, ' ').trim()
  if (CSV_FORMULA_RE.test(text)) {
    text = `'${text}`
  }
  if (/[",]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`
  }
  return text
}

function buildRosterCsv(rows) {
  const header = [
    '昵称',
    '联系电话',
    '城市',
    '报名状态',
    '报名时间',
    '签到时间',
    '票码（掩码）',
  ].join(',')
  const lines = rows.map(row => [
    escapeCsvCell(row.nickname),
    escapeCsvCell(row.phoneNumber),
    escapeCsvCell(row.city),
    escapeCsvCell(ROSTER_STATUS_LABELS[row.status] || row.status || ''),
    escapeCsvCell(row.registeredAt || ''),
    escapeCsvCell(row.attendedAt || ''),
    escapeCsvCell(row.ticketCodeMasked || ''),
  ].join(','))
  return `\uFEFF${[header, ...lines].join('\n')}\n`
}

function rosterExportFileName(now = new Date(), extension = 'xlsx') {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
  const safeExt = extension === 'csv' ? 'csv' : 'xlsx'
  return `event-roster-${stamp}.${safeExt}`
}

function createExportToken() {
  return createHash('sha256')
    .update(randomBytes(32))
    .digest('hex')
}

function hashExportToken(token) {
  return createHash('sha256').update(String(token)).digest('hex')
}

function generateTicketCode() {
  return `T${randomBytes(5).toString('hex').toUpperCase()}`
}

function isWithinCheckInWindow(event, now = new Date()) {
  const startsAt = event.starts_at instanceof Date ? event.starts_at : new Date(event.starts_at)
  const endsAt = event.ends_at
    ? (event.ends_at instanceof Date ? event.ends_at : new Date(event.ends_at))
    : new Date(startsAt.getTime() + 60 * 60 * 1000)
  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) {
    return false
  }
  const openAt = startsAt.getTime() - (6 * 60 * 60 * 1000)
  const closeAt = endsAt.getTime() + (24 * 60 * 60 * 1000)
  const current = now.getTime()
  return current >= openAt && current <= closeAt
}

/**
 * Undo reason: required safe category + optional free text.
 * Audit stores only category and free-text length, never raw operator notes beyond length.
 */
function normalizeUndoReason(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const category = String(value.category || '').trim().toUpperCase()
    if (!UNDO_REASON_CATEGORIES.includes(category)) {
      throw new Error('INVALID_UNDO_REASON')
    }
    const text = typeof value.text === 'string' ? value.text.trim() : ''
    if (text.length > 120) {
      throw new Error('INVALID_UNDO_REASON')
    }
    return { category, text, length: text.length }
  }
  // Backward-compatible plain string → OTHER + text (still length-capped).
  if (typeof value !== 'string') {
    throw new Error('INVALID_UNDO_REASON')
  }
  const text = value.trim()
  if (text.length < 1 || text.length > 120) {
    throw new Error('INVALID_UNDO_REASON')
  }
  return { category: 'OTHER', text, length: text.length }
}

function expectedRegistrationVersion(value) {
  if (value === null || value === undefined || value === '') {
    throw new Error('INVALID_REGISTRATION_VERSION')
  }
  const version = Number(value)
  if (!Number.isInteger(version) || version < 1) {
    throw new Error('INVALID_REGISTRATION_VERSION')
  }
  return version
}

function requirePositiveVersion(value, field = 'version') {
  if (value === null || value === undefined || value === '') {
    throw new Error('DATA_INTEGRITY')
  }
  const version = Number(value)
  if (!Number.isInteger(version) || version < 1) {
    throw new Error('DATA_INTEGRITY')
  }
  return version
}

function normalizeIdempotencyKey(value) {
  if (value === null || value === undefined || value === '') {
    return ''
  }
  if (typeof value !== 'string' || !IDEMPOTENCY_KEY_RE.test(value)) {
    throw new Error('INVALID_IDEMPOTENCY_KEY')
  }
  return value
}

function hashMutationPayload(parts) {
  return createHash('sha256')
    .update(JSON.stringify(parts))
    .digest('hex')
}

module.exports = {
  ROSTER_EXPORT_COLUMNS,
  ROSTER_STATUS,
  ROSTER_STATUS_LABELS,
  STATUS_SORT_RANK,
  UNDO_REASON_CATEGORIES,
  buildRosterCsv,
  classifyRosterQuery,
  clampLimit,
  createExportToken,
  decodeRosterCursor,
  encodeRosterCursor,
  escapeCsvCell,
  escapeLikePattern,
  expectedRegistrationVersion,
  generateTicketCode,
  hashExportToken,
  hashMutationPayload,
  isWithinCheckInWindow,
  maskPhone,
  maskTicketCode,
  normalizeIdempotencyKey,
  normalizeRosterQuery,
  normalizeRosterStatus,
  normalizeUndoReason,
  requirePositiveVersion,
  rosterCursorSignature,
  rosterExportFileName,
  statusRank,
}
