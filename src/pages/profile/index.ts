import type { SuperCaseSummary } from '../../modules/mip-cases'
import type { CooperationCardSummary } from '../../modules/mip-cooperation'
import type { BadgeCollectionItem } from '../../modules/mip-growth'
import type { IdentityAccessSnapshot, ProtectedActionKey } from '../../modules/mip-identity'
import type { OpportunitySummary } from '../../modules/mip-opportunities'
import { cooperationRoles } from '../../config/mip-catalogs'
import { superCaseModule } from '../../modules/mip-cases'
import { cooperationModule } from '../../modules/mip-cooperation'
import { mipGrowthModule } from '../../modules/mip-growth/client'
import { mipAccessPageUrl } from '../../modules/mip-identity'
import { mipBranchesModule, mipIdentityModule } from '../../modules/mip-identity/client'
import { mipMessagingModule } from '../../modules/mip-messaging/client'
import { opportunityModule } from '../../modules/mip-opportunities'
import { canManageEvents, hasCapability, membershipPresentation } from '../../modules/mip-shell'
import { caseNavigateTo, syncCaseNavigation } from '../../modules/platform/case-navigation'
import { formatLocalDate } from '../../utils/date'

type PortfolioTab = 'cooperation' | 'cases' | 'opportunities'
type SectionState = 'loading' | 'ready' | 'error'

interface CooperationCardView extends CooperationCardSummary {
  roleName: string
}

Page({
  data: {
    state: 'loading' as 'loading' | 'ready' | 'error',
    authenticated: false,
    nickname: '微信用户',
    nicknameInitial: '微',
    avatarUrl: '',
    headline: '',
    profileComplete: false,
    primaryBranchName: '未选择主分会',
    membershipLabel: '嘉宾',
    membershipDescription: '当前没有有效会员权益',
    membershipEndsText: '',
    isPlayer: false,
    adminVisible: false,
    eventManagementVisible: false,
    growthState: 'loading' as 'hidden' | SectionState,
    levelName: '',
    growthProgress: 0,
    growthNextText: '',
    experience: 0,
    contribution: 0,
    badgeState: 'loading' as SectionState,
    equippedBadges: [] as BadgeCollectionItem[],
    unreadCount: 0,
    visitorUnreadCount: 0,
    profileViewCount: null as number | null,
    portfolioTab: 'cooperation' as PortfolioTab,
    cooperationState: 'loading' as SectionState,
    cooperationCards: [] as CooperationCardView[],
    caseState: 'loading' as SectionState,
    cases: [] as SuperCaseSummary[],
    opportunityState: 'loading' as SectionState,
    opportunities: [] as OpportunitySummary[],
    message: '',
  },
  resumeDestination: '',

  onShow() {
    syncCaseNavigation(this, 'pages/profile/index')
    const resume = mipIdentityModule.consumePendingResume('pages/profile/index')
    if (resume && this.resumeDestination) {
      const destination = this.resumeDestination
      this.resumeDestination = ''
      caseNavigateTo({ url: destination })
      return
    }
    this.resumeDestination = ''
    void this.loadProfile()
  },

  async loadProfile(options: { force?: boolean } = {}) {
    const cached = mipIdentityModule.peekSnapshot()
    if (cached) {
      this.applyIdentity(cached)
    }
    else if (this.data.state !== 'ready') {
      this.setData({ state: 'loading', message: '' })
    }
    try {
      const snapshot = await mipIdentityModule.loadSnapshot()
      this.applyIdentity(snapshot)
      await Promise.allSettled([
        this.loadBranch(snapshot, options),
        this.loadGrowth(snapshot, options),
        this.loadBadges(snapshot),
        this.loadCooperation(),
        this.loadCases(),
        this.loadOpportunities(),
        this.loadUnreadCount(snapshot),
        this.loadInfluenceSummary(snapshot),
      ])
    }
    catch {
      this.setData(cached || this.data.state === 'ready'
        ? { message: '资料更新失败，已保留上次结果。' }
        : { state: 'error', message: '资料服务暂时不可用。' })
    }
  },

  async loadUnreadCount(snapshot: IdentityAccessSnapshot) {
    if (!snapshot.authenticated) {
      this.setData({ unreadCount: 0 })
      return
    }
    try {
      this.setData({ unreadCount: await mipMessagingModule.refreshUnreadCount() })
    }
    catch {
      this.setData({ unreadCount: mipMessagingModule.peekUnreadCount() || 0 })
    }
  },

  async loadInfluenceSummary(snapshot: IdentityAccessSnapshot) {
    if (!snapshot.authenticated) {
      this.setData({ visitorUnreadCount: 0, profileViewCount: 0 })
      return
    }
    try {
      const page = await opportunityModule.listReceived('VISITOR')
      this.setData({
        visitorUnreadCount: page.unreadCount,
        profileViewCount: page.totalViewCount ?? 0,
      })
    }
    catch {
      this.setData({ visitorUnreadCount: 0, profileViewCount: null })
    }
  },

  applyIdentity(snapshot: IdentityAccessSnapshot) {
    const membership = membershipPresentation(snapshot.membership.kind, snapshot.membership.entitlement)
    this.setData({
      state: 'ready',
      authenticated: snapshot.authenticated,
      nickname: snapshot.profile.nickname || '微信用户',
      nicknameInitial: (snapshot.profile.nickname || '微信用户').slice(0, 1),
      avatarUrl: snapshot.profile.avatarUrl || '',
      headline: snapshot.profile.headline,
      profileComplete: snapshot.profile.complete,
      membershipLabel: membership.label,
      membershipDescription: membership.description,
      membershipEndsText: membership.endsAt ? formatLocalDate(membership.endsAt) : '',
      isPlayer: membership.label === '玩家',
      adminVisible: hasCapability(snapshot.grants, 'admin:enter'),
      eventManagementVisible: canManageEvents(snapshot.grants),
      growthState: membership.label === '玩家' ? this.data.growthState : 'hidden',
      message: '',
    })
  },

  async loadBranch(snapshot: IdentityAccessSnapshot, options: { force?: boolean }) {
    const cached = mipBranchesModule.peek()
    const branchSnapshot = cached && !options.force
      ? cached
      : await mipBranchesModule.load(snapshot.primaryBranchId, snapshot.userVersion)
    const branch = branchSnapshot.branches.find(item => item.id === snapshot.primaryBranchId)
    this.setData({ primaryBranchName: branch?.name || '未选择主分会' })
  },

  async loadGrowth(snapshot: IdentityAccessSnapshot, options: { force?: boolean }) {
    if (snapshot.membership.kind !== 'PLAYER') {
      this.setData({ growthState: 'hidden' })
      return
    }
    const cached = mipGrowthModule.peekSnapshot()
    if (cached) {
      this.applyGrowth(cached)
    }
    try {
      this.applyGrowth(await mipGrowthModule.getSnapshot(options))
    }
    catch {
      if (!cached) {
        this.setData({ growthState: 'error' })
      }
    }
  },

  applyGrowth(snapshot: Awaited<ReturnType<typeof mipGrowthModule.getSnapshot>>) {
    this.setData({
      growthState: 'ready',
      levelName: snapshot.currentLevel.name,
      growthProgress: snapshot.levelProgressPercent,
      growthNextText: snapshot.nextLevel
        ? `距 ${snapshot.nextLevel.name} 还需 ${snapshot.experienceToNextLevel || 0} 经验值`
        : '已达当前最高等级',
      experience: snapshot.account.experienceBalance,
      contribution: snapshot.account.contributionBalance,
    })
  },

  async loadBadges(snapshot: IdentityAccessSnapshot) {
    if (!snapshot.authenticated) {
      this.setData({ badgeState: 'ready', equippedBadges: [] })
      return
    }
    try {
      const collection = await mipGrowthModule.listBadgeCollection()
      this.setData({
        badgeState: 'ready',
        equippedBadges: collection.items
          .filter(item => item.equippedSlot !== undefined)
          .sort((left, right) => Number(left.equippedSlot) - Number(right.equippedSlot)),
      })
    }
    catch {
      this.setData({ badgeState: 'error' })
    }
  },

  async loadCooperation() {
    if (!this.data.authenticated) {
      this.setData({ cooperationState: 'ready', cooperationCards: [] })
      return
    }
    try {
      const page = await cooperationModule.listMine()
      this.setData({
        cooperationState: 'ready',
        cooperationCards: page.items.slice(0, 3).map(item => ({
          ...item,
          roleName: cooperationRoles.find(role => role.key === item.roleKey)?.name || item.roleKey,
        })),
      })
    }
    catch {
      if (!this.data.cooperationCards.length) {
        this.setData({ cooperationState: 'error' })
      }
      else {
        this.setData({ message: '合作卡更新失败，已保留上次结果。' })
      }
    }
  },

  async loadCases() {
    if (!this.data.authenticated) {
      this.setData({ caseState: 'ready', cases: [] })
      return
    }
    try {
      const page = await superCaseModule.listMine()
      this.setData({ caseState: 'ready', cases: page.items.slice(0, 3) })
    }
    catch {
      if (!this.data.cases.length) {
        this.setData({ caseState: 'error' })
      }
      else {
        this.setData({ message: '超级案例更新失败，已保留上次结果。' })
      }
    }
  },

  async loadOpportunities() {
    if (!this.data.authenticated) {
      this.setData({ opportunityState: 'ready', opportunities: [] })
      return
    }
    try {
      const page = await opportunityModule.listMine()
      this.setData({ opportunityState: 'ready', opportunities: page.items.slice(0, 3) })
    }
    catch {
      if (!this.data.opportunities.length) {
        this.setData({ opportunityState: 'error' })
      }
      else {
        this.setData({ message: '机会更新失败，已保留上次结果。' })
      }
    }
  },

  async onPullDownRefresh() {
    try {
      await this.loadProfile({ force: true })
    }
    finally {
      wx.stopPullDownRefresh()
    }
  },

  changePortfolioTab(event: WechatMiniprogram.TouchEvent) {
    const tab = String(event.currentTarget.dataset.tab || '') as PortfolioTab
    if (['cooperation', 'cases', 'opportunities'].includes(tab)) {
      this.setData({ portfolioTab: tab })
    }
  },

  async openProtected(destination: string, action: ProtectedActionKey, requiredCapability?: string) {
    this.resumeDestination = destination
    try {
      const session = await mipIdentityModule.beginProtectedAction({
        action,
        requiredCapability,
        source: { navigation: 'navigateBack' },
      })
      if (session.decision.ready) {
        this.resumeDestination = ''
        caseNavigateTo({ url: destination })
        return
      }
      caseNavigateTo({ url: mipAccessPageUrl(session.token) })
    }
    catch {
      this.resumeDestination = ''
      this.setData({ message: '身份状态暂时无法确认，请稍后重试。' })
    }
  },

  openMembership() { caseNavigateTo({ url: '/pages/membership/index' }) },
  openProfileEdit() { void this.openProtected('/packages/member/mip-profile/index', 'EDIT_PROFILE') },
  openMemberCard() { void this.openProtected('/packages/member/mip-card/index', 'VIEW_RESTRICTED_PROFILE') },
  openDigitalAvatar() { void this.openProtected('/packages/member/mip-avatar/index', 'EDIT_PROFILE') },
  openBranches() { caseNavigateTo({ url: '/packages/member/mip-branches/index' }) },
  openRegistrations() { void this.openProtected('/packages/member/mip-events/mine/index', 'INTERACT') },
  openOrders() { void this.openProtected('/packages/member/orders/index', 'VIEW_RESTRICTED_PROFILE') },
  openNotifications() { void this.openProtected('/packages/member/mip-notifications/index', 'INTERACT') },
  openReceivedInteractions() { void this.openProtected('/packages/member/mip-received/index', 'INTERACT') },
  openHeartHistory() { void this.openProtected('/packages/member/mip-hearts/index', 'INTERACT') },
  openGrowth() { void this.openProtected('/packages/member/mip-growth/index', 'VIEW_RESTRICTED_PROFILE') },
  openBadges() { void this.openProtected('/packages/member/mip-badges/index', 'VIEW_RESTRICTED_PROFILE') },
  openGame() { void this.openProtected('/packages/member/mip-game/index', 'VIEW_RESTRICTED_PROFILE') },
  openAiDrafts() { void this.openProtected('/packages/member/mip-ai/index', 'EDIT_PROFILE') },
  openCooperationList() { void this.openProtected('/packages/member/mip-cooperation/list/index?mine=1', 'INTERACT') },
  openCaseList() { void this.openProtected('/packages/member/mip-cases/list/index?mine=1', 'INTERACT') },
  openOpportunityList() { void this.openProtected('/packages/member/mip-opportunities/mine/index', 'INTERACT') },
  openBenefits() { caseNavigateTo({ url: '/packages/member/benefits/index' }) },
  openPrivacy() { caseNavigateTo({ url: '/packages/member/privacy/index' }) },
  openHelp() { caseNavigateTo({ url: '/packages/member/help/index' }) },
  openAbout() { caseNavigateTo({ url: '/packages/member/about/index' }) },

  openCooperation(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id || '')
    if (id) {
      caseNavigateTo({ url: `/packages/member/mip-cooperation/detail/index?id=${encodeURIComponent(id)}` })
    }
  },

  openCase(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id || '')
    if (id) {
      caseNavigateTo({ url: `/packages/member/mip-cases/detail/index?id=${encodeURIComponent(id)}` })
    }
  },

  openOpportunity(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id || '')
    if (id) {
      caseNavigateTo({ url: `/packages/member/mip-opportunities/detail/index?id=${encodeURIComponent(id)}` })
    }
  },

  openManagedEvents() {
    if (this.data.eventManagementVisible) {
      void this.openProtected('/packages/admin/managed-events/index', 'ENTER_ADMIN', 'admin:enter')
    }
  },

  openAdmin() {
    if (this.data.adminVisible) {
      void this.openProtected('/packages/admin/dashboard/index', 'ENTER_ADMIN', 'admin:enter')
    }
  },
})
