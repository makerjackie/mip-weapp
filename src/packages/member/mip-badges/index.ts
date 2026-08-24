import type { BadgeCollectionItem } from '../../../modules/mip-growth'
import { mipGrowthModule } from '../../../modules/mip-growth/client'

interface BadgeView extends BadgeCollectionItem {
  selected: boolean
  unavailable: boolean
  slotText: string
}

function present(items: BadgeCollectionItem[], selectedIds: string[]): BadgeView[] {
  const selected = new Map(selectedIds.map((id, index) => [id, index + 1]))
  return items.map(item => ({
    ...item,
    selected: selected.has(item.id),
    unavailable: item.status !== 'ACTIVE',
    slotText: selected.has(item.id) ? `佩戴位置 ${selected.get(item.id)}` : '',
  }))
}

Page({
  data: {
    state: 'loading' as 'loading' | 'ready' | 'empty' | 'error' | 'conflict',
    items: [] as BadgeView[],
    selectedIds: [] as string[],
    version: 0,
    saving: false,
    message: '',
  },

  onLoad() {
    void this.loadBadges()
  },

  async loadBadges() {
    if (!this.data.items.length) {
      this.setData({ state: 'loading', message: '' })
    }
    try {
      const collection = await mipGrowthModule.listBadgeCollection()
      const selectedIds = collection.items
        .filter(item => item.equippedSlot !== undefined)
        .sort((left, right) => Number(left.equippedSlot) - Number(right.equippedSlot))
        .map(item => item.id)
      this.setData({
        state: collection.items.length ? 'ready' : 'empty',
        items: present(collection.items, selectedIds),
        selectedIds,
        version: collection.version,
        message: '',
      })
    }
    catch (error) {
      this.setData({
        state: 'error',
        message: error instanceof Error ? error.message : '勋章加载失败。',
      })
    }
  },

  toggleBadge(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id || '')
    const badge = this.data.items.find(item => item.id === id)
    if (!badge || badge.unavailable || this.data.saving) {
      return
    }
    const selectedIds = badge.selected
      ? this.data.selectedIds.filter(item => item !== id)
      : [...this.data.selectedIds, id]
    if (selectedIds.length > 3) {
      wx.showToast({ title: '最多佩戴 3 个勋章', icon: 'none' })
      return
    }
    this.setData({ selectedIds, items: present(this.data.items, selectedIds), message: '' })
  },

  async save() {
    if (this.data.saving || this.data.version < 1) {
      return
    }
    this.setData({ saving: true, message: '' })
    try {
      const collection = await mipGrowthModule.equipBadges(this.data.selectedIds, this.data.version)
      const selectedIds = collection.items
        .filter(item => item.equippedSlot !== undefined)
        .sort((left, right) => Number(left.equippedSlot) - Number(right.equippedSlot))
        .map(item => item.id)
      this.setData({
        state: collection.items.length ? 'ready' : 'empty',
        items: present(collection.items, selectedIds),
        selectedIds,
        version: collection.version,
      })
      wx.showToast({ title: '佩戴状态已更新', icon: 'success' })
    }
    catch (error) {
      const conflict = error && typeof error === 'object' && 'code' in error && error.code === 'CONFLICT'
      this.setData({
        state: conflict ? 'conflict' : 'error',
        message: error instanceof Error ? error.message : '勋章保存失败。',
      })
    }
    finally {
      this.setData({ saving: false })
    }
  },
})
