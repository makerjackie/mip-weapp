'use strict'

const {
  CAPABILITIES,
  authorize,
  firstGrant,
  visibilityForCapability,
} = require('./capabilities')
const { decodeCursor } = require('./pagination')
const { AdminError, limit, requiredId, text } = require('./validation')
const { decryptPhone } = require('../lib/phone')

function createAdminUsers({ repository, access, phoneEncryptionKey }) {
  async function listUsers(caller, input = {}) {
    const context = await access.session(caller)
    firstGrant(context.bindings, CAPABILITIES.USERS_READ)
    const filters = normalizeUserFilters(input.filters || {})
    const includePhone = input.includePhone === true
    const phoneGrant = includePhone
      ? firstGrant(context.bindings, CAPABILITIES.USERS_PHONE_READ)
      : null
    const pageLimit = limit(input.limit)
    const cursor = decodeCursor(input.cursor, ['updatedAt', 'id'])
    const page = pageResult(await repository.listUsers(
      context.caller.appId,
      visibilityForCapability(context.bindings, CAPABILITIES.USERS_READ),
      filters,
      pageLimit,
      cursor,
    ))
    const items = page.items.map(item => projectUser(item, {
      appId: context.caller.appId,
      includePhone,
      phoneEncryptionKey,
    }))
    if (includePhone) {
      await repository.recordAudit(access.audit(context, phoneGrant, {
        scopeType: phoneGrant.scopeType,
        scopeId: phoneGrant.scopeId,
        action: 'admin.users.phone.view',
        resourceType: 'USER_LIST',
        metadata: { count: items.length, filters, cursor: Boolean(cursor) },
      }))
    }
    return { items, nextCursor: page.nextCursor }
  }

  async function getUser(caller, input = {}) {
    const context = await access.session(caller)
    const userId = requiredId(input.userId, '用户')
    const { scope } = await access.userAuthorization(context, userId, CAPABILITIES.USERS_READ)
    const includePhone = input.includePhone === true
    const phoneGrant = includePhone
      ? authorize(context.bindings, CAPABILITIES.USERS_PHONE_READ, scope)
      : null
    const item = await repository.getUserDetail(context.caller.appId, userId)
    if (!item) throw new AdminError('NOT_FOUND', '用户不存在')
    const safe = projectUser(item, {
      appId: context.caller.appId,
      includePhone,
      phoneEncryptionKey,
      userId,
    })
    if (includePhone) {
      await repository.recordAudit(access.audit(context, phoneGrant, {
        scopeType: scope.scopeType,
        scopeId: scope.scopeId,
        action: 'admin.users.phone.view',
        resourceType: 'USER',
        resourceId: userId,
        metadata: { detail: true },
      }))
    }
    const relatedRecords = typeof repository.getUserRelatedRecords === 'function'
      ? await repository.getUserRelatedRecords(context.caller.appId, userId)
      : { superCases: [], opportunities: [], registrations: [], orders: [] }
    return { ...safe, relatedRecords }
  }

  async function updateUser(caller, input) {
    const context = await access.session(caller)
    const userId = requiredId(input.userId, '用户')
    const { scope, grant } = await access.userAuthorization(context, userId, CAPABILITIES.USERS_EDIT)
    const fields = normalizeEditableFields(input.fields)
    const version = nonNegativeVersion(input.expectedVersion)
    return repository.updateUserFields({
      appId: context.caller.appId,
      actorUserId: context.caller.userId,
      userId,
      expectedVersion: version,
      fields,
      authorizedScope: scope,
      authorization: access.mutationAuthorization(grant, CAPABILITIES.USERS_EDIT),
      audit: access.audit(context, grant, {
        scopeType: scope.scopeType,
        scopeId: scope.scopeId,
        action: 'admin.users.fields.update',
        resourceType: 'USER',
        resourceId: userId,
        metadata: { fields: Object.keys(fields), expectedVersion: version },
      }),
    })
  }

  async function setUserControl(caller, input) {
    const context = await access.session(caller)
    const userId = requiredId(input.userId, '用户')
    const { scope, grant } = await access.userAuthorization(context, userId, CAPABILITIES.USERS_CONTROL)
    const controlType = ['ALLOWLIST', 'BLOCKLIST'].includes(input.controlType) ? input.controlType : null
    if (!controlType || typeof input.active !== 'boolean') {
      throw new AdminError('VALIDATION_FAILED', '名单设置无效')
    }
    const reason = text(input.reason, 300, { required: true, label: '原因' })
    return repository.setUserControl({
      appId: context.caller.appId,
      actorUserId: context.caller.userId,
      userId,
      controlType,
      active: input.active,
      reason,
      authorizedScope: scope,
      authorization: access.mutationAuthorization(grant, CAPABILITIES.USERS_CONTROL),
      audit: access.audit(context, grant, {
        scopeType: scope.scopeType,
        scopeId: scope.scopeId,
        action: input.active ? 'admin.users.access.activate' : 'admin.users.access.revoke',
        resourceType: 'USER_ACCESS_CONTROL',
        resourceId: userId,
        metadata: { controlType, reasonLength: reason.length },
      }),
    })
  }

  return {
    getUser,
    listUsers,
    normalizeExportFilters: normalizeUserFilters,
    setUserControl,
    updateUser,
  }
}

function projectUser(item, { appId, includePhone, phoneEncryptionKey, userId = item.id }) {
  const phoneNumber = includePhone && item.phoneCiphertext
    ? decryptPhone(item.phoneCiphertext, phoneEncryptionKey, { appId, userId })
    : null
  const { phoneCiphertext, ...safe } = item
  return { ...safe, phoneNumber }
}

function pageResult(value) {
  if (Array.isArray(value)) return { items: value, nextCursor: null }
  return {
    items: Array.isArray(value?.items) ? value.items : [],
    nextCursor: typeof value?.nextCursor === 'string' ? value.nextCursor : null,
  }
}

function normalizeUserFilters(value) {
  const filters = normalizeFilters(value)
  const createdFrom = dateTimeFilter(filters.createdFrom, '开始时间')
  const createdTo = dateTimeFilter(filters.createdTo, '结束时间')
  if (createdFrom && createdTo && createdFrom > createdTo) {
    throw new AdminError('VALIDATION_FAILED', '注册开始时间不能晚于结束时间')
  }
  const experienceMin = nonNegativeIntegerFilter(filters.experienceMin, '最低经验值')
  const experienceMax = nonNegativeIntegerFilter(filters.experienceMax, '最高经验值')
  if (experienceMin !== null && experienceMax !== null && experienceMin > experienceMax) {
    throw new AdminError('VALIDATION_FAILED', '最低经验值不能大于最高经验值')
  }
  return {
    query: text(filters.query, 80),
    status: ['ACTIVE', 'BLOCKED', 'CLOSED'].includes(filters.status) ? filters.status : '',
    kind: ['PLAYER', 'GUEST'].includes(filters.kind) ? filters.kind : '',
    branchId: filters.branchId ? requiredId(filters.branchId, '城市分会') : '',
    levelId: filters.levelId ? requiredId(filters.levelId, '成长等级') : '',
    controlType: ['ALLOWLIST', 'BLOCKLIST'].includes(filters.controlType) ? filters.controlType : '',
    phoneBound: ['BOUND', 'UNBOUND'].includes(filters.phoneBound) ? filters.phoneBound : '',
    profileComplete: ['COMPLETE', 'INCOMPLETE'].includes(filters.profileComplete) ? filters.profileComplete : '',
    joinedWithinDays: [7, 30, 90].includes(Number(filters.joinedWithinDays))
      ? Number(filters.joinedWithinDays)
      : 0,
    experienceMin,
    experienceMax,
    createdFrom,
    createdTo,
  }
}

function normalizeEditableFields(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AdminError('VALIDATION_FAILED', '可编辑字段无效')
  }
  const allowed = new Set(['nickname', 'headline', 'introduction', 'visibility'])
  const keys = Object.keys(value)
  if (!keys.length || keys.some(key => !allowed.has(key))) {
    throw new AdminError('VALIDATION_FAILED', '包含未授权的资料字段')
  }
  const fields = {}
  if ('nickname' in value) fields.nickname = text(value.nickname, 64, { required: true, label: '昵称' })
  if ('headline' in value) fields.headline = text(value.headline, 160, { label: '简介标题' })
  if ('introduction' in value) fields.introduction = text(value.introduction, 600, { label: '个人介绍' })
  if ('visibility' in value) {
    if (!value.visibility || typeof value.visibility !== 'object' || Array.isArray(value.visibility)) {
      throw new AdminError('VALIDATION_FAILED', '隐私设置无效')
    }
    fields.visibility = value.visibility
  }
  return fields
}

function normalizeFilters(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? { ...value } : {}
}

function nonNegativeIntegerFilter(value, label) {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  if (!Number.isInteger(number) || number < 0 || number > 1_000_000_000) {
    throw new AdminError('VALIDATION_FAILED', `${label}无效`)
  }
  return number
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

function nonNegativeVersion(value) {
  const version = Number(value)
  if (!Number.isInteger(version) || version < 0) {
    throw new AdminError('VALIDATION_FAILED', '记录版本无效')
  }
  return version
}

module.exports = { createAdminUsers }
