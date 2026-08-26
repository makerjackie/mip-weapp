import type { BranchId } from '../mip'
import type { BranchSelectionSnapshot, MipBranchesGateway } from './contracts'

export function createMipBranchesModule(gateway: MipBranchesGateway) {
  let latest: BranchSelectionSnapshot | undefined
  let generation = 0

  return {
    async load(primaryBranchId?: BranchId, userVersion = 0): Promise<BranchSelectionSnapshot> {
      const loadGeneration = generation
      const result = {
        branches: await gateway.listBranches(),
        primaryBranchId,
        userVersion,
      }
      if (loadGeneration === generation) {
        latest = result
      }
      return result
    },

    peek() {
      return latest
    },

    async setPrimaryBranch(branchId: BranchId, expectedVersion: number) {
      const selected = latest?.branches.find(branch => branch.id === branchId)
      if (selected && selected.status !== 'ACTIVE') {
        throw new Error('BRANCH_INACTIVE')
      }
      const loadGeneration = generation
      const result = await gateway.setPrimaryBranch({ branchId, expectedVersion })
      if (loadGeneration === generation) {
        latest = result
      }
      return result
    },

    invalidate() {
      generation += 1
      latest = undefined
    },
  }
}
