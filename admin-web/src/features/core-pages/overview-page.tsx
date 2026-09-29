import {
  CalendarOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  OrderedListOutlined,
  SafetyCertificateOutlined,
  TeamOutlined,
} from '@ant-design/icons'
import { Button, Card, DatePicker, Select, Space, Tag, Typography } from 'antd'
import { useMemo, useState } from 'react'
import type { AdminRequestInput } from '../../domain/contracts'
import { RemoteCatalogSelect } from '../../shared/ui/session-user-select'
import { useAdminSession } from '../../app/session-provider'
import type { AdminTableColumn } from '../../modules/admin-read-pages'
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
import './core-pages.css'

const activityColumns: AdminTableColumn[] = [
  { key: 'title', label: '记录' },
  { key: 'meta', label: '时间与范围' },
  { key: 'state', label: '类型' },
]

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
    period: range ? { preset: 'CUSTOM', startDate: range[0], endDate: range[1] } : { preset },
  }), [preset, branchId, range])
  const query = useAdminOverview(input)
  const quickActions: Array<{ label: string; target: CoreNavigationTarget }> = []
  if (hasCapability('users.read')) quickActions.push({ label: '用户管理', target: '/users' })
  if (hasCapability('events.read')) quickActions.push({ label: '活动管理', target: '/events' })
  if (hasCapability('orders.read')) quickActions.push({ label: '订单管理', target: '/orders' })
  if (hasCapability('operations.exceptions.read')) quickActions.push({ label: '运营记录', target: '/operations' })
  return (
    <PermissionGuard capabilities={['admin.dashboard']}>
      <OverviewPageView
        data={query.data || null}
        loading={query.loading}
        error={query.errorMessage}
        filters={<Space wrap className="filter-bar">
          <Select aria-label="概览时间" value={range ? 'CUSTOM' : preset} options={[{ value: 'TODAY', label: '今天' }, { value: 'THIS_WEEK', label: '本周' }, { value: 'THIS_MONTH', label: '本月' }, { value: 'LAST_30_DAYS', label: '最近 30 天' }, { value: 'CUSTOM', label: '自定义区间' }]} onChange={value => { if (value !== 'CUSTOM') { setPreset(value); setRange(null) } }} />
          <DatePicker.RangePicker aria-label="概览自定义区间" onChange={dates => setRange(dates?.[0] && dates[1] ? [dates[0].format('YYYY-MM-DD'), dates[1].format('YYYY-MM-DD')] : null)} />
          <div style={{ minWidth: 180 }}><RemoteCatalogSelect action="mip.admin.branches.list" input={{ purpose: 'OVERVIEW_FILTER' }} placeholder="全部授权范围" value={branchId} onChange={value => setBranchId(String(value || ''))} /></div>
          <Button onClick={() => void query.refetch()}>刷新概览</Button>
        </Space>}
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
  return (
    <>
      <PageHeader
        title="网站概览"
        description="查看会员、活动和订单的运营状态"
        actions={data ? <Space wrap><Tag icon={<ClockCircleOutlined />}>{data.period}</Tag><Tag>更新于 {data.asOf}</Tag></Space> : undefined}
      />
      {filters}
      {loading && !data ? <LoadingState /> : null}
      {!loading && error ? <ErrorState description={error} onRetry={onRetry} /> : null}
      {!error && data ? (
        <>
          <section className="metric-grid" aria-label="运营指标">
            {data.metrics.map((metric, index) => (
              <MetricCard
                key={metric.label}
                label={metric.label}
                value={metric.value}
                detail={metric.detail}
                trend={metric.trend}
                icon={metricIcons[index]}
              />
            ))}
          </section>

          <div className="overview-primary-grid">
            <Card className="core-panel" title="会籍购买与续费趋势" variant="borderless">
              {data.purchaseTrend?.available ? <DataTable label="会籍购买与续费趋势" rows={data.purchaseTrend.rows} columns={[{ key: 'date', label: '日期' }, { key: 'initial', label: '首次购买' }, { key: 'firstRenewal', label: '首次续费' }, { key: 'repeatRenewal', label: '再次续费' }, { key: 'paidAmount', label: '实付（元）' }]} /> : <EmptyState title="暂无会籍趋势" description="当前授权范围或统计归属尚未提供此数据。" />}
            </Card>
            <Card className="core-panel" title="玩家增长趋势" variant="borderless">
              {data.playerTrend.available && data.playerTrend.points.length ? (
                <ul className="overview-value-list">
                  {data.playerTrend.points.map(item => (
                    <li key={item.label}><span>{item.label}</span><strong>{item.value.toLocaleString('zh-CN')}</strong></li>
                  ))}
                </ul>
              ) : (
                <EmptyState title="暂无趋势数据" description="服务端当前未提供玩家增长时间序列，不以报名或付费数据替代。" />
              )}
            </Card>
            <Card className="core-panel" title="最近待办" variant="borderless">
              {data.attention.length ? (
                <ul className="overview-value-list">
                  {data.attention.map(item => (
                    <li key={item.target}>
                      <span><strong>{item.label}</strong><small>{item.value} 条</small></span>
                      <Button type="link" onClick={() => onNavigate(item.target)}>查看</Button>
                    </li>
                  ))}
                </ul>
              ) : <EmptyState title="暂无待办" description="当前没有可显示的运营待办。" />}
            </Card>
          </div>

          <div className="overview-secondary-grid">
            <section className="core-list-section">
              <Typography.Title level={2}>系统动态</Typography.Title>
              <DataTable label="系统动态" rows={data.activity} columns={activityColumns} />
            </section>
            <Card className="core-panel" title="快捷操作" variant="borderless">
              {quickActions.length ? (
                <Space orientation="vertical" className="quick-action-list">
                  {quickActions.map(item => (
                    <Button key={item.target} block icon={<OrderedListOutlined />} onClick={() => onNavigate(item.target)}>
                      {item.label}
                    </Button>
                  ))}
                </Space>
              ) : <EmptyState title="暂无可用操作" description="当前账号没有可显示的快捷操作。" />}
              <small className="overview-as-of">数据时间：{data.asOf}</small>
            </Card>
          </div>
        </>
      ) : null}
    </>
  )
}
