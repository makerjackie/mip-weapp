import { Button, Space, Typography } from 'antd'
import { LeftOutlined, RightOutlined } from '@ant-design/icons'
import type { ReactNode } from 'react'
import type { AdminDetailRoute } from '../../modules/admin-details'
import type { AdminTableRow, AdminTableSection } from '../../modules/admin-read-pages'
import type { AdminRowOperation } from '../../modules/admin-row-operations'
import {
  DataTable,
  EmptyState,
  ErrorState,
  FilterBar,
  LoadingState,
  MetricCard,
  PageHeader,
} from '../../shared/ui'
import type { FilterFieldAmount, FilterFieldRange } from '../../shared/ui/filter-bar'
import type { OperationsPageState, OperationsWriteIntent } from './types'

interface OperationsReadPageProps extends OperationsPageState {
  title: string
  description: string
  searchPlaceholder: string
  statusOptions: Array<{ value: string; label: string }>
  actions?: ReactNode
  extraFilterSlots?: ReactNode
  timeRangeFields?: FilterFieldRange
  amountRangeFields?: FilterFieldAmount
  paginated?: boolean
  detailRouteForSection?: (section: AdminTableSection, index: number) => AdminDetailRoute | null
  rowExtraActions?: (row: AdminTableRow, section: AdminTableSection, index: number) => ReactNode
}

export function OperationsReadPage({
  title,
  description,
  searchPlaceholder,
  statusOptions,
  actions,
  extraFilterSlots,
  timeRangeFields,
  amountRangeFields,
  paginated,
  detailRouteForSection,
  rowExtraActions,
  page,
  query,
  loading,
  refreshing,
  error,
  demoMode,
  hasPreviousPage,
  onFilterChange,
  onRefresh,
  onPreviousPage,
  onNextPage,
  onOpenDetail,
  onWrite,
  onPageSizeChange,
  canCapability,
}: OperationsReadPageProps) {
  const filterValue = { q: query.query, status: query.status, filters: query.filters }
  const showPagination = Boolean(paginated && (hasPreviousPage || page?.nextCursor))

  return (
    <>
      <PageHeader
        title={title}
        description={description}
        eyebrow={demoMode ? '演示数据' : undefined}
        actions={actions}
      />
      <FilterBar
        extraFilterSlots={extraFilterSlots}
        timeRangeFields={timeRangeFields}
        amountRangeFields={amountRangeFields}
        value={filterValue}
        placeholder={searchPlaceholder}
        statusOptions={statusOptions}
        loading={loading}
        showPageSize
        pageSize={query.limit ?? 20}
        onPageSizeChange={onPageSizeChange}
        onChange={value => onFilterChange({
          query: value.q.trim(),
          status: value.status,
          filters: value.filters && Object.keys(value.filters).length > 0
            ? Object.fromEntries(
                Object.entries(value.filters)
                  .filter(([, v]) => typeof v === 'string' && v.length > 0)
                  .map(([k, v]) => [k, String(v)]),
              )
            : undefined,
        })}
        onRefresh={onRefresh}
      />
      {loading && !page ? <LoadingState /> : null}
      {!loading && error ? <ErrorState description={error} onRetry={onRefresh} /> : null}
      {!loading && !error && !page ? (
        <EmptyState title="暂无页面数据" description="当前请求没有返回可显示的数据。" />
      ) : null}
      {page ? (
        <Space orientation="vertical" size={16} style={{ width: '100%' }}>
          {page.summary?.length ? (
            <div className="metric-grid">
              {page.summary.map(item => <MetricCard key={item.label} label={item.label} value={item.value} />)}
            </div>
          ) : null}
          {page.sections.length ? page.sections.map((section, index) => {
            const detailRoute = section.detailTarget === null
              ? null
              : section.detailTarget || detailRouteForSection?.(section, index) || null
            return (
              <section key={`${section.title || title}-${index}`} aria-labelledby={`${title}-section-${index}`}>
                {section.title ? <Typography.Title id={`${title}-section-${index}`} level={4}>{section.title}</Typography.Title> : null}
                {section.error ? <ErrorState description={section.error} onRetry={onRefresh} /> : <DataTable
                  label={section.title || title}
                  rows={section.rows}
                  columns={section.columns}
                  loading={refreshing}
                  onView={detailRoute && onOpenDetail
                    ? row => onOpenDetail({ route: detailRoute, id: String(row.detailId), row })
                    : undefined}
                  renderActions={onWrite || rowExtraActions || onOpenDetail ? (row) => {
                    const operationActions = rowOperations(row, onWrite, canCapability)
                    const extra = rowExtraActions?.(row, section, index)
                    const links = onOpenDetail && row.detailLinks?.map(link => <Button type="link" size="small" key={`${link.route}:${link.id}`} onClick={() => onOpenDetail({ route: link.route, id: link.id, row })}>{link.label}</Button>)
                    return operationActions || extra || links?.length ? <Space size={4} wrap>{links}{operationActions}{extra}</Space> : null
                  } : undefined}
                />}
              </section>
            )
          }) : <EmptyState title="暂无可显示的数据" description="当前筛选条件下没有可显示的服务端记录。" />}
          {showPagination ? (
            <nav aria-label={`${title}分页`}>
              <Space>
                <Button icon={<LeftOutlined />} disabled={!hasPreviousPage || !onPreviousPage} onClick={onPreviousPage}>上一页</Button>
                <Button
                  icon={<RightOutlined />}
                  iconPlacement="end"
                  disabled={!page.nextCursor || !onNextPage}
                  onClick={() => page.nextCursor && onNextPage?.(page.nextCursor)}
                >下一页</Button>
              </Space>
            </nav>
          ) : null}
        </Space>
      ) : null}
    </>
  )
}

function rowOperations(
  row: AdminTableRow,
  onWrite: ((intent: OperationsWriteIntent) => void) | undefined,
  canCapability?: (capability: string) => boolean,
) {
  if (!onWrite || !Array.isArray(row.rowActions) || !row.rowActions.length) return null
  const operations = (row.rowActions as AdminRowOperation[]).filter(operation =>
    !canCapability
    || !operation.allowedCapabilities?.length
    || operation.allowedCapabilities.some(canCapability))
  if (!operations.length) return null
  return operations.map(operation => (
    <Button
      type="link"
      size="small"
      key={`${operation.action}-${operation.label}`}
      onClick={() => onWrite({
        action: operation.action,
        targetId: operation.targetId,
        values: operation.values,
        expectedVersion: operation.expectedVersion,
        allowedCapabilities: operation.allowedCapabilities,
        row,
      })}
    >
      {operation.label}
    </Button>
  ))
}
