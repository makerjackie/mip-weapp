import type { AdminRequestInput } from '../../domain/contracts'
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
  validateContentMutation,
  type ContentMutationAction,
} from '../../modules/content-mutation-forms'

export type ReviewedOperationAction = AdminPeopleMutationAction
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

export function isReviewedOperationAction(action: string): action is ReviewedOperationAction {
  return peopleActions.has(action) || eventActions.has(action) || contentActions.has(action)
    || taskActions.has(action) || bannerActions.has(action) || gameActions.has(action)
}

export function operationCapability(action: ReviewedOperationAction) {
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
  launch: AdminOperationLaunchContext,
  request: <T>(action: string, input?: AdminRequestInput) => Promise<T>,
): Promise<OperationModel> {
  const readField = (sectionTitle: string, label: string) => detail?.sections
    .find(section => section.title === sectionTitle)?.fields
    ?.find(field => field.label === label)?.value || ''
  const idempotencyKey = operationKey(action)

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
    const definition = createAdminEventMutationDefinition(typedAction, targetId, readField)
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
  const fields = normalizeContentFields(definition.fields as readonly OperationField[])
  const values = { ...prefillContentValues(typedAction, defaultValues(fields), targetId, detail), ...launch.values }
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
      const result = validateContentMutation(typedAction, normalized)
      return result.ok ? result.input : null
    },
  }
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
  return next
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
