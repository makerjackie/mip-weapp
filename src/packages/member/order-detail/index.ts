import type { EventId, OrderId } from '../../../modules/mip'
import type { CommerceOrder, MembershipPlan } from '../../../modules/mip-commerce'
import { MipCommerceError } from '../../../modules/mip-commerce'
import { mipCommerceModule } from '../../../modules/mip-commerce/client'
import { MipEventsError } from '../../../modules/mip-events'
import { mipCheckInResumeStore, mipEventsModule } from '../../../modules/mip-events/client'
import { mipAccessPageUrl } from '../../../modules/mip-identity'
import { mipIdentityModule } from '../../../modules/mip-identity/client'
import { mipMessagingModule } from '../../../modules/mip-messaging/client'
import { createIntentKey, formatCny, planTitle, presentOrderServiceStatus, presentOrderStatus } from '../../../modules/mip-shell'
import { caseNavigateTo, caseRedirectTo } from '../../../platform/navigation/client'
import { clearPageMedia, updatePageMedia } from '../../../platform/storage/component-media'
import { formatLocalDateTime } from '../../../utils/date'

function statusDescription(order: CommerceOrder) {
  switch (order.status) {
    case 'CREATED': return '订单已创建，尚未确认支付。'
    case 'PAYMENT_CREATED': return '付款结果尚未确认，若已扣款，请稍后刷新。'
    case 'PAID': return order.orderType === 'EVENT'
      ? '已付款，可在“我的活动”查看报名结果。'
      : order.orderType === 'CONTENT'
        ? '支付成功。'
        : '支付成功，会员权益已开通。'
    case 'FAILED': return '这笔订单未完成支付。'
    case 'CLOSED': return '这笔订单已关闭。'
    case 'REFUND_PENDING': return '退款申请已提交，正在处理。'
    case 'PARTIALLY_REFUNDED': return '这笔订单已完成部分退款。'
    case 'REFUNDED': return order.orderType === 'EVENT'
      ? '退款已完成，可在“我的活动”查看报名状态。'
      : order.orderType === 'CONTENT'
        ? '退款已完成。'
        : '退款已完成，可在会员页查看当前权益。'
  }
}

function uniqueText(values: Array<string | undefined>) {
  return [...new Set(values.map(value => value?.trim()).filter(Boolean))].join(' · ')
}

Page({
  data: {
    // ui-fidelity fixture 开关：默认走生产布局（被 vitest pin）。
    figmaLayout: false,
    state: 'loading' as 'loading' | 'ready' | 'error',
    orderId: '' as OrderId | '',
    order: null as CommerceOrder | null,
    isEventOrder: false,
    isContentOrder: false,
    eventId: '',
    eventCoverUrl: '',
    eventStartsText: '',
    eventEndsText: '',
    eventLocationText: '',
    priceItems: [] as Array<{ label: string, amountText: string }>,
    title: '订单',
    productDescription: '',
    statusText: '',
    serviceStatusText: '',
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
    // MIW-119：初值乐观，真实可用性由入口预取的支付能力快照与服务端裁决修正。
    paymentEnabled: true,
    paymentUnavailableText: '会员支付尚未配置',
    checkInResumeState: 'none' as 'none' | 'checking' | 'ready' | 'pending',
    checkInResumeMessage: '',
    paying: false,
    accessing: false,
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
    // MIW-119：入口即预取支付能力，支付点击零环境往返；disabled 前置置灰。
    void mipCommerceModule.ensurePaymentCapability()
      .then(capabilities => this.setData({ paymentEnabled: capabilities.available }))
      .catch(() => {})
  },

  onShow() {
    const resume = mipIdentityModule.consumePendingResume('packages/member/order-detail/index')
    if (resume && ['PURCHASE_MEMBERSHIP', 'REGISTER_EVENT', 'INTERACT'].includes(resume.action) && this.resumePayment) {
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

  onUnload() {
    clearPageMedia(this)
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
      // getOrder resolves the order directly; listOrders() only returns the 30 most recent orders,
      // so looking the order up there made older orders impossible to open.
      let [order, plans] = await Promise.all([
        mipCommerceModule.getOrder(this.data.orderId),
        mipCommerceModule.listPlans().catch(() => [] as MembershipPlan[]),
      ])
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
      // The commerce gateway puts the business code on error.code; error.message is Chinese copy.
      const notFound = (error as { code?: unknown })?.code === 'NOT_FOUND'
      this.setData(this.data.order
        ? { message: '订单更新失败，已保留上次结果。' }
        : { state: 'error', message: notFound ? '没有找到这笔订单。' : '订单暂时无法加载。' })
    }
  },

  applyOrder(order: CommerceOrder, plans: readonly MembershipPlan[]) {
    const status = presentOrderStatus(order.status)
    const orderServiceStatus = order.serviceStatus || 'UNAVAILABLE'
    const serviceStatus = presentOrderServiceStatus(orderServiceStatus)
    const plan = plans.find(item => String(item.id) === String(order.membershipPlanId))
    this.setData({
      state: 'ready',
      order,
      isEventOrder: order.orderType === 'EVENT',
      isContentOrder: order.orderType === 'CONTENT',
      eventId: order.orderType === 'EVENT' ? order.resourceId || '' : '',
      eventStartsText: order.event?.startsAt ? formatLocalDateTime(order.event.startsAt) : '',
      eventEndsText: order.event?.endsAt ? formatLocalDateTime(order.event.endsAt) : '',
      eventLocationText: uniqueText([order.event?.cityName, order.event?.venueName, order.event?.address]),
      priceItems: (order.priceItems || []).map(item => ({
        label: item.label,
        amountText: formatCny(item.amountCents),
      })),
      title: planTitle(order, plans),
      productDescription: plan?.description || '',
      statusText: status.label,
      serviceStatusText: orderServiceStatus === 'UNAVAILABLE' ? '' : serviceStatus.label,
      statusDescription: statusDescription(order),
      amountText: formatCny(order.amountCents),
      refundedAmountText: order.refundedAmountCents > 0 ? formatCny(order.refundedAmountCents) : '',
      createdText: order.createdAt ? formatLocalDateTime(order.createdAt) : '',
      paidText: order.paidAt ? formatLocalDateTime(order.paidAt) : '',
      statusBrand: status.tone === 'brand',
      statusSuccess: status.tone === 'success',
      statusDanger: status.tone === 'danger',
      paymentPending: status.paymentPending,
      refundable: status.refundable && order.orderType !== 'EVENT',
      paymentUnavailableText: order.orderType === 'EVENT'
        ? '活动支付尚未配置'
        : order.orderType === 'CONTENT' ? '内容支付尚未配置' : '会员支付尚未配置',
      checkInResumeState: 'none',
      checkInResumeMessage: '',
      message: '',
    })
    // 封面与详情页同一条本地下载管道：cloud:// 先隐藏，解析成临时路径后再渲染。
    updatePageMedia(this, 'eventCoverUrl', order.event?.coverUrl || '')
    if (order.orderType === 'EVENT' && order.status === 'PAID') {
      void this.refreshCheckInResume(order)
    }
  },

  async refreshCheckInResume(order: CommerceOrder) {
    const eventId = order?.orderType === 'EVENT' ? order.resourceId || '' : ''
    if (!eventId || !mipCheckInResumeStore.peek(eventId)) {
      this.setData({ checkInResumeState: 'none', checkInResumeMessage: '' })
      return
    }
    this.setData({
      checkInResumeState: 'checking',
      checkInResumeMessage: '正在核对活动报名资格。',
    })
    try {
      const registration = await mipEventsModule.getMyRegistration(eventId as EventId)
      if (this.data.order?.id !== order.id) {
        return
      }
      const ready = registration !== null && ['REGISTERED', 'ATTENDED'].includes(registration.status)
      this.setData({
        checkInResumeState: ready ? 'ready' : 'pending',
        checkInResumeMessage: ready
          ? '报名资格已生效，可以继续签到。'
          : '支付已确认，报名资格仍在同步。资格生效前不能签到。',
      })
    }
    catch {
      if (this.data.order?.id === order.id) {
        this.setData({
          checkInResumeState: 'pending',
          checkInResumeMessage: '报名资格暂时无法核对，请稍后重试。',
        })
      }
    }
  },

  retryEventRegistration() {
    if (this.data.order) {
      void this.refreshCheckInResume(this.data.order)
    }
  },

  copyOrderId() {
    const orderId = String(this.data.order?.id || '').trim()
    if (!orderId) {
      this.setData({ message: '订单号暂不可用，请重新加载。' })
      return
    }
    wx.setClipboardData({
      data: orderId,
      success: () => {
        this.setData({ message: '' })
        wx.showToast({ title: '订单号已复制', icon: 'success' })
      },
      fail: () => {
        this.setData({ message: '订单号复制失败，请点击订单号重试。' })
      },
    })
  },

  async continueCheckIn() {
    if (this.data.checkInResumeState !== 'ready' || !this.data.eventId || !mipCheckInResumeStore.peek(this.data.eventId)) {
      this.setData({
        checkInResumeState: 'pending',
        checkInResumeMessage: '请重新扫描现场签到码。',
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

  async requestPayment() {
    const order = this.data.order
    if (!order || !this.data.paymentPending || this.data.paying || this.data.accessing) {
      return
    }
    if (!this.data.paymentEnabled) {
      this.setData({ message: `${this.data.paymentUnavailableText}。` })
      return
    }
    this.resumePayment = true
    // BUG-04.3（审计 2026-10-12）：beginProtectedAction 的身份快照往返期间无锁（paying
    // 只在 performPayment 才置位），身份不完整时双击会把授权页叠两层。对照 mip-growth
    // confirmPurchase 的 accessing 闩锁：进入即置位，begin 失败/不 ready/异常路径统一在
    // finally 复位。
    this.setData({ accessing: true })
    try {
      const session = await mipIdentityModule.beginProtectedAction({
        action: order.orderType === 'EVENT'
          ? 'REGISTER_EVENT'
          : order.orderType === 'CONTENT' ? 'INTERACT' : 'PURCHASE_MEMBERSHIP',
        source: {
          navigation: 'navigateBack',
          ...(order.orderType === 'EVENT' && order.resourceId
            ? { route: '/packages/member/order-detail/index', query: { orderId: order.id, eventId: order.resourceId } }
            : {}),
        },
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
    finally {
      this.setData({ accessing: false })
    }
  },

  async performPayment() {
    const order = this.data.order
    if (!order || !this.data.paymentPending || this.data.paying) {
      return
    }
    this.setData({ paying: true, message: '' })
    try {
      if (order.orderType === 'EVENT' && order.resourceId) {
        const registration = await mipEventsModule.getMyRegistration(order.resourceId as EventId)
        if (registration?.status === 'PAYMENT_PENDING') {
          if (registration.orderId !== order.id) {
            this.setData({ message: '当前报名已关联其他订单，请返回活动查看最新状态。' })
            return
          }
          const renewed = await mipEventsModule.register({
            eventId: order.resourceId as EventId,
            formVersion: registration.formVersion,
            answers: registration.answers,
            // MIW-91：不再回传 shareProfile，服务端写路径默认公开（opt-out）。
            idempotencyKey: createIntentKey('event-payment-resume'),
          })
          if (renewed.kind !== 'PAYMENT_REQUIRED' || renewed.orderId !== order.id) {
            this.setData({ message: '报名状态已变化，请返回活动查看最新状态。' })
            return
          }
        }
      }
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
      if (error instanceof MipEventsError && error.code === 'CONFLICT' && order.orderType === 'EVENT' && order.resourceId) {
        caseNavigateTo({ url: `/packages/member/mip-events/registration/index?eventId=${encodeURIComponent(order.resourceId)}` })
        return
      }
      if (error instanceof MipEventsError) {
        this.setData({ message: error.message })
        return
      }
      // MIW-119：可用性错误来自服务端 envelope，按 code 匹配（message 是人话文案）。
      // MIW-123：PAYMENT_UNAVAILABLE 是 provider 拒绝/下发失败，不是「未配置」；
      // 未配置态由入口 paymentEnabled 预检拦截并使用 paymentUnavailableText。
      const unavailable = error instanceof MipCommerceError && error.code === 'PAYMENT_UNAVAILABLE'
      this.setData({ message: unavailable ? '支付服务暂时不可用，请稍后重试。' : '暂时无法发起支付，请稍后重试。' })
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
    // BUG-09.1（审计 2026-10-12）：原实现到弹窗确认后才置 submittingRefund，
    // beginProtectedAction 往返窗口内双击会弹两个 showModal，第二个 fail 被 catch 吞掉后
    // 还显示误导性的「身份状态暂时无法确认」。锁提前到入口，覆盖身份检查与确认弹窗全程；
    // 取消弹窗、确认提交、异常路径都在 finally 复位。退款幂等仍由 refundKey 保证（未改动）。
    this.setData({ submittingRefund: true })
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
      await this.runRefundConfirmation(order)
    }
    catch {
      this.resumeRefund = false
      this.setData({ message: '身份状态暂时无法确认，请稍后重试。' })
    }
    finally {
      this.setData({ submittingRefund: false })
    }
  },

  /** onShow 授权恢复后的直达入口；与 requestRefund 共用弹窗与提交，同样全程持有锁。 */
  async confirmAndSubmitRefund() {
    const order = this.data.order
    if (!order || !this.data.refundable || this.data.submittingRefund) {
      return
    }
    this.setData({ submittingRefund: true })
    try {
      await this.runRefundConfirmation(order)
    }
    finally {
      this.setData({ submittingRefund: false })
    }
  },

  /** 确认弹窗 + 提交换款；调用方必须已持有 submittingRefund 锁（BUG-09.1）。 */
  async runRefundConfirmation(order: CommerceOrder) {
    const confirmation = await wx.showModal({
      title: '申请退款',
      content: '确认提交退款申请？提交后可在订单详情查看进度。',
      confirmText: '确认提交',
      cancelText: '取消',
    })
    if (!confirmation.confirm) {
      return
    }
    this.setData({ message: '' })
    try {
      await mipCommerceModule.requestRefund({
        orderId: order.id,
        idempotencyKey: this.refundKey,
        reason: '用户申请退款',
      })
      this.setData({ message: '退款申请已提交，可在本页查看进度。' })
      await this.load()
    }
    catch (error) {
      const unavailable = error instanceof MipCommerceError && error.code === 'PAYMENT_UNAVAILABLE'
      const message = unavailable
        ? '退款服务尚未配置。'
        : '退款提交结果暂时无法确认，已重新查询订单状态。'
      await this.load()
      this.setData({ message })
    }
  },

  openMembership() { caseNavigateTo({ url: '/packages/member/mip-growth/index' }) },
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
