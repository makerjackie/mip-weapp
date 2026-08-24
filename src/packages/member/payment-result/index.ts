import type { OrderId } from '../../../modules/mip'
import type { CommerceOrder, MembershipPlan } from '../../../modules/mip-commerce'
import { mipCommerceModule } from '../../../modules/mip-commerce/client'
import { mipIdentityModule } from '../../../modules/mip-identity/client'
import { classifyPaymentResult, formatCny, planTitle, presentOrderStatus } from '../../../modules/mip-shell'
import { caseNavigateTo } from '../../../modules/platform/case-navigation'
import { formatLocalDate } from '../../../utils/date'

let pollTimer: ReturnType<typeof setTimeout> | undefined

Page({
  data: {
    result: 'checking' as 'checking' | 'success' | 'pending' | 'failed' | 'refund',
    orderId: '' as OrderId | '',
    order: null as CommerceOrder | null,
    isEventOrder: false,
    eventId: '',
    attempts: 0,
    title: '正在确认支付',
    description: '支付调起完成不代表订单已支付，请等待服务端确认。',
    amountText: '',
    planName: '',
    statusText: '',
    membershipEndsText: '',
  },

  onLoad(query: Record<string, string>) {
    this.setData({ orderId: String(query.orderId || '') as OrderId })
  },

  onShow() {
    if (!pollTimer && this.data.result !== 'success') {
      void this.check()
    }
  },

  onHide() { this.stopPolling() },
  onUnload() { this.stopPolling() },

  stopPolling() {
    if (pollTimer) {
      clearTimeout(pollTimer)
    }
    pollTimer = undefined
  },

  async check() {
    this.stopPolling()
    if (!this.data.orderId) {
      this.setData({ result: 'failed', title: '没有找到订单', description: '请返回订单列表重新查看。' })
      return
    }
    try {
      const [orders, plans] = await Promise.all([
        mipCommerceModule.listOrders(),
        mipCommerceModule.listPlans().catch(() => [] as MembershipPlan[]),
      ])
      let order = orders.find(item => item.id === this.data.orderId)
      if (!order) {
        throw new Error('NOT_FOUND')
      }
      if (presentOrderStatus(order.status).paymentPending) {
        order = await mipCommerceModule.reconcile(order.id)
      }
      this.applyOrder(order, plans)
    }
    catch (error) {
      const attempts = this.data.attempts + 1
      const notFound = error instanceof Error && error.message === 'NOT_FOUND'
      if (notFound) {
        this.setData({ result: 'failed', attempts, title: '没有找到订单', description: '请返回订单列表重新查看。' })
        return
      }
      this.setData({
        result: attempts >= 6 ? 'pending' : 'checking',
        attempts,
        title: attempts >= 6 ? '支付结果仍在确认' : '正在确认支付',
        description: '暂时无法获取最新订单状态。你可以稍后再查，期间不会重复发起支付。',
      })
      if (attempts < 6) {
        this.schedulePoll()
      }
    }
  },

  applyOrder(order: CommerceOrder, plans: readonly MembershipPlan[]) {
    const classification = classifyPaymentResult(order)
    const isEventOrder = order.orderType === 'EVENT'
    const base = {
      order,
      isEventOrder,
      eventId: isEventOrder ? order.resourceId || '' : '',
      amountText: formatCny(order.amountCents),
      planName: planTitle(order, plans),
      statusText: presentOrderStatus(order.status).label,
      membershipEndsText: isEventOrder ? '' : this.data.membershipEndsText,
    }
    if (classification === 'success') {
      this.setData({
        ...base,
        result: 'success',
        title: '支付已确认',
        description: isEventOrder
          ? '服务端已确认订单为已支付，活动报名已生效。'
          : '服务端已确认订单为已支付，会员权益已生效。',
      })
      if (!isEventOrder) {
        void this.loadMembershipEnd()
      }
      return
    }
    if (classification === 'pending') {
      const attempts = this.data.attempts + 1
      this.setData({
        ...base,
        result: attempts >= 6 ? 'pending' : 'checking',
        attempts,
        title: attempts >= 6 ? '支付结果仍在确认' : '正在确认支付',
        description: isEventOrder
          ? '订单尚未达到已支付状态，活动报名尚未生效。'
          : '订单尚未达到已支付状态，会员权益暂未生效。',
      })
      if (attempts < 6) {
        this.schedulePoll()
      }
      return
    }
    if (['REFUND_PENDING', 'PARTIALLY_REFUNDED', 'REFUNDED'].includes(order.status)) {
      this.setData({
        ...base,
        result: 'refund',
        title: presentOrderStatus(order.status).label,
        description: '这笔订单已进入退款流程，请在订单详情查看最新状态。',
      })
      return
    }
    this.setData({
      ...base,
      result: 'failed',
      title: presentOrderStatus(order.status).label,
      description: isEventOrder
        ? '这笔订单未达到已支付状态，活动报名未生效。'
        : '这笔订单未达到已支付状态，会员权益未生效。',
    })
  },

  schedulePoll() {
    pollTimer = setTimeout(() => {
      pollTimer = undefined
      void this.check()
    }, 1500)
  },

  async loadMembershipEnd() {
    try {
      const snapshot = await mipIdentityModule.loadSnapshot()
      if (snapshot.membership.kind === 'PLAYER' && snapshot.membership.entitlement?.endsAt) {
        this.setData({ membershipEndsText: formatLocalDate(snapshot.membership.entitlement.endsAt) })
      }
    }
    catch {
      // The PAID order remains authoritative even when the profile projection is temporarily unavailable.
    }
  },

  retry() {
    this.setData({ attempts: 0, result: 'checking', title: '正在确认支付' })
    void this.check()
  },

  openMembership() { caseNavigateTo({ url: '/pages/membership/index' }) },
  openEvent() {
    if (!this.data.eventId) {
      return
    }
    caseNavigateTo({
      url: `/packages/member/mip-events/detail/index?eventId=${encodeURIComponent(this.data.eventId)}`,
    })
  },
  openMyEvents() { caseNavigateTo({ url: '/packages/member/mip-events/mine/index' }) },
  openOrder() { caseNavigateTo({ url: `/packages/member/order-detail/index?orderId=${encodeURIComponent(this.data.orderId)}` }) },
})
