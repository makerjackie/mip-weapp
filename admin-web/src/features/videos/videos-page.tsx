import { Button, Image, Space, Table } from 'antd'
import { useQuery } from '@tanstack/react-query'
import { useNavigate, useRouterState } from '@tanstack/react-router'
import { useAdminSession } from '../../app/session-provider'
import { loadVideos } from '../../modules/admin-video-management'
import { formatDateTime } from '../../modules/admin-read-formatters'
import { ErrorState, FilterBar, LoadingState, PageHeader, PermissionGuard, StatusTag } from '../../shared/ui'

export function VideosPage() { return <PermissionGuard capabilities={['events.recaps.manage']}><VideosContent /></PermissionGuard> }
function VideosContent() {
  const { request, session, sessionBoundary } = useAdminSession()
  const search = useRouterState({ select: state => state.location.search }) as { q?: string; status?: string; cursor?: string }
  const navigate = useNavigate()
  const query = useQuery({ queryKey: ['admin', 'videos', session?.actor?.id, sessionBoundary, search], enabled: Boolean(session?.enabled), queryFn: () => loadVideos(request, { query: search.q, status: search.status, cursor: search.cursor }) })
  return <>
    <PageHeader title="视频回顾" description="维护首页视频回顾的标题、封面和跳转地址" actions={<Button type="primary" href="#/videos/new/edit">新增视频</Button>} />
    <FilterBar value={{ q: search.q || '', status: search.status || '' }} statusOptions={[{ value: 'DRAFT', label: '草稿' }, { value: 'PUBLISHED', label: '已发布' }, { value: 'UNPUBLISHED', label: '已下架' }, { value: 'ARCHIVED', label: '已归档' }]} placeholder="搜索视频标题" onChange={value => void navigate({ search: { q: value.q, status: value.status } as never })} onRefresh={() => void query.refetch()} />
    {query.isLoading ? <LoadingState /> : query.error ? <ErrorState description={query.error.message} onRetry={() => void query.refetch()} /> : <Table rowKey="id" dataSource={query.data?.items} pagination={false} scroll={{ x: 'max-content' }} columns={[
      { title: '封面', key: 'cover', render: (_, item) => item.coverUrl ? <Image src={item.coverUrl} alt={item.title} width={100} /> : '封面暂不可用' },
      { title: '标题', dataIndex: 'title' }, { title: '状态', dataIndex: 'status', render: value => <StatusTag value={value} /> },
      { title: '更新时间', dataIndex: 'updatedAt', render: formatDateTime },
      { title: '操作', key: 'actions', render: (_, item) => <Space><Button type="link" href={item.jumpUrl} target="_blank" rel="noopener noreferrer">查看视频</Button>{item.status !== 'ARCHIVED' ? <Button type="link" href={`#/videos/${encodeURIComponent(item.id)}/edit`}>编辑 / 启停</Button> : null}</Space> },
    ]} />}
    <Space style={{ marginTop: 16 }}><Button disabled={!search.cursor} onClick={() => void navigate({ search: { ...search, cursor: undefined } as never })}>返回最新</Button><Button disabled={!query.data?.nextCursor} onClick={() => void navigate({ search: { ...search, cursor: query.data?.nextCursor } as never })}>下一页</Button></Space>
  </>
}
