import type { OrderId } from '../../../modules/mip'
import type { CommerceOrder, MembershipPlan } from '../../../modules/mip-commerce'
import { mipCommerceModule } from '../../../modules/mip-commerce/client'
import { mipCheckInResumeStore, mipEventsModule } from '../../../modules/mip-events/client'
import { mipIdentityModule } from '../../../modules/mip-identity/client'
import { mipMessagingModule } from '../../../modules/mip-messaging/client'
import { classifyPaymentResult, formatCny, planTitle, presentOrderStatus } from '../../../modules/mip-shell'
import { caseNavigateTo } from '../../../platform/navigation/client'
import { formatLocalDate } from '../../../utils/date'

Page({
  data: {
    result: 'checking' as 'checking' | 'success' | 'pending' | 'failed' | 'refund',
    orderId: '' as OrderId | '',
    order: null as CommerceOrder | null,
    isEventOrder: false,
    isContentOrder: false,
    eventId: '',
    contentId: '',
    attempts: 0,
    title: '正在确认支付',
    description: '支付调起完成不代表订单已支付，请等待服务端确认。',
    amountText: '',
    planName: '',
    statusText: '',
    membershipEndsText: '',
    canContinueCheckIn: false,
  },
  pollTimer: undefined as ReturnType<typeof setTimeout> | undefined,
  pageActive: true,
  checkRequestSeq: 0,

  onLoad(query: Record<string, string>) {
    this.pageActive = true
    this.setData({ orderId: String(query.orderId || '') as OrderId })
  },

  onShow() {
    this.pageActive = true
    if (!this.pollTimer && this.data.result !== 'success') {
      void this.check()
    }
  },

  onHide() { this.suspendPolling() },
  onUnload() { this.suspendPolling() },

  suspendPolling() {
    this.pageActive = false
    this.checkRequestSeq += 1
    this.stopPolling()
  },

  isCurrentCheck(requestSeq: number) {
    return this.pageActive && requestSeq === this.checkRequestSeq
  },

  stopPolling() {
    if (this.pollTimer) {
      clearTimeout(this.pollTimer)
    }
    this.pollTimer = undefined
  },

  async check() {
    this.stopPolling()
    const requestSeq = this.checkRequestSeq + 1
    this.checkRequestSeq = requestSeq
    if (!this.data.orderId) {
      if (this.isCurrentCheck(requestSeq)) {
        this.setData({ result: 'failed', title: '没有找到订单', description: '请返回订单列表重新查看。' })
      }
      return
    }
    try {
      const [orders, plans] = await Promise.all([
        mipCommerceModule.listOrders(),
        mipCommerceModule.listPlans().catch(() => [] as MembershipPlan[]),
      ])
      if (!this.isCurrentCheck(requestSeq)) {
        return
      }
      let order = orders.find(item => item.id === this.data.orderId)
      if (!order) {
        throw new Error('NOT_FOUND')
      }
      if (presentOrderStatus(order.status).paymentPending) {
        order = await mipCommerceModule.reconcile(order.id)
        if (!this.isCurrentCheck(requestSeq)) {
          return
        }
      }
      await this.applyOrder(order, plans, requestSeq)
    }
    catch (error) {
      if (!this.isCurrentCheck(requestSeq)) {
        return
      }
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
        this.schedulePoll(requestSeq)
      }
    }
  },

  async applyOrder(order: CommerceOrder, plans: readonly MembershipPlan[], requestSeq: number) {
    if (!this.isCurrentCheck(requestSeq)) {
      return
    }
    const classification = classifyPaymentResult(order)
    const isEventOrder = order.orderType === 'EVENT'
    const isContentOrder = order.orderType === 'CONTENT'
    const base = {
      order,
      isEventOrder,
      isContentOrder,
      eventId: isEventOrder ? order.resourceId || '' : '',
      contentId: isContentOrder ? order.resourceId || '' : '',
      amountText: formatCny(order.amountCents),
      planName: planTitle(order, plans),
      statusText: presentOrderStatus(order.status).label,
      membershipEndsText: isEventOrder || isContentOrder ? '' : this.data.membershipEndsText,
      canContinueCheckIn: false,
    }
    if (classification === 'success') {
      if (isEventOrder) {
        const registrationReady = await this.eventRegistrationReady(order.resourceId || '')
        if (!this.isCurrentCheck(requestSeq)) {
          return
        }
        if (!registrationReady) {
          const attempts = this.data.attempts + 1
          this.setData({
            ...base,
            result: attempts >= 6 ? 'pending' : 'checking',
            attempts,
            title: '支付已确认',
            description: attempts >= 6
              ? '报名资格仍在同步，请重新查询。资格生效前不能签到。'
              : '正在等待活动报名资格生效，资格生效前不能签到。',
          })
          if (attempts < 6) {
            this.schedulePoll(requestSeq)
          }
          return
        }
        this.setData({
          ...base,
          result: 'success',
          title: '报名成功',
          description: '支付已确认，活动报名资格已生效。',
          canContinueCheckIn: Boolean(order.resourceId && mipCheckInResumeStore.peek(order.resourceId)),
        })
        return
      }
      this.setData({
        ...base,
        result: 'success',
        title: '支付已确认',
        description: isContentOrder
          ? '服务端已确认订单为已支付，内容访问权益已生效。'
          : '服务端已确认订单为已支付，会员权益已生效。',
      })
      if (!isEventOrder && !isContentOrder) {
        void this.loadMembershipEnd(requestSeq)
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
          : isContentOrder
            ? '订单尚未达到已支付状态，内容访问权益暂未生效。'
            : '订单尚未达到已支付状态，会员权益暂未生效。',
      })
      if (attempts < 6) {
        this.schedulePoll(requestSeq)
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
        : isContentOrder
          ? '这笔订单未达到已支付状态，内容访问权益未生效。'
          : '这笔订单未达到已支付状态，会员权益未生效。',
    })
  },

  async eventRegistrationReady(eventId: string) {
    if (!eventId) {
      return false
    }
    try {
      const registration = await mipEventsModule.getMyRegistration(eventId as import('../../../modules/mip').EventId)
      return registration !== null && ['REGISTERED', 'ATTENDED'].includes(registration.status)
    }
    catch {
      return false
    }
  },

  schedulePoll(requestSeq: number) {
    if (!this.isCurrentCheck(requestSeq)) {
      return
    }
    this.pollTimer = setTimeout(() => {
      this.pollTimer = undefined
      if (this.isCurrentCheck(requestSeq)) {
        void this.check()
      }
    }, 1500)
  },

  async loadMembershipEnd(requestSeq: number) {
    try {
      const snapshot = await mipIdentityModule.loadSnapshot()
      if (this.isCurrentCheck(requestSeq)
        && snapshot.membership.kind === 'PLAYER'
        && snapshot.membership.entitlement?.endsAt) {
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
  async continueCheckIn() {
    if (!this.data.eventId || !mipCheckInResumeStore.peek(this.data.eventId)) {
      this.setData({
        canContinueCheckIn: false,
        description: '签到意图已失效，请返回现场重新扫描活动码。',
      })
      return
    }
    if (mipMessagingModule.subscriptionCapability('CHECKIN_RESULT').available) {
      await mipMessagingModule.requestWechatSubscription('CHECKIN_RESULT').catch(() => undefined)
    }
    caseNavigateTo({
      url: `/packages/member/mip-events/check-in/index?eventId=${encodeURIComponent(this.data.eventId)}&resumeCheckIn=1`,
    })
  },
  openContent() {
    if (this.data.contentId) {
      caseNavigateTo({ url: `/packages/member/mip-knowledge/detail/index?contentId=${encodeURIComponent(this.data.contentId)}` })
    }
  },
  openOrder() { caseNavigateTo({ url: `/packages/member/order-detail/index?orderId=${encodeURIComponent(this.data.orderId)}` }) },
})
