import type { OpportunitySummary } from '../../../../modules/mip-opportunities'
import { opportunityModule } from '../../../../modules/mip-opportunities'
import { caseNavigateTo } from '../../../../modules/platform/case-navigation'

Page({
  data: {
    state: 'loading' as 'loading' | 'ready' | 'error',
    items: [] as OpportunitySummary[],
    nextCursor: '',
    loadingMore: false,
    message: '',
  },

  onShow() { void this.load(true) },

  async load(reset = false) {
    if (reset) {
      this.setData({ state: 'loading', message: '', nextCursor: '' })
    }
    else { this.setData({ loadingMore: true }) }
    try {
      const page = await opportunityModule.listMine(reset ? undefined : this.data.nextCursor || undefined)
      this.setData({
        state: 'ready',
        items: reset ? page.items : [...this.data.items, ...page.items],
        nextCursor: page.nextCursor || '',
      })
    }
    catch (error) {
      this.setData({ state: 'error', message: error instanceof Error ? error.message : '机会加载失败' })
    }
    finally {
      this.setData({ loadingMore: false })
    }
  },

  onReachBottom() {
    if (this.data.nextCursor && !this.data.loadingMore) {
      void this.load(false)
    }
  },

  create() { caseNavigateTo({ url: '/packages/member/mip-opportunities/editor/index' }) },

  open(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id || '')
    if (id) {
      caseNavigateTo({ url: `/packages/member/mip-opportunities/detail/index?id=${encodeURIComponent(id)}` })
    }
  },
})
