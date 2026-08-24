import type { EventId } from '../../modules/mip'
import type {
  EventDateFilter,
  EventFeedQuery,
  EventListView,
  MipEventListItem,
} from '../../modules/mip-events'
import { mipOperationsConfig } from '../../config/mip-operations'
import { resolvePrimaryBranchCity } from '../../modules/mip-events'
import { mipEventsModule } from '../../modules/mip-events/client'
import { mipBranchesModule, mipIdentityModule } from '../../modules/mip-identity/client'
import { caseNavigateTo, syncCaseNavigation } from '../../modules/platform/case-navigation'

interface EventCardView extends MipEventListItem {
  startsText: string
  accessLabel: string
  statusLabel: string
  locationText: string
}

function formatDateTime(value: string) {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) {
    return ''
  }
  return `${date.getMonth() + 1}月${date.getDate()}日 ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

function accessLabel(event: MipEventListItem) {
  if (event.accessType === 'MEMBER_INCLUDED') {
    return '仅玩家'
  }
  if (event.accessType === 'PAID') {
    return '付费活动'
  }
  return '免费活动'
}

function statusLabel(event: MipEventListItem) {
  if (event.registrationStatus === 'ATTENDED') {
    return '已签到'
  }
  if (event.registrationStatus === 'REGISTERED') {
    return '已报名'
  }
  if (event.registrationStatus === 'WAITLISTED') {
    return '候补中'
  }
  if (event.registrationStatus === 'PENDING_REVIEW') {
    return '待审核'
  }
  if (event.status === 'CANCELLED') {
    return '已取消'
  }
  if (event.status === 'ENDED') {
    return '已结束'
  }
  return ''
}

function presentEvent(event: MipEventListItem): EventCardView {
  return {
    ...event,
    coverUrl: event.coverUrl || mipOperationsConfig.defaultCoverPaths.event,
    startsText: formatDateTime(event.startsAt),
    accessLabel: accessLabel(event),
    statusLabel: statusLabel(event),
    locationText: [event.cityName, event.venueName].filter(Boolean).join(' · ') || '地点待公布',
  }
}

Page({
  data: {
    state: 'loading' as 'loading' | 'ready' | 'error',
    view: 'UPCOMING' as EventListView,
    dateFilter: 'RECENT' as EventDateFilter,
    events: [] as EventCardView[],
    heroEvent: null as EventCardView | null,
    cities: [] as string[],
    selectedCity: '',
    searchInput: '',
    activeQuery: '',
    message: '',
  },
  requestSeq: 0,
  searchTimer: 0 as number | ReturnType<typeof setTimeout>,
  citySelectionInitialized: false,
  cityManuallySelected: false,
  cityInitialization: null as Promise<void> | null,

  onShow() {
    syncCaseNavigation(this, 'pages/events/index')
    void this.loadPage()
  },

  onUnload() {
    if (this.searchTimer) {
      clearTimeout(this.searchTimer)
    }
  },

  currentQuery(): EventFeedQuery {
    return {
      view: this.data.view,
      dateFilter: this.data.dateFilter,
      cityName: this.data.selectedCity || undefined,
      query: this.data.activeQuery || undefined,
    }
  },

  async loadPage(options: { force?: boolean } = {}) {
    await this.initializeDefaultCity()
    await this.loadEvents(options)
  },

  async initializeDefaultCity() {
    if (this.citySelectionInitialized || this.cityManuallySelected) {
      return
    }
    if (this.cityInitialization) {
      return this.cityInitialization
    }
    this.cityInitialization = (async () => {
      try {
        const snapshot = mipIdentityModule.peekSnapshot() || await mipIdentityModule.loadSnapshot()
        if (!snapshot.primaryBranchId) {
          return
        }
        const cachedBranches = mipBranchesModule.peek()
        const branchSnapshot = cachedBranches || await mipBranchesModule.load(
          snapshot.primaryBranchId,
          snapshot.userVersion,
        )
        const selectedCity = resolvePrimaryBranchCity(snapshot.primaryBranchId, branchSnapshot.branches)
        if (selectedCity && !this.cityManuallySelected) {
          this.setData({ selectedCity })
        }
      }
      catch {}
      finally {
        this.citySelectionInitialized = true
        this.cityInitialization = null
      }
    })()
    return this.cityInitialization
  },

  async loadEvents(options: { force?: boolean } = {}) {
    const query = this.currentQuery()
    const cached = mipEventsModule.peekEvents(query)
    if (cached) {
      this.applyFeed(cached)
    }
    else if (this.data.state !== 'ready') {
      this.setData({ state: 'loading', message: '' })
    }
    const requestSeq = this.requestSeq + 1
    this.requestSeq = requestSeq
    try {
      const feed = await mipEventsModule.listEvents(query, options)
      if (requestSeq !== this.requestSeq) {
        return
      }
      this.applyFeed(feed)
    }
    catch (error) {
      if (requestSeq !== this.requestSeq) {
        return
      }
      this.setData(cached
        ? { message: '活动更新失败，已保留上次结果。' }
        : { state: 'error', message: error instanceof Error ? error.message : '活动加载失败' })
    }
  },

  applyFeed(feed: Awaited<ReturnType<typeof mipEventsModule.listEvents>>) {
    const events = feed.items.map(presentEvent)
    this.setData({
      state: 'ready',
      events,
      heroEvent: events[0] || null,
      cities: feed.cities || [],
      message: '',
    })
  },

  async onPullDownRefresh() {
    try {
      await this.loadPage({ force: true })
    }
    finally {
      wx.stopPullDownRefresh()
    }
  },

  changeView(event: WechatMiniprogram.TouchEvent) {
    const view = String(event.currentTarget.dataset.view || '') as EventListView
    if (!['UPCOMING', 'PAST'].includes(view) || view === this.data.view) {
      return
    }
    this.setData({ view, dateFilter: view === 'PAST' ? 'ENDED' : 'RECENT', message: '' })
    void this.loadEvents()
  },

  changeDateFilter(event: WechatMiniprogram.TouchEvent) {
    const dateFilter = String(event.currentTarget.dataset.filter || '') as EventDateFilter
    if (!['RECENT', 'ENDED', 'TODAY'].includes(dateFilter) || dateFilter === this.data.dateFilter) {
      return
    }
    this.setData({
      dateFilter,
      view: dateFilter === 'ENDED' ? 'PAST' : 'UPCOMING',
      message: '',
    })
    void this.loadEvents()
  },

  selectCity() {
    const choices = ['全部城市', ...this.data.cities]
    if (choices.length === 1) {
      wx.showToast({ title: '暂无可选城市', icon: 'none' })
      return
    }
    wx.showActionSheet({
      itemList: choices,
      success: ({ tapIndex }) => {
        const selectedCity = tapIndex === 0 ? '' : choices[tapIndex]
        this.cityManuallySelected = true
        this.setData({ selectedCity })
        void this.loadEvents()
      },
    })
  },

  onSearchInput(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    this.setData({ searchInput: event.detail.value })
    if (this.searchTimer) {
      clearTimeout(this.searchTimer)
    }
    this.searchTimer = setTimeout(() => this.commitSearch(), 300)
  },

  onSearchConfirm() {
    if (this.searchTimer) {
      clearTimeout(this.searchTimer)
      this.searchTimer = 0
    }
    this.commitSearch()
  },

  clearSearch() {
    this.setData({ searchInput: '', activeQuery: '' })
    void this.loadEvents()
  },

  commitSearch() {
    const activeQuery = this.data.searchInput.trim()
    if (activeQuery !== this.data.activeQuery) {
      this.setData({ activeQuery })
      void this.loadEvents()
    }
  },

  openEvent(event: WechatMiniprogram.TouchEvent) {
    const eventId = String(event.currentTarget.dataset.eventId || '') as EventId
    if (eventId) {
      caseNavigateTo({ url: `/packages/member/mip-events/detail/index?eventId=${encodeURIComponent(eventId)}` })
    }
  },
})
