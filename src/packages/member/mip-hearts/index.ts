import type { HeartHistoryItem, HeartHistoryKind } from '../../../modules/mip-events'
import { mipEventsModule } from '../../../modules/mip-events/client'
import { mipAccessPageUrl } from '../../../modules/mip-identity'
import { mipIdentityModule } from '../../../modules/mip-identity/client'
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
}

function createCache(): HeartCache {
  return { loaded: false, state: 'loading', items: [], nextCursor: '' }
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
  },
  accessReady: false,
  checkingAccess: false,
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
    const resumed = mipIdentityModule.consumePendingResume()
    if (!this.accessReady || resumed) {
      void this.checkAccess()
      return
    }
    void this.load(this.data.kind, true)
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
      await this.load(this.data.kind, true)
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
    })
  },

  async load(kind: HeartHistoryKind, reset: boolean) {
    const current = this.cache[kind]
    if (!reset && (!current.nextCursor || this.data.loadingMore)) {
      return
    }
    if (reset && !current.items.length) {
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
      current.loaded = true
      current.items = reset
        ? response.items.map(present)
        : current.items.concat(response.items.map((item, index) => present(item, current.items.length + index)))
      current.nextCursor = response.nextCursor || ''
      current.state = current.items.length ? 'ready' : 'empty'
      if (kind === this.data.kind) {
        this.apply(kind)
      }
    }
    catch (error) {
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
      this.setData({ loadingMore: false })
    }
  },

  retry() {
    if (this.data.state === 'access') {
      void this.checkAccess()
      return
    }
    void this.load(this.data.kind, true)
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
