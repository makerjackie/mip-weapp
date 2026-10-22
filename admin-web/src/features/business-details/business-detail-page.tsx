import { useEffect } from 'react'
import { Button, Card, Space } from 'antd'
import { ReloadOutlined } from '@ant-design/icons'
import { useNavigate, useParams, useSearch } from '@tanstack/react-router'
import type { AdminListSearch } from '../../app/router'
import { PageHeader, PermissionGuard } from '../../shared/ui'
import { DetailSections, DetailDrawer } from '../../shared/ui/detail-drawer'
import { useAdminDetail } from '../admin-runtime/use-admin-detail'
import { AdminDetailActions } from '../admin-runtime/admin-detail-actions'
import { useAdminOperations } from '../admin-runtime/admin-operation-provider'
import { useDetailSectionBatch } from '../admin-runtime/use-detail-section-batch'
import { userProfileHref } from '../../modules/user-profile-records'

export function EventDetailPage() { return <BusinessDetailPage route="events" /> }
export function OpportunityDetailPage() { return <BusinessDetailPage route="opportunities" /> }

/** A refreshable detail URL; reads, paging, grants and mutations reuse the existing admin runtime. */
function BusinessDetailPage({ route }: { route: 'events' | 'opportunities' }) {
  const params = useParams({ strict: false }) as { eventId?: string; opportunityId?: string }
  const id = (route === 'events' ? params.eventId : params.opportunityId) || ''
  const search = useSearch({ strict: false }) as { returnSearch?: AdminListSearch }
  const navigate = useNavigate()
  const detail = useAdminDetail()
  const nested = useAdminDetail()
  const sectionBatch = useDetailSectionBatch(detail.refreshDetail)
  const { openDetail } = detail
  const { launch } = useAdminOperations()
  useEffect(() => { openDetail(route, id) }, [route, id, openDetail])
  const back = () => void navigate({ to: route === 'events' ? '/events' : '/opportunities', search: search.returnSearch || {} })
  return <PermissionGuard capabilities={[route === 'events' ? 'events.read' : 'opportunities.moderate']}>
    <PageHeader title={detail.view?.title || (route === 'events' ? '活动详情' : '机会详情')}
      description={detail.view?.subtitle || ''} actions={<Space wrap><Button onClick={back}>返回列表</Button><Button aria-label="刷新" icon={<ReloadOutlined />} loading={detail.loading} onClick={() => void detail.refreshDetail()}>刷新</Button></Space>} />
    <Card>
      <DetailSections open view={detail.view} loading={detail.loading || !detail.selection} error={detail.error}
        onClose={back} {...sectionBatch} onRetry={() => void detail.refreshDetail()} onPagerChange={detail.changeDetailPage}
        onNestedView={(target, row) => {
          if (target === 'users') window.open(userProfileHref(String(row.detailId)), '_blank', 'noopener,noreferrer')
          else nested.openDetail(target, String(row.detailId || ''))
        }}
        onRowAction={operation => void launch(operation.action, operation.targetId, detail.view, operation)}
        actions={detail.view ? <AdminDetailActions route={route} id={id} view={detail.view} /> : null} />
    </Card>
    <DetailDrawer open={Boolean(nested.selection)} view={nested.view} loading={nested.loading} error={nested.error} onClose={nested.closeDetail}
      onRetry={() => void nested.refreshDetail()} onPagerChange={nested.changeDetailPage}
      onRowAction={operation => void launch(operation.action, operation.targetId, nested.view, operation)}
      onNestedView={(target, row) => target === 'users' ? window.open(userProfileHref(String(row.detailId)), '_blank', 'noopener,noreferrer') : nested.openDetail(target, String(row.detailId || ''))}
      actions={nested.selection && nested.view ? <AdminDetailActions route={nested.selection.route} id={nested.selection.id} view={nested.view} /> : null} />
  </PermissionGuard>
}
