import { Button, Collapse, Form, Select, Space } from 'antd'
import { PlusOutlined } from '@ant-design/icons'
import { useNavigate } from '@tanstack/react-router'
import { options } from '../../modules/admin-read-formatters'
import { OperationsReadPage } from './operations-read-page'
import { MembershipConfigurationPanel } from './membership-configuration-panel'
import { GrowthSectionSelect } from './growth-page-shared'
import type { OperationsPageState } from './types'

// MIW-129：权益管理页可见的 growth 分区。权益流水为主表；入会审核与会员方案/协议
// 从原「成长与勋章」页迁入本页（设计稿拍板：会员方案/协议/入会审核归属权益管理）。
const ENTITLEMENT_SECTIONS = [
  { value: 'entitlements', label: '权益流水' },
  { value: 'membershipApprovals', label: '入会审核' },
] as const

const ENTITLEMENT_TYPE_OPTIONS = [
  { value: '', label: '全部类型' },
  { value: 'EXP', label: '经验值' },
  { value: 'CONTRIBUTION', label: '贡献值' },
  { value: 'MEMBERSHIP', label: '玩家会籍' },
]

export function GrowthEntitlementsPage(props: OperationsPageState) {
  const navigate = useNavigate()
  const selected = ENTITLEMENT_SECTIONS.some(section => section.value === props.query.filters?.section)
    ? props.query.filters!.section!
    : 'entitlements'
  const showLedgerFilters = selected === 'entitlements'
  const canGrant = Boolean(props.onWrite) && (!props.canCapability
    || props.canCapability('growth.adjust') || props.canCapability('memberships.adjust'))
  return (
    <>
      <Collapse
        ghost
        items={[{ key: 'membership-plan-config', label: '会员方案与协议配置', children: <MembershipConfigurationPanel onSaved={props.onRefresh} tabs={['plans', 'agreement', 'user-agreement', 'privacy-policy']} title="会员方案与协议" /> }]}
      />
      <OperationsReadPage
        {...props}
        title="权益管理"
        description="查询权益流水、入会审核和会员方案"
        searchPlaceholder="搜索权益流水号、用户或订单号"
        statusOptions={selected === 'membershipApprovals'
          ? [{ value: '', label: '全部状态' }, ...options(['PENDING', 'APPROVED', 'REJECTED'])]
          : [{ value: '', label: '全部状态' }]}
        paginated
        timeRangeFields={showLedgerFilters ? { from: 'sinceTime', to: 'untilTime' } : undefined}
        extraFilterSlots={<>
          <GrowthSectionSelect sections={ENTITLEMENT_SECTIONS} page="权益管理" state={props} />
          {showLedgerFilters ? <Form.Item label="权益类型"><Select aria-label="权益类型" style={{ minWidth: 130 }} value={props.query.filters?.entitlementType || ''}
            options={ENTITLEMENT_TYPE_OPTIONS}
            onChange={entitlementType => props.onFilterChange({ ...props.query, filters: { ...props.query.filters, entitlementType } })} /></Form.Item> : null}
        </>}
        actions={showLedgerFilters && canGrant ? (
          <Space wrap>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => void navigate({ to: '/entitlements/grant' })}>发放权益</Button>
          </Space>
        ) : null}
      />
    </>
  )
}
