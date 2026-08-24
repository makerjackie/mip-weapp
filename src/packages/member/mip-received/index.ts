import type {
  ReceivedInteraction,
  ReceivedInteractionCategory,
} from '../../../modules/mip-opportunities'
import { mipAccessPageUrl } from '../../../modules/mip-identity'
import { mipIdentityModule } from '../../../modules/mip-identity/client'
import { mipMessagingModule } from '../../../modules/mip-messaging/client'
import { opportunityModule } from '../../../modules/mip-opportunities'
import { caseNavigateTo } from '../../../modules/platform/case-navigation'

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

function dateText(value: string) {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) {
    return ''
  }
  return `${date.getMonth() + 1}月${date.getDate()}日 ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

function present(item: ReceivedInteraction, index: number): InteractionView {
  const actorName = item.actor.nickname || 'MIP 用户'
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
      statusText: `${item.visitCount} 次访问`,
      sourceText: '公开档案',
      detailText: '访问了你的公开档案',
      note: '',
      updatedText: dateText(item.lastVisitedAt),
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
      updatedText: dateText(item.updatedAt),
      navigationUrl: `/packages/member/mip-opportunities/detail/index?id=${encodeURIComponent(item.opportunity.id)}`,
    }
  }
  const sourceNames = {
    OPPORTUNITY: '机会',
    COOPERATION_CARD: '合作卡',
    SUPER_CASE: '超级案例',
    PROFILE: '公开档案',
  } as const
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
    updatedText: dateText(item.updatedAt),
    navigationUrl: `/packages/member/mip-public-profile/index?profileRef=${encodeURIComponent(item.actor.profileRef)}`,
  }
}

Page({
  data: {
    state: 'loading' as PageState,
    category: 'REFERRAL' as ReceivedInteractionCategory,
    items: [] as InteractionView[],
    referralUnreadCount: 0,
    interestUnreadCount: 0,
    visitorUnreadCount: 0,
    nextCursor: '',
    loadingMore: false,
    openingKey: '',
    accessToken: '',
    message: '',
  },
  accessReady: false,
  checkingAccess: false,
  categoryCache: {
    REFERRAL: createCategoryCache(),
    PROFILE_INTEREST: createCategoryCache(),
    VISITOR: createCategoryCache(),
  } as Record<ReceivedInteractionCategory, CategoryCache>,

  onShow() {
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
    if (this.checkingAccess) {
      return
    }
    this.checkingAccess = true
    if (!this.accessReady) {
      this.setData({ state: 'loading', message: '' })
    }
    try {
      const session = await mipIdentityModule.beginProtectedAction({
        action: 'INTERACT',
        source: { navigation: 'navigateBack' },
      })
      if (!session.decision.ready) {
        this.accessReady = false
        this.setData({ state: 'access', accessToken: session.token, message: '' })
        return
      }
      this.accessReady = true
      this.setData({ accessToken: '', message: '' })
      await Promise.all([
        this.loadCategory('REFERRAL', true),
        this.loadCategory('PROFILE_INTEREST', true),
        this.loadCategory('VISITOR', true),
      ])
    }
    catch {
      this.setData({ state: 'error', message: '身份状态暂时无法确认。' })
    }
    finally {
      this.checkingAccess = false
    }
  },

  openAccess() {
    if (this.data.accessToken) {
      caseNavigateTo({ url: mipAccessPageUrl(this.data.accessToken) })
    }
  },

  changeCategory(event: WechatMiniprogram.TouchEvent) {
    const category = String(event.currentTarget.dataset.category || '') as ReceivedInteractionCategory
    if (!['REFERRAL', 'PROFILE_INTEREST', 'VISITOR'].includes(category) || category === this.data.category) {
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
    })
  },

  async loadCategory(category: ReceivedInteractionCategory, reset: boolean) {
    const cache = this.categoryCache[category]
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
      cache.state = cache.items.length ? 'ready' : 'error'
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
    if (this.data.state === 'error') {
      void this.loadCategory(this.data.category, true)
    }
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
    if (item.unread && item.messageId) {
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
