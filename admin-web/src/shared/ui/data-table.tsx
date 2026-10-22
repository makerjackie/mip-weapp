import { Button, Image, Space, Table, Tooltip, Typography, type TableColumnsType } from 'antd'
import { useMemo, useState } from 'react'
import type { AdminTableColumn, AdminTableRow } from '../../modules/admin-read-pages'
import type { OperationValues } from '../../modules/admin-operation-ui'
import { BatchActionBar, type BatchAction } from './batch-actions'
import { EmptyState } from './feedback-states'
import { StatusTag } from './status-tag'

export type { BatchAction } from './batch-actions'

export function DataTable({
  label,
  rows,
  columns,
  onView,
  onRowClick,
  renderActions,
  renderCell,
  selectable,
  batchActions,
  onBatchAction,
  rowKey: rowKeyProp,
  loading,
}: {
  label: string
  rows: AdminTableRow[]
  columns: AdminTableColumn[]
  onView?: (row: AdminTableRow) => void
  onRowClick?: (row: AdminTableRow) => void
  renderActions?: (row: AdminTableRow) => React.ReactNode
  renderCell?: (value: unknown, row: AdminTableRow, column: AdminTableColumn) => React.ReactNode
  selectable?: boolean
  batchActions?: readonly BatchAction[]
  onBatchAction?: (action: BatchAction, selectedRows: AdminTableRow[], values: OperationValues) => Promise<void> | void
  rowKey?: (row: AdminTableRow) => string
  loading?: boolean
}) {
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([])

  const tableColumns: TableColumnsType<AdminTableRow> = columns.map(column => ({
    title: column.label,
    dataIndex: column.key,
    key: column.key,
    width: column.width,
    fixed: column.fixed,
    onCell: column.wrap ? () => ({ style: { whiteSpace: 'normal', overflowWrap: 'anywhere', maxWidth: column.width } }) : undefined,
    render: (value: unknown, row) => {
      const custom = renderCell?.(value, row, column)
      if (custom !== undefined) return custom
      if (column.format === 'identifier' && value && value !== '—') {
        const full = String(value)
        const short = full.length > 18 ? `${full.slice(0, 8)}…${full.slice(-6)}` : full
        return <Tooltip title={full}><Typography.Text copyable={{ text: full, tooltips: ['复制完整编号', '已复制'] }}>{short}</Typography.Text></Tooltip>
      }
      if (['status', 'state'].includes(column.key)) return <StatusTag value={value} />
      const url = typeof value === 'string' ? value : ''
      if (/^(imageUrl|coverUrl|iconUrl|avatarUrl)$/.test(column.key) && /^https:\/\//.test(url)) {
        return <Image src={url} alt="预览" width={72} height={48} style={{ objectFit: 'cover', borderRadius: 6 }} />
      }
      return String(value ?? '—')
    },
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

  const selectionConfig = useMemo(
    () => selectable && batchActions?.length
      ? {
          selectedRowKeys,
          onChange: (keys: React.Key[]) => setSelectedRowKeys(keys),
          selections: [
            Table.SELECTION_ALL,
            Table.SELECTION_INVERT,
            Table.SELECTION_NONE,
          ],
        }
      : undefined,
    [selectable, batchActions, selectedRowKeys],
  )

  const selectedRows = useMemo(
    () => {
      if (!selectionConfig) return []
      const keySet = new Set(selectedRowKeys.map(String))
      return rows.filter(row => keySet.has(stableRowKey(row, label)))
    },
    [selectionConfig, rows, selectedRowKeys, label],
  )

  return (
    <div className="data-table" role="region" aria-label={label} tabIndex={0}>
      <Table<AdminTableRow>
        size="middle"
        pagination={false}
        loading={loading}
        rowKey={row => rowKeyProp ? rowKeyProp(row) : stableRowKey(row, label)}
        columns={tableColumns}
        dataSource={rows}
        scroll={{ x: 'max-content' }}
        locale={{ emptyText: <EmptyState /> }}
        rowSelection={selectionConfig}
        onRow={onRowClick ? (row): React.HTMLAttributes<HTMLTableRowElement> => ({
          onClick: () => onRowClick(row),
          onKeyDown: event => {
            if (event.key === 'Enter' || event.key === ' ') onRowClick(row)
          },
          tabIndex: 0,
          style: { cursor: 'pointer' },
        }) : undefined}
      />
      {batchActions?.length ? (
        <BatchActionBar
          count={selectedRows.length}
          actions={batchActions}
          onRun={(action, values) => onBatchAction?.(action, selectedRows, values)}
          onClear={() => setSelectedRowKeys([])}
        />
      ) : null}
    </div>
  )
}

function stableRowKey(row: AdminTableRow, prefix: string) {
  const id = row.detailId || row.id || row.key
  if (id) return String(id)
  return `${prefix}:${JSON.stringify(row, (key, value) => key === 'rowActions' ? undefined : value)}`
}
