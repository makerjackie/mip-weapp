import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createMipAdminGateway } from '../src/modules/mip-admin/cloudbase-gateway'

vi.mock('../src/modules/platform/cloudbase', () => ({
  requireCloudClient: vi.fn(),
}))

vi.mock('../src/config/runtime', () => ({
  runtimeConfig: { cloudbase: { adminFunctionName: 'mip-admin-api' } },
}))

const branch = {
  id: '11111111-1111-4111-8111-111111111111',
  branchKey: 'shenzhen',
  name: '深圳分会',
  cityName: '深圳',
  summary: '深圳城市分会',
  status: 'ACTIVE',
  version: 3,
  currentPlayerCount: 8,
  branchAdminNames: ['管理员甲', '管理员乙'],
  blockers: {
    activeMemberships: 10,
    activeBranchAdmins: 2,
    publishedEvents: 1,
    publishedOpportunities: 0,
  },
}

describe('MIP admin branch list contract', () => {
  it('accepts server-owned player count and all readable branch admin names', async () => {
    const request = vi.fn(async () => ({ items: [branch], nextCursor: null }))

    await expect(createMipAdminGateway({ request }).listBranches()).resolves.toEqual({
      items: [branch],
      nextCursor: null,
    })
    expect(request).toHaveBeenCalledWith({
      contractVersion: 1,
      action: 'mip.admin.branches.list',
      input: {},
    })
  })

  it('renders the summary fields through the responsive admin section grid', () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), 'src/packages/admin/branches/index.wxml'),
      'utf8',
    )
    expect(source).toContain('有效玩家 {{item.currentPlayerCount}}')
    expect(source).toContain('城市管理员 {{item.branchAdminSummary}}')
    expect(source).toContain('class="mip-admin-section-grid mt-3 grid gap-2')
  })
})
