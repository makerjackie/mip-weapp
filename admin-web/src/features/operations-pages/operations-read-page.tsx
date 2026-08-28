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
import type { OperationsPageState, OperationsWriteIntent } from './types'

interface OperationsReadPageProps extends OperationsPageState {
  title: string
  description: string
  searchPlaceholder: string
  statusOptions: Array<{ value: string; label: string }>
  actions?: ReactNode
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
  paginated,
  detailRouteForSection,
  rowExtraActions,
  page,
  query,
  loading,
  error,
  demoMode,
  hasPreviousPage,
  onFilterChange,
  onRefresh,
  onPreviousPage,
  onNextPage,
  onOpenDetail,
  onWrite,
}: OperationsReadPageProps) {
  const filterValue = { q: query.query, status: query.status }
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
        value={filterValue}
        placeholder={searchPlaceholder}
        statusOptions={statusOptions}
        loading={loading}
        onChange={value => onFilterChange({ query: value.q.trim(), status: value.status })}
        onRefresh={onRefresh}
      />
      {loading && !page ? <LoadingState /> : null}
      {!loading && error ? <ErrorState description={error} onRetry={onRefresh} /> : null}
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
                <DataTable
                  label={section.title || title}
                  rows={section.rows}
                  columns={section.columns}
                  onView={detailRoute && onOpenDetail
                    ? row => onOpenDetail({ route: detailRoute, id: String(row.detailId), row })
                    : undefined}
                  renderActions={onWrite || rowExtraActions ? (row) => {
                    const operationActions = rowOperations(row, onWrite)
                    const extra = rowExtraActions?.(row, section, index)
                    return operationActions || extra ? <Space size={4}>{operationActions}{extra}</Space> : null
                  } : undefined}
                />
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
) {
  if (!onWrite || !Array.isArray(row.rowActions) || !row.rowActions.length) return null
  return (row.rowActions as AdminRowOperation[]).map(operation => (
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
