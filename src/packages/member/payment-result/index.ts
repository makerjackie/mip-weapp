import type { MembershipOrder } from '../../../modules/membership/types'
import { membershipModule } from '../../../modules/membership/client'
import { caseRedirectTo, caseRelaunch } from '../../../modules/platform/case-navigation'
import { formatLocalDate } from '../../../utils/date'

let pollTimer: ReturnType<typeof setTimeout> | undefined

Page({
  data: { result: 'checking' as 'checking' | 'success' | 'pending' | 'failed', orderId: '', order: null as MembershipOrder | null, attempts: 0, message: '正在查询付款结果…', amountText: '', planName: '', entitlementText: '' },
  onLoad(query: Record<string, string>) { this.setData({ orderId: query.orderId || '' }) },
  onShow() { void this.check() },
  onHide() {
    if (pollTimer) {
      clearTimeout(pollTimer)
    }
    pollTimer = undefined
  },
  onUnload() {
    if (pollTimer) {
      clearTimeout(pollTimer)
    }
    pollTimer = undefined
  },
  async check() {
    if (!this.data.orderId) {
      this.setData({ result: 'failed', order: null, message: '没有找到这笔订单' })
      return
    }
    try {
      const order = await membershipModule.reconcileOrder(this.data.orderId)
      const display = {
        order,
        amountText: `¥${(order.amountCents / 100).toFixed(2)}`,
        planName: order.planName,
        entitlementText: order.entitlementStart && order.entitlementEnd
          ? `${formatLocalDate(order.entitlementStart)} 至 ${formatLocalDate(order.entitlementEnd)}`
          : '',
      }
      if (order.status === 'PAID') {
        this.setData({ result: 'success', ...display, message: '会员权益已开通' })
        return
      }
      if (['FAILED', 'CLOSED', 'REFUND_FAILED'].includes(order.status)) {
        this.setData({ result: 'failed', ...display, message: '这笔订单未能完成' })
        return
      }
      const attempts = this.data.attempts + 1
      if (attempts >= 5) {
        this.setData({ result: 'pending', ...display, attempts, message: '正在查询付款结果，请稍候' })
        return
      }
      this.setData({ attempts, ...display, message: '正在查询付款结果…' })
      pollTimer = setTimeout(() => {
        pollTimer = undefined
        void this.check()
      }, 1000)
    }
    catch {
      // Transport failure is not payment success; keep pending so auto-retry can continue.
      this.setData({ result: 'pending', message: '正在查询付款结果，请稍候' })
    }
  },
  openMembership() { caseRelaunch({ url: '/pages/membership/index' }) },
  openOrder() { caseRedirectTo({ url: `/packages/member/order-detail/index?orderId=${encodeURIComponent(this.data.orderId)}` }) },
})
