import type { AdminCapabilityGrant, AdminEvent } from '../../../modules/mip-admin'
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
  statusText: string
  statusTheme: string
  startsText: string
}
const statusLabels: Record<AdminEvent['status'], string> = {
  DRAFT: '草稿',
  PUBLISHED: '已发布',
  UNPUBLISHED: '已下架',
  CANCELLED: '已取消',
  ENDED: '已结束',
  ARCHIVED: '已归档',
}
function eventView(item: AdminEvent, canClone: boolean): EventView {
  return {
    ...item,
    canClone,
    statusText: statusLabels[item.status],
    startsText: formatLocalDateTime(item.startsAt),
    statusTheme: item.status === 'PUBLISHED' ? 'success' : item.status === 'CANCELLED' ? 'danger' : item.status === 'DRAFT' ? 'default' : 'warning',
  }
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
    query: '',
    status: '',
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
  cloneConfirmationBusy: false,
  onShow() { void this.loadEvents() },
  updateQuery(event: WechatMiniprogram.CustomEvent<{ value: string }>) { this.setData({ query: event.detail.value }) },
  changeStatus(event: WechatMiniprogram.TouchEvent) {
    const status = String(event.currentTarget.dataset.value || '')
    this.setData({ status })
    void this.loadEvents(true)
  },
  search() { void this.loadEvents(true) },
  async loadEvents(force = false) {
    const hasContent = this.data.events.length > 0
    if (!hasContent) {
      this.setData({ state: 'loading', message: '' })
    }
    try {
      const [session, response, policy] = await Promise.all([
        mipAdminModule.getSession(force),
        mipAdminModule.events.list({
          filters: { query: this.data.query.trim(), status: this.data.status },
        }, force),
        mipAdminModule.events.getPolicy(force),
      ])
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
      this.setData(adminLoadFailure(error, { hasContent, fallbackMessage: '活动列表加载失败' }))
    }
  },
  async loadMoreEvents() {
    if (!this.data.nextCursor || this.data.loadingMore || this.data.state !== 'ready') {
      return
    }
    this.setData({ loadingMore: true, message: '' })
    try {
      const [session, response] = await Promise.all([
        mipAdminModule.getSession(),
        mipAdminModule.events.list({
          cursor: this.data.nextCursor,
          filters: { query: this.data.query.trim(), status: this.data.status },
        }),
      ])
      this.setData({
        events: this.data.events.concat(
          response.items.map(item => eventView(item, canCloneEvent(session.capabilities, item))),
        ),
        nextCursor: response.nextCursor || null,
      })
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '更多活动加载失败' })
    }
    finally {
      this.setData({ loadingMore: false })
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
    if (!eventId || this.data.processingId || this.data.cloneBusyId) {
      return
    }
    const modal = await wx.showModal({ title: '归档活动草稿', editable: true, placeholderText: '填写归档原因' })
    if (!modal.confirm || !modal.content.trim()) {
      return
    }
    this.setData({ processingId: eventId, message: '' })
    try {
      await mipAdminModule.events.archive({ eventId, expectedVersion: version, reason: modal.content })
      wx.showToast({ title: '活动已归档', icon: 'success' })
      await this.loadEvents(true)
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '活动归档失败' })
    }
    finally { this.setData({ processingId: '' }) }
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
