import type {
  AdminExportReservation,
  MipAdminGateway,
} from '../src/modules/mip-admin/types'
import type {
  MipTasksGateway,
  TaskExportResult,
} from '../src/modules/mip-tasks/types'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMipAdminModule } from '../src/modules/mip-admin/client'
import { createPendingAdminExportStore } from '../src/modules/mip-admin/pending-export'
import { createMipTasksModule } from '../src/modules/mip-tasks/module'

const now = Date.parse('2026-08-26T00:00:00.000Z')
const expiresAt = '2026-08-26T00:15:00.000Z'
const token = 'a'.repeat(43)
const readyStatus = {
  status: 'READY' as const,
  rowCount: 2,
  expiresAt,
  fileName: 'mip-sensitive-export.xlsx',
  failureCode: null,
}
const reservation: AdminExportReservation = {
  status: 'RESERVED',
  tempUrl: 'https://example.test/sensitive-export.xlsx',
  fileName: readyStatus.fileName,
  contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  contentBytes: 512,
  contentSha256: 'b'.repeat(64),
  reservationExpiresAt: '2026-08-26T00:02:00.000Z',
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function pendingStore() {
  let value: unknown
  return createPendingAdminExportStore({
    read: () => value,
    write: (_key, pending) => { value = structuredClone(pending) },
    clear: () => { value = undefined },
  }, () => now)
}

function adminGateway(overrides: Partial<MipAdminGateway> = {}) {
  return {
    createExport: vi.fn(async () => ({
      ticketId: 'ticket-a',
      token,
      status: 'PENDING' as const,
      expiresAt,
    })),
    prepareExport: vi.fn(async () => readyStatus),
    reserveExport: vi.fn(async () => reservation),
    completeExport: vi.fn(async () => ({
      status: 'CONSUMED' as const,
      consumedAt: '2026-08-26T00:00:01.000Z',
    })),
    ...overrides,
  } as unknown as MipAdminGateway
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('logout fences privileged admin exports', () => {
  it('does not begin a download when logout happens while reserving the remote export', async () => {
    const reserve = deferred<AdminExportReservation>()
    const gateway = adminGateway({ reserveExport: vi.fn(() => reserve.promise) })
    const store = pendingStore()
    const downloadFile = vi.fn()
    const openDocument = vi.fn()
    const unlink = vi.fn()
    vi.stubGlobal('wx', {
      downloadFile,
      openDocument,
      getFileSystemManager: () => ({ unlink }),
    })
    const module = createMipAdminModule(gateway, { pendingExportStore: store })

    const outcome = module.exports.createAndOpen({ exportType: 'USERS' }).catch(error => error)
    await vi.waitFor(() => expect(gateway.reserveExport).toHaveBeenCalledTimes(1))

    module.invalidate()
    reserve.resolve(reservation)

    await expect(outcome).resolves.toMatchObject({ code: 'AUTH_REQUIRED' })
    expect(downloadFile).not.toHaveBeenCalled()
    expect(gateway.completeExport).not.toHaveBeenCalled()
    expect(openDocument).not.toHaveBeenCalled()
    expect(unlink).not.toHaveBeenCalled()
    expect(store.peek()).toBeNull()
  })

  it('removes the exact temporary workbook when logout finishes an in-flight download', async () => {
    let finishDownload!: (result: { statusCode: number, tempFilePath: string }) => void
    const gateway = adminGateway()
    const store = pendingStore()
    const openDocument = vi.fn()
    const unlink = vi.fn((options: { success: () => void }) => options.success())
    const downloadFile = vi.fn((options: {
      success: (result: { statusCode: number, tempFilePath: string }) => void
    }) => {
      finishDownload = options.success
    })
    vi.stubGlobal('wx', {
      downloadFile,
      openDocument,
      getFileSystemManager: () => ({ unlink }),
    })
    const module = createMipAdminModule(gateway, { pendingExportStore: store })

    const outcome = module.exports.createAndOpen({ exportType: 'USERS' }).catch(error => error)
    await vi.waitFor(() => expect(downloadFile).toHaveBeenCalledTimes(1))

    module.invalidate()
    finishDownload({ statusCode: 200, tempFilePath: '/tmp/mip-sensitive-export.xlsx' })

    await expect(outcome).resolves.toMatchObject({ code: 'AUTH_REQUIRED' })
    expect(unlink).toHaveBeenCalledWith(expect.objectContaining({
      filePath: '/tmp/mip-sensitive-export.xlsx',
    }))
    expect(gateway.completeExport).not.toHaveBeenCalled()
    expect(openDocument).not.toHaveBeenCalled()
    expect(store.peek()).toBeNull()
  })
})

describe('logout fences task completion exports', () => {
  const exportResult: TaskExportResult = {
    fileName: 'mip-task-completions.xlsx',
    contentBase64: 'c2Vuc2l0aXZlLXJvd3M=',
    rowCount: 3,
  }

  it('does not write a workbook when the export response returns after logout', async () => {
    const response = deferred<TaskExportResult>()
    const gateway = {
      exportCompletions: vi.fn(() => response.promise),
    } as unknown as MipTasksGateway
    const writeFile = vi.fn()
    const unlink = vi.fn()
    const openDocument = vi.fn()
    vi.stubGlobal('wx', {
      env: { USER_DATA_PATH: '/user-data' },
      getFileSystemManager: () => ({ writeFile, unlink }),
      openDocument,
    })
    const module = createMipTasksModule(gateway)

    const outcome = module.exportAndOpen().catch(error => error)
    await vi.waitFor(() => expect(gateway.exportCompletions).toHaveBeenCalledTimes(1))

    module.invalidate()
    response.resolve(exportResult)

    await expect(outcome).resolves.toMatchObject({ code: 'AUTH_REQUIRED' })
    expect(writeFile).not.toHaveBeenCalled()
    expect(openDocument).not.toHaveBeenCalled()
    expect(unlink).not.toHaveBeenCalled()
  })

  it('removes the exact workbook when logout finishes an in-flight write', async () => {
    let finishWrite!: () => void
    const gateway = {
      exportCompletions: vi.fn(async () => exportResult),
    } as unknown as MipTasksGateway
    const writeFile = vi.fn((options: { success: () => void }) => {
      finishWrite = options.success
    })
    const unlink = vi.fn((options: { success: () => void }) => options.success())
    const openDocument = vi.fn()
    vi.stubGlobal('wx', {
      env: { USER_DATA_PATH: '/user-data' },
      getFileSystemManager: () => ({ writeFile, unlink }),
      openDocument,
    })
    const module = createMipTasksModule(gateway)

    const outcome = module.exportAndOpen().catch(error => error)
    await vi.waitFor(() => expect(writeFile).toHaveBeenCalledTimes(1))

    module.invalidate()
    finishWrite()

    await expect(outcome).resolves.toMatchObject({ code: 'AUTH_REQUIRED' })
    expect(unlink).toHaveBeenCalledWith(expect.objectContaining({
      filePath: expect.stringMatching(
        /^\/user-data\/mip-task-export-0-\d+-1-mip-task-completions\.xlsx$/,
      ),
    }))
    expect(openDocument).not.toHaveBeenCalled()
  })

  it('removes a successfully opened workbook from this session on logout', async () => {
    const gateway = {
      exportCompletions: vi.fn(async () => exportResult),
    } as unknown as MipTasksGateway
    const writeFile = vi.fn((options: { success: () => void }) => options.success())
    const unlink = vi.fn((options: { success: () => void }) => options.success())
    const openDocument = vi.fn((options: { success: () => void }) => options.success())
    vi.stubGlobal('wx', {
      env: { USER_DATA_PATH: '/user-data' },
      getFileSystemManager: () => ({ writeFile, unlink }),
      openDocument,
    })
    const module = createMipTasksModule(gateway)

    await expect(module.exportAndOpen()).resolves.toEqual({
      fileName: exportResult.fileName,
      rowCount: exportResult.rowCount,
    })
    const writtenPath = writeFile.mock.calls[0]?.[0]?.filePath

    module.invalidate()

    await vi.waitFor(() => expect(unlink).toHaveBeenCalledWith(expect.objectContaining({
      filePath: writtenPath,
    })))
  })

  it('does not save a downloaded task template after logout', async () => {
    let finishDownload!: (result: { statusCode: number, tempFilePath: string }) => void
    const gateway = {} as MipTasksGateway
    const downloadFile = vi.fn((options: {
      success: (result: { statusCode: number, tempFilePath: string }) => void
    }) => { finishDownload = options.success })
    const unlink = vi.fn((options: { success: () => void }) => options.success())
    const saveImageToPhotosAlbum = vi.fn()
    vi.stubGlobal('wx', {
      downloadFile,
      saveImageToPhotosAlbum,
      getFileSystemManager: () => ({ unlink }),
    })
    const module = createMipTasksModule(gateway)

    const outcome = module.saveTemplateImage('https://example.test/template.png').catch(error => error)
    await vi.waitFor(() => expect(downloadFile).toHaveBeenCalledTimes(1))

    module.invalidate()
    finishDownload({ statusCode: 200, tempFilePath: '/tmp/mip-task-template.png' })

    await expect(outcome).resolves.toMatchObject({ code: 'AUTH_REQUIRED' })
    expect(unlink).toHaveBeenCalledWith(expect.objectContaining({
      filePath: '/tmp/mip-task-template.png',
    }))
    expect(saveImageToPhotosAlbum).not.toHaveBeenCalled()
  })
})
