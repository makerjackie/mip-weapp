import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createMipTasksGateway } from '../src/modules/mip-tasks/gateway'
import { isRetryableTaskAction } from '../src/modules/mip-tasks/retry-policy'

const task = {
  id: '10000000-0000-4000-8000-000000000001',
  name: '提交合作记录',
  content: '上传一张合作记录图片。',
  rewardExperience: 20,
  attachmentRequired: true,
  endsAt: '',
  hasTemplate: false,
  version: 1,
  status: 'AVAILABLE',
} as const

describe('MIP tasks client contract', () => {
  it('submits only a task and owned attachment intent', async () => {
    const calls: Array<{ action: string, data?: Record<string, unknown> }> = []
    const gateway = createMipTasksGateway({
      async invoke(action, data) {
        calls.push({ action, data })
        if (action === 'listTasks') {
          return { ok: true, data: { items: [task] } }
        }
        return {
          ok: true,
          data: {
            id: '20000000-0000-4000-8000-000000000001',
            taskId: task.id,
            taskName: task.name,
            rewardExperience: 20,
            resultStatus: 'SUCCESS',
            completedAt: '2026-08-24T08:00:00.000Z',
            alreadyCompleted: false,
          },
        }
      },
    })

    await expect(gateway.listTasks()).resolves.toEqual({ items: [task] })
    await gateway.completeTask(task.id, '30000000-0000-4000-8000-000000000001')
    expect(calls[1]).toEqual({
      action: 'completeTask',
      data: {
        taskId: task.id,
        attachmentAssetId: '30000000-0000-4000-8000-000000000001',
      },
    })
    expect(calls[1]?.data).not.toHaveProperty('rewardExperience')
    expect(calls[1]?.data).not.toHaveProperty('resultStatus')
  })

  it('preserves capability and conflict errors for admin recovery', async () => {
    const gateway = createMipTasksGateway({
      async invoke() {
        return {
          ok: false,
          error: { code: 'CONFLICT', message: '任务状态已变化，请刷新后重试', retryable: true },
        }
      },
    })
    await expect(gateway.publishTask(task.id, 1)).rejects.toEqual(expect.objectContaining({
      name: 'MipTasksError',
      code: 'CONFLICT',
      retryable: true,
    }))
  })

  it('uses opaque member references for batch assignment and revocation intents', async () => {
    const calls: Array<{ action: string, data?: Record<string, unknown> }> = []
    const gateway = createMipTasksGateway({
      async invoke(action, data) {
        calls.push({ action, data })
        return { ok: true, data: { taskId: task.id, requestedCount: 1, changedCount: 1 } }
      },
    })
    const memberRef = 'p1.opaque-member-reference'
    await gateway.assignMembers(task.id, 2, [memberRef])
    await gateway.revokeMembers(task.id, 2, [memberRef])
    expect(calls).toEqual([
      { action: 'admin.assignMembers', data: { taskId: task.id, expectedVersion: 2, memberRefs: [memberRef] } },
      { action: 'admin.revokeMembers', data: { taskId: task.id, expectedVersion: 2, memberRefs: [memberRef] } },
    ])
    expect(JSON.stringify(calls)).not.toContain('userId')
  })

  it('retries only reads and the server-idempotent completion action', () => {
    expect(isRetryableTaskAction('listTasks')).toBe(true)
    expect(isRetryableTaskAction('completeTask')).toBe(true)
    expect(isRetryableTaskAction('admin.getTask')).toBe(true)
    expect(isRetryableTaskAction('admin.listAssignableMembers')).toBe(true)
    expect(isRetryableTaskAction('admin.exportCompletions')).toBe(true)
    expect(isRetryableTaskAction('admin.saveTask')).toBe(false)
    expect(isRetryableTaskAction('admin.publishTask')).toBe(false)
    expect(isRetryableTaskAction('admin.deleteTask')).toBe(false)
  })

  it('keeps task configuration, completion detail, filtering, export and user upload reachable', () => {
    const app = fs.readFileSync(path.join(process.cwd(), 'src/app.json'), 'utf8')
    const dashboard = fs.readFileSync(path.join(process.cwd(), 'src/packages/admin/dashboard/index.wxml'), 'utf8')
    const growth = fs.readFileSync(path.join(process.cwd(), 'src/packages/member/mip-growth/index.wxml'), 'utf8')
    const admin = fs.readFileSync(path.join(process.cwd(), 'src/packages/admin/tasks/index.wxml'), 'utf8')
    const completions = fs.readFileSync(path.join(process.cwd(), 'src/packages/admin/task-completions/index.wxml'), 'utf8')
    const assignments = fs.readFileSync(path.join(process.cwd(), 'src/packages/admin/task-assignments/index.wxml'), 'utf8')
    const detail = fs.readFileSync(path.join(process.cwd(), 'src/packages/member/mip-tasks/detail/index.wxml'), 'utf8')

    for (const route of [
      'mip-tasks/index',
      'mip-tasks/detail/index',
      'tasks/index',
      'task-assignments/index',
      'task-completions/index',
    ]) {
      expect(app).toContain(route)
    }
    expect(dashboard).toContain('/packages/admin/tasks/index')
    expect(growth).toContain('bind:tap="openTasks"')
    expect(admin).toContain('新增任务')
    expect(admin).toContain('需要上传附件')
    expect(admin).toContain('指定成员')
    expect(admin).toContain('上传模板')
    expect(completions).toContain('导出')
    expect(completions).toContain('任务内容快照')
    expect(assignments).toContain('批量派发')
    expect(assignments).toContain('批量撤销')
    expect(assignments).toContain('搜索昵称或分会')
    expect(detail).toContain('原图不超过 10MB')
    expect(detail).toContain('提交完成')
    expect(detail).toContain('保存模板图片')
    expect(detail).toContain('任务已截止')
  })
})
