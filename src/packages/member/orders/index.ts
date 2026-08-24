import type { CommerceOrder, MembershipPlan } from '../../../modules/mip-commerce'
import { mipCommerceModule } from '../../../modules/mip-commerce/client'
import { formatCny, planTitle, presentOrderStatus } from '../../../modules/mip-shell'
import { caseNavigateTo } from '../../../modules/platform/case-navigation'
import { formatLocalDateTime } from '../../../utils/date'

type OrderFilter = 'all' | 'pending' | 'paid' | 'refund'

interface DisplayOrder extends CommerceOrder {
  title: string
  statusText: string
  amountText: string
  createdText: string
  statusBrand: boolean
  statusSuccess: boolean
  statusDanger: boolean
}

function presentOrder(order: CommerceOrder, plans: readonly MembershipPlan[]): DisplayOrder {
  const status = presentOrderStatus(order.status)
  return {
    ...order,
    title: planTitle(order, plans),
    statusText: status.label,
    amountText: formatCny(order.amountCents),
    createdText: order.createdAt ? formatLocalDateTime(order.createdAt) : '',
    statusBrand: status.tone === 'brand',
    statusSuccess: status.tone === 'success',
    statusDanger: status.tone === 'danger',
  }
}

function filterOrders(orders: DisplayOrder[], filter: OrderFilter) {
  if (filter === 'pending') {
    return orders.filter(order => presentOrderStatus(order.status).paymentPending)
  }
  if (filter === 'paid') {
    return orders.filter(order => order.status === 'PAID')
  }
  if (filter === 'refund') {
    return orders.filter(order => ['REFUND_PENDING', 'PARTIALLY_REFUNDED', 'REFUNDED'].includes(order.status))
  }
  return orders
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
    if (!['all', 'pending', 'paid', 'refund'].includes(filter)) {
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
