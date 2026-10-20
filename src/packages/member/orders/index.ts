import type { CommerceOrder, MembershipPlan, OrderServiceStatus } from '../../../modules/mip-commerce'
import { mipCommerceModule } from '../../../modules/mip-commerce/client'
import { formatCny, planTitle, presentOrderServiceStatus, presentOrderStatus } from '../../../modules/mip-shell'
import { caseNavigateTo } from '../../../platform/navigation/client'
import { peekCloudFileUrls } from '../../../platform/storage/cloud-media'
import { clearPageMedia, updatePageMedia } from '../../../platform/storage/component-media'
import { formatBusinessDateTime as formatLocalDateTime } from '../../../utils/business-date'

type OrderFilter = 'all' | Exclude<OrderServiceStatus, 'UNAVAILABLE'>

interface DisplayOrder extends CommerceOrder {
  title: string
  statusText: string
  amountText: string
  createdText: string
  eventStartsText: string
  eventLocationText: string
  statusBrand: boolean
  statusSuccess: boolean
  statusDanger: boolean
  amountLabel: string
  amountHighlight: boolean
}

function presentOrder(order: CommerceOrder, plans: readonly MembershipPlan[]): DisplayOrder {
  const paymentStatus = presentOrderStatus(order.status)
  const orderServiceStatus = order.serviceStatus || 'UNAVAILABLE'
  const serviceStatus = presentOrderServiceStatus(orderServiceStatus)
  const status = orderServiceStatus === 'UNAVAILABLE' ? paymentStatus : serviceStatus
  const isRefundedEvent = order.orderType === 'EVENT' && orderServiceStatus === 'REFUNDED'
  return {
    ...order,
    title: planTitle(order, plans),
    statusText: status.label,
    amountText: formatCny(isRefundedEvent ? order.refundedAmountCents : order.amountCents),
    createdText: order.createdAt ? formatLocalDateTime(order.createdAt) : '',
    eventStartsText: order.event?.startsAt ? formatLocalDateTime(order.event.startsAt) : '',
    eventLocationText: [...new Set([
      order.event?.cityName?.trim(),
      order.event?.venueName?.trim(),
      order.event?.address?.trim(),
    ].filter(Boolean))].join(' · '),
    statusBrand: status.tone === 'brand',
    statusSuccess: status.tone === 'success',
    statusDanger: status.tone === 'danger',
    amountLabel: isRefundedEvent
      ? '已退款'
      : order.orderType === 'EVENT'
        && (order.paidAt || ['PAID', 'PARTIALLY_REFUNDED', 'REFUND_PENDING', 'REFUNDED'].includes(order.status))
        ? '实付款'
        : '订单金额',
    amountHighlight: order.orderType === 'EVENT',
  }
}

Page({
  data: {
    // ui-fidelity fixture 开关：默认走生产布局（被 vitest pin）。
    figmaLayout: false,
    state: 'loading' as 'loading' | 'ready' | 'error',
    nextCursor: '',
    loadingMore: false,
    refreshing: false,
    orders: [] as DisplayOrder[],
    filter: 'all' as OrderFilter,
    message: '',
  },
  requestSeq: 0,
  plans: [] as MembershipPlan[],

  onShow() {
    void this.loadOrders()
  },

  onUnload() {
    this.requestSeq += 1
    clearPageMedia(this)
  },

  async loadOrders() {
    await this.fetchOrders(false)
  },

  async loadMore() {
    await this.fetchOrders(true)
  },

  onReachBottom() {
    void this.loadMore()
  },

  async fetchOrders(append: boolean) {
    if (append && (!this.data.nextCursor || this.data.loadingMore || this.data.refreshing)) {
      return
    }
    const requestSeq = ++this.requestSeq
    clearPageMedia(this)
    const filter = this.data.filter
    this.setData(append
      ? { loadingMore: true, message: '' }
      : { refreshing: true, loadingMore: false, message: '', state: this.data.state === 'ready' ? 'ready' : 'loading' })
    try {
      const page = await mipCommerceModule.listOrderPage({
        ...(filter === 'all' ? {} : { serviceStatus: filter }),
        ...(append ? { cursor: this.data.nextCursor } : {}),
      })
      if (requestSeq !== this.requestSeq) {
        return
      }
      const incoming = page.items.map(order => presentOrder(order, this.plans))
      const orders = append
        ? [...new Map([...this.data.orders, ...incoming].map(order => [order.id, order])).values()]
        : incoming
      this.setData({ state: 'ready', orders: peekCloudFileUrls(orders), nextCursor: page.nextCursor || '', message: '' })
      orders.forEach((order, index) => {
        if (order.event) {
          updatePageMedia(this, `orders[${index}].event.coverUrl`, order.event.coverUrl || '')
        }
      })
      // Event/content titles are already on their orders. Optional membership
      // labels must not delay a nonempty order list or pagination controls.
      if (orders.some(order => order.orderType === 'MEMBERSHIP') && !this.plans.length) {
        void mipCommerceModule.listPlans().then((plans) => {
          if (requestSeq === this.requestSeq) {
            this.plans = plans
            this.setData({ orders: this.data.orders.map(order => ({ ...order, title: planTitle(order, plans) })) })
          }
        }).catch(() => { /* Keep the order's existing fallback title. */ })
      }
    }
    catch {
      if (requestSeq !== this.requestSeq) {
        return
      }
      this.setData(append
        ? { message: '更多订单加载失败，请重试。' }
        : this.data.orders.length
          ? { message: '订单更新失败，已保留上次结果。' }
          : { state: 'error', message: '订单暂时无法加载。' })
    }
    finally {
      if (requestSeq === this.requestSeq) {
        this.setData({ loadingMore: false, refreshing: false })
      }
    }
  },

  async onPullDownRefresh() {
    try {
      await this.loadOrders()
    }
    finally {
      wx.stopPullDownRefresh()
    }
  },

  changeFilter(event: WechatMiniprogram.TouchEvent) {
    const filter = String(event.currentTarget.dataset.filter || '') as OrderFilter
    if (!['all', 'PENDING_USE', 'COMPLETED', 'REFUNDED'].includes(filter)) {
      return
    }
    if (filter === this.data.filter) {
      return
    }
    this.setData({ filter, orders: [], nextCursor: '', state: 'loading' })
    void this.loadOrders()
  },

  openOrder(event: WechatMiniprogram.TouchEvent) {
    const orderId = String(event.currentTarget.dataset.orderId || '')
    if (orderId) {
      caseNavigateTo({ url: `/packages/member/order-detail/index?orderId=${encodeURIComponent(orderId)}` })
    }
  },
})
