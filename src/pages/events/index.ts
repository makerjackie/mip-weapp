import type { QueryOptions } from '@weapp/shared/cache'
import type {
  EventTimeFilter,
  PresentedEvent,
} from '../../modules/membership/event-feed'
import type { EventFeed, EventFeedView } from '../../modules/membership/types'
import { membershipModule } from '../../modules/membership/client'
import { presentEventFeed } from '../../modules/membership/event-feed'
import { caseNavigateTo, syncCaseNavigation } from '../../modules/platform/case-navigation'

function eventSignature(view: EventFeedView, filter: EventTimeFilter, events: PresentedEvent[]) {
  return `${view}:${filter}:${events.map(event => [
    event.id,
    event.coverUrl,
    event.title,
    event.startsText,
    event.availabilityText,
    event.action,
    event.actionLabel,
    event.priceText,
  ].join('|')).join('::')}`
}

Page({
  data: {
    state: 'loading' as 'loading' | 'ready' | 'error',
    view: 'upcoming' as EventFeedView,
    timeFilter: 'all' as EventTimeFilter,
    events: [] as PresentedEvent[],
    sourceCount: 0,
    eventSignature: '',
    registeringEventId: '',
    emptyTitle: '新的活动正在准备',
    emptyDescription: '活动发布后会第一时间出现在这里。',
    message: '',
    isEmbeddedCase: false,
    searchInput: '',
    activeQuery: '',
  },
  requestSeq: 0,
  searchTimer: 0 as number | ReturnType<typeof setTimeout>,
  currentFeed: null as EventFeed | null,

  onShow() {
    syncCaseNavigation(this, 'pages/events/index')
    void this.loadEvents()
  },

  onUnload() {
    if (this.searchTimer) {
      clearTimeout(this.searchTimer)
      this.searchTimer = 0
    }
  },

  async loadEvents(options: QueryOptions = {}) {
    const view = this.data.view
    const query = this.data.activeQuery
    const cached = membershipModule.peekEvents(view, query)
    if (cached) {
      this.applyEvents(cached)
    }
    else if (this.data.state !== 'ready') {
      this.setData({ state: 'loading', message: '' })
    }
    const seq = this.requestSeq + 1
    this.requestSeq = seq
    try {
      const feed = await membershipModule.listEvents(view, query, options)
      if (seq !== this.requestSeq || this.data.view !== view || this.data.activeQuery !== query) {
        return
      }
      this.applyEvents(feed)
    }
    catch (error) {
      if (seq !== this.requestSeq || this.data.view !== view || this.data.activeQuery !== query) {
        return
      }
      this.setData(cached || this.data.state === 'ready'
        ? { message: '活动更新失败，已保留上次结果。' }
        : { state: 'error', message: error instanceof Error ? error.message : '活动加载失败' })
    }
  },

  applyEvents(feed: Awaited<ReturnType<typeof membershipModule.listEvents>>) {
    this.currentFeed = feed
    const events = presentEventFeed(feed.events, {
      membershipActive: feed.membershipActive,
      phoneBound: feed.phoneBound,
      timeFilter: this.data.timeFilter,
    })
    const signature = eventSignature(this.data.view, this.data.timeFilter, events)
    if (this.data.state === 'ready' && this.data.eventSignature === signature) {
      if (this.data.message) {
        this.setData({ message: '' })
      }
      return
    }
    this.setData({
      state: 'ready',
      message: '',
      eventSignature: signature,
      events,
      sourceCount: feed.events.length,
    })
  },

  async onPullDownRefresh() {
    try {
      await this.loadEvents({ force: true })
    }
    finally {
      wx.stopPullDownRefresh()
    }
  },

  changeView(event: WechatMiniprogram.CustomEvent<{ value: EventFeedView }>) {
    const view = event.detail.value
    this.setData({
      view,
      emptyTitle: view === 'mine' ? '还没有报名活动' : '新的活动正在准备',
      emptyDescription: view === 'mine' ? '报名成功的活动会集中出现在这里。' : '活动发布后会第一时间出现在这里。',
    })
    void this.loadEvents()
  },

  changeTimeFilter(event: WechatMiniprogram.TouchEvent) {
    const filter = String(event.currentTarget.dataset.filter || '')
    if (!['all', 'next7', 'weekend', 'month'].includes(filter)
      || filter === this.data.timeFilter) {
      return
    }
    this.setData({ timeFilter: filter as EventTimeFilter, message: '' })
    if (this.currentFeed) {
      this.applyEvents(this.currentFeed)
    }
  },

  onSearchInput(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    this.setData({ searchInput: event.detail.value })
    if (this.searchTimer) {
      clearTimeout(this.searchTimer)
    }
    this.searchTimer = setTimeout(() => {
      this.commitSearch()
    }, 300)
  },

  onSearchConfirm() {
    if (this.searchTimer) {
      clearTimeout(this.searchTimer)
      this.searchTimer = 0
    }
    this.commitSearch()
  },

  clearSearch() {
    if (this.searchTimer) {
      clearTimeout(this.searchTimer)
      this.searchTimer = 0
    }
    this.setData({ searchInput: '', activeQuery: '' })
    void this.loadEvents()
  },

  commitSearch() {
    const activeQuery = this.data.searchInput.trim()
    if (activeQuery === this.data.activeQuery) {
      return
    }
    this.setData({ activeQuery, message: '' })
    void this.loadEvents()
  },

  async handleEventAction(event: WechatMiniprogram.CustomEvent<{ id: string, action: string }>) {
    const { action, id: eventId } = event.detail
    if (!eventId || ['full', 'closed'].includes(action)) {
      return
    }
    if (action === 'registered') {
      caseNavigateTo({ url: `/packages/member/ticket/index?eventId=${encodeURIComponent(eventId)}` })
      return
    }
    if (action === 'pending' || action === 'waitlisted') {
      caseNavigateTo({ url: `/packages/member/event-detail/index?eventId=${encodeURIComponent(eventId)}` })
      return
    }
    if (action === 'phone') {
      caseNavigateTo({ url: `/packages/member/access/index?reason=event&eventId=${encodeURIComponent(eventId)}` })
      return
    }
    if (action === 'membership') {
      caseNavigateTo({ url: '/pages/membership/index' })
      return
    }
    caseNavigateTo({ url: `/packages/member/registration-confirm/index?eventId=${encodeURIComponent(eventId)}` })
  },

  openEvent(event: WechatMiniprogram.CustomEvent<{ id: string }>) {
    const eventId = event.detail.id
    if (!eventId) {
      return
    }
    caseNavigateTo({ url: `/packages/member/event-detail/index?eventId=${encodeURIComponent(eventId)}` })
  },
})
