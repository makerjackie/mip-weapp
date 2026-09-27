import { CaretDownOutlined, CaretUpOutlined, SwapOutlined } from '@ant-design/icons'
import { Button, Image, Space, Table, type TableColumnsType, type TableProps } from 'antd'
import { useMemo, useState } from 'react'
import type { AdminTableColumn, AdminTableRow } from '../../modules/admin-read-pages'
import { EmptyState } from './feedback-states'
import { StatusTag } from './status-tag'

type SortDirection = 'ascend' | 'descend' | null

interface SortState {
  columnKey: string
  direction: SortDirection
}

function numericValue(raw: string): number | null {
  const normalized = raw.replace(/[¥$€£,%\s]/g, '')
  if (!normalized) return null
  const value = Number(normalized)
  return Number.isFinite(value) ? value : null
}

function timeValue(raw: string): number | null {
  if (!/^\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(raw)) return null
  const value = Date.parse(raw.replace(/\//g, '-'))
  return Number.isFinite(value) ? value : null
}

function compareCellValues(left: unknown, right: unknown): number {
  const a = String(left ?? '')
  const b = String(right ?? '')
  if (a === b) return 0
  const numberA = numericValue(a)
  const numberB = numericValue(b)
  if (numberA !== null && numberB !== null) return numberA - numberB
  const timeA = timeValue(a)
  const timeB = timeValue(b)
  if (timeA !== null && timeB !== null) return timeA - timeB
  return a.localeCompare(b, 'zh-Hans-CN')
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
  loading,
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
  loading?: boolean
}) {
  const [sortState, setSortState] = useState<SortState | null>(null)
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([])

  const sortedRows = useMemo(() => {
    if (!sortState) return rows
    const direction = sortState.direction === 'ascend' ? 1 : -1
    return [...rows].sort((a, b) => compareCellValues(a[sortState.columnKey], b[sortState.columnKey]) * direction)
  }, [rows, sortState])

  const tableColumns: TableColumnsType<AdminTableRow> = columns.map(column => ({
    title: column.label,
    dataIndex: column.key,
    key: column.key,
    sorter: true,
    sortOrder: sortState?.columnKey === column.key ? (sortState.direction ?? undefined) : undefined,
    sortIcon: ({ sortOrder }: { sortOrder?: SortDirection }) => sortOrder === 'ascend'
      ? <CaretUpOutlined style={{ fontSize: 12 }} />
      : sortOrder === 'descend'
        ? <CaretDownOutlined style={{ fontSize: 12 }} />
        : <SwapOutlined style={{ opacity: 0.35, fontSize: 12 }} />,
    render: (value: unknown) => {
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
        loading={loading}
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
