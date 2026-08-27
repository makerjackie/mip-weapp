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

  it('loads task detail, assignable members, and task-scoped completions', async () => {
    const calls: Array<{ action: string; input: unknown }> = []
    const detail = await loadTaskDetail(TASK_ID, requestWith({
      'mip.admin.tasks.get': {
        id: TASK_ID, name: '早会复盘', content: '提交本周复盘', rewardExperience: 30,
        attachmentRequired: true, assignmentMode: 'SELECTED', assignmentCount: 8,
        eligibleLevels: [{ id: LEVEL_ID, name: '成长会员', minimumExperience: 100, status: 'ACTIVE' }],
        endsAt: '2030-03-31T12:00:00.000Z', template: { assetId: ASSET_ID },
        status: 'PUBLISHED', version: 3, completionCount: 5,
      },
      'mip.admin.tasks.assignableMembers.list': {
        items: [{ memberRef: 'member-ref-1', nickname: '周宁', branchName: '福田分会', assignmentStatus: 'ACTIVE' }],
      },
      'mip.admin.tasks.completions.list': {
        items: [{ id: COMPLETION_ID, taskName: '早会复盘', nickname: '周宁', rewardExperience: 30, resultStatus: 'SUCCESS' }],
      },
    }, calls))

    assert.deepEqual(calls.map(call => call.action), [
      'mip.admin.tasks.get', 'mip.admin.tasks.completions.list', 'mip.admin.tasks.assignableMembers.list',
    ])
    assert.deepEqual(calls[1].input, { filters: { taskId: TASK_ID }, limit: 20 })
    assert.deepEqual(calls[2].input, { filters: { taskId: TASK_ID, query: '' }, limit: 50 })
    assert.equal(detail.route, 'tasks')
    assert.equal(detail.sections.find(section => section.title === '可分配成员')?.rows?.[0].state, '已分配')
    assert.equal(detail.sections.find(section => section.title === '完成记录')?.detailTarget, 'taskCompletions')
  })

  it('loads one completion and validates an export payload', async () => {
    const calls: Array<{ action: string; input: unknown }> = []
    const request = requestWith({
      'mip.admin.tasks.completions.get': {
        id: COMPLETION_ID, taskName: '早会复盘', taskContent: '提交本周复盘', nickname: '周宁',
        rewardExperience: 30, resultStatus: 'SUCCESS', completedAt: '2030-03-02T00:00:00.000Z',
        attachment: { url: 'https://example.test/file', contentType: 'image/jpeg', bytes: 1200 },
      },
      'mip.admin.tasks.completions.export': { fileName: 'tasks.xlsx', contentBase64: 'AA==', rowCount: 1 },
    }, calls)

    const detail = await loadTaskCompletionDetail(COMPLETION_ID, request)
    const workbook = await exportTaskCompletions(TASK_ID, request)
    assert.equal(detail.route, 'taskCompletions')
    assert.equal(detail.status, '成功')
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
    }
    const save = createTaskMutationDefinition('mip.admin.tasks.save', TASK_ID, source)
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
})
