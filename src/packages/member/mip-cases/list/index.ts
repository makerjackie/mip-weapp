import type { SuperCaseSummary } from '../../../../modules/mip-cases'
import { mipOperationsConfig } from '../../../../config/mip-operations'
import { superCaseModule } from '../../../../modules/mip-cases'
import { caseNavigateTo } from '../../../../modules/platform/case-navigation'

function presentCase(item: SuperCaseSummary): SuperCaseSummary {
  return {
    ...item,
    coverUrl: item.coverUrl || mipOperationsConfig.defaultCoverPaths.superCase,
  }
}

Page({
  data: {
    mine: false,
    state: 'loading' as 'loading' | 'ready' | 'error',
    items: [] as SuperCaseSummary[],
    nextCursor: '',
    loadingMore: false,
    message: '',
  },

  onLoad(options: Record<string, string | undefined>) {
    this.setData({ mine: options.mine === '1' })
  },

  onShow() { void this.load(true) },

  async load(reset = false) {
    if (reset) {
      this.setData({ state: 'loading', nextCursor: '', message: '' })
    }
    else {
      this.setData({ loadingMore: true })
    }
    try {
      const page = this.data.mine
        ? await superCaseModule.listMine(reset ? undefined : this.data.nextCursor || undefined)
        : await superCaseModule.list(reset ? undefined : this.data.nextCursor || undefined)
      this.setData({
        state: 'ready',
        items: reset
          ? page.items.map(presentCase)
          : [...this.data.items, ...page.items.map(presentCase)],
        nextCursor: page.nextCursor || '',
      })
    }
    catch (error) {
      this.setData({ state: 'error', message: error instanceof Error ? error.message : '案例加载失败' })
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

  toggleMine() {
    this.setData({ mine: !this.data.mine })
    void this.load(true)
  },

  create() { caseNavigateTo({ url: '/packages/member/mip-cases/editor/index' }) },

  open(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id || '')
    if (id) {
      caseNavigateTo({ url: `/packages/member/mip-cases/detail/index?id=${encodeURIComponent(id)}` })
    }
  },
})
