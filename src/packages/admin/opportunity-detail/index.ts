import type {
  AdminOpportunityComment,
  AdminOpportunityCommentReport,
  AdminOpportunityCommentSettings,
  AdminOpportunityDetail,
  AdminOpportunityHistoryItem,
} from '../../../modules/mip-admin'
import type { AdminPageState } from '../shared/page-state'
import { hasCapability, hasScopedCapability, mipAdminModule } from '../../../modules/mip-admin'
import { formatLocalDateTime } from '../../../utils/date'
import { adminLoadFailure } from '../shared/page-state'

const actionLabels: Record<string, string> = {
  'admin.opportunities.create': '创建机会',
  'admin.opportunities.update': '更新机会',
  'admin.opportunities.publish': '发布机会',
  'admin.opportunities.end': '结束机会',
  'admin.opportunities.unpublish': '下架机会',
  'admin.opportunities.archive': '归档机会',
}

const statusLabels: Record<AdminOpportunityDetail['status'], string> = {
  DRAFT: '草稿',
  PUBLISHED: '招募中',
  ENDED: '已结束',
  UNPUBLISHED: '已下架',
  ARCHIVED: '已归档',
}

function historyView(item: AdminOpportunityHistoryItem) {
  return { ...item, actionText: actionLabels[item.action] || '更新机会', createdText: item.createdAt ? formatLocalDateTime(item.createdAt) : '' }
}

Page({
  data: {
    state: 'loading' as AdminPageState,
    opportunityId: '',
    item: null as (AdminOpportunityDetail & { statusText: string, deadlineText: string, updatedText: string, roleText: string, tagText: string }) | null,
    history: [] as ReturnType<typeof historyView>[],
    canArchive: false,
    processing: false,
    message: '',
    canManageComments: false,
    commentSettings: null as AdminOpportunityCommentSettings | null,
    comments: [] as Array<AdminOpportunityComment & { createdText: string, statusText: string }>,
    commentReports: [] as Array<AdminOpportunityCommentReport & { createdText: string, categoryText: string }>,
  },
  onLoad(query: Record<string, string | undefined>) {
    this.setData({ opportunityId: String(query.id || '') })
  },
  onShow() {
    if (this.data.opportunityId) {
      void this.load()
    }
  },
  async load() {
    try {
      const [item, session] = await Promise.all([
        mipAdminModule.getOpportunity(this.data.opportunityId, true),
        mipAdminModule.getSession(),
      ])
      const canManageComments = hasScopedCapability(session.capabilities, 'messages.manage', {
        scopeType: item.branchId ? 'BRANCH' : 'PLATFORM',
        scopeId: item.branchId || null,
      })
      const commentState = canManageComments
        ? await mipAdminModule.getOpportunityCommentAdminState(this.data.opportunityId, true)
        : null
      this.setData({
        state: 'ready',
        item: {
          ...item,
          statusText: statusLabels[item.status],
          deadlineText: item.deadlineAt ? formatLocalDateTime(item.deadlineAt) : '未设置',
          updatedText: item.updatedAt ? formatLocalDateTime(item.updatedAt) : '未记录',
          roleText: item.roleKeys.length ? `${item.roleKeys.length} 项` : '未设置',
          tagText: item.tags.join('、') || '未设置',
        },
        history: item.history.map(historyView),
        canArchive: hasCapability(session.capabilities, 'opportunities.archive'),
        canManageComments,
        commentSettings: commentState?.settings || null,
        comments: (commentState?.comments || []).map(comment => ({
          ...comment,
          createdText: comment.createdAt ? formatLocalDateTime(comment.createdAt) : '未记录',
          statusText: comment.status === 'PENDING' ? '待审核' : comment.status === 'HIDDEN' ? '已隐藏' : '已发布',
        })),
        commentReports: (commentState?.reports || []).map(report => ({
          ...report,
          createdText: report.createdAt ? formatLocalDateTime(report.createdAt) : '未记录',
          categoryText: ({
            SPAM: '垃圾信息',
            HARASSMENT: '骚扰行为',
            FRAUD: '欺诈风险',
            INAPPROPRIATE_CONTENT: '不当内容',
            IMPERSONATION: '冒充他人',
            OTHER: '其他问题',
          } as Record<string, string>)[report.category] || '其他问题',
        })),
        message: '',
      })
    }
    catch (error) {
      this.setData(adminLoadFailure(error, {
        hasContent: Boolean(this.data.item),
        fallbackMessage: '机会加载失败',
      }))
    }
  },
  updateCommentSetting(event: WechatMiniprogram.CustomEvent<{ value: boolean }>) {
    const field = String(event.currentTarget.dataset.field || '')
    if (!['commentsEnabled', 'reviewsEnabled', 'callsEnabled'].includes(field)) {
      return
    }
    this.setData({ [`commentSettings.${field}`]: Boolean(event.detail.value) })
  },
  updateModerationMode(event: WechatMiniprogram.CustomEvent<{ value: boolean }>) {
    this.setData({ 'commentSettings.moderationMode': event.detail.value ? 'REVIEW' : 'AUTO' })
  },
  async saveCommentSettings() {
    const settings = this.data.commentSettings
    if (!settings || this.data.processing) {
      return
    }
    this.setData({ processing: true, message: '' })
    try {
      await mipAdminModule.mutate(() => mipAdminModule.gateway.saveOpportunityCommentSettings({
        opportunityId: this.data.opportunityId,
        expectedVersion: settings.version,
        settings: {
          commentsEnabled: settings.commentsEnabled,
          reviewsEnabled: settings.reviewsEnabled,
          callsEnabled: settings.callsEnabled,
          moderationMode: settings.moderationMode,
        },
      }))
      await this.load()
      wx.showToast({ title: '评论设置已保存', icon: 'success' })
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '评论设置保存失败' })
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
    })
    if (!modal.confirm || !modal.content.trim()) {
      return
    }
    this.setData({ processing: true, message: '' })
    try {
      await mipAdminModule.mutate(() => mipAdminModule.gateway.moderateOpportunityComment({
        opportunityId: this.data.opportunityId,
        commentId,
        expectedVersion: comment.version,
        action,
        reason: modal.content,
      }))
      await this.load()
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '评论审核失败' })
    }
    finally {
      this.setData({ processing: false })
    }
  },
  async closeCommentReport(event: WechatMiniprogram.TouchEvent) {
    const reportId = String(event.currentTarget.dataset.id || '')
    const decision = String(event.currentTarget.dataset.decision || '') as 'RESOLVED' | 'DISMISSED'
    const report = this.data.commentReports.find(item => item.id === reportId)
    if (!report || !['RESOLVED', 'DISMISSED'].includes(decision) || this.data.processing) {
      return
    }
    const modal = await wx.showModal({
      title: decision === 'RESOLVED' ? '确认违规' : '驳回举报',
      editable: true,
      placeholderText: '填写处理原因',
    })
    if (!modal.confirm || !modal.content.trim()) {
      return
    }
    this.setData({ processing: true, message: '' })
    try {
      await mipAdminModule.mutate(() => mipAdminModule.gateway.closeOpportunityCommentReport({
        opportunityId: this.data.opportunityId,
        reportId,
        expectedVersion: report.version,
        decision,
        reason: modal.content,
      }))
      await this.load()
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '举报处理失败' })
    }
    finally {
      this.setData({ processing: false })
    }
  },
  edit() {
    void wx.navigateTo({ url: `/packages/admin/opportunity-editor/index?id=${this.data.opportunityId}` })
  },
  async publish() {
    if (!this.data.item || this.data.processing) {
      return
    }
    this.setData({ processing: true, message: '' })
    try {
      await mipAdminModule.mutate(() => mipAdminModule.gateway.publishOpportunity({ opportunityId: this.data.item!.id, expectedVersion: this.data.item!.version }))
      wx.showToast({ title: '机会已发布', icon: 'success' })
      await this.load()
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '机会发布失败' })
    }
    finally {
      this.setData({ processing: false })
    }
  },
  async end() {
    if (!this.data.item || this.data.processing) {
      return
    }
    const modal = await wx.showModal({ title: '结束机会', content: '结束后，用户端将不再显示为招募中。' })
    if (!modal.confirm) {
      return
    }
    this.setData({ processing: true, message: '' })
    try {
      await mipAdminModule.mutate(() => mipAdminModule.gateway.endOpportunity({
        opportunityId: this.data.item!.id,
        expectedVersion: this.data.item!.version,
      }))
      wx.showToast({ title: '机会已结束', icon: 'success' })
      await this.load()
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '机会结束失败' })
    }
    finally {
      this.setData({ processing: false })
    }
  },
  async unpublish() {
    if (!this.data.item || this.data.processing) {
      return
    }
    const modal = await wx.showModal({ title: '下架机会', editable: true, placeholderText: '填写下架原因' })
    if (!modal.confirm || !modal.content.trim()) {
      return
    }
    this.setData({ processing: true, message: '' })
    try {
      await mipAdminModule.mutate(() => mipAdminModule.gateway.unpublishOpportunity({ opportunityId: this.data.item!.id, expectedVersion: this.data.item!.version, reason: modal.content }))
      await this.load()
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '机会下架失败' })
    }
    finally {
      this.setData({ processing: false })
    }
  },
  async archive() {
    if (!this.data.item || this.data.processing || !this.data.canArchive) {
      return
    }
    const modal = await wx.showModal({ title: '归档机会', editable: true, placeholderText: '填写归档原因' })
    if (!modal.confirm || !modal.content.trim()) {
      return
    }
    this.setData({ processing: true, message: '' })
    try {
      await mipAdminModule.mutate(() => mipAdminModule.gateway.archiveOpportunity({ opportunityId: this.data.item!.id, expectedVersion: this.data.item!.version, reason: modal.content }))
      await this.load()
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '机会归档失败' })
    }
    finally {
      this.setData({ processing: false })
    }
  },
})
