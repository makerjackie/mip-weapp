import type { MipTasksGateway } from './types'
import { createQueryCache } from '@weapp/shared/cache'
import { MipTasksError } from './types'

export interface MipTasksQueryFacade {
  listTasks: (
    cursor?: string,
    limit?: number,
    force?: boolean,
  ) => ReturnType<MipTasksGateway['listTasks']>
  getTask: (taskId: string, force?: boolean) => ReturnType<MipTasksGateway['getTask']>
}

export interface MipTasksMutationFacade {
  completeTask: MipTasksGateway['completeTask']
}

function removeFile(filePath: string) {
  return new Promise<void>((resolve) => {
    try {
      wx.getFileSystemManager().unlink({
        filePath,
        success: () => resolve(),
        fail: () => resolve(),
      })
    }
    catch {
      resolve()
    }
  })
}

function downloadImage(url: string) {
  return new Promise<string>((resolve, reject) => {
    wx.downloadFile({
      url,
      success: result => result.statusCode === 200 ? resolve(result.tempFilePath) : reject(new Error('模板下载失败')),
      fail: reject,
    })
  })
}

function saveImage(filePath: string) {
  return new Promise<void>((resolve, reject) => {
    wx.saveImageToPhotosAlbum({ filePath, success: () => resolve(), fail: reject })
  })
}

export function createMipTasksModule(gateway: MipTasksGateway) {
  const cache = createQueryCache(15_000)
  let generation = 0

  function sessionEndedError() {
    return new MipTasksError('AUTH_REQUIRED', '当前会话已结束')
  }

  function isCurrent(workflowGeneration: number) {
    return workflowGeneration === generation
  }

  function assertCurrent(workflowGeneration: number) {
    if (!isCurrent(workflowGeneration)) {
      throw sessionEndedError()
    }
  }

  function cacheKey(name: string, input: unknown = {}) {
    return `mip-tasks:${name}:${JSON.stringify(input)}`
  }

  async function mutate<T>(work: () => Promise<T>) {
    const result = await work()
    cache.invalidate('mip-tasks')
    return result
  }

  const query: MipTasksQueryFacade = {
    listTasks: (cursor, limit, force = false) => cache.query(
      cacheKey('list', { cursor, limit }),
      () => gateway.listTasks(cursor, limit),
      { force },
    ),
    getTask: (taskId, force = false) => cache.query(
      cacheKey('detail', { taskId }),
      () => gateway.getTask(taskId),
      { force },
    ),
  }

  const mutation: MipTasksMutationFacade = {
    completeTask: (taskId, attachmentAssetId) => mutate(
      () => gateway.completeTask(taskId, attachmentAssetId),
    ),
  }

  return {
    mutation,
    query,
    invalidate() {
      generation += 1
      cache.invalidate()
    },
    async saveTemplateImage(url: string) {
      const workflowGeneration = generation
      let downloadedFilePath = ''
      if (!url || /^cloud:\/\//.test(url) || /^http:\/\//.test(url)) {
        throw new Error('模板下载地址无效')
      }
      try {
        assertCurrent(workflowGeneration)
        const filePath = /^https:\/\//.test(url) ? await downloadImage(url) : url
        if (filePath !== url) {
          downloadedFilePath = filePath
        }
        assertCurrent(workflowGeneration)
        await saveImage(filePath)
        assertCurrent(workflowGeneration)
      }
      catch (error) {
        if (!isCurrent(workflowGeneration)) {
          if (downloadedFilePath) {
            await removeFile(downloadedFilePath)
          }
          throw sessionEndedError()
        }
        throw error
      }
    },
  }
}
