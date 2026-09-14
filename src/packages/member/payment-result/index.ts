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
    description: '正在查询支付结果，请稍候。',
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
      let order = await mipCommerceModule.getOrder(this.data.orderId)
      const plans = mipCommerceModule.peekPlans() || []
      if (!this.isCurrentCheck(requestSeq)) {
        return
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
        result: 'pending',
        attempts,
        title: '暂时无法查询支付结果',
        description: '若微信已扣款，请勿重复支付。可稍后刷新，或在“我的订单”查看。',
      })
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
              ? '已付款，报名仍在处理中，请稍后刷新。'
              : '已付款，正在确认报名。',
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
          ? '支付成功，现在可以查看内容。'
          : '支付成功，会员权益已开通。',
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
        title: attempts >= 6 ? '支付结果待确认' : '正在确认支付',
        description: isEventOrder
          ? '尚未确认付款，报名暂未完成。若已扣款，请稍后刷新。'
          : isContentOrder
            ? '尚未确认付款。若已扣款，请稍后刷新。'
            : '尚未确认付款，会员暂未开通。若已扣款，请稍后刷新。',
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
        ? '这笔订单未完成付款，报名未成功。'
        : isContentOrder
          ? '这笔订单未完成付款，暂时无法查看内容。'
          : '这笔订单未完成付款，会员未开通。',
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
        description: '请重新扫描现场签到码。',
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
