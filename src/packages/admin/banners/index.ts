import type { MipAdminBanner, MipBannerStatus } from '../../../modules/mip-banners'
import { MipBannerError, mipBannerModule } from '../../../modules/mip-banners'
import { caseNavigateTo } from '../../../modules/platform/case-navigation'

type PageState = 'loading' | 'ready' | 'error' | 'forbidden' | 'conflict'
type BannerView = MipAdminBanner & {
  statusLabel: string
  targetLabel: string
  dimensionsLabel: string
}
type BannerMutationIntent
  = | { type: 'CHANGE_STATUS', status: 'ACTIVE' | 'INACTIVE' }
    | { type: 'MOVE', direction: 'UP' | 'DOWN' }
    | { type: 'REMOVE' }

const statusLabels: Record<MipBannerStatus, string> = {
  ACTIVE: '已启用',
  INACTIVE: '已停用',
  DELETED: '已删除',
}

function bannerView(item: MipAdminBanner): BannerView {
  return {
    ...item,
    statusLabel: statusLabels[item.status],
    targetLabel: item.targetType === 'ARTICLE_URL' ? '公众号文章' : '小程序页面',
    dimensionsLabel: `${item.imageWidth} × ${item.imageHeight}`,
  }
}

function confirm(content: string) {
  return new Promise<boolean>((resolve) => {
    wx.showModal({
      title: '确认操作',
      content,
      confirmText: '确认',
      cancelText: '取消',
      success: result => resolve(result.confirm),
      fail: () => resolve(false),
    })
  })
}

Page({
  data: {
    state: 'loading' as PageState,
    items: [] as BannerView[],
    statusFilter: '' as MipBannerStatus | '',
    query: '',
    truncated: false,
    mutatingId: '',
    message: '',
  },

  onShow() {
    void this.load(true)
  },

  retryLoad() {
    void this.load(true)
  },

  async load(force = false) {
    const hasContent = this.data.items.length > 0
    if (!hasContent) {
      this.setData({ state: 'loading', message: '' })
    }
    try {
      const page = await mipBannerModule.query.listAdmin({
        status: this.data.statusFilter,
        query: this.data.query.trim(),
      }, force)
      this.setData({
        state: 'ready',
        items: page.items.map(bannerView),
        truncated: page.truncated,
        message: '',
      })
    }
    catch (error) {
      const forbidden = error instanceof MipBannerError && error.code === 'FORBIDDEN'
      if (forbidden) {
        this.setData({ state: 'forbidden', items: [], message: error.message })
        return
      }
      if (hasContent) {
        this.setData({ message: 'Banner 列表刷新失败，已保留上次结果。' })
        return
      }
      this.setData({
        state: 'error',
        message: error instanceof Error ? error.message : 'Banner 列表加载失败',
      })
    }
  },

  updateQuery(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    this.setData({ query: event.detail.value })
  },

  search() {
    void this.load(true)
  },

  chooseStatus(event: WechatMiniprogram.TouchEvent) {
    const raw = String(event.currentTarget.dataset.status || '')
    const statusFilter = ['ACTIVE', 'INACTIVE', 'DELETED'].includes(raw)
      ? raw as MipBannerStatus
      : ''
    this.setData({ statusFilter })
    void this.load(true)
  },

  createBanner() {
    caseNavigateTo({ url: '/packages/admin/banner-editor/index' })
  },

  editBanner(event: WechatMiniprogram.TouchEvent) {
    const bannerId = String(event.currentTarget.dataset.bannerId || '')
    if (bannerId) {
      caseNavigateTo({ url: `/packages/admin/banner-editor/index?bannerId=${encodeURIComponent(bannerId)}` })
    }
  },

  toggleStatus(event: WechatMiniprogram.TouchEvent) {
    const bannerId = String(event.currentTarget.dataset.bannerId || '')
    const item = this.data.items.find(banner => banner.id === bannerId)
    if (item && item.status !== 'DELETED') {
      void this.runMutation(item, {
        type: 'CHANGE_STATUS',
        status: item.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE',
      })
    }
  },

  moveBanner(event: WechatMiniprogram.TouchEvent) {
    const bannerId = String(event.currentTarget.dataset.bannerId || '')
    const direction = String(event.currentTarget.dataset.direction || '')
    const item = this.data.items.find(banner => banner.id === bannerId)
    if (item && (direction === 'UP' || direction === 'DOWN')) {
      void this.runMutation(item, { type: 'MOVE', direction })
    }
  },

  async deleteBanner(event: WechatMiniprogram.TouchEvent) {
    const bannerId = String(event.currentTarget.dataset.bannerId || '')
    const item = this.data.items.find(banner => banner.id === bannerId)
    if (!item || item.status === 'DELETED' || !await confirm('删除后不会在公开页面展示，历史审计记录会保留。')) {
      return
    }
    await this.runMutation(item, { type: 'REMOVE' })
  },

  async runMutation(item: BannerView, intent: BannerMutationIntent) {
    if (this.data.mutatingId) {
      return
    }
    this.setData({ mutatingId: item.id, message: '' })
    try {
      if (intent.type === 'CHANGE_STATUS') {
        await mipBannerModule.mutation.changeStatus(item.id, item.version, intent.status)
      }
      if (intent.type === 'MOVE') {
        await mipBannerModule.mutation.move(item.id, item.version, intent.direction)
      }
      if (intent.type === 'REMOVE') {
        await mipBannerModule.mutation.remove(item.id, item.version)
      }
      await this.load()
      wx.showToast({ title: '操作成功', icon: 'success' })
    }
    catch (error) {
      if (error instanceof MipBannerError && error.code === 'CONFLICT') {
        this.setData({ state: 'conflict', message: error.message })
      }
      else if (error instanceof MipBannerError && error.code === 'FORBIDDEN') {
        this.setData({ state: 'forbidden', message: error.message })
      }
      else {
        this.setData({ message: error instanceof Error ? error.message : 'Banner 操作失败' })
      }
    }
    finally {
      this.setData({ mutatingId: '' })
    }
  },
})
