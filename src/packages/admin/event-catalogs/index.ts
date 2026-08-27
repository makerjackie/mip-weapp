import type {
  AdminEventCatalogKind,
  AdminEventCatalogStatus,
} from '../../../modules/mip-admin'
import type { AdminPageState } from '../shared/page-state'
import type { EventCatalogView } from './model'
import { mipAdminModule } from '../../../modules/mip-admin'
import {
  adminLoadFailure,
  isAdminForbiddenError,
  isAdminVersionConflict,
} from '../shared/page-state'
import {
  eventCatalogDraftError,
  eventCatalogView,
  hasPlatformCatalogCapability,
} from './model'

const pageLimit = 20

Page({
  loadSequence: 0,

  data: {
    state: 'loading' as AdminPageState,
    kind: 'TYPE' as AdminEventCatalogKind,
    items: [] as EventCatalogView[],
    statusFilter: '' as AdminEventCatalogStatus | '',
    queryInput: '',
    appliedQuery: '',
    nextCursor: null as string | null,
    loadingMore: false,
    canManage: false,
    editorOpen: false,
    editorId: '',
    editorVersion: 0,
    editorKey: '',
    editorName: '',
    editorDescription: '',
    editorSortOrder: '0',
    saving: false,
    processingId: '',
    message: '',
    editorError: '',
  },

  onShow() {
    void this.loadCatalogs()
  },

  retryLoad() {
    void this.loadCatalogs(true)
  },

  async loadCatalogs(force = false, append = false) {
    if (append && (!this.data.nextCursor || this.data.loadingMore || this.data.state !== 'ready')) {
      return false
    }
    const sequence = this.loadSequence + 1
    this.loadSequence = sequence
    const input = {
      kind: this.data.kind,
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
      if (!session.enabled || !hasPlatformCatalogCapability(session.capabilities)) {
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
      const response = await mipAdminModule.eventCatalogs.listCatalogs(input, force)
      if (sequence !== this.loadSequence) {
        return false
      }
      const incoming = response.items.map(eventCatalogView)
      this.setData({
        state: 'ready',
        canManage: true,
        items: append ? this.data.items.concat(incoming) : incoming,
        nextCursor: response.nextCursor || null,
        message: '',
      })
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
          fallbackMessage: append ? '更多活动目录加载失败' : '活动目录加载失败',
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

  updateQuery(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    if (this.data.saving) {
      return
    }
    this.setData({ queryInput: event.detail.value })
  },

  searchCatalogs() {
    if (this.data.saving) {
      return
    }
    const query = this.data.queryInput.trim()
    if (query.length > 80) {
      this.setData({ message: '搜索内容不能超过 80 个字符' })
      return
    }
    this.setData({ appliedQuery: query, items: [], nextCursor: null, message: '' })
    void this.loadCatalogs(true)
  },

  chooseKind(event: WechatMiniprogram.TouchEvent) {
    if (this.data.saving || this.data.processingId || this.data.editorOpen) {
      return
    }
    const kind = String(event.currentTarget.dataset.kind || '')
    if (!['TYPE', 'TAG'].includes(kind) || kind === this.data.kind) {
      return
    }
    this.setData({
      kind: kind as AdminEventCatalogKind,
      items: [],
      nextCursor: null,
      editorOpen: false,
      editorId: '',
      editorError: '',
      message: '',
    })
    void this.loadCatalogs(true)
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
    void this.loadCatalogs(true)
  },

  loadMore() {
    void this.loadCatalogs(false, true)
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
      editorKey: '',
      editorName: '',
      editorDescription: '',
      editorSortOrder: '0',
      editorError: '',
    })
  },

  editCatalog(event: WechatMiniprogram.TouchEvent) {
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
      editorKey: item.key,
      editorName: item.name,
      editorDescription: item.description,
      editorSortOrder: String(item.sortOrder),
      editorError: '',
    })
  },

  updateEditorField(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    if (this.data.saving) {
      return
    }
    const field = String(event.currentTarget.dataset.field || '')
    if (['editorKey', 'editorName', 'editorDescription', 'editorSortOrder'].includes(field)) {
      this.setData({ [field]: event.detail.value, editorError: '' })
    }
  },

  closeEditor() {
    if (!this.data.saving) {
      this.setData({ editorOpen: false, editorId: '', editorError: '' })
    }
  },

  async saveCatalog() {
    if (!this.data.canManage || this.data.saving || this.data.processingId) {
      return
    }
    const updating = Boolean(this.data.editorId)
    const draft = {
      key: this.data.editorKey,
      name: this.data.editorName,
      description: this.data.editorDescription,
      sortOrder: this.data.editorSortOrder,
    }
    const validationError = eventCatalogDraftError(draft, updating, this.data.kind)
    if (validationError) {
      this.setData({ editorError: validationError })
      return
    }
    this.setData({ saving: true, editorError: '', message: '' })
    try {
      if (updating) {
        await mipAdminModule.eventCatalogs.saveCatalog({
          kind: this.data.kind,
          catalogId: this.data.editorId,
          expectedVersion: this.data.editorVersion,
          name: this.data.editorName.trim(),
          description: this.data.editorDescription.trim(),
          sortOrder: Number(this.data.editorSortOrder),
        })
      }
      else {
        await mipAdminModule.eventCatalogs.saveCatalog({
          kind: this.data.kind,
          key: this.data.editorKey.trim(),
          name: this.data.editorName.trim(),
          description: this.data.editorDescription.trim(),
          sortOrder: Number(this.data.editorSortOrder),
        })
      }
      this.setData({ editorOpen: false, editorId: '' })
      await this.loadCatalogs(true)
      wx.showToast({ title: updating ? '活动目录已更新' : '活动目录已创建', icon: 'success' })
    }
    catch (error) {
      if (!updating && isAdminVersionConflict(error)) {
        this.setData({ editorError: '稳定标识已存在，请使用其他标识。' })
        return
      }
      await this.handleMutationError(error, '活动目录保存失败', updating)
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
      await mipAdminModule.eventCatalogs.changeCatalogStatus({
        kind: item.kind,
        catalogId: item.id,
        expectedVersion: item.version,
        status,
      })
      await this.loadCatalogs(true)
      wx.showToast({ title: status === 'ACTIVE' ? '已启用' : '已停用', icon: 'success' })
    }
    catch (error) {
      await this.handleMutationError(error, '活动目录状态更新失败', false)
    }
    finally {
      this.setData({ processingId: '' })
    }
  },

  async archiveCatalog(event: WechatMiniprogram.TouchEvent) {
    if (!this.data.canManage || this.data.saving || this.data.processingId || this.data.editorOpen) {
      return
    }
    const id = String(event.currentTarget.dataset.id || '')
    const item = this.data.items.find(candidate => candidate.id === id)
    if (!item || item.status === 'ARCHIVED') {
      return
    }
    const confirmation = await wx.showModal({
      title: `归档${item.kind === 'TYPE' ? '活动分类' : '活动标签'}`,
      content: '归档后不能重新启用，历史引用会保留。',
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
      await mipAdminModule.eventCatalogs.archiveCatalog({
        kind: item.kind,
        catalogId: item.id,
        expectedVersion: item.version,
        reason,
      })
      await this.loadCatalogs(true)
      wx.showToast({ title: '已归档', icon: 'success' })
    }
    catch (error) {
      await this.handleMutationError(error, '活动目录归档失败', false)
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
      const refreshed = await this.loadCatalogs(true)
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
