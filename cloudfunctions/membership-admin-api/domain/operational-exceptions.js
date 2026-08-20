'use strict'

function iso(value) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : date.toISOString()
}

function item(input) {
  return {
    id: input.id,
    type: input.type,
    severity: input.severity,
    title: input.title,
    summary: input.summary,
    status: input.status,
    createdAt: iso(input.createdAt),
    updatedAt: iso(input.updatedAt),
    canRetry: Boolean(input.canRetry),
    route: input.route || '',
    version: Number(input.version || 1),
  }
}

async function listOperationalExceptions(database, appId) {
  const [refunds, cleanup, media, notifications, mediaFailures] = await Promise.all([
    database.query(
      `SELECT f.id, f.status, f.created_at, f.updated_at, o.description, o.id AS order_id
       FROM member_refunds f
       INNER JOIN member_orders o ON o.app_id = f.app_id AND o.id = f.order_id
       WHERE f.app_id = ?
         AND (
           f.status = 'REFUND_FAILED'
           OR (
             f.status IN ('REFUND_PENDING', 'REFUND_CREATED')
             AND f.updated_at < UTC_TIMESTAMP(3) - INTERVAL 10 MINUTE
           )
         )
       ORDER BY f.updated_at ASC LIMIT 50`,
      [appId],
    ),
    database.query(
      `SELECT id, status, attempts, version, created_at, updated_at
       FROM member_media_cleanup_outbox
       WHERE app_id = ?
         AND (
           status = 'FAILED'
           OR (status = 'PENDING' AND updated_at < UTC_TIMESTAMP(3) - INTERVAL 15 MINUTE)
           OR (status = 'LEASED' AND lease_until < UTC_TIMESTAMP(3))
         )
       ORDER BY updated_at ASC LIMIT 50`,
      [appId],
    ),
    database.query(
      `SELECT id, kind, status, created_at, created_at AS updated_at
       FROM member_media_assets
       WHERE app_id = ? AND status = 'PROCESSING'
         AND created_at < UTC_TIMESTAMP(3) - INTERVAL 15 MINUTE
       ORDER BY created_at ASC LIMIT 50`,
      [appId],
    ),
    database.query(
      `SELECT id, template_key, status, attempts, created_at, updated_at
       FROM member_notification_outbox
       WHERE app_id = ?
         AND (
           status = 'FAILED'
           OR (status = 'PENDING' AND updated_at < UTC_TIMESTAMP(3) - INTERVAL 15 MINUTE)
           OR (status = 'LEASED' AND lease_expires_at < UTC_TIMESTAMP(3))
         )
       ORDER BY updated_at ASC LIMIT 50`,
      [appId],
    ),
    database.query(
      `SELECT id, category, resource_type, error_code, status, version,
              created_at, updated_at
       FROM member_operational_failures
       WHERE app_id = ? AND status = 'OPEN'
       ORDER BY updated_at ASC LIMIT 50`,
      [appId],
    ),
  ])
  return [
    ...refunds.map(row => item({
      id: row.id,
      type: 'REFUND',
      severity: row.status === 'REFUND_FAILED' ? 'HIGH' : 'MEDIUM',
      title: row.status === 'REFUND_FAILED' ? '退款处理失败' : '退款状态长时间未更新',
      summary: row.description || '请核对微信支付退款结果',
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      route: `/packages/admin/orders/index?orderId=${encodeURIComponent(row.order_id)}`,
    })),
    ...cleanup.map(row => item({
      id: row.id,
      type: 'MEDIA_CLEANUP',
      severity: row.status === 'FAILED' ? 'MEDIUM' : 'LOW',
      title: '文件清理未完成',
      summary: `已尝试 ${Number(row.attempts || 0)} 次，可安全重新处理`,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      canRetry: row.status === 'FAILED',
      version: row.version,
    })),
    ...media.map(row => item({
      id: row.id,
      type: 'MEDIA_PROCESSING',
      severity: 'MEDIUM',
      title: '图片处理长时间未完成',
      summary: row.kind === 'event-photo' ? '活动照片需要重新上传' : '图片需要重新上传',
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })),
    ...notifications.map(row => item({
      id: row.id,
      type: 'NOTIFICATION',
      severity: row.status === 'FAILED' ? 'MEDIUM' : 'LOW',
      title: '微信消息发送未完成',
      summary: `提醒类型：${row.template_key}，已尝试 ${Number(row.attempts || 0)} 次`,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      canRetry: row.status === 'FAILED',
    })),
    ...mediaFailures.map(row => item({
      id: row.id,
      type: 'MEDIA_FAILURE',
      severity: row.category === 'MEDIA_REVIEW' ? 'MEDIUM' : 'LOW',
      title: row.category === 'MEDIA_REVIEW' ? '图片未通过安全审核' : '图片上传未完成',
      summary: row.resource_type === 'event-photo'
        ? '请联系上传者更换活动照片后重试'
        : '请重新选择图片后上传',
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      version: row.version,
    })),
  ].sort((left, right) => left.updatedAt.localeCompare(right.updatedAt)).slice(0, 100)
}

module.exports = { listOperationalExceptions }
