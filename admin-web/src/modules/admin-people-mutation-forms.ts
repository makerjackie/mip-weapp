import type { AdminRequestInput } from '../domain/contracts'

/** The governance mutations which are safe to expose through a form model. */
export const ADMIN_PEOPLE_MUTATION_ACTIONS = [
  'mip.admin.users.update',
  'mip.admin.users.changePrimaryBranch',
  'mip.admin.users.setControl',
  'mip.admin.roles.set',
  'mip.admin.rolePolicies.update',
  'mip.admin.branches.create',
  'mip.admin.branches.update',
  'mip.admin.branches.changeStatus',
] as const

export type AdminPeopleMutationAction = typeof ADMIN_PEOPLE_MUTATION_ACTIONS[number]
/** Aliases shared with the event and content mutation form modules. */
export const PEOPLE_MUTATION_ACTIONS = ADMIN_PEOPLE_MUTATION_ACTIONS
export type PeopleMutationAction = AdminPeopleMutationAction

export type AdminMutationFieldKind = 'text' | 'textarea' | 'select' | 'checkbox' | 'multi-select'

export interface AdminMutationFieldOption {
  value: string
  label: string
}

export interface AdminMutationField<Name extends string = string> {
  /** Stable field key used by a shared renderer. */
  key?: Name
  /** Name alias retained for native form controls. */
  name: Name
  label: string
  kind: AdminMutationFieldKind
  required?: boolean
  maxLength?: number
  options?: readonly AdminMutationFieldOption[]
  wide?: boolean
}

export interface AdminPeopleMutationActionConfig {
  action: AdminPeopleMutationAction
  capability: string
  title: string
  description: string
  fields: readonly AdminMutationField[]
}

export type PeopleMutationFieldConfig = AdminMutationField

export type AdminPeopleMutationValues = Record<string, unknown>
export type DetailFieldReader = (sectionTitle: string, label: string) => string

export interface AdminPeopleMutationDefinition<
  Action extends AdminPeopleMutationAction = AdminPeopleMutationAction,
> {
  action: Action
  targetId: string
  title: string
  description: string
  capability: string
  fields: readonly AdminMutationField[]
  values: AdminPeopleMutationValues
  /** The optimistic-lock value read from the server-owned detail fields. */
  expectedVersion?: number
  versionSource?: { sectionTitle: string; label: string; minimum: number }
  allowedCapabilities?: readonly string[]
}

const USER_PROFILE_FIELDS = [
  { name: 'nickname', label: '昵称', kind: 'text', maxLength: 64 },
  { name: 'headline', label: '资料标题', kind: 'text', maxLength: 160 },
  { name: 'introduction', label: '个人介绍', kind: 'textarea', maxLength: 600, wide: true },
] as const satisfies readonly AdminMutationField[]

const ROLE_OPTIONS: readonly AdminMutationFieldOption[] = [
  { value: 'PLATFORM_OWNER', label: '平台超级管理员' },
  { value: 'PLATFORM_OPERATIONS', label: '平台运营' },
  { value: 'PLATFORM_FINANCE', label: '平台财务' },
  { value: 'BRANCH_ADMIN', label: '服务器管理员' },
  { value: 'EVENT_OWNER', label: '活动负责人' },
  { value: 'EVENT_MANAGER', label: '活动管理员' },
  { value: 'EVENT_STAFF', label: '活动工作人员' },
]

const CONFIGURABLE_ROLE_OPTIONS = ROLE_OPTIONS.filter(option => option.value !== 'PLATFORM_OWNER')

const CAPABILITY_OPTIONS: readonly AdminMutationFieldOption[] = [
  'admin.dashboard', 'branches.manage', 'users.read', 'users.phone.read', 'users.fields.edit',
  'users.access.manage', 'memberships.read', 'memberships.adjust', 'exports.create',
  'events.read', 'events.write', 'events.roster.read', 'events.registrations.manage',
  'events.checkin.manage', 'events.checkin.undo', 'events.team.manage', 'events.album.manage',
  'events.feedback.read', 'events.comments.manage', 'events.catalog.manage', 'events.recaps.manage',
  'announcements.manage', 'messages.manage', 'messages.delivery.review', 'communications.publish',
  'community.reports.manage', 'userContent.moderate', 'opportunities.moderate', 'opportunities.archive',
  'growth.read', 'growth.configure', 'growth.adjust', 'tasks.manage', 'banners.manage',
  'badges.manage', 'game.manage', 'knowledge.manage', 'orders.read', 'refunds.submit',
  'operations.exceptions.read', 'roles.change', 'audit.read',
].map(value => ({ value, label: value }))

const VERSION_FIELDS = {
  userProfile: [
    ['基本信息', '资料版本'],
    ['基本信息', '资料版本号'],
    ['基本信息', '版本'],
    ['用户信息', '资料版本'],
    ['用户信息', '版本'],
  ],
  userAccount: [
    ['基本信息', '用户版本'],
    ['基本信息', '版本'],
    ['用户信息', '用户版本'],
    ['用户信息', '版本'],
  ],
  branch: [
    ['服务器', '版本'],
    ['分会信息', '版本'],
    ['城市分会', '版本'],
    ['基本信息', '版本'],
  ],
  policy: [
    ['权限策略', '版本'],
    ['角色策略', '版本'],
    ['角色策略摘要', '版本'],
  ],
} as const

export const ADMIN_PEOPLE_MUTATION_CONFIG = {
  'mip.admin.users.update': {
    action: 'mip.admin.users.update',
    capability: 'users.fields.edit',
    title: '更新用户资料',
    description: '更新用户资料字段。提交时使用当前资料版本。',
    fields: USER_PROFILE_FIELDS,
    values: { nickname: '', headline: '', introduction: '' },
    versionKind: 'userProfile',
  },
  'mip.admin.users.changePrimaryBranch': {
    action: 'mip.admin.users.changePrimaryBranch',
    capability: 'users.fields.edit',
    title: '变更主服务器',
    description: '为用户选择新的主服务器，并记录变更原因。',
    fields: [
      { name: 'targetBranchId', label: '目标服务器', kind: 'select', required: true },
      { name: 'reason', label: '变更原因', kind: 'textarea', required: true, maxLength: 300, wide: true },
    ],
    values: { targetBranchId: '', reason: '' },
    versionKind: 'userAccount',
  },
  'mip.admin.users.setControl': {
    action: 'mip.admin.users.setControl',
    capability: 'users.access.manage',
    title: '设置用户访问名单',
    description: '设置或撤销用户的访问名单状态，并记录操作原因。',
    fields: [
      {
        name: 'controlType', label: '名单类型', kind: 'select', required: true,
        options: [{ value: 'ALLOWLIST', label: '允许名单' }, { value: 'BLOCKLIST', label: '限制名单' }],
      },
      { name: 'active', label: '启用名单', kind: 'checkbox', required: true },
      { name: 'reason', label: '操作原因', kind: 'textarea', required: true, maxLength: 300, wide: true },
    ],
    values: { controlType: 'ALLOWLIST', active: true, reason: '' },
  },
  'mip.admin.roles.set': {
    action: 'mip.admin.roles.set',
    capability: 'roles.change',
    title: '设置运营角色',
    description: '为用户设置指定作用范围内的运营角色。',
    fields: [
      { name: 'roleKey', label: '角色', kind: 'select', required: true, options: ROLE_OPTIONS },
      { name: 'scopeId', label: '作用范围标识', kind: 'text' },
      { name: 'branchId', label: '所属服务器标识', kind: 'text' },
      { name: 'active', label: '启用角色', kind: 'checkbox', required: true },
    ],
    values: { roleKey: 'BRANCH_ADMIN', scopeId: '', branchId: '', active: true },
  },
  'mip.admin.rolePolicies.update': {
    action: 'mip.admin.rolePolicies.update',
    capability: 'roles.change',
    title: '更新角色权限策略',
    description: '在角色允许的能力范围内更新权限策略，或恢复默认设置。',
    fields: [
      { name: 'roleKey', label: '角色', kind: 'select', required: true, options: CONFIGURABLE_ROLE_OPTIONS },
      { name: 'capabilities', label: '权限能力', kind: 'multi-select', options: CAPABILITY_OPTIONS, wide: true },
      { name: 'reset', label: '恢复默认设置', kind: 'checkbox' },
    ],
    values: { roleKey: '', capabilities: [], reset: false },
    versionKind: 'policy',
    allowedCapabilities: CAPABILITY_OPTIONS.map(option => option.value),
  },
  'mip.admin.branches.create': {
    action: 'mip.admin.branches.create',
    capability: 'branches.manage',
    title: '创建服务器',
    description: '填写服务器的标识、名称和说明。新服务器创建后默认启用。',
    fields: [
      { name: 'branchKey', label: '服务器标识', kind: 'text', required: true, maxLength: 64 },
      { name: 'name', label: '服务器名称', kind: 'text', required: true, maxLength: 80 },
      { name: 'cityName', label: '城市名称', kind: 'text', required: true, maxLength: 80 },
      { name: 'summary', label: '服务器说明', kind: 'textarea', maxLength: 500, wide: true },
    ],
    values: { branchKey: '', name: '', cityName: '', summary: '' },
  },
  'mip.admin.branches.update': {
    action: 'mip.admin.branches.update',
    capability: 'branches.manage',
    title: '更新服务器',
    description: '更新服务器名称、城市和说明。服务器标识创建后不能修改。',
    fields: [
      { name: 'name', label: '服务器名称', kind: 'text', required: true, maxLength: 80 },
      { name: 'cityName', label: '城市名称', kind: 'text', required: true, maxLength: 80 },
      { name: 'summary', label: '服务器说明', kind: 'textarea', maxLength: 500, wide: true },
    ],
    values: { name: '', cityName: '', summary: '' },
    versionKind: 'branch',
  },
  'mip.admin.branches.changeStatus': {
    action: 'mip.admin.branches.changeStatus',
    capability: 'branches.manage',
    title: '更新服务器状态',
    description: '更新服务器的启用状态。停用前由服务端检查关联业务记录。',
    fields: [{
      name: 'status', label: '服务器状态', kind: 'select', required: true,
      options: [{ value: 'ACTIVE', label: '启用' }, { value: 'INACTIVE', label: '停用' }],
    }],
    values: { status: 'ACTIVE' },
    versionKind: 'branch',
  },
} as const

export const ADMIN_PEOPLE_MUTATION_CONFIGS = ADMIN_PEOPLE_MUTATION_CONFIG

type VersionKind = keyof typeof VERSION_FIELDS

const VERSION_MINIMUMS: Record<VersionKind, number> = {
  userProfile: 0,
  userAccount: 1,
  branch: 1,
  policy: 0,
}

export interface CreateAdminPeopleMutationOptions {
  allowedCapabilities?: readonly string[]
  expectedVersion?: number
}

export function createAdminPeopleMutationDefinition<Action extends AdminPeopleMutationAction>(
  action: Action,
  targetId: string,
  readDetailField: DetailFieldReader = () => '',
  options: CreateAdminPeopleMutationOptions = {},
): AdminPeopleMutationDefinition<Action> {
  const config = ADMIN_PEOPLE_MUTATION_CONFIG[action]
  const versionKind = 'versionKind' in config ? config.versionKind as VersionKind : undefined
  const versionSource = versionKind
    ? explicitVersionSource(options.expectedVersion, VERSION_MINIMUMS[versionKind])
      || readVersionSource(readDetailField, VERSION_FIELDS[versionKind], VERSION_MINIMUMS[versionKind])
    : undefined
  const allowedCapabilities = options.allowedCapabilities || ('allowedCapabilities' in config ? config.allowedCapabilities : undefined)
  return {
    action,
    targetId: normalizeId(targetId),
    title: config.title,
    description: config.description,
    capability: config.capability,
    fields: config.fields.map(field => ({ ...field, key: field.name })),
    values: { ...config.values },
    ...(versionSource ? { expectedVersion: versionSource.value, versionSource: versionSource.field } : {}),
    ...(allowedCapabilities ? { allowedCapabilities: [...allowedCapabilities] } : {}),
  }
}

function explicitVersionSource(value: unknown, minimum: number) {
  return Number.isSafeInteger(value) && Number(value) >= minimum
    ? {
        value: Number(value),
        field: { sectionTitle: '列表当前数据', label: '版本', minimum },
      }
    : undefined
}

/**
 * Builds only fields accepted by the corresponding cloud-function operation.
 * Detail-derived versions and the target id are intentionally never taken from
 * submitted form values.
 */
export function buildAdminPeopleMutationInput(
  definition: AdminPeopleMutationDefinition,
  submittedValues: AdminPeopleMutationValues,
): AdminRequestInput | null {
  const values = plainRecord(submittedValues) ? submittedValues : {}
  switch (definition.action) {
    case 'mip.admin.users.update': return buildUserUpdate(definition, values)
    case 'mip.admin.users.changePrimaryBranch': return buildPrimaryBranch(definition, values)
    case 'mip.admin.users.setControl': return buildUserControl(definition, values)
    case 'mip.admin.roles.set': return buildRole(definition, values)
    case 'mip.admin.rolePolicies.update': return buildPolicy(definition, values)
    case 'mip.admin.branches.create': return buildBranchCreate(values)
    case 'mip.admin.branches.update': return buildBranchUpdate(definition, values)
    case 'mip.admin.branches.changeStatus': return buildBranchStatus(definition, values)
  }
}

export function validateAdminPeopleMutationInput(
  definition: AdminPeopleMutationDefinition,
  submittedValues: AdminPeopleMutationValues,
): boolean {
  return buildAdminPeopleMutationInput(definition, submittedValues) !== null
}

function buildUserUpdate(definition: AdminPeopleMutationDefinition, values: AdminPeopleMutationValues) {
  const version = versionValue(definition, 0)
  if (version === null || !definition.targetId) return null
  const source = plainRecord(values.fields) ? values.fields : values
  const fields: Record<string, unknown> = {}
  for (const key of ['nickname', 'headline', 'introduction'] as const) {
    if (Object.hasOwn(source, key)) {
      const maximum = key === 'nickname' ? 64 : key === 'headline' ? 160 : 600
      const text = boundedText(source[key], maximum)
      if (text === null || (key === 'nickname' && !text)) return null
      fields[key] = text
    }
  }
  if (Object.hasOwn(source, 'visibility') && source.visibility !== '') {
    const visibility = normalizeVisibility(source.visibility)
    if (visibility === null) return null
    fields.visibility = visibility
  }
  return Object.keys(fields).length
    ? { userId: definition.targetId, expectedVersion: version, fields }
    : null
}

function buildPrimaryBranch(definition: AdminPeopleMutationDefinition, values: AdminPeopleMutationValues) {
  const expectedVersion = versionValue(definition, 1)
  const targetBranchId = boundedId(values.targetBranchId)
  const reason = boundedText(values.reason, 300)
  if (!definition.targetId || expectedVersion === null || !targetBranchId || !reason) return null
  return { userId: definition.targetId, targetBranchId, expectedVersion, reason }
}

function buildUserControl(definition: AdminPeopleMutationDefinition, values: AdminPeopleMutationValues) {
  const controlType = oneOf(values.controlType, ['ALLOWLIST', 'BLOCKLIST'] as const)
  const active = booleanValue(values.active)
  const reason = boundedText(values.reason, 300)
  if (!definition.targetId || !controlType || active === null || !reason) return null
  return { userId: definition.targetId, controlType, active, reason }
}

function buildRole(definition: AdminPeopleMutationDefinition, values: AdminPeopleMutationValues) {
  const roleKey = oneOf(values.roleKey, [
    'PLATFORM_OWNER', 'PLATFORM_OPERATIONS', 'PLATFORM_FINANCE', 'BRANCH_ADMIN',
    'EVENT_OWNER', 'EVENT_MANAGER', 'EVENT_STAFF',
  ] as const)
  const active = booleanValue(values.active)
  if (!definition.targetId || !roleKey || active === null) return null
  const result: Record<string, unknown> = { userId: definition.targetId, roleKey, active }
  if (roleKey === 'BRANCH_ADMIN' || roleKey.startsWith('EVENT_')) {
    const scopeId = boundedId(values.scopeId)
    if (!scopeId) return null
    result.scopeId = scopeId
    if (roleKey.startsWith('EVENT_') && values.branchId !== undefined && values.branchId !== '') {
      const branchId = boundedId(values.branchId)
      if (!branchId) return null
      result.branchId = branchId
    }
  }
  return result
}

function buildPolicy(definition: AdminPeopleMutationDefinition, values: AdminPeopleMutationValues) {
  const roleKey = oneOf(values.roleKey, [
    'PLATFORM_OPERATIONS', 'PLATFORM_FINANCE', 'BRANCH_ADMIN',
    'EVENT_OWNER', 'EVENT_MANAGER', 'EVENT_STAFF',
  ] as const)
  const expectedVersion = versionValue(definition, 0)
  if (!roleKey || expectedVersion === null) return null
  if (booleanValue(values.reset) === true) return { roleKey, expectedVersion, reset: true }
  if (!Array.isArray(values.capabilities)) return null
  const capabilities = normalizeCapabilities(values.capabilities, definition.allowedCapabilities)
  return capabilities === null ? null : { roleKey, expectedVersion, capabilities }
}

function buildBranchCreate(values: AdminPeopleMutationValues) {
  const branchKey = normalizeBranchKey(values.branchKey)
  const name = boundedText(values.name, 80)
  const cityName = boundedText(values.cityName, 80)
  const summary = optionalText(values.summary, 500)
  if (!branchKey || !name || !cityName || summary === null) return null
  return { branchKey, name, cityName, summary }
}

function buildBranchUpdate(definition: AdminPeopleMutationDefinition, values: AdminPeopleMutationValues) {
  const expectedVersion = versionValue(definition, 1)
  const name = boundedText(values.name, 80)
  const cityName = boundedText(values.cityName, 80)
  const summary = optionalText(values.summary, 500)
  if (!definition.targetId || expectedVersion === null || !name || !cityName || summary === null) return null
  return { branchId: definition.targetId, expectedVersion, name, cityName, summary }
}

function buildBranchStatus(definition: AdminPeopleMutationDefinition, values: AdminPeopleMutationValues) {
  const expectedVersion = versionValue(definition, 1)
  const status = oneOf(values.status, ['ACTIVE', 'INACTIVE'] as const)
  if (!definition.targetId || expectedVersion === null || !status) return null
  return { branchId: definition.targetId, expectedVersion, status }
}

function readVersionSource(
  readDetailField: DetailFieldReader,
  candidates: readonly (readonly [string, string])[],
  minimum: number,
) {
  for (const [sectionTitle, label] of candidates) {
    const raw = readDetailField(sectionTitle, label)
    if (typeof raw !== 'string' || !raw.trim()) continue
    const value = Number(raw)
    if (Number.isSafeInteger(value) && value >= minimum) {
      return { value, field: { sectionTitle, label, minimum } }
    }
  }
  return undefined
}

function versionValue(definition: AdminPeopleMutationDefinition, minimum: number): number | null {
  const value = definition.expectedVersion
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum ? value : null
}

function normalizeVisibility(value: unknown): Record<string, unknown> | null {
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value)
    }
    catch {
      return null
    }
  }
  if (!plainRecord(value)) return null
  const allowed = new Set([
    'nickname', 'realName', 'gender', 'careerIdentity', 'avatar', 'identityStatus', 'headline',
    'introduction', 'companies', 'organizations', 'industry', 'abilities', 'primaryBranch', 'influence',
    'cardContacts',
  ])
  if (Object.keys(value).some(key => !allowed.has(key))) return null
  const result: Record<string, unknown> = {}
  for (const key of Object.keys(value)) {
    if (key === 'cardContacts') {
      if (!plainRecord(value[key]) || Object.keys(value[key]).some(item => !['phone', 'wechat', 'email', 'address'].includes(item))) return null
      if (Object.values(value[key]).some(item => typeof item !== 'boolean')) return null
      result[key] = { ...value[key] }
    }
    else if (typeof value[key] !== 'boolean') return null
    else result[key] = value[key]
  }
  return result
}

function normalizeCapabilities(value: unknown[], allowed?: readonly string[]): string[] | null {
  if (value.some(item => typeof item !== 'string' || !item.trim())) return null
  const capabilities = value.filter((item): item is string => typeof item === 'string').map(item => item.trim())
  if (new Set(capabilities).size !== capabilities.length) return null
  if (allowed && capabilities.some(item => !allowed.includes(item))) return null
  return capabilities
}

function normalizeBranchKey(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const key = value.normalize('NFKC').trim().toLowerCase()
  return /^[a-z0-9][a-z0-9-]{0,63}$/.test(key) ? key : null
}

function boundedId(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const id = value.trim()
  return id && id.length <= 36 && /^[A-Za-z0-9_-]+$/.test(id) ? id : null
}

function normalizeId(value: string): string {
  return boundedId(value) || ''
}

function boundedText(value: unknown, maximum: number): string | null {
  if (typeof value !== 'string') return null
  const text = value.trim()
  return text.length <= maximum ? text : null
}

function optionalText(value: unknown, maximum: number): string | null {
  if (value === undefined || value === null) return ''
  return boundedText(value, maximum)
}

function booleanValue(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value
  if (value === 'true' || value === 'on') return true
  if (value === 'false' || value === 'off') return false
  return null
}

function oneOf<const Values extends readonly string[]>(value: unknown, values: Values): Values[number] | null {
  return typeof value === 'string' && values.includes(value) ? value as Values[number] : null
}

function plainRecord(value: unknown): value is Record<string, any> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}
