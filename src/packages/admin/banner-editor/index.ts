import type { MipBannerDraft, MipBannerTargetType } from '../../../modules/mip-banners'
import { MipBannerError, mipBannerModule } from '../../../modules/mip-banners'
import { leaveSecondaryPage } from '../../../modules/platform/case-navigation'
import { chooseSingleImage } from '../../../modules/platform/image-upload'

type PageState = 'loading' | 'ready' | 'error' | 'forbidden' | 'conflict'

function initialDraft(): MipBannerDraft {
  return {
    title: '',
    accessibilityLabel: '',
    imageAssetId: '',
    targetType: 'MINIPROGRAM_PATH',
    targetValue: '/pages/events/index',
  }
}

function chooseWasCancelled(error: unknown) {
  return error instanceof Error && /cancel/i.test(error.message)
}

Page({
  data: {
    state: 'loading' as PageState,
    bannerId: '',
    version: 0,
    status: 'INACTIVE',
    draft: initialDraft(),
    imageUrl: '',
    imageWidth: 0,
    imageHeight: 0,
    uploading: false,
    saving: false,
    message: '',
  },

  onLoad(query: Record<string, string>) {
    this.setData({ bannerId: query.bannerId || '' })
    void this.load(true)
  },

  retryLoad() {
    void this.load(true)
  },

  async load(force = false) {
    this.setData({ state: 'loading', message: '' })
    try {
      const [, banner] = await Promise.all([
        mipBannerModule.query.getAdminSession(force),
        this.data.bannerId ? mipBannerModule.query.getAdmin(this.data.bannerId, force) : Promise.resolve(null),
      ])
      if (!banner) {
        this.setData({ state: 'ready', draft: initialDraft(), message: '' })
        return
      }
      this.setData({
        state: 'ready',
        version: banner.version,
        status: banner.status,
        draft: {
          title: banner.title,
          accessibilityLabel: banner.accessibilityLabel,
          imageAssetId: banner.imageAssetId,
          targetType: banner.targetType,
          targetValue: banner.targetValue,
        },
        imageUrl: banner.imageUrl,
        imageWidth: banner.imageWidth,
        imageHeight: banner.imageHeight,
        message: '',
      })
    }
    catch (error) {
      const forbidden = error instanceof MipBannerError && error.code === 'FORBIDDEN'
      this.setData({
        state: forbidden ? 'forbidden' : 'error',
        message: error instanceof Error ? error.message : 'Banner 信息加载失败',
      })
    }
  },

  updateField(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    const field = String(event.currentTarget.dataset.field || '')
    if (['title', 'accessibilityLabel', 'targetValue'].includes(field)) {
      this.setData({ [`draft.${field}`]: event.detail.value })
    }
  },

  chooseTargetType(event: WechatMiniprogram.TouchEvent) {
    const raw = String(event.currentTarget.dataset.type || '')
    if (raw === 'MINIPROGRAM_PATH' || raw === 'ARTICLE_URL') {
      const targetType = raw as MipBannerTargetType
      this.setData({
        'draft.targetType': targetType,
        'draft.targetValue': targetType === 'MINIPROGRAM_PATH' ? '/pages/events/index' : '',
        'message': '',
      })
    }
  },

  async chooseImage() {
    if (this.data.uploading) {
      return
    }
    this.setData({ uploading: true, message: '' })
    try {
      const sourcePath = await chooseSingleImage()
      const asset = await mipBannerModule.uploadBannerImageFromPath(sourcePath)
      this.setData({
        'draft.imageAssetId': asset.assetId,
        'imageUrl': asset.imageUrl,
        'imageWidth': asset.width,
        'imageHeight': asset.height,
      })
    }
    catch (error) {
      if (!chooseWasCancelled(error)) {
        this.setData({ message: error instanceof Error ? error.message : 'Banner 图片上传失败' })
      }
    }
    finally {
      this.setData({ uploading: false })
    }
  },

  async save() {
    if (this.data.saving || this.data.uploading) {
      return
    }
    if (!this.data.draft.imageAssetId) {
      this.setData({ message: '请上传 Banner 图片。' })
      return
    }
    this.setData({ saving: true, message: '' })
    try {
      await mipBannerModule.mutation.saveAdmin({
        ...(this.data.bannerId
          ? { bannerId: this.data.bannerId, expectedVersion: this.data.version }
          : {}),
        banner: this.data.draft,
      })
      wx.showToast({ title: 'Banner 已保存', icon: 'success' })
      setTimeout(leaveSecondaryPage, 500, '/packages/admin/banners/index')
    }
    catch (error) {
      if (error instanceof MipBannerError && error.code === 'CONFLICT') {
        this.setData({ state: 'conflict', message: error.message })
      }
      else if (error instanceof MipBannerError && error.code === 'FORBIDDEN') {
        this.setData({ state: 'forbidden', message: error.message })
      }
      else {
        this.setData({ message: error instanceof Error ? error.message : 'Banner 保存失败' })
      }
    }
    finally {
      this.setData({ saving: false })
    }
  },
})
