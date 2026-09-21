import type { MembershipPlan, MembershipPlanId } from '../../../modules/mip-commerce'
import { runtimeConfig } from '../../../config/runtime'
import { MipCommerceError } from '../../../modules/mip-commerce'
import { mipCommerceModule } from '../../../modules/mip-commerce/client'
import { mipAccessPageUrl } from '../../../modules/mip-identity'
import { mipIdentityModule } from '../../../modules/mip-identity/client'
import { createIntentKey } from '../../../modules/mip-shell'
import { caseNavigateTo, caseSwitchPrimary } from '../../../platform/navigation/client'

/** journey-review J1-07（join-order）：商品固定为 MIP 玩家会员 · 年卡。 */
const MEMBERSHIP_PLAN_FALLBACK_TITLE = '玩家会员 · 年卡'

/** Whole yuan prices drop the decimals（figma join-order 价格展示约定）。 */
function amountText(amountCents: number) {
  const value = amountCents / 100
  return Number.isInteger(value) ? String(value) : value.toFixed(2)
}

function planValidityText(plan: MembershipPlan) {
  return `开通之日起 ${plan.durationDays} 天 · 到期自动关闭权益`
}

const MEMBERSHIP_PURCHASE_NOTICES = [
  '一、订单确认与支付',
  '提交订单并成功支付后，即视为交易合同成立；支付成功后才开通玩家权益。',
  '二、支付方式',
  '微信支付。',
  '三、订单修改',
  '支付前可返回放弃本次开通；未完成支付的订单不会保留，重新发起即重新创建。',
].join('\n')

Page({
  data: {
    state: 'loading' as 'loading' | 'ready' | 'error',
    planTitle: MEMBERSHIP_PLAN_FALLBACK_TITLE,
    validityText: '',
    feeText: '',
    totalSymbol: '¥',
    totalAmount: '',
    orderNumberText: '支付后生成',
    orderIdText: '',
    noticesText: MEMBERSHIP_PURCHASE_NOTICES,
    paymentEnabled: runtimeConfig.paymentMode !== 'disabled',
    paying: false,
    accessing: false,
    message: '',
  },
  planId: '' as MembershipPlanId | '',
  resumePlanId: '' as MembershipPlanId | '',

  onLoad(query: Record<string, string | undefined>) {
    this.planId = String(query.planId || '') as MembershipPlanId | ''
    void this.loadPlan()
  },

  onShow() {
    const resume = mipIdentityModule.consumePendingResume('packages/member/membership-order/index')
    if (resume?.action === 'PURCHASE_MEMBERSHIP' && this.resumePlanId && this.data.state === 'ready') {
      const planId = this.resumePlanId
      this.resumePlanId = '' as MembershipPlanId | ''
      void this.performPurchase(planId)
      return
    }
    this.resumePlanId = '' as MembershipPlanId | ''
  },

  async loadPlan() {
    const cached = mipCommerceModule.peekPlans()
    if (cached?.length) {
      this.applyPlans(cached)
    }
    else {
      this.setData({ state: 'loading', message: '' })
    }
    try {
      const plans = await mipCommerceModule.listPlans({ force: cached !== undefined })
      this.applyPlans(plans)
    }
    catch {
      if (!mipCommerceModule.peekPlans()?.length) {
        this.setData({ state: 'error', message: '会员方案暂时无法加载。' })
      }
      else {
        this.setData({ message: '会员方案更新失败，暂时无法支付。' })
      }
    }
  },

  applyPlans(plans: readonly MembershipPlan[]) {
    if (!plans.length) {
      this.setData({ state: 'error', message: '当前没有可用会员方案。' })
      return
    }
    const plan = plans.find(item => item.id === this.planId) || plans[0]
    this.planId = plan.id
    this.setData({
      state: 'ready',
      planTitle: plan.name || MEMBERSHIP_PLAN_FALLBACK_TITLE,
      validityText: planValidityText(plan),
      feeText: `¥${amountText(plan.priceCents)}`,
      totalAmount: amountText(plan.priceCents),
      message: '',
    })
  },

  async pay() {
    const planId = this.planId
    if (!planId || this.data.state !== 'ready' || this.data.paying || this.data.accessing) {
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
      this.resumePlanId = '' as MembershipPlanId | ''
      await this.performPurchase(planId)
    }
    catch {
      this.resumePlanId = '' as MembershipPlanId | ''
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
    this.setData({ paying: true, message: '' })
    try {
      const outcome = await mipCommerceModule.purchase({
        planId,
        // 待支付订单前端不显示、重新发起即重新创建（M1 00:20:04）：每次支付尝试使用新的幂等键。
        idempotencyKey: createIntentKey('membership-order'),
      })
      if (outcome.kind === 'CANCELLED') {
        this.setData({ message: '支付已取消，会员权益未发生变化。' })
        return
      }
      // 支付成功（账本确认或确认中）→ 回到「我的」（J1-08）；权益是否生效由服务端账本决定。
      void caseSwitchPrimary('/pages/profile/index')
    }
    catch (error) {
      const code = error instanceof MipCommerceError ? error.code : ''
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

  copyOrderId() {
    const orderId = this.data.orderIdText
    if (!orderId) {
      return
    }
    wx.setClipboardData({
      data: orderId,
      success: () => wx.showToast({ title: '订单号已复制', icon: 'success' }),
    })
  },
})
