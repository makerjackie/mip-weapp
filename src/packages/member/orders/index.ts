import type { CommerceOrder, MembershipPlan, OrderServiceStatus } from '../../../modules/mip-commerce'
import { mipCommerceModule } from '../../../modules/mip-commerce/client'
import { formatCny, planTitle, presentOrderServiceStatus, presentOrderStatus } from '../../../modules/mip-shell'
import { caseNavigateTo } from '../../../modules/platform/case-navigation'
import { formatLocalDateTime } from '../../../utils/date'

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
    amountLabel: isRefundedEvent ? '已退款' : order.orderType === 'EVENT' ? '实付款' : '订单金额',
    amountHighlight: order.orderType === 'EVENT',
  }
}

function filterOrders(orders: DisplayOrder[], filter: OrderFilter) {
  return filter === 'all' ? orders : orders.filter(order => order.serviceStatus === filter)
}

Page({
  data: {
    state: 'loading' as 'loading' | 'ready' | 'error',
    allOrders: [] as DisplayOrder[],
    orders: [] as DisplayOrder[],
    filter: 'all' as OrderFilter,
    message: '',
  },
  requestSeq: 0,

  onShow() {
    void this.loadOrders()
  },

  async loadOrders() {
    if (this.data.state !== 'ready') {
      this.setData({ state: 'loading', message: '' })
    }
    const requestSeq = this.requestSeq + 1
    this.requestSeq = requestSeq
    try {
      const [orders, plans] = await Promise.all([
        mipCommerceModule.listOrders(),
        mipCommerceModule.listPlans().catch(() => [] as MembershipPlan[]),
      ])
      if (requestSeq !== this.requestSeq) {
        return
      }
      const allOrders = orders.map(order => presentOrder(order, plans))
      this.setData({
        state: 'ready',
        allOrders,
        orders: filterOrders(allOrders, this.data.filter),
        message: '',
      })
    }
    catch {
      if (requestSeq !== this.requestSeq) {
        return
      }
      this.setData(this.data.allOrders.length
        ? { message: '订单更新失败，已保留上次结果。' }
        : { state: 'error', message: '订单暂时无法加载。' })
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
    this.setData({ filter, orders: filterOrders(this.data.allOrders, filter) })
  },

  openOrder(event: WechatMiniprogram.TouchEvent) {
    const orderId = String(event.currentTarget.dataset.orderId || '')
    if (orderId) {
      caseNavigateTo({ url: `/packages/member/order-detail/index?orderId=${encodeURIComponent(orderId)}` })
    }
  },
})
