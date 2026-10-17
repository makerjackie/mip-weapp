import { PlusOutlined } from '@ant-design/icons'
import { Button, Space } from 'antd'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useAdminSession } from '../../app/session-provider'
import { EVENT_MUTATION_CONFIGS } from '../../modules/admin-event-mutation-forms'
import { label, record } from '../../modules/admin-read-formatters'
import type { AdminRequest, AdminTableRow } from '../../modules/admin-read-pages'
import { eventCatalogRowActions, type AdminRowOperation } from '../../modules/admin-row-operations'
import { useAdminOperations } from '../admin-runtime/admin-operation-provider'
import { DataTable, ErrorState, LoadingState, PageHeader, PermissionGuard } from '../../shared/ui'
import { createCoreDemoEventTagCatalog } from './core-demo-adapter'

const eventTagColumns = [
  { key: 'name', label: '标签名称' },
  { key: 'state', label: '状态' },
]

/** MIW-126：活动标签设置页。标签的增改、启停与归档复用现有活动目录操作。 */
export function EventSettingsPage() {
  return (
    <PermissionGuard capabilities={[EVENT_MUTATION_CONFIGS['mip.admin.events.catalog.save'].capability]}>
      <EventSettingsView />
    </PermissionGuard>
  )
}

function EventSettingsView() {
  const navigate = useNavigate()
  const { request, demoMode, session, sessionBoundary, loading: sessionLoading, hasCapabilityAtScope } = useAdminSession()
  const { launch } = useAdminOperations()
  const canManage = hasCapabilityAtScope(EVENT_MUTATION_CONFIGS['mip.admin.events.catalog.save'].capability, 'PLATFORM')
  const enabled = demoMode || Boolean(session?.enabled)
  const query = useQuery({
    queryKey: ['admin', 'event-settings', 'tags', session?.actor?.id || 'anonymous', sessionBoundary, demoMode ? 'demo' : 'api'],
    enabled,
    queryFn: () => demoMode
      ? Promise.resolve(createCoreDemoEventTagCatalog())
      : loadEventTagRows(request),
  })
  const onRowAction = (operation: AdminRowOperation) => void launch(operation.action, operation.targetId, null, {
    values: operation.values,
    expectedVersion: operation.expectedVersion,
    allowedCapabilities: operation.allowedCapabilities,
  })
  const loading = sessionLoading || (enabled && query.isPending)
  const refreshing = enabled && query.isFetching && !query.isPending
  const errorMessage = query.error instanceof Error ? query.error.message : ''
  return (
    <>
      <PageHeader
        title="活动设置"
        description="维护活动标签目录。标签用于活动筛选与活动展示。"
        actions={(
          <Space wrap>
            <Button onClick={() => void navigate({ to: '/events' })}>返回活动列表</Button>
            {canManage ? (
              <Button
                type="primary"
                icon={<PlusOutlined />}
                onClick={() => onRowAction({
                  action: 'mip.admin.events.catalog.save',
                  label: '新增活动标签',
                  targetId: '',
                  values: { kind: 'TAG' },
                })}
              >
                新增活动标签
              </Button>
            ) : null}
          </Space>
        )}
      />
      {loading && !query.data ? <LoadingState /> : null}
      {!loading && errorMessage ? <ErrorState description={errorMessage} onRetry={() => void query.refetch()} /> : null}
      {query.data ? (
        <DataTable
          label="活动标签"
          rows={query.data}
          columns={eventTagColumns}
          loading={refreshing}
          renderActions={canManage ? row => renderEventTagRowActions(row, onRowAction) : undefined}
        />
      ) : null}
    </>
  )
}

async function loadEventTagRows(request: AdminRequest): Promise<AdminTableRow[]> {
  const payload = record(await request('mip.admin.events.catalog.list', { kind: 'TAG' }))
  const items = Array.isArray(payload.items) ? payload.items : []
  return items.map(item => {
    const entry = record(item)
    return {
      detailId: String(entry.id || entry.catalogId || ''),
      name: String(entry.name || ''),
      state: label(entry.status),
      rowActions: eventCatalogRowActions(entry),
    }
  })
}

function renderEventTagRowActions(row: AdminTableRow, onAction: (operation: AdminRowOperation) => void) {
  const operations = Array.isArray(row.rowActions) ? row.rowActions : []
  return operations.map(operation => (
    <Button
      key={`${operation.action}-${operation.label}`}
      type="link"
      size="small"
      onClick={() => onAction(operation)}
    >
      {operation.label}
    </Button>
  ))
}
