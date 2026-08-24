import type { BranchId, CityBranchSummary } from '../mip'

export interface BranchSelectionSnapshot {
  branches: CityBranchSummary[]
  primaryBranchId?: BranchId
  userVersion: number
}

export interface SetPrimaryBranchInput {
  branchId: BranchId
  expectedVersion: number
}

export interface MipBranchesGateway {
  listBranches: () => Promise<CityBranchSummary[]>
  setPrimaryBranch: (input: SetPrimaryBranchInput) => Promise<BranchSelectionSnapshot>
}
