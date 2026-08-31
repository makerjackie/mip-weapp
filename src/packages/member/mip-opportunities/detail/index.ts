import type { OpportunityId } from '../../../../modules/mip'
import type {
  OpportunityComment,
  OpportunityCommentReportIntent,
  OpportunityCommentSettings,
  OpportunityCommentSubmissionIntent,
  OpportunityCommentType,
  OpportunityDetail,
  PublicPerson,
} from '../../../../modules/mip-opportunities'
import { cooperationRoles } from '../../../../config/mip-catalogs'
import { mipAccessPageUrl } from '../../../../modules/mip-identity'
import { mipIdentityModule } from '../../../../modules/mip-identity/client'
import {
  opportunityModule,
  retainOpportunityCommentReportIntent,
  retainOpportunityCommentSubmissionIntent,
} from '../../../../modules/mip-opportunities'
import { caseNavigateTo } from '../../../../modules/platform/case-navigation'
import { formatLocalDateTime } from '../../../../utils/date'

type Interaction = 'referral' | 'referral-cancel' | 'interest' | 'comment'

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

interface ReferralCandidate extends PublicPerson {
  displayName: string
  displayInitial: string
}

function presentCandidate(item: PublicPerson): ReferralCandidate {
  const displayName = item.nickname || 'MIP 用户'
  return { ...item, displayName, displayInitial: displayName.slice(0, 1) }
}

Page({
  data: {
    id: '' as OpportunityId,
    state: 'loading' as 'loading' | 'ready' | 'error',
    item: null as OpportunityDetail | null,
    publishedText: '',
    roleNames: [] as string[],
    message: '',
    acting: false,
    referralPickerVisible: false,
    referralKeyword: '',
    referralCandidates: [] as ReferralCandidate[],
    referralCandidatesLoading: false,
    referralCandidatesCursor: '',
    referralPickerMessage: '',
    selectedReferralTarget: null as ReferralCandidate | null,
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
  },
  resumeInteraction: '' as '' | Interaction,
  commentSubmissionIntent: null as OpportunityCommentSubmissionIntent | null,
  commentReportIntent: null as OpportunityCommentReportIntent | null,
  endConfirmationBusy: false,

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
      this.setData({
        state: 'ready',
        item,
        publishedText: formatLocalDateTime(item.publishedAt),
        roleNames: item.roles.map(key => cooperationRoles.find(role => role.key === key)?.name || key),
        message: '',
      })
      void this.loadComments(true)
    }
    catch (error) {
      this.setData({
        state: 'error',
        message: error instanceof Error ? error.message : '机会加载失败',
      })
    }
  },

  async toggleReferral() {
    await this.authorizeInteraction('referral')
  },

  async changeReferralTarget() {
    await this.authorizeInteraction('referral')
  },

  async cancelReferral() {
    await this.authorizeInteraction('referral-cancel')
  },

  async toggleInterest() {
    await this.authorizeInteraction('interest')
  },

  async authorizeInteraction(interaction: Interaction) {
    const item = this.data.item
    if (!item || this.data.acting) {
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
      if (interaction === 'referral') {
        this.openReferralPicker()
        return
      }
      if (interaction === 'comment') {
        await this.openCommentComposer()
        return
      }
      if (interaction === 'referral-cancel') {
        const result = await opportunityModule.setReferral(item.id, false)
        this.setData({
          'item.referralActive': result.active,
          'item.referralTarget': undefined,
          'item.referralCount': result.referralCount ?? item.referralCount,
        })
        wx.showToast({ title: '已取消引荐', icon: 'none' })
      }
      else {
        const result = await opportunityModule.setAuthorInterest(item.id, !item.interestActive)
        this.setData({ 'item.interestActive': result.active })
        wx.showToast({ title: result.active ? '已标记感兴趣' : '已取消感兴趣', icon: 'none' })
      }
    }
    catch (error) {
      wx.showToast({ title: error instanceof Error ? error.message : '操作失败', icon: 'none' })
    }
    finally {
      this.setData({ acting: false })
    }
  },

  async loadComments(reset = false) {
    if (this.data.commentsLoadingMore || (!reset && !this.data.commentsCursor)) {
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
      this.setData({
        commentsState: 'ready',
        commentSettings: page.settings,
        comments: [...(reset ? [] : this.data.comments), ...page.items.map(presentComment)],
        commentsCursor: page.nextCursor || '',
      })
    }
    catch (error) {
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

  openReferralPicker() {
    const current = this.data.item?.referralTarget
    this.setData({
      referralPickerVisible: true,
      referralKeyword: '',
      referralCandidates: [],
      referralCandidatesCursor: '',
      referralPickerMessage: '',
      selectedReferralTarget: current
        ? presentCandidate({
            ...current,
            isSelf: false,
            userKind: 'GUEST',
            joinedAt: '',
          })
        : null,
    })
    void this.loadReferralCandidates(true)
  },

  closeReferralPicker() {
    if (!this.data.acting) {
      this.setData({ referralPickerVisible: false })
    }
  },

  handleReferralPickerVisibility(event: WechatMiniprogram.CustomEvent<{ visible?: boolean }>) {
    if (!event.detail.visible) {
      this.closeReferralPicker()
    }
  },

  updateReferralKeyword(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    this.setData({ referralKeyword: event.detail.value })
  },

  searchReferralCandidates() {
    void this.loadReferralCandidates(true)
  },

  loadMoreReferralCandidates() {
    if (this.data.referralCandidatesCursor) {
      void this.loadReferralCandidates(false)
    }
  },

  async loadReferralCandidates(reset: boolean) {
    if (this.data.referralCandidatesLoading || (!reset && !this.data.referralCandidatesCursor)) {
      return
    }
    this.setData({
      referralCandidatesLoading: true,
      referralPickerMessage: '',
      ...(reset ? { referralCandidates: [], referralCandidatesCursor: '' } : {}),
    })
    try {
      const page = await opportunityModule.listPeople({
        kind: 'ALL',
        scope: 'GLOBAL',
        keyword: this.data.referralKeyword.trim() || undefined,
        cursor: reset ? undefined : this.data.referralCandidatesCursor,
        limit: 20,
      })
      const incoming = page.items.filter(item => !item.isSelf).map(presentCandidate)
      const existing = reset ? [] : this.data.referralCandidates
      const profileRefs = new Set(existing.map(item => item.profileRef))
      this.setData({
        referralCandidates: [...existing, ...incoming.filter(item => !profileRefs.has(item.profileRef))],
        referralCandidatesCursor: page.nextCursor || '',
      })
    }
    catch (error) {
      this.setData({
        referralPickerMessage: error instanceof Error ? error.message : '候选人加载失败',
      })
    }
    finally {
      this.setData({ referralCandidatesLoading: false })
    }
  },

  selectReferralTarget(event: WechatMiniprogram.TouchEvent) {
    const profileRef = String(event.currentTarget.dataset.profileRef || '')
    const target = this.data.referralCandidates.find(item => item.profileRef === profileRef)
    if (target) {
      this.setData({ selectedReferralTarget: target, referralPickerMessage: '' })
    }
  },

  async confirmReferralTarget() {
    const item = this.data.item
    const target = this.data.selectedReferralTarget
    if (!item || !target || this.data.acting) {
      if (!target) {
        this.setData({ referralPickerMessage: '请选择被引荐人' })
      }
      return
    }
    this.setData({ acting: true, referralPickerMessage: '' })
    try {
      const result = await opportunityModule.setReferral(item.id, true, target.profileRef)
      this.setData({
        'referralPickerVisible': false,
        'item.referralActive': true,
        'item.referralTarget': {
          profileRef: target.profileRef,
          nickname: target.displayName,
          ...(target.avatarUrl ? { avatarUrl: target.avatarUrl } : {}),
          ...(target.headline ? { headline: target.headline } : {}),
        },
        'item.referralCount': result.referralCount ?? item.referralCount,
      })
      wx.showToast({ title: item.referralActive ? '已更新引荐对象' : '已引荐', icon: 'none' })
    }
    catch (error) {
      this.setData({ referralPickerMessage: error instanceof Error ? error.message : '引荐失败' })
    }
    finally {
      this.setData({ acting: false })
    }
  },

  openAuthor() {
    const profileRef = this.data.item?.author.profileRef
    if (profileRef) {
      caseNavigateTo({ url: `/packages/member/mip-public-profile/index?profileRef=${encodeURIComponent(profileRef)}` })
    }
  },

  openReferralTarget() {
    const profileRef = this.data.item?.referralTarget?.profileRef
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
    if (this.data.item?.canEdit) {
      caseNavigateTo({ url: `/packages/member/mip-opportunities/editor/index?id=${encodeURIComponent(this.data.id)}` })
    }
  },

  async end() {
    const item = this.data.item
    if (!item || !item.canEdit || item.status !== 'PUBLISHED'
      || this.data.acting || this.endConfirmationBusy) {
      return
    }
    this.endConfirmationBusy = true
    try {
      const result = await wx.showModal({
        title: '结束机会',
        content: '结束后会显示在“已完成”，已有引荐记录会保留。',
        confirmText: '确认结束',
      }).catch(() => null)
      if (result?.confirm) {
        await this.confirmEnd(item)
      }
    }
    finally {
      this.endConfirmationBusy = false
    }
  },

  async confirmEnd(item: OpportunityDetail) {
    if (this.data.acting) {
      return
    }
    this.setData({ acting: true })
    try {
      await opportunityModule.end(item.id, item.version)
      await this.load()
      wx.showToast({ title: '机会已结束', icon: 'success' })
    }
    catch (error) {
      wx.showToast({ title: error instanceof Error ? error.message : '操作失败', icon: 'none' })
    }
    finally {
      this.setData({ acting: false })
    }
  },

  onShareAppMessage() {
    return {
      title: this.data.item?.title || 'MIP 机会',
      path: `/packages/member/mip-opportunities/detail/index?id=${this.data.id}`,
    }
  },
})
