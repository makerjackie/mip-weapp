import type { MembershipOrder } from '../../../modules/membership/types'
import { membershipModule } from '../../../modules/membership/client'
import { caseNavigateTo } from '../../../modules/platform/case-navigation'
import { formatLocalDate, formatLocalDateTime } from '../../../utils/date'

const labels: Record<MembershipOrder['status'], string> = {
  PENDING: '待支付',
  PAYMENT_CREATED: '正在确认支付',
  PAID: '已支付',
  CLOSED: '已关闭',
  REFUND_PENDING: '退款处理中',
  REFUNDED: '已退款',
  REFUND_FAILED: '退款失败',
  FAILED: '支付失败',
}

function refundCopy(order: MembershipOrder) {
  if (order.status === 'REFUNDED' || order.refundStatus === 'REFUNDED') {
    return {
      visible: true,
      completed: true,
      title: '退款已完成',
      description: '款项将按微信支付规则原路退回，会员权益已同步更新。',
    }
  }
  if (order.status === 'REFUND_PENDING' || order.refundStatus === 'REFUND_PENDING' || order.refundStatus === 'REFUND_CREATED') {
    return {
      visible: true,
      completed: false,
      title: '退款处理中',
      description: '退款已提交微信支付，处理完成后本页会自动更新。',
    }
  }
  if (order.status === 'REFUND_FAILED' || order.refundStatus === 'REFUND_FAILED') {
    return {
      visible: true,
      completed: false,
      title: '退款未完成',
      description: '本次退款没有成功，会员权益不受影响，请联系售后协助处理。',
    }
  }
  return { visible: false, completed: false, title: '', description: '' }
}

Page({
  data: {
    state: 'loading' as 'loading' | 'ready' | 'error',
    orderId: '',
    order: null as MembershipOrder | null,
    statusText: '',
    amountText: '',
    createdText: '',
    paidText: '',
    entitlementText: '',
    entitlementLabel: '权益有效期',
    refundVisible: false,
    refundCompleted: false,
    refundTitle: '',
    refundDescription: '',
    message: '',
  },
  requestSeq: 0,

  onLoad(query: Record<string, string>) {
    this.setData({ orderId: query.orderId || '' })
  },
  onShow() {
    void this.load()
  },
  async load() {
    if (!this.data.orderId) {
      this.setData({ state: 'error', message: '没有找到这笔订单' })
      return
    }
    if (this.data.state !== 'ready') {
      this.setData({ state: 'loading', message: '' })
    }
    const seq = this.requestSeq + 1
    this.requestSeq = seq
    try {
      const order = await membershipModule.reconcileOrder(this.data.orderId)
      if (seq !== this.requestSeq) {
        return
      }
      const refund = refundCopy(order)
      this.setData({
        state: 'ready',
        order,
        statusText: labels[order.status],
        amountText: `¥${(order.amountCents / 100).toFixed(2)}`,
        createdText: formatLocalDateTime(order.createdAt),
        paidText: order.paidAt ? formatLocalDateTime(order.paidAt) : '',
        entitlementText: order.entitlementStart && order.entitlementEnd
          ? `${formatLocalDate(order.entitlementStart)} 至 ${formatLocalDate(order.entitlementEnd)}`
          : '',
        entitlementLabel: refund.completed ? '原权益有效期' : '权益有效期',
        refundVisible: refund.visible,
        refundCompleted: refund.completed,
        refundTitle: refund.title,
        refundDescription: refund.description,
        message: '',
      })
    }
    catch (error) {
      if (seq !== this.requestSeq) {
        return
      }
      this.setData(this.data.state === 'ready'
        ? { message: '订单更新失败，已保留上次结果。' }
        : { state: 'error', message: error instanceof Error ? error.message : '订单加载失败' })
    }
  },
  openMembership() {
    caseNavigateTo({ url: '/pages/membership/index' })
  },
  openHelp() {
    caseNavigateTo({ url: '/packages/member/help/index' })
  },
})
