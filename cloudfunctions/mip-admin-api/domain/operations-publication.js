'use strict'

const { createHash, randomUUID } = require('node:crypto')

const EVENT_REMINDER_OPERATION = 'admin.communications.publish'
const MAX_EVENT_REMINDER_RECIPIENTS = 500

function createOperationsPublisher(options = {}) {
  const createId = options.createId || randomUUID
  const writeAudit = options.writeAudit
  const lockMutationAuthorization = options.lockMutationAuthorization
  const assertMutationScope = options.assertMutationScope
  const maximumRecipients = boundedMaximum(options.maximumRecipients)

  return {
    async publishEventReminder(tx, input) {
      if (!tx || typeof tx.one !== 'function' || typeof tx.query !== 'function'
        || typeof writeAudit !== 'function' || typeof input.audit !== 'function'
        || typeof lockMutationAuthorization !== 'function'
        || typeof assertMutationScope !== 'function') {
        throw codeError('OPERATIONS_PUBLISHER_CONFIG_REQUIRED')
      }
      const authorization = await lockMutationAuthorization(tx, input)
      const requestHash = eventReminderRequestHash(input)
      const event = await tx.one(
        `SELECT id, branch_id, status, version, title, description,
          DATE_FORMAT(CONVERT_TZ(starts_at, '+00:00', '+08:00'), '%Y-%m-%d %H:%i') AS starts_at_label,
          COALESCE(NULLIF(TRIM(venue_name), ''),
            CASE WHEN event_mode IN ('ONLINE', 'HYBRID') THEN '线上活动' ELSE NULL END,
            NULLIF(TRIM(city_name), ''), '活动地点') AS location_label
         FROM mip_events
         WHERE app_id = ? AND id = ? FOR UPDATE`,
        [input.appId, input.eventId],
      )
      if (!event) throw codeError('NOT_FOUND')
      const currentScope = {
        scopeType: 'EVENT',
        scopeId: input.eventId,
        branchId: event.branch_id || null,
      }
      assertMutationScope(authorization, currentScope)
      if (input.authorizedScope
        && (input.authorizedScope.scopeType !== currentScope.scopeType
          || input.authorizedScope.scopeId !== currentScope.scopeId
          || (input.authorizedScope.branchId || null) !== currentScope.branchId)) {
        throw codeError('CONFLICT')
      }
      if (Number(event.version) !== input.expectedVersion) throw codeError('CONFLICT')
      if (event.status !== 'PUBLISHED') throw codeError('COMMUNICATIONS_EVENT_NOT_PUBLISHED')
      const claim = await claimRequest(tx, input, requestHash, createId)
      if (claim.replay) return { ...claim.replay, idempotent: true }

      const recipients = await tx.query(
        `SELECT registration.user_id
         FROM mip_event_registrations registration
         INNER JOIN mip_users recipient
           ON recipient.app_id = registration.app_id
          AND recipient.id = registration.user_id
          AND recipient.status = 'ACTIVE'
         WHERE registration.app_id = ? AND registration.event_id = ?
           AND registration.status IN ('REGISTERED', 'ATTENDED')
         ORDER BY registration.user_id
         LIMIT ? FOR UPDATE`,
        [input.appId, input.eventId, maximumRecipients + 1],
      )
      if (recipients.length > maximumRecipients) {
        throw codeError('COMMUNICATIONS_RECIPIENT_LIMIT_EXCEEDED')
      }

      const facts = eventReminderFacts(event, input.sendWechatReminder)
      if (recipients.length) {
        await insertRecipientFacts(tx, {
          ...input,
          createId,
          facts,
          publicationId: claim.publicationId,
          recipients,
        })
      }
      const response = {
        publicationId: claim.publicationId,
        recipientCount: recipients.length,
        sendWechatReminder: input.sendWechatReminder,
        wechatDelivery: input.sendWechatReminder ? 'BEST_EFFORT' : 'NOT_REQUESTED',
        idempotent: false,
      }
      await writeAudit(tx, input.audit(claim.publicationId, {
        recipientCount: recipients.length,
        sendWechatReminder: input.sendWechatReminder,
      }))
      const completed = await tx.query(
        `UPDATE mip_idempotency_keys SET status = 'COMPLETED', response_json = ?
         WHERE app_id = ? AND actor_user_id = ? AND operation = ?
           AND idempotency_key = ? AND request_hash = ? AND status = 'RUNNING'`,
        [JSON.stringify(response), input.appId, input.actorUserId, EVENT_REMINDER_OPERATION,
          input.idempotencyKey, requestHash],
      )
      if (Number(completed.affectedRows) !== 1) throw codeError('CONFLICT')
      return response
    },
  }
}

async function claimRequest(tx, input, requestHash, createId) {
  const publicationId = createId()
  try {
    await tx.query(
      `INSERT INTO mip_idempotency_keys (
        id, app_id, actor_user_id, operation, idempotency_key,
        request_hash, status, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'RUNNING', DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 24 HOUR))`,
      [publicationId, input.appId, input.actorUserId, EVENT_REMINDER_OPERATION,
        input.idempotencyKey, requestHash],
    )
    return { publicationId, replay: null }
  }
  catch (error) {
    if (error?.code !== 'ER_DUP_ENTRY' && Number(error?.errno) !== 1062) throw error
  }
  const stored = await tx.one(
    `SELECT id, request_hash, status, response_json
     FROM mip_idempotency_keys
     WHERE app_id = ? AND actor_user_id = ? AND operation = ? AND idempotency_key = ?
     FOR UPDATE`,
    [input.appId, input.actorUserId, EVENT_REMINDER_OPERATION, input.idempotencyKey],
  )
  if (!stored || stored.request_hash !== requestHash) {
    throw codeError('COMMUNICATIONS_IDEMPOTENCY_CONFLICT')
  }
  if (stored.status !== 'COMPLETED') {
    throw codeError('COMMUNICATIONS_REQUEST_IN_PROGRESS', true)
  }
  return { publicationId: stored.id, replay: publicationResponse(stored.response_json) }
}

async function insertRecipientFacts(tx, input) {
  const messages = input.recipients.map(recipient => ({
    messageId: input.createId(),
    outboxEventId: input.createId(),
    recipientUserId: recipient.user_id,
  }))
  const messageValues = messages.map(() => '(?, ?, ?, ?, \'EVENT\', NULL, ?, ?, ?, ?, \'EVENT\', ?, ?, ?, \'PUBLISHED\', 1)').join(', ')
  const messageParams = messages.flatMap(message => [
    message.messageId,
    input.appId,
    input.publicationId,
    input.actorUserId,
    input.eventId,
    message.recipientUserId,
    input.facts.title,
    input.facts.body,
    input.eventId,
    input.facts.templateKey,
    input.facts.templatePayload ? JSON.stringify(input.facts.templatePayload) : null,
  ])
  await tx.query(
    `INSERT INTO mip_operations_messages (
      id, app_id, publication_id, created_by_user_id, scope_type,
      branch_id, event_id, recipient_user_id, title, body,
      target_type, target_id, template_key, template_payload_json,
      status, version
    ) VALUES ${messageValues}`,
    messageParams,
  )

  const outboxValues = messages.map(() => "(?, ?, 'OPERATIONS_MESSAGE', ?, 'operations.notification_published', 1, '{}', 'PENDING')").join(', ')
  const outboxParams = messages.flatMap(message => [
    message.outboxEventId,
    input.appId,
    message.messageId,
  ])
  await tx.query(
    `INSERT INTO mip_outbox_events (
      id, app_id, aggregate_type, aggregate_id, event_type,
      source_version, payload_json, status
    ) VALUES ${outboxValues}`,
    outboxParams,
  )
}

function eventReminderFacts(event, sendWechatReminder) {
  const eventTitle = boundedText(event?.title, 120)
  const startsAt = boundedText(event?.starts_at_label, 100)
  const location = boundedText(event?.location_label, 160)
  if (!eventTitle || !startsAt || !location) {
    throw codeError('COMMUNICATIONS_EVENT_FACT_INVALID')
  }
  const description = boundedText(event?.description_label || event?.description, 100) || eventTitle
  const title = truncateText(`活动提醒：${eventTitle}`, 100)
  const body = `活动“${eventTitle}”将于 ${startsAt} 开始，地点：${location}。`
  if (body.length > 500) throw codeError('COMMUNICATIONS_EVENT_FACT_INVALID')
  return {
    title,
    body,
    templateKey: sendWechatReminder ? 'EVENT_REMINDER' : null,
    templatePayload: sendWechatReminder
      ? {
          fields: {
            title: truncateText(eventTitle, 100),
            startsAt,
            description: truncateText(description, 100),
            location: truncateText(location, 100),
          },
        }
      : null,
  }
}

function eventReminderRequestHash(input) {
  return createHash('sha256')
    .update(`${input.eventId}\0${input.expectedVersion}\0${input.sendWechatReminder ? 1 : 0}`)
    .digest('hex')
}

function publicationResponse(value) {
  const parsed = parseObject(value)
  if (typeof parsed.publicationId !== 'string'
    || !Number.isInteger(parsed.recipientCount) || parsed.recipientCount < 0
    || typeof parsed.sendWechatReminder !== 'boolean'
    || !['BEST_EFFORT', 'NOT_REQUESTED'].includes(parsed.wechatDelivery)) {
    throw codeError('COMMUNICATIONS_IDEMPOTENCY_INVALID')
  }
  return parsed
}

function parseObject(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value
  try {
    const parsed = JSON.parse(value || '{}')
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  }
  catch {
    return {}
  }
}

function boundedText(value, maximum) {
  const normalized = typeof value === 'string' ? value.trim() : ''
  return normalized && normalized.length <= maximum ? normalized : ''
}

function truncateText(value, maximum) {
  return Array.from(value).slice(0, maximum).join('')
}

function boundedMaximum(value) {
  const parsed = Number(value || MAX_EVENT_REMINDER_RECIPIENTS)
  return Number.isInteger(parsed) && parsed > 0 && parsed <= MAX_EVENT_REMINDER_RECIPIENTS
    ? parsed
    : MAX_EVENT_REMINDER_RECIPIENTS
}

function codeError(code, retryable = false) {
  const error = new Error(code)
  error.code = code
  error.retryable = retryable
  return error
}

module.exports = {
  EVENT_REMINDER_OPERATION,
  MAX_EVENT_REMINDER_RECIPIENTS,
  createOperationsPublisher,
  eventReminderFacts,
  eventReminderRequestHash,
}
