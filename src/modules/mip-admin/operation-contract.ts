import type {
  AdminOperationAction,
  AdminOperationKind,
} from '@mip/admin-contracts'
import contractArtifact from './generated/admin-operation-contract.json'

export type {
  AdminMutationAction,
  AdminOperation,
  AdminOperationAction,
  AdminOperationContract,
  AdminOperationKind,
  AdminQueryAction,
} from '@mip/admin-contracts'

export interface AdminOperationContractEntry {
  readonly action: AdminOperationAction
  readonly kind: AdminOperationKind
  readonly authentication: 'REQUIRED'
  readonly session: 'REQUIRED'
  readonly safeToRetry: boolean
  readonly idempotencyKeyRequired: null
}

interface AdminOperationRuntimeContract {
  readonly version: number
  readonly operationCount: number
  readonly operations: readonly AdminOperationContractEntry[]
}

const operations = contractArtifact.operations.map(operation => Object.freeze({
  ...operation,
  action: operation.action as AdminOperationAction,
  kind: operation.kind as AdminOperationKind,
  authentication: operation.authentication as 'REQUIRED',
  session: operation.session as 'REQUIRED',
}))

export const adminOperationContract: AdminOperationRuntimeContract = Object.freeze({
  version: contractArtifact.version,
  operationCount: contractArtifact.operationCount,
  operations: Object.freeze(operations),
})

export const retryableAdminOperationActions: ReadonlySet<AdminOperationAction> = new Set(
  adminOperationContract.operations
    .filter(operation => operation.safeToRetry)
    .map(operation => operation.action),
)

export function isRetryableAdminOperationAction(action: string): boolean {
  return (retryableAdminOperationActions as ReadonlySet<string>).has(action)
}
