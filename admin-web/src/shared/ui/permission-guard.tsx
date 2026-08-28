import type { ReactNode } from 'react'
import { useAdminSession } from '../../app/session-provider'
import { ForbiddenState, LoadingState } from './feedback-states'

export function PermissionGuard({ capabilities, requireAny, children, fallback }: {
  capabilities: string[]
  requireAny?: boolean
  children: ReactNode
  fallback?: ReactNode
}) {
  const { hasCapability, loading } = useAdminSession()
  if (loading) return <LoadingState label="正在验证访问权限" rows={3} />
  const allowed = requireAny
    ? capabilities.some(hasCapability)
    : capabilities.every(hasCapability)
  return allowed ? children : (fallback ?? <ForbiddenState />)
}
