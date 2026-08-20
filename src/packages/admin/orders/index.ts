import type { AdminOrderItem } from '../../../modules/admin/types'
import type { AdminPageState } from '../shared/page-state'
import { createLabelPresenter, formatMinorUnits, formatRecordCode } from '@weapp/shared/presenter'
import { adminModule } from '../../../modules/admin/client'
import { formatLocalDateTime } from '../../../utils/date'
import { adminLoadFailure } from '../shared/page-state'

const statusLabels: Record<string, string> = {
  PENDING: '待支付',
  PAYMENT_CREATED: '支付结果确认中',
  PAID: '已支付',
  CLOSED: '已关闭',
  REFUND_PENDING: '退款处理中',
  REFUNDED: '已退款',
  REFUND_FAILED: '退款失败',
  FAILED: '支付失败',
}
const statusText = createLabelPresenter(statusLabels)

interface DisplayOrder extends AdminOrderItem {
  amountText: string
  createdText: string
  orderText: string
  statusText: string
  refundActionText: string
}

function displayOrders(orders: AdminOrderItem[]) {
  return orders.map(item => ({
    ...item,
    orderText: formatRecordCode(item.id, { prefix: '订单' }),
    statusText: statusText(item.status),
    amountText: formatMinorUnits(item.amountCents),
    createdText: formatLocalDateTime(item.createdAt),
    refundActionText: item.status === 'REFUND_FAILED' ? '重新提交退款' : '发起全额退款',
  }))
}

Page({
  data: { state: 'loading' as AdminPageState, orders: [] as DisplayOrder[], processingId: '', message: '' },
  onShow() { void this.loadOrders() },
  async loadOrders(force = false) {
    const cached = adminModule.peekOrders()
    if (cached) {
      this.setData({ state: 'ready', orders: displayOrders(cached), message: '' })
    }
    else if (this.data.state !== 'ready') {
      this.setData({ state: 'loading', message: '' })
    }
    try {
      const orders = await adminModule.listOrders({ force })
      this.setData({
        state: 'ready',
        orders: displayOrders(orders),
      })
    }
    catch (error) {
      this.setData(adminLoadFailure(error, {
        hasContent: Boolean(cached) || this.data.state === 'ready',
        fallbackMessage: '订单列表加载失败',
      }))
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
  async refund(event: WechatMiniprogram.TouchEvent) {
    const orderId = String(event.currentTarget.dataset.orderId || '')
    if (!orderId) {
      return
    }
    if (this.data.processingId) {
      return
    }
    // Confirm latch before showModal so stacked taps cannot open parallel dialogs.
    this.setData({ processingId: orderId, message: '' })
    try {
      const modal = await wx.showModal({
        title: '全额退款',
        content: '退款成功后，本订单对应的权益或活动名额会同步更新。确认继续？',
        confirmText: '提交退款',
        confirmColor: '#B8453E',
      })
      if (!modal.confirm) {
        return
      }
      await adminModule.refundOrder(orderId, '运营者确认全额退款')
      await this.loadOrders(true)
      const refreshed = this.data.orders.find(item => item.id === orderId)
      const completed = refreshed?.status === 'REFUNDED'
      this.setData({
        message: completed
          ? '退款已完成，会员权益已同步更新。'
          : '退款已提交微信支付，处理完成后会自动更新状态。',
      })
      wx.showToast({ title: completed ? '退款已完成' : '退款已提交', icon: 'success' })
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '退款提交失败' })
    }
    finally {
      this.setData({ processingId: '' })
    }
  },
  async confirmRefund(event: WechatMiniprogram.TouchEvent) {
    const orderId = String(event.currentTarget.dataset.orderId || '')
    const refundId = String(event.currentTarget.dataset.refundId || '')
    if (!orderId || !refundId) {
      return
    }
    if (this.data.processingId) {
      return
    }
    // Confirm latch before showModal so stacked taps cannot open parallel dialogs.
    this.setData({ processingId: orderId, message: '' })
    try {
      const modal = await wx.showModal({
        title: '确认退款已到账',
        content: '仅在微信支付账单或商户平台已显示退款成功时操作。确认后订单会标记为已退款，并重新计算会员权益。',
        confirmText: '确认到账',
        confirmColor: '#9A6B2F',
      })
      if (!modal.confirm) {
        return
      }
      await adminModule.confirmRefund(refundId)
      await this.loadOrders(true)
      this.setData({ message: '退款已确认到账，订单与会员权益已同步更新。' })
      wx.showToast({ title: '已更新为退款完成', icon: 'success' })
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '退款到账确认失败' })
    }
    finally {
      this.setData({ processingId: '' })
    }
  },
})
