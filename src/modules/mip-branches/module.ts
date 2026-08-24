import type { BranchId } from '../mip'
import type { BranchSelectionSnapshot, MipBranchesGateway } from './contracts'

export function createMipBranchesModule(gateway: MipBranchesGateway) {
  let latest: BranchSelectionSnapshot | undefined

  return {
    async load(primaryBranchId?: BranchId, userVersion = 0): Promise<BranchSelectionSnapshot> {
      latest = {
        branches: await gateway.listBranches(),
        primaryBranchId,
        userVersion,
      }
      return latest
    },

    peek() {
      return latest
    },

    async setPrimaryBranch(branchId: BranchId, expectedVersion: number) {
      const selected = latest?.branches.find(branch => branch.id === branchId)
      if (selected && selected.status !== 'ACTIVE') {
        throw new Error('BRANCH_INACTIVE')
      }
      latest = await gateway.setPrimaryBranch({ branchId, expectedVersion })
      return latest
    },
  }
}
