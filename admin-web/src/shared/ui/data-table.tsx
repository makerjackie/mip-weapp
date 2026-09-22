import { DownOutlined, UpOutlined } from '@ant-design/icons'
import { Button, Space, Table, type TableColumnsType, type TableProps } from 'antd'
import { useMemo, useState } from 'react'
import type { AdminTableColumn, AdminTableRow } from '../../modules/admin-read-pages'
import { EmptyState } from './feedback-states'
import { StatusTag } from './status-tag'

type SortDirection = 'ascend' | 'descend' | null

interface SortState {
  columnKey: string
  direction: SortDirection
}

export interface BatchAction {
  key: string
  label: string
  danger?: boolean
  onApply: (selectedRows: AdminTableRow[]) => void
}

export function DataTable({
  label,
  rows,
  columns,
  onView,
  renderActions,
  selectable,
  batchActions,
  onBatchAction,
  rowKey: rowKeyProp,
}: {
  label: string
  rows: AdminTableRow[]
  columns: AdminTableColumn[]
  onView?: (row: AdminTableRow) => void
  renderActions?: (row: AdminTableRow) => React.ReactNode
  selectable?: boolean
  batchActions?: readonly BatchAction[]
  onBatchAction?: (action: BatchAction, selectedRows: AdminTableRow[]) => void
  rowKey?: (row: AdminTableRow) => string
}) {
  const [sortState, setSortState] = useState<SortState | null>(null)
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([])

  const sortedRows = useMemo(() => {
    if (!sortState) return rows
    const direction = sortState.direction === 'ascend' ? 1 : -1
    return [...rows].sort((a, b) => {
      const va = String(a[sortState.columnKey] ?? '')
      const vb = String(b[sortState.columnKey] ?? '')
      const na = Number(va)
      const nb = Number(vb)
      if (va !== '' && vb !== '' && !Number.isNaN(na) && !Number.isNaN(nb)) return (na - nb) * direction
      return va.localeCompare(vb, 'zh-Hans-CN') * direction
    })
  }, [rows, sortState])

  const tableColumns: TableColumnsType<AdminTableRow> = columns.map(column => ({
    title: column.label,
    dataIndex: column.key,
    key: column.key,
    sorter: true,
    sortOrder: sortState?.columnKey === column.key ? (sortState.direction ?? undefined) : undefined,
    sortIcon: ({ sortOrder }: { sortOrder?: SortDirection }) => sortOrder === 'ascend'
      ? <UpOutlined style={{ fontSize: 10 }} />
      : sortOrder === 'descend'
        ? <DownOutlined style={{ fontSize: 10 }} />
        : <span style={{ opacity: 0.3, fontSize: 10 }}>⇅</span>,
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

  const handleSorterChange: TableProps<AdminTableRow>['onChange'] = (_pagination, _filters, sorter) => {
    const sorterInfo = Array.isArray(sorter) ? sorter[0] : sorter
    if (!sorterInfo || !sorterInfo.columnKey) {
      setSortState(null)
      return
    }
    setSortState({
      columnKey: String(sorterInfo.columnKey),
      direction: (sorterInfo.order ?? null) as SortDirection,
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
      return sortedRows.filter(row => keySet.has(stableRowKey(row, label)))
    },
    [selectionConfig, sortedRows, selectedRowKeys, label],
  )

  return (
    <div className="data-table" role="region" aria-label={label} tabIndex={0}>
      <Table<AdminTableRow>
        size="middle"
        pagination={false}
        rowKey={row => rowKeyProp ? rowKeyProp(row) : stableRowKey(row, label)}
        columns={tableColumns}
        dataSource={sortedRows}
        scroll={{ x: 'max-content' }}
        locale={{ emptyText: <EmptyState /> }}
        rowSelection={selectionConfig}
        onChange={handleSorterChange}
      />
      {selectionConfig && selectedRows.length > 0 ? (
        <div className="batch-action-bar" role="toolbar" aria-label="批量操作">
          <span className="batch-action-bar__count">已选 {selectedRows.length} 项</span>
          <Space size={8}>
            {batchActions!.map(action => (
              <Button
                key={action.key}
                size="small"
                danger={action.danger}
                onClick={() => {
                  onBatchAction?.(action, selectedRows)
                  setSelectedRowKeys([])
                }}
              >
                {action.label}
              </Button>
            ))}
            <Button size="small" type="link" onClick={() => setSelectedRowKeys([])}>取消选择</Button>
          </Space>
        </div>
      ) : null}
    </div>
  )
}

function stableRowKey(row: AdminTableRow, prefix: string) {
  const id = row.detailId || row.id || row.key
  if (id) return String(id)
  return `${prefix}:${JSON.stringify(row, (key, value) => key === 'rowActions' ? undefined : value)}`
}
