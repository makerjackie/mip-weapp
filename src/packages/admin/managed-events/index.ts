import type {
  AdminCapabilityGrant,
  AdminEvent,
  AdminEventAccessType,
  AdminEventListFilters,
  AdminEventListInput,
  AdminEventSortDirection,
  AdminEventStatus,
} from '../../../modules/mip-admin'
import type { AdminPageState } from '../shared/page-state'
import { MipAdminError, mipAdminModule } from '../../../modules/mip-admin'
import { formatLocalDateTime } from '../../../utils/date'
import { adminLoadFailure, isAdminVersionConflict } from '../shared/page-state'

interface CloneRequest {
  idempotencyKey: string
  expectedVersion: number
}

type EventView = AdminEvent & {
  canClone: boolean
  accessTypeText: string
  eventTypeText: string
  priceText: string
  statusText: string
  statusTheme: string
  startsText: string
}
const statuses: Array<{ value: AdminEventStatus | '', label: string }> = [
  { value: '', label: '全部' },
  { value: 'PUBLISHED', label: '已发布' },
  { value: 'DRAFT', label: '草稿' },
  { value: 'UNPUBLISHED', label: '已下架' },
  { value: 'CANCELLED', label: '已取消' },
  { value: 'ENDED', label: '已结束' },
  { value: 'ARCHIVED', label: '已归档' },
]
const statusLabels: Record<AdminEventStatus, string> = {
  DRAFT: '草稿',
  PUBLISHED: '已发布',
  UNPUBLISHED: '已下架',
  CANCELLED: '已取消',
  ENDED: '已结束',
  ARCHIVED: '已归档',
}
const accessTypeOptions: Array<{ value: AdminEventAccessType | '', label: string }> = [
  { value: '', label: '全部收费类型' },
  { value: 'FREE', label: '免费报名' },
  { value: 'MEMBER_INCLUDED', label: '玩家权益包含' },
  { value: 'PAID', label: '付费报名' },
]
const accessTypeLabels: Record<AdminEventAccessType, string> = {
  FREE: '免费报名',
  MEMBER_INCLUDED: '玩家权益包含',
  PAID: '付费报名',
}
const sortOptions: Array<{ value: AdminEventSortDirection, label: string }> = [
  { value: 'ASC', label: '开始时间升序' },
  { value: 'DESC', label: '开始时间降序' },
]
const eventTypeLabels: Record<string, string> = {
  general: '综合活动',
  community: '交流活动',
  workshop: '工作坊',
}
const eventTypeOptions = [
  { value: '', label: '全部活动类型' },
  ...Object.entries(eventTypeLabels).map(([value, label]) => ({ value, label })),
]
function eventView(item: AdminEvent, canClone: boolean): EventView {
  return {
    ...item,
    accessTypeText: accessTypeLabels[item.accessType],
    canClone,
    eventTypeText: eventTypeLabels[item.eventTypeKey] || item.eventTypeKey,
    priceText: `${(item.priceCents / 100).toFixed(2)} 元`,
    statusText: statusLabels[item.status],
    startsText: formatLocalDateTime(item.startsAt),
    statusTheme: item.status === 'PUBLISHED' ? 'success' : item.status === 'CANCELLED' ? 'danger' : item.status === 'DRAFT' ? 'default' : 'warning',
  }
}

function dateBoundary(value: string, endOfDay: boolean) {
  const parts = value.split('-').map(Number)
  if (parts.length !== 3 || parts.some(part => !Number.isInteger(part))) {
    return ''
  }
  const date = new Date(
    parts[0],
    parts[1] - 1,
    parts[2],
    endOfDay ? 23 : 0,
    endOfDay ? 59 : 0,
    endOfDay ? 59 : 0,
    endOfDay ? 999 : 0,
  )
  return Number.isFinite(date.getTime()) ? date.toISOString() : ''
}

function yuanToCents(value: string, label: string) {
  const normalized = value.trim()
  if (!normalized) {
    return undefined
  }
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) {
    throw new Error(`${label}格式无效`)
  }
  const cents = Math.round(Number(normalized) * 100)
  if (!Number.isSafeInteger(cents) || cents > 4_294_967_295) {
    throw new Error(`${label}超出范围`)
  }
  return cents
}

function cloneRequestKey(eventId: string) {
  return `event-clone:${eventId}:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`
}

function withoutCloneRequest(requests: Record<string, CloneRequest>, eventId: string) {
  const next = { ...requests }
  delete next[eventId]
  return next
}

function canCloneEvent(
  capabilities: AdminCapabilityGrant[],
  event: AdminEvent,
) {
  return capabilities.some(item => item.capability === 'events.write' && (
    item.scopeType === 'PLATFORM'
    || (item.scopeType === 'BRANCH' && item.scopeId === event.branchId)
  ))
}

Page({
  data: {
    state: 'loading' as AdminPageState,
    events: [] as EventView[],
    statuses,
    accessTypeOptions,
    eventTypeOptions,
    sortOptions,
    query: '',
    status: '' as AdminEventStatus | '',
    startsFromDate: '',
    startsToDate: '',
    cityOrBranch: '',
    eventTypeKey: '',
    eventTypeIndex: 0,
    accessType: '' as AdminEventAccessType | '',
    accessTypeIndex: 0,
    priceMinYuan: '',
    priceMaxYuan: '',
    sortDirection: 'ASC' as AdminEventSortDirection,
    sortIndex: 0,
    canCreate: false,
    canManagePolicy: false,
    cancellationHoursBeforeStart: '24',
    policyVersion: 0,
    policySaving: false,
    message: '',
    nextCursor: null as string | null,
    loadingMore: false,
    processingId: '',
    cloneBusyId: '',
    cloneRequests: {} as Record<string, CloneRequest>,
  },
  requestSeq: 0,
  cloneConfirmationBusy: false,
  archiveConfirmationBusy: false,
  onShow() { void this.loadEvents() },
  onHide() { this.requestSeq += 1 },
  onUnload() { this.requestSeq += 1 },
  updateQuery(event: WechatMiniprogram.CustomEvent<{ value: string }>) { this.setData({ query: event.detail.value }) },
  updateTextFilter(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    const field = String(event.currentTarget.dataset.field || '')
    if (!['cityOrBranch', 'priceMinYuan', 'priceMaxYuan'].includes(field)) {
      return
    }
    this.setData({ [field]: event.detail.value })
  },
  changeStartsDate(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    const field = String(event.currentTarget.dataset.field || '')
    if (!['startsFromDate', 'startsToDate'].includes(field)) {
      return
    }
    this.setData({ [field]: event.detail.value })
  },
  changeAccessType(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    const accessTypeIndex = Number(event.detail.value)
    const accessType = this.data.accessTypeOptions[accessTypeIndex]?.value || ''
    this.setData({ accessTypeIndex, accessType })
  },
  changeEventType(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    const eventTypeIndex = Number(event.detail.value)
    const eventTypeKey = this.data.eventTypeOptions[eventTypeIndex]?.value || ''
    this.setData({ eventTypeIndex, eventTypeKey })
  },
  changeSort(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    const sortIndex = Number(event.detail.value)
    const sortDirection = this.data.sortOptions[sortIndex]?.value || 'ASC'
    this.setData({ sortIndex, sortDirection })
    void this.loadEvents(true)
  },
  changeStatus(event: WechatMiniprogram.TouchEvent) {
    const status = String(event.currentTarget.dataset.value || '') as AdminEventStatus | ''
    this.setData({ status })
    void this.loadEvents(true)
  },
  clearFilters() {
    this.setData({
      query: '',
      status: '',
      startsFromDate: '',
      startsToDate: '',
      cityOrBranch: '',
      eventTypeKey: '',
      eventTypeIndex: 0,
      accessType: '',
      accessTypeIndex: 0,
      priceMinYuan: '',
      priceMaxYuan: '',
      sortDirection: 'ASC',
      sortIndex: 0,
      message: '',
    }, () => void this.loadEvents(true))
  },
  eventListInput(cursor?: string): AdminEventListInput {
    const filters: AdminEventListFilters = {
      query: this.data.query.trim(),
      status: this.data.status,
      startsFrom: dateBoundary(this.data.startsFromDate, false),
      startsTo: dateBoundary(this.data.startsToDate, true),
      cityOrBranch: this.data.cityOrBranch.trim(),
      eventTypeKey: this.data.eventTypeKey.trim(),
      accessType: this.data.accessType,
    }
    const priceMinCents = yuanToCents(this.data.priceMinYuan, '最低价格')
    const priceMaxCents = yuanToCents(this.data.priceMaxYuan, '最高价格')
    if (priceMinCents !== undefined) {
      filters.priceMinCents = priceMinCents
    }
    if (priceMaxCents !== undefined) {
      filters.priceMaxCents = priceMaxCents
    }
    if (priceMinCents !== undefined && priceMaxCents !== undefined && priceMinCents > priceMaxCents) {
      throw new Error('最低价格不能高于最高价格')
    }
    return {
      filters,
      sort: { field: 'startsAt', direction: this.data.sortDirection },
      ...(cursor ? { cursor } : {}),
    }
  },
  search() { void this.loadEvents(true) },
  async loadEvents(force = false) {
    const hasContent = this.data.events.length > 0
    let input: AdminEventListInput
    try {
      input = this.eventListInput()
    }
    catch (error) {
      this.setData({ state: 'ready', message: error instanceof Error ? error.message : '活动筛选条件无效' })
      return
    }
    if (!hasContent) {
      this.setData({ state: 'loading', message: '' })
    }
    const seq = this.requestSeq + 1
    this.requestSeq = seq
    try {
      const [session, response, policy] = await Promise.all([
        mipAdminModule.getSession(force),
        mipAdminModule.events.list(input, force),
        mipAdminModule.events.getPolicy(force),
      ])
      if (seq !== this.requestSeq) {
        return
      }
      const canCreate = session.capabilities.some(item =>
        item.capability === 'events.write' && (item.scopeType === 'PLATFORM' || item.scopeType === 'BRANCH'))
      const canManagePolicy = session.capabilities.some(item =>
        item.capability === 'events.write' && item.scopeType === 'PLATFORM')
      this.setData({
        state: 'ready',
        events: response.items.map(item => eventView(item, canCloneEvent(session.capabilities, item))),
        canCreate,
        canManagePolicy,
        cancellationHoursBeforeStart: String(policy.cancellationHoursBeforeStart),
        policyVersion: policy.version,
        nextCursor: response.nextCursor || null,
        loadingMore: false,
        message: '',
      })
    }
    catch (error) {
      if (seq !== this.requestSeq) {
        return
      }
      this.setData(adminLoadFailure(error, { hasContent, fallbackMessage: '活动列表加载失败' }))
    }
  },
  async loadMoreEvents() {
    if (!this.data.nextCursor || this.data.loadingMore || this.data.state !== 'ready') {
      return
    }
    this.setData({ loadingMore: true, message: '' })
    const seq = this.requestSeq
    try {
      const input = this.eventListInput(this.data.nextCursor)
      const [session, response] = await Promise.all([
        mipAdminModule.getSession(),
        mipAdminModule.events.list(input),
      ])
      if (seq !== this.requestSeq) {
        return
      }
      this.setData({
        events: this.data.events.concat(
          response.items.map(item => eventView(item, canCloneEvent(session.capabilities, item))),
        ),
        nextCursor: response.nextCursor || null,
      })
    }
    catch (error) {
      if (seq !== this.requestSeq) {
        return
      }
      this.setData({ message: error instanceof Error ? error.message : '更多活动加载失败' })
    }
    finally {
      if (seq === this.requestSeq) {
        this.setData({ loadingMore: false })
      }
    }
  },
  onReachBottom() { void this.loadMoreEvents() },
  async onPullDownRefresh() {
    try {
      await this.loadEvents(true)
    }
    finally {
      wx.stopPullDownRefresh()
    }
  },
  openEvent(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id || '')
    if (id) {
      void wx.navigateTo({ url: `/packages/admin/event-console/index?eventId=${encodeURIComponent(id)}` })
    }
  },
  createEvent() {
    if (this.data.canCreate) {
      void wx.navigateTo({ url: '/packages/admin/events/index' })
    }
  },
  openParticipants() {
    void wx.navigateTo({ url: '/packages/admin/event-participants/index' })
  },
  async cloneEvent(event: WechatMiniprogram.TouchEvent) {
    const eventId = String(event.currentTarget.dataset.id || '')
    const displayedVersion = Number(event.currentTarget.dataset.version)
    if (!eventId || !Number.isInteger(displayedVersion) || displayedVersion < 1
      || this.data.processingId || this.data.cloneBusyId || this.cloneConfirmationBusy) {
      return
    }
    const pending = this.data.cloneRequests[eventId]
    this.cloneConfirmationBusy = true
    this.setData({ cloneBusyId: eventId, message: '' })
    try {
      if (!pending) {
        const modal = await wx.showModal({
          title: '复制活动',
          content: '将复制活动内容和配置，并自动顺延时间。报名、订单、签到、相册和消息不会复制。',
          confirmText: '复制',
        }).catch(() => null)
        if (!modal?.confirm) {
          return
        }
      }
      const request = pending || {
        idempotencyKey: cloneRequestKey(eventId),
        expectedVersion: displayedVersion,
      }
      if (!pending) {
        this.setData({
          cloneRequests: { ...this.data.cloneRequests, [eventId]: request },
        })
      }
      const result = await mipAdminModule.events.clone({
        sourceEventId: eventId,
        expectedVersion: request.expectedVersion,
        idempotencyKey: request.idempotencyKey,
      })
      this.setData({ cloneRequests: withoutCloneRequest(this.data.cloneRequests, eventId) })
      await wx.showModal({
        title: '草稿已创建',
        content: '活动时间已自动顺延，请复核活动标题和时间。',
        showCancel: false,
        confirmText: '继续编辑',
      }).catch(() => null)
      try {
        await wx.navigateTo({ url: `/packages/admin/events/index?eventId=${encodeURIComponent(result.id)}` })
      }
      catch {
        await this.loadEvents(true)
        this.setData({ message: '草稿已创建。请在活动列表中打开，并复核标题和时间。' })
      }
    }
    catch (error) {
      if (isAdminVersionConflict(error)) {
        this.setData({
          cloneRequests: withoutCloneRequest(this.data.cloneRequests, eventId),
          message: '活动信息已更新，请刷新列表后重新复制。',
        })
      }
      else if (error instanceof MipAdminError && !error.retryable) {
        this.setData({
          cloneRequests: withoutCloneRequest(this.data.cloneRequests, eventId),
          message: error.message || '活动复制失败',
        })
      }
      else {
        this.setData({
          message: error instanceof Error
            ? `${error.message}。再次点击复制可安全重试。`
            : '活动复制状态未确认，再次点击复制可安全重试。',
        })
      }
    }
    finally {
      this.cloneConfirmationBusy = false
      this.setData({ cloneBusyId: '' })
    }
  },
  async archiveEvent(event: WechatMiniprogram.TouchEvent) {
    const eventId = String(event.currentTarget.dataset.id || '')
    const version = Number(event.currentTarget.dataset.version)
    if (!eventId || this.data.processingId || this.data.cloneBusyId || this.archiveConfirmationBusy) {
      return
    }
    this.archiveConfirmationBusy = true
    try {
      const modal = await wx.showModal({
        title: '归档活动草稿',
        editable: true,
        placeholderText: '填写归档原因',
      }).catch(() => null)
      const reason = modal?.content?.trim() || ''
      if (!modal?.confirm || !reason) {
        return
      }
      this.setData({ processingId: eventId, message: '' })
      await mipAdminModule.events.archive({ eventId, expectedVersion: version, reason })
      wx.showToast({ title: '活动已归档', icon: 'success' })
      await this.loadEvents(true)
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '活动归档失败' })
    }
    finally {
      this.archiveConfirmationBusy = false
      this.setData({ processingId: '' })
    }
  },
  updateCancellationHours(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    this.setData({ cancellationHoursBeforeStart: event.detail.value })
  },
  async saveEventPolicy() {
    if (!this.data.canManagePolicy || this.data.policySaving) {
      return
    }
    const cancellationHoursBeforeStart = Number(this.data.cancellationHoursBeforeStart)
    if (!Number.isInteger(cancellationHoursBeforeStart)
      || cancellationHoursBeforeStart < 0
      || cancellationHoursBeforeStart > 720) {
      this.setData({ message: '默认取消时间应为 0 至 720 的整数小时。' })
      return
    }
    this.setData({ policySaving: true, message: '' })
    try {
      const policy = await mipAdminModule.events.savePolicy({
        cancellationHoursBeforeStart,
        version: this.data.policyVersion,
      })
      this.setData({ policyVersion: policy.version })
      wx.showToast({ title: '取消规则已保存', icon: 'success' })
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '取消规则保存失败' })
    }
    finally {
      this.setData({ policySaving: false })
    }
  },
})
