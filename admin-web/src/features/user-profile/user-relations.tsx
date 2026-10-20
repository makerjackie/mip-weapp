import { useQuery } from '@tanstack/react-query'
import { Button, Form, Select, Space, Tabs } from 'antd'
import { useAdminSession } from '../../app/session-provider'
import { loadUserRelations, type UserRelationKind } from '../../modules/user-profile-relations'
import type { AdminDetailRoute } from '../../modules/admin-details'
import { DetailSections } from '../../shared/ui/detail-drawer'
import { EmptyState, FilterBar } from '../../shared/ui'
import { RemoteCatalogSelect } from '../../shared/ui/session-user-select'

export function UserRelations({ userId, filters = {}, onChange, onOpen }: { userId: string; filters?: Record<string, string>; onChange: (filters: Record<string, string>) => void; onOpen: (route: AdminDetailRoute, id: string) => void }) {
  const { request, session, sessionBoundary, hasCapability } = useAdminSession()
  const kind: UserRelationKind = filters.relation === 'invitations' ? 'invitations' : 'hearts'
  const query = useQuery({ queryKey: ['admin', 'user-relations', session?.actor?.id, sessionBoundary, userId, kind, filters], enabled: Boolean(session?.enabled), queryFn: () => loadUserRelations(userId, kind, filters, request) })
  const update = (changes: Record<string, string>) => onChange({ ...filters, ...changes, cursor: '' })
  return <section aria-label="邀请和心动记录">
    <Tabs activeKey={kind} onChange={relation => onChange({ relation })} items={[{ key: 'invitations', label: '邀请嘉宾' }, { key: 'hearts', label: '心动明细' }]} />
    <FilterBar value={{ q: filters.q || '', status: filters.status || '', filters }} placeholder="搜索关联用户昵称"
      statusOptions={kind === 'hearts' ? [{ value: '', label: '全部状态' }, { value: 'ACTIVE', label: '有效' }, { value: 'CANCELLED', label: '已撤销' }, { value: 'INVALID', label: '已失效' }] : []}
      minutePrecision beijingTime
      timeRangeFields={{ from: 'sinceTime', to: 'untilTime', label: '发生时间' }}
      onChange={value => onChange({ ...value.filters, relation: kind, q: value.q, status: value.status, cursor: '' } as Record<string, string>)} onRefresh={() => void query.refetch()}
      extraFilterSlots={<>
        {kind === 'hearts' ? <Form.Item label="关系方向"><Select aria-label="关系方向" value={filters.direction || 'ALL'} onChange={direction => update({ direction })} options={[{ value: 'ALL', label: '全部方向' }, { value: 'OUTGOING', label: '我心动的人' }, { value: 'INCOMING', label: '对我心动的人' }, { value: 'MUTUAL', label: '双向心动' }]} /></Form.Item>
          : <Form.Item label="邀请来源"><Select aria-label="邀请来源" value={filters.source || ''} onChange={source => update({ source })} options={[{ value: '', label: '全部来源' }, { value: 'EVENT', label: '活动邀请' }, { value: 'MEMBERSHIP', label: '会员邀请' }]} /></Form.Item>}
        {hasCapability('events.read') ? <Form.Item label="关联活动"><RemoteCatalogSelect action="mip.admin.events.list" input={{ limit: 100 }} value={filters.eventId || ''} placeholder="全部活动" onChange={value => update({ eventId: String(value || '') })} /></Form.Item> : null}
      </>} />
    <DetailSections open loading={query.isPending} error={query.error?.message} view={query.data ? { route: 'users', title: '', subtitle: '', status: '', sections: [query.data.section] } : null} onClose={() => {}} onRetry={() => void query.refetch()} onNestedView={(target, row) => onOpen(target, String(row.detailId))} />
    {query.data && !query.error && !query.data.section.rows?.length ? <EmptyState title="暂无相关记录" description="当前筛选范围内没有记录。" /> : null}
    <Space className="user-content-save-actions"><Button disabled={!filters.cursor} onClick={() => onChange({ ...filters, cursor: '' })}>返回最新</Button><Button disabled={!query.data?.nextCursor} onClick={() => onChange({ ...filters, cursor: query.data?.nextCursor || '' })}>更早记录</Button></Space>
  </section>
}
