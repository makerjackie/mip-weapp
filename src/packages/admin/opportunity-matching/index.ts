import type { AdminMatchingRequest, AdminMatchingSettings, AdminOpportunity } from '../../../modules/mip-admin'
import { hasCapability, mipAdminModule } from '../../../modules/mip-admin'
import { formatLocalDateTime } from '../../../utils/date'
import { opportunityActionFailure } from '../opportunities/action-state'
import { adminLoadFailure } from '../shared/page-state'

type PageState = 'loading' | 'ready' | 'error' | 'forbidden'
type MatchingOpportunityOption = Pick<AdminOpportunity, 'id' | 'title' | 'ownerNickname' | 'branchName' | 'cityName'> & {
  updatedText: string
}

function matchingOpportunityOption(item: AdminOpportunity): MatchingOpportunityOption {
  return {
    id: item.id,
    title: item.title,
    ownerNickname: item.ownerNickname,
    branchName: item.branchName,
    cityName: item.cityName,
    updatedText: item.updatedAt ? formatLocalDateTime(item.updatedAt) : '未记录',
  }
}

function matchingOpportunityListInput(query: string, cursor?: string | null) {
  return {
    cursor: cursor || undefined,
    limit: 20,
    filters: {
      query: query.trim(),
      status: 'PUBLISHED',
    },
  }
}

function requestKey(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`
}

Page({
  opportunityOptionRequestSequence: 0,

  data: {
    state: 'loading' as PageState,
    branchId: '',
    settings: null as AdminMatchingSettings | null,
    requests: [] as AdminMatchingRequest[],
    talentMinScore: '35',
    projectMinScore: '30',
    maximumCandidates: '100',
    externalProviderEnabled: false,
    opportunityQuery: '',
    opportunityOptions: [] as MatchingOpportunityOption[],
    opportunityNextCursor: null as string | null,
    opportunityOptionsLoading: false,
    opportunityOptionsMessage: '',
    selectedOpportunity: null as MatchingOpportunityOption | null,
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
      await this.loadOpportunityOptions(true)
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

  updateOpportunityQuery(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    this.setData({ opportunityQuery: event.detail.value })
  },

  searchOpportunities() {
    void this.loadOpportunityOptions(true)
  },

  clearOpportunitySearch() {
    this.setData({ opportunityQuery: '' })
    void this.loadOpportunityOptions(true)
  },

  async loadOpportunityOptions(force = false, append = false) {
    if (append && this.data.opportunityOptionsLoading) {
      return
    }
    const cursor = append ? this.data.opportunityNextCursor : null
    if (append && !cursor) {
      return
    }
    const requestSequence = this.opportunityOptionRequestSequence + 1
    this.opportunityOptionRequestSequence = requestSequence
    if (!append) {
      this.setData({
        opportunityOptions: [],
        opportunityNextCursor: null,
        selectedOpportunity: null,
      })
    }
    this.setData({
      opportunityOptionsLoading: true,
      opportunityOptionsMessage: '',
    })
    try {
      const response = await mipAdminModule.opportunities.list(
        matchingOpportunityListInput(this.data.opportunityQuery, cursor),
        force,
      )
      if (requestSequence !== this.opportunityOptionRequestSequence) {
        return
      }
      const options = response.items.map(matchingOpportunityOption)
      this.setData({
        opportunityOptions: append ? this.data.opportunityOptions.concat(options) : options,
        opportunityNextCursor: response.nextCursor || null,
      })
    }
    catch (error) {
      if (requestSequence !== this.opportunityOptionRequestSequence) {
        return
      }
      this.setData({
        opportunityOptionsMessage: error instanceof Error ? error.message : '机会列表加载失败',
      })
    }
    finally {
      if (requestSequence === this.opportunityOptionRequestSequence) {
        this.setData({ opportunityOptionsLoading: false })
      }
    }
  },

  loadMoreOpportunityOptions() {
    void this.loadOpportunityOptions(false, true)
  },

  chooseOpportunity(event: WechatMiniprogram.TouchEvent) {
    const opportunityId = String(event.currentTarget.dataset.id || '')
    const selectedOpportunity = this.data.opportunityOptions.find(item => item.id === opportunityId) || null
    this.setData({ selectedOpportunity, opportunityOptionsMessage: '' })
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
    const selectedOpportunity = this.data.selectedOpportunity
    if (!selectedOpportunity || this.data.recalculating) {
      if (!selectedOpportunity) {
        this.setData({ opportunityOptionsMessage: '请选择要重新计算的机会' })
      }
      return
    }
    this.setData({ recalculating: true, message: '' })
    try {
      const result = await mipAdminModule.opportunities.recalculateMatching({
        opportunityId: selectedOpportunity.id,
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
