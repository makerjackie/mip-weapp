import type { HeartHistoryItem, HeartHistoryKind } from '../../../modules/mip-events'
import { mipEventsModule } from '../../../modules/mip-events/client'
import { mipAccessPageUrl } from '../../../modules/mip-identity'
import { mipIdentityModule } from '../../../modules/mip-identity/client'
import { ensureProtectedPageAccess, requiresIdentityRefresh } from '../../../modules/mip-identity/protected-page-load'
import { caseNavigateTo } from '../../../platform/navigation/client'
import { formatChineseDate, formatChineseDateTime } from '../../../utils/date'

type PageState = 'loading' | 'ready' | 'empty' | 'error' | 'access'

interface HeartView extends HeartHistoryItem {
  viewKey: string
  eventTimeText: string
  updatedText: string
  personInitial: string
}

interface HeartCache {
  loaded: boolean
  state: PageState
  items: HeartView[]
  nextCursor: string
  readThroughAt: string
  unreadCount: number
  requestSeq: number
}

function createCache(): HeartCache {
  return { loaded: false, state: 'loading', items: [], nextCursor: '', readThroughAt: '', unreadCount: 0, requestSeq: 0 }
}

function present(item: HeartHistoryItem, index: number): HeartView {
  return {
    ...item,
    viewKey: `${item.event.id}-${item.person.profileRef}-${index}`,
    eventTimeText: formatChineseDate(item.event.startsAt),
    updatedText: formatChineseDateTime(item.updatedAt),
    personInitial: item.person.nickname.slice(0, 1) || 'M',
  }
}

Page({
  data: {
    state: 'loading' as PageState,
    kind: 'SENT' as HeartHistoryKind,
    items: [] as HeartView[],
    nextCursor: '',
    loadingMore: false,
    accessToken: '',
    message: '',
    receivedUnreadCount: 0,
    // figma 心动值三稿（1732_19460/2202_44989/2202_44878）的还原态开关，fixture 专用；
    // 生产保持 tabs+列表（被 mip-heart-history 测试 pin）。
    figmaLayout: false,
  },
  accessReady: false,
  checkingAccess: false,
  pageHidden: false,
  markingRead: false,
  cache: {
    SENT: createCache(),
    RECEIVED: createCache(),
  } as Record<HeartHistoryKind, HeartCache>,

  onLoad(query: Record<string, string>) {
    if (query.kind === 'RECEIVED') {
      this.setData({ kind: 'RECEIVED' })
    }
  },

  onShow() {
    this.pageHidden = false
    const resumed = mipIdentityModule.consumePendingResume()
    if (!this.accessReady || resumed) {
      void this.checkAccess()
      return
    }
    void Promise.all([this.load(this.data.kind, true), this.loadOtherKind()])
  },

  onHide() { this.pageHidden = true },
  onUnload() { this.pageHidden = true },

  async loadOtherKind() {
    if (this.data.kind === 'SENT') {
      await this.load('RECEIVED', true)
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
    await Promise.all([this.load(this.data.kind, true), this.loadOtherKind()])
  },

  openAccess() {
    if (this.data.accessToken) {
      caseNavigateTo({ url: mipAccessPageUrl(this.data.accessToken) })
    }
  },

  changeKind(event: WechatMiniprogram.TouchEvent) {
    const kind = String(event.currentTarget.dataset.kind || '') as HeartHistoryKind
    if (!['SENT', 'RECEIVED'].includes(kind) || kind === this.data.kind) {
      return
    }
    this.setData({ kind, message: '' })
    this.apply(kind)
    if (!this.cache[kind].loaded) {
      void this.load(kind, true)
    }
  },

  apply(kind: HeartHistoryKind) {
    const current = this.cache[kind]
    this.setData({
      state: current.state,
      items: current.items,
      nextCursor: current.nextCursor,
    }, () => {
      if (['ready', 'empty'].includes(current.state)) {
        void this.markReceivedRead()
      }
    })
  },

  async markReceivedRead() {
    const current = this.cache.RECEIVED
    if (this.pageHidden || !['ready', 'empty'].includes(this.data.state) || !current.loaded || this.markingRead || !current.readThroughAt || !current.unreadCount) {
      return
    }
    this.markingRead = true
    const readThroughAt = current.readThroughAt
    const requestSeq = current.requestSeq
    try {
      await mipEventsModule.markHeartHistoryRead(readThroughAt)
      if (current.requestSeq === requestSeq && current.readThroughAt === readThroughAt) {
        current.unreadCount = 0
        this.setData({ receivedUnreadCount: 0 })
      }
    }
    catch (error) {
      if (requiresIdentityRefresh(error)) {
        this.accessReady = false
      }
      this.setData({ message: '心动记录已显示，未读标记暂未更新，请重试。' })
    }
    finally {
      this.markingRead = false
      if (current.requestSeq !== requestSeq && current.readThroughAt !== readThroughAt) {
        void this.markReceivedRead()
      }
    }
  },

  async load(kind: HeartHistoryKind, reset: boolean) {
    const current = this.cache[kind]
    if (!reset && (!current.nextCursor || this.data.loadingMore)) {
      return
    }
    const requestSeq = ++current.requestSeq
    if (reset && !current.items.length && kind === this.data.kind) {
      this.setData({ state: 'loading', message: '' })
    }
    else if (!reset) {
      this.setData({ loadingMore: true, message: '' })
    }
    try {
      const response = await mipEventsModule.listHeartHistory(
        kind,
        reset ? undefined : current.nextCursor,
      )
      if (requestSeq !== current.requestSeq) {
        return
      }
      current.loaded = true
      current.items = reset
        ? response.items.map(present)
        : current.items.concat(response.items.map((item, index) => present(item, current.items.length + index)))
      current.nextCursor = response.nextCursor || ''
      current.readThroughAt = response.readThroughAt || ''
      current.unreadCount = response.unreadCount || 0
      if (kind === 'RECEIVED') {
        this.setData({ receivedUnreadCount: current.unreadCount }, () => {
          void this.markReceivedRead()
        })
      }
      current.state = current.items.length ? 'ready' : 'empty'
      if (kind === this.data.kind) {
        this.apply(kind)
      }
    }
    catch (error) {
      if (requestSeq !== current.requestSeq) {
        return
      }
      if (requiresIdentityRefresh(error)) {
        this.accessReady = false
      }
      current.state = current.items.length ? 'ready' : 'error'
      if (kind === this.data.kind) {
        this.apply(kind)
        this.setData({
          message: current.items.length
            ? '心动记录更新失败，已保留上次结果。'
            : (error instanceof Error ? error.message : '心动记录加载失败'),
        })
      }
    }
    finally {
      if (requestSeq === current.requestSeq) {
        this.setData({ loadingMore: false })
      }
    }
  },

  retry() {
    if (this.data.state === 'loading') {
      return
    }
    return this.accessReady
      ? this.load(this.data.kind, true)
      : this.checkAccess()
  },

  loadMore() {
    void this.load(this.data.kind, false)
  },

  openEvent(event: WechatMiniprogram.TouchEvent) {
    const eventId = String(event.currentTarget.dataset.eventId || '')
    if (eventId) {
      caseNavigateTo({ url: `/packages/member/mip-events/detail/index?eventId=${encodeURIComponent(eventId)}` })
    }
  },

  openProfile(event: WechatMiniprogram.TouchEvent) {
    const profileRef = String(event.currentTarget.dataset.profileRef || '')
    if (profileRef) {
      caseNavigateTo({ url: `/packages/member/mip-public-profile/index?profileRef=${encodeURIComponent(profileRef)}` })
    }
  },
})
