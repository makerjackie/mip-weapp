import type {
  AdminEventAlbumPhoto,
  AdminEventAlbumPhotoStatus,
} from '../../../modules/mip-admin'
import { hasScopedCapability, MipAdminError, mipAdminModule } from '../../../modules/mip-admin'
import { isAdminForbiddenError, isAdminVersionConflict } from '../shared/page-state'

type AlbumAdminState = 'loading' | 'ready' | 'empty' | 'error' | 'forbidden' | 'conflict'
type ReviewDecision = 'APPROVE' | 'REJECT'
type PhotoView = AdminEventAlbumPhoto & { createdText: string, reviewedText: string }

const statusOptions: Array<{ value: AdminEventAlbumPhotoStatus, label: string }> = [
  { value: 'PENDING', label: '待审核' },
  { value: 'PUBLISHED', label: '已发布' },
  { value: 'REJECTED', label: '已拒绝' },
]

function localDateTime(value: string | null) {
  if (!value) {
    return ''
  }
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) {
    return ''
  }
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

function photoView(photo: AdminEventAlbumPhoto): PhotoView {
  return {
    ...photo,
    createdText: localDateTime(photo.createdAt),
    reviewedText: localDateTime(photo.reviewedAt),
  }
}

Page({
  data: {
    state: 'loading' as AlbumAdminState,
    eventId: '',
    eventTitle: '',
    status: 'PENDING' as AdminEventAlbumPhotoStatus,
    statusOptions,
    photos: [] as PhotoView[],
    canManage: false,
    actionPhotoId: '',
    actionVersion: 0,
    decision: '' as ReviewDecision | '',
    reason: '',
    processing: false,
    message: '',
  },

  onLoad(query: Record<string, string>) {
    this.setData({ eventId: query.eventId || '' })
  },

  onShow() {
    void this.loadPhotos()
  },

  async onPullDownRefresh() {
    try {
      await this.loadPhotos(true)
    }
    finally {
      wx.stopPullDownRefresh()
    }
  },

  retryLoad() {
    void this.loadPhotos(true)
  },

  async loadPhotos(force = false) {
    if (!this.data.eventId) {
      this.setData({ state: 'error', message: '活动标识无效。' })
      return
    }
    if (!this.data.photos.length) {
      this.setData({ state: 'loading', message: '' })
    }
    try {
      const [event, session] = await Promise.all([
        mipAdminModule.events.get(this.data.eventId, force),
        mipAdminModule.getSession(force),
      ])
      const canManage = hasScopedCapability(session.capabilities, 'events.album.manage', {
        scopeType: 'EVENT',
        scopeId: event.id,
        branchId: event.branchId,
      })
      if (!canManage) {
        this.setData({ state: 'forbidden', canManage: false, photos: [], message: '' })
        return
      }
      const page = await mipAdminModule.events.listAlbumPhotos(this.data.eventId, this.data.status, force)
      const photos = page.items.map(photoView)
      this.setData({
        state: photos.length ? 'ready' : 'empty',
        eventTitle: event.title,
        canManage: true,
        photos,
        message: '',
      })
    }
    catch (error) {
      if (isAdminForbiddenError(error)) {
        this.setData({ state: 'forbidden', canManage: false, photos: [], message: '' })
        return
      }
      this.setData({
        state: this.data.photos.length ? 'ready' : 'error',
        message: error instanceof Error ? error.message : '相册照片加载失败。',
      })
    }
  },

  chooseStatus(event: WechatMiniprogram.TouchEvent) {
    const status = String(event.currentTarget.dataset.status || '') as AdminEventAlbumPhotoStatus
    if (!statusOptions.some(item => item.value === status)
      || status === this.data.status || this.data.processing) {
      return
    }
    this.cancelReview()
    this.setData({ status, photos: [], state: 'loading', message: '' })
    void this.loadPhotos(true)
  },

  beginReview(event: WechatMiniprogram.TouchEvent) {
    const photoId = String(event.currentTarget.dataset.id || '')
    const decision = String(event.currentTarget.dataset.decision || '') as ReviewDecision
    const photo = this.data.photos.find(item => item.id === photoId)
    if (!photo || photo.status !== 'PENDING'
      || !['APPROVE', 'REJECT'].includes(decision) || this.data.processing) {
      return
    }
    this.setData({
      actionPhotoId: photo.id,
      actionVersion: photo.version,
      decision,
      reason: '',
      message: '',
    })
  },

  updateReason(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    this.setData({ reason: event.detail.value })
  },

  cancelReview() {
    this.setData({ actionPhotoId: '', actionVersion: 0, decision: '', reason: '' })
  },

  async confirmReview() {
    const reason = this.data.reason.trim()
    const decision = this.data.decision
    if (!this.data.canManage || !this.data.actionPhotoId || !decision || this.data.processing) {
      return
    }
    if (!reason || reason.length > 300) {
      this.setData({ message: '请填写不超过 300 字的审核原因。' })
      return
    }
    const approving = decision === 'APPROVE'
    const confirmation = await wx.showModal({
      title: approving ? '批准照片' : '拒绝照片',
      content: approving ? '批准后照片将在活动相册公开显示。' : '拒绝后照片仅提交者可查看审核结果。',
      confirmText: approving ? '确认批准' : '确认拒绝',
    }).catch(() => null)
    if (!confirmation?.confirm) {
      return
    }
    this.setData({ processing: true, message: '' })
    try {
      await mipAdminModule.events.reviewAlbumPhoto({
        eventId: this.data.eventId,
        photoId: this.data.actionPhotoId,
        decision,
        reason,
        expectedVersion: this.data.actionVersion,
      })
      void wx.showToast({ title: approving ? '照片已发布' : '照片已拒绝', icon: 'success' })
        .catch(() => null)
      this.cancelReview()
      await this.loadPhotos(true)
    }
    catch (error) {
      if (isAdminForbiddenError(error)) {
        this.cancelReview()
        this.setData({ state: 'forbidden', canManage: false, photos: [], message: '' })
      }
      else if (isAdminVersionConflict(error)
        || (error instanceof MipAdminError && error.code === 'INVALID_STATE')) {
        this.cancelReview()
        this.setData({ state: 'conflict', photos: [], message: '照片状态已变化，请重新加载后再操作。' })
      }
      else {
        this.setData({ message: error instanceof Error ? error.message : '照片审核失败。' })
      }
    }
    finally {
      this.setData({ processing: false })
    }
  },

  preview(event: WechatMiniprogram.BaseEvent) {
    const current = String(event.currentTarget.dataset.url || '')
    const urls = this.data.photos.map(item => item.imageUrl).filter(Boolean)
    if (current && urls.length) {
      void wx.previewImage({ current, urls }).catch(() => null)
    }
  },
})
