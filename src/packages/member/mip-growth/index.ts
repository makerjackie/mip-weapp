import type { MembershipPlan, MembershipPlanId } from '../../../modules/mip-commerce'
import type { GrowthLevel, GrowthSnapshot } from '../../../modules/mip-growth'
import type { UserTaskCard } from '../../../modules/mip-tasks'
import { brand } from '../../../config/brand'
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

/** MIW-27：经验值详情独立页（figma 1948:14177 经验值明细）。 */
const EXPERIENCE_DETAILS_PAGE = '/packages/member/mip-experience-details/index'

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

const POSTER_WIDTH = 375
const POSTER_HEIGHT = 560

interface Canvas2dNode {
  width: number
  height: number
  createImage: () => WechatMiniprogram.Image
  getContext: (type: '2d') => WechatMiniprogram.CanvasRenderingContext.CanvasRenderingContext2D
  requestAnimationFrame?: (callback: () => void) => number
}

function loadCanvasImage(canvas: Canvas2dNode, source: string) {
  return new Promise<WechatMiniprogram.Image>((resolve, reject) => {
    const image = canvas.createImage()
    image.onload = () => resolve(image)
    image.onerror = reject
    image.src = source
  })
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

/** figma 1948_14079: three-point level scale under the hero — first level, middle milestone (locked), last level. */
interface LevelScaleView {
  leftText: string
  centerText: string
  rightText: string
  centerLocked: boolean
}

function levelScaleView(levels: GrowthLevel[], currentLevelNumber: number): LevelScaleView | null {
  if (levels.length < 3) {
    return null
  }
  const last = levels.length
  const center = Math.floor((last - 1) / 2) + 1
  return {
    leftText: 'Lv.1',
    centerText: `Lv.${center}`,
    rightText: `Lv.${last}`,
    centerLocked: center > currentLevelNumber,
  }
}

function growthPresentation(snapshot: GrowthSnapshot) {
  const currentIndex = snapshot.levels.findIndex(level => level.id === snapshot.currentLevel.id)
  const currentLevelNumber = Math.max(1, currentIndex + 1)
  return {
    currentLevelNumber,
    nextLevelThreshold: snapshot.nextLevel?.minimumExperience || 0,
    levelScale: levelScaleView(snapshot.levels, currentLevelNumber),
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
    levelScale: null as LevelScaleView | null,
    tasksState: 'loading' as 'loading' | 'ready' | 'empty' | 'error',
    tasks: [] as GrowthTaskView[],
    tasksMessage: '',
    isPlayer: false,
    membershipState: 'loading' as 'loading' | 'player' | 'guest' | 'pending' | 'error',
    membershipValidityText: '',
    renewWindowOpen: false,
    invitationReady: false,
    invitationMessage: '',
    invitationSourceName: '',
    invitationSourceAvatar: '',
    posterBusy: false,
    posterPath: '',
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
    invitationResolving: false,
    purchaseMessage: '',
    message: '',
  },
  shareInvitationToken: '',
  incomingInvitationToken: '',
  invitationGuestRecorded: false,
  resumePlanId: '' as MembershipPlanId | '',
  checkoutKey: '',
  checkoutPlanId: '' as MembershipPlanId | '',
  growthRequestSeq: 0,
  tasksRequestSeq: 0,

  onLoad(query: Record<string, string | undefined> = {}) {
    const cached = mipGrowthModule.peekSnapshot()
    if (cached) {
      this.presentSnapshot(cached)
    }
    // MIW-27 第二轮：会员邀请落地（分享卡/小程序码）自会员方案页迁至本页。
    this.incomingInvitationToken = decodeQueryValue(query.invitationToken)
    if (!this.incomingInvitationToken && query.scene) {
      void this.resolveIncomingInvitation(query.scene)
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
  },

  async loadMembershipActions() {
    let membership
    try {
      membership = await mipCommerceModule.getMembershipBenefits()
    }
    catch {
      this.shareInvitationToken = ''
      this.setData({
        isPlayer: false,
        membershipState: 'error',
        membershipValidityText: '',
        renewWindowOpen: false,
        invitationReady: false,
      })
      return
    }
    // MIW-27 第二轮：首笔付费等待管理后台审核。玩家等级页如实展示「审核中」，
    // 不给第二次下单入口；同意后的会员态由服务端投影决定。
    if (membership.kind === 'PENDING') {
      this.shareInvitationToken = ''
      this.setData({
        isPlayer: false,
        membershipState: 'pending',
        membershipValidityText: '入会审核中，管理后台通过后生效',
        renewWindowOpen: false,
        invitationReady: false,
      })
      return
    }
    if (membership.kind !== 'PLAYER') {
      this.shareInvitationToken = ''
      this.setData({
        isPlayer: false,
        membershipState: 'guest',
        // J1-06 开通态：新玩家加入页固定展示「有效期一年」（M1 00:45:19）。
        membershipValidityText: '有效期一年',
        renewWindowOpen: false,
        invitationReady: false,
        invitationSourceName: '',
        invitationSourceAvatar: '',
      })
      // 受邀嘉宾进入本页即上报邀请凭证；资格校验与幂等在服务端完成，失败不影响页面。
      if (this.incomingInvitationToken && !this.invitationGuestRecorded) {
        this.invitationGuestRecorded = true
        mipCommerceModule
          .recordMembershipInvitationGuest(this.incomingInvitationToken)
          .catch(() => {})
      }
      return
    }
    this.setData({
      isPlayer: true,
      membershipState: 'player',
      // J4-03 续费态：有效期至:2026.08.08（figma 1948:14079）。
      membershipValidityText: `有效期至:${formatDottedDate(membership.membershipEndsAt)}`,
      renewWindowOpen: withinRenewalWindow(membership.membershipEndsAt),
      invitationReady: false,
      invitationSourceName: membership.invitationAttribution?.displayName || '',
      invitationSourceAvatar: membership.invitationAttribution?.avatarUrl || '',
    })
    try {
      const invitation = await mipCommerceModule.createMembershipInvitation()
      this.shareInvitationToken = invitation.token
      this.setData({ invitationReady: true })
    }
    catch {
      this.shareInvitationToken = ''
      this.setData({ invitationReady: false, invitationMessage: '邀请暂时不可用，请稍后重试。' })
    }
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
        ...growthPresentation(snapshot),
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
      ...growthPresentation(snapshot),
    })
  },

  async loadTasks(force = false) {
    const requestSeq = ++this.tasksRequestSeq
    if (!this.data.tasks.length) {
      this.setData({ tasksState: 'loading', tasksMessage: '' })
    }
    try {
      const page = await mipTasksModule.query.listTasks(undefined, 4, force)
      if (requestSeq !== this.tasksRequestSeq) {
        return
      }
      const tasks = page.items.map(taskView)
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
      || this.data.accessing
      || this.data.invitationResolving) {
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
        invitationToken: this.incomingInvitationToken || undefined,
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

  async resolveIncomingInvitation(sceneValue: string) {
    const scene = decodeQueryValue(sceneValue)
    if (!/^[\w-]{32}$/.test(scene)) {
      this.setData({ invitationMessage: '会员邀请无效或已失效。' })
      return
    }
    this.setData({ invitationResolving: true, invitationMessage: '' })
    try {
      const invitation = await mipCommerceModule.resolveMembershipInvitationScene(scene)
      this.incomingInvitationToken = invitation.token
      this.setData({ invitationMessage: '已识别好友的会员邀请。' })
    }
    catch {
      this.incomingInvitationToken = ''
      this.setData({ invitationMessage: '会员邀请无效或已失效。' })
    }
    finally {
      this.setData({ invitationResolving: false })
    }
  },

  copyInvitation() {
    if (!this.shareInvitationToken) {
      this.setData({ invitationMessage: '邀请信息暂时不可用，请稍后重试。' })
      return
    }
    const path = `/packages/member/mip-growth/index?source=member-copy&invitationToken=${encodeURIComponent(this.shareInvitationToken)}`
    wx.setClipboardData({
      data: ['MIP 会员邀请', '打开 MIP 小程序查看会员方案。', `小程序路径：${path}`].join('\n'),
      success: () => wx.showToast({ title: '邀请文案已复制', icon: 'success' }),
    })
  },

  async createInvitationPoster() {
    if (this.data.posterBusy) {
      return
    }
    this.setData({ posterBusy: true, invitationMessage: '' })
    try {
      const credential = await mipCommerceModule.createMembershipInvitationCode()
      const posterPath = await this.drawInvitationPoster(credential.codeUrl)
      this.setData({ posterPath })
    }
    catch (error) {
      const code = error instanceof MipCommerceError ? error.code : ''
      this.setData({
        invitationMessage: code === 'MEMBERSHIP_INVITATION_CODE_UNAVAILABLE'
          ? '小程序码服务尚未配置，可使用微信分享或复制邀请文案。'
          : '邀请海报生成失败，请稍后重试。',
      })
    }
    finally {
      this.setData({ posterBusy: false })
    }
  },

  async drawInvitationPoster(codeUrl: string) {
    const node = await new Promise<Canvas2dNode>((resolve, reject) => {
      this.createSelectorQuery()
        .select('#mip-growth-invitation-canvas')
        .fields({ node: true, size: true })
        .exec((results) => {
          const result = results?.[0] as { node?: Canvas2dNode } | undefined
          result?.node ? resolve(result.node) : reject(new Error('邀请海报画布不可用'))
        })
    })
    const ratio = wx.getWindowInfo().pixelRatio || 1
    node.width = POSTER_WIDTH * ratio
    node.height = POSTER_HEIGHT * ratio
    const context = node.getContext('2d')
    context.scale(ratio, ratio)
    context.fillStyle = '#FCDF03'
    context.fillRect(0, 0, POSTER_WIDTH, POSTER_HEIGHT)
    context.fillStyle = '#080808'
    context.font = '700 38px sans-serif'
    context.fillText('MIP', 28, 60)
    context.font = '700 24px sans-serif'
    context.fillText('会员邀请', 28, 108)
    context.font = '400 15px sans-serif'
    context.fillText('扫码查看会员方案', 28, 142)
    context.fillStyle = '#FFFFFF'
    context.fillRect(28, 174, 319, 306)
    const codeImage = await loadCanvasImage(node, codeUrl)
    context.drawImage(codeImage, 75, 198, 225, 225)
    context.fillStyle = '#080808'
    context.font = '600 15px sans-serif'
    context.textAlign = 'center'
    context.fillText('使用微信扫码打开 MIP 小程序', POSTER_WIDTH / 2, 454)
    context.textAlign = 'start'
    context.font = '400 12px sans-serif'
    context.fillText('和朋友一起，探索更多可能', 28, 524)
    if (node.requestAnimationFrame) {
      await new Promise<void>(resolve => node.requestAnimationFrame?.(resolve))
    }
    return new Promise<string>((resolve, reject) => {
      wx.canvasToTempFilePath({
        canvas: node,
        fileType: 'png',
        destWidth: POSTER_WIDTH * ratio,
        destHeight: POSTER_HEIGHT * ratio,
        success: result => resolve(result.tempFilePath),
        fail: reject,
      })
    })
  },

  previewInvitationPoster() {
    if (this.data.posterPath) {
      wx.previewImage({ current: this.data.posterPath, urls: [this.data.posterPath] })
    }
  },

  async saveInvitationPoster() {
    if (!this.data.posterPath || this.data.posterBusy) {
      return
    }
    try {
      await wx.saveImageToPhotosAlbum({ filePath: this.data.posterPath })
      wx.showToast({ title: '已保存到相册', icon: 'success' })
    }
    catch {
      this.setData({ invitationMessage: '保存失败，请检查相册权限后重试。' })
    }
  },

  onShareAppMessage() {
    const invitation = this.shareInvitationToken
      ? `&invitationToken=${encodeURIComponent(this.shareInvitationToken)}`
      : ''
    return {
      title: 'MIP 会员方案',
      // MIW-27 第二轮：邀请卡片先统一用品牌默认封面图。
      imageUrl: brand.opportunityDefaultCoverPath,
      // MIW-65：邀请落地自会员方案页改为本页。
      path: `/packages/member/mip-growth/index?source=growth-share${invitation}`,
    }
  },
})
