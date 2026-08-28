import type { ReactNode } from 'react'
import { useAdminSession } from '../../app/session-provider'
import { ForbiddenState } from './feedback-states'

export function PermissionGuard({ capabilities, requireAny, children, fallback }: {
  capabilities: string[]
  requireAny?: boolean
  children: ReactNode
  fallback?: ReactNode
}) {
  const { hasCapability } = useAdminSession()
  const allowed = requireAny
    ? capabilities.some(hasCapability)
    : capabilities.every(hasCapability)
  return allowed ? children : (fallback ?? <ForbiddenState />)
}
