import type { AdminRequestInput } from '../../domain/contracts'
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

export interface AdminOverviewPurchasePoint {
  date: string
  initial: number | null
  firstRenewal: number | null
  repeatRenewal: number | null
  paidAmount: number | null
}

export interface AdminOverviewView {
  period: string
  asOf: string
  metrics: AdminOverviewMetric[]
  playerTrend: {
    available: boolean
    points: Array<{ label: string; value: number }>
  }
  purchaseTrend?: { available: boolean; points?: AdminOverviewPurchasePoint[]; rows: Array<{ [key: string]: unknown; date: string; initial: string; firstRenewal: string; repeatRenewal: string; paidAmount: string }> }
  attention: AdminOverviewAttentionItem[]
  activity: AdminOverviewActivityRow[]
}

export async function loadAdminOverview(request: AdminRequest, input: AdminRequestInput = {}): Promise<AdminOverviewView> {
  return mapAdminOverview(await request('mip.admin.dashboard.overview.get', input))
}

export function mapAdminOverview(value: unknown): AdminOverviewView {
  const data = record(value)
  const people = record(data.people)
  const membership = record(data.membership)
  const events = record(data.events)
  const operations = record(data.operations)
  const period = record(data.period)
  const purchases = record(membership.purchaseFlow)
  return {
    period: dateRange(period.startAt, period.endAt),
    asOf: formatDate(data.asOf, '数据时间未提供'),
    metrics: [
      metric('用户总数', people.activeAccounts, '当前可见范围'),
      metric('有效会员', membership.currentPlayers, '付费权益有效'),
      metric('活动总数', events.totalEvents, '当前可见范围'),
      metric('有效报名', events.effectiveRegistrations, '所选时间范围'),
      metric('新增用户', people.newAccounts, '所选时间范围'),
      metric('已完善档案', people.profiledUsers, '当前可见范围'),
      metric('30 日互动玩家', people.interactingPlayers30d, '最近 30 日'),
      metric('访客次数', people.recordedProfileVisits, '所选时间范围'),
      metric('访客人数', people.distinctProfileVisitors, '所选时间范围'),
      metric('首次会籍购买', record(membership.purchaseFlow).initialPurchases, '所选时间范围'),
      metric('首次续费', record(membership.purchaseFlow).firstRenewals, '所选时间范围'),
      metric('再次续费', record(membership.purchaseFlow).repeatRenewals, '所选时间范围'),
      metric('机会总数', record(data.opportunities).totalOpportunities, '当前可见范围'),
      metric('招募中机会', record(data.opportunities).publishedOpportunities, '当前可见范围'),
      metric('有效引荐', record(data.opportunities).activeReferrals, '当前可见范围'),
      metric('公开合作卡', record(data.opportunities).publishedCooperationCards, '当前可见范围'),
      metric('公开案例', record(data.opportunities).publishedSuperCases, '当前可见范围'),
      metric('已发布任务', record(data.tasks).publishedTasks, '当前可见范围'),
      metric('成功完成任务', record(data.tasks).successfulCompletions, '所选时间范围'),
      metric('任务发放经验', record(data.tasks).awardedExperience, '所选时间范围'),
      moneyMetric('会籍实付金额', purchases.eligiblePaidAmount),
      metric('活动缴费订单', record(events.financials).paidOrders, '所选时间范围'),
      moneyMetric('活动实付金额', record(events.financials).grossAmount),
      moneyMetric('活动退款金额', record(events.financials).refundedAmount),
      moneyMetric('活动净收入', record(events.financials).netAmount),
    ],
    // The current neutral overview contract has no player-count time series;
    // purchase/registration series are not a player-count trend and must not be substituted.
    playerTrend: { available: false, points: [] },
    purchaseTrend: purchaseTrend(purchases),
    attention: [
      attention('30 日内到期会员', membership.expiringPlayers30d, '/users'),
      attention('待审核报名', events.pendingReviewRegistrations, '/events'),
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

function purchaseTrend(purchases: Record<string, unknown>): NonNullable<AdminOverviewView['purchaseTrend']> {
  const available = purchases.availability === 'AVAILABLE' && Array.isArray(purchases.series)
  const points: AdminOverviewPurchasePoint[] = available ? (purchases.series as unknown[]).map(value => {
    const item = record(value)
    const count = (key: string) => typeof item[key] === 'number' && Number.isSafeInteger(item[key]) && Number(item[key]) >= 0 ? Number(item[key]) : null
    return { date: String(item.bucketStartDate || '—'), initial: count('initialPurchaseCount'), firstRenewal: count('firstRenewalCount'), repeatRenewal: count('repeatRenewalCount'), paidAmount: typeof item.eligiblePaidAmountCents === 'number' && Number.isSafeInteger(item.eligiblePaidAmountCents) ? item.eligiblePaidAmountCents / 100 : null }
  }) : []
  const countText = (value: number | null) => value === null ? '—' : value.toLocaleString('zh-CN')
  return { available, points, rows: points.map(point => ({ date: point.date, initial: countText(point.initial), firstRenewal: countText(point.firstRenewal), repeatRenewal: countText(point.repeatRenewal), paidAmount: point.paidAmount === null ? '—' : point.paidAmount.toFixed(2) })) }
}

function moneyMetric(label: string, source: unknown): AdminOverviewMetric {
  const value = record(source)
  return { label, value: value.availability === 'AVAILABLE' && typeof value.amountCents === 'number' && Number.isSafeInteger(value.amountCents) ? `¥${(value.amountCents / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—', detail: value.availability === 'AVAILABLE' ? '所选时间范围 · 人民币' : availabilityLabel(value.availability) }
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
  // Dashboard periods use [startAt, endAt) in Shanghai time. Display the last
  // included calendar day, rather than the following midnight of a custom range.
  const format = (date: Date) => date.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric', timeZone: 'Asia/Shanghai' })
  return `${format(startDate)}–${format(new Date(endDate.getTime() - 1))}`
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
