import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { AdminRequest } from './admin-read-contracts.ts'
import {
  ADMIN_TASK_MUTATION_ACTIONS,
  buildTaskMutationInput,
  taskValidationMessage,
  createTaskMutationDefinition,
  exportTaskCompletions,
  loadTaskCompletionDetail,
  loadTaskDetail,
  loadTaskEligibleLevels,
  loadTaskApprovalPage,
  loadTaskManagementPage,
  buildTaskApprovalPage,
  taskApprovalStarLabel,
  explainTaskAssignment,
} from './admin-task-management.ts'

const TASK_ID = '10000000-0000-4000-8000-000000000001'
const LEVEL_ID = '20000000-0000-4000-8000-000000000002'
const COMPLETION_ID = '30000000-0000-4000-8000-000000000003'
const ASSET_ID = '40000000-0000-4000-8000-000000000004'

function requestWith(responses: Record<string, unknown>, calls: Array<{ action: string; input: unknown }>): AdminRequest {
  return async <T>(action: string, input = {}) => {
    calls.push({ action, input })
    return responses[action] as T
  }
}

describe('admin task management', () => {
  it('loads task and completion sections through neutral cursor queries', async () => {
    const calls: Array<{ action: string; input: unknown }> = []
    const page = await loadTaskManagementPage({
      query: '早会', status: 'PUBLISHED', cursor: 'task-cursor', limit: 20,
    }, requestWith({
      'mip.admin.tasks.list': {
        items: [{ id: TASK_ID, name: '早会复盘', rewardExperience: 30, assignmentMode: 'SELECTED', assignmentCount: 8, completionCount: 5, endsAt: '2030-03-31T12:00:00.000Z', updatedAt: '2030-03-01T00:00:00.000Z', status: 'PUBLISHED' }],
        nextCursor: 'next-task-cursor',
      },
      'mip.admin.tasks.completions.list': {
        items: [{ id: COMPLETION_ID, taskName: '早会复盘', nickname: '林晓', rewardExperience: 30, completedAt: '2030-03-02T00:00:00.000Z', resultStatus: 'SUCCESS' }],
      },
      'mip.admin.tasks.editorOptions': { owners: [{ id: TASK_ID, name: '周宁' }] },
    }, calls))

    assert.deepEqual(calls, [
      { action: 'mip.admin.tasks.list', input: { filters: { query: '早会', status: 'PUBLISHED' }, limit: 20, cursor: 'task-cursor' } },
      { action: 'mip.admin.tasks.completions.list', input: { filters: { query: '早会' }, limit: 20 } },
      { action: 'mip.admin.tasks.editorOptions', input: {} },
    ])
    assert.equal(page.nextCursor, 'next-task-cursor')
    assert.equal(page.sections[0].rows[0].detailId, TASK_ID)
    assert.equal(page.sections[0].rows[0].assignment, '指定成员')
    assert.equal(page.sections[1].rows[0].detailId, COMPLETION_ID)
    assert.equal(page.sections[1].rows[0].state, '成功')
  })

  it('loads task detail with explicit levels and independent member and completion cursors', async () => {
    const calls: Array<{ action: string; input: unknown }> = []
    const detail = await loadTaskDetail(TASK_ID, requestWith({
      'mip.admin.tasks.get': {
        id: TASK_ID, name: '早会复盘', content: '提交本周复盘', rewardExperience: 30,
        attachmentRequired: true, assignmentMode: 'SELECTED', assignmentCount: 8,
        eligibleLevels: [{ id: LEVEL_ID, name: '成长会员', minimumExperience: 100, status: 'ACTIVE' }],
        endsAt: '2030-03-31T12:00:00.000Z', template: { assetId: ASSET_ID },
        status: 'PUBLISHED', version: 3, completionCount: 5,
      },
      'mip.admin.tasks.eligibleLevels.list': [
        { id: LEVEL_ID, name: '成长会员', minimumExperience: 100, status: 'ACTIVE' },
      ],
      'mip.admin.tasks.assignableMembers.list': {
        items: [{ memberRef: 'member-ref-1', nickname: '周宁', branchName: '福田分会', assignmentStatus: 'ACTIVE' }],
        nextCursor: 'next-member-cursor',
      },
      'mip.admin.tasks.completions.list': {
        items: [{ id: COMPLETION_ID, taskName: '早会复盘', nickname: '周宁', rewardExperience: 30, resultStatus: 'SUCCESS' }],
        nextCursor: 'next-completion-cursor',
      },
      'mip.admin.tasks.editorOptions': { owners: [{ id: TASK_ID, name: '周宁' }] },
    }, calls), {
      members: { query: '周', cursor: 'member-cursor', limit: 10 },
      completions: { query: '复盘', cursor: 'completion-cursor', limit: 15 },
    })

    assert.deepEqual(calls.map(call => call.action), [
      'mip.admin.tasks.get', 'mip.admin.tasks.eligibleLevels.list', 'mip.admin.tasks.editorOptions',
      'mip.admin.tasks.completions.list', 'mip.admin.tasks.assignableMembers.list',
    ])
    assert.deepEqual(calls[3].input, {
      filters: { taskId: TASK_ID, query: '复盘' }, limit: 15, cursor: 'completion-cursor',
    })
    assert.deepEqual(calls[4].input, {
      filters: { taskId: TASK_ID, query: '周' }, limit: 10, cursor: 'member-cursor',
    })
    assert.equal(detail.route, 'tasks')
    assert.equal(detail.sections.find(section => section.title === '任务信息')?.fields?.find(field => field.label === '模板文件')?.value, '已配置，当前无法在 Web 查看')
    assert.equal(detail.sections.find(section => section.title === '任务信息')?.fields?.find(field => field.label === '模板管理')?.value, '编辑任务时可上传与替换模板')
    const members = detail.sections.find(section => section.title === '成员候选')
    const completions = detail.sections.find(section => section.title === '完成记录')
    assert.equal(members?.rows?.[0].state, '已分配')
    assert.deepEqual(members?.pager, {
      key: 'taskMembers', query: '周', currentCursor: 'member-cursor', nextCursor: 'next-member-cursor', placeholder: '搜索成员或服务器',
    })
    assert.equal(completions?.detailTarget, 'taskCompletions')
    assert.deepEqual(completions?.pager, {
      key: 'taskCompletions', query: '复盘', currentCursor: 'completion-cursor', nextCursor: 'next-completion-cursor', placeholder: '搜索成员或任务',
    })
    assert.equal(Array.isArray(detail.source?.eligibleLevelCatalog), true)
  })

  it('loads one completion without inventing a Web attachment URL and validates an export payload', async () => {
    const calls: Array<{ action: string; input: unknown }> = []
    const request = requestWith({
      'mip.admin.tasks.completions.get': {
        id: COMPLETION_ID, taskName: '早会复盘', taskContent: '提交本周复盘', nickname: '周宁',
        rewardExperience: 30, resultStatus: 'SUCCESS', completedAt: '2030-03-02T00:00:00.000Z',
        attachment: { assetId: ASSET_ID, contentType: 'image/jpeg', bytes: 1200 },
      },
      'mip.admin.tasks.completions.export': { fileName: 'tasks.xlsx', contentBase64: 'UEsDBA==', rowCount: 1 },
    }, calls)

    const detail = await loadTaskCompletionDetail(COMPLETION_ID, request)
    const workbook = await exportTaskCompletions(TASK_ID, request)
    assert.equal(detail.route, 'taskCompletions')
    assert.equal(detail.status, '成功')
    assert.equal(detail.sections[0].fields?.find(field => field.label === '附件')?.value, '已上传，当前无法在 Web 查看')
    assert.equal(detail.sections[0].fields?.find(field => field.label === '附件查看')?.value, '当前不可用')
    assert.deepEqual(workbook, { fileName: 'tasks.xlsx', contentBase64: 'UEsDBA==', rowCount: 1 })
    assert.deepEqual(calls, [
      { action: 'mip.admin.tasks.completions.get', input: { completionId: COMPLETION_ID } },
      { action: 'mip.admin.tasks.completions.export', input: { filters: { taskId: TASK_ID } } },
    ])
  })

  it('loads the cross-task approval list with a guarded submission status filter', async () => {
    const calls: Array<{ action: string; input: unknown }> = []
    const page = await loadTaskApprovalPage({
      query: '复盘', status: 'pending_review', cursor: 'approval-cursor', limit: 20,
    }, requestWith({
      'mip.admin.tasks.completions.list': {
        items: [
          {
            id: COMPLETION_ID, taskName: '早会复盘', nickname: '林晓', starLevel: 3,
            submissionStatus: 'pending_review', completedAt: '2030-03-02T00:00:00.000Z',
            attachment: { url: '', contentType: 'image/jpeg', bytes: 1200 }, rewardResult: {}, canReview: true,
          },
          {
            id: LEVEL_ID, taskName: '机会跟进', nickname: '陈默', starLevel: 0,
            submissionStatus: 'reward_failed', reviewedBy: TASK_ID,
            rewardResult: { error: '奖励发放失败，可重试' }, canReview: true,
          },
        ],
        nextCursor: 'next-approval-cursor',
      },
      'mip.admin.tasks.editorOptions': { owners: [{ id: TASK_ID, name: '笨笨老大' }] },
    }, calls))

    assert.deepEqual(calls, [
      { action: 'mip.admin.tasks.completions.list', input: { filters: { query: '复盘', submissionStatus: 'pending_review' }, limit: 20, cursor: 'approval-cursor' } },
      { action: 'mip.admin.tasks.editorOptions', input: {} },
    ])
    const section = page.sections[0]
    assert.equal(section.detailTarget, 'taskApprovals')
    assert.deepEqual(section.columns.map(column => column.label), ['提交人', '任务名称', '星级', '附件', '审批人', '审批状态', '奖励结果'])
    assert.equal(page.nextCursor, 'next-approval-cursor')
    const [pending, failed] = section.rows
    assert.equal(pending.member, '林晓')
    assert.equal(pending.starLevel, '三星')
    assert.equal(pending.attachment, '已上传')
    assert.equal(pending.reviewedBy, '—')
    assert.equal(pending.state, '待审批')
    assert.deepEqual((pending.rowActions ?? []).map(operation => operation.action), [
      'mip.admin.tasks.submissions.approve', 'mip.admin.tasks.submissions.reject',
    ])
    assert.equal(failed.starLevel, '—')
    assert.equal(failed.attachment, '未上传')
    assert.equal(failed.reviewedBy, '笨笨老大')
    assert.equal(failed.state, '奖励发放失败')
    assert.equal(failed.rewardResult, '奖励发放失败，可重试')
    assert.deepEqual((failed.rowActions ?? []).map(operation => operation.action), [
      'mip.admin.tasks.submissions.retryReward',
    ])
  })

  it('ignores unknown approval statuses and builds demo rows from completion records', async () => {
    const calls: Array<{ action: string; input: unknown }> = []
    await loadTaskApprovalPage({ query: '', status: 'BOGUS', cursor: null, limit: 20 }, requestWith({
      'mip.admin.tasks.completions.list': { items: [], nextCursor: null },
      'mip.admin.tasks.editorOptions': {},
    }, calls))
    assert.deepEqual(calls, [
      { action: 'mip.admin.tasks.completions.list', input: { filters: { query: '', submissionStatus: '' }, limit: 20, cursor: undefined } },
      { action: 'mip.admin.tasks.editorOptions', input: {} },
    ])
    const built = buildTaskApprovalPage([{
      id: COMPLETION_ID, taskName: '早会复盘', nickname: '周宁', starLevel: 5,
      submissionStatus: 'approved', reviewedBy: 'not-in-catalog', reviewedByName: '笨笨老大',
      rewardResult: { experience: { amount: 30, status: 'OFFLINE_PENDING' } },
    }], null)
    assert.equal(built.sections[0].rows[0].starLevel, '五星')
    assert.equal(built.sections[0].rows[0].state, '已通过')
    assert.equal(built.sections[0].rows[0].reviewedBy, '笨笨老大')
    assert.equal(built.sections[0].rows[0].rewardResult, '经验值 30（待线下发放）')
    assert.equal(taskApprovalStarLabel(6), '—')
    assert.equal(taskApprovalStarLabel(undefined), '—')
  })

  it('provides typed forms and exact business inputs for all task mutations', () => {
    assert.equal(ADMIN_TASK_MUTATION_ACTIONS.length, 10)
    const source = {
      task: {
        id: TASK_ID, name: '早会复盘', content: '提交本周复盘', rewardExperience: 30,
        assignmentMode: 'SELECTED', attachmentRequired: true, version: 3,
        template: { assetId: ASSET_ID }, eligibleLevels: [{ id: LEVEL_ID }],
        purpose: '交付复盘', completionCriteria: '提交截图', assignedOwnerId: TASK_ID,
      },
      assignableMembers: [
        { memberRef: 'member-ref-new', nickname: '陈默', assignmentStatus: 'NONE' },
        { memberRef: 'member-ref-active', nickname: '周宁', assignmentStatus: 'ACTIVE' },
      ],
      eligibleLevelCatalog: [
        { id: LEVEL_ID, name: '成长会员', minimumExperience: 100, status: 'ACTIVE' },
      ],
    }
    const save = createTaskMutationDefinition('mip.admin.tasks.save', TASK_ID, source)
    assert.deepEqual(save.fields.find(field => field.name === 'eligibleLevelIds'), {
      name: 'eligibleLevelIds',
      label: '可参与等级（不选择表示不限）',
      kind: 'multi-select',
      options: [{ value: LEVEL_ID, label: '成长会员 · 100 经验' }],
      wide: true,
      emptyHint: '暂无可选等级。等级在「等级管理」页的等级配置中维护',
    })
    assert.equal(save.fields.find(field => field.name === 'templateAssetId')?.label, '任务模板图片')
    assert.equal(save.fields.find(field => field.name === 'templateAssetId')?.hidden, undefined)
    assert.deepEqual(buildTaskMutationInput(save, save.values), {
      task: {
        name: '早会复盘', content: '提交本周复盘', rewardExperience: 30,
        attachmentRequired: true, assignmentMode: 'SELECTED', endsAt: '',
        templateAssetId: ASSET_ID, eligibleLevelIds: [LEVEL_ID],
        starLevel: 1, purpose: '交付复盘', completionCriteria: '提交截图',
        periodStartAt: '', periodEndAt: '', weeklyDeliverAt: '',
        assignedOwnerId: TASK_ID, applicableServers: [],
        rewardConfig: { experience: { enabled: true, amount: 30 }, contribution: { enabled: false, amount: 0 }, bonus: { enabled: false, amount: 0 } },
        actionType: null, actionTarget: null,
      },
      taskId: TASK_ID,
      expectedVersion: 3,
    })

    // MIW-84：点击动作——PAGE_JUMP 必须选白名单目标页；SHARE 不带目标；越界目标拒绝提交。
    const jumpSource = {
      ...source,
      task: { ...source.task, actionType: 'PAGE_JUMP', actionTarget: 'pages/events/index' },
    }
    const jump = createTaskMutationDefinition('mip.admin.tasks.save', TASK_ID, jumpSource)
    assert.deepEqual(buildTaskMutationInput(jump, jump.values), {
      task: {
        name: '早会复盘', content: '提交本周复盘', rewardExperience: 30,
        attachmentRequired: true, assignmentMode: 'SELECTED', endsAt: '',
        templateAssetId: ASSET_ID, eligibleLevelIds: [LEVEL_ID],
        starLevel: 1, purpose: '交付复盘', completionCriteria: '提交截图',
        periodStartAt: '', periodEndAt: '', weeklyDeliverAt: '',
        assignedOwnerId: TASK_ID, applicableServers: [],
        rewardConfig: { experience: { enabled: true, amount: 30 }, contribution: { enabled: false, amount: 0 }, bonus: { enabled: false, amount: 0 } },
        actionType: 'PAGE_JUMP', actionTarget: 'pages/events/index',
      },
      taskId: TASK_ID,
      expectedVersion: 3,
    })
    assert.equal(buildTaskMutationInput(jump, { ...jump.values, actionTarget: 'packages/admin/tasks/index' }), null)
    assert.equal(buildTaskMutationInput(jump, { ...jump.values, actionTarget: 'pages/events/index?from=task' }), null)
    assert.equal(buildTaskMutationInput(jump, { ...jump.values, actionTarget: '' }), null)
    const share = createTaskMutationDefinition('mip.admin.tasks.save', TASK_ID, {
      ...source,
      task: { ...source.task, actionType: 'SHARE', actionTarget: 'pages/events/index' },
    })
    assert.deepEqual(buildTaskMutationInput(share, share.values), {
      task: {
        name: '早会复盘', content: '提交本周复盘', rewardExperience: 30,
        attachmentRequired: true, assignmentMode: 'SELECTED', endsAt: '',
        templateAssetId: ASSET_ID, eligibleLevelIds: [LEVEL_ID],
        starLevel: 1, purpose: '交付复盘', completionCriteria: '提交截图',
        periodStartAt: '', periodEndAt: '', weeklyDeliverAt: '',
        assignedOwnerId: TASK_ID, applicableServers: [],
        rewardConfig: { experience: { enabled: true, amount: 30 }, contribution: { enabled: false, amount: 0 }, bonus: { enabled: false, amount: 0 } },
        actionType: 'SHARE', actionTarget: null,
      },
      taskId: TASK_ID,
      expectedVersion: 3,
    })
    assert.deepEqual(buildTaskMutationInput(share, { ...share.values, actionType: 'URL' }), {
      task: {
        name: '早会复盘', content: '提交本周复盘', rewardExperience: 30,
        attachmentRequired: true, assignmentMode: 'SELECTED', endsAt: '',
        templateAssetId: ASSET_ID, eligibleLevelIds: [LEVEL_ID],
        starLevel: 1, purpose: '交付复盘', completionCriteria: '提交截图',
        periodStartAt: '', periodEndAt: '', weeklyDeliverAt: '',
        assignedOwnerId: TASK_ID, applicableServers: [],
        rewardConfig: { experience: { enabled: true, amount: 30 }, contribution: { enabled: false, amount: 0 }, bonus: { enabled: false, amount: 0 } },
        actionType: null, actionTarget: null,
      },
      taskId: TASK_ID,
      expectedVersion: 3,
    })

    for (const action of ['mip.admin.tasks.publish', 'mip.admin.tasks.unpublish', 'mip.admin.tasks.delete'] as const) {
      const definition = createTaskMutationDefinition(action, TASK_ID, source)
      assert.deepEqual(buildTaskMutationInput(definition, definition.values), { taskId: TASK_ID, expectedVersion: 3 })
    }
    const assign = createTaskMutationDefinition('mip.admin.tasks.assignMembers', TASK_ID, source)
    const revoke = createTaskMutationDefinition('mip.admin.tasks.revokeMembers', TASK_ID, source)
    assert.deepEqual(assign.fields[0].options, [{ value: 'member-ref-new', label: '陈默' }])
    assert.deepEqual(revoke.fields[0].options, [{ value: 'member-ref-active', label: '周宁' }])
    assert.deepEqual(buildTaskMutationInput(assign, { ...assign.values, memberRefs: ['member-ref-new'] }), {
      taskId: TASK_ID, expectedVersion: 3, memberRefs: ['member-ref-new'],
    })
    assert.deepEqual(buildTaskMutationInput(revoke, { ...revoke.values, memberRefs: ['member-ref-active'] }), {
      taskId: TASK_ID, expectedVersion: 3, memberRefs: ['member-ref-active'],
    })
  })

  it('loads only active well-formed task levels through the exact catalog action', async () => {
    const calls: Array<{ action: string; input: unknown }> = []
    const levels = await loadTaskEligibleLevels(requestWith({
      'mip.admin.tasks.eligibleLevels.list': [
        { id: LEVEL_ID, name: '成长会员', minimumExperience: 100, status: 'ACTIVE' },
      ],
    }, calls))
    assert.deepEqual(calls, [{ action: 'mip.admin.tasks.eligibleLevels.list', input: {} }])
    assert.deepEqual(levels, [{ id: LEVEL_ID, name: '成长会员', minimumExperience: 100, status: 'ACTIVE' }])
  })

  it('keeps reviewer authority server-owned even when a client sends bossApproved', () => {
    const source = { submission: { id: COMPLETION_ID, reviewRemark: '' }, requiresBossApproval: true }
    const approve = createTaskMutationDefinition('mip.admin.tasks.submissions.approve', COMPLETION_ID, source)
    const bossField = approve.fields.find(field => field.name === 'bossApproved')
    assert.equal(bossField, undefined)
    assert.equal(approve.values.bossApproved, undefined)
    const input = buildTaskMutationInput(approve, { ...approve.values, bossApproved: true, remark: '符合标准' })
    assert.equal((input as Record<string, unknown>)?.bossApproved, undefined)
    assert.equal((input as Record<string, unknown>)?.remark, '符合标准')
  })

  it('does not include bossApproved in approve output when checkbox is unchecked', () => {
    const source = { submission: { id: COMPLETION_ID, reviewRemark: '' } }
    const approve = createTaskMutationDefinition('mip.admin.tasks.submissions.approve', COMPLETION_ID, source)
    const input = buildTaskMutationInput(approve, { ...approve.values, bossApproved: false, remark: '通过' })
    assert.equal((input as Record<string, unknown>)?.bossApproved, undefined)
    assert.equal((input as Record<string, unknown>)?.remark, '通过')
  })
})

it('explains missing rewards and malformed weekly times without issuing a save', () => {
  assert.equal(taskValidationMessage({ rewardConfig: { experience: { enabled: false }, contribution: { enabled: false }, bonus: { enabled: false } } }), '请至少启用一项奖励：经验值、贡献值或线下奖金。')
  assert.equal(taskValidationMessage({ rewardConfig: { experience: { enabled: true, amount: 1 } }, weeklyDeliverAt: '25:99' }), '周送达时间请按 HH:mm 填写，例如 09:30。')
})

describe('novice-friendly task form contracts', () => {
  it('renders the weekly delivery time as a picker and keeps the level selector guided', async () => {
    const definition = createTaskMutationDefinition('mip.admin.tasks.save', '', { eligibleLevelCatalog: [], editorOptions: {} })
    const weekly = definition.fields.find(field => field.name === 'weeklyDeliverAt')
    assert.equal(weekly?.kind, 'time')
    const levels = definition.fields.find(field => field.name === 'eligibleLevelIds')
    assert.ok((levels?.emptyHint || '').includes('等级'))
  })
})

describe('R2 novice walkthrough fixes', () => {
  it('marks weekly dispatch fields required only in weekly mode and explains silent rules', () => {
    const definition = createTaskMutationDefinition('mip.admin.tasks.assign', 'task-1', {})
    const flat = definition.fields.flatMap(field => field.name === 'weeklyDeliverAt' || field.name === 'weeklyStartAt' || field.name === 'weeklyEndAt' ? [field] : [])
    for (const field of flat) {
      assert.deepEqual((field as { requiredWhen?: unknown }).requiredWhen, { path: 'assignMode', values: ['weekly'] })
    }
    assert.equal(explainTaskAssignment({ assignMode: 'batch' }), '请至少选择一类接收对象：成员、角色、服务器或标签')
    assert.equal(explainTaskAssignment({ assignMode: 'weekly', recipients: ['p1.x'], weeklyDeliverAt: '', weeklyStartAt: '', weeklyEndAt: '' }), '每周派发需要填写周送达时间、周开始和周结束')
    assert.equal(explainTaskAssignment({ assignMode: 'weekly', recipients: ['p1.x'], weeklyDeliverAt: '09:00', weeklyStartAt: '2030-01-06T00:00:00Z', weeklyEndAt: '2030-01-05T00:00:00Z' }), '周派发结束时间必须晚于开始时间')
    assert.equal(explainTaskAssignment({ assignMode: 'weekly', recipients: ['p1.x'], weeklyDeliverAt: '09:00', weeklyStartAt: '2030-01-06T00:00:00Z', weeklyEndAt: '2030-01-13T00:00:00Z' }), null)
  })
})
