'use strict'

const { createHash, randomUUID } = require('node:crypto')
const {
  ACTIVITY_TYPES,
  assertEventPublishable,
  assertEventTransition,
  assertRegistrationTransition,
  normalizeEvent,
  resolveActivityType,
} = require('../domain/events')
const {
  classifyRosterQuery,
  clampLimit,
  createExportToken,
  decodeRosterCursor,
  encodeRosterCursor,
  escapeLikePattern,
  expectedRegistrationVersion,
  generateTicketCode,
  hashExportToken,
  hashMutationPayload,
  isWithinCheckInWindow,
  maskTicketCode,
  normalizeIdempotencyKey,
  normalizeRosterQuery,
  normalizeRosterStatus,
  normalizeUndoReason,
  requirePositiveVersion,
  rosterCursorSignature,
  rosterExportFileName,
  statusRank,
} = require('../domain/roster')
const { requireExportStorage } = require('./export-storage')
const { XLSX_CONTENT_TYPE, buildRosterXlsx, isXlsxBuffer } = require('./xlsx')

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const EXPORT_BATCH_SIZE = 100
const EXPORT_MAX_ROWS = 5000
const EXPORT_TTL_MS = 15 * 60 * 1000
const EXPORT_RESERVE_LEASE_MS = 30 * 1000
const EXPORT_MAX_BASE64_CHARS = 6 * 1024 * 1024

function validUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value)
}

function toDate(value) {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function expectedVersionFrom(value) {
  if (value === null || value === undefined || value === '') {
    throw new Error('INVALID_EVENT_VERSION')
  }
  const version = Number(value)
  if (!Number.isInteger(version) || version < 1) {
    throw new Error('INVALID_EVENT_VERSION')
  }
  return version
}

/**
 * Cover semantics:
 * - omitted property → keep existing
 * - null / empty → clear cover
 * - UUID → replace after app-scoped media validation
 * Never use `??` that collapses intentional null into "keep".
 */
function resolveCoverIntent(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { kind: 'omit' }
  }
  if (!Object.prototype.hasOwnProperty.call(value, 'coverAssetId')) {
    return { kind: 'omit' }
  }
  const raw = value.coverAssetId
  if (raw === null || raw === undefined || raw === '') {
    return { kind: 'clear' }
  }
  if (typeof raw === 'string' && UUID_RE.test(raw)) {
    return { kind: 'set', id: raw }
  }
  throw new Error('INVALID_EVENT_COVER')
}

async function resolveCoverAssetId(tx, { appId, value, existing }) {
  const intent = resolveCoverIntent(value)
  if (intent.kind === 'omit') {
    return existing?.cover_asset_id || null
  }
  if (intent.kind === 'clear') {
    return null
  }

  // Replacement must be same-tenant, READY, and the event-cover purpose from schema.
  const asset = await tx.one(
    `SELECT id FROM member_media_assets
     WHERE id = ? AND app_id = ? AND status = 'READY' AND kind = 'event-cover'
     FOR SHARE`,
    [intent.id, appId],
  )
  if (!asset) {
    throw new Error('INVALID_EVENT_COVER')
  }
  return intent.id
}

function freeEligibilityTypes() {
  return new Set([ACTIVITY_TYPES.PUBLIC_FREE, ACTIVITY_TYPES.MEMBER_INCLUDED])
}

function isDestructiveFreeEligibilitySwitch(fromType, toType) {
  const free = freeEligibilityTypes()
  return free.has(fromType) && free.has(toType) && fromType !== toType
}

function comparableDate(value) {
  const date = toDate(value)
  return date ? date.toISOString() : ''
}

function eventChange(existing, normalized, schemaJson) {
  if (!existing) return null
  const labels = []
  let type = 'CONTENT'
  if (
    comparableDate(existing.starts_at) !== normalized.startsAt.toISOString()
    || comparableDate(existing.ends_at) !== normalized.endsAt.toISOString()
    || comparableDate(existing.registration_deadline)
      !== (normalized.registrationDeadline?.toISOString() || '')
  ) {
    labels.push('时间')
    type = 'SCHEDULE'
  }
  if (
    String(existing.event_mode || 'OFFLINE') !== normalized.eventMode
    || String(existing.location || '') !== normalized.location
    || String(existing.venue_name || '') !== normalized.venueName
    || String(existing.address || '') !== normalized.address
    || Number(existing.latitude || 0) !== Number(normalized.latitude || 0)
    || Number(existing.longitude || 0) !== Number(normalized.longitude || 0)
    || String(existing.online_url || '') !== normalized.onlineUrl
  ) {
    labels.push('地点')
    if (type === 'CONTENT') type = 'VENUE'
  }
  const previousSchema = typeof existing.registration_schema === 'string'
    ? existing.registration_schema
    : JSON.stringify(existing.registration_schema || [])
  if (
    String(existing.registration_mode || 'AUTO') !== normalized.registrationMode
    || Boolean(Number(existing.waitlist_enabled)) !== normalized.waitlistEnabled
    || Number(existing.capacity || 0) !== Number(normalized.capacity || 30)
    || previousSchema !== schemaJson
  ) {
    labels.push('报名规则')
    if (type === 'CONTENT') type = 'REGISTRATION'
  }
  if (
    String(existing.title || '') !== normalized.title
    || String(existing.description || '') !== normalized.description
    || String(existing.notices || '') !== normalized.notices
  ) {
    labels.push('活动内容')
  }
  const uniqueLabels = [...new Set(labels)]
  if (!uniqueLabels.length) return null
  return {
    type,
    summary: `活动${uniqueLabels.join('、')}已更新`,
  }
}

async function assignEventOwner(tx, { appId, eventId, actorId }) {
  await tx.query(
    `INSERT INTO member_event_managers (
       app_id, event_id, user_id, role, status, assigned_by
     ) VALUES (?, ?, ?, 'EVENT_OWNER', 'ACTIVE', ?)
     ON DUPLICATE KEY UPDATE
       role = 'EVENT_OWNER', status = 'ACTIVE',
       assigned_by = VALUES(assigned_by), updated_at = UTC_TIMESTAMP(3)`,
    [appId, eventId, actorId, actorId],
  )
}

/**
 * Persist an event draft or update with optimistic locking.
 */
async function saveEvent(db, { appId, actorId, actorRole, value, now = new Date() }) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('INVALID_EVENT')
  }
  if (value.id && !validUuid(value.id)) {
    throw new Error('INVALID_EVENT')
  }

  const normalized = normalizeEvent(value)
  return db.transaction(async (tx) => {
    const existing = value.id
      ? await tx.one(
          'SELECT * FROM member_events WHERE id = ? AND app_id = ? FOR UPDATE',
          [value.id, appId],
        )
      : null
    if (value.id && !existing) {
      throw new Error('INVALID_EVENT')
    }
    if (existing && !['DRAFT', 'PUBLISHED'].includes(existing.status)) {
      throw new Error('INVALID_EVENT_TRANSITION')
    }

    const capacity = normalized.capacity === null ? 30 : normalized.capacity
    let occupiedCount = 0
    if (existing) {
      const occupied = await tx.one(
        `SELECT COUNT(*) AS total FROM member_registrations
         WHERE app_id = ? AND event_id = ?
           AND status IN ('REGISTERED', 'CANCELLATION_PENDING', 'ATTENDED')`,
        [appId, existing.id],
      )
      occupiedCount = Number(occupied?.total || 0)
      if (capacity < occupiedCount) {
        throw new Error('EVENT_CAPACITY_BELOW_REGISTRATIONS')
      }

      // Existing attendees must not be reclassified between free eligibility modes.
      if (occupiedCount > 0) {
        const previousType = resolveActivityType(
          Number(existing.price_cents || 0),
          Boolean(Number(existing.member_free)),
        )
        if (isDestructiveFreeEligibilitySwitch(previousType, normalized.activityType)) {
          throw new Error('EVENT_ELIGIBILITY_LOCKED')
        }
      }

      // Published events: first honor the persisted start, then the new payload.
      // An already-started event cannot be rewritten back into the future or otherwise mutated.
      if (existing.status === 'PUBLISHED') {
        const existingStartsAt = toDate(existing.starts_at)
        if (!existingStartsAt || existingStartsAt.getTime() <= now.getTime()) {
          throw new Error('EVENT_ALREADY_STARTED')
        }
        assertEventPublishable(normalized, now)
      }
    }

    const coverAssetId = await resolveCoverAssetId(tx, { appId, value, existing })
    const summary = normalized.description.slice(0, 160) || normalized.title
    const schemaJson = JSON.stringify(normalized.registrationSchema)
    const previousSchema = existing?.registration_schema
      ? (typeof existing.registration_schema === 'string'
          ? existing.registration_schema
          : JSON.stringify(existing.registration_schema))
      : '[]'
    const formVersion = existing && previousSchema !== schemaJson
      ? Number(existing.form_version || 1) + 1
      : Number(existing?.form_version || 1)
    const rowValues = [
      normalized.title,
      summary,
      normalized.description,
      normalized.notices,
      schemaJson,
      formVersion,
      normalized.registrationMode,
      normalized.waitlistEnabled ? 1 : 0,
      normalized.albumEnabled ? 1 : 0,
      normalized.albumRequiresReview ? 1 : 0,
      normalized.eventMode,
      normalized.startsAt,
      normalized.endsAt,
      normalized.registrationDeadline,
      normalized.location,
      normalized.venueName,
      normalized.address,
      normalized.latitude,
      normalized.longitude,
      normalized.onlineUrl || null,
      capacity,
      normalized.memberFree ? 1 : 0,
      normalized.priceCents,
      normalized.cancellationPolicy,
      coverAssetId,
    ]

    if (existing) {
      const expectedVersion = expectedVersionFrom(value.version)
      const result = await tx.query(
        `UPDATE member_events SET
           title = ?, summary = ?, description = ?, notices = ?,
           registration_schema = ?, form_version = ?,
           registration_mode = ?, waitlist_enabled = ?,
           album_enabled = ?, album_requires_review = ?,
           event_mode = ?,
           starts_at = ?, ends_at = ?,
           registration_deadline = ?, location = ?, venue_name = ?, address = ?,
           latitude = ?, longitude = ?, online_url = ?,
           capacity = ?, member_free = ?, price_cents = ?, cancellation_policy = ?,
           cover_asset_id = ?, version = version + 1, updated_at = UTC_TIMESTAMP(3)
         WHERE id = ? AND app_id = ? AND version = ?`,
        [...rowValues, existing.id, appId, expectedVersion],
      )
      if (!result || result.affectedRows !== 1) {
        throw new Error('EVENT_VERSION_CONFLICT')
      }
      const change = eventChange(existing, normalized, schemaJson)
      if (change) {
        await tx.query(
          `INSERT INTO member_event_changes (
             app_id, event_id, event_version, change_type, summary, changed_by
           ) VALUES (?, ?, ?, ?, ?, ?)`,
          [
            appId,
            existing.id,
            expectedVersion + 1,
            change.type,
            change.summary,
            actorId,
          ],
        )
      }
      await tx.query(
        `INSERT INTO member_audit_logs (
           app_id, actor_id, actor_role, action, resource_type, resource_id, metadata
         ) VALUES (?, ?, ?, 'EVENT_UPDATED', 'event', ?, ?)`,
        [
          appId,
          actorId,
          actorRole,
          existing.id,
          JSON.stringify({
            version: expectedVersion + 1,
            activityType: normalized.activityType,
          }),
        ],
      )
      return { id: existing.id, version: expectedVersion + 1 }
    }

    const eventId = randomUUID()
    await tx.query(
      `INSERT INTO member_events (
         id, app_id, title, summary, description, notices, registration_schema,
         form_version, registration_mode, waitlist_enabled,
         album_enabled, album_requires_review, event_mode, starts_at, ends_at,
         registration_deadline, location, venue_name, address,
         latitude, longitude, online_url, capacity,
         member_free, price_cents, cancellation_policy, cover_asset_id,
         status, version
       ) VALUES (
         ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
         ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
         ?, ?, ?, ?, ?, ?, ?,
         'DRAFT', 1
       )`,
      [eventId, appId, ...rowValues],
    )
    await assignEventOwner(tx, {
      appId,
      eventId,
      actorId,
    })
    await tx.query(
      `INSERT INTO member_audit_logs (
         app_id, actor_id, actor_role, action, resource_type, resource_id, metadata
       ) VALUES (?, ?, ?, 'EVENT_CREATED', 'event', ?, ?)`,
      [
        appId,
        actorId,
        actorRole,
        eventId,
        JSON.stringify({ version: 1, activityType: normalized.activityType }),
      ],
    )
    return { id: eventId, version: 1 }
  })
}

/**
 * Transition event status with optimistic version matching.
 * Publishing re-validates completeness and future start.
 * CANCELLED is not allowed here — use cancelEvent for audited registration convergence.
 * Same-status retries return the existing fact without a second audit write.
 */
async function setEventStatus(db, {
  appId,
  actorId,
  actorRole,
  eventId,
  status,
  expectedVersion,
  now = new Date(),
}) {
  if (!validUuid(eventId)) {
    throw new Error('INVALID_EVENT')
  }
  if (status === 'CANCELLED') {
    throw new Error('EVENT_CANCEL_REQUIRES_ACTION')
  }
  if (!['DRAFT', 'PUBLISHED', 'COMPLETED'].includes(status)) {
    throw new Error('INVALID_EVENT_TRANSITION')
  }
  const version = expectedVersionFrom(expectedVersion)

  return db.transaction(async (tx) => {
    const event = await tx.one(
      'SELECT * FROM member_events WHERE id = ? AND app_id = ? FOR UPDATE',
      [eventId, appId],
    )
    if (!event) {
      throw new Error('INVALID_EVENT')
    }

    const currentVersion = Number(event.version)
    const safeVersion = Number.isInteger(currentVersion) && currentVersion > 0 ? currentVersion : 1

    // Idempotent same-status retry: return the stored fact, no audit re-write.
    if (event.status === status) {
      return { id: eventId, status, version: safeVersion }
    }

    assertEventTransition(event.status, status)

    if (status === 'PUBLISHED') {
      const normalized = normalizeEvent({
        title: event.title,
        description: event.description,
        notices: event.notices,
        registrationSchema: typeof event.registration_schema === 'string'
          ? JSON.parse(event.registration_schema || '[]')
          : event.registration_schema,
        registrationMode: event.registration_mode,
        waitlistEnabled: Boolean(event.waitlist_enabled),
        albumEnabled: Boolean(event.album_enabled),
        albumRequiresReview: Boolean(event.album_requires_review),
        eventMode: event.event_mode,
        startsAt: event.starts_at,
        endsAt: event.ends_at,
        registrationDeadline: event.registration_deadline,
        venueName: event.venue_name,
        address: event.address,
        location: event.location,
        latitude: event.latitude,
        longitude: event.longitude,
        onlineUrl: event.online_url,
        capacity: event.capacity,
        cancellationPolicy: event.cancellation_policy,
        coverAssetId: event.cover_asset_id,
        memberFree: event.member_free,
        priceCents: event.price_cents,
        version: event.version,
      })
      assertEventPublishable(normalized, now)
    }
    if (status === 'COMPLETED') {
      const endsAt = toDate(event.ends_at)
      if (!endsAt || endsAt.getTime() > now.getTime()) {
        throw new Error('EVENT_NOT_ENDED')
      }
    }

    if (safeVersion !== version) {
      throw new Error('EVENT_VERSION_CONFLICT')
    }

    const result = await tx.query(
      `UPDATE member_events SET
         status = ?,
         version = version + 1,
         updated_at = UTC_TIMESTAMP(3)
       WHERE id = ? AND app_id = ? AND version = ? AND status = ?`,
      [status, eventId, appId, version, event.status],
    )
    if (!result || result.affectedRows !== 1) {
      throw new Error('EVENT_VERSION_CONFLICT')
    }
    await tx.query(
      `INSERT INTO member_event_changes (
         app_id, event_id, event_version, change_type, summary, changed_by
       ) VALUES (?, ?, ?, 'STATUS', ?, ?)`,
      [
        appId,
        eventId,
        version + 1,
        status === 'PUBLISHED' ? '活动已发布' : (status === 'COMPLETED' ? '活动已结束' : '活动状态已更新'),
        actorId,
      ],
    )
    // status is whitelist-validated above; keep action as a SQL literal for audit consistency.
    await tx.query(
      `INSERT INTO member_audit_logs (
         app_id, actor_id, actor_role, action, resource_type, resource_id, metadata
       ) VALUES (?, ?, ?, 'EVENT_${status}', 'event', ?, ?)`,
      [
        appId,
        actorId,
        actorRole,
        eventId,
        JSON.stringify({ from: event.status, to: status, version: version + 1 }),
      ],
    )
    return { id: eventId, status, version: version + 1 }
  })
}

function normalizeCancellationReason(value) {
  if (typeof value !== 'string') {
    throw new Error('INVALID_CANCELLATION_REASON')
  }
  const reason = value.trim()
  if (reason.length < 1 || reason.length > 500) {
    throw new Error('INVALID_CANCELLATION_REASON')
  }
  return reason
}

function cancelResultFromEvent(event, affectedCount = 0, refundIds = []) {
  const versionNumber = Number(event.version)
  const cancelledAt = toDate(event.cancelled_at)
  return {
    id: event.id,
    status: 'CANCELLED',
    version: Number.isInteger(versionNumber) && versionNumber > 0 ? versionNumber : 1,
    cancelledAt: cancelledAt ? cancelledAt.toISOString() : null,
    cancellationReason: event.cancellation_reason || '',
    affectedCount: Number(affectedCount) || 0,
    refundIds: Array.isArray(refundIds) ? refundIds.filter(validUuid) : [],
  }
}

function eventCancellationRefundNumber(orderId) {
  const digest = createHash('sha256')
    .update(`event-cancel:${orderId}`)
    .digest('hex')
    .slice(0, 31)
    .toUpperCase()
  return `R${digest}`
}

function eventCancellationRetryRefundNumber() {
  return `R${randomUUID().replace(/-/g, '').slice(0, 31).toUpperCase()}`
}

/**
 * Cancel an unpublished or not-yet-started event in one transaction:
 * lock event → write cancel metadata → converge REGISTERED only → audit affected count.
 * Idempotent when the event is already CANCELLED (no second registration/audit writes).
 */
async function cancelEvent(db, {
  appId,
  actorId,
  actorRole,
  eventId,
  reason,
  expectedVersion,
  now = new Date(),
}) {
  if (!validUuid(eventId)) {
    throw new Error('INVALID_EVENT')
  }
  const cancellationReason = normalizeCancellationReason(reason)
  const version = expectedVersionFrom(expectedVersion)

  return db.transaction(async (tx) => {
    const event = await tx.one(
      'SELECT * FROM member_events WHERE id = ? AND app_id = ? FOR UPDATE',
      [eventId, appId],
    )
    if (!event) {
      throw new Error('INVALID_EVENT')
    }

    // Terminal cancel: same fact is always returned, even when expectedVersion is stale.
    if (event.status === 'CANCELLED') {
      const refunds = await tx.query(
        `SELECT refund.id, refund.status, order_row.id AS order_id,
                order_row.status AS order_status
         FROM member_refunds refund
         INNER JOIN member_orders order_row
           ON order_row.app_id = refund.app_id AND order_row.id = refund.order_id
         WHERE refund.app_id = ? AND order_row.order_type = 'EVENT'
           AND order_row.product_id = ?
           AND refund.status IN ('REFUND_PENDING', 'REFUND_CREATED', 'REFUND_FAILED')
         FOR UPDATE`,
        [appId, eventId],
      )
      const refundIds = []
      for (const refund of Array.isArray(refunds) ? refunds : []) {
        if (refund.status === 'REFUND_FAILED') {
          if (refund.order_status !== 'PAID') {
            throw new Error('EVENT_ORDER_NOT_REFUNDABLE')
          }
          const refundUpdate = await tx.query(
            `UPDATE member_refunds SET
               out_refund_no = ?, status = 'REFUND_PENDING', refund_id = NULL,
               submitted_at = NULL, refunded_at = NULL, requested_by = ?,
               reason = ?, updated_at = UTC_TIMESTAMP(3)
             WHERE app_id = ? AND id = ? AND status = 'REFUND_FAILED'`,
            [
              eventCancellationRetryRefundNumber(),
              actorId,
              `活动取消：${event.cancellation_reason || cancellationReason}`.slice(0, 480),
              appId,
              refund.id,
            ],
          )
          const orderUpdate = await tx.query(
            `UPDATE member_orders SET status = 'REFUND_PENDING', updated_at = UTC_TIMESTAMP(3)
             WHERE app_id = ? AND id = ? AND status = 'PAID'`,
            [appId, refund.order_id],
          )
          if (!refundUpdate?.affectedRows || !orderUpdate?.affectedRows) {
            throw new Error('ORDER_STATUS_CONFLICT')
          }
          await tx.query(
            `UPDATE member_registrations SET
               status = 'CANCELLATION_PENDING',
               cancelled_at = COALESCE(cancelled_at, UTC_TIMESTAMP(3)),
               cancelled_by_type = 'EVENT', cancellation_reason = ?,
               version = version + 1, updated_at = UTC_TIMESTAMP(3)
             WHERE app_id = ? AND source_order_id = ? AND status = 'REGISTERED'`,
            [event.cancellation_reason || cancellationReason, appId, refund.order_id],
          )
          await tx.query(
            `UPDATE member_registrations SET
               cancelled_by_type = 'EVENT', cancellation_reason = ?,
               updated_at = UTC_TIMESTAMP(3)
             WHERE app_id = ? AND source_order_id = ? AND status = 'CANCELLATION_PENDING'`,
            [event.cancellation_reason || cancellationReason, appId, refund.order_id],
          )
        }
        refundIds.push(refund.id)
      }
      return cancelResultFromEvent(
        event,
        0,
        refundIds,
      )
    }

    if (event.status === 'COMPLETED') {
      throw new Error('EVENT_ALREADY_COMPLETED')
    }
    if (!['DRAFT', 'PUBLISHED'].includes(event.status)) {
      throw new Error('INVALID_EVENT_TRANSITION')
    }

    const startsAt = toDate(event.starts_at)
    if (!startsAt || startsAt.getTime() <= now.getTime()) {
      throw new Error('EVENT_ALREADY_STARTED')
    }

    if (Number(event.version) !== version) {
      throw new Error('EVENT_VERSION_CONFLICT')
    }

    const eventUpdate = await tx.query(
      `UPDATE member_events SET
         status = 'CANCELLED',
         cancelled_at = UTC_TIMESTAMP(3),
         cancelled_by = ?,
         cancellation_reason = ?,
         version = version + 1,
         updated_at = UTC_TIMESTAMP(3)
       WHERE id = ? AND app_id = ? AND version = ? AND status IN ('DRAFT', 'PUBLISHED')`,
      [actorId, cancellationReason, eventId, appId, version],
    )
    if (!eventUpdate || eventUpdate.affectedRows !== 1) {
      throw new Error('EVENT_VERSION_CONFLICT')
    }

    // ATTENDED history is preserved intentionally. Free registrations cancel
    // immediately; paid registrations wait for the provider-confirmed refund.
    const paidRegistrations = await tx.query(
      `SELECT registration.id, registration.version, registration.source_order_id,
              order_row.status AS order_status, order_row.out_trade_no,
              order_row.amount_cents, order_row.currency,
              refund.id AS refund_id, refund.status AS refund_status
       FROM member_registrations registration
       INNER JOIN member_orders order_row
         ON order_row.app_id = registration.app_id
         AND order_row.id = registration.source_order_id
         AND order_row.order_type = 'EVENT'
       LEFT JOIN member_refunds refund
         ON refund.app_id = order_row.app_id AND refund.order_id = order_row.id
       WHERE registration.app_id = ? AND registration.event_id = ?
         AND registration.status = 'REGISTERED'
       FOR UPDATE`,
      [appId, eventId],
    )
    const freeUpdate = await tx.query(
      `UPDATE member_registrations SET
         status = 'CANCELLED',
         cancelled_at = UTC_TIMESTAMP(3),
         cancelled_by_type = 'EVENT',
         cancellation_reason = ?,
         version = version + 1,
         updated_at = UTC_TIMESTAMP(3)
       WHERE app_id = ? AND event_id = ?
         AND status IN ('PENDING_REVIEW', 'WAITLISTED', 'REGISTERED')
         AND source_order_id IS NULL`,
      [cancellationReason, appId, eventId],
    )
    let affectedCount = Number(freeUpdate?.affectedRows || 0)
    const refundIds = []

    for (const registration of Array.isArray(paidRegistrations) ? paidRegistrations : []) {
      if (!registration.source_order_id) continue
      if (registration.order_status === 'REFUND_PENDING'
        && registration.refund_id
        && ['REFUND_PENDING', 'REFUND_CREATED'].includes(registration.refund_status)) {
        await tx.query(
          `UPDATE member_registrations SET
             status = 'CANCELLATION_PENDING',
             cancelled_at = UTC_TIMESTAMP(3),
             cancelled_by_type = 'EVENT',
             cancellation_reason = ?,
             version = version + 1,
             updated_at = UTC_TIMESTAMP(3)
           WHERE app_id = ? AND id = ? AND status = 'REGISTERED'`,
          [cancellationReason, appId, registration.id],
        )
        refundIds.push(registration.refund_id)
        affectedCount += 1
        continue
      }
      if (registration.order_status !== 'PAID' || registration.refund_id) {
        throw new Error('EVENT_ORDER_NOT_REFUNDABLE')
      }
      const refundId = randomUUID()
      const registrationUpdate = await tx.query(
        `UPDATE member_registrations SET
           status = 'CANCELLATION_PENDING',
           cancelled_at = UTC_TIMESTAMP(3),
           cancelled_by_type = 'EVENT',
           cancellation_reason = ?,
           version = version + 1,
           updated_at = UTC_TIMESTAMP(3)
         WHERE app_id = ? AND id = ? AND status = 'REGISTERED'`,
        [cancellationReason, appId, registration.id],
      )
      if (!registrationUpdate || registrationUpdate.affectedRows !== 1) {
        throw new Error('REGISTRATION_VERSION_CONFLICT')
      }
      const orderUpdate = await tx.query(
        `UPDATE member_orders SET status = 'REFUND_PENDING', updated_at = UTC_TIMESTAMP(3)
         WHERE app_id = ? AND id = ? AND status = 'PAID'`,
        [appId, registration.source_order_id],
      )
      if (!orderUpdate || orderUpdate.affectedRows !== 1) {
        throw new Error('ORDER_STATUS_CONFLICT')
      }
      await tx.query(
        `INSERT INTO member_refunds (
           id, app_id, order_id, out_trade_no, out_refund_no,
           amount_cents, currency, status, requested_by, reason
         ) VALUES (?, ?, ?, ?, ?, ?, ?, 'REFUND_PENDING', ?, ?)`,
        [
          refundId,
          appId,
          registration.source_order_id,
          registration.out_trade_no,
          eventCancellationRefundNumber(registration.source_order_id),
          Number(registration.amount_cents),
          registration.currency || 'CNY',
          actorId,
          `活动取消：${cancellationReason}`.slice(0, 480),
        ],
      )
      refundIds.push(refundId)
      affectedCount += 1
    }

    await tx.query(
      `INSERT INTO member_event_changes (
         app_id, event_id, event_version, change_type, summary, changed_by
       ) VALUES (?, ?, ?, 'STATUS', '活动已取消', ?)`,
      [appId, eventId, version + 1, actorId],
    )

    await tx.query(
      `INSERT INTO member_audit_logs (
         app_id, actor_id, actor_role, action, resource_type, resource_id, metadata
       ) VALUES (?, ?, ?, 'EVENT_CANCELLED', 'event', ?, ?)`,
      [
        appId,
        actorId,
        actorRole,
        eventId,
        JSON.stringify({ affectedCount, refundCount: refundIds.length }),
      ],
    )

    return {
      id: eventId,
      status: 'CANCELLED',
      version: version + 1,
      cancelledAt: now.toISOString(),
      cancellationReason,
      affectedCount,
      refundIds,
    }
  })
}

function mapEventRow(item) {
  const priceCents = Number(item.price_cents || 0)
  const memberFree = Boolean(Number(item.member_free))
  // Never silently coerce illegal price/member_free pairs into PUBLIC_FREE.
  let activityType
  try {
    activityType = resolveActivityType(priceCents, memberFree)
  }
  catch (error) {
    const code = error instanceof Error ? error.message : 'EVENT_DATA_INTEGRITY'
    throw new Error(code === 'INVALID_EVENT_PRICE_COMBINATION' || code === 'INVALID_EVENT_PRICE'
      ? 'EVENT_DATA_INTEGRITY'
      : 'EVENT_DATA_INTEGRITY')
  }

  if (!Number.isInteger(priceCents) || priceCents < 0) {
    throw new Error('EVENT_DATA_INTEGRITY')
  }

  const capacityNumber = item.capacity === null || item.capacity === undefined || item.capacity === ''
    ? null
    : Number(item.capacity)
  const versionNumber = Number(item.version)
  const startsAt = toDate(item.starts_at)
  const endsAt = toDate(item.ends_at)
  const registrationDeadline = toDate(item.registration_deadline)
  const cancelledAt = toDate(item.cancelled_at)

  return {
    id: item.id,
    title: item.title || '',
    description: item.description || '',
    notices: item.notices || '',
    registrationSchema: typeof item.registration_schema === 'string'
      ? JSON.parse(item.registration_schema || '[]')
      : (Array.isArray(item.registration_schema) ? item.registration_schema : []),
    formVersion: Number(item.form_version || 1),
    registrationMode: item.registration_mode === 'APPROVAL' ? 'APPROVAL' : 'AUTO',
    waitlistEnabled: Boolean(Number(item.waitlist_enabled)),
    albumEnabled: Boolean(Number(item.album_enabled)),
    albumRequiresReview: Boolean(Number(item.album_requires_review)),
    eventMode: ['ONLINE', 'HYBRID'].includes(item.event_mode) ? item.event_mode : 'OFFLINE',
    startsAt: startsAt ? startsAt.toISOString() : '',
    endsAt: endsAt ? endsAt.toISOString() : '',
    registrationDeadline: registrationDeadline ? registrationDeadline.toISOString() : null,
    venueName: item.venue_name || '',
    address: item.address || '',
    location: item.location || '',
    latitude: item.latitude === null || item.latitude === undefined ? null : Number(item.latitude),
    longitude: item.longitude === null || item.longitude === undefined ? null : Number(item.longitude),
    onlineUrl: item.online_url || '',
    capacity: Number.isInteger(capacityNumber) ? capacityNumber : null,
    cancellationPolicy: item.cancellation_policy || '',
    coverAssetId: item.cover_asset_id || null,
    coverUrl: item.cover_url || '',
    version: requirePositiveVersion(item.version),
    memberFree,
    priceCents,
    activityType,
    status: item.status || 'DRAFT',
    cancelledAt: cancelledAt ? cancelledAt.toISOString() : null,
    cancellationReason: item.cancellation_reason || null,
  }
}

function parseJsonObject(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value
  if (typeof value !== 'string') return {}
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  }
  catch {
    return {}
  }
}

function maskSensitiveAnswer(type, value, { revealPhone = false } = {}) {
  const text = String(value || '').trim()
  if (type === 'PHONE') {
    if (revealPhone && /^1[3-9]\d{9}$/.test(text)) {
      return text
    }
    return text.length === 11 ? `${text.slice(0, 3)}****${text.slice(-4)}` : '已填写'
  }
  if (type === 'ID_CARD') {
    return text.length === 18 ? `${text.slice(0, 3)}***********${text.slice(-4)}` : '已填写'
  }
  return text
}

function mapRosterItem(row, registrationSchema = [], { includeContact = false } = {}) {
  const version = requirePositiveVersion(row.version)
  const registeredAt = toDate(row.registered_at)
  const attendedAt = toDate(row.attended_at)
  const answers = parseJsonObject(row.answer_snapshot)
  const answerSummary = (Array.isArray(registrationSchema) ? registrationSchema : [])
    .map((question) => {
      const value = answers[question.id]
      if (value === null || value === undefined || value === '' || (Array.isArray(value) && !value.length)) {
        return null
      }
      return {
        label: String(question.label || '').slice(0, 80),
        value: Array.isArray(value)
          ? value.join('、').slice(0, 500)
          : (typeof value === 'boolean'
              ? (value ? '是' : '否')
              : maskSensitiveAnswer(question.type, value, {
                  revealPhone: includeContact,
                }).slice(0, 500)),
      }
    })
    .filter(Boolean)
  const item = {
    id: row.id,
    nickname: row.nickname || '未命名成员',
    avatarUrl: row.cloud_file_id || '',
    city: row.city || '',
    status: row.status || 'CANCELLED',
    ticketCodeMasked: maskTicketCode(row.ticket_code || ''),
    registeredAt: registeredAt ? registeredAt.toISOString() : '',
    attendedAt: attendedAt ? attendedAt.toISOString() : null,
    phoneBound: Boolean(row.phone_number),
    answers: answerSummary,
    reviewReason: row.review_reason || null,
    version,
  }
  if (includeContact) {
    item.phoneNumber = row.phone_number ? String(row.phone_number) : null
  }
  return item
}

function buildRosterFilters({ appId, eventId, status, query, cursor }) {
  const params = [appId, eventId]
  const where = ['r.app_id = ?', 'r.event_id = ?']

  if (status && status !== 'ALL') {
    where.push('r.status = ?')
    params.push(status)
  }

  const intent = classifyRosterQuery(query)
  if (intent.kind === 'phone') {
    where.push('pp.phone_number = ?')
    params.push(intent.value)
  }
  else if (intent.kind === 'ticket') {
    // Ticket format is T+hex; prefix/exact only — never treat plain nicknames as tickets.
    where.push('(r.ticket_code = ? OR r.ticket_code LIKE ? ESCAPE ?)')
    params.push(intent.value, `${escapeLikePattern(intent.value)}%`, '\\')
  }
  else if (intent.kind === 'profile') {
    where.push('(p.nickname LIKE ? ESCAPE ? OR p.city LIKE ? ESCAPE ?)')
    const escaped = escapeLikePattern(intent.value)
    const pattern = `%${escaped}%`
    params.push(pattern, '\\', pattern, '\\')
  }

  if (cursor) {
    // Effective-status priority then registered_at DESC, id DESC. No OFFSET.
    where.push(`(
      CASE r.status
        WHEN 'PENDING_REVIEW' THEN 0
        WHEN 'WAITLISTED' THEN 1
        WHEN 'REGISTERED' THEN 2
        WHEN 'CANCELLATION_PENDING' THEN 3
        WHEN 'ATTENDED' THEN 4
        WHEN 'REJECTED' THEN 5
        WHEN 'CANCELLED' THEN 6
        ELSE 9
      END > ?
      OR (
        CASE r.status
          WHEN 'PENDING_REVIEW' THEN 0
          WHEN 'WAITLISTED' THEN 1
          WHEN 'REGISTERED' THEN 2
          WHEN 'CANCELLATION_PENDING' THEN 3
          WHEN 'ATTENDED' THEN 4
          WHEN 'REJECTED' THEN 5
          WHEN 'CANCELLED' THEN 6
          ELSE 9
        END = ?
        AND (r.registered_at < ? OR (r.registered_at = ? AND r.id < ?))
      )
    )`)
    params.push(cursor.rank, cursor.rank, cursor.registeredAt, cursor.registeredAt, cursor.id)
  }

  return { whereSql: where.join(' AND '), params, intent }
}

const ROSTER_ORDER_SQL = `
  CASE r.status
    WHEN 'PENDING_REVIEW' THEN 0
    WHEN 'WAITLISTED' THEN 1
    WHEN 'REGISTERED' THEN 2
    WHEN 'CANCELLATION_PENDING' THEN 3
    WHEN 'ATTENDED' THEN 4
    WHEN 'REJECTED' THEN 5
    WHEN 'CANCELLED' THEN 6
    ELSE 9
  END ASC,
  r.registered_at DESC,
  r.id DESC
`

/**
 * Page-shaped roster query. Event ownership is verified under trusted app_id.
 * DTO always excludes openid / internal user keys / full ticket.
 * Full phone is included only when the trusted caller has already passed the
 * event-sensitive-roster capability gate.
 */
async function listEventRegistrations(db, {
  appId,
  eventId,
  status,
  query,
  cursor,
  limit,
  includeContact = false,
}) {
  if (!validUuid(eventId)) {
    throw new Error('EVENT_NOT_FOUND')
  }
  const rosterStatus = normalizeRosterStatus(status)
  const rosterQuery = normalizeRosterQuery(query)
  const pageLimit = clampLimit(limit, { min: 1, max: 50, fallback: 20 })
  const signature = rosterCursorSignature({
    appId,
    eventId,
    status: rosterStatus,
    query: rosterQuery,
  })
  const decodedCursor = decodeRosterCursor(cursor, signature)

  const event = await db.one(
    `SELECT id, title, starts_at, ends_at, status, version, registration_schema
     FROM member_events
     WHERE id = ? AND app_id = ?`,
    [eventId, appId],
  )
  if (!event) {
    // Cross-tenant IDs must not leak existence.
    throw new Error('EVENT_NOT_FOUND')
  }

  // Counts ignore cursor so page totals stay consistent with the active filter.
  const countFilters = buildRosterFilters({
    appId,
    eventId,
    status: rosterStatus,
    query: rosterQuery,
    cursor: null,
  })
  const pageFilters = buildRosterFilters({
    appId,
    eventId,
    status: rosterStatus,
    query: rosterQuery,
    cursor: decodedCursor,
  })

  const [counts, rows] = await Promise.all([
    db.one(
      `SELECT
         COUNT(*) AS total,
         SUM(r.status = 'PENDING_REVIEW') AS pending_review_count,
         SUM(r.status = 'WAITLISTED') AS waitlisted_count,
         SUM(r.status = 'REGISTERED') AS registered_count,
         SUM(r.status = 'CANCELLATION_PENDING') AS cancellation_pending_count,
         SUM(r.status = 'ATTENDED') AS attended_count,
         SUM(r.status = 'REJECTED') AS rejected_count,
         SUM(r.status = 'CANCELLED') AS cancelled_count
       FROM member_registrations r
       LEFT JOIN member_profiles p
         ON p.app_id = r.app_id AND p.user_id = r.user_id
       LEFT JOIN member_private_profiles pp
         ON pp.app_id = r.app_id AND pp.user_id = r.user_id
       WHERE ${countFilters.whereSql}`,
      countFilters.params,
    ),
    db.query(
      `SELECT
         r.id,
         r.status,
         r.ticket_code,
         r.registered_at,
         r.attended_at,
         r.answer_snapshot,
         r.review_reason,
         r.version,
         p.nickname,
         p.city,
         m.cloud_file_id,
         pp.phone_number
       FROM member_registrations r
       LEFT JOIN member_profiles p
         ON p.app_id = r.app_id AND p.user_id = r.user_id
       LEFT JOIN member_private_profiles pp
         ON pp.app_id = r.app_id AND pp.user_id = r.user_id
       LEFT JOIN member_media_assets m
         ON m.id = p.avatar_asset_id AND m.app_id = p.app_id AND m.status = 'READY'
       WHERE ${pageFilters.whereSql}
       ORDER BY ${ROSTER_ORDER_SQL}
       LIMIT ${pageLimit + 1}`,
      pageFilters.params,
    ),
  ])

  const hasMore = rows.length > pageLimit
  const pageRows = hasMore ? rows.slice(0, pageLimit) : rows
  const registrationSchema = (() => {
    if (Array.isArray(event.registration_schema)) return event.registration_schema
    try {
      const parsed = JSON.parse(event.registration_schema || '[]')
      return Array.isArray(parsed) ? parsed : []
    }
    catch {
      return []
    }
  })()
  const items = pageRows.map(row => mapRosterItem(row, registrationSchema, { includeContact }))
  let nextCursor = null
  if (hasMore && pageRows.length) {
    const last = pageRows[pageRows.length - 1]
    const registeredAt = toDate(last.registered_at)
    if (registeredAt) {
      nextCursor = encodeRosterCursor({
        registeredAt,
        id: last.id,
        status: last.status,
        signature,
      })
    }
  }

  const startsAt = toDate(event.starts_at)
  return {
    event: {
      id: event.id,
      title: event.title || '',
      startsAt: startsAt ? startsAt.toISOString() : '',
      status: event.status || 'DRAFT',
      registrationCount: Number(counts?.registered_count || 0) + Number(counts?.attended_count || 0),
      pendingReviewCount: Number(counts?.pending_review_count || 0),
      waitlistedCount: Number(counts?.waitlisted_count || 0),
      cancellationPendingCount: Number(counts?.cancellation_pending_count || 0),
      attendedCount: Number(counts?.attended_count || 0),
      rejectedCount: Number(counts?.rejected_count || 0),
      cancelledCount: Number(counts?.cancelled_count || 0),
      totalCount: Number(counts?.total || 0),
    },
    items,
    nextCursor,
  }
}

async function assignTicketCode(tx, { appId, registrationId }) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const ticketCode = generateTicketCode()
    try {
      const result = await tx.query(
        `UPDATE member_registrations
         SET ticket_code = ?, updated_at = UTC_TIMESTAMP(3)
         WHERE app_id = ? AND id = ? AND (ticket_code IS NULL OR ticket_code = '')`,
        [ticketCode, appId, registrationId],
      )
      if (result?.affectedRows === 1) return ticketCode
      const current = await tx.one(
        `SELECT ticket_code FROM member_registrations
         WHERE app_id = ? AND id = ?`,
        [appId, registrationId],
      )
      if (current?.ticket_code) return current.ticket_code
    }
    catch (error) {
      if (/Duplicate entry|member_registrations_ticket_uk|ticket_code/i.test(String(error?.message || error))) {
        continue
      }
      throw error
    }
  }
  throw new Error('TICKET_CODE_UNAVAILABLE')
}

async function reviewEventRegistration(db, {
  appId,
  actorId,
  actorRole,
  eventId,
  registrationId,
  decision,
  reason = '',
  expectedVersion,
}) {
  if (!validUuid(eventId) || !validUuid(registrationId)) {
    throw new Error('REGISTRATION_NOT_FOUND')
  }
  const normalizedDecision = decision === 'approve'
    ? 'approve'
    : (decision === 'reject' ? 'reject' : '')
  if (!normalizedDecision) {
    throw new Error('INVALID_REGISTRATION_DECISION')
  }
  const reviewReason = typeof reason === 'string' ? reason.trim().slice(0, 300) : ''
  if (normalizedDecision === 'reject' && !reviewReason) {
    throw new Error('REGISTRATION_REVIEW_REASON_REQUIRED')
  }
  const version = expectedRegistrationVersion(expectedVersion)
  return db.transaction(async (tx) => {
    const event = await tx.one(
      `SELECT id, status, starts_at, capacity, waitlist_enabled
       FROM member_events
       WHERE app_id = ? AND id = ?
       FOR UPDATE`,
      [appId, eventId],
    )
    const eventStartsAt = toDate(event?.starts_at)
    if (!event || event.status !== 'PUBLISHED'
      || !eventStartsAt || eventStartsAt.getTime() <= Date.now()) {
      throw new Error('EVENT_ALREADY_STARTED')
    }
    const registration = await tx.one(
      `SELECT id, status, version
       FROM member_registrations
       WHERE app_id = ? AND event_id = ? AND id = ?
       FOR UPDATE`,
      [appId, eventId, registrationId],
    )
    if (!registration || !['PENDING_REVIEW', 'WAITLISTED'].includes(registration.status)) {
      throw new Error('INVALID_REGISTRATION_TRANSITION')
    }
    if (requirePositiveVersion(registration.version) !== version) {
      throw new Error('REGISTRATION_VERSION_CONFLICT')
    }

    let nextStatus = 'REJECTED'
    if (normalizedDecision === 'approve') {
      const occupied = await tx.one(
        `SELECT COUNT(*) AS total
         FROM member_registrations
         WHERE app_id = ? AND event_id = ?
           AND status IN ('REGISTERED', 'CANCELLATION_PENDING', 'ATTENDED')`,
        [appId, eventId],
      )
      const capacity = Number(event.capacity)
      const full = Number.isFinite(capacity) && Number(occupied?.total || 0) >= capacity
      if (full && !Boolean(Number(event.waitlist_enabled))) {
        throw new Error('EVENT_FULL')
      }
      nextStatus = full ? 'WAITLISTED' : 'REGISTERED'
    }
    assertRegistrationTransition(registration.status, nextStatus)
    const result = await tx.query(
      `UPDATE member_registrations SET
         status = ?,
         waitlisted_at = CASE WHEN ? = 'WAITLISTED' THEN COALESCE(waitlisted_at, UTC_TIMESTAMP(3)) ELSE NULL END,
         reviewed_at = UTC_TIMESTAMP(3),
         reviewed_by = ?,
         review_reason = ?,
         ticket_code = CASE WHEN ? = 'REGISTERED' THEN ticket_code ELSE NULL END,
         version = version + 1,
         updated_at = UTC_TIMESTAMP(3)
       WHERE app_id = ? AND event_id = ? AND id = ? AND status = ? AND version = ?`,
      [
        nextStatus,
        nextStatus,
        actorId,
        reviewReason || null,
        nextStatus,
        appId,
        eventId,
        registrationId,
        registration.status,
        version,
      ],
    )
    if (!result?.affectedRows) {
      throw new Error('REGISTRATION_VERSION_CONFLICT')
    }
    const ticketCode = nextStatus === 'REGISTERED'
      ? await assignTicketCode(tx, { appId, registrationId })
      : ''
    await tx.query(
      `INSERT INTO member_audit_logs (
         app_id, actor_id, actor_role, action, resource_type, resource_id, metadata
       ) VALUES (?, ?, ?, ?, 'registration', ?, ?)`,
      [
        appId,
        actorId,
        actorRole,
        nextStatus === 'REJECTED'
          ? 'REGISTRATION_REJECTED'
          : (nextStatus === 'WAITLISTED' ? 'REGISTRATION_MOVED_TO_WAITLIST' : 'REGISTRATION_APPROVED'),
        registrationId,
        JSON.stringify({
          eventId,
          from: registration.status,
          to: nextStatus,
          version: version + 1,
          reason: reviewReason,
        }),
      ],
    )
    return {
      id: registrationId,
      eventId,
      status: nextStatus,
      version: version + 1,
      ticketCodeMasked: maskTicketCode(ticketCode),
    }
  })
}

async function duplicateEvent(db, {
  appId,
  actorId,
  actorRole,
  eventId,
  now = new Date(),
}) {
  if (!validUuid(eventId)) throw new Error('INVALID_EVENT')
  return db.transaction(async (tx) => {
    const source = await tx.one(
      `SELECT * FROM member_events
       WHERE app_id = ? AND id = ?
       FOR SHARE`,
      [appId, eventId],
    )
    if (!source) throw new Error('INVALID_EVENT')
    const sourceStarts = toDate(source.starts_at)
    const sourceEnds = toDate(source.ends_at)
    const duration = sourceStarts && sourceEnds
      ? Math.max(60 * 60 * 1000, sourceEnds.getTime() - sourceStarts.getTime())
      : 60 * 60 * 1000
    const startsAt = new Date(Math.max(
      now.getTime() + (24 * 60 * 60 * 1000),
      (sourceStarts?.getTime() || now.getTime()) + (7 * 24 * 60 * 60 * 1000),
    ))
    const endsAt = new Date(startsAt.getTime() + duration)
    const sourceDeadline = toDate(source.registration_deadline)
    const deadlineOffset = sourceStarts && sourceDeadline
      ? Math.max(0, sourceStarts.getTime() - sourceDeadline.getTime())
      : 24 * 60 * 60 * 1000
    const deadline = new Date(startsAt.getTime() - deadlineOffset)
    const duplicateId = randomUUID()
    const title = `${String(source.title || '活动').replace(/（副本）$/, '')}（副本）`.slice(0, 50)
    await tx.query(
      `INSERT INTO member_events (
         id, app_id, title, summary, description, notices, registration_schema,
         form_version, registration_mode, waitlist_enabled,
         album_enabled, album_requires_review, event_mode,
         starts_at, ends_at, registration_deadline,
         location, venue_name, address, latitude, longitude, online_url,
         capacity, member_free, price_cents, cancellation_policy,
         cover_asset_id, poster_asset_id, status, version
       ) VALUES (
         ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
         ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
         ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', 1
       )`,
      [
        duplicateId,
        appId,
        title,
        source.summary || '',
        source.description || '',
        source.notices || '',
        typeof source.registration_schema === 'string'
          ? source.registration_schema
          : JSON.stringify(source.registration_schema || []),
        Number(source.form_version || 1),
        source.registration_mode || 'AUTO',
        Number(source.waitlist_enabled || 0),
        Number(source.album_enabled || 0),
        Number(source.album_requires_review || 0),
        source.event_mode || 'OFFLINE',
        startsAt,
        endsAt,
        deadline,
        source.location || '',
        source.venue_name || '',
        source.address || '',
        source.latitude,
        source.longitude,
        source.online_url || null,
        Number(source.capacity || 30),
        Number(source.member_free || 0),
        Number(source.price_cents || 0),
        source.cancellation_policy || '',
        source.cover_asset_id || null,
        source.poster_asset_id || null,
      ],
    )
    await assignEventOwner(tx, {
      appId,
      eventId: duplicateId,
      actorId,
    })
    await tx.query(
      `INSERT INTO member_audit_logs (
         app_id, actor_id, actor_role, action, resource_type, resource_id, metadata
       ) VALUES (?, ?, ?, 'EVENT_DUPLICATED', 'event', ?, ?)`,
      [
        appId,
        actorId,
        actorRole,
        duplicateId,
        JSON.stringify({ sourceEventId: eventId, version: 1 }),
      ],
    )
    return { id: duplicateId, version: 1 }
  })
}

function mapAttendanceResult(registration, extras = {}) {
  const version = requirePositiveVersion(registration.version)
  const attendedAt = toDate(registration.attended_at)
  return {
    id: registration.id,
    eventId: registration.event_id,
    status: registration.status,
    version,
    attendedAt: attendedAt ? attendedAt.toISOString() : null,
    ...extras,
  }
}

async function loadIdempotency(tx, { appId, scope, key }) {
  if (!key) {
    return null
  }
  return tx.one(
    `SELECT payload_hash, response_json
     FROM member_mutation_idempotency
     WHERE app_id = ? AND scope = ? AND idempotency_key = ?
     FOR UPDATE`,
    [appId, scope, key],
  )
}

async function saveIdempotency(tx, {
  appId,
  scope,
  key,
  payloadHash,
  resourceType,
  resourceId,
  response,
}) {
  if (!key) {
    return
  }
  await tx.query(
    `INSERT INTO member_mutation_idempotency (
       app_id, scope, idempotency_key, payload_hash,
       resource_type, resource_id, response_json
     ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [appId, scope, key, payloadHash, resourceType, resourceId, JSON.stringify(response)],
  )
}

function parseStoredResponse(row) {
  if (!row?.response_json) {
    return null
  }
  if (typeof row.response_json === 'object') {
    return row.response_json
  }
  try {
    return JSON.parse(row.response_json)
  }
  catch {
    throw new Error('DATA_INTEGRITY')
  }
}

/**
 * REGISTERED → ATTENDED with optimistic version, check-in window, and audited mutation.
 * Already-ATTENDED rows are idempotent and do not write a second audit entry.
 * Optional server-stored idempotency key replays the same fact or conflicts on payload change.
 */
async function checkInRegistration(db, {
  appId,
  actorId,
  actorRole,
  eventId,
  registrationId,
  expectedVersion,
  allowOverride = false,
  idempotencyKey,
  now = new Date(),
}) {
  if (!validUuid(eventId) || !validUuid(registrationId)) {
    throw new Error('REGISTRATION_NOT_FOUND')
  }
  const version = expectedRegistrationVersion(expectedVersion)
  const key = normalizeIdempotencyKey(idempotencyKey)
  const payloadHash = hashMutationPayload({
    eventId,
    registrationId,
    expectedVersion: version,
    allowOverride: Boolean(allowOverride),
  })

  return db.transaction(async (tx) => {
    if (key) {
      const existingKey = await loadIdempotency(tx, { appId, scope: 'checkin', key })
      if (existingKey) {
        if (existingKey.payload_hash !== payloadHash) {
          throw new Error('IDEMPOTENCY_KEY_CONFLICT')
        }
        return parseStoredResponse(existingKey)
      }
    }

    const event = await tx.one(
      `SELECT id, status, starts_at, ends_at
       FROM member_events
       WHERE id = ? AND app_id = ?
       FOR UPDATE`,
      [eventId, appId],
    )
    if (!event) {
      throw new Error('REGISTRATION_NOT_FOUND')
    }
    if (event.status === 'CANCELLED') {
      throw new Error('EVENT_CANCELLED')
    }
    if (event.status === 'COMPLETED') {
      throw new Error('EVENT_ALREADY_COMPLETED')
    }

    const registration = await tx.one(
      `SELECT id, event_id, status, version, attended_at, attended_by
       FROM member_registrations
       WHERE id = ? AND app_id = ? AND event_id = ?
       FOR UPDATE`,
      [registrationId, appId, eventId],
    )
    if (!registration) {
      throw new Error('REGISTRATION_NOT_FOUND')
    }

    if (registration.status === 'ATTENDED') {
      const result = mapAttendanceResult(registration, { idempotent: true })
      await saveIdempotency(tx, {
        appId,
        scope: 'checkin',
        key,
        payloadHash,
        resourceType: 'registration',
        resourceId: registrationId,
        response: result,
      })
      return result
    }
    if (registration.status === 'CANCELLED') {
      throw new Error('REGISTRATION_CANCELLED')
    }
    if (registration.status !== 'REGISTERED') {
      throw new Error('INVALID_REGISTRATION_TRANSITION')
    }

    assertRegistrationTransition(registration.status, 'ATTENDED')

    if (requirePositiveVersion(registration.version) !== version) {
      throw new Error('REGISTRATION_VERSION_CONFLICT')
    }

    const withinWindow = isWithinCheckInWindow(event, now)
    let override = false
    if (!withinWindow) {
      if (!allowOverride || actorRole !== 'owner') {
        throw new Error('CHECKIN_WINDOW_CLOSED')
      }
      override = true
    }

    const update = await tx.query(
      `UPDATE member_registrations SET
         status = 'ATTENDED',
         attended_at = UTC_TIMESTAMP(3),
         attended_by = ?,
         version = version + 1,
         updated_at = UTC_TIMESTAMP(3)
       WHERE id = ? AND app_id = ? AND event_id = ? AND status = 'REGISTERED' AND version = ?`,
      [actorId, registrationId, appId, eventId, version],
    )
    if (!update || update.affectedRows !== 1) {
      throw new Error('REGISTRATION_VERSION_CONFLICT')
    }

    await tx.query(
      `INSERT INTO member_audit_logs (
         app_id, actor_id, actor_role, action, resource_type, resource_id, metadata
       ) VALUES (?, ?, ?, ?, 'registration', ?, ?)`,
      [
        appId,
        actorId,
        actorRole,
        override ? 'ATTENDANCE_OVERRIDE' : 'REGISTRATION_CHECKED_IN',
        registrationId,
        JSON.stringify({
          eventId,
          from: 'REGISTERED',
          to: 'ATTENDED',
          version: version + 1,
          override,
        }),
      ],
    )

    const result = {
      id: registrationId,
      eventId,
      status: 'ATTENDED',
      version: version + 1,
      attendedAt: now.toISOString(),
      idempotent: false,
      override,
    }
    await saveIdempotency(tx, {
      appId,
      scope: 'checkin',
      key,
      payloadHash,
      resourceType: 'registration',
      resourceId: registrationId,
      response: result,
    })
    return result
  })
}

/**
 * ATTENDED → REGISTERED undo. Owner/manager only; categorized reason required.
 * Audit failure rolls back with the surrounding transaction.
 */
async function undoCheckIn(db, {
  appId,
  actorId,
  actorRole,
  eventId,
  registrationId,
  expectedVersion,
  reason,
  idempotencyKey,
  now = new Date(),
}) {
  if (!validUuid(eventId) || !validUuid(registrationId)) {
    throw new Error('REGISTRATION_NOT_FOUND')
  }
  if (!['owner', 'manager'].includes(actorRole)) {
    throw new Error('FORBIDDEN')
  }
  const version = expectedRegistrationVersion(expectedVersion)
  const undoReason = normalizeUndoReason(reason)
  const key = normalizeIdempotencyKey(idempotencyKey)
  const payloadHash = hashMutationPayload({
    eventId,
    registrationId,
    expectedVersion: version,
    category: undoReason.category,
  })

  return db.transaction(async (tx) => {
    if (key) {
      const existingKey = await loadIdempotency(tx, { appId, scope: 'undo_checkin', key })
      if (existingKey) {
        if (existingKey.payload_hash !== payloadHash) {
          throw new Error('IDEMPOTENCY_KEY_CONFLICT')
        }
        return parseStoredResponse(existingKey)
      }
    }

    const event = await tx.one(
      `SELECT id, status FROM member_events
       WHERE id = ? AND app_id = ?
       FOR UPDATE`,
      [eventId, appId],
    )
    if (!event) {
      throw new Error('REGISTRATION_NOT_FOUND')
    }
    if (event.status === 'CANCELLED') {
      throw new Error('EVENT_CANCELLED')
    }

    const registration = await tx.one(
      `SELECT id, event_id, status, version
       FROM member_registrations
       WHERE id = ? AND app_id = ? AND event_id = ?
       FOR UPDATE`,
      [registrationId, appId, eventId],
    )
    if (!registration) {
      throw new Error('REGISTRATION_NOT_FOUND')
    }
    if (registration.status === 'REGISTERED') {
      const result = mapAttendanceResult({
        ...registration,
        attended_at: null,
      }, { idempotent: true })
      await saveIdempotency(tx, {
        appId,
        scope: 'undo_checkin',
        key,
        payloadHash,
        resourceType: 'registration',
        resourceId: registrationId,
        response: result,
      })
      return result
    }
    if (registration.status !== 'ATTENDED') {
      throw new Error('INVALID_REGISTRATION_TRANSITION')
    }
    assertRegistrationTransition(registration.status, 'REGISTERED')
    if (requirePositiveVersion(registration.version) !== version) {
      throw new Error('REGISTRATION_VERSION_CONFLICT')
    }

    const update = await tx.query(
      `UPDATE member_registrations SET
         status = 'REGISTERED',
         attended_at = NULL,
         attended_by = NULL,
         version = version + 1,
         updated_at = UTC_TIMESTAMP(3)
       WHERE id = ? AND app_id = ? AND event_id = ? AND status = 'ATTENDED' AND version = ?`,
      [registrationId, appId, eventId, version],
    )
    if (!update || update.affectedRows !== 1) {
      throw new Error('REGISTRATION_VERSION_CONFLICT')
    }

    await tx.query(
      `INSERT INTO member_audit_logs (
         app_id, actor_id, actor_role, action, resource_type, resource_id, metadata
       ) VALUES (?, ?, ?, 'REGISTRATION_CHECKIN_UNDONE', 'registration', ?, ?)`,
      [
        appId,
        actorId,
        actorRole,
        registrationId,
        JSON.stringify({
          eventId,
          from: 'ATTENDED',
          to: 'REGISTERED',
          version: version + 1,
          // Category + length only; never raw free text, openid, phone, or ticket.
          reasonCategory: undoReason.category,
          reasonLength: undoReason.length,
        }),
      ],
    )

    const result = {
      id: registrationId,
      eventId,
      status: 'REGISTERED',
      version: version + 1,
      attendedAt: null,
      idempotent: false,
    }
    await saveIdempotency(tx, {
      appId,
      scope: 'undo_checkin',
      key,
      payloadHash,
      resourceType: 'registration',
      resourceId: registrationId,
      response: result,
    })
    return result
  })
}

async function loadRosterExportRows(db, { appId, eventId, status, query }) {
  const rows = []
  let cursor = null
  let lastIncluded = null
  let hitHardCap = false

  while (rows.length < EXPORT_MAX_ROWS) {
    const pageFilters = buildRosterFilters({
      appId,
      eventId,
      status,
      query,
      cursor,
    })
    const batch = await db.query(
      `SELECT
         r.id,
         r.status,
         r.ticket_code,
         r.registered_at,
         r.attended_at,
         p.nickname,
         p.city,
         pp.phone_number
       FROM member_registrations r
       LEFT JOIN member_profiles p
         ON p.app_id = r.app_id AND p.user_id = r.user_id
       LEFT JOIN member_private_profiles pp
         ON pp.app_id = r.app_id AND pp.user_id = r.user_id
       WHERE ${pageFilters.whereSql}
       ORDER BY ${ROSTER_ORDER_SQL}
       LIMIT ${EXPORT_BATCH_SIZE}`,
      pageFilters.params,
    )
    if (!batch.length) {
      break
    }
    for (const row of batch) {
      const registeredAt = toDate(row.registered_at)
      const attendedAt = toDate(row.attended_at)
      rows.push({
        nickname: row.nickname || '未命名成员',
        city: row.city || '',
        status: row.status || 'CANCELLED',
        registeredAt: registeredAt ? registeredAt.toISOString() : '',
        attendedAt: attendedAt ? attendedAt.toISOString() : '',
        ticketCodeMasked: maskTicketCode(row.ticket_code || ''),
        phoneNumber: row.phone_number ? String(row.phone_number) : '',
      })
      lastIncluded = {
        registeredAt,
        id: row.id,
        rank: statusRank(row.status),
      }
      if (rows.length >= EXPORT_MAX_ROWS) {
        hitHardCap = true
        break
      }
    }
    if (hitHardCap) {
      break
    }
    if (batch.length < EXPORT_BATCH_SIZE) {
      break
    }
    const last = batch[batch.length - 1]
    const registeredAt = toDate(last.registered_at)
    if (!registeredAt) {
      break
    }
    cursor = {
      registeredAt,
      id: last.id,
      rank: statusRank(last.status),
    }
  }

  // If we filled the hard cap, probe one more row — never silently truncate.
  if (hitHardCap && lastIncluded?.registeredAt) {
    const moreFilters = buildRosterFilters({
      appId,
      eventId,
      status,
      query,
      cursor: lastIncluded,
    })
    const more = await db.query(
      `SELECT r.id
       FROM member_registrations r
       LEFT JOIN member_profiles p
         ON p.app_id = r.app_id AND p.user_id = r.user_id
       LEFT JOIN member_private_profiles pp
         ON pp.app_id = r.app_id AND pp.user_id = r.user_id
       WHERE ${moreFilters.whereSql}
       ORDER BY ${ROSTER_ORDER_SQL}
       LIMIT 1`,
      moreFilters.params,
    )
    if (more && more.length) {
      throw new Error('EXPORT_TOO_LARGE')
    }
  }

  return { rows }
}

async function releaseExportReservation(db, { appId, ticketId }) {
  await db.query(
    `UPDATE member_export_tickets
     SET status = 'ACTIVE',
         reserved_until = NULL,
         version = version + 1,
         updated_at = UTC_TIMESTAMP(3)
     WHERE id = ? AND app_id = ? AND status = 'RESERVED'`,
    [ticketId, appId],
  ).catch(() => undefined)
}

async function markExportObjectOrphan(db, { appId, ticketId, reason }) {
  await db.query(
    `UPDATE member_export_tickets
     SET status = CASE WHEN status = 'CONSUMED' THEN status ELSE 'ORPHAN' END,
         updated_at = UTC_TIMESTAMP(3)
     WHERE id = ? AND app_id = ?`,
    [ticketId, appId],
  ).catch(() => undefined)
  // reason is only for structured logs; never include token/path/PII.
  console.error('[export-cleanup]', reason || 'EXPORT_DELETE_FAILED')
}

/**
 * Server-side XLSX export with DB-backed one-time download ticket.
 * Persists full cloud:// fileID + app-scoped object_key + content hash/size.
 * Raw token is returned once and never stored.
 */
async function createRosterExport(db, {
  appId,
  actorId,
  actorRole,
  eventId,
  status,
  query,
  now = new Date(),
  storage,
}) {
  if (!validUuid(eventId)) {
    throw new Error('EVENT_NOT_FOUND')
  }
  const rosterStatus = normalizeRosterStatus(status)
  const rosterQuery = normalizeRosterQuery(query)
  const exportStorage = storage || requireExportStorage()

  const event = await db.one(
    'SELECT id, title FROM member_events WHERE id = ? AND app_id = ?',
    [eventId, appId],
  )
  if (!event) {
    throw new Error('EVENT_NOT_FOUND')
  }

  const { rows } = await loadRosterExportRows(db, {
    appId,
    eventId,
    status: rosterStatus,
    query: rosterQuery,
  })

  const xlsx = buildRosterXlsx(rows)
  if (!isXlsxBuffer(xlsx)) {
    throw new Error('EXPORT_BUILD_FAILED')
  }
  const contentSha256 = createHash('sha256').update(xlsx).digest('hex')
  const contentBytes = xlsx.length
  const fileName = rosterExportFileName(now, 'xlsx')
  const token = createExportToken()
  const tokenHash = hashExportToken(token)
  const keyFragment = createHash('sha256')
    .update(`${appId}:${eventId}:${tokenHash}`)
    .digest('hex')
    .slice(0, 40)
  const expiresAt = new Date(now.getTime() + EXPORT_TTL_MS)
  const ticketId = randomUUID()

  let putResult
  try {
    putResult = await exportStorage.put(keyFragment, xlsx, {
      appId,
      fileName,
      contentType: XLSX_CONTENT_TYPE,
      expiresAt: expiresAt.getTime(),
      metadata: {
        eventId,
        rowCount: rows.length,
        status: rosterStatus,
        hasQuery: Boolean(rosterQuery),
        containsPhoneNumber: true,
        contentSha256,
        contentBytes,
      },
    })
  }
  catch (error) {
    const code = error instanceof Error ? error.message : 'EXPORT_STORAGE_NOT_CONFIGURED'
    if (code === 'EXPORT_STORAGE_NOT_CONFIGURED' || code === 'INVALID_EXPORT_FILE_ID') {
      throw new Error(code === 'INVALID_EXPORT_FILE_ID' ? 'EXPORT_STORAGE_WRITE_FAILED' : code)
    }
    throw new Error('EXPORT_STORAGE_WRITE_FAILED')
  }

  const objectKey = putResult.key || keyFragment
  const fileId = putResult.fileId
  if (!fileId || typeof fileId !== 'string' || !fileId.startsWith('cloud://')) {
    await exportStorage.delete(fileId || objectKey, { fileId, objectKey, appId }).catch(() => undefined)
    throw new Error('EXPORT_STORAGE_WRITE_FAILED')
  }

  try {
    await db.query(
      `INSERT INTO member_export_tickets (
         id, app_id, event_id, operator_id, token_hash, file_id, object_key,
         file_name, content_type, content_bytes, content_sha256,
         row_count, expires_at, status, version
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', 1)`,
      [
        ticketId,
        appId,
        eventId,
        actorId,
        tokenHash,
        fileId,
        objectKey,
        fileName,
        XLSX_CONTENT_TYPE,
        contentBytes,
        contentSha256,
        rows.length,
        expiresAt,
      ],
    )
  }
  catch (error) {
    await exportStorage.delete(fileId, { fileId, objectKey, appId }).catch(() => undefined)
    throw error
  }

  try {
    await db.query(
      `INSERT INTO member_audit_logs (
         app_id, actor_id, actor_role, action, resource_type, resource_id, metadata
       ) VALUES (?, ?, ?, 'EVENT_ROSTER_EXPORTED', 'event', ?, ?)`,
      [
        appId,
        actorId,
        actorRole,
        eventId,
        JSON.stringify({
          rowCount: rows.length,
          status: rosterStatus,
          hasQuery: Boolean(rosterQuery),
          containsPhoneNumber: true,
          ticketId,
        }),
      ],
    )
  }
  catch (error) {
    // Audit failure must not leave a redeemable ticket; mark orphan and delete object.
    await db.query(
      `UPDATE member_export_tickets
       SET status = 'ORPHAN', updated_at = UTC_TIMESTAMP(3)
       WHERE id = ? AND app_id = ?`,
      [ticketId, appId],
    ).catch(() => undefined)
    try {
      await exportStorage.delete(fileId, { fileId, objectKey, appId })
    }
    catch {
      await markExportObjectOrphan(db, { appId, ticketId, reason: 'EXPORT_DELETE_FAILED' })
    }
    throw error
  }

  return {
    downloadToken: token,
    fileName,
    rowCount: rows.length,
    expiresAt: expiresAt.toISOString(),
    contentType: XLSX_CONTENT_TYPE,
  }
}

/**
 * Redeem a one-time export ticket with reservation lease semantics.
 *
 * Contract (at-most-one successful consume + lease recovery):
 * 1. ACTIVE → RESERVED (short lease) under row lock; concurrent losers get no download audit.
 * 2. External object IO verifies existence/size/hash outside MySQL.
 * 3. Bound base64 size BEFORE consume: oversize releases the lease, keeps the object, throws EXPORT_TOO_LARGE.
 * 4. On IO success and size OK: single transaction writes EVENT_ROSTER_DOWNLOAD audit + CONSUMED.
 * 5. On IO/audit failure: release reservation (ticket stays redeemable) unless already CONSUMED.
 * 6. Delete storage object only after successful consume.
 * 7. Crash after CONSUMED but before client receives bytes cannot be exactly-once; client re-exports.
 * Client never supplies a storage path.
 */
async function downloadRosterExport(db, {
  appId,
  actorId,
  actorRole,
  downloadToken,
  eventId,
  storage,
  now = new Date(),
}) {
  if (typeof downloadToken !== 'string' || !/^[a-f0-9]{64}$/i.test(downloadToken)) {
    throw new Error('EXPORT_NOT_FOUND')
  }
  if (!validUuid(eventId)) {
    throw new Error('EXPORT_NOT_FOUND')
  }
  const exportStorage = storage || requireExportStorage()
  const tokenHash = hashExportToken(downloadToken)
  const reserveUntil = new Date(now.getTime() + EXPORT_RESERVE_LEASE_MS)

  const runInTx = typeof db.transaction === 'function'
    ? work => db.transaction(work)
    : async work => work({
        one: (sql, params) => db.one(sql, params),
        query: (sql, params) => db.query(sql, params),
      })

  // Phase 1: lock + reserve (or recover expired lease). No download audit yet.
  const reserved = await runInTx(async (tx) => {
    const ticket = await tx.one(
      `SELECT id, file_id, object_key, file_name, content_type, content_bytes, content_sha256,
              row_count, expires_at, reserved_until, status, version
       FROM member_export_tickets
       WHERE app_id = ? AND event_id = ? AND token_hash = ?
       FOR UPDATE`,
      [appId, eventId, tokenHash],
    )
    if (!ticket) {
      throw new Error('EXPORT_NOT_FOUND')
    }
    if (ticket.status === 'CONSUMED') {
      throw new Error('EXPORT_ALREADY_USED')
    }
    if (ticket.status === 'ORPHAN') {
      throw new Error('EXPORT_NOT_FOUND')
    }

    const expiresAt = toDate(ticket.expires_at)
    if (!expiresAt || expiresAt.getTime() <= now.getTime() || ticket.status === 'EXPIRED') {
      await tx.query(
        `UPDATE member_export_tickets
         SET status = 'EXPIRED',
             reserved_until = NULL,
             updated_at = UTC_TIMESTAMP(3)
         WHERE id = ? AND app_id = ? AND status IN ('ACTIVE', 'RESERVED', 'EXPIRED')`,
        [ticket.id, appId],
      )
      throw new Error('EXPORT_EXPIRED')
    }

    // Recover expired reservation so a crashed reader can retry.
    if (ticket.status === 'RESERVED') {
      const leaseUntil = toDate(ticket.reserved_until)
      if (leaseUntil && leaseUntil.getTime() > now.getTime()) {
        // Concurrent winner still holds the lease — loser writes no audit.
        throw new Error('EXPORT_ALREADY_USED')
      }
      await tx.query(
        `UPDATE member_export_tickets
         SET status = 'ACTIVE',
             reserved_until = NULL,
             version = version + 1,
             updated_at = UTC_TIMESTAMP(3)
         WHERE id = ? AND app_id = ? AND status = 'RESERVED' AND version = ?`,
        [ticket.id, appId, ticket.version],
      )
      ticket.status = 'ACTIVE'
      ticket.version = Number(ticket.version) + 1
    }

    if (ticket.status !== 'ACTIVE') {
      throw new Error('EXPORT_ALREADY_USED')
    }

    const reserve = await tx.query(
      `UPDATE member_export_tickets
       SET status = 'RESERVED',
           reserved_until = ?,
           version = version + 1,
           updated_at = UTC_TIMESTAMP(3)
       WHERE id = ? AND app_id = ? AND status = 'ACTIVE' AND version = ?`,
      [reserveUntil, ticket.id, appId, ticket.version],
    )
    if (!reserve || reserve.affectedRows !== 1) {
      throw new Error('EXPORT_ALREADY_USED')
    }

    return {
      id: ticket.id,
      file_id: ticket.file_id,
      object_key: ticket.object_key,
      file_name: ticket.file_name,
      content_type: ticket.content_type,
      content_bytes: Number(ticket.content_bytes || 0),
      content_sha256: ticket.content_sha256,
      row_count: Number(ticket.row_count || 0),
      version: Number(ticket.version) + 1,
    }
  })

  // Phase 2: external object IO — verify existence, size, and hash before consume.
  let payload
  try {
    if (typeof exportStorage.read !== 'function') {
      throw new Error('EXPORT_NOT_FOUND')
    }
    payload = await exportStorage.read(reserved.file_id, {
      appId,
      fileId: reserved.file_id,
      objectKey: reserved.object_key,
    })
    const content = payload.content
    if (!Buffer.isBuffer(content) || content.length === 0) {
      throw new Error('EXPORT_NOT_FOUND')
    }
    if (content.length !== reserved.content_bytes) {
      throw new Error('EXPORT_OBJECT_INTEGRITY')
    }
    const digest = createHash('sha256').update(content).digest('hex')
    if (digest !== reserved.content_sha256) {
      throw new Error('EXPORT_OBJECT_INTEGRITY')
    }
  }
  catch (error) {
    await releaseExportReservation(db, { appId, ticketId: reserved.id })
    const code = error instanceof Error ? error.message : 'EXPORT_NOT_FOUND'
    if ([
      'EXPORT_NOT_FOUND',
      'EXPORT_EXPIRED',
      'EXPORT_ALREADY_USED',
      'EXPORT_OBJECT_INTEGRITY',
      'INVALID_EXPORT_FILE_ID',
    ].includes(code)) {
      throw new Error(code === 'INVALID_EXPORT_FILE_ID' ? 'EXPORT_NOT_FOUND' : code)
    }
    throw error
  }

  // Phase 2b: size-bound base64 BEFORE consume/delete so oversize cannot burn the ticket.
  const contentBase64 = payload.content.toString('base64')
  if (contentBase64.length > EXPORT_MAX_BASE64_CHARS) {
    await releaseExportReservation(db, { appId, ticketId: reserved.id })
    throw new Error('EXPORT_TOO_LARGE')
  }

  // Phase 3: audit + consume in one DB transaction. Concurrent losers already failed at reserve.
  try {
    await runInTx(async (tx) => {
      const ticket = await tx.one(
        `SELECT id, status, version, row_count
         FROM member_export_tickets
         WHERE id = ? AND app_id = ?
         FOR UPDATE`,
        [reserved.id, appId],
      )
      if (!ticket || ticket.status !== 'RESERVED' || Number(ticket.version) !== reserved.version) {
        throw new Error('EXPORT_ALREADY_USED')
      }
      await tx.query(
        `INSERT INTO member_audit_logs (
           app_id, actor_id, actor_role, action, resource_type, resource_id, metadata
         ) VALUES (?, ?, ?, 'EVENT_ROSTER_DOWNLOAD', 'event', ?, ?)`,
        [
          appId,
          actorId,
          actorRole,
          eventId,
          JSON.stringify({
            rowCount: Number(ticket.row_count || reserved.row_count || 0),
            ticketId: ticket.id,
          }),
        ],
      )
      const consume = await tx.query(
        `UPDATE member_export_tickets
         SET status = 'CONSUMED',
             consumed_at = UTC_TIMESTAMP(3),
             reserved_until = NULL,
             version = version + 1,
             updated_at = UTC_TIMESTAMP(3)
         WHERE id = ? AND app_id = ? AND status = 'RESERVED' AND version = ?`,
        [ticket.id, appId, ticket.version],
      )
      if (!consume || consume.affectedRows !== 1) {
        throw new Error('EXPORT_ALREADY_USED')
      }
    })
  }
  catch (error) {
    // Audit/consume failure must not burn the ticket when still RESERVED.
    await releaseExportReservation(db, { appId, ticketId: reserved.id })
    throw error
  }

  // Phase 4: delete object after successful consume. Failures are not silent.
  try {
    if (typeof exportStorage.delete === 'function') {
      await exportStorage.delete(reserved.file_id, {
        appId,
        fileId: reserved.file_id,
        objectKey: reserved.object_key,
      })
    }
  }
  catch {
    await markExportObjectOrphan(db, {
      appId,
      ticketId: reserved.id,
      reason: 'EXPORT_DELETE_FAILED',
    })
  }

  return {
    fileName: reserved.file_name || payload.fileName || 'event-roster.xlsx',
    contentType: reserved.content_type || payload.contentType || XLSX_CONTENT_TYPE,
    contentBase64,
  }
}

module.exports = {
  cancelEvent,
  checkInRegistration,
  createRosterExport,
  duplicateEvent,
  downloadRosterExport,
  listEventRegistrations,
  mapEventRow,
  mapRosterItem,
  resolveCoverIntent,
  reviewEventRegistration,
  saveEvent,
  setEventStatus,
  undoCheckIn,
}
