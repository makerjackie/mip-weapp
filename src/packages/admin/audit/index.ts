import type { AdminAuditItem } from '../../../modules/mip-admin'
import type { AdminPageState } from '../shared/page-state'
import { mipAdminModule } from '../../../modules/mip-admin'
import { adminLoadFailure } from '../shared/page-state'

type AuditView = AdminAuditItem & { metadataText: string }

Page({
  data: {
    state: 'loading' as AdminPageState,
    items: [] as AuditView[],
    action: '',
    resourceType: '',
    message: '',
    nextCursor: null as string | null,
    loadingMore: false,
  },
  onShow() { void this.loadAudit() },
  updateAction(event: WechatMiniprogram.CustomEvent<{ value: string }>) { this.setData({ action: event.detail.value }) },
  updateResource(event: WechatMiniprogram.CustomEvent<{ value: string }>) { this.setData({ resourceType: event.detail.value }) },
  search() { void this.loadAudit(true) },
  async loadAudit(force = false) {
    const hasContent = this.data.items.length > 0
    if (!hasContent) {
      this.setData({ state: 'loading', message: '' })
    }
    try {
      const response = await mipAdminModule.listAudit({
        filters: { action: this.data.action.trim(), resourceType: this.data.resourceType.trim() },
      }, force)
      this.setData({
        state: 'ready',
        items: response.items.map(item => ({ ...item, metadataText: JSON.stringify(item.metadata) })),
        nextCursor: response.nextCursor || null,
        loadingMore: false,
        message: '',
      })
    }
    catch (error) {
      this.setData(adminLoadFailure(error, { hasContent, fallbackMessage: '审计记录加载失败' }))
    }
  },
  async loadMoreAudit() {
    if (!this.data.nextCursor || this.data.loadingMore || this.data.state !== 'ready') {
      return
    }
    this.setData({ loadingMore: true, message: '' })
    try {
      const response = await mipAdminModule.listAudit({
        cursor: this.data.nextCursor,
        filters: { action: this.data.action.trim(), resourceType: this.data.resourceType.trim() },
      })
      this.setData({
        items: this.data.items.concat(response.items.map(item => ({ ...item, metadataText: JSON.stringify(item.metadata) }))),
        nextCursor: response.nextCursor || null,
      })
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '更多审计记录加载失败' })
    }
    finally {
      this.setData({ loadingMore: false })
    }
  },
  onReachBottom() { void this.loadMoreAudit() },
  async onPullDownRefresh() {
    try {
      await this.loadAudit(true)
    }
    finally {
      wx.stopPullDownRefresh()
    }
  },
})
