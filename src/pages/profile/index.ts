import type { QueryOptions } from '@weapp/shared/cache'
import { adminModule } from '../../modules/admin/client'
import { membershipModule } from '../../modules/membership/client'
import { caseNavigateTo, syncCaseNavigation } from '../../modules/platform/case-navigation'
import { formatLocalDate } from '../../utils/date'

const roleLabels: Record<string, string> = {
  owner: '主理人',
  manager: '管理员',
  reviewer: '审核员',
  support: '客服',
}

function profileSignature(overview: Awaited<ReturnType<typeof membershipModule.load>>) {
  return JSON.stringify({
    profile: overview.profile,
    membership: overview.membership,
    unreadNotificationCount: overview.unreadNotificationCount,
  })
}

Page({
  data: {
    state: 'loading' as 'loading' | 'ready' | 'error',
    nickname: '微信用户',
    nicknameInitial: '微',
    avatarUrl: '',
    city: '',
    headline: '',
    phoneBound: false,
    completion: 0,
    membershipLabel: '普通用户',
    expiresText: '',
    savingProfile: false,
    message: '',
    adminEnabled: false,
    eventManagerEnabled: false,
    adminRole: '',
    onboardingComplete: true,
    profileSignature: '',
    unreadNotificationCount: 0,
  },

  onShow() {
    syncCaseNavigation(this, 'pages/profile/index')
    void this.loadProfile()
  },

  async loadProfile(options: QueryOptions = {}) {
    const cached = membershipModule.peekOverview()
    if (cached) {
      this.applyOverview(cached)
    }
    else if (this.data.state !== 'ready') {
      this.setData({ state: 'loading', message: '' })
    }
    try {
      const overview = await membershipModule.load(options)
      this.applyOverview(overview)
      try {
        const session = await adminModule.getSession(options)
        this.setData({
          adminEnabled: session.enabled,
          eventManagerEnabled: session.eventManagerEnabled,
          adminRole: roleLabels[session.role || ''] || '',
        })
      }
      catch {
        this.setData({ adminEnabled: false, eventManagerEnabled: false, adminRole: '' })
      }
    }
    catch (error) {
      this.setData(cached || this.data.state === 'ready'
        ? { message: '资料更新失败，已保留上次结果。' }
        : { state: 'error', message: error instanceof Error ? error.message : '个人信息加载失败' })
    }
  },

  applyOverview(overview: Awaited<ReturnType<typeof membershipModule.load>>) {
    const signature = profileSignature(overview)
    if (this.data.state === 'ready' && this.data.profileSignature === signature) {
      if (this.data.message) {
        this.setData({ message: '' })
      }
      return
    }
    const expiresAt = overview.membership.expiresAt
    const expired = Boolean(expiresAt && new Date(expiresAt).getTime() <= Date.now())
    this.setData({
      state: 'ready',
      nickname: overview.profile.nickname || '微信用户',
      nicknameInitial: (overview.profile.nickname || '微信用户').slice(0, 1),
      avatarUrl: overview.profile.avatarUrl,
      city: overview.profile.city,
      headline: overview.profile.headline,
      phoneBound: overview.profile.phoneBound,
      completion: overview.profile.completion,
      onboardingComplete: overview.profile.onboardingComplete,
      membershipLabel: overview.membership.active ? '有效会员' : (expired ? '会员已到期' : '普通用户'),
      expiresText: overview.membership.active && expiresAt ? formatLocalDate(expiresAt) : '',
      message: '',
      profileSignature: signature,
      unreadNotificationCount: overview.unreadNotificationCount,
    })
  },

  async onPullDownRefresh() {
    try {
      await this.loadProfile({ force: true })
    }
    finally {
      wx.stopPullDownRefresh()
    }
  },

  openMembership() {
    caseNavigateTo({ url: '/pages/membership/index' })
  },

  openProfileEdit() {
    caseNavigateTo({ url: '/packages/member/profile-edit/index' })
  },

  openAccess() {
    caseNavigateTo({ url: '/packages/member/profile-edit/index' })
  },

  openOrders() {
    caseNavigateTo({ url: '/packages/member/orders/index' })
  },

  openConnections() {
    caseNavigateTo({ url: '/packages/member/connections/index' })
  },

  openNotifications() {
    caseNavigateTo({ url: '/packages/member/notifications/index' })
  },

  openRegistrations() {
    caseNavigateTo({ url: '/packages/member/registrations/index' })
  },

  openPrivacy() {
    caseNavigateTo({ url: '/packages/member/privacy/index' })
  },

  openBenefits() {
    caseNavigateTo({ url: '/packages/member/benefits/index' })
  },

  openHelp() {
    caseNavigateTo({ url: '/packages/member/help/index' })
  },

  openAbout() {
    caseNavigateTo({ url: '/packages/member/about/index' })
  },

  openAdmin() {
    if (!this.data.adminEnabled) {
      return
    }
    caseNavigateTo({ url: '/packages/admin/dashboard/index' })
  },

  openManagedEvents() {
    if (!this.data.adminEnabled && !this.data.eventManagerEnabled) {
      return
    }
    caseNavigateTo({ url: '/packages/admin/managed-events/index' })
  },
})
