'use strict'

const { createHash, randomBytes, randomUUID } = require('node:crypto')
const {
  buildRegistrationAuditRow,
  decideMembershipCapacity,
  decideMembershipEnrollment,
  isReactivatableRegistration,
} = require('./activity-domain-adapter')
const {
  activityType,
  resolvePrivateProfileAnswers,
  validateRegistrationAnswers,
} = require('../domain/activity-platform')
const { insertCleanupOutbox } = require('../domain/media-cleanup')

function merchantOrderNumber() {
  const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 17)
  return `MBR${stamp}${randomBytes(5).toString('hex').toUpperCase()}`
}

function merchantRefundNumber() {
  const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 17)
  return `EVR${stamp}${randomBytes(5).toString('hex').toUpperCase()}`
}

function generateTicketCode() {
  return `T${randomBytes(5).toString('hex').toUpperCase()}`
}

function isTicketUniqueConflict(error) {
  if (!error) {
    return false
  }
  const code = Number(error.errno || error.code)
  const message = String(error.message || error.sqlMessage || error)
  // MySQL ER_DUP_ENTRY = 1062
  if (code !== 1062 && !/Duplicate entry/i.test(message)) {
    return false
  }
  return /member_registrations_ticket_uk|ticket_code/i.test(message)
}

function requirePositiveVersion(value) {
  if (value === null || value === undefined || value === '') {
    throw new Error('DATA_INTEGRITY')
  }
  const version = Number(value)
  if (!Number.isInteger(version) || version < 1) {
    throw new Error('DATA_INTEGRITY')
  }
  return version
}

async function writeRegistrationAudit(tx, {
  appId,
  actorId,
  action,
  registrationId,
  from = null,
  to,
  version,
  eventId,
  now,
  requestId,
  buildAudit = buildRegistrationAuditRow,
}) {
  const row = buildAudit({
    appId,
    actorId,
    action,
    registrationId,
    from,
    to,
    version,
    eventId,
    now,
    requestId,
  })
  await tx.query(
    `INSERT INTO member_audit_logs (
       app_id, actor_id, actor_role, action, resource_type, resource_id, metadata
     ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      row.appId,
      row.actorId,
      row.actorRole,
      row.action,
      row.resourceType,
      row.resourceId,
      JSON.stringify(row.metadata || {}),
    ],
  )
  return row
}

async function ensureTicketCode(tx, { appId, registrationId, existingCode }) {
  if (existingCode) {
    return existingCode
  }
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const ticketCode = generateTicketCode()
    try {
      const result = await tx.query(
        `UPDATE member_registrations
         SET ticket_code = ?, updated_at = UTC_TIMESTAMP(3)
         WHERE id = ? AND app_id = ? AND (ticket_code IS NULL OR ticket_code = '')`,
        [ticketCode, registrationId, appId],
      )
      if (result && result.affectedRows === 1) {
        return ticketCode
      }
      const current = await tx.one(
        'SELECT ticket_code FROM member_registrations WHERE id = ? AND app_id = ?',
        [registrationId, appId],
      )
      if (current?.ticket_code) {
        return current.ticket_code
      }
    }
    catch (error) {
      // Only retry explicit ticket unique-index collisions; all other DB errors fail as-is.
      if (isTicketUniqueConflict(error)) {
        continue
      }
      throw error
    }
  }
  throw new Error('TICKET_CODE_UNAVAILABLE')
}

async function createMembershipOrder(db, input) {
  return db.transaction(async (tx) => {
    const phone = await tx.one(
      `SELECT phone_number FROM member_private_profiles
       WHERE app_id = ? AND user_id = ? AND phone_number IS NOT NULL AND phone_number <> ''
       FOR UPDATE`,
      [input.appId, input.userId],
    )
    if (!phone) {
      throw new Error('PHONE_REQUIRED')
    }
    const plan = await tx.one(
      `SELECT id, name, price_cents, duration_days FROM member_plans
       WHERE app_id = ? AND id = ? AND environment = ? AND status = 'ACTIVE'
       FOR SHARE`,
      [input.appId, input.planId, input.environment],
    )
    if (!plan) {
      throw new Error('PLAN_NOT_AVAILABLE')
    }
    const existing = await tx.one(
      `SELECT id, product_id FROM member_orders
       WHERE app_id = ? AND user_id = ? AND idempotency_key = ?
       FOR UPDATE`,
      [input.appId, input.userId, input.idempotencyKey],
    )
    if (existing) {
      if (existing.product_id !== input.planId) {
        throw new Error('IDEMPOTENCY_CONFLICT')
      }
      return existing.id
    }
    const orderId = randomUUID()
    await tx.query(
      `INSERT INTO member_orders (
         id, app_id, user_id, order_type, product_id, idempotency_key,
         out_trade_no, amount_cents, currency, description, duration_days
       ) VALUES (?, ?, ?, 'MEMBERSHIP', ?, ?, ?, ?, 'CNY', ?, ?)`,
      [
        orderId,
        input.appId,
        input.userId,
        plan.id,
        input.idempotencyKey,
        merchantOrderNumber(),
        plan.price_cents,
        `同行会 ${plan.name}`,
        plan.duration_days,
      ],
    )
    return orderId
  })
}

/**
 * Create or replay a paid event seat reservation and trusted EVENT order.
 * The client submits no amount or order description. Capacity includes active
 * registrations plus unexpired/payment-created reservations.
 */
async function createEventReservationOrder(db, input) {
  const now = input.now instanceof Date ? input.now : new Date()
  if (typeof input.idempotencyKey !== 'string'
    || !input.idempotencyKey.trim()
    || input.idempotencyKey.length > 128) {
    throw new Error('INVALID_IDEMPOTENCY_KEY')
  }

  return db.transaction(async (tx) => {
    const phone = await tx.one(
      `SELECT phone_number FROM member_private_profiles
       WHERE app_id = ? AND user_id = ? AND phone_number IS NOT NULL AND phone_number <> ''
       FOR UPDATE`,
      [input.appId, input.userId],
    )
    if (!phone) {
      throw new Error('PHONE_REQUIRED')
    }

    const event = await tx.one(
      `SELECT id, title, capacity, price_cents, member_free, registration_deadline,
              status, starts_at, registration_schema, form_version
       FROM member_events
       WHERE id = ? AND app_id = ?
       FOR UPDATE`,
      [input.eventId, input.appId],
    )
    if (!event || event.status !== 'PUBLISHED') {
      throw new Error('EVENT_NOT_AVAILABLE')
    }
    const startsAt = event.starts_at ? new Date(event.starts_at) : null
    const deadline = event.registration_deadline ? new Date(event.registration_deadline) : null
    if (!startsAt || startsAt.getTime() <= now.getTime()
      || (deadline && deadline.getTime() <= now.getTime())) {
      throw new Error('EVENT_CLOSED')
    }
    if (activityType(event) !== 'PAID' || !Number.isInteger(Number(event.price_cents)) || Number(event.price_cents) < 1) {
      throw new Error('EVENT_PAYMENT_NOT_REQUIRED')
    }

    const formVersion = Number(input.formVersion)
    if (!Number.isInteger(formVersion) || formVersion !== Number(event.form_version || 1)) {
      throw new Error('REGISTRATION_FORM_CHANGED')
    }
    const normalized = validateRegistrationAnswers(
      event.registration_schema,
      resolvePrivateProfileAnswers(event.registration_schema, input.answers, phone),
    )

    const registration = await tx.one(
      `SELECT id, status FROM member_registrations
       WHERE app_id = ? AND event_id = ? AND user_id = ?
       FOR UPDATE`,
      [input.appId, input.eventId, input.userId],
    )
    if (registration && ['REGISTERED', 'ATTENDED', 'CANCELLATION_PENDING'].includes(registration.status)) {
      throw new Error('ALREADY_REGISTERED')
    }

    const existingIdempotent = await tx.one(
      `SELECT id, product_id FROM member_orders
       WHERE app_id = ? AND user_id = ? AND idempotency_key = ?
       FOR UPDATE`,
      [input.appId, input.userId, input.idempotencyKey.trim()],
    )
    if (existingIdempotent) {
      if (existingIdempotent.product_id !== input.eventId) {
        throw new Error('IDEMPOTENCY_CONFLICT')
      }
      const existingReservation = await tx.one(
        `SELECT expires_at FROM member_event_reservations
         WHERE app_id = ? AND order_id = ?`,
        [input.appId, existingIdempotent.id],
      )
      return {
        orderId: existingIdempotent.id,
        expiresAt: existingReservation?.expires_at || now,
        idempotent: true,
      }
    }

    // Expire only never-started checkout reservations. PAYMENT_CREATED keeps its
    // seat until the provider callback/query converges.
    await tx.query(
      `UPDATE member_event_reservations r
       INNER JOIN member_orders o ON o.app_id = r.app_id AND o.id = r.order_id
       SET r.status = 'EXPIRED', r.released_at = UTC_TIMESTAMP(3), r.updated_at = UTC_TIMESTAMP(3),
           o.status = 'CLOSED', o.closed_at = UTC_TIMESTAMP(3), o.updated_at = UTC_TIMESTAMP(3)
       WHERE r.app_id = ? AND r.event_id = ? AND r.status = 'ACTIVE'
         AND r.expires_at <= UTC_TIMESTAMP(3) AND o.status = 'PENDING'`,
      [input.appId, input.eventId],
    )

    const activeReservation = await tx.one(
      `SELECT r.order_id, r.expires_at
       FROM member_event_reservations r
       INNER JOIN member_orders o ON o.app_id = r.app_id AND o.id = r.order_id
       WHERE r.app_id = ? AND r.event_id = ? AND r.user_id = ? AND r.status = 'ACTIVE'
         AND (r.expires_at > UTC_TIMESTAMP(3) OR o.status = 'PAYMENT_CREATED')
       ORDER BY r.created_at DESC LIMIT 1
       FOR UPDATE`,
      [input.appId, input.eventId, input.userId],
    )
    if (activeReservation) {
      return {
        orderId: activeReservation.order_id,
        expiresAt: activeReservation.expires_at,
        idempotent: true,
      }
    }

    const occupied = await tx.one(
      `SELECT
         (SELECT COUNT(*) FROM member_registrations
          WHERE app_id = ? AND event_id = ?
            AND status IN ('REGISTERED', 'CANCELLATION_PENDING', 'ATTENDED'))
         +
         (SELECT COUNT(*) FROM member_event_reservations r
          INNER JOIN member_orders o ON o.app_id = r.app_id AND o.id = r.order_id
          WHERE r.app_id = ? AND r.event_id = ? AND r.status = 'ACTIVE'
            AND (r.expires_at > UTC_TIMESTAMP(3) OR o.status = 'PAYMENT_CREATED'))
         AS total`,
      [input.appId, input.eventId, input.appId, input.eventId],
    )
    if (Number(occupied?.total || 0) >= Number(event.capacity || 0)) {
      throw new Error('EVENT_FULL')
    }

    const orderId = randomUUID()
    const reservationId = randomUUID()
    const expiresAt = new Date(now.getTime() + 15 * 60 * 1000)
    await tx.query(
      `INSERT INTO member_orders (
         id, app_id, user_id, order_type, product_id, idempotency_key,
         out_trade_no, amount_cents, currency, description, duration_days
       ) VALUES (?, ?, ?, 'EVENT', ?, ?, ?, ?, 'CNY', ?, NULL)`,
      [
        orderId,
        input.appId,
        input.userId,
        event.id,
        input.idempotencyKey.trim(),
        merchantOrderNumber(),
        Number(event.price_cents),
        `同行会活动 · ${String(event.title || '活动报名').slice(0, 90)}`,
      ],
    )
    await tx.query(
      `INSERT INTO member_event_reservations (
         id, app_id, event_id, user_id, order_id, status,
         form_version, answer_snapshot, share_profile, expires_at
       ) VALUES (?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?, ?)`,
      [
        reservationId,
        input.appId,
        input.eventId,
        input.userId,
        orderId,
        formVersion,
        JSON.stringify(normalized.answers),
        input.shareProfile === true ? 1 : 0,
        expiresAt,
      ],
    )
    await tx.query(
      `INSERT INTO member_audit_logs (
         app_id, actor_id, actor_role, action, resource_type, resource_id, metadata
       ) VALUES (?, ?, 'member', 'EVENT_PAYMENT_RESERVED', 'event', ?, ?)`,
      [
        input.appId,
        input.userId,
        input.eventId,
        JSON.stringify({ orderId, reservationId, formVersion }),
      ],
    )
    return { orderId, expiresAt, idempotent: false }
  })
}

/**
 * Register for a free/member-included event.
 * Existing REGISTERED/ATTENDED facts are returned before any eligibility checks.
 * Only new inserts and CANCELLED reactivations re-check phone, open state, deadline,
 * membership, and capacity. Mutations write app-scoped audit; audit failure rolls back.
 * CANCELLED → REGISTERED reactivation is adapter policy, not a shared state machine.
 *
 * @param {object} db
 * @param {object} input
 * @param {{
 *   decideMembershipEnrollment?: typeof decideMembershipEnrollment,
 *   buildRegistrationAuditRow?: typeof buildRegistrationAuditRow,
 * }} [deps] injectable pure seams for offline contract tests
 */
async function registerForEvent(db, input, deps = {}) {
  const now = input.now instanceof Date ? input.now : new Date()
  const decideEnrollment = deps.decideMembershipEnrollment || decideMembershipEnrollment
  const buildAudit = deps.buildRegistrationAuditRow || buildRegistrationAuditRow

  return db.transaction(async (tx) => {
    const event = await tx.one(
      `SELECT id, capacity, price_cents, member_free, registration_deadline, status, starts_at,
              registration_schema, form_version, registration_mode, waitlist_enabled
       FROM member_events
       WHERE id = ? AND app_id = ?
       FOR UPDATE`,
      [input.eventId, input.appId],
    )
    if (!event) {
      throw new Error('EVENT_NOT_AVAILABLE')
    }

    const existing = await tx.one(
      `SELECT id, status, ticket_code, version FROM member_registrations
       WHERE app_id = ? AND event_id = ? AND user_id = ?
       FOR UPDATE`,
      [input.appId, input.eventId, input.userId],
    )

    // Phase 1: REPLAY / accepting / deadline (capacity deferred until after phone).
    const enrollment = decideEnrollment({
      existing,
      eventStatus: event.status,
      startsAt: event.starts_at,
      registrationDeadline: event.registration_deadline,
      now,
    }, { decideEnrollmentAttempt: deps.decideEnrollmentAttempt })

    if (enrollment.kind === 'REPLAY') {
      // Zero-write fact read: never UPDATE ticket_code / updated_at on this path.
      return {
        id: enrollment.fact.id,
        status: enrollment.fact.status,
        ticketCode: enrollment.fact.ticket_code || '',
        version: requirePositiveVersion(enrollment.fact.version),
        idempotent: true,
      }
    }

    // ACCEPT path: case-specific eligibility (phone, price, membership) before capacity.
    const phone = await tx.one(
      `SELECT phone_number FROM member_private_profiles
       WHERE app_id = ? AND user_id = ? AND phone_number IS NOT NULL AND phone_number <> ''
       FOR UPDATE`,
      [input.appId, input.userId],
    )
    if (!phone) {
      throw new Error('PHONE_REQUIRED')
    }

    if (Number(event.price_cents) > 0 && !event.member_free) {
      throw new Error('EVENT_PAYMENT_REQUIRED')
    }
    if (event.member_free) {
      const entitlement = await tx.one(
        `SELECT id FROM member_entitlements
         WHERE app_id = ? AND user_id = ? AND status = 'ACTIVE' AND expires_at > UTC_TIMESTAMP(3)
         FOR SHARE`,
        [input.appId, input.userId],
      )
      if (!entitlement) {
        throw new Error('MEMBERSHIP_REQUIRED')
      }
    }

    const formVersion = Number(input.formVersion || event.form_version || 1)
    if (!Number.isInteger(formVersion) || formVersion !== Number(event.form_version || 1)) {
      throw new Error('REGISTRATION_FORM_CHANGED')
    }
    const normalized = validateRegistrationAnswers(
      event.registration_schema,
      resolvePrivateProfileAnswers(event.registration_schema, input.answers, phone),
    )

    const count = await tx.one(
      `SELECT COUNT(*) AS total FROM member_registrations
       WHERE app_id = ? AND event_id = ? AND status IN ('REGISTERED', 'CANCELLATION_PENDING', 'ATTENDED')`,
      [input.appId, input.eventId],
    )
    const occupiedSeats = Number(count?.total || 0)
    const capacity = event.capacity === null || event.capacity === undefined
      ? null
      : Number(event.capacity)
    const isFull = capacity !== null && occupiedSeats >= capacity
    const registrationMode = event.registration_mode === 'APPROVAL' ? 'APPROVAL' : 'AUTO'
    const waitlistEnabled = Boolean(Number(event.waitlist_enabled))
    let nextStatus = registrationMode === 'APPROVAL' ? 'PENDING_REVIEW' : 'REGISTERED'
    if (registrationMode === 'AUTO' && isFull) {
      if (!waitlistEnabled) {
        const decideCapacity = deps.decideMembershipCapacity || decideMembershipCapacity
        decideCapacity({
          capacity: event.capacity,
          occupiedSeats,
          now,
        }, { decideEnrollmentAttempt: deps.decideEnrollmentAttempt })
      }
      nextStatus = 'WAITLISTED'
    }

    if (existing) {
      // CANCELLED / REJECTED may submit again against the current form and policy.
      if (!isReactivatableRegistration(existing)) {
        throw new Error('REGISTRATION_CONFLICT')
      }
      const previousVersion = requirePositiveVersion(existing.version)
      const ticketCode = nextStatus === 'REGISTERED'
        ? (existing.ticket_code || generateTicketCode())
        : null
      const result = await tx.query(
        `UPDATE member_registrations SET
           status = ?,
           ticket_code = CASE
             WHEN ? = 'REGISTERED' THEN COALESCE(NULLIF(ticket_code, ''), ?)
             ELSE NULL
           END,
           waitlisted_at = CASE WHEN ? = 'WAITLISTED' THEN UTC_TIMESTAMP(3) ELSE NULL END,
           reviewed_at = NULL,
           reviewed_by = NULL,
           review_reason = NULL,
           cancelled_at = NULL,
           cancelled_by_type = NULL,
           cancellation_reason = NULL,
           form_version = ?,
           answer_snapshot = ?,
           share_profile = ?,
           version = version + 1,
           updated_at = UTC_TIMESTAMP(3)
         WHERE app_id = ? AND event_id = ? AND user_id = ?
           AND status IN ('CANCELLED', 'REJECTED')`,
        [
          nextStatus,
          nextStatus,
          ticketCode,
          nextStatus,
          formVersion,
          JSON.stringify(normalized.answers),
          input.shareProfile === true ? 1 : 0,
          input.appId,
          input.eventId,
          input.userId,
        ],
      )
      if (!result || result.affectedRows !== 1) {
        throw new Error('REGISTRATION_CONFLICT')
      }
      await writeRegistrationAudit(tx, {
        appId: input.appId,
        actorId: input.userId,
        action: 'REGISTRATION_REACTIVATED',
        registrationId: existing.id,
        from: existing.status,
        to: nextStatus,
        version: previousVersion + 1,
        eventId: input.eventId,
        now,
        buildAudit,
      })
      return {
        id: existing.id,
        status: nextStatus,
        ticketCode: ticketCode || '',
        version: previousVersion + 1,
        idempotent: false,
      }
    }

    const registrationId = randomUUID()
    const ticketCode = nextStatus === 'REGISTERED' ? generateTicketCode() : null
    try {
      await tx.query(
        `INSERT INTO member_registrations (
           id, app_id, event_id, user_id, status, ticket_code,
           waitlisted_at, form_version, answer_snapshot, share_profile, version
         ) VALUES (
           ?, ?, ?, ?, ?, ?,
           CASE WHEN ? = 'WAITLISTED' THEN UTC_TIMESTAMP(3) ELSE NULL END,
           ?, ?, ?, 1
         )`,
        [
          registrationId,
          input.appId,
          input.eventId,
          input.userId,
          nextStatus,
          ticketCode,
          nextStatus,
          formVersion,
          JSON.stringify(normalized.answers),
          input.shareProfile === true ? 1 : 0,
        ],
      )
    }
    catch (error) {
      if (isTicketUniqueConflict(error)) {
        // Extremely rare on insert; regenerate once through ensure path is not available yet.
        throw new Error('TICKET_CODE_UNAVAILABLE')
      }
      throw error
    }
    await writeRegistrationAudit(tx, {
      appId: input.appId,
      actorId: input.userId,
      action: nextStatus === 'PENDING_REVIEW'
        ? 'REGISTRATION_SUBMITTED_FOR_REVIEW'
        : (nextStatus === 'WAITLISTED' ? 'REGISTRATION_WAITLISTED' : 'REGISTRATION_CREATED'),
      registrationId,
      from: null,
      to: nextStatus,
      version: 1,
      eventId: input.eventId,
      now,
      buildAudit,
    })
    return {
      id: registrationId,
      status: nextStatus,
      ticketCode: ticketCode || '',
      version: 1,
      idempotent: false,
    }
  })
}

async function promoteNextWaitlisted(tx, { appId, eventId, actorId = 'system:waitlist' }) {
  const candidate = await tx.one(
    `SELECT id, version
     FROM member_registrations
     WHERE app_id = ? AND event_id = ? AND status = 'WAITLISTED'
     ORDER BY COALESCE(waitlisted_at, registered_at) ASC, id ASC
     LIMIT 1
     FOR UPDATE`,
    [appId, eventId],
  )
  if (!candidate) {
    return null
  }
  const previousVersion = requirePositiveVersion(candidate.version)
  const updated = await tx.query(
    `UPDATE member_registrations SET
       status = 'REGISTERED',
       waitlisted_at = NULL,
       version = version + 1,
       updated_at = UTC_TIMESTAMP(3)
     WHERE app_id = ? AND event_id = ? AND id = ?
       AND status = 'WAITLISTED' AND version = ?`,
    [appId, eventId, candidate.id, previousVersion],
  )
  if (!updated || updated.affectedRows !== 1) {
    throw new Error('REGISTRATION_CONFLICT')
  }
  const ticketCode = await ensureTicketCode(tx, {
    appId,
    registrationId: candidate.id,
    existingCode: null,
  })
  await tx.query(
    `INSERT INTO member_audit_logs (
       app_id, actor_id, actor_role, action, resource_type, resource_id, metadata
     ) VALUES (?, ?, 'system', 'WAITLIST_PROMOTED', 'registration', ?, ?)`,
    [
      appId,
      actorId,
      candidate.id,
      JSON.stringify({
        eventId,
        from: 'WAITLISTED',
        to: 'REGISTERED',
        version: previousVersion + 1,
      }),
    ],
  )
  return {
    id: candidate.id,
    status: 'REGISTERED',
    ticketCode,
    version: previousVersion + 1,
  }
}

/**
 * Member cancel. Terminal CANCELLED replay is preferred over dynamic open checks:
 * even if the event later closes/cancels/completes, a prior CANCELLED fact still replays.
 * Audit failure rolls back.
 *
 * @param {object} db
 * @param {object} input
 * @param {{ buildRegistrationAuditRow?: typeof buildRegistrationAuditRow }} [deps]
 */
async function cancelEventRegistration(db, input, deps = {}) {
  const buildAudit = deps.buildRegistrationAuditRow || buildRegistrationAuditRow
  const now = input.now instanceof Date ? input.now : new Date()

  return db.transaction(async (tx) => {
    // Load the registration first so terminal CANCELLED can replay without
    // requiring the event to still be open.
    const existing = await tx.one(
      `SELECT id, status, source_order_id, version FROM member_registrations
       WHERE app_id = ? AND event_id = ? AND user_id = ?
       FOR UPDATE`,
      [input.appId, input.eventId, input.userId],
    )
    if (!existing) {
      throw new Error('REGISTRATION_NOT_FOUND')
    }
    if (existing.status === 'CANCELLED') {
      return {
        id: existing.id,
        eventId: input.eventId,
        status: 'CANCELLED',
        version: requirePositiveVersion(existing.version),
        idempotent: true,
      }
    }
    if (existing.status === 'CANCELLATION_PENDING') {
      const refund = await tx.one(
        `SELECT id, status FROM member_refunds
         WHERE app_id = ? AND order_id = ?`,
        [input.appId, existing.source_order_id],
      )
      if (!refund) {
        throw new Error('DATA_INTEGRITY')
      }
      if (refund.status === 'REFUND_FAILED') {
        const orderReset = await tx.query(
          `UPDATE member_orders SET status = 'REFUND_PENDING', updated_at = UTC_TIMESTAMP(3)
           WHERE app_id = ? AND id = ? AND status = 'PAID'`,
          [input.appId, existing.source_order_id],
        )
        if (!orderReset || orderReset.affectedRows !== 1) {
          throw new Error('EVENT_ORDER_NOT_REFUNDABLE')
        }
        await tx.query(
          `UPDATE member_refunds SET
             status = 'REFUND_PENDING', out_refund_no = ?, refund_id = NULL,
             submitted_at = NULL, refunded_at = NULL, requested_by = ?,
             updated_at = UTC_TIMESTAMP(3)
           WHERE app_id = ? AND id = ? AND status = 'REFUND_FAILED'`,
          [merchantRefundNumber(), input.userId, input.appId, refund.id],
        )
        return {
          id: existing.id,
          eventId: input.eventId,
          status: 'CANCELLATION_PENDING',
          version: requirePositiveVersion(existing.version),
          refundId: refund.id,
          refundStatus: 'REFUND_PENDING',
          idempotent: false,
        }
      }
      return {
        id: existing.id,
        eventId: input.eventId,
        status: 'CANCELLATION_PENDING',
        version: requirePositiveVersion(existing.version),
        refundId: refund.id,
        refundStatus: refund.status,
        idempotent: true,
      }
    }
    if (['PENDING_REVIEW', 'WAITLISTED'].includes(existing.status)) {
      const previousVersion = requirePositiveVersion(existing.version)
      const result = await tx.query(
        `UPDATE member_registrations SET
           status = 'CANCELLED',
           cancelled_at = UTC_TIMESTAMP(3),
           cancelled_by_type = 'MEMBER',
           cancellation_reason = ?,
           version = version + 1,
           updated_at = UTC_TIMESTAMP(3)
         WHERE app_id = ? AND event_id = ? AND user_id = ?
           AND status = ? AND version = ?`,
        [
          typeof input.reason === 'string' && input.reason.trim()
            ? input.reason.trim().slice(0, 500)
            : '用户撤回活动报名',
          input.appId,
          input.eventId,
          input.userId,
          existing.status,
          previousVersion,
        ],
      )
      if (!result || result.affectedRows !== 1) {
        throw new Error('REGISTRATION_NOT_FOUND')
      }
      await writeRegistrationAudit(tx, {
        appId: input.appId,
        actorId: input.userId,
        action: 'REGISTRATION_WITHDRAWN_BY_MEMBER',
        registrationId: existing.id,
        from: existing.status,
        to: 'CANCELLED',
        version: previousVersion + 1,
        eventId: input.eventId,
        now,
        buildAudit,
      })
      return {
        id: existing.id,
        eventId: input.eventId,
        status: 'CANCELLED',
        version: previousVersion + 1,
        idempotent: false,
      }
    }
    if (existing.status !== 'REGISTERED') {
      throw new Error('REGISTRATION_NOT_FOUND')
    }

    const event = await tx.one(
      `SELECT id, status, starts_at, waitlist_enabled FROM member_events
       WHERE app_id = ? AND id = ? AND starts_at > UTC_TIMESTAMP(3)
       FOR SHARE`,
      [input.appId, input.eventId],
    )
    if (!event) {
      throw new Error('EVENT_CLOSED')
    }
    if (event.status === 'CANCELLED' || event.status === 'COMPLETED') {
      throw new Error('EVENT_CLOSED')
    }

    const previousVersion = requirePositiveVersion(existing.version)
    if (existing.source_order_id) {
      const order = await tx.one(
        `SELECT * FROM member_orders
         WHERE app_id = ? AND id = ? AND user_id = ?
         FOR UPDATE`,
        [input.appId, existing.source_order_id, input.userId],
      )
      if (!order || order.order_type !== 'EVENT') {
        throw new Error('DATA_INTEGRITY')
      }
      if (order.status === 'REFUND_PENDING') {
        const refund = await tx.one(
          `SELECT id, status FROM member_refunds WHERE app_id = ? AND order_id = ?`,
          [input.appId, order.id],
        )
        if (!refund) throw new Error('DATA_INTEGRITY')
        return {
          id: existing.id,
          eventId: input.eventId,
          status: 'CANCELLATION_PENDING',
          version: previousVersion,
          refundId: refund.id,
          refundStatus: refund.status,
          idempotent: true,
        }
      }
      if (order.status !== 'PAID') {
        throw new Error('EVENT_ORDER_NOT_REFUNDABLE')
      }
      const existingRefund = await tx.one(
        `SELECT id, status FROM member_refunds
         WHERE app_id = ? AND order_id = ? FOR UPDATE`,
        [input.appId, order.id],
      )
      if (existingRefund && existingRefund.status !== 'REFUND_FAILED') {
        throw new Error('EVENT_ORDER_NOT_REFUNDABLE')
      }
      const refundId = existingRefund?.id || randomUUID()
      const outRefundNo = merchantRefundNumber()
      const result = await tx.query(
        `UPDATE member_registrations
         SET status = 'CANCELLATION_PENDING',
             cancelled_at = UTC_TIMESTAMP(3),
             cancelled_by_type = 'MEMBER',
             cancellation_reason = ?,
             version = version + 1,
             updated_at = UTC_TIMESTAMP(3)
         WHERE app_id = ? AND event_id = ? AND user_id = ?
           AND status = 'REGISTERED' AND version = ?`,
        [
          typeof input.reason === 'string' && input.reason.trim()
            ? input.reason.trim().slice(0, 500)
            : '用户申请取消活动报名',
          input.appId,
          input.eventId,
          input.userId,
          previousVersion,
        ],
      )
      if (!result || result.affectedRows !== 1) {
        throw new Error('REGISTRATION_NOT_FOUND')
      }
      await tx.query(
        `UPDATE member_orders SET status = 'REFUND_PENDING', updated_at = UTC_TIMESTAMP(3)
         WHERE id = ? AND app_id = ? AND status = 'PAID'`,
        [order.id, input.appId],
      )
      if (existingRefund) {
        await tx.query(
          `UPDATE member_refunds SET
             out_refund_no = ?, status = 'REFUND_PENDING', refund_id = NULL,
             submitted_at = NULL, refunded_at = NULL, requested_by = ?,
             reason = ?, updated_at = UTC_TIMESTAMP(3)
           WHERE app_id = ? AND id = ? AND status = 'REFUND_FAILED'`,
          [
            outRefundNo,
            input.userId,
            '用户取消付费活动报名',
            input.appId,
            existingRefund.id,
          ],
        )
      }
      else {
        await tx.query(
          `INSERT INTO member_refunds (
             id, app_id, order_id, out_trade_no, out_refund_no,
             amount_cents, currency, status, requested_by, reason
           ) VALUES (?, ?, ?, ?, ?, ?, 'CNY', 'REFUND_PENDING', ?, ?)`,
          [
            refundId,
            input.appId,
            order.id,
            order.out_trade_no,
            outRefundNo,
            Number(order.amount_cents),
            input.userId,
            '用户取消付费活动报名',
          ],
        )
      }
      await writeRegistrationAudit(tx, {
        appId: input.appId,
        actorId: input.userId,
        action: 'EVENT_REFUND_REQUESTED',
        registrationId: existing.id,
        from: 'REGISTERED',
        to: 'CANCELLATION_PENDING',
        version: previousVersion + 1,
        eventId: input.eventId,
        now,
        buildAudit,
      })
      return {
        id: existing.id,
        eventId: input.eventId,
        status: 'CANCELLATION_PENDING',
        version: previousVersion + 1,
        refundId,
        refundStatus: 'REFUND_PENDING',
        idempotent: false,
      }
    }

    const result = await tx.query(
      `UPDATE member_registrations
       SET status = 'CANCELLED',
           cancelled_at = UTC_TIMESTAMP(3),
           cancelled_by_type = 'MEMBER',
           cancellation_reason = NULL,
           version = version + 1,
           updated_at = UTC_TIMESTAMP(3)
       WHERE app_id = ? AND event_id = ? AND user_id = ? AND status = 'REGISTERED' AND version = ?`,
      [input.appId, input.eventId, input.userId, previousVersion],
    )
    if (!result || result.affectedRows !== 1) {
      throw new Error('REGISTRATION_NOT_FOUND')
    }

    await writeRegistrationAudit(tx, {
      appId: input.appId,
      actorId: input.userId,
      action: 'REGISTRATION_CANCELLED_BY_MEMBER',
      registrationId: existing.id,
      from: 'REGISTERED',
      to: 'CANCELLED',
      version: previousVersion + 1,
      eventId: input.eventId,
      now,
      buildAudit,
    })

    const promoted = Boolean(Number(event.waitlist_enabled))
      ? await promoteNextWaitlisted(tx, {
          appId: input.appId,
          eventId: input.eventId,
        })
      : null

    return {
      id: existing.id,
      eventId: input.eventId,
      status: 'CANCELLED',
      version: previousVersion + 1,
      promotedRegistrationId: promoted?.id || null,
      idempotent: false,
    }
  })
}

async function updateRegistrationAnswers(db, input, deps = {}) {
  const now = input.now instanceof Date ? input.now : new Date()
  const buildAudit = deps.buildRegistrationAuditRow || buildRegistrationAuditRow
  return db.transaction(async (tx) => {
    const event = await tx.one(
      `SELECT id, status, starts_at, registration_deadline, registration_schema, form_version
       FROM member_events
       WHERE app_id = ? AND id = ?
       FOR SHARE`,
      [input.appId, input.eventId],
    )
    if (!event || event.status !== 'PUBLISHED') {
      throw new Error('EVENT_CLOSED')
    }
    const startsAt = new Date(event.starts_at)
    const deadline = event.registration_deadline
      ? new Date(event.registration_deadline)
      : startsAt
    if (!Number.isFinite(startsAt.getTime())
      || startsAt.getTime() <= now.getTime()
      || !Number.isFinite(deadline.getTime())
      || deadline.getTime() <= now.getTime()) {
      throw new Error('REGISTRATION_CLOSED')
    }
    const registration = await tx.one(
      `SELECT id, status, version
       FROM member_registrations
       WHERE app_id = ? AND event_id = ? AND user_id = ?
       FOR UPDATE`,
      [input.appId, input.eventId, input.userId],
    )
    if (!registration
      || !['PENDING_REVIEW', 'WAITLISTED', 'REGISTERED'].includes(registration.status)) {
      throw new Error('REGISTRATION_NOT_EDITABLE')
    }
    const expectedVersion = requirePositiveVersion(input.expectedVersion)
    if (requirePositiveVersion(registration.version) !== expectedVersion) {
      throw new Error('REGISTRATION_VERSION_CONFLICT')
    }
    const formVersion = Number(input.formVersion)
    if (!Number.isInteger(formVersion) || formVersion !== Number(event.form_version || 1)) {
      throw new Error('REGISTRATION_FORM_CHANGED')
    }
    const phone = await tx.one(
      `SELECT phone_number FROM member_private_profiles
       WHERE app_id = ? AND user_id = ?`,
      [input.appId, input.userId],
    )
    const normalized = validateRegistrationAnswers(
      event.registration_schema,
      resolvePrivateProfileAnswers(event.registration_schema, input.answers, phone),
    )
    const updated = await tx.query(
      `UPDATE member_registrations SET
         form_version = ?,
         answer_snapshot = ?,
         share_profile = ?,
         version = version + 1,
         updated_at = UTC_TIMESTAMP(3)
       WHERE app_id = ? AND id = ? AND version = ?
         AND status IN ('PENDING_REVIEW', 'WAITLISTED', 'REGISTERED')`,
      [
        formVersion,
        JSON.stringify(normalized.answers),
        input.shareProfile === true ? 1 : 0,
        input.appId,
        registration.id,
        expectedVersion,
      ],
    )
    if (!updated || updated.affectedRows !== 1) {
      throw new Error('REGISTRATION_VERSION_CONFLICT')
    }
    await writeRegistrationAudit(tx, {
      appId: input.appId,
      actorId: input.userId,
      action: 'REGISTRATION_ANSWERS_UPDATED',
      registrationId: registration.id,
      from: registration.status,
      to: registration.status,
      version: expectedVersion + 1,
      eventId: input.eventId,
      now,
      buildAudit,
    })
    return {
      id: registration.id,
      eventId: input.eventId,
      status: registration.status,
      version: expectedVersion + 1,
    }
  })
}

/**
 * Soft-delete a member account inside one transaction:
 * lock profile → unbind/archive media → clear PII → revoke entitlements →
 * cancel REGISTERED rows with full cancel metadata + audit →
 * write MEDIA_CLEANUP_PENDING outbox audits → ACCOUNT_DELETED.
 *
 * Returns cleanup items for best-effort cloud object deletion after commit.
 * Object delete failures must not fail the account deletion (retry via outbox).
 *
 * @param {object} db
 * @param {{ appId: string, userId: string, now?: Date, buildRegistrationAuditRow?: Function }} input
 * @param {{ buildRegistrationAuditRow?: Function }} [deps]
 */
async function deleteMemberAccount(db, input, deps = {}) {
  const now = input.now instanceof Date ? input.now : new Date()
  const buildAudit = deps.buildRegistrationAuditRow
    || input.buildRegistrationAuditRow
    || buildRegistrationAuditRow
  const userScope = createHash('sha256').update(input.userId).digest('hex').slice(0, 24)
  const avatarAssetKey = `member-avatar-${userScope}`

  return db.transaction(async (tx) => {
    const profile = await tx.one(
      `SELECT id, avatar_asset_id, status FROM member_profiles
       WHERE app_id = ? AND user_id = ?
       FOR UPDATE`,
      [input.appId, input.userId],
    )

    // Collect avatar (and profile-linked) media rows that still hold cloud objects.
    const mediaRowsRaw = await tx.query(
      `SELECT id, cloud_file_id, object_key, status, asset_key
       FROM member_media_assets
       WHERE app_id = ?
         AND (
           id = ?
           OR (kind = 'avatar' AND asset_key = ?)
         )
         AND status IN ('READY', 'PROCESSING', 'ARCHIVED')
       FOR UPDATE`,
      [input.appId, profile?.avatar_asset_id || null, avatarAssetKey],
    )
    const mediaRows = Array.isArray(mediaRowsRaw) ? mediaRowsRaw : []

    // Unbind avatar and clear public PII before archiving media (FK-safe).
    await tx.query(
      `UPDATE member_profiles
       SET nickname = '', city = '', headline = '', bio = '', tags = JSON_ARRAY(),
           avatar_asset_id = NULL, status = 'DELETED', approved_at = NULL,
           updated_at = UTC_TIMESTAMP(3)
       WHERE app_id = ? AND user_id = ?`,
      [input.appId, input.userId],
    )
    await tx.query(
      `UPDATE member_private_profiles
       SET phone_number = NULL, phone_bound_at = NULL, updated_at = UTC_TIMESTAMP(3)
       WHERE app_id = ? AND user_id = ?`,
      [input.appId, input.userId],
    )
    await tx.query(
      `UPDATE member_entitlements
       SET status = 'REVOKED', expires_at = LEAST(expires_at, UTC_TIMESTAMP(3)),
           source_order_id = NULL, updated_at = UTC_TIMESTAMP(3)
       WHERE app_id = ? AND user_id = ?`,
      [input.appId, input.userId],
    )
    // Notification grants are user-scoped one-time authorizations. Remove
    // pending delivery first, then the inbox and grants, during account deletion.
    await tx.query(
      `DELETE FROM member_notification_outbox
       WHERE app_id = ? AND user_id = ?`,
      [input.appId, input.userId],
    )
    await tx.query(
      `DELETE FROM member_notifications
       WHERE app_id = ? AND user_id = ?`,
      [input.appId, input.userId],
    )
    await tx.query(
      `DELETE FROM member_notification_subscriptions
       WHERE app_id = ? AND user_id = ?`,
      [input.appId, input.userId],
    )
    await tx.query(
      `DELETE FROM member_operational_failures
       WHERE app_id = ? AND user_id = ?`,
      [input.appId, input.userId],
    )
    await tx.query(
      `DELETE FROM member_follows
       WHERE app_id = ? AND (follower_user_id = ? OR followee_user_id = ?)`,
      [input.appId, input.userId, input.userId],
    )
    await tx.query(
      `DELETE FROM member_blocks
       WHERE app_id = ? AND (blocker_user_id = ? OR blocked_user_id = ?)`,
      [input.appId, input.userId, input.userId],
    )
    // Cancel each active application/registration with full metadata + per-registration audit.
    // cancelledRegistrations records actual affectedRows, not the candidate count.
    const registrationsRaw = await tx.query(
      `SELECT id, version, event_id, status FROM member_registrations
       WHERE app_id = ? AND user_id = ?
         AND status IN ('PENDING_REVIEW', 'WAITLISTED', 'REGISTERED')
       FOR UPDATE`,
      [input.appId, input.userId],
    )
    const registrations = Array.isArray(registrationsRaw) ? registrationsRaw : []
    let cancelledRegistrations = 0
    for (const registration of registrations) {
      const previousVersion = requirePositiveVersion(registration.version)
      const result = await tx.query(
        `UPDATE member_registrations
         SET status = 'CANCELLED',
             cancelled_at = UTC_TIMESTAMP(3),
             cancelled_by_type = 'MEMBER',
             cancellation_reason = 'ACCOUNT_DELETED',
             version = version + 1,
             updated_at = UTC_TIMESTAMP(3)
         WHERE id = ? AND app_id = ? AND status = ? AND version = ?`,
        [registration.id, input.appId, registration.status, previousVersion],
      )
      if (!result || result.affectedRows !== 1) {
        // Concurrent cancel/check-in — skip rather than abort whole account delete.
        continue
      }
      cancelledRegistrations += 1
      await writeRegistrationAudit(tx, {
        appId: input.appId,
        actorId: input.userId,
        action: 'REGISTRATION_CANCELLED_ON_ACCOUNT_DELETE',
        registrationId: registration.id,
        from: registration.status,
        to: 'CANCELLED',
        version: previousVersion + 1,
        eventId: registration.event_id,
        now,
        buildAudit,
      })
    }

    // Archive media assets and write executable cleanup outbox rows (not audit-only).
    const cleanupItems = []
    const seenAssetIds = new Set()
    for (const asset of mediaRows) {
      if (!asset?.id || seenAssetIds.has(asset.id)) {
        continue
      }
      seenAssetIds.add(asset.id)
      if (asset.status !== 'ARCHIVED') {
        await tx.query(
          `UPDATE member_media_assets
           SET status = 'ARCHIVED'
           WHERE app_id = ? AND id = ? AND status <> 'ARCHIVED'`,
          [input.appId, asset.id],
        )
      }
      if (asset.cloud_file_id) {
        const outbox = await insertCleanupOutbox(tx, {
          appId: input.appId,
          userId: input.userId,
          mediaAssetId: asset.id,
          cloudFileId: asset.cloud_file_id,
          now,
        })
        const cleanupMeta = {
          outboxId: outbox.id,
          assetId: asset.id,
          cloudFileId: asset.cloud_file_id,
          objectKey: asset.object_key || '',
          version: Number(outbox.version || 1),
        }
        cleanupItems.push(cleanupMeta)
        await tx.query(
          `INSERT INTO member_audit_logs (
             app_id, actor_id, actor_role, action, resource_type, resource_id, metadata
           ) VALUES (?, ?, 'member', 'MEDIA_CLEANUP_PENDING', 'media', ?, ?)`,
          [
            input.appId,
            input.userId,
            asset.id,
            JSON.stringify(cleanupMeta),
          ],
        )
      }
    }

    await tx.query(
      `INSERT INTO member_audit_logs (
         app_id, actor_id, actor_role, action, resource_type, resource_id, metadata
       ) VALUES (?, ?, 'member', 'ACCOUNT_DELETED', 'profile', ?, ?)`,
      [
        input.appId,
        input.userId,
        profile?.id || input.userId,
        JSON.stringify({
          previousStatus: profile?.status || null,
          avatarAssetId: profile?.avatar_asset_id || null,
          cancelledRegistrations,
          archivedAssets: cleanupItems.length,
          version: 1,
        }),
      ],
    )

    return {
      status: 'DELETED',
      cleanupItems,
      cancelledRegistrations,
      archivedAssets: cleanupItems.length,
    }
  })
}

module.exports = {
  cancelEventRegistration,
  createEventReservationOrder,
  createMembershipOrder,
  deleteMemberAccount,
  ensureTicketCode,
  isTicketUniqueConflict,
  merchantOrderNumber,
  merchantRefundNumber,
  promoteNextWaitlisted,
  registerForEvent,
  updateRegistrationAnswers,
}
