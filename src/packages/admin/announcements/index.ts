import type { AdminAnnouncement, AdminAnnouncementStatus } from '../../../modules/mip-admin/announcements'
import type { AdminPageState } from '../shared/page-state'
import { hasCapability, mipAdminModule } from '../../../modules/mip-admin'
import { caseNavigateTo } from '../../../modules/platform/case-navigation'
import { formatLocalDateTime } from '../../../utils/date'
import { adminLoadFailure, isAdminVersionConflict } from '../shared/page-state'

type AnnouncementPageState = AdminPageState | 'empty'
type AnnouncementView = AdminAnnouncement & {
  scopeText: string
  statusText: string
  safetyText: string
  updatedText: string
}

const statusLabels: Record<AdminAnnouncementStatus, string> = {
  DRAFT: '草稿',
  PUBLISHED: '已发布',
  WITHDRAWN: '已撤回',
}

const safetyLabels = {
  PENDING: '待检查',
  PASSED: '已通过',
  REJECTED: '未通过',
  ERROR: '检查失败',
}

function view(item: AdminAnnouncement): AnnouncementView {
  return {
    ...item,
    scopeText: item.scopeType === 'PLATFORM' ? '全平台' : item.branchName,
    statusText: statusLabels[item.status],
    safetyText: safetyLabels[item.contentSafetyStatus],
    updatedText: formatLocalDateTime(item.updatedAt),
  }
}

Page({
  data: {
    state: 'loading' as AnnouncementPageState,
    status: '' as AdminAnnouncementStatus | '',
    items: [] as AnnouncementView[],
    processingId: '',
    message: '',
  },

  onShow() {
    void this.loadItems()
  },

  async onPullDownRefresh() {
    try {
      await this.loadItems(true)
    }
    finally {
      wx.stopPullDownRefresh()
    }
  },

  retryLoad() {
    void this.loadItems(true)
  },

  chooseStatus(event: WechatMiniprogram.TouchEvent) {
    const status = String(event.currentTarget.dataset.status || '') as AdminAnnouncementStatus | ''
    if (status === this.data.status || !['', 'DRAFT', 'PUBLISHED', 'WITHDRAWN'].includes(status)) {
      return
    }
    this.setData({ status, items: [], state: 'loading', message: '' })
    void this.loadItems(true)
  },

  async loadItems(force = false) {
    const hasContent = this.data.items.length > 0
    if (!hasContent) {
      this.setData({ state: 'loading', message: '' })
    }
    try {
      const session = await mipAdminModule.getSession(force)
      if (!hasCapability(session.capabilities, 'announcements.manage')) {
        this.setData({ state: 'forbidden', items: [], message: '' })
        return
      }
      const response = await mipAdminModule.listAnnouncements({ status: this.data.status, limit: 50 }, force)
      this.setData({
        state: response.items.length ? 'ready' : 'empty',
        items: response.items.map(view),
        message: '',
      })
    }
    catch (error) {
      this.setData(adminLoadFailure(error, { hasContent, fallbackMessage: '公告列表加载失败' }))
    }
  },

  createItem() {
    caseNavigateTo({ url: '/packages/admin/announcement-editor/index' })
  },

  editItem(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id || '')
    if (id) {
      caseNavigateTo({
        url: `/packages/admin/announcement-editor/index?announcementId=${encodeURIComponent(id)}`,
      })
    }
  },

  async transition(event: WechatMiniprogram.TouchEvent) {
    const item = this.data.items.find(candidate => candidate.id === String(event.currentTarget.dataset.id || ''))
    const transition = String(event.currentTarget.dataset.transition || '') as 'PUBLISH' | 'WITHDRAW' | 'PIN' | 'UNPIN'
    if (!item || this.data.processingId || !['PUBLISH', 'WITHDRAW', 'PIN', 'UNPIN'].includes(transition)) {
      return
    }
    const confirmation = await this.confirmTransition(item, transition)
    if (!confirmation.confirmed) {
      return
    }
    this.setData({ processingId: item.id, message: '' })
    try {
      await mipAdminModule.mutate(() => transition === 'PUBLISH'
        ? mipAdminModule.gateway.publishAnnouncement(item.id, item.version)
        : transition === 'WITHDRAW'
          ? mipAdminModule.gateway.withdrawAnnouncement(item.id, item.version, confirmation.reason)
          : mipAdminModule.gateway.setAnnouncementPinned(item.id, transition === 'PIN', item.version))
      wx.showToast({ title: '公告状态已更新', icon: 'success' })
      await this.loadItems(true)
    }
    catch (error) {
      if (isAdminVersionConflict(error)) {
        this.setData({ state: 'conflict', message: '公告状态已更新，请重新加载后再操作。' })
      }
      else {
        this.setData({ message: error instanceof Error ? error.message : '公告状态更新失败' })
      }
    }
    finally {
      this.setData({ processingId: '' })
    }
  },

  async confirmTransition(
    item: AnnouncementView,
    transition: 'PUBLISH' | 'WITHDRAW' | 'PIN' | 'UNPIN',
  ) {
    if (transition === 'WITHDRAW') {
      const result = await wx.showModal({
        title: '撤回公告',
        content: `填写撤回“${item.title}”的原因。`,
        editable: true,
        placeholderText: '撤回原因',
        confirmText: '撤回',
        confirmColor: '#E65C5C',
      }).catch(() => null)
      return {
        confirmed: result?.confirm === true && Boolean(result.content?.trim()),
        reason: result?.content?.trim() || '',
      }
    }
    const copy = transition === 'PUBLISH'
      ? { title: '发布公告', content: '发布后，展示范围内的用户可以查看公告。' }
      : transition === 'PIN'
        ? { title: '置顶公告', content: '同一范围内原有的置顶公告会自动取消置顶。' }
        : { title: '取消置顶', content: '公告仍保持已发布状态。' }
    const result = await wx.showModal({ ...copy, confirmText: '确认' }).catch(() => null)
    return { confirmed: result?.confirm === true, reason: '' }
  },
})
