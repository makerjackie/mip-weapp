import type { BadgeView } from '../../../modules/mip-growth/badge-presentation'
import { orderedEquippedIds, presentBadges } from '../../../modules/mip-growth/badge-presentation'
import { mipGrowthModule } from '../../../modules/mip-growth/client'

Page({
  data: {
    state: 'loading' as 'loading' | 'ready' | 'empty' | 'error',
    badge: null as BadgeView | null,
    version: 0,
    saving: false,
    message: '',
  },

  badgeId: '',
  loadSequence: 0,

  onLoad(options: Record<string, string | undefined>) {
    this.badgeId = String(options.badgeId || '')
    void this.loadBadge()
  },

  onUnload() {
    this.loadSequence += 1
  },

  async loadBadge() {
    const sequence = ++this.loadSequence
    if (!this.badgeId) {
      this.setData({ state: 'empty', message: '未找到徽章。' })
      return
    }
    try {
      const collection = await mipGrowthModule.listBadgeCollection()
      const selectedIds = orderedEquippedIds(collection.items)
      const badge = presentBadges(collection.items, selectedIds).find(item => item.id === this.badgeId) || null
      if (sequence !== this.loadSequence) {
        return
      }
      this.setData({ state: badge ? 'ready' : 'empty', badge, version: collection.version, message: badge ? '' : '未找到徽章。' })
    }
    catch (error) {
      if (sequence !== this.loadSequence) {
        return
      }
      this.setData({ state: 'error', message: error instanceof Error ? error.message : '徽章加载失败。' })
    }
  },

  async toggleEquipment() {
    const badge = this.data.badge
    if (!badge || badge.locked || this.data.saving) {
      if (badge?.locked) {
        wx.showToast({ title: '获得徽章后才能佩戴', icon: 'none' })
      }
      return
    }
    this.setData({ saving: true, message: '' })
    try {
      const collection = await mipGrowthModule.listBadgeCollection()
      const latestIds = orderedEquippedIds(collection.items)
      const currentlySelected = latestIds.includes(badge.id)
      const nextIds = currentlySelected
        ? latestIds.filter(id => id !== badge.id)
        : [...latestIds, badge.id]
      if (nextIds.length > 3) {
        wx.showToast({ title: '最多佩戴 3 个徽章', icon: 'none' })
        return
      }
      const result = await mipGrowthModule.equipBadges(nextIds, collection.version)
      const ids = orderedEquippedIds(result.items)
      const nextBadge = presentBadges(result.items, ids).find(item => item.id === this.badgeId) || null
      this.setData({ badge: nextBadge, version: result.version })
      wx.showToast({ title: nextBadge?.selected ? '已佩戴' : '已取消佩戴', icon: 'success' })
    }
    catch (error) {
      const conflict = error && typeof error === 'object' && 'code' in error && error.code === 'CONFLICT'
      if (conflict) {
        await this.loadBadge()
      }
      else {
        this.setData({ message: error instanceof Error ? error.message : '佩戴状态更新失败。' })
      }
    }
    finally {
      this.setData({ saving: false })
    }
  },
})
