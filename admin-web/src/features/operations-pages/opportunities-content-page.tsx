import { Button, Space } from 'antd'
import { PlusOutlined } from '@ant-design/icons'
import { useNavigate } from '@tanstack/react-router'
import { getAdminReadRouteDefinition } from '../../modules/admin-read-pages'
import { OperationsReadPage } from './operations-read-page'
import type { OperationsPageState } from './types'

export function OpportunitiesContentPage(props: OperationsPageState) {
  const definition = getAdminReadRouteDefinition('opportunities')
  const navigate = useNavigate()
  return (
    <OperationsReadPage
      {...props}
      title="机会与内容"
      description="查看机会、用户内容、撮合和评论事实"
      searchPlaceholder={definition.searchPlaceholder}
      statusOptions={definition.statusOptions}
      paginated={definition.paginated}
      detailRouteForSection={section => section.title === '机会'
        ? 'opportunities'
        : section.title === '用户内容' ? 'userContent' : null}
      actions={props.onWrite ? (
        <Space wrap>
          <Button icon={<PlusOutlined />} onClick={() => void navigate({ to: '/userContent/$contentId/edit' as never, params: { contentId: 'new' } as never, search: { kind: 'COOPERATION_CARD' } as never })}>创建合作卡</Button>
          <Button icon={<PlusOutlined />} onClick={() => void navigate({ to: '/userContent/$contentId/edit' as never, params: { contentId: 'new' } as never, search: { kind: 'SUPER_CASE' } as never })}>创建超级案例</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => void navigate({ to: '/opportunities/$opportunityId/edit' as never, params: { opportunityId: 'new' } as never })}>创建机会</Button>
        </Space>
      ) : null}
    />
  )
}
