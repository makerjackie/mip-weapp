import type {
  AdminCapabilityGrant,
  AdminDashboardActivity,
  AdminDashboardAvailability,
  AdminDashboardCountMetric,
  AdminDashboardMoneyMetric,
  AdminDashboardOverview,
  AdminDashboardOverviewPreset,
  AdminDashboardRateMetric,
} from '../../../modules/mip-admin'
import type { AdminDashboardTrendView } from './trends'
import { buildAdminWorkspaceNavigation } from '../components/workspace-nav/model'
import { withDashboardMetricTargets } from './metric-targets'
import { buildDashboardTrends } from './trends'

export type { AdminDashboardScopeOption } from './filters'
export {
  buildDashboardScopeOptions,
  canLoadDashboardBranchCatalog,
  customDashboardPeriod,
  dashboardShanghaiToday,
  initialDashboardScopeOptions,
  validateDashboardCustomPeriod,
} from './filters'
export type {
  AdminDashboardTrendBarView,
  AdminDashboardTrendPointView,
  AdminDashboardTrendView,
} from './trends'
export { normalizedDashboardTrendWidth } from './trends'

export interface AdminDashboardMetricView {
  key: string
  label: string
  value: string
  detail: string
  available: boolean
  path: string
}

export interface AdminDashboardActivityView {
  id: string
  title: string
  actor: string
  resource: string
  scope: string
  occurredAt: string
}

export interface AdminDashboardAttentionView {
  key: string
  label: string
  value: string
  detail: string
  path: string
}

export interface AdminDashboardActionView {
  key: string
  label: string
  description: string
  path: string
}

export type AdminDashboardMenuItemView = AdminDashboardActionView

export interface AdminDashboardMenuGroupView {
  key: string
  label: string
  items: AdminDashboardMenuItemView[]
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
  attentionItems: AdminDashboardAttentionView[]
  quickActions: AdminDashboardActionView[]
  menuGroups: AdminDashboardMenuGroupView[]
  trends: AdminDashboardTrendView[]
  activities: AdminDashboardActivityView[]
  activityAvailable: boolean
}

export type AdminDashboardPeriodOption = AdminDashboardOverviewPreset

export const dashboardPeriodOptions: Array<{
  key: AdminDashboardPeriodOption
  label: string
}> = [
  { key: 'TODAY', label: '今天' },
  { key: 'THIS_WEEK', label: '本周' },
  { key: 'THIS_MONTH', label: '本月' },
  { key: 'LAST_30_DAYS', label: '近 30 天' },
  { key: 'CUSTOM', label: '自定义' },
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
  attentionItems: [],
  quickActions: [],
  menuGroups: [],
  trends: [],
  activities: [],
  activityAvailable: false,
}

const dashboardMenuDescriptions: Readonly<Record<string, string>> = {
  'profiles': '筛选用户并查看资料与会员状态',
  'managed-events': '管理活动、报名、签到和队伍',
  'event-catalogs': '维护活动分类、标签和显示顺序',
  'event-recaps': '维护活动视频回顾入口',
  'event-participants': '查看活动参与者和联系方式',
  'orders': '查看订单并处理退款申请',
  'payment-attempts': '核对支付请求和处理状态',
  'membership-ledger': '查看会员权益变更记录',
  'announcements': '维护平台和城市分会公告',
  'message-campaigns': '创建并发布站内消息',
  'message-delivery-records': '查看消息投递结果',
  'banners': '维护首页 Banner 内容',
  'knowledge': '维护知识内容和评论审核',
  'opportunities': '审核和管理合作机会',
  'user-content': '审核用户发布的内容',
  'community-reports': '领取并处理举报记录',
  'growth-entries': '查看成长值变更流水',
  'benefit-ledger': '查看统一权益变更流水',
  'growth-transitions': '查看会员等级变更记录',
  'growth-levels': '维护成长等级和规则',
  'tasks': '配置任务并查看完成情况',
  'badges': '维护勋章并管理授予状态',
  'game': '管理赛季、队伍和排行榜',
  'branches': '新增、编辑和启停城市分会',
  'roles': '管理平台、分会和活动角色',
  'exceptions': '处理运营异常和消息投递问题',
  'audit': '查看敏感读取与管理变更',
}

const dashboardQuickActionKeys = ['managed-events', 'profiles', 'orders', 'message-campaigns']

export function buildDashboardMenuGroups(grants: AdminCapabilityGrant[]): AdminDashboardMenuGroupView[] {
  return buildAdminWorkspaceNavigation(grants, '')
    .map(group => ({
      key: group.key,
      label: group.label,
      items: group.items
        .filter(item => item.key !== 'dashboard')
        .map(item => ({
          key: item.key,
          label: item.label,
          description: dashboardMenuDescriptions[item.key] || `打开${item.label}`,
          path: `/${item.route}`,
        })),
    }))
    .filter(group => group.items.length > 0)
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
    path: '',
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
    path: '',
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
    path: '',
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
    path: '',
  }
}

function ratingMetric(key: string, label: string, value: number | null) {
  return value === null
    ? unavailableMetric(key, label, 'NOT_PROVIDED')
    : { key, label, value: value.toFixed(1), detail: '满分 5 分', available: true, path: '' }
}

function metricAttention(
  metric: AdminDashboardMetricView | undefined,
  key: string,
  label: string,
): AdminDashboardAttentionView | null {
  if (!metric || !metric.available || !metric.path || metric.value === '0') {
    return null
  }
  return {
    key,
    label,
    value: metric.value,
    detail: metric.detail,
    path: metric.path,
  }
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
  const option = overview.period.preset === 'CUSTOM'
    ? null
    : dashboardPeriodOptions.find(item => item.key === overview.period.preset)
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

export function buildDashboardViewModel(
  overview: AdminDashboardOverview,
  grants: AdminCapabilityGrant[] = [],
): AdminDashboardViewModel {
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

  const targetedMembershipMetrics = withDashboardMetricTargets(membershipMetrics, grants)
  const targetedEventMetrics = withDashboardMetricTargets(eventMetrics, grants)
  const targetedTaskMetrics = withDashboardMetricTargets(taskMetrics, grants)
  const attentionItems = [
    metricAttention(targetedEventMetrics.find(item => item.key === 'events-pending-review'), 'event-reviews', '待审核报名'),
    metricAttention(targetedTaskMetrics.find(item => item.key === 'tasks-pending-review'), 'task-reviews', '待审核任务'),
    metricAttention(targetedMembershipMetrics.find(item => item.key === 'membership-expiring'), 'membership-expiring', '即将到期会员'),
  ].filter((item): item is AdminDashboardAttentionView => item !== null)

  const menuGroups = buildDashboardMenuGroups(grants)
  const actionsByKey = new Map(
    menuGroups.flatMap(group => group.items).map(item => [item.key, item]),
  )
  const quickActions = dashboardQuickActionKeys
    .map(key => actionsByKey.get(key))
    .filter((item): item is AdminDashboardActionView => item !== undefined)

  return {
    scopeLabel: scopeLabel(overview),
    periodLabel: periodLabel(overview),
    asOfLabel: shanghaiTime(overview.asOf),
    summaryMetrics: withDashboardMetricTargets(summaryMetrics, grants),
    membershipMetrics: targetedMembershipMetrics,
    eventMetrics: targetedEventMetrics,
    opportunityMetrics: withDashboardMetricTargets(opportunityMetrics, grants),
    taskMetrics: targetedTaskMetrics,
    attentionItems,
    quickActions,
    menuGroups,
    trends: buildDashboardTrends(overview),
    activities: overview.operations.availability === 'AVAILABLE'
      ? overview.operations.activity.map(activityView)
      : [],
    activityAvailable: overview.operations.availability === 'AVAILABLE',
  }
}
