import type { MipAdminGateway, MipAdminSession } from '../src/modules/mip-admin/types'
import { describe, expect, it, vi } from 'vitest'
import { createMipAdminModule, hasCapability, hasScopedCapability } from '../src/modules/mip-admin/client'
import { createAndOpenExport } from '../src/modules/mip-admin/export-download'

const session: MipAdminSession = {
  enabled: true,
  roles: [{ roleKey: 'BRANCH_ADMIN', scopeType: 'BRANCH', scopeId: 'branch-a' }],
  capabilities: [
    { capability: 'users.read', scopeType: 'BRANCH', scopeId: 'branch-a' },
    { capability: 'events.read', scopeType: 'BRANCH', scopeId: 'branch-a' },
    { capability: 'events.album.manage', scopeType: 'BRANCH', scopeId: 'branch-a' },
    { capability: 'communications.publish', scopeType: 'BRANCH', scopeId: 'branch-a' },
  ],
}

function gateway() {
  return {
    getSession: vi.fn(async () => session),
    getDashboard: vi.fn(),
    listBranches: vi.fn(async () => ({ items: [], nextCursor: null })),
    createBranch: vi.fn(),
    updateBranch: vi.fn(),
    changeBranchStatus: vi.fn(),
    listCommunityReports: vi.fn(async () => ({ items: [], nextCursor: null })),
    claimCommunityReport: vi.fn(),
    closeCommunityReport: vi.fn(),
    listUsers: vi.fn(async () => ({ items: [], nextCursor: null })),
    updateUser: vi.fn(),
    setUserControl: vi.fn(),
    createExport: vi.fn(),
    prepareExport: vi.fn(),
    getExportStatus: vi.fn(),
    reserveExport: vi.fn(),
    completeExport: vi.fn(),
    listEvents: vi.fn(async () => ({ items: [], nextCursor: null })),
    getEvent: vi.fn(),
    listEventAlbumPhotos: vi.fn(async () => ({ items: [], nextCursor: null })),
    reviewEventAlbumPhoto: vi.fn(),
    saveEvent: vi.fn(),
    cloneEvent: vi.fn(),
    changeEventStatus: vi.fn(),
    publishEventReminder: vi.fn(),
    listRoster: vi.fn(),
    reviewRegistration: vi.fn(),
    checkIn: vi.fn(),
    listRoles: vi.fn(),
    searchRoleCandidates: vi.fn(),
    setRole: vi.fn(),
    listOpportunities: vi.fn(),
    unpublishOpportunity: vi.fn(),
    archiveOpportunity: vi.fn(),
    listGrowthLevels: vi.fn(),
    saveGrowthLevel: vi.fn(),
    listGrowthRules: vi.fn(),
    saveGrowthRule: vi.fn(),
    listGrowthEntries: vi.fn(),
    adjustGrowth: vi.fn(),
    listOrders: vi.fn(),
    submitRefund: vi.fn(),
    retryRefund: vi.fn(),
    listOperationalExceptions: vi.fn(async () => ({ items: [], nextCursor: null, availableTypes: [] })),
    listAudit: vi.fn(),
  } satisfies MipAdminGateway
}

describe('MIP admin client module', () => {
  it('uses scoped server grants only for display decisions', () => {
    expect(hasCapability(session.capabilities, 'users.read')).toBe(true)
    expect(hasCapability(session.capabilities, 'refunds.submit')).toBe(false)
    expect(hasCapability(session.capabilities, 'branches.manage')).toBe(false)
    expect(hasCapability(session.capabilities, 'community.reports.manage')).toBe(false)
    expect(hasScopedCapability(session.capabilities, 'communications.publish', {
      scopeType: 'EVENT',
      scopeId: 'event-a',
      branchId: 'branch-a',
    })).toBe(true)
    expect(hasScopedCapability(session.capabilities, 'communications.publish', {
      scopeType: 'EVENT',
      scopeId: 'event-b',
      branchId: 'branch-b',
    })).toBe(false)
    expect(hasScopedCapability(session.capabilities, 'events.album.manage', {
      scopeType: 'EVENT',
      scopeId: 'event-a',
      branchId: 'branch-a',
    })).toBe(true)
  })

  it('caches reads and invalidates them after a mutation', async () => {
    const source = gateway()
    const module = createMipAdminModule(source)
    await module.listUsers({ filters: { kind: 'PLAYER' } })
    await module.listUsers({ filters: { kind: 'PLAYER' } })
    expect(source.listUsers).toHaveBeenCalledTimes(1)
    await module.mutate(async () => ({ ok: true }))
    await module.listUsers({ filters: { kind: 'PLAYER' } })
    expect(source.listUsers).toHaveBeenCalledTimes(2)
  })

  it('caches the branch directory and invalidates it after a successful mutation', async () => {
    const source = gateway()
    const module = createMipAdminModule(source)
    await module.listBranches()
    await module.listBranches()
    expect(source.listBranches).toHaveBeenCalledTimes(1)
    await module.mutate(async () => ({ ok: true }))
    await module.listBranches()
    expect(source.listBranches).toHaveBeenCalledTimes(2)
  })

  it('caches each community report status and invalidates the list after a mutation', async () => {
    const source = gateway()
    const module = createMipAdminModule(source)
    await module.listCommunityReports('PENDING')
    await module.listCommunityReports('PENDING')
    await module.listCommunityReports('REVIEWING')
    expect(source.listCommunityReports).toHaveBeenCalledTimes(2)
    await module.mutate(async () => ({ ok: true }))
    await module.listCommunityReports('PENDING')
    expect(source.listCommunityReports).toHaveBeenCalledTimes(3)
  })

  it('caches operational exception reads by server-side filters', async () => {
    const source = gateway()
    const module = createMipAdminModule(source)
    await module.listOperationalExceptions({ type: 'PAYMENT', status: 'FAILED' })
    await module.listOperationalExceptions({ type: 'PAYMENT', status: 'FAILED' })
    await module.listOperationalExceptions({ type: 'REFUND', status: 'FAILED' })
    expect(source.listOperationalExceptions).toHaveBeenCalledTimes(2)
  })

  it('downloads before consuming the one-time export and opens only the local file', async () => {
    const source = gateway()
    const calls: string[] = []
    source.createExport.mockImplementation(async () => {
      calls.push('create')
      return { ticketId: 'ticket-a', token: 'a'.repeat(43), status: 'PENDING', expiresAt: '2026-08-24T00:15:00.000Z' }
    })
    source.prepareExport.mockImplementation(async () => {
      calls.push('prepare')
      return { status: 'READY', rowCount: 2, expiresAt: '2026-08-24T00:15:00.000Z', fileName: 'mip-users-20260824T000000000Z.xlsx', failureCode: null }
    })
    source.reserveExport.mockImplementation(async () => {
      calls.push('reserve')
      return {
        status: 'RESERVED',
        tempUrl: 'https://example.test/export.xlsx',
        fileName: 'mip-users-20260824T000000000Z.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        contentBytes: 512,
        contentSha256: 'a'.repeat(64),
        reservationExpiresAt: '2026-08-24T00:02:00.000Z',
      }
    })
    source.completeExport.mockImplementation(async () => {
      calls.push('complete')
      return { status: 'CONSUMED', consumedAt: '2026-08-24T00:00:01.000Z' }
    })
    const runtime = {
      downloadFile(options: { success: (value: { statusCode: number, tempFilePath: string }) => void }) {
        calls.push('download')
        options.success({ statusCode: 200, tempFilePath: '/tmp/export.xlsx' })
      },
      openDocument(options: { filePath: string, success: () => void }) {
        calls.push(`open:${options.filePath}`)
        options.success()
      },
    }
    const result = await createAndOpenExport(source, { exportType: 'USERS' }, { runtime })
    expect(result.rowCount).toBe(2)
    expect(calls).toEqual(['create', 'prepare', 'reserve', 'download', 'complete', 'open:/tmp/export.xlsx'])
  })

  it('does not consume a reservation when the file download fails', async () => {
    const source = gateway()
    source.createExport.mockResolvedValue({
      ticketId: 'ticket-a',
      token: 'a'.repeat(43),
      status: 'PENDING',
      expiresAt: '2026-08-24T00:15:00.000Z',
    })
    source.prepareExport.mockResolvedValue({
      status: 'READY',
      rowCount: 1,
      expiresAt: '2026-08-24T00:15:00.000Z',
      fileName: 'mip-users-20260824T000000000Z.xlsx',
      failureCode: null,
    })
    source.reserveExport.mockResolvedValue({
      status: 'RESERVED',
      tempUrl: 'https://example.test/export.xlsx',
      fileName: 'mip-users-20260824T000000000Z.xlsx',
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      contentBytes: 512,
      contentSha256: 'a'.repeat(64),
      reservationExpiresAt: '2026-08-24T00:02:00.000Z',
    })
    const runtime = {
      downloadFile(options: { fail: () => void }) { options.fail() },
      openDocument: vi.fn(),
    }
    await expect(createAndOpenExport(source, { exportType: 'USERS' }, { runtime })).rejects.toThrow('下载失败')
    expect(source.completeExport).not.toHaveBeenCalled()
  })
})
