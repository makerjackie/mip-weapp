import type {
  AdminCompletionFilters,
  AdminTaskFilters,
  MipTasksGateway,
  TaskExportResult,
} from './types'
import { createQueryCache } from '@weapp/shared/cache'
import { MipTasksError } from './types'

export interface MipTasksQueryFacade {
  listTasks: (
    cursor?: string,
    limit?: number,
    force?: boolean,
  ) => ReturnType<MipTasksGateway['listTasks']>
  getTask: (taskId: string, force?: boolean) => ReturnType<MipTasksGateway['getTask']>
  getAdminSession: (force?: boolean) => ReturnType<MipTasksGateway['getAdminSession']>
  getAdminTask: (taskId: string, force?: boolean) => ReturnType<MipTasksGateway['getAdminTask']>
  listAdminTasks: (
    filters?: AdminTaskFilters,
    cursor?: string,
    limit?: number,
    force?: boolean,
  ) => ReturnType<MipTasksGateway['listAdminTasks']>
  listEligibleLevels: (force?: boolean) => ReturnType<MipTasksGateway['listEligibleLevels']>
  listAssignableMembers: (
    filters: Parameters<MipTasksGateway['listAssignableMembers']>[0],
    cursor?: string,
    limit?: number,
    force?: boolean,
  ) => ReturnType<MipTasksGateway['listAssignableMembers']>
  listCompletions: (
    filters?: AdminCompletionFilters,
    cursor?: string,
    limit?: number,
    force?: boolean,
  ) => ReturnType<MipTasksGateway['listCompletions']>
  getCompletion: (
    completionId: string,
    force?: boolean,
  ) => ReturnType<MipTasksGateway['getCompletion']>
  exportCompletions: MipTasksGateway['exportCompletions']
}

export interface MipTasksMutationFacade {
  completeTask: MipTasksGateway['completeTask']
  saveTask: MipTasksGateway['saveTask']
  publishTask: MipTasksGateway['publishTask']
  unpublishTask: MipTasksGateway['unpublishTask']
  deleteTask: MipTasksGateway['deleteTask']
  assignMembers: MipTasksGateway['assignMembers']
  revokeMembers: MipTasksGateway['revokeMembers']
}

function writeFile(filePath: string, base64: string) {
  return new Promise<void>((resolve, reject) => {
    wx.getFileSystemManager().writeFile({
      filePath,
      data: base64,
      encoding: 'base64',
      success: () => resolve(),
      fail: reject,
    })
  })
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

function openWorkbook(filePath: string) {
  return new Promise<void>((resolve, reject) => {
    wx.openDocument({
      filePath,
      fileType: 'xlsx',
      showMenu: true,
      success: () => resolve(),
      fail: reject,
    })
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
  const generatedExportFiles = new Set<string>()
  let generation = 0
  let exportFileSequence = 0

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
    getAdminSession: (force = false) => cache.query(
      cacheKey('admin-session'),
      gateway.getAdminSession,
      { force },
    ),
    getAdminTask: (taskId, force = false) => cache.query(
      cacheKey('admin-detail', { taskId }),
      () => gateway.getAdminTask(taskId),
      { force },
    ),
    listAdminTasks: (filters = {}, cursor, limit, force = false) => cache.query(
      cacheKey('admin-list', { filters, cursor, limit }),
      () => gateway.listAdminTasks(filters, cursor, limit),
      { force },
    ),
    listEligibleLevels: (force = false) => cache.query(
      cacheKey('eligible-levels'),
      gateway.listEligibleLevels,
      { force },
    ),
    listAssignableMembers: (filters, cursor, limit, force = false) => cache.query(
      cacheKey('assignable-members', { filters, cursor, limit }),
      () => gateway.listAssignableMembers(filters, cursor, limit),
      { force },
    ),
    listCompletions: (filters = {}, cursor, limit, force = false) => cache.query(
      cacheKey('completions', { filters, cursor, limit }),
      () => gateway.listCompletions(filters, cursor, limit),
      { force },
    ),
    getCompletion: (completionId, force = false) => cache.query(
      cacheKey('completion', { completionId }),
      () => gateway.getCompletion(completionId),
      { force },
    ),
    exportCompletions: filters => gateway.exportCompletions(filters),
  }

  const mutation: MipTasksMutationFacade = {
    completeTask: (taskId, attachmentAssetId) => mutate(
      () => gateway.completeTask(taskId, attachmentAssetId),
    ),
    saveTask: input => mutate(() => gateway.saveTask(input)),
    publishTask: (taskId, expectedVersion) => mutate(
      () => gateway.publishTask(taskId, expectedVersion),
    ),
    unpublishTask: (taskId, expectedVersion) => mutate(
      () => gateway.unpublishTask(taskId, expectedVersion),
    ),
    deleteTask: (taskId, expectedVersion) => mutate(
      () => gateway.deleteTask(taskId, expectedVersion),
    ),
    assignMembers: (taskId, expectedVersion, memberRefs) => mutate(
      () => gateway.assignMembers(taskId, expectedVersion, memberRefs),
    ),
    revokeMembers: (taskId, expectedVersion, memberRefs) => mutate(
      () => gateway.revokeMembers(taskId, expectedVersion, memberRefs),
    ),
  }

  async function exportAndOpen(filters?: AdminCompletionFilters): Promise<Omit<TaskExportResult, 'contentBase64'>> {
    const workflowGeneration = generation
    let filePath = ''
    let fileMayExist = false
    try {
      assertCurrent(workflowGeneration)
      const result = await query.exportCompletions(filters)
      assertCurrent(workflowGeneration)
      const safeName = result.fileName.replace(/[^\w.-]/g, '-').slice(0, 100)
      const baseName = (safeName || 'task-completions.xlsx').replace(/\.xlsx$/i, '')
      exportFileSequence += 1
      filePath = `${wx.env.USER_DATA_PATH}/mip-task-export-${workflowGeneration}-${Date.now()}-${exportFileSequence}-${baseName}.xlsx`
      assertCurrent(workflowGeneration)
      fileMayExist = true
      generatedExportFiles.add(filePath)
      await writeFile(filePath, result.contentBase64)
      assertCurrent(workflowGeneration)
      await openWorkbook(filePath)
      assertCurrent(workflowGeneration)
      return { fileName: result.fileName, rowCount: result.rowCount }
    }
    catch (error) {
      if (!isCurrent(workflowGeneration)) {
        if (fileMayExist && filePath) {
          await removeFile(filePath)
          generatedExportFiles.delete(filePath)
        }
        throw sessionEndedError()
      }
      throw error
    }
  }

  return {
    mutation,
    query,
    invalidate() {
      generation += 1
      cache.invalidate()
      for (const filePath of generatedExportFiles) {
        void removeFile(filePath)
      }
      generatedExportFiles.clear()
    },
    exportAndOpen,
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
