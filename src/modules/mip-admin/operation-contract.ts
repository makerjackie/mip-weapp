import type {
  AdminOperationAction,
} from '@mip/admin-contracts'
import { ADMIN_OPERATION_CONTRACT } from '@mip/admin-contracts'

export type {
  AdminMutationAction,
  AdminOperation,
  AdminOperationAction,
  AdminOperationContract,
  AdminOperationKind,
  AdminQueryAction,
} from '@mip/admin-contracts'

for (const operation of ADMIN_OPERATION_CONTRACT.operations) {
  Object.freeze(operation)
}
Object.freeze(ADMIN_OPERATION_CONTRACT.operations)

export const adminOperationContract = Object.freeze(ADMIN_OPERATION_CONTRACT)

export const retryableAdminOperationActions: ReadonlySet<AdminOperationAction> = new Set(
  adminOperationContract.operations
    .filter(operation => operation.safeToRetry)
    .map(operation => operation.action),
)

export function isRetryableAdminOperationAction(action: string): boolean {
  return (retryableAdminOperationActions as ReadonlySet<string>).has(action)
}
