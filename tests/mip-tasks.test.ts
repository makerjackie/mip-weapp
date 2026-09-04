import type { MipTasksGateway, MipTasksRequest } from '../src/modules/mip-tasks/types'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMipTasksCloudbaseGateway } from '../src/modules/mip-tasks/cloudbase-gateway'
import { createMipTasksGateway } from '../src/modules/mip-tasks/gateway'
import { createMipTasksModule } from '../src/modules/mip-tasks/module'
import { rewardExperienceStarIndexes } from '../src/modules/mip-tasks/presentation'
import { MipTasksError } from '../src/modules/mip-tasks/types'

const cloudHarness = vi.hoisted(() => ({
  callFunction: vi.fn(),
  downloadFile: vi.fn(),
}))

const wxHarness = vi.hoisted(() => ({
  downloadFile: vi.fn(),
  saveImageToPhotosAlbum: vi.fn(),
  unlink: vi.fn(),
}))

vi.mock('../src/platform/cloudbase/client', () => ({
  requireCloudClient: vi.fn(async () => cloudHarness),
}))

vi.mock('../src/config/runtime', () => ({
  runtimeConfig: { cloudbase: { tasksFunctionName: 'mip-tasks-api' } },
}))

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

const completion = {
  id: '20000000-0000-4000-8000-000000000001',
  taskId: task.id,
  taskName: task.name,
  rewardExperience: 20,
  resultStatus: 'SUCCESS',
  completedAt: '2026-08-24T08:00:00.000Z',
  alreadyCompleted: false,
} as const

describe('MIP tasks public client', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('wx', {
      downloadFile: wxHarness.downloadFile,
      saveImageToPhotosAlbum: wxHarness.saveImageToPhotosAlbum,
      getFileSystemManager: () => ({ unlink: wxHarness.unlink }),
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('derives bounded reward stars from server-owned experience values', () => {
    expect(rewardExperienceStarIndexes(0)).toEqual([])
    expect(rewardExperienceStarIndexes(1)).toEqual([0])
    expect(rewardExperienceStarIndexes(20)).toEqual([0, 1])
    expect(rewardExperienceStarIndexes(100)).toEqual([0, 1, 2, 3, 4])
  })

  it('preserves the v1 requests for every user task operation', async () => {
    const calls: MipTasksRequest[] = []
    const gateway = createMipTasksGateway({
      async invoke(request) {
        calls.push(request)
        if (request.action === 'listTasks') {
          return { ok: true, data: { items: [task] } }
        }
        if (request.action === 'getTask') {
          return { ok: true, data: task }
        }
        return { ok: true, data: completion }
      },
    })
    const attachmentAssetId = '30000000-0000-4000-8000-000000000001'

    await expect(gateway.listTasks('mtu1.cursor', 20)).resolves.toEqual({ items: [task] })
    await expect(gateway.getTask(task.id)).resolves.toEqual(task)
    await expect(gateway.completeTask(task.id, attachmentAssetId)).resolves.toEqual(completion)

    expect(calls).toEqual([
      {
        contractVersion: 1,
        action: 'listTasks',
        input: { cursor: 'mtu1.cursor', limit: 20 },
      },
      {
        contractVersion: 1,
        action: 'getTask',
        input: { taskId: task.id },
      },
      {
        contractVersion: 1,
        action: 'completeTask',
        input: { taskId: task.id, attachmentAssetId },
      },
    ])
    expect(calls[2]?.input).not.toHaveProperty('rewardExperience')
    expect(calls[2]?.input).not.toHaveProperty('resultStatus')
  })

  it('preserves business errors and rejects malformed service data', async () => {
    const conflictGateway = createMipTasksGateway({
      async invoke() {
        return {
          ok: false,
          error: { code: 'CONFLICT', message: '任务状态已变化，请刷新后重试', retryable: true },
        }
      },
    })
    const malformedEnvelope = createMipTasksGateway({
      async invoke() {
        return { ok: true, data: { items: [] }, debug: true }
      },
    })
    const malformedTask = createMipTasksGateway({
      async invoke() {
        return { ok: true, data: { ...task, hasTemplate: true } }
      },
    })

    await expect(conflictGateway.completeTask(task.id)).rejects.toMatchObject({
      name: 'MipTasksError',
      code: 'CONFLICT',
      retryable: true,
    })
    await expect(malformedEnvelope.listTasks()).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
      retryable: true,
    })
    await expect(malformedTask.getTask(task.id)).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
      retryable: true,
    })
  })

  it('caches reads, preserves cache after failed completion, and invalidates after success', async () => {
    let listCalls = 0
    let detailCalls = 0
    let failCompletion = true
    const failure = new MipTasksError('CONFLICT', '任务已经完成')
    const gateway: MipTasksGateway = {
      async listTasks() {
        listCalls += 1
        return { items: [task] }
      },
      async getTask() {
        detailCalls += 1
        return task
      },
      async completeTask() {
        if (failCompletion) {
          throw failure
        }
        return completion
      },
    }
    const module = createMipTasksModule(gateway)

    await module.query.listTasks()
    await module.query.listTasks()
    await module.query.getTask(task.id)
    await module.query.getTask(task.id)
    expect({ listCalls, detailCalls }).toEqual({ listCalls: 1, detailCalls: 1 })

    await module.query.listTasks(undefined, undefined, true)
    expect(listCalls).toBe(2)

    await expect(module.mutation.completeTask(task.id)).rejects.toBe(failure)
    await module.query.listTasks()
    expect(listCalls).toBe(2)

    failCompletion = false
    await module.mutation.completeTask(task.id)
    await module.query.listTasks()
    await module.query.getTask(task.id)
    expect({ listCalls, detailCalls }).toEqual({ listCalls: 3, detailCalls: 2 })
  })

  it('saves local and HTTPS template images while rejecting unsafe sources', async () => {
    wxHarness.downloadFile.mockImplementation((options: {
      success: (result: { statusCode: number, tempFilePath: string }) => void
    }) => options.success({ statusCode: 200, tempFilePath: 'wxfile://tmp/template.jpg' }))
    wxHarness.saveImageToPhotosAlbum.mockImplementation((options: { success: () => void }) => {
      options.success()
    })
    const module = createMipTasksModule({} as MipTasksGateway)

    await module.saveTemplateImage('wxfile://local/template.jpg')
    await module.saveTemplateImage('https://cdn.example.com/template.jpg')

    expect(wxHarness.downloadFile).toHaveBeenCalledOnce()
    expect(wxHarness.saveImageToPhotosAlbum).toHaveBeenNthCalledWith(1, {
      filePath: 'wxfile://local/template.jpg',
      success: expect.any(Function),
      fail: expect.any(Function),
    })
    expect(wxHarness.saveImageToPhotosAlbum).toHaveBeenNthCalledWith(2, {
      filePath: 'wxfile://tmp/template.jpg',
      success: expect.any(Function),
      fail: expect.any(Function),
    })
    await expect(module.saveTemplateImage('')).rejects.toThrow('模板下载地址无效')
    await expect(module.saveTemplateImage('http://cdn.example.com/template.jpg'))
      .rejects
      .toThrow('模板下载地址无效')
    await expect(module.saveTemplateImage('cloud://mip-test/template.jpg'))
      .rejects
      .toThrow('模板下载地址无效')
  })

  it('cancels an in-flight template save when local task state is invalidated', async () => {
    let finishDownload: ((result: { statusCode: number, tempFilePath: string }) => void) | undefined
    wxHarness.downloadFile.mockImplementation((options: {
      success: (result: { statusCode: number, tempFilePath: string }) => void
    }) => {
      finishDownload = options.success
    })
    wxHarness.unlink.mockImplementation((options: { success: () => void }) => options.success())
    const module = createMipTasksModule({} as MipTasksGateway)

    const pending = module.saveTemplateImage('https://cdn.example.com/template.jpg')
    module.invalidate()
    finishDownload?.({ statusCode: 200, tempFilePath: 'wxfile://tmp/template.jpg' })

    await expect(pending).rejects.toMatchObject({
      name: 'MipTasksError',
      code: 'AUTH_REQUIRED',
    })
    expect(wxHarness.saveImageToPhotosAlbum).not.toHaveBeenCalled()
    expect(wxHarness.unlink).toHaveBeenCalledWith({
      filePath: 'wxfile://tmp/template.jpg',
      success: expect.any(Function),
      fail: expect.any(Function),
    })
  })

  it('retries CloudBase reads but never replays task completion', async () => {
    vi.useFakeTimers()
    cloudHarness.callFunction
      .mockRejectedValueOnce(new Error('cold start'))
      .mockResolvedValueOnce({ result: { ok: true, data: { items: [task] } } })
    const gateway = createMipTasksCloudbaseGateway('mip-tasks-api')

    const pending = gateway.listTasks()
    await vi.runAllTimersAsync()
    await expect(pending).resolves.toEqual({ items: [task] })
    expect(cloudHarness.callFunction).toHaveBeenCalledTimes(2)

    cloudHarness.callFunction.mockReset()
    cloudHarness.callFunction.mockRejectedValue(new Error('response lost'))
    await expect(gateway.completeTask(task.id)).rejects.toMatchObject({
      name: 'MipTasksError',
      code: 'SERVICE_UNAVAILABLE',
      retryable: true,
    })
    expect(cloudHarness.callFunction).toHaveBeenCalledOnce()
  })
})
