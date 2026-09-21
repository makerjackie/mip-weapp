import type {
  ReceivedInteraction,
  ReceivedInteractionActor,
  ReceivedInteractionCategory,
} from '../../../modules/mip-opportunities'
import { mipAccessPageUrl } from '../../../modules/mip-identity'
import { mipIdentityModule } from '../../../modules/mip-identity/client'
import { ensureProtectedPageAccess, requiresIdentityRefresh } from '../../../modules/mip-identity/protected-page-load'
import { mipMessagingModule } from '../../../modules/mip-messaging/client'
import { opportunityModule } from '../../../modules/mip-opportunities'
import { getLoadingDiagnostics, recordLoadingFailure } from '../../../platform/cloudbase/loading-diagnostics'
import { caseNavigateTo } from '../../../platform/navigation/client'
import { formatChineseMonthDayTime } from '../../../utils/date'

type PageState = 'loading' | 'ready' | 'empty' | 'error' | 'access'

interface InteractionView {
  viewKey: string
  kind: ReceivedInteraction['kind']
  messageId: string
  unread: boolean
  actorName: string
  actorInitial: string
  actorAvatarUrl: string
  actorHeadline: string
  statusText: string
  sourceText: string
  detailText: string
  note: string
  updatedText: string
  navigationUrl: string
  // journey-review J3-05/06/07/08 四列表卡片网格（participants 卡族同构）：
  // metaText = meta 行；countBadge = 右上角 ×N（GUEST=有效邀请次数，INTERACTION=已加载同场事实次数）；
  // noteText = 邀请人标注（数据=邀请人是我本人，服务端只回该口径）。
  metaText: string
  countBadge: string
  noteText: string
}

interface CategoryCache {
  loaded: boolean
  state: PageState
  items: InteractionView[]
  // INTERACTION 逐条事实（同场心动一次一条），用于客户端按人合并 ×N。
  rawItems: ReceivedInteraction[]
  nextCursor: string
  unreadCount: number
}

function createCategoryCache(): CategoryCache {
  return {
    loaded: false,
    state: 'loading',
    items: [],
    rawItems: [],
    nextCursor: '',
    unreadCount: 0,
  }
}

function cardBase(subject: { profileRef: string, nickname?: string, avatarUrl?: string, headline?: string }) {
  const actorName = subject.nickname || 'MIP 用户'
  return {
    actorName,
    actorInitial: actorName.slice(0, 1),
    actorAvatarUrl: subject.avatarUrl || '',
    actorHeadline: subject.headline || '',
    metaText: subject.headline || '',
    countBadge: '',
    noteText: '',
  }
}

function profileUrl(profileRef: string) {
  return `/packages/member/mip-public-profile/index?profileRef=${encodeURIComponent(profileRef)}`
}

// journey-review J3-05：同一嘉宾多次邀请右上角 ×N（invitationCount 为服务端口径）。
function presentGuest(item: Extract<ReceivedInteraction, { kind: 'GUEST' }>, index: number, viewerName: string): InteractionView {
  return {
    viewKey: `guest-${item.actor.profileRef}-${index}`,
    kind: item.kind,
    messageId: '',
    unread: false,
    ...cardBase(item.actor),
    statusText: '嘉宾',
    sourceText: item.event.title,
    detailText: item.invitationCount > 1
      ? `通过你的邀请参加过 ${item.invitationCount} 场活动`
      : '通过你的邀请参加活动',
    note: '',
    noteText: viewerName ? `邀请人${viewerName}` : '',
    countBadge: item.invitationCount > 1 ? `×${item.invitationCount}` : '',
    updatedText: formatChineseMonthDayTime(item.updatedAt),
    navigationUrl: profileUrl(item.actor.profileRef),
  }
}

// journey-review J3-06：同场多次 ×N 由已加载的同人事实条数合并得到（服务端逐条返回）。
// 邀请人标注（「邀请人Bear」口径）待服务端 listInfluenceInteractions 补 inviter 字段
// （mip-opportunities-api），DTO 扩展归 WS-OPPORTUNITIES/服务端；noteText 渲染链保留，
// 字段到位即显示（依赖记 .tmp/shared-change-requests.md）。
function presentInteraction(person: ReceivedInteractionActor, factCount: number): InteractionView {
  return {
    viewKey: `interaction-${person.profileRef}`,
    kind: 'INTERACTION',
    messageId: '',
    unread: false,
    ...cardBase(person),
    statusText: person.userKind === 'PLAYER' ? '玩家' : '嘉宾',
    sourceText: '',
    detailText: factCount > 1 ? `与你同场互动过 ${factCount} 次` : '与你同场互动过',
    note: '',
    countBadge: factCount > 1 ? `×${factCount}` : '',
    updatedText: '',
    navigationUrl: profileUrl(person.profileRef),
  }
}

function present(item: ReceivedInteraction, index: number, viewerName = ''): InteractionView {
  if (item.kind === 'GUEST') {
    return presentGuest(item, index, viewerName)
  }
  if (item.kind === 'INTERACTION') {
    return {
      ...presentInteraction(item.actor, 1),
      viewKey: `interaction-${item.actor.profileRef}-${item.event.id}-${index}`,
      sourceText: item.event.title,
      updatedText: formatChineseMonthDayTime(item.updatedAt),
    }
  }
  if (item.kind === 'ACTIVE_INTEREST') {
    // journey-review J3-07：「对我心动」红点暂无服务端事实——listActiveInfluenceInterests
    // 硬编码 unread:false / unreadCount:0，且行无 messageId（markReceivedRead 清除路径无接线对象）。
    // 红点死 UI 已移除（presenter 字段保留），待服务端补 unread 口径后客户端再接进入清除；
    // 依赖记 .tmp/shared-change-requests.md（我的页入口红点由 WS-MEMBERSHIP 消费 unreadCount，另行联动）。
    return {
      viewKey: `active-interest-${item.actor.profileRef}-${index}`,
      kind: item.kind,
      messageId: '',
      unread: false,
      ...cardBase(item.actor),
      statusText: item.actor.userKind === 'PLAYER' ? '玩家' : '嘉宾',
      sourceText: item.source.label,
      detailText: '当前对你标记了感兴趣',
      note: '',
      updatedText: formatChineseMonthDayTime(item.updatedAt),
      navigationUrl: profileUrl(item.actor.profileRef),
    }
  }
  if (item.kind === 'VISITOR') {
    // journey-review J3-08（QT 终审）：访客卡不显示访问时间。
    return {
      viewKey: `visitor-${item.actor.profileRef}-${index}`,
      kind: item.kind,
      messageId: item.actor.profileRef,
      unread: item.unread,
      ...cardBase(item.actor),
      statusText: item.actor.userKind === 'PLAYER' ? '玩家' : '嘉宾',
      sourceText: '公开档案',
      detailText: `访问了你的公开档案 ${item.visitCount} 次`,
      note: '',
      updatedText: formatChineseMonthDayTime(item.lastVisitedAt),
      navigationUrl: profileUrl(item.actor.profileRef),
    }
  }
  if (item.kind === 'REFERRAL') {
    return {
      viewKey: item.messageId || `referral-${item.opportunity.id}-${index}`,
      kind: item.kind,
      messageId: item.messageId || '',
      unread: item.unread,
      ...cardBase(item.actor),
      statusText: item.status === 'ACTIVE' ? '有效' : '已取消',
      sourceText: item.opportunity.title,
      detailText: '向你引荐了这个机会',
      note: item.note || '',
      updatedText: formatChineseMonthDayTime(item.updatedAt),
      navigationUrl: `/packages/member/mip-opportunities/detail/index?id=${encodeURIComponent(item.opportunity.id)}`,
    }
  }
  const sourceNames = {
    OPPORTUNITY: '机会',
    COOPERATION_CARD: '合作卡',
    SUPER_CASE: '超级案例',
    PROFILE: '公开档案',
  } as const
  if (item.kind === 'OUTBOUND_INTEREST') {
    return {
      viewKey: `outbound-interest-${item.target.profileRef}-${index}`,
      kind: item.kind,
      messageId: '',
      unread: false,
      ...cardBase(item.target),
      statusText: '感兴趣',
      sourceText: item.source.label,
      detailText: `你对该用户的${sourceNames[item.source.type]}标记了感兴趣`,
      note: '',
      updatedText: formatChineseMonthDayTime(item.updatedAt),
      navigationUrl: profileUrl(item.target.profileRef),
    }
  }
  return {
    viewKey: item.messageId || `interest-${item.actor.profileRef}-${index}`,
    kind: item.kind,
    messageId: item.messageId || '',
    unread: item.unread,
    ...cardBase(item.actor),
    statusText: item.status === 'ACTIVE' ? '有效' : '已取消',
    sourceText: item.source.label,
    detailText: `对你的${sourceNames[item.source.type]}标记感兴趣`,
    note: '',
    updatedText: formatChineseMonthDayTime(item.updatedAt),
    navigationUrl: profileUrl(item.actor.profileRef),
  }
}

// INTERACTION：按人合并已加载的同场事实（保持最近一次在前的服务端顺序）。
function mergeInteractionViews(rawItems: ReceivedInteraction[]): InteractionView[] {
  const counts = new Map<string, number>()
  const ordered: ReceivedInteractionActor[] = []
  for (const item of rawItems) {
    if (item.kind !== 'INTERACTION') {
      continue
    }
    const count = counts.get(item.actor.profileRef) || 0
    counts.set(item.actor.profileRef, count + 1)
    if (count === 0) {
      ordered.push(item.actor)
    }
  }
  return ordered.map(actor => presentInteraction(actor, counts.get(actor.profileRef) || 1))
}

function matchesInteractionSearch(view: InteractionView, keyword: string) {
  if (!keyword) {
    return true
  }
  const needle = keyword.trim().toLowerCase()
  if (!needle) {
    return true
  }
  // 搜索姓名、行业、简介等：DTO 只有昵称与 headline（身份/行业/简介混合行）。
  return view.actorName.toLowerCase().includes(needle)
    || view.actorHeadline.toLowerCase().includes(needle)
}

const influenceTitles: Partial<Record<ReceivedInteractionCategory, string>> = {
  GUEST: '嘉宾',
  INTERACTION: '互动过',
  ACTIVE_INTEREST: '心动值',
  VISITOR: '访客',
}

Page({
  data: {
    state: 'loading' as PageState,
    influenceMode: false,
    heartsMode: false,
    category: 'REFERRAL' as ReceivedInteractionCategory,
    items: [] as InteractionView[],
    displayItems: [] as InteractionView[],
    searchInput: '',
    viewerName: '',
    referralUnreadCount: 0,
    interestUnreadCount: 0,
    visitorUnreadCount: 0,
    totalViewCount: null as number | null,
    totalViewState: 'loading' as 'loading' | 'ready' | 'error',
    nextCursor: '',
    loadingMore: false,
    refreshing: false,
    openingKey: '',
    accessToken: '',
    message: '',
    // figma 嘉宾卡网格（1732_19323 等五稿）的还原态开关，fixture 专用；
    // 生产保持 总浏览量+tabs+列表（mip-received-interactions 测试 pin）。
    figmaLayout: false,
  },
  markingVisitorsRead: false,
  pageHidden: false,
  accessReady: false,
  checkingAccess: false,
  categoryCache: {
    REFERRAL: createCategoryCache(),
    PROFILE_INTEREST: createCategoryCache(),
    OUTBOUND_INTEREST: createCategoryCache(),
    VISITOR: createCategoryCache(),
    GUEST: createCategoryCache(),
    INTERACTION: createCategoryCache(),
    ACTIVE_INTEREST: createCategoryCache(),
  } as Record<ReceivedInteractionCategory, CategoryCache>,

  onLoad(query: Record<string, string | undefined>) {
    const heartsMode = query.scope === 'hearts'
    const influenceMode = query.scope === 'influence'
    const requested = String(query.category || '').toUpperCase() as ReceivedInteractionCategory
    const allowed = heartsMode
      ? ['ACTIVE_INTEREST', 'OUTBOUND_INTEREST']
      : influenceMode
        ? ['GUEST', 'INTERACTION', 'ACTIVE_INTEREST', 'VISITOR']
        : ['REFERRAL', 'PROFILE_INTEREST', 'OUTBOUND_INTEREST', 'VISITOR']
    const category = allowed.includes(requested)
      ? requested
      : (heartsMode ? 'ACTIVE_INTEREST' : influenceMode ? 'GUEST' : 'REFERRAL')
    // journey-review J3-05/06/07/08：导航按数据卡命名（心动值 D-01 定稿名）。
    if (heartsMode) {
      wx.setNavigationBarTitle({ title: '心动值' })
    }
    else if (influenceMode && influenceTitles[category]) {
      wx.setNavigationBarTitle({ title: influenceTitles[category] })
    }
    this.setData({
      influenceMode,
      heartsMode,
      category,
    })
  },

  onHide() { this.pageHidden = true },
  onUnload() { this.pageHidden = true },

  onShow() {
    this.pageHidden = false
    const resumed = mipIdentityModule.consumePendingResume()
    if (!this.accessReady || resumed) {
      void this.checkAccess()
      return
    }
    // J3-05：被邀请嘉宾签到成功后次数自动刷新（onShow 重拉当前类目）。
    if (this.categoryCache[this.data.category].loaded) {
      void this.loadCategory(this.data.category, true)
    }
  },

  async checkAccess() {
    const ready = await ensureProtectedPageAccess(this, () => mipIdentityModule.beginProtectedAction({
      action: 'INTERACT',
      source: { navigation: 'navigateBack' },
    }))
    if (!ready) {
      return
    }
    const snapshot = mipIdentityModule.peekSnapshot()
    this.setData({ viewerName: snapshot?.profile.nickname || '' })
    const categories = this.data.heartsMode
      ? ['ACTIVE_INTEREST', 'OUTBOUND_INTEREST'] as const
      : this.data.influenceMode
        // 影响力四列表各自独立成页（无横向 tabs），只拉当前类目。
        ? [this.data.category] as const
        : ['REFERRAL', 'PROFILE_INTEREST', 'OUTBOUND_INTEREST', 'VISITOR'] as const
    await Promise.all(categories.map(category => this.loadCategory(category, true)))
  },

  openEventHearts() { caseNavigateTo({ url: '/packages/member/mip-hearts/index' }) },

  openAccess() {
    if (this.data.accessToken) {
      caseNavigateTo({ url: mipAccessPageUrl(this.data.accessToken) })
    }
  },

  changeCategory(event: WechatMiniprogram.TouchEvent) {
    const category = String(event.currentTarget.dataset.category || '') as ReceivedInteractionCategory
    const allowed = this.data.heartsMode
      ? ['ACTIVE_INTEREST', 'OUTBOUND_INTEREST']
      : this.data.influenceMode
        ? ['GUEST', 'INTERACTION', 'ACTIVE_INTEREST', 'VISITOR']
        : ['REFERRAL', 'PROFILE_INTEREST', 'OUTBOUND_INTEREST', 'VISITOR']
    if (!allowed.includes(category) || category === this.data.category) {
      return
    }
    this.setData({ category, message: '' })
    this.applyCategory(category)
    if (!this.categoryCache[category].loaded) {
      void this.loadCategory(category, true)
    }
  },

  onSearchInput(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    this.applySearch(String(event.detail.value || ''))
  },

  clearSearch() {
    this.applySearch('')
  },

  applySearch(keyword: string) {
    this.setData({ searchInput: keyword, displayItems: this.filterDisplayed(this.data.items, keyword) })
  },

  filterDisplayed(items: InteractionView[], keyword: string) {
    if (this.data.category !== 'INTERACTION' || !this.data.influenceMode) {
      return items
    }
    return items.filter(item => matchesInteractionSearch(item, keyword))
  },

  applyCategory(category: ReceivedInteractionCategory) {
    const cache = this.categoryCache[category]
    this.setData({
      state: cache.state,
      items: cache.items,
      displayItems: this.filterDisplayed(cache.items, this.data.searchInput),
      nextCursor: cache.nextCursor,
      referralUnreadCount: this.categoryCache.REFERRAL.unreadCount,
      interestUnreadCount: this.categoryCache.PROFILE_INTEREST.unreadCount,
      visitorUnreadCount: this.categoryCache.VISITOR.unreadCount,
    }, () => {
      if (category === 'VISITOR' && cache.state === 'ready') {
        void this.markDisplayedVisitorsRead()
      }
    })
  },

  async markDisplayedVisitorsRead() {
    if (this.markingVisitorsRead || this.pageHidden || this.data.category !== 'VISITOR') {
      return
    }
    const cache = this.categoryCache.VISITOR
    const displayed = cache.items.filter(item => item.unread && item.messageId)
    if (!displayed.length) {
      return
    }
    this.markingVisitorsRead = true
    this.setData({ refreshing: true })
    let failed = false
    try {
      for (const item of displayed) {
        if (this.pageHidden || this.data.category !== 'VISITOR') {
          break
        }
        try {
          await opportunityModule.markReceivedRead(item.messageId, 'VISITOR')
          item.unread = false
          cache.unreadCount = Math.max(0, cache.unreadCount - 1)
          mipMessagingModule.invalidate()
        }
        catch (error) {
          recordLoadingFailure('opportunities.response', error)
          if (requiresIdentityRefresh(error)) {
            this.accessReady = false
          }
          failed = true
        }
      }
      if (!this.pageHidden && this.data.category === 'VISITOR') {
        this.setData({
          items: cache.items,
          displayItems: this.filterDisplayed(cache.items, this.data.searchInput),
          visitorUnreadCount: cache.unreadCount,
          message: failed ? '访客已显示，未读标记暂未更新，请刷新重试。' : '',
        })
      }
    }
    finally {
      this.markingVisitorsRead = false
      this.setData({ refreshing: false })
    }
  },

  async loadCategory(category: ReceivedInteractionCategory, reset: boolean) {
    const cache = this.categoryCache[category]
    if (category === 'VISITOR' && this.markingVisitorsRead) {
      return
    }
    if (!reset && (!cache.nextCursor || this.data.loadingMore)) {
      return
    }
    if (reset && !cache.items.length && category === this.data.category) {
      this.setData({ state: 'loading', message: '' })
    }
    if (!reset) {
      this.setData({ loadingMore: true, message: '' })
    }
    try {
      const page = await opportunityModule.listReceived(
        category,
        reset ? undefined : cache.nextCursor || undefined,
      )
      cache.loaded = true
      if (category === 'INTERACTION') {
        // 逐条同场事实按人合并成 ×N 卡片；翻页累计。
        cache.rawItems = reset ? page.items : [...cache.rawItems, ...page.items]
        cache.items = mergeInteractionViews(cache.rawItems)
      }
      else {
        cache.items = reset
          ? page.items.map((item, index) => present(item, index, this.data.viewerName))
          : [...cache.items, ...page.items.map((item, index) => present(item, cache.items.length + index, this.data.viewerName))]
      }
      cache.nextCursor = page.nextCursor || ''
      cache.unreadCount = page.unreadCount
      cache.state = cache.items.length ? 'ready' : 'empty'
      if (category === 'VISITOR') {
        this.setData({
          totalViewCount: page.totalViewCount || 0,
          totalViewState: 'ready',
        })
      }
      if (category === this.data.category) {
        this.applyCategory(category)
      }
      else {
        this.setData({
          referralUnreadCount: this.categoryCache.REFERRAL.unreadCount,
          interestUnreadCount: this.categoryCache.PROFILE_INTEREST.unreadCount,
          visitorUnreadCount: this.categoryCache.VISITOR.unreadCount,
        })
      }
    }
    catch (error) {
      recordLoadingFailure('opportunities.response', error)
      if (requiresIdentityRefresh(error)) {
        this.accessReady = false
      }
      cache.state = cache.items.length ? 'ready' : 'error'
      if (category === 'VISITOR' && this.data.totalViewCount === null) {
        this.setData({ totalViewState: 'error' })
      }
      if (category === this.data.category) {
        this.applyCategory(category)
        this.setData({
          message: cache.items.length
            ? '互动记录更新失败，已保留上次结果。'
            : (error instanceof Error ? error.message : '互动记录加载失败'),
        })
      }
    }
    finally {
      this.setData({ loadingMore: false })
    }
  },

  retry() {
    if (this.data.refreshing) {
      return
    }
    if (this.data.state !== 'error' && !(this.data.state === 'ready' && this.data.message)) {
      return
    }
    this.setData({ refreshing: true })
    const refresh = this.accessReady
      ? this.loadCategory(this.data.category, true)
      : this.checkAccess()
    return refresh.finally(() => {
      if (!this.markingVisitorsRead) {
        this.setData({ refreshing: false })
      }
    })
  },

  copyLoadingDiagnostics() {
    wx.setClipboardData({
      data: JSON.stringify({ format: 1, page: 'received', category: this.data.category, collectedAt: new Date().toISOString(), samples: getLoadingDiagnostics() }),
      fail: () => wx.showToast({ title: '复制失败，请重试', icon: 'none' }),
    })
  },

  loadMore() {
    void this.loadCategory(this.data.category, false)
  },

  async openInteraction(event: WechatMiniprogram.TouchEvent) {
    const viewKey = String(event.currentTarget.dataset.key || '')
    if (!viewKey || this.data.openingKey) {
      return
    }
    const cache = this.categoryCache[this.data.category]
    const item = cache.items.find(entry => entry.viewKey === viewKey)
    if (!item) {
      return
    }
    this.setData({ openingKey: viewKey, message: '' })
    if (item.unread && item.messageId && !(this.data.category === 'VISITOR' && this.markingVisitorsRead)) {
      try {
        if (this.data.category === 'VISITOR') {
          await opportunityModule.markReceivedRead(item.messageId, this.data.category)
        }
        else {
          await opportunityModule.markReceivedRead(item.messageId)
        }
        item.unread = false
        cache.unreadCount = Math.max(0, cache.unreadCount - 1)
        mipMessagingModule.invalidate()
        this.applyCategory(this.data.category)
      }
      catch {
        this.setData({ message: '未读状态更新失败。' })
      }
    }
    this.setData({ openingKey: '' })
    caseNavigateTo({ url: item.navigationUrl })
  },
})
