import type { PendingAdminExport, PendingAdminExportStore } from './pending-export'
import type {
  AdminExportDownloadResult,
  AdminExportStatus,
  AdminExportStatusValue,
  MipAdminGateway,
} from './types'
import { MipAdminError } from './error'

export type ExportAdminGateway = Pick<
  MipAdminGateway,
  | 'createExport'
  | 'getExportStatus'
  | 'prepareExport'
  | 'reserveExport'
  | 'completeExport'
>

export type ExportProgress = 'creating' | 'checking' | 'preparing' | 'downloading' | 'opening'

export interface PendingAdminExportStatus extends AdminExportStatus {
  ticketId: string
}

interface ExportRuntime {
  downloadFile: (options: {
    url: string
    success: (result: { statusCode: number, tempFilePath: string }) => void
    fail: () => void
  }) => unknown
  openDocument: (options: {
    filePath: string
    fileType: 'xlsx'
    showMenu: boolean
    success: () => void
    fail: () => void
  }) => unknown
  getFileSystemManager?: () => {
    unlink: (options: {
      filePath: string
      success: () => void
      fail: () => void
    }) => unknown
  }
}

export interface ExportSessionFence {
  isCurrent: () => boolean
}

interface ExportWorkflowOptions {
  runtime?: ExportRuntime
  pendingStore?: PendingAdminExportStore
  onProgress?: (progress: ExportProgress) => void
  wait?: (milliseconds: number) => Promise<void>
  preparePendingImmediately?: boolean
  sessionFence?: ExportSessionFence
}

const terminalStatuses = new Set<AdminExportStatusValue>([
  'CONSUMED',
  'EXPIRED',
  'REVOKED',
  'FAILED',
])
const identityLossCodes = new Set([
  'AUTH_REQUIRED',
  'AGREEMENT_REQUIRED',
  'PROFILE_REQUIRED',
  'FORBIDDEN',
  'EXPORT_NOT_FOUND',
])
const terminalErrorCodes = new Set([
  'EXPORT_CONSUMED',
  'EXPORT_EXPIRED',
  'EXPORT_FAILED',
  'EXPORT_INTEGRITY_FAILED',
  'EXPORT_TOO_LARGE',
  'INVALID_RESPONSE',
])

const transientPendingStore: PendingAdminExportStore = {
  save: () => null,
  peek: () => null,
  clear: () => {},
}

function wait(milliseconds: number) {
  return new Promise<void>(resolve => setTimeout(resolve, milliseconds))
}

function sessionEndedError() {
  return new MipAdminError('AUTH_REQUIRED', '当前会话已结束')
}

function isSessionCurrent(options: ExportWorkflowOptions) {
  return options.sessionFence?.isCurrent() !== false
}

function assertSessionCurrent(options: ExportWorkflowOptions) {
  if (!isSessionCurrent(options)) {
    throw sessionEndedError()
  }
}

async function waitInCurrentSession<T>(promise: Promise<T>, options: ExportWorkflowOptions) {
  try {
    const result = await promise
    assertSessionCurrent(options)
    return result
  }
  catch (error) {
    assertSessionCurrent(options)
    throw error
  }
}

function removeTemporaryFile(runtime: ExportRuntime, filePath: string) {
  return new Promise<void>((resolve) => {
    try {
      const fileSystem = runtime.getFileSystemManager?.()
      if (!fileSystem) {
        resolve()
        return
      }
      fileSystem.unlink({
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

function download(runtime: ExportRuntime, url: string) {
  return new Promise<string>((resolve, reject) => {
    runtime.downloadFile({
      url,
      success(result) {
        if (result.statusCode === 200 && result.tempFilePath) {
          resolve(result.tempFilePath)
        }
        else {
          reject(new MipAdminError('EXPORT_DOWNLOAD_FAILED', '导出文件下载失败', true))
        }
      },
      fail() {
        reject(new MipAdminError('EXPORT_DOWNLOAD_FAILED', '导出文件下载失败', true))
      },
    })
  })
}

function openDocument(runtime: ExportRuntime, filePath: string) {
  return new Promise<void>((resolve, reject) => {
    runtime.openDocument({
      filePath,
      fileType: 'xlsx',
      showMenu: true,
      success: resolve,
      fail() {
        reject(new MipAdminError('EXPORT_OPEN_FAILED', '导出文件无法打开'))
      },
    })
  })
}

async function waitUntilReady(
  gateway: ExportAdminGateway,
  ticketId: string,
  token: string,
  initial: AdminExportStatus,
  waitFor: (milliseconds: number) => Promise<void>,
  options: ExportWorkflowOptions,
) {
  let status = initial
  for (let attempt = 0; attempt < 20 && status.status === 'PENDING'; attempt += 1) {
    assertSessionCurrent(options)
    await waitInCurrentSession(
      waitFor(Math.max(300, Math.min(status.retryAfterMs || 500, 2_000))),
      options,
    )
    assertSessionCurrent(options)
    status = await waitInCurrentSession(gateway.prepareExport(ticketId, token), options)
  }
  if (status.status === 'READY') {
    return status
  }
  if (status.status === 'FAILED') {
    throw new MipAdminError(status.failureCode || 'EXPORT_FAILED', '导出任务处理失败')
  }
  throw new MipAdminError('EXPORT_NOT_READY', '导出文件尚未就绪', true)
}

function terminalStatusError(status: AdminExportStatus) {
  if (status.status === 'CONSUMED') {
    return new MipAdminError('EXPORT_CONSUMED', '导出文件已下载')
  }
  if (status.status === 'EXPIRED') {
    return new MipAdminError('EXPORT_EXPIRED', '导出任务已过期')
  }
  if (status.status === 'REVOKED') {
    return new MipAdminError('EXPORT_INTEGRITY_FAILED', '导出文件不可用')
  }
  return new MipAdminError(status.failureCode || 'EXPORT_FAILED', '导出任务处理失败')
}

function shouldDiscardPending(error: unknown) {
  if (!(error instanceof MipAdminError)) {
    return false
  }
  if (identityLossCodes.has(error.code) || terminalErrorCodes.has(error.code)) {
    return true
  }
  return error.code.startsWith('EXPORT_')
    && !error.retryable
    && !['EXPORT_BUSY', 'EXPORT_NOT_READY', 'EXPORT_STORAGE_UNAVAILABLE', 'EXPORT_URL_UNAVAILABLE'].includes(error.code)
}

async function observePendingExport(
  gateway: ExportAdminGateway,
  pendingStore: PendingAdminExportStore,
  options: ExportWorkflowOptions,
) {
  assertSessionCurrent(options)
  const pending = pendingStore.peek()
  if (!pending) {
    return null
  }
  assertSessionCurrent(options)
  options.onProgress?.('checking')
  try {
    assertSessionCurrent(options)
    const status = await waitInCurrentSession(
      gateway.getExportStatus(pending.ticketId, pending.token),
      options,
    )
    if (terminalStatuses.has(status.status)) {
      assertSessionCurrent(options)
      pendingStore.clear(pending.ticketId)
    }
    return { pending, status }
  }
  catch (error) {
    if (shouldDiscardPending(error)) {
      pendingStore.clear(pending.ticketId)
    }
    if (error instanceof MipAdminError && identityLossCodes.has(error.code)) {
      return null
    }
    throw error
  }
}

async function openPreparedExport(
  gateway: ExportAdminGateway,
  pending: PendingAdminExport,
  status: AdminExportStatus,
  options: ExportWorkflowOptions,
) {
  const runtime = options.runtime || wx
  const pendingStore = options.pendingStore || transientPendingStore
  const waitFor = options.wait || wait
  let downloadedFilePath = ''
  assertSessionCurrent(options)
  if (terminalStatuses.has(status.status)) {
    assertSessionCurrent(options)
    pendingStore.clear(pending.ticketId)
    throw terminalStatusError(status)
  }

  let ready = status
  try {
    if (ready.status === 'PENDING') {
      assertSessionCurrent(options)
      options.onProgress?.('preparing')
      const initial = options.preparePendingImmediately
        ? await waitInCurrentSession(
            gateway.prepareExport(pending.ticketId, pending.token),
            options,
          )
        : ready
      ready = await waitUntilReady(
        gateway,
        pending.ticketId,
        pending.token,
        initial,
        waitFor,
        options,
      )
      assertSessionCurrent(options)
    }
    assertSessionCurrent(options)
    options.onProgress?.('downloading')
    assertSessionCurrent(options)
    const reservation = await waitInCurrentSession(
      gateway.reserveExport(pending.ticketId, pending.token),
      options,
    )
    assertSessionCurrent(options)
    downloadedFilePath = await download(runtime, reservation.tempUrl)
    assertSessionCurrent(options)
    try {
      assertSessionCurrent(options)
      await waitInCurrentSession(
        gateway.completeExport(pending.ticketId, pending.token),
        options,
      )
    }
    catch (error) {
      if (!(error instanceof MipAdminError) || error.code !== 'EXPORT_CONSUMED') {
        throw error
      }
    }
    assertSessionCurrent(options)
    pendingStore.clear(pending.ticketId)
    assertSessionCurrent(options)
    options.onProgress?.('opening')
    assertSessionCurrent(options)
    await waitInCurrentSession(openDocument(runtime, downloadedFilePath), options)
    return {
      ticketId: pending.ticketId,
      fileName: reservation.fileName,
      rowCount: ready.rowCount || 0,
    }
  }
  catch (error) {
    if (!isSessionCurrent(options)) {
      if (downloadedFilePath) {
        await removeTemporaryFile(runtime, downloadedFilePath)
      }
      throw sessionEndedError()
    }
    if (shouldDiscardPending(error)) {
      pendingStore.clear(pending.ticketId)
    }
    throw error
  }
}

export async function getPendingAdminExportStatus(
  gateway: ExportAdminGateway,
  options: Pick<ExportWorkflowOptions, 'pendingStore' | 'onProgress' | 'sessionFence'> = {},
): Promise<PendingAdminExportStatus | null> {
  const observed = await observePendingExport(
    gateway,
    options.pendingStore || transientPendingStore,
    options,
  )
  assertSessionCurrent(options)
  return observed
    ? { ticketId: observed.pending.ticketId, ...observed.status }
    : null
}

export async function resumeAndOpenPendingAdminExport(
  gateway: ExportAdminGateway,
  options: ExportWorkflowOptions = {},
): Promise<AdminExportDownloadResult | null> {
  const pendingStore = options.pendingStore || transientPendingStore
  const observed = await observePendingExport(gateway, pendingStore, options)
  assertSessionCurrent(options)
  if (!observed) {
    return null
  }
  return openPreparedExport(gateway, observed.pending, observed.status, {
    ...options,
    pendingStore,
    preparePendingImmediately: true,
  })
}

export async function createAndOpenExport(
  gateway: ExportAdminGateway,
  input: Record<string, unknown>,
  options: ExportWorkflowOptions = {},
): Promise<AdminExportDownloadResult> {
  const pendingStore = options.pendingStore || transientPendingStore
  assertSessionCurrent(options)
  options.onProgress?.('creating')
  assertSessionCurrent(options)
  const ticket = await waitInCurrentSession(gateway.createExport(input), options)
  assertSessionCurrent(options)
  const pending = pendingStore.save(ticket) || {
    version: 1 as const,
    ticketId: ticket.ticketId,
    token: ticket.token,
    expiresAt: ticket.expiresAt,
  }
  assertSessionCurrent(options)
  options.onProgress?.('preparing')
  try {
    assertSessionCurrent(options)
    const initial = await waitInCurrentSession(
      gateway.prepareExport(ticket.ticketId, ticket.token),
      options,
    )
    const result = await openPreparedExport(gateway, pending, initial, {
      ...options,
      pendingStore,
    })
    assertSessionCurrent(options)
    return result
  }
  catch (error) {
    if (shouldDiscardPending(error)) {
      pendingStore.clear(ticket.ticketId)
    }
    throw error
  }
}
