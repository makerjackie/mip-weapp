import {
  CalendarOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  OrderedListOutlined,
  SafetyCertificateOutlined,
  TeamOutlined,
} from '@ant-design/icons'
import { Button, Card, Space, Tag, Typography } from 'antd'
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
  const query = useAdminOverview()
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
  onNavigate,
  onRetry,
}: {
  data: AdminOverviewView | null
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
        actions={data ? <Tag icon={<ClockCircleOutlined />}>{data.period}</Tag> : undefined}
      />
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
            <Card className="core-panel" title="玩家增长趋势" variant="borderless">
              {data.playerTrend.available && data.playerTrend.points.length ? (
                <ul className="overview-value-list">
                  {data.playerTrend.points.map(item => (
                    <li key={item.label}><span>{item.label}</span><strong>{item.value.toLocaleString('zh-CN')}</strong></li>
                  ))}
                </ul>
              ) : (
                <EmptyState title="暂无趋势数据" description="当前周期没有可显示的玩家增长趋势。" />
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
