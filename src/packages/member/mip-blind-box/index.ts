import type { BlindBoxCatalogSummary } from '../../../modules/mip-game'
import { mipGameModule } from '../../../modules/mip-game'

interface CatalogView extends BlindBoxCatalogSummary {
  stockText: string
}

function catalogView(item: BlindBoxCatalogSummary): CatalogView {
  return {
    ...item,
    stockText: item.stockRemaining > 0 ? `剩余 ${item.stockRemaining} 份` : '库存已用完',
  }
}

Page({
  data: {
    state: 'loading' as 'loading' | 'ready' | 'empty' | 'error',
    coinBalance: 0,
    items: [] as CatalogView[],
    message: '',
  },

  onShow() {
    void this.loadCatalogs()
  },

  async onPullDownRefresh() {
    try {
      await this.loadCatalogs()
    }
    finally {
      wx.stopPullDownRefresh()
    }
  },

  async loadCatalogs() {
    if (!this.data.items.length) {
      this.setData({ state: 'loading', message: '' })
    }
    try {
      const page = await mipGameModule.gateway.listBlindBoxes()
      this.setData({
        state: page.items.length ? 'ready' : 'empty',
        coinBalance: page.coinBalance,
        items: page.items.map(catalogView),
        message: '',
      })
    }
    catch (error) {
      this.setData(this.data.items.length
        ? { message: '盲盒列表更新失败，已保留上次结果。' }
        : {
            state: 'error',
            message: error instanceof Error ? error.message : '盲盒列表加载失败',
          })
    }
  },

  openDetail(event: WechatMiniprogram.TouchEvent) {
    const catalogId = String(event.currentTarget.dataset.catalogId || '')
    if (catalogId) {
      void wx.navigateTo({
        url: `/packages/member/mip-blind-box/detail/index?catalogId=${encodeURIComponent(catalogId)}`,
      })
    }
  },

  openBackpack() {
    void wx.navigateTo({ url: '/packages/member/mip-blind-box/backpack/index' })
  },

  openCoinEntries() {
    void wx.navigateTo({ url: '/packages/member/mip-blind-box/coin-entries/index' })
  },
})
