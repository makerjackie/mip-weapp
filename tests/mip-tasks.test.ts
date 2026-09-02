import type { MipTasksGateway, MipTasksRequest } from '../src/modules/mip-tasks/types'
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createMipTasksGateway } from '../src/modules/mip-tasks/gateway'
import { createMipTasksModule } from '../src/modules/mip-tasks/module'
import { rewardExperienceStarIndexes } from '../src/modules/mip-tasks/presentation'
import { isRetryableTaskAction } from '../src/modules/mip-tasks/retry-policy'
import { MipTasksError } from '../src/modules/mip-tasks/types'

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
  it('derives bounded reward stars from server-owned experience values', () => {
    expect(rewardExperienceStarIndexes(0)).toEqual([])
    expect(rewardExperienceStarIndexes(1)).toEqual([0])
    expect(rewardExperienceStarIndexes(20)).toEqual([0, 1])
    expect(rewardExperienceStarIndexes(100)).toEqual([0, 1, 2, 3, 4])
  })

  it('submits only a task and owned attachment intent', async () => {
    const calls: MipTasksRequest[] = []
    const gateway = createMipTasksGateway({
      async invoke(request) {
        calls.push(request)
        if (request.action === 'listTasks') {
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
      contractVersion: 1,
      action: 'completeTask',
      input: {
        taskId: task.id,
        attachmentAssetId: '30000000-0000-4000-8000-000000000001',
      },
    })
    expect(calls[1]?.input).not.toHaveProperty('rewardExperience')
    expect(calls[1]?.input).not.toHaveProperty('resultStatus')
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
    const calls: MipTasksRequest[] = []
    const gateway = createMipTasksGateway({
      async invoke(request) {
        calls.push(request)
        return { ok: true, data: { taskId: task.id, requestedCount: 1, changedCount: 1 } }
      },
    })
    const memberRef = 'p1.opaque-member-reference'
    await gateway.assignMembers(task.id, 2, [memberRef])
    await gateway.revokeMembers(task.id, 2, [memberRef])
    expect(calls).toEqual([
      {
        contractVersion: 1,
        action: 'admin.assignMembers',
        input: { taskId: task.id, expectedVersion: 2, memberRefs: [memberRef] },
      },
      {
        contractVersion: 1,
        action: 'admin.revokeMembers',
        input: { taskId: task.id, expectedVersion: 2, memberRefs: [memberRef] },
      },
    ])
    expect(JSON.stringify(calls)).not.toContain('userId')
  })

  it('sends the exact eligible growth-level set through the admin contract', async () => {
    const calls: MipTasksRequest[] = []
    const levelId = '70000000-0000-4000-8000-000000000001'
    const gateway = createMipTasksGateway({
      async invoke(request) {
        calls.push(request)
        if (request.action === 'admin.listEligibleLevels') {
          return { ok: true, data: [{ id: levelId, levelKey: 'level-1', name: '等级 1', minimumExperience: 0, status: 'ACTIVE' }] }
        }
        return { ok: true, data: { id: task.id } }
      },
    })
    await gateway.listEligibleLevels()
    await gateway.saveTask({
      task: {
        name: task.name,
        content: task.content,
        rewardExperience: task.rewardExperience,
        attachmentRequired: false,
        assignmentMode: 'ALL',
        eligibleLevelIds: [levelId],
      },
    })
    expect(calls[0]).toEqual({ contractVersion: 1, action: 'admin.listEligibleLevels', input: {} })
    expect(calls[1]?.input).toEqual(expect.objectContaining({
      task: expect.objectContaining({ eligibleLevelIds: [levelId] }),
    }))
  })

  it('retries only read actions during a cold start', () => {
    expect(isRetryableTaskAction('listTasks')).toBe(true)
    expect(isRetryableTaskAction('completeTask')).toBe(false)
    expect(isRetryableTaskAction('admin.getTask')).toBe(true)
    expect(isRetryableTaskAction('admin.listEligibleLevels')).toBe(true)
    expect(isRetryableTaskAction('admin.listAssignableMembers')).toBe(true)
    expect(isRetryableTaskAction('admin.exportCompletions')).toBe(true)
    expect(isRetryableTaskAction('admin.saveTask')).toBe(false)
    expect(isRetryableTaskAction('admin.assignMembers')).toBe(false)
    expect(isRetryableTaskAction('admin.revokeMembers')).toBe(false)
    expect(isRetryableTaskAction('admin.publishTask')).toBe(false)
    expect(isRetryableTaskAction('admin.unpublishTask')).toBe(false)
    expect(isRetryableTaskAction('admin.deleteTask')).toBe(false)
  })

  it('keeps task versions and export filters inside the neutral v1 input', async () => {
    const calls: MipTasksRequest[] = []
    const gateway = createMipTasksGateway({
      async invoke(request) {
        calls.push(request)
        if (request.action === 'admin.exportCompletions') {
          return { ok: true, data: { fileName: 'tasks.xlsx', contentBase64: '', rowCount: 0 } }
        }
        return { ok: true, data: { id: task.id, version: 4 } }
      },
    })
    await gateway.publishTask(task.id, 3)
    await gateway.saveTask({
      taskId: task.id,
      expectedVersion: 3,
      task: {
        name: task.name,
        content: task.content,
        rewardExperience: task.rewardExperience,
        attachmentRequired: false,
        assignmentMode: 'ALL',
      },
    })
    await gateway.exportCompletions({
      taskId: task.id,
      resultStatus: 'SUCCESS',
      completedFrom: '2026-08-01T00:00:00.000Z',
    })

    expect(calls[0]).toMatchObject({
      contractVersion: 1,
      action: 'admin.publishTask',
      input: { taskId: task.id, expectedVersion: 3 },
    })
    expect(calls[1]).toMatchObject({
      contractVersion: 1,
      action: 'admin.saveTask',
      input: { taskId: task.id, expectedVersion: 3 },
    })
    expect(calls[2]).toEqual({
      contractVersion: 1,
      action: 'admin.exportCompletions',
      input: {
        filters: {
          taskId: task.id,
          resultStatus: 'SUCCESS',
          completedFrom: '2026-08-01T00:00:00.000Z',
        },
      },
    })
  })

  it('invalidates cached task queries after every successful mutation', async () => {
    let listCalls = 0
    const gateway = createMipTasksGateway({
      async invoke(request) {
        if (request.action === 'admin.listTasks') {
          listCalls += 1
          return { ok: true, data: { items: [] } }
        }
        if (request.action === 'completeTask') {
          return {
            ok: true,
            data: {
              id: '20000000-0000-4000-8000-000000000001',
              taskId: task.id,
              taskName: task.name,
              rewardExperience: 20,
              resultStatus: 'SUCCESS',
              completedAt: '2026-08-25T00:00:00.000Z',
              alreadyCompleted: false,
            },
          }
        }
        if (request.action === 'admin.assignMembers' || request.action === 'admin.revokeMembers') {
          return { ok: true, data: { taskId: task.id, requestedCount: 1, changedCount: 1 } }
        }
        return { ok: true, data: { id: task.id, version: 2 } }
      },
    })
    const module = createMipTasksModule(gateway)
    const mutations = [
      () => module.mutation.completeTask(task.id),
      () => module.mutation.saveTask({
        task: {
          name: task.name,
          content: task.content,
          rewardExperience: task.rewardExperience,
          attachmentRequired: false,
          assignmentMode: 'ALL',
        },
      }),
      () => module.mutation.publishTask(task.id, 1),
      () => module.mutation.unpublishTask(task.id, 1),
      () => module.mutation.deleteTask(task.id, 1),
      () => module.mutation.assignMembers(task.id, 1, ['p1.member']),
      () => module.mutation.revokeMembers(task.id, 1, ['p1.member']),
    ]

    await module.query.listAdminTasks()
    await module.query.listAdminTasks()
    expect(listCalls).toBe(1)
    for (const mutate of mutations) {
      await mutate()
      await module.query.listAdminTasks()
    }
    expect(listCalls).toBe(1 + mutations.length)
  })

  it.each(['CONFLICT', 'FORBIDDEN'] as const)(
    'preserves %s mutation errors and cached read state',
    async (code) => {
      let listCalls = 0
      const failure = new MipTasksError(code, `${code} message`, code === 'CONFLICT')
      const gateway = {
        async listAdminTasks() {
          listCalls += 1
          return { items: [] }
        },
        async publishTask() {
          throw failure
        },
      } as unknown as MipTasksGateway
      const module = createMipTasksModule(gateway)

      await module.query.listAdminTasks()
      await expect(module.mutation.publishTask(task.id, 1)).rejects.toBe(failure)
      await module.query.listAdminTasks()

      expect(listCalls).toBe(1)
    },
  )

  it.each([
    { items: [{ ...task, rewardExperience: '20' }] },
    { items: [{ ...task }, { ...task }] },
    { items: [{ ...task, status: 'COMPLETED' }] },
    { items: [task], nextCursor: 'eyJpZCI6InRhc2staWQifQ' },
    { items: [task], unexpected: true },
  ])('fails the entire user task page closed for malformed data %#', async (data) => {
    const gateway = createMipTasksGateway({
      async invoke() {
        return { ok: true, data }
      },
    })
    await expect(gateway.listTasks()).rejects.toEqual(expect.objectContaining({
      code: 'SERVICE_UNAVAILABLE',
      retryable: true,
    }))
  })

  it('strictly validates task detail and completion facts', async () => {
    const malformedDetail = createMipTasksGateway({
      async invoke() { return { ok: true, data: { ...task, hasTemplate: true } } },
    })
    await expect(malformedDetail.getTask(task.id)).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' })

    const malformedCompletion = createMipTasksGateway({
      async invoke() {
        return {
          ok: true,
          data: {
            id: '20000000-0000-4000-8000-000000000001',
            taskId: task.id,
            taskName: task.name,
            rewardExperience: 20,
            resultStatus: 'SUCCESS',
            completedAt: 'not-a-date',
            alreadyCompleted: false,
          },
        }
      },
    })
    await expect(malformedCompletion.completeTask(task.id)).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' })
  })

  it('rejects malformed success and error envelopes before using their contents', async () => {
    const extraSuccess = createMipTasksGateway({
      async invoke() { return { ok: true, data: { items: [] }, debug: true } },
    })
    await expect(extraSuccess.listTasks()).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' })

    const malformedError = createMipTasksGateway({
      async invoke() { return { ok: false, error: { code: 'FORBIDDEN', message: '无权限' } } },
    })
    await expect(malformedError.listTasks()).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' })
  })

  it('keeps member task completion reachable without a mini-program dispatch entry', () => {
    const app = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'src/app.json'), 'utf8')) as {
      subPackages: Array<{ root: string, pages: string[] }>
    }
    const growth = fs.readFileSync(path.join(process.cwd(), 'src/packages/member/mip-growth/index.wxml'), 'utf8')
    const memberListSource = fs.readFileSync(path.join(process.cwd(), 'src/packages/member/mip-tasks/index.ts'), 'utf8')
    const memberListView = fs.readFileSync(path.join(process.cwd(), 'src/packages/member/mip-tasks/index.wxml'), 'utf8')
    const memberDetailSource = fs.readFileSync(path.join(process.cwd(), 'src/packages/member/mip-tasks/detail/index.ts'), 'utf8')
    const moduleSource = fs.readFileSync(path.join(process.cwd(), 'src/modules/mip-tasks/module.ts'), 'utf8')
    const cloudbaseTransport = fs.readFileSync(path.join(process.cwd(), 'src/modules/mip-tasks/cloudbase-gateway.ts'), 'utf8')
    const detail = fs.readFileSync(path.join(process.cwd(), 'src/packages/member/mip-tasks/detail/index.wxml'), 'utf8')

    expect(app.subPackages.find(pkg => pkg.root === 'packages/member')?.pages).toEqual(expect.arrayContaining([
      'mip-tasks/index',
      'mip-tasks/detail/index',
    ]))
    expect(app.subPackages.find(pkg => pkg.root === 'packages/admin')?.pages).not.toEqual(expect.arrayContaining([
      'tasks/index',
      'task-assignments/index',
      'task-completions/index',
    ]))
    expect(growth).toContain('bind:tap="openTasks"')
    expect(detail).toContain('原图不超过 10MB')
    expect(detail).toContain('提交完成')
    expect(detail).toContain('保存模板图片')
    expect(detail).toContain('任务已截止')
    expect(memberListView).toContain('min-h-[88rpx]')
    expect(memberListView).toContain('starIndexes')
    expect(memberListView).not.toContain('派发任务')
    expect(memberListSource).not.toContain('getAdminSession')
    for (const source of [memberListSource, memberDetailSource]) {
      expect(source).not.toContain('mipTasksModule.gateway')
      expect(source).toContain('mipTasksModule.query')
    }
    expect(memberDetailSource).toContain('mipTasksModule.mutation.completeTask')
    expect(moduleSource).not.toMatch(/return\s*\{\s*gateway,/)
    expect(cloudbaseTransport).toContain('data: request')
    expect(cloudbaseTransport).not.toContain('{ action, ...data }')
  })
})
