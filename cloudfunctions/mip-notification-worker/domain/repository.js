'use strict'

const { randomUUID } = require('node:crypto')

const MAX_ATTEMPTS = 5
const TASK_LEASE_MS = 2 * 60 * 1000

function createNotificationRepository(database, options = {}) {
  const createId = options.createId || randomUUID

  async function publishMessage(appId, message) {
    return database.transaction(async (tx) => {
      const recipient = await tx.one(
        `SELECT id, status FROM mip_users WHERE app_id = ? AND id = ? FOR UPDATE`,
        [appId, message.recipientUserId],
      )
      if (!recipient || recipient.status !== 'ACTIVE') throw new Error('NOT_FOUND')
      const messageId = createId()
      await tx.query(
        `INSERT INTO mip_inbox_messages (
           id, app_id, recipient_user_id, message_type, title, body,
           target_type, target_id, target_route, dedupe_key
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE dedupe_key = VALUES(dedupe_key)`,
        [
          messageId,
          appId,
          message.recipientUserId,
          message.messageType,
          message.title,
          message.body,
          message.target?.type || null,
          message.target?.id || null,
          message.target?.route || null,
          message.dedupeKey,
        ],
      )
      const stored = await tx.one(
        `SELECT id, recipient_user_id, message_type, title, body, target_type,
                target_id, target_route, read_at, created_at
         FROM mip_inbox_messages
         WHERE app_id = ? AND recipient_user_id = ? AND dedupe_key = ? FOR UPDATE`,
        [appId, message.recipientUserId, message.dedupeKey],
      )
      if (message.external) {
        await tx.query(
          `INSERT INTO mip_delivery_tasks (
             id, app_id, inbox_message_id, channel, template_key, payload_json, status
           ) VALUES (?, ?, ?, ?, ?, ?, 'PENDING')
           ON DUPLICATE KEY UPDATE inbox_message_id = VALUES(inbox_message_id)`,
          [
            createId(),
            appId,
            stored.id,
            message.external.channel,
            message.external.templateKey,
            JSON.stringify(message.external.payload),
          ],
        )
      }
      return messageDto(stored)
    })
  }

  async function leaseTasks(appId, limit, now = new Date()) {
    const batchSize = Math.min(20, Math.max(1, Number(limit) || 10))
    const leaseExpiresAt = new Date(now.getTime() + TASK_LEASE_MS)
    return database.transaction(async (tx) => {
      const exhausted = await tx.query(
        `SELECT id FROM mip_delivery_tasks
         WHERE app_id = ? AND status = 'PROCESSING' AND attempts >= ?
           AND lease_expires_at < ?
         ORDER BY lease_expires_at, id LIMIT ? FOR UPDATE SKIP LOCKED`,
        [appId, MAX_ATTEMPTS, now, batchSize],
      )
      if (exhausted.length) {
        const exhaustedIds = exhausted.map(row => row.id)
        const exhaustedPlaceholders = exhaustedIds.map(() => '?').join(', ')
        await tx.query(
          `UPDATE mip_notification_grants
           SET status = 'EXPIRED', reservation_task_id = NULL,
               reservation_token = NULL, reservation_expires_at = NULL
           WHERE app_id = ? AND status = 'RESERVED'
             AND reservation_task_id IN (${exhaustedPlaceholders})`,
          [appId, ...exhaustedIds],
        )
        await tx.query(
          `UPDATE mip_delivery_tasks
           SET status = 'CANCELLED', lease_expires_at = NULL,
               last_error_code = 'DELIVERY_OUTCOME_UNKNOWN'
           WHERE app_id = ? AND status = 'PROCESSING' AND attempts >= ?
             AND id IN (${exhaustedPlaceholders})`,
          [appId, MAX_ATTEMPTS, ...exhaustedIds],
        )
      }

      const rows = await tx.query(
        `SELECT id FROM mip_delivery_tasks
         WHERE app_id = ? AND attempts < ? AND available_at <= ?
           AND (status IN ('PENDING', 'FAILED') OR (status = 'PROCESSING' AND lease_expires_at < ?))
         ORDER BY available_at, id LIMIT ? FOR UPDATE SKIP LOCKED`,
        [appId, MAX_ATTEMPTS, now, now, batchSize],
      )
      if (!rows.length) return []
      const ids = rows.map(row => row.id)
      const placeholders = ids.map(() => '?').join(', ')
      await tx.query(
        `UPDATE mip_delivery_tasks
         SET status = 'PROCESSING', attempts = attempts + 1, lease_expires_at = ?, last_error_code = NULL
         WHERE app_id = ? AND id IN (${placeholders})`,
        [leaseExpiresAt, appId, ...ids],
      )
      const tasks = await tx.query(
        `SELECT id, app_id, attempts, lease_expires_at
         FROM mip_delivery_tasks
         WHERE app_id = ? AND id IN (${placeholders})
         ORDER BY available_at, id`,
        [appId, ...ids],
      )
      return tasks.map(row => ({ ...row, leaseKey: iso(row.lease_expires_at) }))
    })
  }

  async function reserveTask(task) {
    const reservationToken = createId()
    return database.transaction(async (tx) => {
      const current = await tx.one(
        `SELECT t.id, t.app_id, t.channel, t.template_key, t.payload_json,
                t.attempts, t.lease_expires_at, m.recipient_user_id, m.target_route
         FROM mip_delivery_tasks t
         INNER JOIN mip_inbox_messages m ON m.app_id = t.app_id AND m.id = t.inbox_message_id
         INNER JOIN mip_users u
           ON u.app_id = m.app_id AND u.id = m.recipient_user_id AND u.status = 'ACTIVE'
         WHERE t.app_id = ? AND t.id = ? AND t.status = 'PROCESSING' FOR UPDATE`,
        [task.app_id, task.id],
      )
      assertTaskLease(current, task)

      if (current.channel === 'WECHAT_SERVICE_ACCOUNT') {
        return reservationDto(current, null, null)
      }

      let grant = await tx.one(
        `SELECT id, recipient_hash, recipient_ciphertext
         FROM mip_notification_grants
         WHERE app_id = ? AND status = 'RESERVED' AND reservation_task_id = ?
           AND user_id = ? AND channel = ? AND template_key = ?
         LIMIT 1 FOR UPDATE`,
        [
          task.app_id,
          task.id,
          current.recipient_user_id,
          current.channel,
          current.template_key,
        ],
      )
      if (!grant) {
        grant = await tx.one(
          `SELECT id, recipient_hash, recipient_ciphertext
           FROM mip_notification_grants
           WHERE app_id = ? AND user_id = ? AND channel = ? AND template_key = ?
             AND status = 'AVAILABLE' AND (expires_at IS NULL OR expires_at > UTC_TIMESTAMP(3))
           ORDER BY granted_at, id LIMIT 1 FOR UPDATE`,
          [task.app_id, current.recipient_user_id, current.channel, current.template_key],
        )
        if (!grant) throw new Error('GRANT_UNAVAILABLE')
        const update = await tx.query(
          `UPDATE mip_notification_grants
           SET status = 'RESERVED', reservation_task_id = ?, reservation_token = ?,
               reservation_expires_at = ?
           WHERE app_id = ? AND id = ? AND status = 'AVAILABLE'
             AND reservation_task_id IS NULL AND reservation_token IS NULL`,
          [task.id, reservationToken, current.lease_expires_at, task.app_id, grant.id],
        )
        assertAffected(update, 'DELIVERY_RESERVATION_LOST')
      }
      else {
        const update = await tx.query(
          `UPDATE mip_notification_grants
           SET reservation_token = ?, reservation_expires_at = ?
           WHERE app_id = ? AND id = ? AND status = 'RESERVED'
             AND reservation_task_id = ?`,
          [reservationToken, current.lease_expires_at, task.app_id, grant.id, task.id],
        )
        assertAffected(update, 'DELIVERY_RESERVATION_LOST')
      }

      return reservationDto(current, grant, reservationToken)
    })
  }

  async function deliverReservedTask(reservation, deliver, input = {}) {
    const now = input.now || new Date()
    if (typeof deliver !== 'function') throw new Error('DELIVERY_SENDER_INVALID')
    // Retrying this transaction could repeat a provider call after an uncertain commit.
    return database.transaction(async (tx) => {
      const recipient = await tx.one(
        `SELECT id, status FROM mip_users
         WHERE app_id = ? AND id = ? FOR UPDATE`,
        [reservation.app_id, reservation.recipient_user_id],
      )
      const current = await tx.one(
        `SELECT id, app_id, status, attempts, lease_expires_at
         FROM mip_delivery_tasks
         WHERE app_id = ? AND id = ? FOR UPDATE`,
        [reservation.app_id, reservation.taskId],
      )
      assertReservationTask(current, reservation)
      const grant = reservation.grant
        ? await tx.one(
            `SELECT id, user_id, channel, template_key, status, expires_at,
                    reservation_task_id, reservation_token
             FROM mip_notification_grants
             WHERE app_id = ? AND id = ? FOR UPDATE`,
            [reservation.app_id, reservation.grant.id],
          )
        : null
      if (reservation.grant) {
        assertGrantReservation(grant, reservation)
        assertGrantScope(grant, reservation)
      }
      if (!recipient || recipient.status !== 'ACTIVE') {
        const grantUpdate = reservation.grant
          ? await expireReservationGrant(tx, reservation)
          : null
        const taskUpdate = await tx.query(
          `UPDATE mip_delivery_tasks
           SET status = 'CANCELLED', lease_expires_at = NULL,
               last_error_code = 'DELIVERY_RECIPIENT_INACTIVE'
           WHERE app_id = ? AND id = ? AND status = 'PROCESSING' AND lease_expires_at = ?`,
          [reservation.app_id, reservation.taskId, reservation.lease_expires_at],
        )
        if (grantUpdate) assertAffected(grantUpdate, 'DELIVERY_RESERVATION_LOST')
        assertAffected(taskUpdate, 'DELIVERY_LEASE_LOST')
        return {
          taskId: reservation.taskId,
          status: 'CANCELLED',
          errorCode: 'DELIVERY_RECIPIENT_INACTIVE',
        }
      }

      if (grant && grant.expires_at && new Date(grant.expires_at).getTime() <= now.getTime()) {
        const grantUpdate = await expireReservationGrant(tx, reservation)
        const taskUpdate = await tx.query(
          `UPDATE mip_delivery_tasks
           SET status = 'CANCELLED', lease_expires_at = NULL,
               last_error_code = 'DELIVERY_WINDOW_EXPIRED'
           WHERE app_id = ? AND id = ? AND status = 'PROCESSING' AND lease_expires_at = ?`,
          [reservation.app_id, reservation.taskId, reservation.lease_expires_at],
        )
        assertAffected(grantUpdate, 'DELIVERY_RESERVATION_LOST')
        assertAffected(taskUpdate, 'DELIVERY_LEASE_LOST')
        return {
          taskId: reservation.taskId,
          status: 'CANCELLED',
          errorCode: 'DELIVERY_WINDOW_EXPIRED',
        }
      }

      let deliveryError = null
      try {
        await deliver()
      }
      catch (error) {
        deliveryError = safeErrorCode(error instanceof Error ? error.message : '')
      }

      if (deliveryError) {
        return settleAttemptedFailure(tx, current, reservation, deliveryError, now)
      }

      const grantUpdate = reservation.grant
        ? await completeReservationGrant(tx, reservation)
        : null
      const taskUpdate = await tx.query(
        `UPDATE mip_delivery_tasks
         SET status = 'DELIVERED', delivered_at = UTC_TIMESTAMP(3), lease_expires_at = NULL
         WHERE app_id = ? AND id = ? AND status = 'PROCESSING' AND lease_expires_at = ?`,
        [reservation.app_id, reservation.taskId, reservation.lease_expires_at],
      )
      if (grantUpdate) assertAffected(grantUpdate, 'DELIVERY_RESERVATION_LOST')
      assertAffected(taskUpdate, 'DELIVERY_LEASE_LOST')
      return { taskId: reservation.taskId, status: 'DELIVERED' }
    }, 1)
  }

  async function failReservedTask(reservation, errorCode, input = {}) {
    const now = input.now || new Date()
    const externalAttempted = input.externalAttempted === true
    const code = safeErrorCode(errorCode)
    return database.transaction(async (tx) => {
      const current = await tx.one(
        `SELECT id, app_id, status, attempts, lease_expires_at
         FROM mip_delivery_tasks
         WHERE app_id = ? AND id = ? FOR UPDATE`,
        [reservation.app_id, reservation.taskId],
      )
      assertReservationTask(current, reservation)
      const grant = reservation.grant
        ? await tx.one(
            `SELECT id, status, reservation_task_id, reservation_token
             FROM mip_notification_grants
             WHERE app_id = ? AND id = ? FOR UPDATE`,
            [reservation.app_id, reservation.grant.id],
          )
        : null
      if (reservation.grant) assertGrantReservation(grant, reservation)

      const terminal = Number(current.attempts) >= MAX_ATTEMPTS
      if (reservation.grant && (!externalAttempted || terminal)) {
        const nextGrantStatus = externalAttempted
          && reservation.channel !== 'WECHAT_CUSTOMER_SERVICE' ? 'EXPIRED' : 'AVAILABLE'
        const grantUpdate = await tx.query(
          `UPDATE mip_notification_grants
           SET status = ?, reservation_task_id = NULL, reservation_token = NULL,
               reservation_expires_at = NULL
           WHERE app_id = ? AND id = ? AND status = 'RESERVED'
             AND reservation_task_id = ? AND reservation_token = ?`,
          [
            nextGrantStatus,
            reservation.app_id,
            reservation.grant.id,
            reservation.taskId,
            reservation.reservationToken,
          ],
        )
        assertAffected(grantUpdate, 'DELIVERY_RESERVATION_LOST')
      }

      const status = terminal ? 'CANCELLED' : 'FAILED'
      const availableAt = new Date(now.getTime() + retryDelayMs(Number(current.attempts)))
      const taskUpdate = await tx.query(
        `UPDATE mip_delivery_tasks
         SET status = ?, available_at = ?, lease_expires_at = NULL, last_error_code = ?
         WHERE app_id = ? AND id = ? AND status = 'PROCESSING' AND lease_expires_at = ?`,
        [status, availableAt, code, reservation.app_id, reservation.taskId, reservation.lease_expires_at],
      )
      assertAffected(taskUpdate, 'DELIVERY_LEASE_LOST')
      return failureResult(reservation.taskId, status, code, availableAt)
    })
  }

  async function failLeasedTask(task, errorCode, now = new Date()) {
    const code = safeErrorCode(errorCode)
    return database.transaction(async (tx) => {
      const current = await tx.one(
        `SELECT id, app_id, status, attempts, lease_expires_at
         FROM mip_delivery_tasks
         WHERE app_id = ? AND id = ? FOR UPDATE`,
        [task.app_id, task.id],
      )
      assertTaskLease(current, task)
      const terminal = Number(current.attempts) >= MAX_ATTEMPTS
      if (terminal) {
        await tx.query(
          `UPDATE mip_notification_grants
           SET status = 'EXPIRED', reservation_task_id = NULL,
               reservation_token = NULL, reservation_expires_at = NULL
           WHERE app_id = ? AND status = 'RESERVED' AND reservation_task_id = ?`,
          [task.app_id, task.id],
        )
      }
      const status = terminal ? 'CANCELLED' : 'FAILED'
      const availableAt = new Date(now.getTime() + retryDelayMs(Number(current.attempts)))
      const update = await tx.query(
        `UPDATE mip_delivery_tasks
         SET status = ?, available_at = ?, lease_expires_at = NULL, last_error_code = ?
         WHERE app_id = ? AND id = ? AND status = 'PROCESSING' AND lease_expires_at = ?`,
        [status, availableAt, code, task.app_id, task.id, current.lease_expires_at],
      )
      assertAffected(update, 'DELIVERY_LEASE_LOST')
      return failureResult(task.id, status, code, availableAt)
    })
  }

  return {
    deliverReservedTask,
    failLeasedTask,
    failReservedTask,
    leaseTasks,
    publishMessage,
    reserveTask,
  }
}

function reservationDto(task, grant, reservationToken) {
  return {
    taskId: task.id,
    app_id: task.app_id,
    channel: task.channel,
    template_key: task.template_key,
    payload_json: task.payload_json,
    attempts: Number(task.attempts),
    lease_expires_at: task.lease_expires_at,
    leaseKey: iso(task.lease_expires_at),
    recipient_user_id: task.recipient_user_id,
    target_route: task.target_route,
    ...(reservationToken ? { reservationToken } : {}),
    ...(grant ? {
      grant: {
        id: grant.id,
        recipient_hash: grant.recipient_hash,
        recipient_ciphertext: grant.recipient_ciphertext,
      },
    } : {}),
  }
}

function assertTaskLease(current, task) {
  if (!current || (current.status !== undefined && current.status !== 'PROCESSING')
    || iso(current.lease_expires_at) !== task.leaseKey) {
    throw new Error('DELIVERY_LEASE_LOST')
  }
}

function assertReservationTask(current, reservation) {
  assertTaskLease(current, { leaseKey: reservation.leaseKey })
}

function assertGrantReservation(grant, reservation) {
  if (!grant || grant.status !== 'RESERVED'
    || grant.reservation_task_id !== reservation.taskId
    || grant.reservation_token !== reservation.reservationToken) {
    throw new Error('DELIVERY_RESERVATION_LOST')
  }
}

function assertGrantScope(grant, reservation) {
  if (grant.user_id !== reservation.recipient_user_id
    || grant.channel !== reservation.channel
    || grant.template_key !== reservation.template_key) {
    throw new Error('DELIVERY_RESERVATION_LOST')
  }
}

async function settleAttemptedFailure(tx, current, reservation, errorCode, now) {
  const terminal = Number(current.attempts) >= MAX_ATTEMPTS
  if (reservation.grant && (terminal || reservation.channel === 'WECHAT_CUSTOMER_SERVICE')) {
    const grantUpdate = reservation.channel === 'WECHAT_CUSTOMER_SERVICE'
      ? await releaseReservationGrant(tx, reservation)
      : await expireReservationGrant(tx, reservation)
    assertAffected(grantUpdate, 'DELIVERY_RESERVATION_LOST')
  }
  const availableAt = new Date(now.getTime() + retryDelayMs(Number(current.attempts)))
  const status = terminal ? 'CANCELLED' : 'FAILED'
  const taskUpdate = await tx.query(
    `UPDATE mip_delivery_tasks
     SET status = ?, available_at = ?, lease_expires_at = NULL, last_error_code = ?
     WHERE app_id = ? AND id = ? AND status = 'PROCESSING' AND lease_expires_at = ?`,
    [status, availableAt, errorCode, reservation.app_id, reservation.taskId, reservation.lease_expires_at],
  )
  assertAffected(taskUpdate, 'DELIVERY_LEASE_LOST')
  return failureResult(reservation.taskId, status, errorCode, availableAt)
}

function completeReservationGrant(tx, reservation) {
  if (reservation.channel === 'WECHAT_CUSTOMER_SERVICE') {
    return releaseReservationGrant(tx, reservation)
  }
  return tx.query(
    `UPDATE mip_notification_grants
     SET status = 'CONSUMED', consumed_at = UTC_TIMESTAMP(3),
         reservation_task_id = NULL, reservation_token = NULL,
         reservation_expires_at = NULL
     WHERE app_id = ? AND id = ? AND status = 'RESERVED'
       AND reservation_task_id = ? AND reservation_token = ?`,
    [
      reservation.app_id,
      reservation.grant.id,
      reservation.taskId,
      reservation.reservationToken,
    ],
  )
}

function expireReservationGrant(tx, reservation) {
  return tx.query(
    `UPDATE mip_notification_grants
     SET status = 'EXPIRED', reservation_task_id = NULL, reservation_token = NULL,
         reservation_expires_at = NULL
     WHERE app_id = ? AND id = ? AND status = 'RESERVED'
       AND reservation_task_id = ? AND reservation_token = ?`,
    [
      reservation.app_id,
      reservation.grant.id,
      reservation.taskId,
      reservation.reservationToken,
    ],
  )
}

function releaseReservationGrant(tx, reservation) {
  return tx.query(
    `UPDATE mip_notification_grants
     SET status = 'AVAILABLE', reservation_task_id = NULL, reservation_token = NULL,
         reservation_expires_at = NULL
     WHERE app_id = ? AND id = ? AND status = 'RESERVED'
       AND reservation_task_id = ? AND reservation_token = ?`,
    [
      reservation.app_id,
      reservation.grant.id,
      reservation.taskId,
      reservation.reservationToken,
    ],
  )
}

function failureResult(taskId, status, errorCode, availableAt) {
  return {
    taskId,
    status,
    errorCode,
    ...(status === 'FAILED' ? { retryAt: iso(availableAt) } : {}),
  }
}

function assertAffected(result, code) {
  if (Number(result?.affectedRows) !== 1) throw new Error(code)
}

function messageDto(row) {
  const target = row.target_type && row.target_id && row.target_route
    ? { type: row.target_type, id: row.target_id, route: row.target_route }
    : undefined
  return {
    id: row.id,
    recipientUserId: row.recipient_user_id,
    messageType: row.message_type,
    title: row.title,
    body: row.body,
    target,
    readAt: row.read_at ? iso(row.read_at) : undefined,
    createdAt: iso(row.created_at),
  }
}

function retryDelayMs(attempts) {
  return Math.min(8_000, Math.max(500, 2 ** Math.max(0, attempts - 1) * 500))
}

function safeErrorCode(value) {
  const code = String(value || 'DELIVERY_FAILED').toUpperCase().replace(/[^A-Z0-9_]/g, '_')
  return code.slice(0, 64) || 'DELIVERY_FAILED'
}

function iso(value) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : date.toISOString()
}

module.exports = {
  MAX_ATTEMPTS,
  createNotificationRepository,
  messageDto,
  retryDelayMs,
  safeErrorCode,
}
