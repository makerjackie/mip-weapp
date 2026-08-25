import type {
  PendingAdminExport,
  PendingAdminExportStorage,
} from '../src/modules/mip-admin/pending-export'
import type {
  AdminExportStatus,
  MipAdminGateway,
} from '../src/modules/mip-admin/types'
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createMipAdminGateway } from '../src/modules/mip-admin/cloudbase-gateway'
import { createCloudBaseAdminTransport } from '../src/modules/mip-admin/cloudbase-transport'
import {
  createAndOpenExport,
  getPendingAdminExportStatus,
  resumeAndOpenPendingAdminExport,
} from '../src/modules/mip-admin/export-download'
import { createPendingAdminExportStore } from '../src/modules/mip-admin/pending-export'
import { createInMemoryAdminTransport } from '../src/modules/mip-admin/transport'
import { MipAdminError } from '../src/modules/mip-admin/types'
import {
  pendingExportFailurePresentation,
  pendingExportStatusPresentation,
} from '../src/packages/admin/exports/state'

vi.mock('../src/modules/platform/cloudbase', () => ({
  requireCloudClient: vi.fn(),
}))

vi.mock('../src/config/runtime', () => ({
  runtimeConfig: { cloudbase: { adminFunctionName: 'mip-admin-api' } },
}))

const now = Date.parse('2026-08-25T00:00:00.000Z')
const expiresAt = '2026-08-25T00:15:00.000Z'
const token = 'a'.repeat(43)
const readyStatus: AdminExportStatus = {
  status: 'READY',
  rowCount: 2,
  expiresAt,
  fileName: 'mip-users-20260825T000000000Z.xlsx',
  failureCode: null,
}

function storageHarness(initial?: unknown) {
  let value = initial
  const writes: PendingAdminExport[] = []
  const clears: string[] = []
  const storage: PendingAdminExportStorage = {
    read: () => value,
    write: (_key, pending) => {
      value = structuredClone(pending)
      writes.push(structuredClone(pending))
    },
    clear: (key) => {
      value = undefined
      clears.push(key)
    },
  }
  return {
    storage,
    writes,
    clears,
    value: () => value,
  }
}

function exportGateway(overrides: Partial<MipAdminGateway> = {}) {
  return {
    createExport: vi.fn(async () => ({
      ticketId: 'ticket-a',
      token,
      status: 'PENDING' as const,
      expiresAt,
    })),
    prepareExport: vi.fn(async () => readyStatus),
    getExportStatus: vi.fn(async () => readyStatus),
    reserveExport: vi.fn(async () => ({
      status: 'RESERVED' as const,
      tempUrl: 'https://example.test/export.xlsx',
      fileName: readyStatus.fileName,
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' as const,
      contentBytes: 512,
      contentSha256: 'b'.repeat(64),
      reservationExpiresAt: '2026-08-25T00:02:00.000Z',
    })),
    completeExport: vi.fn(async () => ({
      status: 'CONSUMED' as const,
      consumedAt: '2026-08-25T00:00:01.000Z',
    })),
    ...overrides,
  } as unknown as MipAdminGateway
}

function exportRuntime(options: { downloadFails?: boolean } = {}) {
  return {
    downloadFile(input: {
      success: (value: { statusCode: number, tempFilePath: string }) => void
      fail: () => void
    }) {
      if (options.downloadFails) {
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

describe('MIP admin pending export storage', () => {
  it('persists only the short-lived ticket identity and opaque token', () => {
    const harness = storageHarness()
    const store = createPendingAdminExportStore(harness.storage, () => now)

    store.save({ ticketId: 'ticket-a', token, status: 'PENDING', expiresAt })

    expect(harness.value()).toEqual({
      version: 1,
      ticketId: 'ticket-a',
      token,
      expiresAt,
    })
    expect(Object.keys(harness.value() as object).sort()).toEqual([
      'expiresAt',
      'ticketId',
      'token',
      'version',
    ])
    expect(JSON.stringify(harness.value())).not.toMatch(/phone|tempUrl|fileName|content|filters/i)
  })

  it('fails closed for expired or expanded local records', () => {
    const expanded = storageHarness({
      version: 1,
      ticketId: 'ticket-a',
      token,
      expiresAt,
      tempUrl: 'https://example.test/export.xlsx',
    })
    const expandedStore = createPendingAdminExportStore(expanded.storage, () => now)
    expect(expandedStore.peek()).toBeNull()
    expect(expanded.value()).toBeUndefined()

    const expired = storageHarness({
      version: 1,
      ticketId: 'ticket-a',
      token,
      expiresAt: '2026-08-24T00:15:00.000Z',
    })
    const expiredStore = createPendingAdminExportStore(expired.storage, () => now)
    expect(expiredStore.peek()).toBeNull()
    expect(expired.value()).toBeUndefined()
  })

  it('does not let an older workflow clear a newer pending ticket', () => {
    const harness = storageHarness()
    const store = createPendingAdminExportStore(harness.storage, () => now)
    store.save({ ticketId: 'ticket-a', token, status: 'PENDING', expiresAt })
    store.save({ ticketId: 'ticket-b', token: 'b'.repeat(43), status: 'PENDING', expiresAt })

    store.clear('ticket-a')

    expect(store.peek()).toMatchObject({ ticketId: 'ticket-b', token: 'b'.repeat(43) })
  })
})

describe('MIP admin export recovery workflow', () => {
  it('saves before preparing and clears only after consumption', async () => {
    const harness = storageHarness()
    const store = createPendingAdminExportStore(harness.storage, () => now)
    const gateway = exportGateway({
      prepareExport: vi.fn(async () => {
        expect(store.peek()).toMatchObject({ ticketId: 'ticket-a', token })
        return readyStatus
      }),
    })

    await expect(createAndOpenExport(gateway, { exportType: 'USERS' }, {
      pendingStore: store,
      runtime: exportRuntime(),
    })).resolves.toMatchObject({ ticketId: 'ticket-a', rowCount: 2 })

    expect(store.peek()).toBeNull()
    expect(harness.writes).toHaveLength(1)
    expect(JSON.stringify(harness.writes)).not.toContain('https://example.test/export.xlsx')
  })

  it('keeps the minimal ticket after a retryable download failure', async () => {
    const harness = storageHarness()
    const store = createPendingAdminExportStore(harness.storage, () => now)
    const gateway = exportGateway()

    await expect(createAndOpenExport(gateway, { exportType: 'USERS' }, {
      pendingStore: store,
      runtime: exportRuntime({ downloadFails: true }),
    })).rejects.toMatchObject({ code: 'EXPORT_DOWNLOAD_FAILED', retryable: true })

    expect(store.peek()).toEqual({ version: 1, ticketId: 'ticket-a', token, expiresAt })
    expect(JSON.stringify(harness.value())).not.toContain('https://example.test/export.xlsx')
    expect(gateway.completeExport).not.toHaveBeenCalled()
  })

  it('checks status and resumes a pending ticket through prepare, reserve and complete', async () => {
    const harness = storageHarness()
    const store = createPendingAdminExportStore(harness.storage, () => now)
    store.save({ ticketId: 'ticket-a', token, status: 'PENDING', expiresAt })
    const calls: string[] = []
    const gateway = exportGateway({
      getExportStatus: vi.fn(async () => {
        calls.push('status')
        return { ...readyStatus, status: 'PENDING', rowCount: null }
      }),
      prepareExport: vi.fn(async () => {
        calls.push('prepare')
        return readyStatus
      }),
      reserveExport: vi.fn(async () => {
        calls.push('reserve')
        return {
          status: 'RESERVED',
          tempUrl: 'https://example.test/export.xlsx',
          fileName: readyStatus.fileName,
          contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          contentBytes: 512,
          contentSha256: 'b'.repeat(64),
          reservationExpiresAt: '2026-08-25T00:02:00.000Z',
        }
      }),
      completeExport: vi.fn(async () => {
        calls.push('complete')
        return { status: 'CONSUMED', consumedAt: '2026-08-25T00:00:01.000Z' }
      }),
    })

    await expect(resumeAndOpenPendingAdminExport(gateway, {
      pendingStore: store,
      runtime: exportRuntime(),
      wait: async () => {},
    })).resolves.toMatchObject({ ticketId: 'ticket-a', rowCount: 2 })

    expect(calls).toEqual(['status', 'prepare', 'reserve', 'complete'])
    expect(store.peek()).toBeNull()
  })

  it('clears terminal and identity-mismatched tickets but retains conflicts and retryable reservations', async () => {
    for (const terminalStatus of ['FAILED', 'EXPIRED', 'REVOKED', 'CONSUMED'] as const) {
      const terminalHarness = storageHarness()
      const terminalStore = createPendingAdminExportStore(terminalHarness.storage, () => now)
      terminalStore.save({ ticketId: 'ticket-a', token, status: 'PENDING', expiresAt })
      const terminal = await getPendingAdminExportStatus(exportGateway({
        getExportStatus: vi.fn(async () => ({
          ...readyStatus,
          status: terminalStatus,
          failureCode: terminalStatus === 'FAILED' ? 'EXPORT_BUILD_FAILED' : null,
        })),
      }), { pendingStore: terminalStore })
      expect(terminal?.status).toBe(terminalStatus)
      expect(terminalStore.peek()).toBeNull()
    }

    const identityHarness = storageHarness()
    const identityStore = createPendingAdminExportStore(identityHarness.storage, () => now)
    identityStore.save({ ticketId: 'ticket-a', token, status: 'PENDING', expiresAt })
    await expect(getPendingAdminExportStatus(exportGateway({
      getExportStatus: vi.fn(async () => {
        throw new MipAdminError('EXPORT_NOT_FOUND', '导出任务不存在')
      }),
    }), { pendingStore: identityStore })).resolves.toBeNull()
    expect(identityStore.peek()).toBeNull()

    const conflictHarness = storageHarness()
    const conflictStore = createPendingAdminExportStore(conflictHarness.storage, () => now)
    conflictStore.save({ ticketId: 'ticket-a', token, status: 'PENDING', expiresAt })
    await expect(getPendingAdminExportStatus(exportGateway({
      getExportStatus: vi.fn(async () => {
        throw new MipAdminError('CONFLICT', '状态已变化')
      }),
    }), { pendingStore: conflictStore })).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(conflictStore.peek()).not.toBeNull()

    const reservedHarness = storageHarness()
    const reservedStore = createPendingAdminExportStore(reservedHarness.storage, () => now)
    reservedStore.save({ ticketId: 'ticket-a', token, status: 'PENDING', expiresAt })
    await expect(resumeAndOpenPendingAdminExport(exportGateway({
      getExportStatus: vi.fn(async () => ({ ...readyStatus, status: 'RESERVED' })),
      reserveExport: vi.fn(async () => {
        throw new MipAdminError('EXPORT_BUSY', '导出任务正在处理', true)
      }),
    }), {
      pendingStore: reservedStore,
      runtime: exportRuntime(),
    })).rejects.toMatchObject({ code: 'EXPORT_BUSY', retryable: true })
    expect(reservedStore.peek()).not.toBeNull()
  })
})

describe('MIP export status transport contract', () => {
  it('uses the same v1 action and input through in-memory and CloudBase transports', async () => {
    const handledInputs: Array<Record<string, unknown>> = []
    const inMemoryGateway = createMipAdminGateway(createInMemoryAdminTransport({
      'mip.admin.exports.status': (input) => {
        handledInputs.push(input)
        return readyStatus
      },
    }))
    const callFunction = vi.fn()
      .mockRejectedValueOnce(new Error('cold start'))
      .mockResolvedValueOnce({ result: { ok: true, data: readyStatus } })
    const cloudbaseGateway = createMipAdminGateway(createCloudBaseAdminTransport({
      cloudClient: { callFunction },
      functionName: 'mip-admin-api-test',
    }))

    await expect(inMemoryGateway.getExportStatus('ticket-a', token)).resolves.toEqual(readyStatus)
    await expect(cloudbaseGateway.getExportStatus('ticket-a', token)).resolves.toEqual(readyStatus)

    expect(handledInputs).toEqual([{ ticketId: 'ticket-a', token }])
    expect(callFunction).toHaveBeenCalledWith({
      name: 'mip-admin-api-test',
      data: {
        contractVersion: 1,
        action: 'mip.admin.exports.status',
        input: { ticketId: 'ticket-a', token },
      },
    })
    expect(callFunction).toHaveBeenCalledTimes(2)
  })
})

describe('MIP export recovery page states', () => {
  it('distinguishes resumable, retry, conflict and terminal states', () => {
    expect(pendingExportStatusPresentation({ ticketId: 'ticket-a', ...readyStatus }).pendingState)
      .toBe('resumable')
    expect(pendingExportStatusPresentation({ ticketId: 'ticket-a', ...readyStatus, status: 'RESERVED' }).pendingState)
      .toBe('retry')
    expect(pendingExportStatusPresentation({ ticketId: 'ticket-a', ...readyStatus, status: 'EXPIRED' }).pendingState)
      .toBe('terminal')
    expect(pendingExportFailurePresentation(new MipAdminError('CONFLICT', '状态已变化')).pendingState)
      .toBe('conflict')
    expect(pendingExportFailurePresentation(new MipAdminError('EXPORT_BUSY', '正在处理', true)).pendingState)
      .toBe('retry')
  })

  it('checks status on page show and exposes an explicit resume action', () => {
    const root = path.resolve(import.meta.dirname, '..')
    const page = fs.readFileSync(path.join(root, 'src/packages/admin/exports/index.ts'), 'utf8')
    const template = fs.readFileSync(path.join(root, 'src/packages/admin/exports/index.wxml'), 'utf8')

    expect(page).toContain('await this.loadPendingExportStatus()')
    expect(page).toContain('mipAdminModule.exports.getPendingStatus()')
    expect(page).toContain('mipAdminModule.exports.resumeAndOpen')
    expect(page).toContain('mipAdminModule.exports.clearPending()')
    expect(page).toContain('mipAdminModule.exports.createAndOpen')
    expect(page).toContain('mipAdminModule.governance.getSession')
    expect(page).toContain('mipAdminModule.events.get')
    expect(page).not.toContain('mipAdminModule.mutate')
    expect(page).not.toContain('mipAdminModule.gateway')
    expect(template).toContain('bind:tap="resumePendingExport"')
    expect(template).toContain('bind:tap="discardPendingExport"')
    expect(template).toContain('pendingState === \'conflict\'')
    expect(template).toContain('pendingState === \'retry\'')
  })
})
