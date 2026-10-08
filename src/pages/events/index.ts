import type { EventCardView, RecapCardView } from '../../components/mip-activity-card/model'
import type { EventId } from '../../modules/mip'
import type { MipPublicBanner } from '../../modules/mip-banners'
import type {
  EventCalendarWeek,
  EventDateFilter,
  EventFeedQuery,
  EventListView,
} from '../../modules/mip-events'
import { presentEventCard, presentRecapCard } from '../../components/mip-activity-card/model'
import { mipBannerModule } from '../../modules/mip-banners'
import {
  buildEventCalendarMonth,
  eventInvitationPath,
  resolvePrimaryBranchCity,
} from '../../modules/mip-events'
import { mipEventsModule } from '../../modules/mip-events/client'
import { mipBranchesModule, mipIdentityModule } from '../../modules/mip-identity/client'
import { caseNavigateTo, syncCaseNavigation } from '../../platform/navigation/client'
import { clearPageMedia, updatePageMedia } from '../../platform/storage/component-media'
import { formatChineseMonthDay, formatLocalDate, parseLocalDate } from '../../utils/date'

type EventBannerView = MipPublicBanner

function rollingCalendarBoundary(yearOffset: number) {
  const today = new Date()
  return new Date(today.getFullYear() + yearOffset, yearOffset < 0 ? 0 : 11, yearOffset < 0 ? 1 : 31).getTime()
}

// MIW-37 figma 1819_17793: 稿内「今天」之前的日期为 #4c4c4c 不可选，起始边界即今天零点。
function startOfToday() {
  const today = new Date()
  return new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()
}

const calendarWeekdays = ['日', '一', '二', '三', '四', '五', '六']

Page({
  data: {
    state: 'loading' as 'loading' | 'ready' | 'error',
    view: 'UPCOMING' as EventListView,
    dateFilter: 'RECENT' as EventDateFilter,
    // 往期活动 tab 放的是后台配置的回顾条目（RecapCardView），与活动 feed 卡片共用列表渲染。
    events: [] as (EventCardView | RecapCardView)[],
    banners: [] as EventBannerView[],
    cities: [] as string[],
    selectedCity: '',
    searchInput: '',
    activeQuery: '',
    selectedDate: '',
    customDateLabel: '',
    cityNoticeVisible: false,
    calendarVisible: false,
    calendarYear: new Date().getFullYear(),
    calendarMonth: new Date().getMonth() + 1,
    calendarWeekdays,
    calendarWeeks: [] as EventCalendarWeek[],
    calendarSelected: '',
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
  shareInviteRequests: new Map<string, Promise<string>>(),
  // MIW-39 日历黄点：有活动的日期集合，只喂给 buildEventCalendarMonth，不进 wxml data。
  calendarEventDates: new Set<string>(),

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
    // MIW-57 往期活动 tab 的内容来自后台配置的回顾条目，不查活动 feed。
    if (this.data.view === 'PAST') {
      return this.loadRecaps(options)
    }
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

  // MIW-57：回顾条目走模块短缓存，下拉刷新 force 绕过；加载态/错误态与活动 feed 同一套。
  async loadRecaps(options: { force?: boolean } = {}) {
    const cached = mipEventsModule.peekRecaps()
    if (this.data.state !== 'ready' && !cached) {
      this.setData({ state: 'loading', message: '' })
    }
    const requestSeq = this.requestSeq + 1
    this.requestSeq = requestSeq
    try {
      const recaps = await mipEventsModule.listRecaps({ force: options.force === true })
      if (requestSeq !== this.requestSeq) {
        return
      }
      updatePageMedia(this, 'events', recaps.items.map(presentRecapCard))
      this.setData({
        state: 'ready',
        nextCursor: '',
        loadingMore: false,
        message: '',
      })
    }
    catch (error) {
      if (requestSeq !== this.requestSeq) {
        return
      }
      this.setData(cached
        ? { message: '往期活动更新失败，已保留上次结果。' }
        : { state: 'error', message: error instanceof Error ? error.message : '往期活动加载失败' })
    }
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
    // MIW-39：TODAY 快捷入口已随默认态「今天」文字一起移除，日期只从日历确认（CUSTOM）。
    const nextView = dateFilter === 'ENDED' ? 'PAST' : 'UPCOMING'
    if (!['RECENT', 'ENDED'].includes(dateFilter)
      || (dateFilter === this.data.dateFilter && this.data.view === nextView)) {
      return
    }
    this.setData({
      dateFilter,
      view: dateFilter === 'ENDED' ? 'PAST' : 'UPCOMING',
      selectedDate: '',
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
    const base = this.data.selectedDate ? parseLocalDate(this.data.selectedDate) : null
    const today = new Date()
    this.setData({
      calendarVisible: true,
      calendarYear: base ? base.getFullYear() : today.getFullYear(),
      calendarMonth: base ? base.getMonth() + 1 : today.getMonth() + 1,
      calendarSelected: this.data.selectedDate,
    })
    this.rebuildCalendar()
    void this.loadCalendarDates()
  },

  // MIW-39 figma 1819_17793：日历格子下的黄点 = 当天有活动；数据来自服务端日历接口，按可见月份取。
  async loadCalendarDates() {
    const { calendarYear: year, calendarMonth: month } = this.data
    try {
      const result = await mipEventsModule.getCalendarDates({
        dateFrom: formatLocalDate(new Date(year, month - 1, 1)),
        dateTo: formatLocalDate(new Date(year, month - 1, new Date(year, month, 0).getDate())),
        cityName: this.data.selectedCity || undefined,
      })
      this.calendarEventDates = new Set(result.dates)
    }
    catch {
      // 黄点拉取失败只降级为无点，不阻断选日期。
      this.calendarEventDates = new Set()
    }
    // 等待期间用户可能已翻月或关掉弹层，只重绘仍然可见的月份。
    if (this.data.calendarVisible && this.data.calendarYear === year && this.data.calendarMonth === month) {
      this.rebuildCalendar()
    }
  },

  rebuildCalendar() {
    const { calendarYear, calendarMonth, calendarSelected, calendarMinDate, calendarMaxDate } = this.data
    this.setData({
      calendarWeeks: buildEventCalendarMonth({
        year: calendarYear,
        month: calendarMonth,
        selectedDate: calendarSelected,
        minDate: Math.max(calendarMinDate, startOfToday()),
        maxDate: calendarMaxDate,
        eventDates: this.calendarEventDates,
      }),
    })
  },

  // Steppers clamp to the same rolling window the grid disables days against.
  shiftCalendarYear(event: WechatMiniprogram.TouchEvent) {
    this.stepCalendarMonth(Number(event.currentTarget.dataset.delta) * 12)
  },

  shiftCalendarMonth(event: WechatMiniprogram.TouchEvent) {
    this.stepCalendarMonth(Number(event.currentTarget.dataset.delta))
  },

  stepCalendarMonth(delta: number) {
    const min = new Date(this.data.calendarMinDate)
    const max = new Date(this.data.calendarMaxDate)
    const current = this.data.calendarYear * 12 + this.data.calendarMonth - 1 + delta
    const clamped = Math.min(Math.max(current, min.getFullYear() * 12 + min.getMonth()), max.getFullYear() * 12 + max.getMonth())
    if (clamped === this.data.calendarYear * 12 + this.data.calendarMonth - 1) {
      return
    }
    this.setData({ calendarYear: Math.floor(clamped / 12), calendarMonth: clamped % 12 + 1 })
    this.rebuildCalendar()
    void this.loadCalendarDates()
  },

  pickCalendarDay(event: WechatMiniprogram.TouchEvent) {
    const selectedDate = String(event.currentTarget.dataset.date || '')
    if (!selectedDate || event.currentTarget.dataset.disabled) {
      return
    }
    this.setData({ calendarSelected: selectedDate })
    this.rebuildCalendar()
  },

  closeCalendar() {
    this.setData({ calendarVisible: false })
  },

  noop() {},

  closeCityNotice() {
    this.setData({ cityNoticeVisible: false })
  },

  confirmCalendar() {
    const selectedDate = this.data.calendarSelected
    const value = selectedDate ? parseLocalDate(selectedDate) : null
    if (!selectedDate || !value) {
      wx.showToast({ title: '请选择有效日期', icon: 'none' })
      return
    }
    // MIW-37 figma 1819_17793: 只有选中「今天」时标签才带「今天」，其他日期直接显示「M月D日」。
    const label = selectedDate === formatLocalDate(new Date()) ? '今天' : formatChineseMonthDay(value)
    this.setData({
      calendarVisible: false,
      selectedDate,
      customDateLabel: label,
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
    const content = {
      title: item?.title || 'MIP 活动',
      path: eventId ? eventInvitationPath(eventId) : '/pages/events/index',
      imageUrl: item?.coverUrl?.startsWith('cloud://') ? undefined : item?.coverUrl,
    }
    if (!eventId) {
      return content
    }
    // MIW-23：卡片按钮转发带上邀请 ref，服务端凭 openid 归属邀请人；游客或生成失败回落纯路径。
    return {
      ...content,
      promise: this.ensureEventInviteRef(eventId).then((inviteRef: string) => ({
        ...content,
        ...(inviteRef ? { path: eventInvitationPath(eventId, inviteRef) } : {}),
      })),
    }
  },

  // Page 自定义属性在多实例间按引用共享，按 eventId 键控后跨实例复用也是同活动同用户的合法 ref。
  ensureEventInviteRef(eventId: string): Promise<string> {
    const pending = this.shareInviteRequests.get(eventId)
    if (pending) {
      return pending
    }
    const request = mipEventsModule.createInvitation(eventId as EventId).then(
      result => result.inviteRef,
      () => {
        this.shareInviteRequests.delete(eventId)
        return ''
      },
    )
    this.shareInviteRequests.set(eventId, request)
    return request
  },
})
