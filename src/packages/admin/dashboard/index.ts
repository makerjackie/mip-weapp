import type { AdminPageState } from '../shared/page-state'
import type { AdminDashboardActivityView, AdminDashboardPeriodOption } from './model'
import { hasCapability, mipAdminModule } from '../../../modules/mip-admin'
import { adminLoadFailure, isAdminForbiddenError } from '../shared/page-state'
import {
  buildDashboardViewModel,
  dashboardPeriodOptions,
  emptyDashboardViewModel,
} from './model'

Page({
  data: {
    state: 'loading' as AdminPageState,
    view: emptyDashboardViewModel,
    periodOptions: dashboardPeriodOptions,
    selectedPreset: 'THIS_MONTH' as AdminDashboardPeriodOption,
    successfulPreset: 'THIS_MONTH' as AdminDashboardPeriodOption,
    activityDetailOpen: false,
    selectedActivity: null as AdminDashboardActivityView | null,
    canUsers: false,
    canBranches: false,
    canCommunityReports: false,
    canAnnouncements: false,
    canMessages: false,
    canEvents: false,
    canOrders: false,
    canOpportunities: false,
    canGrowth: false,
    canTasks: false,
    canBanners: false,
    canBadges: false,
    canGame: false,
    canKnowledge: false,
    canExceptions: false,
    canRoles: false,
    canAudit: false,
    message: '',
  },
  requestSeq: 0,

  onShow() {
    void this.loadDashboard()
  },

  onUnload() {
    this.requestSeq += 1
  },

  async loadDashboard(force = false) {
    const hasContent = this.data.state === 'ready'
    const requestedPreset = this.data.selectedPreset
    const seq = this.requestSeq + 1
    this.requestSeq = seq
    this.setData(hasContent ? { message: '' } : { state: 'loading', message: '' })
    try {
      const [session, overview] = await Promise.all([
        mipAdminModule.getSession(force),
        mipAdminModule.getDashboardOverview({
          period: { preset: requestedPreset },
        }, force),
      ])
      if (seq !== this.requestSeq) {
        return
      }
      const grants = session.capabilities
      this.setData({
        state: 'ready',
        view: buildDashboardViewModel(overview),
        successfulPreset: requestedPreset,
        canUsers: hasCapability(grants, 'users.read'),
        canBranches: hasCapability(grants, 'branches.manage'),
        canCommunityReports: hasCapability(grants, 'community.reports.manage'),
        canAnnouncements: hasCapability(grants, 'announcements.manage'),
        canMessages: hasCapability(grants, 'messages.manage'),
        canEvents: hasCapability(grants, 'events.read'),
        canOrders: hasCapability(grants, 'orders.read'),
        canOpportunities: hasCapability(grants, 'opportunities.moderate'),
        canGrowth: hasCapability(grants, 'growth.read'),
        canTasks: hasCapability(grants, 'tasks.manage'),
        canBanners: hasCapability(grants, 'banners.manage'),
        canBadges: hasCapability(grants, 'badges.manage'),
        canGame: hasCapability(grants, 'game.manage'),
        canKnowledge: hasCapability(grants, 'knowledge.manage'),
        canExceptions: hasCapability(grants, 'operations.exceptions.read')
          || hasCapability(grants, 'messages.delivery.review'),
        canRoles: hasCapability(grants, 'roles.change'),
        canAudit: hasCapability(grants, 'audit.read'),
        message: '',
      })
    }
    catch (error) {
      if (seq !== this.requestSeq) {
        return
      }
      const accessRevoked = isAdminForbiddenError(error)
      this.setData({
        ...adminLoadFailure(error, {
          hasContent: hasContent && !accessRevoked,
          fallbackMessage: '数据概览加载失败',
        }),
        selectedPreset: this.data.successfulPreset,
        ...(accessRevoked
          ? {
              view: emptyDashboardViewModel,
              activityDetailOpen: false,
              selectedActivity: null,
            }
          : {}),
      })
    }
  },

  changePeriod(event: WechatMiniprogram.TouchEvent) {
    const preset = String(event.currentTarget.dataset.preset || '') as AdminDashboardPeriodOption
    if (!dashboardPeriodOptions.some(item => item.key === preset)
      || preset === this.data.selectedPreset) {
      return
    }
    this.setData({ selectedPreset: preset })
    void this.loadDashboard(true)
  },

  openActivity(event: WechatMiniprogram.TouchEvent) {
    const activity = this.data.view.activities.find(
      item => item.id === String(event.currentTarget.dataset.id || ''),
    )
    if (activity) {
      this.setData({ activityDetailOpen: true, selectedActivity: activity })
    }
  },

  closeActivity() {
    this.setData({ activityDetailOpen: false, selectedActivity: null })
  },

  handleActivityVisibility(event: WechatMiniprogram.CustomEvent<{ visible?: boolean }>) {
    if (!event.detail.visible) {
      this.closeActivity()
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

  openPage(event: WechatMiniprogram.TouchEvent) {
    const path = String(event.currentTarget.dataset.path || '')
    if (path.startsWith('/packages/admin/')) {
      void wx.navigateTo({ url: path })
    }
  },
})
