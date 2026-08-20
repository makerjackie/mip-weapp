'use strict'

const cloud = require('wx-server-sdk')
const { assertProfileTransition } = require('./domain/profiles')
const { assertCapability, capabilitiesFor } = require('./domain/rbac')
const {
  EVENT_MANAGER_ROLES,
  actorRoleForEventRole,
  capabilitiesForEventRole,
  eventRoleHasCapability,
  normalizeEventManagerRole,
} = require('./domain/event-permissions')
const {
  assertMembershipRefundAllowed,
  evaluateMembershipRefundEligibility,
} = require('./domain/refunds')
const { processDueCleanup, requeueTerminalCleanup } = require('./domain/media-cleanup')
const { listOperationalExceptions } = require('./domain/operational-exceptions')
const {
  getAdminAnnouncement,
  listAdminAnnouncements,
  listMemberReports,
  resolveMemberReport,
  saveAnnouncement,
  setAnnouncementState,
} = require('./domain/community-admin')
const { randomUUID, createHash } = require('node:crypto')
const { resolveTrustedIdentity } = require('./lib/identity')
const { mysqlDatabase } = require('./lib/mysql')
const {
  cancelEvent: cancelEventWorkflow,
  checkInRegistration: checkInRegistrationWorkflow,
  createRosterExport: createRosterExportWorkflow,
  duplicateEvent: duplicateEventWorkflow,
  downloadRosterExport: downloadRosterExportWorkflow,
  listEventRegistrations: listEventRegistrationsWorkflow,
  mapEventRow,
  reviewEventRegistration: reviewEventRegistrationWorkflow,
  saveEvent: saveEventWorkflow,
  setEventStatus: setEventStatusWorkflow,
  undoCheckIn: undoCheckInWorkflow,
} = require('./lib/workflows')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const allowedAppIds = new Set(String(process.env.MEMBERSHIP_ALLOWED_APP_IDS || '')
  .split(',')
  .map(value => value.trim())
  .filter(Boolean))

const messages = {
  FORBIDDEN: '你没有执行此操作的权限',
  INVALID_DECISION: '审核决定无效',
  INVALID_EVENT: '活动资料格式无效',
  INVALID_EVENT_CAPACITY: '活动名额需为 1 至 10000',
  INVALID_EVENT_DATE: '活动时间无效',
  INVALID_EVENT_DESCRIPTION: '活动说明不能超过 2000 个字符',
  INVALID_EVENT_LOCATION: '活动地点不能为空且不能超过 255 个字符',
  INVALID_EVENT_PRICE: '活动金额无效',
  INVALID_EVENT_PRICE_COMBINATION: '不支持的活动价格组合',
  INVALID_EVENT_TITLE: '活动标题不能为空且不能超过 50 个字符',
  INVALID_EVENT_TRANSITION: '不允许执行该活动状态变更',
  INVALID_EVENT_ENDS_AT: '活动结束时间无效',
  INVALID_EVENT_TIME_RANGE: '结束时间必须晚于开始时间',
  INVALID_EVENT_DEADLINE: '报名截止时间不能晚于开始时间',
  INVALID_EVENT_VENUE: '场地名称不能超过 120 个字符',
  INVALID_EVENT_ADDRESS: '详细地址不能超过 300 个字符',
  INVALID_EVENT_COORDINATES: '活动地图坐标无效',
  INVALID_EVENT_ONLINE_URL: '线上活动链接需为有效的 HTTPS 地址',
  INVALID_EVENT_CANCELLATION_POLICY: '取消规则不能超过 1000 个字符',
  INVALID_EVENT_COVER: '活动封面无效',
  INVALID_EVENT_MANAGER_ROLE: '活动管理员角色无效',
  EVENT_OWNER_REQUIRED: '每场活动至少需要保留一位活动负责人',
  INVALID_EVENT_NOTICES: '活动须知不能超过 3000 个字符',
  INVALID_REGISTRATION_FORM: '报名问题配置无效，最多 12 项',
  INVALID_EVENT_VERSION: '活动版本无效，请刷新后重试',
  INVALID_EVENT_STARTS_AT: '发布时开始时间必须在未来',
  INVALID_ACTIVITY_TYPE: '活动类型无效',
  EVENT_VERSION_CONFLICT: '活动已被其他人更新，请刷新后重新编辑',
  EVENT_CAPACITY_BELOW_REGISTRATIONS: '名额不能小于当前有效报名人数',
  EVENT_ELIGIBILITY_LOCKED: '已有有效报名，不能在公开免费与会员包含之间切换',
  EVENT_CANCEL_REQUIRES_ACTION: '取消活动请使用取消操作并填写原因',
  EVENT_ALREADY_STARTED: '活动已开始，不能修改或取消',
  EVENT_ALREADY_COMPLETED: '活动已结束，不能取消',
  EVENT_NOT_ENDED: '活动尚未结束，不能提前标记为已结束',
  EVENT_DATA_INTEGRITY: '活动数据不完整或价格组合非法，请修复后再编辑/发布',
  INVALID_CANCELLATION_REASON: '取消原因需为 1 至 500 个字符',
  INVALID_REFUND_REASON: '退款原因需为 1 至 120 个字符',
  INVALID_ROSTER_STATUS: '报名状态筛选无效',
  INVALID_ROSTER_QUERY: '搜索词需为 2 至 64 个字符',
  INVALID_ROSTER_CURSOR: '名单分页游标无效，请重新加载',
  INVALID_REGISTRATION_VERSION: '报名版本无效，请刷新后重试',
  INVALID_REGISTRATION_TRANSITION: '当前报名状态不允许此操作',
  INVALID_REGISTRATION_DECISION: '报名审核决定无效',
  REGISTRATION_REVIEW_REASON_REQUIRED: '拒绝报名时请填写原因',
  EVENT_FULL: '活动名额已满',
  TICKET_CODE_UNAVAILABLE: '报名凭证生成失败，请重试',
  UNSUPPORTED_PAID_REGISTRATION_POLICY: '付费活动暂不支持审核或候补模式',
  INVALID_UNDO_REASON: '撤销原因需为 1 至 120 个字符',
  REGISTRATION_NOT_FOUND: '报名记录不存在',
  REGISTRATION_CANCELLED: '该报名已取消，不能签到',
  REGISTRATION_VERSION_CONFLICT: '报名状态已变化，请刷新后重试',
  CHECKIN_CREDENTIAL_INVALID: '签到二维码无效或已过期',
  PHOTO_NOT_FOUND: '活动照片不存在或已处理',
  EVENT_CANCELLED: '活动已取消，不能继续签到',
  CHECKIN_WINDOW_CLOSED: '不在签到时间窗口内',
  EXPORT_STORAGE_NOT_CONFIGURED: '导出存储未配置，暂不可用',
  EXPORT_NOT_FOUND: '导出文件不存在或无权访问',
  EXPORT_EXPIRED: '导出文件已过期，请重新导出',
  EXPORT_ALREADY_USED: '导出下载链接已使用，请重新导出',
  EXPORT_TOO_LARGE: '导出名额超过 5000 条上限，请缩小筛选范围后重试',
  EXPORT_STORAGE_WRITE_FAILED: '导出文件写入失败，请稍后重试',
  EXPORT_BUILD_FAILED: '导出文件生成失败，请稍后重试',
  EXPORT_OBJECT_INTEGRITY: '导出文件校验失败，请重新导出',
  IDEMPOTENCY_KEY_CONFLICT: '重复请求内容不一致，请刷新后重试',
  INVALID_IDEMPOTENCY_KEY: '请求标识无效，请重试',
  DATA_INTEGRITY: '数据不完整，请刷新后重试',
  ORDER_NOT_FOUND: '订单不存在',
  ORDER_NOT_REFUNDABLE: '该订单当前不可退款',
  ORDER_STATUS_CONFLICT: '订单状态已变化，请刷新后重试',
  REFUND_BLOCKED_ATTENDED_MEMBER_EVENT: '退款会使会员权益失效，且该权益期内已签到会员包含活动，不能退款',
  ROLE_CANNOT_REFUND: '当前角色不能发起退款',
  ORDER_NOT_PAID: '仅已支付订单可退款',
  REFUND_ALREADY_EXISTS: '该订单已有退款记录',
  PROFILE_NOT_FOUND: '资料不存在或已被处理',
  INVALID_ADMIN_ROLE: '管理员角色无效',
  OPERATION_EXCEPTION_NOT_RETRYABLE: '该异常不能自动重试，请按提示人工处理',
  OPERATION_EXCEPTION_NOT_FOUND: '异常记录已变化，请刷新后重试',
  ADMIN_SELF_MUTATION_FORBIDDEN: '不能在这里修改自己的权限',
  ANNOUNCEMENT_NOT_FOUND: '公告不存在或已经删除',
  ANNOUNCEMENT_VERSION_CONFLICT: '公告已被其他运营者更新，请刷新后重试',
  INVALID_ANNOUNCEMENT_BODY: '公告正文需为 1 至 5000 个字符',
  INVALID_ANNOUNCEMENT_SUMMARY: '公告摘要需为 1 至 160 个字符',
  INVALID_ANNOUNCEMENT_TITLE: '公告标题需为 1 至 80 个字符',
  INVALID_ANNOUNCEMENT_TRANSITION: '当前公告状态不允许此操作',
  INVALID_ANNOUNCEMENT_VERSION: '公告版本无效，请刷新后重试',
  INVALID_ANNOUNCEMENT_WINDOW: '公告展示时间无效',
  INVALID_PROFILE_TRANSITION: '不允许执行该资料状态变更',
  INVALID_REPORT_DECISION: '举报处理决定无效',
  INVALID_REPORT_REASON: '处理原因需为 1 至 200 个字符',
  REPORT_NOT_FOUND: '举报记录不存在或已经变化',
  REPORT_VERSION_CONFLICT: '举报记录已被其他运营者处理，请刷新后重试',
  UNSUPPORTED_ACTION: '不支持该运营操作',
}

function db() {
  return mysqlDatabase()
}

function identity() {
  const context = cloud.getWXContext()
  const resolved = resolveTrustedIdentity(context, { errorCode: 'FORBIDDEN' })
  if (!allowedAppIds.size || !allowedAppIds.has(resolved.appId)) {
    throw new Error('FORBIDDEN')
  }
  return { openId: resolved.openId, appId: resolved.appId }
}

function validUuid(value) {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function retryRefundNumber() {
  return `R${randomUUID().replace(/-/g, '').slice(0, 31).toUpperCase()}`
}

function iso(value) {
  if (!value) {
    return null
  }
  const result = new Date(value)
  return Number.isNaN(result.getTime()) ? null : result.toISOString()
}

function jsonArray(value) {
  if (Array.isArray(value)) {
    return value
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      return Array.isArray(parsed) ? parsed : []
    }
    catch {
      return []
    }
  }
  return []
}

function success(data) {
  return { ok: true, data }
}

function failure(error) {
  const code = error instanceof Error && /^[A-Z][A-Z0-9_]+$/.test(error.message)
    ? error.message
    : 'INTERNAL_ERROR'
  return {
    ok: false,
    error: {
      code,
      message: code === 'INTERNAL_ERROR' ? '运营服务暂时不可用' : (messages[code] || code),
    },
  }
}

async function adminFor(caller) {
  return db().one(
    `SELECT role, status FROM member_admin_roles
     WHERE app_id = ? AND user_id = ? AND status = 'ACTIVE'`,
    [caller.appId, caller.openId],
  )
}

function publicSession(admin, eventManagerEnabled = false) {
  return {
    enabled: Boolean(admin),
    role: admin?.role || null,
    capabilities: admin ? capabilitiesFor(admin.role) : [],
    eventManagerEnabled: Boolean(eventManagerEnabled),
  }
}

async function authorized(caller, capability) {
  const admin = await adminFor(caller)
  assertCapability(admin, capability)
  return admin
}

async function authorizedForEvent(caller, eventId, capability) {
  const admin = await adminFor(caller)
  if (admin && capabilitiesFor(admin.role).includes('events')) {
    return { actorRole: admin.role, scope: 'global' }
  }
  const manager = await db().one(
    `SELECT role FROM member_event_managers
     WHERE app_id = ? AND event_id = ? AND user_id = ? AND status = 'ACTIVE'`,
    [caller.appId, eventId, caller.openId],
  )
  if (!manager || !eventRoleHasCapability(manager.role, capability)) {
    throw new Error('FORBIDDEN')
  }
  return {
    actorRole: actorRoleForEventRole(manager.role),
    managerRole: normalizeEventManagerRole(manager.role),
    scope: 'event',
  }
}

function managedEventCapabilities(role, globalAccess) {
  if (globalAccess) {
    return {
      canEdit: true,
      canManageTeam: true,
      canRoster: true,
      canViewSensitiveRoster: true,
      canExportRoster: true,
      canCheckIn: true,
      canAlbum: true,
    }
  }
  const capabilities = capabilitiesForEventRole(role)
  return {
    canEdit: capabilities.includes('edit'),
    canManageTeam: capabilities.includes('team'),
    canRoster: capabilities.includes('roster'),
    canViewSensitiveRoster: capabilities.includes('rosterSensitive'),
    canExportRoster: capabilities.includes('rosterExport'),
    canCheckIn: capabilities.includes('checkin'),
    canAlbum: capabilities.includes('album'),
  }
}

async function listManagedEvents(caller) {
  const admin = await adminFor(caller)
  const globalAccess = Boolean(admin && capabilitiesFor(admin.role).includes('events'))
  const rows = globalAccess
    ? await db().query(
        `SELECT event.*, media.cloud_file_id AS cover_url,
                'GLOBAL' AS manager_role,
                COUNT(CASE WHEN registration.status IN ('REGISTERED', 'CANCELLATION_PENDING', 'ATTENDED') THEN 1 END) AS registration_count
         FROM member_events event
         LEFT JOIN member_media_assets media
           ON media.app_id = event.app_id AND media.id = event.cover_asset_id
           AND media.status = 'READY'
         LEFT JOIN member_registrations registration
           ON registration.app_id = event.app_id AND registration.event_id = event.id
         WHERE event.app_id = ?
         GROUP BY event.id, media.cloud_file_id
         ORDER BY event.starts_at DESC LIMIT 100`,
        [caller.appId],
      )
    : await db().query(
        `SELECT event.*, media.cloud_file_id AS cover_url,
                manager.role AS manager_role,
                COUNT(CASE WHEN registration.status IN ('REGISTERED', 'CANCELLATION_PENDING', 'ATTENDED') THEN 1 END) AS registration_count
         FROM member_event_managers manager
         INNER JOIN member_events event
           ON event.app_id = manager.app_id AND event.id = manager.event_id
         LEFT JOIN member_media_assets media
           ON media.app_id = event.app_id AND media.id = event.cover_asset_id
           AND media.status = 'READY'
         LEFT JOIN member_registrations registration
           ON registration.app_id = event.app_id AND registration.event_id = event.id
         WHERE manager.app_id = ? AND manager.user_id = ? AND manager.status = 'ACTIVE'
         GROUP BY event.id, media.cloud_file_id, manager.role
         ORDER BY event.starts_at DESC LIMIT 100`,
        [caller.appId, caller.openId],
      )
  return (Array.isArray(rows) ? rows : []).map((item) => ({
    id: item.id,
    title: item.title || '',
    startsAt: iso(item.starts_at) || '',
    endsAt: iso(item.ends_at) || '',
    location: item.location || item.venue_name || item.address || '',
    coverUrl: item.cover_url || '',
    status: item.status || 'DRAFT',
    managerRole: globalAccess ? 'GLOBAL' : normalizeEventManagerRole(item.manager_role),
    registrationCount: Number(item.registration_count || 0),
    ...managedEventCapabilities(item.manager_role, globalAccess),
  }))
}

async function getDashboard(caller) {
  const admin = await authorized(caller, 'dashboard')
  const canAudit = capabilitiesFor(admin.role).includes('audit')
  const canOperate = capabilitiesFor(admin.role).includes('operations')
  const canAnnounce = capabilitiesFor(admin.role).includes('announcements')
  const canReviewReports = capabilitiesFor(admin.role).includes('reports')
  const [
    profiles,
    memberships,
    events,
    registrations,
    orders,
    refunds,
    recentAudit,
    operationalExceptions,
    announcements,
    reports,
  ] = await Promise.all([
    db().one(
      `SELECT
         COUNT(DISTINCT CASE WHEN user_id IS NOT NULL THEN user_id END) AS total_users,
         COUNT(DISTINCT CASE WHEN user_id IS NOT NULL AND created_at >= UTC_TIMESTAMP(3) - INTERVAL 7 DAY THEN user_id END) AS new_users_7d,
         SUM(status = 'PENDING') AS pending_profiles
       FROM member_profiles WHERE app_id = ?`,
      [caller.appId],
    ),
    db().one(
      `SELECT COUNT(*) AS total FROM member_entitlements
       WHERE app_id = ? AND status = 'ACTIVE' AND expires_at > UTC_TIMESTAMP(3)`,
      [caller.appId],
    ),
    db().one("SELECT COUNT(*) AS total FROM member_events WHERE app_id = ? AND status = 'PUBLISHED'", [caller.appId]),
    db().one(
      `SELECT COUNT(*) AS total FROM member_registrations r
       INNER JOIN member_events e ON e.id = r.event_id AND e.app_id = r.app_id
       WHERE r.app_id = ? AND r.status IN ('REGISTERED', 'ATTENDED')
         AND e.status = 'PUBLISHED' AND e.starts_at >= UTC_TIMESTAMP(3)`,
      [caller.appId],
    ),
    db().one("SELECT COUNT(*) AS total FROM member_orders WHERE app_id = ? AND status IN ('PAID', 'REFUND_PENDING', 'REFUNDED')", [caller.appId]),
    db().one("SELECT COUNT(*) AS total FROM member_refunds WHERE app_id = ? AND status IN ('REFUND_PENDING', 'REFUND_CREATED')", [caller.appId]),
    canAudit
      ? db().query(
          `SELECT id, action, resource_type, resource_id, actor_role, created_at
           FROM member_audit_logs WHERE app_id = ? ORDER BY created_at DESC LIMIT 3`,
          [caller.appId],
        )
      : Promise.resolve([]),
    canOperate ? listOperationalExceptions(db(), caller.appId) : Promise.resolve([]),
    canAnnounce
      ? db().one(
          `SELECT COUNT(*) AS total FROM member_announcements
           WHERE app_id = ? AND status = 'PUBLISHED'`,
          [caller.appId],
        )
      : Promise.resolve(null),
    canReviewReports
      ? db().one(
          `SELECT COUNT(*) AS total FROM member_reports
           WHERE app_id = ? AND status IN ('PENDING', 'REVIEWING')`,
          [caller.appId],
        )
      : Promise.resolve(null),
  ])
  return {
    session: publicSession(admin),
    counts: {
      totalUsers: Number(profiles?.total_users || 0),
      newUsers7d: Number(profiles?.new_users_7d || 0),
      activeMembers: Number(memberships?.total || 0),
      upcomingRegistrations: Number(registrations?.total || 0),
      pendingProfiles: Number(profiles?.pending_profiles || 0),
      publishedEvents: Number(events?.total || 0),
      paidOrders: Number(orders?.total || 0),
      pendingRefunds: Number(refunds?.total || 0),
      operationalExceptions: operationalExceptions.length,
      publishedAnnouncements: Number(announcements?.total || 0),
      pendingReports: Number(reports?.total || 0),
    },
    recentAudit: recentAudit.map(publicAudit),
  }
}

async function getOperationalExceptions(caller) {
  await authorized(caller, 'operations')
  return listOperationalExceptions(db(), caller.appId)
}

async function retryOperationalException(caller, event) {
  const admin = await authorized(caller, 'operations')
  if (!event || typeof event.id !== 'string' || typeof event.type !== 'string') {
    throw new Error('OPERATION_EXCEPTION_NOT_FOUND')
  }
  if (event.type === 'MEDIA_CLEANUP') {
    return retryMediaCleanup(caller, {
      requeue: true,
      outboxId: event.id,
      expectedVersion: event.version,
      reason: 'exception center retry',
    })
  }
  if (event.type !== 'NOTIFICATION') {
    throw new Error('OPERATION_EXCEPTION_NOT_RETRYABLE')
  }
  return db().transaction(async (tx) => {
    const row = await tx.one(
      `SELECT id, status FROM member_notification_outbox
       WHERE app_id = ? AND id = ? FOR UPDATE`,
      [caller.appId, event.id],
    )
    if (!row || row.status !== 'FAILED') {
      throw new Error('OPERATION_EXCEPTION_NOT_FOUND')
    }
    const result = await tx.query(
      `UPDATE member_notification_outbox
       SET status = 'PENDING', attempts = 0, send_at = UTC_TIMESTAMP(3),
           lease_owner = NULL, lease_expires_at = NULL, last_error = NULL
       WHERE app_id = ? AND id = ? AND status = 'FAILED'`,
      [caller.appId, event.id],
    )
    if (!result || result.affectedRows !== 1) {
      throw new Error('OPERATION_EXCEPTION_NOT_FOUND')
    }
    await tx.query(
      `INSERT INTO member_audit_logs (
         app_id, actor_id, actor_role, action, resource_type, resource_id, metadata
       ) VALUES (?, ?, ?, 'NOTIFICATION_REQUEUED', 'notification_outbox', ?, ?)`,
      [
        caller.appId,
        caller.openId,
        admin.role,
        event.id,
        JSON.stringify({ source: 'exception-center' }),
      ],
    )
    return { id: event.id, status: 'PENDING' }
  })
}

async function getAnnouncements(caller, event) {
  await authorized(caller, 'announcements')
  return listAdminAnnouncements(db(), {
    appId: caller.appId,
    status: event.status,
    query: event.query,
  })
}

async function getAnnouncementForAdmin(caller, event) {
  await authorized(caller, 'announcements')
  return getAdminAnnouncement(db(), {
    appId: caller.appId,
    announcementId: event.announcementId,
  })
}

async function saveCommunityAnnouncement(caller, event) {
  const admin = await authorized(caller, 'announcements')
  return saveAnnouncement(db(), {
    appId: caller.appId,
    actorId: caller.openId,
    actorRole: admin.role,
    announcement: event.announcement,
  })
}

async function changeAnnouncementState(caller, event) {
  const admin = await authorized(caller, 'announcements')
  return setAnnouncementState(db(), {
    appId: caller.appId,
    actorId: caller.openId,
    actorRole: admin.role,
    announcementId: event.announcementId,
    action: event.transition,
    expectedVersion: event.expectedVersion,
  })
}

async function getMemberReports(caller, event) {
  await authorized(caller, 'reports')
  return listMemberReports(db(), {
    appId: caller.appId,
    status: event.status,
  })
}

async function reviewMemberReport(caller, event) {
  const admin = await authorized(caller, 'reports')
  return resolveMemberReport(db(), {
    appId: caller.appId,
    actorId: caller.openId,
    actorRole: admin.role,
    reportId: event.reportId,
    decision: event.decision,
    reason: event.reason,
    expectedVersion: event.expectedVersion,
  })
}

/**
 * Resolve READY media cloud_file_id values for a set of asset ids.
 * Mirrors membership-api mediaMap: returns permanent cloud:// file IDs;
 * the client CloudBase adapter turns them into temp/local URLs.
 */
async function mediaMap(appId, assetIds) {
  const ids = [...new Set((assetIds || []).filter(Boolean))]
  if (!ids.length) {
    return new Map()
  }
  const placeholders = ids.map(() => '?').join(', ')
  const rows = await db().query(
    `SELECT id, cloud_file_id FROM member_media_assets
     WHERE app_id = ? AND id IN (${placeholders}) AND status = 'READY'`,
    [appId, ...ids],
  )
  const list = Array.isArray(rows) ? rows : []
  return new Map(list.map(item => [item.id, item.cloud_file_id]))
}

async function listProfiles(caller, status) {
  await authorized(caller, 'profiles')
  const allowed = ['PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED', 'DELETED']
  const selected = allowed.includes(status) ? status : 'PENDING'
  const rows = await db().query(
    `SELECT id, nickname, city, headline, tags, status, updated_at, avatar_asset_id
     FROM member_profiles WHERE app_id = ? AND status = ?
     ORDER BY updated_at DESC LIMIT 50`,
    [caller.appId, selected],
  )
  const list = Array.isArray(rows) ? rows : []
  const assets = await mediaMap(caller.appId, list.map(item => item.avatar_asset_id))
  return list.map(item => ({
    id: item.id,
    nickname: item.nickname || '未命名成员',
    city: item.city || '',
    headline: item.headline || '',
    tags: jsonArray(item.tags).slice(0, 5),
    status: item.status || '',
    updatedAt: iso(item.updated_at) || '',
    avatarUrl: assets.get(item.avatar_asset_id) || '',
  }))
}

async function reviewProfile(caller, profileId, decision) {
  const admin = await authorized(caller, 'profiles')
  if (!validUuid(profileId)) {
    throw new Error('PROFILE_NOT_FOUND')
  }
  if (!['approve', 'reject'].includes(decision)) {
    throw new Error('INVALID_DECISION')
  }
  const status = decision === 'approve' ? 'APPROVED' : 'REJECTED'
  // Status change + audit must commit together; audit failure rolls status back.
  return db().transaction(async (tx) => {
    const profile = await tx.one(
      `SELECT id, status FROM member_profiles
       WHERE id = ? AND app_id = ?
       FOR UPDATE`,
      [profileId, caller.appId],
    )
    if (!profile || profile.status !== 'PENDING') {
      throw new Error('PROFILE_NOT_FOUND')
    }
    const result = await tx.query(
      `UPDATE member_profiles
       SET status = ?, approved_at = ?, updated_at = UTC_TIMESTAMP(3)
       WHERE id = ? AND app_id = ? AND status = 'PENDING'`,
      [status, decision === 'approve' ? new Date() : null, profileId, caller.appId],
    )
    if (!result || result.affectedRows !== 1) {
      throw new Error('PROFILE_NOT_FOUND')
    }
    await tx.query(
      `INSERT INTO member_audit_logs (
         app_id, actor_id, actor_role, action, resource_type, resource_id, metadata
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        caller.appId,
        caller.openId,
        admin.role,
        `PROFILE_${status}`,
        'profile',
        profileId,
        JSON.stringify({}),
      ],
    )
    return { id: profileId, status }
  })
}

async function setProfileStatus(caller, profileId, status) {
  const admin = await authorized(caller, 'profiles')
  if (!validUuid(profileId) || !['APPROVED', 'SUSPENDED'].includes(status)) {
    throw new Error('INVALID_PROFILE_TRANSITION')
  }
  // Transition + audit must commit together; audit failure rolls status back.
  return db().transaction(async (tx) => {
    const profile = await tx.one(
      `SELECT id, status FROM member_profiles
       WHERE id = ? AND app_id = ?
       FOR UPDATE`,
      [profileId, caller.appId],
    )
    if (!profile) {
      throw new Error('PROFILE_NOT_FOUND')
    }
    assertProfileTransition(profile.status, status)
    const result = await tx.query(
      `UPDATE member_profiles
       SET status = ?, approved_at = ?, updated_at = UTC_TIMESTAMP(3)
       WHERE id = ? AND app_id = ? AND status = ?`,
      [status, status === 'APPROVED' ? new Date() : null, profileId, caller.appId, profile.status],
    )
    if (!result || result.affectedRows !== 1) {
      throw new Error('INVALID_PROFILE_TRANSITION')
    }
    await tx.query(
      `INSERT INTO member_audit_logs (
         app_id, actor_id, actor_role, action, resource_type, resource_id, metadata
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        caller.appId,
        caller.openId,
        admin.role,
        `PROFILE_${status}`,
        'profile',
        profileId,
        JSON.stringify({}),
      ],
    )
    return { id: profileId, status }
  })
}

async function listEvents(caller) {
  const admin = await adminFor(caller)
  const globalAccess = Boolean(admin && capabilitiesFor(admin.role).includes('events'))
  const rows = globalAccess
    ? await db().query(
        `SELECT event.*, media.cloud_file_id AS cover_url, 'GLOBAL' AS operator_role
         FROM member_events event
         LEFT JOIN member_media_assets media
           ON media.app_id = event.app_id AND media.id = event.cover_asset_id
           AND media.status = 'READY'
         WHERE event.app_id = ? ORDER BY event.starts_at DESC LIMIT 50`,
        [caller.appId],
      )
    : await db().query(
        `SELECT event.*, media.cloud_file_id AS cover_url, manager.role AS operator_role
         FROM member_event_managers manager
         INNER JOIN member_events event
           ON event.app_id = manager.app_id AND event.id = manager.event_id
         LEFT JOIN member_media_assets media
           ON media.app_id = event.app_id AND media.id = event.cover_asset_id
           AND media.status = 'READY'
         WHERE manager.app_id = ? AND manager.user_id = ? AND manager.status = 'ACTIVE'
           AND manager.role IN ('EVENT_OWNER', 'EVENT_MANAGER', 'EDITOR')
         ORDER BY event.starts_at DESC LIMIT 50`,
        [caller.appId, caller.openId],
      )
  if (!globalAccess && !rows.length) {
    throw new Error('FORBIDDEN')
  }
  return rows.map((row) => {
    const event = mapEventRow(row)
    const isGlobal = row.operator_role === 'GLOBAL'
    return {
      ...event,
      canDuplicate: isGlobal,
      canManageTeam: isGlobal || eventRoleHasCapability(row.operator_role, 'team'),
    }
  })
}

async function saveEvent(caller, value) {
  const access = value?.id
    ? await authorizedForEvent(caller, value.id, 'edit')
    : { actorRole: (await authorized(caller, 'events')).role }
  return saveEventWorkflow(db(), {
    appId: caller.appId,
    actorId: caller.openId,
    actorRole: access.actorRole,
    value,
  })
}

async function duplicateEvent(caller, eventId) {
  const admin = await authorized(caller, 'events')
  return duplicateEventWorkflow(db(), {
    appId: caller.appId,
    actorId: caller.openId,
    actorRole: admin.role,
    eventId,
  })
}

async function setEventStatus(caller, eventId, status, expectedVersion) {
  const access = await authorizedForEvent(caller, eventId, 'publish')
  return setEventStatusWorkflow(db(), {
    appId: caller.appId,
    actorId: caller.openId,
    actorRole: access.actorRole,
    eventId,
    status,
    expectedVersion,
  })
}

async function cancelEvent(caller, eventId, reason, expectedVersion) {
  const access = await authorizedForEvent(caller, eventId, 'publish')
  return cancelEventWorkflow(db(), {
    appId: caller.appId,
    actorId: caller.openId,
    actorRole: access.actorRole,
    eventId,
    reason,
    expectedVersion,
  })
}

async function listEventRegistrations(caller, event) {
  const access = await authorizedForEvent(caller, event.eventId, 'roster')
  const canViewSensitiveRoster = access.scope === 'global'
    || eventRoleHasCapability(access.managerRole, 'rosterSensitive')
  const page = await listEventRegistrationsWorkflow(db(), {
    appId: caller.appId,
    eventId: event.eventId,
    status: event.status,
    query: event.query,
    cursor: event.cursor,
    limit: event.limit,
    includeContact: canViewSensitiveRoster,
  })
  return {
    ...page,
    canViewSensitiveRoster,
    canExportRoster: access.scope === 'global'
      || eventRoleHasCapability(access.managerRole, 'rosterExport'),
    canReviewRegistration: access.scope === 'global'
      || eventRoleHasCapability(access.managerRole, 'registrationReview'),
    canCheckIn: access.scope === 'global'
      || eventRoleHasCapability(access.managerRole, 'checkin'),
    canUndoCheckIn: ['owner', 'manager'].includes(access.actorRole),
    canOverrideCheckIn: access.actorRole === 'owner',
  }
}

async function reviewEventRegistration(caller, event) {
  const access = await authorizedForEvent(caller, event.eventId, 'registrationReview')
  return reviewEventRegistrationWorkflow(db(), {
    appId: caller.appId,
    actorId: caller.openId,
    actorRole: access.actorRole,
    eventId: event.eventId,
    registrationId: event.registrationId,
    decision: event.decision,
    reason: event.reason,
    expectedVersion: event.expectedVersion,
  })
}

async function checkInRegistration(caller, event) {
  const access = await authorizedForEvent(caller, event.eventId, 'checkin')
  // Only owner may request window override; other roles never get allowOverride=true.
  const allowOverride = Boolean(event.allowOverride) && access.actorRole === 'owner'
  return checkInRegistrationWorkflow(db(), {
    appId: caller.appId,
    actorId: caller.openId,
    actorRole: access.actorRole,
    eventId: event.eventId,
    registrationId: event.registrationId,
    expectedVersion: event.expectedVersion,
    allowOverride,
    idempotencyKey: event.idempotencyKey,
  })
}

async function undoCheckIn(caller, event) {
  const access = await authorizedForEvent(caller, event.eventId, 'checkin')
  return undoCheckInWorkflow(db(), {
    appId: caller.appId,
    actorId: caller.openId,
    actorRole: access.actorRole,
    eventId: event.eventId,
    registrationId: event.registrationId,
    expectedVersion: event.expectedVersion,
    reason: event.reason,
    idempotencyKey: event.idempotencyKey,
  })
}

async function createRosterExport(caller, event) {
  const access = await authorizedForEvent(caller, event.eventId, 'rosterExport')
  return createRosterExportWorkflow(db(), {
    appId: caller.appId,
    actorId: caller.openId,
    actorRole: access.actorRole,
    eventId: event.eventId,
    status: event.status,
    query: event.query,
  })
}

async function downloadRosterExport(caller, event) {
  const access = await authorizedForEvent(caller, event.eventId, 'rosterExport')
  return downloadRosterExportWorkflow(db(), {
    appId: caller.appId,
    actorId: caller.openId,
    actorRole: access.actorRole,
    eventId: event.eventId,
    downloadToken: event.downloadToken,
  })
}

async function listEventManagers(caller, eventId) {
  if (!validUuid(eventId)) throw new Error('INVALID_EVENT')
  await authorizedForEvent(caller, eventId, 'team')
  const rows = await db().query(
    `SELECT m.user_id, m.role, m.status, m.created_at,
            p.id AS profile_id, p.nickname, p.city, p.organization, p.role_title,
            media.cloud_file_id AS avatar_url
     FROM member_event_managers m
     LEFT JOIN member_profiles p ON p.app_id = m.app_id AND p.user_id = m.user_id
     LEFT JOIN member_media_assets media
       ON media.app_id = p.app_id AND media.id = p.avatar_asset_id AND media.status = 'READY'
     WHERE m.app_id = ? AND m.event_id = ? AND m.status = 'ACTIVE'
     ORDER BY m.created_at ASC`,
    [caller.appId, eventId],
  )
  return rows.map(item => ({
    profileId: item.profile_id || '',
    nickname: item.nickname || '活动管理员',
    city: item.city || '',
    organization: item.organization || '',
    roleTitle: item.role_title || '',
    avatarUrl: item.avatar_url || '',
    role: normalizeEventManagerRole(item.role) || 'EVENT_STAFF',
    createdAt: iso(item.created_at) || '',
  }))
}

async function setEventManager(caller, event) {
  if (!validUuid(event.eventId) || !validUuid(event.profileId)) {
    throw new Error('INVALID_EVENT')
  }
  const access = await authorizedForEvent(caller, event.eventId, 'team')
  const role = String(event.role || '')
  if (!EVENT_MANAGER_ROLES.includes(role)) {
    throw new Error('INVALID_EVENT_MANAGER_ROLE')
  }
  const target = await db().one(
    `SELECT user_id FROM member_profiles
     WHERE app_id = ? AND id = ? AND status = 'APPROVED'`,
    [caller.appId, event.profileId],
  )
  if (!target) throw new Error('PROFILE_NOT_FOUND')
  const active = event.active !== false
  await db().transaction(async (tx) => {
    const current = await tx.one(
      `SELECT role FROM member_event_managers
       WHERE app_id = ? AND event_id = ? AND user_id = ? AND status = 'ACTIVE'
       FOR UPDATE`,
      [caller.appId, event.eventId, target.user_id],
    )
    const removesOwner = normalizeEventManagerRole(current?.role) === 'EVENT_OWNER'
      && (!active || role !== 'EVENT_OWNER')
    if (removesOwner) {
      const owners = await tx.one(
        `SELECT COUNT(*) AS total FROM member_event_managers
         WHERE app_id = ? AND event_id = ? AND status = 'ACTIVE'
           AND role = 'EVENT_OWNER'`,
        [caller.appId, event.eventId],
      )
      if (Number(owners?.total || 0) <= 1) {
        throw new Error('EVENT_OWNER_REQUIRED')
      }
    }
    await tx.query(
      `INSERT INTO member_event_managers (
         app_id, event_id, user_id, role, status, assigned_by
       ) VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         role = VALUES(role), status = VALUES(status),
         assigned_by = VALUES(assigned_by), updated_at = UTC_TIMESTAMP(3)`,
      [
        caller.appId,
        event.eventId,
        target.user_id,
        role,
        active ? 'ACTIVE' : 'REVOKED',
        caller.openId,
      ],
    )
    await tx.query(
      `INSERT INTO member_audit_logs (
         app_id, actor_id, actor_role, action, resource_type, resource_id, metadata
       ) VALUES (?, ?, ?, ?, 'event', ?, ?)`,
      [
        caller.appId,
        caller.openId,
        access.actorRole,
        active ? 'EVENT_MANAGER_ASSIGNED' : 'EVENT_MANAGER_REVOKED',
        event.eventId,
        JSON.stringify({ profileId: event.profileId, role }),
      ],
    )
  })
  return { eventId: event.eventId, profileId: event.profileId, role, active }
}

async function listPendingEventPhotos(caller, eventId) {
  await authorizedForEvent(caller, eventId, 'album')
  const rows = await db().query(
    `SELECT photo.id, photo.caption, photo.status, photo.version, photo.created_at,
            profile.nickname, media.cloud_file_id
     FROM member_event_photos photo
     INNER JOIN member_media_assets media
       ON media.app_id = photo.app_id AND media.id = photo.media_asset_id
     LEFT JOIN member_profiles profile
       ON profile.app_id = photo.app_id AND profile.user_id = photo.user_id
     WHERE photo.app_id = ? AND photo.event_id = ? AND photo.status = 'PENDING_REVIEW'
     ORDER BY photo.created_at ASC LIMIT 100`,
    [caller.appId, eventId],
  )
  return rows.map(item => ({
    id: item.id,
    caption: item.caption || '',
    status: item.status,
    version: Number(item.version || 1),
    nickname: item.nickname || '活动成员',
    imageUrl: item.cloud_file_id || '',
    createdAt: iso(item.created_at) || '',
  }))
}

async function reviewEventPhoto(caller, event) {
  if (!validUuid(event.eventId) || !validUuid(event.photoId)) {
    throw new Error('PHOTO_NOT_FOUND')
  }
  const access = await authorizedForEvent(caller, event.eventId, 'album')
  const decision = event.decision === 'approve' ? 'PUBLISHED' : 'REJECTED'
  const reason = typeof event.reason === 'string' ? event.reason.trim().slice(0, 300) : ''
  return db().transaction(async (tx) => {
    const photo = await tx.one(
      `SELECT id, version FROM member_event_photos
       WHERE app_id = ? AND event_id = ? AND id = ? AND status = 'PENDING_REVIEW'
       FOR UPDATE`,
      [caller.appId, event.eventId, event.photoId],
    )
    if (!photo || Number(photo.version) !== Number(event.expectedVersion)) {
      throw new Error('PHOTO_NOT_FOUND')
    }
    await tx.query(
      `UPDATE member_event_photos SET
         status = ?, reviewed_by = ?, reviewed_at = UTC_TIMESTAMP(3),
         rejection_reason = ?, version = version + 1, updated_at = UTC_TIMESTAMP(3)
       WHERE app_id = ? AND id = ? AND status = 'PENDING_REVIEW' AND version = ?`,
      [
        decision,
        caller.openId,
        decision === 'REJECTED' ? reason : null,
        caller.appId,
        event.photoId,
        Number(event.expectedVersion),
      ],
    )
    await tx.query(
      `INSERT INTO member_audit_logs (
         app_id, actor_id, actor_role, action, resource_type, resource_id, metadata
       ) VALUES (?, ?, ?, ?, 'event-photo', ?, ?)`,
      [
        caller.appId,
        caller.openId,
        access.actorRole,
        decision === 'PUBLISHED' ? 'EVENT_PHOTO_APPROVED' : 'EVENT_PHOTO_REJECTED',
        event.photoId,
        JSON.stringify({ eventId: event.eventId, reason }),
      ],
    )
    return { id: event.photoId, status: decision, version: Number(photo.version) + 1 }
  })
}

async function checkInByQr(caller, value) {
  const prefix = 'mbr-checkin:v1:'
  if (typeof value !== 'string' || !value.startsWith(prefix) || value.length > 256) {
    throw new Error('CHECKIN_CREDENTIAL_INVALID')
  }
  const tokenHash = createHash('sha256').update(value.slice(prefix.length)).digest('hex')
  const credential = await db().one(
    `SELECT c.id, c.registration_id, c.expires_at, c.consumed_at,
            r.event_id, r.version
     FROM member_checkin_credentials c
     INNER JOIN member_registrations r
       ON r.app_id = c.app_id AND r.id = c.registration_id
     WHERE c.app_id = ? AND c.token_hash = ?`,
    [caller.appId, tokenHash],
  )
  if (!credential || credential.consumed_at
    || !credential.expires_at
    || new Date(credential.expires_at).getTime() <= Date.now()) {
    throw new Error('CHECKIN_CREDENTIAL_INVALID')
  }
  const access = await authorizedForEvent(caller, credential.event_id, 'checkin')
  const result = await checkInRegistrationWorkflow(db(), {
    appId: caller.appId,
    actorId: caller.openId,
    actorRole: access.actorRole,
    eventId: credential.event_id,
    registrationId: credential.registration_id,
    expectedVersion: Number(credential.version),
    allowOverride: false,
    idempotencyKey: `qr-${credential.id}`,
  })
  const consumed = await db().query(
    `UPDATE member_checkin_credentials
     SET consumed_at = UTC_TIMESTAMP(3)
     WHERE app_id = ? AND id = ? AND consumed_at IS NULL AND expires_at > UTC_TIMESTAMP(3)`,
    [caller.appId, credential.id],
  )
  if (!consumed || consumed.affectedRows !== 1) {
    throw new Error('CHECKIN_CREDENTIAL_INVALID')
  }
  return result
}

async function listOrders(caller) {
  const admin = await authorized(caller, 'orders')
  const [orders, plans] = await Promise.all([
    db().query(
      `SELECT o.*, r.id AS refund_id, r.status AS refund_status
       FROM member_orders o
       LEFT JOIN member_refunds r ON r.app_id = o.app_id AND r.order_id = o.id
       WHERE o.app_id = ? ORDER BY o.created_at DESC LIMIT 50`,
      [caller.appId],
    ),
    db().query(
      'SELECT id, name FROM member_plans WHERE app_id = ? LIMIT 100',
      [caller.appId],
    ),
  ])
  const planNames = new Map(plans.map(plan => [plan.id, plan.name]))
  const roleCanRefund = capabilitiesFor(admin.role).includes('refunds')
  const results = []
  for (const item of orders) {
    // Align list canRefund with the write-path attended / multi-order gate.
    // eslint-disable-next-line no-await-in-loop
    const eligibility = await evaluateMembershipRefundEligibility(db(), {
      appId: caller.appId,
      userId: item.user_id,
      orderType: item.order_type,
      orderId: item.id,
      order: item,
      roleCanRefund,
      hasRefund: Boolean(item.refund_id) && item.refund_status !== 'REFUND_FAILED',
    })
    results.push({
      id: item.id,
      planName: planNames.get(item.product_id) || item.description || item.product_id,
      amountCents: Number(item.amount_cents || 0),
      status: item.refund_status === 'REFUND_FAILED' ? 'REFUND_FAILED' : (item.status || ''),
      createdAt: iso(item.created_at) || '',
      paidAt: iso(item.paid_at),
      canRefund: eligibility.canRefund,
      refundBlockReason: eligibility.canRefund ? null : eligibility.refundBlockReason,
      canConfirmRefund: admin.role === 'owner'
        && item.status === 'REFUND_PENDING'
        && ['REFUND_PENDING', 'REFUND_CREATED'].includes(item.refund_status),
      refundId: item.refund_id || null,
    })
  }
  return results
}

async function requestRefund(caller, orderId, reason) {
  const normalizedReason = typeof reason === 'string' ? reason.trim() : ''
  if (normalizedReason.length < 1 || normalizedReason.length > 120) {
    throw new Error('INVALID_REFUND_REASON')
  }
  return db().transaction(async (tx) => {
    const admin = await tx.one(
      `SELECT role FROM member_admin_roles
       WHERE app_id = ? AND user_id = ? AND status = 'ACTIVE'
         AND role IN ('owner', 'manager', 'support')
       FOR SHARE`,
      [caller.appId, caller.openId],
    )
    if (!admin) {
      throw new Error('FORBIDDEN')
    }
    const order = await tx.one(
      'SELECT * FROM member_orders WHERE app_id = ? AND id = ? FOR UPDATE',
      [caller.appId, orderId],
    )
    if (!order) {
      throw new Error('ORDER_NOT_FOUND')
    }
    const existing = await tx.one(
      'SELECT id, status FROM member_refunds WHERE app_id = ? AND order_id = ? FOR UPDATE',
      [caller.appId, orderId],
    )
    if (existing) {
      if (existing.status === 'REFUND_FAILED' && order.status === 'PAID') {
        await assertMembershipRefundAllowed(tx, {
          appId: caller.appId,
          userId: order.user_id,
          orderType: order.order_type,
          orderId: order.id,
          order,
        })
        const refundUpdate = await tx.query(
          `UPDATE member_refunds SET
             out_refund_no = ?, status = 'REFUND_PENDING', refund_id = NULL,
             submitted_at = NULL, refunded_at = NULL, requested_by = ?,
             reason = ?, updated_at = UTC_TIMESTAMP(3)
           WHERE app_id = ? AND id = ? AND status = 'REFUND_FAILED'`,
          [retryRefundNumber(), caller.openId, normalizedReason, caller.appId, existing.id],
        )
        const orderUpdate = await tx.query(
          `UPDATE member_orders SET status = 'REFUND_PENDING', updated_at = UTC_TIMESTAMP(3)
           WHERE app_id = ? AND id = ? AND status = 'PAID'`,
          [caller.appId, order.id],
        )
        if (!refundUpdate?.affectedRows || !orderUpdate?.affectedRows) {
          throw new Error('ORDER_STATUS_CONFLICT')
        }
        await tx.query(
          `INSERT INTO member_audit_logs (
             app_id, actor_id, actor_role, action, resource_type, resource_id, metadata
           ) VALUES (?, ?, ?, 'REFUND_RETRIED', 'order', ?, ?)`,
          [caller.appId, caller.openId, admin.role, order.id, JSON.stringify({ refundId: existing.id })],
        )
        return { id: existing.id, status: 'REFUND_PENDING' }
      }
      return existing
    }
    if (order.status !== 'PAID') {
      throw new Error('ORDER_NOT_REFUNDABLE')
    }
    await assertMembershipRefundAllowed(tx, {
      appId: caller.appId,
      userId: order.user_id,
      orderType: order.order_type,
      orderId: order.id,
      order,
    })
    const refundId = randomUUID()
    const digest = createHash('sha256').update(`${order.id}:full-refund`).digest('hex').slice(0, 31).toUpperCase()
    const outRefundNo = `R${digest}`
    await tx.query(
      `INSERT INTO member_refunds (
         id, app_id, order_id, out_trade_no, out_refund_no, amount_cents,
         currency, requested_by, reason, status
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'REFUND_PENDING')`,
      [refundId, caller.appId, order.id, order.out_trade_no, outRefundNo, order.amount_cents, order.currency, caller.openId, normalizedReason],
    )
    const orderUpdate = await tx.query(
      `UPDATE member_orders SET status = 'REFUND_PENDING', updated_at = UTC_TIMESTAMP(3)
       WHERE id = ? AND status = 'PAID'`,
      [order.id],
    )
    // Concurrency: another writer may have left PAID between FOR UPDATE and UPDATE.
    // Fail before audit so the transaction rolls back the refund insert.
    if (!orderUpdate || orderUpdate.affectedRows !== 1) {
      throw new Error('ORDER_STATUS_CONFLICT')
    }
    await tx.query(
      `INSERT INTO member_audit_logs (
         app_id, actor_id, actor_role, action, resource_type, resource_id, metadata
       ) VALUES (?, ?, ?, 'REFUND_REQUESTED', 'order', ?, ?)`,
      [caller.appId, caller.openId, admin.role, order.id, JSON.stringify({ refundId })],
    )
    return { id: refundId, status: 'REFUND_PENDING' }
  })
}

async function createRefund(caller, orderId, reason) {
  await authorized(caller, 'refunds')
  if (!validUuid(orderId)) {
    throw new Error('ORDER_NOT_FOUND')
  }
  const refund = await requestRefund(caller, orderId, reason)
  return { refundId: String(refund.id), status: refund.status || 'REFUND_PENDING' }
}

function publicAudit(item) {
  return {
    id: String(item.id),
    action: item.action || '',
    resourceType: item.resource_type || '',
    resourceId: item.resource_id || '',
    actorRole: item.actor_role || '',
    createdAt: iso(item.created_at) || '',
  }
}

async function listAudit(caller) {
  await authorized(caller, 'audit')
  const rows = await db().query(
    `SELECT id, action, resource_type, resource_id, actor_role, created_at
     FROM member_audit_logs WHERE app_id = ? ORDER BY created_at DESC LIMIT 100`,
    [caller.appId],
  )
  return rows.map(publicAudit)
}

async function listAdminRoles(caller) {
  await authorized(caller, 'roles')
  const rows = await db().query(
    `SELECT p.id AS profile_id, p.nickname, p.city, r.role, r.status, r.created_at
     FROM member_admin_roles r
     LEFT JOIN member_profiles p
       ON p.app_id = r.app_id AND p.user_id = r.user_id
     WHERE r.app_id = ?
     ORDER BY FIELD(r.role, 'owner', 'manager', 'reviewer', 'support'), r.created_at ASC`,
    [caller.appId],
  )
  return (Array.isArray(rows) ? rows : []).map(item => ({
    profileId: item.profile_id || '',
    nickname: item.nickname || (item.role === 'owner' ? '主理人' : '未命名管理员'),
    city: item.city || '',
    role: item.role,
    status: item.status,
    capabilities: capabilitiesFor(item.role),
    createdAt: iso(item.created_at) || '',
  }))
}

async function setAdminRole(caller, event) {
  const admin = await authorized(caller, 'roles')
  const profileId = event.profileId
  const role = String(event.role || '')
  const active = event.active !== false
  if (!validUuid(profileId)) throw new Error('PROFILE_NOT_FOUND')
  if (!['manager', 'reviewer', 'support'].includes(role)) throw new Error('INVALID_ADMIN_ROLE')
  return db().transaction(async (tx) => {
    const profile = await tx.one(
      `SELECT id, user_id, nickname FROM member_profiles
       WHERE id = ? AND app_id = ? AND status = 'APPROVED'
       FOR UPDATE`,
      [profileId, caller.appId],
    )
    if (!profile?.user_id) throw new Error('PROFILE_NOT_FOUND')
    if (profile.user_id === caller.openId) throw new Error('ADMIN_SELF_MUTATION_FORBIDDEN')
    const existing = await tx.one(
      `SELECT role FROM member_admin_roles WHERE app_id = ? AND user_id = ? FOR UPDATE`,
      [caller.appId, profile.user_id],
    )
    if (existing?.role === 'owner') throw new Error('FORBIDDEN')
    const status = active ? 'ACTIVE' : 'SUSPENDED'
    await tx.query(
      `INSERT INTO member_admin_roles (app_id, user_id, role, status)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE role = VALUES(role), status = VALUES(status), updated_at = UTC_TIMESTAMP(3)`,
      [caller.appId, profile.user_id, role, status],
    )
    await tx.query(
      `INSERT INTO member_audit_logs (
         app_id, actor_id, actor_role, action, resource_type, resource_id, metadata
       ) VALUES (?, ?, ?, ?, 'profile', ?, ?)`,
      [
        caller.appId,
        caller.openId,
        admin.role,
        active ? 'ADMIN_ROLE_ASSIGNED' : 'ADMIN_ROLE_SUSPENDED',
        profileId,
        JSON.stringify({ role, status }),
      ],
    )
    return { profileId, nickname: profile.nickname || '', role, status }
  })
}

const handlers = {
  getDashboard: caller => getDashboard(caller),
  listManagedEvents: caller => listManagedEvents(caller),
  listProfiles: (caller, event) => listProfiles(caller, event.status),
  reviewProfile: (caller, event) => reviewProfile(caller, event.profileId, event.decision),
  setProfileStatus: (caller, event) => setProfileStatus(caller, event.profileId, event.status),
  listEvents: caller => listEvents(caller),
  saveEvent: (caller, event) => saveEvent(caller, event.event),
  duplicateEvent: (caller, event) => duplicateEvent(caller, event.eventId),
  setEventStatus: (caller, event) => setEventStatus(
    caller,
    event.eventId,
    event.status,
    event.expectedVersion,
  ),
  cancelEvent: (caller, event) => cancelEvent(
    caller,
    event.eventId,
    event.reason,
    event.expectedVersion,
  ),
  listEventRegistrations: (caller, event) => listEventRegistrations(caller, event),
  reviewEventRegistration: (caller, event) => reviewEventRegistration(caller, event),
  checkInRegistration: (caller, event) => checkInRegistration(caller, event),
  undoCheckIn: (caller, event) => undoCheckIn(caller, event),
  createRosterExport: (caller, event) => createRosterExport(caller, event),
  downloadRosterExport: (caller, event) => downloadRosterExport(caller, event),
  listEventManagers: (caller, event) => listEventManagers(caller, event.eventId),
  setEventManager: (caller, event) => setEventManager(caller, event),
  listPendingEventPhotos: (caller, event) => listPendingEventPhotos(caller, event.eventId),
  reviewEventPhoto: (caller, event) => reviewEventPhoto(caller, event),
  checkInByQr: (caller, event) => checkInByQr(caller, event.value),
  listOrders: caller => listOrders(caller),
  createRefund: (caller, event) => createRefund(caller, event.orderId, event.reason),
  listAudit: caller => listAudit(caller),
  listOperationalExceptions: caller => getOperationalExceptions(caller),
  retryOperationalException: (caller, event) => retryOperationalException(caller, event),
  listAnnouncements: (caller, event) => getAnnouncements(caller, event),
  getAnnouncement: (caller, event) => getAnnouncementForAdmin(caller, event),
  saveAnnouncement: (caller, event) => saveCommunityAnnouncement(caller, event),
  setAnnouncementState: (caller, event) => changeAnnouncementState(caller, event),
  listMemberReports: (caller, event) => getMemberReports(caller, event),
  resolveMemberReport: (caller, event) => reviewMemberReport(caller, event),
  listAdminRoles: caller => listAdminRoles(caller),
  setAdminRole: (caller, event) => setAdminRole(caller, event),
  retryMediaCleanup: (caller, event) => retryMediaCleanup(caller, event),
  healthDeep: (caller, event) => healthDeep(caller, event),
}

/**
 * Read-only grant probe for public health. Never takes write locks or writes rows.
 */
async function proveExportIntegrityGrantsReadOnly(database) {
  const probeAppId = '__health_probe_app__'
  const ticket = await database.one(
    `SELECT COUNT(*) AS c FROM member_export_tickets WHERE 1 = 0`,
  )
  const idem = await database.one(
    `SELECT COUNT(*) AS c FROM member_mutation_idempotency WHERE 1 = 0`,
  )
  const outbox = await database.one(
    `SELECT COUNT(*) AS c FROM member_media_cleanup_outbox WHERE 1 = 0`,
  ).catch(() => null)
  const operationalExceptions = await listOperationalExceptions(database, probeAppId)
  const announcements = await listAdminAnnouncements(database, { appId: probeAppId })
  const reports = await listMemberReports(database, { appId: probeAppId })
  return {
    exportTickets: ticket !== undefined && ticket !== null,
    mutationIdempotency: idem !== undefined && idem !== null,
    mediaCleanupOutbox: outbox !== null,
    operationalExceptionsRead: Array.isArray(operationalExceptions),
    announcementsRead: Array.isArray(announcements),
    memberReportsRead: Array.isArray(reports),
    appScoped: true,
    mode: 'read-only',
  }
}

/**
 * Deep write probe — owner only, or signed internal maintenance.
 * Strict app_id scope; always rolls back so no probe rows commit.
 */
async function proveExportIntegrityGrantsWrite(database) {
  const probeApp = '__health_probe_app__'
  const eventId = randomUUID()
  const ticketId = randomUUID()
  const tokenHash = createHash('sha256').update(`health:${ticketId}`).digest('hex')
  const contentSha = createHash('sha256').update('health-probe').digest('hex')
  class HealthProbeRollback extends Error {
    constructor() {
      super('HEALTH_PROBE_ROLLBACK')
      this.code = 'HEALTH_PROBE_ROLLBACK'
    }
  }
  try {
    await database.transaction(async (tx) => {
      await tx.query(
        `INSERT INTO member_events (
           id, app_id, title, summary, description, starts_at, ends_at,
           location, address, capacity, member_free, price_cents, status
         ) VALUES (
           ?, ?, 'health-probe', 'health-probe', 'health-probe',
           UTC_TIMESTAMP(3) + INTERVAL 2 DAY,
           UTC_TIMESTAMP(3) + INTERVAL 2 DAY + INTERVAL 2 HOUR,
           'probe', 'probe', 1, 0, 0, 'DRAFT'
         )`,
        [eventId, probeApp],
      )
      await tx.query(
        `INSERT INTO member_export_tickets (
           id, app_id, event_id, operator_id, token_hash, file_id, object_key,
           file_name, content_type, content_bytes, content_sha256,
           row_count, expires_at, status, version
         ) VALUES (
           ?, ?, ?, 'health', ?,
           'cloud://health-probe/membership-exports/health/probe.xlsx',
           'membership-exports/health/probe.xlsx',
           'probe.xlsx',
           'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
           4, ?, 0, UTC_TIMESTAMP(3) + INTERVAL 15 MINUTE, 'ACTIVE', 1
         )`,
        [ticketId, probeApp, eventId, tokenHash, contentSha],
      )
      const ticket = await tx.one(
        `SELECT id FROM member_export_tickets
         WHERE app_id = ? AND id = ? FOR UPDATE`,
        [probeApp, ticketId],
      )
      if (!ticket) {
        throw new Error('HEALTH_EXPORT_TICKET_GRANT_FAILED')
      }
      await tx.query(
        `UPDATE member_export_tickets
         SET status = 'RESERVED', reserved_until = UTC_TIMESTAMP(3) + INTERVAL 30 SECOND
         WHERE app_id = ? AND id = ?`,
        [probeApp, ticketId],
      )
      await tx.query(
        `INSERT INTO member_mutation_idempotency (
           app_id, scope, idempotency_key, payload_hash,
           resource_type, resource_id, response_json
         ) VALUES (?, 'checkin', ?, ?, 'registration', 'health', ?)`,
        [
          probeApp,
          `health-${ticketId}`,
          contentSha,
          JSON.stringify({ ok: true }),
        ],
      )
      const idem = await tx.one(
        `SELECT app_id FROM member_mutation_idempotency
         WHERE app_id = ? AND scope = 'checkin' AND idempotency_key = ?
         FOR UPDATE`,
        [probeApp, `health-${ticketId}`],
      )
      if (!idem || idem.app_id !== probeApp) {
        throw new Error('HEALTH_IDEMPOTENCY_GRANT_FAILED')
      }
      throw new HealthProbeRollback()
    })
  }
  catch (error) {
    if (error?.code === 'HEALTH_PROBE_ROLLBACK' || error?.message === 'HEALTH_PROBE_ROLLBACK') {
      return {
        exportTickets: true,
        mutationIdempotency: true,
        appScoped: true,
        mode: 'write-probe',
      }
    }
    throw error
  }
  throw new Error('HEALTH_PROBE_DID_NOT_ROLLBACK')
}

function verifyMaintenanceSignature(event) {
  const secret = process.env.MEMBERSHIP_MAINTENANCE_SECRET || ''
  if (!secret || secret.length < 32) {
    return false
  }
  if (!event?.signedAt || !event?.nonce || !event?.signature) {
    return false
  }
  const age = Math.abs(Date.now() - Number(event.signedAt))
  if (!Number.isFinite(age) || age > 5 * 60 * 1000) {
    return false
  }
  const { createHmac, timingSafeEqual } = require('node:crypto')
  const payload = JSON.stringify({
    action: event.action,
    appId: event.appId || null,
    signedAt: Number(event.signedAt),
    nonce: String(event.nonce),
  })
  const expected = createHmac('sha256', secret).update(payload).digest('hex')
  const provided = String(event.signature)
  if (expected.length !== provided.length) {
    return false
  }
  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(provided))
  }
  catch {
    return false
  }
}

async function healthDeep(caller, event = {}) {
  const signed = verifyMaintenanceSignature({ ...event, action: 'healthDeep', appId: caller.appId })
  if (!signed) {
    const admin = await authorized(caller, 'audit')
    if (admin.role !== 'owner') {
      throw new Error('FORBIDDEN')
    }
  }
  return proveExportIntegrityGrantsWrite(db())
}

async function retryMediaCleanup(caller, event = {}) {
  const signed = verifyMaintenanceSignature({
    ...event,
    action: 'retryMediaCleanup',
    appId: caller.appId,
  })
  let actorRole = signed ? 'maintenance' : null
  if (!signed) {
    const admin = await authorized(caller, 'audit')
    if (!['owner', 'manager'].includes(admin.role)) {
      throw new Error('FORBIDDEN')
    }
    actorRole = admin.role
  }
  const wantsRequeue = event.requeue === true || event.requeue === 'true'
  let requeue = null
  if (wantsRequeue) {
    const outboxId = typeof event.outboxId === 'string' ? event.outboxId : ''
    if (!outboxId) {
      throw new Error('OUTBOX_ID_REQUIRED')
    }
    const expectedVersion = event.expectedVersion ?? event.version
    requeue = await db().transaction(async (tx) => {
      const result = await requeueTerminalCleanup(tx, {
        appId: caller.appId,
        outboxId,
        expectedVersion,
        actorId: caller.openId,
        reason: typeof event.reason === 'string' ? event.reason : 'manual requeue',
      })
      if (result.ok) {
        await tx.query(
          `INSERT INTO member_audit_logs (
             app_id, actor_id, actor_role, action, resource_type, resource_id, metadata
           ) VALUES (?, ?, ?, 'MEDIA_CLEANUP_REQUEUED', 'media_cleanup_outbox', ?, ?)`,
          [
            caller.appId,
            caller.openId,
            actorRole || 'owner',
            outboxId,
            JSON.stringify({
              outboxId,
              expectedVersion: Number(expectedVersion),
              reason: result.reason,
              signed: Boolean(signed),
            }),
          ],
        )
      }
      return result
    })
    if (!requeue.ok) {
      return {
        requeued: false,
        processed: 0,
        results: [],
        leaseOwner: `admin:${caller.openId.slice(0, 16)}`,
      }
    }
  }
  const batch = await processDueCleanup(db(), cloud, {
    appId: caller.appId,
    userId: typeof event.userId === 'string' ? event.userId : null,
    limit: Number(event.limit) || 20,
    leaseOwner: `admin:${caller.openId.slice(0, 16)}`,
  })
  if (requeue) {
    return { requeued: true, ...batch }
  }
  return batch
}

exports.main = async (event = {}) => {
  if (event.action === 'health') {
    // Public health is read-only: no write locks, no rollback writes.
    await db().one('SELECT 1 AS ok')
    const exportIntegrity = await proveExportIntegrityGrantsReadOnly(db())
    return success({
      service: 'membership-admin-api',
      status: 'ok',
      persistence: 'cloudbase-mysql',
      appAllowlistConfigured: allowedAppIds.size > 0,
      exportIntegrityGrants: exportIntegrity,
      contractVersion: 12,
    })
  }
  try {
    const caller = identity()
    if (event.action === 'getSession') {
      const [admin, eventManager] = await Promise.all([
        adminFor(caller),
        db().one(
          `SELECT 1 AS present FROM member_event_managers
           WHERE app_id = ? AND user_id = ? AND status = 'ACTIVE' LIMIT 1`,
          [caller.appId, caller.openId],
        ),
      ])
      return success(publicSession(admin, Boolean(eventManager)))
    }
    const handler = handlers[event.action]
    if (!handler) {
      throw new Error('UNSUPPORTED_ACTION')
    }
    return success(await handler(caller, event))
  }
  catch (error) {
    console.error('[membership-admin-api]', event.action, error)
    return failure(error)
  }
}

module.exports._test = {
  publicSession,
  identity,
  resolveTrustedIdentity,
}
