import type { MyRegistrationCategory } from '../../../../modules/mip-events'

export function resolveMyRegistrationCategory(value: unknown): MyRegistrationCategory {
  return value === 'ATTENDED' || value === 'HISTORY' ? value : 'UPCOMING'
}
