import { Button, Drawer, Space, Table, Typography } from 'antd'
import { useState } from 'react'
import type { AdminDetailPager, AdminDetailRoute, AdminDetailView } from '../../modules/admin-details'
import type { OperationValues } from '../../modules/admin-operation-ui'
import type { AdminOperationRow, AdminRowOperation } from '../../modules/admin-row-operations'
import { BatchActionBar, type BatchAction } from './batch-actions'
import { ErrorState, LoadingState } from './feedback-states'
import { StatusTag } from './status-tag'
import { OVERLAY_Z_INDEX } from './overlay-z-index'

type DetailSection = NonNullable<AdminDetailView>['sections'][number]

export function DetailDrawer({ open, view, loading, error, onClose, actions, onRowAction, onNestedView, onPagerChange, onRetry, batchActionsForSection, onSectionBatchAction }: {
  open: boolean
  view: AdminDetailView | null
  loading?: boolean
  error?: string
  onClose: () => void
  actions?: React.ReactNode
  onRowAction?: (operation: AdminRowOperation) => void
  onNestedView?: (target: AdminDetailRoute, row: AdminOperationRow) => void
  onPagerChange?: (pager: AdminDetailPager, direction: 'previous' | 'next') => void
  onRetry?: () => void
  batchActionsForSection?: (section: DetailSection) => readonly BatchAction[] | undefined
  onSectionBatchAction?: (section: DetailSection, action: BatchAction, rows: AdminOperationRow[], values: OperationValues) => Promise<void> | void
}) {
  const [selection, setSelection] = useState<Record<string, React.Key[]>>({})

  return (
    <Drawer
      className="detail-drawer"
      zIndex={OVERLAY_Z_INDEX.drawer}
      size={820}
      open={open}
      onClose={() => { setSelection({}); onClose() }}
      title={(
        <span className="detail-drawer__title">
          <strong>{view?.title || '详情'}</strong>
          {view?.subtitle ? <small>{view.subtitle}</small> : null}
        </span>
      )}
      extra={actions}
      destroyOnHidden
    >
      {loading && !view ? <LoadingState /> : null}
      {!loading && error ? <ErrorState description={error} onRetry={onRetry} /> : null}
      {!error && view ? (
        <Space orientation="vertical" size={16} className="detail-sections">
          {view.status ? <StatusTag value={view.status} /> : null}
          {view.sections.map((section) => {
            const sectionBatchActions = batchActionsForSection?.(section) ?? []
            const keys = selection[section.title] ?? []
            const keySet = new Set(keys.map(String))
            const selectedRows = section.rows?.filter(row => keySet.has(stableRowKey(row, section.title))) ?? []
            return (
              <section className="detail-section" key={section.title}>
                <Typography.Title level={4}>{section.title}</Typography.Title>
                {section.fields?.length ? (
                  <dl className="detail-fields">
                    {section.fields.map(field => <div key={field.label}><dt>{field.label}</dt><dd>{renderFieldValue(field.value)}</dd></div>)}
                  </dl>
                ) : null}
                {section.metrics?.length ? (
                  <dl className="detail-metrics">
                    {section.metrics.map(metric => <div key={metric.label}><dt>{metric.label}</dt><dd>{metric.value}</dd></div>)}
                  </dl>
                ) : null}
                {section.rows?.length && section.columns?.length ? (
                  <>
                    <Table
                      size="small"
                      pagination={false}
                      rowKey={row => stableRowKey(row, section.title)}
                      rowSelection={sectionBatchActions.length
                        ? {
                            selectedRowKeys: keys,
                            onChange: (next: React.Key[]) => setSelection(current => ({ ...current, [section.title]: next })),
                          }
                        : undefined}
                      columns={[
                        ...section.columns.map(column => ({
                          title: column.label,
                          dataIndex: column.key,
                          key: column.key,
                          render: (value: unknown) => ['status', 'state'].includes(column.key)
                            ? <StatusTag value={value} />
                            : String(value ?? '—'),
                        })),
                        ...((section.detailTarget && onNestedView) || (onRowAction && section.rows.some(row => row.rowActions?.length))
                          ? [{
                              title: '操作',
                              key: 'actions',
                              fixed: 'right' as const,
                              render: (_: unknown, row: AdminOperationRow) => (
                                <Space size={4}>
                                  {section.detailTarget && onNestedView && row.detailId
                                    ? <Button type="link" size="small" onClick={() => onNestedView(section.detailTarget!, row)}>查看</Button>
                                    : null}
                                  {onRowAction ? row.rowActions?.map(operation => (
                                    <Button type="link" size="small" key={`${operation.action}-${operation.label}`} onClick={() => onRowAction(operation)}>{operation.label}</Button>
                                  )) : null}
                                </Space>
                              ),
                            }]
                          : []),
                      ]}
                      dataSource={section.rows}
                      scroll={{ x: 'max-content' }}
                    />
                    {sectionBatchActions.length ? (
                      <BatchActionBar
                        count={selectedRows.length}
                        actions={sectionBatchActions}
                        onRun={(action, values) => onSectionBatchAction?.(section, action, selectedRows, values)}
                        onClear={() => setSelection(current => ({ ...current, [section.title]: [] }))}
                      />
                    ) : null}
                  </>
                ) : null}
                {section.pager ? (
                  <nav className="detail-section__pager" aria-label={`${section.title}分页`}>
                    <Space size={8}>
                      <Button
                        disabled={!section.pager.currentCursor || !onPagerChange}
                        onClick={() => onPagerChange?.(section.pager!, 'previous')}
                      >
                        上一页
                      </Button>
                      <Button
                        disabled={!section.pager.nextCursor || !onPagerChange}
                        onClick={() => onPagerChange?.(section.pager!, 'next')}
                      >
                        下一页
                      </Button>
                    </Space>
                  </nav>
                ) : null}
              </section>
            )
          })}
        </Space>
      ) : null}
    </Drawer>
  )
}

function stableRowKey(row: AdminOperationRow, prefix: string) {
  const id = row.detailId || row.id || row.key
  if (id) return String(id)
  return `${prefix}:${JSON.stringify(row, (key, value) => key === 'rowActions' ? undefined : value)}`
}

function renderFieldValue(value: React.ReactNode) {
  if (typeof value === 'string' && /^https:\/\/[^\s]+$/.test(value)) {
    return <a href={value} target="_blank" rel="noreferrer noopener">{value}</a>
  }
  return value
}
