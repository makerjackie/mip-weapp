import { useMemo, useState } from 'react'
import { App, Avatar, Button, Card, Select, Space, Tabs } from 'antd'
import { CopyOutlined, ReloadOutlined } from '@ant-design/icons'
import { useParams, useRouterState, useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useAdminSession } from '../../app/session-provider'
import { loadAdminDetail, type AdminDetailView, type AdminDetailRoute } from '../../modules/admin-details'
import { profileCardFromUser } from '../../modules/admin-profile-cards'
import { loadUserProfileRecords, userProfileHref, type UserRecordTab } from '../../modules/user-profile-records'
import { record } from '../../modules/admin-read-formatters'
import { DetailSections, DetailDrawer } from '../../shared/ui/detail-drawer'
import { PageHeader, PermissionGuard, EmptyState } from '../../shared/ui'
import { ProfileEditorDialog } from '../profile-cards/profile-editor-dialog'
import { AdminDetailActions } from '../admin-runtime/admin-detail-actions'
import { useAdminDetail } from '../admin-runtime/use-admin-detail'
import { useAdminOperations } from '../admin-runtime/admin-operation-provider'
import { BadgeSelectionDialog } from './badge-selection-dialog'

const summaryTitles = new Set(['会员权益', '成长数据', '业务记录', '影响力数据'])
const recordTabs = new Set(['invitations', 'hearts', 'logs', 'history', 'content'])
export function UserProfilePage() {
  return <PermissionGuard capabilities={['users.read']}><UserProfileContent /></PermissionGuard>
}
function UserProfileContent() {
  const { userId } = useParams({ strict: false }) as { userId: string }
  const search = useRouterState({ select: state => state.location.search }) as { tab?: string; cursor?: string; direction?: string; status?: string; filters?: Record<string, string> }
  const tab = search.tab || 'basic'
  const navigate = useNavigate()
  const { request, session, sessionBoundary, hasCapabilityAtScope, hasCapability } = useAdminSession()
  const { message } = App.useApp()
  const [editing, setEditing] = useState(false)
  const [editingBadges, setEditingBadges] = useState(false)
  const nested = useAdminDetail()
  const operations = useAdminOperations()
  const query = useQuery({ queryKey: ['admin', 'user-profile', session?.actor?.id, sessionBoundary, userId],
    enabled: Boolean(session?.enabled && userId), queryFn: () => loadAdminDetail('users', userId, request, {
      includeUserMembership: hasCapabilityAtScope('memberships.read', 'PLATFORM'),
    }) })
  const related = useQuery({ queryKey: ['admin', 'user-profile-records', session?.actor?.id, sessionBoundary, userId, tab, search.cursor, search.direction, search.status, search.filters?.relatedSection],
    enabled: Boolean(query.data && recordTabs.has(tab) && session?.enabled),
    queryFn: () => loadUserProfileRecords(userId, tab as UserRecordTab, { cursor: search.cursor, direction: search.direction, status: search.status, relatedSection: search.filters?.relatedSection }, request) })
  const user = record(query.data?.source?.user)
  const profile = useMemo(() => query.data ? profileCardFromUser(query.data.source?.user) : null, [query.data])
  const sliced = (sections: AdminDetailView['sections']): AdminDetailView | null => query.data ? { ...query.data, sections } : null
  const showRelated = recordTabs.has(tab)
  const contentSections = query.data?.sections.filter(section => tab === 'basic' ? ['基本信息', '任职信息', '标签', '运营角色'].includes(section.title)
    : tab === 'growth' ? ['会员权益', '成长数据'].includes(section.title)
      : !summaryTitles.has(section.title) && !['基本信息', '任职信息', '标签', '运营角色'].includes(section.title)) || []
  const view = showRelated ? sliced(related.data?.sections || []) : sliced(contentSections)
  const openNested = (target: AdminDetailRoute, id: string) => target === 'users'
    ? window.open(userProfileHref(id), '_blank', 'noopener,noreferrer') : nested.openDetail(target, id)
  const setSearch = (next: typeof search) => void navigate({ search: next as never })
  return <>
    <PageHeader title={query.data?.title || '用户档案'} description={query.data?.subtitle} actions={<Space wrap>
      <Button icon={<CopyOutlined />} onClick={() => { void navigator.clipboard.writeText(`${window.location.origin}${window.location.pathname}${userProfileHref(userId)}`).then(() => message.success('档案链接已复制')).catch(() => message.error('复制失败，请复制浏览器地址。')) }}>复制链接</Button>
      <Button icon={<ReloadOutlined />} onClick={() => { void query.refetch(); if (showRelated) void related.refetch() }}>刷新</Button>
      <Button href={`#/cards?q=${encodeURIComponent(String(user.realName || user.nickname || ''))}`}>名片管理</Button>
    </Space>} />
    <div className="user-profile-layout">
      <aside><Card title={<Space><Avatar src={typeof user.avatarUrl === 'string' ? user.avatarUrl : undefined}>{String(user.nickname || '').slice(0, 1)}</Avatar>{query.data?.title || '用户'}</Space>}>
        <DetailSections open view={sliced(query.data?.sections.filter(section => summaryTitles.has(section.title)) || [])} loading={query.isLoading} error={query.error?.message} onClose={() => {}} onRetry={() => void query.refetch()} />
      </Card></aside>
      <section className="user-profile-main">
        {query.data ? <AdminDetailActions route="users" id={userId} view={query.data} onEditProfile={() => setEditing(true)} onEditBadges={() => setEditingBadges(true)} /> : null}
        <Tabs activeKey={tab} onChange={value => setSearch({ tab: value })} items={[{ key: 'basic', label: '基础与职业' }, { key: 'growth', label: '成长与权益' }, { key: 'content', label: '内容与业务' }, { key: 'invitations', label: '邀请嘉宾' }, { key: 'hearts', label: '心动明细' }, { key: 'history', label: '资料历史' }, { key: 'logs', label: '操作日志' }]} />
        {tab === 'content' ? <Select aria-label="关联业务类型" style={{ minWidth: 180, marginBottom: 16 }} value={search.filters?.relatedSection || 'superCases'} onChange={relatedSection => setSearch({ tab, filters: { relatedSection } })} options={[{ value: 'superCases', label: '超级案例' }, { value: 'cooperationCards', label: '合作卡' }, { value: 'opportunities', label: '发布的机会' }, { value: 'registrations', label: '报名活动' }, ...(hasCapability('orders.read') ? [{ value: 'orders', label: '关联订单' }] : [])]} /> : null}
        {tab === 'hearts' ? <Space wrap style={{ marginBottom: 16 }}><Select aria-label="心动方向" value={search.direction || 'ALL'} onChange={direction => setSearch({ tab, direction, status: search.status })} options={[{ value: 'ALL', label: '全部方向' }, { value: 'INCOMING', label: '收到心动' }, { value: 'OUTGOING', label: '主动心动' }, { value: 'MUTUAL', label: '相互心动' }]} /><Select aria-label="心动状态" value={search.status || ''} onChange={status => setSearch({ tab, direction: search.direction, status })} options={[{ value: '', label: '全部状态' }, { value: 'ACTIVE', label: '有效' }, { value: 'CANCELLED', label: '已撤销' }, { value: 'INVALID', label: '已失效' }]} /></Space> : null}
        <DetailSections open view={view} loading={query.isLoading || (showRelated && related.isLoading)} error={query.error?.message || (showRelated ? related.error?.message : '')} onClose={() => {}} onRetry={() => { void query.refetch(); if (showRelated) void related.refetch() }} onNestedView={(target, row) => openNested(target, String(row.detailId))} />
        {showRelated && !related.isLoading && !related.error && related.data && !related.data.sections.some(section => section.rows?.length || section.fields?.length) ? <EmptyState title="暂无记录" description="该用户在当前筛选下没有相关记录。" /> : null}
        {showRelated ? <Space><Button disabled={!search.cursor} onClick={() => setSearch({ ...search, cursor: undefined })}>返回最新</Button><Button disabled={!related.data?.nextCursor} onClick={() => setSearch({ ...search, cursor: related.data?.nextCursor || undefined })}>更早记录</Button></Space> : null}
      </section>
    </div>
    <ProfileEditorDialog item={editing ? profile : null} onClose={() => setEditing(false)} onSaved={() => void query.refetch()} />
    <BadgeSelectionDialog key={userId} userId={userId} open={editingBadges} onClose={() => setEditingBadges(false)} />
    <DetailDrawer open={Boolean(nested.selection)} view={nested.view} loading={nested.loading} error={nested.error} onClose={nested.closeDetail} onRetry={() => void nested.refreshDetail()} onPagerChange={nested.changeDetailPage} onNestedView={(target, row) => openNested(target, String(row.detailId))} onRowAction={operation => void operations.launch(operation.action, operation.targetId, nested.view, operation)} actions={nested.selection && nested.view ? <AdminDetailActions route={nested.selection.route} id={nested.selection.id} view={nested.view} /> : null} />
  </>
}
