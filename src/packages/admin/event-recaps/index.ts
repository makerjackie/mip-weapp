import type {
  AdminEventCatalogStatus,
  AdminEventVideoRecap,
} from '../../../modules/mip-admin'
import type { AdminPageState } from '../shared/page-state'
import type { EventRecapEventOption, EventVideoRecapView } from './model'
import { mipAdminModule } from '../../../modules/mip-admin'
import {
  adminLoadFailure,
  isAdminForbiddenError,
  isAdminVersionConflict,
} from '../shared/page-state'
import {
  canReadRecapEventOptions,
  eventRecapEventOption,
  eventVideoRecapDraftError,
  eventVideoRecapView,
  hasPlatformRecapCapability,
  validEventId,
} from './model'

const pageLimit = 20

Page({
  loadSequence: 0,
  eventOptionSequence: 0,

  data: {
    state: 'loading' as AdminPageState,
    items: [] as EventVideoRecapView[],
    statusFilter: '' as AdminEventCatalogStatus | '',
    eventIdInput: '',
    appliedEventId: '',
    queryInput: '',
    appliedQuery: '',
    nextCursor: null as string | null,
    loadingMore: false,
    canManage: false,
    eventCatalogState: 'idle' as 'idle' | 'loading' | 'ready' | 'unavailable',
    eventCatalogMessage: '',
    eventOptions: [] as EventRecapEventOption[],
    eventSearchInput: '',
    appliedEventSearch: '',
    eventOptionsNextCursor: null as string | null,
    eventOptionsLoadingMore: false,
    eventPickerOpen: false,
    eventPickerTarget: 'FILTER' as 'FILTER' | 'EDITOR',
    filterEventTitle: '',
    editorEventTitle: '',
    editorOpen: false,
    editorId: '',
    editorVersion: 0,
    editorEventId: '',
    editorTitle: '',
    editorSummary: '',
    destinationType: 'PROFILE' as AdminEventVideoRecap['destination']['type'],
    finderUserName: '',
    feedId: '',
    editorSortOrder: '0',
    saving: false,
    processingId: '',
    message: '',
    filterError: '',
    editorError: '',
  },

  onLoad(query: Record<string, string>) {
    const eventId = String(query.eventId || '').trim()
    if (validEventId(eventId)) {
      this.setData({ eventIdInput: eventId, appliedEventId: eventId })
    }
  },

  onShow() {
    void this.loadRecaps()
  },

  retryLoad() {
    void this.loadRecaps(true)
  },

  async loadRecaps(force = false, append = false) {
    if (append && (!this.data.nextCursor || this.data.loadingMore || this.data.state !== 'ready')) {
      return false
    }
    const sequence = this.loadSequence + 1
    this.loadSequence = sequence
    const input = {
      eventId: this.data.appliedEventId || undefined,
      status: this.data.statusFilter,
      query: this.data.appliedQuery,
      cursor: append ? this.data.nextCursor || undefined : undefined,
      limit: pageLimit,
    }
    const hasContent = this.data.items.length > 0
    this.setData(append
      ? { loadingMore: true, message: '' }
      : { ...(!hasContent ? { state: 'loading' as AdminPageState } : {}), message: '' })
    try {
      const session = await mipAdminModule.getSession(force)
      if (sequence !== this.loadSequence) {
        return false
      }
      if (!session.enabled || !hasPlatformRecapCapability(session.capabilities)) {
        this.setData({
          state: 'forbidden',
          canManage: false,
          items: [],
          nextCursor: null,
          editorOpen: false,
          message: '',
        })
        return false
      }
      const response = await mipAdminModule.eventCatalogs.listRecaps(input, force)
      if (sequence !== this.loadSequence) {
        return false
      }
      const incoming = response.items.map(eventVideoRecapView)
      this.setData({
        state: 'ready',
        canManage: true,
        items: append ? this.data.items.concat(incoming) : incoming,
        nextCursor: response.nextCursor || null,
        message: '',
      })
      if (!append && this.data.eventCatalogState === 'idle') {
        await this.loadEventOptions(force)
      }
      return true
    }
    catch (error) {
      if (sequence === this.loadSequence) {
        if (isAdminForbiddenError(error)) {
          this.setData({
            state: 'forbidden',
            canManage: false,
            items: [],
            nextCursor: null,
            editorOpen: false,
            message: '',
          })
          return false
        }
        this.setData(adminLoadFailure(error, {
          hasContent,
          fallbackMessage: append ? '更多视频回顾加载失败' : '视频回顾加载失败',
        }))
      }
      return false
    }
    finally {
      if (sequence === this.loadSequence) {
        this.setData({ loadingMore: false })
      }
    }
  },

  async loadEventOptions(force = false, append = false) {
    if (append && (!this.data.eventOptionsNextCursor
      || this.data.eventOptionsLoadingMore
      || this.data.eventCatalogState !== 'ready')) {
      return false
    }
    const sequence = this.eventOptionSequence + 1
    this.eventOptionSequence = sequence
    this.setData(append
      ? { eventOptionsLoadingMore: true, eventCatalogMessage: '' }
      : { eventCatalogState: 'loading', eventCatalogMessage: '' })
    try {
      const session = await mipAdminModule.getSession(force)
      if (sequence !== this.eventOptionSequence) {
        return false
      }
      if (!session.enabled || !canReadRecapEventOptions(session.capabilities)) {
        this.setData({
          eventCatalogState: 'unavailable',
          eventCatalogMessage: '当前账号不能读取活动列表，可继续填写活动 ID。',
          eventOptions: [],
          eventOptionsNextCursor: null,
        })
        return false
      }
      const response = await mipAdminModule.events.list({
        filters: { query: this.data.appliedEventSearch },
        sort: { field: 'startsAt', direction: 'DESC' },
        cursor: append ? this.data.eventOptionsNextCursor || undefined : undefined,
        limit: 20,
      }, force)
      if (sequence !== this.eventOptionSequence) {
        return false
      }
      const incoming = response.items.map(eventRecapEventOption)
      const eventOptions = append ? this.data.eventOptions.concat(incoming) : incoming
      const filterMatch = eventOptions.find(option => option.id === this.data.eventIdInput)
      const editorMatch = eventOptions.find(option => option.id === this.data.editorEventId)
      this.setData({
        eventCatalogState: 'ready',
        eventCatalogMessage: '',
        eventOptions,
        eventOptionsNextCursor: response.nextCursor || null,
        ...(filterMatch ? { filterEventTitle: filterMatch.title } : {}),
        ...(editorMatch ? { editorEventTitle: editorMatch.title } : {}),
      })
      return true
    }
    catch {
      if (sequence === this.eventOptionSequence) {
        this.setData(append
          ? {
              eventCatalogMessage: '更多活动加载失败，请重试。',
            }
          : {
              eventCatalogState: 'unavailable',
              eventCatalogMessage: '活动列表暂时无法加载，可继续填写活动 ID。',
              eventOptions: [],
              eventOptionsNextCursor: null,
            })
      }
      return false
    }
    finally {
      if (sequence === this.eventOptionSequence) {
        this.setData({ eventOptionsLoadingMore: false })
      }
    }
  },

  openEventPicker(event: WechatMiniprogram.TouchEvent) {
    if (this.data.saving) {
      return
    }
    const target = String(event.currentTarget.dataset.target || '')
    if (!['FILTER', 'EDITOR'].includes(target)) {
      return
    }
    this.setData({
      eventPickerOpen: true,
      eventPickerTarget: target as 'FILTER' | 'EDITOR',
    })
  },

  closeEventPicker() {
    this.setData({ eventPickerOpen: false })
  },

  updateEventSearch(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    if (this.data.saving) {
      return
    }
    this.setData({ eventSearchInput: event.detail.value })
  },

  searchEventOptions() {
    if (this.data.saving) {
      return
    }
    if (this.data.eventSearchInput.trim().length > 80) {
      this.setData({ eventCatalogMessage: '活动搜索内容不能超过 80 个字符' })
      return
    }
    this.setData({
      appliedEventSearch: this.data.eventSearchInput.trim(),
      eventOptions: [],
      eventOptionsNextCursor: null,
    })
    void this.loadEventOptions(true)
  },

  retryEventOptions() {
    if (this.data.saving) {
      return
    }
    void this.loadEventOptions(true)
  },

  loadMoreEventOptions() {
    if (this.data.saving) {
      return
    }
    void this.loadEventOptions(false, true)
  },

  chooseEventOption(event: WechatMiniprogram.TouchEvent) {
    if (this.data.saving) {
      return
    }
    const id = String(event.currentTarget.dataset.id || '')
    const item = this.data.eventOptions.find(option => option.id === id)
    if (!item) {
      return
    }
    this.setData({
      [this.data.eventPickerTarget === 'EDITOR' ? 'editorEventId' : 'eventIdInput']: item.id,
      [this.data.eventPickerTarget === 'EDITOR' ? 'editorEventTitle' : 'filterEventTitle']: item.title,
      eventPickerOpen: false,
      filterError: '',
      editorError: '',
    })
  },

  updateFilterField(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    if (this.data.saving) {
      return
    }
    const field = String(event.currentTarget.dataset.field || '')
    if (field === 'eventIdInput' && this.data.eventCatalogState !== 'unavailable') {
      return
    }
    if (['eventIdInput', 'queryInput'].includes(field)) {
      this.setData({ [field]: event.detail.value, filterError: '' })
    }
  },

  applyFilters() {
    if (this.data.saving) {
      return
    }
    const eventId = this.data.eventIdInput.trim()
    const query = this.data.queryInput.trim()
    if (eventId && !validEventId(eventId)) {
      this.setData({ filterError: '活动 ID 格式无效' })
      return
    }
    if (query.length > 80) {
      this.setData({ filterError: '搜索内容不能超过 80 个字符' })
      return
    }
    this.setData({
      appliedEventId: eventId,
      appliedQuery: query,
      items: [],
      nextCursor: null,
      filterError: '',
      message: '',
    })
    void this.loadRecaps(true)
  },

  clearFilters() {
    if (this.data.saving) {
      return
    }
    this.setData({
      eventIdInput: '',
      appliedEventId: '',
      queryInput: '',
      appliedQuery: '',
      statusFilter: '',
      items: [],
      nextCursor: null,
      filterError: '',
      filterEventTitle: '',
      message: '',
    })
    void this.loadRecaps(true)
  },

  chooseStatus(event: WechatMiniprogram.TouchEvent) {
    if (this.data.saving) {
      return
    }
    const raw = String(event.currentTarget.dataset.status || '')
    const statusFilter = ['ACTIVE', 'INACTIVE', 'ARCHIVED'].includes(raw)
      ? raw as AdminEventCatalogStatus
      : ''
    if (statusFilter === this.data.statusFilter) {
      return
    }
    this.setData({ statusFilter, items: [], nextCursor: null, message: '' })
    void this.loadRecaps(true)
  },

  loadMore() {
    if (this.data.saving) {
      return
    }
    void this.loadRecaps(false, true)
  },

  onReachBottom() {
    this.loadMore()
  },

  openCreate() {
    if (!this.data.canManage || this.data.saving || this.data.processingId || this.data.editorOpen) {
      return
    }
    this.setData({
      editorOpen: true,
      editorId: '',
      editorVersion: 0,
      editorEventId: this.data.appliedEventId,
      editorEventTitle: this.data.filterEventTitle,
      editorTitle: '',
      editorSummary: '',
      destinationType: 'PROFILE',
      finderUserName: '',
      feedId: '',
      editorSortOrder: '0',
      editorError: '',
    })
  },

  editRecap(event: WechatMiniprogram.TouchEvent) {
    if (!this.data.canManage || this.data.saving || this.data.processingId || this.data.editorOpen) {
      return
    }
    const id = String(event.currentTarget.dataset.id || '')
    const item = this.data.items.find(candidate => candidate.id === id)
    if (!item || item.status === 'ARCHIVED') {
      return
    }
    this.setData({
      editorOpen: true,
      editorId: item.id,
      editorVersion: item.version,
      editorEventId: item.eventId,
      editorEventTitle: item.eventTitle,
      editorTitle: item.title,
      editorSummary: item.summary,
      destinationType: item.destination.type,
      finderUserName: item.destination.finderUserName,
      feedId: item.destination.feedId || '',
      editorSortOrder: String(item.sortOrder),
      editorError: '',
    })
  },

  updateEditorField(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    if (this.data.saving) {
      return
    }
    const field = String(event.currentTarget.dataset.field || '')
    if (field === 'editorEventId' && this.data.eventCatalogState !== 'unavailable') {
      return
    }
    if (['editorEventId', 'editorTitle', 'editorSummary', 'finderUserName', 'feedId', 'editorSortOrder'].includes(field)) {
      this.setData({
        [field]: event.detail.value,
        ...(field === 'editorEventId' ? { editorEventTitle: '' } : {}),
        editorError: '',
      })
    }
  },

  chooseDestination(event: WechatMiniprogram.TouchEvent) {
    if (this.data.saving) {
      return
    }
    const destinationType = String(event.currentTarget.dataset.type || '')
    if (!['PROFILE', 'ACTIVITY'].includes(destinationType)) {
      return
    }
    this.setData({
      destinationType: destinationType as AdminEventVideoRecap['destination']['type'],
      ...(destinationType === 'PROFILE' ? { feedId: '' } : {}),
      editorError: '',
    })
  },

  closeEditor() {
    if (!this.data.saving) {
      this.setData({ editorOpen: false, editorId: '', editorError: '' })
    }
  },

  async saveRecap() {
    if (!this.data.canManage || this.data.saving || this.data.processingId) {
      return
    }
    const updating = Boolean(this.data.editorId)
    const draft = {
      eventId: this.data.editorEventId,
      title: this.data.editorTitle,
      summary: this.data.editorSummary,
      destinationType: this.data.destinationType,
      finderUserName: this.data.finderUserName,
      feedId: this.data.feedId,
      sortOrder: this.data.editorSortOrder,
    }
    const validationError = eventVideoRecapDraftError(draft)
    if (validationError) {
      this.setData({ editorError: validationError })
      return
    }
    const common = {
      eventId: this.data.editorEventId.trim(),
      title: this.data.editorTitle.trim(),
      summary: this.data.editorSummary.trim(),
      destination: {
        provider: 'WECHAT_CHANNELS' as const,
        type: this.data.destinationType,
        finderUserName: this.data.finderUserName.trim(),
        feedId: this.data.destinationType === 'PROFILE' ? null : this.data.feedId.trim(),
      },
      sortOrder: Number(this.data.editorSortOrder),
    }
    this.setData({ saving: true, editorError: '', message: '' })
    try {
      if (updating) {
        await mipAdminModule.eventCatalogs.saveRecap({
          recapId: this.data.editorId,
          expectedVersion: this.data.editorVersion,
          ...common,
        })
      }
      else {
        await mipAdminModule.eventCatalogs.saveRecap(common)
      }
      this.setData({ editorOpen: false, editorId: '' })
      await this.loadRecaps(true)
      wx.showToast({ title: updating ? '视频回顾已更新' : '视频回顾已创建', icon: 'success' })
    }
    catch (error) {
      await this.handleMutationError(error, '视频回顾保存失败', updating)
    }
    finally {
      this.setData({ saving: false })
    }
  },

  async changeStatus(event: WechatMiniprogram.TouchEvent) {
    if (!this.data.canManage || this.data.saving || this.data.processingId || this.data.editorOpen) {
      return
    }
    const id = String(event.currentTarget.dataset.id || '')
    const item = this.data.items.find(candidate => candidate.id === id)
    if (!item || item.status === 'ARCHIVED') {
      return
    }
    const status = item.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE'
    this.setData({ processingId: item.id, message: '' })
    try {
      await mipAdminModule.eventCatalogs.changeRecapStatus({
        recapId: item.id,
        expectedVersion: item.version,
        status,
      })
      await this.loadRecaps(true)
      wx.showToast({ title: status === 'ACTIVE' ? '已启用' : '已停用', icon: 'success' })
    }
    catch (error) {
      await this.handleMutationError(error, '视频回顾状态更新失败', false)
    }
    finally {
      this.setData({ processingId: '' })
    }
  },

  async archiveRecap(event: WechatMiniprogram.TouchEvent) {
    if (!this.data.canManage || this.data.saving || this.data.processingId || this.data.editorOpen) {
      return
    }
    const id = String(event.currentTarget.dataset.id || '')
    const item = this.data.items.find(candidate => candidate.id === id)
    if (!item || item.status === 'ARCHIVED') {
      return
    }
    const confirmation = await wx.showModal({
      title: '归档视频回顾',
      content: '归档后不会继续展示，历史记录会保留。',
      editable: true,
      placeholderText: '填写归档原因',
      confirmText: '确认归档',
      confirmColor: '#E65C5C',
    }).catch(() => null)
    const reason = String(confirmation?.content || '').trim()
    if (!confirmation?.confirm) {
      return
    }
    if (!reason) {
      this.setData({ message: '请填写归档原因' })
      return
    }
    if (reason.length > 300) {
      this.setData({ message: '归档原因不能超过 300 个字符' })
      return
    }
    this.setData({ processingId: item.id, message: '' })
    try {
      await mipAdminModule.eventCatalogs.archiveRecap({
        recapId: item.id,
        expectedVersion: item.version,
        reason,
      })
      await this.loadRecaps(true)
      wx.showToast({ title: '已归档', icon: 'success' })
    }
    catch (error) {
      await this.handleMutationError(error, '视频回顾归档失败', false)
    }
    finally {
      this.setData({ processingId: '' })
    }
  },

  async handleMutationError(error: unknown, fallbackMessage: string, closeStaleEditor: boolean) {
    if (isAdminForbiddenError(error)) {
      this.setData({
        state: 'forbidden',
        canManage: false,
        items: [],
        nextCursor: null,
        editorOpen: false,
        message: '',
      })
      return
    }
    if (isAdminVersionConflict(error)) {
      if (closeStaleEditor) {
        this.setData({ editorOpen: false, editorId: '' })
      }
      const refreshed = await this.loadRecaps(true)
      if (this.data.state !== 'forbidden') {
        this.setData({
          message: refreshed
            ? closeStaleEditor
              ? '记录已被其他人更新，列表已刷新，请重新编辑。'
              : '记录状态已变化，列表已刷新，请重试。'
            : '记录状态已变化，自动刷新失败，请手动重新加载。',
        })
      }
      return
    }
    this.setData({
      [this.data.editorOpen ? 'editorError' : 'message']: error instanceof Error
        ? error.message
        : fallbackMessage,
    })
  },
})
