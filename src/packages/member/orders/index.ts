import type { MembershipOrder } from '../../../modules/membership/types'
import { membershipModule } from '../../../modules/membership/client'
import { caseNavigateTo } from '../../../modules/platform/case-navigation'
import { formatLocalDateTime } from '../../../utils/date'

const labels: Record<MembershipOrder['status'], string> = {
  PENDING: '待发起支付',
  PAYMENT_CREATED: '支付结果确认中',
  PAID: '已支付',
  CLOSED: '已关闭',
  REFUND_PENDING: '退款处理中',
  REFUNDED: '已退款',
  REFUND_FAILED: '退款失败',
  FAILED: '支付失败',
}
type OrderFilter = 'all' | 'pending' | 'paid' | 'refunded'

interface DisplayOrder extends MembershipOrder { statusText: string, amountText: string, createdText: string }

function displayOrders(orders: MembershipOrder[]) {
  return orders.map(order => ({
    ...order,
    statusText: labels[order.status],
    amountText: `¥${(order.amountCents / 100).toFixed(2)}`,
    createdText: formatLocalDateTime(order.createdAt),
  }))
}

function filterOrders(orders: DisplayOrder[], filter: OrderFilter) {
  if (filter === 'pending') {
    return orders.filter(order => ['PENDING', 'PAYMENT_CREATED'].includes(order.status))
  }
  if (filter === 'paid') {
    return orders.filter(order => order.status === 'PAID')
  }
  if (filter === 'refunded') {
    return orders.filter(order => ['REFUND_PENDING', 'REFUNDED', 'REFUND_FAILED'].includes(order.status))
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
    void this.refreshOrders()
  },
  async refreshOrders() {
    try {
      await membershipModule.reconcilePendingPayments()
    }
    catch { /* Order list remains available while the next focus retries. */ }
    try {
      await membershipModule.reconcilePendingRefunds()
    }
    catch { /* A later foreground refresh can reconcile the same provider refund. */ }
    await this.loadOrders(true)
  },
  async loadOrders(force = false) {
    const cached = membershipModule.peekOrders()
    if (cached) {
      const allOrders = displayOrders(cached)
      this.setData({ state: 'ready', allOrders, orders: filterOrders(allOrders, this.data.filter), message: '' })
    }
    else if (this.data.state !== 'ready') {
      this.setData({ state: 'loading', message: '' })
    }
    const seq = this.requestSeq + 1
    this.requestSeq = seq
    try {
      const orders = await membershipModule.listOrders({ force })
      if (seq !== this.requestSeq) {
        return
      }
      const allOrders = displayOrders(orders)
      this.setData({
        state: 'ready',
        allOrders,
        orders: filterOrders(allOrders, this.data.filter),
      })
    }
    catch (error) {
      if (seq !== this.requestSeq) {
        return
      }
      this.setData(cached || this.data.state === 'ready'
        ? { message: '订单更新失败，已保留上次结果。' }
        : { state: 'error', message: error instanceof Error ? error.message : '订单加载失败' })
    }
  },
  async onPullDownRefresh() {
    try {
      await this.loadOrders(true)
    }
    finally {
      wx.stopPullDownRefresh()
    }
  },
  changeFilter(event: WechatMiniprogram.CustomEvent<{ value: OrderFilter }>) {
    const filter = event.detail.value
    if (!['all', 'pending', 'paid', 'refunded'].includes(filter)) {
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
