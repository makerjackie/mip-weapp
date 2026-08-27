import type { BadgeView } from './presenter'
import { mipGrowthModule } from '../../../modules/mip-growth/client'
import { mipIdentityModule } from '../../../modules/mip-identity/client'
import { orderedEquippedIds, presentBadges } from './presenter'

type BadgeCategory = 'IDENTITY' | 'HONOR'

Page({
  data: {
    state: 'loading' as 'loading' | 'ready' | 'empty' | 'error',
    items: [] as BadgeView[],
    visibleItems: [] as BadgeView[],
    selectedIds: [] as string[],
    activeCategory: 'IDENTITY' as BadgeCategory,
    earnedCount: 0,
    memberName: 'MIP 成员',
    avatarUrl: '',
    message: '',
  },

  onLoad() {
    void this.loadBadges()
  },

  onShow() {
    if (this.data.state === 'ready') {
      void this.loadBadges()
    }
  },

  filterItems(items: BadgeView[], category: BadgeCategory) {
    return items.filter(item => item.category === category)
  },

  async loadBadges() {
    if (!this.data.items.length) {
      this.setData({ state: 'loading', message: '' })
    }
    try {
      const [collection, identity] = await Promise.all([
        mipGrowthModule.listBadgeCollection(),
        mipIdentityModule.loadSnapshot().catch(() => null),
      ])
      const selectedIds = orderedEquippedIds(collection.items)
      const items = presentBadges(collection.items, selectedIds)
      const profile = identity?.profile
      this.setData({
        state: collection.items.length ? 'ready' : 'empty',
        items,
        visibleItems: this.filterItems(items, this.data.activeCategory),
        selectedIds,
        earnedCount: items.filter(item => item.earned).length,
        memberName: profile?.nickname || 'MIP 成员',
        avatarUrl: profile?.avatarUrl || '',
        message: '',
      })
    }
    catch (error) {
      this.setData({ state: 'error', message: error instanceof Error ? error.message : '徽章加载失败。' })
    }
  },

  chooseCategory(event: WechatMiniprogram.TouchEvent) {
    const category = String(event.currentTarget.dataset.category || 'IDENTITY') as BadgeCategory
    this.setData({ activeCategory: category, visibleItems: this.filterItems(this.data.items, category) })
  },

  openDetail(event: WechatMiniprogram.TouchEvent) {
    const badgeId = String(event.currentTarget.dataset.id || '')
    if (badgeId) {
      wx.navigateTo({ url: `/packages/member/mip-badge-detail/index?badgeId=${encodeURIComponent(badgeId)}` })
    }
  },

})
