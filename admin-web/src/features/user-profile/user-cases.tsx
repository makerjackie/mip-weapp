import { useQuery } from '@tanstack/react-query'
import { Alert, Button, Card, Image, Space } from 'antd'
import { useNavigate } from '@tanstack/react-router'
import { useAdminSession } from '../../app/session-provider'
import { loadAdminDetail, type AdminDetailView } from '../../modules/admin-details'
import { loadUserProfileRecords } from '../../modules/user-profile-records'
import { record } from '../../modules/admin-read-formatters'
import { DetailSections } from '../../shared/ui/detail-drawer'
import { EmptyState, ErrorState, LoadingState } from '../../shared/ui'

export function UserCases({ userId, cursor, onCursor }: { userId: string; cursor?: string; onCursor: (value?: string) => void }) {
  const { request, session, sessionBoundary, hasCapability } = useAdminSession()
  const query = useQuery({ queryKey: ['admin', 'user-cases', session?.actor?.id, sessionBoundary, userId, cursor], enabled: Boolean(session?.enabled), queryFn: () => loadUserProfileRecords(userId, 'superCases', { cursor }, request) })
  const rows = query.data?.sections.flatMap(section => section.rows || []) || []
  if (!hasCapability('userContent.moderate')) return <Alert type="info" title="当前账号没有查看和编辑案例的权限。" />
  if (query.isPending) return <LoadingState />
  if (query.error) return <ErrorState description={query.error.message} onRetry={() => void query.refetch()} />
  return <Space orientation="vertical" size={16} className="user-content-list">
    {!rows.length ? <EmptyState title="暂无超级案例" description="该用户尚无可查看的案例。" /> : null}
    {rows.map(row => row.detailId ? <UserCase key={String(row.detailId)} userId={userId} reference={String(row.detailId)} /> : <Card key={String(row.title)} title={String(row.title)}><Alert type="info" title="无权查看此案例详情。" /></Card>)}
    <Space><Button disabled={!cursor} onClick={() => onCursor()}>返回最新</Button><Button disabled={!query.data?.nextCursor} onClick={() => onCursor(query.data?.nextCursor || undefined)}>更早案例</Button></Space>
  </Space>
}

function UserCase({ userId, reference }: { userId: string; reference: string }) {
  const { request, session, sessionBoundary, hasCapability } = useAdminSession()
  const navigate = useNavigate()
  const query = useQuery({ queryKey: ['admin', 'user-case', session?.actor?.id, sessionBoundary, userId, reference], queryFn: async () => {
    const view = await loadAdminDetail('userContent', reference, request)
    if (record(record(view.source?.userContent).owner).userId !== userId) throw new Error('案例归属不匹配，请重新加载。')
    return view
  } })
  const item = record(query.data?.source?.userContent)
  const view: AdminDetailView | null = query.data ? { ...query.data, sections: query.data.sections.filter(section => section.title !== '基本信息') } : null
  return <Card title={typeof item.projectName === 'string' ? item.projectName : '超级案例'} extra={hasCapability('userContent.moderate') && query.data && item.status !== 'ARCHIVED'
    ? <Button onClick={() => void navigate({ to: '/userContent/$contentId/edit', params: { contentId: reference }, search: { backUserId: userId } as never })}>编辑案例</Button> : null}>
    {typeof item.coverUrl === 'string' && /^https:\/\//.test(item.coverUrl) ? <Image className="user-case-cover" src={item.coverUrl} alt={String(item.projectName || '案例封面')} width="100%" /> : null}
    <DetailSections open view={view} loading={query.isPending} error={query.error?.message} onClose={() => {}} onRetry={() => void query.refetch()} />
  </Card>
}
