import type { BlindBoxInventoryItem } from '../../../../modules/mip-game'
import { mipGameModule } from '../../../../modules/mip-game'
import { formatLocalDate } from '../../../../utils/date'

interface InventoryView extends BlindBoxInventoryItem {
  firstAcquiredText: string
  lastAcquiredText: string
  rarityLabel: string
}

function inventoryView(item: BlindBoxInventoryItem): InventoryView {
  const rarityLabels: Record<BlindBoxInventoryItem['rarity'], string> = {
    COMMON: '普通',
    RARE: '稀有',
    EPIC: '史诗',
    LEGENDARY: '传说',
  }
  return {
    ...item,
    firstAcquiredText: formatLocalDate(item.firstAcquiredAt),
    lastAcquiredText: formatLocalDate(item.lastAcquiredAt),
    rarityLabel: rarityLabels[item.rarity],
  }
}

Page({
  data: {
    state: 'loading' as 'loading' | 'ready' | 'empty' | 'error',
    catalogId: '',
    items: [] as InventoryView[],
    message: '',
  },

  onLoad(options: Record<string, string>) {
    this.setData({ catalogId: String(options.catalogId || '') })
    void this.loadInventory()
  },

  async onPullDownRefresh() {
    try {
      await this.loadInventory(true)
    }
    finally {
      wx.stopPullDownRefresh()
    }
  },

  async loadInventory(force = false) {
    if (!this.data.items.length) {
      this.setData({ state: 'loading', message: '' })
    }
    try {
      const inventory = await mipGameModule.query.getBlindBoxInventory(
        this.data.catalogId || undefined,
        force,
      )
      this.setData({
        state: inventory.items.length ? 'ready' : 'empty',
        items: inventory.items.map(inventoryView),
        message: '',
      })
    }
    catch (error) {
      this.setData(this.data.items.length
        ? { message: '卡牌背包更新失败，已保留上次结果。' }
        : {
            state: 'error',
            message: error instanceof Error ? error.message : '卡牌背包加载失败',
          })
    }
  },
})
