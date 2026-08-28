import { Button, Space } from 'antd'
import { PlusOutlined } from '@ant-design/icons'
import { getAdminReadRouteDefinition } from '../../modules/admin-read-pages'
import { OperationsReadPage } from './operations-read-page'
import type { OperationsPageState } from './types'

export function GameManagementPage(props: OperationsPageState) {
  const definition = getAdminReadRouteDefinition('game')
  return (
    <OperationsReadPage
      {...props}
      title="战队管理"
      description="管理赛季、战队成员、周赛排行和盲盒配置"
      searchPlaceholder={definition.searchPlaceholder}
      statusOptions={definition.statusOptions}
      paginated={definition.paginated}
      actions={props.onWrite ? (
        <Space wrap>
          <Button icon={<PlusOutlined />} onClick={() => props.onWrite?.({ action: 'mip.admin.game.blindBoxes.catalogs.save' })}>新增盲盒目录</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => props.onWrite?.({ action: 'mip.admin.game.seasons.save' })}>新增赛季</Button>
        </Space>
      ) : null}
    />
  )
}
