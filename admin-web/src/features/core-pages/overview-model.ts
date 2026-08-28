import type { AdminRequest } from '../../modules/admin-read-pages'

export interface AdminOverviewMetric {
  label: string
  value: string
  detail: string
  trend?: 'up' | 'down' | 'neutral'
}

export interface AdminOverviewActivityRow {
  [key: string]: unknown
  detailId: string
  title: string
  meta: string
  state: string
}

export interface AdminOverviewAttentionItem {
  label: string
  value: string
  target: '/users' | '/events' | '/orders' | '/tasks'
}

export interface AdminOverviewView {
  period: string
  asOf: string
  metrics: AdminOverviewMetric[]
  playerTrend: {
    available: boolean
    points: Array<{ label: string; value: number }>
  }
  attention: AdminOverviewAttentionItem[]
  activity: AdminOverviewActivityRow[]
}

export async function loadAdminOverview(request: AdminRequest): Promise<AdminOverviewView> {
  return mapAdminOverview(await request('mip.admin.dashboard.overview.get'))
}

export function mapAdminOverview(value: unknown): AdminOverviewView {
  const data = record(value)
  const people = record(data.people)
  const membership = record(data.membership)
  const events = record(data.events)
  const tasks = record(data.tasks)
  const operations = record(data.operations)
  const period = record(data.period)
  return {
    period: dateRange(period.startAt, period.endAt),
    asOf: formatDate(data.asOf, '数据时间未提供'),
    metrics: [
      metric('用户总数', people.activeAccounts, '当前可见范围'),
      metric('有效会员', membership.currentPlayers, '付费权益有效'),
      metric('活动总数', events.totalEvents, '所选时间范围'),
      metric('有效报名', events.effectiveRegistrations, '所选时间范围'),
    ],
    // The current neutral overview contract has no player-count time series.
    playerTrend: { available: false, points: [] },
    attention: [
      attention('30 日内到期会员', membership.expiringPlayers30d, '/users'),
      attention('待审核报名', events.pendingReviewRegistrations, '/events'),
      attention('待审核任务', tasks.pendingReview, '/tasks'),
    ].filter((item): item is AdminOverviewAttentionItem => item !== null),
    activity: Array.isArray(operations.activity)
      ? operations.activity.map((item, index) => {
          const activity = record(item)
          const resource = record(activity.resource)
          const scope = record(activity.scope)
          return {
            detailId: String(activity.id || `activity-${index + 1}`),
            title: String(resource.title || '运营记录'),
            meta: `${formatDate(activity.occurredAt)} · ${scopeLabel(scope.type)}`,
            state: activityLabel(activity.kind),
          }
        })
      : [],
  }
}

function metric(label: string, source: unknown, fallbackDetail: string): AdminOverviewMetric {
  const value = record(source)
  const count = Number(value.count)
  const comparison = record(value.comparison)
  if (value.availability !== 'AVAILABLE' || !Number.isFinite(count)) {
    return { label, value: '—', detail: availabilityLabel(value.availability), trend: 'neutral' }
  }
  const change = Number(comparison.deltaCount)
  if (comparison.availability !== 'AVAILABLE' || !Number.isFinite(change)) {
    return { label, value: count.toLocaleString('zh-CN'), detail: fallbackDetail, trend: 'neutral' }
  }
  return {
    label,
    value: count.toLocaleString('zh-CN'),
    detail: change === 0 ? '与上一周期持平' : `较上一周期 ${change > 0 ? '+' : ''}${change.toLocaleString('zh-CN')}`,
    trend: change > 0 ? 'up' : change < 0 ? 'down' : 'neutral',
  }
}

function attention(
  label: string,
  source: unknown,
  target: AdminOverviewAttentionItem['target'],
): AdminOverviewAttentionItem | null {
  const value = record(source)
  const count = Number(value.count)
  return value.availability === 'AVAILABLE' && Number.isFinite(count)
    ? { label, value: count.toLocaleString('zh-CN'), target }
    : null
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function dateRange(start: unknown, end: unknown) {
  const startDate = new Date(String(start || ''))
  const endDate = new Date(String(end || ''))
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return '当前周期'
  const format = (date: Date) => date.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
  return `${format(startDate)}–${format(endDate)}`
}

function formatDate(value: unknown, fallback = '时间未提供') {
  const date = new Date(String(value || ''))
  return Number.isNaN(date.getTime()) ? fallback : date.toLocaleString('zh-CN', { hour12: false })
}

function availabilityLabel(value: unknown) {
  if (value === 'RESTRICTED') return '当前账号不可查看'
  if (value === 'NOT_APPLICABLE') return '当前范围不适用'
  if (value === 'NOT_TRACKED') return '暂未统计'
  return '暂无数据'
}

function scopeLabel(value: unknown) {
  const labels: Record<string, string> = {
    PLATFORM: '平台',
    BRANCH: '服务器',
    EVENT: '活动',
    RESOURCE: '业务资源',
  }
  return labels[String(value || '')] || '平台'
}

function activityLabel(value: unknown) {
  const labels: Record<string, string> = {
    'event.registration_confirmed': '活动报名',
    'membership.payment_confirmed': '会员支付',
    'task.completed': '任务完成',
  }
  const key = String(value || '')
  if (labels[key]) return labels[key]
  if (key.startsWith('admin.')) return '运营操作'
  return '业务记录'
}
