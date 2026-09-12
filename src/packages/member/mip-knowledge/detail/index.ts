import type { KnowledgeCommentIntent } from '../../../../modules/mip-knowledge/gateway'
import type { KnowledgeComment, KnowledgeContentDetail } from '../../../../modules/mip-knowledge/types'
import { reportCategoryOptions } from '../../../../modules/mip-community'
import { mipAccessPageUrl } from '../../../../modules/mip-identity'
import { mipIdentityModule } from '../../../../modules/mip-identity/client'
import { mipKnowledgeModule } from '../../../../modules/mip-knowledge/client'
import { caseNavigateTo } from '../../../../platform/navigation/client'

Page({
  data: {
    state: 'loading' as 'loading' | 'ready' | 'error',
    contentId: '',
    detail: null as KnowledgeContentDetail | null,
    priceLabel: '',
    comments: [] as KnowledgeComment[],
    commentsEnabled: false,
    commentsNextCursor: '',
    loadingComments: false,
    refreshingComments: false,
    commentBody: '',
    submitting: false,
    purchasing: false,
    message: '',
    paymentEnabled: mipKnowledgeModule.paymentEnabled,
  },
  resumePurchase: false,
  commentIntent: null as KnowledgeCommentIntent | null,
  loadSequence: 0,

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

  onHide() { this.loadSequence += 1 },
  onUnload() { this.loadSequence += 1 },

  async load() {
    const sequence = ++this.loadSequence
    this.setData({ loadingComments: false, refreshingComments: true })
    if (!this.data.detail) {
      this.setData({ state: 'loading', message: '' })
    }
    try {
      const [detail, comments] = await Promise.all([
        mipKnowledgeModule.getContent(this.data.contentId),
        mipKnowledgeModule.listComments(this.data.contentId),
      ])
      if (sequence !== this.loadSequence) {
        return
      }
      this.setData({
        state: 'ready',
        detail,
        priceLabel: detail.product ? `¥${(detail.product.priceCents / 100).toFixed(2)}` : '',
        comments: comments.items,
        commentsNextCursor: comments.nextCursor || '',
        commentsEnabled: comments.settings.commentsEnabled,
        message: '',
      })
    }
    catch (error) {
      if (sequence !== this.loadSequence) {
        return
      }
      this.setData({ state: this.data.detail ? 'ready' : 'error', message: error instanceof Error ? error.message : '内容加载失败' })
    }
    finally {
      if (sequence === this.loadSequence) {
        this.setData({ refreshingComments: false })
      }
    }
  },

  async loadMoreComments() {
    if (!this.data.commentsNextCursor || this.data.loadingComments || this.data.refreshingComments) {
      return
    }
    const sequence = this.loadSequence
    this.setData({ loadingComments: true, message: '' })
    try {
      const page = await mipKnowledgeModule.listComments(this.data.contentId, this.data.commentsNextCursor)
      if (sequence !== this.loadSequence) {
        return
      }
      const existing = new Set(this.data.comments.map(comment => comment.id))
      this.setData({
        comments: this.data.comments.concat(page.items.filter(comment => !existing.has(comment.id))),
        commentsNextCursor: page.nextCursor || '',
      })
    }
    catch (error) {
      if (sequence === this.loadSequence) {
        this.setData({ message: error instanceof Error ? error.message : '更多评论加载失败' })
      }
    }
    finally {
      if (sequence === this.loadSequence) {
        this.setData({ loadingComments: false })
      }
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
      if (!this.commentIntent || this.commentIntent.contentId !== this.data.contentId || this.commentIntent.body !== body) {
        this.commentIntent = mipKnowledgeModule.createCommentIntent(this.data.contentId, body)
      }
      await mipKnowledgeModule.createComment(this.commentIntent)
      this.commentIntent = null
      if (this.data.commentBody.trim() === body) {
        this.setData({ commentBody: '' })
      }
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
