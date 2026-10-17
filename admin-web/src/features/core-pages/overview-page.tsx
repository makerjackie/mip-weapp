import {
  CalendarOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  ArrowRightOutlined,
  FileSearchOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
  TeamOutlined,
} from '@ant-design/icons'
import { Alert, Button, Card, Collapse, DatePicker, Select, Space, Tabs, Tag } from 'antd'
import { lazy, Suspense, useMemo, useState } from 'react'
import dayjs from 'dayjs'
import type { AdminRequestInput } from '../../domain/contracts'
import { RemoteCatalogSelect } from '../../shared/ui/session-user-select'
import { useAdminSession } from '../../app/session-provider'
import {
  DataTable,
  EmptyState,
  ErrorState,
  LoadingState,
  MetricCard,
  PageHeader,
  PermissionGuard,
} from '../../shared/ui'
import type { CoreNavigationTarget } from './core-page-types'
import type { AdminOverviewView } from './overview-model'
import { useAdminOverview } from './use-core-page-query'
import { groupOverviewMetrics } from './overview-metric-groups'
import './core-pages.css'
import './overview-page.css'

const PurchaseChart = lazy(() => import('./overview-purchase-chart'))

const metricIcons = [<TeamOutlined />, <SafetyCertificateOutlined />, <CalendarOutlined />, <CheckCircleOutlined />]

export interface OverviewPageProps {
  onNavigate: (target: CoreNavigationTarget) => void
}

export function OverviewPage({ onNavigate }: OverviewPageProps) {
  const { hasCapability } = useAdminSession()
  const [preset, setPreset] = useState('THIS_MONTH')
  const [branchId, setBranchId] = useState('')
  const [range, setRange] = useState<[string, string] | null>(null)
  const input = useMemo<AdminRequestInput>(() => ({
    scope: branchId ? { type: 'BRANCH', id: branchId } : { type: 'AUTHORIZED' },
    period: range ? { preset: 'CUSTOM', startDate: range[0], endDate: range[1] } : { preset: preset === 'CUSTOM' ? 'THIS_MONTH' : preset },
  }), [preset, branchId, range])
  const query = useAdminOverview(input)
  const quickActions: Array<{ label: string; target: CoreNavigationTarget }> = []
  if (hasCapability('events.write')) quickActions.push({ label: '创建活动', target: '/events/new/edit' })
  if (hasCapability('tasks.manage')) quickActions.push({ label: 'NPC 任务', target: '/task-approval' })
  if (hasCapability('orders.read')) quickActions.push({ label: '订单查询', target: '/orders' })
  return (
    <PermissionGuard capabilities={['admin.dashboard']}>
      <OverviewPageView
        data={query.data || null}
        loading={query.loading}
        error={query.errorMessage}
        filters={<div className="filter-bar overview-filters">
          <Select aria-label="概览时间" value={preset} options={[{ value: 'TODAY', label: '今天' }, { value: 'THIS_WEEK', label: '本周' }, { value: 'THIS_MONTH', label: '本月' }, { value: 'LAST_30_DAYS', label: '最近 30 天' }, { value: 'CUSTOM', label: '自定义区间' }]} onChange={value => { setPreset(value); setRange(null) }} />
          {preset === 'CUSTOM' ? <DatePicker.RangePicker aria-label="概览自定义区间" value={range ? [dayjs(range[0]), dayjs(range[1])] : null} onChange={dates => { setRange(dates?.[0] && dates[1] ? [dates[0].format('YYYY-MM-DD'), dates[1].format('YYYY-MM-DD')] : null); if (dates?.[0] && dates[1]) setPreset('CUSTOM') }} /> : null}
          <div className="overview-scope-filter"><RemoteCatalogSelect action="mip.admin.branches.list" input={{ purpose: 'OVERVIEW_FILTER' }} placeholder="全部授权范围" value={branchId} onChange={value => setBranchId(String(value || ''))} /></div>
          <Button icon={<ReloadOutlined />} loading={query.loading} onClick={() => void query.refetch()}>刷新概览</Button>
        </div>}
        quickActions={quickActions}
        onNavigate={onNavigate}
        onRetry={() => void query.refetch()}
      />
    </PermissionGuard>
  )
}

export function OverviewPageView({
  data,
  loading,
  error,
  quickActions,
  filters,
  onNavigate,
  onRetry,
}: {
  data: AdminOverviewView | null
  filters?: React.ReactNode
  loading?: boolean
  error?: string
  quickActions: Array<{ label: string; target: CoreNavigationTarget }>
  onNavigate: (target: CoreNavigationTarget) => void
  onRetry?: () => void
}) {
  const [showAllActivity, setShowAllActivity] = useState(false)
  const groups = data ? groupOverviewMetrics(data.metrics) : []
  const attention = data?.attention.filter(item => item.value !== '0') || []
  const activity = showAllActivity ? data?.activity || [] : data?.activity.slice(0, 6) || []
  return (
    <>
      <PageHeader title="网站概览" description="会员、活动与运营概况" actions={data ? <Space wrap><Tag icon={<ClockCircleOutlined />}>{data.period}</Tag><span className="overview-updated">更新于 {data.asOf}</span></Space> : undefined} />
      {filters}
      {loading && !data ? <LoadingState /> : null}
      {error ? data ? <Alert className="overview-refresh-error" type="warning" showIcon title="刷新失败，当前显示上次成功加载的数据" description={error} action={<Button onClick={onRetry}>重试</Button>} /> : <ErrorState description={error} onRetry={onRetry} /> : null}
      {data ? <>
        <section className="metric-grid overview-headline" aria-label="关键运营指标">
          {data.metrics.slice(0, 4).map((metric, index) => <MetricCard key={metric.label} {...metric} icon={metricIcons[index]} />)}
        </section>
        <div className="overview-focus-grid">
          <Card className="core-panel" title="会籍购买与续费趋势" variant="borderless" extra={<Tag>{data.period}</Tag>}>
            {data.playerTrend.available && data.playerTrend.months.length ? <Suspense fallback={<LoadingState />}><PurchaseChart months={data.playerTrend.months} /></Suspense>
              : <EmptyState title="暂无会籍趋势" description="按月的新增玩家与续费趋势暂未提供，待服务端接入后展示。" />}
            {data.purchaseTrend?.rows.length ? <Collapse ghost items={[{ key: 'daily', label: `查看逐日明细（${data.purchaseTrend.rows.length} 天）`, children: <div className="overview-trend-details"><DataTable label="会籍购买与续费逐日明细" rows={data.purchaseTrend.rows} columns={[{ key: 'date', label: '日期' }, { key: 'initial', label: '首次购买' }, { key: 'firstRenewal', label: '首次续费' }, { key: 'repeatRenewal', label: '再次续费' }, { key: 'paidAmount', label: '实付（元）' }]} /></div> }]} /> : null}
          </Card>
          <Card className="core-panel overview-workbench" title="运营待办" variant="borderless">
            {attention.length ? <ul className="overview-attention">{attention.map(item => <li key={item.target}><Button type="text" block onClick={() => onNavigate(item.target)}><span>{item.label}</span><strong>{item.value}</strong><ArrowRightOutlined /></Button></li>)}</ul> : <div className="overview-clear"><CheckCircleOutlined /><strong>{data.attention.length ? '当前没有待办' : '暂无待办数据'}</strong><span>{data.attention.length ? '已统计的待办均为 0 条' : '暂无可显示的待办数据'}</span></div>}
            <p className="overview-attention-note">到期提醒、审核与发送类待办按 PRD 分为 8 类，其余类别将在后续分期接入。</p>
            {data.attention.some(item => item.value === '0') ? <div className="overview-checked-items">{data.attention.filter(item => item.value === '0').map(item => <span key={item.target}><CheckCircleOutlined />{item.label}：0</span>)}</div> : null}
            <div className="overview-shortcuts"><h2>常用入口</h2>{quickActions.map(item => <Button key={item.target} onClick={() => onNavigate(item.target)}>{item.label}<ArrowRightOutlined /></Button>)}{!quickActions.length ? <span>暂无可用入口</span> : null}</div>
          </Card>
        </div>
        {groups.length ? <Card className="core-panel overview-breakdown" title="业务指标" variant="borderless"><Tabs items={groups.map(group => ({ key: group.key, label: group.title, children: <dl className="overview-metric-details">{group.metrics.map(metric => <div key={metric.label}><dt>{metric.label}</dt><dd>{metric.value}</dd><small data-trend={metric.trend}>{metric.detail}</small></div>)}</dl> }))} /></Card> : null}
        <Card className="core-panel overview-activity" title="最近动态" variant="borderless" extra={data.activity.length > 6 ? <Button type="link" onClick={() => setShowAllActivity(value => !value)}>{showAllActivity ? '收起动态' : `查看全部（${data.activity.length}）`}</Button> : undefined}>
          {activity.length ? <ul className="overview-activity-list">{activity.map(item => <li key={item.detailId}><span className="overview-activity-icon"><FileSearchOutlined /></span><div><strong>{item.title}</strong><small>{item.meta}</small></div><Tag>{item.state}</Tag></li>)}</ul> : <EmptyState title="暂无系统动态" description="当前范围没有可显示的业务记录。" />}
        </Card>
      </> : null}
    </>
  )
}
