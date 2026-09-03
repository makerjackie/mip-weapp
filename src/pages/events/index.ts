import type { EventId } from '../../modules/mip'
import type { MipPublicBanner } from '../../modules/mip-banners'
import type {
  EventAccessType,
  EventDateFilter,
  EventDiscoveryOption,
  EventFeedQuery,
  EventListView,
  EventSortDirection,
  MipEventListItem,
} from '../../modules/mip-events'
import { mipOperationsConfig } from '../../config/mip-operations'
import { mipBannerModule } from '../../modules/mip-banners'
import { publicEventTypeLabel, resolvePrimaryBranchCity } from '../../modules/mip-events'
import { mipEventsModule } from '../../modules/mip-events/client'
import { mipBranchesModule, mipIdentityModule } from '../../modules/mip-identity/client'
import { caseNavigateTo, syncCaseNavigation } from '../../platform/navigation/client'
import { formatChineseMonthDay, formatChineseMonthDayTime, formatLocalDate } from '../../utils/date'

interface EventCardView extends MipEventListItem {
  startsText: string
  accessLabel: string
  statusLabel: string
  locationText: string
}

interface EventFilterOptionView extends EventDiscoveryOption {
  selected: boolean
}

type EventBannerView = MipPublicBanner

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
  const eventTypeLabel = publicEventTypeLabel(event.eventTypeLabel)
  return {
    ...event,
    coverUrl: event.coverUrl || '',
    startsText: formatChineseMonthDayTime(event.startsAt),
    accessLabel: accessLabel(event),
    statusLabel: statusLabel(event),
    locationText: [event.cityName, event.venueName].filter(Boolean).join(' · ') || '地点待公布',
    eventTypeLabel,
  }
}

function rollingCalendarBoundary(yearOffset: number) {
  const today = new Date()
  return new Date(today.getFullYear() + yearOffset, yearOffset < 0 ? 0 : 11, yearOffset < 0 ? 1 : 31).getTime()
}

function selectedOptions(
  options: EventDiscoveryOption[],
  selected: string | string[],
  presentNames = false,
): EventFilterOptionView[] {
  const keys = new Set(Array.isArray(selected) ? selected : selected ? [selected] : [])
  return options.map(option => ({
    ...option,
    name: presentNames ? publicEventTypeLabel(option.name, option.key) : option.name,
    selected: keys.has(option.key),
  }))
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
    eventTypeOptions: [] as EventFilterOptionView[],
    tagOptions: [] as EventFilterOptionView[],
    selectedEventTypeKey: '',
    selectedTagKeys: [] as string[],
    selectedAccessType: '' as '' | EventAccessType,
    selectedSortDirection: '' as '' | EventSortDirection,
    draftEventTypeKey: '',
    draftTagKeys: [] as string[],
    draftAccessType: '' as '' | EventAccessType,
    draftSortDirection: '' as '' | EventSortDirection,
    activeFilterCount: 0,
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
      eventTypeKey: this.data.selectedEventTypeKey || undefined,
      tagKeys: this.data.selectedTagKeys.length ? [...this.data.selectedTagKeys] : undefined,
      accessType: this.data.selectedAccessType || undefined,
      sortDirection: this.data.selectedSortDirection || undefined,
      query: this.data.activeQuery || undefined,
      cursor: cursor || undefined,
    }
  },

  async loadPage(options: { force?: boolean } = {}) {
    await this.initializeDefaultCity()
    await this.loadDiscoveryFilters(options.force === true)
    await Promise.all([
      this.loadEvents(options),
      this.loadBanners(options.force === true),
    ])
  },

  async loadDiscoveryFilters(force = false) {
    const cached = mipEventsModule.peekDiscoveryFilters()
    if (cached) {
      this.applyDiscoveryFilters(cached)
    }
    try {
      const filters = await mipEventsModule.getDiscoveryFilters({ force: force || Boolean(cached) })
      this.applyDiscoveryFilters(filters)
    }
    catch {
      // Activity discovery remains usable when the optional catalog request is unavailable.
    }
  },

  applyDiscoveryFilters(filters: Awaited<ReturnType<typeof mipEventsModule.getDiscoveryFilters>>) {
    const eventTypeKeys = new Set(filters.eventTypes.map(option => option.key))
    const tagKeys = new Set(filters.tags.map(option => option.key))
    const selectedEventTypeKey = eventTypeKeys.has(this.data.selectedEventTypeKey)
      ? this.data.selectedEventTypeKey
      : ''
    const selectedTagKeys = this.data.selectedTagKeys.filter(key => tagKeys.has(key))
    const draftEventTypeKey = eventTypeKeys.has(this.data.draftEventTypeKey)
      ? this.data.draftEventTypeKey
      : selectedEventTypeKey
    const draftTagKeys = this.data.draftTagKeys.filter(key => tagKeys.has(key))
    this.setData({
      selectedEventTypeKey,
      selectedTagKeys,
      draftEventTypeKey,
      draftTagKeys: draftTagKeys.length ? draftTagKeys : [...selectedTagKeys],
      eventTypeOptions: selectedOptions(filters.eventTypes, draftEventTypeKey, true),
      tagOptions: selectedOptions(filters.tags, draftTagKeys.length ? draftTagKeys : selectedTagKeys),
      activeFilterCount: this.countActiveFilters({ selectedEventTypeKey, selectedTagKeys }),
    })
  },

  countActiveFilters(overrides: {
    selectedEventTypeKey?: string
    selectedTagKeys?: string[]
    selectedAccessType?: '' | EventAccessType
    selectedSortDirection?: '' | EventSortDirection
  } = {}) {
    const typeKey = overrides.selectedEventTypeKey ?? this.data.selectedEventTypeKey
    const tagKeys = overrides.selectedTagKeys ?? this.data.selectedTagKeys
    const accessType = overrides.selectedAccessType ?? this.data.selectedAccessType
    const sortDirection = overrides.selectedSortDirection ?? this.data.selectedSortDirection
    return Number(Boolean(typeKey)) + tagKeys.length + Number(Boolean(accessType)) + Number(Boolean(sortDirection))
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
    if (this.data.rangePanelVisible) {
      this.setData({ rangePanelVisible: false })
      return
    }
    const draftEventTypeKey = this.data.selectedEventTypeKey
    const draftTagKeys = [...this.data.selectedTagKeys]
    this.setData({
      rangePanelVisible: true,
      draftEventTypeKey,
      draftTagKeys,
      draftAccessType: this.data.selectedAccessType,
      draftSortDirection: this.data.selectedSortDirection
        || (this.data.view === 'PAST' ? 'DESC' : 'ASC'),
      eventTypeOptions: selectedOptions(this.data.eventTypeOptions, draftEventTypeKey, true),
      tagOptions: selectedOptions(this.data.tagOptions, draftTagKeys),
    })
  },

  selectEventType(event: WechatMiniprogram.TouchEvent) {
    const key = String(event.currentTarget.dataset.key || '')
    if (!this.data.eventTypeOptions.some(option => option.key === key)) {
      return
    }
    const draftEventTypeKey = this.data.draftEventTypeKey === key ? '' : key
    this.setData({
      draftEventTypeKey,
      eventTypeOptions: selectedOptions(this.data.eventTypeOptions, draftEventTypeKey, true),
    })
  },

  toggleEventTag(event: WechatMiniprogram.TouchEvent) {
    const key = String(event.currentTarget.dataset.key || '')
    if (!this.data.tagOptions.some(option => option.key === key)) {
      return
    }
    const selected = new Set(this.data.draftTagKeys)
    if (selected.has(key)) {
      selected.delete(key)
    }
    else if (selected.size < 12) {
      selected.add(key)
    }
    else {
      wx.showToast({ title: '最多选择 12 个活动标签', icon: 'none' })
      return
    }
    const draftTagKeys = [...selected].sort()
    this.setData({
      draftTagKeys,
      tagOptions: selectedOptions(this.data.tagOptions, draftTagKeys),
    })
  },

  selectAccessType(event: WechatMiniprogram.TouchEvent) {
    const value = String(event.currentTarget.dataset.value || '') as '' | EventAccessType
    if (!['', 'FREE', 'MEMBER_INCLUDED', 'PAID'].includes(value)) {
      return
    }
    this.setData({ draftAccessType: value })
  },

  selectSortDirection(event: WechatMiniprogram.TouchEvent) {
    const value = String(event.currentTarget.dataset.value || '') as '' | EventSortDirection
    if (!['', 'ASC', 'DESC'].includes(value)) {
      return
    }
    this.setData({ draftSortDirection: value })
  },

  confirmDiscoveryFilters() {
    const selectedEventTypeKey = this.data.draftEventTypeKey
    const selectedTagKeys = [...this.data.draftTagKeys]
    const selectedAccessType = this.data.draftAccessType
    const selectedSortDirection = this.data.draftSortDirection
    this.setData({
      selectedEventTypeKey,
      selectedTagKeys,
      selectedAccessType,
      selectedSortDirection,
      activeFilterCount: this.countActiveFilters({
        selectedEventTypeKey,
        selectedTagKeys,
        selectedAccessType,
        selectedSortDirection,
      }),
      rangePanelVisible: false,
      nextCursor: '',
      message: '',
    })
    void this.loadEvents()
  },

  clearDiscoveryFilters() {
    const dateFilter: EventDateFilter = this.data.view === 'PAST' ? 'ENDED' : 'RECENT'
    this.setData({
      dateFilter,
      selectedDate: '',
      selectedDateLabel: '',
      customDateLabel: '',
      dateFrom: '',
      dateFromLabel: '',
      dateTo: '',
      dateToLabel: '',
      selectedEventTypeKey: '',
      selectedTagKeys: [],
      selectedAccessType: '',
      selectedSortDirection: '',
      draftEventTypeKey: '',
      draftTagKeys: [],
      draftAccessType: '',
      draftSortDirection: '',
      activeFilterCount: 0,
      eventTypeOptions: selectedOptions(this.data.eventTypeOptions, '', true),
      tagOptions: selectedOptions(this.data.tagOptions, []),
      rangePanelVisible: false,
      nextCursor: '',
      message: '',
    })
    void this.loadEvents()
  },

  closeCalendar() {
    this.setData({ calendarVisible: false })
  },

  confirmCalendar(event: WechatMiniprogram.CustomEvent<{ value: number | number[] }>) {
    const value = Array.isArray(event.detail.value) ? event.detail.value[0] : event.detail.value
    const selectedDate = formatLocalDate(value)
    if (!selectedDate) {
      wx.showToast({ title: '请选择有效日期', icon: 'none' })
      return
    }
    const label = formatChineseMonthDay(value)
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
      imageUrl: item?.coverUrl,
    }
  },
})
