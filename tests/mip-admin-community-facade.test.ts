import type {
  AdminCommunityReport,
  AdminCommunityReportStatus,
  MipAdminGateway,
} from '../src/modules/mip-admin/types'
import { describe, expect, it, vi } from 'vitest'
import { createMipAdminModule } from '../src/modules/mip-admin/client'
import { MipAdminError } from '../src/modules/mip-admin/types'

const report: AdminCommunityReport = {
  reportId: 'report-a',
  category: 'SPAM',
  description: '重复发布无关内容',
  status: 'PENDING',
  version: 1,
  reporter: { nickname: '举报人', headline: '', cityName: '深圳' },
  target: { nickname: '被举报人', headline: '', cityName: '广州' },
  resolutionReason: '',
  createdAt: '2026-08-25T00:00:00.000Z',
  updatedAt: '2026-08-25T00:00:00.000Z',
  reviewedAt: null,
}

const statuses: AdminCommunityReportStatus[] = [
  'PENDING',
  'REVIEWING',
  'RESOLVED',
  'DISMISSED',
]
const auditInput = {
  filters: { action: 'admin.community_reports.claim', resourceType: 'COMMUNITY_REPORT' },
  cursor: 'audit-cursor-a',
  limit: 25,
}
const userListInput = {
  includePhone: false,
  filters: { query: '被举报人' },
  cursor: 'user-cursor-a',
  limit: 25,
}
const claimInput = { reportId: report.reportId, expectedVersion: 1, reason: '开始审核' }
const closeInput = {
  reportId: report.reportId,
  expectedVersion: 2,
  outcome: 'RESOLVED' as const,
  reason: '已核实并完成处理',
}

function createHarness() {
  const spies = {
    listCommunityReports: vi.fn<MipAdminGateway['listCommunityReports']>(async status => ({
      items: [{ ...report, status }],
      nextCursor: null,
    })),
    claimCommunityReport: vi.fn<MipAdminGateway['claimCommunityReport']>(async () => ({
      ...report,
      status: 'REVIEWING',
      version: 2,
    })),
    closeCommunityReport: vi.fn<MipAdminGateway['closeCommunityReport']>(async input => ({
      ...report,
      status: input.outcome,
      version: 3,
    })),
    listAudit: vi.fn<MipAdminGateway['listAudit']>(async () => ({ items: [], nextCursor: null })),
    listUsers: vi.fn<MipAdminGateway['listUsers']>(async () => ({ items: [], nextCursor: null })),
    getUser: vi.fn<MipAdminGateway['getUser']>(async () => ({ id: 'user-a' }) as never),
  }
  const gateway = spies as unknown as MipAdminGateway
  return { module: createMipAdminModule(gateway), spies }
}

async function warmDependencies(module: ReturnType<typeof createHarness>['module']) {
  await Promise.all([
    ...statuses.map(status => module.community.listReports(status)),
    module.governance.listAudit(auditInput),
    module.users.list(userListInput),
    module.users.get('user-a'),
  ])
}

describe('MIP admin community facade', () => {
  it('uses the complete status dimension and keeps the legacy alias on the same cache', async () => {
    const { module, spies } = createHarness()

    await module.community.listReports('PENDING')
    await module.community.listReports('PENDING')
    for (const status of statuses.slice(1)) {
      await module.community.listReports(status)
      await module.community.listReports(status)
    }
    await module.community.listReports('PENDING', true)

    expect(spies.listCommunityReports.mock.calls.map(call => call[0])).toEqual([
      'PENDING',
      'REVIEWING',
      'RESOLVED',
      'DISMISSED',
      'PENDING',
    ])
  })

  it('passes claim and close inputs to the neutral gateway unchanged', async () => {
    const { module, spies } = createHarness()

    await module.community.claimReport(claimInput)
    await module.community.closeReport(closeInput)

    expect(spies.claimCommunityReport.mock.calls[0]?.[0]).toBe(claimInput)
    expect(spies.closeCommunityReport.mock.calls[0]?.[0]).toBe(closeInput)
  })

  it.each([
    ['claimReport', 'claimCommunityReport', claimInput],
    ['closeReport', 'closeCommunityReport', closeInput],
  ] as const)('refreshes report lists and audit, but not unrelated users, after %s', async (
    method,
    _spy,
    input,
  ) => {
    const { module, spies } = createHarness()
    await warmDependencies(module)
    await warmDependencies(module)

    if (method === 'claimReport') {
      await module.community.claimReport(input)
    }
    else {
      await module.community.closeReport(input)
    }
    await warmDependencies(module)

    expect(spies.listCommunityReports).toHaveBeenCalledTimes(statuses.length * 2)
    expect(spies.listAudit).toHaveBeenCalledTimes(2)
    expect(spies.listUsers).toHaveBeenCalledTimes(1)
    expect(spies.getUser).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['claimReport', 'claimCommunityReport', claimInput, new MipAdminError('CONFLICT', '举报状态已变化')],
    ['closeReport', 'closeCommunityReport', closeInput, new MipAdminError('FORBIDDEN', '当前账号不能处理举报')],
  ] as const)('preserves caches and the original error when %s fails', async (
    method,
    spy,
    input,
    failure,
  ) => {
    const { module, spies } = createHarness()
    spies[spy].mockRejectedValueOnce(failure)
    await warmDependencies(module)

    const work = method === 'claimReport'
      ? module.community.claimReport(input)
      : module.community.closeReport(input)
    await expect(work).rejects.toBe(failure)
    await warmDependencies(module)

    expect(spies.listCommunityReports).toHaveBeenCalledTimes(statuses.length)
    expect(spies.listAudit).toHaveBeenCalledTimes(1)
    expect(spies.listUsers).toHaveBeenCalledTimes(1)
    expect(spies.getUser).toHaveBeenCalledTimes(1)
  })
})
