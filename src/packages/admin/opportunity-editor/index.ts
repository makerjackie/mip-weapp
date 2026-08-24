import type { AdminOpportunityDetail, AdminOpportunityEditorOptions } from '../../../modules/mip-admin'
import { mipAdminModule } from '../../../modules/mip-admin'

interface Choice { id: string, label: string, selected?: boolean }

function deadlineIso(value: string) {
  return value ? new Date(`${value}T23:59:59+08:00`).toISOString() : null
}

Page({
  data: {
    state: 'loading',
    opportunityId: '',
    version: 0,
    options: null as AdminOpportunityEditorOptions | null,
    ownerIndex: 0,
    branchIndex: 0,
    cityIndex: 0,
    scopeType: 'PLATFORM' as 'PLATFORM' | 'BRANCH',
    title: '',
    valueSummary: '',
    targetSummary: '',
    description: '',
    deadlineDate: '',
    roles: [] as Array<Choice & { key: string }>,
    tags: [] as Choice[],
    saving: false,
    message: '',
  },
  onLoad(query: Record<string, string | undefined>) {
    this.setData({ opportunityId: String(query.id || '') })
    void this.load()
  },
  async load() {
    try {
      const [options, item] = await Promise.all([
        mipAdminModule.getOpportunityEditorOptions(true),
        this.data.opportunityId ? mipAdminModule.getOpportunity(this.data.opportunityId, true) : Promise.resolve(null),
      ])
      const detail = item as AdminOpportunityDetail | null
      const ownerIndex = Math.max(0, options.owners.findIndex(owner => owner.id === detail?.ownerUserId))
      const branchIndex = Math.max(0, options.branches.findIndex(branch => branch.id === detail?.branchId))
      const cityIndex = Math.max(0, options.cities.findIndex(city => city.id === detail?.cityTagId))
      this.setData({
        state: 'ready',
        options,
        ownerIndex,
        branchIndex,
        cityIndex,
        version: detail?.version || 0,
        scopeType: detail?.scopeType === 'BRANCH' ? 'BRANCH' : 'PLATFORM',
        title: detail?.title || '',
        valueSummary: detail?.valueSummary || '',
        targetSummary: detail?.targetSummary || '',
        description: detail?.description || '',
        deadlineDate: detail?.deadlineAt ? detail.deadlineAt.slice(0, 10) : '',
        roles: options.roles.map(role => ({ id: role.key, key: role.key, label: role.label, selected: detail?.roleKeys.includes(role.key) || false })),
        tags: options.tags.map(tag => ({ id: tag.id, label: tag.label, selected: detail?.tagIds.includes(tag.id) || false })),
      })
    }
    catch (error) {
      this.setData({ state: 'error', message: error instanceof Error ? error.message : '机会加载失败' })
    }
  },
  updateField(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    const field = String(event.currentTarget.dataset.field || '')
    if (['title', 'valueSummary', 'targetSummary', 'description'].includes(field)) {
      this.setData({ [field]: event.detail.value })
    }
  },
  chooseScope(event: WechatMiniprogram.TouchEvent) {
    this.setData({ scopeType: event.currentTarget.dataset.value === 'BRANCH' ? 'BRANCH' : 'PLATFORM' })
  },
  chooseOwner(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    this.setData({ ownerIndex: Number(event.detail.value) })
  },
  chooseBranch(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    this.setData({ branchIndex: Number(event.detail.value) })
  },
  chooseCity(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    this.setData({ cityIndex: Number(event.detail.value) })
  },
  chooseDeadline(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    this.setData({ deadlineDate: event.detail.value })
  },
  clearDeadline() {
    this.setData({ deadlineDate: '' })
  },
  toggleRole(event: WechatMiniprogram.TouchEvent) {
    const key = String(event.currentTarget.dataset.key || '')
    this.setData({ roles: this.data.roles.map(item => item.key === key ? { ...item, selected: !item.selected } : item) })
  },
  toggleTag(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id || '')
    this.setData({ tags: this.data.tags.map(item => item.id === id ? { ...item, selected: !item.selected } : item) })
  },
  async save() {
    if (this.data.saving || !this.data.options) {
      return
    }
    const owner = this.data.options.owners[this.data.ownerIndex]
    const branch = this.data.options.branches[this.data.branchIndex]
    const city = this.data.options.cities[this.data.cityIndex]
    if (!owner) {
      this.setData({ message: '请选择发布人' })
      return
    }
    this.setData({ saving: true, message: '' })
    try {
      const result = await mipAdminModule.mutate(() => mipAdminModule.gateway.saveOpportunity({
        opportunityId: this.data.opportunityId || undefined,
        expectedVersion: this.data.opportunityId ? this.data.version : undefined,
        draft: {
          ownerUserId: owner.id,
          scopeType: this.data.scopeType,
          branchId: this.data.scopeType === 'BRANCH' ? branch?.id : null,
          cityTagId: city?.id || null,
          title: this.data.title,
          valueSummary: this.data.valueSummary,
          targetSummary: this.data.targetSummary,
          description: this.data.description,
          deadlineAt: deadlineIso(this.data.deadlineDate),
          roleKeys: this.data.roles.filter(item => item.selected).map(item => item.key),
          tagIds: this.data.tags.filter(item => item.selected).map(item => item.id),
        },
      }))
      wx.showToast({ title: '机会已保存', icon: 'success' })
      void wx.redirectTo({ url: `/packages/admin/opportunity-detail/index?id=${result.id}` })
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '机会保存失败' })
    }
    finally { this.setData({ saving: false }) }
  },
})
