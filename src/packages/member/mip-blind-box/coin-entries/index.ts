import type { BlindBoxCoinEntry } from '../../../../modules/mip-game'
import { mipGameModule } from '../../../../modules/mip-game'
import { formatLocalDateTime } from '../../../../utils/date'

interface CoinEntryView extends BlindBoxCoinEntry {
  deltaText: string
  createdText: string
}

function entryView(item: BlindBoxCoinEntry): CoinEntryView {
  return {
    ...item,
    deltaText: item.deltaValue > 0 ? `+${item.deltaValue}` : String(item.deltaValue),
    createdText: formatLocalDateTime(item.createdAt),
  }
}

Page({
  data: {
    state: 'loading' as 'loading' | 'ready' | 'empty' | 'error',
    coinBalance: 0,
    items: [] as CoinEntryView[],
    message: '',
  },

  onLoad() {
    void this.loadEntries()
  },

  async onPullDownRefresh() {
    try {
      await this.loadEntries(true)
    }
    finally {
      wx.stopPullDownRefresh()
    }
  },

  async loadEntries(force = false) {
    if (!this.data.items.length) {
      this.setData({ state: 'loading', message: '' })
    }
    try {
      const page = await mipGameModule.query.listBlindBoxCoinEntries(50, force)
      this.setData({
        state: page.items.length ? 'ready' : 'empty',
        coinBalance: page.coinBalance,
        items: page.items.map(entryView),
        message: '',
      })
    }
    catch (error) {
      this.setData(this.data.items.length
        ? { message: '游戏币流水更新失败，已保留上次结果。' }
        : {
            state: 'error',
            message: error instanceof Error ? error.message : '游戏币流水加载失败',
          })
    }
  },
})
