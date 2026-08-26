import contractArtifact from './generated/admin-operation-contract.json'

export type AdminOperationKind = 'QUERY' | 'MUTATION'

export interface AdminOperationContractEntry {
  readonly action: string
  readonly kind: AdminOperationKind
  readonly authentication: 'REQUIRED'
  readonly session: 'REQUIRED'
  readonly safeToRetry: boolean
  readonly idempotencyKeyRequired: null
}

export interface AdminOperationContract {
  readonly version: number
  readonly operationCount: number
  readonly operations: readonly AdminOperationContractEntry[]
}

const operations = contractArtifact.operations.map(operation => Object.freeze({
  ...operation,
  kind: operation.kind as AdminOperationKind,
  authentication: operation.authentication as 'REQUIRED',
  session: operation.session as 'REQUIRED',
}))

export const adminOperationContract: AdminOperationContract = Object.freeze({
  version: contractArtifact.version,
  operationCount: contractArtifact.operationCount,
  operations: Object.freeze(operations),
})

export const retryableAdminOperationActions: ReadonlySet<string> = new Set(
  adminOperationContract.operations
    .filter(operation => operation.safeToRetry)
    .map(operation => operation.action),
)
