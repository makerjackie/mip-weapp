'use strict'

const { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } = require('node:crypto')
const cloud = require('wx-server-sdk')
const {
  assertAvatarContentSafe,
  decodeAvatar,
  metadata: avatarMetadata,
  setAvatarCloudClient,
} = require('./domain/avatar')
const {
  insertCleanupOutbox,
  processCleanupItem,
  processDueCleanup,
  requeueTerminalCleanup,
  resolveDeleteFileResults,
} = require('./domain/media-cleanup')
const { recordOperationalFailure } = require('./domain/operational-failures')
const { normalizeProfile } = require('./domain/profiles')
const {
  activityType,
  publicRegistrationForm,
} = require('./domain/activity-platform')
const {
  listNotifications,
  markNotificationsRead,
  recordSubscriptions,
} = require('./domain/notifications')
const {
  assertNoBlockRelationship,
  createMemberReport,
  getAnnouncement,
  listAnnouncements,
  listBlockedMembers,
  setMemberBlock,
} = require('./domain/community')
const {
  listEventParticipants: listEventParticipantsDomain,
  previewEventParticipants,
} = require('./domain/event-participants')
const { resolveTrustedIdentity } = require('./lib/identity')
const { mysqlDatabase } = require('./lib/mysql')
const {
  cancelEventRegistration,
  createEventReservationOrder,
  createMembershipOrder,
  deleteMemberAccount,
  registerForEvent,
  updateRegistrationAnswers,
} = require('./lib/workflows')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
// Default content-safety path lazily uses cloud.openapi.security.imgSecCheck.
setAvatarCloudClient(cloud)

const paymentMode = ['test', 'live'].includes(process.env.MEMBERSHIP_PAYMENT_MODE)
  ? process.env.MEMBERSHIP_PAYMENT_MODE
  : 'disabled'
const allowedAppIds = new Set(String(process.env.MEMBERSHIP_ALLOWED_APP_IDS || '')
  .split(',')
  .map(value => value.trim())
  .filter(Boolean))

const errorMessages = {
  ACCOUNT_DELETE_CONFIRMATION_REQUIRED: '请输入 DELETE 确认注销账号',
  ANNOUNCEMENT_NOT_FOUND: '公告不存在或已经撤回',
  AVATAR_CONTENT_REJECTED: '头像未通过内容安全检测，请更换后重试',
  AVATAR_IMAGE_INVALID: '请选择清晰的微信头像后重试',
  AVATAR_IMAGE_TOO_LARGE: '头像文件过大，请重新选择',
  AVATAR_SAFETY_NOT_CONFIGURED: '头像安全检测暂不可用，请稍后重试',
  AVATAR_UPLOAD_FAILED: '头像上传失败，请稍后重试',
  EVENT_CLOSED: '该活动已结束报名',
  EVENT_FULL: '该活动报名名额已满',
  EVENT_NOT_AVAILABLE: '活动不存在或尚未发布',
  EVENT_NOT_FOUND: '活动不存在或尚未发布',
  EVENT_ORDER_NOT_REFUNDABLE: '活动订单当前无法退款',
  EVENT_PAYMENT_NOT_REQUIRED: '该活动不需要独立付款',
  EVENT_PAYMENT_REQUIRED: '该活动需要完成付款后报名',
  EVENT_REGISTRATION_NOT_FOUND: '没有找到可取消的报名',
  EVENT_ALBUM_CLOSED: '本场活动暂未开放相册',
  ALREADY_REGISTERED: '你已经报名了该活动',
  DATA_INTEGRITY: '数据不完整，请刷新后重试',
  FORBIDDEN: '没有权限执行此操作',
  IDENTITY_REQUIRED: '未获得有效的微信身份',
  INVALID_CITY: '城市不能超过 30 个字符',
  INVALID_HEADLINE: '个人介绍不能超过 100 个字符',
  INVALID_INDUSTRY: '行业不能超过 60 个字符',
  INVALID_INTERESTS: '最多填写 8 个兴趣，每项不超过 20 个字符',
  INVALID_IDEMPOTENCY_KEY: '下单请求标识无效，请重试',
  INVALID_ORGANIZATION: '组织名称不能超过 60 个字符',
  IDEMPOTENCY_CONFLICT: '重复下单请求内容不一致，请刷新后重试',
  INVALID_NICKNAME: '昵称需为 1 至 20 个字符',
  INVALID_PROFILE: '个人资料格式无效',
  INVALID_REGISTRATION_ANSWERS: '报名信息格式不正确，请检查后重试',
  INVALID_REGISTRATION_FORM: '活动报名表配置无效',
  INVALID_ROLE_TITLE: '职业名称不能超过 60 个字符',
  INVALID_SKILLS: '最多填写 8 个技能，每项不超过 20 个字符',
  INVALID_TAGS: '最多填写 5 个标签，每个不超过 12 个字符',
  MEMBERSHIP_REQUIRED: '成为会员后可查看完整资料并报名会员活动',
  MEMBER_NOT_FOUND: '成员不存在或资料尚未通过审核',
  PHOTO_CONTENT_REJECTED: '照片未通过内容安全检测，请更换后重试',
  PHOTO_IMAGE_INVALID: '请选择清晰的照片后重试',
  PHOTO_IMAGE_TOO_LARGE: '照片文件过大，请压缩后重试',
  PHOTO_NOT_FOUND: '照片不存在或已经删除',
  PHOTO_UPLOAD_FAILED: '照片上传失败，请稍后重试',
  ORDER_NOT_FOUND: '订单不存在',
  PHONE_BIND_FAILED: '手机号绑定失败，请重试',
  PHONE_CODE_REQUIRED: '未获得手机号授权码',
  PHONE_REQUIRED: '请先在个人中心绑定手机号',
  PLAN_NOT_AVAILABLE: '当前方案不可购买',
  REPORT_CATEGORY_INVALID: '请选择有效的举报原因',
  REPORT_CONTENT_REJECTED: '举报说明未通过内容安全检测，请修改后重试',
  REPORT_DESCRIPTION_INVALID: '举报说明不能超过 200 个字符',
  REPORT_IDEMPOTENCY_CONFLICT: '举报内容已变化，请重新提交',
  REPORT_IDEMPOTENCY_INVALID: '举报请求标识无效，请重试',
  REGISTRATION_CLOSED: '该活动已结束报名',
  REGISTRATION_ANSWERS_REQUIRED: '请完成必填的报名信息',
  REGISTRATION_FORM_CHANGED: '活动报名问题已更新，请重新确认',
  REGISTRATION_CONFLICT: '报名状态已变化，请刷新后重试',
  REGISTRATION_NOT_EDITABLE: '当前报名状态不能修改资料',
  REGISTRATION_NOT_FOUND: '没有找到可取消的报名',
  REGISTRATION_VERSION_CONFLICT: '报名资料已更新，请刷新后重试',
  NOTIFICATION_IDS_REQUIRED: '请选择需要标记的消息',
  SUBSCRIPTION_RESULTS_INVALID: '消息提醒授权结果无效，请重试',
  SUBSCRIBE_TEMPLATE_CONFIG_INVALID: '活动提醒配置有误，请联系运营人员',
  TICKET_CODE_UNAVAILABLE: '报名凭证生成失败，请重试',
  UNSUPPORTED_ACTION: '不支持该操作',
}

function db() {
  return mysqlDatabase()
}

function boundedFailureCode(error, fallback, prefix) {
  if (error instanceof Error
    && /^[A-Z][A-Z0-9_]+$/.test(error.message)
    && (!prefix || error.message.startsWith(prefix))) {
    return error.message
  }
  return fallback
}

async function recordMediaFailure(caller, {
  category,
  resourceType,
  resourceId,
  errorCode,
}) {
  try {
    await recordOperationalFailure(db(), {
      appId: caller.appId,
      userId: caller.openId,
      category,
      resourceType,
      resourceId,
      errorCode,
    })
  }
  catch {
    // Observability must never replace the original user-facing failure.
  }
}

async function cleanupUploadedOrphan(caller, cloudClient, cloudFileId, mediaAssetId) {
  if (!cloudFileId) {
    return
  }
  let resolved = false
  try {
    const response = await cloudClient.deleteFile({ fileList: [cloudFileId] })
    resolved = Boolean(resolveDeleteFileResults(response, [cloudFileId])[0]?.ok)
  }
  catch {
    resolved = false
  }
  if (!resolved) {
    try {
      await db().transaction(tx => insertCleanupOutbox(tx, {
        appId: caller.appId,
        userId: caller.openId,
        mediaAssetId,
        cloudFileId,
      }))
    }
    catch {
      // Preserve the original media error if the recovery queue is unavailable.
    }
  }
}

function identity() {
  const context = cloud.getWXContext()
  const resolved = resolveTrustedIdentity(context, { errorCode: 'IDENTITY_REQUIRED' })
  if (!allowedAppIds.size || !allowedAppIds.has(resolved.appId)) {
    throw new Error('IDENTITY_REQUIRED')
  }
  return { appId: resolved.appId, openId: resolved.openId }
}

module.exports._test = module.exports._test || {}
module.exports._test.identity = identity
module.exports._test.resolveTrustedIdentity = resolveTrustedIdentity

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
      message: code === 'INTERNAL_ERROR' ? '会员服务暂时不可用' : (errorMessages[code] || code),
    },
  }
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

function jsonObject(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
    }
    catch {
      return {}
    }
  }
  return {}
}

function escapeLikePattern(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')
}

function activeMembership(value) {
  const expiresAt = value?.expires_at ? new Date(value.expires_at) : null
  return Boolean(expiresAt && expiresAt.getTime() > Date.now() && value.status === 'ACTIVE')
}

async function mediaMap(appId, assetIds) {
  const ids = [...new Set(assetIds.filter(Boolean))]
  if (!ids.length) {
    return new Map()
  }
  const placeholders = ids.map(() => '?').join(', ')
  const rows = await db().query(
    `SELECT id, cloud_file_id FROM member_media_assets
     WHERE app_id = ? AND id IN (${placeholders}) AND status = 'READY'`,
    [appId, ...ids],
  )
  return new Map(rows.map(item => [item.id, item.cloud_file_id]))
}

function publicProfile(profile, privateProfile, avatarUrl = '') {
  const nicknameReady = Boolean(profile?.nickname && profile.nickname !== '微信用户')
  const completed = [nicknameReady, avatarUrl, privateProfile?.phone_number, profile?.city]
    .filter(Boolean).length
  return {
    nickname: profile?.nickname || '',
    avatarUrl,
    city: profile?.city || '',
    headline: profile?.headline || '',
    bio: profile?.bio || '',
    organization: profile?.organization || '',
    roleTitle: profile?.role_title || '',
    industry: profile?.industry || '',
    tags: jsonArray(profile?.tags).slice(0, 5),
    interests: jsonArray(profile?.interests).slice(0, 8),
    skills: jsonArray(profile?.skills).slice(0, 8),
    phoneBound: Boolean(privateProfile?.phone_number),
    completion: completed * 25,
    onboardingComplete: Boolean(nicknameReady && avatarUrl && privateProfile?.phone_number),
  }
}

function publicPlan(plan) {
  return {
    id: plan.id,
    name: plan.name,
    description: plan.description,
    priceCents: Number(plan.price_cents),
    durationDays: Number(plan.duration_days),
    benefits: jsonArray(plan.benefits),
    testOnly: plan.environment === 'test',
  }
}

function publicOrder(order) {
  return {
    id: order.id,
    orderType: order.order_type || 'MEMBERSHIP',
    status: order.status,
    planId: order.product_id,
    planName: order.plan_name || order.event_name || order.description || '服务订单',
    description: order.description || '',
    durationDays: order.duration_days !== null && order.duration_days !== undefined && Number.isInteger(Number(order.duration_days))
      ? Number(order.duration_days)
      : null,
    amountCents: Number(order.amount_cents),
    createdAt: iso(order.created_at) || '',
    paidAt: iso(order.paid_at),
    entitlementStart: iso(order.entitlement_start),
    entitlementEnd: iso(order.entitlement_end),
    refundStatus: order.refund_status || null,
    refundId: order.refund_id || null,
  }
}

function memberSummary(profile, detailLocked, assetById) {
  return {
    id: profile.id,
    nickname: profile.nickname || '社区成员',
    city: profile.city || '',
    headline: profile.headline || '',
    bio: profile.bio || '',
    organization: profile.organization || '',
    roleTitle: profile.role_title || '',
    industry: profile.industry || '',
    avatarUrl: assetById.get(profile.avatar_asset_id) || '',
    tags: jsonArray(profile.tags).slice(0, 4),
    interests: jsonArray(profile.interests).slice(0, 4),
    skills: jsonArray(profile.skills).slice(0, 4),
    detailLocked,
  }
}

async function assertMessageContentSafe(caller, content) {
  if (!content) {
    return
  }
  const checker = cloud.openapi?.security?.msgSecCheck
  if (typeof checker !== 'function') {
    throw new Error('REPORT_CONTENT_REJECTED')
  }
  try {
    const response = await checker({
      content,
      version: 2,
      scene: 2,
      openid: caller.openId,
    })
    const errCode = Number(response?.errCode ?? response?.errcode)
    const suggestion = response?.result?.suggest
    if (errCode !== 0 || suggestion !== 'pass') {
      throw new Error('REPORT_CONTENT_REJECTED')
    }
  }
  catch {
    throw new Error('REPORT_CONTENT_REJECTED')
  }
}

function eventSummary(
  event,
  registeredEventIds,
  registrationCounts,
  assetById,
  registrationStates = new Map(),
) {
  const deadline = event.registration_deadline ? new Date(event.registration_deadline) : null
  const startsAt = event.starts_at ? new Date(event.starts_at) : null
  const eventState = event.status || 'DRAFT'
  const publishedOpen = eventState === 'PUBLISHED'
    && Boolean(
      startsAt
      && startsAt.getTime() > Date.now()
      && (!deadline || deadline.getTime() > Date.now()),
    )
  return {
    id: event.id,
    title: event.title || '',
    startsAt: iso(event.starts_at) || '',
    location: event.location || '',
    priceCents: Number(event.price_cents || 0),
    memberFree: Boolean(event.member_free),
    activityType: activityType(event),
    registered: registeredEventIds.has(event.id),
    registrationState: registrationStates.get(event.id) || null,
    coverUrl: assetById.get(event.cover_asset_id) || '',
    capacity: Number.isInteger(event.capacity) ? event.capacity : null,
    registrationCount: Number(registrationCounts.get(event.id) || 0),
    registrationOpen: publishedOpen,
    registrationMode: event.registration_mode === 'APPROVAL' ? 'APPROVAL' : 'AUTO',
    waitlistEnabled: Boolean(Number(event.waitlist_enabled)),
    eventMode: ['ONLINE', 'HYBRID'].includes(event.event_mode) ? event.event_mode : 'OFFLINE',
    eventState,
  }
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

function publicRegistrationHistory(registration, event) {
  const startsAt = iso(event?.starts_at) || ''
  const eventState = event?.status || 'CANCELLED'
  const registrationState = registration.status || 'CANCELLED'
  const cancelledByType = registration.cancelled_by_type || null
  const canCancel = ['PENDING_REVIEW', 'WAITLISTED', 'REGISTERED'].includes(registrationState)
    && eventState === 'PUBLISHED'
    && Boolean(startsAt && new Date(startsAt) > new Date())
  return {
    id: registration.id,
    eventId: registration.event_id,
    title: event?.title || '活动已下线',
    startsAt,
    location: event?.location || '',
    status: registrationState,
    eventState,
    registrationState,
    cancelledByType,
    cancellationReason: registration.cancellation_reason
      || (eventState === 'CANCELLED' ? (event?.cancellation_reason || null) : null)
      || null,
    cancelledAt: iso(registration.cancelled_at)
      || (eventState === 'CANCELLED' ? iso(event?.cancelled_at) : null),
    ticketCodeMasked: maskTicketCode(registration.ticket_code || ''),
    canCancel,
  }
}

async function getOverview(caller) {
  const ensuredProfile = await ensureProfile(caller)
  const [
    profile,
    privateProfile,
    membership,
    plans,
    profiles,
    events,
    ownRegistrations,
    unreadNotifications,
    announcements,
  ] = await Promise.all([
    Promise.resolve(ensuredProfile),
    db().one(
      'SELECT phone_number FROM member_private_profiles WHERE app_id = ? AND user_id = ?',
      [caller.appId, caller.openId],
    ),
    db().one(
      'SELECT status, expires_at FROM member_entitlements WHERE app_id = ? AND user_id = ?',
      [caller.appId, caller.openId],
    ),
    paymentMode === 'disabled'
      ? Promise.resolve([])
      : db().query(
          `SELECT * FROM member_plans
           WHERE app_id = ? AND environment = ? AND status = 'ACTIVE'
           ORDER BY price_cents ASC`,
          [caller.appId, paymentMode],
        ),
    db().query(
      `SELECT p.id, p.user_id, p.nickname, p.city, p.headline, p.bio, p.organization,
              p.role_title, p.industry, p.tags, p.interests, p.skills,
              p.avatar_asset_id, p.created_at
       FROM member_profiles p
       WHERE p.app_id = ? AND p.status = 'APPROVED'
         AND NOT EXISTS (
           SELECT 1 FROM member_blocks b
           WHERE b.app_id = p.app_id
             AND (
               (b.blocker_user_id = ? AND b.blocked_user_id = p.user_id)
               OR (b.blocker_user_id = p.user_id AND b.blocked_user_id = ?)
             )
         )
       ORDER BY p.updated_at DESC LIMIT 20`,
      [caller.appId, caller.openId, caller.openId],
    ),
    db().query(
      `SELECT * FROM member_events
       WHERE app_id = ? AND status = 'PUBLISHED' AND starts_at >= UTC_TIMESTAMP(3)
       ORDER BY starts_at ASC LIMIT 20`,
      [caller.appId],
    ),
    db().query(
      `SELECT event_id, status FROM member_registrations
       WHERE app_id = ? AND user_id = ?
         AND status IN ('PENDING_REVIEW', 'WAITLISTED', 'REGISTERED', 'CANCELLATION_PENDING', 'ATTENDED')
       LIMIT 100`,
      [caller.appId, caller.openId],
    ),
    db().one(
      `SELECT COUNT(*) AS total FROM member_notifications
       WHERE app_id = ? AND user_id = ? AND status = 'UNREAD'`,
      [caller.appId, caller.openId],
    ),
    listAnnouncements(db(), { appId: caller.appId, limit: 5 }),
  ])

  const recommendations = profiles.filter(item => item.user_id !== caller.openId).slice(0, 12)
  const eventIds = events.map(item => item.id)
  const eventRegistrations = eventIds.length
    ? await db().query(
        `SELECT event_id, COUNT(*) AS total FROM member_registrations
         WHERE app_id = ? AND event_id IN (${eventIds.map(() => '?').join(', ')})
           AND status IN ('REGISTERED', 'CANCELLATION_PENDING', 'ATTENDED')
         GROUP BY event_id`,
        [caller.appId, ...eventIds],
      )
    : []
  const registrationCounts = new Map(
    eventRegistrations.map(item => [item.event_id, Number(item.total)]),
  )

  const assets = await mediaMap(caller.appId, [
    profile?.avatar_asset_id,
    ...recommendations.map(item => item.avatar_asset_id),
    ...events.map(item => item.cover_asset_id),
  ])
  const isMember = activeMembership(membership)
  const registeredEventIds = new Set(ownRegistrations.map(item => item.event_id))
  const registrationStates = new Map(
    ownRegistrations.map(item => [item.event_id, item.status]),
  )

  return {
    plans: plans.map(publicPlan),
    membership: {
      active: isMember,
      level: isMember ? 'member' : 'guest',
      expiresAt: iso(membership?.expires_at),
    },
    profile: publicProfile(profile, privateProfile, assets.get(profile?.avatar_asset_id) || ''),
    recommendations: recommendations.map(item => memberSummary(item, !isMember, assets)),
    events: events.map(event => eventSummary(
      event,
      registeredEventIds,
      registrationCounts,
      assets,
      registrationStates,
    )),
    unreadNotificationCount: Number(unreadNotifications?.total || 0),
    announcements,
  }
}

async function saveNotificationSubscriptions(caller, event) {
  if (typeof event.eventId !== 'string' || !event.eventId) {
    throw new Error('EVENT_NOT_FOUND')
  }
  return recordSubscriptions(db(), {
    appId: caller.appId,
    userId: caller.openId,
    eventId: event.eventId,
    results: event.results,
  })
}

async function getNotifications(caller) {
  return listNotifications(db(), {
    appId: caller.appId,
    userId: caller.openId,
    limit: 30,
  })
}

async function readNotifications(caller, event) {
  return markNotificationsRead(db(), {
    appId: caller.appId,
    userId: caller.openId,
    all: event.all === true,
    ids: event.ids,
  })
}

async function listMembers(caller, filter) {
  const selectedFilter = ['recommended', 'same-city', 'new'].includes(filter) ? filter : 'recommended'
  const [membership, ownProfile] = await Promise.all([
    db().one(
      'SELECT status, expires_at FROM member_entitlements WHERE app_id = ? AND user_id = ?',
      [caller.appId, caller.openId],
    ),
    selectedFilter === 'same-city'
      ? db().one(
          'SELECT city FROM member_profiles WHERE app_id = ? AND user_id = ?',
          [caller.appId, caller.openId],
        )
      : Promise.resolve(null),
  ])
  if (selectedFilter === 'same-city' && !ownProfile?.city) {
    return []
  }
  const cityFilter = selectedFilter === 'same-city' ? ' AND city = ?' : ''
  const orderColumn = selectedFilter === 'new' ? 'created_at' : 'updated_at'
  const params = selectedFilter === 'same-city'
    ? [caller.appId, caller.openId, ownProfile.city]
    : [caller.appId, caller.openId]
  const profiles = await db().query(
    `SELECT id, user_id, nickname, city, headline, bio, organization, role_title, industry,
            tags, interests, skills, avatar_asset_id, created_at, updated_at
     FROM member_profiles
     WHERE app_id = ? AND status = 'APPROVED' AND user_id <> ?${cityFilter}
       AND NOT EXISTS (
         SELECT 1 FROM member_blocks b
         WHERE b.app_id = member_profiles.app_id
           AND (
             (b.blocker_user_id = ? AND b.blocked_user_id = member_profiles.user_id)
             OR (b.blocker_user_id = member_profiles.user_id AND b.blocked_user_id = ?)
           )
       )
     ORDER BY ${orderColumn} DESC LIMIT 20`,
    [...params, caller.openId, caller.openId],
  )
  const assets = await mediaMap(caller.appId, profiles.map(item => item.avatar_asset_id))
  return profiles.map(item => memberSummary(item, !activeMembership(membership), assets))
}

async function listEventFeed(caller, view, queryValue = '') {
  const selectedView = view === 'mine' ? 'mine' : 'upcoming'
  const query = typeof queryValue === 'string' ? queryValue.trim().slice(0, 40) : ''
  const [membership, privateProfile, ownRegistrations] = await Promise.all([
    db().one(
      'SELECT status, expires_at FROM member_entitlements WHERE app_id = ? AND user_id = ?',
      [caller.appId, caller.openId],
    ),
    db().one(
      'SELECT phone_number FROM member_private_profiles WHERE app_id = ? AND user_id = ?',
      [caller.appId, caller.openId],
    ),
    db().query(
      `SELECT event_id, status FROM member_registrations
       WHERE app_id = ? AND user_id = ?
         AND status IN ('PENDING_REVIEW', 'WAITLISTED', 'REGISTERED', 'CANCELLATION_PENDING', 'ATTENDED')
       LIMIT 100`,
      [caller.appId, caller.openId],
    ),
  ])
  const ownEventIds = [...new Set(ownRegistrations.map(item => item.event_id).filter(Boolean))]
  if (selectedView === 'mine' && !ownEventIds.length) {
    return {
      membershipActive: activeMembership(membership),
      phoneBound: Boolean(privateProfile?.phone_number),
      events: [],
    }
  }
  const mineFilter = selectedView === 'mine'
    ? ` AND id IN (${ownEventIds.map(() => '?').join(', ')})`
    : ''
  const searchFilter = query
    ? ` AND (
        title LIKE ? ESCAPE '\\\\'
        OR location LIKE ? ESCAPE '\\\\'
        OR venue_name LIKE ? ESCAPE '\\\\'
        OR address LIKE ? ESCAPE '\\\\'
      )`
    : ''
  const like = `%${escapeLikePattern(query)}%`
  const events = await db().query(
    `SELECT * FROM member_events
     WHERE app_id = ? AND status = 'PUBLISHED' AND starts_at >= UTC_TIMESTAMP(3)${mineFilter}${searchFilter}
     ORDER BY starts_at ASC LIMIT 50`,
    [
      caller.appId,
      ...(selectedView === 'mine' ? ownEventIds : []),
      ...(query ? [like, like, like, like] : []),
    ],
  )
  const eventIds = events.map(item => item.id)
  const registrations = eventIds.length
    ? await db().query(
        `SELECT event_id, COUNT(*) AS total FROM member_registrations
         WHERE app_id = ? AND event_id IN (${eventIds.map(() => '?').join(', ')})
           AND status IN ('REGISTERED', 'CANCELLATION_PENDING', 'ATTENDED')
         GROUP BY event_id`,
        [caller.appId, ...eventIds],
      )
    : []
  const registrationCounts = new Map(
    registrations.map(item => [item.event_id, Number(item.total)]),
  )
  const assets = await mediaMap(caller.appId, events.map(item => item.cover_asset_id))
  const registeredEventIds = new Set(ownEventIds)
  const registrationStates = new Map(
    ownRegistrations.map(item => [item.event_id, item.status]),
  )
  return {
    membershipActive: activeMembership(membership),
    phoneBound: Boolean(privateProfile?.phone_number),
    events: events.map(event => eventSummary(
      event,
      registeredEventIds,
      registrationCounts,
      assets,
      registrationStates,
    )),
  }
}

async function createCheckout(caller, event) {
  if (typeof event.idempotencyKey !== 'string' || !event.idempotencyKey.trim()) {
    throw new Error('INVALID_IDEMPOTENCY_KEY')
  }
  if (typeof event.planId !== 'string' || !event.planId) {
    throw new Error('PLAN_NOT_AVAILABLE')
  }
  const orderId = await createMembershipOrder(db(), {
    appId: caller.appId,
    userId: caller.openId,
    planId: event.planId,
    idempotencyKey: event.idempotencyKey.trim(),
    environment: paymentMode,
  })
  if (!orderId) {
    throw new Error('ORDER_NOT_FOUND')
  }
  return { orderId: String(orderId) }
}

async function getOrder(caller, orderId) {
  if (typeof orderId !== 'string' || !orderId) {
    throw new Error('ORDER_NOT_FOUND')
  }
  const order = await db().one(
    `SELECT o.*, p.name AS plan_name, e.title AS event_name,
            r.id AS refund_id, r.status AS refund_status
     FROM member_orders o
     LEFT JOIN member_plans p ON p.app_id = o.app_id AND p.id = o.product_id
     LEFT JOIN member_events e ON e.app_id = o.app_id AND e.id = o.product_id
     LEFT JOIN member_refunds r ON r.app_id = o.app_id AND r.order_id = o.id
     WHERE o.id = ? AND o.app_id = ? AND o.user_id = ?`,
    [orderId, caller.appId, caller.openId],
  )
  if (!order) {
    throw new Error('ORDER_NOT_FOUND')
  }
  return publicOrder(order)
}

async function ensureProfile(caller) {
  const existing = await db().one(
    'SELECT * FROM member_profiles WHERE app_id = ? AND user_id = ?',
    [caller.appId, caller.openId],
  )
  if (existing) {
    return existing
  }
  await db().query(
    `INSERT IGNORE INTO member_profiles (
       id, app_id, user_id, nickname, bio, tags, status
     ) VALUES (UUID(), ?, ?, '微信用户', '', JSON_ARRAY(), 'DRAFT')`,
    [caller.appId, caller.openId],
  )
  return db().one(
    'SELECT * FROM member_profiles WHERE app_id = ? AND user_id = ?',
    [caller.appId, caller.openId],
  )
}

async function bindPhone(caller, code) {
  if (typeof code !== 'string' || !code) {
    throw new Error('PHONE_CODE_REQUIRED')
  }
  const result = await cloud.openapi.phonenumber.getPhoneNumber({ code })
  const phone = result?.phoneInfo?.phoneNumber || result?.phone_info?.phoneNumber
  if (!phone) {
    throw new Error('PHONE_BIND_FAILED')
  }
  await db().query(
    `INSERT INTO member_private_profiles (app_id, user_id, phone_number, phone_bound_at)
     VALUES (?, ?, ?, UTC_TIMESTAMP(3))
     ON DUPLICATE KEY UPDATE
       phone_number = VALUES(phone_number),
       phone_bound_at = VALUES(phone_bound_at),
       updated_at = UTC_TIMESTAMP(3)`,
    [caller.appId, caller.openId, phone],
  )
  const profile = await ensureProfile(caller)
  const assets = await mediaMap(caller.appId, [profile?.avatar_asset_id])
  return publicProfile(profile, { phone_number: phone }, assets.get(profile?.avatar_asset_id) || '')
}

async function updateProfile(caller, value) {
  const profile = normalizeProfile(value)
  await db().query(
    `INSERT INTO member_profiles (
       id, app_id, user_id, nickname, city, headline, organization, role_title,
       industry, bio, tags, interests, skills, status, approved_at
     ) VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', NULL)
     ON DUPLICATE KEY UPDATE
       nickname = VALUES(nickname), city = VALUES(city), headline = VALUES(headline),
       organization = VALUES(organization), role_title = VALUES(role_title),
       industry = VALUES(industry), bio = VALUES(bio), tags = VALUES(tags), interests = VALUES(interests),
       skills = VALUES(skills), profile_version = profile_version + 1,
       status = 'PENDING', approved_at = NULL,
       updated_at = UTC_TIMESTAMP(3)`,
    [
      caller.appId,
      caller.openId,
      profile.nickname,
      profile.city,
      profile.headline,
      profile.organization,
      profile.roleTitle,
      profile.industry,
      profile.bio,
      JSON.stringify(profile.tags),
      JSON.stringify(profile.interests),
      JSON.stringify(profile.skills),
    ],
  )
  const stored = await ensureProfile(caller)
  const [privateProfile, assets] = await Promise.all([
    db().one(
      'SELECT phone_number FROM member_private_profiles WHERE app_id = ? AND user_id = ?',
      [caller.appId, caller.openId],
    ),
    mediaMap(caller.appId, [stored?.avatar_asset_id]),
  ])
  return publicProfile(stored, privateProfile, assets.get(stored?.avatar_asset_id) || '')
}

/**
 * Re-read the uploaded object when cloud.downloadFile exists and verify
 * bytes/sha256/dimensions match the decoded avatar. Unit mocks without
 * downloadFile skip the round-trip but production CloudBase paths re-verify.
 */
async function verifyUploadedAvatarObject(cloudClient, cloudFileId, expected) {
  if (!cloudClient || typeof cloudClient.downloadFile !== 'function') {
    return expected
  }
  const downloaded = await cloudClient.downloadFile({ fileID: cloudFileId })
  const content = downloaded?.fileContent
  if (!content) {
    throw new Error('AVATAR_UPLOAD_FAILED')
  }
  const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content)
  if (buffer.length !== expected.bytes) {
    throw new Error('AVATAR_UPLOAD_FAILED')
  }
  const sha256 = createHash('sha256').update(buffer).digest('hex')
  if (sha256 !== expected.sha256) {
    throw new Error('AVATAR_UPLOAD_FAILED')
  }
  const image = avatarMetadata(buffer)
  if (image.width !== expected.width
    || image.height !== expected.height
    || image.mimeType !== expected.mimeType) {
    throw new Error('AVATAR_UPLOAD_FAILED')
  }
  return { ...expected, buffer, bytes: buffer.length, sha256 }
}

async function uploadAvatar(caller, base64, deps = {}) {
  const cloudClient = deps.cloud || cloud
  const assetId = randomUUID()
  let cloudFileId = ''
  try {
    // 1) Structure decode (strict PNG / JPEG SOF).
    const image = decodeAvatar(base64)
    const sha256 = createHash('sha256').update(image.buffer).digest('hex')
    // 2) Content safety via default OpenAPI imgSecCheck (injectable for tests).
    // Production/test stages fail closed when OpenAPI is missing — not via process setter.
    const safetyCheck = deps.assertAvatarContentSafe || assertAvatarContentSafe
    await safetyCheck(image.buffer, {
      cloud: cloudClient,
      ...(deps.contentSafety || {}),
    })

    const appScope = createHash('sha256').update(caller.appId).digest('hex').slice(0, 16)
    const userScope = createHash('sha256').update(caller.openId).digest('hex').slice(0, 24)
    const assetKey = `member-avatar-${userScope}`
    const objectKey = `member-assets/${appScope}/avatars/${userScope}/${randomUUID()}.${image.extension}`
    // 3) Upload to cloud storage.
    const uploaded = await cloudClient.uploadFile({ cloudPath: objectKey, fileContent: image.buffer })
    cloudFileId = uploaded?.fileID || uploaded?.fileId || ''
    if (!cloudFileId) {
      throw new Error('AVATAR_UPLOAD_FAILED')
    }
    // 4) Re-read + verify when downloadFile is available.
    const verified = await verifyUploadedAvatarObject(cloudClient, cloudFileId, {
      width: image.width,
      height: image.height,
      bytes: image.bytes,
      mimeType: image.mimeType,
      sha256,
      buffer: image.buffer,
    })

    await ensureProfile(caller)
    // 5) Insert READY only after decode + safety + upload verify all pass.
    await db().transaction(async (tx) => {
      const current = await tx.one(
        'SELECT avatar_asset_id FROM member_profiles WHERE app_id = ? AND user_id = ? FOR UPDATE',
        [caller.appId, caller.openId],
      )
      const version = await tx.one(
        'SELECT COALESCE(MAX(content_version), 0) + 1 AS next_version FROM member_media_assets WHERE app_id = ? AND asset_key = ?',
        [caller.appId, assetKey],
      )
      await tx.query(
        `INSERT INTO member_media_assets (
           id, app_id, asset_key, kind, cloud_file_id, object_key, width, height, bytes,
           mime_type, alt_text, sha256, provenance, content_version, status, is_demo
         ) VALUES (?, ?, ?, 'avatar', ?, ?, ?, ?, ?, ?, '用户头像', ?, 'wechat:chooseAvatar', ?, 'READY', 0)`,
        [
          assetId,
          caller.appId,
          assetKey,
          cloudFileId,
          objectKey,
          verified.width,
          verified.height,
          verified.bytes,
          verified.mimeType,
          verified.sha256,
          Number(version?.next_version || 1),
        ],
      )
      await tx.query(
        `UPDATE member_profiles
         SET avatar_asset_id = ?, status = 'PENDING', approved_at = NULL, updated_at = UTC_TIMESTAMP(3)
         WHERE app_id = ? AND user_id = ?`,
        [assetId, caller.appId, caller.openId],
      )
      if (current?.avatar_asset_id) {
        await tx.query(
          `UPDATE member_media_assets SET status = 'ARCHIVED'
           WHERE app_id = ? AND id = ? AND id <> ?`,
          [caller.appId, current.avatar_asset_id, assetId],
        )
      }
    })
  }
  catch (error) {
    const errorCode = boundedFailureCode(error, 'AVATAR_UPLOAD_FAILED', 'AVATAR_')
    await recordMediaFailure(caller, {
      category: ['AVATAR_CONTENT_REJECTED', 'AVATAR_SAFETY_NOT_CONFIGURED'].includes(errorCode)
        ? 'MEDIA_REVIEW'
        : 'MEDIA_UPLOAD',
      resourceType: 'avatar',
      resourceId: assetId,
      errorCode,
    })
    // 6) Delete uploaded objects immediately; unresolved deletes enter the
    // durable cleanup outbox instead of being silently abandoned.
    await cleanupUploadedOrphan(caller, cloudClient, cloudFileId, assetId)
    throw new Error(errorCode)
  }
  const stored = await ensureProfile(caller)
  const [privateProfile, assets] = await Promise.all([
    db().one(
      'SELECT phone_number FROM member_private_profiles WHERE app_id = ? AND user_id = ?',
      [caller.appId, caller.openId],
    ),
    mediaMap(caller.appId, [stored?.avatar_asset_id]),
  ])
  return publicProfile(stored, privateProfile, assets.get(stored?.avatar_asset_id) || '')
}

async function getMember(caller, memberId) {
  if (typeof memberId !== 'string' || !/^[0-9a-f-]{36}$/i.test(memberId)) {
    throw new Error('MEMBER_NOT_FOUND')
  }
  const membership = await db().one(
    'SELECT status, expires_at FROM member_entitlements WHERE app_id = ? AND user_id = ?',
    [caller.appId, caller.openId],
  )
  const profile = await db().one(
    `SELECT * FROM member_profiles
     WHERE id = ? AND app_id = ? AND status = 'APPROVED'`,
    [memberId, caller.appId],
  )
  if (!profile) {
    throw new Error('MEMBER_NOT_FOUND')
  }
  if (profile.user_id !== caller.openId) {
    await assertNoBlockRelationship(db(), {
      appId: caller.appId,
      userId: caller.openId,
      targetUserId: profile.user_id,
    })
  }
  const [assets, followers, following, relationship] = await Promise.all([
    mediaMap(caller.appId, [profile.avatar_asset_id]),
    db().one(
      'SELECT COUNT(*) AS total FROM member_follows WHERE app_id = ? AND followee_user_id = ?',
      [caller.appId, profile.user_id],
    ),
    db().one(
      'SELECT COUNT(*) AS total FROM member_follows WHERE app_id = ? AND follower_user_id = ?',
      [caller.appId, profile.user_id],
    ),
    profile.user_id === caller.openId
      ? Promise.resolve(null)
      : db().one(
          `SELECT 1 AS followed FROM member_follows
           WHERE app_id = ? AND follower_user_id = ? AND followee_user_id = ?`,
          [caller.appId, caller.openId, profile.user_id],
        ),
  ])
  return {
    id: profile.id,
    nickname: profile.nickname || '社区成员',
    city: profile.city || '',
    headline: profile.headline || '',
    bio: profile.bio || '',
    organization: profile.organization || '',
    roleTitle: profile.role_title || '',
    industry: profile.industry || '',
    avatarUrl: assets.get(profile.avatar_asset_id) || '',
    tags: jsonArray(profile.tags).slice(0, 5),
    interests: jsonArray(profile.interests).slice(0, 8),
    skills: jsonArray(profile.skills).slice(0, 8),
    detailLocked: !activeMembership(membership),
    joinedAt: activeMembership(membership) ? iso(profile.created_at) : null,
    followersCount: Number(followers?.total || 0),
    followingCount: Number(following?.total || 0),
    isFollowing: Boolean(relationship),
    isSelf: profile.user_id === caller.openId,
  }
}

async function setFollow(caller, memberId, following) {
  if (typeof memberId !== 'string' || !/^[0-9a-f-]{36}$/i.test(memberId)) {
    throw new Error('MEMBER_NOT_FOUND')
  }
  const target = await db().one(
    `SELECT user_id FROM member_profiles
     WHERE id = ? AND app_id = ? AND status = 'APPROVED'`,
    [memberId, caller.appId],
  )
  if (!target || target.user_id === caller.openId) {
    throw new Error('MEMBER_NOT_FOUND')
  }
  await assertNoBlockRelationship(db(), {
    appId: caller.appId,
    userId: caller.openId,
    targetUserId: target.user_id,
  })
  if (following) {
    await db().query(
      `INSERT IGNORE INTO member_follows (app_id, follower_user_id, followee_user_id)
       VALUES (?, ?, ?)`,
      [caller.appId, caller.openId, target.user_id],
    )
  }
  else {
    await db().query(
      `DELETE FROM member_follows
       WHERE app_id = ? AND follower_user_id = ? AND followee_user_id = ?`,
      [caller.appId, caller.openId, target.user_id],
    )
  }
  return { memberId, following: Boolean(following) }
}

async function listConnections(caller, direction) {
  const selected = direction === 'followers' ? 'followers' : 'following'
  const join = selected === 'followers'
    ? 'f.followee_user_id = ? AND p.user_id = f.follower_user_id'
    : 'f.follower_user_id = ? AND p.user_id = f.followee_user_id'
  const rows = await db().query(
    `SELECT p.id, p.user_id, p.nickname, p.city, p.headline, p.bio, p.organization,
            p.role_title, p.industry, p.tags, p.interests, p.skills,
            p.avatar_asset_id, p.created_at
     FROM member_follows f
     INNER JOIN member_profiles p ON p.app_id = f.app_id AND ${join}
     WHERE f.app_id = ? AND p.status = 'APPROVED'
       AND NOT EXISTS (
         SELECT 1 FROM member_blocks b
         WHERE b.app_id = p.app_id
           AND (
             (b.blocker_user_id = ? AND b.blocked_user_id = p.user_id)
             OR (b.blocker_user_id = p.user_id AND b.blocked_user_id = ?)
           )
       )
     ORDER BY f.created_at DESC LIMIT 100`,
    [caller.openId, caller.appId, caller.openId, caller.openId],
  )
  const assets = await mediaMap(caller.appId, rows.map(item => item.avatar_asset_id))
  return rows.map(item => memberSummary(item, false, assets))
}

function photoError(error) {
  if (!(error instanceof Error)) return new Error('PHOTO_UPLOAD_FAILED')
  const mapping = {
    AVATAR_CONTENT_REJECTED: 'PHOTO_CONTENT_REJECTED',
    AVATAR_IMAGE_INVALID: 'PHOTO_IMAGE_INVALID',
    AVATAR_IMAGE_TOO_LARGE: 'PHOTO_IMAGE_TOO_LARGE',
  }
  return new Error(mapping[error.message] || 'PHOTO_UPLOAD_FAILED')
}

async function listEventAlbum(caller, eventId, cursor = '') {
  if (typeof eventId !== 'string' || !/^[0-9a-f-]{36}$/i.test(eventId)) {
    throw new Error('EVENT_NOT_FOUND')
  }
  const event = await db().one(
    `SELECT id, album_enabled FROM member_events
     WHERE app_id = ? AND id = ? AND status IN ('PUBLISHED', 'COMPLETED')`,
    [caller.appId, eventId],
  )
  if (!event || !event.album_enabled) {
    throw new Error('EVENT_ALBUM_CLOSED')
  }
  let cursorFilter = ''
  const params = [caller.appId, eventId, caller.openId]
  if (typeof cursor === 'string' && /^[0-9a-f-]{36}$/i.test(cursor)) {
    cursorFilter = ` AND (
      p.created_at < (SELECT created_at FROM member_event_photos WHERE app_id = ? AND id = ?)
      OR (
        p.created_at = (SELECT created_at FROM member_event_photos WHERE app_id = ? AND id = ?)
        AND p.id < ?
      )
    )`
    params.push(caller.appId, cursor, caller.appId, cursor, cursor)
  }
  const rows = await db().query(
    `SELECT p.*, m.cloud_file_id, profile.nickname, avatar.cloud_file_id AS avatar_file_id
     FROM member_event_photos p
     INNER JOIN member_media_assets m
       ON m.app_id = p.app_id AND m.id = p.media_asset_id AND m.status = 'READY'
     LEFT JOIN member_profiles profile ON profile.app_id = p.app_id AND profile.user_id = p.user_id
     LEFT JOIN member_media_assets avatar
       ON avatar.app_id = profile.app_id AND avatar.id = profile.avatar_asset_id AND avatar.status = 'READY'
     WHERE p.app_id = ? AND p.event_id = ?
       AND (p.status = 'PUBLISHED' OR (p.user_id = ? AND p.status = 'PENDING_REVIEW'))
       ${cursorFilter}
     ORDER BY p.created_at DESC, p.id DESC LIMIT 21`,
    params,
  )
  const hasMore = rows.length > 20
  const page = rows.slice(0, 20)
  return {
    items: page.map(item => ({
      id: item.id,
      imageUrl: item.cloud_file_id || '',
      caption: item.caption || '',
      nickname: item.nickname || '活动成员',
      avatarUrl: item.avatar_file_id || '',
      status: item.status,
      mine: item.user_id === caller.openId,
      createdAt: iso(item.created_at) || '',
    })),
    nextCursor: hasMore ? page.at(-1)?.id || null : null,
  }
}

async function uploadEventPhoto(caller, eventId, base64, caption = '', deps = {}) {
  if (typeof eventId !== 'string' || !/^[0-9a-f-]{36}$/i.test(eventId)) {
    throw new Error('EVENT_NOT_FOUND')
  }
  const event = await db().one(
    `SELECT e.id, e.album_enabled, e.album_requires_review
     FROM member_events e
     INNER JOIN member_registrations r
       ON r.app_id = e.app_id AND r.event_id = e.id AND r.user_id = ?
       AND r.status IN ('REGISTERED', 'ATTENDED')
     WHERE e.app_id = ? AND e.id = ? AND e.status IN ('PUBLISHED', 'COMPLETED')`,
    [caller.openId, caller.appId, eventId],
  )
  if (!event || !event.album_enabled) {
    throw new Error('EVENT_ALBUM_CLOSED')
  }
  const safeCaption = typeof caption === 'string' ? caption.trim().slice(0, 300) : ''
  const cloudClient = deps.cloud || cloud
  const photoId = randomUUID()
  const assetId = randomUUID()
  let cloudFileId = ''
  try {
    const image = decodeAvatar(base64)
    await (deps.assertAvatarContentSafe || assertAvatarContentSafe)(image.buffer, {
      cloud: cloudClient,
      ...(deps.contentSafety || {}),
    })
    const appScope = createHash('sha256').update(caller.appId).digest('hex').slice(0, 16)
    const userScope = createHash('sha256').update(caller.openId).digest('hex').slice(0, 24)
    const objectKey = `member-assets/${appScope}/events/${eventId}/album/${photoId}.${image.extension}`
    const uploaded = await cloudClient.uploadFile({ cloudPath: objectKey, fileContent: image.buffer })
    cloudFileId = uploaded?.fileID || uploaded?.fileId || ''
    if (!cloudFileId) throw new Error('PHOTO_UPLOAD_FAILED')
    const verified = await verifyUploadedAvatarObject(cloudClient, cloudFileId, {
      width: image.width,
      height: image.height,
      bytes: image.bytes,
      mimeType: image.mimeType,
      sha256: createHash('sha256').update(image.buffer).digest('hex'),
      buffer: image.buffer,
    })
    const status = event.album_requires_review ? 'PENDING_REVIEW' : 'PUBLISHED'
    await db().transaction(async (tx) => {
      await tx.query(
        `INSERT INTO member_media_assets (
           id, app_id, asset_key, kind, cloud_file_id, object_key, width, height,
           bytes, mime_type, alt_text, sha256, provenance, content_version, status, is_demo
         ) VALUES (?, ?, ?, 'event-photo', ?, ?, ?, ?, ?, ?, ?, ?, 'wechat:chooseMedia', 1, 'READY', 0)`,
        [
          assetId,
          caller.appId,
          `event-photo-${photoId}`,
          cloudFileId,
          objectKey,
          verified.width,
          verified.height,
          verified.bytes,
          verified.mimeType,
          safeCaption || '活动照片',
          verified.sha256,
        ],
      )
      await tx.query(
        `INSERT INTO member_event_photos (
           id, app_id, event_id, user_id, media_asset_id, caption, status
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [photoId, caller.appId, eventId, caller.openId, assetId, safeCaption, status],
      )
    })
    return { id: photoId, status }
  }
  catch (error) {
    const mapped = photoError(error)
    await recordMediaFailure(caller, {
      category: mapped.message === 'PHOTO_CONTENT_REJECTED' ? 'MEDIA_REVIEW' : 'MEDIA_UPLOAD',
      resourceType: 'event-photo',
      resourceId: eventId,
      errorCode: mapped.message,
    })
    await cleanupUploadedOrphan(caller, cloudClient, cloudFileId, assetId)
    throw mapped
  }
}

async function uploadEventCover(caller, eventId, base64, deps = {}) {
  const existingEventId = typeof eventId === 'string' && eventId
    ? eventId
    : null
  if (existingEventId && !/^[0-9a-f-]{36}$/i.test(existingEventId)) {
    throw new Error('EVENT_NOT_FOUND')
  }
  const [globalAdmin, eventManager] = await Promise.all([
    db().one(
      `SELECT role FROM member_admin_roles
       WHERE app_id = ? AND user_id = ? AND status = 'ACTIVE'
         AND role IN ('owner', 'manager')`,
      [caller.appId, caller.openId],
    ),
    existingEventId
      ? db().one(
          `SELECT manager.role FROM member_event_managers manager
           INNER JOIN member_events event
             ON event.app_id = manager.app_id AND event.id = manager.event_id
           WHERE manager.app_id = ? AND manager.event_id = ? AND manager.user_id = ?
             AND manager.status = 'ACTIVE'
             AND manager.role IN ('EVENT_OWNER', 'EVENT_MANAGER', 'EDITOR')`,
          [caller.appId, existingEventId, caller.openId],
        )
      : Promise.resolve(null),
  ])
  if (!globalAdmin && !eventManager) {
    throw new Error('FORBIDDEN')
  }

  const cloudClient = deps.cloud || cloud
  const assetId = randomUUID()
  let cloudFileId = ''
  try {
    const image = decodeAvatar(base64)
    await (deps.assertAvatarContentSafe || assertAvatarContentSafe)(image.buffer, {
      cloud: cloudClient,
      ...(deps.contentSafety || {}),
    })
    const appScope = createHash('sha256').update(caller.appId).digest('hex').slice(0, 16)
    const objectKey = `member-assets/${appScope}/events/${existingEventId || 'drafts'}/covers/${assetId}.${image.extension}`
    const uploaded = await cloudClient.uploadFile({ cloudPath: objectKey, fileContent: image.buffer })
    cloudFileId = uploaded?.fileID || uploaded?.fileId || ''
    if (!cloudFileId) throw new Error('PHOTO_UPLOAD_FAILED')
    const verified = await verifyUploadedAvatarObject(cloudClient, cloudFileId, {
      width: image.width,
      height: image.height,
      bytes: image.bytes,
      mimeType: image.mimeType,
      sha256: createHash('sha256').update(image.buffer).digest('hex'),
      buffer: image.buffer,
    })
    await db().query(
      `INSERT INTO member_media_assets (
         id, app_id, asset_key, kind, cloud_file_id, object_key, width, height,
         bytes, mime_type, alt_text, sha256, provenance, content_version, status, is_demo
       ) VALUES (?, ?, ?, 'event-cover', ?, ?, ?, ?, ?, ?, '活动封面', ?,
                 'admin:chooseMedia', 1, 'READY', 0)`,
      [
        assetId,
        caller.appId,
        `event-cover-${assetId}`,
        cloudFileId,
        objectKey,
        verified.width,
        verified.height,
        verified.bytes,
        verified.mimeType,
        verified.sha256,
      ],
    )
    return { assetId, coverUrl: cloudFileId }
  }
  catch (error) {
    const mapped = photoError(error)
    await recordMediaFailure(caller, {
      category: mapped.message === 'PHOTO_CONTENT_REJECTED' ? 'MEDIA_REVIEW' : 'MEDIA_UPLOAD',
      resourceType: 'event-cover',
      resourceId: existingEventId || assetId,
      errorCode: mapped.message,
    })
    await cleanupUploadedOrphan(caller, cloudClient, cloudFileId, assetId)
    throw mapped
  }
}

async function deleteEventPhoto(caller, photoId, deps = {}) {
  if (typeof photoId !== 'string' || !/^[0-9a-f-]{36}$/i.test(photoId)) {
    throw new Error('PHOTO_NOT_FOUND')
  }
  const cleanup = await db().transaction(async (tx) => {
    const photo = await tx.one(
      `SELECT p.id, p.status, p.media_asset_id, m.cloud_file_id
       FROM member_event_photos p
       INNER JOIN member_media_assets m ON m.app_id = p.app_id AND m.id = p.media_asset_id
       WHERE p.app_id = ? AND p.id = ? AND p.user_id = ?
       FOR UPDATE`,
      [caller.appId, photoId, caller.openId],
    )
    if (!photo || photo.status === 'REMOVED') {
      throw new Error('PHOTO_NOT_FOUND')
    }
    await tx.query(
      `UPDATE member_event_photos
       SET status = 'REMOVED', version = version + 1, updated_at = UTC_TIMESTAMP(3)
       WHERE app_id = ? AND id = ?`,
      [caller.appId, photoId],
    )
    await tx.query(
      `UPDATE member_media_assets SET status = 'ARCHIVED'
       WHERE app_id = ? AND id = ?`,
      [caller.appId, photo.media_asset_id],
    )
    return insertCleanupOutbox(tx, {
      appId: caller.appId,
      userId: caller.openId,
      mediaAssetId: photo.media_asset_id,
      cloudFileId: photo.cloud_file_id,
    })
  })
  if (cleanup?.id) {
    await processCleanupItem(db(), deps.cloud || cloud, {
      id: cleanup.id,
      app_id: caller.appId,
      cloud_file_id: cleanup.cloud_file_id,
      version: cleanup.version || 1,
    }, { leaseOwner: `photo:${caller.openId.slice(0, 12)}` }).catch(() => undefined)
  }
  return { id: photoId, status: 'REMOVED' }
}

async function issueCheckInPass(caller, eventId) {
  if (typeof eventId !== 'string' || !/^[0-9a-f-]{36}$/i.test(eventId)) {
    throw new Error('EVENT_NOT_FOUND')
  }
  const registration = await db().one(
    `SELECT r.id, r.status
     FROM member_registrations r
     INNER JOIN member_events e ON e.app_id = r.app_id AND e.id = r.event_id
     WHERE r.app_id = ? AND r.event_id = ? AND r.user_id = ?
       AND r.status IN ('REGISTERED', 'ATTENDED')
       AND e.status IN ('PUBLISHED', 'COMPLETED')`,
    [caller.appId, eventId, caller.openId],
  )
  if (!registration) {
    throw new Error('REGISTRATION_NOT_FOUND')
  }
  const token = randomBytes(32).toString('base64url')
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000)
  await db().transaction(async (tx) => {
    await tx.query(
      `DELETE FROM member_checkin_credentials
       WHERE app_id = ? AND registration_id = ?
         AND (expires_at <= UTC_TIMESTAMP(3) OR consumed_at IS NOT NULL)`,
      [caller.appId, registration.id],
    )
    await tx.query(
      `INSERT INTO member_checkin_credentials (
         id, app_id, registration_id, token_hash, expires_at
       ) VALUES (?, ?, ?, ?, ?)`,
      [
        randomUUID(),
        caller.appId,
        registration.id,
        createHash('sha256').update(token).digest('hex'),
        expiresAt,
      ],
    )
  })
  return {
    eventId,
    registrationId: registration.id,
    status: registration.status,
    value: `mbr-checkin:v1:${token}`,
    expiresAt: expiresAt.toISOString(),
  }
}

async function getEvent(caller, eventId) {
  if (typeof eventId !== 'string' || !/^[0-9a-f-]{36}$/i.test(eventId)) {
    throw new Error('EVENT_NOT_FOUND')
  }
  // Public feed remains PUBLISHED-only. Holders of any registration may still open
  // CANCELLED/COMPLETED history for the same app without leaking operator IDs.
  const event = await db().one(
    `SELECT e.*
     FROM member_events e
     WHERE e.id = ? AND e.app_id = ?
       AND (
         e.status = 'PUBLISHED'
         OR EXISTS (
           SELECT 1 FROM member_registrations r
           WHERE r.app_id = e.app_id
             AND r.event_id = e.id
             AND r.user_id = ?
         )
       )`,
    [eventId, caller.appId, caller.openId],
  )
  if (!event) {
    throw new Error('EVENT_NOT_FOUND')
  }
  const [
    ownRegistration,
    registrations,
    visibleParticipants,
    membership,
    privateProfile,
    ownProfile,
    eventManager,
    eventOwner,
    albumPreview,
    participantPreview,
    eventChanges,
  ] = await Promise.all([
    db().one(
      `SELECT id, status, ticket_code, cancelled_by_type, cancellation_reason, cancelled_at,
              answer_snapshot, share_profile, form_version, version, waitlisted_at, review_reason
       FROM member_registrations
       WHERE event_id = ? AND app_id = ? AND user_id = ?
       LIMIT 1`,
      [eventId, caller.appId, caller.openId],
    ),
    db().one(
      `SELECT COUNT(*) AS total FROM member_registrations
       WHERE event_id = ? AND app_id = ? AND status IN ('REGISTERED', 'CANCELLATION_PENDING', 'ATTENDED')`,
      [eventId, caller.appId],
    ),
    db().one(
      `SELECT COUNT(*) AS total
       FROM member_registrations r
       INNER JOIN member_profiles p
         ON p.app_id = r.app_id AND p.user_id = r.user_id AND p.status = 'APPROVED'
       WHERE r.event_id = ? AND r.app_id = ? AND r.share_profile = 1
         AND r.status IN ('REGISTERED', 'CANCELLATION_PENDING', 'ATTENDED')`,
      [eventId, caller.appId],
    ),
    db().one(
      'SELECT status, expires_at FROM member_entitlements WHERE app_id = ? AND user_id = ?',
      [caller.appId, caller.openId],
    ),
    db().one(
      'SELECT phone_number FROM member_private_profiles WHERE app_id = ? AND user_id = ?',
      [caller.appId, caller.openId],
    ),
    ensureProfile(caller),
    db().one(
      `SELECT role FROM member_event_managers
       WHERE app_id = ? AND event_id = ? AND user_id = ? AND status = 'ACTIVE'`,
      [caller.appId, eventId, caller.openId],
    ),
    db().one(
      `SELECT profile.id, profile.nickname, profile.headline, profile.avatar_asset_id
       FROM member_event_managers manager
       INNER JOIN member_profiles profile
         ON profile.app_id = manager.app_id
         AND profile.user_id = manager.user_id
         AND profile.status = 'APPROVED'
       WHERE manager.app_id = ? AND manager.event_id = ?
         AND manager.role = 'EVENT_OWNER' AND manager.status = 'ACTIVE'
       ORDER BY manager.created_at ASC
       LIMIT 1`,
      [caller.appId, eventId],
    ),
    event.album_enabled
      ? db().query(
          `SELECT photo.id, photo.caption, media.cloud_file_id,
                  profile.nickname, avatar.cloud_file_id AS avatar_url
           FROM member_event_photos photo
           INNER JOIN member_media_assets media
             ON media.app_id = photo.app_id AND media.id = photo.media_asset_id
             AND media.status = 'READY'
           LEFT JOIN member_profiles profile
             ON profile.app_id = photo.app_id AND profile.user_id = photo.user_id
           LEFT JOIN member_media_assets avatar
             ON avatar.app_id = profile.app_id AND avatar.id = profile.avatar_asset_id
             AND avatar.status = 'READY'
           WHERE photo.app_id = ? AND photo.event_id = ? AND photo.status = 'PUBLISHED'
           ORDER BY photo.created_at DESC LIMIT 6`,
          [caller.appId, eventId],
        )
      : Promise.resolve([]),
    previewEventParticipants(db(), {
      appId: caller.appId,
      userId: caller.openId,
      eventId,
      limit: 5,
    }),
    db().query(
      `SELECT event_version, change_type, summary, created_at
       FROM member_event_changes
       WHERE app_id = ? AND event_id = ?
       ORDER BY created_at DESC, id DESC
       LIMIT 5`,
      [caller.appId, eventId],
    ),
  ])
  const assets = await mediaMap(caller.appId, [
    event.cover_asset_id,
    event.poster_asset_id,
    eventOwner?.avatar_asset_id,
  ])
  const activeRegistration = ownRegistration
    && [
      'PENDING_REVIEW',
      'WAITLISTED',
      'REGISTERED',
      'CANCELLATION_PENDING',
      'ATTENDED',
    ].includes(ownRegistration.status)
  const history = ownRegistration
    ? publicRegistrationHistory(ownRegistration, event)
    : null
  const summary = eventSummary(
    event,
    new Set(activeRegistration ? [eventId] : []),
    new Map([[eventId, Number(registrations?.total || 0)]]),
    assets,
    new Map(ownRegistration ? [[eventId, ownRegistration.status]] : []),
  )
  const waitlistPosition = ownRegistration?.status === 'WAITLISTED'
    ? Number((await db().one(
        `SELECT COUNT(*) AS total
         FROM member_registrations
         WHERE app_id = ? AND event_id = ? AND status = 'WAITLISTED'
           AND (
             COALESCE(waitlisted_at, registered_at) < COALESCE(?, registered_at)
             OR (
               COALESCE(waitlisted_at, registered_at) = COALESCE(?, registered_at)
               AND id <= ?
             )
           )`,
        [
          caller.appId,
          eventId,
          ownRegistration.waitlisted_at,
          ownRegistration.waitlisted_at,
          ownRegistration.id,
        ],
      ))?.total || 0)
    : null
  return {
    ...summary,
    summary: event.summary || '',
    description: event.description || '',
    notices: event.notices || '',
    organizer: eventOwner
      ? {
          id: eventOwner.id,
          nickname: eventOwner.nickname || '活动发起人',
          headline: eventOwner.headline || '',
          avatarUrl: assets.get(eventOwner.avatar_asset_id) || '',
        }
      : null,
    venueName: event.venue_name || '',
    address: event.address || '',
    eventMode: ['ONLINE', 'HYBRID'].includes(event.event_mode) ? event.event_mode : 'OFFLINE',
    latitude: event.latitude === null || event.latitude === undefined ? null : Number(event.latitude),
    longitude: event.longitude === null || event.longitude === undefined ? null : Number(event.longitude),
    onlineUrl: activeRegistration || eventManager ? (event.online_url || '') : '',
    endsAt: iso(event.ends_at),
    registrationDeadline: iso(event.registration_deadline),
    cancellationPolicy: event.cancellation_policy || '',
    formVersion: Number(event.form_version || 1),
    registrationForm: publicRegistrationForm(
      event.registration_schema,
      ownProfile,
      privateProfile,
    ),
    registrationAnswers: ownRegistration ? jsonObject(ownRegistration.answer_snapshot) : {},
    registrationSharesProfile: Boolean(ownRegistration?.share_profile),
    registrationVersion: ownRegistration ? Number(ownRegistration.version || 1) : null,
    waitlistPosition,
    reviewReason: ownRegistration?.review_reason || null,
    changes: eventChanges.map(item => ({
      version: Number(item.event_version || 1),
      type: item.change_type || 'CONTENT',
      summary: item.summary || '',
      createdAt: iso(item.created_at) || '',
    })),
    albumEnabled: Boolean(event.album_enabled),
    albumPreview: albumPreview.map(item => ({
      id: item.id,
      imageUrl: item.cloud_file_id || '',
      caption: item.caption || '',
      nickname: item.nickname || '活动成员',
      avatarUrl: item.avatar_url || '',
    })),
    participantPreview,
    visibleParticipantCount: Number(visibleParticipants?.total || 0),
    canManage: Boolean(eventManager),
    managerRole: eventManager?.role || null,
    posterUrl: assets.get(event.poster_asset_id) || '',
    membershipActive: activeMembership(membership),
    phoneBound: Boolean(privateProfile?.phone_number),
    registrationState: history?.registrationState || null,
    cancelledByType: history?.cancelledByType || null,
    cancellationReason: history?.cancellationReason
      || (event.status === 'CANCELLED' ? (event.cancellation_reason || null) : null),
    cancelledAt: history?.cancelledAt
      || (event.status === 'CANCELLED' ? iso(event.cancelled_at) : null),
    canCancel: history ? history.canCancel : false,
    canEditRegistration: Boolean(
      ownRegistration
      && ['PENDING_REVIEW', 'WAITLISTED', 'REGISTERED'].includes(ownRegistration.status)
      && summary.registrationOpen,
    ),
    canRegister: Boolean(
      event.status === 'PUBLISHED'
      && !activeRegistration
      && summary.registrationOpen,
    ),
  }
}

async function listOrders(caller) {
  const rows = await db().query(
    `SELECT o.*, p.name AS plan_name, e.title AS event_name,
            r.id AS refund_id, r.status AS refund_status
     FROM member_orders o
     LEFT JOIN member_plans p ON p.app_id = o.app_id AND p.id = o.product_id
     LEFT JOIN member_events e ON e.app_id = o.app_id AND e.id = o.product_id
     LEFT JOIN member_refunds r ON r.app_id = o.app_id AND r.order_id = o.id
     WHERE o.app_id = ? AND o.user_id = ?
     ORDER BY o.created_at DESC LIMIT 50`,
    [caller.appId, caller.openId],
  )
  return rows.map(publicOrder)
}

async function listRegistrations(caller) {
  // Own history joins the event so CANCELLED/COMPLETED activities remain readable.
  // Operator internal IDs (cancelled_by) are never returned to the member client.
  const rows = await db().query(
    `SELECT
       r.id,
       r.event_id,
       r.status,
       r.ticket_code,
       r.cancelled_by_type,
       r.cancellation_reason,
       r.cancelled_at,
       r.registered_at,
       e.title,
       e.starts_at,
       e.location,
       e.status AS event_status,
       e.cancellation_reason AS event_cancellation_reason,
       e.cancelled_at AS event_cancelled_at
     FROM member_registrations r
     INNER JOIN member_events e ON e.id = r.event_id AND e.app_id = r.app_id
     WHERE r.app_id = ? AND r.user_id = ?
     ORDER BY r.registered_at DESC
     LIMIT 50`,
    [caller.appId, caller.openId],
  )
  return rows.map(row => publicRegistrationHistory(
    {
      id: row.id,
      event_id: row.event_id,
      status: row.status,
      ticket_code: row.ticket_code,
      cancelled_by_type: row.cancelled_by_type,
      cancellation_reason: row.cancellation_reason,
      cancelled_at: row.cancelled_at,
    },
    {
      title: row.title,
      starts_at: row.starts_at,
      location: row.location,
      status: row.event_status,
      cancellation_reason: row.event_cancellation_reason,
      cancelled_at: row.event_cancelled_at,
    },
  ))
}

async function registerEvent(caller, input) {
  const eventId = input?.eventId
  if (typeof eventId !== 'string' || !/^[0-9a-f-]{36}$/i.test(eventId)) {
    throw new Error('EVENT_NOT_FOUND')
  }
  const event = await db().one(
    `SELECT price_cents, member_free FROM member_events
     WHERE app_id = ? AND id = ? AND status = 'PUBLISHED'`,
    [caller.appId, eventId],
  )
  if (!event) {
    throw new Error('EVENT_NOT_FOUND')
  }
  if (activityType(event) === 'PAID') {
    const reservation = await createEventReservationOrder(db(), {
      appId: caller.appId,
      userId: caller.openId,
      eventId,
      formVersion: input.formVersion,
      answers: input.answers,
      shareProfile: input.shareProfile === true,
      idempotencyKey: input.idempotencyKey,
    })
    return {
      kind: 'PAYMENT_REQUIRED',
      eventId,
      orderId: reservation.orderId,
      expiresAt: iso(reservation.expiresAt),
      idempotent: Boolean(reservation.idempotent),
    }
  }
  const registration = await registerForEvent(db(), {
    appId: caller.appId,
    userId: caller.openId,
    eventId,
    formVersion: input.formVersion,
    answers: input.answers,
    shareProfile: input.shareProfile === true,
  })
  // Pass through the real registration fact; do not forge REGISTERED for ATTENDED retries.
  return {
    kind: 'REGISTERED',
    eventId,
    id: registration.id,
    status: registration.status,
    version: registration.version,
    ticketCodeMasked: maskTicketCode(registration.ticketCode || ''),
    idempotent: Boolean(registration.idempotent),
  }
}

async function cancelRegistration(caller, eventId, reason = '') {
  if (typeof eventId !== 'string' || !/^[0-9a-f-]{36}$/i.test(eventId)) {
    throw new Error('EVENT_REGISTRATION_NOT_FOUND')
  }
  const result = await cancelEventRegistration(db(), {
    appId: caller.appId,
    userId: caller.openId,
    eventId,
    reason,
  })
  return {
    eventId,
    id: result.id,
    status: result.status,
    version: result.version,
    refundId: result.refundId || null,
    refundStatus: result.refundStatus || null,
    idempotent: Boolean(result.idempotent),
  }
}

async function updateRegistration(caller, input) {
  const eventId = input?.eventId
  if (typeof eventId !== 'string' || !/^[0-9a-f-]{36}$/i.test(eventId)) {
    throw new Error('REGISTRATION_NOT_FOUND')
  }
  return updateRegistrationAnswers(db(), {
    appId: caller.appId,
    userId: caller.openId,
    eventId,
    formVersion: input.formVersion,
    answers: input.answers,
    shareProfile: input.shareProfile === true,
    expectedVersion: input.expectedVersion,
  })
}

async function listEventParticipants(caller, input) {
  const eventId = input?.eventId
  if (typeof eventId !== 'string' || !/^[0-9a-f-]{36}$/i.test(eventId)) {
    throw new Error('EVENT_NOT_FOUND')
  }
  const event = await db().one(
    `SELECT e.id, e.title
     FROM member_events e
     WHERE e.app_id = ? AND e.id = ?
       AND (
         e.status IN ('PUBLISHED', 'COMPLETED')
         OR EXISTS (
           SELECT 1 FROM member_registrations r
           WHERE r.app_id = e.app_id AND r.event_id = e.id AND r.user_id = ?
         )
       )`,
    [caller.appId, eventId, caller.openId],
  )
  if (!event) {
    throw new Error('EVENT_NOT_FOUND')
  }
  const page = await listEventParticipantsDomain(db(), {
    appId: caller.appId,
    userId: caller.openId,
    eventId,
    cursor: input.cursor,
    role: input.role,
    limit: 20,
  })
  return {
    eventId,
    eventTitle: event.title || '活动参与者',
    ...page,
  }
}

async function getCommunityAnnouncements(caller) {
  return listAnnouncements(db(), { appId: caller.appId, limit: 50 })
}

async function getCommunityAnnouncement(caller, announcementId) {
  return getAnnouncement(db(), { appId: caller.appId, announcementId })
}

async function updateMemberBlock(caller, event) {
  return setMemberBlock(db(), {
    appId: caller.appId,
    userId: caller.openId,
    memberId: event.memberId,
    blocked: event.blocked === true,
  })
}

async function getBlockedMembers(caller) {
  return listBlockedMembers(db(), {
    appId: caller.appId,
    userId: caller.openId,
  })
}

async function reportMember(caller, event) {
  const description = typeof event.description === 'string' ? event.description.trim() : ''
  await assertMessageContentSafe(caller, description)
  return createMemberReport(db(), {
    appId: caller.appId,
    userId: caller.openId,
    memberId: event.memberId,
    category: event.category,
    description,
    idempotencyKey: event.idempotencyKey,
  })
}

async function requestAccountDeletion(caller, confirmation, deps = {}) {
  if (confirmation !== 'DELETE') {
    throw new Error('ACCOUNT_DELETE_CONFIRMATION_REQUIRED')
  }
  const result = await deleteMemberAccount(db(), {
    appId: caller.appId,
    userId: caller.openId,
  })
  // Immediate attempt after commit: each deleteFile item status is checked before DONE.
  // Failures leave PENDING/FAILED outbox rows for owner/admin retryMediaCleanup.
  const cloudClient = deps.cloud || cloud
  const cleanupItems = Array.isArray(result?.cleanupItems) ? result.cleanupItems : []
  const cleanupResults = []
  for (const item of cleanupItems) {
    if (!item?.cloudFileId || !item?.outboxId) {
      continue
    }
    // eslint-disable-next-line no-await-in-loop
    const outcome = await processCleanupItem(db(), cloudClient, {
      id: item.outboxId,
      app_id: caller.appId,
      cloud_file_id: item.cloudFileId,
      version: item.version || 1,
    }, {
      leaseOwner: `delete:${caller.openId.slice(0, 12)}`,
    })
    cleanupResults.push({
      outboxId: item.outboxId,
      assetId: item.assetId,
      status: outcome.status,
    })
    if (outcome.status === 'DONE') {
      // eslint-disable-next-line no-await-in-loop
      await db().query(
        `INSERT INTO member_audit_logs (
           app_id, actor_id, actor_role, action, resource_type, resource_id, metadata
         ) VALUES (?, ?, 'member', 'MEDIA_CLEANUP_DONE', 'media', ?, ?)`,
        [
          caller.appId,
          caller.openId,
          item.assetId || item.cloudFileId,
          JSON.stringify({
            outboxId: item.outboxId,
            assetId: item.assetId || null,
            cloudFileId: item.cloudFileId,
            objectKey: item.objectKey || '',
          }),
        ],
      ).catch(() => undefined)
    }
  }
  return {
    status: 'DELETED',
    cancelledRegistrations: result.cancelledRegistrations,
    cleanupResults,
  }
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

async function retryMediaCleanup(caller, event = {}, deps = {}) {
  const signed = verifyMaintenanceSignature({
    ...event,
    action: 'retryMediaCleanup',
    appId: caller.appId,
  })
  let actorRole = signed ? 'maintenance' : null
  if (!signed) {
    const admin = await db().one(
      `SELECT role FROM member_admin_roles
       WHERE app_id = ? AND user_id = ? AND status = 'ACTIVE'
         AND role IN ('owner', 'manager')`,
      [caller.appId, caller.openId],
    )
    if (!admin) {
      throw new Error('FORBIDDEN')
    }
    actorRole = admin.role
  }
  const cloudClient = deps.cloud || cloud
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
        leaseOwner: `api:${caller.openId.slice(0, 16)}`,
      }
    }
  }
  const batch = await processDueCleanup(db(), cloudClient, {
    appId: caller.appId,
    userId: typeof event.userId === 'string' ? event.userId : null,
    limit: Number(event.limit) || 20,
    leaseOwner: `api:${caller.openId.slice(0, 16)}`,
  })
  if (requeue) {
    return { requeued: true, ...batch }
  }
  return batch
}

const handlers = {
  getOverview: caller => getOverview(caller),
  listMembers: (caller, event) => listMembers(caller, event.filter),
  listEvents: (caller, event) => listEventFeed(caller, event.view, event.query),
  createCheckout,
  getOrder: (caller, event) => getOrder(caller, event.orderId),
  bindPhone: (caller, event) => bindPhone(caller, event.code),
  uploadAvatar: (caller, event) => uploadAvatar(caller, event.base64),
  updateProfile: (caller, event) => updateProfile(caller, event.profile),
  registerEvent: (caller, event) => registerEvent(caller, event),
  updateRegistration: (caller, event) => updateRegistration(caller, event),
  cancelRegistration: (caller, event) => cancelRegistration(caller, event.eventId, event.reason),
  getMember: (caller, event) => getMember(caller, event.memberId),
  setFollow: (caller, event) => setFollow(caller, event.memberId, Boolean(event.following)),
  listConnections: (caller, event) => listConnections(caller, event.direction),
  listEventParticipants: (caller, event) => listEventParticipants(caller, event),
  listAnnouncements: caller => getCommunityAnnouncements(caller),
  getAnnouncement: (caller, event) => getCommunityAnnouncement(caller, event.announcementId),
  setMemberBlock: (caller, event) => updateMemberBlock(caller, event),
  listBlockedMembers: caller => getBlockedMembers(caller),
  reportMember: (caller, event) => reportMember(caller, event),
  listEventAlbum: (caller, event) => listEventAlbum(caller, event.eventId, event.cursor),
  uploadEventPhoto: (caller, event) => uploadEventPhoto(
    caller,
    event.eventId,
    event.base64,
    event.caption,
  ),
  uploadEventCover: (caller, event) => uploadEventCover(
    caller,
    event.eventId,
    event.base64,
  ),
  deleteEventPhoto: (caller, event) => deleteEventPhoto(caller, event.photoId),
  issueCheckInPass: (caller, event) => issueCheckInPass(caller, event.eventId),
  getEvent: (caller, event) => getEvent(caller, event.eventId),
  listOrders: caller => listOrders(caller),
  listRegistrations: caller => listRegistrations(caller),
  listNotifications: caller => getNotifications(caller),
  markNotificationsRead: (caller, event) => readNotifications(caller, event),
  recordNotificationSubscriptions: (caller, event) => saveNotificationSubscriptions(caller, event),
  requestAccountDeletion: (caller, event) => requestAccountDeletion(caller, event.confirmation),
  retryMediaCleanup: (caller, event) => retryMediaCleanup(caller, event),
}

/**
 * Read-only grant probe for public health. Never takes write locks or writes rows.
 */
async function proveExportIntegrityGrantsReadOnly(database) {
  const ticket = await database.one(
    `SELECT COUNT(*) AS c FROM member_export_tickets WHERE 1 = 0`,
  )
  const idem = await database.one(
    `SELECT COUNT(*) AS c FROM member_mutation_idempotency WHERE 1 = 0`,
  )
  const outbox = await database.one(
    `SELECT COUNT(*) AS c FROM member_media_cleanup_outbox WHERE 1 = 0`,
  ).catch(() => null)
  const notificationAppId = allowedAppIds.values().next().value || '__health_probe__'
  const notifications = await listNotifications(database, {
    appId: notificationAppId,
    userId: '__health_probe__',
    limit: 1,
  })
  const announcementProbe = await listAnnouncements(database, {
    appId: notificationAppId,
    limit: 1,
  })
  return {
    exportTickets: ticket !== undefined && ticket !== null,
    mutationIdempotency: idem !== undefined && idem !== null,
    mediaCleanupOutbox: outbox !== null,
    notificationInboxRead: Array.isArray(notifications),
    announcementRead: Array.isArray(announcementProbe),
    appScoped: true,
    mode: 'read-only',
  }
}

exports.main = async (event = {}) => {
  if (event.action === 'health') {
    // Public health is read-only: no write locks, no rollback writes.
    await db().one('SELECT 1 AS ok')
    const exportIntegrity = await proveExportIntegrityGrantsReadOnly(db())
    return success({
      service: 'membership-api',
      status: 'ok',
      paymentMode,
      persistence: 'cloudbase-mysql',
      appAllowlistConfigured: allowedAppIds.size > 0,
      exportIntegrityGrants: exportIntegrity,
      contractVersion: 12,
    })
  }
  const handler = handlers[event.action]
  if (!handler) {
    return failure(new Error('UNSUPPORTED_ACTION'))
  }
  try {
    return success(await handler(identity(), event))
  }
  catch (error) {
    console.error('[membership-api]', event.action, error)
    return failure(error)
  }
}
