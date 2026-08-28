import { Button, Drawer, Space, Table, Typography } from 'antd'
import type { AdminDetailRoute, AdminDetailView } from '../../modules/admin-details'
import type { AdminOperationRow, AdminRowOperation } from '../../modules/admin-row-operations'
import { ErrorState, LoadingState } from './feedback-states'
import { StatusTag } from './status-tag'

export function DetailDrawer({ open, view, loading, error, onClose, actions, onRowAction, onNestedView }: {
  open: boolean
  view: AdminDetailView | null
  loading?: boolean
  error?: string
  onClose: () => void
  actions?: React.ReactNode
  onRowAction?: (operation: AdminRowOperation) => void
  onNestedView?: (target: AdminDetailRoute, row: AdminOperationRow) => void
}) {
  return (
    <Drawer
      className="detail-drawer"
      width={820}
      open={open}
      onClose={onClose}
      title={(
        <span className="detail-drawer__title">
          <strong>{view?.title || '详情'}</strong>
          {view?.subtitle ? <small>{view.subtitle}</small> : null}
        </span>
      )}
      extra={actions}
      destroyOnHidden
    >
      {loading ? <LoadingState /> : null}
      {!loading && error ? <ErrorState description={error} /> : null}
      {!loading && !error && view ? (
        <Space direction="vertical" size={16} className="detail-sections">
          {view.status ? <StatusTag value={view.status} /> : null}
          {view.sections.map(section => (
            <section className="detail-section" key={section.title}>
              <Typography.Title level={4}>{section.title}</Typography.Title>
              {section.fields?.length ? (
                <dl className="detail-fields">
                  {section.fields.map(field => <div key={field.label}><dt>{field.label}</dt><dd>{field.value}</dd></div>)}
                </dl>
              ) : null}
              {section.metrics?.length ? (
                <dl className="detail-metrics">
                  {section.metrics.map(metric => <div key={metric.label}><dt>{metric.label}</dt><dd>{metric.value}</dd></div>)}
                </dl>
              ) : null}
              {section.rows?.length && section.columns?.length ? (
                <Table
                  size="small"
                  pagination={false}
                  rowKey={(row, index) => String(row.detailId || `${section.title}-${index}`)}
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
              ) : null}
            </section>
          ))}
        </Space>
      ) : null}
    </Drawer>
  )
}
