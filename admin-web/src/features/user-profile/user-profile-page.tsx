import { useCallback, useMemo, useRef, useState } from 'react'
import { App, Avatar, Button, Card, Space, Tabs, Tooltip, Typography, Modal } from 'antd'
import { CopyOutlined, ReloadOutlined } from '@ant-design/icons'
import { useParams, useRouterState, useNavigate, useBlocker } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useAdminSession } from '../../app/session-provider'
import { loadAdminDetail, type AdminDetailView, type AdminDetailRoute, type AdminDetailSection } from '../../modules/admin-details'
import { profileCardFromUser } from '../../modules/admin-profile-cards'
import { loadUserProfileRecords, loadUserBadgeSummary, userProfileHref, type UserRecordTab } from '../../modules/user-profile-records'
import { record, label as codeLabel } from '../../modules/admin-read-formatters'
import { userAccountStatus, userDashboardMetrics } from '../../modules/user-profile-dashboard'
import { StatusTag } from '../../shared/ui/status-tag'
import { DetailSections, DetailDrawer } from '../../shared/ui/detail-drawer'
import { PageHeader, PermissionGuard, EmptyState } from '../../shared/ui'
import { ProfileEditorDialog } from '../profile-cards/profile-editor-dialog'
import { AdminDetailActions } from '../admin-runtime/admin-detail-actions'
import { useAdminDetail } from '../admin-runtime/use-admin-detail'
import { useAdminOperations } from '../admin-runtime/admin-operation-provider'
import { BadgeSelectionDialog } from './badge-selection-dialog'
import { UserCooperationCards } from './user-cooperation-cards'
import { UserCases } from './user-cases'
import { UserRelations } from './user-relations'

const recordTabs = new Set<string>(['records'])
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
  const contentEditing = useRef(false)
  const setContentEditing = useCallback((value: boolean) => { contentEditing.current = value }, [])
  const blocker = useBlocker({ shouldBlockFn: () => contentEditing.current, enableBeforeUnload: () => contentEditing.current, withResolver: true })
  const nested = useAdminDetail()
  const operations = useAdminOperations()
  const canManageBadges = hasCapability('badges.manage')
  const query = useQuery({ queryKey: ['admin', 'user-profile', session?.actor?.id, sessionBoundary, userId],
    enabled: Boolean(session?.enabled && userId), queryFn: () => loadAdminDetail('users', userId, request, {
      includeUserMembership: hasCapabilityAtScope('memberships.read', 'PLATFORM'),
      includeUserPhone: hasCapability('users.phone.read'),
    }) })
  const related = useQuery({ queryKey: ['admin', 'user-profile-records', session?.actor?.id, sessionBoundary, userId, tab, search.cursor, search.filters?.logCursor],
    enabled: Boolean(query.data && recordTabs.has(tab) && session?.enabled),
    queryFn: () => loadUserProfileRecords(userId, tab as UserRecordTab, { cursor: search.cursor, logCursor: search.filters?.logCursor }, request) })
  const badges = useQuery({ queryKey: ['admin', 'user-profile-badges', session?.actor?.id, sessionBoundary, userId],
    enabled: Boolean(query.data && tab === 'growth' && canManageBadges && session?.enabled),
    queryFn: () => loadUserBadgeSummary(userId, request) })
  const user = record(query.data?.source?.user)
  const profile = useMemo(() => query.data ? profileCardFromUser(query.data.source?.user) : null, [query.data])
  const sliced = (sections: AdminDetailSection[]): AdminDetailView | null => query.data ? { ...query.data, status: '', sections } : null
  const sectionsFor = (titles: string[]) => query.data?.sections.filter(section => titles.includes(section.title)) || []
  const badgeSection: AdminDetailSection | null = useMemo(() => badges.data ? {
    title: '徽章',
    metrics: [{ label: '持有勋章', value: String(badges.data.length) }],
    fields: [{ label: '勋章明细', value: badges.data.map(item => item.equipped ? `${item.badgeName}（佩戴中）` : item.badgeName).join('、') || '—' }],
  } : null, [badges.data])
  const viewSections = tab === 'basic' ? sectionsFor(['基本信息', '后台角色'])
    : tab === 'career' ? sectionsFor(['职业信息', '任职信息', '标签'])
      : tab === 'growth' ? [...sectionsFor(['成长数据']),
          ...(badgeSection ? [badgeSection] : badges.error ? [{ title: '徽章', error: '勋章记录读取失败，请刷新重试。' }] : []),
          ...sectionsFor(['会员权益'])]
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
      if (canManageBadges) void badges.refetch()
    }
  }
  const logCursor = search.filters?.logCursor
  return <>
    <PageHeader title="用户详情" description="查看用户档案与业务记录" actions={<Space wrap>
      <Button href="#/users">返回列表</Button>
      {query.data && (record(user.permissions).freeze === true || record(user.permissions).unfreeze === true) ? <Button danger={user.status !== 'BLOCKED'} onClick={() => void operations.launch('mip.admin.users.setControl', userId, query.data, { values: { controlType: 'BLOCKLIST', active: user.status !== 'BLOCKED', reason: '' } })}>{user.status === 'BLOCKED' ? '解冻用户' : '冻结用户'}</Button> : null}
      <Button icon={<CopyOutlined />} onClick={() => { void navigator.clipboard.writeText(`${window.location.origin}${window.location.pathname}${userProfileHref(userId)}`).then(() => message.success('档案链接已复制')).catch(() => message.error('复制失败，请复制浏览器地址。')) }}>复制链接</Button>
      <Button icon={<ReloadOutlined />} onClick={refresh}>刷新</Button>
    </Space>} />
    <div className="user-profile-layout">
      <aside className="user-profile-sidebar"><Card>
        <div className="user-profile-identity">
          <Avatar size={72} src={typeof user.avatarUrl === 'string' ? user.avatarUrl : undefined}>{String(user.nickname || '用户').slice(0, 1)}</Avatar>
          <Typography.Title level={2}>{String(user.nickname || '未设置昵称')}</Typography.Title>
          <Space><StatusTag value={codeLabel(user.kind)} /><StatusTag value={userAccountStatus(user.status)} /></Space>
        </div>
        <div className="user-profile-dashboard-heading"><Typography.Title level={3}>社交影响力数据</Typography.Title><Typography.Text type="secondary">当前累计</Typography.Text></div>
        {query.error ? <Typography.Text type="danger">档案读取失败，请刷新重试。</Typography.Text> : null}
        <dl className="user-profile-dashboard">
          {userDashboardMetrics(user).map(metric => <Tooltip title={metric.description} key={metric.key}><div><dd>{query.isPending ? '—' : metric.value}</dd><dt>{metric.label}</dt></div></Tooltip>)}
        </dl>
        <Button block href={`#/cards?q=${encodeURIComponent(String(user.realName || user.nickname || ''))}`}>查看名片</Button>
      </Card></aside>
      <section className="user-profile-main"><Card className="user-profile-content-card">
        {query.data ? <AdminDetailActions route="users" id={userId} view={query.data} onEditProfile={() => setEditing(true)} onEditBadges={() => setEditingBadges(true)} /> : null}
        <Tabs activeKey={tab} onChange={value => setSearch({ tab: value })} items={[
          { key: 'basic', label: '基础信息' },
          { key: 'growth', label: '成长信息' },
          { key: 'career', label: '职业信息' },
          { key: 'cooperationCards', label: '合作卡' },
          { key: 'superCases', label: '超级案例' },
          { key: 'records', label: '操作记录' },
        ]} />
        {tab === 'superCases' ? <UserCases key={userId} userId={userId} cursor={search.cursor} onCursor={cursor => setSearch({ tab, cursor })} /> : null}
        {tab === 'cooperationCards' ? <UserCooperationCards key={userId} userId={userId} onEditingChange={setContentEditing} /> : null}
        <DetailSections open={tab !== 'cooperationCards'} view={['cooperationCards', 'superCases'].includes(tab) ? null : view} loading={query.isLoading || (recordTabs.has(tab) && related.isLoading)} error={query.error?.message || (recordTabs.has(tab) ? related.error?.message : '')} onClose={() => {}} onRetry={refresh} onNestedView={(target, row) => openNested(target, String(row.detailId))} />
        {tab === 'growth' ? <UserRelations key={userId} userId={userId} filters={search.filters} onChange={filters => setSearch({ tab, filters })} onOpen={openNested} /> : null}
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
      </Card></section>
    </div>
    <Modal open={blocker.status === 'blocked'} title="离开当前编辑？" okText="放弃修改并离开" cancelText="继续编辑" onOk={() => { contentEditing.current = false; blocker.proceed?.() }} onCancel={() => blocker.reset?.()}>
      合作卡的未保存修改将被放弃。
    </Modal>
    <ProfileEditorDialog item={editing ? profile : null} onClose={() => setEditing(false)} onSaved={() => void query.refetch()} />
    <BadgeSelectionDialog key={userId} userId={userId} open={editingBadges} onClose={() => setEditingBadges(false)} />
    <DetailDrawer open={Boolean(nested.selection)} view={nested.view} loading={nested.loading} error={nested.error} onClose={nested.closeDetail} onRetry={() => void nested.refreshDetail()} onPagerChange={nested.changeDetailPage} onNestedView={(target, row) => openNested(target, String(row.detailId))} onRowAction={operation => void operations.launch(operation.action, operation.targetId, nested.view, operation)} actions={nested.selection && nested.view ? <AdminDetailActions route={nested.selection.route} id={nested.selection.id} view={nested.view} /> : null} />
  </>
}
