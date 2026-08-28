import { Button, Space } from 'antd'
import { PlusOutlined } from '@ant-design/icons'
import { getAdminReadRouteDefinition } from '../../modules/admin-read-pages'
import { OperationsReadPage } from './operations-read-page'
import type { OperationsPageState } from './types'

export function OpportunitiesContentPage(props: OperationsPageState) {
  const definition = getAdminReadRouteDefinition('opportunities')
  return (
    <OperationsReadPage
      {...props}
      title="机会与内容"
      description="查看机会、用户内容、撮合和评论事实"
      searchPlaceholder={definition.searchPlaceholder}
      statusOptions={definition.statusOptions}
      paginated={definition.paginated}
      detailRouteForSection={section => section.title === '机会' ? 'opportunities' : null}
      actions={props.onWrite ? (
        <Space wrap>
          <Button icon={<PlusOutlined />} onClick={() => props.onWrite?.({ action: 'mip.admin.userContent.save' })}>创建用户内容</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => props.onWrite?.({ action: 'mip.admin.opportunities.save' })}>创建机会</Button>
        </Space>
      ) : null}
    />
  )
}
