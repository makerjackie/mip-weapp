import type { OpportunityId } from '../../../../modules/mip'
import type {
  OpportunityComment,
  OpportunityCommentReportIntent,
  OpportunityCommentSettings,
  OpportunityCommentSubmissionIntent,
  OpportunityCommentType,
  OpportunityDetail,
} from '../../../../modules/mip-opportunities'
import { cooperationRoles } from '../../../../config/mip-catalogs'
import { mipAccessPageUrl } from '../../../../modules/mip-identity'
import { mipIdentityModule } from '../../../../modules/mip-identity/client'
import {
  journeyStatusOf,
  opportunityModule,
  opportunityTypeLabel,
  retainOpportunityCommentReportIntent,
  retainOpportunityCommentSubmissionIntent,
} from '../../../../modules/mip-opportunities'
import { caseNavigateTo } from '../../../../platform/navigation/client'
import { formatLocalDateTime } from '../../../../utils/date'

type Interaction = 'cooperation' | 'comment'
/**
 * journey-review J4-05/J4-06：发布人底部条形态。
 * draft=草稿（未发布过）、unpublished=已下架（分享置灰）、active=招募中、ended=已结束。
 */
type OwnerBarMode = 'draft' | 'unpublished' | 'active' | 'ended'

interface PresentedComment extends OpportunityComment {
  createdText: string
  authorInitial: string
}

function presentComment(item: OpportunityComment): PresentedComment {
  return {
    ...item,
    createdText: formatLocalDateTime(item.createdAt),
    authorInitial: item.author.nickname.slice(0, 1) || 'M',
  }
}

Page({
  data: {
    id: '' as OpportunityId,
    state: 'loading' as 'loading' | 'ready' | 'error',
    item: null as OpportunityDetail | null,
    publishedText: '',
    typeTagViews: [] as Array<{ key: string, label: string }>,
    /** journey-review J4-06：已下架态（服务端 DRAFT+publishedAt 的呈现）。 */
    journeyStatus: 'DRAFT' as ReturnType<typeof journeyStatusOf>,
    ownerBar: '' as '' | OwnerBarMode,
    cooperationAvatars: [] as string[],
    roleNames: [] as string[],
    message: '',
    acting: false,
    cooperatorsVisible: false,
    cooperators: [] as OpportunityDetail['author'][],
    cooperatorsCursor: '',
    cooperatorsLoading: false,
    cooperatorsMessage: '',
    commentsAvailable: false,
    commentsState: 'loading' as 'loading' | 'ready' | 'error',
    comments: [] as PresentedComment[],
    commentsCursor: '',
    commentsLoadingMore: false,
    commentsMessage: '',
    commentSettings: null as OpportunityCommentSettings | null,
    composerVisible: false,
    commentType: 'COMMENT' as OpportunityCommentType,
    commentBody: '',
    commentRating: 5,
    editingComment: null as PresentedComment | null,
    commentActingId: '',
    // figma 1768_37414/1768_37369 机会详情还原态开关，fixture 专用；
    // 生产保持 skeleton+卡片+评论布局（opportunity-detail 测试 pin）。
    figmaLayout: false,
  },
  resumeInteraction: '' as '' | Interaction,
  commentSubmissionIntent: null as OpportunityCommentSubmissionIntent | null,
  commentReportIntent: null as OpportunityCommentReportIntent | null,
  cooperatorsRequestSeq: 0,

  onLoad(options: Record<string, string | undefined>) {
    this.commentSubmissionIntent = null
    this.commentReportIntent = null
    const id = String(options.id || '') as OpportunityId
    this.setData({ id })
    void this.load()
  },

  onShow() {
    const resume = mipIdentityModule.consumePendingResume('packages/member/mip-opportunities/detail/index')
    const interaction = this.resumeInteraction
    if (resume?.action === 'INTERACT' && interaction) {
      this.resumeInteraction = ''
      void this.performInteraction(interaction)
    }
    else if (interaction) {
      this.resumeInteraction = ''
    }
    if (this.data.item) {
      void this.load()
    }
  },

  onUnload() {
    this.cooperatorsRequestSeq += 1
  },

  async load() {
    if (!this.data.id) {
      this.setData({ state: 'error', message: '机会信息不完整' })
      return
    }
    if (!this.data.item) {
      this.setData({ state: 'loading', message: '' })
    }
    try {
      const item = await opportunityModule.get(this.data.id)
      const journeyStatus = journeyStatusOf(item)
      // Matches the comment API's public states; ended projects retain reviews.
      const commentsAvailable = item.status === 'PUBLISHED' || item.status === 'ENDED'
      const ownerBar: '' | OwnerBarMode = !item.mine
        ? ''
        : journeyStatus === 'UNPUBLISHED'
          ? 'unpublished'
          : journeyStatus === 'ENDED' ? 'ended' : journeyStatus === 'DRAFT' ? 'draft' : 'active'
      this.setData({
        state: 'ready',
        item,
        publishedText: formatLocalDateTime(item.publishedAt),
        typeTagViews: (item.typeKeys || []).map(key => ({ key, label: opportunityTypeLabel(key) })),
        journeyStatus,
        ownerBar,
        commentsAvailable,
        ...(!commentsAvailable
          ? {
              comments: [],
              commentsCursor: '',
              commentsMessage: '',
              commentSettings: null,
              composerVisible: false,
            }
          : {}),
        // 运行时验收（2026-09-22）：服务端 avatars 形状不可信，保底数组后才绑给卡片 type: Array 属性。
        cooperationAvatars: Array.isArray(item.avatars) ? item.avatars.filter(v => typeof v === 'string' && v) : [],
        roleNames: item.roles.map(key => cooperationRoles.find(role => role.key === key)?.name || key),
        message: '',
      })
      if (commentsAvailable) {
        void this.loadComments(true)
      }
    }
    catch (error) {
      this.setData({
        state: 'error',
        message: error instanceof Error ? error.message : '机会加载失败',
      })
    }
  },

  async authorizeInteraction(interaction: Interaction) {
    const item = this.data.item
    if (!item || this.data.acting || (interaction === 'comment' && !this.data.commentsAvailable)) {
      return
    }
    this.resumeInteraction = interaction
    this.setData({ acting: true })
    try {
      const session = await mipIdentityModule.beginProtectedAction({
        action: 'INTERACT',
        source: { navigation: 'navigateBack' },
      })
      if (!session.decision.ready) {
        caseNavigateTo({ url: mipAccessPageUrl(session.token) })
        return
      }
      this.resumeInteraction = ''
      this.setData({ acting: false })
      await this.performInteraction(interaction)
    }
    catch {
      this.resumeInteraction = ''
      wx.showToast({ title: '身份状态暂时无法确认', icon: 'none' })
    }
    finally {
      this.setData({ acting: false })
    }
  },

  async performInteraction(interaction: Interaction) {
    const item = this.data.item
    if (!item || this.data.acting) {
      return
    }
    this.setData({ acting: true })
    try {
      if (interaction === 'comment') {
        await this.openCommentComposer()
        return
      }
      const result = await opportunityModule.setCooperation(item.id, !item.cooperationActive)
      this.setData({ 'item.cooperationActive': result.active })
      wx.showToast({ title: result.active ? '已表达合作意向' : '已取消合作意向', icon: 'none' })
      await this.load()
    }
    catch (error) {
      wx.showToast({ title: error instanceof Error ? error.message : '操作失败', icon: 'none' })
    }
    finally {
      this.setData({ acting: false })
    }
  },

  async loadComments(reset = false) {
    if (!this.data.commentsAvailable || this.data.commentsLoadingMore || (!reset && !this.data.commentsCursor)) {
      return
    }
    this.setData({
      ...(reset ? { commentsState: 'loading', comments: [], commentsCursor: '' } : { commentsLoadingMore: true }),
      commentsMessage: '',
    })
    try {
      const page = await opportunityModule.listComments(
        this.data.id,
        reset ? undefined : this.data.commentsCursor,
      )
      if (!this.data.commentsAvailable) {
        return
      }
      this.setData({
        commentsState: 'ready',
        commentSettings: page.settings,
        comments: [...(reset ? [] : this.data.comments), ...page.items.map(presentComment)],
        commentsCursor: page.nextCursor || '',
      })
    }
    catch (error) {
      if (!this.data.commentsAvailable) {
        return
      }
      const commentsMessage = error instanceof Error ? error.message : '评论加载失败'
      this.setData({
        commentsState: reset || !this.data.comments.length ? 'error' : 'ready',
        commentsMessage,
      })
    }
    finally {
      this.setData({ commentsLoadingMore: false })
    }
  },

  startComment() {
    void this.authorizeInteraction('comment')
  },

  async openCommentComposer() {
    if (!this.data.commentsAvailable) {
      return
    }
    if (!this.data.commentSettings) {
      await this.loadComments(true)
    }
    const settings = this.data.commentSettings
    if (!settings) {
      return
    }
    const type = settings.commentsEnabled
      ? 'COMMENT'
      : settings.reviewsEnabled && settings.opportunityStatus === 'ENDED' ? 'REVIEW' : null
    if (!type) {
      wx.showToast({ title: '当前机会未开放评论', icon: 'none' })
      return
    }
    this.setData({
      composerVisible: true,
      editingComment: null,
      commentType: type,
      commentBody: '',
      commentRating: 5,
      commentsMessage: '',
    })
  },

  editComment(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id || '')
    const item = this.data.comments.find(comment => comment.id === id)
    if (!item?.canEdit) {
      return
    }
    this.setData({
      composerVisible: true,
      editingComment: item,
      commentType: item.type,
      commentBody: item.body,
      commentRating: item.rating || 5,
      commentsMessage: '',
    })
  },

  closeCommentComposer() {
    if (!this.data.commentActingId) {
      this.setData({ composerVisible: false })
    }
  },

  handleComposerVisibility(event: WechatMiniprogram.CustomEvent<{ visible?: boolean }>) {
    if (!event.detail.visible) {
      this.closeCommentComposer()
    }
  },

  chooseCommentType(event: WechatMiniprogram.TouchEvent) {
    if (this.data.editingComment) {
      return
    }
    const type = String(event.currentTarget.dataset.type || '') as OpportunityCommentType
    const settings = this.data.commentSettings
    if (type === 'COMMENT' && settings?.commentsEnabled && type !== this.data.commentType) {
      this.commentSubmissionIntent = null
      this.setData({ commentType: type })
    }
    if (type === 'REVIEW' && settings?.reviewsEnabled
      && settings.opportunityStatus === 'ENDED' && type !== this.data.commentType) {
      this.commentSubmissionIntent = null
      this.setData({ commentType: type })
    }
  },

  updateCommentBody(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    if (event.detail.value !== this.data.commentBody) {
      this.commentSubmissionIntent = null
    }
    this.setData({ commentBody: event.detail.value })
  },

  chooseCommentRating(event: WechatMiniprogram.TouchEvent) {
    const rating = Number(event.currentTarget.dataset.rating)
    if (Number.isInteger(rating) && rating >= 1 && rating <= 5 && rating !== this.data.commentRating) {
      this.commentSubmissionIntent = null
      this.setData({ commentRating: rating })
    }
  },

  async submitComment() {
    const body = this.data.commentBody.trim()
    if (!body || this.data.commentActingId) {
      return
    }
    const editing = this.data.editingComment
    const input = {
      opportunityId: this.data.id,
      ...(editing ? { commentId: editing.id, expectedVersion: editing.version } : {}),
      type: this.data.commentType,
      body,
      ...(this.data.commentType === 'REVIEW' ? { rating: this.data.commentRating } : {}),
    }
    const intent = retainOpportunityCommentSubmissionIntent(this.commentSubmissionIntent, input)
    this.commentSubmissionIntent = intent
    this.setData({ commentActingId: editing?.id || 'new', commentsMessage: '' })
    try {
      await opportunityModule.saveComment(input, intent.idempotencyKey)
      this.commentSubmissionIntent = null
      this.setData({ composerVisible: false, editingComment: null, commentBody: '' })
      await this.loadComments(true)
      wx.showToast({ title: this.data.commentSettings?.moderationMode === 'REVIEW' && !editing ? '已提交审核' : '已发布', icon: 'none' })
    }
    catch (error) {
      this.setData({ commentsMessage: error instanceof Error ? error.message : '提交失败' })
    }
    finally {
      this.setData({ commentActingId: '' })
    }
  },

  deleteComment(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id || '')
    const item = this.data.comments.find(comment => comment.id === id)
    if (!item?.canDelete || this.data.commentActingId) {
      return
    }
    wx.showModal({
      title: '删除评论',
      content: '删除后评论将不再展示。',
      confirmText: '删除',
      success: (result) => {
        if (result.confirm) {
          void this.confirmDeleteComment(item)
        }
      },
    })
  },

  async confirmDeleteComment(item: PresentedComment) {
    this.setData({ commentActingId: item.id })
    try {
      await opportunityModule.deleteComment(item.id, item.version)
      this.setData({ comments: this.data.comments.filter(comment => comment.id !== item.id) })
      wx.showToast({ title: '已删除', icon: 'none' })
    }
    catch (error) {
      wx.showToast({ title: error instanceof Error ? error.message : '删除失败', icon: 'none' })
    }
    finally {
      this.setData({ commentActingId: '' })
    }
  },

  async toggleCommentCall(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id || '')
    const item = this.data.comments.find(comment => comment.id === id)
    if (!item || item.mine || this.data.commentActingId) {
      return
    }
    this.setData({ commentActingId: id })
    try {
      const result = await opportunityModule.setCommentCall(id, !item.callActive)
      this.setData({
        comments: this.data.comments.map(comment => comment.id === id
          ? { ...comment, callActive: result.active, callCount: result.callCount }
          : comment),
      })
    }
    catch (error) {
      wx.showToast({ title: error instanceof Error ? error.message : '操作失败', icon: 'none' })
    }
    finally {
      this.setData({ commentActingId: '' })
    }
  },

  reportComment(event: WechatMiniprogram.TouchEvent) {
    const commentId = String(event.currentTarget.dataset.id || '')
    const item = this.data.comments.find(comment => comment.id === commentId)
    if (!item || item.mine) {
      return
    }
    const labels = ['垃圾信息', '骚扰行为', '欺诈风险', '不当内容', '冒充他人', '其他问题']
    const categories = ['SPAM', 'HARASSMENT', 'FRAUD', 'INAPPROPRIATE_CONTENT', 'IMPERSONATION', 'OTHER'] as const
    wx.showActionSheet({
      itemList: labels,
      success: (result) => {
        const category = categories[result.tapIndex]
        if (category) {
          void this.submitCommentReport(commentId, category)
        }
      },
    })
  },

  async submitCommentReport(commentId: string, category: 'SPAM' | 'HARASSMENT' | 'FRAUD' | 'INAPPROPRIATE_CONTENT' | 'IMPERSONATION' | 'OTHER') {
    if (this.data.commentActingId) {
      return
    }
    this.setData({ commentActingId: commentId })
    const intent = retainOpportunityCommentReportIntent(this.commentReportIntent, { commentId, category })
    this.commentReportIntent = intent
    try {
      await opportunityModule.reportComment(
        { commentId, category, requestId: intent.requestId },
        intent.idempotencyKey,
      )
      this.commentReportIntent = null
      wx.showToast({ title: '已提交举报', icon: 'none' })
    }
    catch (error) {
      wx.showToast({ title: error instanceof Error ? error.message : '举报失败', icon: 'none' })
    }
    finally {
      this.setData({ commentActingId: '' })
    }
  },

  openCommentAuthor(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id || '')
    const profileRef = this.data.comments.find(comment => comment.id === id)?.author.profileRef
    if (profileRef) {
      caseNavigateTo({ url: `/packages/member/mip-public-profile/index?profileRef=${encodeURIComponent(profileRef)}` })
    }
  },

  loadMoreComments() {
    void this.loadComments(false)
  },

  retryComments() {
    void this.loadComments(true)
  },

  async openCooperators() {
    this.setData({ cooperatorsVisible: true, cooperators: [], cooperatorsCursor: '', cooperatorsMessage: '' })
    await this.loadCooperators(true)
  },

  closeCooperators() {
    this.cooperatorsRequestSeq += 1
    this.setData({ cooperatorsVisible: false, cooperatorsLoading: false })
  },

  handleCooperatorsVisibility(event: WechatMiniprogram.CustomEvent<{ visible?: boolean }>) {
    if (!event.detail.visible) {
      this.closeCooperators()
    }
  },

  async loadCooperators(reset = false) {
    if (!reset && (!this.data.cooperatorsCursor || this.data.cooperatorsLoading)) {
      return
    }
    const seq = ++this.cooperatorsRequestSeq
    this.setData({ cooperatorsLoading: true, cooperatorsMessage: '' })
    try {
      const page = await opportunityModule.listCooperators(this.data.id, reset ? undefined : this.data.cooperatorsCursor)
      if (seq !== this.cooperatorsRequestSeq) {
        return
      }
      const current = reset ? [] : this.data.cooperators
      const ids = new Set(current.map(item => item.profileRef))
      this.setData({ cooperators: [...current, ...page.items.filter(item => !ids.has(item.profileRef))], cooperatorsCursor: page.nextCursor || '' })
    }
    catch (error) {
      if (seq === this.cooperatorsRequestSeq) {
        this.setData({ cooperatorsMessage: error instanceof Error ? error.message : '合作意向名单加载失败' })
      }
    }
    finally {
      if (seq === this.cooperatorsRequestSeq) {
        this.setData({ cooperatorsLoading: false })
      }
    }
  },

  loadMoreCooperators() { void this.loadCooperators(false) },
  retryCooperators() { void this.loadCooperators(true) },

  openAuthor() {
    const profileRef = this.data.item?.author.profileRef
    if (profileRef) {
      caseNavigateTo({ url: `/packages/member/mip-public-profile/index?profileRef=${encodeURIComponent(profileRef)}` })
    }
  },

  openTeamMember(event: WechatMiniprogram.TouchEvent) {
    const profileRef = String(event.currentTarget.dataset.profileRef || '')
    if (profileRef) {
      caseNavigateTo({ url: `/packages/member/mip-public-profile/index?profileRef=${encodeURIComponent(profileRef)}` })
    }
  },

  edit() {
    const item = this.data.item
    // 服务端 OWNER_EDITABLE 只含 DRAFT/PUBLISHED：已结束机会的「编辑」置灰，这里兜底不跳转。
    if (item && item.status !== 'ENDED' && (item.canEdit || item.mine)) {
      caseNavigateTo({ url: `/packages/member/mip-opportunities/editor/index?id=${encodeURIComponent(this.data.id)}` })
    }
  },

  async cooperationIntent() {
    await this.authorizeInteraction('cooperation')
  },

  onShareAppMessage() {
    return {
      title: this.data.item?.title || 'MIP 机会',
      path: `/packages/member/mip-opportunities/detail/index?id=${this.data.id}`,
    }
  },
})
