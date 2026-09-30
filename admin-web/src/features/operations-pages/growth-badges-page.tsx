import { MembershipConfigurationPanel } from './membership-configuration-panel'
import { Button, Dropdown, Form, Select, type MenuProps } from 'antd'
import { DownOutlined } from '@ant-design/icons'
import { getAdminReadRouteDefinition } from '../../modules/admin-read-pages'
import { OperationsReadPage } from './operations-read-page'
import type { OperationsPageState, OperationsWriteAction } from './types'
import { SensitiveExportButton } from '../admin-runtime/sensitive-export-button'
import { Space } from 'antd'
import { growthSections } from '../../modules/growth-sections'

const actions: Array<{ key: OperationsWriteAction; label: string; capability: string }> = [
  { key: 'mip.admin.growth.adjust', label: '调整成长数据', capability: 'growth.adjust' },
  { key: 'mip.admin.badges.grant', label: '授予勋章', capability: 'badges.manage' },
  { key: 'mip.admin.badges.revoke', label: '撤销勋章', capability: 'badges.manage' },
]

export function GrowthBadgesPage(props: OperationsPageState) {
  const definition = getAdminReadRouteDefinition('growth')
  const sections = growthSections.filter(section => !props.canCapability || props.canCapability(section.capability))
  const selected = props.query.filters?.section || ''
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
      paginated={growthSections.some(section => section.value === selected && 'paginated' in section && section.paginated)}
      timeRangeFields={selected === 'entitlements' ? { from: 'sinceTime', to: 'untilTime' } : selected === 'entries' || selected === 'transitions' ? { from: 'createdFrom', to: 'createdTo' } : undefined}
      extraFilterSlots={<><Form.Item label="分区"><Select aria-label="成长分区" style={{ minWidth: 180 }} value={selected}
        options={[{ value: '', label: '全部概览' }, ...sections]} onChange={section => props.onFilterChange({ ...props.query, filters: { section } })} /></Form.Item>{selected === 'entitlements' ? <Form.Item label="权益类型"><Select aria-label="权益类型" style={{ minWidth: 140 }} value={props.query.filters?.entitlementType || ''} options={[{ value: '', label: '全部类型' }, { value: 'EXP', label: '经验' }, { value: 'CONTRIBUTION', label: '贡献' }, { value: 'MEMBERSHIP', label: '会籍' }]} onChange={entitlementType => props.onFilterChange({ ...props.query, filters: { ...props.query.filters, entitlementType } })} /></Form.Item> : null}</>}
      actions={<Space wrap>{selected === 'entries' ? <SensitiveExportButton kind="growthEntries" query={props.query.query} status={props.query.status} filters={Object.fromEntries(Object.entries(props.query.filters || {}).filter(([key]) => key !== 'section'))} /> : null}{props.onWrite && available.length ? (
        <Dropdown menu={menu} placement="bottomRight">
          <Button type="primary">运营操作 <DownOutlined /></Button>
        </Dropdown>
      ) : null}</Space>}
    />
    </>
  )
}
