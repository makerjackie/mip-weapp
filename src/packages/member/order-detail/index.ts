import type { OrderId } from '../../../modules/mip'
import type { CommerceOrder, MembershipPlan } from '../../../modules/mip-commerce'
import { runtimeConfig } from '../../../config/runtime'
import { mipCommerceModule } from '../../../modules/mip-commerce/client'
import { mipAccessPageUrl } from '../../../modules/mip-identity'
import { mipIdentityModule } from '../../../modules/mip-identity/client'
import { createIntentKey, formatCny, planTitle, presentOrderStatus } from '../../../modules/mip-shell'
import { caseNavigateTo, caseRedirectTo } from '../../../modules/platform/case-navigation'
import { formatLocalDateTime } from '../../../utils/date'

function statusDescription(order: CommerceOrder) {
  switch (order.status) {
    case 'CREATED': return '订单已创建，尚未确认支付。'
    case 'PAYMENT_CREATED': return '已调起支付，正在等待服务端确认。'
    case 'PAID': return order.orderType === 'EVENT'
      ? '服务端已确认支付，活动报名已生效。'
      : '服务端已确认支付，会员权益已生效。'
    case 'FAILED': return '这笔订单未完成支付。'
    case 'CLOSED': return '这笔订单已关闭。'
    case 'REFUND_PENDING': return '退款意图已提交，处理结果以服务端状态为准。'
    case 'PARTIALLY_REFUNDED': return '这笔订单已完成部分退款。'
    case 'REFUNDED': return order.orderType === 'EVENT'
      ? '退款已完成，活动报名状态已按服务端事实更新。'
      : '退款已完成，会员权益已按服务端事实更新。'
  }
}

Page({
  data: {
    state: 'loading' as 'loading' | 'ready' | 'error',
    orderId: '' as OrderId | '',
    order: null as CommerceOrder | null,
    isEventOrder: false,
    eventId: '',
    title: '订单',
    productDescription: '',
    statusText: '',
    statusDescription: '',
    amountText: '',
    refundedAmountText: '',
    createdText: '',
    paidText: '',
    statusBrand: false,
    statusSuccess: false,
    statusDanger: false,
    paymentPending: false,
    refundable: false,
    paymentEnabled: runtimeConfig.paymentMode !== 'disabled',
    paymentUnavailableText: '会员支付尚未配置',
    paying: false,
    submittingRefund: false,
    message: '',
  },
  requestSeq: 0,
  refundKey: '',
  resumePayment: false,
  resumeRefund: false,

  onLoad(query: Record<string, string>) {
    const orderId = String(query.orderId || '') as OrderId
    this.refundKey = createIntentKey('order-refund')
    this.setData({ orderId })
  },

  onShow() {
    const resume = mipIdentityModule.consumePendingResume('packages/member/order-detail/index')
    if (resume && ['PURCHASE_MEMBERSHIP', 'REGISTER_EVENT'].includes(resume.action) && this.resumePayment) {
      this.resumePayment = false
      void this.performPayment()
      return
    }
    if (resume?.action === 'INTERACT' && this.resumeRefund) {
      this.resumeRefund = false
      void this.confirmAndSubmitRefund()
      return
    }
    this.resumePayment = false
    this.resumeRefund = false
    void this.load()
  },

  async load() {
    if (!this.data.orderId) {
      this.setData({ state: 'error', message: '没有找到这笔订单。' })
      return
    }
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
      let order = orders.find(item => item.id === this.data.orderId)
      if (!order) {
        throw new Error('NOT_FOUND')
      }
      if (presentOrderStatus(order.status).paymentPending) {
        try {
          order = await mipCommerceModule.reconcile(order.id)
        }
        catch {
          // Keep the last server order fact visible while provider reconciliation is unavailable.
        }
      }
      if (requestSeq !== this.requestSeq) {
        return
      }
      this.applyOrder(order, plans)
    }
    catch (error) {
      if (requestSeq !== this.requestSeq) {
        return
      }
      const notFound = error instanceof Error && error.message === 'NOT_FOUND'
      this.setData(this.data.order
        ? { message: '订单更新失败，已保留上次结果。' }
        : { state: 'error', message: notFound ? '没有找到这笔订单。' : '订单暂时无法加载。' })
    }
  },

  applyOrder(order: CommerceOrder, plans: readonly MembershipPlan[]) {
    const status = presentOrderStatus(order.status)
    const plan = plans.find(item => String(item.id) === String(order.membershipPlanId))
    this.setData({
      state: 'ready',
      order,
      isEventOrder: order.orderType === 'EVENT',
      eventId: order.orderType === 'EVENT' ? order.resourceId || '' : '',
      title: planTitle(order, plans),
      productDescription: plan?.description || '',
      statusText: status.label,
      statusDescription: statusDescription(order),
      amountText: formatCny(order.amountCents),
      refundedAmountText: order.refundedAmountCents > 0 ? formatCny(order.refundedAmountCents) : '',
      createdText: order.createdAt ? formatLocalDateTime(order.createdAt) : '',
      paidText: order.paidAt ? formatLocalDateTime(order.paidAt) : '',
      statusBrand: status.tone === 'brand',
      statusSuccess: status.tone === 'success',
      statusDanger: status.tone === 'danger',
      paymentPending: status.paymentPending,
      refundable: status.refundable,
      paymentUnavailableText: order.orderType === 'EVENT' ? '活动支付尚未配置' : '会员支付尚未配置',
      message: '',
    })
  },

  async requestPayment() {
    const order = this.data.order
    if (!order || !this.data.paymentPending || this.data.paying) {
      return
    }
    if (!this.data.paymentEnabled) {
      this.setData({ message: `${this.data.paymentUnavailableText}。` })
      return
    }
    this.resumePayment = true
    try {
      const session = await mipIdentityModule.beginProtectedAction({
        action: order.orderType === 'EVENT' ? 'REGISTER_EVENT' : 'PURCHASE_MEMBERSHIP',
        source: { navigation: 'navigateBack' },
      })
      if (!session.decision.ready) {
        caseNavigateTo({ url: mipAccessPageUrl(session.token) })
        return
      }
      this.resumePayment = false
      await this.performPayment()
    }
    catch {
      this.resumePayment = false
      this.setData({ message: '身份状态暂时无法确认，请稍后重试。' })
    }
  },

  async performPayment() {
    const order = this.data.order
    if (!order || !this.data.paymentPending || this.data.paying) {
      return
    }
    this.setData({ paying: true, message: '' })
    try {
      const outcome = await mipCommerceModule.payOrder(order.id)
      if (outcome.kind === 'CANCELLED') {
        this.setData({ message: '支付已取消，订单状态未发生变化。' })
        return
      }
      caseRedirectTo({
        url: `/packages/member/payment-result/index?orderId=${encodeURIComponent(outcome.order.id)}`,
      })
    }
    catch (error) {
      const unavailable = error instanceof Error && error.message === 'PAYMENT_UNAVAILABLE'
      this.setData({ message: unavailable ? `${this.data.paymentUnavailableText}。` : '暂时无法发起支付，请稍后重试。' })
    }
    finally {
      this.setData({ paying: false })
    }
  },

  async requestRefund() {
    const order = this.data.order
    if (!order || !this.data.refundable || this.data.submittingRefund) {
      return
    }
    if (!this.data.paymentEnabled) {
      this.setData({ message: '退款服务尚未配置。' })
      return
    }
    this.resumeRefund = true
    try {
      const session = await mipIdentityModule.beginProtectedAction({
        action: 'INTERACT',
        source: { navigation: 'navigateBack' },
      })
      if (!session.decision.ready) {
        caseNavigateTo({ url: mipAccessPageUrl(session.token) })
        return
      }
      this.resumeRefund = false
      await this.confirmAndSubmitRefund()
    }
    catch {
      this.resumeRefund = false
      this.setData({ message: '身份状态暂时无法确认，请稍后重试。' })
    }
  },

  async confirmAndSubmitRefund() {
    const order = this.data.order
    if (!order || !this.data.refundable || this.data.submittingRefund) {
      return
    }
    const confirmation = await wx.showModal({
      title: '申请退款',
      content: '提交后将由服务端核对可退金额和订单关联状态。',
      confirmText: '确认提交',
      cancelText: '取消',
    })
    if (!confirmation.confirm) {
      return
    }
    this.setData({ submittingRefund: true, message: '' })
    try {
      await mipCommerceModule.requestRefund({
        orderId: order.id,
        idempotencyKey: this.refundKey,
        reason: '用户申请退款',
      })
      this.setData({ message: '退款意图已提交，请以订单状态为准。' })
      await this.load()
    }
    catch (error) {
      const unavailable = error instanceof Error && error.message === 'PAYMENT_UNAVAILABLE'
      const message = unavailable
        ? '退款服务尚未配置。'
        : '退款提交结果暂时无法确认，已重新查询订单状态。'
      await this.load()
      this.setData({ message })
    }
    finally {
      this.setData({ submittingRefund: false })
    }
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
  openHelp() { caseNavigateTo({ url: '/packages/member/help/index' }) },
})
