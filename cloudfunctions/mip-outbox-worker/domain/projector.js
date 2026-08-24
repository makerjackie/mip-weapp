'use strict'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const SUBSTANTIVE_EVENT_FIELDS = new Set([
  'accessType',
  'address',
  'branchId',
  'cancellationDeadline',
  'capacity',
  'cityName',
  'description',
  'endsAt',
  'eventMode',
  'eventTypeKey',
  'latitude',
  'longitude',
  'mode',
  'notices',
  'onlineUrl',
  'priceCents',
  'registrationDeadline',
  'registrationOpensAt',
  'registrationPolicy',
  'registrationSchema',
  'scopeType',
  'startsAt',
  'summary',
  'title',
  'venueName',
  'waitlistEnabled',
])

const NO_PROJECTION_EVENT_TYPES = new Set([
  'admin.refund_requested',
  'announcement.published',
  'announcement.withdrawn',
  'event.created',
  'event.feedback_submitted',
  'event.published',
  'identity.user_registered',
  'membership.order_created',
  'membership.refund_requested',
  'opportunity.published',
])

async function projectEvent(database, event) {
  assertEvent(event)
  switch (event.event_type) {
    case 'identity.profile_completed':
      return projectProfileCompleted(database, event)
    case 'membership.payment_confirmed':
      return projectMembershipPayment(database, event)
    case 'membership.refund_confirmed':
      return projectMembershipRefund(database, event)
    case 'event.registration_submitted':
    case 'event.registration_confirmed':
    case 'event.registration_waitlisted':
    case 'event.registration_rejected':
    case 'event.registration_refund_requested':
    case 'event.registration_cancelled':
    case 'event.refund_confirmed':
      return projectRegistration(database, event)
    case 'event.checked_in':
      return event.aggregate_type === 'EVENT_CHECKIN_TRANSITION'
        ? projectCheckInTransition(database, event)
        : projectCheckIn(database, event)
    case 'event.checkin_revoked':
      return projectCheckInTransition(database, event)
    case 'event.status_changed':
    case 'event.updated':
      return projectEventNotice(database, event)
    case 'growth.changed':
      return projectGrowthChanged(database, event)
    case 'operations.notification_published':
      return projectOperationsNotification(database, event)
    case 'event.heart_changed':
      return projectHeart(database, event)
    case 'opportunity.referral_changed':
      return projectReferral(database, event)
    case 'profile.interest_changed':
      return projectInterest(database, event)
    case 'super_case.published':
      return projectSuperCasePublished(database, event)
    default:
      return NO_PROJECTION_EVENT_TYPES.has(event.event_type)
        ? projection([], [], 'NO_PROJECTION_REQUIRED')
        : { supported: false, notifications: [], growth: [], reason: 'EVENT_TYPE_UNSUPPORTED' }
  }
}

async function projectProfileCompleted(database, event) {
  assertAggregate(event, 'USER')
  const row = await database.one(
    `SELECT u.id AS user_id
     FROM mip_users u
     INNER JOIN mip_profiles p ON p.app_id = u.app_id AND p.user_id = u.id
     WHERE u.app_id = ? AND u.id = ? AND u.status = 'ACTIVE'
       AND NULLIF(TRIM(p.nickname), '') IS NOT NULL`,
    [event.app_id, event.aggregate_id],
  )
  if (!row) return projection([], [], 'FACT_NO_LONGER_CURRENT')
  return projection([], [growth(event, row.user_id)], 'PROJECTED')
}

async function projectSuperCasePublished(database, event) {
  assertAggregate(event, 'SUPER_CASE')
  const row = await database.one(
    `SELECT c.owner_user_id
     FROM mip_super_cases c
     INNER JOIN mip_users u
       ON u.app_id = c.app_id AND u.id = c.owner_user_id AND u.status = 'ACTIVE'
     WHERE c.app_id = ? AND c.id = ? AND c.status = 'PUBLISHED'
       AND c.published_at IS NOT NULL`,
    [event.app_id, event.aggregate_id],
  )
  if (!row) return projection([], [], 'FACT_NO_LONGER_CURRENT')
  return projection([], [growth(event, row.owner_user_id)], 'PROJECTED')
}

async function projectMembershipPayment(database, event) {
  assertAggregate(event, 'ORDER')
  const row = await database.one(
    `SELECT o.id AS order_id, o.user_id
     FROM mip_orders o
     INNER JOIN mip_users u ON u.app_id = o.app_id AND u.id = o.user_id AND u.status = 'ACTIVE'
     WHERE o.app_id = ? AND o.id = ? AND o.order_type = 'MEMBERSHIP'
       AND o.paid_at IS NOT NULL`,
    [event.app_id, event.aggregate_id],
  )
  if (!row) return projection([], [], 'FACT_NO_LONGER_CURRENT')
  return projection([
    message(event, row.user_id, 'payment-confirmed', {
      messageType: 'MEMBERSHIP',
      title: '会员支付已确认',
      body: '会员权益已按支付结果更新。',
      targetType: 'ORDER',
      targetId: row.order_id,
    }),
  ], [], 'PROJECTED')
}

async function projectMembershipRefund(database, event) {
  assertAggregate(event, 'REFUND')
  const row = await database.one(
    `SELECT r.id AS refund_id, o.id AS order_id, o.user_id
     FROM mip_refunds r
     INNER JOIN mip_orders o ON o.app_id = r.app_id AND o.id = r.order_id
     INNER JOIN mip_users u ON u.app_id = o.app_id AND u.id = o.user_id AND u.status = 'ACTIVE'
     WHERE r.app_id = ? AND r.id = ? AND r.status = 'SUCCEEDED'
       AND o.order_type = 'MEMBERSHIP'`,
    [event.app_id, event.aggregate_id],
  )
  if (!row) return projection([], [], 'FACT_NO_LONGER_CURRENT')
  return projection([
    message(event, row.user_id, 'refund-confirmed', {
      messageType: 'MEMBERSHIP',
      title: '会员退款已完成',
      body: '退款结果和会员权益已更新。',
      targetType: 'ORDER',
      targetId: row.order_id,
    }),
  ], [], 'PROJECTED')
}

async function projectRegistration(database, event) {
  assertAggregate(event, event.event_type === 'event.refund_confirmed' ? 'REFUND' : 'EVENT_REGISTRATION')
  const row = event.event_type === 'event.refund_confirmed'
    ? await refundedRegistration(database, event)
    : await registration(database, event)
  if (!row) return projection([], [], 'FACT_NO_LONGER_CURRENT')
  if (row.cancelled_by_type === 'EVENT'
    && ['event.registration_cancelled', 'event.registration_refund_requested'].includes(event.event_type)) {
    return projection([], [], 'PROJECTED_BY_EVENT_NOTICE')
  }
  const details = registrationMessage(event.event_type, row.status)
  if (!details) return projection([], [], 'FACT_NO_LONGER_CURRENT')
  return projection([
    message(event, row.user_id, details.key, {
      messageType: 'EVENT',
      title: details.title,
      body: details.body,
      targetType: 'EVENT',
      targetId: row.event_id,
    }),
  ], [], 'PROJECTED')
}

async function registration(database, event) {
  return database.one(
    `SELECT r.id, r.user_id, r.status, r.event_id, r.cancelled_by_type
     FROM mip_event_registrations r
     INNER JOIN mip_events e ON e.app_id = r.app_id AND e.id = r.event_id
     INNER JOIN mip_users u ON u.app_id = r.app_id AND u.id = r.user_id AND u.status = 'ACTIVE'
     WHERE r.app_id = ? AND r.id = ?`,
    [event.app_id, event.aggregate_id],
  )
}

async function refundedRegistration(database, event) {
  return database.one(
    `SELECT r.id, r.user_id, r.status, r.event_id
     FROM mip_refunds f
     INNER JOIN mip_orders o ON o.app_id = f.app_id AND o.id = f.order_id AND o.order_type = 'EVENT'
     INNER JOIN mip_event_registrations r ON r.app_id = o.app_id AND r.order_id = o.id
     INNER JOIN mip_events e ON e.app_id = r.app_id AND e.id = r.event_id
     INNER JOIN mip_users u ON u.app_id = r.app_id AND u.id = r.user_id AND u.status = 'ACTIVE'
     WHERE f.app_id = ? AND f.id = ? AND f.status = 'SUCCEEDED'`,
    [event.app_id, event.aggregate_id],
  )
}

function registrationMessage(eventType, status) {
  const entries = {
    'event.registration_submitted': {
      PENDING_REVIEW: ['registration-review', '活动报名已提交', '报名正在审核。'],
      WAITLISTED: ['registration-waitlisted', '活动报名已候补', '当前报名已进入候补名单。'],
      PAYMENT_PENDING: ['registration-payment', '活动报名待支付', '完成支付后，报名结果将由服务端确认。'],
    },
    'event.registration_confirmed': {
      REGISTERED: ['registration-confirmed', '活动报名已确认', '报名资格已确认。'],
      ATTENDED: ['registration-confirmed', '活动报名已确认', '报名资格已确认。'],
    },
    'event.registration_waitlisted': {
      WAITLISTED: ['registration-waitlisted', '活动报名已候补', '当前报名已进入候补名单。'],
    },
    'event.registration_rejected': {
      REJECTED: ['registration-rejected', '活动报名未通过', '本次报名未获得活动资格。'],
    },
    'event.registration_refund_requested': {
      CANCELLATION_PENDING: ['registration-refund', '活动退款处理中', '退款申请已提交，结果以支付记录为准。'],
    },
    'event.registration_cancelled': {
      CANCELLED: ['registration-cancelled', '活动报名已取消', '报名状态已更新。'],
    },
    'event.refund_confirmed': {
      CANCELLED: ['event-refund-confirmed', '活动退款已完成', '退款结果和报名状态已更新。'],
    },
  }
  const item = entries[eventType]?.[status]
  return item ? { key: item[0], title: item[1], body: item[2] } : null
}

async function projectCheckIn(database, event) {
  assertAggregate(event, 'EVENT_REGISTRATION')
  const row = await database.one(
    `SELECT r.user_id, r.event_id, e.title AS event_title,
            c.checked_in_at, transition.id AS transition_id
     FROM mip_event_registrations r
     INNER JOIN mip_events e ON e.app_id = r.app_id AND e.id = r.event_id
     INNER JOIN mip_event_checkins c
       ON c.app_id = r.app_id AND c.registration_id = r.id AND c.status = 'ACTIVE'
     INNER JOIN mip_event_checkin_transitions transition
       ON transition.app_id = c.app_id
      AND transition.checkin_id = c.id
      AND transition.registration_id = r.id
      AND transition.transition_type = 'CHECKED_IN'
      AND transition.registration_version = ?
     INNER JOIN mip_users u ON u.app_id = r.app_id AND u.id = r.user_id AND u.status = 'ACTIVE'
     WHERE r.app_id = ? AND r.id = ? AND r.status = 'ATTENDED'`,
    [event.source_version, event.app_id, event.aggregate_id],
  )
  if (!row) return projection([], [], 'FACT_NO_LONGER_CURRENT')
  return projection([
    message(event, row.user_id, 'checked-in', {
      messageType: 'EVENT',
      title: '活动签到成功',
      body: '到场状态已记录。',
      targetType: 'EVENT',
      targetId: row.event_id,
      external: checkInExternal(row.event_title, row.checked_in_at),
    }),
  ], [checkInGrowth(row.transition_id)], 'PROJECTED')
}

async function projectCheckInTransition(database, event) {
  assertAggregate(event, 'EVENT_CHECKIN_TRANSITION')
  const row = await database.one(
    `SELECT transition.id, transition.transition_type, transition.registration_version,
            transition.reversal_of_transition_id, transition.user_id, transition.event_id,
            transition.occurred_at, event_fact.title AS event_title,
            user.status AS user_status, reversal.id AS reversal_id
     FROM mip_event_checkin_transitions transition
     INNER JOIN mip_event_checkins checkin
       ON checkin.app_id = transition.app_id
      AND checkin.id = transition.checkin_id
      AND checkin.registration_id = transition.registration_id
      AND checkin.event_id = transition.event_id
      AND checkin.user_id = transition.user_id
     INNER JOIN mip_event_registrations registration
       ON registration.app_id = transition.app_id
      AND registration.id = transition.registration_id
      AND registration.event_id = transition.event_id
      AND registration.user_id = transition.user_id
     INNER JOIN mip_users user
       ON user.app_id = transition.app_id AND user.id = transition.user_id
     INNER JOIN mip_events event_fact
       ON event_fact.app_id = transition.app_id AND event_fact.id = transition.event_id
     LEFT JOIN mip_event_checkin_transitions reversal
       ON reversal.app_id = transition.app_id
      AND reversal.reversal_of_transition_id = transition.id
      AND reversal.transition_type = 'REVOKED'
     WHERE transition.app_id = ? AND transition.id = ?`,
    [event.app_id, event.aggregate_id],
  )
  const expectedType = event.event_type === 'event.checked_in' ? 'CHECKED_IN' : 'REVOKED'
  if (!row
    || row.transition_type !== expectedType
    || Number(row.registration_version) !== Number(event.source_version)
    || (expectedType === 'REVOKED' && !row.reversal_of_transition_id)) {
    throw new Error('OUTBOX_EVENT_INVALID')
  }
  const growthEvents = [checkInGrowth(row.id)]
  if (expectedType === 'REVOKED' || row.reversal_id || row.user_status !== 'ACTIVE') {
    return projection([], growthEvents, 'PROJECTED')
  }
  return projection([
    message(event, row.user_id, 'checked-in', {
      messageType: 'EVENT',
      title: '活动签到成功',
      body: '到场状态已记录。',
      targetType: 'EVENT',
      targetId: row.event_id,
      external: checkInExternal(row.event_title, row.occurred_at),
    }),
  ], growthEvents, 'PROJECTED')
}

async function projectEventNotice(database, event) {
  assertAggregate(event, 'EVENT')
  const fact = await database.one(
    `SELECT e.id AS event_id, e.title, e.status, e.version,
            e.published_at, e.unpublished_at, e.cancelled_at,
            change_fact.change_type, change_fact.changed_fields_json,
            change_fact.created_at AS change_created_at,
            (
              SELECT MAX(later_status.source_version)
              FROM mip_event_changes later_status
              WHERE later_status.app_id = e.app_id
                AND later_status.event_id = e.id
                AND later_status.change_type = 'STATUS'
            ) AS latest_status_version
     FROM mip_events e
     INNER JOIN mip_event_changes change_fact
       ON change_fact.app_id = e.app_id
      AND change_fact.event_id = e.id
      AND change_fact.source_version = ?
     WHERE e.app_id = ? AND e.id = ?`,
    [event.source_version, event.app_id, event.aggregate_id],
  )
  const staleUpdate = event.event_type === 'event.updated'
    && Number(fact?.version) !== Number(event.source_version)
  const staleStatus = event.event_type === 'event.status_changed'
    && Number(fact?.latest_status_version) !== Number(event.source_version)
  if (!fact || staleUpdate || staleStatus) {
    return projection([], [], 'FACT_NO_LONGER_CURRENT')
  }
  const details = eventNoticeDetails(event, fact)
  if (!details) return projection([], [], 'FACT_NO_LONGER_CURRENT')
  const recipients = await eventNoticeRecipients(database, event, fact)
  if (!recipients.length) return projection([], [], 'NO_EFFECTIVE_RECIPIENTS')
  return projection(recipients.map((row) => {
    if (!UUID_PATTERN.test(String(row.user_id || ''))) throw new Error('OUTBOX_EVENT_INVALID')
    return message(event, row.user_id, `recipient:${row.user_id}`, {
      messageType: 'EVENT',
      title: details.title,
      body: details.body,
      targetType: 'EVENT',
      targetId: fact.event_id,
    })
  }), [], 'PROJECTED')
}

function eventNoticeDetails(event, fact) {
  const eventTitle = boundedText(fact.title, 120)
  if (!eventTitle || !UUID_PATTERN.test(String(fact.event_id || ''))) {
    throw new Error('OUTBOX_EVENT_INVALID')
  }
  if (event.event_type === 'event.updated') {
    if (!['CONTENT', 'SCHEDULE', 'LOCATION', 'RULES'].includes(fact.change_type)
      || !hasSubstantiveEventChange(fact.changed_fields_json)
      || !atOrAfter(fact.change_created_at, fact.published_at)) {
      return null
    }
    if (fact.status === 'PUBLISHED') {
      return {
        title: '活动信息已更新',
        body: `活动“${eventTitle}”的信息已更新，请查看最新时间、地点和参与说明。`,
      }
    }
    if (fact.status === 'UNPUBLISHED' && wasImplicitlyUnpublished(fact)) {
      return statusNotice('UNPUBLISHED', eventTitle)
    }
    return null
  }
  if (event.event_type !== 'event.status_changed' || fact.change_type !== 'STATUS') return null
  return statusNotice(fact.status, eventTitle)
}

function statusNotice(status, eventTitle) {
  const messages = {
    UNPUBLISHED: ['活动已下架', `活动“${eventTitle}”已下架，请查看活动详情。`],
    CANCELLED: ['活动已取消', `活动“${eventTitle}”已取消，请查看活动详情和相关订单状态。`],
    ENDED: ['活动已结束', `活动“${eventTitle}”已结束。`],
  }
  const item = messages[status]
  return item ? { title: item[0], body: item[1] } : null
}

async function eventNoticeRecipients(database, event, fact) {
  if (fact.status === 'CANCELLED') {
    return database.query(
      `SELECT DISTINCT registration.user_id
       FROM mip_event_registrations registration
       INNER JOIN mip_events current_event
         ON current_event.app_id = registration.app_id
        AND current_event.id = registration.event_id
        AND current_event.version = ?
        AND current_event.status = 'CANCELLED'
       INNER JOIN mip_users recipient
         ON recipient.app_id = registration.app_id
        AND recipient.id = registration.user_id
        AND recipient.status = 'ACTIVE'
       WHERE registration.app_id = ? AND registration.event_id = ?
         AND (
           registration.status = 'ATTENDED'
           OR (
             registration.status IN ('CANCELLED', 'CANCELLATION_PENDING')
             AND registration.cancelled_by_type = 'EVENT'
             AND registration.cancelled_at = current_event.cancelled_at
           )
         )
       ORDER BY registration.user_id`,
      [fact.version, event.app_id, event.aggregate_id],
    )
  }
  return database.query(
    `SELECT DISTINCT registration.user_id
     FROM mip_event_registrations registration
     INNER JOIN mip_events current_event
       ON current_event.app_id = registration.app_id
      AND current_event.id = registration.event_id
      AND current_event.version = ?
      AND current_event.status = ?
     INNER JOIN mip_users recipient
       ON recipient.app_id = registration.app_id
      AND recipient.id = registration.user_id
      AND recipient.status = 'ACTIVE'
     WHERE registration.app_id = ? AND registration.event_id = ?
       AND registration.status IN (
         'PENDING_REVIEW', 'WAITLISTED', 'PAYMENT_PENDING',
         'REGISTERED', 'CANCELLATION_PENDING', 'ATTENDED'
       )
     ORDER BY registration.user_id`,
    [fact.version, fact.status, event.app_id, event.aggregate_id],
  )
}

function hasSubstantiveEventChange(value) {
  return parseArray(value).some(item => SUBSTANTIVE_EVENT_FIELDS.has(item))
}

function parseArray(value) {
  if (Array.isArray(value)) return value.filter(item => typeof item === 'string')
  try {
    const parsed = JSON.parse(value || '[]')
    return Array.isArray(parsed) ? parsed.filter(item => typeof item === 'string') : []
  }
  catch {
    return []
  }
}

function wasImplicitlyUnpublished(fact) {
  if (!fact.published_at) return false
  return !fact.unpublished_at || atOrAfter(fact.published_at, fact.unpublished_at)
}

function atOrAfter(left, right) {
  const leftTime = new Date(left).getTime()
  const rightTime = new Date(right).getTime()
  return Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime >= rightTime
}

async function projectHeart(database, event) {
  assertAggregate(event, 'EVENT_HEART')
  const row = await database.one(
    `SELECT h.target_user_id, h.event_id, h.status, h.version,
            e.title AS event_title
     FROM mip_event_hearts h
     INNER JOIN mip_events e ON e.app_id = h.app_id AND e.id = h.event_id
     INNER JOIN mip_users u
       ON u.app_id = h.app_id AND u.id = h.target_user_id AND u.status = 'ACTIVE'
     WHERE h.app_id = ? AND h.id = ?`,
    [event.app_id, event.aggregate_id],
  )
  if (!row || row.status !== 'ACTIVE' || Number(row.version) !== Number(event.source_version)) {
    return projection([], [], 'FACT_NO_LONGER_CURRENT')
  }
  return projection([
    message(event, row.target_user_id, 'heart', {
      messageType: 'EVENT',
      title: '活动心动选择',
      body: '活动中有新的心动选择。',
      targetType: 'EVENT',
      targetId: row.event_id,
      external: {
        channel: 'WECHAT_SUBSCRIPTION',
        templateKey: 'HEART_RECEIVED',
        fields: {
          title: boundedText(row.event_title, 100),
          status: '收到新的心动选择',
        },
      },
    }),
  ], [], 'PROJECTED')
}

async function projectGrowthChanged(database, event) {
  assertAggregate(event, 'GROWTH_ENTRY')
  const row = await database.one(
    `SELECT entry.id, entry.user_id, entry.metric, entry.delta_value, entry.balance_after
     FROM mip_growth_entries entry
     INNER JOIN mip_users user
       ON user.app_id = entry.app_id AND user.id = entry.user_id AND user.status = 'ACTIVE'
     WHERE entry.app_id = ? AND entry.id = ?
       AND entry.metric IN ('EXPERIENCE', 'CONTRIBUTION')`,
    [event.app_id, event.aggregate_id],
  )
  if (!row) return projection([], [], 'FACT_NO_LONGER_CURRENT')
  if (row.metric !== 'EXPERIENCE' && row.metric !== 'CONTRIBUTION') {
    return projection([], [], 'FACT_OUT_OF_SCOPE')
  }
  const labels = {
    EXPERIENCE: '经验值',
    CONTRIBUTION: '贡献值',
  }
  const label = labels[row.metric]
  const delta = Number(row.delta_value)
  const balance = Number(row.balance_after)
  if (!label || !Number.isFinite(delta) || !Number.isFinite(balance)) {
    throw new Error('OUTBOX_EVENT_INVALID')
  }
  return projection([
    message(event, row.user_id, 'growth-changed', {
      messageType: 'GROWTH',
      title: `${label}已更新`,
      body: `本次${delta >= 0 ? '增加' : '减少'} ${Math.abs(delta)}，当前余额 ${balance}。`,
      targetType: 'GROWTH',
      targetId: row.id,
    }),
  ], [], 'PROJECTED')
}

async function projectOperationsNotification(database, event) {
  assertAggregate(event, 'OPERATIONS_MESSAGE')
  const row = await database.one(
    `SELECT message.id, message.recipient_user_id, message.title, message.body,
            message.target_type, message.target_id, message.event_id,
            message.template_key, message.template_payload_json,
            message.status, message.version
     FROM mip_operations_messages message
     INNER JOIN mip_users recipient
       ON recipient.app_id = message.app_id
      AND recipient.id = message.recipient_user_id
      AND recipient.status = 'ACTIVE'
     INNER JOIN mip_users creator
       ON creator.app_id = message.app_id
      AND creator.id = message.created_by_user_id
     LEFT JOIN mip_events event_fact
       ON event_fact.app_id = message.app_id
      AND event_fact.id = message.event_id
     WHERE message.app_id = ? AND message.id = ?
       AND (message.event_id IS NULL OR event_fact.id IS NOT NULL)`,
    [event.app_id, event.aggregate_id],
  )
  if (!row || row.status !== 'PUBLISHED' || Number(row.version) !== Number(event.source_version)) {
    return projection([], [], 'FACT_NO_LONGER_CURRENT')
  }
  const title = boundedText(row.title, 100)
  const body = boundedText(row.body, 500)
  if (!UUID_PATTERN.test(String(row.recipient_user_id || '')) || !title || !body) {
    throw new Error('OUTBOX_EVENT_INVALID')
  }
  const details = {
    messageType: 'OPERATIONS',
    title,
    body,
  }
  if (row.target_type !== null || row.target_id !== null) {
    if (row.target_type !== 'EVENT'
      || !UUID_PATTERN.test(String(row.target_id || ''))
      || row.target_id !== row.event_id) {
      throw new Error('OUTBOX_EVENT_INVALID')
    }
    details.targetType = 'EVENT'
    details.targetId = row.target_id
  }
  if (row.template_key !== null || row.template_payload_json !== null) {
    if (row.template_key !== 'EVENT_REMINDER' || details.targetType !== 'EVENT') {
      throw new Error('OUTBOX_EVENT_INVALID')
    }
    details.external = {
      channel: 'WECHAT_SUBSCRIPTION',
      templateKey: 'EVENT_REMINDER',
      fields: eventReminderFields(row.template_payload_json),
    }
  }
  return projection([
    message(event, row.recipient_user_id, 'operations', details),
  ], [], 'PROJECTED')
}

function eventReminderFields(value) {
  const parsed = parseObject(value)
  const fields = parsed.fields
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) {
    throw new Error('OUTBOX_EVENT_INVALID')
  }
  const normalized = {
    title: boundedText(fields.title, 100),
    startsAt: boundedText(fields.startsAt, 100),
    location: boundedText(fields.location, 100),
  }
  if (Object.values(normalized).some(item => !item)) {
    throw new Error('OUTBOX_EVENT_INVALID')
  }
  return normalized
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

function boundedText(value, limit) {
  const normalized = typeof value === 'string' ? value.trim() : ''
  return normalized.length <= limit ? normalized : ''
}

async function projectReferral(database, event) {
  assertAggregate(event, 'REFERRAL_INTENT')
  const row = await database.one(
    `SELECT r.status, r.version, r.opportunity_id, r.actor_user_id, r.target_user_id
     FROM mip_referral_intents r
     INNER JOIN mip_opportunities o
       ON o.app_id = r.app_id AND o.id = r.opportunity_id AND o.status IN ('PUBLISHED', 'ENDED')
     INNER JOIN mip_users actor
       ON actor.app_id = r.app_id AND actor.id = r.actor_user_id AND actor.status = 'ACTIVE'
     INNER JOIN mip_users target
       ON target.app_id = r.app_id AND target.id = r.target_user_id AND target.status = 'ACTIVE'
     WHERE r.app_id = ? AND r.id = ?
       AND NOT EXISTS (
         SELECT 1 FROM mip_user_blocks visibility_block
         WHERE visibility_block.app_id = r.app_id AND visibility_block.status = 'ACTIVE'
           AND (
             (visibility_block.blocker_user_id = r.actor_user_id
               AND visibility_block.blocked_user_id = r.target_user_id)
             OR
             (visibility_block.blocker_user_id = r.target_user_id
               AND visibility_block.blocked_user_id = r.actor_user_id)
           )
       )`,
    [event.app_id, event.aggregate_id],
  )
  if (!row || row.status !== 'ACTIVE' || Number(row.version) !== Number(event.source_version)) {
    return projection([], [], 'FACT_NO_LONGER_CURRENT')
  }
  const growthEvents = Number(row.version) === 1
    ? [growth(event, row.actor_user_id, 'referral.confirmed')]
    : []
  return projection([
    message(event, row.target_user_id, 'referral', {
      messageType: 'OPPORTUNITY',
      title: '收到机会引荐',
      body: '有人向你引荐了一个机会。',
      targetType: 'OPPORTUNITY',
      targetId: row.opportunity_id,
    }),
  ], growthEvents, 'PROJECTED')
}

async function projectInterest(database, event) {
  assertAggregate(event, 'PROFILE_INTEREST')
  const row = await database.one(
    `SELECT i.status, i.version, i.target_user_id, i.source_type, i.source_id
     FROM mip_profile_interests i
     INNER JOIN mip_users u
       ON u.app_id = i.app_id AND u.id = i.target_user_id AND u.status = 'ACTIVE'
     WHERE i.app_id = ? AND i.id = ?`,
    [event.app_id, event.aggregate_id],
  )
  if (!row || row.status !== 'ACTIVE' || Number(row.version) !== Number(event.source_version)) {
    return projection([], [], 'FACT_NO_LONGER_CURRENT')
  }
  const source = await activeInterestSource(database, event.app_id, row.source_type, row.source_id)
  if (!source) return projection([], [], 'FACT_NO_LONGER_CURRENT')
  const labels = {
    OPPORTUNITY: ['opportunity-interest', '机会收到新的关注', '你的机会收到新的感兴趣标记。'],
    COOPERATION_CARD: ['cooperation-interest', '合作卡收到新的关注', '你的合作卡收到新的感兴趣标记。'],
    SUPER_CASE: ['case-interest', '超级案例收到新的关注', '你的超级案例收到新的感兴趣标记。'],
    PROFILE: ['profile-interest', '公开档案收到新的关注', '有人对你的公开档案标记感兴趣。'],
  }
  const label = labels[row.source_type]
  const target = row.source_type === 'OPPORTUNITY'
    ? { targetType: 'OPPORTUNITY', targetId: row.source_id }
    : {}
  return projection([
    message(event, row.target_user_id, label[0], {
      messageType: 'PROFILE_INTEREST',
      title: label[1],
      body: label[2],
      ...target,
    }),
  ], [], 'PROJECTED')
}

async function activeInterestSource(database, appId, sourceType, sourceId) {
  const queries = {
    OPPORTUNITY: `SELECT id FROM mip_opportunities
      WHERE app_id = ? AND id = ? AND status IN ('PUBLISHED', 'ENDED')`,
    COOPERATION_CARD: `SELECT id FROM mip_cooperation_cards
      WHERE app_id = ? AND id = ? AND status = 'PUBLISHED'`,
    SUPER_CASE: `SELECT id FROM mip_super_cases
      WHERE app_id = ? AND id = ? AND status = 'PUBLISHED'`,
    PROFILE: `SELECT target.id FROM mip_users target
      INNER JOIN mip_profiles profile ON profile.app_id = target.app_id AND profile.user_id = target.id
      WHERE target.app_id = ? AND target.id = ? AND target.status = 'ACTIVE'`,
  }
  return queries[sourceType] ? database.one(queries[sourceType], [appId, sourceId]) : null
}

function projection(notifications, growthEvents, reason) {
  return { supported: true, notifications, growth: growthEvents, reason }
}

function message(event, recipientUserId, key, details) {
  return {
    recipientUserId,
    messageType: details.messageType,
    title: details.title,
    body: details.body,
    dedupeKey: `outbox:${event.id}:${key}`,
    ...(details.targetType ? { targetType: details.targetType, targetId: details.targetId } : {}),
    ...(details.external ? { external: details.external } : {}),
  }
}

function checkInExternal(title, occurredAt) {
  return {
    channel: 'WECHAT_SUBSCRIPTION',
    templateKey: 'CHECKIN_RESULT',
    fields: {
      title: boundedText(title, 100),
      checkedAt: notificationDateTime(occurredAt),
      status: '签到成功',
    },
  }
}

function notificationDateTime(value) {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) throw new Error('OUTBOX_EVENT_INVALID')
  const local = new Date(date.getTime() + 8 * 60 * 60 * 1000)
  return [
    `${local.getUTCFullYear()}-${String(local.getUTCMonth() + 1).padStart(2, '0')}-${String(local.getUTCDate()).padStart(2, '0')}`,
    `${String(local.getUTCHours()).padStart(2, '0')}:${String(local.getUTCMinutes()).padStart(2, '0')}`,
  ].join(' ')
}

function growth(event, userId, sourceEventType = event.event_type) {
  return {
    userId,
    sourceEventType,
    sourceEventId: event.id,
  }
}

function checkInGrowth(transitionId) {
  return { action: 'applyCheckInTransition', transitionId }
}

function assertEvent(event) {
  if (!event || !UUID_PATTERN.test(String(event.id || ''))
    || !UUID_PATTERN.test(String(event.aggregate_id || ''))
    || !/^[a-z][a-z0-9_.-]{2,79}$/.test(String(event.event_type || ''))
    || !Number.isInteger(Number(event.source_version))
    || Number(event.source_version) < 1) {
    throw new Error('OUTBOX_EVENT_INVALID')
  }
}

function assertAggregate(event, expected) {
  if (event.aggregate_type !== expected) throw new Error('OUTBOX_EVENT_INVALID')
}

module.exports = { NO_PROJECTION_EVENT_TYPES, projectEvent }
