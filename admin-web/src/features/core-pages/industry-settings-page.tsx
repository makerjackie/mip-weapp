import { PlusOutlined, ReloadOutlined } from '@ant-design/icons'
import { Button, Space } from 'antd'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useAdminSession } from '../../app/session-provider'
import { INDUSTRY_CAPABILITY, loadIndustryCatalog } from '../../modules/admin-industry-management'
import { useAdminOperations } from '../admin-runtime/admin-operation-provider'
import { DataTable, ErrorState, LoadingState, PageHeader, PermissionGuard } from '../../shared/ui'

const columns = [{ key: 'label', label: '名称' }, { key: 'level', label: '层级' }, { key: 'parentLabel', label: '所属分类' }, { key: 'popularLabel', label: '热门' }, { key: 'sortOrder', label: '排序' }, { key: 'state', label: '状态' }]

export function IndustrySettingsPage() {
  return <PermissionGuard capabilities={[INDUSTRY_CAPABILITY]}><IndustrySettingsView /></PermissionGuard>
}

function IndustrySettingsView() {
  const navigate = useNavigate()
  const { request, demoMode, session, sessionBoundary, loading: sessionLoading, hasCapabilityAtScope } = useAdminSession()
  const { launch } = useAdminOperations()
  const canManage = hasCapabilityAtScope(INDUSTRY_CAPABILITY, 'PLATFORM')
  const enabled = Boolean(session?.enabled) && canManage
  const query = useQuery({ queryKey: ['admin', 'industries', session?.actor?.id || 'anonymous', sessionBoundary], enabled: enabled && !demoMode, queryFn: () => loadIndustryCatalog(request) })
  const items = query.data || []
  const groups = items.filter(item => !item.selectable && !item.parentId)
  const rows = items.map(item => ({ ...item, level: item.selectable ? '二级行业' : '一级分类', parentLabel: groups.find(group => group.id === item.parentId)?.label || '—', popularLabel: item.popular ? '是' : '—', state: item.enabled ? item.parentId && !groups.find(group => group.id === item.parentId)?.enabled ? '所属分类已停用' : '启用' : '停用' }))
  return <>
    <PageHeader title="行业设置" description="维护个人资料和人才筛选使用的两级行业目录。" actions={<Space wrap>
      <Button onClick={() => void navigate({ to: '/users' })}>返回用户列表</Button>
      <Button icon={<ReloadOutlined />} onClick={() => void query.refetch()} disabled={demoMode}>刷新</Button>
      {canManage && !demoMode ? <>
        <Button icon={<PlusOutlined />} onClick={() => void launch('mip.admin.industries.save', '', null, { values: { parentId: null } })}>新增一级分类</Button>
        <Button type="primary" icon={<PlusOutlined />} disabled={!groups.length} onClick={() => void launch('mip.admin.industries.save', '', null, { values: { parentId: groups.find(group => group.enabled)?.id || groups[0]?.id } })}>新增行业</Button>
      </> : null}
    </Space>} />
    {demoMode ? <ErrorState description="演示模式不读取或修改真实行业目录，请连接后台服务后操作。" /> : null}
    {!demoMode && (sessionLoading || (enabled && query.isPending)) ? <LoadingState /> : null}
    {!demoMode && query.error ? <ErrorState description={query.error instanceof Error ? query.error.message : '行业目录加载失败'} onRetry={() => void query.refetch()} /> : null}
    {!demoMode && query.data ? <DataTable label="行业目录" columns={columns} rows={rows} loading={query.isFetching} renderActions={canManage ? row => <Space>
      <Button type="link" size="small" onClick={() => void launch('mip.admin.industries.save', String(row.id), null, { expectedVersion: Number(row.version) })}>编辑</Button>
      <Button type="link" size="small" onClick={() => void launch('mip.admin.industries.changeStatus', String(row.id), null, { expectedVersion: Number(row.version), values: { enabled: !row.enabled } })}>{row.enabled ? '停用' : '启用'}</Button>
    </Space> : undefined} /> : null}
  </>
}
