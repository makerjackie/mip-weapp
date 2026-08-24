import type { BranchId, CityBranchSummary } from '../src/modules/mip'
import { describe, expect, it, vi } from 'vitest'
import { createMipBranchesModule } from '../src/modules/mip-branches'

const activeBranch: CityBranchSummary = {
  id: '20000000-0000-4000-8000-000000000001' as BranchId,
  name: '深圳分会',
  cityName: '深圳',
  status: 'ACTIVE',
}

describe('MIP city branch module', () => {
  it('uses the server result as the primary-branch fact', async () => {
    const gateway = {
      listBranches: vi.fn(async () => [activeBranch]),
      setPrimaryBranch: vi.fn(async () => ({
        branches: [activeBranch],
        primaryBranchId: activeBranch.id,
        userVersion: 3,
      })),
    }
    const module = createMipBranchesModule(gateway)
    await module.load(undefined, 2)

    await expect(module.setPrimaryBranch(activeBranch.id, 2)).resolves.toMatchObject({
      primaryBranchId: activeBranch.id,
      userVersion: 3,
    })
    expect(gateway.setPrimaryBranch).toHaveBeenCalledWith({
      branchId: activeBranch.id,
      expectedVersion: 2,
    })
  })

  it('does not submit a known inactive branch', async () => {
    const inactive = { ...activeBranch, status: 'INACTIVE' as const }
    const gateway = {
      listBranches: vi.fn(async () => [inactive]),
      setPrimaryBranch: vi.fn(),
    }
    const module = createMipBranchesModule(gateway)
    await module.load()

    await expect(module.setPrimaryBranch(inactive.id, 1)).rejects.toThrow('BRANCH_INACTIVE')
    expect(gateway.setPrimaryBranch).not.toHaveBeenCalled()
  })
})
