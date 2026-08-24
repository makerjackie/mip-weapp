import type { EventId } from '../../modules/mip'
import type { MipPublicBanner } from '../../modules/mip-banners'
import type {
  EventDateFilter,
  EventFeedQuery,
  EventListView,
  MipEventListItem,
} from '../../modules/mip-events'
import { mipOperationsConfig } from '../../config/mip-operations'
import { mipBannerModule } from '../../modules/mip-banners'
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

type EventBannerView = MipPublicBanner

function fallbackEventBanners(): EventBannerView[] {
  return mipOperationsConfig.eventBanners.map((item, index) => ({
    id: item.id,
    title: item.accessibilityLabel,
    accessibilityLabel: item.accessibilityLabel,
    imageUrl: item.imagePath,
    targetType: item.targetType === 'ARTICLE' ? 'ARTICLE_URL' : 'MINIPROGRAM_PATH',
    targetValue: item.target,
    sortOrder: index * 10,
  }))
}

function formatDateTime(value: string) {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) {
    return ''
  }
  return `${date.getMonth() + 1}月${date.getDate()}日 ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

function formatCalendarDate(value: number) {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) {
    return ''
  }
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-')
}

function formatCalendarLabel(value: number) {
  const date = new Date(value)
  return Number.isFinite(date.getTime())
    ? `${date.getMonth() + 1}月${date.getDate()}日`
    : ''
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
    banners: fallbackEventBanners(),
    videoChannelConfigured: Boolean(mipOperationsConfig.videoChannelFinderUserName),
    cities: [] as string[],
    selectedCity: '',
    searchInput: '',
    activeQuery: '',
    selectedDate: '',
    selectedDateLabel: '',
    customDateLabel: '',
    dateFrom: '',
    dateFromLabel: '',
    dateTo: '',
    dateToLabel: '',
    rangePanelVisible: false,
    calendarVisible: false,
    calendarTarget: 'SINGLE' as 'SINGLE' | 'FROM' | 'TO',
    calendarValue: Date.now(),
    calendarMinDate: new Date(new Date().getFullYear() - 1, 0, 1).getTime(),
    calendarMaxDate: new Date(new Date().getFullYear() + 2, 11, 31).getTime(),
    nextCursor: '',
    loadingMore: false,
    shareTokens: {} as Record<string, string>,
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

  currentQuery(cursor = ''): EventFeedQuery {
    return {
      view: this.data.view,
      dateFilter: this.data.dateFilter,
      cityName: this.data.selectedCity || undefined,
      date: this.data.dateFilter === 'CUSTOM' ? this.data.selectedDate : undefined,
      dateFrom: this.data.dateFrom || undefined,
      dateTo: this.data.dateTo || undefined,
      query: this.data.activeQuery || undefined,
      cursor: cursor || undefined,
    }
  },

  async loadPage(options: { force?: boolean } = {}) {
    await this.initializeDefaultCity()
    await Promise.all([
      this.loadEvents(options),
      this.loadBanners(options.force === true),
    ])
  },

  async loadBanners(force = false) {
    try {
      const banners = await mipBannerModule.listActive(force)
      this.setData({ banners: banners.length ? banners : fallbackEventBanners() })
    }
    catch {
      if (!this.data.banners.length) {
        this.setData({ banners: fallbackEventBanners() })
      }
    }
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

  async loadEvents(options: { force?: boolean, append?: boolean } = {}) {
    const cursor = options.append ? this.data.nextCursor : ''
    if (options.append && (!cursor || this.data.loadingMore)) {
      return
    }
    const query = this.currentQuery(cursor)
    const cached = mipEventsModule.peekEvents(query)
    if (options.append) {
      this.setData({ loadingMore: true })
    }
    else if (cached) {
      this.applyFeed(cached, false)
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
      this.applyFeed(feed, options.append === true)
    }
    catch (error) {
      if (requestSeq !== this.requestSeq) {
        return
      }
      this.setData(cached && !options.append
        ? { message: '活动更新失败，已保留上次结果。' }
        : options.append
          ? { loadingMore: false, message: '更多活动加载失败，请稍后重试。' }
          : { state: 'error', message: error instanceof Error ? error.message : '活动加载失败' })
    }
  },

  applyFeed(feed: Awaited<ReturnType<typeof mipEventsModule.listEvents>>, append = false) {
    const events = feed.items.map(presentEvent)
    const merged = append
      ? [...this.data.events, ...events.filter(item => !this.data.events.some(current => current.id === item.id))]
      : events
    this.setData({
      state: 'ready',
      events: merged,
      cities: feed.cities || [],
      nextCursor: feed.nextCursor || '',
      loadingMore: false,
      message: '',
    })
    void this.loadShareTokens(events)
  },

  async loadShareTokens(events: EventCardView[]) {
    const missing = events.filter(item => !this.data.shareTokens[item.id])
    if (!missing.length) {
      return
    }
    const entries = await Promise.all(missing.map(async (item) => {
      try {
        const invitation = await mipEventsModule.createInvitation(item.id)
        return [item.id, invitation.token] as const
      }
      catch {
        return [item.id, ''] as const
      }
    }))
    const shareTokens = { ...this.data.shareTokens }
    for (const [eventId, token] of entries) {
      if (token) {
        shareTokens[eventId] = token
      }
    }
    this.setData({ shareTokens })
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
    this.setData({
      view,
      dateFilter: view === 'PAST' ? 'ENDED' : 'RECENT',
      selectedDate: '',
      selectedDateLabel: '',
      customDateLabel: '',
      dateFrom: '',
      dateFromLabel: '',
      dateTo: '',
      dateToLabel: '',
      nextCursor: '',
      message: '',
    })
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
      selectedDate: '',
      selectedDateLabel: '',
      customDateLabel: '',
      dateFrom: '',
      dateFromLabel: '',
      dateTo: '',
      dateToLabel: '',
      nextCursor: '',
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
        this.setData({ selectedCity, nextCursor: '' })
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
      this.setData({ activeQuery, nextCursor: '' })
      void this.loadEvents()
    }
  },

  showCalendar() {
    this.setData({ calendarVisible: true, calendarTarget: 'SINGLE' })
  },

  showRangeCalendar(event: WechatMiniprogram.TouchEvent) {
    const target = String(event.currentTarget.dataset.target || '') as 'FROM' | 'TO'
    if (target !== 'FROM' && target !== 'TO') {
      return
    }
    this.setData({ calendarVisible: true, calendarTarget: target })
  },

  toggleRangePanel() {
    this.setData({ rangePanelVisible: !this.data.rangePanelVisible })
  },

  closeCalendar() {
    this.setData({ calendarVisible: false })
  },

  confirmCalendar(event: WechatMiniprogram.CustomEvent<{ value: number | number[] }>) {
    const value = Array.isArray(event.detail.value) ? event.detail.value[0] : event.detail.value
    const selectedDate = formatCalendarDate(value)
    if (!selectedDate) {
      wx.showToast({ title: '请选择有效日期', icon: 'none' })
      return
    }
    const label = formatCalendarLabel(value)
    if (this.data.calendarTarget === 'FROM') {
      if (this.data.dateTo && selectedDate > this.data.dateTo) {
        wx.showToast({ title: '开始日期不能晚于结束日期', icon: 'none' })
        return
      }
      this.setData({
        calendarVisible: false,
        calendarValue: value,
        dateFrom: selectedDate,
        dateFromLabel: label,
        dateFilter: 'CUSTOM',
        selectedDate: '',
        selectedDateLabel: '',
        customDateLabel: this.data.dateToLabel ? `${label} - ${this.data.dateToLabel}` : `${label}起`,
        view: 'UPCOMING',
        nextCursor: '',
        message: '',
      })
    }
    else if (this.data.calendarTarget === 'TO') {
      if (this.data.dateFrom && selectedDate < this.data.dateFrom) {
        wx.showToast({ title: '结束日期不能早于开始日期', icon: 'none' })
        return
      }
      this.setData({
        calendarVisible: false,
        calendarValue: value,
        dateTo: selectedDate,
        dateToLabel: label,
        dateFilter: 'CUSTOM',
        selectedDate: '',
        selectedDateLabel: '',
        customDateLabel: this.data.dateFromLabel ? `${this.data.dateFromLabel} - ${label}` : `截至${label}`,
        view: 'UPCOMING',
        nextCursor: '',
        message: '',
      })
    }
    else {
      this.setData({
        calendarVisible: false,
        calendarValue: value,
        selectedDate,
        selectedDateLabel: label,
        customDateLabel: label,
        dateFrom: '',
        dateFromLabel: '',
        dateTo: '',
        dateToLabel: '',
        dateFilter: 'CUSTOM',
        view: 'UPCOMING',
        nextCursor: '',
        message: '',
      })
    }
    void this.loadEvents()
  },

  clearDateRange() {
    if (!this.data.dateFrom && !this.data.dateTo) {
      return
    }
    this.setData({
      dateFrom: '',
      dateFromLabel: '',
      dateTo: '',
      dateToLabel: '',
      customDateLabel: this.data.selectedDateLabel,
      dateFilter: this.data.selectedDate ? 'CUSTOM' : 'RECENT',
      nextCursor: '',
      message: '',
    })
    void this.loadEvents()
  },

  openBanner(event: WechatMiniprogram.TouchEvent) {
    const bannerId = String(event.currentTarget.dataset.bannerId || '')
    const banner = this.data.banners.find(item => item.id === bannerId)
    if (!banner) {
      return
    }
    if (banner.targetType === 'ARTICLE_URL') {
      wx.openOfficialAccountArticle({
        url: banner.targetValue,
        fail: () => wx.showToast({ title: '文章暂未配置', icon: 'none' }),
      })
      return
    }
    if (banner.targetValue && banner.targetValue !== '/pages/events/index') {
      caseNavigateTo({ url: banner.targetValue })
    }
  },

  openPastReview() {
    const finderUserName = mipOperationsConfig.videoChannelFinderUserName
    if (!finderUserName) {
      return
    }
    wx.openChannelsUserProfile({
      finderUserName,
      fail: () => wx.showToast({ title: '暂时无法打开视频号', icon: 'none' }),
    })
  },

  loadMore() {
    void this.loadEvents({ append: true })
  },

  stopPropagation() {},

  openEvent(event: WechatMiniprogram.TouchEvent) {
    const eventId = String(event.currentTarget.dataset.eventId || '') as EventId
    if (eventId) {
      caseNavigateTo({ url: `/packages/member/mip-events/detail/index?eventId=${encodeURIComponent(eventId)}` })
    }
  },

  onShareAppMessage(event: WechatMiniprogram.Page.IShareAppMessageOption) {
    const eventId = String(event.target?.dataset?.eventId || '')
    const item = this.data.events.find(current => current.id === eventId)
    const token = eventId ? this.data.shareTokens[eventId] : ''
    const invitation = token ? `&invitationToken=${encodeURIComponent(token)}` : ''
    return {
      title: item?.title || 'MIP 活动',
      path: eventId
        ? `/packages/member/mip-events/detail/index?eventId=${encodeURIComponent(eventId)}${invitation}`
        : '/pages/events/index',
      imageUrl: item?.coverUrl,
    }
  },
})
