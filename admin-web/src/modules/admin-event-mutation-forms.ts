import type { AdminRequestInput } from '../domain/contracts.ts'

/** Actions that are currently exposed by the event operations service. */
export const EVENT_MUTATION_ACTIONS = [
  'mip.admin.events.save',
  'mip.admin.events.registrations.review',
  'mip.admin.events.checkIn',
  'mip.admin.events.undoCheckIn',
  'mip.admin.events.album.review',
  'mip.admin.events.policy.save',
  'mip.admin.events.tags.replace',
  'mip.admin.events.catalog.save',
  'mip.admin.events.catalog.changeStatus',
  'mip.admin.events.catalog.archive',
] as const

export type EventMutationAction = typeof EVENT_MUTATION_ACTIONS[number]
/** Naming aligned with the other web mutation form modules. */
export const ADMIN_EVENT_MUTATION_ACTIONS = EVENT_MUTATION_ACTIONS
export type AdminEventMutationAction = EventMutationAction

export type EventMutationFieldKind =
  | 'text'
  | 'textarea'
  | 'number'
  | 'select'
  | 'checkbox'
  | 'datetime'
  | 'asset'
  | 'asset-list'
  | 'tags'
  | 'json'

export interface EventMutationFieldOption {
  value: string
  label: string
}

export interface EventMutationFieldConfig {
  key: string
  /** Alias used by the shared form renderer. */
  name?: string
  label: string
  kind: EventMutationFieldKind
  required?: boolean
  hidden?: boolean
  maxLength?: number
  options?: readonly EventMutationFieldOption[]
}

export interface EventMutationActionConfig {
  action: EventMutationAction
  capability: string
  title: string
  description: string
  fields: readonly EventMutationFieldConfig[]
}

export interface AdminEventMutationDefinition<Action extends AdminEventMutationAction = AdminEventMutationAction>
  extends EventMutationActionConfig {
  action: Action
  targetId: string
  values: EventMutationValues
  expectedVersion?: number
  versionSource?: { sectionTitle: string, label: string, minimum: number }
}

const option = (value: string, label: string): EventMutationFieldOption => ({ value, label })

const eventSaveFields: readonly EventMutationFieldConfig[] = [
  { key: 'eventId', label: '活动标识', kind: 'text', hidden: true },
  { key: 'expectedVersion', label: '记录版本', kind: 'number', hidden: true },
  { key: 'scopeType', label: '活动范围', kind: 'select', options: [option('PLATFORM', '平台'), option('BRANCH', '服务器')] },
  { key: 'branchId', label: '服务器标识', kind: 'text' },
  { key: 'title', label: '活动名称', kind: 'text', required: true, maxLength: 120 },
  { key: 'summary', label: '活动摘要', kind: 'textarea', required: true, maxLength: 300 },
  { key: 'description', label: '活动介绍', kind: 'textarea', required: true, maxLength: 20_000 },
  { key: 'contentMedia', label: '活动介绍媒体', kind: 'asset-list' },
  { key: 'notices', label: '活动说明', kind: 'textarea', maxLength: 5_000 },
  { key: 'coverAssetId', label: '活动封面素材 ID', kind: 'asset' },
  { key: 'eventTypeKey', label: '活动类型标识', kind: 'text', maxLength: 64 },
  { key: 'eventMode', label: '活动方式', kind: 'select', options: [option('OFFLINE', '线下'), option('ONLINE', '线上'), option('HYBRID', '混合')] },
  { key: 'accessType', label: '收费类型', kind: 'select', options: [option('FREE', '免费'), option('MEMBER_INCLUDED', '会员权益'), option('PAID', '付费')] },
  { key: 'registrationPolicy', label: '报名方式', kind: 'select', options: [option('AUTO', '自动确认'), option('APPROVAL', '审核确认')] },
  { key: 'albumEnabled', label: '活动相册', kind: 'checkbox' },
  { key: 'albumSubmissionPolicy', label: '相册提交方式', kind: 'select', options: [option('AUTO', '自动发布'), option('REVIEW', '审核后发布')] },
  { key: 'startsAt', label: '开始时间', kind: 'datetime', required: true },
  { key: 'endsAt', label: '结束时间', kind: 'datetime', required: true },
  { key: 'registrationDeadline', label: '报名截止时间', kind: 'datetime' },
  { key: 'cancellationDeadline', label: '取消截止时间', kind: 'datetime' },
  { key: 'venueName', label: '活动地点', kind: 'text', maxLength: 160 },
  { key: 'address', label: '详细地址', kind: 'text', maxLength: 300 },
  { key: 'cityName', label: '城市', kind: 'text', maxLength: 80 },
  { key: 'latitude', label: '纬度', kind: 'number' },
  { key: 'longitude', label: '经度', kind: 'number' },
  { key: 'onlineUrl', label: '线上地址', kind: 'text', maxLength: 1_024 },
  { key: 'capacity', label: '活动名额', kind: 'number' },
  { key: 'waitlistEnabled', label: '候补报名', kind: 'checkbox' },
  { key: 'priceCents', label: '金额（分）', kind: 'number' },
  // The service accepts this opaque array. It is kept as a hidden value so an edit
  // does not accidentally erase registration fields that the web form does not edit.
  { key: 'registrationSchema', label: '报名字段配置', kind: 'json', hidden: true },
]

const EVENT_MUTATION_CONFIGS = {
  'mip.admin.events.save': {
    action: 'mip.admin.events.save',
    capability: 'events.write',
    title: '保存活动',
    description: '保存活动基本信息。封面和活动介绍图片可使用素材上传页返回的素材 ID；服务端会再次校验活动内容、时间和当前版本。',
    fields: eventSaveFields,
  },
  'mip.admin.events.registrations.review': {
    action: 'mip.admin.events.registrations.review',
    capability: 'events.registrations.manage',
    title: '审核报名',
    description: '提交报名审核结果。报名状态和活动资格由服务端确定。',
    fields: [
      { key: 'eventId', label: '活动标识', kind: 'text', required: true },
      { key: 'registrationId', label: '报名标识', kind: 'text', required: true },
      { key: 'expectedVersion', label: '记录版本', kind: 'number', required: true },
      { key: 'decision', label: '审核结果', kind: 'select', required: true, options: [option('APPROVE', '审核通过'), option('REJECT', '审核拒绝')] },
    ],
  },
  'mip.admin.events.checkIn': {
    action: 'mip.admin.events.checkIn',
    capability: 'events.checkin.manage',
    title: '确认签到',
    description: '确认当前报名记录签到。服务端会校验活动、报名记录和当前版本。',
    fields: [
      { key: 'eventId', label: '活动标识', kind: 'text', required: true },
      { key: 'registrationId', label: '报名标识', kind: 'text', required: true },
      { key: 'expectedVersion', label: '记录版本', kind: 'number', required: true },
    ],
  },
  'mip.admin.events.undoCheckIn': {
    action: 'mip.admin.events.undoCheckIn',
    capability: 'events.checkin.undo',
    title: '撤销签到',
    description: '撤销当前报名记录的签到状态，并记录撤销原因。',
    fields: [
      { key: 'eventId', label: '活动标识', kind: 'text', required: true },
      { key: 'registrationId', label: '报名标识', kind: 'text', required: true },
      { key: 'expectedVersion', label: '记录版本', kind: 'number', required: true },
      { key: 'reason', label: '撤销原因', kind: 'textarea', required: true, maxLength: 120 },
    ],
  },
  'mip.admin.events.album.review': {
    action: 'mip.admin.events.album.review',
    capability: 'events.album.manage',
    title: '审核活动相册照片',
    description: '提交照片审核结果。照片状态和版本由服务端确定。',
    fields: [
      { key: 'eventId', label: '活动标识', kind: 'text', required: true },
      { key: 'photoId', label: '照片标识', kind: 'text', required: true },
      { key: 'expectedVersion', label: '记录版本', kind: 'number', required: true },
      { key: 'decision', label: '审核结果', kind: 'select', required: true, options: [option('APPROVE', '审核通过'), option('REJECT', '审核拒绝')] },
      { key: 'reason', label: '审核原因', kind: 'textarea', required: true, maxLength: 300 },
    ],
  },
  'mip.admin.events.policy.save': {
    action: 'mip.admin.events.policy.save',
    capability: 'events.write',
    title: '保存活动政策',
    description: '保存默认取消时间。服务端会按当前政策版本执行并发校验。',
    fields: [
      { key: 'expectedVersion', label: '记录版本', kind: 'number', required: true },
      { key: 'cancellationHoursBeforeStart', label: '默认取消提前小时数', kind: 'number', required: true },
    ],
  },
  'mip.admin.events.tags.replace': {
    action: 'mip.admin.events.tags.replace',
    capability: 'events.catalog.manage',
    title: '更新活动标签',
    description: '替换活动标签集合。标签标识由目录服务端校验。',
    fields: [
      { key: 'eventId', label: '活动标识', kind: 'text', required: true },
      { key: 'expectedVersion', label: '记录版本', kind: 'number', required: true },
      { key: 'tagIds', label: '活动标签标识', kind: 'tags' },
    ],
  },
  'mip.admin.events.catalog.save': {
    action: 'mip.admin.events.catalog.save',
    capability: 'events.catalog.manage',
    title: '保存活动目录项',
    description: '保存活动类型或标签目录项。新建和编辑使用不同的服务端字段。',
    fields: [
      { key: 'catalogId', label: '目录项标识', kind: 'text' },
      { key: 'expectedVersion', label: '记录版本', kind: 'number' },
      { key: 'kind', label: '目录类型', kind: 'select', required: true, options: [option('TYPE', '活动类型'), option('TAG', '活动标签')] },
      { key: 'key', label: '目录标识', kind: 'text', maxLength: 64 },
      { key: 'name', label: '目录名称', kind: 'text', required: true },
      { key: 'description', label: '目录说明', kind: 'textarea', maxLength: 300 },
      { key: 'sortOrder', label: '目录排序', kind: 'number', required: true },
    ],
  },
  'mip.admin.events.catalog.changeStatus': {
    action: 'mip.admin.events.catalog.changeStatus',
    capability: 'events.catalog.manage',
    title: '变更活动目录状态',
    description: '变更活动类型或标签的启用状态。归档使用单独操作。',
    fields: [
      { key: 'kind', label: '目录类型', kind: 'select', required: true, options: [option('TYPE', '活动类型'), option('TAG', '活动标签')] },
      { key: 'catalogId', label: '目录项标识', kind: 'text', required: true },
      { key: 'expectedVersion', label: '记录版本', kind: 'number', required: true },
      { key: 'status', label: '目录状态', kind: 'select', required: true, options: [option('ACTIVE', '启用'), option('INACTIVE', '停用')] },
    ],
  },
  'mip.admin.events.catalog.archive': {
    action: 'mip.admin.events.catalog.archive',
    capability: 'events.catalog.manage',
    title: '归档活动目录项',
    description: '归档活动类型或标签，并记录归档原因。',
    fields: [
      { key: 'kind', label: '目录类型', kind: 'select', required: true, options: [option('TYPE', '活动类型'), option('TAG', '活动标签')] },
      { key: 'catalogId', label: '目录项标识', kind: 'text', required: true },
      { key: 'expectedVersion', label: '记录版本', kind: 'number', required: true },
      { key: 'reason', label: '归档原因', kind: 'textarea', required: true, maxLength: 300 },
    ],
  },
} as const satisfies Record<EventMutationAction, EventMutationActionConfig>

export { EVENT_MUTATION_CONFIGS }

export type EventMutationValues = Record<string, unknown>
export type EventMutationValidationError = { field: string, message: string }
export type EventMutationValidation =
  | { ok: true, input: AdminRequestInput }
  | { ok: false, errors: readonly EventMutationValidationError[] }

const identifierPattern = /^[A-Za-z0-9_-]+$/
const stableKeyPattern = /^[A-Za-z0-9_.:-]+$/
const assetIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const eventMutationActionSet = new Set<string>(EVENT_MUTATION_ACTIONS)

class FormValidationError extends Error {
  readonly field: string

  constructor(field: string, message: string) {
    super(message)
    this.field = field
  }
}

function own(value: EventMutationValues, key: string) {
  return Object.prototype.hasOwnProperty.call(value, key)
}

function text(value: unknown, field: string, maximum: number, required = false) {
  if (typeof value !== 'string') throw new FormValidationError(field, `${field}格式无效`)
  const normalized = value.trim()
  if ((required && !normalized) || normalized.length > maximum) {
    throw new FormValidationError(field, `${field}格式无效`)
  }
  return normalized
}

function optionalText(value: unknown, field: string, maximum: number) {
  if (value === undefined || value === null || value === '') return ''
  return text(value, field, maximum)
}

function id(value: unknown, field: string) {
  const normalized = text(value, field, 36, true)
  if (!identifierPattern.test(normalized)) throw new FormValidationError(field, `${field}标识无效`)
  return normalized
}

function version(value: unknown, field = '记录版本', allowZero = false) {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : Number.NaN
  if (!Number.isSafeInteger(parsed) || parsed < (allowZero ? 0 : 1)) {
    throw new FormValidationError(field, `${field}无效`)
  }
  return parsed
}

function integer(value: unknown, field: string, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : Number.NaN
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) throw new FormValidationError(field, `${field}无效`)
  return parsed
}

function finiteNumber(value: unknown, field: string, minimum: number, maximum: number) {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : Number.NaN
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) throw new FormValidationError(field, `${field}无效`)
  return parsed
}

function enumValue<T extends string>(value: unknown, field: string, allowed: readonly T[]) {
  if (typeof value !== 'string' || !allowed.includes(value as T)) throw new FormValidationError(field, `${field}无效`)
  return value as T
}

function optionalDate(value: unknown, field: string) {
  if (value === undefined || value === null || value === '') return null
  const normalized = text(value, field, 40)
  if (!Number.isFinite(new Date(normalized).getTime())) throw new FormValidationError(field, `${field}无效`)
  return normalized
}

function requiredDate(value: unknown, field: string) {
  const normalized = text(value, field, 40, true)
  if (!Number.isFinite(new Date(normalized).getTime())) throw new FormValidationError(field, `${field}无效`)
  return normalized
}

function asset(value: unknown, field: string) {
  const normalized = optionalText(value, field, 36)
  if (normalized && !assetIdPattern.test(normalized)) throw new FormValidationError(field, `${field}无效`)
  return normalized || null
}

function exactFields(values: EventMutationValues, allowed: readonly string[]) {
  const allowedSet = new Set(allowed)
  const unknown = Object.keys(values).filter(key => !allowedSet.has(key))
  if (unknown.length) throw new FormValidationError(unknown[0]!, '表单包含不支持的字段')
}

function eventMedia(value: unknown) {
  if (value === undefined || value === null || value === '') return []
  if (!Array.isArray(value) || value.length > 12) throw new FormValidationError('contentMedia', '活动介绍图片最多 12 张')
  const ids = new Set<string>()
  return value.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new FormValidationError(`contentMedia.${index}`, '活动介绍图片无效')
    }
    const source = item as Record<string, unknown>
    const keys = Object.keys(source)
    if (keys.some(key => key !== 'assetId' && key !== 'caption')) {
      throw new FormValidationError(`contentMedia.${index}`, '活动介绍图片无效')
    }
    const assetId = text(source.assetId, `contentMedia.${index}.assetId`, 36, true)
    if (!assetIdPattern.test(assetId) || ids.has(assetId)) {
      throw new FormValidationError(`contentMedia.${index}.assetId`, '活动介绍图片无效')
    }
    ids.add(assetId)
    return { assetId, caption: optionalText(source.caption, `contentMedia.${index}.caption`, 120) }
  })
}

function tagIds(value: unknown) {
  if (value === undefined || value === null || value === '') return []
  if (!Array.isArray(value) || value.length > 100) throw new FormValidationError('tagIds', '活动标签数量无效')
  const ids = value.map(item => id(item, '活动标签'))
  if (new Set(ids).size !== ids.length) throw new FormValidationError('tagIds', '活动标签不能重复')
  return [...ids].sort()
}

function eventDraft(values: EventMutationValues) {
  const startsAt = requiredDate(values.startsAt, '开始时间')
  const endsAt = requiredDate(values.endsAt, '结束时间')
  if (new Date(endsAt).getTime() <= new Date(startsAt).getTime()) throw new FormValidationError('endsAt', '结束时间必须晚于开始时间')
  const eventMode = enumValue(values.eventMode, '活动方式', ['OFFLINE', 'ONLINE', 'HYBRID'] as const)
  const accessType = enumValue(values.accessType, '收费类型', ['FREE', 'MEMBER_INCLUDED', 'PAID'] as const)
  const registrationPolicy = enumValue(values.registrationPolicy, '报名方式', ['AUTO', 'APPROVAL'] as const)
  const albumSubmissionPolicy = values.albumSubmissionPolicy === undefined || values.albumSubmissionPolicy === ''
    ? 'REVIEW'
    : enumValue(values.albumSubmissionPolicy, '相册提交方式', ['AUTO', 'REVIEW'] as const)
  const priceCents = integer(values.priceCents === undefined || values.priceCents === '' ? 0 : values.priceCents, '金额（分）')
  const waitlistEnabled = values.waitlistEnabled === true
    || values.waitlistEnabled === 'true'
    || values.waitlistEnabled === 'on'
  if (accessType === 'PAID' && (priceCents < 1 || registrationPolicy !== 'AUTO' || waitlistEnabled)) {
    throw new FormValidationError('accessType', '付费活动配置无效')
  }
  if (accessType !== 'PAID' && priceCents !== 0) throw new FormValidationError('priceCents', '免费活动金额必须为零')
  const scopeType = values.scopeType === undefined || values.scopeType === '' ? 'PLATFORM' : enumValue(values.scopeType, '活动范围', ['PLATFORM', 'BRANCH'] as const)
  const branchId = scopeType === 'BRANCH' ? id(values.branchId, '服务器') : null
  const venueName = optionalText(values.venueName, '活动地点', 160)
  const onlineUrl = optionalText(values.onlineUrl, '线上地址', 1_024)
  if ((eventMode === 'OFFLINE' || eventMode === 'HYBRID') && !venueName) throw new FormValidationError('venueName', '请填写活动地点')
  if ((eventMode === 'ONLINE' || eventMode === 'HYBRID') && !onlineUrl.startsWith('https://')) throw new FormValidationError('onlineUrl', '线上地址必须使用 HTTPS')
  const latitude = values.latitude === undefined || values.latitude === '' ? null : finiteNumber(values.latitude, '纬度', -90, 90)
  const longitude = values.longitude === undefined || values.longitude === '' ? null : finiteNumber(values.longitude, '经度', -180, 180)
  if ((latitude === null) !== (longitude === null)) throw new FormValidationError('latitude', '活动地点坐标不完整')
  const capacity = values.capacity === undefined || values.capacity === '' || values.capacity === null ? null : integer(values.capacity, '活动名额', 1)
  const registrationDeadline = optionalDate(values.registrationDeadline, '报名截止时间')
  const cancellationDeadline = optionalDate(values.cancellationDeadline, '取消截止时间')
  if (registrationDeadline && new Date(registrationDeadline).getTime() > new Date(startsAt).getTime()) throw new FormValidationError('registrationDeadline', '报名截止时间不能晚于活动开始时间')
  if (cancellationDeadline && new Date(cancellationDeadline).getTime() > new Date(startsAt).getTime()) throw new FormValidationError('cancellationDeadline', '取消截止时间不能晚于活动开始时间')
  const registrationSchema = values.registrationSchema === undefined || values.registrationSchema === '' ? [] : values.registrationSchema
  if (!Array.isArray(registrationSchema)) throw new FormValidationError('registrationSchema', '报名字段配置无效')
  return {
    scopeType,
    branchId,
    title: text(values.title, '活动名称', 120, true),
    summary: text(values.summary, '活动摘要', 300, true),
    description: text(values.description, '活动介绍', 20_000, true),
    contentMedia: eventMedia(values.contentMedia),
    notices: optionalText(values.notices, '活动说明', 5_000),
    coverAssetId: asset(values.coverAssetId, '活动封面素材 ID'),
    eventTypeKey: values.eventTypeKey === undefined || values.eventTypeKey === '' ? 'general' : (() => {
      const key = text(values.eventTypeKey, '活动类型标识', 64)
      if (!stableKeyPattern.test(key)) throw new FormValidationError('eventTypeKey', '活动类型标识无效')
      return key
    })(),
    eventMode,
    accessType,
    registrationPolicy,
    albumEnabled: values.albumEnabled !== false && values.albumEnabled !== 'false',
    albumSubmissionPolicy,
    startsAt,
    endsAt,
    registrationDeadline,
    cancellationDeadline,
    venueName,
    address: optionalText(values.address, '详细地址', 300),
    cityName: optionalText(values.cityName, '城市', 80),
    latitude,
    longitude,
    onlineUrl: eventMode === 'OFFLINE' ? null : onlineUrl,
    capacity,
    waitlistEnabled,
    priceCents,
    registrationSchema: [...registrationSchema],
  }
}

function build(action: EventMutationAction, values: EventMutationValues): AdminRequestInput {
  const fields = EVENT_MUTATION_CONFIGS[action].fields.map(field => field.key)
  exactFields(values, fields)
  if (action === 'mip.admin.events.save') {
    const draft = eventDraft(values)
    const eventId = values.eventId === undefined || values.eventId === '' ? '' : id(values.eventId, '活动')
    const expectedVersionValue = values.expectedVersion === undefined || values.expectedVersion === '' ? null : version(values.expectedVersion)
    if (eventId && expectedVersionValue === null) throw new FormValidationError('expectedVersion', '编辑活动必须提供记录版本')
    if (!eventId && expectedVersionValue !== null) throw new FormValidationError('eventId', '新建活动不能提供记录版本')
    return eventId ? { eventId, expectedVersion: expectedVersionValue, draft } : { draft }
  }
  if (action === 'mip.admin.events.registrations.review') return {
    eventId: id(values.eventId, '活动'), registrationId: id(values.registrationId, '报名'),
    expectedVersion: version(values.expectedVersion), decision: enumValue(values.decision, '审核结果', ['APPROVE', 'REJECT'] as const),
  }
  if (action === 'mip.admin.events.checkIn') return {
    eventId: id(values.eventId, '活动'), registrationId: id(values.registrationId, '报名'), expectedVersion: version(values.expectedVersion),
  }
  if (action === 'mip.admin.events.undoCheckIn') return {
    eventId: id(values.eventId, '活动'), registrationId: id(values.registrationId, '报名'), expectedVersion: version(values.expectedVersion), reason: text(values.reason, '撤销原因', 120, true),
  }
  if (action === 'mip.admin.events.album.review') return {
    eventId: id(values.eventId, '活动'), photoId: id(values.photoId, '照片'), expectedVersion: version(values.expectedVersion),
    decision: enumValue(values.decision, '审核结果', ['APPROVE', 'REJECT'] as const), reason: text(values.reason, '审核原因', 300, true),
  }
  if (action === 'mip.admin.events.policy.save') return {
    expectedVersion: version(values.expectedVersion, '记录版本', true), cancellationHoursBeforeStart: integer(values.cancellationHoursBeforeStart, '默认取消提前小时数', 0, 720),
  }
  if (action === 'mip.admin.events.tags.replace') return {
    eventId: id(values.eventId, '活动'), expectedVersion: version(values.expectedVersion), tagIds: tagIds(values.tagIds),
  }
  if (action === 'mip.admin.events.catalog.save') {
    const kind = enumValue(values.kind, '目录类型', ['TYPE', 'TAG'] as const)
    const catalogId = values.catalogId === undefined || values.catalogId === '' ? '' : id(values.catalogId, '目录项')
    const expectedVersionValue = values.expectedVersion === undefined || values.expectedVersion === '' ? null : version(values.expectedVersion)
    const name = text(values.name, '目录名称', kind === 'TAG' ? 5 : 80, true)
    const description = optionalText(values.description, '目录说明', 300)
    const sortOrder = integer(values.sortOrder, '目录排序')
    if (catalogId) {
      if (expectedVersionValue === null || own(values, 'key')) throw new FormValidationError('expectedVersion', '编辑目录项字段无效')
      return { kind, catalogId, expectedVersion: expectedVersionValue, name, description, sortOrder }
    }
    if (expectedVersionValue !== null) throw new FormValidationError('catalogId', '新建目录项不能提供记录版本')
    const key = text(values.key, '目录标识', 64, true)
    if (!stableKeyPattern.test(key)) throw new FormValidationError('key', '目录标识无效')
    return { kind, key, name, description, sortOrder }
  }
  if (action === 'mip.admin.events.catalog.changeStatus') return {
    kind: enumValue(values.kind, '目录类型', ['TYPE', 'TAG'] as const), catalogId: id(values.catalogId, '目录项'), expectedVersion: version(values.expectedVersion),
    status: enumValue(values.status, '目录状态', ['ACTIVE', 'INACTIVE'] as const),
  }
  return {
    kind: enumValue(values.kind, '目录类型', ['TYPE', 'TAG'] as const), catalogId: id(values.catalogId, '目录项'), expectedVersion: version(values.expectedVersion),
    reason: text(values.reason, '归档原因', 300, true),
  }
}

export function validateEventMutationInput(action: EventMutationAction, values: EventMutationValues): EventMutationValidation {
  if (!eventMutationActionSet.has(action)) return { ok: false, errors: [{ field: 'action', message: '活动操作无效' }] }
  try {
    return { ok: true, input: build(action, values) }
  }
  catch (error) {
    if (error instanceof FormValidationError) return { ok: false, errors: [{ field: error.field, message: error.message }] }
    return { ok: false, errors: [{ field: 'form', message: '表单内容无效' }] }
  }
}

/** Returns a transport-ready business input, or null for a form validation failure. */
export function buildEventMutationInput(action: EventMutationAction, values: EventMutationValues): AdminRequestInput | null {
  const result = validateEventMutationInput(action, values)
  return result.ok ? result.input : null
}

export function eventMutationConfig(action: EventMutationAction): EventMutationActionConfig {
  return EVENT_MUTATION_CONFIGS[action]
}

function readVersion(
  action: EventMutationAction,
  targetId: string,
  readDetailField: (sectionTitle: string, label: string) => string,
) {
  if (action !== 'mip.admin.events.policy.save' && (!targetId || action !== 'mip.admin.events.save')) return undefined
  const candidates = action === 'mip.admin.events.policy.save'
    ? [['活动政策', '版本'], ['活动政策', '政策版本']]
    : [['活动信息', '版本'], ['活动信息', '活动版本']]
  for (const [sectionTitle, label] of candidates) {
    const value = Number(readDetailField(sectionTitle, label))
    const minimum = action === 'mip.admin.events.policy.save' ? 0 : 1
    if (Number.isSafeInteger(value) && value >= minimum) return {
      value,
      field: { sectionTitle, label, minimum },
    }
  }
  return undefined
}

function defaultValues(action: EventMutationAction): EventMutationValues {
  const values: EventMutationValues = {}
  for (const field of EVENT_MUTATION_CONFIGS[action].fields) {
    values[field.key] = field.kind === 'checkbox'
      ? field.key === 'albumEnabled'
      : field.kind === 'asset-list' || field.kind === 'tags' || field.kind === 'json'
        ? []
        : ''
  }
  if (action === 'mip.admin.events.save') {
    Object.assign(values, {
      scopeType: 'PLATFORM', eventTypeKey: 'general', eventMode: 'OFFLINE', accessType: 'FREE',
      registrationPolicy: 'AUTO', albumSubmissionPolicy: 'REVIEW', albumEnabled: true,
      waitlistEnabled: false, priceCents: '0',
    })
  }
  return values
}

/** Definition adapter for the common web form renderer. */
export function createAdminEventMutationDefinition<Action extends AdminEventMutationAction>(
  action: Action,
  targetId: string,
  readDetailField: (sectionTitle: string, label: string) => string = () => '',
): AdminEventMutationDefinition<Action> {
  const config = EVENT_MUTATION_CONFIGS[action]
  const source = readVersion(action, idOrEmpty(targetId), readDetailField)
  return {
    ...config,
    action,
    fields: config.fields.map(field => ({ ...field, name: field.key })),
    targetId: idOrEmpty(targetId),
    values: defaultValues(action),
    ...(source ? { expectedVersion: source.value, versionSource: source.field } : {}),
  }
}

function idOrEmpty(value: unknown) {
  if (typeof value !== 'string') return ''
  const normalized = value.trim()
  return normalized && normalized.length <= 36 && identifierPattern.test(normalized) ? normalized : ''
}

/**
 * Builds an event operation input from a definition. Target ids and versions
 * come from the definition; submitted values are limited to configured fields.
 */
export function buildAdminEventMutationInput(
  definition: AdminEventMutationDefinition,
  submittedValues: EventMutationValues,
): AdminRequestInput | null {
  if (!definition || !eventMutationActionSet.has(definition.action)) return null
  const values = { ...definition.values }
  const configured = new Set(definition.fields.map(field => field.key))
  if (submittedValues && typeof submittedValues === 'object' && !Array.isArray(submittedValues)) {
    for (const [key, value] of Object.entries(submittedValues)) {
      if (configured.has(key)) values[key] = value
    }
  }
  if (definition.targetId) {
    if (definition.action === 'mip.admin.events.catalog.save'
      || definition.action === 'mip.admin.events.catalog.changeStatus'
      || definition.action === 'mip.admin.events.catalog.archive') values.catalogId = definition.targetId
    else if (definition.action !== 'mip.admin.events.policy.save') values.eventId = definition.targetId
  }
  if (definition.action === 'mip.admin.events.catalog.save' && definition.targetId) delete values.key
  if (definition.expectedVersion !== undefined) values.expectedVersion = definition.expectedVersion
  // A definition may intentionally omit an id for platform-wide policy writes.
  return buildEventMutationInput(definition.action, values)
}
