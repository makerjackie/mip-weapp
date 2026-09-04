import type { AdminOperationAction, AdminRequestInput } from '../../domain/contracts'
import type { AdminDetailView } from '../../modules/admin-details'
import {
  ADMIN_BANNER_MUTATION_ACTIONS,
  buildBannerMutationInput,
  createBannerMutationDefinition,
  type AdminBannerMutationAction,
} from '../../modules/admin-banner-management'
import {
  ADMIN_EVENT_MUTATION_ACTIONS,
  buildAdminEventMutationInput,
  createAdminEventMutationDefinition,
  eventMutationConfig,
  type AdminEventMutationAction,
} from '../../modules/admin-event-mutation-forms'
import {
  ADMIN_GAME_MUTATION_ACTIONS,
  buildGameMutationInput,
  createGameMutationDefinition,
  type AdminGameMutationAction,
} from '../../modules/admin-game-management'
import {
  ADMIN_PEOPLE_MUTATION_ACTIONS,
  ADMIN_PEOPLE_MUTATION_CONFIGS,
  buildAdminPeopleMutationInput,
  createAdminPeopleMutationDefinition,
  type AdminPeopleMutationAction,
} from '../../modules/admin-people-mutation-forms'
import type { OperationField, OperationValues } from '../../modules/admin-operation-ui'
import type { AdminOperationLaunchContext } from '../../modules/admin-row-operations'
import {
  ADMIN_TASK_MUTATION_ACTIONS,
  buildTaskMutationInput,
  createTaskMutationDefinition,
  loadTaskEligibleLevels,
  type AdminTaskMutationAction,
} from '../../modules/admin-task-management'
import {
  ADMIN_CONTENT_MUTATION_ACTIONS,
  getContentMutationForm,
  USER_CONTENT_ROLE_FIELDS,
  validateContentMutation,
  type ContentMutationAction,
} from '../../modules/content-mutation-forms'

const BASIC_OPERATION_ACTIONS = [
  'mip.admin.memberships.grant',
  'mip.admin.events.clone',
  'mip.admin.events.changeStatus',
  'mip.admin.events.archive',
  'mip.admin.communications.publishEventReminder',
  'mip.admin.refunds.submit',
] as const

type BasicOperationAction = typeof BASIC_OPERATION_ACTIONS[number]
type OperationLaunchContext = AdminOperationLaunchContext & {
  targetStatus?: 'PUBLISHED' | 'UNPUBLISHED'
}

export type ReviewedOperationAction = BasicOperationAction
  | AdminPeopleMutationAction
  | AdminEventMutationAction
  | ContentMutationAction
  | AdminTaskMutationAction
  | AdminBannerMutationAction
  | AdminGameMutationAction

export interface OperationModel {
  action: ReviewedOperationAction
  capability: string
  title: string
  description: string
  fields: readonly OperationField[]
  values: OperationValues
  idempotencyKey: string
  buildInput: (values: OperationValues) => AdminRequestInput | null
}

const peopleActions = new Set<string>(ADMIN_PEOPLE_MUTATION_ACTIONS)
const eventActions = new Set<string>(ADMIN_EVENT_MUTATION_ACTIONS)
const contentActions = new Set<string>(ADMIN_CONTENT_MUTATION_ACTIONS)
const taskActions = new Set<string>(ADMIN_TASK_MUTATION_ACTIONS)
const bannerActions = new Set<string>(ADMIN_BANNER_MUTATION_ACTIONS)
const gameActions = new Set<string>(ADMIN_GAME_MUTATION_ACTIONS)
const basicActions = new Set<string>(BASIC_OPERATION_ACTIONS)

export function isReviewedOperationAction(action: string): action is ReviewedOperationAction {
  return basicActions.has(action) || peopleActions.has(action) || eventActions.has(action) || contentActions.has(action)
    || taskActions.has(action) || bannerActions.has(action) || gameActions.has(action)
}

export function operationCapability(action: ReviewedOperationAction) {
  if (basicActions.has(action)) return basicOperationCapability(action as BasicOperationAction)
  if (peopleActions.has(action)) return ADMIN_PEOPLE_MUTATION_CONFIGS[action as AdminPeopleMutationAction].capability
  if (eventActions.has(action)) return eventMutationConfig(action as AdminEventMutationAction).capability
  if (taskActions.has(action)) return 'tasks.manage'
  if (bannerActions.has(action)) return 'banners.manage'
  if (gameActions.has(action)) return 'game.manage'
  return getContentMutationForm(action as ContentMutationAction).capability
}

export async function createOperationModel(
  action: ReviewedOperationAction,
  targetId: string,
  detail: AdminDetailView | null,
  launch: OperationLaunchContext,
  request: <T>(action: AdminOperationAction, input?: AdminRequestInput) => Promise<T>,
): Promise<OperationModel> {
  const readField = (sectionTitle: string, label: string) => detail?.sections
    .find(section => section.title === sectionTitle)?.fields
    ?.find(field => field.label === label)?.value || ''
  const idempotencyKey = operationKey(action)

  if (basicActions.has(action)) {
    return createBasicOperationModel(
      action as BasicOperationAction,
      targetId,
      readField,
      launch.targetStatus,
      idempotencyKey,
    )
  }
  if (peopleActions.has(action)) {
    const typedAction = action as AdminPeopleMutationAction
    const definition = createAdminPeopleMutationDefinition(typedAction, targetId, readField, {
      expectedVersion: launch.expectedVersion,
      allowedCapabilities: launch.allowedCapabilities,
    })
    const values = { ...prefillPeopleValues(typedAction, definition.values, detail), ...launch.values }
    const fields = peopleFields(typedAction, definition.fields, launch.allowedCapabilities, detail)
    return model(definition, fields, values, idempotencyKey, next => buildAdminPeopleMutationInput(definition, next))
  }
  if (eventActions.has(action)) {
    const typedAction = action as AdminEventMutationAction
    const baseDefinition = createAdminEventMutationDefinition(typedAction, targetId, readField)
    const launchVersion = trustedEventVersion(typedAction, launch)
    const definition = launchVersion === undefined
      ? baseDefinition
      : { ...baseDefinition, expectedVersion: launchVersion }
    const values = { ...prefillEventValues(typedAction, definition.values, detail), ...launch.values }
    return model(definition, definition.fields as readonly OperationField[], values, idempotencyKey, next => buildAdminEventMutationInput(definition, next))
  }
  if (taskActions.has(action)) {
    const typedAction = action as AdminTaskMutationAction
    let source = detail?.source || {}
    if (typedAction === 'mip.admin.tasks.save' && !Array.isArray(source.eligibleLevelCatalog)) {
      source = { ...source, eligibleLevelCatalog: await loadTaskEligibleLevels(request) }
    }
    const definition = createTaskMutationDefinition(typedAction, targetId, source)
    return model(definition, definition.fields, definition.values, idempotencyKey, next => buildTaskMutationInput(definition, next))
  }
  if (bannerActions.has(action)) {
    const typedAction = action as AdminBannerMutationAction
    const definition = createBannerMutationDefinition(typedAction, targetId, detail?.source || {})
    const values = { ...definition.values, ...versionValue(launch), ...launch.values }
    return model(definition, definition.fields, values, idempotencyKey, next => buildBannerMutationInput(definition, next))
  }
  if (gameActions.has(action)) {
    const typedAction = action as AdminGameMutationAction
    const definition = createGameMutationDefinition(typedAction, targetId, detail?.source || {})
    const values = { ...definition.values, ...versionValue(launch), ...launch.values }
    return model(definition, definition.fields, values, idempotencyKey, next => buildGameMutationInput(definition, next))
  }

  const typedAction = action as ContentMutationAction
  const definition = getContentMutationForm(typedAction)
  const baseFields = normalizeContentFields(definition.fields as readonly OperationField[])
  const values = mergeValues(
    prefillContentValues(typedAction, defaultValues(baseFields), targetId, detail),
    launch.values || {},
  )
  const targetKey = contentTargetKey(typedAction)
  const trustedTarget = targetId && targetKey ? targetId : ''
  const trustedVersion = positiveInteger(values.expectedVersion)
  const creating = typedAction.endsWith('.save') && !targetId && !detail
  const fields = baseFields.map(field => {
    const key = String(field.key || field.name || '')
    return (trustedTarget && key === targetKey)
      || (trustedVersion !== undefined && key === 'expectedVersion')
      || (creating && (key === targetKey || key === 'expectedVersion'))
      ? { ...field, hidden: true }
      : field
  })
  return {
    action: typedAction,
    capability: definition.capability,
    title: contentTitle(typedAction, definition.resource),
    description: `${definition.resource}操作提交后由服务端校验权限、作用范围和当前状态。`,
    fields,
    values,
    idempotencyKey,
    buildInput: (next) => {
      const normalized = contentValues(typedAction, next, idempotencyKey)
      if (trustedTarget) normalized[targetKey] = trustedTarget
      if (trustedVersion !== undefined) normalized.expectedVersion = trustedVersion
      const result = validateContentMutation(typedAction, normalized)
      return result.ok ? result.input : null
    },
  }
}

function createBasicOperationModel(
  action: BasicOperationAction,
  targetId: string,
  readField: (sectionTitle: string, label: string) => string,
  targetStatus: 'PUBLISHED' | 'UNPUBLISHED' | undefined,
  idempotencyKey: string,
): OperationModel {
  const expectedVersion = readField('活动信息', '版本') || '1'
  const capability = basicOperationCapability(action)
  if (action === 'mip.admin.memberships.grant') {
    const values = {
      durationMonths: '12',
      expectedChainVersion: readField('会员权益', '会员链版本') || '1',
      reason: '',
    }
    return model({
      action,
      capability,
      title: '补录会员',
      description: '为该用户追加有效付费权益。提交前请确认会员时长和调整原因。',
    }, [
      { name: 'expectedChainVersion', label: '会员链版本', kind: 'number', hidden: true },
      { name: 'durationMonths', label: '会员时长', kind: 'select', required: true, options: [
        { value: '1', label: '1 个月' }, { value: '3', label: '3 个月' },
        { value: '6', label: '6 个月' }, { value: '12', label: '12 个月' },
      ] },
      { name: 'reason', label: '调整原因', kind: 'textarea', required: true, maxLength: 300, wide: true },
    ], values, idempotencyKey, (next) => {
      const durationMonths = Number(next.durationMonths)
      const chainVersion = positiveInteger(next.expectedChainVersion)
      return [1, 3, 6, 12].includes(durationMonths) && chainVersion !== undefined && next.reason
        ? { userId: targetId, durationMonths, expectedChainVersion: chainVersion, reason: String(next.reason) }
        : null
    })
  }
  if (action === 'mip.admin.events.clone') {
    const values = { expectedVersion }
    return model({
      action,
      capability,
      title: '克隆活动',
      description: '根据当前活动创建一份新的草稿活动。提交后由服务端重新校验权限和活动版本。',
    }, versionField(), values, idempotencyKey, (next) => {
      const version = positiveInteger(next.expectedVersion)
      return version === undefined ? null : { sourceEventId: targetId, expectedVersion: version }
    })
  }
  if (action === 'mip.admin.events.changeStatus') {
    const status = targetStatus || 'PUBLISHED'
    const values = { expectedVersion, status }
    return model({
      action,
      capability,
      title: status === 'PUBLISHED' ? '发布活动' : '下架活动',
      description: status === 'PUBLISHED'
        ? '发布前由服务端校验内容安全、活动时间和当前版本。'
        : '下架后活动不再接受新的公开报名，历史报名和订单事实会保留。',
    }, versionField(), values, idempotencyKey, (next) => {
      const version = positiveInteger(next.expectedVersion)
      const nextStatus = String(next.status)
      return version !== undefined && ['PUBLISHED', 'UNPUBLISHED'].includes(nextStatus)
        ? { eventId: targetId, expectedVersion: version, status: nextStatus }
        : null
    })
  }
  if (action === 'mip.admin.events.archive') {
    const values = { expectedVersion, reason: '' }
    return model({
      action,
      capability,
      title: '归档活动',
      description: '仅可归档没有报名、订单、签到或相册记录的草稿活动。提交后活动历史仍会保留。',
    }, [
      ...versionField(),
      { name: 'reason', label: '归档原因', kind: 'textarea', required: true, maxLength: 300, wide: true },
    ], values, idempotencyKey, (next) => {
      const version = positiveInteger(next.expectedVersion)
      return version !== undefined && next.reason
        ? { eventId: targetId, expectedVersion: version, reason: String(next.reason) }
        : null
    })
  }
  if (action === 'mip.admin.communications.publishEventReminder') {
    const values = { expectedVersion, sendWechatReminder: true }
    return model({
      action,
      capability,
      title: '发布活动提醒',
      description: '为当前活动生成提醒投递任务。只有已发布活动可以执行此操作。',
    }, [
      ...versionField(),
      { name: 'sendWechatReminder', label: '同时生成微信提醒任务', kind: 'checkbox', wide: true },
    ], values, idempotencyKey, (next) => {
      const version = positiveInteger(next.expectedVersion)
      return version === undefined ? null : {
        eventId: targetId,
        expectedVersion: version,
        sendWechatReminder: next.sendWechatReminder === true,
      }
    })
  }
  const values = { reason: '' }
  return model({
    action,
    capability,
    title: '提交退款',
    description: '提交当前订单的退款申请。金额和退款状态由服务端订单与支付流水决定。',
  }, [
    { name: 'reason', label: '退款原因', kind: 'textarea', required: true, maxLength: 300, wide: true },
  ], values, idempotencyKey, next => next.reason
    ? { orderId: targetId, reason: String(next.reason) }
    : null)
}

function basicOperationCapability(action: BasicOperationAction) {
  if (action === 'mip.admin.memberships.grant') return 'memberships.adjust'
  if (action === 'mip.admin.refunds.submit') return 'refunds.submit'
  if (action === 'mip.admin.communications.publishEventReminder') return 'communications.publish'
  return 'events.write'
}

function versionField(): OperationField[] {
  return [{ name: 'expectedVersion', label: '版本', kind: 'number', hidden: true }]
}

function contentTargetKey(action: ContentMutationAction) {
  if (action.startsWith('mip.admin.announcements.')) return 'announcementId'
  if (action.startsWith('mip.admin.messageCampaigns.')) return 'campaignId'
  if (action.startsWith('mip.admin.messageTemplates.')) return 'templateId'
  if (action.startsWith('mip.admin.communityReports.')) return 'reportId'
  if (action.startsWith('mip.admin.opportunities.')) return 'opportunityId'
  if (action.startsWith('mip.admin.userContent.')) return 'contentId'
  if (action.startsWith('mip.admin.knowledge.contents.')) return 'contentId'
  if (action.startsWith('mip.admin.knowledge.schedules.')) return 'scheduleId'
  if (action === 'mip.admin.badges.revoke') return 'awardId'
  if (action === 'mip.admin.badges.grant' || action === 'mip.admin.growth.adjust') return 'userId'
  return ''
}

function positiveInteger(value: unknown) {
  const number = Number(value)
  return Number.isSafeInteger(number) && number >= 1 ? number : undefined
}

function trustedEventVersion(action: AdminEventMutationAction, launch: AdminOperationLaunchContext) {
  const candidate = launch.expectedVersion ?? record(launch.values).expectedVersion
  const version = Number(candidate)
  const minimum = action === 'mip.admin.events.policy.save' ? 0 : 1
  return Number.isSafeInteger(version) && version >= minimum ? version : undefined
}

function model(
  definition: { action: ReviewedOperationAction; capability: string; title: string; description: string },
  fields: readonly OperationField[],
  values: OperationValues,
  idempotencyKey: string,
  buildInput: (values: OperationValues) => AdminRequestInput | null,
): OperationModel {
  return { ...definition, fields, values, idempotencyKey, buildInput }
}

function peopleFields(
  action: AdminPeopleMutationAction,
  fields: readonly OperationField[],
  allowedCapabilities: readonly string[] = [],
  detail: AdminDetailView | null,
) {
  if (action === 'mip.admin.users.changePrimaryBranch') {
    const user = record(record(detail?.source).user)
    const options = records(user.primaryBranchOptions).map(item => ({
      value: String(item.id || ''), label: String(item.label || item.name || item.id || ''),
    })).filter(item => item.value && item.label)
    return fields.map(field => (field.name === 'targetBranchId' && options.length ? { ...field, options } : field))
  }
  if (action === 'mip.admin.rolePolicies.update' && allowedCapabilities.length) {
    const allowed = new Set(allowedCapabilities)
    return fields.map(field => field.name === 'capabilities'
      ? { ...field, options: (field.options || []).filter(option => allowed.has(typeof option === 'string' ? option : option.value)) }
      : field)
  }
  return fields
}

function prefillPeopleValues(action: AdminPeopleMutationAction, values: OperationValues, detail: AdminDetailView | null) {
  const next = { ...values }
  const user = record(record(detail?.source).user)
  if (action === 'mip.admin.users.update') {
    for (const key of ['nickname', 'headline', 'introduction']) if (user[key] !== undefined) next[key] = user[key]
  }
  return next
}

function prefillEventValues(action: AdminEventMutationAction, values: OperationValues, detail: AdminDetailView | null) {
  const next = { ...values }
  if (action !== 'mip.admin.events.save') return next
  const event = record(record(detail?.source).event)
  for (const field of eventMutationConfig(action).fields) if (!field.hidden && event[field.key] !== undefined) next[field.key] = event[field.key]
  return next
}

function prefillContentValues(action: ContentMutationAction, values: OperationValues, targetId: string, detail: AdminDetailView | null) {
  const next = { ...values }
  const source = record(detail?.source)
  if (action === 'mip.admin.userContent.save') return prefillUserContent(next, targetId, record(source.userContent))
  const resource = action.startsWith('mip.admin.messageCampaigns.') ? record(source.campaign)
    : action.startsWith('mip.admin.opportunities.') ? record(source.opportunity)
      : action.startsWith('mip.admin.knowledge.contents.') ? record(source.content) : {}
  const idKey = action.startsWith('mip.admin.messageCampaigns.') ? 'campaignId'
    : action.startsWith('mip.admin.opportunities.') ? 'opportunityId'
      : action.startsWith('mip.admin.knowledge.contents.') ? 'contentId'
        : action.startsWith('mip.admin.badges.') || action === 'mip.admin.growth.adjust' ? 'userId' : ''
  if (idKey && targetId) next[idKey] = targetId
  if (resource.version !== undefined) next.expectedVersion = resource.version
  if (action.endsWith('.save')) for (const key of Object.keys(next)) if (resource[key] !== undefined) next[key] = resource[key]
  return next
}

function prefillUserContent(values: OperationValues, targetId: string, item: OperationValues) {
  const next = { ...values }
  if (!Object.keys(item).length) {
    if (targetId) next.contentId = targetId
    return next
  }
  const kind = String(item.kind || '')
  const owner = record(item.owner)
  next.kind = kind
  next.contentId = String(item.id || targetId || '')
  next.ownerUserId = String(owner.userId || '')
  next.expectedVersion = item.version
  const common = { kind, status: item.status }
  next.draft = kind === 'COOPERATION_CARD'
    ? { ...common, roleKey: item.roleKey, positioning: item.positioning, targetSummary: item.targetSummary, roleFields: item.roleFields, abilityScores: item.abilityScores }
    : { ...common, projectName: item.projectName, summary: item.summary, startedOn: item.startedOn, endedOn: item.endedOn, responsibility: item.responsibility, cityTagId: item.cityTagId, industryTagId: item.industryTagId, caseType: item.caseType, description: item.description, coverAssetId: item.coverAssetId, mediaAssetIds: item.mediaAssetIds }
  return next
}

function defaultValues(fields: readonly OperationField[]): OperationValues {
  const values: OperationValues = {}
  for (const field of fields) {
    const key = String(field.key || field.name || '')
    if (!key) continue
    if (field.kind === 'group') values[key] = defaultValues(field.fields || [])
    else if (field.kind === 'checkbox' || field.kind === 'boolean') values[key] = false
    else if (['id-list', 'profile-ref-list', 'asset-list', 'tags', 'multi-select'].includes(field.kind)) values[key] = []
    else if (field.kind === 'select') {
      const first = field.options?.[0]
      values[key] = field.required && first ? (typeof first === 'string' ? first : first.value) : ''
    }
    else values[key] = ''
  }
  return values
}

function contentValues(action: ContentMutationAction, values: OperationValues, idempotencyKey: string) {
  const next = pruneEmptyGroups({ ...values })
  const form = getContentMutationForm(action)
  if (form.idempotencyRequired) next.idempotencyKey = idempotencyKey
  if (action === 'mip.admin.opportunities.save') {
    const draft = record(next.draft)
    const terms = record(draft.commercialTerms)
    if (!terms.minAmountCents && !terms.maxAmountCents && !Array.isArray(terms.locations)) delete draft.commercialTerms
    next.draft = draft
  }
  if (action === 'mip.admin.userContent.save') next.draft = userContentDraft(next)
  return next
}

function userContentDraft(values: OperationValues) {
  const kind = String(values.kind || '')
  const draft = record(values.draft)
  if (kind === 'COOPERATION_CARD') {
    const roleKey = String(draft.roleKey || '') as keyof typeof USER_CONTENT_ROLE_FIELDS
    const sourceRoleFields = record(draft.roleFields)
    const roleFields = Object.fromEntries((USER_CONTENT_ROLE_FIELDS[roleKey] || [])
      .flatMap(key => nonEmpty(sourceRoleFields[key]) ? [[key, sourceRoleFields[key]]] : []))
    return {
      kind,
      roleKey,
      positioning: draft.positioning,
      targetSummary: draft.targetSummary,
      roleFields,
      abilityScores: record(draft.abilityScores),
      status: draft.status,
    }
  }
  const output: OperationValues = { kind }
  for (const key of ['projectName', 'summary', 'startedOn', 'endedOn', 'responsibility', 'cityTagId', 'industryTagId', 'caseType', 'description', 'coverAssetId', 'mediaAssetIds', 'status']) {
    const value = draft[key]
    if (value !== undefined && (nonEmpty(value) || key === 'mediaAssetIds')) output[key] = dateOnly(key, value)
  }
  return output
}

function dateOnly(key: string, value: unknown) {
  return ['startedOn', 'endedOn'].includes(key) && typeof value === 'string' && value.length >= 10
    ? value.slice(0, 10)
    : value
}

function nonEmpty(value: unknown) {
  return Array.isArray(value) ? value.length > 0 : typeof value === 'string' ? Boolean(value.trim()) : value !== undefined && value !== null
}

function mergeValues(base: OperationValues, override: OperationValues): OperationValues {
  const output = { ...base }
  for (const [key, value] of Object.entries(override)) {
    output[key] = value && typeof value === 'object' && !Array.isArray(value)
      ? mergeValues(record(output[key]), value as OperationValues)
      : value
  }
  return output
}

function normalizeContentFields(fields: readonly OperationField[]): readonly OperationField[] {
  return fields.map(field => ({
    ...field,
    ...(String(field.key || field.name || '') === 'roleKeys' ? { kind: 'multi-select' } : {}),
    ...(field.fields ? { fields: normalizeContentFields(field.fields) } : {}),
  })) as readonly OperationField[]
}

function pruneEmptyGroups(value: OperationValues): OperationValues {
  const output: OperationValues = {}
  for (const [key, item] of Object.entries(value)) {
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      const nested = pruneEmptyGroups(item as OperationValues)
      if (Object.keys(nested).length) output[key] = nested
    }
    else output[key] = item
  }
  return output
}

function contentTitle(action: ContentMutationAction, resource: string) {
  const verb = action.endsWith('.save') ? '保存'
    : action.endsWith('.publish') ? '发布'
      : action.endsWith('.withdraw') || action.endsWith('.unpublish') ? '下架'
        : action.endsWith('.archive') ? '归档'
          : action.endsWith('.claim') ? '领取处理'
            : action.endsWith('.close') ? '完成处理'
              : action.endsWith('.grant') ? '授予'
                : action.endsWith('.revoke') ? '撤销'
                  : action.endsWith('.adjust') ? '调整' : '更新'
  return `${verb}${resource}`
}

function versionValue(launch: AdminOperationLaunchContext) {
  return launch.expectedVersion === undefined ? {} : { expectedVersion: launch.expectedVersion }
}

function operationKey(action: string) {
  const suffix = globalThis.crypto?.randomUUID?.().replaceAll('-', '')
    || `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`
  return `web-${action.split('.').at(-1) || 'operation'}-${suffix}`.slice(0, 128)
}

function record(value: unknown): OperationValues {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as OperationValues : {}
}

function records(value: unknown) {
  return Array.isArray(value) ? value.map(record) : []
}
