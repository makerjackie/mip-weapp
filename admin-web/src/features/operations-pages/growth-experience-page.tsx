import { Collapse, Form, Select } from 'antd'
import { getAdminReadRouteDefinition } from '../../modules/admin-read-pages'
import { options } from '../../modules/admin-read-formatters'
import { RemoteCatalogSelect } from '../../shared/ui/session-user-select'
import { SensitiveExportButton } from '../admin-runtime/sensitive-export-button'
import { OperationsReadPage } from './operations-read-page'
import { MembershipConfigurationPanel } from './membership-configuration-panel'
import { GrowthSectionSelect, growthFiltersWithoutSection } from './growth-page-shared'
import type { OperationsPageState } from './types'

// MIW-129：经验值管理页可见的 growth 分区。经验值流水（entries）为主表，
// 成长奖励规则（含规则说明文档）作为本页配置分区安置。
const EXPERIENCE_SECTIONS = [
  { value: 'entries', label: '经验值流水' },
  { value: 'rules', label: '成长规则' },
] as const

// 设计稿来源口径（任务/活动/签到/人工冲正）映射到现有来源事件；经验值流水查询
// 按服务端 sourceEventType 精确匹配，人工冲正对应服务端落库的 ADMIN_ADJUSTMENT。
const EXPERIENCE_SOURCE_OPTIONS = [
  { value: '', label: '全部来源' },
  { value: 'task.completed', label: '任务' },
  { value: 'event.registered', label: '活动' },
  { value: 'event.checked_in', label: '签到' },
  { value: 'ADMIN_ADJUSTMENT', label: '人工冲正' },
]

const SECTION_STATUS_OPTIONS: Record<string, Array<{ value: string; label: string }>> = {
  entries: [{ value: '', label: '全部状态' }],
  rules: [{ value: '', label: '全部状态' }, ...options(['ACTIVE', 'INACTIVE'])],
}

export function GrowthExperiencePage(props: OperationsPageState) {
  const definition = getAdminReadRouteDefinition('growth')
  const selected = EXPERIENCE_SECTIONS.some(section => section.value === props.query.filters?.section)
    ? props.query.filters!.section!
    : 'entries'
  const showLedgerFilters = selected === 'entries'
  return (
    <>
      <Collapse
        ghost
        items={[{ key: 'experience-rules-config', label: '成长奖励规则配置', children: <MembershipConfigurationPanel onSaved={props.onRefresh} tabs={['rules', 'experience-rules']} title="经验值规则配置" /> }]}
      />
      <OperationsReadPage
        {...props}
        title="经验值管理"
        description="查询经验值流水与成长奖励规则"
        searchPlaceholder={definition.searchPlaceholder}
        statusOptions={SECTION_STATUS_OPTIONS[selected] || [{ value: '', label: '全部状态' }]}
        paginated={showLedgerFilters}
        timeRangeFields={showLedgerFilters ? { from: 'createdFrom', to: 'createdTo' } : undefined}
        extraFilterSlots={<>
          <GrowthSectionSelect sections={EXPERIENCE_SECTIONS} page="经验值管理" state={props} />
          {showLedgerFilters ? <Form.Item label="来源"><Select aria-label="经验值来源" style={{ minWidth: 130 }} value={props.query.filters?.sourceEventType || ''}
            options={EXPERIENCE_SOURCE_OPTIONS}
            onChange={sourceEventType => props.onFilterChange({ ...props.query, filters: { ...props.query.filters, sourceEventType } })} /></Form.Item> : null}
          {/* 服务端 growth.entries 尚未提供服务器筛选（contribution 已支持 serverId），
              先按同一参数名前进，待联调后生效。 */}
          {showLedgerFilters ? <Form.Item label="服务器"><RemoteCatalogSelect action="mip.admin.branches.list" input={{ purpose: 'USER_FILTER' }}
            value={props.query.filters?.serverId || ''} placeholder="全部授权服务器"
            onChange={serverId => props.onFilterChange({ ...props.query, filters: { ...props.query.filters, serverId: String(serverId || '') } })} /></Form.Item> : null}
        </>}
        actions={showLedgerFilters ? (
          <SensitiveExportButton kind="growthEntries" query={props.query.query} status={props.query.status} filters={growthFiltersWithoutSection(props)} />
        ) : null}
      />
    </>
  )
}
