import { taskCompletionRowActions } from './admin-row-operations.ts'
import type { AdminRequestInput } from '../domain/contracts'
import type {
  AdminDetailRequest,
  AdminDetailSection,
  AdminDetailView,
} from './admin-details.ts'
import type { OperationField, OperationValues } from './admin-operation-ui.ts'
import type {
  AdminListQuery,
  AdminReadPage,
  AdminRequest,
  AdminTableRow,
} from './admin-read-contracts.ts'
import {
  columns,
  formatDateTime,
  numberLabel,
  pageValue,
  record,
  valueOf,
} from './admin-read-formatters.ts'

export const ADMIN_TASK_MUTATION_ACTIONS = [
  'mip.admin.tasks.save',
  'mip.admin.tasks.publish',
  'mip.admin.tasks.unpublish',
  'mip.admin.tasks.delete',
  'mip.admin.tasks.assignMembers',
  'mip.admin.tasks.revokeMembers',
  'mip.admin.tasks.assign',
  'mip.admin.tasks.submissions.approve',
  'mip.admin.tasks.submissions.reject',
  'mip.admin.tasks.submissions.retryReward',
] as const

export type AdminTaskMutationAction = typeof ADMIN_TASK_MUTATION_ACTIONS[number]

export interface AdminTaskMutationDefinition {
  action: AdminTaskMutationAction
  capability: 'tasks.manage'
  title: string
  description: string
  fields: readonly OperationField[]
  values: OperationValues
}

export interface TaskCompletionExport {
  fileName: string
  contentBase64: string
  rowCount: number
}

export interface TaskDetailPageQuery {
  query?: string
  cursor?: string | null
  limit?: number
}

export interface TaskDetailLoadOptions {
  members?: TaskDetailPageQuery
  completions?: TaskDetailPageQuery
}

export interface TaskEligibleLevel {
  id: string
  name: string
  minimumExperience: number
  status: string
}

const taskStatusLabels: Record<string, string> = {
  ACTIVE: '启用',
  DRAFT: '草稿',
  PUBLISHED: '已发布',
  UNPUBLISHED: '已下架',
  DELETED: '已删除',
}

const assignmentStatusLabels: Record<string, string> = {
  ACTIVE: '已分配',
  REVOKED: '已撤销',
  NONE: '未分配',
}

const resultStatusLabels: Record<string, string> = {
  PENDING: '待审批',
  SUCCESS: '成功',
  FAILED: '失败',
}

const submissionStatusLabels: Record<string, string> = {
  pending: '待开始',
  in_progress: '进行中',
  pending_submit: '待提交',
  expired: '已过期',
  submitted: '已提交',
  pending_review: '待审批',
  boss_approved: '笨笨老大已审批',
  approved: '已通过',
  rejected: '已退回',
  reward_pending: '奖励发放中',
  reward_succeeded: '奖励已发放',
  reward_failed: '奖励发放失败',
  retrying: '重试中',
}

export async function loadTaskManagementPage(
  query: AdminListQuery,
  request: AdminRequest,
): Promise<AdminReadPage> {
  const [taskPayload, completionPayload] = await Promise.all([
    request('mip.admin.tasks.list', {
      filters: { query: query.query, status: query.status },
      limit: query.limit,
      cursor: query.cursor || undefined,
    }),
    request('mip.admin.tasks.completions.list', {
      filters: { query: query.query },
      limit: query.limit,
    }),
  ])
  const taskPage = pageValue(taskPayload)
  const completionPage = pageValue(completionPayload)
  return {
    sections: [
      {
        title: '任务',
        rows: taskPage.items.map(taskListRow),
        columns: columns([
          ['name', '任务名称'], ['reward', '经验奖励'], ['starLevel', '星级'],
          ['period', '周期'], ['assignedOwner', '笨笨老大'], ['rewardConfig', '奖励分项'],
          ['assignment', '分配范围'], ['assigned', '已分配'], ['completed', '已完成'],
          ['endsAt', '截止时间'], ['updatedAt', '更新时间'], ['state', '状态'],
        ]),
      },
      {
        title: '近期完成记录',
        rows: completionPage.items.map(completionListRow),
        columns: columns([
          ['task', '任务'], ['member', '成员'], ['reward', '经验奖励'],
          ['completedAt', '完成时间'], ['state', '结果'],
        ]),
        detailTarget: 'taskCompletions',
      },
    ],
    nextCursor: taskPage.nextCursor,
  }
}

export async function loadTaskEditorOptions(request: AdminRequest): Promise<Record<string, unknown>> {
  return record(await request('mip.admin.tasks.editorOptions'))
}

function catalogOptions(value: unknown) {
  return Array.isArray(value) ? value.map(record).filter(item => identifier(item.id)).map(item => ({ value: String(item.id), label: String(item.name || item.id) })) : []
}

export async function loadTaskEligibleLevels(request: AdminRequest): Promise<TaskEligibleLevel[]> {
  const value = await request('mip.admin.tasks.eligibleLevels.list')
  if (!Array.isArray(value)) throw new Error('INVALID_TASK_LEVELS')
  return value.map((item) => {
    const level = record(item)
    const id = identifier(level.id)
    const name = text(level.name, 100)
    const minimumExperience = safeNonNegativeInteger(level.minimumExperience)
    if (!id || !name || minimumExperience === null || level.status !== 'ACTIVE') {
      throw new Error('INVALID_TASK_LEVELS')
    }
    return { id, name, minimumExperience, status: 'ACTIVE' }
  })
}

export async function loadTaskDetail(
  taskId: string,
  request: AdminDetailRequest,
  options: TaskDetailLoadOptions = {},
): Promise<AdminDetailView> {
  const [taskValue, eligibleLevelCatalog] = await Promise.all([
    request('mip.admin.tasks.get', { taskId }),
    loadTaskEligibleLevels(request),
  ])
  const task = record(taskValue)
  const assignmentMode = String(task.assignmentMode || 'ALL')
  const memberQuery = taskDetailPageQuery(options.members, 20)
  const completionQuery = taskDetailPageQuery(options.completions, 20)
  const [completionPayload, memberPayload] = await Promise.all([
    request('mip.admin.tasks.completions.list', taskDetailPageInput(
      { taskId, ...(completionQuery.query ? { query: completionQuery.query } : {}) },
      completionQuery,
    )),
    assignmentMode === 'SELECTED'
      ? request('mip.admin.tasks.assignableMembers.list', taskDetailPageInput(
          { taskId, query: memberQuery.query },
          memberQuery,
        ))
      : Promise.resolve({ items: [], nextCursor: null }),
  ])
  const completionPage = pageValue(completionPayload)
  const memberPage = pageValue(memberPayload)
  const completions = completionPage.items
  const members = memberPage.items
  const eligibleLevels = Array.isArray(task.eligibleLevels)
    ? task.eligibleLevels.map(item => record(item))
    : []
  const template = record(task.template)
  const sections: AdminDetailSection[] = [
    {
      title: '任务信息',
      fields: detailFields([
        ['任务内容', task.content],
        ['经验奖励', numberLabel(task.rewardExperience)],
        ['需要附件', task.attachmentRequired === true ? '是' : '否'],
        ['分配范围', assignmentModeLabel(task.assignmentMode)],
        ['截止时间', formatDateTime(task.endsAt)],
        ['星级', task.starLevel ? numberLabel(task.starLevel) : '—'],
        ['用途', task.purpose],
        ['完成标准', task.completionCriteria],
        ['周期开始', formatDateTime(task.periodStartAt)],
        ['周期结束', formatDateTime(task.periodEndAt)],
        ['周送达时间', task.weeklyDeliverAt],
        ['指派负责人', task.assignedOwnerName || task.assignedOwnerId],
        ['奖励配置', rewardConfigDisplay(task.rewardConfig)],
        ['模板文件', taskTemplateStatus(template)],
        ['模板管理', '编辑任务时可上传与替换模板'],
        ['版本', numberLabel(task.version)],
        ['发布时间', formatDateTime(task.publishedAt)],
        ['更新时间', formatDateTime(task.updatedAt)],
      ]),
    },
    {
      title: '执行数据',
      metrics: detailFields([
        ['已分配成员', numberLabel(task.assignmentCount)],
        ['已完成', numberLabel(task.completionCount)],
        ['可参与等级', eligibleLevels.length ? String(eligibleLevels.length) : '不限'],
      ]),
    },
  ]
  if (eligibleLevels.length) {
    sections.push({
      title: '可参与等级',
      rows: eligibleLevels.map(item => ({
        id: valueOf(item, 'id'),
        name: valueOf(item, 'name'),
        minimum: numberLabel(item.minimumExperience),
        state: taskStatusLabel(item.status),
      })),
      columns: columns([['name', '等级'], ['minimum', '最低经验值'], ['state', '状态']]),
    })
  }
  if (assignmentMode === 'SELECTED') {
    sections.push({
      title: '成员候选',
      rows: members.map(item => ({
        memberRef: valueOf(item, 'memberRef'),
        name: valueOf(item, 'nickname'),
        branch: valueOf(item, 'branchName'),
        assignedAt: formatDateTime(item.assignedAt),
        state: assignmentStatusLabel(item.assignmentStatus),
      })),
      columns: columns([['name', '成员'], ['branch', '所属服务器'], ['assignedAt', '分配时间'], ['state', '分配状态']]),
      pager: {
        key: 'taskMembers',
        query: memberQuery.query,
        currentCursor: memberQuery.cursor,
        nextCursor: memberPage.nextCursor,
        placeholder: '搜索成员或服务器',
      },
    })
  }
  sections.push({
    title: '完成记录',
    rows: completions.map(item => ({
      detailId: valueOf(item, 'id'),
      task: valueOf(item, 'taskName'),
      member: valueOf(item, 'nickname'),
      reward: numberLabel(item.rewardExperience),
      completedAt: formatDateTime(item.completedAt),
      state: item.submissionStatus ? submissionStatusLabel(item.submissionStatus) : resultStatusLabel(item.resultStatus),
    })),
    columns: columns([
      ['task', '任务'], ['member', '成员'], ['reward', '经验奖励'],
      ['completedAt', '完成时间'], ['state', '结果'],
    ]),
    detailTarget: 'taskCompletions',
    pager: {
      key: 'taskCompletions',
      query: completionQuery.query,
      currentCursor: completionQuery.cursor,
      nextCursor: completionPage.nextCursor,
      placeholder: '搜索成员或任务',
    },
  })
  return {
    route: 'tasks',
    title: String(task.name || '任务详情'),
    subtitle: `${assignmentModeLabel(task.assignmentMode)} · ${numberLabel(task.rewardExperience)} 经验值`,
    status: taskStatusLabel(task.status),
    sections,
    source: {
      task,
      assignableMembers: members,
      eligibleLevelCatalog,
      taskDetailPages: {
        members: { query: memberQuery.query, nextCursor: memberPage.nextCursor },
        completions: { query: completionQuery.query, nextCursor: completionPage.nextCursor },
      },
    },
  }
}

export async function loadTaskCompletionDetail(
  completionId: string,
  request: AdminDetailRequest,
): Promise<AdminDetailView> {
  const completion = record(await request('mip.admin.tasks.completions.get', { completionId }))
  const attachment = record(completion.attachment)
  return {
    route: 'taskCompletions',
    title: String(completion.taskName || '任务完成记录'),
    subtitle: String(completion.nickname || '成员未提供'),
    status: resultStatusLabel(completion.resultStatus),
    sections: [{
      title: '完成信息',
      fields: detailFields([
        ['成员', completion.nickname],
        ['任务内容快照', completion.taskContent],
        ['经验奖励', numberLabel(completion.rewardExperience)],
        ['结果说明', completion.resultMessage],
        ['完成时间', formatDateTime(completion.completedAt)],
        ['审批状态', submissionStatusLabel(completion.submissionStatus)],
        ['审批说明', completion.reviewRemark],
        ['奖励结果', rewardResultDisplay(completion.rewardResult)],
        ['审核人', completion.reviewedBy],
        ['审核时间', formatDateTime(completion.reviewedAt)],
        ['奖励重试次数', Array.isArray(completion.retryLog) ? String(completion.retryLog.length) : '0'],
        ['附件', completionAttachmentStatus(attachment)],
        ['附件查看', validWebMediaUrl(attachment.url) ? '可用' : '当前不可用'],
        ['附件类型', attachment.contentType],
        ['附件大小', attachment.bytes ? `${numberLabel(attachment.bytes)} 字节` : '—'],
      ]),
    }],
    source: { completion },
  }
}

export function createTaskMutationDefinition(
  action: AdminTaskMutationAction,
  targetId = '',
  source: Record<string, unknown> = {},
): AdminTaskMutationDefinition {
  const task = record(source.task)
  const version = integer(task.version)
  if (action === 'mip.admin.tasks.save') {
    const eligibleLevelIds = Array.isArray(task.eligibleLevels)
      ? task.eligibleLevels.map(item => String(record(item).id || '')).filter(Boolean)
      : []
    const levelOptions = Array.isArray(source.eligibleLevelCatalog)
      ? source.eligibleLevelCatalog.map(item => record(item)).map(item => ({
          value: String(item.id || ''),
          label: `${String(item.name || '未命名等级')} · ${numberLabel(item.minimumExperience)} 经验`,
        })).filter(item => identifier(item.value))
      : []
    return definition(action, targetId ? '编辑任务' : '创建任务', '填写任务内容、经验奖励、参与范围和截止时间。任务模板图片可使用素材上传页返回的素材 ID。', [
      { name: 'name', label: '任务名称', kind: 'text', required: true, maxLength: 100 },
      { name: 'content', label: '任务内容', kind: 'textarea', required: true, maxLength: 5000, wide: true },

      { name: 'assignmentMode', label: '分配范围', kind: 'select', required: true, options: [
        { value: 'ALL', label: '全部成员' }, { value: 'SELECTED', label: '指定成员' },
      ] },
      { name: 'attachmentRequired', label: '完成时必须上传附件', kind: 'checkbox', wide: true },
      { name: 'endsAt', label: '截止时间', kind: 'datetime' },
      { name: 'templateAssetId', label: '任务模板图片', kind: 'text', wide: true, assetPurpose: 'TASK_TEMPLATE' },
      { name: 'eligibleLevelIds', label: '可参与等级（不选择表示不限）', kind: 'multi-select', options: levelOptions, wide: true },
      { name: 'starLevel', label: '星级', kind: 'select', required: true, options: [1, 2, 3, 4, 5].map(level => ({ value: String(level), label: `${level} 星` })) },
      { name: 'purpose', label: '任务目的', kind: 'textarea', required: true, maxLength: 500, wide: true },
      { name: 'completionCriteria', label: '完成标准', kind: 'textarea', required: true, maxLength: 1000, wide: true },
      { name: 'periodStartAt', label: '周期开始', kind: 'datetime' },
      { name: 'periodEndAt', label: '周期结束', kind: 'datetime' },
      { name: 'weeklyDeliverAt', label: '周送达时间（HH:mm，北京时间）', kind: 'text', maxLength: 5 },
      { name: 'assignedOwnerId', label: '任务负责人', kind: 'select', required: true, options: catalogOptions(record(source.editorOptions).owners) },
      { name: 'applicableServers', label: '适用服务器', kind: 'multi-select', options: catalogOptions(record(source.editorOptions).servers), wide: true },
      { name: 'rewardConfig', label: '奖励配置（奖金线下发放）', kind: 'group', fields: rewardFields(), wide: true },
    ], {
      taskId: targetId,
      expectedVersion: version,
      name: String(task.name || ''),
      content: String(task.content || ''),
      rewardExperience: integer(task.rewardExperience),
      assignmentMode: String(task.assignmentMode || 'ALL'),
      attachmentRequired: task.attachmentRequired === true,
      endsAt: String(task.endsAt || ''),
      templateAssetId: String(record(task.template).assetId || ''),
      eligibleLevelIds,
      starLevel: String(integer(task.starLevel) || 1),
      purpose: String(task.purpose || ''),
      completionCriteria: String(task.completionCriteria || ''),
      periodStartAt: String(task.periodStartAt || ''),
      periodEndAt: String(task.periodEndAt || ''),
      weeklyDeliverAt: String(task.weeklyDeliverAt || ''),
      assignedOwnerId: String(task.assignedOwnerId || ''),
      applicableServers: Array.isArray(task.applicableServers) ? task.applicableServers : [],
      rewardConfig: task.rewardConfig || { experience: { enabled: true, amount: integer(task.rewardExperience) || 1 }, contribution: { enabled: false, amount: 0 }, bonus: { enabled: false, amount: 0 } },
    })
  }
  if (action === 'mip.admin.tasks.assignMembers' || action === 'mip.admin.tasks.revokeMembers') {
    const members = Array.isArray(source.assignableMembers)
      ? source.assignableMembers.map(item => record(item))
      : []
    const assigning = action === 'mip.admin.tasks.assignMembers'
    const options = members
      .filter(item => assigning ? item.assignmentStatus !== 'ACTIVE' : item.assignmentStatus === 'ACTIVE')
      .map(item => ({
        value: String(item.memberRef || ''),
        label: [item.nickname, item.branchName].filter(Boolean).join(' · ') || '未命名成员',
      }))
      .filter(item => item.value)
    return definition(action, assigning ? '分配任务成员' : '撤销任务成员', '从当前任务可分配成员中选择需要更新的成员。', [
      { name: 'memberRefs', label: '成员', kind: 'multi-select', required: true, options, wide: true },
    ], { taskId: targetId, expectedVersion: version, memberRefs: [] })
  }
  if (action === 'mip.admin.tasks.submissions.approve' || action === 'mip.admin.tasks.submissions.reject' || action === 'mip.admin.tasks.submissions.retryReward') {
    return createTaskSubmissionMutationDefinition(action, targetId, source)
  }
  if (action === 'mip.admin.tasks.assign') {
    return createTaskAssignmentMutationDefinition(action, targetId, source)
  }
  const titles: Record<Exclude<AdminTaskMutationAction, 'mip.admin.tasks.save' | 'mip.admin.tasks.assignMembers' | 'mip.admin.tasks.revokeMembers' | 'mip.admin.tasks.assign' | 'mip.admin.tasks.submissions.approve' | 'mip.admin.tasks.submissions.reject' | 'mip.admin.tasks.submissions.retryReward'>, string> = {
    'mip.admin.tasks.publish': '发布任务',
    'mip.admin.tasks.unpublish': '下架任务',
    'mip.admin.tasks.delete': '删除任务',
  }
  return definition(action, titles[action], '提交前会按当前任务版本检查状态，避免覆盖其他运营成员的更新。', [], {
    taskId: targetId,
    expectedVersion: version,
  })
}

export function createTaskSubmissionMutationDefinition(
  action: 'mip.admin.tasks.submissions.approve' | 'mip.admin.tasks.submissions.reject' | 'mip.admin.tasks.submissions.retryReward',
  targetId = '',
  source: Record<string, unknown> = {},
): AdminTaskMutationDefinition {
  const submission = record(source.submission)
  const submissionId = targetId || identifier(submission.id || submission.submissionId)
  if (action === 'mip.admin.tasks.submissions.approve') {
    return reviewDefinition(action, '审批通过', '确认该任务提交符合完成标准，通过后奖励将按服务端规则发放。', [
      { name: 'remark', label: '审批说明', kind: 'textarea', maxLength: 500, wide: true },
    ], { submissionId, remark: String(submission.reviewRemark || '') })
  }
  if (action === 'mip.admin.tasks.submissions.reject') {
    return reviewDefinition(action, '退回提交', '退回该任务提交，提交人需修改后重新提交。请填写退回原因。', [
      { name: 'remark', label: '退回原因', kind: 'textarea', required: true, maxLength: 500, wide: true },
    ], { submissionId, remark: '' })
  }
  return reviewDefinition(action, '重试奖励发放', '重新触发该提交的奖励发放流程。仅适用于奖励发放失败的情况。', [
    { name: 'remark', label: '说明', kind: 'textarea', maxLength: 500, wide: true },
  ], { submissionId, remark: String(submission.reviewRemark || '') })
}

export function createTaskAssignmentMutationDefinition(
  action: 'mip.admin.tasks.assign',
  targetId = '',
  source: Record<string, unknown> = {},
): AdminTaskMutationDefinition {
  const task = record(source.task)
  const version = integer(task.version)
  const recipients = Array.isArray(source.assignableMembers)
    ? source.assignableMembers.map(item => record(item))
    : []
  const options = recipients
    .map(item => ({
      value: String(item.memberRef || ''),
      label: [item.nickname, item.branchName].filter(Boolean).join(' · ') || '未命名成员',
    }))
    .filter(item => item.value)
  return definition(action, '派发任务', '选择派发模式与接收成员。周派发会在设定周期内按周送达时间自动分配。', [
    { name: 'assignMode', label: '派发模式', kind: 'select', required: true, options: [
      { value: 'single', label: '单次派发' }, { value: 'batch', label: '批量派发' }, { value: 'weekly', label: '每周派发' },
    ] },
    { name: 'recipients', label: '接收成员', kind: 'multi-select', options, wide: true },
    { name: 'roleIds', label: '接收角色', kind: 'multi-select', options: Array.isArray(record(source.editorOptions).roles) ? (record(source.editorOptions).roles as unknown[]).map(record).map(role => ({ value: String(role.id), label: String(role.name) })) : [] },
    { name: 'serverIds', label: '接收服务器', kind: 'multi-select', options: catalogOptions(record(source.editorOptions).servers) },
    { name: 'tagIds', label: '接收标签', kind: 'multi-select', options: catalogOptions(record(source.editorOptions).tags) },
    { name: 'weeklyDeliverAt', label: '周送达时间（HH:mm，北京时间）', kind: 'text', maxLength: 5, visibleWhen: { path: 'assignMode', value: 'weekly' } },
    { name: 'weeklyStartAt', label: '周派发开始', kind: 'datetime', visibleWhen: { path: 'assignMode', value: 'weekly' } },
    { name: 'weeklyEndAt', label: '周派发结束', kind: 'datetime', visibleWhen: { path: 'assignMode', value: 'weekly' } },
  ], {
    taskId: targetId,
    expectedVersion: version,
    assignMode: 'batch',
    roleIds: [], serverIds: [], tagIds: [],
    recipients: [],
    weeklyDeliverAt: String(task.weeklyDeliverAt || ''),
    weeklyStartAt: String(task.periodStartAt || ''),
    weeklyEndAt: String(task.periodEndAt || ''),
  })
}

export function buildTaskMutationInput(
  definitionValue: AdminTaskMutationDefinition,
  values: OperationValues,
): AdminRequestInput | null {
  const action = definitionValue.action
  const taskId = identifier(values.taskId)
  const expectedVersion = positiveInteger(values.expectedVersion)
  if (action === 'mip.admin.tasks.save') {
    const name = text(values.name, 100)
    const content = text(values.content, 5000)
    const rewardConfig = normalizeRewardValues(values.rewardConfig)
    if (!rewardConfig) return null
    const rewardExperience = rewardConfig.experience.enabled ? rewardConfig.experience.amount : 0
    const assignmentMode = ['ALL', 'SELECTED'].includes(String(values.assignmentMode))
      ? String(values.assignmentMode)
      : ''
    const eligibleLevelIds = identifiers(values.eligibleLevelIds, true)
    if (!name || !content || rewardExperience === null || !assignmentMode || eligibleLevelIds === null) return null
    const templateAssetId = optionalIdentifier(values.templateAssetId)
    if (templateAssetId === null) return null
    const endsAt = isoDate(values.endsAt)
    if (endsAt === null) return null
    const starLevel = boundedInteger(values.starLevel, 1, 5)
    if (starLevel === null) return null
    const purpose = text(values.purpose, 500)
    const completionCriteria = text(values.completionCriteria, 1000)
    const periodStartAt = isoDate(values.periodStartAt)
    if (periodStartAt === null) return null
    const periodEndAt = isoDate(values.periodEndAt)
    if (periodEndAt === null) return null
    if (periodStartAt && periodEndAt && new Date(periodStartAt) > new Date(periodEndAt)) return null
    const weeklyDeliverAt = text(values.weeklyDeliverAt, 5)
    if (weeklyDeliverAt && !/^([01]\d|2[0-3]):[0-5]\d$/.test(weeklyDeliverAt)) return null
    const assignedOwnerId = identifier(values.assignedOwnerId)
    const applicableServers = identifiers(values.applicableServers || [], true)
    if (!purpose || !completionCriteria || !assignedOwnerId || !applicableServers) return null
    const input: AdminRequestInput = {
      task: {
        name,
        content,
        rewardExperience,
        attachmentRequired: values.attachmentRequired === true,
        assignmentMode,
        endsAt,
        templateAssetId: templateAssetId || null,
        eligibleLevelIds,
        starLevel,
        purpose,
        completionCriteria,
        periodStartAt,
        periodEndAt,
        weeklyDeliverAt,
        assignedOwnerId,
        applicableServers,
        rewardConfig,
      },
    }
    if (taskId) {
      if (!expectedVersion) return null
      input.taskId = taskId
      input.expectedVersion = expectedVersion
    }
    return input
  }
  if (action === 'mip.admin.tasks.submissions.approve' || action === 'mip.admin.tasks.submissions.reject' || action === 'mip.admin.tasks.submissions.retryReward') {
    return buildTaskSubmissionInput(action, values)
  }
  if (action === 'mip.admin.tasks.assign') {
    return buildTaskAssignmentInput(action, values)
  }
  if (!taskId || !expectedVersion) return null
  if (action === 'mip.admin.tasks.assignMembers' || action === 'mip.admin.tasks.revokeMembers') {
    const memberRefs = profileRefs(values.memberRefs)
    return memberRefs?.length ? { taskId, expectedVersion, memberRefs } : null
  }
  return { taskId, expectedVersion }
}

export function buildTaskSubmissionInput(
  action: 'mip.admin.tasks.submissions.approve' | 'mip.admin.tasks.submissions.reject' | 'mip.admin.tasks.submissions.retryReward',
  values: OperationValues,
): AdminRequestInput | null {
  const submissionId = identifier(values.submissionId)
  if (!submissionId) return null
  const remark = text(values.remark, 500)
  if (action === 'mip.admin.tasks.submissions.reject' && !remark) return null
  const input: AdminRequestInput = { submissionId }
  if (remark) input.remark = remark
  return input
}

export function buildTaskAssignmentInput(
  action: 'mip.admin.tasks.assign',
  values: OperationValues,
): AdminRequestInput | null {
  const taskId = identifier(values.taskId)
  if (!taskId) return null
  const assignMode = String(values.assignMode || '')
  if (!['single', 'batch', 'weekly'].includes(assignMode)) return null
  const memberRefs = profileRefs(values.recipients || []) || []
  const roleIds = Array.isArray(values.roleIds) ? values.roleIds.map(String) : []
  const serverIds = identifiers(values.serverIds || [], true)
  const tagIds = identifiers(values.tagIds || [], true)
  if (!serverIds || !tagIds || ![memberRefs, roleIds, serverIds, tagIds].some(items => items.length)) return null
  const recipients = { memberRefs, roleIds, serverIds, tagIds }
  const expectedVersion = positiveInteger(values.expectedVersion)
  const weeklyDeliverAt = text(values.weeklyDeliverAt, 5)
  if (weeklyDeliverAt && !/^([01]\d|2[0-3]):[0-5]\d$/.test(weeklyDeliverAt)) return null
  const weeklyStartAt = isoDate(values.weeklyStartAt)
  if (weeklyStartAt === null) return null
  const weeklyEndAt = isoDate(values.weeklyEndAt)
  if (weeklyEndAt === null) return null
  if (!expectedVersion || (assignMode === 'weekly' && (!weeklyDeliverAt || !weeklyStartAt || !weeklyEndAt || weeklyEndAt <= weeklyStartAt))) return null
  const input: AdminRequestInput = { taskId, recipients, assignMode }
  if (expectedVersion) input.expectedVersion = expectedVersion
  if (weeklyDeliverAt) input.weeklyDeliverAt = weeklyDeliverAt
  if (weeklyStartAt) input.weeklyStartAt = weeklyStartAt
  if (weeklyEndAt) input.weeklyEndAt = weeklyEndAt
  return input
}

export async function exportTaskCompletions(
  taskId: string,
  request: AdminRequest,
): Promise<TaskCompletionExport> {
  const value = record(await request('mip.admin.tasks.completions.export', { filters: { taskId } }))
  if (typeof value.fileName !== 'string'
    || typeof value.contentBase64 !== 'string'
    || !Number.isSafeInteger(Number(value.rowCount))) {
    throw new Error('INVALID_TASK_EXPORT')
  }
  return {
    fileName: value.fileName,
    contentBase64: value.contentBase64,
    rowCount: Number(value.rowCount),
  }
}

export function downloadTaskCompletionExport(value: TaskCompletionExport) {
  const bytes = Uint8Array.from(atob(value.contentBase64), character => character.charCodeAt(0))
  const link = document.createElement('a')
  link.href = URL.createObjectURL(new Blob([bytes], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  }))
  link.download = value.fileName
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(link.href), 0)
}

export function taskStatusLabel(value: unknown) {
  const code = String(value || '')
  return taskStatusLabels[code] || code || '—'
}

export function assignmentModeLabel(value: unknown) {
  return String(value || '') === 'SELECTED' ? '指定成员' : '全部成员'
}

export function assignmentStatusLabel(value: unknown) {
  const code = String(value || '')
  return assignmentStatusLabels[code] || code || '—'
}

export function resultStatusLabel(value: unknown) {
  const code = String(value || '')
  return resultStatusLabels[code] || code || '—'
}

export function submissionStatusLabel(value: unknown) {
  const code = String(value || '')
  return submissionStatusLabels[code] || code || '—'
}

function taskDetailPageQuery(value: TaskDetailPageQuery | undefined, fallbackLimit: number) {
  const query = typeof value?.query === 'string' ? value.query.trim().slice(0, 80) : ''
  const cursor = typeof value?.cursor === 'string' && value.cursor.length <= 512
    ? value.cursor
    : null
  const limit = Number.isSafeInteger(value?.limit)
    ? Math.max(1, Math.min(Number(value?.limit), 50))
    : fallbackLimit
  return { query, cursor, limit }
}

function taskDetailPageInput(
  filters: Record<string, unknown>,
  query: ReturnType<typeof taskDetailPageQuery>,
) {
  return {
    filters,
    limit: query.limit,
    ...(query.cursor ? { cursor: query.cursor } : {}),
  }
}

function taskTemplateStatus(template: AdminTableRow) {
  if (!template.assetId) return '未配置'
  return validWebMediaUrl(template.url) ? '已配置' : '已配置，当前无法在 Web 查看'
}

function rewardFields(): OperationField[] {
  return [['experience', '经验值'], ['contribution', '贡献值'], ['bonus', '奖金（元，线下发放）']].map(([name, label]) => ({
    name, label, kind: 'group', fields: [
      { name: 'enabled', label: `启用${label}`, kind: 'checkbox' },
      { name: 'amount', label: '数额', kind: name === 'bonus' ? 'number' : 'integer' },
    ],
  }))
}

function normalizeRewardValues(value: unknown) {
  const source = record(value)
  const result = {} as Record<'experience' | 'contribution' | 'bonus', { enabled: boolean; amount: number }>
  for (const key of ['experience', 'contribution', 'bonus'] as const) {
    const entry = record(source[key])
    const enabled = entry.enabled === true
    const amount = enabled ? Number(entry.amount) : 0
    if (!Number.isFinite(amount) || amount < 0 || amount > 1000000
      || (enabled && key !== 'bonus' && (!Number.isSafeInteger(amount) || amount < 1))
      || (key === 'bonus' && Math.abs(amount * 100 - Math.round(amount * 100)) > 0.00001)) return null
    result[key] = { enabled, amount }
  }
  return Object.values(result).some(item => item.enabled) ? result : null
}

function rewardConfigDisplay(value: unknown) {
  const config = record(value)
  return [['experience', '经验值'], ['contribution', '贡献值'], ['bonus', '奖金（线下）']]
    .flatMap(([key, label]) => record(config[key]).enabled ? [`${label} ${numberLabel(record(config[key]).amount)}`] : []).join(' / ') || '—'
}

function rewardResultDisplay(value: unknown) {
  const result = record(value)
  if (result.error) return String(result.error)
  return [['experience', '经验值'], ['contribution', '贡献值'], ['bonus', '奖金']].flatMap(([key, label]) => {
    const item = record(result[key])
    return item.amount !== undefined ? [`${label} ${numberLabel(item.amount)}${item.status === 'OFFLINE_PENDING' ? '（待线下发放）' : ''}`] : []
  }).join(' / ') || '—'
}

function completionAttachmentStatus(attachment: AdminTableRow) {
  if (!Object.keys(attachment).length) return '未上传'
  return validWebMediaUrl(attachment.url) ? '已上传' : '已上传，当前无法在 Web 查看'
}

function validWebMediaUrl(value: unknown) {
  try {
    const url = new URL(String(value || ''))
    return url.protocol === 'https:' && !url.username && !url.password
  }
  catch {
    return false
  }
}

function taskListRow(item: AdminTableRow) {
  return {
    detailId: valueOf(item, 'id', 'taskId'),
    name: valueOf(item, 'name'),
    reward: numberLabel(item.rewardExperience),
    starLevel: item.starLevel !== undefined && item.starLevel !== null && item.starLevel !== ''
      ? numberLabel(item.starLevel)
      : '—',
    period: formatDateTime(item.periodStartAt),
    assignedOwner: valueOf(item, 'assignedOwnerName') !== '—' ? valueOf(item, 'assignedOwnerName') : valueOf(item, 'assignedOwnerId'),
    rewardConfig: rewardConfigDisplay(item.rewardConfig),
    assignment: assignmentModeLabel(item.assignmentMode),
    assigned: numberLabel(item.assignmentCount),
    completed: numberLabel(item.completionCount),
    endsAt: formatDateTime(item.endsAt),
    updatedAt: formatDateTime(item.updatedAt),
    state: taskStatusLabel(item.status),
  }
}

function completionListRow(item: AdminTableRow) {
  return {
    detailId: valueOf(item, 'id', 'completionId'),
    rowActions: taskCompletionRowActions(item),
    task: valueOf(item, 'taskName'),
    member: valueOf(item, 'nickname'),
    reward: numberLabel(item.rewardExperience),
    completedAt: formatDateTime(item.completedAt),
    state: item.submissionStatus ? submissionStatusLabel(item.submissionStatus) : resultStatusLabel(item.resultStatus),
  }
}

function detailFields(entries: Array<[string, unknown]>) {
  return entries.map(([label, value]) => ({ label, value: display(value) }))
}

function display(value: unknown) {
  return value === undefined || value === null || value === '' ? '—' : String(value)
}

function definition(
  action: AdminTaskMutationAction,
  title: string,
  description: string,
  fields: readonly OperationField[],
  values: OperationValues,
): AdminTaskMutationDefinition {
  return { action, capability: 'tasks.manage', title, description, fields, values }
}

function reviewDefinition(
  action: AdminTaskMutationAction,
  title: string,
  description: string,
  fields: readonly OperationField[],
  values: OperationValues,
): AdminTaskMutationDefinition {
  return { action, capability: 'tasks.manage', title, description, fields, values }
}

function integer(value: unknown) {
  const number = Number(value)
  return Number.isSafeInteger(number) ? number : 0
}

function positiveInteger(value: unknown) {
  const number = Number(value)
  return Number.isSafeInteger(number) && number > 0 ? number : null
}

function safeNonNegativeInteger(value: unknown) {
  const number = Number(value)
  return Number.isSafeInteger(number) && number >= 0 ? number : null
}

function boundedInteger(value: unknown, minimum: number, maximum: number) {
  const number = Number(value)
  return Number.isSafeInteger(number) && number >= minimum && number <= maximum ? number : null
}

function text(value: unknown, maximum: number) {
  const normalized = typeof value === 'string' ? value.trim() : ''
  return normalized && normalized.length <= maximum ? normalized : ''
}

function identifier(value: unknown) {
  const normalized = typeof value === 'string' ? value.trim() : ''
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalized)
    ? normalized
    : ''
}

function optionalIdentifier(value: unknown): string | null {
  const normalized = typeof value === 'string' ? value.trim() : ''
  return normalized ? identifier(normalized) || null : ''
}

function identifiers(value: unknown, allowEmpty = false): string[] | null {
  if (!Array.isArray(value) || (!allowEmpty && !value.length) || value.length > 50) return null
  const output = [...new Set(value.map(identifier))]
  return output.every(Boolean) ? output : null
}

function profileRefs(value: unknown): string[] | null {
  if (!Array.isArray(value) || !value.length || value.length > 100) return null
  const refs = [...new Set(value.map(item => typeof item === 'string' ? item.trim() : ''))]
  return refs.every(item => item.length > 0 && item.length <= 200) ? refs : null
}

function isoDate(value: unknown): string | null {
  if (value === '' || value === undefined || value === null) return ''
  const date = new Date(String(value))
  return Number.isFinite(date.getTime()) ? date.toISOString() : null
}
