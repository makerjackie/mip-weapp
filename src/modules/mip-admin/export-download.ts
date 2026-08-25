import type { PendingAdminExport, PendingAdminExportStore } from './pending-export'
import type {
  AdminExportDownloadResult,
  AdminExportStatus,
  AdminExportStatusValue,
  MipAdminGateway,
} from './types'
import { MipAdminError } from './types'

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
}

interface ExportWorkflowOptions {
  runtime?: ExportRuntime
  pendingStore?: PendingAdminExportStore
  onProgress?: (progress: ExportProgress) => void
  wait?: (milliseconds: number) => Promise<void>
  preparePendingImmediately?: boolean
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
  gateway: MipAdminGateway,
  ticketId: string,
  token: string,
  initial: AdminExportStatus,
  waitFor: (milliseconds: number) => Promise<void>,
) {
  let status = initial
  for (let attempt = 0; attempt < 20 && status.status === 'PENDING'; attempt += 1) {
    await waitFor(Math.max(300, Math.min(status.retryAfterMs || 500, 2_000)))
    status = await gateway.prepareExport(ticketId, token)
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
  gateway: MipAdminGateway,
  pendingStore: PendingAdminExportStore,
  onProgress?: (progress: ExportProgress) => void,
) {
  const pending = pendingStore.peek()
  if (!pending) {
    return null
  }
  onProgress?.('checking')
  try {
    const status = await gateway.getExportStatus(pending.ticketId, pending.token)
    if (terminalStatuses.has(status.status)) {
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
  gateway: MipAdminGateway,
  pending: PendingAdminExport,
  status: AdminExportStatus,
  options: ExportWorkflowOptions,
) {
  const runtime = options.runtime || wx
  const pendingStore = options.pendingStore || transientPendingStore
  const waitFor = options.wait || wait
  if (terminalStatuses.has(status.status)) {
    pendingStore.clear(pending.ticketId)
    throw terminalStatusError(status)
  }

  let ready = status
  try {
    if (ready.status === 'PENDING') {
      options.onProgress?.('preparing')
      const initial = options.preparePendingImmediately
        ? await gateway.prepareExport(pending.ticketId, pending.token)
        : ready
      ready = await waitUntilReady(
        gateway,
        pending.ticketId,
        pending.token,
        initial,
        waitFor,
      )
    }
    options.onProgress?.('downloading')
    const reservation = await gateway.reserveExport(pending.ticketId, pending.token)
    const filePath = await download(runtime, reservation.tempUrl)
    try {
      await gateway.completeExport(pending.ticketId, pending.token)
    }
    catch (error) {
      if (!(error instanceof MipAdminError) || error.code !== 'EXPORT_CONSUMED') {
        throw error
      }
    }
    pendingStore.clear(pending.ticketId)
    options.onProgress?.('opening')
    await openDocument(runtime, filePath)
    return {
      ticketId: pending.ticketId,
      fileName: reservation.fileName,
      rowCount: ready.rowCount || 0,
    }
  }
  catch (error) {
    if (shouldDiscardPending(error)) {
      pendingStore.clear(pending.ticketId)
    }
    throw error
  }
}

export async function getPendingAdminExportStatus(
  gateway: MipAdminGateway,
  options: Pick<ExportWorkflowOptions, 'pendingStore' | 'onProgress'> = {},
): Promise<PendingAdminExportStatus | null> {
  const observed = await observePendingExport(
    gateway,
    options.pendingStore || transientPendingStore,
    options.onProgress,
  )
  return observed
    ? { ticketId: observed.pending.ticketId, ...observed.status }
    : null
}

export async function resumeAndOpenPendingAdminExport(
  gateway: MipAdminGateway,
  options: ExportWorkflowOptions = {},
): Promise<AdminExportDownloadResult | null> {
  const pendingStore = options.pendingStore || transientPendingStore
  const observed = await observePendingExport(gateway, pendingStore, options.onProgress)
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
  gateway: MipAdminGateway,
  input: Record<string, unknown>,
  options: ExportWorkflowOptions = {},
): Promise<AdminExportDownloadResult> {
  const pendingStore = options.pendingStore || transientPendingStore
  options.onProgress?.('creating')
  const ticket = await gateway.createExport(input)
  const pending = pendingStore.save(ticket) || {
    version: 1 as const,
    ticketId: ticket.ticketId,
    token: ticket.token,
    expiresAt: ticket.expiresAt,
  }
  options.onProgress?.('preparing')
  try {
    const initial = await gateway.prepareExport(ticket.ticketId, ticket.token)
    return await openPreparedExport(gateway, pending, initial, {
      ...options,
      pendingStore,
    })
  }
  catch (error) {
    if (shouldDiscardPending(error)) {
      pendingStore.clear(ticket.ticketId)
    }
    throw error
  }
}
