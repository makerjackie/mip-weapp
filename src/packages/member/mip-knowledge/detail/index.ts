import type { KnowledgeComment, KnowledgeContentDetail } from '../../../../modules/mip-knowledge/types'
import { reportCategoryOptions } from '../../../../modules/mip-community'
import { mipAccessPageUrl } from '../../../../modules/mip-identity'
import { mipIdentityModule } from '../../../../modules/mip-identity/client'
import { mipKnowledgeModule } from '../../../../modules/mip-knowledge/module'
import { caseNavigateTo } from '../../../../modules/platform/case-navigation'

Page({
  data: {
    state: 'loading' as 'loading' | 'ready' | 'error',
    contentId: '',
    detail: null as KnowledgeContentDetail | null,
    priceLabel: '',
    comments: [] as KnowledgeComment[],
    commentsEnabled: false,
    commentBody: '',
    submitting: false,
    purchasing: false,
    message: '',
    paymentEnabled: mipKnowledgeModule.paymentEnabled,
  },
  resumePurchase: false,

  onLoad(query: Record<string, string | undefined>) {
    const contentId = String(query.contentId || '')
    this.setData({ contentId })
  },

  onShow() {
    const resume = mipIdentityModule.consumePendingResume('packages/member/mip-knowledge/detail/index')
    if (resume?.action === 'INTERACT' && this.resumePurchase) {
      this.resumePurchase = false
      void this.purchase()
      return
    }
    this.resumePurchase = false
    void this.load()
  },

  async load() {
    if (!this.data.detail) {
      this.setData({ state: 'loading', message: '' })
    }
    try {
      const [detail, comments] = await Promise.all([
        mipKnowledgeModule.getContent(this.data.contentId),
        mipKnowledgeModule.listComments(this.data.contentId),
      ])
      this.setData({
        state: 'ready',
        detail,
        priceLabel: detail.product ? `¥${(detail.product.priceCents / 100).toFixed(2)}` : '',
        comments: comments.items,
        commentsEnabled: comments.settings.commentsEnabled,
        message: '',
      })
    }
    catch (error) {
      this.setData({ state: this.data.detail ? 'ready' : 'error', message: error instanceof Error ? error.message : '内容加载失败' })
    }
  },

  updateComment(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    this.setData({ commentBody: event.detail.value })
  },

  async submitComment() {
    const body = this.data.commentBody.trim()
    if (!body || this.data.submitting) {
      return
    }
    this.setData({ submitting: true, message: '' })
    try {
      await mipKnowledgeModule.createComment(this.data.contentId, body)
      this.setData({ commentBody: '' })
      await this.load()
      wx.showToast({ title: '评论已提交', icon: 'success' })
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '评论提交失败' })
    }
    finally {
      this.setData({ submitting: false })
    }
  },

  async deleteComment(event: WechatMiniprogram.TouchEvent) {
    const commentId = String(event.currentTarget.dataset.id || '')
    const version = Number(event.currentTarget.dataset.version)
    if (!commentId || !Number.isInteger(version)) {
      return
    }
    try {
      await mipKnowledgeModule.deleteComment(commentId, version)
      await this.load()
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '评论删除失败' })
    }
  },

  async reportComment(event: WechatMiniprogram.TouchEvent) {
    const commentId = String(event.currentTarget.dataset.id || '')
    const choices = reportCategoryOptions.map(item => item.label)
    wx.showActionSheet({
      itemList: choices,
      success: (result) => {
        const category = reportCategoryOptions[result.tapIndex]?.value
        if (category) {
          void mipKnowledgeModule.reportComment(commentId, category)
            .then(() => wx.showToast({ title: '举报已提交', icon: 'success' }))
            .catch(error => this.setData({ message: error instanceof Error ? error.message : '举报提交失败' }))
        }
      },
    })
  },

  async purchase() {
    if (!this.data.detail?.product || this.data.purchasing) {
      return
    }
    if (!this.data.paymentEnabled) {
      this.setData({ message: '当前环境未开启微信支付，暂时不能购买单内容。' })
      return
    }
    this.resumePurchase = true
    try {
      const session = await mipIdentityModule.beginProtectedAction({
        action: 'INTERACT',
        source: {
          navigation: 'navigateBack',
          route: 'packages/member/mip-knowledge/detail/index',
          query: { contentId: this.data.contentId },
        },
      })
      if (!session.decision.ready) {
        caseNavigateTo({ url: mipAccessPageUrl(session.token) })
        return
      }
    }
    catch {
      this.resumePurchase = false
      this.setData({ message: '身份状态暂时无法确认，请稍后重试。' })
      return
    }
    this.resumePurchase = false
    this.setData({ purchasing: true, message: '' })
    try {
      const result = await mipKnowledgeModule.purchase(this.data.contentId)
      if (result.payment.kind === 'CANCELLED') {
        return
      }
      if (result.payment.kind === 'PENDING') {
        caseNavigateTo({
          url: `/packages/member/payment-result/index?orderId=${encodeURIComponent(result.payment.order.id)}`,
        })
        return
      }
      await this.load()
    }
    catch (error) {
      const message = error instanceof Error && error.message === 'PAYMENT_UNAVAILABLE'
        ? '当前环境未开启微信支付，暂时不能购买单内容。'
        : error instanceof Error ? error.message : '购买失败'
      this.setData({ message })
    }
    finally {
      this.setData({ purchasing: false })
    }
  },

  openContent() {
    const detail = this.data.detail
    if (!detail?.access.unlocked) {
      return
    }
    if (detail.contentType === 'PRIVATE_CHANNEL' && detail.channel) {
      if (typeof wx.openChannelsActivity !== 'function') {
        this.setData({ message: '当前微信版本不能打开视频号内容。' })
        return
      }
      wx.openChannelsActivity({
        finderUserName: detail.channel.finderUserName,
        feedId: detail.channel.feedId,
        fail: () => this.setData({ message: '视频号内容暂时无法打开。' }),
      })
      return
    }
    if (detail.externalUrl) {
      void wx.navigateTo({
        url: `/packages/member/mip-knowledge/web/index?contentId=${encodeURIComponent(detail.id)}`,
      })
    }
  },
})
