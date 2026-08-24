import type { AdminGrowthBenefit } from '../../../modules/mip-admin'
import type { AdminPageState } from '../shared/page-state'
import { hasCapability, mipAdminModule } from '../../../modules/mip-admin'
import { adminLoadFailure } from '../shared/page-state'

type BenefitView = AdminGrowthBenefit & { statusText: string, statusTheme: string }
const labels = { DRAFT: '草稿', ACTIVE: '启用', INACTIVE: '停用' } as const
function view(item: AdminGrowthBenefit): BenefitView {
  return { ...item, statusText: labels[item.status], statusTheme: item.status === 'ACTIVE' ? 'success' : item.status === 'INACTIVE' ? 'danger' : 'default' }
}

Page({
  data: {
    state: 'loading' as AdminPageState,
    items: [] as BenefitView[],
    canConfigure: false,
    editorId: '',
    editorVersion: 0,
    name: '',
    description: '',
    sortOrder: '',
    status: 'DRAFT' as AdminGrowthBenefit['status'],
    saving: false,
    message: '',
  },
  onShow() { void this.load() },
  async load(force = false) {
    try {
      const [page, session] = await Promise.all([mipAdminModule.listGrowthBenefits(force), mipAdminModule.getSession(force)])
      this.setData({ state: 'ready', items: page.items.map(view), canConfigure: hasCapability(session.capabilities, 'growth.configure'), message: '' })
    }
    catch (error) {
      this.setData(adminLoadFailure(error, {
        hasContent: this.data.items.length > 0,
        fallbackMessage: '权益加载失败',
      }))
    }
  },
  updateField(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    const field = String(event.currentTarget.dataset.field || '')
    if (['name', 'description', 'sortOrder'].includes(field)) {
      this.setData({ [field]: event.detail.value })
    }
  },
  chooseStatus(event: WechatMiniprogram.TouchEvent) {
    this.setData({ status: String(event.currentTarget.dataset.value || 'DRAFT') as AdminGrowthBenefit['status'] })
  },
  edit(event: WechatMiniprogram.TouchEvent) {
    const item = this.data.items.find(row => row.id === String(event.currentTarget.dataset.id || ''))
    if (!item) {
      return
    }
    this.setData({ editorId: item.id, editorVersion: item.version, name: item.name, description: item.description, sortOrder: String(item.sortOrder), status: item.status })
  },
  reset() {
    this.setData({ editorId: '', editorVersion: 0, name: '', description: '', sortOrder: '', status: 'DRAFT' })
  },
  async save() {
    if (!this.data.canConfigure || this.data.saving) {
      return
    }
    this.setData({ saving: true, message: '' })
    try {
      await mipAdminModule.mutate(() => mipAdminModule.gateway.saveGrowthBenefit({
        benefitId: this.data.editorId || undefined,
        expectedVersion: this.data.editorId ? this.data.editorVersion : undefined,
        draft: { name: this.data.name, description: this.data.description, sortOrder: Number(this.data.sortOrder), status: this.data.status },
      }))
      wx.showToast({ title: '权益已保存', icon: 'success' })
      this.reset()
      await this.load(true)
    }
    catch (error) { this.setData({ message: error instanceof Error ? error.message : '权益保存失败' }) }
    finally { this.setData({ saving: false }) }
  },
})
