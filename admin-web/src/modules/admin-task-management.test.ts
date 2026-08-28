import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { AdminRequest } from './admin-read-contracts.ts'
import {
  ADMIN_TASK_MUTATION_ACTIONS,
  buildTaskMutationInput,
  createTaskMutationDefinition,
  exportTaskCompletions,
  loadTaskCompletionDetail,
  loadTaskDetail,
  loadTaskEligibleLevels,
  loadTaskManagementPage,
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
    }, calls))

    assert.deepEqual(calls, [
      { action: 'mip.admin.tasks.list', input: { filters: { query: '早会', status: 'PUBLISHED' }, limit: 20, cursor: 'task-cursor' } },
      { action: 'mip.admin.tasks.completions.list', input: { filters: { query: '早会' }, limit: 20 } },
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
    }, calls), {
      members: { query: '周', cursor: 'member-cursor', limit: 10 },
      completions: { query: '复盘', cursor: 'completion-cursor', limit: 15 },
    })

    assert.deepEqual(calls.map(call => call.action), [
      'mip.admin.tasks.get', 'mip.admin.tasks.eligibleLevels.list',
      'mip.admin.tasks.completions.list', 'mip.admin.tasks.assignableMembers.list',
    ])
    assert.deepEqual(calls[2].input, {
      filters: { taskId: TASK_ID, query: '复盘' }, limit: 15, cursor: 'completion-cursor',
    })
    assert.deepEqual(calls[3].input, {
      filters: { taskId: TASK_ID, query: '周' }, limit: 10, cursor: 'member-cursor',
    })
    assert.equal(detail.route, 'tasks')
    assert.equal(detail.sections.find(section => section.title === '任务信息')?.fields?.find(field => field.label === '模板文件')?.value, '已配置，当前无法在 Web 查看')
    assert.equal(detail.sections.find(section => section.title === '任务信息')?.fields?.find(field => field.label === '模板管理')?.value, '上传与替换功能暂不可用')
    const members = detail.sections.find(section => section.title === '成员候选')
    const completions = detail.sections.find(section => section.title === '完成记录')
    assert.equal(members?.rows?.[0].state, '已分配')
    assert.deepEqual(members?.pager, {
      key: 'taskMembers', query: '周', nextCursor: 'next-member-cursor', placeholder: '搜索成员或服务器',
    })
    assert.equal(completions?.detailTarget, 'taskCompletions')
    assert.deepEqual(completions?.pager, {
      key: 'taskCompletions', query: '复盘', nextCursor: 'next-completion-cursor', placeholder: '搜索成员或任务',
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
      'mip.admin.tasks.completions.export': { fileName: 'tasks.xlsx', contentBase64: 'AA==', rowCount: 1 },
    }, calls)

    const detail = await loadTaskCompletionDetail(COMPLETION_ID, request)
    const workbook = await exportTaskCompletions(TASK_ID, request)
    assert.equal(detail.route, 'taskCompletions')
    assert.equal(detail.status, '成功')
    assert.equal(detail.sections[0].fields?.find(field => field.label === '附件')?.value, '已上传，当前无法在 Web 查看')
    assert.equal(detail.sections[0].fields?.find(field => field.label === '附件查看')?.value, '当前不可用')
    assert.deepEqual(workbook, { fileName: 'tasks.xlsx', contentBase64: 'AA==', rowCount: 1 })
    assert.deepEqual(calls, [
      { action: 'mip.admin.tasks.completions.get', input: { completionId: COMPLETION_ID } },
      { action: 'mip.admin.tasks.completions.export', input: { filters: { taskId: TASK_ID } } },
    ])
  })

  it('provides typed forms and exact business inputs for all six task mutations', () => {
    assert.equal(ADMIN_TASK_MUTATION_ACTIONS.length, 6)
    const source = {
      task: {
        id: TASK_ID, name: '早会复盘', content: '提交本周复盘', rewardExperience: 30,
        assignmentMode: 'SELECTED', attachmentRequired: true, version: 3,
        template: { assetId: ASSET_ID }, eligibleLevels: [{ id: LEVEL_ID }],
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
    })
    assert.equal(save.fields.find(field => field.name === 'templateAssetId')?.label, '任务模板素材 ID')
    assert.equal(save.fields.find(field => field.name === 'templateAssetId')?.hidden, undefined)
    assert.deepEqual(buildTaskMutationInput(save, save.values), {
      task: {
        name: '早会复盘', content: '提交本周复盘', rewardExperience: 30,
        attachmentRequired: true, assignmentMode: 'SELECTED', endsAt: '',
        templateAssetId: ASSET_ID, eligibleLevelIds: [LEVEL_ID],
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
})
