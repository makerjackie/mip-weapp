import type {
  AdminOrder,
  AdminOrderDetail,
  AdminOrderFilters,
  AdminOrderStatus,
  AdminOrderSummary,
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
  resourceTypeText: string
  canSubmitRefund: boolean
  canRetryRefund: boolean
  entitlementWindowText: string
  statusTheme: 'default' | 'success' | 'warning' | 'danger'
}

type SummaryView = AdminOrderSummary & {
  eventGrossText: string
  membershipGrossText: string
  grossText: string
  refundedText: string
  netText: string
}

const emptySummary: AdminOrderSummary = {
  currency: 'CNY',
  orderCount: 0,
  paidOrderCount: 0,
  eventGrossAmountCents: 0,
  membershipGrossAmountCents: 0,
  grossAmountCents: 0,
  refundedAmountCents: 0,
  netAmountCents: 0,
}

function summaryView(summary: AdminOrderSummary): SummaryView {
  const money = (value: number) => `${summary.currency} ${(value / 100).toFixed(2)}`
  return {
    ...summary,
    eventGrossText: money(summary.eventGrossAmountCents),
    membershipGrossText: money(summary.membershipGrossAmountCents),
    grossText: money(summary.grossAmountCents),
    refundedText: money(summary.refundedAmountCents),
    netText: money(summary.netAmountCents),
  }
}

const orderTypeOptions: Array<FilterOption<AdminOrder['orderType']>> = [
  { label: '全部类型', value: '' },
  { label: '会员订单', value: 'MEMBERSHIP' },
  { label: '活动订单', value: 'EVENT' },
  { label: '内容订单', value: 'CONTENT' },
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
const resourceTypeLabels: Record<AdminOrder['resourceType'], string> = {
  EVENT: '活动',
  KNOWLEDGE_CONTENT: '内容商品',
  MEMBERSHIP_PLAN: '会员方案',
}
const buyerKindLabels = { PLAYER: '玩家', GUEST: '嘉宾' } as const
const accountStatusLabels = { ACTIVE: '正常', BLOCKED: '已限制', CLOSED: '已关闭' } as const
const paymentProviderLabels = { WECHAT_PAY: '微信支付', TEST: '测试支付' } as const
const paymentAttemptStatusLabels: Record<string, string> = {
  CREATED: '已创建',
  PARAMETERS_ISSUED: '支付参数已生成',
  PENDING: '处理中',
  SUCCEEDED: '已成功',
  FAILED: '已失败',
  CLOSED: '已关闭',
}
const callbackStatusLabels: Record<string, string> = {
  RECEIVED: '已接收',
  PROCESSED: '已处理',
  FAILED: '处理失败',
  IGNORED: '已忽略',
}
const requestedByLabels = { BUYER: '买家', OPERATOR: '运营人员', SYSTEM: '系统' } as const
const entitlementKindLabels = { MEMBERSHIP: '会员权益', CONTENT: '内容权益' } as const
const entitlementStatusLabels: Record<string, string> = {
  PENDING: '待生效',
  ACTIVE: '已生效',
  EXPIRED: '已到期',
  REVOKED: '已撤销',
  REFUNDED: '已退款',
}
const timelineEvidenceLabels: Record<string, string> = {
  ORDER_CREATED: '订单创建',
  PAYMENT_CONFIRMED: '支付确认',
  ORDER_CLOSED: '订单关闭',
  REFUND_CREATED: '退款申请创建',
  REFUND_COMPLETED: '退款完成',
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
    resourceTypeText: resourceTypeLabels[item.resourceType],
    entitlementWindowText: item.orderType === 'MEMBERSHIP' && item.entitlementStartsAt && item.entitlementEndsAt
      ? `${formatLocalDateTime(item.entitlementStartsAt)} 至 ${formatLocalDateTime(item.entitlementEndsAt)}`
      : '',
    statusTheme: ['PAID', 'REFUNDED'].includes(item.status)
      ? 'success'
      : ['FAILED', 'CLOSED'].includes(item.status) ? 'danger' : 'warning',
    canSubmitRefund: item.availableRefundActions.includes('SUBMIT_REFUND'),
    canRetryRefund: item.availableRefundActions.includes('RETRY_REFUND'),
  }
}

function moneyText(currency: string, amountCents: number) {
  return `${currency} ${(amountCents / 100).toFixed(2)}`
}

function localDateText(value: string | null) {
  return value ? formatLocalDateTime(value) : '—'
}

function timelineView(item: AdminOrderDetail['statusTimeline'][number], index: number) {
  return {
    ...item,
    key: `${item.evidence}:${item.occurredAt}:${index}`,
    statusText: statusLabels[item.status] || refundStatusLabels[item.status] || item.status,
    occurredText: formatLocalDateTime(item.occurredAt),
    evidenceText: timelineEvidenceLabels[item.evidence] || item.evidence,
  }
}

function orderDetailView(detail: AdminOrderDetail) {
  const snapshot = detail.product.snapshot
  const productFacts: Array<{ label: string, value: string }> = []
  if (snapshot.catalogStage) {
    productFacts.push({
      label: '商品类型',
      value: snapshot.catalogStage === 'LIVE' ? '正式商品' : '测试商品',
    })
  }
  if (snapshot.version !== null) {
    productFacts.push({ label: '商品版本', value: `v${snapshot.version}` })
  }
  if (snapshot.durationDays !== null) {
    productFacts.push({ label: '会员时长', value: `${snapshot.durationDays} 天` })
  }
  if (snapshot.unlockDays !== null) {
    productFacts.push({ label: '解锁时长', value: `${snapshot.unlockDays} 天` })
  }
  if (snapshot.refundPolicy) {
    productFacts.push({
      label: '退款规则',
      value: snapshot.refundPolicy === 'BEFORE_ACCESS' ? '首次访问前可退' : '不可退款',
    })
  }
  if (snapshot.refundWindowHours !== null) {
    productFacts.push({ label: '退款时窗', value: `${snapshot.refundWindowHours} 小时` })
  }
  if (snapshot.eventStartsAt) {
    productFacts.push({ label: '活动开始', value: formatLocalDateTime(snapshot.eventStartsAt) })
  }
  if (snapshot.eventEndsAt) {
    productFacts.push({ label: '活动结束', value: formatLocalDateTime(snapshot.eventEndsAt) })
  }
  if (snapshot.cityName) {
    productFacts.push({ label: '城市', value: snapshot.cityName })
  }
  if (snapshot.venueName) {
    productFacts.push({ label: '场地', value: snapshot.venueName })
  }

  return {
    order: {
      ...detail.order,
      orderTypeText: orderTypeLabels[detail.order.orderType] || detail.order.orderType,
      statusText: statusLabels[detail.order.status] || detail.order.status,
      amountText: moneyText(detail.order.currency, detail.order.amountCents),
      refundedText: moneyText(detail.order.currency, detail.order.refundedAmountCents),
      createdText: formatLocalDateTime(detail.order.createdAt),
      updatedText: formatLocalDateTime(detail.order.updatedAt),
      paidText: localDateText(detail.order.paidAt),
      closedText: localDateText(detail.order.closedAt),
    },
    buyer: {
      ...detail.buyer,
      kindText: buyerKindLabels[detail.buyer.kind],
      accountStatusText: accountStatusLabels[detail.buyer.accountStatus],
      locationText: [detail.buyer.branchName, detail.buyer.cityName].filter(Boolean).join(' · ') || '未设置分会',
    },
    product: {
      ...detail.product,
      resourceTypeText: resourceTypeLabels[detail.product.resourceType],
      facts: productFacts,
      benefits: [...snapshot.benefits],
    },
    payment: {
      attempts: detail.payment.attempts.map((item, index) => ({
        ...item,
        key: `${item.provider}:${item.createdAt}:${index}`,
        providerText: paymentProviderLabels[item.provider],
        statusText: paymentAttemptStatusLabels[item.status] || item.status,
        createdText: formatLocalDateTime(item.createdAt),
        updatedText: formatLocalDateTime(item.updatedAt),
      })),
      callbacks: detail.payment.callbacks.map((item, index) => ({
        ...item,
        key: `${item.callbackType}:${item.createdAt}:${index}`,
        statusText: callbackStatusLabels[item.processingStatus] || item.processingStatus,
        createdText: formatLocalDateTime(item.createdAt),
        processedText: localDateText(item.processedAt),
      })),
    },
    refunds: detail.refunds.map(item => ({
      ...item,
      requestedByText: requestedByLabels[item.requestedBy],
      statusText: refundStatusLabels[item.status] || item.status,
      amountText: moneyText(item.currency, item.amountCents),
      createdText: formatLocalDateTime(item.createdAt),
      updatedText: formatLocalDateTime(item.updatedAt),
      refundedText: localDateText(item.refundedAt),
      callback: item.callback
        ? {
            ...item.callback,
            statusText: callbackStatusLabels[item.callback.processingStatus] || item.callback.processingStatus,
            processedText: localDateText(item.callback.processedAt),
          }
        : null,
      statusTimeline: item.statusTimeline.map(timelineView),
    })),
    entitlementTimeline: detail.entitlementTimeline.map((item, index) => ({
      ...item,
      key: `${item.kind}:${item.startsAt}:${index}`,
      kindText: entitlementKindLabels[item.kind],
      statusText: entitlementStatusLabels[item.status] || item.status,
      startsText: formatLocalDateTime(item.startsAt),
      endsText: localDateText(item.endsAt),
      firstAccessedText: localDateText(item.firstAccessedAt),
      revokedText: localDateText(item.revokedAt),
    })),
    statusTimeline: detail.statusTimeline.map(timelineView),
  }
}

Page({
  data: {
    state: 'loading' as AdminPageState,
    eventId: '',
    orders: [] as OrderView[],
    summary: summaryView(emptySummary),
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
    detailOpen: false,
    detailState: 'loading' as AdminPageState,
    detail: null as ReturnType<typeof orderDetailView> | null,
    detailMessage: '',
    selectedOrderId: '',
  },
  requestSeq: 0,
  detailRequestSeq: 0,
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
        mipAdminModule.orders.list(input, force),
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
        summary: summaryView(response.summary),
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
      const response = await mipAdminModule.orders.list({
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
  async openOrderDetail(event: WechatMiniprogram.TouchEvent) {
    const orderId = String(event.currentTarget.dataset.id || '')
    if (!orderId) {
      return
    }
    this.setData({ detailOpen: true, selectedOrderId: orderId })
    await this.loadOrderDetail(orderId, true)
  },
  async loadOrderDetail(orderId: string, reset: boolean) {
    const seq = this.detailRequestSeq + 1
    this.detailRequestSeq = seq
    if (reset) {
      this.setData({ detailState: 'loading', detail: null, detailMessage: '' })
    }
    try {
      const detail = await mipAdminModule.orders.get(orderId, true)
      if (!this.data.detailOpen || seq !== this.detailRequestSeq) {
        return
      }
      this.setData({ detailState: 'ready', detail: orderDetailView(detail), detailMessage: '' })
    }
    catch (error) {
      if (!this.data.detailOpen || seq !== this.detailRequestSeq) {
        return
      }
      this.setData({
        detailState: 'error',
        detailMessage: error instanceof Error ? error.message : '订单详情加载失败',
      })
    }
  },
  retryOrderDetail() {
    if (this.data.selectedOrderId) {
      void this.loadOrderDetail(this.data.selectedOrderId, true)
    }
  },
  closeOrderDetail() {
    this.detailRequestSeq += 1
    this.setData({
      detailOpen: false,
      detailState: 'loading',
      detail: null,
      detailMessage: '',
      selectedOrderId: '',
    })
  },
  handleDetailVisibility(event: WechatMiniprogram.CustomEvent<{ visible?: boolean }>) {
    if (event.detail.visible !== true) {
      this.closeOrderDetail()
    }
  },
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
      const result = await mipAdminModule.orders.submitRefund({
        orderId,
        reason: modal.content,
        idempotencyKey: `admin-refund-${orderId}-${Date.now()}`,
      })
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
      if (this.data.detailOpen && this.data.selectedOrderId === orderId) {
        await this.loadOrderDetail(orderId, false)
      }
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
      const result = await mipAdminModule.orders.retryRefund(refundId)
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
      if (this.data.detailOpen && this.data.selectedOrderId === orderId) {
        await this.loadOrderDetail(orderId, false)
      }
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
      const result = await mipAdminModule.exportAndOpen({
        exportType: this.data.eventId ? 'EVENT_ORDERS' : 'ORDERS',
        eventId: this.data.eventId || undefined,
        includesPhone: false,
        filters: filters(this.data),
      })
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
