import { DownloadOutlined, PlusOutlined } from '@ant-design/icons'
import { Button, Typography } from 'antd'
import { useMemo } from 'react'
import { useAdminSession } from '../../app/session-provider'
import { EVENT_MUTATION_CONFIGS } from '../../modules/admin-event-mutation-forms'
import {
  getAdminReadRouteDefinition,
  type AdminListRoute,
  type AdminReadPage,
  type AdminTableRow,
} from '../../modules/admin-read-pages'
import {
  DataTable,
  ErrorState,
  FilterBar,
  LoadingState,
  MetricCard,
  PageHeader,
  PermissionGuard,
} from '../../shared/ui'
import type {
  CoreListPageCallbacks,
  CorePageDetailIntent,
  CorePageSearchState,
} from './core-page-types'
import { useCoreReadPage } from './use-core-page-query'
import './core-pages.css'

type CoreListRoute = Extract<AdminListRoute, 'users' | 'events' | 'orders'>

const pageDefinitions: Record<CoreListRoute, {
  title: string
  description: string
  capability: string
  detailRoute: CorePageDetailIntent['route']
}> = {
  users: {
    title: '用户管理',
    description: '查看会员、嘉宾及用户资料',
    capability: 'users.read',
    detailRoute: 'users',
  },
  events: {
    title: '活动管理',
    description: '查看活动信息、报名和签到状态',
    capability: 'events.read',
    detailRoute: 'events',
  },
  orders: {
    title: '订单管理',
    description: '查看会员和活动订单及支付状态',
    capability: 'orders.read',
    detailRoute: 'orders',
  },
}

export interface CoreListPageProps extends CoreListPageCallbacks {
  search: CorePageSearchState
}

export function UsersPage(props: CoreListPageProps) {
  return <CoreListPage route="users" {...props} />
}

export function EventsPage(props: CoreListPageProps) {
  return <CoreListPage route="events" {...props} />
}

export function OrdersPage(props: CoreListPageProps) {
  return <CoreListPage route="orders" {...props} />
}

function CoreListPage({ route, ...props }: CoreListPageProps & { route: CoreListRoute }) {
  const { hasCapability } = useAdminSession()
  const query = useCoreReadPage(route, props.search)
  const definition = pageDefinitions[route]
  return (
    <PermissionGuard capabilities={[definition.capability]}>
      <CoreListPageView
        {...props}
        route={route}
        page={query.data || null}
        loading={query.loading}
        error={query.errorMessage}
        canExport={hasCapability('exports.create')}
        canWriteEvents={hasCapability(EVENT_MUTATION_CONFIGS['mip.admin.events.save'].capability)}
        onRetry={() => void query.refetch()}
      />
    </PermissionGuard>
  )
}

export function CoreListPageView({
  route,
  search,
  page,
  loading,
  error,
  canExport,
  canWriteEvents,
  onRetry,
  onSearchChange,
  onOpenDetail,
  onPreviousPage,
  onMutation,
  onSensitiveExport,
}: CoreListPageCallbacks & {
  route: CoreListRoute
  search: CorePageSearchState
  page: AdminReadPage | null
  loading?: boolean
  error?: string
  canExport?: boolean
  canWriteEvents?: boolean
  onRetry?: () => void
}) {
  const pageDefinition = pageDefinitions[route]
  const readDefinition = getAdminReadRouteDefinition(route)
  const pageNumber = search.page && search.page > 1 ? search.page : 1
  const headerActions = useMemo(() => {
    if (route === 'events' && canWriteEvents && onMutation) {
      const config = EVENT_MUTATION_CONFIGS['mip.admin.events.save']
      return (
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => onMutation({ action: config.action, targetId: '' })}
        >
          新建活动
        </Button>
      )
    }
    if ((route === 'users' || route === 'orders') && canExport && onSensitiveExport) {
      return (
        <Button
          type="primary"
          icon={<DownloadOutlined />}
          onClick={() => onSensitiveExport({
            kind: route,
            filters: { query: search.q || '', status: search.status || '' },
          })}
        >
          {route === 'users' ? '导出用户' : '导出订单'}
        </Button>
      )
    }
    return null
  }, [canExport, canWriteEvents, onMutation, onSensitiveExport, route, search.q, search.status])

  function openDetail(row: AdminTableRow) {
    const id = String(row.detailId || '')
    if (!id) return
    onOpenDetail({ route: pageDefinition.detailRoute, id, row })
  }

  return (
    <>
      <PageHeader title={pageDefinition.title} description={pageDefinition.description} actions={headerActions} />
      <FilterBar
        value={{ q: search.q || '', status: search.status || '' }}
        placeholder={readDefinition.searchPlaceholder}
        statusOptions={readDefinition.statusOptions}
        loading={loading}
        onChange={value => onSearchChange({
          ...search,
          q: value.q || undefined,
          status: value.status || undefined,
          cursor: undefined,
          page: undefined,
        })}
        onRefresh={onRetry}
      />

      {page?.summary?.length ? (
        <section className="metric-grid core-summary-grid" aria-label="订单汇总">
          {page.summary.map(item => <MetricCard key={item.label} label={item.label} value={item.value} />)}
        </section>
      ) : null}

      {loading && !page ? <LoadingState /> : null}
      {!loading && error ? <ErrorState description={error} onRetry={onRetry} /> : null}
      {page ? (
        <div className="core-list-sections">
          {page.sections.map((section, index) => (
            <section key={`${section.title || pageDefinition.title}-${index}`} className="core-list-section">
              {section.title ? <Typography.Title level={2}>{section.title}</Typography.Title> : null}
              <DataTable
                label={section.title || pageDefinition.title}
                rows={section.rows}
                columns={section.columns}
                onView={section.detailTarget === null ? undefined : openDetail}
              />
            </section>
          ))}
        </div>
      ) : null}

      {readDefinition.paginated && page && (pageNumber > 1 || page.nextCursor) ? (
        <nav className="core-pagination" aria-label="分页">
          <Button disabled={pageNumber <= 1 || !onPreviousPage} onClick={onPreviousPage}>上一页</Button>
          <span>第 {pageNumber} 页</span>
          <Button
            disabled={!page.nextCursor}
            onClick={() => page.nextCursor && onSearchChange({
              ...search,
              cursor: page.nextCursor,
              page: pageNumber + 1,
            })}
          >
            下一页
          </Button>
        </nav>
      ) : null}
    </>
  )
}
