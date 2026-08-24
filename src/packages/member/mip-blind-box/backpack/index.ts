import type { BlindBoxInventoryItem } from '../../../../modules/mip-game'
import { mipGameModule } from '../../../../modules/mip-game'

interface InventoryView extends BlindBoxInventoryItem {
  firstAcquiredText: string
  lastAcquiredText: string
  rarityLabel: string
}

function dateText(value: string) {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) {
    return ''
  }
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
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
    firstAcquiredText: dateText(item.firstAcquiredAt),
    lastAcquiredText: dateText(item.lastAcquiredAt),
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
      await this.loadInventory()
    }
    finally {
      wx.stopPullDownRefresh()
    }
  },

  async loadInventory() {
    if (!this.data.items.length) {
      this.setData({ state: 'loading', message: '' })
    }
    try {
      const inventory = await mipGameModule.gateway.getBlindBoxInventory(this.data.catalogId || undefined)
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
