import type { AdminGrowthBenefit, AdminGrowthLevel } from '../../../modules/mip-admin'
import type { AdminPageState } from '../shared/page-state'
import { hasCapability, mipAdminModule } from '../../../modules/mip-admin'
import { growthAdminActionFailure } from '../growth-entries/action-state'
import { adminLoadFailure } from '../shared/page-state'

type LevelView = AdminGrowthLevel & { statusText: string, statusTheme: string, benefitText: string }
type BenefitChoice = AdminGrowthBenefit & { selected: boolean }
const statusLabels = { DRAFT: '草稿', ACTIVE: '启用', INACTIVE: '停用' } as const

function levelView(item: AdminGrowthLevel): LevelView {
  const benefitNames = item.benefits.map(benefit => benefit.name)
  return {
    ...item,
    statusText: statusLabels[item.status],
    statusTheme: item.status === 'ACTIVE' ? 'success' : item.status === 'INACTIVE' ? 'danger' : 'default',
    benefitText: [...benefitNames, ...item.legacyBenefits.filter(name => !benefitNames.includes(name))].join('、') || '未关联权益',
  }
}

Page({
  data: {
    state: 'loading' as AdminPageState,
    levels: [] as LevelView[],
    benefits: [] as BenefitChoice[],
    canConfigure: false,
    editorId: '',
    editorVersion: 0,
    levelKey: '',
    name: '',
    displayBadge: '',
    minimumExperience: '',
    sortOrder: '',
    status: 'DRAFT' as AdminGrowthLevel['status'],
    saving: false,
    message: '',
  },
  onShow() { void this.loadLevels() },
  async loadLevels(force = false) {
    const hasContent = this.data.levels.length > 0
    if (!hasContent) {
      this.setData({ state: 'loading', message: '' })
    }
    try {
      const [session, response, benefits] = await Promise.all([
        mipAdminModule.getSession(force),
        mipAdminModule.growth.listLevels(force),
        mipAdminModule.growth.listBenefits(force),
      ])
      this.setData({
        state: 'ready',
        levels: response.items.map(levelView),
        benefits: benefits.items.map(item => ({ ...item, selected: false })),
        canConfigure: hasCapability(session.capabilities, 'growth.configure'),
        message: '',
      })
    }
    catch (error) {
      this.setData(adminLoadFailure(error, { hasContent, fallbackMessage: '成长等级加载失败' }))
    }
  },
  updateField(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    const field = String(event.currentTarget.dataset.field || '')
    if (['name', 'displayBadge', 'minimumExperience', 'sortOrder'].includes(field)) {
      this.setData({ [field]: event.detail.value })
    }
  },
  chooseStatus(event: WechatMiniprogram.TouchEvent) {
    this.setData({ status: String(event.currentTarget.dataset.value || 'DRAFT') as AdminGrowthLevel['status'] })
  },
  toggleBenefit(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id || '')
    this.setData({ benefits: this.data.benefits.map(item => item.id === id ? { ...item, selected: !item.selected } : item) })
  },
  edit(event: WechatMiniprogram.TouchEvent) {
    const level = this.data.levels.find(item => item.id === String(event.currentTarget.dataset.id || ''))
    if (!level) {
      return
    }
    const selected = new Set(level.benefits.map(item => item.id))
    this.setData({
      editorId: level.id,
      editorVersion: level.version,
      levelKey: level.levelKey,
      name: level.name,
      displayBadge: level.displayBadge,
      minimumExperience: String(level.minimumExperience),
      sortOrder: String(level.sortOrder),
      status: level.status,
      benefits: this.data.benefits.map(item => ({ ...item, selected: selected.has(item.id) })),
    })
  },
  resetEditor() {
    this.setData({
      editorId: '',
      editorVersion: 0,
      levelKey: '',
      name: '',
      displayBadge: '',
      minimumExperience: '',
      sortOrder: '',
      status: 'DRAFT',
      benefits: this.data.benefits.map(item => ({ ...item, selected: false })),
    })
  },
  async save() {
    if (!this.data.canConfigure || this.data.saving) {
      return
    }
    this.setData({ saving: true, message: '' })
    try {
      await mipAdminModule.growth.saveLevel({
        levelId: this.data.editorId || undefined,
        expectedVersion: this.data.editorId ? this.data.editorVersion : undefined,
        draft: {
          levelKey: this.data.levelKey || `level-${Date.now()}`,
          name: this.data.name,
          displayBadge: this.data.displayBadge,
          minimumExperience: Number(this.data.minimumExperience),
          sortOrder: Number(this.data.sortOrder),
          benefitIds: this.data.benefits.filter(item => item.selected).map(item => item.id),
          status: this.data.status,
        },
      })
      wx.showToast({ title: '等级已保存', icon: 'success' })
      this.resetEditor()
      await this.loadLevels(true)
    }
    catch (error) { this.setData(growthAdminActionFailure(error, '等级保存失败')) }
    finally { this.setData({ saving: false }) }
  },
  openBenefits() { void wx.navigateTo({ url: '/packages/admin/growth-benefits/index' }) },
  openRules() { void wx.navigateTo({ url: '/packages/admin/growth-rules/index' }) },
  openEntries() { void wx.navigateTo({ url: '/packages/admin/growth-entries/index' }) },
  openTransitions() { void wx.navigateTo({ url: '/packages/admin/growth-transitions/index' }) },
  openLevelUsers(event: WechatMiniprogram.TouchEvent) {
    const levelId = String(event.currentTarget.dataset.id || '')
    if (levelId) {
      void wx.navigateTo({ url: `/packages/admin/profiles/index?levelId=${levelId}` })
    }
  },
})
