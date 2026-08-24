import type { AdminGrowthLevel } from '../../../modules/mip-admin'
import type { AdminPageState } from '../shared/page-state'
import { hasCapability, mipAdminModule } from '../../../modules/mip-admin'
import { adminLoadFailure } from '../shared/page-state'

Page({
  data: {
    state: 'loading' as AdminPageState,
    levels: [] as AdminGrowthLevel[],
    canConfigure: false,
    editorId: '',
    editorVersion: 0,
    levelKey: '',
    name: '',
    minimumExperience: '',
    benefits: '',
    status: 'DRAFT',
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
      const [session, response] = await Promise.all([mipAdminModule.getSession(force), mipAdminModule.listGrowthLevels(force)])
      this.setData({ state: 'ready', levels: response.items, canConfigure: hasCapability(session.capabilities, 'growth.configure'), message: '' })
    }
    catch (error) {
      this.setData(adminLoadFailure(error, { hasContent, fallbackMessage: '成长等级加载失败' }))
    }
  },
  updateField(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    const field = String(event.currentTarget.dataset.field || '')
    if (['levelKey', 'name', 'minimumExperience', 'benefits'].includes(field)) {
      this.setData({ [field]: event.detail.value })
    }
  },
  chooseStatus(event: WechatMiniprogram.TouchEvent) { this.setData({ status: String(event.currentTarget.dataset.value || 'DRAFT') }) },
  edit(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id || '')
    const level = this.data.levels.find(item => item.id === id)
    if (!level) {
      return
    }
    this.setData({ editorId: level.id, editorVersion: level.version, levelKey: level.levelKey, name: level.name, minimumExperience: String(level.minimumExperience), benefits: level.benefits.join('、'), status: level.status })
  },
  resetEditor() { this.setData({ editorId: '', editorVersion: 0, levelKey: '', name: '', minimumExperience: '', benefits: '', status: 'DRAFT' }) },
  async save() {
    if (!this.data.canConfigure || this.data.saving) {
      return
    }
    this.setData({ saving: true, message: '' })
    try {
      await mipAdminModule.mutate(() => mipAdminModule.gateway.saveGrowthLevel({
        levelId: this.data.editorId || undefined,
        expectedVersion: this.data.editorVersion || undefined,
        draft: {
          levelKey: this.data.levelKey.trim(),
          name: this.data.name.trim(),
          minimumExperience: Number(this.data.minimumExperience),
          benefits: this.data.benefits.split(/[、,，]/).map(value => value.trim()).filter(Boolean),
          status: this.data.status,
        },
      }))
      wx.showToast({ title: '等级已保存', icon: 'success' })
      this.resetEditor()
      await this.loadLevels(true)
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '等级保存失败' })
    }
    finally {
      this.setData({ saving: false })
    }
  },
  openRules() { void wx.navigateTo({ url: '/packages/admin/growth-rules/index' }) },
  openEntries() { void wx.navigateTo({ url: '/packages/admin/growth-entries/index' }) },
})
