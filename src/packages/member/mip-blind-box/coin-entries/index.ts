import type { BlindBoxCoinEntry } from '../../../../modules/mip-game'
import { mipGameModule } from '../../../../modules/mip-game'

interface CoinEntryView extends BlindBoxCoinEntry {
  deltaText: string
  createdText: string
}

function dateText(value: string) {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) {
    return ''
  }
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

function entryView(item: BlindBoxCoinEntry): CoinEntryView {
  return {
    ...item,
    deltaText: item.deltaValue > 0 ? `+${item.deltaValue}` : String(item.deltaValue),
    createdText: dateText(item.createdAt),
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
      await this.loadEntries()
    }
    finally {
      wx.stopPullDownRefresh()
    }
  },

  async loadEntries() {
    if (!this.data.items.length) {
      this.setData({ state: 'loading', message: '' })
    }
    try {
      const page = await mipGameModule.gateway.listBlindBoxCoinEntries(50)
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
