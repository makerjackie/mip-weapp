import type {
  ReceivedInteraction,
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
}

interface CategoryCache {
  loaded: boolean
  state: PageState
  items: InteractionView[]
  nextCursor: string
  unreadCount: number
}

function createCategoryCache(): CategoryCache {
  return {
    loaded: false,
    state: 'loading',
    items: [],
    nextCursor: '',
    unreadCount: 0,
  }
}

function present(item: ReceivedInteraction, index: number): InteractionView {
  const subject = item.kind === 'OUTBOUND_INTEREST' ? item.target : item.actor
  const actorName = subject.nickname || 'MIP 用户'
  if (item.kind === 'GUEST') {
    return {
      viewKey: `guest-${item.actor.profileRef}-${index}`,
      kind: item.kind,
      messageId: '',
      unread: false,
      actorName,
      actorInitial: actorName.slice(0, 1),
      actorAvatarUrl: item.actor.avatarUrl || '',
      actorHeadline: item.actor.headline || '',
      statusText: '嘉宾',
      sourceText: item.event.title,
      detailText: item.invitationCount > 1
        ? `通过你的邀请参加过 ${item.invitationCount} 场活动`
        : '通过你的邀请参加活动',
      note: '',
      updatedText: formatChineseMonthDayTime(item.updatedAt),
      navigationUrl: `/packages/member/mip-public-profile/index?profileRef=${encodeURIComponent(item.actor.profileRef)}`,
    }
  }
  if (item.kind === 'INTERACTION') {
    return {
      viewKey: `interaction-${item.actor.profileRef}-${item.event.id}-${index}`,
      kind: item.kind,
      messageId: '',
      unread: false,
      actorName,
      actorInitial: actorName.slice(0, 1),
      actorAvatarUrl: item.actor.avatarUrl || '',
      actorHeadline: item.actor.headline || '',
      statusText: item.actor.userKind === 'PLAYER' ? '玩家' : '嘉宾',
      sourceText: item.event.title,
      detailText: '在活动中向你发送了心动',
      note: '',
      updatedText: formatChineseMonthDayTime(item.updatedAt),
      navigationUrl: `/packages/member/mip-public-profile/index?profileRef=${encodeURIComponent(item.actor.profileRef)}`,
    }
  }
  if (item.kind === 'ACTIVE_INTEREST') {
    return {
      viewKey: `active-interest-${item.actor.profileRef}-${index}`,
      kind: item.kind,
      messageId: '',
      unread: false,
      actorName,
      actorInitial: actorName.slice(0, 1),
      actorAvatarUrl: item.actor.avatarUrl || '',
      actorHeadline: item.actor.headline || '',
      statusText: item.actor.userKind === 'PLAYER' ? '玩家' : '嘉宾',
      sourceText: item.source.label,
      detailText: '当前对你标记了感兴趣',
      note: '',
      updatedText: formatChineseMonthDayTime(item.updatedAt),
      navigationUrl: `/packages/member/mip-public-profile/index?profileRef=${encodeURIComponent(item.actor.profileRef)}`,
    }
  }
  if (item.kind === 'VISITOR') {
    return {
      viewKey: `visitor-${item.actor.profileRef}-${index}`,
      kind: item.kind,
      messageId: item.actor.profileRef,
      unread: item.unread,
      actorName,
      actorInitial: actorName.slice(0, 1),
      actorAvatarUrl: item.actor.avatarUrl || '',
      actorHeadline: item.actor.headline || '',
      statusText: item.actor.userKind === 'PLAYER' ? '玩家' : '嘉宾',
      sourceText: '公开档案',
      detailText: `访问了你的公开档案 ${item.visitCount} 次`,
      note: '',
      updatedText: formatChineseMonthDayTime(item.lastVisitedAt),
      navigationUrl: `/packages/member/mip-public-profile/index?profileRef=${encodeURIComponent(item.actor.profileRef)}`,
    }
  }
  if (item.kind === 'REFERRAL') {
    return {
      viewKey: item.messageId || `referral-${item.opportunity.id}-${index}`,
      kind: item.kind,
      messageId: item.messageId || '',
      unread: item.unread,
      actorName,
      actorInitial: actorName.slice(0, 1),
      actorAvatarUrl: item.actor.avatarUrl || '',
      actorHeadline: item.actor.headline || '',
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
      actorName,
      actorInitial: actorName.slice(0, 1),
      actorAvatarUrl: item.target.avatarUrl || '',
      actorHeadline: item.target.headline || '',
      statusText: '感兴趣',
      sourceText: item.source.label,
      detailText: `你对该用户的${sourceNames[item.source.type]}标记了感兴趣`,
      note: '',
      updatedText: formatChineseMonthDayTime(item.updatedAt),
      navigationUrl: `/packages/member/mip-public-profile/index?profileRef=${encodeURIComponent(item.target.profileRef)}`,
    }
  }
  return {
    viewKey: item.messageId || `interest-${item.actor.profileRef}-${index}`,
    kind: item.kind,
    messageId: item.messageId || '',
    unread: item.unread,
    actorName,
    actorInitial: actorName.slice(0, 1),
    actorAvatarUrl: item.actor.avatarUrl || '',
    actorHeadline: item.actor.headline || '',
    statusText: item.status === 'ACTIVE' ? '有效' : '已取消',
    sourceText: item.source.label,
    detailText: `对你的${sourceNames[item.source.type]}标记感兴趣`,
    note: '',
    updatedText: formatChineseMonthDayTime(item.updatedAt),
    navigationUrl: `/packages/member/mip-public-profile/index?profileRef=${encodeURIComponent(item.actor.profileRef)}`,
  }
}

Page({
  data: {
    state: 'loading' as PageState,
    influenceMode: false,
    heartsMode: false,
    category: 'REFERRAL' as ReceivedInteractionCategory,
    items: [] as InteractionView[],
    referralUnreadCount: 0,
    interestUnreadCount: 0,
    visitorUnreadCount: 0,
    totalViewCount: null as number | null,
    totalViewState: 'loading' as 'loading' | 'ready' | 'error',
    nextCursor: '',
    loadingMore: false,
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
    if (heartsMode) {
      wx.setNavigationBarTitle({ title: '心动记录' })
    }
    const influenceMode = query.scope === 'influence'
    const requested = String(query.category || '').toUpperCase() as ReceivedInteractionCategory
    const allowed = heartsMode
      ? ['ACTIVE_INTEREST', 'OUTBOUND_INTEREST']
      : influenceMode
        ? ['GUEST', 'INTERACTION', 'ACTIVE_INTEREST', 'VISITOR']
        : ['REFERRAL', 'PROFILE_INTEREST', 'OUTBOUND_INTEREST', 'VISITOR']
    this.setData({
      influenceMode,
      heartsMode,
      category: allowed.includes(requested) ? requested : (heartsMode ? 'ACTIVE_INTEREST' : influenceMode ? 'GUEST' : 'REFERRAL'),
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
    const categories = this.data.heartsMode
      ? ['ACTIVE_INTEREST', 'OUTBOUND_INTEREST'] as const
      : this.data.influenceMode
        ? ['GUEST', 'INTERACTION', 'ACTIVE_INTEREST', 'VISITOR'] as const
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

  applyCategory(category: ReceivedInteractionCategory) {
    const cache = this.categoryCache[category]
    this.setData({
      state: cache.state,
      items: cache.items,
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
          visitorUnreadCount: cache.unreadCount,
          message: failed ? '访客已显示，未读标记暂未更新，请刷新重试。' : '',
        })
      }
    }
    finally {
      this.markingVisitorsRead = false
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
      cache.items = reset
        ? page.items.map(present)
        : [...cache.items, ...page.items.map((item, index) => present(item, cache.items.length + index))]
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
    if (this.data.state !== 'error' && !(this.data.state === 'ready' && this.data.message)) {
      return
    }
    return this.accessReady
      ? this.loadCategory(this.data.category, true)
      : this.checkAccess()
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
