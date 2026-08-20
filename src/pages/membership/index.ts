import type { QueryOptions } from '@weapp/shared/cache'
import type { MembershipPlan } from '../../modules/membership/types'
import { runtimeConfig } from '../../config/runtime'
import { membershipModule } from '../../modules/membership/client'
import { caseNavigateTo, caseRedirectTo, caseSwitchPrimary } from '../../modules/platform/case-navigation'
import { formatLocalDate } from '../../utils/date'

interface DisplayPlan extends MembershipPlan {
  priceText: string
  durationText: string
}

function displayPlan(plan: MembershipPlan): DisplayPlan {
  return {
    ...plan,
    priceText: `¥${(plan.priceCents / 100).toFixed(2)}`,
    durationText: plan.testOnly ? `${plan.durationDays} 天体验权益` : `${plan.durationDays} 天会员`,
  }
}

function planData(overview: Awaited<ReturnType<typeof membershipModule.load>>) {
  const plans = overview.plans.map(displayPlan)
  return {
    state: 'ready' as const,
    plans,
    phoneBound: overview.profile.phoneBound,
    profileReady: overview.profile.phoneBound,
    membershipActive: overview.membership.active,
    expiresAt: overview.membership.expiresAt,
    expiresText: overview.membership.expiresAt ? formatLocalDate(overview.membership.expiresAt) : '',
    nickname: overview.profile.nickname || '微信用户',
    nicknameInitial: (overview.profile.nickname || '微信用户').slice(0, 1),
    avatarUrl: overview.profile.avatarUrl,
    selectedPlanId: plans[0]?.id || '',
    message: plans.length ? '' : '会员方案即将开放',
  }
}

Page({
  data: {
    state: 'loading' as 'loading' | 'ready' | 'error',
    plans: [] as DisplayPlan[],
    selectedPlanId: '',
    paying: false,
    paymentEnabled: runtimeConfig.paymentMode !== 'disabled',
    phoneBound: false,
    profileReady: false,
    membershipActive: false,
    expiresAt: null as string | null,
    expiresText: '',
    nickname: '微信用户',
    nicknameInitial: '微',
    avatarUrl: '',
    phoneSheetVisible: false,
    phoneBinding: false,
    message: '',
  },

  onLoad() {
    void this.loadPlans()
  },

  onShow() {
    if (this.data.paying) {
      return
    }
    void this.reconcilePayment()
  },

  async reconcilePayment() {
    try {
      const order = await membershipModule.reconcilePendingPayments()
      if (order?.status === 'PAID') {
        this.setData({ message: '会员权益已生效。' })
        await this.loadPlans({ force: true })
      }
    }
    catch {
      // Keep the current content visible; the next page focus or pull-down refresh retries automatically.
    }
  },

  async loadPlans(options: QueryOptions = {}) {
    const cached = membershipModule.peekOverview()
    if (cached) {
      this.setData(planData(cached))
    }
    else if (this.data.state !== 'ready') {
      this.setData({ state: 'loading', message: '' })
    }
    try {
      const overview = await membershipModule.load(options)
      this.setData(planData(overview))
    }
    catch (error) {
      this.setData(cached || this.data.state === 'ready'
        ? { message: '方案更新失败，已保留上次结果。' }
        : { state: 'error', message: error instanceof Error ? error.message : '方案加载失败' })
    }
  },

  async onPullDownRefresh() {
    try {
      await this.loadPlans({ force: true })
    }
    finally {
      wx.stopPullDownRefresh()
    }
  },

  selectPlan(event: WechatMiniprogram.TouchEvent) {
    this.setData({ selectedPlanId: String(event.currentTarget.dataset.planId || '') })
  },

  async purchase() {
    if (!this.data.selectedPlanId || this.data.paying) {
      return
    }
    if (!this.data.profileReady) {
      this.setData({ phoneSheetVisible: true, message: '' })
      return
    }
    this.setData({ paying: true, message: '' })
    try {
      const outcome = await membershipModule.purchase(this.data.selectedPlanId)
      if (outcome.status === 'cancelled') {
        this.setData({ message: '你已取消支付，订单未生效。' })
        return
      }
      caseRedirectTo({ url: `/packages/member/payment-result/index?orderId=${encodeURIComponent(outcome.order.id)}` })
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '支付失败，请稍后重试' })
    }
    finally {
      this.setData({ paying: false })
    }
  },

  openOrders() {
    caseNavigateTo({ url: '/packages/member/orders/index' })
  },

  openBenefits() {
    caseNavigateTo({ url: '/packages/member/benefits/index' })
  },

  backToHome() {
    caseSwitchPrimary('/pages/index/index')
  },

  closePhoneSheet() {
    if (!this.data.phoneBinding) {
      this.setData({ phoneSheetVisible: false })
    }
  },

  async bindPhone(event: WechatMiniprogram.CustomEvent<{ code?: string, errMsg?: string }>) {
    if (this.data.phoneBinding || this.data.paying) {
      return
    }
    const code = event.detail.code
    if (!code) {
      const errMsg = event.detail.errMsg || ''
      this.setData({
        phoneSheetVisible: false,
        message: errMsg.includes('deny') || errMsg.includes('cancel')
          ? '已取消登录，你仍可继续查看会员方案。'
          : '手机号授权需在微信真机完成，模拟器无法代替。',
      })
      return
    }
    this.setData({ phoneBinding: true, message: '' })
    try {
      const profile = await membershipModule.bindPhone(code)
      if (!profile.phoneBound) {
        this.setData({ message: '手机号尚未绑定成功，请重试。' })
        return
      }
      this.setData({ phoneBound: true, profileReady: true, phoneSheetVisible: false })
      await this.purchase()
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '手机号登录失败，请重试' })
    }
    finally {
      this.setData({ phoneBinding: false })
    }
  },

  openAgreement() {
    caseNavigateTo({ url: '/packages/member/about/index' })
  },

  openPrivacy() {
    caseNavigateTo({ url: '/packages/member/privacy/index' })
  },
})
