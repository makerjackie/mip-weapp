import type { BadgeCollectionItem } from '../../../modules/mip-growth'
import { mipGrowthModule } from '../../../modules/mip-growth/client'
import { formatLocalDate } from '../../../utils/date'

interface BadgeView extends BadgeCollectionItem {
  selected: boolean
  unavailable: boolean
  slotText: string
  awardedText: string
}

function present(items: BadgeCollectionItem[], selectedIds: string[]): BadgeView[] {
  const selected = new Map(selectedIds.map((id, index) => [id, index + 1]))
  return items.map(item => ({
    ...item,
    selected: selected.has(item.id),
    unavailable: item.status !== 'ACTIVE',
    slotText: selected.has(item.id) ? `佩戴位置 ${selected.get(item.id)}` : '',
    awardedText: formatLocalDate(item.awardedAt),
  }))
}

function filterItems(items: BadgeView[], filter: 'all' | 'equipped' | 'available') {
  if (filter === 'equipped') {
    return items.filter(item => item.selected)
  }
  if (filter === 'available') {
    return items.filter(item => !item.unavailable)
  }
  return items
}

Page({
  data: {
    state: 'loading' as 'loading' | 'ready' | 'empty' | 'error',
    items: [] as BadgeView[],
    visibleItems: [] as BadgeView[],
    selectedIds: [] as string[],
    filter: 'all' as 'all' | 'equipped' | 'available',
    activeBadge: null as BadgeView | null,
    detailVisible: false,
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
      const items = present(collection.items, selectedIds)
      this.setData({
        state: collection.items.length ? 'ready' : 'empty',
        items,
        visibleItems: filterItems(items, this.data.filter),
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
    const items = present(this.data.items, selectedIds)
    this.setData({ selectedIds, items, visibleItems: filterItems(items, this.data.filter), activeBadge: items.find(item => item.id === id) || null, message: '' })
  },

  chooseFilter(event: WechatMiniprogram.TouchEvent) {
    const filter = String(event.currentTarget.dataset.filter || 'all') as 'all' | 'equipped' | 'available'
    this.setData({ filter, visibleItems: filterItems(this.data.items, filter) })
  },

  showBadge(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id || '')
    const badge = this.data.items.find(item => item.id === id)
    if (badge) {
      this.setData({ activeBadge: badge, detailVisible: true })
    }
  },

  closeBadgeDetail() {
    this.setData({ detailVisible: false })
  },

  handleDetailVisibility(event: WechatMiniprogram.CustomEvent<{ visible?: boolean }>) {
    if (!event.detail.visible) {
      this.closeBadgeDetail()
    }
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
      const items = present(collection.items, selectedIds)
      this.setData({
        state: collection.items.length ? 'ready' : 'empty',
        items,
        visibleItems: filterItems(items, this.data.filter),
        selectedIds,
        version: collection.version,
      })
      wx.showToast({ title: '佩戴状态已更新', icon: 'success' })
    }
    catch (error) {
      const conflict = error && typeof error === 'object' && 'code' in error && error.code === 'CONFLICT'
      if (conflict) {
        wx.showToast({ title: '佩戴状态已更新，正在刷新', icon: 'none' })
        await this.loadBadges()
      }
      else {
        this.setData({ message: error instanceof Error ? error.message : '勋章保存失败。' })
      }
    }
    finally {
      this.setData({ saving: false })
    }
  },
})
