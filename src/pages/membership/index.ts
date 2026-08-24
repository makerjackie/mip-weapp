import type { MembershipPlan, MembershipPlanId } from '../../modules/mip-commerce'
import { runtimeConfig } from '../../config/runtime'
import { mipCommerceModule } from '../../modules/mip-commerce/client'
import { mipAccessPageUrl } from '../../modules/mip-identity'
import { mipIdentityModule } from '../../modules/mip-identity/client'
import { createIntentKey, formatCny, membershipPresentation } from '../../modules/mip-shell'
import { caseNavigateTo, caseRedirectTo } from '../../modules/platform/case-navigation'
import { formatLocalDate } from '../../utils/date'

interface DisplayPlan extends MembershipPlan {
  priceText: string
  durationText: string
}

function presentPlan(plan: MembershipPlan): DisplayPlan {
  return {
    ...plan,
    priceText: formatCny(plan.priceCents),
    durationText: `${plan.durationDays} 天`,
  }
}

function decodeQueryValue(value: string | undefined) {
  if (typeof value !== 'string' || !value || value.length > 768) {
    return ''
  }
  try {
    return decodeURIComponent(value).slice(0, 512)
  }
  catch {
    return ''
  }
}

Page({
  data: {
    state: 'loading' as 'loading' | 'ready' | 'error',
    plans: [] as DisplayPlan[],
    selectedPlanId: '' as MembershipPlanId | '',
    selectedBenefits: [] as string[],
    identityState: 'loading' as 'loading' | 'ready' | 'error',
    membershipLabel: '嘉宾',
    membershipDescription: '当前没有有效会员权益',
    membershipEndsText: '',
    isPlayer: false,
    paymentEnabled: runtimeConfig.paymentMode !== 'disabled',
    paying: false,
    accessing: false,
    invitationReady: false,
    message: '',
  },
  incomingInvitationToken: '',
  shareInvitationToken: '',
  resumePlanId: '' as MembershipPlanId | '',
  checkoutKey: '',
  checkoutPlanId: '' as MembershipPlanId | '',

  onLoad(query: Record<string, string | undefined>) {
    this.incomingInvitationToken = decodeQueryValue(query.invitationToken)
    void this.loadPlans()
  },

  onShow() {
    const resume = mipIdentityModule.consumePendingResume('pages/membership/index')
    if (resume?.action === 'PURCHASE_MEMBERSHIP' && this.resumePlanId) {
      const planId = this.resumePlanId
      this.resumePlanId = ''
      void this.performPurchase(planId)
      return
    }
    this.resumePlanId = ''
    void this.loadIdentity()
  },

  async loadPlans() {
    if (this.data.state !== 'ready') {
      this.setData({ state: 'loading' })
    }
    try {
      const plans = (await mipCommerceModule.listPlans()).map(presentPlan)
      const selectedPlanId = plans.some(plan => plan.id === this.data.selectedPlanId)
        ? this.data.selectedPlanId
        : plans[0]?.id || ''
      const selected = plans.find(plan => plan.id === selectedPlanId)
      this.setData({
        state: 'ready',
        plans,
        selectedPlanId,
        selectedBenefits: selected?.benefits || [],
        message: plans.length ? '' : '当前没有可用会员方案。',
      })
    }
    catch {
      this.setData(this.data.plans.length
        ? { message: '会员方案更新失败，已保留上次结果。' }
        : { state: 'error', message: '会员方案暂时无法加载。' })
    }
  },

  async loadIdentity() {
    try {
      const snapshot = await mipIdentityModule.loadSnapshot()
      const membership = membershipPresentation(snapshot.membership.kind, snapshot.membership.entitlement)
      this.setData({
        identityState: 'ready',
        membershipLabel: membership.label,
        membershipDescription: membership.description,
        membershipEndsText: membership.endsAt ? formatLocalDate(membership.endsAt) : '',
        isPlayer: membership.label === '玩家',
      })
      if (membership.label === '玩家') {
        void this.prepareInvitation()
      }
      else {
        this.shareInvitationToken = ''
        this.setData({ invitationReady: false })
      }
    }
    catch {
      this.setData({ identityState: 'error' })
    }
  },

  async prepareInvitation() {
    try {
      const invitation = await mipCommerceModule.createMembershipInvitation()
      this.shareInvitationToken = invitation.token
      this.setData({ invitationReady: true })
    }
    catch {
      this.shareInvitationToken = ''
      this.setData({ invitationReady: false })
    }
  },

  async onPullDownRefresh() {
    try {
      await Promise.allSettled([this.loadPlans(), this.loadIdentity()])
    }
    finally {
      wx.stopPullDownRefresh()
    }
  },

  selectPlan(event: WechatMiniprogram.TouchEvent) {
    const selectedPlanId = String(event.currentTarget.dataset.planId || '') as MembershipPlanId
    const selected = this.data.plans.find(plan => plan.id === selectedPlanId)
    if (!selected) {
      return
    }
    this.checkoutKey = ''
    this.checkoutPlanId = ''
    this.setData({ selectedPlanId, selectedBenefits: selected.benefits, message: '' })
  },

  async purchase() {
    const planId = this.data.selectedPlanId
    if (!planId || this.data.paying || this.data.accessing) {
      return
    }
    if (!this.data.paymentEnabled) {
      this.setData({ message: '会员支付尚未配置。' })
      return
    }
    this.resumePlanId = planId
    this.setData({ accessing: true, message: '' })
    try {
      const session = await mipIdentityModule.beginProtectedAction({
        action: 'PURCHASE_MEMBERSHIP',
        source: { navigation: 'navigateBack' },
      })
      if (!session.decision.ready) {
        caseNavigateTo({ url: mipAccessPageUrl(session.token) })
        return
      }
      this.resumePlanId = ''
      await this.performPurchase(planId)
    }
    catch {
      this.resumePlanId = ''
      this.setData({ message: '身份状态暂时无法确认，请稍后重试。' })
    }
    finally {
      this.setData({ accessing: false })
    }
  },

  async performPurchase(planId: MembershipPlanId) {
    if (this.data.paying) {
      return
    }
    if (this.checkoutPlanId !== planId || !this.checkoutKey) {
      this.checkoutPlanId = planId
      this.checkoutKey = createIntentKey('membership-checkout')
    }
    this.setData({ paying: true, message: '' })
    try {
      const outcome = await mipCommerceModule.purchase({
        planId,
        idempotencyKey: this.checkoutKey,
        invitationToken: this.incomingInvitationToken || undefined,
      })
      if (outcome.kind === 'CANCELLED') {
        this.setData({ message: '支付已取消，会员权益未发生变化。' })
        return
      }
      caseRedirectTo({
        url: `/packages/member/payment-result/index?orderId=${encodeURIComponent(outcome.order.id)}`,
      })
    }
    catch (error) {
      const code = error instanceof Error ? error.message : ''
      this.setData({
        message: code === 'PAYMENT_UNAVAILABLE'
          ? '会员支付尚未配置。'
          : '暂时无法发起支付，请稍后重试。',
      })
    }
    finally {
      this.setData({ paying: false })
    }
  },

  openOrders() { caseNavigateTo({ url: '/packages/member/orders/index' }) },
  openBenefits() { caseNavigateTo({ url: '/packages/member/benefits/index' }) },

  onShareAppMessage() {
    const invitation = this.shareInvitationToken
      ? `&invitationToken=${encodeURIComponent(this.shareInvitationToken)}`
      : ''
    return {
      title: 'MIP 会员方案',
      path: `/pages/membership/index?source=member-share${invitation}`,
    }
  },
})
