'use strict'

const { createHash, randomBytes, randomUUID } = require('node:crypto')
const {
  DomainError,
  activeRegistrationStatuses,
  assertCanCancel,
  assertCheckInAllowed,
  capacityStatuses,
  decideRegistration,
  grantsCapability,
  validateFeedback,
} = require('./rules')
const {
  normalizeRegistrationAnswerPayload,
  normalizeRegistrationAnswers,
  normalizeRegistrationSchema,
} = require('./registration-schema')
const { createSignedToken, readSignedToken } = require('../lib/tokens')
const { createProfileRef } = require('../lib/profile-ref')

function parseJson(value, fallback) {
  if (value === null || value === undefined) {
    return fallback
  }
  if (typeof value === 'object') {
    return value
  }
  try {
    return JSON.parse(value)
  }
  catch {
    return fallback
  }
}

function iso(value) {
  const date = value instanceof Date ? value : new Date(value)
  return Number.isFinite(date.getTime()) ? date.toISOString() : ''
}

function registeredOnlineUrl(row) {
  if (!['ONLINE', 'HYBRID'].includes(row.event_mode)
    || !['REGISTERED', 'ATTENDED'].includes(row.registration_status)
    || typeof row.online_url !== 'string') {
    return undefined
  }
  const value = row.online_url.trim()
  if (/\s/.test(value)) {
    return undefined
  }
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'https:' && parsed.hostname && !parsed.username && !parsed.password
      ? value
      : undefined
  }
  catch {
    return undefined
  }
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function parseCheckInToken(value) {
  const token = typeof value === 'string' ? value.trim() : ''
  const short = /^s1\.([A-Za-z0-9_-]{11})\.([A-Za-z0-9_-]{11})$/.exec(token)
  if (short) {
    return { kind: 'SHORT', reference: short[1], secret: short[2], token }
  }
  const legacy = /^([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.([A-Za-z0-9_-]{16,64})$/i.exec(token)
  if (legacy) {
    return { kind: 'LEGACY', reference: legacy[1], secret: legacy[2], token }
  }
  throw new DomainError('VALIDATION_FAILED', '活动码无效')
}

function parseInvitationScene(value) {
  const token = typeof value === 'string' ? value.trim() : ''
  const parsed = /^i1\.([A-Za-z0-9_-]{11})\.([A-Za-z0-9_-]{11})$/.exec(token)
  if (!parsed) {
    throw new DomainError('VALIDATION_FAILED', '活动邀请无效')
  }
  return { reference: parsed[1], secret: parsed[2], token }
}

function checkInCredentialQuery(parsed, { lock = false } = {}) {
  return {
    sql: `SELECT * FROM mip_event_checkin_credentials
      WHERE app_id = ? AND ${parsed.kind === 'SHORT' ? 'scan_key' : 'id'} = ? AND token_hash = ?${lock ? ' FOR UPDATE' : ''}`,
    params: [parsed.reference, sha256(parsed.secret)],
  }
}

function encodeCursor(row) {
  return Buffer.from(JSON.stringify({ startsAt: iso(row.starts_at), id: row.id })).toString('base64url')
}

function decodeCursor(value) {
  if (!value) {
    return null
  }
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
    if (typeof parsed.startsAt === 'string' && typeof parsed.id === 'string') {
      return parsed
    }
  }
  catch {}
  throw new DomainError('VALIDATION_FAILED', '分页参数无效')
}

const businessDayMilliseconds = 24 * 60 * 60 * 1000
const chinaOffsetMilliseconds = 8 * 60 * 60 * 1000

function businessDateStart(value, label) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new DomainError('VALIDATION_FAILED', label)
  }
  const [year, month, day] = value.split('-').map(Number)
  const utcDay = new Date(Date.UTC(year, month - 1, day))
  if (utcDay.getUTCFullYear() !== year
    || utcDay.getUTCMonth() !== month - 1
    || utcDay.getUTCDate() !== day) {
    throw new DomainError('VALIDATION_FAILED', label)
  }
  return new Date(utcDay.getTime() - chinaOffsetMilliseconds)
}

function currentBusinessDateStart(now) {
  const local = new Date(now.getTime() + chinaOffsetMilliseconds)
  const value = [
    local.getUTCFullYear(),
    String(local.getUTCMonth() + 1).padStart(2, '0'),
    String(local.getUTCDate()).padStart(2, '0'),
  ].join('-')
  return businessDateStart(value, '当前日期无效')
}

function encodeAlbumCursor(row) {
  return Buffer.from(JSON.stringify({ createdAt: iso(row.created_at), id: row.id })).toString('base64url')
}

function decodeAlbumCursor(value) {
  if (!value) return null
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
    if (typeof parsed.createdAt === 'string'
      && Number.isFinite(Date.parse(parsed.createdAt))
      && typeof parsed.id === 'string'
      && /^[0-9a-f-]{36}$/i.test(parsed.id)) {
      return parsed
    }
  }
  catch {}
  throw new DomainError('VALIDATION_FAILED', '分页参数无效')
}

function encodeParticipantCursor(row) {
  return Buffer.from(JSON.stringify({
    registeredAt: iso(row.registered_at),
    id: row.registration_id,
  })).toString('base64url')
}

function decodeParticipantCursor(value) {
  if (!value) return null
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
    if (typeof parsed.registeredAt === 'string'
      && Number.isFinite(Date.parse(parsed.registeredAt))
      && typeof parsed.id === 'string'
      && /^[0-9a-f-]{36}$/i.test(parsed.id)) {
      return parsed
    }
  }
  catch {}
  throw new DomainError('VALIDATION_FAILED', '分页参数无效')
}

function encodeHeartCursor(row) {
  return Buffer.from(JSON.stringify({
    updatedAt: iso(row.updated_at),
    id: row.id,
  })).toString('base64url')
}

function decodeHeartCursor(value) {
  if (!value) return null
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
    if (typeof parsed.updatedAt === 'string'
      && Number.isFinite(Date.parse(parsed.updatedAt))
      && typeof parsed.id === 'string'
      && /^[0-9a-f-]{36}$/i.test(parsed.id)) {
      return parsed
    }
  }
  catch {}
  throw new DomainError('VALIDATION_FAILED', '分页参数无效')
}

function likePattern(value) {
  return `%${String(value).replace(/=/g, '==').replace(/%/g, '=%').replace(/_/g, '=_')}%`
}

function requiredUuid(value, label) {
  const normalized = typeof value === 'string' ? value.trim() : ''
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalized)) {
    throw new DomainError('VALIDATION_FAILED', `${label}标识无效`)
  }
  return normalized
}

function albumPhotoRow(row, { mine = false } = {}) {
  const visibility = publicVisibility(row.visibility_json)
  return {
    id: row.id,
    imageUrl: row.asset_status === 'READY' ? (row.cloud_file_id || '') : '',
    caption: row.caption || '',
    status: row.status,
    version: Number(row.version),
    mine,
    ...(row.status === 'REJECTED' && row.moderation_reason
      ? { moderationReason: row.moderation_reason }
      : {}),
    ...(visibility.nickname && row.nickname ? { nickname: row.nickname } : {}),
    ...(visibility.avatar && row.avatar_file_id ? { avatarUrl: row.avatar_file_id } : {}),
    createdAt: iso(row.created_at),
  }
}

function limitOf(value) {
  const limit = Number(value || 20)
  if (!Number.isInteger(limit) || limit < 1) {
    throw new DomainError('VALIDATION_FAILED', '分页数量无效')
  }
  return Math.min(limit, 30)
}

function mutualBlockFilter(viewerUserId, subjectSql, appSql) {
  if (!viewerUserId) return { sql: '', params: [] }
  return {
    sql: `NOT EXISTS (
      SELECT 1 FROM mip_user_blocks visibility_block
      WHERE visibility_block.app_id = ${appSql} AND visibility_block.status = 'ACTIVE'
        AND (
          (visibility_block.blocker_user_id = ? AND visibility_block.blocked_user_id = ${subjectSql})
          OR
          (visibility_block.blocker_user_id = ${subjectSql} AND visibility_block.blocked_user_id = ?)
        )
    )`,
    params: [viewerUserId, viewerUserId],
  }
}

function publicEventRow(row, previews = []) {
  return {
    id: row.id,
    scopeType: row.scope_type,
    branchId: row.branch_id || undefined,
    branchName: row.branch_name || undefined,
    title: row.title,
    summary: row.summary,
    coverUrl: row.cover_file_id || undefined,
    eventTypeLabel: row.event_type_label || row.event_type_key,
    mode: row.event_mode,
    accessType: row.access_type,
    startsAt: iso(row.starts_at),
    endsAt: iso(row.ends_at),
    cityName: row.city_name || undefined,
    venueName: row.venue_name || undefined,
    status: row.public_status || row.status,
    capacity: row.capacity === null ? undefined : Number(row.capacity),
    registrationCount: Number(row.registration_count || 0),
    participantPreview: previews,
    registrationStatus: row.registration_status || undefined,
    albumEnabled: Number(row.album_enabled) === 1,
  }
}

function publicInvitationAttribution(row) {
  if (!row.registration_status || !row.invitation_source_type) {
    return undefined
  }
  if (row.invitation_source_type !== 'USER') {
    return { sourceType: 'PLATFORM', displayName: 'MIP 平台' }
  }
  const allowed = publicVisibility(row.inviter_visibility_json)
  return {
    sourceType: 'USER',
    displayName: allowed.nickname && row.inviter_nickname ? row.inviter_nickname : 'MIP 用户',
    ...(allowed.avatar && row.inviter_avatar_file_id ? { avatarUrl: row.inviter_avatar_file_id } : {}),
  }
}

async function defaultResolveUserKind(tx, appId, userId, now) {
  const entitlement = await tx.one(
    `SELECT id FROM mip_membership_entitlements
     WHERE app_id = ? AND user_id = ? AND status = 'ACTIVE'
       AND starts_at <= ? AND ends_at > ?
     ORDER BY ends_at DESC, id DESC LIMIT 1`,
    [appId, userId, now, now],
  )
  return entitlement ? 'PLAYER' : 'GUEST'
}

async function requireParticipationAccess(tx, appId, userId) {
  const [profile, privateProfile, agreements] = await Promise.all([
    tx.one(
      `SELECT user_id FROM mip_profiles
       WHERE app_id = ? AND user_id = ? AND nickname <> ''`,
      [appId, userId],
    ),
    tx.one(
      `SELECT user_id FROM mip_private_profiles
       WHERE app_id = ? AND user_id = ? AND phone_verified_at IS NOT NULL`,
      [appId, userId],
    ),
    tx.one(
      `SELECT COUNT(DISTINCT agreement_key) AS total
       FROM mip_agreement_acceptances
       WHERE app_id = ? AND user_id = ?`,
      [appId, userId],
    ),
  ])
  if (Number(agreements?.total || 0) < 2) {
    throw new DomainError('AGREEMENT_REQUIRED', '请先确认服务协议和隐私政策')
  }
  if (!privateProfile) {
    throw new DomainError('PHONE_REQUIRED', '请先绑定手机号')
  }
  if (!profile) {
    throw new DomainError('PROFILE_REQUIRED', '请先完善个人资料')
  }
}

async function requireActiveUserForMutation(tx, appId, userId) {
  const user = await tx.one(
    `SELECT id, status FROM mip_users
     WHERE app_id = ? AND id = ? FOR UPDATE`,
    [appId, userId],
  )
  if (!user || user.status !== 'ACTIVE') {
    throw new DomainError('FORBIDDEN', '当前账号不能执行此操作')
  }
  return user
}

async function idempotencyReplay(tx, { appId, userId, operation, key, request }) {
  if (typeof key !== 'string' || !key.trim() || key.length > 128) {
    throw new DomainError('VALIDATION_FAILED', '请求标识无效')
  }
  const normalizedKey = key.trim()
  const requestHash = sha256(JSON.stringify(request))
  try {
    await tx.query(
      `INSERT INTO mip_idempotency_keys (
        id, app_id, actor_user_id, operation, idempotency_key, request_hash, status, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'RUNNING', DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 24 HOUR))`,
      [randomUUID(), appId, userId, operation, normalizedKey, requestHash],
    )
    return { key: normalizedKey, requestHash, replay: null }
  }
  catch (error) {
    if (Number(error?.errno) !== 1062 && error?.code !== 'ER_DUP_ENTRY') {
      throw error
    }
    const existing = await tx.one(
      `SELECT request_hash, status, response_json FROM mip_idempotency_keys
       WHERE app_id = ? AND actor_user_id = ? AND operation = ? AND idempotency_key = ?
       FOR UPDATE`,
      [appId, userId, operation, normalizedKey],
    )
    if (!existing || existing.request_hash !== requestHash) {
      throw new DomainError('CONFLICT', '重复请求的内容不一致')
    }
    if (existing.status === 'COMPLETED') {
      return { key: normalizedKey, requestHash, replay: parseJson(existing.response_json, null) }
    }
    throw new DomainError('CONFLICT', '相同请求正在处理中', true)
  }
}

async function completeIdempotency(tx, claim, { appId, userId, operation, response }) {
  await tx.query(
    `UPDATE mip_idempotency_keys SET status = 'COMPLETED', response_json = ?
     WHERE app_id = ? AND actor_user_id = ? AND operation = ? AND idempotency_key = ?
       AND request_hash = ? AND status = 'RUNNING'`,
    [JSON.stringify(response), appId, userId, operation, claim.key, claim.requestHash],
  )
}

async function writeAudit(tx, {
  appId,
  actorUserId,
  actorType = 'USER',
  scopeType = 'EVENT',
  scopeId,
  action,
  resourceType,
  resourceId,
  effectiveRole = null,
  metadata = {},
}) {
  await tx.query(
    `INSERT INTO mip_audit_logs (
      app_id, actor_user_id, actor_type, scope_type, scope_id, action,
      resource_type, resource_id, effective_role, metadata_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      appId,
      actorUserId || null,
      actorType,
      scopeType,
      scopeId || null,
      action,
      resourceType,
      resourceId || null,
      effectiveRole,
      JSON.stringify(metadata),
    ],
  )
}

async function writeOutbox(tx, {
  id = randomUUID(),
  appId,
  aggregateType,
  aggregateId,
  eventType,
  sourceVersion,
  payload = {},
}) {
  await tx.query(
    `INSERT INTO mip_outbox_events (
      id, app_id, aggregate_type, aggregate_id, event_type, source_version, payload_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, appId, aggregateType, aggregateId, eventType, sourceVersion, JSON.stringify(payload)],
  )
}

async function writeCheckInTransition(tx, input) {
  await tx.query(
    `INSERT INTO mip_event_checkin_transitions (
      id, app_id, checkin_id, registration_id, event_id, user_id,
      transition_type, checkin_version, registration_version,
      reversal_of_transition_id, actor_user_id, source, revoke_reason, occurred_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.id,
      input.appId,
      input.checkinId,
      input.registrationId,
      input.eventId,
      input.userId,
      input.transitionType,
      input.checkinVersion,
      input.registrationVersion,
      input.reversalOfTransitionId || null,
      input.actorUserId || null,
      input.source,
      input.revokeReason || null,
      input.occurredAt,
    ],
  )
}

function merchantOrderNumber(now) {
  return `MIP${iso(now).replace(/\D/g, '').slice(0, 17)}${randomBytes(5).toString('hex').toUpperCase()}`
}

function merchantRefundNumber(now) {
  return `MIPR${iso(now).replace(/\D/g, '').slice(0, 17)}${randomBytes(5).toString('hex').toUpperCase()}`
}

async function createEventRefund(tx, {
  appId,
  order,
  registrationId,
  requestedByUserId,
  reason,
}) {
  const idempotencyKey = `event-refund:${registrationId}`
  const existing = await tx.one(
    `SELECT id FROM mip_refunds
     WHERE app_id = ? AND order_id = ? AND idempotency_key = ? FOR UPDATE`,
    [appId, order.id, idempotencyKey],
  )
  if (existing) {
    return existing.id
  }
  const refundId = randomUUID()
  await tx.query(
    `INSERT INTO mip_refunds (
      id, app_id, order_id, requested_by_user_id, merchant_refund_no,
      idempotency_key, amount_cents, reason, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING')`,
    [
      refundId,
      appId,
      order.id,
      requestedByUserId,
      merchantRefundNumber(new Date()),
      idempotencyKey,
      order.amount_cents,
      reason,
    ],
  )
  return refundId
}

async function loadParticipantPreviews(db, {
  appId,
  eventIds,
  tokenSecret,
  viewerUserId = null,
}) {
  const grouped = new Map()
  if (!eventIds.length || !tokenSecret) {
    return grouped
  }
  const placeholders = eventIds.map(() => '?').join(', ')
  const blockFilter = mutualBlockFilter(viewerUserId, 'r.user_id', 'r.app_id')
  const rows = await db.query(
    `SELECT r.event_id, r.id AS registration_id, p.nickname, a.cloud_file_id AS avatar_file_id
     FROM mip_event_registrations r
     JOIN mip_profiles p ON p.app_id = r.app_id AND p.user_id = r.user_id
     LEFT JOIN mip_media_assets a ON a.app_id = p.app_id AND a.id = p.avatar_asset_id AND a.status = 'READY'
     WHERE r.app_id = ? AND r.event_id IN (${placeholders})
       AND r.share_profile = 1 AND r.status IN ('REGISTERED', 'ATTENDED')
       ${blockFilter.sql ? `AND ${blockFilter.sql}` : ''}
     ORDER BY r.registered_at DESC, r.id DESC`,
    [appId, ...eventIds, ...blockFilter.params],
  )
  for (const row of rows) {
    const current = grouped.get(row.event_id) || []
    if (current.length < 4) {
      current.push({
        participantRef: createSignedToken({ type: 'participant', eventId: row.event_id, registrationId: row.registration_id }, tokenSecret),
        nickname: row.nickname,
        avatarUrl: row.avatar_file_id || undefined,
      })
      grouped.set(row.event_id, current)
    }
  }
  return grouped
}

async function listEvents(db, {
  appId,
  userId = null,
  query = {},
  now = new Date(),
  tokenSecret,
}) {
  const view = ['UPCOMING', 'PAST', 'MINE'].includes(query.view) ? query.view : 'UPCOMING'
  const dateFilter = ['RECENT', 'ENDED', 'TODAY', 'CUSTOM'].includes(query.dateFilter) ? query.dateFilter : 'RECENT'
  if (view === 'MINE' && !userId) {
    throw new DomainError('AUTH_REQUIRED', '请登录后查看我的活动')
  }
  const limit = limitOf(query.limit)
  const cursor = decodeCursor(query.cursor)
  const clauses = ['e.app_id = ?']
  const params = [appId]
  if (view === 'MINE') {
    clauses.push("r.status IN ('PENDING_REVIEW','WAITLISTED','PAYMENT_PENDING','REGISTERED','CANCELLATION_PENDING','CANCELLED','REJECTED','ATTENDED')")
    clauses.push('r.user_id = ?')
    params.push(userId)
  }
  else if (view === 'PAST' || dateFilter === 'ENDED') {
    clauses.push("(e.status IN ('CANCELLED','ENDED') OR (e.status = 'PUBLISHED' AND e.ends_at < ?))")
    clauses.push('e.published_at IS NOT NULL')
    params.push(now)
  }
  else {
    clauses.push("e.status = 'PUBLISHED'")
    clauses.push('e.ends_at >= ?')
    params.push(now)
  }
  if (dateFilter === 'TODAY') {
    const start = currentBusinessDateStart(now)
    const end = new Date(start.getTime() + businessDayMilliseconds)
    clauses.push('e.starts_at >= ? AND e.starts_at < ?')
    params.push(start, end)
  }
  const hasDateRange = query.dateFrom !== undefined || query.dateTo !== undefined
  if (hasDateRange) {
    const start = query.dateFrom === undefined
      ? undefined
      : businessDateStart(query.dateFrom, '开始日期无效')
    const endStart = query.dateTo === undefined
      ? undefined
      : businessDateStart(query.dateTo, '结束日期无效')
    if (start && endStart && start > endStart) {
      throw new DomainError('VALIDATION_FAILED', '开始日期不能晚于结束日期')
    }
    if (start) {
      clauses.push('e.starts_at >= ?')
      params.push(start)
    }
    if (endStart) {
      clauses.push('e.starts_at < ?')
      params.push(new Date(endStart.getTime() + businessDayMilliseconds))
    }
  }
  else if (dateFilter === 'CUSTOM') {
    const start = businessDateStart(query.date, '请选择有效日期')
    const end = new Date(start.getTime() + businessDayMilliseconds)
    clauses.push('e.starts_at >= ? AND e.starts_at < ?')
    params.push(start, end)
  }
  if (query.branchId) {
    clauses.push('e.branch_id = ?')
    params.push(String(query.branchId))
  }
  if (typeof query.cityName === 'string' && query.cityName.trim()) {
    clauses.push('e.city_name = ?')
    params.push(query.cityName.trim().slice(0, 80))
  }
  if (typeof query.query === 'string' && query.query.trim()) {
    clauses.push('e.title LIKE ? ESCAPE \'\\\\\'')
    params.push(`%${query.query.trim().slice(0, 50).replace(/[\\%_]/g, '\\$&')}%`)
  }
  const descending = view === 'PAST' || view === 'MINE' || dateFilter === 'ENDED'
  if (cursor) {
    clauses.push(descending
      ? '(e.starts_at < ? OR (e.starts_at = ? AND e.id < ?))'
      : '(e.starts_at > ? OR (e.starts_at = ? AND e.id > ?))')
    params.push(cursor.startsAt, cursor.startsAt, cursor.id)
  }
  const rows = await db.query(
    `SELECT e.*, b.name AS branch_name, a.cloud_file_id AS cover_file_id,
       r.status AS registration_status,
       CASE WHEN e.status = 'PUBLISHED' AND e.ends_at < ? THEN 'ENDED' ELSE e.status END AS public_status,
       (SELECT COUNT(*) FROM mip_event_registrations rc
        WHERE rc.app_id = e.app_id AND rc.event_id = e.id
          AND rc.status IN ('REGISTERED','CANCELLATION_PENDING','ATTENDED')) AS registration_count
     FROM mip_events e
     LEFT JOIN mip_city_branches b ON b.app_id = e.app_id AND b.id = e.branch_id
     LEFT JOIN mip_media_assets a ON a.app_id = e.app_id AND a.id = e.cover_asset_id AND a.status = 'READY'
     LEFT JOIN mip_event_registrations r ON r.app_id = e.app_id AND r.event_id = e.id AND r.user_id = ?
     WHERE ${clauses.join(' AND ')}
     ORDER BY e.starts_at ${descending ? 'DESC' : 'ASC'}, e.id ${descending ? 'DESC' : 'ASC'}
     LIMIT ?`,
    [now, userId || '', ...params, limit + 1],
  )
  const hasMore = rows.length > limit
  const pageRows = rows.slice(0, limit)
  const previews = await loadParticipantPreviews(db, {
    appId,
    eventIds: pageRows.map(row => row.id),
    tokenSecret,
    viewerUserId: userId,
  })
  const cities = await db.query(
    `SELECT DISTINCT city_name FROM mip_city_branches
     WHERE app_id = ? AND status = 'ACTIVE' ORDER BY city_name ASC`,
    [appId],
  )
  return {
    items: pageRows.map(row => publicEventRow(row, previews.get(row.id) || [])),
    cities: cities.map(row => row.city_name),
    nextCursor: hasMore ? encodeCursor(pageRows[pageRows.length - 1]) : undefined,
  }
}

async function getEvent(db, {
  appId,
  userId = null,
  eventId,
  now = new Date(),
  tokenSecret,
  profileRefSecret,
}) {
  const organizerBlock = mutualBlockFilter(userId, 'e.organizer_user_id', 'e.app_id')
  const inviterBlock = mutualBlockFilter(userId, 'ia.inviter_user_id', 'ia.app_id')
  const row = await db.one(
    `SELECT e.*, b.name AS branch_name, a.cloud_file_id AS cover_file_id,
       organizer_profile.nickname AS organizer_nickname,
       organizer_profile.headline AS organizer_headline,
       organizer_profile.visibility_json AS organizer_visibility_json,
       organizer_avatar.cloud_file_id AS organizer_avatar_file_id,
       ia.source_type AS invitation_source_type,
       inviter_profile.nickname AS inviter_nickname,
       inviter_profile.visibility_json AS inviter_visibility_json,
       inviter_avatar.cloud_file_id AS inviter_avatar_file_id,
       r.status AS registration_status,
       CASE WHEN e.status = 'PUBLISHED' AND e.ends_at < ? THEN 'ENDED' ELSE e.status END AS public_status,
       (SELECT COUNT(*) FROM mip_event_registrations rc
        WHERE rc.app_id = e.app_id AND rc.event_id = e.id
          AND rc.status IN ('REGISTERED','CANCELLATION_PENDING','ATTENDED')) AS registration_count
     FROM mip_events e
     LEFT JOIN mip_city_branches b ON b.app_id = e.app_id AND b.id = e.branch_id
     LEFT JOIN mip_media_assets a ON a.app_id = e.app_id AND a.id = e.cover_asset_id AND a.status = 'READY'
     LEFT JOIN mip_profiles organizer_profile
       ON organizer_profile.app_id = e.app_id AND organizer_profile.user_id = e.organizer_user_id
       ${organizerBlock.sql ? `AND ${organizerBlock.sql}` : ''}
     LEFT JOIN mip_media_assets organizer_avatar
       ON organizer_avatar.app_id = organizer_profile.app_id
       AND organizer_avatar.id = organizer_profile.avatar_asset_id AND organizer_avatar.status = 'READY'
     LEFT JOIN mip_event_registrations r ON r.app_id = e.app_id AND r.event_id = e.id AND r.user_id = ?
     LEFT JOIN mip_event_invitation_attributions ia
       ON ia.app_id = r.app_id AND ia.registration_id = r.id
     LEFT JOIN mip_profiles inviter_profile
       ON inviter_profile.app_id = ia.app_id AND inviter_profile.user_id = ia.inviter_user_id
       ${inviterBlock.sql ? `AND ${inviterBlock.sql}` : ''}
     LEFT JOIN mip_media_assets inviter_avatar
       ON inviter_avatar.app_id = inviter_profile.app_id
       AND inviter_avatar.id = inviter_profile.avatar_asset_id AND inviter_avatar.status = 'READY'
     WHERE e.app_id = ? AND e.id = ?
       AND (e.status = 'PUBLISHED' OR (e.published_at IS NOT NULL AND e.status IN ('CANCELLED','ENDED')) OR r.id IS NOT NULL)
     LIMIT 1`,
    [now, ...organizerBlock.params, userId || '', ...inviterBlock.params, appId, eventId],
  )
  if (!row) {
    throw new DomainError('NOT_FOUND', '活动不存在或已下架')
  }
  const previews = await loadParticipantPreviews(db, {
    appId,
    eventIds: [eventId],
    tokenSecret,
    viewerUserId: userId,
  })
  const changes = await db.query(
    `SELECT source_version, summary, created_at FROM mip_event_changes
     WHERE app_id = ? AND event_id = ? ORDER BY source_version DESC, id DESC LIMIT 20`,
    [appId, eventId],
  )
  const contentMedia = await db.query(
    `SELECT asset.cloud_file_id, media.caption
     FROM mip_event_content_media media
     INNER JOIN mip_media_assets asset
       ON asset.app_id = media.app_id AND asset.id = media.media_asset_id
       AND asset.status = 'READY' AND asset.purpose = 'EVENT_CONTENT'
     WHERE media.app_id = ? AND media.event_id = ? AND media.status = 'ACTIVE'
     ORDER BY media.sort_order, media.media_asset_id`,
    [appId, eventId],
  )
  const timestamp = now.getTime()
  const cancellationDeadline = await effectiveCancellationDeadline(db, appId, row)
  const opensAt = row.registration_opens_at ? new Date(row.registration_opens_at).getTime() : Number.NEGATIVE_INFINITY
  const deadline = row.registration_deadline ? new Date(row.registration_deadline).getTime() : new Date(row.starts_at).getTime()
  const activeStatus = activeRegistrationStatuses.has(row.registration_status)
  const onlineUrl = registeredOnlineUrl(row)
  return {
    ...publicEventRow(row, previews.get(eventId) || []),
    description: row.description,
    contentMedia: contentMedia.map(item => ({
      imageUrl: item.cloud_file_id,
      caption: item.caption || '',
    })),
    notices: row.notices || undefined,
    address: row.address || undefined,
    latitude: row.latitude === null ? undefined : Number(row.latitude),
    longitude: row.longitude === null ? undefined : Number(row.longitude),
    onlineAccessAvailable: Boolean(onlineUrl),
    ...(onlineUrl ? { onlineUrl } : {}),
    registrationPolicy: row.registration_policy,
    registrationOpensAt: row.registration_opens_at ? iso(row.registration_opens_at) : undefined,
    registrationDeadline: row.registration_deadline ? iso(row.registration_deadline) : undefined,
    cancellationDeadline: iso(cancellationDeadline) || undefined,
    priceCents: Number(row.price_cents),
    currency: row.currency,
    formVersion: Number(row.form_version),
    registrationSchema: normalizeRegistrationSchema(parseJson(row.registration_schema_json, [])),
    changes: changes.map(change => ({
      version: Number(change.source_version),
      summary: change.summary,
      createdAt: iso(change.created_at),
    })),
    canRegister: row.status === 'PUBLISHED' && !activeStatus && timestamp >= opensAt && timestamp < deadline,
    canCancel: activeStatus && row.registration_status !== 'ATTENDED'
      && timestamp < cancellationDeadline.getTime(),
    canCheckIn: ['REGISTERED', 'ATTENDED'].includes(row.registration_status),
    canInteract: row.registration_status === 'ATTENDED',
    albumSubmissionPolicy: row.album_submission_policy,
    organizer: publicOrganizer(row, { appId, profileRefSecret }),
    invitationAttribution: publicInvitationAttribution(row),
  }
}

function eventCancellationHours(value) {
  const policy = parseJson(value, {})
  const hours = Number(policy.cancellationHoursBeforeStart)
  return Number.isInteger(hours) && hours >= 0 && hours <= 720 ? hours : 24
}

async function effectiveCancellationDeadline(adapter, appId, event) {
  if (event.cancellation_deadline) return new Date(event.cancellation_deadline)
  const setting = await adapter.one(
    `SELECT value_json FROM mip_app_settings
     WHERE app_id = ? AND setting_key = 'EVENT_REGISTRATION_POLICY'`,
    [appId],
  )
  const startsAt = new Date(event.starts_at)
  if (!Number.isFinite(startsAt.getTime())) throw new DomainError('INVALID_STATE', '活动时间无效')
  return new Date(startsAt.getTime() - eventCancellationHours(setting?.value_json) * 60 * 60 * 1000)
}

function publicOrganizer(row, { appId, profileRefSecret }) {
  if (!row.organizer_user_id || !row.organizer_nickname) {
    return undefined
  }
  const allowed = publicVisibility(row.organizer_visibility_json)
  return {
    profileRef: createProfileRef({ appId, userId: row.organizer_user_id }, profileRefSecret),
    ...(allowed.nickname ? { nickname: row.organizer_nickname } : {}),
    ...(allowed.avatar && row.organizer_avatar_file_id ? { avatarUrl: row.organizer_avatar_file_id } : {}),
    ...(allowed.headline && row.organizer_headline ? { headline: row.organizer_headline } : {}),
  }
}

async function listPublicParticipants(db, {
  appId,
  userId = null,
  eventId: rawEventId,
  query = {},
  profileRefSecret,
}) {
  const eventId = requiredUuid(rawEventId, '活动')
  const source = query && typeof query === 'object' && !Array.isArray(query) ? query : {}
  const keyword = typeof source.keyword === 'string' ? source.keyword.trim().slice(0, 80) : ''
  const userKind = source.userKind || null
  if (userKind && !['PLAYER', 'GUEST'].includes(userKind)) {
    throw new DomainError('VALIDATION_FAILED', '参与人列表参数无效')
  }
  const pageLimit = limitOf(source.limit || 24)
  const cursor = decodeParticipantCursor(source.cursor)
  const event = await db.one(
    `SELECT id FROM mip_events
     WHERE app_id = ? AND id = ?
       AND (status = 'PUBLISHED' OR (published_at IS NOT NULL AND status IN ('CANCELLED', 'ENDED')))
     LIMIT 1`,
    [appId, eventId],
  )
  if (!event) {
    throw new DomainError('NOT_FOUND', '活动不存在或已下架')
  }

  const blockFilter = mutualBlockFilter(userId, 'r.user_id', 'r.app_id')
  const membershipExists = `EXISTS(
    SELECT 1 FROM mip_membership_entitlements entitlement
    WHERE entitlement.app_id = r.app_id AND entitlement.user_id = r.user_id
      AND entitlement.status = 'ACTIVE'
      AND entitlement.starts_at <= UTC_TIMESTAMP(3)
      AND entitlement.ends_at > UTC_TIMESTAMP(3)
  )`
  const clauses = [
    'r.app_id = ?',
    'r.event_id = ?',
    'r.share_profile = 1',
    "r.status IN ('REGISTERED', 'ATTENDED')",
  ]
  const params = [appId, eventId]
  if (blockFilter.sql) {
    clauses.push(blockFilter.sql)
    params.push(...blockFilter.params)
  }
  if (keyword) {
    const pattern = likePattern(keyword)
    clauses.push(`(
      (
        COALESCE(JSON_UNQUOTE(JSON_EXTRACT(p.visibility_json, '$.nickname')), 'true') <> 'false'
        AND p.nickname LIKE ? ESCAPE '='
      ) OR (
        COALESCE(JSON_UNQUOTE(JSON_EXTRACT(p.visibility_json, '$.headline')), 'true') <> 'false'
        AND p.headline LIKE ? ESCAPE '='
      ) OR (
        COALESCE(JSON_UNQUOTE(JSON_EXTRACT(p.visibility_json, '$.introduction')), 'true') <> 'false'
        AND p.introduction LIKE ? ESCAPE '='
      ) OR (
        COALESCE(JSON_UNQUOTE(JSON_EXTRACT(p.visibility_json, '$.industry')), 'true') <> 'false'
        AND EXISTS (
          SELECT 1 FROM mip_profile_tags search_profile_tag
          INNER JOIN mip_tags search_tag
            ON search_tag.app_id = search_profile_tag.app_id
              AND search_tag.id = search_profile_tag.tag_id
              AND search_tag.kind = 'INDUSTRY'
              AND search_tag.enabled = 1
          WHERE search_profile_tag.app_id = r.app_id
            AND search_profile_tag.user_id = r.user_id
            AND search_profile_tag.relation = 'PRIMARY_INDUSTRY'
            AND search_tag.label LIKE ? ESCAPE '='
        )
      )
    )`)
    params.push(pattern, pattern, pattern, pattern)
  }
  if (userKind === 'PLAYER') {
    clauses.push(membershipExists)
  }
  else if (userKind === 'GUEST') {
    clauses.push(`NOT ${membershipExists}`)
  }
  if (cursor) {
    clauses.push('(r.registered_at < ? OR (r.registered_at = ? AND r.id < ?))')
    params.push(cursor.registeredAt, cursor.registeredAt, cursor.id)
  }
  const rows = await db.query(
    `SELECT r.id AS registration_id, r.registered_at, r.user_id,
            p.nickname, p.identity_status, p.headline, p.introduction, p.visibility_json,
            avatar.cloud_file_id AS avatar_file_id,
            branch.name AS branch_name, branch.city_name AS branch_city_name,
            (${membershipExists}) AS is_player,
            (
              SELECT industry_tag.label
              FROM mip_profile_tags industry_profile_tag
              INNER JOIN mip_tags industry_tag
                ON industry_tag.app_id = industry_profile_tag.app_id
                  AND industry_tag.id = industry_profile_tag.tag_id
                  AND industry_tag.kind = 'INDUSTRY'
                  AND industry_tag.enabled = 1
              WHERE industry_profile_tag.app_id = r.app_id
                AND industry_profile_tag.user_id = r.user_id
                AND industry_profile_tag.relation = 'PRIMARY_INDUSTRY'
              ORDER BY industry_tag.sort_order, industry_tag.id
              LIMIT 1
            ) AS primary_industry_label
     FROM mip_event_registrations r
     INNER JOIN mip_users u ON u.app_id = r.app_id AND u.id = r.user_id AND u.status = 'ACTIVE'
     INNER JOIN mip_profiles p ON p.app_id = r.app_id AND p.user_id = r.user_id
     LEFT JOIN mip_media_assets avatar
       ON avatar.app_id = p.app_id AND avatar.id = p.avatar_asset_id AND avatar.status = 'READY'
     LEFT JOIN mip_city_branches branch
       ON branch.app_id = u.app_id AND branch.id = u.primary_branch_id AND branch.status = 'ACTIVE'
     WHERE ${clauses.join(' AND ')}
     ORDER BY r.registered_at DESC, r.id DESC
     LIMIT ?`,
    [...params, pageLimit + 1],
  )
  const pageRows = rows.slice(0, pageLimit)
  return {
    items: pageRows.map((row) => {
      const allowed = publicVisibility(row.visibility_json)
      return {
        profileRef: createProfileRef({ appId, userId: row.user_id }, profileRefSecret),
        ...(allowed.nickname && row.nickname ? { nickname: row.nickname } : {}),
        ...(allowed.avatar && row.avatar_file_id ? { avatarUrl: row.avatar_file_id } : {}),
        userKind: Number(row.is_player) === 1 ? 'PLAYER' : 'GUEST',
        ...(allowed.identityStatus
          ? {
              ...(row.identity_status ? { identityStatus: row.identity_status } : {}),
            }
          : {}),
        ...(allowed.headline && row.headline ? { headline: row.headline } : {}),
        ...(allowed.introduction && row.introduction ? { introduction: row.introduction } : {}),
        ...(allowed.industry && row.primary_industry_label
          ? { primaryIndustry: { label: row.primary_industry_label } }
          : {}),
        ...(allowed.primaryBranch && row.branch_name
          ? { primaryBranch: { name: row.branch_name, cityName: row.branch_city_name || '' } }
          : {}),
      }
    }),
    nextCursor: rows.length > pageLimit && pageRows.length
      ? encodeParticipantCursor(pageRows[pageRows.length - 1])
      : undefined,
  }
}

function publicVisibility(value) {
  const source = parseJson(value, {})
  return {
    nickname: source.nickname !== false,
    avatar: source.avatar !== false,
    identityStatus: source.identityStatus !== false,
    headline: source.headline !== false,
    introduction: source.introduction !== false,
    industry: source.industry !== false,
    primaryBranch: source.primaryBranch !== false,
  }
}

async function listEventAlbum(db, {
  appId,
  userId = null,
  eventId,
  cursor,
  limit = 20,
}) {
  const normalizedEventId = requiredUuid(eventId, '活动')
  const event = await db.one(
    `SELECT id, album_enabled, album_submission_policy
     FROM mip_events
     WHERE app_id = ? AND id = ?
       AND (status = 'PUBLISHED' OR (published_at IS NOT NULL AND status IN ('ENDED', 'CANCELLED')))
     LIMIT 1`,
    [appId, normalizedEventId],
  )
  if (!event) throw new DomainError('NOT_FOUND', '活动不存在或未发布')
  if (Number(event.album_enabled) !== 1) {
    return {
      eventId: normalizedEventId,
      albumEnabled: false,
      submissionPolicy: event.album_submission_policy,
      items: [],
    }
  }

  const pageLimit = limitOf(limit)
  const decoded = decodeAlbumCursor(cursor)
  const clauses = [
    'photo.app_id = ?',
    'photo.event_id = ?',
    "photo.status = 'PUBLISHED'",
    "asset.status = 'READY'",
    "asset.purpose = 'EVENT_ALBUM'",
  ]
  const params = [appId, normalizedEventId]
  if (decoded) {
    clauses.push('(photo.created_at < ? OR (photo.created_at = ? AND photo.id < ?))')
    params.push(decoded.createdAt, decoded.createdAt, decoded.id)
  }
  const block = mutualBlockFilter(userId, 'photo.uploader_user_id', 'photo.app_id')
  if (block.sql) {
    clauses.push(block.sql)
    params.push(...block.params)
  }
  const rows = await db.query(
    `SELECT photo.id, photo.uploader_user_id, photo.caption, photo.status, photo.version,
       photo.created_at, asset.status AS asset_status, asset.cloud_file_id,
       profile.nickname, profile.visibility_json,
       avatar.cloud_file_id AS avatar_file_id
     FROM mip_event_album_photos photo
     LEFT JOIN mip_media_assets asset
       ON asset.app_id = photo.app_id AND asset.id = photo.media_asset_id
     LEFT JOIN mip_profiles profile
       ON profile.app_id = photo.app_id AND profile.user_id = photo.uploader_user_id
     LEFT JOIN mip_media_assets avatar
       ON avatar.app_id = profile.app_id AND avatar.id = profile.avatar_asset_id
       AND avatar.status = 'READY'
     WHERE ${clauses.join(' AND ')}
     ORDER BY photo.created_at DESC, photo.id DESC
     LIMIT ?`,
    [...params, pageLimit + 1],
  )
  const hasMore = rows.length > pageLimit
  const page = rows.slice(0, pageLimit)
  return {
    eventId: normalizedEventId,
    albumEnabled: true,
    submissionPolicy: event.album_submission_policy,
    items: page.map(row => albumPhotoRow(row, { mine: Boolean(userId) && row.uploader_user_id === userId })),
    nextCursor: hasMore ? encodeAlbumCursor(page[page.length - 1]) : undefined,
  }
}

async function listMyEventAlbumSubmissions(db, { appId, userId, eventId }) {
  const normalizedEventId = requiredUuid(eventId, '活动')
  const event = await db.one(
    `SELECT e.id, e.status, e.published_at, e.album_enabled, e.album_submission_policy,
       r.status AS registration_status
     FROM mip_events e
     LEFT JOIN mip_event_registrations r
       ON r.app_id = e.app_id AND r.event_id = e.id AND r.user_id = ?
     WHERE e.app_id = ? AND e.id = ? LIMIT 1`,
    [userId, appId, normalizedEventId],
  )
  if (!event) throw new DomainError('NOT_FOUND', '活动不存在')
  const rows = await db.query(
    `SELECT photo.id, photo.caption, photo.status, photo.version, photo.moderation_reason,
       photo.created_at, asset.status AS asset_status, asset.cloud_file_id,
       profile.nickname, profile.visibility_json,
       avatar.cloud_file_id AS avatar_file_id
     FROM mip_event_album_photos photo
     JOIN mip_media_assets asset
       ON asset.app_id = photo.app_id AND asset.id = photo.media_asset_id
     LEFT JOIN mip_profiles profile
       ON profile.app_id = photo.app_id AND profile.user_id = photo.uploader_user_id
     LEFT JOIN mip_media_assets avatar
       ON avatar.app_id = profile.app_id AND avatar.id = profile.avatar_asset_id
       AND avatar.status = 'READY'
     WHERE photo.app_id = ? AND photo.event_id = ? AND photo.uploader_user_id = ?
       AND photo.status IN ('PENDING', 'PUBLISHED', 'REJECTED')
       AND (
         photo.status = 'REJECTED'
         OR (asset.status = 'READY' AND asset.purpose = 'EVENT_ALBUM')
       )
     ORDER BY photo.created_at DESC, photo.id DESC LIMIT 50`,
    [appId, normalizedEventId, userId],
  )
  return {
    eventId: normalizedEventId,
    albumEnabled: Number(event.album_enabled) === 1,
    submissionPolicy: event.album_submission_policy,
    canSubmit: Number(event.album_enabled) === 1
      && (event.status === 'PUBLISHED' || (event.status === 'ENDED' && event.published_at))
      && ['REGISTERED', 'ATTENDED'].includes(event.registration_status),
    items: rows.map(row => albumPhotoRow(row, { mine: true })),
  }
}

function assertReadyAlbumAsset(asset) {
  if (!asset
    || asset.status !== 'READY'
    || asset.purpose !== 'EVENT_ALBUM'
    || !/^image\/(?:png|jpeg)$/.test(asset.content_type || '')
    || !/^[0-9a-f]{64}$/.test(asset.content_sha256 || '')
    || typeof asset.cloud_file_id !== 'string'
    || !asset.cloud_file_id.startsWith('cloud://')
    || typeof asset.object_key !== 'string'
    || !/^mip\/(?:development|test|staging|production)\//.test(asset.object_key)
    || asset.object_key.includes('..')
    || Number(asset.content_bytes) < 1
    || Number(asset.width_px) < 1
    || Number(asset.height_px) < 1) {
    throw new DomainError('EVENT_ALBUM_MEDIA_INVALID', '照片素材未完成安全检查')
  }
}

async function submitEventAlbumPhoto(db, {
  appId,
  userId,
  eventId,
  mediaAssetId,
  caption,
}) {
  const normalizedEventId = requiredUuid(eventId, '活动')
  const normalizedAssetId = requiredUuid(mediaAssetId, '素材')
  const normalizedCaption = typeof caption === 'string' ? caption.trim() : ''
  if (normalizedCaption.length > 300) {
    throw new DomainError('VALIDATION_FAILED', '照片说明不能超过 300 个字')
  }
  return db.transaction(async (tx) => {
    await requireActiveUserForMutation(tx, appId, userId)
    const event = await tx.one(
      `SELECT id, status, published_at, album_enabled, album_submission_policy
       FROM mip_events WHERE app_id = ? AND id = ? FOR UPDATE`,
      [appId, normalizedEventId],
    )
    if (!event) throw new DomainError('NOT_FOUND', '活动不存在')
    if (Number(event.album_enabled) !== 1
      || !(event.status === 'PUBLISHED' || (event.status === 'ENDED' && event.published_at))) {
      throw new DomainError('EVENT_ALBUM_DISABLED', '活动相册暂未开放')
    }
    const registration = await tx.one(
      `SELECT status FROM mip_event_registrations
       WHERE app_id = ? AND event_id = ? AND user_id = ? FOR UPDATE`,
      [appId, normalizedEventId, userId],
    )
    if (!registration || !['REGISTERED', 'ATTENDED'].includes(registration.status)) {
      throw new DomainError('EVENT_ALBUM_PARTICIPATION_REQUIRED', '只有已确认参与者可以提交照片')
    }
    const asset = await tx.one(
      `SELECT id, purpose, status, object_key, cloud_file_id,
         content_sha256, content_type, content_bytes, width_px, height_px
       FROM mip_media_assets
       WHERE app_id = ? AND id = ? AND owner_user_id = ? FOR UPDATE`,
      [appId, normalizedAssetId, userId],
    )
    assertReadyAlbumAsset(asset)
    const existing = await tx.one(
      `SELECT id, event_id, uploader_user_id, status, version
       FROM mip_event_album_photos
       WHERE app_id = ? AND media_asset_id = ? FOR UPDATE`,
      [appId, normalizedAssetId],
    )
    if (existing) {
      if (existing.event_id === normalizedEventId && existing.uploader_user_id === userId
        && existing.status !== 'WITHDRAWN') {
        return {
          id: existing.id,
          status: existing.status,
          version: Number(existing.version),
          idempotent: true,
        }
      }
      throw new DomainError('EVENT_ALBUM_MEDIA_INVALID', '照片素材已被使用')
    }

    const photoId = randomUUID()
    const status = event.album_submission_policy === 'AUTO' ? 'PUBLISHED' : 'PENDING'
    await tx.query(
      `INSERT INTO mip_event_album_photos (
        id, app_id, event_id, uploader_user_id, media_asset_id, caption, status, published_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [photoId, appId, normalizedEventId, userId, normalizedAssetId, normalizedCaption,
        status, status === 'PUBLISHED' ? new Date() : null],
    )
    await writeAudit(tx, {
      appId,
      actorUserId: userId,
      scopeId: normalizedEventId,
      action: 'event.album.photo.submit',
      resourceType: 'EVENT_ALBUM_PHOTO',
      resourceId: photoId,
      metadata: { status, submissionPolicy: event.album_submission_policy },
    })
    return { id: photoId, status, version: 1, idempotent: false }
  })
}

async function withdrawEventAlbumPhoto(db, {
  appId,
  userId,
  photoId,
  expectedVersion,
}) {
  const normalizedPhotoId = requiredUuid(photoId, '照片')
  const version = Number(expectedVersion)
  if (!Number.isInteger(version) || version < 1) {
    throw new DomainError('VALIDATION_FAILED', '照片版本无效')
  }
  return db.transaction(async (tx) => {
    await requireActiveUserForMutation(tx, appId, userId)
    const photo = await tx.one(
      `SELECT id, event_id, status, version FROM mip_event_album_photos
       WHERE app_id = ? AND id = ? AND uploader_user_id = ? FOR UPDATE`,
      [appId, normalizedPhotoId, userId],
    )
    if (!photo) throw new DomainError('NOT_FOUND', '照片不存在')
    if (Number(photo.version) !== version) {
      throw new DomainError('CONFLICT', '照片状态已变化，请刷新后重试', true)
    }
    if (!['PENDING', 'PUBLISHED', 'REJECTED'].includes(photo.status)) {
      throw new DomainError('INVALID_STATE', '照片当前不能撤回')
    }
    const updated = await tx.query(
      `UPDATE mip_event_album_photos
       SET status = 'WITHDRAWN', withdrawn_at = UTC_TIMESTAMP(3), version = version + 1
       WHERE app_id = ? AND id = ? AND uploader_user_id = ? AND version = ?
         AND status IN ('PENDING', 'PUBLISHED', 'REJECTED')`,
      [appId, normalizedPhotoId, userId, version],
    )
    if (Number(updated?.affectedRows) !== 1) {
      throw new DomainError('CONFLICT', '照片状态已变化，请刷新后重试', true)
    }
    await writeAudit(tx, {
      appId,
      actorUserId: userId,
      scopeId: photo.event_id,
      action: 'event.album.photo.withdraw',
      resourceType: 'EVENT_ALBUM_PHOTO',
      resourceId: normalizedPhotoId,
      metadata: { previousStatus: photo.status, expectedVersion: version },
    })
    return { id: normalizedPhotoId, status: 'WITHDRAWN', version: version + 1 }
  })
}

function registrationOutcome(row, extras = {}) {
  if (row.status === 'PAYMENT_PENDING') {
    return {
      kind: 'PAYMENT_REQUIRED',
      registrationId: row.id,
      status: row.status,
      orderId: row.order_id,
      amountCents: Number(row.amount_cents),
      currency: row.currency,
      holdExpiresAt: iso(row.hold_expires_at),
      paymentAvailable: extras.paymentAvailable === true,
    }
  }
  return {
    kind: row.status,
    registrationId: row.id,
    status: row.status,
    waitlistPosition: extras.waitlistPosition || undefined,
  }
}

const editableRegistrationStatuses = new Set(['PENDING_REVIEW', 'WAITLISTED', 'REGISTERED'])

function canEditRegistration(event, registrationStatus, now = new Date()) {
  if (!editableRegistrationStatuses.has(registrationStatus)) {
    return false
  }
  const timestamp = now instanceof Date ? now.getTime() : new Date(now).getTime()
  if (!Number.isFinite(timestamp)) {
    return false
  }
  if (registrationStatus === 'REGISTERED') {
    const deadline = new Date(event.registration_deadline || event.starts_at).getTime()
    return Number.isFinite(deadline) && timestamp < deadline
  }
  const startsAt = new Date(event.starts_at).getTime()
  return event.status === 'PUBLISHED' && Number.isFinite(startsAt) && timestamp < startsAt
}

function registrationEditView(event, registration, now = new Date()) {
  const parsedAnswers = parseJson(registration.answers_json, {})
  const answers = parsedAnswers && typeof parsedAnswers === 'object' && !Array.isArray(parsedAnswers)
    ? parsedAnswers
    : {}
  return {
    status: registration.status,
    version: Number(registration.version),
    formVersion: Number(registration.form_version),
    answers,
    shareProfile: Number(registration.share_profile) === 1,
    canEdit: canEditRegistration(event, registration.status, now),
  }
}

async function getMyRegistration(db, { appId, userId, eventId, now = new Date() }) {
  if (typeof eventId !== 'string' || !eventId) {
    throw new DomainError('VALIDATION_FAILED', '活动参数无效')
  }
  const row = await db.one(
    `SELECT r.status, r.version, r.form_version, r.answers_json, r.share_profile,
            e.status AS event_status, e.registration_deadline, e.starts_at
     FROM mip_event_registrations r
     INNER JOIN mip_events e ON e.app_id = r.app_id AND e.id = r.event_id
     WHERE r.app_id = ? AND r.event_id = ? AND r.user_id = ?
     LIMIT 1`,
    [appId, eventId, userId],
  )
  if (!row) {
    return null
  }
  return registrationEditView({
    status: row.event_status,
    registration_deadline: row.registration_deadline,
    starts_at: row.starts_at,
  }, row, now)
}

async function updateRegistration(db, {
  appId,
  userId,
  input,
  now = new Date(),
}) {
  const eventId = typeof input.eventId === 'string' ? input.eventId : ''
  const submittedAnswers = normalizeRegistrationAnswerPayload(input.answers)
  const formVersion = Number(input.formVersion)
  const expectedVersion = Number(input.expectedVersion)
  if (!eventId
    || !Number.isInteger(formVersion) || formVersion < 1
    || !Number.isInteger(expectedVersion) || expectedVersion < 1) {
    throw new DomainError('VALIDATION_FAILED', '报名信息无效')
  }
  return db.transaction(async (tx) => {
    await requireActiveUserForMutation(tx, appId, userId)
    const operation = 'event.updateRegistration'
    const claim = await idempotencyReplay(tx, {
      appId,
      userId,
      operation,
      key: input.idempotencyKey,
      request: {
        eventId,
        formVersion,
        expectedVersion,
        answers: submittedAnswers,
        shareProfile: input.shareProfile === true,
      },
    })
    if (claim.replay) {
      return claim.replay
    }
    const event = await tx.one(
      `SELECT id, status, starts_at, registration_deadline, registration_schema_json, form_version
       FROM mip_events WHERE app_id = ? AND id = ? FOR UPDATE`,
      [appId, eventId],
    )
    const registration = await tx.one(
      `SELECT id, status, version, form_version, answers_json, share_profile
       FROM mip_event_registrations
       WHERE app_id = ? AND event_id = ? AND user_id = ? FOR UPDATE`,
      [appId, eventId, userId],
    )
    if (!event || !registration) {
      throw new DomainError('NOT_FOUND', '报名记录不存在')
    }
    if (!canEditRegistration(event, registration.status, now)) {
      throw new DomainError('CONFLICT', '当前报名状态或时间不能修改')
    }
    if (Number(registration.version) !== expectedVersion) {
      throw new DomainError('CONFLICT', '报名信息已更新，请刷新后重试', true)
    }
    if (Number(event.form_version) !== formVersion) {
      throw new DomainError('CONFLICT', '报名表已更新，请刷新后重试', true)
    }
    const answers = normalizeRegistrationAnswers(event.registration_schema_json, submittedAnswers)
    const updated = await tx.query(
      `UPDATE mip_event_registrations SET
        answers_json = ?, share_profile = ?, form_version = ?, version = version + 1
       WHERE app_id = ? AND event_id = ? AND user_id = ? AND id = ? AND version = ?`,
      [
        JSON.stringify(answers),
        input.shareProfile === true ? 1 : 0,
        Number(event.form_version),
        appId,
        eventId,
        userId,
        registration.id,
        expectedVersion,
      ],
    )
    if (Number(updated?.affectedRows) !== 1) {
      throw new DomainError('CONFLICT', '报名信息已更新，请刷新后重试', true)
    }
    const result = registrationEditView(event, {
      ...registration,
      version: expectedVersion + 1,
      form_version: Number(event.form_version),
      answers_json: answers,
      share_profile: input.shareProfile === true ? 1 : 0,
    }, now)
    await writeAudit(tx, {
      appId,
      actorUserId: userId,
      scopeId: eventId,
      action: 'EVENT_REGISTRATION_UPDATED',
      resourceType: 'EVENT_REGISTRATION',
      resourceId: registration.id,
      metadata: {
        status: registration.status,
        fromVersion: expectedVersion,
        toVersion: expectedVersion + 1,
        formVersion: Number(event.form_version),
        shareProfile: input.shareProfile === true,
      },
    })
    await completeIdempotency(tx, claim, { appId, userId, operation, response: result })
    return result
  })
}

async function recordInvitationAttribution(tx, {
  appId,
  eventId,
  registrationId,
  userId,
  userKind,
  invitationToken,
  tokenSecret,
  now,
}) {
  if (userKind !== 'GUEST') {
    return
  }
  let inviterUserId = null
  if (invitationToken) {
    const payload = readSignedToken(invitationToken, tokenSecret, 'event-invitation', now)
    if (payload.eventId !== eventId || payload.inviterUserId === userId) {
      throw new DomainError('VALIDATION_FAILED', '活动邀请无效')
    }
    const inviter = await tx.one(
      `SELECT id FROM mip_users
       WHERE app_id = ? AND id = ? AND status = 'ACTIVE' FOR UPDATE`,
      [appId, payload.inviterUserId],
    )
    if (!inviter) {
      throw new DomainError('VALIDATION_FAILED', '活动邀请无效')
    }
    inviterUserId = inviter.id
  }
  await tx.query(
    `INSERT IGNORE INTO mip_event_invitation_attributions (
      app_id, registration_id, event_id, guest_user_id, source_type, inviter_user_id, captured_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [appId, registrationId, eventId, userId, inviterUserId ? 'USER' : 'PLATFORM', inviterUserId, now],
  )
}

async function createRegistration(db, {
  appId,
  userId,
  input,
  now = new Date(),
  tokenSecret,
  paymentAvailable = false,
  resolveUserKind = defaultResolveUserKind,
}) {
  const eventId = typeof input.eventId === 'string' ? input.eventId : ''
  const submittedAnswers = normalizeRegistrationAnswerPayload(input.answers)
  const formVersion = Number(input.formVersion)
  if (!eventId || !Number.isInteger(formVersion) || formVersion < 1) {
    throw new DomainError('VALIDATION_FAILED', '报名信息无效')
  }
  return db.transaction(async (tx) => {
    await requireActiveUserForMutation(tx, appId, userId)
    const claim = await idempotencyReplay(tx, {
      appId,
      userId,
      operation: 'event.register',
      key: input.idempotencyKey,
      request: { eventId, formVersion, answers: submittedAnswers, shareProfile: input.shareProfile === true },
    })
    if (claim.replay) {
      return claim.replay
    }
    const event = await tx.one(
      `SELECT * FROM mip_events WHERE app_id = ? AND id = ? FOR UPDATE`,
      [appId, eventId],
    )
    const existing = await tx.one(
      `SELECT r.*, o.amount_cents, o.currency, h.expires_at AS hold_expires_at
       FROM mip_event_registrations r
       LEFT JOIN mip_orders o ON o.app_id = r.app_id AND o.id = r.order_id AND o.order_type = 'EVENT'
       LEFT JOIN mip_event_seat_holds h ON h.app_id = o.app_id AND h.order_id = o.id
       WHERE r.app_id = ? AND r.event_id = ? AND r.user_id = ? FOR UPDATE`,
      [appId, eventId, userId],
    )
    if (existing && activeRegistrationStatuses.has(existing.status)) {
      const outcome = registrationOutcome(existing, { paymentAvailable })
      await completeIdempotency(tx, claim, { appId, userId, operation: 'event.register', response: outcome })
      return outcome
    }
    await requireParticipationAccess(tx, appId, userId)
    if (!event || Number(event.form_version) !== formVersion) {
      throw new DomainError(event ? 'CONFLICT' : 'NOT_FOUND', event ? '报名表已更新，请刷新后重试' : '活动不存在')
    }
    const answers = normalizeRegistrationAnswers(event.registration_schema_json, submittedAnswers)
    await tx.query(
      `UPDATE mip_event_seat_holds SET status = 'EXPIRED'
       WHERE app_id = ? AND event_id = ? AND status = 'ACTIVE' AND expires_at <= ?`,
      [appId, eventId, now],
    )
    const [capacity, holds] = await Promise.all([
      tx.one(
        `SELECT COUNT(*) AS total FROM mip_event_registrations
         WHERE app_id = ? AND event_id = ?
           AND status IN ('REGISTERED','CANCELLATION_PENDING','ATTENDED')`,
        [appId, eventId],
      ),
      tx.one(
        `SELECT COUNT(*) AS total FROM mip_event_seat_holds
         WHERE app_id = ? AND event_id = ? AND status = 'ACTIVE' AND expires_at > ?`,
        [appId, eventId, now],
      ),
    ])
    const userKind = await resolveUserKind(tx, appId, userId, now)
    const nextStatus = decideRegistration({
      event,
      userKind,
      capacityCount: Number(capacity?.total || 0),
      activeHoldCount: Number(holds?.total || 0),
      now,
    })
    const registrationId = existing?.id || randomUUID()
    let order = null
    if (nextStatus === 'PAYMENT_PENDING') {
      const holdId = randomUUID()
      const orderId = randomUUID()
      const holdExpiresAt = new Date(now.getTime() + 15 * 60 * 1000)
      await tx.query(
        `INSERT INTO mip_orders (
          id, app_id, user_id, order_type, resource_id, membership_plan_id,
          merchant_order_no, idempotency_key, amount_cents, currency, status,
          product_snapshot_json
        ) VALUES (?, ?, ?, 'EVENT', ?, NULL, ?, ?, ?, ?, 'CREATED', ?)`,
        [
          orderId,
          appId,
          userId,
          eventId,
          merchantOrderNumber(now),
          input.idempotencyKey.trim(),
          event.price_cents,
          event.currency,
          JSON.stringify({
            eventId,
            title: event.title,
            startsAt: iso(event.starts_at),
            priceCents: Number(event.price_cents),
            currency: event.currency,
            eventVersion: Number(event.version),
          }),
        ],
      )
      await tx.query(
        `INSERT INTO mip_event_seat_holds (
          id, app_id, event_id, user_id, order_id, status, expires_at
        ) VALUES (?, ?, ?, ?, ?, 'ACTIVE', ?)`,
        [holdId, appId, eventId, userId, orderId, holdExpiresAt],
      )
      order = {
        id: orderId,
        amount_cents: Number(event.price_cents),
        currency: event.currency,
        hold_expires_at: holdExpiresAt,
      }
    }
    const ticketHash = nextStatus === 'REGISTERED' ? sha256(randomBytes(24)) : null
    if (existing) {
      await tx.query(
        `UPDATE mip_event_registrations SET
          order_id = ?, status = ?, answers_json = ?, form_version = ?, share_profile = ?,
          ticket_hash = ?, waitlisted_at = ?, registered_at = ?, cancelled_at = NULL,
          cancellation_reason = NULL, cancelled_by_type = NULL, version = version + 1
         WHERE app_id = ? AND id = ?`,
        [
          order?.id || null,
          nextStatus,
          JSON.stringify(answers),
          formVersion,
          input.shareProfile === true ? 1 : 0,
          ticketHash,
          nextStatus === 'WAITLISTED' ? now : null,
          nextStatus === 'REGISTERED' ? now : null,
          appId,
          registrationId,
        ],
      )
    }
    else {
      await tx.query(
        `INSERT INTO mip_event_registrations (
          id, app_id, event_id, user_id, order_id, status, answers_json, form_version,
          share_profile, ticket_hash, waitlisted_at, registered_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          registrationId,
          appId,
          eventId,
          userId,
          order?.id || null,
          nextStatus,
          JSON.stringify(answers),
          formVersion,
          input.shareProfile === true ? 1 : 0,
          ticketHash,
          nextStatus === 'WAITLISTED' ? now : null,
          nextStatus === 'REGISTERED' ? now : null,
        ],
      )
    }
    await recordInvitationAttribution(tx, {
      appId,
      eventId,
      registrationId,
      userId,
      userKind,
      invitationToken: input.invitationToken,
      tokenSecret,
      now,
    })
    await writeAudit(tx, {
      appId,
      actorUserId: userId,
      scopeId: eventId,
      action: 'EVENT_REGISTRATION_SUBMITTED',
      resourceType: 'EVENT_REGISTRATION',
      resourceId: registrationId,
      metadata: { status: nextStatus, shareProfile: input.shareProfile === true },
    })
    await writeOutbox(tx, {
      appId,
      aggregateType: 'EVENT_REGISTRATION',
      aggregateId: registrationId,
      eventType: nextStatus === 'REGISTERED' ? 'event.registration_confirmed' : 'event.registration_submitted',
      sourceVersion: Number(existing?.version || 0) + 1,
      payload: { eventId, userId, status: nextStatus },
    })
    const row = {
      id: registrationId,
      status: nextStatus,
      order_id: order?.id,
      amount_cents: order?.amount_cents,
      currency: order?.currency,
      hold_expires_at: order?.hold_expires_at,
    }
    let waitlistPosition
    if (nextStatus === 'WAITLISTED') {
      const position = await tx.one(
        `SELECT COUNT(*) AS total FROM mip_event_registrations
         WHERE app_id = ? AND event_id = ? AND status = 'WAITLISTED'
           AND (waitlisted_at < ? OR (waitlisted_at = ? AND id <= ?))`,
        [appId, eventId, now, now, registrationId],
      )
      waitlistPosition = Number(position?.total || 0)
    }
    const outcome = registrationOutcome(row, { paymentAvailable, waitlistPosition })
    await completeIdempotency(tx, claim, { appId, userId, operation: 'event.register', response: outcome })
    return outcome
  })
}

async function listMyRegistrations(db, { appId, userId, cursor, limit = 20, now = new Date(), tokenSecret }) {
  const pageLimit = limitOf(limit)
  const decoded = decodeCursor(cursor)
  const params = [now, userId, appId, userId]
  let cursorClause = ''
  if (decoded) {
    cursorClause = 'AND (e.starts_at < ? OR (e.starts_at = ? AND e.id < ?))'
    params.push(decoded.startsAt, decoded.startsAt, decoded.id)
  }
  params.push(pageLimit + 1)
  const rows = await db.query(
    `SELECT e.*, b.name AS branch_name, a.cloud_file_id AS cover_file_id,
       r.id AS registration_id, r.status AS registration_status, r.order_id,
       r.updated_at AS registration_updated_at, c.checked_in_at,
       CASE WHEN e.status = 'PUBLISHED' AND e.ends_at < ? THEN 'ENDED' ELSE e.status END AS public_status,
       (SELECT COUNT(*) FROM mip_event_registrations rc
        WHERE rc.app_id = e.app_id AND rc.event_id = e.id
          AND rc.status IN ('REGISTERED','CANCELLATION_PENDING','ATTENDED')) AS registration_count
     FROM mip_event_registrations r
     JOIN mip_events e ON e.app_id = r.app_id AND e.id = r.event_id
     LEFT JOIN mip_city_branches b ON b.app_id = e.app_id AND b.id = e.branch_id
     LEFT JOIN mip_media_assets a ON a.app_id = e.app_id AND a.id = e.cover_asset_id AND a.status = 'READY'
     LEFT JOIN mip_event_checkins c ON c.app_id = r.app_id AND c.registration_id = r.id AND c.status = 'ACTIVE'
     WHERE r.user_id = ? AND r.app_id = ? AND r.user_id = ? ${cursorClause}
     ORDER BY e.starts_at DESC, e.id DESC LIMIT ?`,
    params,
  )
  const hasMore = rows.length > pageLimit
  const pageRows = rows.slice(0, pageLimit)
  const previews = await loadParticipantPreviews(db, {
    appId,
    eventIds: pageRows.map(row => row.id),
    tokenSecret,
    viewerUserId: userId,
  })
  return {
    items: pageRows.map(row => ({
      registrationId: row.registration_id,
      event: publicEventRow(row, previews.get(row.id) || []),
      status: row.registration_status,
      orderId: row.order_id || undefined,
      checkedInAt: row.checked_in_at ? iso(row.checked_in_at) : undefined,
      updatedAt: iso(row.registration_updated_at),
      canEdit: canEditRegistration(row, row.registration_status, now),
    })),
    nextCursor: hasMore ? encodeCursor(pageRows[pageRows.length - 1]) : undefined,
  }
}

async function promoteWaitlist(tx, { appId, eventId, now }) {
  const next = await tx.one(
    `SELECT id, user_id, version FROM mip_event_registrations
     WHERE app_id = ? AND event_id = ? AND status = 'WAITLISTED'
     ORDER BY waitlisted_at ASC, id ASC LIMIT 1 FOR UPDATE`,
    [appId, eventId],
  )
  if (!next) {
    return null
  }
  await tx.query(
    `UPDATE mip_event_registrations SET
      status = 'REGISTERED', ticket_hash = ?, registered_at = ?, waitlisted_at = NULL,
      version = version + 1
     WHERE app_id = ? AND id = ? AND version = ?`,
    [sha256(randomBytes(24)), now, appId, next.id, next.version],
  )
  await writeOutbox(tx, {
    appId,
    aggregateType: 'EVENT_REGISTRATION',
    aggregateId: next.id,
    eventType: 'event.registration_confirmed',
    sourceVersion: Number(next.version) + 1,
    payload: { eventId, userId: next.user_id, status: 'REGISTERED', promotedFromWaitlist: true },
  })
  return next.id
}

async function cancelRegistration(db, {
  appId,
  userId,
  eventId,
  expectedVersion,
  now = new Date(),
  paymentAvailable = false,
}) {
  return db.transaction(async (tx) => {
    await requireActiveUserForMutation(tx, appId, userId)
    const event = await tx.one(
      `SELECT id, access_type, starts_at, cancellation_deadline FROM mip_events
       WHERE app_id = ? AND id = ? FOR UPDATE`,
      [appId, eventId],
    )
    const registration = await tx.one(
      `SELECT r.*, o.status AS order_status, o.amount_cents, h.id AS seat_hold_id
       FROM mip_event_registrations r
       LEFT JOIN mip_orders o ON o.app_id = r.app_id AND o.id = r.order_id AND o.order_type = 'EVENT'
       LEFT JOIN mip_event_seat_holds h ON h.app_id = o.app_id AND h.order_id = o.id
       WHERE r.app_id = ? AND r.event_id = ? AND r.user_id = ? FOR UPDATE`,
      [appId, eventId, userId],
    )
    if (!event || !registration) {
      throw new DomainError('NOT_FOUND', '报名记录不存在')
    }
    const cancellationDeadline = await effectiveCancellationDeadline(tx, appId, event)
    if (registration.status === 'CANCELLED') {
      return { registrationId: registration.id, status: 'CANCELLED', refundRequired: false, paymentAvailable }
    }
    assertCanCancel(registration.status)
    if (now.getTime() >= cancellationDeadline.getTime()) {
      throw new DomainError('CONFLICT', '已超过可取消时间')
    }
    if (expectedVersion !== undefined && Number(expectedVersion) !== Number(registration.version)) {
      throw new DomainError('CONFLICT', '报名状态已变化，请刷新后重试', true)
    }
    const releasedCapacity = capacityStatuses.has(registration.status)
    const paidOrder = registration.order_id && registration.order_status === 'PAID'
    const nextStatus = paidOrder ? 'CANCELLATION_PENDING' : 'CANCELLED'
    const nextVersion = Number(registration.version) + 1
    await tx.query(
      `UPDATE mip_event_registrations SET status = ?, cancelled_at = ?,
       cancelled_by_type = 'USER', cancellation_reason = NULL, version = version + 1
       WHERE app_id = ? AND id = ? AND version = ?`,
      [nextStatus, now, appId, registration.id, registration.version],
    )
    let refundId
    if (registration.order_id) {
      if (paidOrder) {
        await tx.query(
          `UPDATE mip_orders SET status = 'REFUND_PENDING', version = version + 1
           WHERE app_id = ? AND id = ? AND status = 'PAID'`,
          [appId, registration.order_id],
        )
        refundId = await createEventRefund(tx, {
          appId,
          order: { id: registration.order_id, amount_cents: registration.amount_cents },
          registrationId: registration.id,
          requestedByUserId: userId,
          reason: '用户取消活动报名',
        })
      }
      else {
        await tx.query(
          `UPDATE mip_orders SET status = 'CLOSED', closed_at = ?, version = version + 1
           WHERE app_id = ? AND id = ? AND status IN ('CREATED','PAYMENT_CREATED')`,
          [now, appId, registration.order_id],
        )
        if (registration.seat_hold_id) {
          await tx.query(
            `UPDATE mip_event_seat_holds SET status = 'CANCELLED', cancelled_at = ?
             WHERE app_id = ? AND id = ? AND status = 'ACTIVE'`,
            [now, appId, registration.seat_hold_id],
          )
        }
      }
    }
    if (releasedCapacity && !paidOrder && event.access_type !== 'PAID') {
      await promoteWaitlist(tx, { appId, eventId, now })
    }
    await writeAudit(tx, {
      appId,
      actorUserId: userId,
      scopeId: eventId,
      action: paidOrder ? 'EVENT_REGISTRATION_REFUND_REQUESTED' : 'EVENT_REGISTRATION_CANCELLED',
      resourceType: 'EVENT_REGISTRATION',
      resourceId: registration.id,
      metadata: { from: registration.status, to: nextStatus },
    })
    await writeOutbox(tx, {
      appId,
      aggregateType: 'EVENT_REGISTRATION',
      aggregateId: registration.id,
      eventType: paidOrder ? 'event.registration_refund_requested' : 'event.registration_cancelled',
      sourceVersion: nextVersion,
      payload: { eventId, userId, status: nextStatus, orderId: registration.order_id || undefined },
    })
    return {
      registrationId: registration.id,
      status: nextStatus,
      refundRequired: paidOrder,
      refundId,
      paymentAvailable,
    }
  })
}

async function checkIn(db, { appId, userId, scanToken, idempotencyKey, expectedVersion, now = new Date() }) {
  const parsedToken = parseCheckInToken(scanToken)
  return db.transaction(async (tx) => {
    await requireActiveUserForMutation(tx, appId, userId)
    const claim = await idempotencyReplay(tx, {
      appId,
      userId,
      operation: 'event.checkin',
      key: idempotencyKey,
      request: { credentialRef: parsedToken.reference },
    })
    if (claim.replay) {
      return claim.replay
    }
    const lookup = checkInCredentialQuery(parsedToken, { lock: true })
    const credential = await tx.one(lookup.sql, [appId, ...lookup.params])
    if (!credential) {
      throw new DomainError('VALIDATION_FAILED', '活动码无效')
    }
    const event = await tx.one(
      `SELECT id FROM mip_events WHERE app_id = ? AND id = ? FOR UPDATE`,
      [appId, credential.event_id],
    )
    const registration = await tx.one(
      `SELECT * FROM mip_event_registrations
       WHERE app_id = ? AND event_id = ? AND user_id = ? FOR UPDATE`,
      [appId, credential.event_id, userId],
    )
    assertCheckInAllowed({ event, registration, credential, now })
    const existingCheckin = await tx.one(
      `SELECT id, status, checked_in_at, version FROM mip_event_checkins
       WHERE app_id = ? AND registration_id = ? FOR UPDATE`,
      [appId, registration.id],
    )
    if (registration.status === 'ATTENDED') {
      const outcome = {
        eventId: event.id,
        registrationId: registration.id,
        status: 'ATTENDED',
        checkedInAt: iso(existingCheckin?.checked_in_at || now),
        idempotent: true,
      }
      await completeIdempotency(tx, claim, { appId, userId, operation: 'event.checkin', response: outcome })
      return outcome
    }
    if (expectedVersion !== undefined && Number(expectedVersion) !== Number(registration.version)) {
      throw new DomainError('CONFLICT', '报名状态已变化，请刷新后重试', true)
    }
    const checkinId = existingCheckin?.id || randomUUID()
    const checkinVersion = existingCheckin ? Number(existingCheckin.version) + 1 : 1
    const registrationVersion = Number(registration.version) + 1
    const transitionId = randomUUID()
    const registrationUpdate = await tx.query(
      `UPDATE mip_event_registrations SET status = 'ATTENDED', version = version + 1
       WHERE app_id = ? AND id = ? AND version = ? AND status = 'REGISTERED'`,
      [appId, registration.id, registration.version],
    )
    if (Number(registrationUpdate.affectedRows) !== 1) {
      throw new DomainError('CONFLICT', '报名状态已变化，请刷新后重试', true)
    }
    if (existingCheckin) {
      const checkinUpdate = await tx.query(
        `UPDATE mip_event_checkins SET credential_id = ?, source = 'USER_SCAN', status = 'ACTIVE',
         checked_in_at = ?, revoked_at = NULL, revoked_by_user_id = NULL, revoke_reason = NULL,
         version = version + 1 WHERE app_id = ? AND id = ? AND version = ? AND status = 'REVOKED'`,
        [credential.id, now, appId, checkinId, existingCheckin.version],
      )
      if (Number(checkinUpdate.affectedRows) !== 1) {
        throw new DomainError('CONFLICT', '签到状态已变化，请刷新后重试', true)
      }
    }
    else {
      await tx.query(
        `INSERT INTO mip_event_checkins (
          id, app_id, event_id, registration_id, user_id, credential_id, source,
          status, checked_in_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'USER_SCAN', 'ACTIVE', ?)`,
        [checkinId, appId, event.id, registration.id, userId, credential.id, now],
      )
    }
    await writeCheckInTransition(tx, {
      id: transitionId,
      appId,
      checkinId,
      registrationId: registration.id,
      eventId: event.id,
      userId,
      transitionType: 'CHECKED_IN',
      checkinVersion,
      registrationVersion,
      actorUserId: userId,
      source: 'USER_SCAN',
      occurredAt: now,
    })
    await writeAudit(tx, {
      appId,
      actorUserId: userId,
      scopeId: event.id,
      action: 'EVENT_CHECKED_IN',
      resourceType: 'EVENT_CHECKIN',
      resourceId: checkinId,
      metadata: { source: 'USER_SCAN', credentialMode: credential.mode },
    })
    await writeOutbox(tx, {
      id: transitionId,
      appId,
      aggregateType: 'EVENT_CHECKIN_TRANSITION',
      aggregateId: transitionId,
      eventType: 'event.checked_in',
      sourceVersion: registrationVersion,
      payload: { eventId: event.id, registrationId: registration.id, userId, checkinId },
    })
    const outcome = {
      eventId: event.id,
      registrationId: registration.id,
      status: 'ATTENDED',
      checkedInAt: iso(now),
      idempotent: false,
    }
    await completeIdempotency(tx, claim, { appId, userId, operation: 'event.checkin', response: outcome })
    return outcome
  })
}

async function resolveCheckInScene(db, { appId, scene, now = new Date() }) {
  const parsedToken = parseCheckInToken(scene)
  const lookup = checkInCredentialQuery(parsedToken)
  const credential = await db.one(
    `${lookup.sql} AND status = 'ACTIVE' AND valid_from <= ? AND valid_until >= ?`,
    [appId, ...lookup.params, now, now],
  )
  if (!credential) {
    throw new DomainError('VALIDATION_FAILED', '活动码无效或已失效')
  }
  const event = await db.one(
    `SELECT id FROM mip_events WHERE app_id = ? AND id = ? AND status = 'PUBLISHED'`,
    [appId, credential.event_id],
  )
  if (!event) {
    throw new DomainError('NOT_FOUND', '活动不存在或已下架')
  }
  return {
    eventId: event.id,
    scanToken: parsedToken.token,
    validFrom: iso(credential.valid_from),
    validUntil: iso(credential.valid_until),
  }
}

async function issueInvitationLink(db, { appId, eventId, userId, now = new Date() }) {
  return db.transaction(async (tx) => {
    await requireActiveUserForMutation(tx, appId, userId)
    const event = await tx.one(
      `SELECT id FROM mip_events WHERE app_id = ? AND id = ? AND status = 'PUBLISHED' FOR UPDATE`,
      [appId, eventId],
    )
    if (!event) {
      throw new DomainError('NOT_FOUND', '活动不存在或已下架')
    }
    const invitationId = randomUUID()
    const sceneKey = randomBytes(8).toString('base64url')
    const secret = randomBytes(8).toString('base64url')
    const validUntil = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)
    await tx.query(
      `INSERT INTO mip_event_invitation_links (
        id, app_id, event_id, inviter_user_id, scene_key, token_hash, status, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE', ?)`,
      [invitationId, appId, eventId, userId, sceneKey, sha256(secret), validUntil],
    )
    await writeAudit(tx, {
      appId,
      actorUserId: userId,
      scopeId: eventId,
      action: 'EVENT_INVITATION_CODE_CREATED',
      resourceType: 'EVENT_INVITATION_LINK',
      resourceId: invitationId,
      metadata: { validUntil: iso(validUntil) },
    })
    return {
      invitationId,
      eventId,
      scene: `i1.${sceneKey}.${secret}`,
      validUntil: iso(validUntil),
    }
  })
}

async function attachInvitationCodeAsset(db, { appId, invitationId, userId, assetId, now = new Date() }) {
  return db.transaction(async (tx) => {
    const invitation = await tx.one(
      `SELECT id, code_asset_id, status, expires_at FROM mip_event_invitation_links
       WHERE app_id = ? AND id = ? AND inviter_user_id = ? FOR UPDATE`,
      [appId, invitationId, userId],
    )
    if (!invitation || invitation.status !== 'ACTIVE' || new Date(invitation.expires_at) <= now) {
      throw new DomainError('CONFLICT', '活动分享码已失效，请重新生成', true)
    }
    if (invitation.code_asset_id && invitation.code_asset_id !== assetId) {
      throw new DomainError('CONFLICT', '活动分享码已更新，请重新生成', true)
    }
    if (!invitation.code_asset_id) {
      const result = await tx.query(
        `UPDATE mip_event_invitation_links SET code_asset_id = ?
         WHERE app_id = ? AND id = ? AND inviter_user_id = ? AND code_asset_id IS NULL
           AND status = 'ACTIVE' AND expires_at > ?`,
        [assetId, appId, invitationId, userId, now],
      )
      if (Number(result?.affectedRows) !== 1) {
        throw new DomainError('CONFLICT', '活动分享码已变化，请重新生成', true)
      }
    }
    return { invitationId, assetId }
  })
}

async function resolveInvitationScene(db, {
  appId,
  scene,
  tokenSecret,
  now = new Date(),
}) {
  const parsed = parseInvitationScene(scene)
  const invitation = await db.one(
    `SELECT link.event_id, link.inviter_user_id, link.expires_at
     FROM mip_event_invitation_links link
     JOIN mip_events event ON event.app_id = link.app_id AND event.id = link.event_id
     WHERE link.app_id = ? AND link.scene_key = ? AND link.token_hash = ?
       AND link.status = 'ACTIVE' AND link.expires_at > ? AND event.status = 'PUBLISHED'`,
    [appId, parsed.reference, sha256(parsed.secret), now],
  )
  if (!invitation) {
    throw new DomainError('VALIDATION_FAILED', '活动邀请无效或已失效')
  }
  const validUntil = iso(invitation.expires_at)
  return {
    eventId: invitation.event_id,
    invitationToken: createSignedToken({
      type: 'event-invitation',
      eventId: invitation.event_id,
      inviterUserId: invitation.inviter_user_id,
      expiresAt: validUntil,
    }, tokenSecret),
    validUntil,
  }
}

function heartParticipant(row, { eventId, tokenSecret }) {
  return {
    participantRef: createSignedToken({
      type: 'heart-target',
      eventId,
      registrationId: row.registration_id,
      expiresAt: iso(new Date(Date.now() + 90 * 24 * 60 * 60 * 1000)),
    }, tokenSecret),
    nickname: row.nickname,
    avatarUrl: row.avatar_file_id || undefined,
    headline: row.headline || undefined,
    selected: false,
  }
}

async function requireAttendedRegistration(db, { appId, eventId, userId, lock = false }) {
  const registration = await db.one(
    `SELECT id, event_id, user_id, status, version FROM mip_event_registrations
     WHERE app_id = ? AND event_id = ? AND user_id = ? ${lock ? 'FOR UPDATE' : ''}`,
    [appId, eventId, userId],
  )
  if (!registration || registration.status !== 'ATTENDED') {
    throw new DomainError('FORBIDDEN', '完成签到后可以使用本场互动')
  }
  return registration
}

async function listHeartCandidates(db, { appId, eventId, userId, tokenSecret }) {
  await requireAttendedRegistration(db, { appId, eventId, userId })
  const blockFilter = mutualBlockFilter(userId, 'r.user_id', 'r.app_id')
  const [rows, selected] = await Promise.all([
    db.query(
      `SELECT r.id AS registration_id, p.nickname, p.headline,
         a.cloud_file_id AS avatar_file_id
       FROM mip_event_registrations r
       JOIN mip_profiles p ON p.app_id = r.app_id AND p.user_id = r.user_id
       LEFT JOIN mip_media_assets a ON a.app_id = p.app_id AND a.id = p.avatar_asset_id AND a.status = 'READY'
       WHERE r.app_id = ? AND r.event_id = ? AND r.status = 'ATTENDED' AND r.user_id <> ?
         AND ${blockFilter.sql}
       ORDER BY r.registered_at DESC, r.id DESC`,
      [appId, eventId, userId, ...blockFilter.params],
    ),
    db.one(
      `SELECT tr.id AS registration_id
       FROM mip_event_hearts h
       JOIN mip_event_registrations tr
         ON tr.app_id = h.app_id AND tr.event_id = h.event_id AND tr.user_id = h.target_user_id
       WHERE h.app_id = ? AND h.event_id = ? AND h.voter_user_id = ? AND h.status = 'ACTIVE'`,
      [appId, eventId, userId],
    ),
  ])
  return rows.map((row) => ({
    ...heartParticipant(row, { eventId, tokenSecret }),
    selected: row.registration_id === selected?.registration_id,
  }))
}

async function getHeart(db, { appId, eventId, userId, tokenSecret }) {
  await requireAttendedRegistration(db, { appId, eventId, userId })
  const targetBlock = mutualBlockFilter(userId, 'h.target_user_id', 'h.app_id')
  const voterBlock = mutualBlockFilter(userId, 'h.voter_user_id', 'h.app_id')
  const [heart, received] = await Promise.all([
    db.one(
      `SELECT h.version, h.updated_at, tr.id AS registration_id,
         p.nickname, p.headline, a.cloud_file_id AS avatar_file_id
       FROM mip_event_hearts h
       LEFT JOIN mip_event_registrations tr
         ON tr.app_id = h.app_id AND tr.event_id = h.event_id AND tr.user_id = h.target_user_id
         AND ${targetBlock.sql}
       LEFT JOIN mip_profiles p ON p.app_id = tr.app_id AND p.user_id = tr.user_id
       LEFT JOIN mip_media_assets a ON a.app_id = p.app_id AND a.id = p.avatar_asset_id AND a.status = 'READY'
       WHERE h.app_id = ? AND h.event_id = ? AND h.voter_user_id = ?`,
      [...targetBlock.params, appId, eventId, userId],
    ),
    db.query(
      `SELECT vr.id AS registration_id, p.nickname, p.headline,
         a.cloud_file_id AS avatar_file_id
       FROM mip_event_hearts h
       JOIN mip_event_registrations vr
         ON vr.app_id = h.app_id AND vr.event_id = h.event_id AND vr.user_id = h.voter_user_id
       JOIN mip_profiles p ON p.app_id = vr.app_id AND p.user_id = vr.user_id
       LEFT JOIN mip_media_assets a ON a.app_id = p.app_id AND a.id = p.avatar_asset_id AND a.status = 'READY'
       WHERE h.app_id = ? AND h.event_id = ? AND h.target_user_id = ? AND h.status = 'ACTIVE'
         AND ${voterBlock.sql}
       ORDER BY h.updated_at DESC, h.id DESC`,
      [appId, eventId, userId, ...voterBlock.params],
    ),
  ])
  const target = heart?.registration_id
    ? heartParticipant(heart, { eventId, tokenSecret })
    : undefined
  return {
    targetRef: target?.participantRef,
    target,
    received: received.map(row => heartParticipant(row, { eventId, tokenSecret })),
    version: Number(heart?.version || 0),
    updatedAt: heart?.updated_at ? iso(heart.updated_at) : undefined,
  }
}

async function listHeartHistory(db, {
  appId,
  userId,
  kind = 'SENT',
  cursor,
  limit = 20,
  profileRefSecret,
}) {
  if (!['SENT', 'RECEIVED'].includes(kind)) {
    throw new DomainError('VALIDATION_FAILED', '心动记录类型无效')
  }
  const pageLimit = limitOf(limit)
  const decoded = decodeHeartCursor(cursor)
  const personSql = kind === 'SENT' ? 'h.target_user_id' : 'h.voter_user_id'
  const ownerSql = kind === 'SENT' ? 'h.voter_user_id' : 'h.target_user_id'
  const blockFilter = mutualBlockFilter(userId, personSql, 'h.app_id')
  const cursorClause = decoded
    ? 'AND (h.updated_at < ? OR (h.updated_at = ? AND h.id < ?))'
    : ''
  const params = [appId, userId, ...blockFilter.params]
  if (decoded) {
    params.push(decoded.updatedAt, decoded.updatedAt, decoded.id)
  }
  params.push(pageLimit + 1)
  const rows = await db.query(
    `SELECT h.id, h.updated_at, e.id AS event_id, e.title AS event_title,
       e.starts_at, e.ends_at, p.user_id AS person_user_id, p.nickname, p.headline,
       a.cloud_file_id AS avatar_file_id
     FROM mip_event_hearts h
     JOIN mip_events e ON e.app_id = h.app_id AND e.id = h.event_id
     JOIN mip_profiles p ON p.app_id = h.app_id AND p.user_id = ${personSql}
     LEFT JOIN mip_media_assets a
       ON a.app_id = p.app_id AND a.id = p.avatar_asset_id AND a.status = 'READY'
     WHERE h.app_id = ? AND ${ownerSql} = ? AND h.status = 'ACTIVE'
       AND ${blockFilter.sql} ${cursorClause}
     ORDER BY h.updated_at DESC, h.id DESC LIMIT ?`,
    params,
  )
  const hasMore = rows.length > pageLimit
  const pageRows = rows.slice(0, pageLimit)
  return {
    kind,
    items: pageRows.map(row => ({
      event: {
        id: row.event_id,
        title: row.event_title,
        startsAt: iso(row.starts_at),
        endsAt: iso(row.ends_at),
      },
      person: {
        profileRef: createProfileRef({ appId, userId: row.person_user_id }, profileRefSecret),
        nickname: row.nickname || 'MIP 用户',
        avatarUrl: row.avatar_file_id || undefined,
        headline: row.headline || undefined,
      },
      updatedAt: iso(row.updated_at),
    })),
    nextCursor: hasMore && pageRows.length
      ? encodeHeartCursor(pageRows[pageRows.length - 1])
      : undefined,
  }
}

async function setHeart(db, { appId, eventId, userId, targetRef, expectedVersion, tokenSecret, now = new Date() }) {
  return db.transaction(async (tx) => {
    await requireActiveUserForMutation(tx, appId, userId)
    await requireAttendedRegistration(tx, { appId, eventId, userId, lock: true })
    let target = null
    if (targetRef) {
      const payload = readSignedToken(targetRef, tokenSecret, 'heart-target', now)
      if (payload.eventId !== eventId) {
        throw new DomainError('VALIDATION_FAILED', '心动对象无效')
      }
      const blockFilter = mutualBlockFilter(userId, 'r.user_id', 'r.app_id')
      target = await tx.one(
        `SELECT r.id, r.user_id FROM mip_event_registrations r
         WHERE r.app_id = ? AND r.event_id = ? AND r.id = ? AND r.status = 'ATTENDED'
           AND ${blockFilter.sql} FOR UPDATE`,
        [appId, eventId, payload.registrationId, ...blockFilter.params],
      )
      if (!target) {
        throw new DomainError('NOT_FOUND', '参与人不存在或当前不可见')
      }
      if (target.user_id === userId) {
        throw new DomainError('VALIDATION_FAILED', '不能选择自己')
      }
    }
    const existing = await tx.one(
      `SELECT id, target_user_id, status, version FROM mip_event_hearts
       WHERE app_id = ? AND event_id = ? AND voter_user_id = ? FOR UPDATE`,
      [appId, eventId, userId],
    )
    if (expectedVersion !== undefined && Number(expectedVersion) !== Number(existing?.version || 0)) {
      throw new DomainError('CONFLICT', '心动状态已变化，请刷新后重试', true)
    }
    const nextVersion = Number(existing?.version || 0) + 1
    const heartId = existing?.id || randomUUID()
    if (existing) {
      await tx.query(
        `UPDATE mip_event_hearts SET target_user_id = ?, status = ?, cancelled_at = ?, version = version + 1
         WHERE app_id = ? AND id = ? AND version = ?`,
        [target?.user_id || null, target ? 'ACTIVE' : 'CANCELLED', target ? null : now, appId, existing.id, existing.version],
      )
    }
    else if (target) {
      await tx.query(
        `INSERT INTO mip_event_hearts (
          id, app_id, event_id, voter_user_id, target_user_id, status
        ) VALUES (?, ?, ?, ?, ?, 'ACTIVE')`,
        [heartId, appId, eventId, userId, target.user_id],
      )
    }
    else {
      return null
    }
    await writeAudit(tx, {
      appId,
      actorUserId: userId,
      scopeId: eventId,
      action: target ? 'EVENT_HEART_SET' : 'EVENT_HEART_CANCELLED',
      resourceType: 'EVENT_HEART',
      resourceId: heartId,
      metadata: { active: Boolean(target) },
    })
    await writeOutbox(tx, {
      appId,
      aggregateType: 'EVENT_HEART',
      aggregateId: heartId,
      eventType: 'event.heart_changed',
      sourceVersion: nextVersion,
      payload: { eventId, voterUserId: userId, targetUserId: target?.user_id || null, active: Boolean(target) },
    })
    return null
  }).then(async result => result || getHeart(db, { appId, eventId, userId, tokenSecret }))
}

async function getFeedback(db, { appId, eventId, userId }) {
  await requireAttendedRegistration(db, { appId, eventId, userId })
  const feedback = await db.one(
    `SELECT id, rating, body, version, submitted_at, updated_at
     FROM mip_event_feedback WHERE app_id = ? AND event_id = ? AND user_id = ?`,
    [appId, eventId, userId],
  )
  return feedback
    ? {
        id: feedback.id,
        rating: feedback.rating === null ? undefined : Number(feedback.rating),
        body: feedback.body,
        version: Number(feedback.version),
        submittedAt: iso(feedback.submitted_at),
        updatedAt: iso(feedback.updated_at),
      }
    : null
}

async function saveFeedback(db, { appId, eventId, userId, draft, now = new Date() }) {
  const normalized = validateFeedback(draft || {})
  return db.transaction(async (tx) => {
    await requireActiveUserForMutation(tx, appId, userId)
    await requireAttendedRegistration(tx, { appId, eventId, userId, lock: true })
    const existing = await tx.one(
      `SELECT id, version, submitted_at FROM mip_event_feedback
       WHERE app_id = ? AND event_id = ? AND user_id = ? FOR UPDATE`,
      [appId, eventId, userId],
    )
    if (draft?.version !== undefined && Number(draft.version) !== Number(existing?.version || 0)) {
      throw new DomainError('CONFLICT', '反馈已变化，请刷新后重试', true)
    }
    const feedbackId = existing?.id || randomUUID()
    const nextVersion = Number(existing?.version || 0) + 1
    if (existing) {
      await tx.query(
        `UPDATE mip_event_feedback SET rating = ?, body = ?, version = version + 1
         WHERE app_id = ? AND id = ? AND version = ?`,
        [normalized.rating, normalized.body, appId, feedbackId, existing.version],
      )
    }
    else {
      await tx.query(
        `INSERT INTO mip_event_feedback (
          id, app_id, event_id, user_id, rating, body, version, submitted_at
        ) VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
        [feedbackId, appId, eventId, userId, normalized.rating, normalized.body, now],
      )
    }
    await writeAudit(tx, {
      appId,
      actorUserId: userId,
      scopeId: eventId,
      action: existing ? 'EVENT_FEEDBACK_UPDATED' : 'EVENT_FEEDBACK_SUBMITTED',
      resourceType: 'EVENT_FEEDBACK',
      resourceId: feedbackId,
      metadata: { ratingProvided: normalized.rating !== null, bodyLength: normalized.body.length },
    })
    await writeOutbox(tx, {
      appId,
      aggregateType: 'EVENT_FEEDBACK',
      aggregateId: feedbackId,
      eventType: 'event.feedback_submitted',
      sourceVersion: nextVersion,
      payload: { eventId, userId, updated: Boolean(existing) },
    })
    return {
      id: feedbackId,
      rating: normalized.rating === null ? undefined : normalized.rating,
      body: normalized.body,
      version: nextVersion,
      submittedAt: iso(existing?.submitted_at || now),
      updatedAt: iso(now),
    }
  })
}

async function createInvitation(db, { appId, eventId, userId, tokenSecret, now = new Date() }) {
  return db.transaction(async (tx) => {
    await requireActiveUserForMutation(tx, appId, userId)
    const event = await tx.one(
      `SELECT id FROM mip_events WHERE app_id = ? AND id = ? AND status = 'PUBLISHED'`,
      [appId, eventId],
    )
    if (!event) {
      throw new DomainError('NOT_FOUND', '活动不存在或已下架')
    }
    return {
      token: createSignedToken({
        type: 'event-invitation',
        eventId,
        inviterUserId: userId,
        expiresAt: iso(new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)),
      }, tokenSecret),
    }
  })
}

async function loadActiveBindings(db, { appId, userId }) {
  return db.query(
    `SELECT scope_type, scope_id, role_key FROM mip_admin_role_bindings
     WHERE app_id = ? AND user_id = ? AND status = 'ACTIVE'`,
    [appId, userId],
  )
}

async function requireEventCapability(db, { appId, userId, event, capability }) {
  const bindings = await loadActiveBindings(db, { appId, userId })
  if (!grantsCapability(bindings, capability, event)) {
    throw new DomainError('FORBIDDEN', '当前没有操作权限')
  }
  return bindings.find(binding => grantsCapability([binding], capability, event))?.role_key || null
}

function normalizedEventDraft(input) {
  const title = typeof input.title === 'string' ? input.title.trim() : ''
  const summary = typeof input.summary === 'string' ? input.summary.trim() : ''
  const description = typeof input.description === 'string' ? input.description.trim() : ''
  const startsAt = new Date(input.startsAt)
  const endsAt = new Date(input.endsAt)
  const scopeType = input.scopeType === 'BRANCH' ? 'BRANCH' : 'PLATFORM'
  const accessType = ['FREE', 'MEMBER_INCLUDED', 'PAID'].includes(input.accessType) ? input.accessType : 'FREE'
  const registrationPolicy = input.registrationPolicy === 'APPROVAL' ? 'APPROVAL' : 'AUTO'
  const mode = ['OFFLINE', 'ONLINE', 'HYBRID'].includes(input.mode) ? input.mode : 'OFFLINE'
  const priceCents = Number(input.priceCents || 0)
  if (!title || title.length > 120 || !summary || summary.length > 300 || !description) {
    throw new DomainError('VALIDATION_FAILED', '请完整填写活动标题、摘要和介绍')
  }
  if (!Number.isFinite(startsAt.getTime()) || !Number.isFinite(endsAt.getTime()) || endsAt <= startsAt) {
    throw new DomainError('VALIDATION_FAILED', '活动时间无效')
  }
  if ((scopeType === 'BRANCH') !== Boolean(input.branchId)) {
    throw new DomainError('VALIDATION_FAILED', '活动范围与城市分会不一致')
  }
  if (accessType === 'PAID'
    && (!Number.isInteger(priceCents) || priceCents < 1 || registrationPolicy !== 'AUTO' || input.waitlistEnabled === true)) {
    throw new DomainError('VALIDATION_FAILED', '付费活动必须自动确认且不开放候补')
  }
  if (accessType !== 'PAID' && priceCents !== 0) {
    throw new DomainError('VALIDATION_FAILED', '免费或玩家活动不能设置独立价格')
  }
  const onlineUrl = typeof input.onlineUrl === 'string' ? input.onlineUrl.trim() : ''
  const venueName = typeof input.venueName === 'string' ? input.venueName.trim() : ''
  if ((mode === 'ONLINE' || mode === 'HYBRID') && !onlineUrl.startsWith('https://')) {
    throw new DomainError('VALIDATION_FAILED', '线上活动需填写 HTTPS 参与链接')
  }
  if ((mode === 'OFFLINE' || mode === 'HYBRID') && !venueName) {
    throw new DomainError('VALIDATION_FAILED', '线下活动需填写活动地点')
  }
  const registrationDeadline = input.registrationDeadline ? new Date(input.registrationDeadline) : null
  const cancellationDeadline = input.cancellationDeadline ? new Date(input.cancellationDeadline) : null
  if ((registrationDeadline && (!Number.isFinite(registrationDeadline.getTime()) || registrationDeadline > startsAt))
    || (cancellationDeadline && (!Number.isFinite(cancellationDeadline.getTime()) || cancellationDeadline > startsAt))) {
    throw new DomainError('VALIDATION_FAILED', '报名或取消截止时间无效')
  }
  const capacity = input.capacity === null || input.capacity === undefined || input.capacity === ''
    ? null
    : Number(input.capacity)
  if (capacity !== null && (!Number.isInteger(capacity) || capacity < 1)) {
    throw new DomainError('VALIDATION_FAILED', '活动人数上限无效')
  }
  return {
    scopeType,
    branchId: input.branchId || null,
    title,
    summary,
    description,
    notices: typeof input.notices === 'string' ? input.notices.trim() || null : null,
    coverAssetId: input.coverAssetId || null,
    eventTypeKey: typeof input.eventTypeKey === 'string' && input.eventTypeKey.trim()
      ? input.eventTypeKey.trim().slice(0, 64)
      : 'community',
    mode,
    accessType,
    registrationPolicy,
    startsAt,
    endsAt,
    registrationOpensAt: input.registrationOpensAt ? new Date(input.registrationOpensAt) : null,
    registrationDeadline,
    cancellationDeadline,
    venueName: venueName || null,
    address: typeof input.address === 'string' ? input.address.trim() || null : null,
    cityName: typeof input.cityName === 'string' ? input.cityName.trim() || null : null,
    latitude: input.latitude ?? null,
    longitude: input.longitude ?? null,
    onlineUrl: onlineUrl || null,
    capacity,
    waitlistEnabled: input.waitlistEnabled === true ? 1 : 0,
    priceCents,
    registrationSchema: normalizeRegistrationSchema(input.registrationSchema || []),
  }
}

async function adminSaveEvent(db, {
  appId,
  userId,
  eventId,
  expectedVersion,
  draft,
  contentSafetyStatus,
  now = new Date(),
}) {
  const normalized = normalizedEventDraft(draft || {})
  return db.transaction(async (tx) => {
    const existing = eventId
      ? await tx.one(`SELECT * FROM mip_events WHERE app_id = ? AND id = ? FOR UPDATE`, [appId, eventId])
      : null
    if (eventId && !existing) {
      throw new DomainError('NOT_FOUND', '活动不存在')
    }
    const capabilityEvent = existing || { id: eventId || randomUUID(), branch_id: normalized.branchId }
    const role = await requireEventCapability(tx, {
      appId,
      userId,
      event: capabilityEvent,
      capability: 'events.manage',
    })
    if (existing && Number(expectedVersion) !== Number(existing.version)) {
      throw new DomainError('CONFLICT', '活动已被修改，请刷新后重试', true)
    }
    const id = existing?.id || capabilityEvent.id
    const nextVersion = Number(existing?.version || 0) + 1
    const nextStatus = existing?.status === 'PUBLISHED' && contentSafetyStatus !== 'PASSED'
      ? 'UNPUBLISHED'
      : existing?.status || 'DRAFT'
    if (existing) {
      await tx.query(
        `UPDATE mip_events SET
          scope_type = ?, branch_id = ?, title = ?, summary = ?, description = ?, notices = ?,
          cover_asset_id = ?, event_type_key = ?, event_mode = ?, access_type = ?,
          registration_policy = ?, status = ?, content_safety_status = ?, starts_at = ?, ends_at = ?,
          registration_opens_at = ?, registration_deadline = ?, cancellation_deadline = ?,
          venue_name = ?, address = ?, city_name = ?, latitude = ?, longitude = ?, online_url = ?,
          capacity = ?, waitlist_enabled = ?, price_cents = ?, registration_schema_json = ?,
          form_version = form_version + 1, version = version + 1
         WHERE app_id = ? AND id = ? AND version = ?`,
        [
          normalized.scopeType, normalized.branchId, normalized.title, normalized.summary,
          normalized.description, normalized.notices, normalized.coverAssetId, normalized.eventTypeKey,
          normalized.mode, normalized.accessType, normalized.registrationPolicy, nextStatus,
          contentSafetyStatus, normalized.startsAt, normalized.endsAt, normalized.registrationOpensAt,
          normalized.registrationDeadline, normalized.cancellationDeadline, normalized.venueName,
          normalized.address, normalized.cityName, normalized.latitude, normalized.longitude,
          normalized.onlineUrl, normalized.capacity, normalized.waitlistEnabled, normalized.priceCents,
          JSON.stringify(normalized.registrationSchema), appId, id, existing.version,
        ],
      )
    }
    else {
      await tx.query(
        `INSERT INTO mip_events (
          id, app_id, scope_type, branch_id, organizer_user_id, title, summary, description,
          notices, cover_asset_id, event_type_key, event_mode, access_type, registration_policy,
          status, content_safety_status, starts_at, ends_at, registration_opens_at,
          registration_deadline, cancellation_deadline, venue_name, address, city_name,
          latitude, longitude, online_url, capacity, waitlist_enabled, price_cents,
          registration_schema_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id, appId, normalized.scopeType, normalized.branchId, userId, normalized.title,
          normalized.summary, normalized.description, normalized.notices, normalized.coverAssetId,
          normalized.eventTypeKey, normalized.mode, normalized.accessType, normalized.registrationPolicy,
          contentSafetyStatus, normalized.startsAt, normalized.endsAt, normalized.registrationOpensAt,
          normalized.registrationDeadline, normalized.cancellationDeadline, normalized.venueName,
          normalized.address, normalized.cityName, normalized.latitude, normalized.longitude,
          normalized.onlineUrl, normalized.capacity, normalized.waitlistEnabled, normalized.priceCents,
          JSON.stringify(normalized.registrationSchema),
        ],
      )
    }
    await tx.query(
      `INSERT INTO mip_event_changes (
        id, app_id, event_id, source_version, change_type, summary, changed_fields_json, actor_user_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        randomUUID(), appId, id, nextVersion, existing ? 'CONTENT' : 'CREATED',
        existing ? '活动信息已更新' : '活动已创建', JSON.stringify(Object.keys(normalized)), userId,
      ],
    )
    await writeAudit(tx, {
      appId,
      actorUserId: userId,
      actorType: 'ADMIN',
      scopeId: id,
      action: existing ? 'EVENT_UPDATED' : 'EVENT_CREATED',
      resourceType: 'EVENT',
      resourceId: id,
      effectiveRole: role,
      metadata: { version: nextVersion, contentSafetyStatus },
    })
    await writeOutbox(tx, {
      appId,
      aggregateType: 'EVENT',
      aggregateId: id,
      eventType: existing ? 'event.updated' : 'event.created',
      sourceVersion: nextVersion,
      payload: { eventId: id },
    })
    return { id, status: nextStatus, version: nextVersion, contentSafetyStatus }
  })
}

async function adminChangeEventStatus(db, {
  appId,
  userId,
  eventId,
  expectedVersion,
  status,
  now = new Date(),
}) {
  if (!['PUBLISHED', 'UNPUBLISHED', 'CANCELLED', 'ENDED'].includes(status)) {
    throw new DomainError('VALIDATION_FAILED', '活动状态无效')
  }
  return db.transaction(async (tx) => {
    const event = await tx.one(
      `SELECT * FROM mip_events WHERE app_id = ? AND id = ? FOR UPDATE`,
      [appId, eventId],
    )
    if (!event) {
      throw new DomainError('NOT_FOUND', '活动不存在')
    }
    const role = await requireEventCapability(tx, { appId, userId, event, capability: 'events.manage' })
    if (Number(expectedVersion) !== Number(event.version)) {
      throw new DomainError('CONFLICT', '活动已被修改，请刷新后重试', true)
    }
    if (status === 'PUBLISHED'
      && (event.content_safety_status !== 'PASSED' || new Date(event.starts_at) <= now)) {
      throw new DomainError('CONFLICT', event.content_safety_status !== 'PASSED' ? '内容安全检查未通过' : '活动开始时间必须晚于当前时间')
    }
    const nextVersion = Number(event.version) + 1
    await tx.query(
      `UPDATE mip_events SET status = ?, published_at = CASE WHEN ? = 'PUBLISHED' THEN ? ELSE published_at END,
       unpublished_at = CASE WHEN ? = 'UNPUBLISHED' THEN ? ELSE unpublished_at END,
       cancelled_at = CASE WHEN ? = 'CANCELLED' THEN ? ELSE cancelled_at END,
       ended_at = CASE WHEN ? = 'ENDED' THEN ? ELSE ended_at END,
       version = version + 1 WHERE app_id = ? AND id = ? AND version = ?`,
      [status, status, now, status, now, status, now, status, now, appId, eventId, event.version],
    )
    if (status === 'CANCELLED') {
      const registrations = await tx.query(
        `SELECT r.id, r.user_id, r.status, r.version, r.order_id,
           o.status AS order_status, o.amount_cents, h.id AS seat_hold_id
         FROM mip_event_registrations r
         LEFT JOIN mip_orders o ON o.app_id = r.app_id AND o.id = r.order_id AND o.order_type = 'EVENT'
         LEFT JOIN mip_event_seat_holds h ON h.app_id = o.app_id AND h.order_id = o.id
         WHERE r.app_id = ? AND r.event_id = ?
           AND r.status IN ('PENDING_REVIEW','WAITLISTED','PAYMENT_PENDING','REGISTERED','CANCELLATION_PENDING')
         FOR UPDATE`,
        [appId, eventId],
      )
      for (const registration of registrations) {
        const refundRequired = registration.order_status === 'PAID'
        const registrationStatus = refundRequired ? 'CANCELLATION_PENDING' : 'CANCELLED'
        await tx.query(
          `UPDATE mip_event_registrations SET status = ?, cancelled_at = ?, cancelled_by_type = 'EVENT',
           cancellation_reason = '活动已取消', version = version + 1 WHERE app_id = ? AND id = ?`,
          [registrationStatus, now, appId, registration.id],
        )
        if (refundRequired) {
          await tx.query(
            `UPDATE mip_orders SET status = 'REFUND_PENDING', version = version + 1
             WHERE app_id = ? AND id = ? AND status = 'PAID'`,
            [appId, registration.order_id],
          )
          await createEventRefund(tx, {
            appId,
            order: { id: registration.order_id, amount_cents: registration.amount_cents },
            registrationId: registration.id,
            requestedByUserId: registration.user_id,
            reason: '活动取消',
          })
        }
        else if (registration.order_id) {
          await tx.query(
            `UPDATE mip_orders SET status = 'CLOSED', closed_at = ?, version = version + 1
             WHERE app_id = ? AND id = ? AND status IN ('CREATED','PAYMENT_CREATED')`,
            [now, appId, registration.order_id],
          )
          if (registration.seat_hold_id) {
            await tx.query(
              `UPDATE mip_event_seat_holds SET status = 'CANCELLED', cancelled_at = ?
               WHERE app_id = ? AND id = ? AND status = 'ACTIVE'`,
              [now, appId, registration.seat_hold_id],
            )
          }
        }
        await writeOutbox(tx, {
          appId,
          aggregateType: 'EVENT_REGISTRATION',
          aggregateId: registration.id,
          eventType: refundRequired ? 'event.registration_refund_requested' : 'event.registration_cancelled',
          sourceVersion: Number(registration.version) + 1,
          payload: { eventId, userId: registration.user_id, status: registrationStatus, eventCancelled: true },
        })
      }
    }
    await tx.query(
      `INSERT INTO mip_event_changes (
        id, app_id, event_id, source_version, change_type, summary, changed_fields_json, actor_user_id
      ) VALUES (?, ?, ?, ?, 'STATUS', ?, ?, ?)`,
      [randomUUID(), appId, eventId, nextVersion, `活动状态变更为 ${status}`, JSON.stringify(['status']), userId],
    )
    await writeAudit(tx, {
      appId,
      actorUserId: userId,
      actorType: 'ADMIN',
      scopeId: eventId,
      action: `EVENT_${status}`,
      resourceType: 'EVENT',
      resourceId: eventId,
      effectiveRole: role,
      metadata: { from: event.status, to: status, version: nextVersion },
    })
    await writeOutbox(tx, {
      appId,
      aggregateType: 'EVENT',
      aggregateId: eventId,
      eventType: status === 'PUBLISHED' ? 'event.published' : 'event.status_changed',
      sourceVersion: nextVersion,
      payload: { eventId, from: event.status, to: status },
    })
    return { id: eventId, status, version: nextVersion }
  })
}

async function adminIssueCheckInCredential(db, {
  appId,
  userId,
  eventId,
  mode = 'STATIC',
  now = new Date(),
}) {
  return db.transaction(async (tx) => {
    await requireActiveUserForMutation(tx, appId, userId)
    const event = await tx.one(
      `SELECT id, branch_id, starts_at, ends_at, status FROM mip_events
       WHERE app_id = ? AND id = ? FOR UPDATE`,
      [appId, eventId],
    )
    if (!event) {
      throw new DomainError('NOT_FOUND', '活动不存在')
    }
    if (event.status !== 'PUBLISHED') {
      throw new DomainError('INVALID_STATE', '请先发布活动再生成签到海报')
    }
    const role = await requireEventCapability(tx, { appId, userId, event, capability: 'events.checkin' })
    const credentialMode = mode === 'ROTATING' ? 'ROTATING' : 'STATIC'
    const validFrom = credentialMode === 'ROTATING'
      ? now
      : new Date(new Date(event.starts_at).getTime() - 6 * 60 * 60 * 1000)
    const validUntil = credentialMode === 'ROTATING'
      ? new Date(now.getTime() + 5 * 60 * 1000)
      : new Date(new Date(event.ends_at).getTime() + 24 * 60 * 60 * 1000)
    if (credentialMode === 'ROTATING') {
      await tx.query(
        `UPDATE mip_event_checkin_credentials SET status = 'REVOKED', revoked_at = ?
         WHERE app_id = ? AND event_id = ? AND mode = 'ROTATING'
           AND status = 'ACTIVE' AND valid_until > ?`,
        [now, appId, eventId, now],
      )
    }
    const credentialId = randomUUID()
    const scanKey = randomBytes(8).toString('base64url')
    const secret = randomBytes(8).toString('base64url')
    await tx.query(
      `INSERT INTO mip_event_checkin_credentials (
        id, app_id, event_id, scan_key, mode, token_hash, valid_from, valid_until, created_by_user_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [credentialId, appId, eventId, scanKey, credentialMode, sha256(secret), validFrom, validUntil, userId],
    )
    await writeAudit(tx, {
      appId,
      actorUserId: userId,
      actorType: 'ADMIN',
      scopeId: eventId,
      action: 'EVENT_CHECKIN_CREDENTIAL_ISSUED',
      resourceType: 'EVENT_CHECKIN_CREDENTIAL',
      resourceId: credentialId,
      effectiveRole: role,
      metadata: { mode: credentialMode, validFrom: iso(validFrom), validUntil: iso(validUntil) },
    })
    return {
      eventId,
      credentialId,
      mode: credentialMode,
      scanToken: `s1.${scanKey}.${secret}`,
      validFrom: iso(validFrom),
      validUntil: iso(validUntil),
    }
  })
}

async function adminUndoCheckIn(db, {
  appId,
  userId,
  registrationId,
  expectedVersion,
  reason,
  now = new Date(),
}) {
  const normalizedReason = typeof reason === 'string' ? reason.trim() : ''
  if (!normalizedReason || normalizedReason.length > 120) {
    throw new DomainError('VALIDATION_FAILED', '请填写 1–120 个字的撤销原因')
  }
  return db.transaction(async (tx) => {
    const registration = await tx.one(
      `SELECT r.*, e.branch_id FROM mip_event_registrations r
       JOIN mip_events e ON e.app_id = r.app_id AND e.id = r.event_id
       WHERE r.app_id = ? AND r.id = ? FOR UPDATE`,
      [appId, registrationId],
    )
    if (!registration) {
      throw new DomainError('NOT_FOUND', '签到记录不存在')
    }
    const role = await requireEventCapability(tx, {
      appId,
      userId,
      event: { id: registration.event_id, branch_id: registration.branch_id },
      capability: 'events.manage',
    })
    if (registration.status !== 'ATTENDED') {
      throw new DomainError('CONFLICT', '当前不是已签到状态')
    }
    if (Number(expectedVersion) !== Number(registration.version)) {
      throw new DomainError('CONFLICT', '签到状态已变化，请刷新后重试', true)
    }
    const checkin = await tx.one(
      `SELECT id, version FROM mip_event_checkins
       WHERE app_id = ? AND registration_id = ? AND status = 'ACTIVE' FOR UPDATE`,
      [appId, registrationId],
    )
    if (!checkin) {
      throw new DomainError('CONFLICT', '签到记录已变化，请刷新后重试', true)
    }
    await tx.query(
      `UPDATE mip_event_registrations SET status = 'REGISTERED', version = version + 1
       WHERE app_id = ? AND id = ? AND version = ?`,
      [appId, registrationId, registration.version],
    )
    await tx.query(
      `UPDATE mip_event_checkins SET status = 'REVOKED', revoked_at = ?,
       revoked_by_user_id = ?, revoke_reason = ?, version = version + 1
       WHERE app_id = ? AND id = ? AND version = ?`,
      [now, userId, normalizedReason, appId, checkin.id, checkin.version],
    )
    await writeAudit(tx, {
      appId,
      actorUserId: userId,
      actorType: 'ADMIN',
      scopeId: registration.event_id,
      action: 'EVENT_CHECKIN_REVOKED',
      resourceType: 'EVENT_CHECKIN',
      resourceId: checkin.id,
      effectiveRole: role,
      metadata: { reason: normalizedReason, registrationVersion: Number(registration.version) + 1 },
    })
    return {
      eventId: registration.event_id,
      registrationId,
      status: 'REGISTERED',
      version: Number(registration.version) + 1,
    }
  })
}

async function adminListFeedback(db, { appId, userId, eventId, cursor, limit = 30, rating }) {
  const event = await db.one(
    `SELECT id, branch_id FROM mip_events WHERE app_id = ? AND id = ?`,
    [appId, eventId],
  )
  if (!event) {
    throw new DomainError('NOT_FOUND', '活动不存在')
  }
  await requireEventCapability(db, { appId, userId, event, capability: 'events.feedback.read' })
  const pageLimit = Math.min(limitOf(limit), 30)
  let cursorClause = ''
  const params = [appId, eventId]
  const normalizedRating = rating === undefined || rating === null || rating === '' ? null : Number(rating)
  if (normalizedRating !== null && (!Number.isInteger(normalizedRating) || normalizedRating < 1 || normalizedRating > 5)) {
    throw new DomainError('VALIDATION_FAILED', '评分筛选参数无效')
  }
  if (normalizedRating !== null) {
    params.push(normalizedRating)
  }
  if (cursor) {
    const parsed = (() => {
      try {
        return JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))
      }
      catch {
        throw new DomainError('VALIDATION_FAILED', '分页参数无效')
      }
    })()
    if (!parsed || typeof parsed.submittedAt !== 'string'
      || !Number.isFinite(Date.parse(parsed.submittedAt))
      || typeof parsed.id !== 'string'
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(parsed.id)) {
      throw new DomainError('VALIDATION_FAILED', '分页参数无效')
    }
    cursorClause = 'AND (f.submitted_at < ? OR (f.submitted_at = ? AND f.id < ?))'
    params.push(parsed.submittedAt, parsed.submittedAt, parsed.id)
  }
  params.push(pageLimit + 1)
  const rows = await db.query(
    `SELECT f.id, f.rating, f.body, f.version, f.submitted_at, f.updated_at, p.nickname
     FROM mip_event_feedback f
     JOIN mip_profiles p ON p.app_id = f.app_id AND p.user_id = f.user_id
     WHERE f.app_id = ? AND f.event_id = ?${normalizedRating === null ? '' : ' AND f.rating = ?'} ${cursorClause}
     ORDER BY f.submitted_at DESC, f.id DESC LIMIT ?`,
    params,
  )
  const hasMore = rows.length > pageLimit
  const pageRows = rows.slice(0, pageLimit)
  const last = pageRows[pageRows.length - 1]
  return {
    items: pageRows.map(row => ({
      id: row.id,
      nickname: typeof row.nickname === 'string' && row.nickname ? row.nickname : '匿名用户',
      rating: row.rating === null ? undefined : Number(row.rating),
      body: row.body,
      version: Number(row.version),
      submittedAt: iso(row.submitted_at),
      updatedAt: iso(row.updated_at),
    })),
    nextCursor: hasMore
      ? Buffer.from(JSON.stringify({ submittedAt: iso(last.submitted_at), id: last.id })).toString('base64url')
      : undefined,
  }
}

module.exports = {
  adminIssueCheckInCredential,
  adminListFeedback,
  attachInvitationCodeAsset,
  cancelRegistration,
  canEditRegistration,
  checkIn,
  createInvitation,
  createRegistration,
  getEvent,
  effectiveCancellationDeadline,
  eventCancellationHours,
  getFeedback,
  getHeart,
  getMyRegistration,
  listEventAlbum,
  listEvents,
  listHeartCandidates,
  listHeartHistory,
  listMyEventAlbumSubmissions,
  listMyRegistrations,
  listPublicParticipants,
  parseCheckInToken,
  parseInvitationScene,
  resolveCheckInScene,
  resolveInvitationScene,
  saveFeedback,
  setHeart,
  issueInvitationLink,
  submitEventAlbumPhoto,
  updateRegistration,
  withdrawEventAlbumPhoto,
}
