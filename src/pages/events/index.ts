import type { EventCardView } from '../../components/mip-activity-card/model'
import type { EventId } from '../../modules/mip'
import type { MipPublicBanner } from '../../modules/mip-banners'
import type {
  EventDateFilter,
  EventFeedQuery,
  EventListView,
} from '../../modules/mip-events'
import { presentEventCard } from '../../components/mip-activity-card/model'
import { mipOperationsConfig } from '../../config/mip-operations'
import { mipBannerModule } from '../../modules/mip-banners'
import { resolvePrimaryBranchCity } from '../../modules/mip-events'
import { mipEventsModule } from '../../modules/mip-events/client'
import { mipBranchesModule, mipIdentityModule } from '../../modules/mip-identity/client'
import { caseNavigateTo, syncCaseNavigation } from '../../platform/navigation/client'
import { clearPageMedia, updatePageMedia } from '../../platform/storage/component-media'
import { formatChineseMonthDay, formatLocalDate } from '../../utils/date'

type EventBannerView = MipPublicBanner

function rollingCalendarBoundary(yearOffset: number) {
  const today = new Date()
  return new Date(today.getFullYear() + yearOffset, yearOffset < 0 ? 0 : 11, yearOffset < 0 ? 1 : 31).getTime()
}

Page({
  data: {
    state: 'loading' as 'loading' | 'ready' | 'error',
    view: 'UPCOMING' as EventListView,
    dateFilter: 'RECENT' as EventDateFilter,
    events: [] as EventCardView[],
    banners: [] as EventBannerView[],
    videoChannelConfigured: Boolean(mipOperationsConfig.videoChannelFinderUserName),
    cities: [] as string[],
    selectedCity: '',
    searchInput: '',
    activeQuery: '',
    selectedDate: '',
    selectedDateLabel: '',
    customDateLabel: '',
    cityNoticeVisible: false,
    calendarVisible: false,
    calendarValue: Date.now(),
    calendarMinDate: rollingCalendarBoundary(-5),
    calendarMaxDate: rollingCalendarBoundary(10),
    nextCursor: '',
    loadingMore: false,
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
    clearPageMedia(this)
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
      query: this.data.activeQuery || undefined,
      cursor: cursor || undefined,
    }
  },

  async loadPage(options: { force?: boolean } = {}) {
    await Promise.all([
      this.initializeDefaultCity().then(() => this.loadEvents(options)),
      this.loadBanners(options.force === true),
    ])
  },

  async loadBanners(force = false) {
    try {
      const banners = await mipBannerModule.listActive(force)
      this.setData({ banners })
    }
    catch {}
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
      const feed = await mipEventsModule.listEvents(query, {
        force: options.force === true || Boolean(cached),
      })
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
    const events = feed.items.map(presentEventCard)
    const merged = append
      ? [...this.data.events, ...events.filter(item => !this.data.events.some(current => current.id === item.id))]
      : events
    updatePageMedia(this, 'events', merged)
    this.setData({
      state: 'ready',
      cities: feed.cities || [],
      nextCursor: feed.nextCursor || '',
      loadingMore: false,
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

  changeDateFilter(event: WechatMiniprogram.TouchEvent) {
    const dateFilter = String(event.currentTarget.dataset.filter || '') as EventDateFilter
    // 「已结束」status radio only sets dateFilter and keeps the upcoming view, so the returning
    // 往期活动 tab must still be able to flip the view for the same dateFilter.
    const nextView = dateFilter === 'ENDED' ? 'PAST' : 'UPCOMING'
    if (!['RECENT', 'ENDED', 'TODAY'].includes(dateFilter)
      || (dateFilter === this.data.dateFilter && this.data.view === nextView)) {
      return
    }
    this.setData({
      dateFilter,
      view: dateFilter === 'ENDED' ? 'PAST' : 'UPCOMING',
      selectedDate: '',
      selectedDateLabel: '',
      customDateLabel: '',
      nextCursor: '',
      message: '',
    })
    void this.loadEvents()
  },

  // Status radios (figma 1819_18218): switch RECENT/ENDED inside the upcoming tab
  // without flipping the tab view the way changeDateFilter does.
  changeStatusFilter(event: WechatMiniprogram.TouchEvent) {
    const dateFilter = String(event.currentTarget.dataset.filter || '') as EventDateFilter
    if (!['RECENT', 'ENDED'].includes(dateFilter) || dateFilter === this.data.dateFilter) {
      return
    }
    this.setData({
      dateFilter,
      selectedDate: '',
      selectedDateLabel: '',
      customDateLabel: '',
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
    this.setData({ calendarVisible: true })
  },

  closeCalendar() {
    this.setData({ calendarVisible: false })
  },

  closeCityNotice() {
    this.setData({ cityNoticeVisible: false })
  },

  confirmCalendar(event: WechatMiniprogram.CustomEvent<{ value: number | number[] }>) {
    const value = Array.isArray(event.detail.value) ? event.detail.value[0] : event.detail.value
    const selectedDate = formatLocalDate(value)
    if (!selectedDate) {
      wx.showToast({ title: '请选择有效日期', icon: 'none' })
      return
    }
    this.setData({
      calendarVisible: false,
      calendarValue: value,
      selectedDate,
      selectedDateLabel: formatChineseMonthDay(value),
      customDateLabel: formatChineseMonthDay(value),
      dateFilter: 'CUSTOM',
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

  openEvent(event: WechatMiniprogram.TouchEvent) {
    const detail = (event as unknown as { detail?: { id?: string } }).detail
    const eventId = String(detail?.id || event.currentTarget?.dataset?.eventId || '') as EventId
    if (eventId) {
      caseNavigateTo({ url: `/packages/member/mip-events/detail/index?eventId=${encodeURIComponent(eventId)}` })
    }
  },

  onShareAppMessage(event: WechatMiniprogram.Page.IShareAppMessageOption) {
    const eventId = String(event.target?.dataset?.eventId || '')
    const item = this.data.events.find(current => current.id === eventId)
    return {
      title: item?.title || 'MIP 活动',
      path: eventId
        ? `/packages/member/mip-events/detail/index?eventId=${encodeURIComponent(eventId)}`
        : '/pages/events/index',
      imageUrl: item?.coverUrl?.startsWith('cloud://') ? undefined : item?.coverUrl,
    }
  },
})
