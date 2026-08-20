import type { AdminAnnouncement, AdminAnnouncementStatus } from '../../../modules/admin/types'
import { adminModule } from '../../../modules/admin/client'
import { caseNavigateTo } from '../../../modules/platform/case-navigation'
import { formatLocalMonthDayTime } from '../../../utils/date'
import { adminLoadFailure } from '../shared/page-state'

interface AnnouncementView extends AdminAnnouncement {
  statusText: string
  updatedText: string
}

const statusLabels: Record<AdminAnnouncementStatus, string> = {
  DRAFT: '草稿',
  PUBLISHED: '已发布',
  WITHDRAWN: '已撤回',
}

Page({
  data: {
    state: 'loading' as 'loading' | 'ready' | 'error' | 'forbidden',
    status: '' as '' | AdminAnnouncementStatus,
    items: [] as AnnouncementView[],
    processingId: '',
    message: '',
  },

  onShow() {
    void this.loadItems(true)
  },

  changeStatus(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    this.setData({ status: event.detail.value as '' | AdminAnnouncementStatus })
    void this.loadItems()
  },

  async loadItems(force = false) {
    const cached = adminModule.peekAnnouncements(this.data.status || undefined)
    if (cached) {
      this.applyItems(cached)
    }
    else if (this.data.state !== 'ready') {
      this.setData({ state: 'loading', message: '' })
    }
    try {
      this.applyItems(await adminModule.listAnnouncements(
        this.data.status || undefined,
        '',
        { force },
      ))
    }
    catch (error) {
      this.setData(adminLoadFailure(error, {
        hasContent: Boolean(cached) || this.data.items.length > 0,
        fallbackMessage: '公告列表加载失败',
      }))
    }
  },

  applyItems(items: AdminAnnouncement[]) {
    this.setData({
      state: 'ready',
      items: items.map(item => ({
        ...item,
        statusText: statusLabels[item.status],
        updatedText: item.updatedAt ? formatLocalMonthDayTime(item.updatedAt) : '',
      })),
      message: '',
    })
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
    const index = Number(event.currentTarget.dataset.index)
    const transition = String(event.currentTarget.dataset.transition || '') as 'PUBLISH' | 'WITHDRAW' | 'PIN' | 'UNPIN'
    const item = this.data.items[index]
    if (!item || this.data.processingId) {
      return
    }
    const copy = {
      PUBLISH: ['发布公告', '发布后所有用户都能看到。'],
      WITHDRAW: ['撤回公告', '撤回后用户端将立即不可见。'],
      PIN: ['置顶公告', '置顶后会替换当前置顶公告。'],
      UNPIN: ['取消置顶', '公告仍会保持发布状态。'],
    }[transition]
    const confirmed = await wx.showModal({
      title: copy[0],
      content: copy[1],
      confirmText: transition === 'WITHDRAW' ? '撤回' : '确认',
      confirmColor: transition === 'WITHDRAW' ? '#B8453E' : '#235B43',
    }).catch(() => null)
    if (!confirmed?.confirm) {
      return
    }
    this.setData({ processingId: item.id, message: '' })
    try {
      await adminModule.setAnnouncementState(item.id, transition, item.version)
      await this.loadItems(true)
      wx.showToast({ title: '操作成功', icon: 'success' })
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '操作失败' })
    }
    finally {
      this.setData({ processingId: '' })
    }
  },

  async onPullDownRefresh() {
    try {
      await this.loadItems(true)
    }
    finally {
      wx.stopPullDownRefresh()
    }
  },
})
