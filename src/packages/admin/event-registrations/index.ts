import type { AdminRosterItem, AdminRosterStatus } from '../../../modules/mip-admin'
import type { AdminPageState } from '../shared/page-state'
import { hasScopedCapability, mipAdminModule } from '../../../modules/mip-admin'
import { formatLocalDateTime } from '../../../utils/date'
import { adminLoadFailure } from '../shared/page-state'

type RosterView = AdminRosterItem & {
  statusText: string
  submittedText: string
  registeredText: string
  checkedInText: string
}

const statusLabels: Record<AdminRosterStatus, string> = {
  PENDING_REVIEW: '待审核',
  WAITLISTED: '候补中',
  PAYMENT_PENDING: '待支付',
  REGISTERED: '已报名',
  CANCELLATION_PENDING: '取消处理中',
  CANCELLED: '已取消',
  REJECTED: '已拒绝',
  ATTENDED: '已签到',
}

function rosterView(item: AdminRosterItem): RosterView {
  return {
    ...item,
    statusText: statusLabels[item.status],
    submittedText: formatLocalDateTime(item.submittedAt),
    registeredText: item.registeredAt ? formatLocalDateTime(item.registeredAt) : '',
    checkedInText: item.checkedInAt ? formatLocalDateTime(item.checkedInAt) : '',
  }
}

Page({
  data: {
    state: 'loading' as AdminPageState,
    eventId: '',
    items: [] as RosterView[],
    query: '',
    status: '' as AdminRosterStatus | '',
    includePhone: false,
    canPhone: false,
    canExport: false,
    canReview: false,
    canCheckIn: false,
    canUndoCheckIn: false,
    processingId: '',
    exportPending: false,
    message: '',
    nextCursor: null as string | null,
    loadingMore: false,
  },
  requestSeq: 0,
  confirmationBusy: false,
  onLoad(query: Record<string, string>) { this.setData({ eventId: query.eventId || '' }) },
  onShow() {
    if (this.data.eventId) {
      void this.loadRoster()
    }
  },
  onHide() {
    this.requestSeq += 1
    mipAdminModule.clearSensitive()
    this.setData({
      includePhone: false,
      items: this.data.items.map(item => ({ ...item, phoneNumber: null })),
    })
  },
  onUnload() {
    this.requestSeq += 1
    mipAdminModule.clearSensitive()
  },
  updateQuery(event: WechatMiniprogram.CustomEvent<{ value: string }>) { this.setData({ query: event.detail.value }) },
  chooseStatus(event: WechatMiniprogram.TouchEvent) {
    const status = String(event.currentTarget.dataset.value || '') as AdminRosterStatus | ''
    this.setData({ status, items: [], nextCursor: null })
    void this.loadRoster(true)
  },
  search() { void this.loadRoster(true) },
  async loadRoster(force = false) {
    const hasContent = this.data.items.length > 0
    if (!hasContent) {
      this.setData({ state: 'loading', message: '' })
    }
    const seq = this.requestSeq + 1
    this.requestSeq = seq
    try {
      const [session, eventDetail, page] = await Promise.all([
        mipAdminModule.getSession(force),
        mipAdminModule.getEvent(this.data.eventId, force),
        mipAdminModule.listRoster({
          eventId: this.data.eventId,
          includePhone: this.data.includePhone,
          filters: { query: this.data.query.trim(), status: this.data.status },
        }, force),
      ])
      if (seq !== this.requestSeq) {
        return
      }
      const scope = { scopeType: 'EVENT' as const, scopeId: this.data.eventId, branchId: eventDetail.branchId }
      this.setData({
        state: 'ready',
        items: page.items.map(rosterView),
        canPhone: hasScopedCapability(session.capabilities, 'users.phone.read', scope),
        canExport: hasScopedCapability(session.capabilities, 'exports.create', scope),
        canReview: hasScopedCapability(session.capabilities, 'events.registrations.manage', scope),
        canCheckIn: hasScopedCapability(session.capabilities, 'events.checkin.manage', scope),
        canUndoCheckIn: hasScopedCapability(session.capabilities, 'events.checkin.undo', scope),
        nextCursor: page.nextCursor || null,
        loadingMore: false,
        message: '',
      })
    }
    catch (error) {
      if (seq !== this.requestSeq) {
        return
      }
      this.setData(adminLoadFailure(error, { hasContent, fallbackMessage: '参与者名单加载失败' }))
    }
  },
  async loadMoreRoster() {
    if (!this.data.nextCursor || this.data.loadingMore || this.data.state !== 'ready') {
      return
    }
    this.setData({ loadingMore: true, message: '' })
    try {
      const page = await mipAdminModule.listRoster({
        eventId: this.data.eventId,
        includePhone: this.data.includePhone,
        cursor: this.data.nextCursor,
        filters: { query: this.data.query.trim(), status: this.data.status },
      })
      this.setData({ items: this.data.items.concat(page.items.map(rosterView)), nextCursor: page.nextCursor || null })
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '更多参与者加载失败' })
    }
    finally {
      this.setData({ loadingMore: false })
    }
  },
  onReachBottom() { void this.loadMoreRoster() },
  async reviewRegistration(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id || '')
    const version = Number(event.currentTarget.dataset.version)
    const decision = String(event.currentTarget.dataset.decision || '') as 'APPROVE' | 'REJECT'
    if (!id || !this.data.canReview || !['APPROVE', 'REJECT'].includes(decision)
      || this.data.processingId || this.data.exportPending || this.confirmationBusy) {
      return
    }
    this.confirmationBusy = true
    try {
      const modal = await wx.showModal({
        title: decision === 'APPROVE' ? '通过报名' : '拒绝报名',
        content: decision === 'APPROVE'
          ? '通过后将根据当前名额确认报名或加入候补。'
          : '拒绝后该报名不会获得活动资格。',
      })
      if (!modal.confirm) {
        return
      }
      this.setData({ processingId: id, message: '' })
      const result = await mipAdminModule.mutate(() => mipAdminModule.gateway.reviewRegistration({
        eventId: this.data.eventId,
        registrationId: id,
        expectedVersion: version,
        decision,
      }))
      wx.showToast({
        title: result.status === 'REGISTERED' ? '报名已通过' : result.status === 'WAITLISTED' ? '已加入候补' : '报名已拒绝',
        icon: 'success',
      })
      await this.loadRoster(true)
    }
    catch (error) {
      const failure = adminLoadFailure(error, { hasContent: true, fallbackMessage: '报名审核失败' })
      this.setData({ state: failure.state || 'ready', message: failure.message })
    }
    finally {
      this.confirmationBusy = false
      this.setData({ processingId: '' })
    }
  },
  async showPhones() {
    if (!this.data.canPhone || this.data.processingId || this.data.exportPending || this.confirmationBusy) {
      return
    }
    this.confirmationBusy = true
    try {
      const modal = await wx.showModal({
        title: '查看联系电话',
        content: '联系电话仅用于本场活动联系和现场服务。',
      })
      if (!modal.confirm) {
        return
      }
      this.setData({ includePhone: true })
      await this.loadRoster(true)
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '联系电话加载失败' })
    }
    finally {
      this.confirmationBusy = false
    }
  },
  async checkIn(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id || '')
    const version = Number(event.currentTarget.dataset.version)
    if (!id || this.data.processingId || this.data.exportPending || this.confirmationBusy) {
      return
    }
    this.setData({ processingId: id, message: '' })
    try {
      await mipAdminModule.mutate(() => mipAdminModule.gateway.checkIn({
        eventId: this.data.eventId,
        registrationId: id,
        expectedVersion: version,
      }))
      wx.showToast({ title: '已签到', icon: 'success' })
      await this.loadRoster(true)
    }
    catch (error) {
      const failure = adminLoadFailure(error, { hasContent: true, fallbackMessage: '签到失败' })
      this.setData({ state: failure.state || 'ready', message: failure.message })
    }
    finally {
      this.setData({ processingId: '' })
    }
  },
  async undoCheckIn(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id || '')
    const version = Number(event.currentTarget.dataset.version)
    if (!id || !this.data.canUndoCheckIn || this.data.processingId
      || this.data.exportPending || this.confirmationBusy) {
      return
    }
    this.confirmationBusy = true
    try {
      const modal = await wx.showModal({
        title: '撤销签到',
        content: '填写撤销原因。撤销后参与者恢复为已报名状态。',
        editable: true,
        placeholderText: '撤销原因',
        confirmText: '撤销签到',
        confirmColor: '#E65C5C',
      })
      const reason = modal.content?.trim() || ''
      if (!modal.confirm) {
        return
      }
      if (!reason) {
        this.setData({ message: '请填写撤销原因。' })
        return
      }
      this.setData({ processingId: id, message: '' })
      await mipAdminModule.mutate(() => mipAdminModule.gateway.undoCheckIn({
        eventId: this.data.eventId,
        registrationId: id,
        expectedVersion: version,
        reason,
      }))
      wx.showToast({ title: '签到已撤销', icon: 'success' })
      await this.loadRoster(true)
    }
    catch (error) {
      const failure = adminLoadFailure(error, { hasContent: true, fallbackMessage: '撤销签到失败' })
      this.setData({ state: failure.state || 'ready', message: failure.message })
    }
    finally {
      this.confirmationBusy = false
      this.setData({ processingId: '' })
    }
  },
  async createExport() {
    if (!this.data.canExport || this.data.exportPending || this.data.processingId || this.confirmationBusy) {
      return
    }
    this.confirmationBusy = true
    this.setData({ exportPending: true, message: '' })
    try {
      const modal = await wx.showModal({ title: '创建参与者导出', content: '导出文件仅用于本场活动联系和现场服务，有效期较短。' })
      if (!modal.confirm) {
        return
      }
      const result = await mipAdminModule.mutate(() => mipAdminModule.exportAndOpen({
        exportType: 'EVENT_ROSTER',
        eventId: this.data.eventId,
        includesPhone: this.data.includePhone,
        filters: { query: this.data.query, status: this.data.status },
      }))
      wx.showToast({ title: `已导出 ${result.rowCount} 条`, icon: 'success' })
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '导出任务创建失败' })
    }
    finally {
      this.confirmationBusy = false
      this.setData({ exportPending: false })
    }
  },
})
