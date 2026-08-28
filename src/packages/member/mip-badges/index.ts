import type { BadgeCollectionFilter, BadgeView } from '../../../modules/mip-growth/badge-presentation'
import { mipGrowthModule } from '../../../modules/mip-growth/client'
import { mipIdentityModule } from '../../../modules/mip-identity/client'
import {
  canApplyBadgeLoad,
  filterBadgeItems,
  moveEquippedId,
  orderedEquippedBadges,
  orderedEquippedIds,
  presentBadges,
  sameIdOrder,
} from '../../../modules/mip-growth/badge-presentation'

type BadgeCategory = 'IDENTITY' | 'HONOR'

Page({
  data: {
    state: 'loading' as 'loading' | 'ready' | 'empty' | 'error',
    items: [] as BadgeView[],
    visibleItems: [] as BadgeView[],
    equippedItems: [] as BadgeView[],
    selectedIds: [] as string[],
    savedSelectedIds: [] as string[],
    activeCategory: 'IDENTITY' as BadgeCategory,
    activeFilter: 'ALL' as BadgeCollectionFilter,
    filterOptions: [
      { key: 'ALL' as BadgeCollectionFilter, label: '全部' },
      { key: 'EQUIPPED' as BadgeCollectionFilter, label: '已佩戴' },
      { key: 'EQUIPPABLE' as BadgeCollectionFilter, label: '可佩戴' },
    ],
    maximumEquipped: 3,
    version: 0,
    earnedCount: 0,
    memberName: 'MIP 成员',
    avatarUrl: '',
    saving: false,
    dirty: false,
    message: '',
  },
  loadSequence: 0,

  onLoad() {
    void this.loadBadges()
  },

  onShow() {
    if (this.data.state === 'ready' && !this.data.dirty) {
      void this.loadBadges()
    }
  },

  filterItems(items: BadgeView[], category: BadgeCategory, filter: BadgeCollectionFilter) {
    return filterBadgeItems(items, category, filter)
  },

  updateDraft(selectedIds: string[]) {
    const selected = new Set(selectedIds)
    const items = this.data.items.map(item => ({ ...item, selected: selected.has(item.id) }))
    this.setData({
      items,
      selectedIds,
      equippedItems: orderedEquippedBadges(items, selectedIds),
      dirty: !sameIdOrder(selectedIds, this.data.savedSelectedIds),
      visibleItems: this.filterItems(items, this.data.activeCategory, this.data.activeFilter),
      message: '',
    })
  },

  async loadBadges(options: { discardDraft?: boolean } = {}) {
    const sequence = ++this.loadSequence
    if (!this.data.items.length) {
      this.setData({ state: 'loading', message: '' })
    }
    try {
      const [collection, identity] = await Promise.all([
        mipGrowthModule.listBadgeCollection(),
        mipIdentityModule.loadSnapshot().catch(() => null),
      ])
      if (!canApplyBadgeLoad(sequence, this.loadSequence, this.data.dirty, options.discardDraft)) {
        return
      }
      const selectedIds = orderedEquippedIds(collection.items)
      const items = presentBadges(collection.items, selectedIds)
      const profile = identity?.profile
      this.setData({
        state: collection.items.length ? 'ready' : 'empty',
        items,
        visibleItems: this.filterItems(items, this.data.activeCategory, this.data.activeFilter),
        equippedItems: orderedEquippedBadges(items, selectedIds),
        selectedIds,
        savedSelectedIds: selectedIds,
        maximumEquipped: collection.maximumEquipped || 3,
        version: collection.version,
        earnedCount: items.filter(item => item.earned).length,
        memberName: profile?.nickname || 'MIP 成员',
        avatarUrl: profile?.avatarUrl || '',
        saving: false,
        dirty: false,
        message: '',
      })
    }
    catch (error) {
      if (!canApplyBadgeLoad(sequence, this.loadSequence, this.data.dirty, options.discardDraft)) {
        return
      }
      const message = error instanceof Error ? error.message : '徽章加载失败。'
      this.setData(this.data.items.length ? { message } : { state: 'error', message })
    }
  },

  chooseCategory(event: WechatMiniprogram.TouchEvent) {
    const category = String(event.currentTarget.dataset.category || 'IDENTITY') as BadgeCategory
    this.setData({
      activeCategory: category,
      visibleItems: this.filterItems(this.data.items, category, this.data.activeFilter),
    })
  },

  chooseFilter(event: WechatMiniprogram.TouchEvent) {
    const filter = String(event.currentTarget.dataset.filter || 'ALL') as BadgeCollectionFilter
    this.setData({
      activeFilter: filter,
      visibleItems: this.filterItems(this.data.items, this.data.activeCategory, filter),
    })
  },

  toggleEquipment(event: WechatMiniprogram.TouchEvent) {
    const badgeId = String(event.currentTarget.dataset.id || '')
    const badge = this.data.items.find(item => item.id === badgeId)
    if (!badge || badge.locked || this.data.saving) {
      if (badge?.locked) {
        wx.showToast({ title: '获得有效徽章后才能佩戴', icon: 'none' })
      }
      return
    }
    const currentlySelected = this.data.selectedIds.includes(badgeId)
    if (!currentlySelected && this.data.selectedIds.length >= this.data.maximumEquipped) {
      wx.showToast({ title: `最多佩戴 ${this.data.maximumEquipped} 个徽章`, icon: 'none' })
      return
    }
    const selectedIds = currentlySelected
      ? this.data.selectedIds.filter(id => id !== badgeId)
      : [...this.data.selectedIds, badgeId]
    this.updateDraft(selectedIds)
  },

  moveEquipment(event: WechatMiniprogram.TouchEvent) {
    if (this.data.saving) {
      return
    }
    const badgeId = String(event.currentTarget.dataset.id || '')
    const direction = String(event.currentTarget.dataset.direction || 'UP') as 'UP' | 'DOWN'
    this.updateDraft(moveEquippedId(this.data.selectedIds, badgeId, direction))
  },

  async saveEquipment() {
    if (!this.data.dirty || this.data.saving) {
      return
    }
    this.setData({ saving: true, message: '' })
    try {
      const result = await mipGrowthModule.equipBadges(this.data.selectedIds, this.data.version)
      const selectedIds = orderedEquippedIds(result.items)
      const items = presentBadges(result.items, selectedIds)
      this.setData({
        items,
        visibleItems: this.filterItems(items, this.data.activeCategory, this.data.activeFilter),
        equippedItems: orderedEquippedBadges(items, selectedIds),
        selectedIds,
        savedSelectedIds: selectedIds,
        maximumEquipped: result.maximumEquipped || this.data.maximumEquipped,
        version: result.version,
        earnedCount: items.filter(item => item.earned).length,
        dirty: false,
        message: '',
      })
      wx.showToast({ title: '佩戴状态已保存', icon: 'success' })
    }
    catch (error) {
      const conflict = error && typeof error === 'object' && 'code' in error && error.code === 'CONFLICT'
      if (conflict) {
        await this.loadBadges({ discardDraft: true })
        this.setData({ message: '佩戴状态已发生变化，已刷新当前状态。' })
      }
      else {
        this.setData({ message: error instanceof Error ? error.message : '佩戴状态保存失败。' })
      }
    }
    finally {
      this.setData({ saving: false })
    }
  },

  openDetail(event: WechatMiniprogram.TouchEvent) {
    const badgeId = String(event.currentTarget.dataset.id || '')
    if (badgeId) {
      wx.navigateTo({ url: `/packages/member/mip-badge-detail/index?badgeId=${encodeURIComponent(badgeId)}` })
    }
  },
})
