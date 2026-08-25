import type { AdminMatchingRequest, AdminMatchingSettings } from '../../../modules/mip-admin'
import { hasCapability, mipAdminModule } from '../../../modules/mip-admin'
import { opportunityActionFailure } from '../opportunities/action-state'
import { adminLoadFailure } from '../shared/page-state'

type PageState = 'loading' | 'ready' | 'error' | 'forbidden'

function requestKey(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`
}

Page({
  data: {
    state: 'loading' as PageState,
    branchId: '',
    settings: null as AdminMatchingSettings | null,
    requests: [] as AdminMatchingRequest[],
    talentMinScore: '35',
    projectMinScore: '30',
    maximumCandidates: '100',
    externalProviderEnabled: false,
    opportunityId: '',
    saving: false,
    recalculating: false,
    message: '',
  },

  onLoad() {
    void this.load()
  },

  async load() {
    this.setData({ state: 'loading', message: '' })
    try {
      const session = await mipAdminModule.getSession(true)
      if (!hasCapability(session.capabilities, 'opportunities.moderate')) {
        this.setData({ state: 'forbidden' })
        return
      }
      const grant = session.capabilities.find(item => item.capability === 'opportunities.moderate')
      const branchId = grant?.scopeType === 'BRANCH' ? grant.scopeId || '' : ''
      const result = await mipAdminModule.opportunities.getMatchingState(branchId || undefined, true)
      this.setData({
        state: 'ready',
        branchId,
        settings: result.settings,
        requests: result.requests,
        talentMinScore: String(result.settings.talentMinScore),
        projectMinScore: String(result.settings.projectMinScore),
        maximumCandidates: String(result.settings.maximumCandidates),
        externalProviderEnabled: result.settings.externalProviderEnabled,
      })
    }
    catch (error) {
      const failure = adminLoadFailure(error, {
        hasContent: false,
        fallbackMessage: '撮合设置加载失败',
      })
      this.setData({ state: failure.state === 'forbidden' ? 'forbidden' : 'error', message: failure.message })
    }
  },

  updateNumber(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    const field = String(event.currentTarget.dataset.field || '')
    if (['talentMinScore', 'projectMinScore', 'maximumCandidates'].includes(field)) {
      this.setData({ [field]: event.detail.value })
    }
  },

  updateOpportunityId(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    this.setData({ opportunityId: event.detail.value.trim() })
  },

  toggleProvider(event: WechatMiniprogram.CustomEvent<{ value: boolean }>) {
    this.setData({ externalProviderEnabled: Boolean(event.detail.value) })
  },

  async save() {
    const settings = this.data.settings
    if (!settings || this.data.saving) {
      return
    }
    this.setData({ saving: true, message: '' })
    try {
      const result = await mipAdminModule.opportunities.saveMatchingSettings({
        branchId: this.data.branchId || undefined,
        expectedVersion: settings.version,
        settings: {
          talentMinScore: Number(this.data.talentMinScore),
          projectMinScore: Number(this.data.projectMinScore),
          maximumCandidates: Number(this.data.maximumCandidates),
          externalProviderEnabled: this.data.externalProviderEnabled,
        },
      })
      this.setData({ settings: result })
      wx.showToast({ title: '设置已保存', icon: 'success' })
    }
    catch (error) {
      this.setData(opportunityActionFailure(error, '设置保存失败'))
    }
    finally {
      this.setData({ saving: false })
    }
  },

  async recalculate() {
    if (!this.data.opportunityId || this.data.recalculating) {
      return
    }
    this.setData({ recalculating: true, message: '' })
    try {
      const result = await mipAdminModule.opportunities.recalculateMatching({
        opportunityId: this.data.opportunityId,
        idempotencyKey: requestKey('admin-matching-recalculate'),
      })
      wx.showToast({ title: `已生成 ${result.resultCount} 条`, icon: 'none' })
      await this.load()
    }
    catch (error) {
      this.setData(opportunityActionFailure(error, '撮合重算失败'))
    }
    finally {
      this.setData({ recalculating: false })
    }
  },
})
