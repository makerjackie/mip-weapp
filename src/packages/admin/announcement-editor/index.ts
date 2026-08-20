import { adminModule } from '../../../modules/admin/client'

Page({
  data: {
    state: 'ready' as 'loading' | 'ready' | 'error',
    announcementId: '',
    title: '',
    summary: '',
    body: '',
    version: 0,
    saving: false,
    message: '',
  },

  onLoad(query: Record<string, string>) {
    const announcementId = query.announcementId || ''
    this.setData({ announcementId })
    if (announcementId) {
      void this.loadItem()
    }
  },

  async loadItem() {
    this.setData({ state: 'loading', message: '' })
    try {
      const item = await adminModule.getAnnouncement(this.data.announcementId)
      this.setData({
        state: 'ready',
        title: item.title,
        summary: item.summary,
        body: item.body,
        version: item.version,
      })
    }
    catch (error) {
      this.setData({ state: 'error', message: error instanceof Error ? error.message : '公告加载失败' })
    }
  },

  updateTitle(event: WechatMiniprogram.Input) {
    this.setData({ title: event.detail.value })
  },
  updateSummary(event: WechatMiniprogram.Input) {
    this.setData({ summary: event.detail.value })
  },
  updateBody(event: WechatMiniprogram.Input) {
    this.setData({ body: event.detail.value })
  },

  async save() {
    if (this.data.saving) {
      return
    }
    this.setData({ saving: true, message: '' })
    try {
      const saved = await adminModule.saveAnnouncement({
        ...(this.data.announcementId
          ? { id: this.data.announcementId, version: this.data.version }
          : {}),
        title: this.data.title,
        summary: this.data.summary,
        body: this.data.body,
      })
      this.setData({ announcementId: saved.id, version: saved.version })
      wx.showToast({ title: '草稿已保存', icon: 'success' })
      setTimeout(() => wx.navigateBack(), 500)
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '保存失败' })
    }
    finally {
      this.setData({ saving: false })
    }
  },
})
