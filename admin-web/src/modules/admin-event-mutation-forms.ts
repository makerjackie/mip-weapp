import type { AdminRequestInput } from '../domain/contracts.ts'

/** Actions that are currently exposed by the event operations service. */
export const EVENT_MUTATION_ACTIONS = [
  'mip.admin.events.save',
  'mip.admin.events.registrations.review',
  'mip.admin.events.checkIn',
  'mip.admin.events.undoCheckIn',
  'mip.admin.events.policy.save',
  'mip.admin.events.tags.replace',
  'mip.admin.events.catalog.save',
  'mip.admin.events.catalog.changeStatus',
  'mip.admin.events.catalog.archive',
  'mip.admin.events.participants.import',
  'mip.admin.events.participants.cancel',
  'mip.admin.events.participants.markAbnormal',
] as const

export type EventMutationAction = typeof EVENT_MUTATION_ACTIONS[number]
/** Naming aligned with the other web mutation form modules. */
export const ADMIN_EVENT_MUTATION_ACTIONS = EVENT_MUTATION_ACTIONS
export type AdminEventMutationAction = EventMutationAction

export type EventMutationFieldKind =
  | 'text'
  | 'textarea'
  | 'rich-text'
  | 'number'
  | 'select'
  | 'multi-select'
  | 'checkbox'
  | 'datetime'
  | 'asset'
  | 'asset-list'
  | 'tags'
  | 'json'
  | 'registration-schema'
  | 'money'

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
  wide?: boolean
  maxLength?: number
  options?: readonly EventMutationFieldOption[]
  /** Upload purpose for asset/asset-list fields. */
  assetPurpose?: string
  /** Renders a session-backed searchable user picker. */
  remoteUserSearch?: boolean
  /** Renders a session-backed catalog select loaded from this query action. */
  optionsAction?: string
  optionsInput?: Record<string, unknown>
  optionsValueKey?: string
  optionsKey?: string
  /** Shows the control only when another field has the given value. */
  visibleWhen?: { path: string, value: string | boolean | readonly (string | boolean)[] }
  /** Marks the field required only when another field holds one of the given values. */
  requiredWhen?: { path: string, values: readonly string[] }
  /** Input placeholder shown inside the control. */
  placeholder?: string
  /** Helper text under the control explaining the value's origin. */
  extra?: string
  /** Optional external helper link rendered next to `extra` (opens in a new tab). */
  helpLink?: { href: string, label: string }
  /** Empty-catalog hint telling operators where options come from. */
  emptyHint?: string
  /** Tucks the field into the collapsed「高级设置」section. */
  advanced?: boolean
  /** Money unit scale: 100 = cents, 1_000_000 = 万元. */
  valueScale?: number
  /** Catalog control style: dropdown (default) or selectable pill group. */
  variant?: 'select' | 'pills'
  /** Pills only: show「＋ 新建」to create a catalog entry inline via `mip.admin.events.catalog.save`. */
  allowCreate?: boolean
  /** Catalog kind created inline (e.g. TAG/TYPE). */
  createKind?: string
  /** Max characters for the inline-created catalog name. */
  createMaxLength?: number
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

// 字段顺序按原型的主流程排布：名称 → 封面 → 标签 → 费用 → 场地/时间 → 图文；
// 内部模型字段（范围/服务器/活动类型/报名方式/满员策略/坐标）与选填项收进「高级设置」。
const eventSaveFields: readonly EventMutationFieldConfig[] = [
  { key: 'cloneSourceEventId', label: '复制来源', kind: 'text', hidden: true },
  { key: 'eventId', label: '活动标识', kind: 'text', hidden: true },
  { key: 'expectedVersion', label: '记录版本', kind: 'number', hidden: true },
  // 原型/PRD 要求活动名称最多 20 字；历史超长标题不截断，编辑时原值可见可存、只是不能继续加长。
  { key: 'title', label: '活动名称', kind: 'text', required: true, maxLength: 20, wide: true, placeholder: '最多 20 字，如：周末城市漫步·第 3 期' },
  // 活动范围/分会归属是真实业务归属，放主流程；默认值按当前账号授权范围注入（见 event-edit-form-page）。
  { key: 'scopeType', label: '活动范围', kind: 'select', options: [option('PLATFORM', '平台（所有分会）'), option('BRANCH', '指定分会')] },
  { key: 'branchId', label: '所属分会', kind: 'text', visibleWhen: { path: 'scopeType', value: 'BRANCH' }, requiredWhen: { path: 'scopeType', values: ['BRANCH'] }, optionsAction: 'mip.admin.branches.list', optionsInput: { purpose: 'EVENT_EDIT' }, emptyHint: '暂无可选分会。分会在「权限」页的「新建服务器」中创建' },
  { key: 'coverAssetId', label: '封面', kind: 'asset', assetPurpose: 'EVENT_COVER', wide: true, placeholder: '点击或拖拽上传活动封面' },
  { key: 'tagIds', label: '活动标签（可多选）', kind: 'multi-select', variant: 'pills', allowCreate: true, createKind: 'TAG', createMaxLength: 5, optionsAction: 'mip.admin.events.catalog.list', optionsInput: { kind: 'TAG', selectable: true }, emptyHint: '暂无可选标签。可点「＋ 新建标签」创建' },
  { key: 'accessType', label: '费用类型', kind: 'select', options: [option('FREE', '免费'), option('MEMBER_INCLUDED', '会员权益'), option('PAID', '付费')] },
  { key: 'memberFree', label: '玩家免费', kind: 'checkbox', visibleWhen: { path: 'accessType', value: 'PAID' }, extra: '开启后，有效玩家免费报名，嘉宾按活动金额付费；已有订单金额不变。' },
  { key: 'priceCents', label: '金额（元）', kind: 'money', valueScale: 100, required: true, visibleWhen: { path: 'accessType', value: 'PAID' }, placeholder: '如 199.00' },
  { key: 'eventMode', label: '活动方式', kind: 'select', options: [option('OFFLINE', '线下'), option('ONLINE', '线上'), option('HYBRID', '混合')] },
  { key: 'venueName', label: '场地地址文案', kind: 'text', maxLength: 160, requiredWhen: { path: 'eventMode', values: ['OFFLINE', 'HYBRID'] }, placeholder: '如：上海·徐汇 XX 空间' },
  { key: 'address', label: '详细地址', kind: 'text', maxLength: 300, placeholder: '街道门牌号，方便成员找路' },
  { key: 'cityName', label: '城市', kind: 'text', maxLength: 80, placeholder: '如：上海' },
  { key: 'guideUrl', label: '场地跳转链接（选填）', kind: 'text', maxLength: 1_024, placeholder: 'https:// 开头，成员点击可查看场地/路线说明' },
  { key: 'startsAt', label: '开始时间', kind: 'datetime', required: true },
  { key: 'endsAt', label: '结束时间', kind: 'datetime', required: true },
  { key: 'onlineUrl', label: '线上地址', kind: 'text', maxLength: 1_024, visibleWhen: { path: 'eventMode', value: ['ONLINE', 'HYBRID'] }, placeholder: 'https:// 开头的直播/会议链接' },
  { key: 'description', label: '活动介绍', kind: 'rich-text', required: true, maxLength: 20_000, wide: true, placeholder: '介绍活动亮点、流程与注意事项；可加粗、斜体、下划线，支持列表、对齐与插图' },
  { key: 'contentMedia', label: '活动介绍图库（可选）', kind: 'asset-list', assetPurpose: 'EVENT_CONTENT', wide: true, advanced: true, extra: '可选：追加的正文图片。活动介绍里的插图直接在编辑器中「插入图片」或粘贴/拖入即可。' },
  { key: 'organizerIntroduction', label: '主办方介绍', kind: 'rich-text', maxLength: 20_000, wide: true, placeholder: '介绍主办方或主理人背景；可加粗、斜体、下划线，支持列表、对齐与插图' },
  { key: 'notices', label: '报名须知', kind: 'rich-text', maxLength: 5_000, wide: true, placeholder: '报名须知、注意事项等；可加粗、斜体、下划线，支持列表、对齐与插图' },
  // —— 高级设置（选填 / 内部模型字段） ——
  // 摘要不是业务必填；列表 DTO 需要非空，故留空自动从活动介绍截取（编辑时保留原值），不对运营展示。
  { key: 'summary', label: '活动摘要', kind: 'textarea', required: false, maxLength: 300, hidden: true },
  { key: 'eventTypeKey', label: '活动类型', kind: 'text', maxLength: 64, advanced: true, optionsAction: 'mip.admin.events.catalog.list', optionsInput: { kind: 'TYPE', selectable: true }, optionsValueKey: 'key', emptyHint: '暂无可选活动类型。可在「活动」页底部的「活动规则与类型设置」中添加类型；不选择时默认为「活动」' },
  { key: 'registrationPolicy', label: '报名方式', kind: 'select', advanced: true, options: [option('AUTO', '自动确认'), option('APPROVAL', '审核确认')] },
  { key: 'registrationDeadline', label: '报名截止时间', kind: 'datetime', advanced: true, extra: '选填。不填则报名持续到活动开始' },
  { key: 'cancellationDeadline', label: '取消截止时间', kind: 'datetime', advanced: true, extra: '选填。在此时间前成员可自主取消报名' },
  { key: 'capacity', label: '活动名额', kind: 'number', advanced: true, placeholder: '留空表示不限名额' },
  { key: 'waitlistEnabled', label: '满员进入候补', kind: 'checkbox', advanced: true, extra: '名额报满后，新报名自动进入候补名单（不勾选则名额报满后拒绝报名）' },
  { key: 'oversellEnabled', label: '允许超售', kind: 'checkbox', advanced: true, visibleWhen: { path: 'waitlistEnabled', value: false }, extra: '名额报满后仍继续接受报名（忽略名额上限）；付费活动不支持' },
  // 坐标/地图导航暂不对外开放（原型没有该字段，客户有需求再启用）。字段保持 hidden：
  // 编辑已有活动时保留服务端已存坐标、不被清空；新建活动不写坐标，小程序详情页不显示导航。
  { key: 'locationCoords', label: '地图坐标', kind: 'text', maxLength: 64, hidden: true },
  // 报名字段编辑入口已按产品决策下线：字段保持 hidden，编辑已有活动时
  // definition.values 携带服务端已存的配置原样提交，不会被清空；新建活动为空数组
  // （报名页退回基础字段）。小程序报名页仍消费这份配置。
  { key: 'registrationSchema', label: '报名字段', kind: 'registration-schema', wide: true, hidden: true },
]

const EVENT_MUTATION_CONFIGS = {
  'mip.admin.events.save': {
    action: 'mip.admin.events.save',
    capability: 'events.write',
    title: '保存活动',
    description: '编辑活动信息、报名规则与介绍图片。价格调整只影响新订单；已发布活动更改归属、活动方式、收费类型或报名方式前，请先下架。',
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
      { key: 'eventId', label: '活动标识', kind: 'text', required: true, hidden: true },
      { key: 'expectedVersion', label: '记录版本', kind: 'number', required: true, hidden: true },
      { key: 'tagIds', label: '活动标签', kind: 'multi-select', optionsAction: 'mip.admin.events.catalog.list', optionsInput: { kind: 'TAG', selectable: true }, emptyHint: '暂无可选标签。可在「活动设置」页添加标签' },
    ],
  },
  'mip.admin.events.catalog.save': {
    action: 'mip.admin.events.catalog.save',
    capability: 'events.catalog.manage',
    title: '保存活动目录项',
    description: '保存活动类型或标签目录项。新建和编辑使用不同的服务端字段。',
    fields: [
      { key: 'catalogId', label: '目录项标识', kind: 'text', hidden: true },
      { key: 'expectedVersion', label: '记录版本', kind: 'number', hidden: true },
      { key: 'kind', label: '目录类型', kind: 'select', required: true, options: [option('TYPE', '活动类型'), option('TAG', '活动标签')] },
      { key: 'key', label: '目录标识', kind: 'text', maxLength: 64, hidden: true },
      { key: 'name', label: '目录名称', kind: 'text', required: true, extra: '标签类名称不能超过 5 个字，类型类不能超过 80 个字' },
      { key: 'description', label: '目录说明', kind: 'textarea', maxLength: 300 },
      { key: 'sortOrder', label: '目录排序', kind: 'number', required: true, extra: '数字越小越靠前' },
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
  'mip.admin.events.participants.import': {
    action: 'mip.admin.events.participants.import',
    capability: 'events.registrations.manage',
    title: '补录报名',
    description: '为活动补录参与者，不触发支付流程。',
    fields: [
      { key: 'eventId', label: '活动标识', kind: 'text', hidden: true },
      { key: 'userId', label: '用户', kind: 'text', required: true, remoteUserSearch: true },
      { key: 'roleMark', label: '角色标记', kind: 'select', options: [option('MEMBER', '成员'), option('GUEST', '嘉宾'), option('PLAYER', '玩家')] },
      { key: 'reason', label: '补录原因', kind: 'textarea', maxLength: 120 },
    ],
  },
  'mip.admin.events.participants.cancel': {
    action: 'mip.admin.events.participants.cancel',
    capability: 'events.registrations.manage',
    title: '取消报名',
    description: '取消指定参与者的报名记录。',
    fields: [
      { key: 'eventId', label: '活动标识', kind: 'text', hidden: true },
      { key: 'registrationId', label: '报名记录 ID', kind: 'text', hidden: true },
      { key: 'expectedVersion', label: '记录版本', kind: 'number', hidden: true },
      { key: 'reason', label: '取消原因', kind: 'textarea', required: true, maxLength: 120 },
    ],
  },
  'mip.admin.events.participants.markAbnormal': {
    action: 'mip.admin.events.participants.markAbnormal',
    capability: 'events.registrations.manage',
    title: '标记异常',
    description: '将指定参与者标记为异常状态。',
    fields: [
      { key: 'eventId', label: '活动标识', kind: 'text', hidden: true },
      { key: 'registrationId', label: '报名记录 ID', kind: 'text', hidden: true },
      { key: 'expectedVersion', label: '记录版本', kind: 'number', hidden: true },
      { key: 'reason', label: '异常原因', kind: 'textarea', required: true, maxLength: 120 },
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

function registrationSchema(value: unknown) {
  if (!Array.isArray(value) || value.length > 12) throw new FormValidationError('registrationSchema', '最多添加 12 个报名字段')
  const keys = new Set<string>()
  const result = value.map((item, index) => {
    const errorKey = `registrationSchema.${index}`
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new FormValidationError(errorKey, '报名字段配置无效')
    const field = item as Record<string, unknown>
    const key = text(field.key, errorKey, 48, true)
    const label = text(field.label, errorKey, 60, true)
    if (!/^[a-z][a-z0-9_]{0,47}$/.test(key) || keys.has(key)) throw new FormValidationError(errorKey, '报名字段标识无效或重复')
    if (/[\r\n]/.test(label)) throw new FormValidationError(errorKey, '报名字段名称不能换行')
    keys.add(key)
    const type = enumValue(field.type, errorKey, ['TEXT', 'TEXTAREA', 'SELECT', 'BOOLEAN'] as const)
    if (field.required !== undefined && typeof field.required !== 'boolean') throw new FormValidationError(errorKey, '报名字段必填设置无效')
    const normalized: Record<string, unknown> = { key, label, type, required: field.required === true }
    if (type === 'TEXT' || type === 'TEXTAREA') {
      normalized.maxLength = integer(field.maxLength ?? (type === 'TEXT' ? 120 : 500), errorKey, 1, type === 'TEXT' ? 200 : 1000)
    }
    if (type === 'SELECT') {
      if (!Array.isArray(field.options) || !field.options.length || field.options.length > 20) throw new FormValidationError(errorKey, '单选字段需要 1–20 个选项')
      const options = field.options.map(option => text(option, errorKey, 60, true))
      if (options.some(option => /[\r\n]/.test(option)) || new Set(options).size !== options.length) throw new FormValidationError(errorKey, '报名选项不能换行或重复')
      normalized.options = options
    }
    return normalized
  })
  if (new TextEncoder().encode(JSON.stringify(result)).length > 16 * 1024) throw new FormValidationError('registrationSchema', '报名字段内容过多')
  return result
}

/** 解析「纬度,经度」整体输入；留空表示不设坐标（不静默改写成 0）。 */
function parseLocationCoords(value: unknown): { latitude: number | null, longitude: number | null } {
  const raw = String(value ?? '').trim()
  if (!raw) return { latitude: null, longitude: null }
  const parts = raw.split(/[,，;；\s]+/).map(part => part.trim()).filter(Boolean)
  if (parts.length !== 2) throw new FormValidationError('locationCoords', '坐标格式应为「纬度,经度」，例如 31.230416,121.473701')
  const latitude = finiteNumber(parts[0], '纬度', -90, 90)
  const longitude = finiteNumber(parts[1], '经度', -180, 180)
  return { latitude, longitude }
}

function eventDraft(values: EventMutationValues) {
  const startsAt = requiredDate(values.startsAt, '开始时间')
  const endsAt = requiredDate(values.endsAt, '结束时间')
  if (new Date(endsAt).getTime() <= new Date(startsAt).getTime()) throw new FormValidationError('endsAt', '结束时间必须晚于开始时间')
  const eventMode = enumValue(values.eventMode, '活动方式', ['OFFLINE', 'ONLINE', 'HYBRID'] as const)
  const accessType = enumValue(values.accessType, '收费类型', ['FREE', 'MEMBER_INCLUDED', 'PAID'] as const)
  const registrationPolicy = enumValue(values.registrationPolicy, '报名方式', ['AUTO', 'APPROVAL'] as const)
  // A stale price from a previously paid draft must not block a free save: the
  // control is hidden once accessType leaves PAID, so the operator cannot clear it.
  const priceCents = accessType === 'PAID'
    ? integer(values.priceCents === undefined || values.priceCents === '' || values.priceCents === null ? 0 : values.priceCents, '金额')
    : 0
  const waitlistEnabled = values.waitlistEnabled === true
    || values.waitlistEnabled === 'true'
    || values.waitlistEnabled === 'on'
  const oversellEnabled = values.oversellEnabled === true
    || values.oversellEnabled === 'true'
    || values.oversellEnabled === 'on'
  if (waitlistEnabled && oversellEnabled) throw new FormValidationError('oversellEnabled', '候补与允许超售不能同时开启，请只选择一种')
  if (accessType === 'PAID') {
    if (priceCents < 1) throw new FormValidationError('priceCents', '付费活动必须填写大于 0 的金额（元）')
    if (registrationPolicy !== 'AUTO') throw new FormValidationError('registrationPolicy', '付费活动仅支持「自动确认」报名方式，请先调整报名方式')
    if (waitlistEnabled) throw new FormValidationError('waitlistEnabled', '付费活动不支持候补报名，请关闭候补报名')
    if (oversellEnabled) throw new FormValidationError('oversellEnabled', '付费活动不支持允许超售，请关闭允许超售')
  }
  const scopeType = values.scopeType === undefined || values.scopeType === '' ? 'PLATFORM' : enumValue(values.scopeType, '活动范围', ['PLATFORM', 'BRANCH'] as const)
  const branchId = scopeType === 'BRANCH' ? (() => {
    const candidate = String(values.branchId ?? '').trim()
    if (!candidate) throw new FormValidationError('branchId', '请选择服务器')
    if (!identifierPattern.test(candidate)) throw new FormValidationError('branchId', '服务器无效，请重新选择')
    return candidate
  })() : null
  const venueName = optionalText(values.venueName, '活动地点', 160)
  const onlineUrl = optionalText(values.onlineUrl, '线上地址', 1_024)
  if ((eventMode === 'OFFLINE' || eventMode === 'HYBRID') && !venueName) throw new FormValidationError('venueName', '请填写活动地点')
  if ((eventMode === 'ONLINE' || eventMode === 'HYBRID') && !onlineUrl.startsWith('https://')) throw new FormValidationError('onlineUrl', '线上地址必须使用 HTTPS')
  const guideUrl = optionalText(values.guideUrl, '路线指引链接', 1_024)
  if (guideUrl && !/^https:\/\/\S+$/.test(guideUrl)) throw new FormValidationError('guideUrl', '路线指引链接必须是以 https:// 开头的完整链接')
  const { latitude, longitude } = parseLocationCoords(values.locationCoords)
  const capacity = values.capacity === undefined || values.capacity === '' || values.capacity === null ? null : integer(values.capacity, '活动名额', 1)
  const registrationDeadline = optionalDate(values.registrationDeadline, '报名截止时间')
  const cancellationDeadline = optionalDate(values.cancellationDeadline, '取消截止时间')
  if (registrationDeadline && new Date(registrationDeadline).getTime() > new Date(startsAt).getTime()) throw new FormValidationError('registrationDeadline', '报名截止时间不能晚于活动开始时间')
  if (cancellationDeadline && new Date(cancellationDeadline).getTime() > new Date(startsAt).getTime()) throw new FormValidationError('cancellationDeadline', '取消截止时间不能晚于活动开始时间')
  const registrationSchemaValue = values.registrationSchema === undefined || values.registrationSchema === '' ? [] : values.registrationSchema
  const registrationSchemaResult = registrationSchema(registrationSchemaValue)
  const description = text(values.description, '活动介绍', 20_000, true)
  // The mini program never renders summary; derive one from the description so
  // operators are never forced to write it (server still requires ≤300 chars).
  const summary = optionalText(values.summary, '活动摘要', 300)
    || description.replace(/\s+/g, ' ').trim().slice(0, 120)
  return {
    scopeType,
    branchId,
    title: text(values.title, '活动名称', 120, true),
    summary,
    description,
    contentMedia: eventMedia(values.contentMedia),
    organizerIntroduction: optionalText(values.organizerIntroduction, '主办方介绍', 20_000),
    notices: optionalText(values.notices, '报名须知', 5_000),
    coverAssetId: asset(values.coverAssetId, '活动封面素材 ID'),
    eventTypeKey: values.eventTypeKey === undefined || values.eventTypeKey === '' ? 'general' : (() => {
      const key = text(values.eventTypeKey, '活动类型标识', 64)
      if (!stableKeyPattern.test(key)) throw new FormValidationError('eventTypeKey', '活动类型标识无效')
      return key
    })(),
    eventMode,
    accessType,
    registrationPolicy,
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
    guideUrl: guideUrl || null,
    capacity,
    waitlistEnabled,
    oversellEnabled,
    priceCents,
    memberFree: accessType === 'PAID' && [true, 'true', 'on'].includes(values.memberFree as boolean | string),
    registrationSchema: registrationSchemaResult,
    ...(values.tagIds !== undefined ? { tagIds: tagIds(values.tagIds) } : {}),
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
    return eventId ? { eventId, expectedVersion: expectedVersionValue, draft }
      : { draft, ...(values.cloneSourceEventId ? { cloneSourceEventId: id(values.cloneSourceEventId, '复制来源') } : {}) }
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
    // The server caps TAG names at 5 chars; name it explicitly instead of a generic format error.
    if (kind === 'TAG' && String(values.name ?? '').trim().length > 5) throw new FormValidationError('name', '标签名称不能超过 5 个字')
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
  if (action === 'mip.admin.events.catalog.archive') return {
    kind: enumValue(values.kind, '目录类型', ['TYPE', 'TAG'] as const), catalogId: id(values.catalogId, '目录项'), expectedVersion: version(values.expectedVersion),
    reason: text(values.reason, '归档原因', 300, true),
  }
  if (action === 'mip.admin.events.participants.import') {
    const roleMark = values.roleMark === undefined || values.roleMark === ''
      ? null
      : enumValue(values.roleMark, '角色标记', ['MEMBER', 'GUEST', 'PLAYER'] as const)
    return {
      eventId: id(values.eventId, '活动'), userId: id(values.userId, '用户'),
      ...(roleMark ? { roleMark } : {}),
      reason: optionalText(values.reason, '补录原因', 120),
    }
  }
  if (action === 'mip.admin.events.participants.cancel') return {
    eventId: id(values.eventId, '活动'), registrationId: id(values.registrationId, '报名'), expectedVersion: version(values.expectedVersion),
    reason: text(values.reason, '取消原因', 120, true),
  }
  return {
    eventId: id(values.eventId, '活动'), registrationId: id(values.registrationId, '报名'), expectedVersion: version(values.expectedVersion),
    reason: text(values.reason, '异常原因', 120, true),
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
      ? true
      : field.kind === 'asset-list' || field.kind === 'tags' || field.kind === 'json'
        ? []
        : ''
  }
  if (action === 'mip.admin.events.save') {
    // eventTypeKey stays empty on create: the draft builder falls back to the
    // platform default type, and preseeding it showed a ghost「等待目录核对」row.
    Object.assign(values, {
      scopeType: 'PLATFORM', eventMode: 'OFFLINE', accessType: 'FREE',
      registrationPolicy: 'AUTO', waitlistEnabled: false, oversellEnabled: false, priceCents: '0',
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
  const values = defaultValues(action)
  const fields = config.fields.map(field => ({ ...field, name: field.key }))
  if (action === 'mip.admin.events.catalog.save') {
    // The stable key, catalogId and expectedVersion are internal identifiers or
    // server facts: generated/prefilled from row context, never surfaced. Updates
    // must not carry the key at all (server rejects it).
    if (!targetId) {
      values.key = `web-${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`
      values.sortOrder = 0
    }
  }
  return {
    ...config,
    action,
    fields,
    targetId: idOrEmpty(targetId),
    values,
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
  const result = validateAdminEventMutationInput(definition, submittedValues)
  return result.ok ? result.input : null
}

/** Same merge rules as the builder, but preserves field-level validation errors for forms. */
export function validateAdminEventMutationInput(
  definition: AdminEventMutationDefinition,
  submittedValues: EventMutationValues,
): EventMutationValidation {
  if (!definition || !eventMutationActionSet.has(definition.action)) {
    return { ok: false, errors: [{ field: 'action', message: '活动操作无效' }] }
  }
  const configured = new Set(definition.fields.map(field => field.key))
  const values = Object.fromEntries(Object.entries(definition.values).filter(([key]) => configured.has(key)))
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
  return validateEventMutationInput(definition.action, values)
}
