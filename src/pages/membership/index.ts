import type { MembershipPlan, MembershipPlanId } from '../../modules/mip-commerce'
import { runtimeConfig } from '../../config/runtime'
import { MipCommerceError } from '../../modules/mip-commerce'
import { mipCommerceModule } from '../../modules/mip-commerce/client'
import { mipAccessPageUrl } from '../../modules/mip-identity'
import { mipIdentityModule } from '../../modules/mip-identity/client'
import { createIntentKey, formatCny, membershipPresentation } from '../../modules/mip-shell'
import { caseNavigateTo, caseRedirectTo } from '../../modules/platform/case-navigation'
import { formatLocalDate } from '../../utils/date'

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
    invitationResolving: false,
    invitationMessage: '',
    invitationSourceName: '',
    invitationSourceAvatar: '',
    posterBusy: false,
    posterPath: '',
    message: '',
  },
  incomingInvitationToken: '',
  shareInvitationToken: '',
  resumePlanId: '' as MembershipPlanId | '',
  checkoutKey: '',
  checkoutPlanId: '' as MembershipPlanId | '',

  onLoad(query: Record<string, string | undefined>) {
    this.incomingInvitationToken = decodeQueryValue(query.invitationToken)
    if (!this.incomingInvitationToken && query.scene) {
      void this.resolveIncomingInvitation(query.scene)
    }
    void this.loadPlans()
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
      this.setData({ invitationMessage: '会员邀请已识别，购买后邀请来源将由服务端记录。' })
    }
    catch {
      this.incomingInvitationToken = ''
      this.setData({ invitationMessage: '会员邀请无效或已失效。' })
    }
    finally {
      this.setData({ invitationResolving: false })
    }
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
      const [snapshot, benefits] = await Promise.all([
        mipIdentityModule.loadSnapshot(),
        mipCommerceModule.getMembershipBenefits().catch(() => null),
      ])
      const membership = membershipPresentation(snapshot.membership.kind, snapshot.membership.entitlement)
      const attribution = benefits?.kind === 'PLAYER' ? benefits.invitationAttribution : undefined
      this.setData({
        identityState: 'ready',
        membershipLabel: membership.label,
        membershipDescription: membership.description,
        membershipEndsText: membership.endsAt ? formatLocalDate(membership.endsAt) : '',
        isPlayer: membership.label === '玩家',
        invitationSourceName: attribution?.displayName || '',
        invitationSourceAvatar: attribution?.avatarUrl || '',
      })
      if (membership.label === '玩家') {
        void this.prepareInvitation()
      }
      else {
        this.shareInvitationToken = ''
        this.setData({ invitationReady: false, invitationSourceName: '', invitationSourceAvatar: '' })
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
    if (!planId || this.data.paying || this.data.accessing || this.data.invitationResolving) {
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

  openOrders() { caseNavigateTo({ url: '/packages/member/orders/index' }) },
  openBenefits() { caseNavigateTo({ url: '/packages/member/benefits/index' }) },

  copyInvitation() {
    if (!this.shareInvitationToken) {
      this.setData({ invitationMessage: '邀请信息暂时不可用，请稍后重试。' })
      return
    }
    const path = `/pages/membership/index?source=member-copy&invitationToken=${encodeURIComponent(this.shareInvitationToken)}`
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
        .select('#mip-membership-invitation-canvas')
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
    context.fillStyle = '#FFD800'
    context.fillRect(0, 0, POSTER_WIDTH, POSTER_HEIGHT)
    context.fillStyle = '#111111'
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
    context.fillStyle = '#111111'
    context.font = '600 15px sans-serif'
    context.textAlign = 'center'
    context.fillText('使用微信扫码打开 MIP 小程序', POSTER_WIDTH / 2, 454)
    context.textAlign = 'start'
    context.font = '400 12px sans-serif'
    context.fillText('邀请来源和会员权益以服务端记录为准', 28, 524)
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
      path: `/pages/membership/index?source=member-share${invitation}`,
    }
  },
})
