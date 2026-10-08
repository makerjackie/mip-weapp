import type { SuperCaseSummary } from '../../modules/mip-cases'
import type { CooperationCardSummary } from '../../modules/mip-cooperation'
import type { BadgeCollectionItem } from '../../modules/mip-growth'
import type {
  AccessRequirement,
  IdentityAccessSnapshot,
  MipGuestLoginProceedContext,
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
import { createMipGuestLoginFlow, evaluateAccess } from '../../modules/mip-identity'
import { mipBranchesModule, mipIdentityModule } from '../../modules/mip-identity/client'
import { mipMessagingModule } from '../../modules/mip-messaging/client'
import { opportunityModule, opportunityTypeLabel } from '../../modules/mip-opportunities'
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
  /** MIW-55 figma 3675:6828：卡片左下机会类型黄标（找资源/找伙伴）。 */
  typeTagViews: Array<{ key: string, label: string }>
}

/** MIW-55：发布/想合作两份清单共用卡片视图模型（头像保底数组 + 机会类型黄标）。 */
function presentOpportunityCard(item: OpportunitySummary): OpportunityCardView {
  return {
    ...item,
    avatarViews: Array.isArray(item.avatars) ? item.avatars.filter(v => typeof v === 'string' && v) : [],
    typeTagViews: (item.typeKeys || []).map(key => ({ key, label: opportunityTypeLabel(key) })),
  }
}

/** MIW-54（2026-10-08）：弹窗标题带对象类型、内容带卡片标识——同栏多张卡时用户才能确认长按删的是哪一张。 */
function portfolioItemLabel(item: CooperationCardView | CaseView | OpportunityCardView, tab: PortfolioTab): string {
  if (tab === 'cooperation' && 'roleName' in item) {
    // 同角色可有多张卡，positioning 才是区分它们的行。
    return item.positioning ? `${item.roleName} · ${item.positioning}` : item.roleName
  }
  if (tab === 'cases' && 'projectName' in item) {
    return item.projectName
  }
  return 'title' in item ? item.title : ''
}

function portfolioDeleteContent(item: CooperationCardView | CaseView | OpportunityCardView, tab: PortfolioTab): string {
  const label = portfolioItemLabel(item, tab).trim()
  const name = label.length > 16 ? `${label.slice(0, 16)}…` : label
  return name ? `「${name}」删除后将无法恢复，是否删除？` : '删除后将无法恢复，是否删除？'
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
    levelBannerText: '',
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
    loginSheetOpen: false,
    loginSheetBusy: false,
    loginSheetRestoreFirst: false,
  },
  authToken: '',
  resumeDestination: '',
  loadPromise: null as Promise<void> | null,
  lastSuccessfulRefreshAt: 0,
  refreshOnReturn: false,
  openingActionLock: false,
  guestLoginFlow: null as ReturnType<typeof createMipGuestLoginFlow> | null,
  // 删除成功后，丢弃此前开始的该类列表读取，防止已删内容重新出现。
  portfolioVersions: { cooperation: 0, cases: 0, opportunities: 0 },

  /** 通用游客登录引导（src/modules/mip-identity/guest-login-flow.ts）的本页接入点。 */
  requireGuestLoginFlow() {
    if (!this.guestLoginFlow) {
      this.guestLoginFlow = createMipGuestLoginFlow({
        route: 'pages/profile/index',
        getAuthToken: () => this.authToken,
        setAuthToken: (token: string) => { this.authToken = token },
        isSheetActive: () => this.data.loginSheetOpen || this.data.loginSheetBusy,
        setSheetState: state => this.setData(state),
        proceed: context => this.proceedGuestLogin(context),
        noticeUnavailable: (message: string) => wx.showToast({ title: message, icon: 'none' }),
        onAbandon: () => this.loadProfile({ force: true }),
      }, mipIdentityModule)
    }
    return this.guestLoginFlow
  },

  /** 身份就绪后继续登录前的原目的地；无目的地时按「回到我的页」强制刷新。 */
  proceedGuestLogin({ resume }: MipGuestLoginProceedContext) {
    const destination = resume?.source.query?.destination || this.resumeDestination
    this.resumeDestination = ''
    if (destination) {
      caseNavigateTo({ url: destination })
      return
    }
    return this.loadProfile({ force: true })
  },

  async onShow() {
    syncCaseNavigation(this, 'pages/profile/index')
    this.openingActionLock = false
    if (this.data.openingAction) {
      this.setData({ openingAction: '' })
    }
    if (this.data.loginSheetOpen || this.data.loginSheetBusy) {
      return
    }
    if (this.authToken) {
      void this.resumeLogin()
      return
    }
    if (await this.requireGuestLoginFlow().resume() === 'resumed') {
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
      await this.loadPromise
      if (!options.force) {
        return
      }
      // Login may finish while anonymous sections are still loading. Force a fresh identity read.
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
    // 等级序号按等级表位置推导，与 packages/member/mip-growth 的 growthPresentation 同规则；
    // 横幅与昵称旁徽标统一展示 Lv.数字（设计稿 level-banner-mine.png），等级名不在我的页露出。
    const currentIndex = snapshot.levels.findIndex(level => level.id === snapshot.currentLevel.id)
    this.setData({
      growthState: 'ready',
      levelBannerText: `Lv.${Math.max(1, currentIndex + 1)}`,
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
    const version = this.portfolioVersions.cooperation
    try {
      const page = await cooperationModule.listMine()
      if (version !== this.portfolioVersions.cooperation) {
        return
      }
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
      if (version !== this.portfolioVersions.cooperation) {
        return
      }
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
    const version = this.portfolioVersions.cases
    try {
      const page = await superCaseModule.listMine()
      if (version !== this.portfolioVersions.cases) {
        return
      }
      this.setData({ caseState: 'ready', cases: page.items.map(presentCase), caseCursor: page.nextCursor || '' })
    }
    catch {
      if (version !== this.portfolioVersions.cases) {
        return
      }
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
    const version = this.portfolioVersions.opportunities
    try {
      const page = await opportunityModule.listMine()
      if (version !== this.portfolioVersions.opportunities) {
        return
      }
      // 保底数组：非数组（含 null/对象/字符串）与非法元素一律丢弃，杜绝卡片属性收到 non-array 告警。
      const opportunities: OpportunityCardView[] = page.items.map(presentOpportunityCard)
      this.setData({ opportunityState: 'ready', opportunities, opportunityCursor: page.nextCursor || '' })
    }
    catch {
      if (version !== this.portfolioVersions.opportunities) {
        return
      }
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
    const version = this.portfolioVersions.opportunities
    try {
      const page = await opportunityModule.listMyCooperations()
      if (version !== this.portfolioVersions.opportunities) {
        return
      }
      this.setData({
        collaborationOpportunityState: 'ready',
        collaborationOpportunities: page.items.map(presentOpportunityCard),
        collaborationOpportunityCursor: page.nextCursor || '',
      })
    }
    catch {
      if (version !== this.portfolioVersions.opportunities) {
        return
      }
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
    const version = this.portfolioVersions[tab]
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
        if (version !== this.portfolioVersions[tab]) {
          return
        }
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
        if (version !== this.portfolioVersions[tab]) {
          return
        }
        const ids = new Set(this.data.cases.map(item => item.id))
        this.setData({ cases: [...this.data.cases, ...page.items.filter(item => !ids.has(item.id)).map(presentCase)], caseCursor: page.nextCursor || '' })
      }
      else if (this.data.opportunitySubTab === 'COOPERATING') {
        const page = await opportunityModule.listMyCooperations(cursor)
        if (version !== this.portfolioVersions[tab]) {
          return
        }
        const ids = new Set(this.data.collaborationOpportunities.map(item => item.id))
        this.setData({
          collaborationOpportunities: [...this.data.collaborationOpportunities, ...page.items.filter(item => !ids.has(item.id)).map(presentOpportunityCard)],
          collaborationOpportunityCursor: page.nextCursor || '',
        })
      }
      else {
        const page = await opportunityModule.listMine(cursor)
        if (version !== this.portfolioVersions[tab]) {
          return
        }
        const ids = new Set(this.data.opportunities.map(item => item.id))
        this.setData({
          opportunities: [...this.data.opportunities, ...page.items.filter(item => !ids.has(item.id)).map(presentOpportunityCard)],
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

  /** 受保护入口：引导骨架在通用 guest-login-flow，本页保留打开锁与快路径语义。 */
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
    const intent: ProtectedActionIntent = {
      action,
      requiredCapability,
      requirements: this.data.authenticated ? requirements : ['AUTHENTICATED', 'AGREEMENTS', 'PHONE', 'PROFILE'],
      source: { navigation: 'navigateBack', route: '/pages/profile/index', query: { destination } },
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
    const result = await this.requireGuestLoginFlow().begin(intent)
    if (result.outcome === 'ready') {
      this.resumeDestination = ''
      this.openingActionLock = false
      this.setData({ openingAction: '' })
      if (destination) {
        caseNavigateTo({ url: destination })
      }
      else {
        await this.loadProfile({ force: true })
      }
      return
    }
    if (result.outcome === 'sheet') {
      this.openingActionLock = false
      this.setData({ openingAction: '' })
      return
    }
    if (result.outcome === 'unavailable') {
      this.openingActionLock = false
      this.resumeDestination = ''
      this.setData({ openingAction: '', message: '身份状态暂时无法确认，请稍后重试。' })
    }
  },

  onLoginSheetPhone(event: WechatMiniprogram.CustomEvent<{ code?: string, errMsg?: string }>) {
    return this.requireGuestLoginFlow().phone(event)
  },

  onLoginSheetSignIn() {
    return this.requireGuestLoginFlow().signIn()
  },

  resumeLogin() {
    return this.requireGuestLoginFlow().resume()
  },

  onLoginSheetDismiss() {
    if (this.data.loginSheetBusy) {
      return
    }
    this.requireGuestLoginFlow().dismiss()
    this.resumeDestination = ''
    this.openingActionLock = false
    this.setData({ openingAction: '' })
  },

  openMembership() { caseNavigateTo({ url: '/pages/membership/index' }) },
  openLogin() { void this.openProtected('', 'EDIT_PROFILE') },
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
  openCaseEditor() { void this.openProtected('/packages/member/mip-cases/editor/index', 'INTERACT') },
  openOpportunityEditor() { void this.openProtected('/packages/member/mip-opportunities/editor/index', 'INTERACT') },
  /** J5-01/J1-08：设置入口（账号设置口径，WS-SETTINGS 承接页面内容）；游客点击先过登录门禁（六入口口径）。 */
  openSettings() { void this.openProtected('/packages/member/privacy/index', 'EDIT_PROFILE') },
  openNotifications() { void this.openProtected('/packages/member/mip-notifications/index', 'INTERACT') },
  openBranches() { caseNavigateTo({ url: '/packages/member/mip-branches/index' }) },

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
    this.setData({ removingPortfolioId: id })
    const confirmation = await wx.showModal({
      title: tab === 'cooperation'
        ? '删除合作卡'
        : tab === 'cases'
          ? '删除超级案例'
          : '删除机会',
      content: portfolioDeleteContent(item, tab),
      confirmText: '删除',
      confirmColor: '#FF4D5E',
    }).catch(() => null)
    if (!confirmation?.confirm) {
      this.setData({ removingPortfolioId: '' })
      return
    }
    try {
      if (tab === 'cooperation') {
        const card = this.data.cooperationCards.find(entry => entry.id === id)
        if (!card) {
          return
        }
        const version = Number.isInteger(card.version) ? Number(card.version) : (await cooperationModule.get(card.id)).version
        await cooperationModule.archive(card.id, version)
        this.portfolioVersions[tab] += 1
        this.setData({ cooperationCards: this.data.cooperationCards.filter(entry => entry.id !== id) })
      }
      else if (tab === 'cases') {
        const card = this.data.cases.find(entry => entry.id === id)
        if (!card) {
          return
        }
        const version = Number.isInteger(card.version) ? Number(card.version) : (await superCaseModule.get(card.id)).version
        await superCaseModule.archive(card.id, version)
        this.portfolioVersions[tab] += 1
        this.setData({ cases: this.data.cases.filter(entry => entry.id !== id) })
      }
      else {
        const card = this.data.opportunities.find(entry => entry.id === id)
        if (!card) {
          return
        }
        const version = (await opportunityModule.get(card.id)).version
        await opportunityModule.remove(card.id, version)
        this.portfolioVersions[tab] += 1
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
