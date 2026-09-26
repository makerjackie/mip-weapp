import type { SuperCaseSummary } from '../../modules/mip-cases'
import type { CooperationCardSummary } from '../../modules/mip-cooperation'
import type { BadgeCollectionItem } from '../../modules/mip-growth'
import type {
  AccessRequirement,
  IdentityAccessSnapshot,
  ProtectedActionIntent,
  ProtectedActionKey,
} from '../../modules/mip-identity'
import type { OpportunitySummary } from '../../modules/mip-opportunities'
import { badgeArtUrl } from '../../config/mip-badge-art'
import { cooperationRoles } from '../../config/mip-catalogs'
import { superCaseModule } from '../../modules/mip-cases'
import { cooperationModule } from '../../modules/mip-cooperation'
import { mipEventsModule } from '../../modules/mip-events/client'
import { mipGrowthModule } from '../../modules/mip-growth/client'
import { evaluateAccess, mipAccessPageUrl } from '../../modules/mip-identity'
import { mipBranchesModule, mipIdentityModule } from '../../modules/mip-identity/client'
import { mipMessagingModule } from '../../modules/mip-messaging/client'
import { opportunityModule } from '../../modules/mip-opportunities'
import { canManageEvents, hasCapability, membershipPresentation } from '../../modules/mip-shell'
import { getLoadingDiagnostics, recordLoadingFailure } from '../../platform/cloudbase/loading-diagnostics'
import { caseNavigateTo, syncCaseNavigation } from '../../platform/navigation/client'
import { formatLocalDate } from '../../utils/date'

type PortfolioTab = 'cooperation' | 'cases' | 'opportunities'
type OpportunitySubTab = 'PUBLISHED' | 'COOPERATING'
type SectionState = 'loading' | 'ready' | 'error'
type OpeningAction = '' | 'cooperation-editor' | 'other'

const PROFILE_REFRESH_INTERVAL_MS = 30_000

interface CooperationCardView extends CooperationCardSummary {
  roleName: string
}

interface CaseView extends SuperCaseSummary {
  monthLabel: string
}

function presentCase(item: SuperCaseSummary): CaseView {
  const date = formatLocalDate(item.publishedAt)
  const [year, month] = date.split('-')
  return {
    ...item,
    monthLabel: year && month ? `${year}年 ${Number(month)}月` : '未发布',
  }
}

interface OpportunityCardView extends OpportunitySummary {
  /** 运行时验收（2026-09-22）：服务端 avatars 形状不可信，presenter 保底数组后才绑给卡片 type: Array 属性。 */
  avatarViews: string[]
}

Page({
  copyLoadingDiagnostics() {
    wx.setClipboardData({
      data: JSON.stringify({ format: 1, page: 'profile', collectedAt: new Date().toISOString(), samples: getLoadingDiagnostics() }),
      fail: () => wx.showToast({ title: '复制失败，请重试', icon: 'none' }),
    })
  },
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
    growthState: 'loading' as 'hidden' | SectionState,
    levelName: '',
    growthProgress: 0,
    growthNextText: '',
    experience: 0,
    growthTarget: 0,
    growthFillPx: 0,
    contribution: 0,
    badgeState: 'loading' as SectionState,
    equippedBadges: [] as BadgeCollectionItem[],
    primaryBadge: null as BadgeCollectionItem | null,
    guestCount: null as number | null,
    interactionCount: null as number | null,
    interestCount: null as number | null,
    interestUnreadCount: 0,
    visitorUnreadCount: 0,
    visitorCount: null as number | null,
    notificationUnreadCount: 0,
    portfolioTab: 'cooperation' as PortfolioTab,
    // ui-fidelity fixture 开关：默认走生产布局（被 vitest pin）。
    figmaLayout: false,
    cooperationState: 'loading' as SectionState,
    cooperationCards: [] as CooperationCardView[],
    cooperationCursor: '',
    caseState: 'loading' as SectionState,
    cases: [] as CaseView[],
    caseCursor: '',
    opportunityState: 'loading' as SectionState,
    opportunities: [] as OpportunityCardView[],
    opportunityCursor: '',
    opportunitySubTab: 'PUBLISHED' as OpportunitySubTab,
    collaborationOpportunityState: 'loading' as SectionState,
    collaborationOpportunities: [] as OpportunityCardView[],
    collaborationOpportunityCursor: '',
    loadingMorePortfolio: false,
    removingPortfolioId: '',
    openingAction: '' as OpeningAction,
    message: '',
  },
  resumeDestination: '',
  loadPromise: null as Promise<void> | null,
  lastSuccessfulRefreshAt: 0,
  refreshOnReturn: false,
  openingActionLock: false,

  onShow() {
    syncCaseNavigation(this, 'pages/profile/index')
    this.openingActionLock = false
    if (this.data.openingAction) {
      this.setData({ openingAction: '' })
    }
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
    const shouldForceRefresh = this.refreshOnReturn
    const refreshIsDue = Date.now() - this.lastSuccessfulRefreshAt >= PROFILE_REFRESH_INTERVAL_MS
    if (!shouldForceRefresh && this.data.state === 'ready' && !refreshIsDue) {
      const unreadCount = mipMessagingModule.peekUnreadCount()
      if (unreadCount !== undefined) {
        this.setData({ notificationUnreadCount: unreadCount })
      }
      return
    }
    this.refreshOnReturn = false
    void this.loadProfile({ force: shouldForceRefresh })
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
      // Identity is cached by the app shell. Reveal the existing page immediately while
      // the remaining profile sections revalidate in the background.
      if (!hasRenderedContent) {
        this.setData({ state: 'ready', initialSectionsState: 'loading' })
      }
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
    catch (error) {
      recordLoadingFailure('identity.response', error)
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
    this.setData({ state: 'ready', initialSectionsState: 'loading' })
    const collaborationOpportunitiesRequest = this.data.opportunitySubTab === 'COOPERATING'
      ? this.loadCollaborationOpportunities()
      : Promise.resolve()
    const sectionResults = await Promise.allSettled([
      this.loadBranch(snapshot, options),
      this.loadIndustry(snapshot),
      this.loadGrowth(snapshot, options),
      this.loadBadges(snapshot),
      this.loadCooperation(),
      this.loadCases(),
      this.loadOpportunities(),
      collaborationOpportunitiesRequest,
      this.loadInfluenceSummary(snapshot),
      this.loadNotificationUnread(snapshot, options),
    ])
    const hasUnexpectedSectionFailure = sectionResults.some(result => result.status === 'rejected')
    this.setData({
      state: 'ready',
      initialSectionsState: 'ready',
      message: hasUnexpectedSectionFailure ? '部分资料暂时无法加载，请稍后重试。' : this.data.message,
    })
    this.lastSuccessfulRefreshAt = Date.now()
  },

  async loadInfluenceSummary(snapshot: IdentityAccessSnapshot) {
    if (!snapshot.authenticated) {
      this.setData({
        guestCount: null,
        interactionCount: null,
        interestCount: null,
        visitorCount: null,
        interestUnreadCount: 0,
        visitorUnreadCount: 0,
      })
      return
    }
    const [summaryResult, visitorResult, interestResult] = await Promise.allSettled([
      opportunityModule.getProfileInfluence(),
      opportunityModule.listReceived('VISITOR'),
      // journey-review J3-04：心动值与访客两卡都有未读红点（M1 00:35:58），进入列表后清除。
      mipEventsModule.listHeartHistory('RECEIVED'),
    ])
    const updates: Partial<typeof this.data> = {}
    if (summaryResult.status === 'fulfilled') {
      const summary = summaryResult.value
      Object.assign(updates, {
        guestCount: summary.guestCount,
        interactionCount: summary.interactionCount,
        visitorCount: summary.visitorCount,
      })
    }
    if (visitorResult.status === 'fulfilled') {
      updates.visitorUnreadCount = visitorResult.value.unreadCount
    }
    if (interestResult.status === 'fulfilled') {
      updates.interestCount = interestResult.value.totalCount ?? null
      updates.interestUnreadCount = interestResult.value.unreadCount || 0
    }
    if (summaryResult.status === 'rejected' || visitorResult.status === 'rejected' || interestResult.status === 'rejected') {
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
      adminVisible: hasCapability(snapshot.grants, 'admin:enter') || canManageEvents(snapshot.grants),
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
      growthTarget: snapshot.account.experienceBalance + (snapshot.experienceToNextLevel || 0),
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
            imageUrl: badgeArtUrl(equippedBadges[0].imageUrl, equippedBadges[0].key, equippedBadges[0].name),
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
        cooperationCards: page.items.map(item => ({
          ...item,
          roleName: cooperationRoles.find(role => role.key === item.roleKey)?.name || item.roleKey,
        })),
        cooperationCursor: page.nextCursor || '',
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
      this.setData({ caseState: 'ready', cases: page.items.map(presentCase), caseCursor: page.nextCursor || '' })
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
      // 保底数组：非数组（含 null/对象/字符串）与非法元素一律丢弃，杜绝卡片属性收到 non-array 告警。
      const opportunities: OpportunityCardView[] = page.items.map(item => ({
        ...item,
        avatarViews: Array.isArray(item.avatars) ? item.avatars.filter(v => typeof v === 'string' && v) : [],
      }))
      this.setData({ opportunityState: 'ready', opportunities, opportunityCursor: page.nextCursor || '' })
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

  async loadCollaborationOpportunities() {
    if (!this.data.authenticated) {
      this.setData({ collaborationOpportunityState: 'ready', collaborationOpportunities: [], collaborationOpportunityCursor: '' })
      return
    }
    try {
      const page = await opportunityModule.listMyCooperations()
      this.setData({
        collaborationOpportunityState: 'ready',
        collaborationOpportunities: page.items.map(item => ({ ...item, avatarViews: Array.isArray(item.avatars) ? item.avatars.filter(value => typeof value === 'string' && value) : [] })),
        collaborationOpportunityCursor: page.nextCursor || '',
      })
    }
    catch {
      this.setData(this.data.collaborationOpportunities.length
        ? { message: '合作意向更新失败，已保留上次结果。' }
        : { collaborationOpportunityState: 'error' })
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

  changeOpportunitySubTab(event: WechatMiniprogram.TouchEvent) {
    const tab = String(event.currentTarget.dataset.tab || '') as OpportunitySubTab
    if (tab !== 'PUBLISHED' && tab !== 'COOPERATING') {
      return
    }
    this.setData({ opportunitySubTab: tab })
    if (tab === 'COOPERATING' && this.data.collaborationOpportunityState === 'loading') {
      void this.loadCollaborationOpportunities()
    }
  },

  async loadMorePortfolio() {
    if (this.data.loadingMorePortfolio) {
      return
    }
    const tab = this.data.portfolioTab
    const cursor = tab === 'cooperation'
      ? this.data.cooperationCursor
      : tab === 'cases'
        ? this.data.caseCursor
        : this.data.opportunitySubTab === 'COOPERATING'
          ? this.data.collaborationOpportunityCursor
          : this.data.opportunityCursor
    if (!cursor) {
      return
    }
    this.setData({ loadingMorePortfolio: true })
    try {
      if (tab === 'cooperation') {
        const page = await cooperationModule.listMine(cursor)
        const ids = new Set(this.data.cooperationCards.map(item => item.id))
        this.setData({
          cooperationCards: [...this.data.cooperationCards, ...page.items.filter(item => !ids.has(item.id)).map(item => ({
            ...item,
            roleName: cooperationRoles.find(role => role.key === item.roleKey)?.name || item.roleKey,
          }))],
          cooperationCursor: page.nextCursor || '',
        })
      }
      else if (tab === 'cases') {
        const page = await superCaseModule.listMine(cursor)
        const ids = new Set(this.data.cases.map(item => item.id))
        this.setData({ cases: [...this.data.cases, ...page.items.filter(item => !ids.has(item.id)).map(presentCase)], caseCursor: page.nextCursor || '' })
      }
      else if (this.data.opportunitySubTab === 'COOPERATING') {
        const page = await opportunityModule.listMyCooperations(cursor)
        const ids = new Set(this.data.collaborationOpportunities.map(item => item.id))
        this.setData({
          collaborationOpportunities: [...this.data.collaborationOpportunities, ...page.items.filter(item => !ids.has(item.id)).map(item => ({ ...item, avatarViews: Array.isArray(item.avatars) ? item.avatars.filter(value => typeof value === 'string' && value) : [] }))],
          collaborationOpportunityCursor: page.nextCursor || '',
        })
      }
      else {
        const page = await opportunityModule.listMine(cursor)
        const ids = new Set(this.data.opportunities.map(item => item.id))
        this.setData({
          opportunities: [...this.data.opportunities, ...page.items.filter(item => !ids.has(item.id)).map(item => ({
            ...item,
            avatarViews: Array.isArray(item.avatars) ? item.avatars.filter(v => typeof v === 'string' && v) : [],
          }))],
          opportunityCursor: page.nextCursor || '',
        })
      }
    }
    catch {
      wx.showToast({ title: '加载更多失败，请重试', icon: 'none' })
    }
    finally {
      this.setData({ loadingMorePortfolio: false })
    }
  },

  async openProtected(
    destination: string,
    action: ProtectedActionKey,
    requiredCapability?: string,
    openingAction: Exclude<OpeningAction, ''> = 'other',
    requirements?: AccessRequirement[],
  ) {
    if (this.openingActionLock || this.data.openingAction) {
      return
    }
    this.openingActionLock = true
    this.setData({ openingAction })
    this.refreshOnReturn = true
    this.resumeDestination = destination
    try {
      const intent: ProtectedActionIntent = {
        action,
        requiredCapability,
        requirements,
        source: { navigation: 'navigateBack' },
      }
      const accessSnapshotFresh = this.lastSuccessfulRefreshAt > 0
        && Date.now() - this.lastSuccessfulRefreshAt < PROFILE_REFRESH_INTERVAL_MS
      if (openingAction === 'cooperation-editor' && accessSnapshotFresh) {
        const cached = mipIdentityModule.peekSnapshot()
        if (cached && evaluateAccess(cached, intent).ready) {
          this.resumeDestination = ''
          caseNavigateTo({ url: destination })
          return
        }
      }
      const session = await mipIdentityModule.beginProtectedAction(intent)
      if (session.decision.ready) {
        this.resumeDestination = ''
        caseNavigateTo({ url: destination })
        return
      }
      caseNavigateTo({ url: mipAccessPageUrl(session.token) })
    }
    catch {
      this.openingActionLock = false
      this.resumeDestination = ''
      this.setData({ openingAction: '', message: '身份状态暂时无法确认，请稍后重试。' })
    }
  },

  openMembership() { caseNavigateTo({ url: '/pages/membership/index' }) },
  openLogin() { void this.openProtected('/packages/member/mip-profile/index', 'EDIT_PROFILE') },
  openProfileEdit() { void this.openProtected('/packages/member/mip-profile/index', 'EDIT_PROFILE') },
  openMemberCard() { void this.openProtected('/packages/member/mip-card/index', 'VIEW_RESTRICTED_PROFILE') },
  openRegistrations() { void this.openProtected('/packages/member/mip-events/mine/index', 'INTERACT') },
  openOrders() { void this.openProtected('/packages/member/orders/index', 'VIEW_RESTRICTED_PROFILE') },
  openInfluenceList(event: WechatMiniprogram.TouchEvent) {
    const category = String(event.currentTarget.dataset.category || '')
    if (category === 'ACTIVE_INTEREST') {
      void this.openProtected('/packages/member/mip-hearts/index', 'INTERACT')
      return
    }
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
  openStat(event: WechatMiniprogram.CustomEvent<{ label: string }>) {
    const label = String(event.detail.label || '')
    if (label === '心动值') {
      void this.openProtected('/packages/member/mip-hearts/index', 'INTERACT')
      return
    }
    if (label === '访客') {
      this.openReceivedInteractions()
      return
    }
    const category = ({ 嘉宾: 'GUEST', 互动过: 'INTERACTION', 心动值: 'ACTIVE_INTEREST' } as Record<string, string>)[label]
    if (category) {
      this.openInfluenceList({ currentTarget: { dataset: { category } } } as unknown as WechatMiniprogram.TouchEvent)
    }
  },
  openGrowth() { void this.openProtected('/packages/member/mip-growth/index', 'VIEW_RESTRICTED_PROFILE') },
  openBadges() { void this.openProtected('/packages/member/mip-badges/index', 'VIEW_RESTRICTED_PROFILE') },
  openTasks() { void this.openProtected('/packages/member/mip-tasks/index', 'VIEW_RESTRICTED_PROFILE') },
  openCooperationEditor() {
    void this.openProtected(
      '/packages/member/mip-cooperation/editor/index',
      'INTERACT',
      undefined,
      'cooperation-editor',
      ['AUTHENTICATED', 'AGREEMENTS'],
    )
  },
  openCaseList() { void this.openProtected('/packages/member/mip-cases/list/index?mine=1', 'INTERACT') },
  openCaseEditor() { void this.openProtected('/packages/member/mip-cases/editor/index', 'INTERACT') },
  openOpportunityEditor() { void this.openProtected('/packages/member/mip-opportunities/editor/index', 'INTERACT') },
  /** J5-01/J1-08：设置入口（账号设置口径，WS-SETTINGS 承接页面内容）；游客点击先过登录门禁（六入口口径）。 */
  openSettings() { void this.openProtected('/packages/member/privacy/index', 'EDIT_PROFILE') },
  openNotifications() { void this.openProtected('/packages/member/mip-notifications/index', 'INTERACT') },
  openGame() { void this.openProtected('/packages/member/mip-game/index', 'VIEW_RESTRICTED_PROFILE') },
  openBranches() { caseNavigateTo({ url: '/packages/member/mip-branches/index' }) },
  openHelp() { caseNavigateTo({ url: '/packages/member/help/index' }) },

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

  deleteCooperationCard(event: WechatMiniprogram.TouchEvent) {
    void this.deletePortfolioItem('cooperation', String(event.currentTarget.dataset.id || ''))
  },

  deleteCase(event: WechatMiniprogram.TouchEvent) {
    void this.deletePortfolioItem('cases', String(event.currentTarget.dataset.id || ''))
  },

  deleteOpportunity(event: WechatMiniprogram.TouchEvent) {
    void this.deletePortfolioItem('opportunities', String(event.currentTarget.dataset.id || ''))
  },

  /** J6-01~03：三个本人档案 tab 在卡片原位长按删除，复用各域现有归档契约。 */
  async deletePortfolioItem(tab: PortfolioTab, id: string) {
    if (!id || this.data.removingPortfolioId) {
      return
    }
    const item = tab === 'cooperation'
      ? this.data.cooperationCards.find(card => card.id === id)
      : tab === 'cases'
        ? this.data.cases.find(card => card.id === id)
        : this.data.opportunities.find(card => card.id === id)
    if (!item?.mine) {
      return
    }
    const confirmation = await wx.showModal({
      title: '删除提示',
      content: '删除后将无法恢复，是否删除？',
      confirmText: '删除',
      confirmColor: '#FF4D5E',
    })
    if (!confirmation.confirm || this.data.removingPortfolioId) {
      return
    }
    this.setData({ removingPortfolioId: id })
    try {
      if (tab === 'cooperation') {
        const card = this.data.cooperationCards.find(entry => entry.id === id)
        if (!card) {
          return
        }
        const version = Number.isInteger(card.version) ? Number(card.version) : (await cooperationModule.get(card.id)).version
        await cooperationModule.archive(card.id, version)
        this.setData({ cooperationCards: this.data.cooperationCards.filter(entry => entry.id !== id) })
      }
      else if (tab === 'cases') {
        const card = this.data.cases.find(entry => entry.id === id)
        if (!card) {
          return
        }
        const version = Number.isInteger(card.version) ? Number(card.version) : (await superCaseModule.get(card.id)).version
        await superCaseModule.archive(card.id, version)
        this.setData({ cases: this.data.cases.filter(entry => entry.id !== id) })
      }
      else {
        const card = this.data.opportunities.find(entry => entry.id === id)
        if (!card) {
          return
        }
        const version = (await opportunityModule.get(card.id)).version
        await opportunityModule.remove(card.id, version)
        this.setData({ opportunities: this.data.opportunities.filter(entry => entry.id !== id) })
      }
      this.refreshOnReturn = true
      wx.showToast({ title: '已删除', icon: 'success', duration: 1800 })
    }
    catch (error) {
      wx.showToast({ title: error instanceof Error ? error.message : '删除失败，请稍后重试', icon: 'none' })
    }
    finally {
      this.setData({ removingPortfolioId: '' })
    }
  },

  openAdmin() {
    if (this.data.adminVisible) {
      void this.openProtected('/packages/admin/dashboard/index', 'ENTER_ADMIN')
    }
  },
})
