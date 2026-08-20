'use strict'

const { randomUUID } = require('node:crypto')
const { renderTemplateData } = require('./templates')

function iso(value) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function localTime(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return '时间待定'
  }
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date)
}

function money(cents) {
  return `¥${(Number(cents || 0) / 100).toFixed(2)}`
}

function registrationStatus(status) {
  return ({
    PENDING_REVIEW: '待审核',
    WAITLISTED: '候补中',
    REGISTERED: '报名成功',
    REJECTED: '未通过',
    CANCELLED: '已取消',
  })[status] || '状态已更新'
}

function registrationTitle(status) {
  return ({
    PENDING_REVIEW: '报名资料已提交',
    WAITLISTED: '已进入活动候补',
    REGISTERED: '活动报名成功',
    REJECTED: '报名结果已更新',
    CANCELLED: '活动报名已取消',
  })[status] || '报名状态已更新'
}

async function createNotification(database, input) {
  const notificationId = randomUUID()
  await database.query(
    `INSERT IGNORE INTO member_notifications (
       id, app_id, user_id, kind, source_type, source_id, source_version,
       event_id, order_id, title, summary, page_path, status, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'UNREAD', ?)`,
    [
      notificationId,
      input.appId,
      input.userId,
      input.kind,
      input.sourceType,
      input.sourceId,
      input.sourceVersion,
      input.eventId || null,
      input.orderId || null,
      input.title,
      input.summary,
      input.pagePath,
      input.createdAt || new Date(),
    ],
  )
  const notification = await database.one(
    `SELECT id FROM member_notifications
     WHERE app_id = ? AND user_id = ? AND kind = ? AND source_type = ?
       AND source_id = ? AND source_version = ?`,
    [
      input.appId,
      input.userId,
      input.kind,
      input.sourceType,
      input.sourceId,
      input.sourceVersion,
    ],
  )
  if (!notification?.id) {
    throw new Error('NOTIFICATION_INSERT_FAILED')
  }
  await database.query(
    `INSERT IGNORE INTO member_notification_outbox (
       id, app_id, user_id, notification_id, kind, source_type, source_id,
       source_version, event_id, template_key, payload, page_path,
       send_at, expires_at, status
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING')`,
    [
      randomUUID(),
      input.appId,
      input.userId,
      notification.id,
      input.kind,
      input.sourceType,
      input.sourceId,
      input.sourceVersion,
      input.eventId || null,
      input.templateKey,
      JSON.stringify(input.payload),
      input.pagePath,
      input.sendAt || new Date(),
      input.expiresAt || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    ],
  )
  return notification.id
}

async function materializeRegistrationNotifications(database, appId) {
  const rows = await database.query(
    `SELECT r.id, r.user_id, r.event_id, r.status, r.version, r.updated_at,
            e.title, e.starts_at, e.location
     FROM member_registrations r
     INNER JOIN member_events e ON e.app_id = r.app_id AND e.id = r.event_id
     WHERE r.app_id = ?
       AND r.status IN ('PENDING_REVIEW', 'WAITLISTED', 'REGISTERED', 'REJECTED', 'CANCELLED')
       AND r.updated_at >= UTC_TIMESTAMP(3) - INTERVAL 30 DAY
     ORDER BY r.updated_at ASC LIMIT 500`,
    [appId],
  )
  for (const row of rows) {
    const status = registrationStatus(row.status)
    await createNotification(database, {
      appId,
      userId: row.user_id,
      kind: 'REGISTRATION_RESULT',
      sourceType: 'registration',
      sourceId: row.id,
      sourceVersion: Number(row.version || 1),
      eventId: row.event_id,
      title: registrationTitle(row.status),
      summary: `${row.title} · ${status}`,
      pagePath: `/packages/member/ticket/index?eventId=${encodeURIComponent(row.event_id)}`,
      templateKey: 'registration',
      payload: {
        title: row.title,
        status,
        time: localTime(row.starts_at),
        location: row.location || '详见活动页',
      },
      createdAt: row.updated_at,
    })
  }
  return rows.length
}

async function materializeEventChangeNotifications(database, appId) {
  const rows = await database.query(
    `SELECT c.id, c.event_id, c.event_version, c.summary, c.created_at,
            e.title, e.starts_at, e.location, e.status, e.cancellation_reason,
            r.user_id
     FROM member_event_changes c
     INNER JOIN member_events e ON e.app_id = c.app_id AND e.id = c.event_id
     INNER JOIN member_registrations r ON r.app_id = c.app_id AND r.event_id = c.event_id
     WHERE c.app_id = ?
       AND c.created_at >= UTC_TIMESTAMP(3) - INTERVAL 30 DAY
       AND r.status IN ('PENDING_REVIEW', 'WAITLISTED', 'REGISTERED', 'CANCELLATION_PENDING', 'ATTENDED')
     ORDER BY c.created_at ASC LIMIT 1000`,
    [appId],
  )
  for (const row of rows) {
    const cancelled = row.status === 'CANCELLED'
    await createNotification(database, {
      appId,
      userId: row.user_id,
      kind: cancelled ? 'EVENT_CANCEL' : 'EVENT_UPDATE',
      sourceType: 'event_change',
      sourceId: String(row.id),
      sourceVersion: Number(row.event_version || 1),
      eventId: row.event_id,
      title: cancelled ? '活动已取消' : '活动信息有更新',
      summary: `${row.title} · ${row.summary}`,
      pagePath: `/packages/member/event-detail/index?eventId=${encodeURIComponent(row.event_id)}`,
      templateKey: cancelled ? 'event_cancel' : 'event_update',
      payload: cancelled
        ? {
            title: row.title,
            reason: row.cancellation_reason || row.summary,
            time: localTime(row.starts_at),
          }
        : {
            title: row.title,
            summary: row.summary,
            time: localTime(row.starts_at),
          },
      createdAt: row.created_at,
    })
  }
  return rows.length
}

async function materializeReminderNotifications(database, appId) {
  const rows = await database.query(
    `SELECT e.id AS event_id, e.version, e.title, e.starts_at, e.location, r.user_id
     FROM member_events e
     INNER JOIN member_registrations r ON r.app_id = e.app_id AND r.event_id = e.id
     WHERE e.app_id = ? AND e.status = 'PUBLISHED'
       AND e.starts_at >= UTC_TIMESTAMP(3) + INTERVAL 23 HOUR
       AND e.starts_at < UTC_TIMESTAMP(3) + INTERVAL 24 HOUR
       AND r.status IN ('REGISTERED', 'ATTENDED')
     ORDER BY e.starts_at ASC LIMIT 500`,
    [appId],
  )
  for (const row of rows) {
    await createNotification(database, {
      appId,
      userId: row.user_id,
      kind: 'EVENT_REMINDER',
      sourceType: 'event',
      sourceId: row.event_id,
      sourceVersion: Number(row.version || 1),
      eventId: row.event_id,
      title: '活动将在明天开始',
      summary: `${row.title} · ${localTime(row.starts_at)}`,
      pagePath: `/packages/member/ticket/index?eventId=${encodeURIComponent(row.event_id)}`,
      templateKey: 'event_reminder',
      payload: {
        title: row.title,
        time: localTime(row.starts_at),
        location: row.location || '详见活动页',
      },
      expiresAt: new Date(new Date(row.starts_at).getTime() + 2 * 60 * 60 * 1000),
    })
  }
  return rows.length
}

async function materializeRefundNotifications(database, appId) {
  const rows = await database.query(
    `SELECT f.id, f.status, f.amount_cents, f.updated_at, o.id AS order_id,
            o.user_id, o.description
     FROM member_refunds f
     INNER JOIN member_orders o ON o.app_id = f.app_id AND o.id = f.order_id
     WHERE f.app_id = ? AND f.status IN ('REFUNDED', 'REFUND_FAILED')
       AND f.updated_at >= UTC_TIMESTAMP(3) - INTERVAL 30 DAY
     ORDER BY f.updated_at ASC LIMIT 500`,
    [appId],
  )
  for (const row of rows) {
    const succeeded = row.status === 'REFUNDED'
    await createNotification(database, {
      appId,
      userId: row.user_id,
      kind: 'REFUND_RESULT',
      sourceType: 'refund',
      sourceId: row.id,
      sourceVersion: Math.max(1, Math.floor(new Date(row.updated_at).getTime() / 1000)),
      orderId: row.order_id,
      title: succeeded ? '退款已完成' : '退款处理遇到问题',
      summary: `${row.description} · ${money(row.amount_cents)}`,
      pagePath: `/packages/member/order-detail/index?orderId=${encodeURIComponent(row.order_id)}`,
      templateKey: 'refund',
      payload: {
        title: row.description,
        amount: money(row.amount_cents),
        status: succeeded ? '退款成功' : '处理失败',
        time: localTime(row.updated_at),
      },
      createdAt: row.updated_at,
    })
  }
  return rows.length
}

async function materializeNotifications(database, appIds) {
  const counts = {
    registrations: 0,
    eventChanges: 0,
    reminders: 0,
    refunds: 0,
  }
  for (const appId of appIds) {
    counts.registrations += await materializeRegistrationNotifications(database, appId)
    counts.eventChanges += await materializeEventChangeNotifications(database, appId)
    counts.reminders += await materializeReminderNotifications(database, appId)
    counts.refunds += await materializeRefundNotifications(database, appId)
  }
  return counts
}

async function claimOutbox(database, appIds, leaseOwner) {
  if (!appIds.length) return null
  return database.transaction(async (tx) => {
    const row = await tx.one(
      `SELECT * FROM member_notification_outbox
       WHERE app_id IN (${appIds.map(() => '?').join(', ')})
         AND (
           (status = 'PENDING' AND send_at <= UTC_TIMESTAMP(3))
           OR (status = 'LEASED' AND lease_expires_at < UTC_TIMESTAMP(3))
         )
       ORDER BY send_at ASC, id ASC
       LIMIT 1 FOR UPDATE`,
      appIds,
    )
    if (!row) return null
    const updated = await tx.query(
      `UPDATE member_notification_outbox
       SET status = 'LEASED', attempts = attempts + 1, lease_owner = ?,
           lease_expires_at = UTC_TIMESTAMP(3) + INTERVAL 2 MINUTE
       WHERE id = ? AND app_id = ? AND attempts < 10`,
      [leaseOwner, row.id, row.app_id],
    )
    return updated?.affectedRows === 1 ? { ...row, attempts: Number(row.attempts || 0) + 1 } : null
  })
}

async function finishOutbox(database, row, status, fields = {}) {
  await database.query(
    `UPDATE member_notification_outbox
     SET status = ?, provider_msg_id = ?, last_error = ?,
         lease_owner = NULL, lease_expires_at = NULL
     WHERE id = ? AND app_id = ? AND status = 'LEASED'`,
    [
      status,
      fields.providerMsgId || null,
      fields.lastError ? String(fields.lastError).slice(0, 500) : null,
      row.id,
      row.app_id,
    ],
  )
}

async function sendDueNotifications(database, options) {
  const limit = Math.min(Math.max(Number(options.limit || 50), 1), 200)
  const result = { sent: 0, inAppOnly: 0, failed: 0 }
  for (let index = 0; index < limit; index += 1) {
    const row = await claimOutbox(database, options.appIds, options.leaseOwner)
    if (!row) break
    if (new Date(row.expires_at).getTime() <= Date.now()) {
      await finishOutbox(database, row, 'IN_APP_ONLY', { lastError: 'MESSAGE_EXPIRED' })
      result.inAppOnly += 1
      continue
    }
    const template = options.templates[row.template_key]
    if (!template) {
      await finishOutbox(database, row, 'IN_APP_ONLY', { lastError: 'TEMPLATE_NOT_CONFIGURED' })
      result.inAppOnly += 1
      continue
    }
    const grant = await database.one(
      `SELECT id FROM member_notification_subscriptions
       WHERE app_id = ? AND user_id = ? AND template_key = ? AND template_id = ?
         AND status = 'ACCEPTED' AND consumed_at IS NULL
         AND (event_id IS NULL OR event_id = ?)
       ORDER BY (event_id = ?) DESC, created_at ASC LIMIT 1`,
      [
        row.app_id,
        row.user_id,
        row.template_key,
        template.templateId,
        row.event_id || null,
        row.event_id || null,
      ],
    )
    if (!grant?.id) {
      await finishOutbox(database, row, 'IN_APP_ONLY', { lastError: 'NO_AVAILABLE_SUBSCRIPTION' })
      result.inAppOnly += 1
      continue
    }
    try {
      const response = await options.send({
        touser: row.user_id,
        templateId: template.templateId,
        page: row.page_path,
        miniprogramState: options.miniprogramState,
        lang: 'zh_CN',
        data: renderTemplateData(
          template,
          typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload,
        ),
      })
      const errCode = Number(response?.errCode ?? response?.errcode ?? 0)
      if (errCode !== 0) {
        throw new Error(`WECHAT_${errCode}`)
      }
      await database.transaction(async (tx) => {
        await tx.query(
          `UPDATE member_notification_subscriptions
           SET consumed_at = UTC_TIMESTAMP(3)
           WHERE id = ? AND app_id = ? AND consumed_at IS NULL`,
          [grant.id, row.app_id],
        )
        await tx.query(
          `UPDATE member_notification_outbox
           SET status = 'SENT', provider_msg_id = ?, last_error = NULL,
               lease_owner = NULL, lease_expires_at = NULL
           WHERE id = ? AND app_id = ? AND status = 'LEASED'`,
          [String(response?.msgId || response?.msgid || ''), row.id, row.app_id],
        )
      })
      result.sent += 1
    }
    catch (error) {
      const retryable = row.attempts < 3
      await finishOutbox(database, row, retryable ? 'PENDING' : 'FAILED', {
        lastError: error instanceof Error ? error.message : 'WECHAT_SEND_FAILED',
      })
      result.failed += 1
    }
  }
  return result
}

async function runNotificationWorker(database, options) {
  const materialized = await materializeNotifications(database, options.appIds)
  const delivery = await sendDueNotifications(database, options)
  return { materialized, delivery, ranAt: iso(new Date()) }
}

module.exports = {
  createNotification,
  materializeNotifications,
  runNotificationWorker,
  sendDueNotifications,
}
