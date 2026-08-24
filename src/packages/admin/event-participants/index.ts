import type { AdminRosterAllItem, AdminRosterStatus } from '../../../modules/mip-admin'
import { hasCapability, mipAdminModule } from '../../../modules/mip-admin'
import { formatLocalDateTime } from '../../../utils/date'

type ItemView = AdminRosterAllItem & { statusText: string, statusTheme: string, submittedText: string, phoneText: string }
const statuses: Array<{ value: AdminRosterStatus | '', label: string }> = [
  { value: '', label: '全部' },
  { value: 'PENDING_REVIEW', label: '待审核' },
  { value: 'REGISTERED', label: '已报名' },
  { value: 'WAITLISTED', label: '候补中' },
  { value: 'ATTENDED', label: '已参加' },
  { value: 'CANCELLED', label: '已取消' },
]
const labels: Record<AdminRosterStatus, string> = {
  PENDING_REVIEW: '待审核',
  WAITLISTED: '候补中',
  PAYMENT_PENDING: '待支付',
  REGISTERED: '已报名',
  CANCELLATION_PENDING: '取消处理中',
  CANCELLED: '已取消',
  REJECTED: '未通过',
  ATTENDED: '已参加',
}
function itemView(item: AdminRosterAllItem): ItemView {
  return {
    ...item,
    statusText: labels[item.status],
    statusTheme: item.status === 'ATTENDED' || item.status === 'REGISTERED' ? 'success' : item.status === 'REJECTED' || item.status === 'CANCELLED' ? 'danger' : 'warning',
    submittedText: formatLocalDateTime(item.submittedAt),
    phoneText: item.phoneNumber || (item.phoneBound ? '已绑定' : '未绑定'),
  }
}
function boundary(value: string, end: boolean) {
  return value ? new Date(`${value}T${end ? '23:59:59' : '00:00:00'}+08:00`).toISOString() : ''
}

Page({
  data: {
    state: 'loading',
    items: [] as ItemView[],
    events: [] as Array<{ id: string, title: string }>,
    branches: [] as Array<{ id: string, name: string }>,
    statuses,
    query: '',
    status: '' as AdminRosterStatus | '',
    eventIndex: 0,
    branchIndex: 0,
    createdFromDate: '',
    createdToDate: '',
    includePhone: false,
    canPhone: false,
    canExport: false,
    nextCursor: null as string | null,
    loadingMore: false,
    message: '',
  },
  onShow() { void this.load(true) },
  onHide() {
    mipAdminModule.clearSensitive()
    this.setData({ includePhone: false, items: this.data.items.map(item => ({ ...item, phoneNumber: null, phoneText: item.phoneBound ? '已绑定' : '未绑定' })) })
  },
  onUnload() {
    mipAdminModule.clearSensitive()
  },
  filters() {
    return {
      query: this.data.query.trim(),
      status: this.data.status,
      eventId: this.data.events[this.data.eventIndex]?.id || '',
      branchId: this.data.branches[this.data.branchIndex]?.id || '',
      createdFrom: boundary(this.data.createdFromDate, false),
      createdTo: boundary(this.data.createdToDate, true),
    }
  },
  async load(force = false) {
    try {
      const [page, events, branches, session] = await Promise.all([
        mipAdminModule.listRosterAll({ includePhone: this.data.includePhone, filters: this.filters() }, force),
        mipAdminModule.listEvents({ limit: 100 }, force),
        mipAdminModule.listBranches(force),
        mipAdminModule.getSession(force),
      ])
      this.setData({
        state: 'ready',
        items: page.items.map(itemView),
        events: [{ id: '', title: '全部活动' }, ...events.items.map(item => ({ id: item.id, title: item.title }))],
        branches: [{ id: '', name: '全部分会' }, ...branches.items.map(item => ({ id: item.id, name: item.name }))],
        canPhone: hasCapability(session.capabilities, 'users.phone.read'),
        canExport: hasCapability(session.capabilities, 'exports.create'),
        nextCursor: page.nextCursor || null,
        message: '',
      })
    }
    catch (error) {
      this.setData({ state: 'error', message: error instanceof Error ? error.message : '参与者加载失败' })
    }
  },
  updateQuery(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    this.setData({ query: event.detail.value })
  },
  chooseStatus(event: WechatMiniprogram.TouchEvent) {
    this.setData({ status: String(event.currentTarget.dataset.value || '') as AdminRosterStatus | '' })
    void this.load(true)
  },
  chooseEvent(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    this.setData({ eventIndex: Number(event.detail.value) })
    void this.load(true)
  },
  chooseBranch(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    this.setData({ branchIndex: Number(event.detail.value) })
    void this.load(true)
  },
  chooseDate(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    this.setData({ [String(event.currentTarget.dataset.field)]: event.detail.value })
    void this.load(true)
  },
  async togglePhone() {
    if (!this.data.canPhone) {
      return
    }
    if (!this.data.includePhone) {
      const modal = await wx.showModal({
        title: '查看联系电话',
        content: '联系电话仅用于已报名活动的运营联系。',
      })
      if (!modal.confirm) {
        return
      }
    }
    this.setData({ includePhone: !this.data.includePhone })
    await this.load(true)
  },
  search() { void this.load(true) },
  openRoster(event: WechatMiniprogram.TouchEvent) {
    void wx.navigateTo({ url: `/packages/admin/event-registrations/index?eventId=${String(event.currentTarget.dataset.id || '')}` })
  },
  async loadMore() {
    if (!this.data.nextCursor || this.data.loadingMore) {
      return
    }
    this.setData({ loadingMore: true })
    try {
      const page = await mipAdminModule.listRosterAll({ includePhone: this.data.includePhone, filters: this.filters(), cursor: this.data.nextCursor })
      this.setData({ items: this.data.items.concat(page.items.map(itemView)), nextCursor: page.nextCursor || null })
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '更多参与者加载失败' })
    }
    finally {
      this.setData({ loadingMore: false })
    }
  },
  async exportRows() {
    if (!this.data.canExport) {
      return
    }
    try {
      await mipAdminModule.exportAndOpen({ exportType: 'EVENT_ROSTER_ALL', includesPhone: this.data.includePhone, filters: this.filters() })
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '参与者导出失败' })
    }
  },
})
