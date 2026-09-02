import type { AdminRosterItem, AdminRosterStatus } from '../../../modules/mip-admin'
import type { AdminPageState } from '../shared/page-state'
import { hasScopedCapability, mipAdminModule } from '../../../modules/mip-admin'
import { formatLocalDateTime } from '../../../utils/date'
import { adminLoadFailure } from '../shared/page-state'

type RosterView = Omit<AdminRosterItem, 'phoneNumber'> & {
  statusText: string
  statusTheme: 'default' | 'primary' | 'success' | 'warning' | 'danger'
  checkedInText: string
}

const statusOptions: Array<{ value: AdminRosterStatus | '', label: string }> = [
  { value: '', label: '全部' },
  { value: 'REGISTERED', label: '已报名' },
  { value: 'ATTENDED', label: '已签到' },
]

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

const statusThemes: Record<AdminRosterStatus, RosterView['statusTheme']> = {
  PENDING_REVIEW: 'warning',
  WAITLISTED: 'warning',
  PAYMENT_PENDING: 'warning',
  REGISTERED: 'primary',
  CANCELLATION_PENDING: 'warning',
  CANCELLED: 'default',
  REJECTED: 'danger',
  ATTENDED: 'success',
}

function rosterView(item: AdminRosterItem): RosterView {
  const { phoneNumber, ...publicItem } = item
  void phoneNumber
  return {
    ...publicItem,
    statusText: statusLabels[item.status],
    statusTheme: statusThemes[item.status],
    checkedInText: item.checkedInAt ? formatLocalDateTime(item.checkedInAt) : '',
  }
}

Page({
  data: {
    state: 'loading' as AdminPageState,
    eventId: '',
    eventTitle: '',
    items: [] as RosterView[],
    query: '',
    status: '' as AdminRosterStatus | '',
    statusOptions,
    canCheckIn: false,
    canUndoCheckIn: false,
    processingId: '',
    message: '',
    nextCursor: null as string | null,
    loadingMore: false,
  },
  requestSeq: 0,
  confirmationBusy: false,

  onLoad(query: Record<string, string>) {
    this.setData({ eventId: query.eventId || '' })
  },

  onShow() {
    if (this.data.eventId) {
      void this.loadRoster()
    }
  },

  onHide() {
    this.requestSeq += 1
  },

  onUnload() {
    this.requestSeq += 1
  },

  updateQuery(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    this.setData({ query: event.detail.value })
  },

  chooseStatus(event: WechatMiniprogram.TouchEvent) {
    const status = String(event.currentTarget.dataset.value || '') as AdminRosterStatus | ''
    this.setData({ status, items: [], nextCursor: null })
    void this.loadRoster(true)
  },

  search() {
    this.setData({ items: [], nextCursor: null })
    void this.loadRoster(true)
  },

  async loadRoster(force = false) {
    const hasContent = this.data.items.length > 0
    if (!hasContent) {
      this.setData({ state: 'loading', message: '' })
    }
    const seq = this.requestSeq + 1
    this.requestSeq = seq
    try {
      const [session, eventDetail, page] = await Promise.all([
        mipAdminModule.session.get(force),
        mipAdminModule.events.get(this.data.eventId, force),
        mipAdminModule.events.listRoster({
          eventId: this.data.eventId,
          includePhone: false,
          filters: {
            query: this.data.query.trim(),
            status: this.data.status,
          },
        }, force),
      ])
      if (seq !== this.requestSeq) {
        return
      }
      const scope = { scopeType: 'EVENT' as const, scopeId: this.data.eventId, branchId: eventDetail.branchId }
      this.setData({
        state: 'ready',
        eventTitle: eventDetail.title,
        items: page.items.map(rosterView),
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
    const seq = this.requestSeq
    this.setData({ loadingMore: true, message: '' })
    try {
      const page = await mipAdminModule.events.listRoster({
        eventId: this.data.eventId,
        includePhone: false,
        cursor: this.data.nextCursor,
        filters: {
          query: this.data.query.trim(),
          status: this.data.status,
        },
      })
      if (seq !== this.requestSeq) {
        return
      }
      this.setData({
        items: this.data.items.concat(page.items.map(rosterView)),
        nextCursor: page.nextCursor || null,
      })
    }
    catch (error) {
      if (seq === this.requestSeq) {
        this.setData({ message: error instanceof Error ? error.message : '更多参与者加载失败' })
      }
    }
    finally {
      if (seq === this.requestSeq) {
        this.setData({ loadingMore: false })
      }
    }
  },

  async checkIn(event: WechatMiniprogram.TouchEvent) {
    const registrationId = String(event.currentTarget.dataset.id || '')
    const expectedVersion = Number(event.currentTarget.dataset.version)
    if (!registrationId || !this.data.canCheckIn || this.data.processingId || this.confirmationBusy) {
      return
    }
    this.setData({ processingId: registrationId, message: '' })
    try {
      await mipAdminModule.events.checkIn({
        eventId: this.data.eventId,
        registrationId,
        expectedVersion,
      })
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
    const registrationId = String(event.currentTarget.dataset.id || '')
    const expectedVersion = Number(event.currentTarget.dataset.version)
    if (!registrationId || !this.data.canUndoCheckIn || this.data.processingId || this.confirmationBusy) {
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
      this.setData({ processingId: registrationId, message: '' })
      await mipAdminModule.events.undoCheckIn({
        eventId: this.data.eventId,
        registrationId,
        expectedVersion,
        reason,
      })
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

  openCheckInTools() {
    if (!this.data.eventId) {
      return
    }
    void wx.navigateTo({
      url: `/packages/admin/event-console/index?eventId=${encodeURIComponent(this.data.eventId)}`,
    })
  },
})
