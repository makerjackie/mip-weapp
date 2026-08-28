import { useRouterState } from '@tanstack/react-router'
import { navigationByPath, type AdminRoutePath } from '../app/navigation'
import { EmptyState, PageHeader, PermissionGuard } from '../shared/ui'

export function FoundationPage() {
  const pathname = useRouterState({ select: state => state.location.pathname }) as AdminRoutePath
  const item = navigationByPath.get(pathname) || navigationByPath.get('/overview')!
  return (
    <PermissionGuard capabilities={item.capabilities} requireAny={item.requireAny}>
      <PageHeader title={item.label} description={item.description} />
      <EmptyState title="暂无数据" description="当前页面没有可显示的服务端记录。" />
    </PermissionGuard>
  )
}
