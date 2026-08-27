import type { AdminRequestInput } from '../domain/contracts'

export const ADMIN_MUTATION_ACTIONS = [
  'mip.admin.memberships.grant',
  'mip.admin.events.clone',
  'mip.admin.events.changeStatus',
  'mip.admin.events.archive',
  'mip.admin.communications.publishEventReminder',
  'mip.admin.refunds.submit',
] as const

export type AdminMutationAction = typeof ADMIN_MUTATION_ACTIONS[number]

export interface AdminMutationIntent {
  action: AdminMutationAction
  idempotencyKey: string
  input: AdminRequestInput
}

export function createMutationIntent(
  action: AdminMutationAction,
  input: AdminRequestInput,
  key = createIdempotencyKey(action),
): AdminMutationIntent {
  const normalizedKey = key.trim()
  if (!/^[A-Za-z0-9_.:-]{12,128}$/.test(normalizedKey)) {
    throw new TypeError('Invalid admin mutation idempotency key')
  }
  return {
    action,
    idempotencyKey: normalizedKey,
    input: { ...input, idempotencyKey: normalizedKey },
  }
}

export function createIdempotencyKey(action: AdminMutationAction): string {
  const prefix = action.split('.').at(-1) || 'mutation'
  const uuid = globalThis.crypto?.randomUUID?.()
    || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  return `web-${prefix}-${uuid.replaceAll('-', '')}`.slice(0, 128)
}
