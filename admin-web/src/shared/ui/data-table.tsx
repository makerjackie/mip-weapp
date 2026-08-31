import { Button, Space, Table, type TableColumnsType } from 'antd'
import type { AdminTableColumn, AdminTableRow } from '../../modules/admin-read-pages'
import { EmptyState } from './feedback-states'
import { StatusTag } from './status-tag'

export function DataTable({ label, rows, columns, onView, renderActions }: {
  label: string
  rows: AdminTableRow[]
  columns: AdminTableColumn[]
  onView?: (row: AdminTableRow) => void
  renderActions?: (row: AdminTableRow) => React.ReactNode
}) {
  const tableColumns: TableColumnsType<AdminTableRow> = columns.map(column => ({
    title: column.label,
    dataIndex: column.key,
    key: column.key,
    render: (value: unknown) => ['status', 'state'].includes(column.key) ? <StatusTag value={value} /> : String(value ?? '—'),
  }))
  if (onView || renderActions) {
    tableColumns.push({
      title: '操作',
      key: 'actions',
      fixed: 'right',
      width: 128,
      render: (_, row) => (
        <Space size={4}>
          {onView && row.detailId ? <Button type="link" size="small" onClick={() => onView(row)}>查看</Button> : null}
          {renderActions?.(row)}
        </Space>
      ),
    })
  }
  return (
    <div className="data-table" role="region" aria-label={label} tabIndex={0}>
      <Table<AdminTableRow>
        size="middle"
        pagination={false}
        rowKey={row => stableRowKey(row, label)}
        columns={tableColumns}
        dataSource={rows}
        scroll={{ x: 'max-content' }}
        locale={{ emptyText: <EmptyState /> }}
      />
    </div>
  )
}

function stableRowKey(row: AdminTableRow, prefix: string) {
  const id = row.detailId || row.id || row.key
  if (id) return String(id)
  return `${prefix}:${JSON.stringify(row, (key, value) => key === 'rowActions' ? undefined : value)}`
}
