import type { EventId } from '../../../modules/mip'
import type { EventAlbumPhoto } from '../../../modules/mip-events'
import type { AlbumPageCursor } from './cursor-state'
import { MipEventsError } from '../../../modules/mip-events'
import { mipEventsModule } from '../../../modules/mip-events/client'
import { mipMediaModule } from '../../../modules/mip-media/client'
import { chooseSingleImage } from '../../../platform/wechat/image-upload'
import { albumPageCursor, albumRequestCursor } from './cursor-state'

type AlbumState = 'loading' | 'ready' | 'empty' | 'disabled' | 'error'

function isCancelled(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || '')
  return /cancel/i.test(message)
}

function mergeItems(published: EventAlbumPhoto[], mine: EventAlbumPhoto[]) {
  const byId = new Map(published.map(item => [item.id, item]))
  for (const item of mine) {
    byId.set(item.id, { ...byId.get(item.id), ...item, mine: true })
  }
  return [...byId.values()].sort((left, right) =>
    Date.parse(right.createdAt) - Date.parse(left.createdAt) || right.id.localeCompare(left.id))
}

async function askCaption() {
  const result = await wx.showModal({
    title: '照片说明',
    content: '',
    editable: true,
    placeholderText: '选填，最多 300 个字',
    confirmText: '提交',
  })
  if (!result.confirm) {
    return null
  }
  return String(result.content || '').trim().slice(0, 300)
}

Page({
  data: {
    state: 'loading' as AlbumState,
    eventId: '',
    items: [] as EventAlbumPhoto[],
    publicItems: [] as EventAlbumPhoto[],
    myItems: [] as EventAlbumPhoto[],
    cursor: null as AlbumPageCursor,
    canSubmit: false,
    loadingMore: false,
    uploading: false,
    withdrawingId: '',
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

  async load(reset = true) {
    if (!this.data.eventId) {
      this.setData({ state: 'error', message: '活动标识无效。' })
      return
    }
    if (reset) {
      this.setData({ state: 'loading', message: '' })
    }
    else {
      this.setData({ loadingMore: true, message: '' })
    }
    try {
      const publicPage = await mipEventsModule.listEventAlbum(
        this.data.eventId as EventId,
        albumRequestCursor(reset, this.data.cursor),
      )
      const publicItems = reset
        ? publicPage.items
        : [...this.data.publicItems, ...publicPage.items]
      let myItems = this.data.myItems
      let canSubmit = this.data.canSubmit
      let privateMessage = ''
      if (reset) {
        try {
          const mine = await mipEventsModule.listMyEventAlbumSubmissions(this.data.eventId as EventId)
          myItems = mine.items
          canSubmit = mine.canSubmit
        }
        catch (error) {
          privateMessage = error instanceof MipEventsError && error.code === 'AUTH_REQUIRED'
            ? ''
            : (error instanceof Error ? error.message : '个人提交状态加载失败。')
          myItems = []
          canSubmit = false
        }
      }
      const items = mergeItems(publicItems, myItems)
      this.setData({
        state: !publicPage.albumEnabled ? 'disabled' : (items.length ? 'ready' : 'empty'),
        publicItems,
        myItems,
        items,
        cursor: albumPageCursor(publicPage.nextCursor),
        canSubmit: publicPage.albumEnabled && canSubmit,
        message: privateMessage,
      })
    }
    catch (error) {
      const message = error instanceof Error ? error.message : '相册加载失败。'
      this.setData(this.data.items.length
        ? { state: 'ready', message }
        : { state: 'error', message })
    }
    finally {
      this.setData({ loadingMore: false })
    }
  },

  async upload() {
    if (!this.data.canSubmit || this.data.uploading) {
      return
    }
    this.setData({ uploading: true, message: '' })
    try {
      const sourcePath = await chooseSingleImage()
      const caption = await askCaption()
      if (caption === null) {
        return
      }
      const asset = await mipMediaModule.uploadImageFromPath('EVENT_ALBUM', sourcePath)
      const result = await mipEventsModule.submitEventAlbumPhoto(
        this.data.eventId as EventId,
        asset.assetId,
        caption,
      )
      await wx.showToast({
        title: result.status === 'PUBLISHED' ? '照片已发布' : '照片已提交',
        icon: 'success',
      })
      await this.load(true)
    }
    catch (error) {
      if (!isCancelled(error)) {
        this.setData({ message: error instanceof Error ? error.message : '照片提交失败。' })
      }
    }
    finally {
      this.setData({ uploading: false })
    }
  },

  preview(event: WechatMiniprogram.BaseEvent) {
    const current = String(event.currentTarget.dataset.url || '')
    const urls = this.data.items.map(item => item.imageUrl).filter(Boolean)
    if (current && urls.length) {
      void wx.previewImage({ current, urls }).catch(() => null)
    }
  },

  async withdraw(event: WechatMiniprogram.BaseEvent) {
    const photoId = String(event.currentTarget.dataset.photoId || '')
    const version = Number(event.currentTarget.dataset.version)
    if (!photoId || this.data.withdrawingId) {
      return
    }
    const confirmation = await wx.showModal({
      title: '撤回照片',
      content: '撤回后照片不再显示，确认继续吗？',
      confirmText: '撤回',
      confirmColor: '#B84A43',
    }).catch(() => null)
    if (!confirmation?.confirm) {
      return
    }
    this.setData({ withdrawingId: photoId, message: '' })
    try {
      await mipEventsModule.withdrawEventAlbumPhoto(photoId, version)
      await this.load(true)
      await wx.showToast({ title: '照片已撤回', icon: 'success' })
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '照片撤回失败。' })
    }
    finally {
      this.setData({ withdrawingId: '' })
    }
  },
})
