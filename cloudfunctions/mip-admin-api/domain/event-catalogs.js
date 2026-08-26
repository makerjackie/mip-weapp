'use strict'

const { CAPABILITIES, firstGrant } = require('./capabilities')
const { decodeCursor } = require('./pagination')
const {
  AdminError,
  expectedVersion,
  limit,
  requiredId,
  stableKey,
  text,
} = require('./validation')

const CATALOG_KINDS = new Set(['TYPE', 'TAG'])
const CATALOG_STATUSES = new Set(['ACTIVE', 'INACTIVE', 'ARCHIVED'])
const MUTABLE_STATUSES = new Set(['ACTIVE', 'INACTIVE'])
const RECAP_PROVIDERS = new Set(['WECHAT_CHANNELS'])
const RECAP_DESTINATION_KINDS = new Set(['PROFILE', 'ACTIVITY'])
const LIST_CATALOG_KEYS = new Set(['kind', 'status', 'query', 'cursor', 'limit'])
const SAVE_CATALOG_CREATE_KEYS = new Set(['kind', 'key', 'name', 'description', 'sortOrder'])
const SAVE_CATALOG_UPDATE_KEYS = new Set([
  'kind', 'catalogId', 'expectedVersion', 'name', 'description', 'sortOrder',
])
const STATUS_CATALOG_KEYS = new Set(['kind', 'catalogId', 'expectedVersion', 'status'])
const ARCHIVE_CATALOG_KEYS = new Set(['kind', 'catalogId', 'expectedVersion', 'reason'])
const LIST_RECAP_KEYS = new Set(['eventId', 'status', 'query', 'cursor', 'limit'])
const GET_RECAP_KEYS = new Set(['recapId'])
const SAVE_RECAP_CREATE_KEYS = new Set([
  'eventId', 'title', 'summary', 'destination', 'sortOrder',
])
const SAVE_RECAP_UPDATE_KEYS = new Set([
  'recapId', 'expectedVersion', 'eventId', 'title', 'summary', 'destination', 'sortOrder',
])
const STATUS_RECAP_KEYS = new Set(['recapId', 'expectedVersion', 'status'])
const ARCHIVE_RECAP_KEYS = new Set(['recapId', 'expectedVersion', 'reason'])
const DESTINATION_KEYS = new Set(['provider', 'type', 'finderUserName', 'feedId'])
const CATALOG_CURSOR_FIELDS = ['kind', 'status', 'query', 'updatedAt', 'id']
const RECAP_CURSOR_FIELDS = ['event', 'status', 'query', 'updatedAt', 'id']
const PLATFORM_SCOPE = Object.freeze({ scopeType: 'PLATFORM', scopeId: null })

function createEventCatalogAdmin({ access, repository }) {
  async function listEventCatalogs(caller, rawInput = {}) {
    const { context } = await platformContext(caller, CAPABILITIES.EVENTS_CATALOG_MANAGE)
    const input = normalizeCatalogList(rawInput)
    return repository.listEventCatalogs(
      context.caller.appId,
      input.kind,
      input,
      input.limit,
    )
  }

  async function saveEventCatalog(caller, rawInput = {}) {
    const { context, grant } = await platformContext(caller, CAPABILITIES.EVENTS_CATALOG_MANAGE)
    const input = normalizeCatalogSave(rawInput)
    return repository.saveEventCatalog({
      ...input,
      appId: context.caller.appId,
      actorUserId: context.caller.userId,
      authorization: access.mutationAuthorization(grant, CAPABILITIES.EVENTS_CATALOG_MANAGE),
      audit: catalogId => access.audit(context, grant, {
        ...PLATFORM_SCOPE,
        action: input.catalogId ? 'admin.events.catalog.update' : 'admin.events.catalog.create',
        resourceType: input.kind === 'TYPE' ? 'EVENT_TYPE' : 'EVENT_TAG',
        resourceId: catalogId,
        metadata: {
          created: !input.catalogId,
          kind: input.kind,
          key: input.key || null,
          changedFields: ['name', 'description', 'sortOrder'],
        },
      }),
    })
  }

  async function changeEventCatalogStatus(caller, rawInput = {}) {
    const { context, grant } = await platformContext(caller, CAPABILITIES.EVENTS_CATALOG_MANAGE)
    const input = normalizeCatalogStatus(rawInput)
    return repository.changeEventCatalogStatus({
      ...input,
      appId: context.caller.appId,
      actorUserId: context.caller.userId,
      authorization: access.mutationAuthorization(grant, CAPABILITIES.EVENTS_CATALOG_MANAGE),
      audit: (catalogId, fromStatus) => access.audit(context, grant, {
        ...PLATFORM_SCOPE,
        action: 'admin.events.catalog.status.change',
        resourceType: input.kind === 'TYPE' ? 'EVENT_TYPE' : 'EVENT_TAG',
        resourceId: catalogId,
        metadata: { kind: input.kind, fromStatus, toStatus: input.status },
      }),
    })
  }

  async function archiveEventCatalog(caller, rawInput = {}) {
    const { context, grant } = await platformContext(caller, CAPABILITIES.EVENTS_CATALOG_MANAGE)
    const input = normalizeCatalogArchive(rawInput)
    return repository.archiveEventCatalog({
      ...input,
      appId: context.caller.appId,
      actorUserId: context.caller.userId,
      authorization: access.mutationAuthorization(grant, CAPABILITIES.EVENTS_CATALOG_MANAGE),
      audit: (catalogId, fromStatus) => access.audit(context, grant, {
        ...PLATFORM_SCOPE,
        action: 'admin.events.catalog.archive',
        resourceType: input.kind === 'TYPE' ? 'EVENT_TYPE' : 'EVENT_TAG',
        resourceId: catalogId,
        metadata: { kind: input.kind, fromStatus, reason: input.reason },
      }),
    })
  }

  async function listEventVideoRecaps(caller, rawInput = {}) {
    const { context } = await platformContext(caller, CAPABILITIES.EVENTS_RECAPS_MANAGE)
    const input = normalizeRecapList(rawInput)
    return repository.listEventVideoRecaps(context.caller.appId, input, input.limit)
  }

  async function getEventVideoRecap(caller, rawInput = {}) {
    const { context } = await platformContext(caller, CAPABILITIES.EVENTS_RECAPS_MANAGE)
    const input = normalizeRecapGet(rawInput)
    const recap = await repository.getEventVideoRecap(context.caller.appId, input.recapId)
    if (!recap) throw new AdminError('NOT_FOUND', '视频回顾不存在')
    return recap
  }

  async function saveEventVideoRecap(caller, rawInput = {}) {
    const { context, grant } = await platformContext(caller, CAPABILITIES.EVENTS_RECAPS_MANAGE)
    const input = normalizeRecapSave(rawInput)
    return repository.saveEventVideoRecap({
      ...input,
      appId: context.caller.appId,
      actorUserId: context.caller.userId,
      authorization: access.mutationAuthorization(grant, CAPABILITIES.EVENTS_RECAPS_MANAGE),
      audit: recapId => access.audit(context, grant, {
        ...PLATFORM_SCOPE,
        action: input.recapId ? 'admin.events.recap.update' : 'admin.events.recap.create',
        resourceType: 'EVENT_VIDEO_RECAP',
        resourceId: recapId,
        metadata: {
          created: !input.recapId,
          eventId: input.eventId,
          destinationProvider: input.destination.provider,
          destinationType: input.destination.type,
        },
      }),
    })
  }

  async function changeEventVideoRecapStatus(caller, rawInput = {}) {
    const { context, grant } = await platformContext(caller, CAPABILITIES.EVENTS_RECAPS_MANAGE)
    const input = normalizeRecapStatus(rawInput)
    return repository.changeEventVideoRecapStatus({
      ...input,
      appId: context.caller.appId,
      actorUserId: context.caller.userId,
      authorization: access.mutationAuthorization(grant, CAPABILITIES.EVENTS_RECAPS_MANAGE),
      audit: fromStatus => access.audit(context, grant, {
        ...PLATFORM_SCOPE,
        action: 'admin.events.recap.status.change',
        resourceType: 'EVENT_VIDEO_RECAP',
        resourceId: input.recapId,
        metadata: { fromStatus, toStatus: input.status },
      }),
    })
  }

  async function archiveEventVideoRecap(caller, rawInput = {}) {
    const { context, grant } = await platformContext(caller, CAPABILITIES.EVENTS_RECAPS_MANAGE)
    const input = normalizeRecapArchive(rawInput)
    return repository.archiveEventVideoRecap({
      ...input,
      appId: context.caller.appId,
      actorUserId: context.caller.userId,
      authorization: access.mutationAuthorization(grant, CAPABILITIES.EVENTS_RECAPS_MANAGE),
      audit: fromStatus => access.audit(context, grant, {
        ...PLATFORM_SCOPE,
        action: 'admin.events.recap.archive',
        resourceType: 'EVENT_VIDEO_RECAP',
        resourceId: input.recapId,
        metadata: { fromStatus, reason: input.reason },
      }),
    })
  }

  async function platformContext(caller, capability) {
    const context = await access.session(caller)
    const grant = firstGrant(context.bindings, capability)
    if (grant.scopeType !== 'PLATFORM') {
      throw new AdminError('FORBIDDEN', '当前账号没有平台运营权限')
    }
    return { context, grant }
  }

  return {
    archiveEventCatalog,
    archiveEventVideoRecap,
    changeEventCatalogStatus,
    changeEventVideoRecapStatus,
    getEventVideoRecap,
    listEventCatalogs,
    listEventVideoRecaps,
    saveEventCatalog,
    saveEventVideoRecap,
  }
}

function normalizeCatalogList(value) {
  exactObject(value, LIST_CATALOG_KEYS, ['kind'], '活动目录筛选无效')
  const kind = enumValue(value.kind, CATALOG_KINDS, '活动目录类型无效')
  const status = optionalStatus(value.status, CATALOG_STATUSES)
  const query = optionalText(value.query, 80, '搜索内容')
  const cursorContext = {
    kind,
    status: status || '-',
    query: query || '-',
  }
  return {
    kind,
    status,
    query,
    cursor: catalogCursor(value.cursor, cursorContext),
    cursorContext,
    limit: optionalLimit(value.limit),
  }
}

function normalizeCatalogSave(value) {
  const updating = isPlainObject(value) && Object.hasOwn(value, 'catalogId')
  exactObject(
    value,
    updating ? SAVE_CATALOG_UPDATE_KEYS : SAVE_CATALOG_CREATE_KEYS,
    [...(updating ? SAVE_CATALOG_UPDATE_KEYS : SAVE_CATALOG_CREATE_KEYS)],
    '活动目录内容无效',
  )
  return {
    kind: enumValue(value.kind, CATALOG_KINDS, '活动目录类型无效'),
    catalogId: updating ? requiredId(value.catalogId, '活动目录') : null,
    expectedVersion: updating ? expectedVersion(value.expectedVersion) : null,
    key: updating ? null : stableKey(value.key, '活动目录', 64),
    name: text(value.name, 80, { required: true, label: '目录名称' }),
    description: text(value.description, 300, { label: '目录说明' }),
    sortOrder: nonNegativeInteger(value.sortOrder, '目录排序'),
  }
}

function normalizeCatalogStatus(value) {
  exactObject(value, STATUS_CATALOG_KEYS, [...STATUS_CATALOG_KEYS], '活动目录状态变更无效')
  return {
    kind: enumValue(value.kind, CATALOG_KINDS, '活动目录类型无效'),
    catalogId: requiredId(value.catalogId, '活动目录'),
    expectedVersion: expectedVersion(value.expectedVersion),
    status: enumValue(value.status, MUTABLE_STATUSES, '活动目录状态无效'),
  }
}

function normalizeCatalogArchive(value) {
  exactObject(value, ARCHIVE_CATALOG_KEYS, [...ARCHIVE_CATALOG_KEYS], '活动目录归档请求无效')
  return {
    kind: enumValue(value.kind, CATALOG_KINDS, '活动目录类型无效'),
    catalogId: requiredId(value.catalogId, '活动目录'),
    expectedVersion: expectedVersion(value.expectedVersion),
    reason: text(value.reason, 300, { required: true, label: '归档原因' }),
  }
}

function normalizeRecapList(value) {
  exactObject(value, LIST_RECAP_KEYS, [], '视频回顾筛选无效')
  const eventId = Object.hasOwn(value, 'eventId') && value.eventId !== ''
    ? requiredId(value.eventId, '活动')
    : null
  const status = optionalStatus(value.status, CATALOG_STATUSES)
  const query = optionalText(value.query, 80, '搜索内容')
  const cursorContext = {
    event: eventId || '-',
    status: status || '-',
    query: query || '-',
  }
  return {
    eventId,
    status,
    query,
    cursor: recapCursor(value.cursor, cursorContext),
    cursorContext,
    limit: optionalLimit(value.limit),
  }
}

function normalizeRecapGet(value) {
  exactObject(value, GET_RECAP_KEYS, [...GET_RECAP_KEYS], '视频回顾查询无效')
  return { recapId: requiredId(value.recapId, '视频回顾') }
}

function normalizeRecapSave(value) {
  const updating = isPlainObject(value) && Object.hasOwn(value, 'recapId')
  const keys = updating ? SAVE_RECAP_UPDATE_KEYS : SAVE_RECAP_CREATE_KEYS
  exactObject(value, keys, [...keys], '视频回顾内容无效')
  return {
    recapId: updating ? requiredId(value.recapId, '视频回顾') : null,
    expectedVersion: updating ? expectedVersion(value.expectedVersion) : null,
    eventId: requiredId(value.eventId, '活动'),
    title: text(value.title, 120, { required: true, label: '视频回顾标题' }),
    summary: text(value.summary, 300, { label: '视频回顾说明' }),
    destination: normalizeDestination(value.destination),
    sortOrder: nonNegativeInteger(value.sortOrder, '视频回顾排序'),
  }
}

function normalizeRecapStatus(value) {
  exactObject(value, STATUS_RECAP_KEYS, [...STATUS_RECAP_KEYS], '视频回顾状态变更无效')
  return {
    recapId: requiredId(value.recapId, '视频回顾'),
    expectedVersion: expectedVersion(value.expectedVersion),
    status: enumValue(value.status, MUTABLE_STATUSES, '视频回顾状态无效'),
  }
}

function normalizeRecapArchive(value) {
  exactObject(value, ARCHIVE_RECAP_KEYS, [...ARCHIVE_RECAP_KEYS], '视频回顾归档请求无效')
  return {
    recapId: requiredId(value.recapId, '视频回顾'),
    expectedVersion: expectedVersion(value.expectedVersion),
    reason: text(value.reason, 300, { required: true, label: '归档原因' }),
  }
}

function normalizeDestination(value) {
  exactObject(value, DESTINATION_KEYS, [...DESTINATION_KEYS], '视频回顾目标无效')
  const provider = enumValue(value.provider, RECAP_PROVIDERS, '视频回顾平台无效')
  const type = enumValue(value.type, RECAP_DESTINATION_KINDS, '视频回顾目标类型无效')
  const finderUserName = channelsFinderUserName(value.finderUserName)
  const feedId = value.feedId === null ? null : stableToken(value.feedId, 256, '视频号内容')
  if ((type === 'PROFILE' && feedId !== null) || (type === 'ACTIVITY' && feedId === null)) {
    throw new AdminError('VALIDATION_FAILED', '视频回顾目标组合无效')
  }
  return { provider, type, finderUserName, feedId }
}

function channelsFinderUserName(value) {
  const normalized = typeof value === 'string' ? value.trim() : ''
  if (normalized.length > 128 || !/^sph[A-Za-z0-9]+$/.test(normalized)) {
    throw new AdminError('VALIDATION_FAILED', '视频号账号无效')
  }
  return normalized
}

function catalogCursor(value, context) {
  return boundCursor(value, CATALOG_CURSOR_FIELDS, context, '活动目录')
}

function recapCursor(value, context) {
  return boundCursor(value, RECAP_CURSOR_FIELDS, context, '视频回顾')
}

function boundCursor(value, fields, context, label) {
  const cursor = decodeCursor(value, fields)
  if (!cursor) return null
  const allowed = new Set(['v', ...fields])
  if (!hasExactKeys(cursor, allowed)
    || Object.entries(context).some(([key, expected]) => cursor[key] !== expected)) {
    throw new AdminError('VALIDATION_FAILED', `${label}分页游标与筛选条件不一致`)
  }
  return cursor
}

function optionalStatus(value, values) {
  if (value === undefined || value === '') return ''
  return enumValue(value, values, '状态无效')
}

function optionalText(value, maximum, label) {
  if (value === undefined || value === '') return ''
  return text(value, maximum, { label })
}

function optionalLimit(value) {
  return value === undefined ? 20 : limit(value, 50)
}

function enumValue(value, values, message) {
  if (typeof value !== 'string' || !values.has(value)) {
    throw new AdminError('VALIDATION_FAILED', message)
  }
  return value
}

function stableToken(value, maximum, label) {
  const normalized = typeof value === 'string' ? value.trim() : ''
  if (!normalized || normalized.length > maximum || !/^[A-Za-z0-9_=:+/.-]+$/.test(normalized)) {
    throw new AdminError('VALIDATION_FAILED', `${label}无效`)
  }
  return normalized
}

function nonNegativeInteger(value, label) {
  if (!Number.isInteger(value) || value < 0 || value > 1_000_000) {
    throw new AdminError('VALIDATION_FAILED', `${label}无效`)
  }
  return value
}

function exactObject(value, allowed, required, message) {
  if (!isPlainObject(value)
    || !required.every(key => Object.hasOwn(value, key))
    || !Reflect.ownKeys(value).every(key => typeof key === 'string' && allowed.has(key))) {
    throw new AdminError('VALIDATION_FAILED', message)
  }
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function hasExactKeys(value, allowed) {
  return isPlainObject(value)
    && Reflect.ownKeys(value).length === allowed.size
    && Reflect.ownKeys(value).every(key => typeof key === 'string' && allowed.has(key))
}

module.exports = {
  createEventCatalogAdmin,
  normalizeCatalogArchive,
  normalizeCatalogList,
  normalizeCatalogSave,
  normalizeCatalogStatus,
  normalizeRecapArchive,
  normalizeRecapGet,
  normalizeRecapList,
  normalizeRecapSave,
  normalizeRecapStatus,
}
