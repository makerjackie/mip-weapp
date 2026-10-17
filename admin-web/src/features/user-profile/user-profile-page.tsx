import { useMemo, useState } from 'react'
import { App, Avatar, Button, Card, Space, Tabs } from 'antd'
import { CopyOutlined, ReloadOutlined } from '@ant-design/icons'
import { useParams, useRouterState, useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useAdminSession } from '../../app/session-provider'
import { loadAdminDetail, type AdminDetailView, type AdminDetailRoute, type AdminDetailSection } from '../../modules/admin-details'
import { profileCardFromUser } from '../../modules/admin-profile-cards'
import { loadUserProfileRecords, loadUserProfileGrowthSummaries, loadUserBadgeSummary, userProfileHref, type UserRecordTab } from '../../modules/user-profile-records'
import { record } from '../../modules/admin-read-formatters'
import { DetailSections, DetailDrawer } from '../../shared/ui/detail-drawer'
import { PageHeader, PermissionGuard, EmptyState } from '../../shared/ui'
import { ProfileEditorDialog } from '../profile-cards/profile-editor-dialog'
import { AdminDetailActions } from '../admin-runtime/admin-detail-actions'
import { useAdminDetail } from '../admin-runtime/use-admin-detail'
import { useAdminOperations } from '../admin-runtime/admin-operation-provider'
import { BadgeSelectionDialog } from './badge-selection-dialog'

const summaryTitles = new Set(['会员权益', '成长数据', '业务记录', '影响力数据'])
const recordTabs = new Set<string>(['superCases', 'cooperationCards', 'records'])
// 旧版 Tab 键（基础与职业/成长与权益/内容与业务/邀请嘉宾/心动明细/资料历史/操作日志）映射到六 Tab。
const legacyTabs: Record<string, string> = { content: 'superCases', invitations: 'growth', hearts: 'growth', history: 'records', logs: 'records' }
export function UserProfilePage() {
  return <PermissionGuard capabilities={['users.read']}><UserProfileContent /></PermissionGuard>
}
function UserProfileContent() {
  const { userId } = useParams({ strict: false }) as { userId: string }
  const search = useRouterState({ select: state => state.location.search }) as { tab?: string; cursor?: string; filters?: Record<string, string> }
  const tab = legacyTabs[search.tab || ''] || search.tab || 'basic'
  const navigate = useNavigate()
  const { request, session, sessionBoundary, hasCapabilityAtScope, hasCapability } = useAdminSession()
  const { message } = App.useApp()
  const [editing, setEditing] = useState(false)
  const [editingBadges, setEditingBadges] = useState(false)
  const nested = useAdminDetail()
  const operations = useAdminOperations()
  const canManageBadges = hasCapability('badges.manage')
  const query = useQuery({ queryKey: ['admin', 'user-profile', session?.actor?.id, sessionBoundary, userId],
    enabled: Boolean(session?.enabled && userId), queryFn: () => loadAdminDetail('users', userId, request, {
      includeUserMembership: hasCapabilityAtScope('memberships.read', 'PLATFORM'),
    }) })
  const related = useQuery({ queryKey: ['admin', 'user-profile-records', session?.actor?.id, sessionBoundary, userId, tab, search.cursor, search.filters?.logCursor],
    enabled: Boolean(query.data && recordTabs.has(tab) && session?.enabled),
    queryFn: () => loadUserProfileRecords(userId, tab as UserRecordTab, { cursor: search.cursor, logCursor: search.filters?.logCursor }, request) })
  const summaries = useQuery({ queryKey: ['admin', 'user-profile-growth-summaries', session?.actor?.id, sessionBoundary, userId],
    enabled: Boolean(query.data && tab === 'growth' && session?.enabled),
    queryFn: () => loadUserProfileGrowthSummaries(userId, request) })
  const badges = useQuery({ queryKey: ['admin', 'user-profile-badges', session?.actor?.id, sessionBoundary, userId],
    enabled: Boolean(query.data && tab === 'growth' && canManageBadges && session?.enabled),
    queryFn: () => loadUserBadgeSummary(userId, request) })
  const user = record(query.data?.source?.user)
  const profile = useMemo(() => query.data ? profileCardFromUser(query.data.source?.user) : null, [query.data])
  const sliced = (sections: AdminDetailSection[]): AdminDetailView | null => query.data ? { ...query.data, sections } : null
  const sectionsFor = (titles: string[]) => query.data?.sections.filter(section => titles.includes(section.title)) || []
  const badgeSection: AdminDetailSection | null = useMemo(() => badges.data ? {
    title: '徽章',
    metrics: [{ label: '持有勋章', value: String(badges.data.length) }],
    fields: [{ label: '勋章明细', value: badges.data.map(item => item.equipped ? `${item.badgeName}（佩戴中）` : item.badgeName).join('、') || '—' }],
  } : null, [badges.data])
  const viewSections = tab === 'basic' ? sectionsFor(['基本信息', '运营角色'])
    : tab === 'career' ? sectionsFor(['职业信息', '任职信息', '标签'])
      : tab === 'growth' ? [...sectionsFor(['成长数据']),
          ...(badgeSection ? [badgeSection] : badges.error ? [{ title: '徽章', error: '勋章记录读取失败，请刷新重试。' }] : []),
          ...sectionsFor(['会员权益', '影响力数据']),
          ...(summaries.data?.sections || []),
          ...(summaries.error ? [{ title: '成长概要', error: '邀请嘉宾与心动明细概要读取失败，请刷新重试。' }] : [])]
        : tab === 'records' ? [...sectionsFor(['业务记录', '发布的机会', '报名活动', '关联订单', '关联业务记录']), ...(related.data?.sections || [])]
          : related.data?.sections || []
  const view = sliced(viewSections)
  const openNested = (target: AdminDetailRoute, id: string) => target === 'users'
    ? window.open(userProfileHref(id), '_blank', 'noopener,noreferrer') : nested.openDetail(target, id)
  const setSearch = (next: typeof search) => void navigate({ search: next as never })
  const refresh = () => {
    void query.refetch()
    if (recordTabs.has(tab)) void related.refetch()
    if (tab === 'growth') {
      // 失败的概要没有 data，重试不能被 data 条件挡住。
      void summaries.refetch()
      if (canManageBadges) void badges.refetch()
    }
  }
  const logCursor = search.filters?.logCursor
  return <>
    <PageHeader title={query.data?.title || '用户档案'} description={query.data?.subtitle} actions={<Space wrap>
      <Button icon={<CopyOutlined />} onClick={() => { void navigator.clipboard.writeText(`${window.location.origin}${window.location.pathname}${userProfileHref(userId)}`).then(() => message.success('档案链接已复制')).catch(() => message.error('复制失败，请复制浏览器地址。')) }}>复制链接</Button>
      <Button icon={<ReloadOutlined />} onClick={refresh}>刷新</Button>
      <Button href={`#/cards?q=${encodeURIComponent(String(user.realName || user.nickname || ''))}`}>名片管理</Button>
    </Space>} />
    <div className="user-profile-layout">
      <aside><Card title={<Space><Avatar src={typeof user.avatarUrl === 'string' ? user.avatarUrl : undefined}>{String(user.nickname || '').slice(0, 1)}</Avatar>{query.data?.title || '用户'}</Space>}>
        <DetailSections open view={sliced(query.data?.sections.filter(section => summaryTitles.has(section.title)) || [])} loading={query.isLoading} error={query.error?.message} onClose={() => {}} onRetry={() => void query.refetch()} />
      </Card></aside>
      <section className="user-profile-main">
        {query.data ? <AdminDetailActions route="users" id={userId} view={query.data} onEditProfile={() => setEditing(true)} onEditBadges={() => setEditingBadges(true)} /> : null}
        <Tabs activeKey={tab} onChange={value => setSearch({ tab: value })} items={[
          { key: 'basic', label: '基础信息' },
          { key: 'growth', label: '成长信息' },
          { key: 'career', label: '职业信息' },
          { key: 'cooperationCards', label: '合作卡' },
          { key: 'superCases', label: '超级案例' },
          { key: 'records', label: '操作记录' },
        ]} />
        <DetailSections open view={view} loading={query.isLoading || (recordTabs.has(tab) && related.isLoading)} error={query.error?.message || (recordTabs.has(tab) ? related.error?.message : '')} onClose={() => {}} onRetry={refresh} onNestedView={(target, row) => openNested(target, String(row.detailId))} />
        {recordTabs.has(tab) && !query.isLoading && !related.isLoading && !related.error && related.data
          && !viewSections.some(section => section.rows?.length || section.fields?.length || section.metrics?.length)
          ? <EmptyState title="暂无记录" description="该用户在当前筛选下没有相关记录。" /> : null}
        {recordTabs.has(tab) && tab !== 'records' ? <Space>
          <Button disabled={!search.cursor} onClick={() => setSearch({ tab, cursor: undefined })}>返回最新</Button>
          <Button disabled={!related.data?.nextCursor} onClick={() => setSearch({ tab, cursor: related.data?.nextCursor || undefined })}>更早记录</Button>
        </Space> : null}
        {tab === 'records' ? <Space wrap size={24}>
          <Space><Button disabled={!search.cursor} onClick={() => setSearch({ tab, cursor: undefined, filters: logCursor ? { logCursor } : undefined })}>资料历史：返回最新</Button>
            <Button disabled={!related.data?.nextCursor} onClick={() => setSearch({ tab, cursor: related.data?.nextCursor || undefined, filters: logCursor ? { logCursor } : undefined })}>资料历史：更早版本</Button></Space>
          <Space><Button disabled={!logCursor} onClick={() => setSearch({ tab, cursor: search.cursor, filters: {} })}>操作日志：返回最新</Button>
            <Button disabled={!related.data?.logNextCursor} onClick={() => setSearch({ tab, cursor: search.cursor, filters: { logCursor: related.data?.logNextCursor || '' } })}>操作日志：更早日志</Button></Space>
        </Space> : null}
      </section>
    </div>
    <ProfileEditorDialog item={editing ? profile : null} onClose={() => setEditing(false)} onSaved={() => void query.refetch()} />
    <BadgeSelectionDialog key={userId} userId={userId} open={editingBadges} onClose={() => setEditingBadges(false)} />
    <DetailDrawer open={Boolean(nested.selection)} view={nested.view} loading={nested.loading} error={nested.error} onClose={nested.closeDetail} onRetry={() => void nested.refreshDetail()} onPagerChange={nested.changeDetailPage} onNestedView={(target, row) => openNested(target, String(row.detailId))} onRowAction={operation => void operations.launch(operation.action, operation.targetId, nested.view, operation)} actions={nested.selection && nested.view ? <AdminDetailActions route={nested.selection.route} id={nested.selection.id} view={nested.view} /> : null} />
  </>
}
