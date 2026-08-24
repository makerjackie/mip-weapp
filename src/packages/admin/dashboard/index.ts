import type { AdminDashboard } from '../../../modules/mip-admin'
import type { AdminPageState } from '../shared/page-state'
import { hasCapability, mipAdminModule } from '../../../modules/mip-admin'
import { adminLoadFailure } from '../shared/page-state'

const emptyCounts: AdminDashboard['counts'] = {
  totalUsers: 0,
  newUsers7d: 0,
  activePlayers: 0,
  interactingPlayers30d: 0,
  playerInteractionRate30d: 0,
  totalEvents: 0,
  publishedEvents: 0,
  pendingRegistrations: 0,
  paidOrders: 0,
  pendingRefunds: 0,
  totalOpportunities: 0,
  publishedOpportunities: 0,
  publishedLifecycleOpportunities: 0,
  convertedOpportunities: 0,
  opportunityConversionRate: 0,
}

Page({
  data: {
    state: 'loading' as AdminPageState,
    counts: emptyCounts,
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

  onShow() {
    void this.loadDashboard()
  },

  async loadDashboard(force = false) {
    const hasContent = this.data.state === 'ready'
    if (!hasContent) {
      this.setData({ state: 'loading', message: '' })
    }
    try {
      const dashboard = await mipAdminModule.getDashboard(force)
      const grants = dashboard.session.capabilities
      this.setData({
        state: 'ready',
        counts: dashboard.counts,
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
        canExceptions: hasCapability(grants, 'operations.exceptions.read'),
        canRoles: hasCapability(grants, 'roles.change'),
        canAudit: hasCapability(grants, 'audit.read'),
        message: '',
      })
    }
    catch (error) {
      this.setData(adminLoadFailure(error, { hasContent, fallbackMessage: '运营工作台加载失败' }))
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
