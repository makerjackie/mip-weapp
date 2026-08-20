import type { AdminPageState } from '../shared/page-state'
import { adminModule } from '../../../modules/admin/client'
import { caseNavigateTo } from '../../../modules/platform/case-navigation'
import { formatLocalMonthDayTime } from '../../../utils/date'
import { adminLoadFailure } from '../shared/page-state'

interface DashboardAudit {
  id: string
  actionText: string
  createdText: string
}

const roleLabels: Record<string, string> = {
  owner: '主理人',
  manager: '管理员',
  reviewer: '审核员',
  support: '客服',
}

const actionLabels: Record<string, string> = {
  PROFILE_APPROVED: '通过成员资料',
  PROFILE_REJECTED: '驳回成员资料',
  PROFILE_SUSPENDED: '暂停展示成员',
  EVENT_CREATED: '创建活动草稿',
  EVENT_UPDATED: '更新活动',
  EVENT_PUBLISHED: '发布活动',
  EVENT_CANCELLED: '取消活动',
  REFUND_REQUESTED: '发起退款',
  ACCOUNT_DELETED: '注销账号',
}

function displayDashboard(dashboard: Awaited<ReturnType<typeof adminModule.getDashboard>>) {
  const capabilities = dashboard.session.capabilities
  return {
    state: 'ready' as const,
    role: roleLabels[dashboard.session.role || ''] || '',
    counts: dashboard.counts,
    recentAudit: dashboard.recentAudit.map(item => ({
      id: item.id,
      actionText: actionLabels[item.action] || '运营操作',
      createdText: formatLocalMonthDayTime(item.createdAt),
    })),
    canProfiles: capabilities.includes('profiles'),
    canEvents: capabilities.includes('events'),
    canOrders: capabilities.includes('orders'),
    canAudit: capabilities.includes('audit'),
    canRoles: capabilities.includes('roles'),
    canOperations: capabilities.includes('operations'),
    canAnnouncements: capabilities.includes('announcements'),
    canReports: capabilities.includes('reports'),
    message: '',
  }
}

Page({
  data: { state: 'loading' as AdminPageState, role: '', counts: { totalUsers: 0, newUsers7d: 0, activeMembers: 0, upcomingRegistrations: 0, pendingProfiles: 0, publishedEvents: 0, paidOrders: 0, pendingRefunds: 0, operationalExceptions: 0, publishedAnnouncements: 0, pendingReports: 0 }, recentAudit: [] as DashboardAudit[], canProfiles: false, canEvents: false, canOrders: false, canAudit: false, canRoles: false, canOperations: false, canAnnouncements: false, canReports: false, guideExpanded: false, message: '' },
  onShow() { void this.loadDashboard() },
  async loadDashboard(force = false) {
    const cached = adminModule.peekDashboard()
    if (cached) {
      this.setData(displayDashboard(cached))
    }
    else if (this.data.state !== 'ready') {
      this.setData({ state: 'loading', message: '' })
    }
    try {
      this.setData(displayDashboard(await adminModule.getDashboard({ force })))
    }
    catch (error) {
      this.setData(adminLoadFailure(error, {
        hasContent: Boolean(cached) || this.data.state === 'ready',
        fallbackMessage: '运营台加载失败',
      }))
    }
  },
  async onPullDownRefresh() {
    try {
      await this.loadDashboard(true)
    }
    finally {
      wx.stopPullDownRefresh()
    }
  },
  openProfiles() {
    if (this.data.canProfiles) {
      caseNavigateTo({ url: '/packages/admin/profiles/index' })
    }
  },
  openEvents() {
    if (this.data.canEvents) {
      caseNavigateTo({ url: '/packages/admin/managed-events/index' })
    }
  },
  openOrders() {
    if (this.data.canOrders) {
      caseNavigateTo({ url: '/packages/admin/orders/index' })
    }
  },
  openAudit() {
    if (this.data.canAudit) {
      caseNavigateTo({ url: '/packages/admin/audit/index' })
    }
  },
  openRoles() {
    if (this.data.canRoles) {
      caseNavigateTo({ url: '/packages/admin/roles/index' })
    }
  },
  openOperations() {
    if (this.data.canOperations) {
      caseNavigateTo({ url: '/packages/admin/exceptions/index' })
    }
  },
  openAnnouncements() {
    if (this.data.canAnnouncements) {
      caseNavigateTo({ url: '/packages/admin/announcements/index' })
    }
  },
  openReports() {
    if (this.data.canReports) {
      caseNavigateTo({ url: '/packages/admin/reports/index' })
    }
  },
  toggleGuide() {
    if (this.data.canRoles) {
      this.setData({ guideExpanded: !this.data.guideExpanded })
    }
  },
})
