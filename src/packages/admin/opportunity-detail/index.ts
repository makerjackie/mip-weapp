import type { AdminOpportunityDetail, AdminOpportunityHistoryItem } from '../../../modules/mip-admin'
import { hasCapability, mipAdminModule } from '../../../modules/mip-admin'
import { formatLocalDateTime } from '../../../utils/date'

const actionLabels: Record<string, string> = {
  'admin.opportunities.create': '创建机会',
  'admin.opportunities.update': '更新机会',
  'admin.opportunities.publish': '发布机会',
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
    state: 'loading',
    opportunityId: '',
    item: null as (AdminOpportunityDetail & { statusText: string, deadlineText: string, updatedText: string, roleText: string, tagText: string }) | null,
    history: [] as ReturnType<typeof historyView>[],
    canArchive: false,
    processing: false,
    message: '',
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
        message: '',
      })
    }
    catch (error) {
      this.setData({ state: 'error', message: error instanceof Error ? error.message : '机会加载失败' })
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
