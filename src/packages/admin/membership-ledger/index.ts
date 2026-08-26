import type {
  AdminMembershipEntitlementStatus,
  AdminMembershipSourceType,
  AdminMembershipTimelineItem,
} from '../../../modules/mip-admin'
import type { AdminPageState } from '../shared/page-state'
import { hasCapability, MipAdminError, mipAdminModule } from '../../../modules/mip-admin'
import { formatLocalDateTime } from '../../../utils/date'
import { adminLoadFailure } from '../shared/page-state'

interface FilterOption<T extends string> { label: string, value: T | '' }
type TimelineView = AdminMembershipTimelineItem & {
  sourceText: string
  statusText: string
  startsText: string
  endsText: string
  createdText: string
  updatedText: string
  orderText: string
  refundText: string
  adjustmentText: string
}

const statusOptions: Array<FilterOption<AdminMembershipEntitlementStatus>> = [
  { label: '全部状态', value: '' },
  { label: '待生效', value: 'PENDING' },
  { label: '有效', value: 'ACTIVE' },
  { label: '已过期', value: 'EXPIRED' },
  { label: '已撤销', value: 'REVOKED' },
  { label: '已退款', value: 'REFUNDED' },
]
const sourceOptions: Array<FilterOption<AdminMembershipSourceType>> = [
  { label: '全部来源', value: '' },
  { label: '购买', value: 'ORDER' },
  { label: '人工开通', value: 'ADMIN_ADJUSTMENT' },
]
const statusLabels: Record<AdminMembershipEntitlementStatus, string> = {
  PENDING: '待生效',
  ACTIVE: '有效',
  EXPIRED: '已过期',
  REVOKED: '已撤销',
  REFUNDED: '已退款',
}

function dateBoundary(value: string, endOfDay: boolean) {
  const parts = value.split('-').map(Number)
  if (parts.length !== 3 || parts.some(part => !Number.isInteger(part))) {
    return ''
  }
  const date = new Date(parts[0], parts[1] - 1, parts[2], endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0, endOfDay ? 999 : 0)
  return Number.isFinite(date.getTime()) ? date.toISOString() : ''
}

function view(item: AdminMembershipTimelineItem): TimelineView {
  const order = item.order
  return {
    ...item,
    sourceText: item.sourceType === 'ORDER' ? '购买' : '人工开通',
    statusText: statusLabels[item.status],
    startsText: formatLocalDateTime(item.startsAt),
    endsText: formatLocalDateTime(item.endsAt),
    createdText: formatLocalDateTime(item.createdAt),
    updatedText: formatLocalDateTime(item.updatedAt),
    orderText: order ? `${order.currency} ${(order.amountCents / 100).toFixed(2)} · ${order.status}` : '无订单',
    refundText: order?.refundStatus
      ? `${order.refundStatus} · 已退 ${order.currency} ${(order.refundedAmountCents / 100).toFixed(2)}`
      : '无退款记录',
    adjustmentText: item.adjustment
      ? `${item.adjustment.reason} · ${item.adjustment.actorNickname}`
      : '',
  }
}

Page({
  data: {
    state: 'loading' as AdminPageState,
    message: '',
    userId: '',
    userQuery: '',
    statusOptions,
    sourceOptions,
    statusIndex: 0,
    sourceIndex: 0,
    createdFromDate: '',
    createdToDate: '',
    items: [] as TimelineView[],
    nextCursor: null as string | null,
    loadingMore: false,
  },
  requestSeq: 0,
  onLoad(options: Record<string, string | undefined>) {
    this.setData({ userId: String(options.userId || '').trim() })
  },
  onShow() {
    void this.loadTimeline(true)
  },
  onHide() { this.requestSeq += 1 },
  onUnload() { this.requestSeq += 1 },
  filters() {
    const status = statusOptions[this.data.statusIndex]?.value || ''
    const sourceType = sourceOptions[this.data.sourceIndex]?.value || ''
    return {
      ...(this.data.userId.trim() ? { userId: this.data.userId.trim() } : {}),
      ...(this.data.userQuery.trim() ? { userQuery: this.data.userQuery.trim() } : {}),
      ...(status ? { status } : {}),
      ...(sourceType ? { sourceType } : {}),
      ...(this.data.createdFromDate ? { createdFrom: dateBoundary(this.data.createdFromDate, false) } : {}),
      ...(this.data.createdToDate ? { createdTo: dateBoundary(this.data.createdToDate, true) } : {}),
    }
  },
  async loadTimeline(force = false) {
    if (this.data.state === 'loading' && !force) {
      return false
    }
    const seq = this.requestSeq + 1
    this.requestSeq = seq
    this.setData({ state: 'loading', message: '', items: [], nextCursor: null })
    try {
      const session = await mipAdminModule.getSession(force)
      if (seq !== this.requestSeq) {
        return false
      }
      if (!hasCapability(session.capabilities, 'memberships.read')) {
        this.setData({ state: 'forbidden', message: '当前账号没有查看会员权益台账的权限。' })
        return false
      }
      const page = await mipAdminModule.memberships.listTimeline({ filters: this.filters() }, force)
      if (seq !== this.requestSeq) {
        return false
      }
      this.setData({ state: 'ready', items: page.items.map(view), nextCursor: page.nextCursor || null, message: '' })
      return true
    }
    catch (error) {
      if (seq !== this.requestSeq) {
        return false
      }
      const failed = adminLoadFailure(error, { hasContent: false, fallbackMessage: '会员权益台账加载失败' })
      this.setData(failed)
      return false
    }
  },
  async loadMore() {
    if (!this.data.nextCursor || this.data.loadingMore) {
      return
    }
    this.setData({ loadingMore: true })
    try {
      const page = await mipAdminModule.memberships.listTimeline({
        filters: this.filters(),
        cursor: this.data.nextCursor,
      })
      this.setData({
        state: 'ready',
        items: this.data.items.concat(page.items.map(view)),
        nextCursor: page.nextCursor || null,
      })
    }
    catch (error) {
      this.setData({ message: error instanceof MipAdminError ? error.message : '加载更多失败，请重试。' })
    }
    finally { this.setData({ loadingMore: false }) }
  },
  updateUserQuery(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    this.setData({ userQuery: event.detail.value })
  },
  search() {
    if (this.data.userQuery.trim()) this.setData({ userId: '' })
    void this.loadTimeline(true)
  },
  changeStatus(event: WechatMiniprogram.CustomEvent) {
    this.setData({ statusIndex: Number(event.detail.value) })
    void this.loadTimeline(true)
  },
  changeSource(event: WechatMiniprogram.CustomEvent) {
    this.setData({ sourceIndex: Number(event.detail.value) })
    void this.loadTimeline(true)
  },
  changeDate(event: WechatMiniprogram.CustomEvent) {
    const field = event.currentTarget.dataset.field as 'createdFromDate' | 'createdToDate'
    if (field === 'createdFromDate' || field === 'createdToDate') {
      this.setData({ [field]: event.detail.value } as unknown as Record<string, unknown>)
    }
    void this.loadTimeline(true)
  },
  clearDates() {
    this.setData({ createdFromDate: '', createdToDate: '' })
    void this.loadTimeline(true)
  },
  retry() { void this.loadTimeline(true) },
})
