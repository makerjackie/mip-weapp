import { Drawer, Space, Table, Typography } from 'antd'
import type { AdminDetailView } from '../../modules/admin-details'
import { ErrorState, LoadingState } from './feedback-states'
import { StatusTag } from './status-tag'

export function DetailDrawer({ open, view, loading, error, onClose, actions }: {
  open: boolean
  view: AdminDetailView | null
  loading?: boolean
  error?: string
  onClose: () => void
  actions?: React.ReactNode
}) {
  return (
    <Drawer
      className="detail-drawer"
      width={820}
      open={open}
      onClose={onClose}
      title={view?.title || '详情'}
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
              {section.rows?.length && section.columns?.length ? (
                <Table size="small" pagination={false} rowKey={(_, index) => `${section.title}-${index}`} columns={section.columns.map(column => ({ title: column.label, dataIndex: column.key, key: column.key }))} dataSource={section.rows} scroll={{ x: 'max-content' }} />
              ) : null}
            </section>
          ))}
        </Space>
      ) : null}
    </Drawer>
  )
}
