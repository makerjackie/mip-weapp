import { MembershipConfigurationPanel } from './membership-configuration-panel'
import { Button, Dropdown, type MenuProps } from 'antd'
import { DownOutlined } from '@ant-design/icons'
import { getAdminReadRouteDefinition } from '../../modules/admin-read-pages'
import { OperationsReadPage } from './operations-read-page'
import type { OperationsPageState, OperationsWriteAction } from './types'

const actions: Array<{ key: OperationsWriteAction; label: string; capability: string }> = [
  { key: 'mip.admin.growth.adjust', label: '调整成长数据', capability: 'growth.adjust' },
  { key: 'mip.admin.badges.grant', label: '授予勋章', capability: 'badges.manage' },
  { key: 'mip.admin.badges.revoke', label: '撤销勋章', capability: 'badges.manage' },
]

export function GrowthBadgesPage(props: OperationsPageState) {
  const definition = getAdminReadRouteDefinition('growth')
  const available = actions.filter(action => !props.canCapability || props.canCapability(action.capability))
  const menu: MenuProps = {
    items: available,
    onClick: ({ key }) => props.onWrite?.({ action: key as OperationsWriteAction }),
  }
  return (
    <>
    <MembershipConfigurationPanel onSaved={props.onRefresh} />
    <OperationsReadPage
      {...props}
      title="成长与勋章"
      description="查看等级、权益、成长流水和勋章事实"
      searchPlaceholder={definition.searchPlaceholder}
      statusOptions={definition.statusOptions}
      paginated={definition.paginated}
      actions={props.onWrite && available.length ? (
        <Dropdown menu={menu} placement="bottomRight">
          <Button type="primary">运营操作 <DownOutlined /></Button>
        </Dropdown>
      ) : null}
    />
    </>
  )
}
