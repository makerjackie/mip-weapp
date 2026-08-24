import type {
  AdminOrder,
  AdminOrderFilters,
  AdminOrderStatus,
  AdminRefundStatus,
} from '../../../modules/mip-admin'
import type { AdminPageState } from '../shared/page-state'
import { hasCapability, hasScopedCapability, mipAdminModule } from '../../../modules/mip-admin'
import { formatLocalDateTime } from '../../../utils/date'
import { adminLoadFailure } from '../shared/page-state'

interface FilterOption<T extends string> {
  label: string
  value: T | ''
}

type OrderView = AdminOrder & {
  amountText: string
  refundedText: string
  createdText: string
  paidText: string
  orderTypeText: string
  statusText: string
  refundStatusText: string
  canSubmitRefund: boolean
  canRetryRefund: boolean
}

const orderTypeOptions: Array<FilterOption<AdminOrder['orderType']>> = [
  { label: '全部类型', value: '' },
  { label: '会员订单', value: 'MEMBERSHIP' },
  { label: '活动订单', value: 'EVENT' },
]
const statusOptions: Array<FilterOption<AdminOrderStatus>> = [
  { label: '全部订单状态', value: '' },
  { label: '待支付', value: 'CREATED' },
  { label: '支付单已创建', value: 'PAYMENT_CREATED' },
  { label: '已支付', value: 'PAID' },
  { label: '支付失败', value: 'FAILED' },
  { label: '已关闭', value: 'CLOSED' },
  { label: '退款处理中', value: 'REFUND_PENDING' },
  { label: '部分退款', value: 'PARTIALLY_REFUNDED' },
  { label: '已退款', value: 'REFUNDED' },
]
const refundStatusOptions: Array<FilterOption<AdminRefundStatus | 'NONE'>> = [
  { label: '全部退款状态', value: '' },
  { label: '无退款记录', value: 'NONE' },
  { label: '待提交', value: 'PENDING' },
  { label: '退款单已创建', value: 'PROVIDER_CREATED' },
  { label: '退款处理中', value: 'PROCESSING' },
  { label: '退款成功', value: 'SUCCEEDED' },
  { label: '退款失败', value: 'FAILED' },
  { label: '退款已取消', value: 'CANCELLED' },
]
const orderTypeLabels = Object.fromEntries(orderTypeOptions.map(item => [item.value, item.label]))
const statusLabels = Object.fromEntries(statusOptions.map(item => [item.value, item.label]))
const refundStatusLabels = Object.fromEntries(refundStatusOptions.map(item => [item.value, item.label]))

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

function filters(data: {
  eventId: string
  query: string
  orderTypeIndex: number
  statusIndex: number
  refundStatusIndex: number
  createdFromDate: string
  createdToDate: string
}): AdminOrderFilters {
  return {
    query: data.query.trim(),
    eventId: data.eventId || undefined,
    orderType: data.eventId ? 'EVENT' : orderTypeOptions[data.orderTypeIndex]?.value || '',
    status: statusOptions[data.statusIndex]?.value || '',
    refundStatus: refundStatusOptions[data.refundStatusIndex]?.value || '',
    createdFrom: data.createdFromDate ? dateBoundary(data.createdFromDate, false) : '',
    createdTo: data.createdToDate ? dateBoundary(data.createdToDate, true) : '',
  }
}

function orderView(item: AdminOrder): OrderView {
  return {
    ...item,
    amountText: `${item.currency} ${(item.amountCents / 100).toFixed(2)}`,
    refundedText: `${item.currency} ${(item.refundedAmountCents / 100).toFixed(2)}`,
    createdText: formatLocalDateTime(item.createdAt),
    paidText: item.paidAt ? formatLocalDateTime(item.paidAt) : '',
    orderTypeText: orderTypeLabels[item.orderType] || item.orderType,
    statusText: statusLabels[item.status] || item.status,
    refundStatusText: item.refundStatus ? refundStatusLabels[item.refundStatus] || item.refundStatus : '无退款记录',
    canSubmitRefund: item.availableRefundActions.includes('SUBMIT_REFUND'),
    canRetryRefund: item.availableRefundActions.includes('RETRY_REFUND'),
  }
}

Page({
  data: {
    state: 'loading' as AdminPageState,
    eventId: '',
    orders: [] as OrderView[],
    query: '',
    orderTypeOptions,
    orderTypeIndex: 0,
    statusOptions,
    statusIndex: 0,
    refundStatusOptions,
    refundStatusIndex: 0,
    createdFromDate: '',
    createdToDate: '',
    canExport: false,
    processingId: '',
    exportPending: false,
    message: '',
    nextCursor: null as string | null,
    loadingMore: false,
  },
  requestSeq: 0,
  onLoad(query: Record<string, string>) { this.setData({ eventId: query.eventId || '' }) },
  onShow() { void this.loadOrders() },
  updateQuery(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    this.setData({ query: event.detail.value })
  },
  search() {
    this.setData({ orders: [], nextCursor: null })
    void this.loadOrders(true)
  },
  changeOrderType(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    this.setData({ orderTypeIndex: Number(event.detail.value), orders: [], nextCursor: null })
    void this.loadOrders(true)
  },
  changeStatus(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    this.setData({ statusIndex: Number(event.detail.value), orders: [], nextCursor: null })
    void this.loadOrders(true)
  },
  changeRefundStatus(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    this.setData({ refundStatusIndex: Number(event.detail.value), orders: [], nextCursor: null })
    void this.loadOrders(true)
  },
  changeCreatedDate(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    const field = String(event.currentTarget.dataset.field || '')
    if (!['createdFromDate', 'createdToDate'].includes(field)) {
      return
    }
    this.setData({ [field]: event.detail.value, orders: [], nextCursor: null })
    void this.loadOrders(true)
  },
  clearCreatedDates() {
    this.setData({ createdFromDate: '', createdToDate: '', orders: [], nextCursor: null })
    void this.loadOrders(true)
  },
  async loadOrders(force = false) {
    const hasContent = this.data.orders.length > 0
    if (!hasContent) {
      this.setData({ state: 'loading', message: '' })
    }
    const seq = this.requestSeq + 1
    this.requestSeq = seq
    try {
      const input = { filters: filters(this.data) }
      const [session, response, event] = await Promise.all([
        mipAdminModule.getSession(force),
        mipAdminModule.listOrders(input, force),
        this.data.eventId ? mipAdminModule.getEvent(this.data.eventId, force) : Promise.resolve(null),
      ])
      if (seq !== this.requestSeq) {
        return
      }
      const eventScope = event
        ? { scopeType: 'EVENT' as const, scopeId: event.id, branchId: event.branchId }
        : null
      this.setData({
        state: 'ready',
        orders: response.items.map(orderView),
        canExport: eventScope
          ? hasScopedCapability(session.capabilities, 'exports.create', eventScope)
          : hasCapability(session.capabilities, 'exports.create'),
        nextCursor: response.nextCursor || null,
        loadingMore: false,
        message: '',
      })
    }
    catch (error) {
      if (seq !== this.requestSeq) {
        return
      }
      this.setData(adminLoadFailure(error, { hasContent, fallbackMessage: '订单列表加载失败' }))
    }
  },
  async loadMoreOrders() {
    if (!this.data.nextCursor || this.data.loadingMore || this.data.state !== 'ready') {
      return
    }
    this.setData({ loadingMore: true, message: '' })
    try {
      const response = await mipAdminModule.listOrders({
        cursor: this.data.nextCursor,
        filters: filters(this.data),
      })
      this.setData({
        orders: this.data.orders.concat(response.items.map(orderView)),
        nextCursor: response.nextCursor || null,
      })
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '更多订单加载失败' })
    }
    finally {
      this.setData({ loadingMore: false })
    }
  },
  onReachBottom() { void this.loadMoreOrders() },
  async submitRefund(event: WechatMiniprogram.TouchEvent) {
    const orderId = String(event.currentTarget.dataset.id || '')
    const order = this.data.orders.find(item => item.id === orderId)
    if (!order?.canSubmitRefund || this.data.processingId) {
      return
    }
    this.setData({ processingId: orderId, message: '' })
    try {
      const modal = await wx.showModal({ title: '提交退款', editable: true, placeholderText: '填写退款原因' })
      if (!modal.confirm || !modal.content.trim()) {
        return
      }
      const result = await mipAdminModule.mutate(() => mipAdminModule.gateway.submitRefund({
        orderId,
        reason: modal.content,
        idempotencyKey: `admin-refund-${orderId}-${Date.now()}`,
      }))
      const dispatchStatus = (result.providerDispatch as { status?: string } | undefined)?.status
      const title = dispatchStatus === 'SUCCEEDED'
        ? '退款已完成'
        : dispatchStatus === 'FAILED'
          ? '退款处理失败'
          : dispatchStatus === 'PENDING_RETRY'
            ? '退款请求已记录'
            : '退款已提交'
      wx.showToast({ title, icon: dispatchStatus === 'FAILED' ? 'none' : 'success' })
      await this.loadOrders(true)
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '退款请求提交失败' })
    }
    finally {
      this.setData({ processingId: '' })
    }
  },
  async retryRefund(event: WechatMiniprogram.TouchEvent) {
    const orderId = String(event.currentTarget.dataset.orderId || '')
    const refundId = String(event.currentTarget.dataset.refundId || '')
    const order = this.data.orders.find(item => item.id === orderId)
    if (!refundId || !order?.canRetryRefund || this.data.processingId) {
      return
    }
    this.setData({ processingId: orderId, message: '' })
    try {
      const result = await mipAdminModule.mutate(() => mipAdminModule.gateway.retryRefund(refundId))
      const status = (result.providerDispatch as { status?: string } | undefined)?.status
      wx.showToast({
        title: status === 'SUCCEEDED'
          ? '退款已完成'
          : status === 'FAILED'
            ? '退款处理失败'
            : status === 'PENDING_RETRY'
              ? '退款仍待处理'
              : '退款处理已更新',
        icon: 'none',
      })
      await this.loadOrders(true)
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '退款重试失败' })
    }
    finally {
      this.setData({ processingId: '' })
    }
  },
  async createExport() {
    if (!this.data.canExport || this.data.exportPending || this.data.processingId) {
      return
    }
    this.setData({ exportPending: true, message: '' })
    try {
      const result = await mipAdminModule.mutate(() => mipAdminModule.exportAndOpen({
        exportType: this.data.eventId ? 'EVENT_ORDERS' : 'ORDERS',
        eventId: this.data.eventId || undefined,
        includesPhone: false,
        filters: filters(this.data),
      }))
      wx.showToast({ title: `已导出 ${result.rowCount} 条`, icon: 'success' })
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '导出任务创建失败' })
    }
    finally {
      this.setData({ exportPending: false })
    }
  },
})
