import type {
  AdminExportDownloadResult,
  AdminExportStatus,
  MipAdminGateway,
} from './types'
import { MipAdminError } from './types'

type ExportProgress = 'creating' | 'preparing' | 'downloading' | 'opening'

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
) {
  let status = initial
  for (let attempt = 0; attempt < 20 && status.status === 'PENDING'; attempt += 1) {
    await wait(Math.max(300, Math.min(status.retryAfterMs || 500, 2_000)))
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

export async function createAndOpenExport(
  gateway: MipAdminGateway,
  input: Record<string, unknown>,
  options: {
    runtime?: ExportRuntime
    onProgress?: (progress: ExportProgress) => void
  } = {},
): Promise<AdminExportDownloadResult> {
  const runtime = options.runtime || wx
  options.onProgress?.('creating')
  const ticket = await gateway.createExport(input)
  options.onProgress?.('preparing')
  const ready = await waitUntilReady(
    gateway,
    ticket.ticketId,
    ticket.token,
    await gateway.prepareExport(ticket.ticketId, ticket.token),
  )
  options.onProgress?.('downloading')
  const reservation = await gateway.reserveExport(ticket.ticketId, ticket.token)
  const filePath = await download(runtime, reservation.tempUrl)
  try {
    await gateway.completeExport(ticket.ticketId, ticket.token)
  }
  catch (error) {
    if (!(error instanceof MipAdminError) || error.code !== 'EXPORT_CONSUMED') {
      throw error
    }
  }
  options.onProgress?.('opening')
  await openDocument(runtime, filePath)
  return {
    ticketId: ticket.ticketId,
    fileName: reservation.fileName,
    rowCount: ready.rowCount || 0,
  }
}
