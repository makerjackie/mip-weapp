import type {
  AdminDashboardAvailability,
  AdminDashboardOverview,
} from '../../../modules/mip-admin'

export interface AdminDashboardTrendBarView {
  key: string
  label: string
  value: string
  widthPercent: number
}

export interface AdminDashboardTrendPointView {
  key: string
  label: string
  detail: string
  bars: AdminDashboardTrendBarView[]
}

export interface AdminDashboardTrendView {
  key: 'membership' | 'events'
  title: string
  state: 'ready' | 'empty' | 'unavailable'
  message: string
  points: AdminDashboardTrendPointView[]
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
  return '暂未提供'
}

export function normalizedDashboardTrendWidth(value: number, maximum: number) {
  if (!Number.isFinite(value) || value <= 0 || !Number.isFinite(maximum) || maximum <= 0) {
    return 0
  }
  return Math.max(8, Math.min(100, Math.round((value / maximum) * 100)))
}

function membershipTrend(overview: AdminDashboardOverview): AdminDashboardTrendView {
  const flow = overview.membership.purchaseFlow
  if (flow.availability !== 'AVAILABLE') {
    return {
      key: 'membership',
      title: '会员购买趋势',
      state: 'unavailable',
      message: availabilityText(flow.availability),
      points: [],
    }
  }
  const maximum = Math.max(0, ...flow.series.map(item => item.eligiblePurchaseCount))
  if (maximum === 0) {
    return {
      key: 'membership',
      title: '会员购买趋势',
      state: 'empty',
      message: '当前时间范围内没有会员购买记录。',
      points: [],
    }
  }
  return {
    key: 'membership',
    title: '会员购买趋势',
    state: 'ready',
    message: '',
    points: flow.series.map(item => ({
      key: item.bucketStartDate,
      label: item.bucketStartDate,
      detail: [
        `初购 ${item.initialPurchaseCount}`,
        `首续 ${item.firstRenewalCount}`,
        `再续 ${item.repeatRenewalCount}`,
        `实付 ¥${(item.eligiblePaidAmountCents / 100).toFixed(2)}`,
      ].join(' · '),
      bars: [{
        key: 'eligible-purchases',
        label: '购买',
        value: `${item.eligiblePurchaseCount}`,
        widthPercent: normalizedDashboardTrendWidth(item.eligiblePurchaseCount, maximum),
      }],
    })),
  }
}

function eventTrend(overview: AdminDashboardOverview): AdminDashboardTrendView {
  if (overview.events.availability !== 'AVAILABLE') {
    return {
      key: 'events',
      title: '活动与报名趋势',
      state: 'unavailable',
      message: availabilityText(overview.events.availability),
      points: [],
    }
  }
  const maximum = Math.max(0, ...overview.events.series.flatMap(item => [
    item.scheduledEventCount,
    item.effectiveRegistrationCount,
  ]))
  if (maximum === 0) {
    return {
      key: 'events',
      title: '活动与报名趋势',
      state: 'empty',
      message: '当前时间范围内没有活动安排或有效报名。',
      points: [],
    }
  }
  return {
    key: 'events',
    title: '活动与报名趋势',
    state: 'ready',
    message: '',
    points: overview.events.series.map(item => ({
      key: item.bucketStartDate,
      label: item.bucketStartDate,
      detail: '',
      bars: [{
        key: 'scheduled-events',
        label: '活动',
        value: `${item.scheduledEventCount}`,
        widthPercent: normalizedDashboardTrendWidth(item.scheduledEventCount, maximum),
      }, {
        key: 'effective-registrations',
        label: '报名',
        value: `${item.effectiveRegistrationCount}`,
        widthPercent: normalizedDashboardTrendWidth(item.effectiveRegistrationCount, maximum),
      }],
    })),
  }
}

export function buildDashboardTrends(overview: AdminDashboardOverview) {
  return [membershipTrend(overview), eventTrend(overview)]
}
