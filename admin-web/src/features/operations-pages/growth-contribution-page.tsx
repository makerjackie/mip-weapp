import { Form, Select } from 'antd'
import { getAdminReadRouteDefinition } from '../../modules/admin-read-pages'
import { options } from '../../modules/admin-read-formatters'
import { RemoteCatalogSelect } from '../../shared/ui/session-user-select'
import { OperationsReadPage } from './operations-read-page'
import { GrowthSectionSelect } from './growth-page-shared'
import type { OperationsPageState } from './types'

// MIW-129：贡献值管理页可见的 growth 分区。贡献值流水为主表；
// 「贡献值规则」分区即设计稿要求的顶部配置入口（规则编辑走服务端契约，Web 当前提供列表视图）。
const CONTRIBUTION_SECTIONS = [
  { value: 'contributionTransactions', label: '贡献值流水' },
  { value: 'contributionRules', label: '贡献值规则' },
] as const

// 设计稿行为口径映射现有贡献行为；贡献值流水查询按服务端 behavior 代码精确匹配。
const CONTRIBUTION_BEHAVIOR_OPTIONS = [
  { value: '', label: '全部行为' },
  { value: 'INVITE_GUEST', label: '邀请嘉宾' },
  { value: 'EVENT_CHECKIN', label: '活动签到' },
  { value: 'TASK_COMPLETED', label: '完成任务' },
  { value: 'OPPORTUNITY_REFERRAL', label: '引荐机会' },
  { value: 'OPPORTUNITY_COOPERATION', label: '合作成功' },
]

const SECTION_STATUS_OPTIONS: Record<string, Array<{ value: string; label: string }>> = {
  contributionTransactions: [{ value: '', label: '全部状态' }],
  contributionRules: [{ value: '', label: '全部状态' }, ...options(['ACTIVE', 'INACTIVE'])],
}

export function GrowthContributionPage(props: OperationsPageState) {
  const definition = getAdminReadRouteDefinition('growth')
  const selected = CONTRIBUTION_SECTIONS.some(section => section.value === props.query.filters?.section)
    ? props.query.filters!.section!
    : 'contributionTransactions'
  const showLedgerFilters = selected === 'contributionTransactions'
  return (
    <OperationsReadPage
      {...props}
      title="贡献值管理"
      description="查询贡献值流水与贡献值规则"
      searchPlaceholder={definition.searchPlaceholder}
      statusOptions={SECTION_STATUS_OPTIONS[selected] || [{ value: '', label: '全部状态' }]}
      paginated
      extraFilterSlots={<>
        <GrowthSectionSelect sections={CONTRIBUTION_SECTIONS} page="贡献值管理" state={props} />
        {showLedgerFilters ? <Form.Item label="行为"><Select aria-label="贡献值行为" style={{ minWidth: 130 }} value={props.query.filters?.behavior || ''}
          options={CONTRIBUTION_BEHAVIOR_OPTIONS}
          onChange={behavior => props.onFilterChange({ ...props.query, filters: { ...props.query.filters, behavior } })} /></Form.Item> : null}
        {showLedgerFilters ? <Form.Item label="服务器"><RemoteCatalogSelect action="mip.admin.branches.list" input={{ purpose: 'USER_FILTER' }}
          value={props.query.filters?.serverId || ''} placeholder="全部授权服务器"
          onChange={serverId => props.onFilterChange({ ...props.query, filters: { ...props.query.filters, serverId: String(serverId || '') } })} /></Form.Item> : null}
      </>}
    />
  )
}
