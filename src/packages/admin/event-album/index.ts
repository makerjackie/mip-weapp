import type { AdminEventPhoto } from '../../../modules/admin/types'
import type { AdminPageState } from '../shared/page-state'
import { adminModule } from '../../../modules/admin/client'
import { formatLocalDateTime } from '../../../utils/date'
import { adminLoadFailure } from '../shared/page-state'

Page({
  data: {
    state: 'loading' as AdminPageState,
    eventId: '',
    eventTitle: '',
    startsText: '',
    items: [] as AdminEventPhoto[],
    processingId: '',
    message: '',
  },

  onLoad(query: Record<string, string>) {
    this.setData({
      eventId: query.eventId || '',
      eventTitle: query.title ? decodeURIComponent(query.title) : '',
      startsText: query.startsAt ? formatLocalDateTime(decodeURIComponent(query.startsAt)) : '',
    })
    void this.load(true)
  },

  async onPullDownRefresh() {
    try {
      await this.load(true)
    }
    finally {
      wx.stopPullDownRefresh()
    }
  },

  async load(force = false) {
    if (this.data.state !== 'ready') {
      this.setData({ state: 'loading', message: '' })
    }
    try {
      const [items, managedEvents] = await Promise.all([
        adminModule.listPendingEventPhotos(this.data.eventId, { force }),
        adminModule.listManagedEvents({ force }),
      ])
      const currentEvent = managedEvents.find(item => item.id === this.data.eventId)
      this.setData({
        state: 'ready',
        eventTitle: currentEvent?.title || this.data.eventTitle,
        startsText: currentEvent?.startsAt
          ? formatLocalDateTime(currentEvent.startsAt)
          : this.data.startsText,
        items,
        message: '',
      })
    }
    catch (error) {
      this.setData(adminLoadFailure(error, {
        hasContent: this.data.items.length > 0,
        fallbackMessage: '照片加载失败',
      }))
    }
  },

  preview(event: WechatMiniprogram.BaseEvent) {
    const current = String(event.currentTarget.dataset.url || '')
    const urls = this.data.items.map(item => item.imageUrl)
    if (current) {
      wx.previewImage({ current, urls })
    }
  },

  async review(event: WechatMiniprogram.BaseEvent) {
    const photoId = String(event.currentTarget.dataset.photoId || '')
    const decision = String(event.currentTarget.dataset.decision || '') as 'approve' | 'reject'
    const item = this.data.items.find(photo => photo.id === photoId)
    if (!item || !['approve', 'reject'].includes(decision) || this.data.processingId) {
      return
    }
    this.setData({ processingId: photoId, message: '' })
    try {
      await adminModule.reviewEventPhoto(
        this.data.eventId,
        photoId,
        decision,
        item.version,
        decision === 'reject' ? '不适合公开展示' : '',
      )
      this.setData({ items: this.data.items.filter(photo => photo.id !== photoId) })
      wx.showToast({ title: decision === 'approve' ? '已发布' : '已拒绝', icon: 'success' })
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '审核失败' })
    }
    finally {
      this.setData({ processingId: '' })
    }
  },
})
