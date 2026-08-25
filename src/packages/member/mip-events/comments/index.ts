import type {
  EventComment,
  EventCommentDeleteIntent,
  EventCommentReportIntent,
  EventCommentSubmissionInput,
  EventCommentSubmissionIntent,
  ReportCategory,
} from '../../../../modules/mip-community'
import {
  canResumeEventCommentMutation,
  MipCommunityError,
  mipCommunityModule,
  reportCategoryOptions,
  retainEventCommentDeleteIntent,
  retainEventCommentReportIntent,
  retainEventCommentSubmissionIntent,
} from '../../../../modules/mip-community'
import { mipAccessPageUrl } from '../../../../modules/mip-identity'
import { mipIdentityModule } from '../../../../modules/mip-identity/client'
import { caseNavigateTo } from '../../../../modules/platform/case-navigation'

type PageState = 'loading' | 'ready' | 'empty' | 'error' | 'access'
type PendingAction
  = | { kind: 'SAVE', input: EventCommentSubmissionInput }
    | { kind: 'DELETE', comment: EventComment }
    | { kind: 'REPORT', comment: EventComment, category: ReportCategory }

interface PresentedComment extends EventComment {
  createdText: string
  statusText: string
}

const accessErrorCodes = new Set([
  'AUTH_REQUIRED',
  'AGREEMENT_REQUIRED',
  'PHONE_REQUIRED',
  'PROFILE_REQUIRED',
])

function formatTime(value?: string) {
  if (!value) {
    return ''
  }
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) {
    return ''
  }
  const now = new Date()
  if (date.getFullYear() === now.getFullYear()
    && date.getMonth() === now.getMonth()
    && date.getDate() === now.getDate()) {
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
  }
  return `${date.getMonth() + 1}月${date.getDate()}日`
}

function present(comment: EventComment): PresentedComment {
  return {
    ...comment,
    createdText: formatTime(comment.editedAt || comment.createdAt),
    statusText: comment.status === 'PENDING'
      ? '待审核'
      : comment.editedAt ? '已编辑' : '',
  }
}

function isAccessError(error: unknown) {
  return error instanceof MipCommunityError && accessErrorCodes.has(error.code)
}

Page({
  data: {
    state: 'loading' as PageState,
    eventId: '',
    eventTitle: '',
    eventStatus: '' as '' | 'PUBLISHED' | 'CANCELLED' | 'ENDED',
    comments: [] as PresentedComment[],
    commentsEnabled: false,
    moderationMode: 'AUTO' as 'AUTO' | 'REVIEW',
    nextCursor: '',
    draft: '',
    editingCommentId: '',
    editingVersion: 0,
    accessToken: '',
    submitting: false,
    actingCommentId: '',
    loadingMore: false,
    message: '',
  },
  accessReady: false,
  checkingAccess: false,
  pendingAction: null as PendingAction | null,
  accessRetryAttempted: false,
  submissionIntent: null as EventCommentSubmissionIntent | null,
  deleteIntent: null as EventCommentDeleteIntent | null,
  reportIntent: null as EventCommentReportIntent | null,

  onLoad(query: Record<string, string | undefined>) {
    const eventId = String(query.eventId || '').trim()
    this.setData(eventId
      ? { eventId }
      : { state: 'error', message: '活动参数无效，请从活动详情重新进入。' })
  },

  onShow() {
    const resumed = mipIdentityModule.consumePendingResume('packages/member/mip-events/comments/index')
    const shouldResume = resumed?.action === 'INTERACT'
    if (!this.accessReady || shouldResume) {
      void this.checkAccess(shouldResume)
      return
    }
    void this.loadComments(true)
  },

  async checkAccess(resumed = false) {
    if (this.checkingAccess || !this.data.eventId) {
      return
    }
    this.checkingAccess = true
    if (!this.accessReady) {
      this.setData({ state: 'loading', message: '' })
    }
    try {
      const session = await mipIdentityModule.beginProtectedAction({
        action: 'INTERACT',
        source: {
          navigation: 'navigateBack',
          route: '/packages/member/mip-events/comments/index',
          query: { eventId: this.data.eventId, resumeComment: '1' },
        },
      })
      if (!session.decision.ready) {
        this.accessReady = false
        this.setData({ state: 'access', accessToken: session.token, message: '' })
        return
      }
      this.accessReady = true
      this.setData({ accessToken: '' })
      await this.loadComments(true)
      if (resumed && canResumeEventCommentMutation(this.accessReady, this.pendingAction)) {
        const pending = this.pendingAction
        this.pendingAction = null
        this.accessRetryAttempted = true
        await this.executePending(pending)
      }
    }
    catch {
      this.accessReady = false
      this.setData({ state: 'error', message: '身份状态暂时无法确认，请稍后重试。' })
    }
    finally {
      this.checkingAccess = false
    }
  },

  openAccess() {
    if (this.data.accessToken) {
      caseNavigateTo({ url: mipAccessPageUrl(this.data.accessToken) })
    }
  },

  retry() {
    if (this.data.state === 'access') {
      this.openAccess()
      return
    }
    void this.checkAccess()
  },

  async loadComments(reset = false) {
    if (!this.accessReady || (!reset && (!this.data.nextCursor || this.data.loadingMore))) {
      return
    }
    if (reset && !this.data.comments.length) {
      this.setData({ state: 'loading', message: '' })
    }
    if (!reset) {
      this.setData({ loadingMore: true, message: '' })
    }
    try {
      const page = await mipCommunityModule.listEventComments(
        this.data.eventId,
        reset ? undefined : this.data.nextCursor,
      )
      const comments = reset
        ? page.items.map(present)
        : [...this.data.comments, ...page.items.map(present)]
      this.setData({
        state: comments.length ? 'ready' : 'empty',
        eventTitle: page.event.title,
        eventStatus: page.event.status,
        comments,
        commentsEnabled: page.settings.commentsEnabled,
        moderationMode: page.settings.moderationMode,
        nextCursor: page.nextCursor || '',
        message: '',
      })
    }
    catch (error) {
      if (isAccessError(error)) {
        this.accessReady = false
        await this.recoverAccess(null)
        return
      }
      this.setData(this.data.comments.length
        ? { state: 'ready', message: '评论更新失败，已保留当前结果。' }
        : {
            state: 'error',
            message: error instanceof Error ? error.message : '活动评论加载失败。',
          })
    }
    finally {
      this.setData({ loadingMore: false })
    }
  },

  loadMore() {
    void this.loadComments(false)
  },

  updateDraft(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    if (event.detail.value !== this.data.draft) {
      this.submissionIntent = null
    }
    this.setData({ draft: event.detail.value, message: '' })
  },

  startEdit(event: WechatMiniprogram.TouchEvent) {
    const commentId = String(event.currentTarget.dataset.id || '')
    const comment = this.data.comments.find(item => item.id === commentId)
    if (!comment?.canEdit || this.data.actingCommentId || this.data.submitting) {
      return
    }
    this.submissionIntent = null
    this.setData({
      draft: comment.body,
      editingCommentId: comment.id,
      editingVersion: comment.version,
      message: '',
    })
  },

  cancelEdit() {
    if (this.data.submitting) {
      return
    }
    this.submissionIntent = null
    this.setData({ draft: '', editingCommentId: '', editingVersion: 0, message: '' })
  },

  submitComment() {
    const body = this.data.draft.trim()
    if (!body || !this.data.commentsEnabled || this.data.submitting) {
      return
    }
    const input: EventCommentSubmissionInput = {
      eventId: this.data.eventId,
      body,
      ...(this.data.editingCommentId
        ? {
            commentId: this.data.editingCommentId,
            expectedVersion: this.data.editingVersion,
          }
        : {}),
    }
    this.accessRetryAttempted = false
    void this.executeSave(input)
  },

  async executeSave(input: EventCommentSubmissionInput) {
    if (this.data.submitting) {
      return
    }
    const intent = retainEventCommentSubmissionIntent(this.submissionIntent, input)
    this.submissionIntent = intent
    this.setData({ submitting: true, message: '' })
    try {
      const result = await mipCommunityModule.saveEventComment(input, intent.idempotencyKey)
      this.submissionIntent = null
      this.setData({ draft: '', editingCommentId: '', editingVersion: 0 })
      await this.loadComments(true)
      wx.showToast({
        title: result.status === 'PENDING' ? '已提交审核' : input.commentId ? '已更新' : '已发布',
        icon: 'none',
      })
    }
    catch (error) {
      if (isAccessError(error)) {
        this.setData({ submitting: false })
        await this.recoverAccess({ kind: 'SAVE', input })
      }
      else if (error instanceof MipCommunityError
        && ['CONFLICT', 'COMMENT_EDIT_WINDOW_CLOSED'].includes(error.code)) {
        await this.recoverConflict(input.commentId, error.code === 'COMMENT_EDIT_WINDOW_CLOSED')
      }
      else {
        this.setData({ message: error instanceof Error ? error.message : '评论提交失败。' })
      }
    }
    finally {
      this.setData({ submitting: false })
    }
  },

  deleteComment(event: WechatMiniprogram.TouchEvent) {
    const commentId = String(event.currentTarget.dataset.id || '')
    const comment = this.data.comments.find(item => item.id === commentId)
    if (!comment?.canDelete || this.data.actingCommentId) {
      return
    }
    wx.showModal({
      title: '删除评论',
      content: '删除后评论将不再展示。',
      confirmText: '删除',
      success: (result) => {
        if (result.confirm) {
          this.accessRetryAttempted = false
          void this.executeDelete(comment)
        }
      },
    })
  },

  async executeDelete(comment: EventComment) {
    if (this.data.actingCommentId) {
      return
    }
    const input = {
      eventId: this.data.eventId,
      commentId: comment.id,
      expectedVersion: comment.version,
    }
    const intent = retainEventCommentDeleteIntent(this.deleteIntent, input)
    this.deleteIntent = intent
    this.setData({ actingCommentId: comment.id, message: '' })
    try {
      await mipCommunityModule.deleteEventComment(
        input.eventId,
        input.commentId,
        input.expectedVersion,
        intent.idempotencyKey,
      )
      this.deleteIntent = null
      const comments = this.data.comments.filter(item => item.id !== comment.id)
      this.setData({ comments, state: comments.length ? 'ready' : 'empty' })
      wx.showToast({ title: '已删除', icon: 'none' })
    }
    catch (error) {
      if (isAccessError(error)) {
        this.setData({ actingCommentId: '' })
        await this.recoverAccess({ kind: 'DELETE', comment })
      }
      else if (error instanceof MipCommunityError && error.code === 'CONFLICT') {
        await this.recoverConflict()
      }
      else {
        this.setData({ message: error instanceof Error ? error.message : '评论删除失败。' })
      }
    }
    finally {
      this.setData({ actingCommentId: '' })
    }
  },

  reportComment(event: WechatMiniprogram.TouchEvent) {
    const commentId = String(event.currentTarget.dataset.id || '')
    const comment = this.data.comments.find(item => item.id === commentId)
    if (!comment || comment.mine || this.data.actingCommentId) {
      return
    }
    wx.showActionSheet({
      itemList: reportCategoryOptions.map(item => item.label),
      success: (result) => {
        const category = reportCategoryOptions[result.tapIndex]?.value
        if (category) {
          this.accessRetryAttempted = false
          void this.executeReport(comment, category)
        }
      },
    })
  },

  async executeReport(comment: EventComment, category: ReportCategory) {
    if (this.data.actingCommentId) {
      return
    }
    const input = {
      eventId: this.data.eventId,
      commentId: comment.id,
      expectedVersion: comment.version,
      category,
    }
    const intent = retainEventCommentReportIntent(this.reportIntent, input)
    this.reportIntent = intent
    this.setData({ actingCommentId: comment.id, message: '' })
    try {
      await mipCommunityModule.reportEventComment({
        ...input,
        requestId: intent.requestId,
        idempotencyKey: intent.idempotencyKey,
      })
      this.reportIntent = null
      wx.showToast({ title: '举报已提交', icon: 'none' })
    }
    catch (error) {
      if (isAccessError(error)) {
        this.setData({ actingCommentId: '' })
        await this.recoverAccess({ kind: 'REPORT', comment, category })
      }
      else if (error instanceof MipCommunityError && error.code === 'CONFLICT') {
        await this.recoverConflict()
      }
      else {
        this.setData({ message: error instanceof Error ? error.message : '举报提交失败。' })
      }
    }
    finally {
      this.setData({ actingCommentId: '' })
    }
  },

  openAuthor(event: WechatMiniprogram.TouchEvent) {
    const commentId = String(event.currentTarget.dataset.id || '')
    const profileRef = this.data.comments.find(item => item.id === commentId)?.author.profileRef
    if (profileRef) {
      caseNavigateTo({
        url: `/packages/member/mip-public-profile/index?profileRef=${encodeURIComponent(profileRef)}`,
      })
    }
  },

  async recoverAccess(pending: PendingAction | null) {
    if (this.accessRetryAttempted) {
      this.setData({ message: '身份状态仍未满足评论条件，请稍后重试。' })
      return
    }
    this.pendingAction = pending
    this.accessReady = false
    try {
      const session = await mipIdentityModule.beginProtectedAction({
        action: 'INTERACT',
        source: {
          navigation: 'navigateBack',
          route: '/packages/member/mip-events/comments/index',
          query: { eventId: this.data.eventId, resumeComment: '1' },
        },
      })
      if (!session.decision.ready) {
        caseNavigateTo({ url: mipAccessPageUrl(session.token) })
        return
      }
      this.accessReady = true
      this.accessRetryAttempted = true
      await this.loadComments(true)
      if (canResumeEventCommentMutation(this.accessReady, pending)) {
        this.pendingAction = null
        await this.executePending(pending)
      }
    }
    catch {
      this.pendingAction = null
      this.setData({ message: '身份状态暂时无法确认，请稍后重试。' })
    }
  },

  async executePending(pending: PendingAction) {
    if (pending.kind === 'SAVE') {
      await this.executeSave(pending.input)
    }
    else if (pending.kind === 'DELETE') {
      await this.executeDelete(pending.comment)
    }
    else {
      await this.executeReport(pending.comment, pending.category)
    }
  },

  async recoverConflict(editingCommentId?: string, editWindowClosed = false) {
    await this.loadComments(true)
    if (editingCommentId) {
      const current = this.data.comments.find(item => item.id === editingCommentId)
      if (current?.canEdit) {
        this.submissionIntent = null
        this.setData({ editingVersion: current.version })
      }
      else {
        this.submissionIntent = null
        this.setData({ draft: '', editingCommentId: '', editingVersion: 0 })
      }
    }
    this.setData({
      message: editWindowClosed
        ? '评论已超过可编辑时间，最新状态已加载。'
        : '评论状态已更新，请确认后重新操作。',
    })
  },
})
