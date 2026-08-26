'use strict'

const {
  CAPABILITIES,
  authorize,
  firstGrant,
  visibilityForCapability,
} = require('./capabilities')
const { decodeCursor } = require('./pagination')
const {
  AdminError,
  expectedVersion,
  limit,
  requiredId,
  stableKey,
  text,
} = require('./validation')
const { decryptPhone } = require('../lib/phone')

const ROSTER_STATUSES = [
  'PENDING_REVIEW', 'WAITLISTED', 'PAYMENT_PENDING', 'REGISTERED',
  'CANCELLATION_PENDING', 'CANCELLED', 'REJECTED', 'ATTENDED',
]
const EVENT_STATUSES = ['DRAFT', 'PUBLISHED', 'UNPUBLISHED', 'CANCELLED', 'ENDED', 'ARCHIVED']
const EVENT_ACCESS_TYPES = ['FREE', 'MEMBER_INCLUDED', 'PAID']
const EVENT_SORT_FIELD = 'startsAt'

function createAdminEvents({
  repository,
  access,
  phoneEncryptionKey,
  contentSafety = async () => 'ERROR',
  dispatchCancellationRefunds = async (_appId, refundIds) => ({
    requested: refundIds.length,
    attempted: refundIds.length,
    deferred: 0,
    failed: refundIds.length,
  }),
}) {
  async function archiveEvent(caller, input = {}) {
    const context = await access.session(caller)
    const eventId = requiredId(input.eventId, '活动')
    const { scope, grant } = await access.eventAuthorization(context, eventId, CAPABILITIES.EVENTS_WRITE)
    const version = expectedVersion(input.expectedVersion)
    const reason = text(input.reason, 300, { required: true, label: '归档原因' })
    return repository.archiveEvent({
      appId: context.caller.appId,
      actorUserId: context.caller.userId,
      eventId,
      expectedVersion: version,
      reason,
      authorizedScope: scope,
      authorization: access.mutationAuthorization(grant, CAPABILITIES.EVENTS_WRITE),
      audit: access.audit(context, grant, {
        scopeType: 'EVENT', scopeId: eventId,
        action: 'admin.events.archive', resourceType: 'EVENT', resourceId: eventId,
        metadata: { expectedVersion: version, reasonLength: reason.length },
      }),
    })
  }

  async function listEvents(caller, input = {}) {
    const context = await access.session(caller)
    firstGrant(context.bindings, CAPABILITIES.EVENTS_READ)
    const query = normalizeEventListInput(input)
    return pageResult(await repository.listEvents(
      context.caller.appId,
      visibilityForCapability(context.bindings, CAPABILITIES.EVENTS_READ),
      query.filters,
      query.sort,
      query.pageLimit,
      query.cursor,
    ))
  }

  async function getEventPolicy(caller) {
    const context = await access.session(caller)
    firstGrant(context.bindings, CAPABILITIES.EVENTS_WRITE)
    return repository.getEventPolicy(context.caller.appId)
  }

  async function saveEventPolicy(caller, input = {}) {
    const context = await access.session(caller)
    const grant = authorize(context.bindings, CAPABILITIES.EVENTS_WRITE, {
      scopeType: 'PLATFORM',
      scopeId: null,
    })
    const cancellationHoursBeforeStart = Number(input.cancellationHoursBeforeStart)
    if (!Number.isInteger(cancellationHoursBeforeStart)
      || cancellationHoursBeforeStart < 0
      || cancellationHoursBeforeStart > 720) {
      throw new AdminError('VALIDATION_FAILED', '默认取消时间无效')
    }
    const version = nonNegativeVersion(input.expectedVersion)
    return repository.saveEventPolicy({
      appId: context.caller.appId,
      actorUserId: context.caller.userId,
      expectedVersion: version,
      cancellationHoursBeforeStart,
      authorization: access.mutationAuthorization(grant, CAPABILITIES.EVENTS_WRITE),
      audit: access.audit(context, grant, {
        scopeType: 'PLATFORM',
        scopeId: null,
        action: 'admin.events.policy.update',
        resourceType: 'APP_SETTING',
        metadata: { expectedVersion: version, cancellationHoursBeforeStart },
      }),
    })
  }

  async function getEvent(caller, input) {
    const context = await access.session(caller)
    const eventId = requiredId(input.eventId, '活动')
    await access.eventAuthorization(context, eventId, CAPABILITIES.EVENTS_READ)
    const event = await repository.getEvent(context.caller.appId, eventId)
    if (!event) throw new AdminError('NOT_FOUND', '活动不存在')
    return event
  }

  async function getEventInsights(caller, input = {}) {
    const context = await access.session(caller)
    const eventId = requiredId(input.eventId, '活动')
    return repository.getEventInsights({
      appId: context.caller.appId,
      actorUserId: context.caller.userId,
      eventId,
    })
  }

  async function listEventAlbumPhotos(caller, input = {}) {
    const context = await access.session(caller)
    const eventId = requiredId(input.eventId, '活动')
    await access.eventAuthorization(context, eventId, CAPABILITIES.EVENTS_ALBUM_MANAGE)
    const status = ['PENDING', 'PUBLISHED', 'REJECTED'].includes(input.status)
      ? input.status
      : null
    if (!status) throw new AdminError('VALIDATION_FAILED', '相册筛选状态无效')
    return {
      items: await repository.listEventAlbumPhotos(
        context.caller.appId,
        eventId,
        status,
        limit(input.limit, 100),
      ),
      nextCursor: null,
    }
  }

  async function reviewEventAlbumPhoto(caller, input = {}) {
    const context = await access.session(caller)
    const eventId = requiredId(input.eventId, '活动')
    const photoId = requiredId(input.photoId, '照片')
    const { scope, grant } = await access.eventAuthorization(context, eventId, CAPABILITIES.EVENTS_ALBUM_MANAGE)
    const decision = input.decision === 'APPROVE'
      ? { status: 'PUBLISHED', action: 'admin.events.album.approve' }
      : input.decision === 'REJECT'
        ? { status: 'REJECTED', action: 'admin.events.album.reject' }
        : null
    if (!decision) throw new AdminError('VALIDATION_FAILED', '相册审核结论无效')
    const reason = text(input.reason, 300, { required: true, label: '审核原因' })
    const version = expectedVersion(input.expectedVersion)
    return repository.reviewEventAlbumPhoto({
      appId: context.caller.appId,
      actorUserId: context.caller.userId,
      eventId,
      photoId,
      expectedVersion: version,
      status: decision.status,
      reason,
      authorization: access.mutationAuthorization(grant, CAPABILITIES.EVENTS_ALBUM_MANAGE),
      authorizedScope: scope,
      audit: access.audit(context, grant, {
        scopeType: 'EVENT',
        scopeId: eventId,
        action: decision.action,
        resourceType: 'EVENT_ALBUM_PHOTO',
        resourceId: photoId,
        metadata: { expectedVersion: version, reason },
      }),
    })
  }

  async function saveEvent(caller, input) {
    const context = await access.session(caller)
    let grant
    let existingScope = null
    if (input.eventId) {
      const authorization = await access.eventAuthorization(context, input.eventId, CAPABILITIES.EVENTS_WRITE)
      grant = authorization.grant
      existingScope = authorization.scope
    }
    else {
      const scope = input.draft?.scopeType === 'BRANCH'
        ? { scopeType: 'BRANCH', scopeId: requiredId(input.draft.branchId, '城市分会') }
        : { scopeType: 'PLATFORM', scopeId: null }
      grant = authorize(context.bindings, CAPABILITIES.EVENTS_WRITE, scope)
    }
    const draft = normalizeEventDraft(input.draft)
    if (existingScope && grant.scopeType !== 'PLATFORM') {
      const scopeChanged = draft.scopeType !== existingScope.eventScopeType
        || (draft.branchId || null) !== (existingScope.branchId || null)
      if (scopeChanged) throw new AdminError('FORBIDDEN', '当前账号不能修改活动归属')
    }
    const version = input.eventId ? expectedVersion(input.expectedVersion) : 0
    const checkedContentSafetyStatus = await contentSafety({
      title: draft.title,
      summary: draft.summary,
      description: draft.description,
      notices: draft.notices,
    }, caller)
    const contentSafetyStatus = ['PASSED', 'REJECTED', 'ERROR'].includes(checkedContentSafetyStatus)
      ? checkedContentSafetyStatus
      : 'ERROR'
    return repository.saveEvent({
      appId: context.caller.appId,
      actorUserId: context.caller.userId,
      eventId: input.eventId ? requiredId(input.eventId, '活动') : null,
      expectedVersion: version,
      draft,
      contentSafetyStatus,
      authorization: access.mutationAuthorization(grant, CAPABILITIES.EVENTS_WRITE),
      authorizedScope: existingScope,
      audit: eventId => access.audit(context, grant, {
        scopeType: 'EVENT',
        scopeId: eventId,
        action: input.eventId ? 'admin.events.update' : 'admin.events.create',
        resourceType: 'EVENT',
        resourceId: eventId,
        metadata: { expectedVersion: version },
      }),
    })
  }

  async function cloneEvent(caller, input) {
    const context = await access.session(caller)
    const sourceEventId = requiredId(input.sourceEventId, '活动')
    const authorization = await access.eventAuthorization(context, sourceEventId, CAPABILITIES.EVENTS_WRITE)
    const { scope } = authorization
    let { grant } = authorization
    if (grant.scopeType === 'EVENT') {
      const creationScope = scope.eventScopeType === 'BRANCH'
        ? { scopeType: 'BRANCH', scopeId: scope.branchId }
        : { scopeType: 'PLATFORM', scopeId: null }
      try {
        grant = authorize(context.bindings, CAPABILITIES.EVENTS_WRITE, creationScope)
      }
      catch {
        throw new AdminError('FORBIDDEN', '当前账号没有创建活动权限')
      }
    }
    const version = expectedVersion(input.expectedVersion)
    const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey)
    const source = await repository.getEvent(context.caller.appId, sourceEventId)
    if (!source) throw new AdminError('NOT_FOUND', '活动不存在')
    const title = cloneEventTitle(source.title)
    const checkedContentSafetyStatus = await contentSafety({
      title,
      summary: source.summary,
      description: source.description,
      notices: source.notices,
    }, caller)
    const contentSafetyStatus = ['PASSED', 'REJECTED', 'ERROR'].includes(checkedContentSafetyStatus)
      ? checkedContentSafetyStatus
      : 'ERROR'
    return repository.cloneEvent({
      appId: context.caller.appId,
      actorUserId: context.caller.userId,
      sourceEventId,
      expectedVersion: version,
      idempotencyKey,
      title,
      contentSafetyStatus,
      authorization: access.mutationAuthorization(grant, CAPABILITIES.EVENTS_WRITE),
      authorizedScope: scope,
      audit: eventId => access.audit(context, grant, {
        scopeType: 'EVENT',
        scopeId: eventId,
        action: 'admin.events.clone',
        resourceType: 'EVENT',
        resourceId: eventId,
        metadata: { sourceEventId, sourceVersion: version },
      }),
    })
  }

  async function changeEventStatus(caller, input) {
    const context = await access.session(caller)
    const eventId = requiredId(input.eventId, '活动')
    const { scope, grant } = await access.eventAuthorization(context, eventId, CAPABILITIES.EVENTS_WRITE)
    if (!['PUBLISHED', 'UNPUBLISHED', 'CANCELLED', 'ENDED'].includes(input.status)) {
      throw new AdminError('VALIDATION_FAILED', '活动状态无效')
    }
    const reason = input.status === 'CANCELLED'
      ? text(input.reason, 300, { required: true, label: '取消原因' })
      : ''
    const version = expectedVersion(input.expectedVersion)
    const result = await repository.changeEventStatus({
      appId: context.caller.appId,
      actorUserId: context.caller.userId,
      eventId,
      expectedVersion: version,
      status: input.status,
      reason,
      authorization: access.mutationAuthorization(grant, CAPABILITIES.EVENTS_WRITE),
      authorizedScope: scope,
      audit: access.audit(context, grant, {
        scopeType: 'EVENT',
        scopeId: eventId,
        action: 'admin.events.status.change',
        resourceType: 'EVENT',
        resourceId: eventId,
        metadata: {
          status: input.status,
          previousStatus: scope.status,
          expectedVersion: version,
          reasonLength: reason.length,
        },
      }),
    })
    const refundIds = Array.isArray(result.refundIds) ? result.refundIds : []
    const refundDispatch = await dispatchCancellationRefunds(context.caller.appId, refundIds)
    return {
      id: result.id,
      status: result.status,
      version: result.version,
      affectedCount: result.affectedCount,
      refundDispatch,
    }
  }

  async function publishEventReminder(caller, input) {
    const context = await access.session(caller)
    const eventId = requiredId(input.eventId, '活动')
    const { scope, grant } = await access.eventAuthorization(context, eventId, CAPABILITIES.COMMUNICATIONS_PUBLISH)
    const version = expectedVersion(input.expectedVersion)
    const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey)
    if (typeof input.sendWechatReminder !== 'boolean') {
      throw new AdminError('VALIDATION_FAILED', '微信提醒设置无效')
    }
    return repository.publishEventReminder({
      appId: context.caller.appId,
      actorUserId: context.caller.userId,
      eventId,
      expectedVersion: version,
      idempotencyKey,
      sendWechatReminder: input.sendWechatReminder,
      authorization: access.mutationAuthorization(grant, CAPABILITIES.COMMUNICATIONS_PUBLISH),
      authorizedScope: scope,
      audit: (publicationId, result) => access.audit(context, grant, {
        scopeType: 'EVENT',
        scopeId: eventId,
        action: 'admin.communications.publish',
        resourceType: 'OPERATIONS_PUBLICATION',
        resourceId: publicationId,
        metadata: {
          eventId,
          expectedVersion: version,
          recipientCount: result.recipientCount,
          sendWechatReminder: result.sendWechatReminder,
        },
      }),
    })
  }

  async function listRoster(caller, input) {
    const context = await access.session(caller)
    const eventId = requiredId(input.eventId, '活动')
    const { scope } = await access.eventAuthorization(context, eventId, CAPABILITIES.EVENTS_ROSTER)
    const includePhone = input.includePhone === true
    const phoneGrant = includePhone
      ? authorize(context.bindings, CAPABILITIES.USERS_PHONE_READ, scope)
      : null
    const page = pageResult(await repository.listRoster(
      context.caller.appId,
      eventId,
      normalizeRosterFilters(input.filters),
      limit(input.limit),
      decodeCursor(input.cursor, ['submittedAt', 'id']),
    ))
    const safeItems = page.items.map((item) => {
      const rawPhone = includePhone && item.phoneCiphertext
        ? decryptPhone(item.phoneCiphertext, phoneEncryptionKey, { appId: context.caller.appId, userId: item.userId })
        : null
      const { phoneCiphertext, userId, ...safe } = item
      return {
        ...safe,
        phoneNumber: rawPhone,
      }
    })
    if (includePhone) {
      await repository.recordAudit(access.audit(context, phoneGrant, {
        scopeType: 'EVENT',
        scopeId: eventId,
        action: 'admin.events.roster.phone.view',
        resourceType: 'EVENT_ROSTER',
        resourceId: eventId,
        metadata: { count: safeItems.length },
      }))
    }
    return { items: safeItems, nextCursor: page.nextCursor }
  }

  async function listRosterAll(caller, input = {}) {
    const context = await access.session(caller)
    const grant = firstGrant(context.bindings, CAPABILITIES.EVENTS_ROSTER)
    const includePhone = input.includePhone === true
    const scope = { scopeType: grant.scopeType, scopeId: grant.scopeId }
    const phoneGrant = includePhone
      ? authorize(context.bindings, CAPABILITIES.USERS_PHONE_READ, scope)
      : null
    const page = pageResult(await repository.listRosterAll(
      context.caller.appId,
      visibilityForCapability(context.bindings, CAPABILITIES.EVENTS_ROSTER),
      normalizeRosterAllFilters(input.filters),
      limit(input.limit),
      decodeCursor(input.cursor, ['submittedAt', 'id']),
    ))
    const items = page.items.map((item) => {
      const phoneNumber = includePhone && item.phoneCiphertext
        ? decryptPhone(item.phoneCiphertext, phoneEncryptionKey, { appId: context.caller.appId, userId: item.userId })
        : null
      const { phoneCiphertext, ...safe } = item
      return { ...safe, phoneNumber }
    })
    if (includePhone) {
      await repository.recordAudit(access.audit(context, phoneGrant, {
        scopeType: scope.scopeType,
        scopeId: scope.scopeId,
        action: 'admin.events.roster.all.phone.view',
        resourceType: 'EVENT_ROSTER',
        metadata: { count: items.length },
      }))
    }
    return { items, nextCursor: page.nextCursor }
  }

  async function checkIn(caller, input) {
    const context = await access.session(caller)
    const eventId = requiredId(input.eventId, '活动')
    const { scope, grant } = await access.eventAuthorization(context, eventId, CAPABILITIES.EVENTS_CHECKIN)
    const registrationId = requiredId(input.registrationId, '报名')
    const version = expectedVersion(input.expectedVersion)
    return repository.checkIn({
      appId: context.caller.appId,
      actorUserId: context.caller.userId,
      eventId,
      registrationId,
      expectedVersion: version,
      authorization: access.mutationAuthorization(grant, CAPABILITIES.EVENTS_CHECKIN),
      authorizedScope: scope,
      audit: access.audit(context, grant, {
        scopeType: 'EVENT', scopeId: eventId, action: 'admin.events.checkin',
        resourceType: 'EVENT_REGISTRATION', resourceId: registrationId,
        metadata: { expectedVersion: version },
      }),
    })
  }

  async function undoCheckIn(caller, input = {}) {
    const context = await access.session(caller)
    const eventId = requiredId(input.eventId, '活动')
    const { scope, grant } = await access.eventAuthorization(context, eventId, CAPABILITIES.EVENTS_CHECKIN_UNDO)
    const registrationId = requiredId(input.registrationId, '报名')
    const version = expectedVersion(input.expectedVersion)
    const reason = text(input.reason, 120, { required: true, label: '撤销原因' })
    return repository.undoCheckIn({
      appId: context.caller.appId,
      actorUserId: context.caller.userId,
      eventId,
      registrationId,
      expectedVersion: version,
      reason,
      authorization: access.mutationAuthorization(grant, CAPABILITIES.EVENTS_CHECKIN_UNDO),
      authorizedScope: scope,
      audit: access.audit(context, grant, {
        scopeType: 'EVENT',
        scopeId: eventId,
        action: 'admin.events.checkin.undo',
        resourceType: 'EVENT_REGISTRATION',
        resourceId: registrationId,
        metadata: { expectedVersion: version, reason },
      }),
    })
  }

  async function reviewRegistration(caller, input) {
    const context = await access.session(caller)
    const eventId = requiredId(input.eventId, '活动')
    const { scope, grant } = await access.eventAuthorization(context, eventId, CAPABILITIES.EVENTS_REGISTRATIONS_MANAGE)
    const registrationId = requiredId(input.registrationId, '报名')
    const version = expectedVersion(input.expectedVersion)
    const decision = ['APPROVE', 'REJECT'].includes(input.decision) ? input.decision : null
    if (!decision) throw new AdminError('VALIDATION_FAILED', '审核结果无效')
    return repository.reviewRegistration({
      appId: context.caller.appId,
      actorUserId: context.caller.userId,
      eventId,
      registrationId,
      expectedVersion: version,
      decision,
      authorization: access.mutationAuthorization(grant, CAPABILITIES.EVENTS_REGISTRATIONS_MANAGE),
      authorizedScope: scope,
      audit: status => access.audit(context, grant, {
        scopeType: 'EVENT',
        scopeId: eventId,
        action: decision === 'APPROVE'
          ? 'admin.events.registration.approve'
          : 'admin.events.registration.reject',
        resourceType: 'EVENT_REGISTRATION',
        resourceId: registrationId,
        metadata: { decision, status, expectedVersion: version },
      }),
    })
  }

  return {
    archiveEvent,
    changeEventStatus,
    checkIn,
    cloneEvent,
    getEvent,
    getEventInsights,
    getEventPolicy,
    listEventAlbumPhotos,
    listEvents,
    listRoster,
    listRosterAll,
    normalizeExportFilters,
    publishEventReminder,
    reviewEventAlbumPhoto,
    reviewRegistration,
    saveEvent,
    saveEventPolicy,
    undoCheckIn,
  }
}

function pageResult(value) {
  if (Array.isArray(value)) return { items: value, nextCursor: null }
  return {
    items: Array.isArray(value?.items) ? value.items : [],
    nextCursor: typeof value?.nextCursor === 'string' ? value.nextCursor : null,
  }
}

function normalizeFilters(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? { ...value } : {}
}

function normalizeEventListInput(input) {
  const source = normalizeFilters(input)
  const filters = normalizeFilters(source.filters)
  const startsFrom = dateTimeFilter(filters.startsFrom, '活动开始时间起')
  const startsTo = dateTimeFilter(filters.startsTo, '活动开始时间止')
  if (startsFrom && startsTo && startsFrom > startsTo) {
    throw new AdminError('VALIDATION_FAILED', '活动开始时间起不能晚于结束时间')
  }
  const priceMinCents = moneyFilter(filters.priceMinCents, '最低价格')
  const priceMaxCents = moneyFilter(filters.priceMaxCents, '最高价格')
  if (priceMinCents !== null && priceMaxCents !== null && priceMinCents > priceMaxCents) {
    throw new AdminError('VALIDATION_FAILED', '最低价格不能高于最高价格')
  }
  const sort = normalizeEventSort(source.sort)
  const cursor = decodeCursor(source.cursor, ['startsAt', 'id', 'sortField', 'sortDirection'])
  if (cursor && (cursor.sortField !== sort.field || cursor.sortDirection !== sort.direction)) {
    throw new AdminError('VALIDATION_FAILED', '分页游标与活动排序不一致')
  }
  return {
    filters: {
      query: text(filters.query, 80),
      status: enumFilter(filters.status, EVENT_STATUSES, '活动状态'),
      startsFrom,
      startsTo,
      cityOrBranch: text(filters.cityOrBranch, 80),
      branchId: filters.branchId ? requiredId(filters.branchId, '城市分会') : '',
      eventTypeKey: filters.eventTypeKey ? stableKey(filters.eventTypeKey, '活动类型', 64) : '',
      accessType: enumFilter(filters.accessType, EVENT_ACCESS_TYPES, '收费类型'),
      priceMinCents,
      priceMaxCents,
    },
    sort,
    pageLimit: limit(source.limit),
    cursor,
  }
}

function normalizeEventSort(value) {
  if (value === null || value === undefined) {
    return { field: EVENT_SORT_FIELD, direction: 'ASC' }
  }
  const source = normalizeFilters(value)
  if (source.field !== EVENT_SORT_FIELD || !['ASC', 'DESC'].includes(source.direction)) {
    throw new AdminError('VALIDATION_FAILED', '活动排序无效')
  }
  return { field: EVENT_SORT_FIELD, direction: source.direction }
}

function moneyFilter(value, label) {
  if (value === null || value === undefined || value === '') return null
  const amount = Number(value)
  if (!Number.isSafeInteger(amount) || amount < 0 || amount > 4_294_967_295) {
    throw new AdminError('VALIDATION_FAILED', `${label}无效`)
  }
  return amount
}

function normalizeRosterFilters(value) {
  const filters = normalizeFilters(value)
  const createdFrom = dateTimeFilter(filters.createdFrom, '开始时间')
  const createdTo = dateTimeFilter(filters.createdTo, '结束时间')
  if (createdFrom && createdTo && createdFrom > createdTo) {
    throw new AdminError('VALIDATION_FAILED', '报名开始时间不能晚于结束时间')
  }
  return {
    query: text(filters.query, 80),
    status: enumFilter(filters.status, ROSTER_STATUSES, '报名状态'),
    createdFrom,
    createdTo,
  }
}

function normalizeRosterAllFilters(value) {
  const filters = normalizeRosterFilters(value)
  const source = normalizeFilters(value)
  return {
    ...filters,
    eventId: source.eventId ? requiredId(source.eventId, '活动') : '',
    branchId: source.branchId ? requiredId(source.branchId, '城市分会') : '',
  }
}

function normalizeExportFilters(exportType, value) {
  if (exportType === 'EVENT_ROSTER') return normalizeRosterFilters(value)
  if (exportType === 'EVENT_ROSTER_ALL') return normalizeRosterAllFilters(value)
  throw new AdminError('VALIDATION_FAILED', '活动导出类型无效')
}

function enumFilter(value, allowed, label) {
  if (value === null || value === undefined || value === '') return ''
  const normalized = typeof value === 'string' ? value.trim().toUpperCase() : ''
  if (!allowed.includes(normalized)) {
    throw new AdminError('VALIDATION_FAILED', `${label}无效`)
  }
  return normalized
}

function dateTimeFilter(value, label) {
  if (value === null || value === undefined || value === '') return ''
  if (typeof value !== 'string' || value.length > 40) {
    throw new AdminError('VALIDATION_FAILED', `${label}无效`)
  }
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) {
    throw new AdminError('VALIDATION_FAILED', `${label}无效`)
  }
  return date.toISOString().slice(0, 23).replace('T', ' ')
}

function normalizeEventDraft(value) {
  if (!value || typeof value !== 'object') throw new AdminError('VALIDATION_FAILED', '活动内容无效')
  const startsAt = new Date(value.startsAt)
  const endsAt = new Date(value.endsAt)
  if (!Number.isFinite(startsAt.getTime()) || !Number.isFinite(endsAt.getTime()) || endsAt <= startsAt) {
    throw new AdminError('VALIDATION_FAILED', '活动时间无效')
  }
  const eventMode = ['OFFLINE', 'ONLINE', 'HYBRID'].includes(value.eventMode) ? value.eventMode : 'OFFLINE'
  const accessType = ['FREE', 'MEMBER_INCLUDED', 'PAID'].includes(value.accessType) ? value.accessType : 'FREE'
  const registrationPolicy = ['AUTO', 'APPROVAL'].includes(value.registrationPolicy) ? value.registrationPolicy : 'AUTO'
  const albumSubmissionPolicy = value.albumSubmissionPolicy === 'AUTO' ? 'AUTO' : 'REVIEW'
  const priceCents = Number(value.priceCents || 0)
  const waitlistEnabled = value.waitlistEnabled === true
  if (accessType === 'PAID' && (!Number.isInteger(priceCents) || priceCents < 1 || registrationPolicy !== 'AUTO' || waitlistEnabled)) {
    throw new AdminError('VALIDATION_FAILED', '付费活动配置无效')
  }
  if (accessType !== 'PAID' && priceCents !== 0) throw new AdminError('VALIDATION_FAILED', '免费活动金额必须为零')
  const venueName = text(value.venueName, 160)
  const onlineUrl = text(value.onlineUrl, 1024)
  const latitude = coordinate(value.latitude, -90, 90, '纬度')
  const longitude = coordinate(value.longitude, -180, 180, '经度')
  if ((latitude === null) !== (longitude === null)) {
    throw new AdminError('VALIDATION_FAILED', '活动地点坐标不完整')
  }
  if ((eventMode === 'OFFLINE' || eventMode === 'HYBRID') && !venueName) throw new AdminError('VALIDATION_FAILED', '请填写活动地点')
  if ((eventMode === 'ONLINE' || eventMode === 'HYBRID') && !onlineUrl.startsWith('https://')) throw new AdminError('VALIDATION_FAILED', '线上地址必须使用 HTTPS')
  const capacity = value.capacity === null || value.capacity === undefined || value.capacity === '' ? null : Number(value.capacity)
  if (capacity !== null && (!Number.isInteger(capacity) || capacity < 1)) throw new AdminError('VALIDATION_FAILED', '活动名额无效')
  const registrationDeadline = dateOrNull(value.registrationDeadline)
  const cancellationDeadline = dateOrNull(value.cancellationDeadline)
  if (registrationDeadline && registrationDeadline > startsAt) throw new AdminError('VALIDATION_FAILED', '报名截止时间不能晚于活动开始时间')
  if (cancellationDeadline && cancellationDeadline > startsAt) throw new AdminError('VALIDATION_FAILED', '取消截止时间不能晚于活动开始时间')
  const coverAssetId = text(value.coverAssetId, 36)
  if (coverAssetId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(coverAssetId)) {
    throw new AdminError('VALIDATION_FAILED', '活动封面无效')
  }
  const contentMedia = Array.isArray(value.contentMedia) ? value.contentMedia : []
  if (contentMedia.length > 12) {
    throw new AdminError('VALIDATION_FAILED', '活动介绍图片最多 12 张')
  }
  const contentMediaIds = new Set()
  const normalizedContentMedia = contentMedia.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new AdminError('VALIDATION_FAILED', '活动介绍图片无效')
    }
    const assetId = text(item.assetId, 36)
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(assetId)
      || contentMediaIds.has(assetId)) {
      throw new AdminError('VALIDATION_FAILED', '活动介绍图片无效')
    }
    contentMediaIds.add(assetId)
    return { assetId, caption: text(item.caption, 120) }
  })
  return {
    scopeType: value.scopeType === 'BRANCH' ? 'BRANCH' : 'PLATFORM',
    branchId: value.scopeType === 'BRANCH' ? requiredId(value.branchId, '城市分会') : null,
    title: text(value.title, 120, { required: true, label: '活动名称' }),
    summary: text(value.summary, 300, { required: true, label: '活动摘要' }),
    description: text(value.description, 20_000, { required: true, label: '活动介绍' }),
    contentMedia: normalizedContentMedia,
    notices: text(value.notices, 5_000),
    coverAssetId: coverAssetId || null,
    eventTypeKey: stableKey(value.eventTypeKey || 'general', '活动类型', 64),
    eventMode,
    accessType,
    registrationPolicy,
    albumEnabled: value.albumEnabled !== false,
    albumSubmissionPolicy,
    startsAt,
    endsAt,
    registrationDeadline,
    cancellationDeadline,
    venueName,
    address: text(value.address, 300),
    cityName: text(value.cityName, 80),
    latitude,
    longitude,
    onlineUrl: eventMode === 'OFFLINE' ? null : onlineUrl,
    capacity,
    waitlistEnabled,
    priceCents,
    registrationSchema: Array.isArray(value.registrationSchema) ? value.registrationSchema : [],
  }
}

function cloneEventTitle(value) {
  const suffix = '（副本）'
  return `${String(value || '').trim().slice(0, 120 - suffix.length)}${suffix}`
}

function dateOrNull(value) {
  if (!value) return null
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) throw new AdminError('VALIDATION_FAILED', '日期格式无效')
  return date
}

function coordinate(value, minimum, maximum, label) {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  if (!Number.isFinite(number) || number < minimum || number > maximum) {
    throw new AdminError('VALIDATION_FAILED', `${label}无效`)
  }
  return number
}

function normalizeIdempotencyKey(value) {
  const key = stableKey(value, '请求', 128)
  if (key.length < 12) throw new AdminError('VALIDATION_FAILED', '请求标识无效')
  return key
}

function nonNegativeVersion(value) {
  const version = Number(value)
  if (!Number.isInteger(version) || version < 0) throw new AdminError('VALIDATION_FAILED', '记录版本无效')
  return version
}

module.exports = { createAdminEvents }
