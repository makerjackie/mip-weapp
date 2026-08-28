import { Button, Space } from 'antd'
import { PlusOutlined, UploadOutlined } from '@ant-design/icons'
import type { AdminMediaPurpose } from '../../modules/admin-media-upload'
import { getAdminReadRouteDefinition } from '../../modules/admin-read-pages'
import { OperationsReadPage } from './operations-read-page'
import type { OperationsPageState } from './types'

export function BannerManagementPage(props: OperationsPageState & {
  onOpenMedia?: (purpose: AdminMediaPurpose) => void
}) {
  const definition = getAdminReadRouteDefinition('banners')
  return (
    <OperationsReadPage
      {...props}
      title="Banner 管理"
      description="管理 Banner 图片、跳转目标、状态和展示顺序"
      searchPlaceholder={definition.searchPlaceholder}
      statusOptions={definition.statusOptions}
      paginated={definition.paginated}
      actions={(
        <Space wrap>
          {props.onOpenMedia ? <Button icon={<UploadOutlined />} onClick={() => props.onOpenMedia?.('BANNER')}>上传图片</Button> : null}
          {props.onWrite ? <Button type="primary" icon={<PlusOutlined />} onClick={() => props.onWrite?.({ action: 'mip.admin.banners.save' })}>新增 Banner</Button> : null}
        </Space>
      )}
    />
  )
}
