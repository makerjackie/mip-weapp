import { Alert, Button, Form, Select } from 'antd'
import { useState } from 'react'
import { useAdminSession } from '../../app/session-provider'
import { getAdminReadRouteDefinition } from '../../modules/admin-read-pages'
import type { AdminTableRow } from '../../modules/admin-read-pages'
import { contributionBehaviors, contributionExportFilters } from '../../modules/contribution-management'
import { options } from '../../modules/admin-read-formatters'
import { RemoteCatalogSelect } from '../../shared/ui/session-user-select'
import { OperationsReadPage } from './operations-read-page'
import { GrowthSectionSelect } from './growth-page-shared'
import { SensitiveExportButton } from '../admin-runtime/sensitive-export-button'
import { ContributionReversalDialog } from './contribution-reversal-dialog'
import type { OperationsPageState } from './types'

const CONTRIBUTION_SECTIONS = [
  { value: 'contributionTransactions', label: '贡献值流水' },
  { value: 'contributionRules', label: '贡献值规则' },
] as const

// 设计稿行为口径映射现有贡献行为；贡献值流水查询按服务端 behavior 代码精确匹配。
const CONTRIBUTION_BEHAVIOR_OPTIONS = [
  { value: '', label: '全部行为' },
  ...contributionBehaviors,
  { value: 'ADMIN_ADJUSTMENT', label: '人工发放或调整' },
  { value: 'CONTRIBUTION_REVERSAL', label: '贡献值冲正' },
]

const SECTION_STATUS_OPTIONS: Record<string, Array<{ value: string; label: string }>> = {
  contributionTransactions: [{ value: '', label: '全部状态' }],
  contributionRules: [{ value: '', label: '全部状态' }, ...options(['ACTIVE', 'INACTIVE'])],
}

export function GrowthContributionPage(props: OperationsPageState) {
  const session = useAdminSession()
  const [reversing, setReversing] = useState<AdminTableRow | null>(null)
  const canReverse = !props.demoMode && session.hasCapabilityAtScope('growth.adjust', 'PLATFORM')
  const definition = getAdminReadRouteDefinition('growth')
  const selected = CONTRIBUTION_SECTIONS.some(section => section.value === props.query.filters?.section)
    ? props.query.filters!.section!
    : 'contributionTransactions'
  const showLedgerFilters = selected === 'contributionTransactions'
  return (
    <><OperationsReadPage
      {...props}
      title="贡献值管理"
      description="查询贡献值流水与贡献值规则"
      searchPlaceholder={definition.searchPlaceholder}
      statusOptions={SECTION_STATUS_OPTIONS[selected] || [{ value: '', label: '全部状态' }]}
      paginated
      timeRangeFields={showLedgerFilters ? { from: 'sinceTime', to: 'untilTime' } : undefined}
      actions={showLedgerFilters ? <SensitiveExportButton kind="growthEntries" label="导出贡献值流水" query={props.query.query} status="" filters={contributionExportFilters(props.query.filters)} /> : null}
      rowExtraActions={row => <>
        {showLedgerFilters && canReverse && Number(row.reversibleValue) > 0 ? <Button type="link" danger size="small" onClick={() => setReversing(row)}>冲正</Button> : null}
      </>}
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
    {!showLedgerFilters ? <Alert type="info" showIcon title="自动贡献奖励规则待确认，当前仅供查询。" /> : null}
    {reversing ? <ContributionReversalDialog row={reversing} onClose={() => setReversing(null)} onSaved={props.onRefresh} /> : null}
    </>
  )
}
