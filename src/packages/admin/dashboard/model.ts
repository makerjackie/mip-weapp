import type {
  AdminDashboardActivity,
  AdminDashboardAvailability,
  AdminDashboardCountMetric,
  AdminDashboardMoneyMetric,
  AdminDashboardOverview,
  AdminDashboardOverviewPreset,
  AdminDashboardRateMetric,
} from '../../../modules/mip-admin'

export interface AdminDashboardMetricView {
  key: string
  label: string
  value: string
  detail: string
  available: boolean
}

export interface AdminDashboardActivityView {
  id: string
  title: string
  actor: string
  resource: string
  scope: string
  occurredAt: string
}

export interface AdminDashboardViewModel {
  scopeLabel: string
  periodLabel: string
  asOfLabel: string
  summaryMetrics: AdminDashboardMetricView[]
  membershipMetrics: AdminDashboardMetricView[]
  eventMetrics: AdminDashboardMetricView[]
  opportunityMetrics: AdminDashboardMetricView[]
  taskMetrics: AdminDashboardMetricView[]
  activities: AdminDashboardActivityView[]
  activityAvailable: boolean
}

export type AdminDashboardPeriodOption = Exclude<AdminDashboardOverviewPreset, 'CUSTOM'>

export const dashboardPeriodOptions: Array<{
  key: AdminDashboardPeriodOption
  label: string
}> = [
  { key: 'TODAY', label: '今天' },
  { key: 'THIS_WEEK', label: '本周' },
  { key: 'THIS_MONTH', label: '本月' },
  { key: 'LAST_30_DAYS', label: '近 30 天' },
]

const activityLabels: Record<string, string> = {
  'event.registration_confirmed': '活动报名已确认',
  'membership.payment_confirmed': '会员订单已确认',
  'task.completed': '任务已完成',
  'admin.branches.create': '城市分会已创建',
  'admin.branches.status.change': '城市分会状态已更新',
  'admin.branches.update': '城市分会资料已更新',
  'admin.events.create': '活动已创建',
  'admin.events.status.change': '活动状态已更新',
  'admin.events.update': '活动资料已更新',
  'admin.opportunities.create': '机会已创建',
  'admin.opportunities.end': '机会已结束',
  'admin.opportunities.publish': '机会已发布',
  'admin.users.access.activate': '用户访问状态已启用',
  'admin.users.access.revoke': '用户访问状态已停用',
  'admin.users.fields.update': '用户资料已更新',
}

const resourceLabels: Record<string, string> = {
  ADMIN_SESSION: '管理会话',
  BRANCH: '城市分会',
  EVENT: '活动',
  OPPORTUNITY: '机会',
  ORDER: '订单',
  TASK: '任务',
  USER: '用户',
}

export const emptyDashboardViewModel: AdminDashboardViewModel = {
  scopeLabel: '当前权限范围',
  periodLabel: '本月',
  asOfLabel: '',
  summaryMetrics: [],
  membershipMetrics: [],
  eventMetrics: [],
  opportunityMetrics: [],
  taskMetrics: [],
  activities: [],
  activityAvailable: false,
}

function availabilityText(availability: AdminDashboardAvailability) {
  if (availability === 'RESTRICTED') {
    return '当前权限范围内不可见'
  }
  if (availability === 'NOT_TRACKED') {
    return '暂未统计'
  }
  if (availability === 'NOT_APPLICABLE') {
    return '当前范围不适用'
  }
  if (availability === 'NOT_PROVIDED') {
    return '暂未提供'
  }
  return ''
}

function unavailableMetric(key: string, label: string, availability: AdminDashboardAvailability) {
  return {
    key,
    label,
    value: '—',
    detail: availabilityText(availability),
    available: false,
  }
}

function countMetric(key: string, label: string, metric: AdminDashboardCountMetric, suffix = '') {
  if (metric.availability !== 'AVAILABLE') {
    return unavailableMetric(key, label, metric.availability)
  }
  const comparison = metric.comparison.availability === 'AVAILABLE'
    ? `较上期 ${metric.comparison.deltaCount >= 0 ? '+' : ''}${metric.comparison.deltaCount}`
    : '本期数据'
  return {
    key,
    label,
    value: `${metric.count}${suffix}`,
    detail: comparison,
    available: true,
  }
}

function percentValue(basisPoints: number | null) {
  if (basisPoints === null) {
    return '—'
  }
  const value = (basisPoints / 100).toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1')
  return `${value}%`
}

function rateMetric(key: string, label: string, metric: AdminDashboardRateMetric) {
  if (metric.availability !== 'AVAILABLE') {
    return unavailableMetric(key, label, metric.availability)
  }
  return {
    key,
    label,
    value: percentValue(metric.basisPoints),
    detail: metric.denominator === 0
      ? '当前没有可计算样本'
      : `${metric.numerator} / ${metric.denominator}`,
    available: metric.basisPoints !== null,
  }
}

function moneyMetric(key: string, label: string, metric: AdminDashboardMoneyMetric) {
  const comparison = metric.comparison.availability === 'AVAILABLE'
    ? `较上期 ${metric.comparison.deltaAmountCents >= 0 ? '+' : '-'}¥${(Math.abs(metric.comparison.deltaAmountCents) / 100).toFixed(2)}`
    : '本期数据'
  return {
    key,
    label,
    value: `¥${(metric.amountCents / 100).toFixed(2)}`,
    detail: comparison,
    available: true,
  }
}

function ratingMetric(key: string, label: string, value: number | null) {
  return value === null
    ? unavailableMetric(key, label, 'NOT_PROVIDED')
    : { key, label, value: value.toFixed(1), detail: '满分 5 分', available: true }
}

function fallbackCount(key: string, label: string, availability: AdminDashboardAvailability) {
  return unavailableMetric(key, label, availability)
}

function scopeLabel(overview: AdminDashboardOverview) {
  if (overview.scope.type === 'BRANCH') {
    return overview.scope.name || '城市分会'
  }
  if (overview.scope.type === 'EVENT') {
    return overview.scope.name || '活动'
  }
  if (overview.scope.type === 'PLATFORM') {
    return '平台范围'
  }
  return '当前权限范围'
}

function shanghaiDate(value: string, adjustmentMs = 0) {
  const shifted = new Date(Date.parse(value) + adjustmentMs + 8 * 60 * 60 * 1_000)
  const pad = (item: number) => String(item).padStart(2, '0')
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`
}

function periodLabel(overview: AdminDashboardOverview) {
  const option = dashboardPeriodOptions.find(item => item.key === overview.period.preset)
  if (option) {
    return option.label
  }
  return `${shanghaiDate(overview.period.startAt)} 至 ${shanghaiDate(overview.period.endAt, -1)}`
}

function shanghaiTime(value: string) {
  const shifted = new Date(Date.parse(value) + 8 * 60 * 60 * 1_000)
  const pad = (item: number) => String(item).padStart(2, '0')
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())} ${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}`
}

function activityView(item: AdminDashboardActivity): AdminDashboardActivityView {
  const resourceType = resourceLabels[item.resource.type] || '业务记录'
  return {
    id: item.id,
    title: activityLabels[item.kind] || '运营记录已更新',
    actor: item.actor.displayName || (item.actor.userId ? '未命名用户' : '系统'),
    resource: item.resource.title || resourceType,
    scope: item.scope.type === 'PLATFORM'
      ? '平台'
      : item.scope.type === 'BRANCH'
        ? '城市分会'
        : item.scope.type === 'EVENT'
          ? '活动'
          : '业务范围',
    occurredAt: shanghaiTime(item.occurredAt),
  }
}

export function buildDashboardViewModel(overview: AdminDashboardOverview): AdminDashboardViewModel {
  const people = overview.people.availability === 'AVAILABLE' ? overview.people : null
  const events = overview.events.availability === 'AVAILABLE' ? overview.events : null
  const opportunities = overview.opportunities.availability === 'AVAILABLE'
    ? overview.opportunities
    : null
  const tasks = overview.tasks.availability === 'AVAILABLE' ? overview.tasks : null
  const purchaseFlow = overview.membership.purchaseFlow.availability === 'AVAILABLE'
    ? overview.membership.purchaseFlow
    : null

  const summaryMetrics = [
    countMetric('current-players', '有效玩家', overview.membership.currentPlayers),
    people
      ? countMetric('new-accounts', '新增账号', people.newAccounts)
      : fallbackCount('new-accounts', '新增账号', overview.people.availability),
    events
      ? countMetric('registration-open-events', '可报名活动', events.registrationOpenEvents)
      : fallbackCount('registration-open-events', '可报名活动', overview.events.availability),
    events
      ? countMetric('effective-registrations', '有效报名', events.effectiveRegistrations)
      : fallbackCount('effective-registrations', '有效报名', overview.events.availability),
    opportunities
      ? countMetric('published-opportunities', '已发布机会', opportunities.publishedOpportunities)
      : fallbackCount('published-opportunities', '已发布机会', overview.opportunities.availability),
    tasks
      ? countMetric('task-completions', '任务完成', tasks.successfulCompletions)
      : fallbackCount('task-completions', '任务完成', overview.tasks.availability),
  ]

  const membershipMetrics = [
    countMetric('membership-expiring', '30 日内到期', overview.membership.expiringPlayers30d),
    ...(purchaseFlow
      ? [
          countMetric('membership-initial', '初次购买', purchaseFlow.initialPurchases),
          countMetric('membership-first-renewal', '首次续费', purchaseFlow.firstRenewals),
          countMetric('membership-repeat-renewal', '再次续费', purchaseFlow.repeatRenewals),
          moneyMetric('membership-paid-amount', '会员实付金额', purchaseFlow.eligiblePaidAmount),
        ]
      : [unavailableMetric(
          'membership-purchase-flow',
          '购买与续费',
          overview.membership.purchaseFlow.availability,
        )]),
  ]

  const eventMetrics = events
    ? [
        countMetric('events-total', '活动总数', events.totalEvents),
        countMetric('events-pending-review', '待审核报名', events.pendingReviewRegistrations),
        rateMetric('events-checkin-rate', '签到率', events.quality.checkInRate),
        events.feedback.availability === 'AVAILABLE'
          ? rateMetric('events-feedback-rate', '反馈提交率', events.feedback.submissionRate)
          : unavailableMetric('events-feedback-rate', '反馈提交率', events.feedback.availability),
        events.feedback.availability === 'AVAILABLE'
          ? ratingMetric('events-rating', '平均评分', events.feedback.averageRating)
          : unavailableMetric('events-rating', '平均评分', events.feedback.availability),
        events.financials.availability === 'AVAILABLE'
          ? moneyMetric('events-net-amount', '活动净收入', events.financials.netAmount)
          : unavailableMetric('events-net-amount', '活动净收入', events.financials.availability),
      ]
    : [unavailableMetric('events', '活动数据', overview.events.availability)]

  const opportunityMetrics = opportunities
    ? [
        countMetric('opportunities-total', '机会总数', opportunities.totalOpportunities),
        rateMetric('opportunities-team-rate', '组队率', opportunities.teamFormationRate),
        countMetric('opportunities-referrals', '有效引荐', opportunities.activeReferrals),
        countMetric('opportunities-cards', '已发布合作卡', opportunities.publishedCooperationCards),
        countMetric('opportunities-cases', '已发布案例', opportunities.publishedSuperCases),
        rateMetric('opportunities-conversion', '真实转化率', opportunities.trueConversionRate),
      ]
    : [unavailableMetric('opportunities', '机会数据', overview.opportunities.availability)]

  const taskMetrics = tasks
    ? [
        countMetric('tasks-published', '已发布任务', tasks.publishedTasks),
        countMetric('tasks-completed', '成功完成', tasks.successfulCompletions),
        countMetric('tasks-experience', '发放经验值', tasks.awardedExperience),
        countMetric('tasks-pending-review', '待审核任务', tasks.pendingReview),
      ]
    : [unavailableMetric('tasks', '任务数据', overview.tasks.availability)]

  return {
    scopeLabel: scopeLabel(overview),
    periodLabel: periodLabel(overview),
    asOfLabel: shanghaiTime(overview.asOf),
    summaryMetrics,
    membershipMetrics,
    eventMetrics,
    opportunityMetrics,
    taskMetrics,
    activities: overview.operations.availability === 'AVAILABLE'
      ? overview.operations.activity.map(activityView)
      : [],
    activityAvailable: overview.operations.availability === 'AVAILABLE',
  }
}
