import type {
  AdminEventComment,
  AdminEventCommentReport,
  AdminEventCommentSettings,
} from '../../../modules/mip-admin'
import type { AdminPageState } from '../shared/page-state'
import {
  MipAdminError,
  mipAdminModule,
} from '../../../modules/mip-admin'
import { formatLocalDateTime } from '../../../utils/date'
import {
  adminLoadFailure,
  isAdminForbiddenError,
  isAdminVersionConflict,
} from '../shared/page-state'

type EventCommentPageState = AdminPageState | 'empty'
type CommentView = AdminEventComment & { statusText: string, createdText: string }
type ReportView = AdminEventCommentReport & {
  statusText: string
  categoryText: string
  createdText: string
  reviewedText: string
}

const commentStatusLabels: Record<AdminEventComment['status'], string> = {
  PENDING: '待审核',
  PUBLISHED: '已发布',
  HIDDEN: '已隐藏',
}

const reportStatusLabels: Record<AdminEventCommentReport['status'], string> = {
  PENDING: '待领取',
  REVIEWING: '审核中',
}

const reportCategoryLabels: Record<AdminEventCommentReport['category'], string> = {
  SPAM: '垃圾信息',
  HARASSMENT: '骚扰行为',
  FRAUD: '欺诈风险',
  INAPPROPRIATE_CONTENT: '不当内容',
  IMPERSONATION: '冒充他人',
  OTHER: '其他问题',
}

const eventStatusLabels: Record<string, string> = {
  DRAFT: '草稿',
  PUBLISHED: '已发布',
  UNPUBLISHED: '已下架',
  CANCELLED: '已取消',
  ENDED: '已结束',
  ARCHIVED: '已归档',
}

function commentView(comment: AdminEventComment): CommentView {
  return {
    ...comment,
    statusText: commentStatusLabels[comment.status],
    createdText: comment.createdAt ? formatLocalDateTime(comment.createdAt) : '未记录',
  }
}

function reportView(report: AdminEventCommentReport): ReportView {
  return {
    ...report,
    statusText: reportStatusLabels[report.status],
    categoryText: reportCategoryLabels[report.category],
    createdText: report.createdAt ? formatLocalDateTime(report.createdAt) : '未记录',
    reviewedText: report.reviewedAt ? formatLocalDateTime(report.reviewedAt) : '',
  }
}

Page({
  data: {
    state: 'loading' as EventCommentPageState,
    eventId: '',
    event: null as {
      id: string
      title: string
      status: string
      statusText: string
      version: number
    } | null,
    settings: null as AdminEventCommentSettings | null,
    comments: [] as CommentView[],
    reports: [] as ReportView[],
    processing: false,
    message: '',
  },

  onLoad(query: Record<string, string | undefined>) {
    this.setData({ eventId: String(query.eventId || '') })
  },

  onShow() {
    if (this.data.eventId) {
      void this.load()
    }
    else {
      this.setData({ state: 'error', message: '活动标识无效' })
    }
  },

  async onPullDownRefresh() {
    try {
      await this.load(true)
    }
    finally {
      wx.stopPullDownRefresh()
    }
  },

  retryLoad() {
    void this.load(true)
  },

  async load(force = false) {
    const hasContent = Boolean(this.data.event && this.data.settings)
    if (!hasContent) {
      this.setData({ state: 'loading', message: '' })
    }
    try {
      const state = await mipAdminModule.events.getCommentState(this.data.eventId, force)
      this.setData({
        state: state.comments.length || state.reports.length ? 'ready' : 'empty',
        event: { ...state.event, statusText: eventStatusLabels[state.event.status] },
        settings: state.settings,
        comments: state.comments.map(commentView),
        reports: state.reports.map(reportView),
        message: '',
      })
    }
    catch (error) {
      this.setData(adminLoadFailure(error, {
        hasContent,
        fallbackMessage: '活动评论加载失败',
      }))
    }
  },

  updateCommentsEnabled(event: WechatMiniprogram.CustomEvent<{ value: boolean }>) {
    if (this.data.processing || !this.data.settings) {
      return
    }
    this.setData({ 'settings.commentsEnabled': Boolean(event.detail.value) })
  },

  updateModerationMode(event: WechatMiniprogram.CustomEvent<{ value: boolean }>) {
    if (this.data.processing || !this.data.settings) {
      return
    }
    this.setData({ 'settings.moderationMode': event.detail.value ? 'REVIEW' : 'AUTO' })
  },

  async saveSettings() {
    const settings = this.data.settings
    if (!settings || this.data.processing) {
      return
    }
    this.setData({ processing: true, message: '' })
    try {
      await mipAdminModule.events.saveCommentSettings({
        eventId: this.data.eventId,
        expectedVersion: settings.version,
        settings: {
          commentsEnabled: settings.commentsEnabled,
          moderationMode: settings.moderationMode,
        },
      })
      await this.load(true)
      wx.showToast({ title: '评论设置已保存', icon: 'success' })
    }
    catch (error) {
      await this.handleMutationFailure(error, '评论设置保存失败')
    }
    finally {
      this.setData({ processing: false })
    }
  },

  async moderateComment(event: WechatMiniprogram.TouchEvent) {
    const commentId = String(event.currentTarget.dataset.id || '')
    const action = String(event.currentTarget.dataset.action || '') as 'PUBLISH' | 'HIDE'
    const comment = this.data.comments.find(item => item.id === commentId)
    if (!comment || !['PUBLISH', 'HIDE'].includes(action) || this.data.processing) {
      return
    }
    const modal = await wx.showModal({
      title: action === 'PUBLISH' ? '发布评论' : '隐藏评论',
      editable: true,
      placeholderText: '填写审核原因',
      confirmText: action === 'PUBLISH' ? '发布' : '隐藏',
    }).catch(() => null)
    const reason = modal?.content?.trim() || ''
    if (!modal?.confirm) {
      return
    }
    if (!reason || reason.length > 300) {
      this.setData({ message: '请填写不超过 300 字的审核原因。' })
      return
    }
    this.setData({ processing: true, message: '' })
    try {
      await mipAdminModule.events.moderateComment({
        eventId: this.data.eventId,
        commentId,
        expectedVersion: comment.version,
        action,
        reason,
      })
      await this.load(true)
      wx.showToast({ title: action === 'PUBLISH' ? '评论已发布' : '评论已隐藏', icon: 'success' })
    }
    catch (error) {
      await this.handleMutationFailure(error, '评论审核失败')
    }
    finally {
      this.setData({ processing: false })
    }
  },

  async claimReport(event: WechatMiniprogram.TouchEvent) {
    const reportId = String(event.currentTarget.dataset.id || '')
    const report = this.data.reports.find(item => item.id === reportId)
    if (!report || report.status !== 'PENDING' || this.data.processing) {
      return
    }
    const modal = await wx.showModal({
      title: '领取举报',
      content: '领取后，举报将进入审核中状态。',
      confirmText: '领取',
    }).catch(() => null)
    if (!modal?.confirm) {
      return
    }
    this.setData({ processing: true, message: '' })
    try {
      await mipAdminModule.events.claimCommentReport({
        eventId: this.data.eventId,
        reportId,
        expectedVersion: report.version,
      })
      await this.load(true)
      wx.showToast({ title: '举报已领取', icon: 'success' })
    }
    catch (error) {
      await this.handleMutationFailure(error, '举报领取失败')
    }
    finally {
      this.setData({ processing: false })
    }
  },

  async closeReport(event: WechatMiniprogram.TouchEvent) {
    const reportId = String(event.currentTarget.dataset.id || '')
    const decision = String(event.currentTarget.dataset.decision || '') as 'RESOLVED' | 'DISMISSED'
    const report = this.data.reports.find(item => item.id === reportId)
    if (!report || report.status !== 'REVIEWING' || !report.claimedByMe
      || !['RESOLVED', 'DISMISSED'].includes(decision) || this.data.processing) {
      return
    }
    const modal = await wx.showModal({
      title: decision === 'RESOLVED' ? '确认违规' : '驳回举报',
      editable: true,
      placeholderText: '填写处理原因',
      confirmText: decision === 'RESOLVED' ? '确认处理' : '确认驳回',
    }).catch(() => null)
    const reason = modal?.content?.trim() || ''
    if (!modal?.confirm) {
      return
    }
    if (!reason || reason.length > 300) {
      this.setData({ message: '请填写不超过 300 字的处理原因。' })
      return
    }
    this.setData({ processing: true, message: '' })
    try {
      await mipAdminModule.events.closeCommentReport({
        eventId: this.data.eventId,
        reportId,
        expectedVersion: report.version,
        decision,
        reason,
      })
      await this.load(true)
      wx.showToast({ title: decision === 'RESOLVED' ? '举报已处理' : '举报已驳回', icon: 'success' })
    }
    catch (error) {
      await this.handleMutationFailure(error, '举报处理失败')
    }
    finally {
      this.setData({ processing: false })
    }
  },

  async handleMutationFailure(error: unknown, fallbackMessage: string) {
    if (isAdminForbiddenError(error)) {
      this.setData({ state: 'forbidden', event: null, settings: null, comments: [], reports: [], message: '' })
      return
    }
    if (isAdminVersionConflict(error)
      || (error instanceof MipAdminError && error.code === 'INVALID_STATE')) {
      this.setData({ state: 'conflict', message: '记录状态已变化，正在刷新。' })
      await this.load(true)
      if (this.data.state === 'ready' || this.data.state === 'empty') {
        this.setData({ message: '状态已刷新，请重新操作。' })
      }
      return
    }
    this.setData({ message: error instanceof Error ? error.message : fallbackMessage })
  },
})
