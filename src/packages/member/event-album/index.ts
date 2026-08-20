import type { EventAlbumPhoto } from '../../../modules/membership/types'
import { membershipModule } from '../../../modules/membership/client'
import {
  chooseSingleImage,
  compressImageToBase64,
  IMAGE_UPLOAD_POLICIES,
} from '../../../modules/platform/image-upload'

async function askCaption() {
  const result = await wx.showModal({
    title: '添加照片说明',
    content: '',
    editable: true,
    placeholderText: '可选：记录这一刻',
    confirmText: '继续上传',
  })
  if (!result.confirm) {
    return null
  }
  return String(result.content || '').trim().slice(0, 120)
}

Page({
  data: {
    state: 'loading' as 'loading' | 'ready' | 'error',
    eventId: '',
    items: [] as EventAlbumPhoto[],
    cursor: null as string | null,
    loadingMore: false,
    uploading: false,
    message: '',
  },

  onLoad(query: Record<string, string>) {
    this.setData({ eventId: query.eventId || '' })
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

  onReachBottom() {
    if (this.data.cursor && !this.data.loadingMore) {
      void this.load(false)
    }
  },

  async load(reset: boolean) {
    if (reset && this.data.state !== 'ready') {
      this.setData({ state: 'loading', message: '' })
    }
    if (!reset) {
      this.setData({ loadingMore: true })
    }
    try {
      const page = await membershipModule.listEventAlbum(
        this.data.eventId,
        reset ? undefined : this.data.cursor || undefined,
      )
      this.setData({
        state: 'ready',
        items: reset ? page.items : [...this.data.items, ...page.items],
        cursor: page.nextCursor,
        message: '',
      })
    }
    catch (error) {
      this.setData(this.data.items.length
        ? { message: error instanceof Error ? error.message : '相册加载失败' }
        : { state: 'error', message: error instanceof Error ? error.message : '相册加载失败' })
    }
    finally {
      this.setData({ loadingMore: false })
    }
  },

  async upload() {
    if (this.data.uploading) {
      return
    }
    this.setData({ uploading: true, message: '' })
    try {
      const selected = await chooseSingleImage()
      const caption = await askCaption()
      if (caption === null) {
        return
      }
      const base64 = await compressImageToBase64(selected, IMAGE_UPLOAD_POLICIES.eventAlbum)
      const result = await membershipModule.uploadEventPhoto(this.data.eventId, base64, caption)
      wx.showToast({
        title: result.status === 'PUBLISHED' ? '已发布' : '已提交审核',
        icon: 'success',
      })
      await this.load(true)
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '照片上传失败' })
    }
    finally {
      this.setData({ uploading: false })
    }
  },

  preview(event: WechatMiniprogram.BaseEvent) {
    const current = String(event.currentTarget.dataset.url || '')
    const urls = this.data.items.map(item => item.imageUrl).filter(Boolean)
    if (current && urls.length) {
      wx.previewImage({ current, urls })
    }
  },

  async remove(event: WechatMiniprogram.BaseEvent) {
    const photoId = String(event.currentTarget.dataset.photoId || '')
    const result = await wx.showModal({
      title: '删除照片',
      content: '删除后无法恢复，确认继续吗？',
      confirmText: '删除',
      confirmColor: '#B84A43',
    })
    if (!result.confirm) {
      return
    }
    try {
      await membershipModule.deleteEventPhoto(photoId)
      this.setData({ items: this.data.items.filter(item => item.id !== photoId) })
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '删除失败' })
    }
  },
})
