import type { ExportProgress } from '../src/modules/mip-admin/export-download'
import type { PendingAdminExportStorage } from '../src/modules/mip-admin/pending-export'
import type { AdminExportStatus, MipAdminGateway } from '../src/modules/mip-admin/types'
import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMipAdminModule } from '../src/modules/mip-admin/client'
import { createPendingAdminExportStore } from '../src/modules/mip-admin/pending-export'
import { MipAdminError } from '../src/modules/mip-admin/types'

const now = Date.parse('2026-08-25T00:00:00.000Z')
const expiresAt = '2026-08-25T00:15:00.000Z'
const token = 'a'.repeat(43)
const readyStatus: AdminExportStatus = {
  status: 'READY',
  rowCount: 2,
  expiresAt,
  fileName: 'mip-event-roster-20260825T000000000Z.xlsx',
  failureCode: null,
}
const exportInput = {
  exportType: 'EVENT_ROSTER',
  eventId: 'event-a',
  includesPhone: false,
  filters: {},
}
const auditInput = {
  filters: { action: 'admin.export.request', resourceType: 'EXPORT_TICKET' },
  cursor: 'audit-cursor-a',
  limit: 25,
}
const userInput = { includePhone: false, filters: { branchId: 'branch-a' }, limit: 25 }
const eventInput = { filters: { branchId: 'branch-a' }, limit: 25 }

function storageHarness() {
  let value: unknown
  const storage: PendingAdminExportStorage = {
    read: () => value,
    write: (_key, pending) => { value = structuredClone(pending) },
    clear: () => { value = undefined },
  }
  return {
    store: createPendingAdminExportStore(storage, () => now),
    value: () => value,
  }
}

function runtime(downloadFails = false) {
  return {
    downloadFile(input: {
      success: (result: { statusCode: number, tempFilePath: string }) => void
      fail: () => void
    }) {
      if (downloadFails) {
        input.fail()
      }
      else {
        input.success({ statusCode: 200, tempFilePath: '/tmp/export.xlsx' })
      }
    },
    openDocument(input: { success: () => void }) {
      input.success()
    },
  }
}

function createHarness() {
  const pending = storageHarness()
  const spies = {
    createExport: vi.fn<MipAdminGateway['createExport']>(async () => ({
      ticketId: 'ticket-a',
      token,
      status: 'PENDING',
      expiresAt,
    })),
    prepareExport: vi.fn<MipAdminGateway['prepareExport']>(async () => readyStatus),
    getExportStatus: vi.fn<MipAdminGateway['getExportStatus']>(async () => readyStatus),
    reserveExport: vi.fn<MipAdminGateway['reserveExport']>(async () => ({
      status: 'RESERVED',
      tempUrl: 'https://example.test/export.xlsx',
      fileName: readyStatus.fileName,
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      contentBytes: 512,
      contentSha256: 'b'.repeat(64),
      reservationExpiresAt: '2026-08-25T00:02:00.000Z',
    })),
    completeExport: vi.fn<MipAdminGateway['completeExport']>(async () => ({
      status: 'CONSUMED',
      consumedAt: '2026-08-25T00:00:01.000Z',
    })),
    listAudit: vi.fn<MipAdminGateway['listAudit']>(async () => ({ items: [], nextCursor: null })),
    listUsers: vi.fn<MipAdminGateway['listUsers']>(async () => ({ items: [], nextCursor: null })),
    listEvents: vi.fn<MipAdminGateway['listEvents']>(async () => ({ items: [], nextCursor: null })),
  }
  const gateway = spies as unknown as MipAdminGateway
  return {
    module: createMipAdminModule(gateway, { pendingExportStore: pending.store }),
    pending,
    spies,
  }
}

async function warmAdminReads(module: ReturnType<typeof createHarness>['module']) {
  await Promise.all([
    module.governance.listAudit(auditInput),
    module.users.list(userInput),
    module.events.list(eventInput),
  ])
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('MIP admin exports facade', () => {
  it('shares one pending store across legacy aliases and the facade without clearing retryable work', async () => {
    const { module, pending, spies } = createHarness()
    vi.stubGlobal('wx', runtime(true))
    const createProgress: ExportProgress[] = []

    await expect(module.exportAndOpen(exportInput, progress => createProgress.push(progress)))
      .rejects
      .toMatchObject({ code: 'EXPORT_DOWNLOAD_FAILED', retryable: true })
    expect(createProgress).toEqual(['creating', 'preparing', 'downloading'])
    expect(pending.store.peek()).toMatchObject({ ticketId: 'ticket-a', token })

    const statusProgress: ExportProgress[] = []
    await expect(module.exports.getPendingStatus(progress => statusProgress.push(progress)))
      .resolves
      .toMatchObject({ ticketId: 'ticket-a', status: 'READY' })
    expect(statusProgress).toEqual(['checking'])
    expect(spies.getExportStatus).toHaveBeenCalledTimes(1)

    module.clearPendingExport()
    await expect(module.exports.getPendingStatus()).resolves.toBeNull()
    expect(pending.value()).toBeUndefined()
    expect(spies.getExportStatus).toHaveBeenCalledTimes(1)
  })

  it('preserves progress and refreshes only audit after a successful create and open', async () => {
    const { module, pending, spies } = createHarness()
    vi.stubGlobal('wx', runtime())
    const progress: ExportProgress[] = []
    await warmAdminReads(module)
    await warmAdminReads(module)

    await expect(module.exports.createAndOpen(exportInput, value => progress.push(value)))
      .resolves
      .toMatchObject({ ticketId: 'ticket-a', rowCount: 2 })
    await warmAdminReads(module)

    expect(progress).toEqual(['creating', 'preparing', 'downloading', 'opening'])
    expect(spies.listAudit).toHaveBeenCalledTimes(2)
    expect(spies.listUsers).toHaveBeenCalledTimes(1)
    expect(spies.listEvents).toHaveBeenCalledTimes(1)
    expect(pending.store.peek()).toBeNull()
  })

  it('refreshes only audit after a successful resume and open', async () => {
    const { module, pending, spies } = createHarness()
    vi.stubGlobal('wx', runtime())
    pending.store.save({ ticketId: 'ticket-a', token, status: 'PENDING', expiresAt })
    const progress: ExportProgress[] = []
    await warmAdminReads(module)

    await expect(module.exports.resumeAndOpen(value => progress.push(value)))
      .resolves
      .toMatchObject({ ticketId: 'ticket-a', rowCount: 2 })
    await warmAdminReads(module)

    expect(progress).toEqual(['checking', 'downloading', 'opening'])
    expect(spies.getExportStatus).toHaveBeenCalledTimes(1)
    expect(spies.reserveExport).toHaveBeenCalledTimes(1)
    expect(spies.completeExport).toHaveBeenCalledTimes(1)
    expect(spies.listAudit).toHaveBeenCalledTimes(2)
    expect(spies.listUsers).toHaveBeenCalledTimes(1)
    expect(spies.listEvents).toHaveBeenCalledTimes(1)
    expect(pending.store.peek()).toBeNull()
  })

  it('does not retry a failed create mutation or invalidate cached reads', async () => {
    const { module, pending, spies } = createHarness()
    const failure = new MipAdminError('EXPORT_STORAGE_UNAVAILABLE', '导出存储不可用', true)
    spies.createExport.mockRejectedValueOnce(failure)
    await warmAdminReads(module)

    await expect(module.exports.createAndOpen(exportInput)).rejects.toBe(failure)
    await warmAdminReads(module)

    expect(spies.createExport).toHaveBeenCalledTimes(1)
    expect(spies.prepareExport).not.toHaveBeenCalled()
    expect(spies.listAudit).toHaveBeenCalledTimes(1)
    expect(spies.listUsers).toHaveBeenCalledTimes(1)
    expect(spies.listEvents).toHaveBeenCalledTimes(1)
    expect(pending.store.peek()).toBeNull()
  })

  it('does not invalidate cached reads when resume finds no pending ticket', async () => {
    const { module, spies } = createHarness()
    await warmAdminReads(module)

    await expect(module.exports.resumeAndOpen()).resolves.toBeNull()
    await warmAdminReads(module)

    expect(spies.getExportStatus).not.toHaveBeenCalled()
    expect(spies.listAudit).toHaveBeenCalledTimes(1)
    expect(spies.listUsers).toHaveBeenCalledTimes(1)
    expect(spies.listEvents).toHaveBeenCalledTimes(1)
  })

  it('does not retry a failed prepare mutation or discard its recoverable ticket', async () => {
    const { module, pending, spies } = createHarness()
    const failure = new MipAdminError('CONFLICT', '导出状态已变化')
    spies.prepareExport.mockRejectedValueOnce(failure)
    await warmAdminReads(module)

    await expect(module.exports.createAndOpen(exportInput)).rejects.toBe(failure)
    await warmAdminReads(module)

    expect(spies.createExport).toHaveBeenCalledTimes(1)
    expect(spies.prepareExport).toHaveBeenCalledTimes(1)
    expect(spies.reserveExport).not.toHaveBeenCalled()
    expect(spies.listAudit).toHaveBeenCalledTimes(1)
    expect(pending.store.peek()).toMatchObject({ ticketId: 'ticket-a', token })
  })

  it('does not retry a failed resume mutation or discard retryable pending work', async () => {
    const { module, pending, spies } = createHarness()
    const failure = new MipAdminError('EXPORT_BUSY', '导出任务正在处理', true)
    vi.stubGlobal('wx', runtime())
    pending.store.save({ ticketId: 'ticket-a', token, status: 'PENDING', expiresAt })
    spies.reserveExport.mockRejectedValueOnce(failure)
    await warmAdminReads(module)

    await expect(module.resumePendingExport()).rejects.toBe(failure)
    await warmAdminReads(module)

    expect(spies.getExportStatus).toHaveBeenCalledTimes(1)
    expect(spies.reserveExport).toHaveBeenCalledTimes(1)
    expect(spies.completeExport).not.toHaveBeenCalled()
    expect(spies.listAudit).toHaveBeenCalledTimes(1)
    expect(pending.store.peek()).toMatchObject({ ticketId: 'ticket-a', token })
  })

  it('keeps the exports page behind typed governance, events, and exports interfaces', () => {
    const source = fs.readFileSync(
      path.resolve(import.meta.dirname, '../src/packages/admin/exports/index.ts'),
      'utf8',
    )

    expect(source).toContain('mipAdminModule.governance.getSession(')
    expect(source).toContain('mipAdminModule.events.get(')
    expect(source).toContain('mipAdminModule.exports.getPendingStatus(')
    expect(source).toContain('mipAdminModule.exports.resumeAndOpen(')
    expect(source).toContain('mipAdminModule.exports.clearPending(')
    expect(source).toContain('mipAdminModule.exports.createAndOpen(')
    expect(source).not.toContain('mipAdminModule.mutate')
    expect(source).not.toContain('mipAdminModule.gateway')
    expect(source).not.toContain('mipAdminModule.exportAndOpen')
  })
})
