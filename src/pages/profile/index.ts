import type { SuperCaseSummary } from '../../modules/mip-cases'
import type { CooperationCardSummary } from '../../modules/mip-cooperation'
import type { BadgeCollectionItem } from '../../modules/mip-growth'
import type { IdentityAccessSnapshot, ProtectedActionKey } from '../../modules/mip-identity'
import type { OpportunitySummary } from '../../modules/mip-opportunities'
import { badgeArtFallback } from '../../config/mip-badge-art'
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
    identityState: 'loading' as 'loading' | 'ready' | 'error',
    initialSectionsState: 'loading' as 'loading' | 'ready' | 'error',
    authenticated: false,
    nickname: '微信用户',
    nicknameInitial: '微',
    avatarUrl: '',
    headline: '',
    identityStatus: '',
    profileComplete: false,
    primaryBranchName: '未选择主分会',
    primaryIndustryName: '',
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
    primaryBadge: null as BadgeCollectionItem | null,
    guestCount: null as number | null,
    interactionCount: null as number | null,
    interestCount: null as number | null,
    visitorUnreadCount: 0,
    visitorCount: null as number | null,
    notificationUnreadCount: 0,
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
  loadPromise: null as Promise<void> | null,

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
    if (this.loadPromise) {
      return
    }
    void this.loadProfile()
  },

  async loadProfile(options: { force?: boolean } = {}) {
    if (this.loadPromise) {
      return this.loadPromise
    }
    const loadPromise = this.loadProfileOnce(options)
    this.loadPromise = loadPromise
    try {
      await loadPromise
    }
    finally {
      if (this.loadPromise === loadPromise) {
        this.loadPromise = null
      }
    }
  },

  async loadProfileOnce(options: { force?: boolean } = {}) {
    const cached = mipIdentityModule.peekSnapshot()
    const hasRenderedContent = this.data.state === 'ready'
    if (hasRenderedContent) {
      this.setData({ identityState: 'loading', initialSectionsState: 'loading', message: '' })
    }
    if (cached) {
      this.applyIdentity(cached)
    }
    else if (!hasRenderedContent) {
      this.setData({
        state: 'loading',
        identityState: 'loading',
        initialSectionsState: 'loading',
        message: '',
      })
    }
    let snapshot: IdentityAccessSnapshot
    try {
      snapshot = await mipIdentityModule.loadSnapshot()
      this.applyIdentity(snapshot)
    }
    catch {
      if (!cached) {
        this.setData({
          state: 'error',
          identityState: 'error',
          initialSectionsState: 'error',
          message: '资料服务暂时不可用。',
        })
        return
      }
      snapshot = cached
      this.applyIdentity(snapshot)
      this.setData({ identityState: 'error', message: '资料更新失败，已保留上次结果。' })
    }
    const sectionResults = await Promise.allSettled([
      this.loadBranch(snapshot, options),
      this.loadIndustry(snapshot),
      this.loadGrowth(snapshot, options),
      this.loadBadges(snapshot),
      this.loadCooperation(),
      this.loadCases(),
      this.loadOpportunities(),
      this.loadInfluenceSummary(snapshot),
      this.loadNotificationUnread(snapshot, options),
    ])
    const hasUnexpectedSectionFailure = sectionResults.some(result => result.status === 'rejected')
    this.setData({
      state: 'ready',
      initialSectionsState: 'ready',
      message: hasUnexpectedSectionFailure ? '部分资料暂时无法加载，请稍后重试。' : this.data.message,
    })
  },

  async loadInfluenceSummary(snapshot: IdentityAccessSnapshot) {
    if (!snapshot.authenticated) {
      this.setData({
        guestCount: null,
        interactionCount: null,
        interestCount: null,
        visitorCount: null,
        visitorUnreadCount: 0,
      })
      return
    }
    const [summaryResult, visitorResult] = await Promise.allSettled([
      opportunityModule.getProfileInfluence(),
      opportunityModule.listReceived('VISITOR'),
    ])
    const updates: Record<string, unknown> = {}
    if (summaryResult.status === 'fulfilled') {
      const summary = summaryResult.value
      Object.assign(updates, {
        guestCount: summary.guestCount,
        interactionCount: summary.interactionCount,
        interestCount: summary.interestCount,
        visitorCount: summary.visitorCount,
      })
    }
    if (visitorResult.status === 'fulfilled') {
      updates.visitorUnreadCount = visitorResult.value.unreadCount
    }
    if (summaryResult.status === 'rejected' || visitorResult.status === 'rejected') {
      updates.message = this.data.message || '部分影响力数据暂时无法加载，请稍后重试。'
    }
    if (Object.keys(updates).length) {
      this.setData(updates)
    }
  },

  async loadNotificationUnread(
    snapshot: IdentityAccessSnapshot,
    options: { force?: boolean },
  ) {
    if (!snapshot.authenticated) {
      this.setData({ notificationUnreadCount: 0 })
      return
    }
    const cached = mipMessagingModule.peekUnreadCount()
    if (cached !== undefined) {
      this.setData({ notificationUnreadCount: cached })
    }
    try {
      const notificationUnreadCount = await mipMessagingModule.refreshUnreadCount({
        force: options.force,
      })
      this.setData({ notificationUnreadCount })
    }
    catch {
      if (cached === undefined) {
        this.setData({ notificationUnreadCount: 0 })
      }
    }
  },

  applyIdentity(snapshot: IdentityAccessSnapshot) {
    const membership = membershipPresentation(snapshot.membership.kind, snapshot.membership.entitlement)
    const isPlayer = snapshot.membership.kind === 'PLAYER'
    this.setData({
      identityState: 'ready',
      authenticated: snapshot.authenticated,
      nickname: snapshot.profile.nickname || '微信用户',
      nicknameInitial: (snapshot.profile.nickname || '微信用户').slice(0, 1),
      avatarUrl: snapshot.profile.avatarUrl || '',
      headline: snapshot.profile.headline,
      identityStatus: snapshot.profile.identityStatus,
      profileComplete: snapshot.profile.complete,
      membershipLabel: membership.label,
      membershipDescription: membership.description,
      membershipEndsText: membership.endsAt ? formatLocalDate(membership.endsAt) : '',
      isPlayer,
      adminVisible: hasCapability(snapshot.grants, 'admin:enter'),
      // The workspace already surfaces every granted activity tool, so keep one clear entry point.
      eventManagementVisible: !hasCapability(snapshot.grants, 'admin:enter')
        && canManageEvents(snapshot.grants),
      growthState: isPlayer ? this.data.growthState : 'hidden',
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

  async loadIndustry(snapshot: IdentityAccessSnapshot) {
    if (!snapshot.profile.primaryIndustryTagId) {
      this.setData({ primaryIndustryName: '' })
      return
    }
    try {
      const tags = await mipIdentityModule.listProfileTags()
      const industry = tags.find(item => item.id === snapshot.profile.primaryIndustryTagId)
      this.setData({ primaryIndustryName: industry?.label || '' })
    }
    catch {
      this.setData({ message: this.data.message || '行业资料暂时无法更新，请稍后重试。' })
    }
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
      else {
        this.setData({ message: this.data.message || '成长数据暂时无法更新，请稍后重试。' })
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
      this.setData({ badgeState: 'ready', equippedBadges: [], primaryBadge: null })
      return
    }
    try {
      const collection = await mipGrowthModule.listBadgeCollection()
      const equippedBadges = collection.items
        .filter(item => item.equippedSlot !== undefined)
        .sort((left, right) => Number(left.equippedSlot) - Number(right.equippedSlot))
      const primaryBadge = equippedBadges[0]
        ? {
            ...equippedBadges[0],
            imageUrl: equippedBadges[0].imageUrl || badgeArtFallback(equippedBadges[0].key, equippedBadges[0].name),
          }
        : null
      this.setData({
        badgeState: 'ready',
        equippedBadges,
        primaryBadge,
      })
    }
    catch {
      this.setData({
        badgeState: 'error',
        message: this.data.message || '徽章数据暂时无法加载，请稍后重试。',
      })
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
  openInfluenceList(event: WechatMiniprogram.TouchEvent) {
    const category = String(event.currentTarget.dataset.category || '')
    if (!['GUEST', 'INTERACTION', 'ACTIVE_INTEREST'].includes(category)) {
      return
    }
    void this.openProtected(
      `/packages/member/mip-received/index?scope=influence&category=${category}`,
      'INTERACT',
    )
  },
  openReceivedInteractions() {
    void this.openProtected(
      '/packages/member/mip-received/index?scope=influence&category=VISITOR',
      'INTERACT',
    )
  },
  openHeartHistory() { void this.openProtected('/packages/member/mip-hearts/index', 'INTERACT') },
  openGrowth() { void this.openProtected('/packages/member/mip-growth/index', 'VIEW_RESTRICTED_PROFILE') },
  openBadges() { void this.openProtected('/packages/member/mip-badges/index', 'VIEW_RESTRICTED_PROFILE') },
  openTasks() { void this.openProtected('/packages/member/mip-tasks/index', 'VIEW_RESTRICTED_PROFILE') },
  openGame() { void this.openProtected('/packages/member/mip-game/index', 'VIEW_RESTRICTED_PROFILE') },
  openAiDrafts() { void this.openProtected('/packages/member/mip-ai/index', 'EDIT_PROFILE') },
  openMatching() { void this.openProtected('/packages/member/mip-opportunity-matching/index', 'INTERACT') },
  openOpportunitySettings() { void this.openProtected('/packages/member/mip-opportunity-settings/index', 'INTERACT') },
  openCooperationList() { void this.openProtected('/packages/member/mip-cooperation/list/index?mine=1', 'INTERACT') },
  openCaseList() { void this.openProtected('/packages/member/mip-cases/list/index?mine=1', 'INTERACT') },
  openOpportunityList() { void this.openProtected('/packages/member/mip-opportunities/mine/index', 'INTERACT') },
  openBenefits() { caseNavigateTo({ url: '/packages/member/benefits/index' }) },
  openSettings() { caseNavigateTo({ url: '/packages/member/privacy/index' }) },
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
