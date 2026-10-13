import type { MembershipPlan, MembershipPlanId } from '../../../modules/mip-commerce'
import type { GrowthSnapshot } from '../../../modules/mip-growth'
import type { UserTaskCard } from '../../../modules/mip-tasks'
import type { GrowthBenefitSlotView, GrowthTierView } from './tiers'
import { runtimeConfig } from '../../../config/runtime'
import { MipCommerceError } from '../../../modules/mip-commerce'
import { mipCommerceModule } from '../../../modules/mip-commerce/client'
import { mipGrowthModule } from '../../../modules/mip-growth/client'
import { mipAccessPageUrl } from '../../../modules/mip-identity'
import { mipIdentityModule } from '../../../modules/mip-identity/client'
import { createIntentKey, formatCny } from '../../../modules/mip-shell'
import { mipTasksModule } from '../../../modules/mip-tasks/client'
import { caseNavigateTo, caseRedirectTo } from '../../../platform/navigation/client'
import { formatLocalDate } from '../../../utils/date'
import { withinRenewalWindow } from './renewal-window'
import { benefitPanelMinHeight, benefitSlots, deriveTierStartIndexes, selectedTierIndexFor, tierViews } from './tiers'

/** MIW-27：经验值详情独立页（figma 1948:14177 经验值明细）。 */
const EXPERIENCE_DETAILS_PAGE = '/packages/member/mip-experience-details/index'

/**
 * MIW-83 GROWTH-06 D4：「邀请入会」为本期轻量微信分享（mip-pill-button openType="share"）；
 * 完整邀请系统（海报/凭证/邀请人归属）另卡。落地页用主包首页。
 */
const MEMBERSHIP_INVITE_SHARE_TITLE = '邀请你加入 MIP 玩家会员，一起解锁专属权益'
const MEMBERSHIP_INVITE_SHARE_PATH = '/pages/index/index'

/** MIW-83 GROWTH-04 D5：任务全量展示——分页游标聚合（服务端页大小 20，防御上限 10 页）。 */
const TASK_PAGE_SIZE = 20
const TASK_PAGE_LIMIT = 10

/** MIW-65：会员方案页/订单确认页下线后，本页为唯一开通面；协议沿用既有会员服务协议文档。 */
const MEMBERSHIP_AGREEMENT_URL = '/packages/member/user-agreement/index?document=membership'

/** journey-review J1-07 购买须知随订单确认页收敛为本弹层文案。 */
const MEMBERSHIP_PURCHASE_NOTICES = [
  '一、订单确认与支付',
  '提交订单并成功支付后，即视为交易合同成立；支付成功后才开通玩家权益。',
  '二、支付方式',
  '微信支付。',
  '三、订单修改',
  '支付前可关闭本弹层放弃本次开通；未支付订单不显示在订单列表。若支付状态待确认，请勿重复付款。',
].join('\n')

function planValidityText(plan: MembershipPlan) {
  return `开通之日起 ${plan.durationDays} 天 · 到期自动关闭权益`
}

/** 到期时间展示为 2026.08.08（figma 1948:14079 / 3296:5808）。 */
function formatDottedDate(value: string) {
  return formatLocalDate(value).replaceAll('-', '.')
}

interface GrowthTaskView extends UserTaskCard {
  actionText: string
}

/**
 * MIW-83 GROWTH-01/02：权益差异档位 + 跟随档位的权益区（figma 3984:8958 系列）。
 * preferredTierIndex 保留用户已滑到的档位（会员态落定刷新锁定旗标时不回跳）。
 */
function growthPresentation(snapshot: GrowthSnapshot, isPlayer: boolean, preferredTierIndex = -1) {
  const currentIndex = snapshot.levels.findIndex(level => level.id === snapshot.currentLevel.id)
  const currentLevelNumber = Math.max(1, currentIndex + 1)
  const tiers = tierViews(
    deriveTierStartIndexes(snapshot.levels),
    currentLevelNumber,
    isPlayer,
  )
  const fallbackTierIndex = selectedTierIndexFor(tiers, currentLevelNumber)
  const tierIndex = tiers[preferredTierIndex] ? preferredTierIndex : fallbackTierIndex
  const tierLevel = snapshot.levels[tiers[tierIndex].startIndex]
  const tierBenefits = benefitSlots(tierLevel.benefits)
  return {
    currentLevelNumber,
    nextLevelThreshold: snapshot.nextLevel?.minimumExperience || 0,
    tiers,
    tierIndex,
    tierBenefits,
    tierBenefitCount: tierLevel.benefits.length,
    tierBenefitsMinHeight: benefitPanelMinHeight(tierBenefits.length),
  }
}

function taskView(task: UserTaskCard): GrowthTaskView {
  const completed = task.status === 'COMPLETED'
  const ended = task.status === 'ENDED'
  return {
    ...task,
    name: task.name === '完善合作资料' ? '完善资料' : task.name,
    actionText: completed ? '已完成' : ended ? '已截止' : '去完成',
  }
}

Page({
  data: {
    state: 'loading' as 'loading' | 'ready' | 'error',
    snapshot: null as GrowthSnapshot | null,
    currentLevelNumber: 1,
    nextLevelThreshold: 0,
    // MIW-83 GROWTH-01/02：档位轮播 + 跟随档位的权益区。
    tiers: [] as GrowthTierView[],
    tierIndex: 0,
    tierBenefits: [] as GrowthBenefitSlotView[],
    tierBenefitCount: 0,
    tierBenefitsMinHeight: 238,
    // MIW-83 GROWTH-02：权益详情弹层（「Lv.N 解锁权益：{description}」，原型参考项）。
    benefitSheetVisible: false,
    benefitSheetTitle: '',
    benefitSheetBody: '',
    tasksState: 'loading' as 'loading' | 'ready' | 'empty' | 'error',
    tasks: [] as GrowthTaskView[],
    tasksMessage: '',
    isPlayer: false,
    membershipState: 'loading' as 'loading' | 'player' | 'guest' | 'pending' | 'error',
    membershipValidityText: '',
    renewWindowOpen: false,
    // MIW-65：开通/续费确认弹层（原会员订单确认页收敛于此，不新增路由）。
    purchaseDialogVisible: false,
    purchaseDialogTitle: '确认开通会员',
    planTitleText: '',
    planPriceText: '',
    planValidityText: '',
    planBenefits: [] as string[],
    noticesText: MEMBERSHIP_PURCHASE_NOTICES,
    plansLoading: false,
    plansVerified: false,
    paymentEnabled: runtimeConfig.paymentMode !== 'disabled',
    paying: false,
    accessing: false,
    purchaseMessage: '',
    message: '',
  },
  resumePlanId: '' as MembershipPlanId | '',
  checkoutKey: '',
  checkoutPlanId: '' as MembershipPlanId | '',
  growthRequestSeq: 0,
  tasksRequestSeq: 0,
  // BUG-10.4（审计 2026-10-12）：会员态加载补序列守卫（对齐 growthRequestSeq/tasksRequestSeq），
  // onShow 与下拉刷新并发双跑时后写胜出，避免会员文案回跳。
  membershipRequestSeq: 0,

  onLoad() {
    const cached = mipGrowthModule.peekSnapshot()
    if (cached) {
      this.presentSnapshot(cached)
    }
  },

  onShow() {
    // Completing a task or drawing a blind box changes server-owned balances while this page is hidden.
    void this.loadGrowth(true)
    void this.loadMembershipActions()
    void this.loadTasks(true)
    // 身份门槛（登录/协议/手机号）经 mip-access 完成后回本页恢复购买意图。
    const resume = mipIdentityModule.consumePendingResume('packages/member/mip-growth/index')
    if (resume?.action === 'PURCHASE_MEMBERSHIP' && this.resumePlanId) {
      const planId = this.resumePlanId
      this.resumePlanId = '' as MembershipPlanId | ''
      void this.performPurchase(planId)
    }
    else {
      this.resumePlanId = '' as MembershipPlanId | ''
    }
  },

  onHide() {
    this.growthRequestSeq += 1
    this.tasksRequestSeq += 1
    this.membershipRequestSeq += 1
  },

  async loadMembershipActions() {
    // BUG-10.4：整段绑定代际号，await（权益）之后的写入都要复核代际。
    const requestSeq = ++this.membershipRequestSeq
    let membership
    try {
      membership = await mipCommerceModule.getMembershipBenefits()
    }
    catch {
      if (requestSeq !== this.membershipRequestSeq) {
        return
      }
      this.setData({
        isPlayer: false,
        membershipState: 'error',
        membershipValidityText: '',
        renewWindowOpen: false,
      })
      return
    }
    if (requestSeq !== this.membershipRequestSeq) {
      return
    }
    // MIW-27 第二轮：首笔付费等待管理后台审核。玩家等级页如实展示「审核中」，
    // 不给第二次下单入口；同意后的会员态由服务端投影决定。
    if (membership.kind === 'PENDING') {
      this.setData({
        isPlayer: false,
        membershipState: 'pending',
        membershipValidityText: '入会审核中，管理后台通过后生效',
        renewWindowOpen: false,
      })
      this.refreshTierPresentation()
      return
    }
    if (membership.kind !== 'PLAYER') {
      this.setData({
        isPlayer: false,
        membershipState: 'guest',
        // J1-06 开通态：新玩家加入页固定展示「有效期一年」（M1 00:45:19）。
        membershipValidityText: '有效期一年',
        renewWindowOpen: false,
      })
      this.refreshTierPresentation()
      return
    }
    this.setData({
      isPlayer: true,
      membershipState: 'player',
      // J4-03 续费态：有效期至:2026.08.08（figma 1948:14079）。
      membershipValidityText: `有效期至:${formatDottedDate(membership.membershipEndsAt)}`,
      renewWindowOpen: withinRenewalWindow(membership.membershipEndsAt),
    })
    this.refreshTierPresentation()
  },

  /**
   * MIW-83 GROWTH-01：会员态落定后刷新档位锁定旗标（非会员全锁、会员按等级解锁），
   * 保留用户已滑到的档位；无快照（快照未返回/用例直调）时静默跳过。
   */
  refreshTierPresentation() {
    if (!this.data.snapshot) {
      return
    }
    this.setData(growthPresentation(this.data.snapshot, this.data.isPlayer, this.data.tierIndex))
  },

  async onPullDownRefresh() {
    try {
      await Promise.all([
        this.loadGrowth(true),
        this.loadMembershipActions(),
        this.loadTasks(true),
      ])
    }
    finally {
      wx.stopPullDownRefresh()
    }
  },

  async loadGrowth(force = false) {
    const requestSeq = ++this.growthRequestSeq
    if (!this.data.snapshot) {
      this.setData({ state: 'loading', message: '' })
    }
    try {
      const snapshot = await mipGrowthModule.getSnapshot({ force })
      if (requestSeq !== this.growthRequestSeq) {
        return
      }
      this.setData({
        state: 'ready',
        snapshot,
        ...growthPresentation(snapshot, this.data.isPlayer),
        message: '',
      })
    }
    catch (error) {
      if (requestSeq !== this.growthRequestSeq) {
        return
      }
      this.setData(this.data.snapshot
        ? { message: '成长记录更新失败，已保留上次结果。' }
        : { state: 'error', message: error instanceof Error ? error.message : '成长记录加载失败' })
    }
  },

  presentSnapshot(snapshot: GrowthSnapshot) {
    this.setData({
      state: 'ready',
      snapshot,
      ...growthPresentation(snapshot, this.data.isPlayer),
    })
  },

  async loadTasks(force = false) {
    const requestSeq = ++this.tasksRequestSeq
    if (!this.data.tasks.length) {
      this.setData({ tasksState: 'loading', tasksMessage: '' })
    }
    try {
      // MIW-83 GROWTH-04（D5）：取消「前 4 条」上限，游标聚合全量任务，页面自然滚动浏览。
      const items: UserTaskCard[] = []
      let cursor: string | undefined
      for (let page = 0; page < TASK_PAGE_LIMIT; page += 1) {
        const result = await mipTasksModule.query.listTasks(cursor, TASK_PAGE_SIZE, force)
        if (requestSeq !== this.tasksRequestSeq) {
          return
        }
        items.push(...result.items)
        if (!result.nextCursor) {
          break
        }
        cursor = result.nextCursor
      }
      const tasks = items.map(taskView)
      this.setData({
        tasksState: tasks.length ? 'ready' : 'empty',
        tasks,
        tasksMessage: '',
      })
    }
    catch {
      if (requestSeq !== this.tasksRequestSeq) {
        return
      }
      this.setData({
        tasksState: this.data.tasks.length ? 'ready' : 'error',
        tasksMessage: '请稍后重试。',
      })
    }
  },

  openTask(event: WechatMiniprogram.TouchEvent) {
    const taskId = String(event.currentTarget.dataset.id || '')
    if (taskId) {
      void caseNavigateTo({ url: `/packages/member/mip-tasks/detail/index?taskId=${taskId}` })
    }
  },

  /** MIW-27：经验值详情跳转独立明细页（figma 1948:14177），不再原地展开滚动。 */
  openExperienceDetails() {
    void caseNavigateTo({ url: EXPERIENCE_DETAILS_PAGE })
  },

  /**
   * MIW-83 GROWTH-01：手指拖动档位条由 swiper 原生跟随（lv 数字随手滑动），
   * 松手落定后按新档位联动权益区（含面板高度过渡）。
   */
  onTierChange(event: { detail: { current?: number } }) {
    const index = Number(event.detail.current)
    if (!Number.isInteger(index) || !this.data.snapshot || !this.data.tiers[index]) {
      return
    }
    if (index === this.data.tierIndex) {
      return
    }
    this.setData(growthPresentation(this.data.snapshot, this.data.isPlayer, index))
  },

  /**
   * MIW-83 GROWTH-02：权益点按弹详情（原型参考项「Lv.N 解锁权益：{description}」）；
   * 占位槽与空说明权益不弹。
   */
  openBenefitDetail(event: WechatMiniprogram.TouchEvent) {
    const name = String(event.currentTarget.dataset.name || '')
    const description = String(event.currentTarget.dataset.description || '')
    if (!description) {
      return
    }
    const tier = this.data.tiers[this.data.tierIndex]
    this.setData({
      benefitSheetVisible: true,
      benefitSheetTitle: name,
      benefitSheetBody: `Lv.${tier ? tier.levelNumber : this.data.currentLevelNumber} 解锁权益：${description}`,
    })
  },

  handleBenefitSheetVisibility(event: { detail: { visible?: boolean } }) {
    if (!event.detail.visible) {
      this.setData({ benefitSheetVisible: false })
    }
  },

  closeBenefitSheet() {
    this.setData({ benefitSheetVisible: false })
  },

  /** MIW-83 GROWTH-06 D4：会员操作栏「邀请入会」经 open-type="share" 触发的分享卡片。 */
  onShareAppMessage(): { title: string, path: string } {
    return { title: MEMBERSHIP_INVITE_SHARE_TITLE, path: MEMBERSHIP_INVITE_SHARE_PATH }
  },

  /** J1-06/J4-03：开通与续费共用确认弹层（原会员订单确认页收敛于此）。 */
  openPurchaseDialog(event: WechatMiniprogram.TouchEvent) {
    const source = String(event.currentTarget.dataset.source || '') === 'renew' ? 'renew' : 'join'
    this.setData({
      purchaseDialogVisible: true,
      purchaseDialogTitle: source === 'renew' ? '确认续费会员' : '确认开通会员',
      purchaseMessage: '',
    })
    void this.loadPlans()
  },

  handlePurchaseVisibility(event: { detail: { visible?: boolean } }) {
    if (!event.detail.visible) {
      this.setData({ purchaseDialogVisible: false })
    }
  },

  closePurchaseDialog() {
    this.setData({ purchaseDialogVisible: false })
  },

  openMembershipAgreement() {
    caseNavigateTo({ url: MEMBERSHIP_AGREEMENT_URL })
  },

  async loadPlans() {
    const cached = mipCommerceModule.peekPlans()
    const hasCachedPlans = cached !== undefined
    // 缓存方案只用来先出内容；金额能否支付以一次成功的服务端刷新为准（plansVerified 守卫）。
    if (cached?.length) {
      this.applyPlans(cached, false)
      this.setData({ purchaseMessage: '正在确认最新会员方案。' })
    }
    this.setData({ plansLoading: true })
    try {
      const plans = await mipCommerceModule.listPlans({ force: hasCachedPlans })
      this.applyPlans(plans, true)
    }
    catch {
      if (mipCommerceModule.peekPlans()?.length) {
        this.setData({ plansVerified: false, purchaseMessage: '会员方案更新失败，暂时无法支付。' })
      }
      else {
        this.setData({ purchaseMessage: '会员方案暂时无法加载，请稍后重试。' })
      }
    }
    finally {
      this.setData({ plansLoading: false })
    }
  },

  applyPlans(source: readonly MembershipPlan[], plansVerified: boolean) {
    if (!source.length) {
      this.setData({ plansVerified: false, purchaseMessage: '当前没有可用会员方案。' })
      return
    }
    const plan = source[0]
    this.setData({
      plansVerified,
      planTitleText: plan.name || '',
      planPriceText: formatCny(plan.priceCents),
      planValidityText: planValidityText(plan),
      planBenefits: plan.benefits || [],
      purchaseMessage: '',
    })
  },

  async confirmPurchase() {
    const plan = mipCommerceModule.peekPlans()?.[0]
    const planId = plan?.id as MembershipPlanId | undefined
    if (!planId
      || !this.data.plansVerified
      || this.data.paying
      || this.data.accessing) {
      return
    }
    if (!this.data.paymentEnabled) {
      this.setData({ purchaseMessage: '会员支付尚未配置。' })
      return
    }
    this.resumePlanId = planId
    this.setData({ accessing: true, purchaseMessage: '' })
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
      this.setData({ purchaseMessage: '身份状态暂时无法确认，请稍后重试。' })
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
    this.setData({ paying: true, purchaseMessage: '' })
    try {
      const outcome = await mipCommerceModule.purchase({
        planId,
        idempotencyKey: this.checkoutKey,
      })
      if (outcome.kind === 'CANCELLED') {
        // 明确取消后才开启新的购买尝试；未知错误要保留原订单幂等键以便恢复。
        this.checkoutKey = ''
        this.setData({ purchaseMessage: '支付已取消，会员权益未发生变化。' })
        return
      }
      // 账本确认和确认中都由结果页按订单 ID 回读，不能在未确认时直接呈现会员状态。
      void caseRedirectTo({
        url: `/packages/member/payment-result/index?orderId=${encodeURIComponent(outcome.order.id)}`,
      })
    }
    catch (error) {
      const code = error instanceof MipCommerceError ? error.code : ''
      this.setData({
        purchaseMessage: code === 'PAYMENT_UNAVAILABLE'
          ? '会员支付尚未配置。'
          : '暂时无法发起支付，请稍后重试。',
      })
    }
    finally {
      this.setData({ paying: false })
    }
  },
})
