import {
  ADMIN_WEB_OPERATION_CONTRACT,
  type AdminWebMutationAction,
} from '@mip/admin-contracts'

export interface ReviewedAdminMutation {
  action: AdminWebMutationAction
  required: readonly string[]
  optional: readonly string[]
}

export const WEB_ADMIN_QUERY_ACTIONS: ReadonlySet<string> = new Set(
  ADMIN_WEB_OPERATION_CONTRACT.operations
    .filter(operation => operation.webAllowed
      && operation.webRoute === 'ADMIN'
      && operation.kind === 'QUERY')
    .map(operation => operation.action),
)

export const REVIEWED_ADMIN_MUTATIONS: readonly ReviewedAdminMutation[] = Object.freeze(
  ADMIN_WEB_OPERATION_CONTRACT.operations
    .filter(operation => operation.webAllowed
      && operation.webRoute === 'ADMIN'
      && operation.kind === 'MUTATION')
    .map(operation => Object.freeze({
      action: operation.action as AdminWebMutationAction,
      required: operation.requiredInputKeys,
      optional: operation.optionalInputKeys,
    })),
)

export const REVIEWED_ADMIN_MUTATION_ACTIONS: ReadonlySet<string> = new Set(
  REVIEWED_ADMIN_MUTATIONS.map(item => item.action),
)

export const REVIEWED_ADMIN_MUTATION_SCHEMAS: ReadonlyMap<string, {
  required: ReadonlySet<string>
  optional: ReadonlySet<string>
}> = new Map(
  REVIEWED_ADMIN_MUTATIONS.map(item => [
    item.action,
    { required: new Set(item.required), optional: new Set(item.optional) },
  ]),
)
