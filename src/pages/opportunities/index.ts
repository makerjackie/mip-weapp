import type { BranchId, CooperationRoleKey, OpportunityId } from '../../modules/mip'
import type { CooperationCardSummary } from '../../modules/mip-cooperation'
import type { ProtectedActionKey } from '../../modules/mip-identity'
import type {
  OpportunityCatalog,
  OpportunityFilter,
  OpportunitySummary,
} from '../../modules/mip-opportunities'
import { cooperationRoles } from '../../config/mip-catalogs'
import { cooperationModule } from '../../modules/mip-cooperation'
import { mipAccessPageUrl } from '../../modules/mip-identity'
import { mipIdentityModule } from '../../modules/mip-identity/client'
import { opportunityModule } from '../../modules/mip-opportunities'
import { caseNavigateTo, syncCaseNavigation } from '../../modules/platform/case-navigation'

type PageMode = 'opportunities' | 'cooperation'
interface CooperationCardView extends CooperationCardSummary { roleName: string }
interface TagView { id: string, label: string, selected: boolean }
interface IndustryGroupView { id: string, label: string, options: TagView[] }
interface CityOption { id: string, label: string }

const allRoleOptions = [{ key: '', name: '全部角色' }, ...cooperationRoles]
const nationwideOption: CityOption = { id: '', label: '全国' }

function cityOptionsFor(mode: PageMode, catalog: OpportunityCatalog): CityOption[] {
  return mode === 'cooperation'
    ? [nationwideOption, ...catalog.branches.map(item => ({
        id: item.id,
        label: item.name === item.cityName ? item.cityName : `${item.cityName} · ${item.name}`,
      }))]
    : [nationwideOption, ...catalog.cityTags.map(item => ({ id: item.id, label: item.label }))]
}

Page({
  data: {
    state: 'loading' as 'loading' | 'ready' | 'error',
    mode: 'opportunities' as PageMode,
    status: 'RECRUITING' as OpportunityFilter['status'],
    keywordInput: '',
    keyword: '',
    filterOpen: false,
    catalog: { branches: [], cityTags: [], industryGroups: [], industryTags: [], abilityTags: [] } as OpportunityCatalog,
    cityOptions: [nationwideOption] as CityOption[],
    cityIndex: 0,
    draftOpportunityCityTagId: '',
    draftCooperationBranchId: '' as '' | BranchId,
    selectedCityTagId: '',
    selectedCooperationBranchId: '' as '' | BranchId,
    roleOptions: allRoleOptions,
    draftRoleKey: '' as '' | CooperationRoleKey,
    selectedRoleKey: '' as '' | CooperationRoleKey,
    draftIndustryTagIds: [] as string[],
    selectedIndustryTagIds: [] as string[],
    draftAbilityTagIds: [] as string[],
    selectedAbilityTagIds: [] as string[],
    industryGroups: [] as IndustryGroupView[],
    abilityOptions: [] as TagView[],
    hasAppliedFilters: false,
    opportunities: [] as OpportunitySummary[],
    cooperationCards: [] as CooperationCardView[],
    nextCursor: '',
    loadingMore: false,
    message: '',
  },
  requestSequence: 0,
  resumeDestination: '',

  onShow() {
    syncCaseNavigation(this, 'pages/opportunities/index')
    const resume = mipIdentityModule.consumePendingResume('pages/opportunities/index')
    if (resume && this.resumeDestination) {
      const destination = this.resumeDestination
      this.resumeDestination = ''
      caseNavigateTo({ url: destination })
      return
    }
    this.resumeDestination = ''
    if (!this.data.catalog.cityTags.length) {
      void this.loadCatalogs()
    }
    void this.loadContent(true)
  },

  async loadCatalogs() {
    try {
      const catalog = await opportunityModule.getCatalogs()
      const cityOptions = cityOptionsFor(this.data.mode, catalog)
      const draftCityId = this.data.mode === 'cooperation'
        ? this.data.draftCooperationBranchId
        : this.data.draftOpportunityCityTagId
      this.setData({
        catalog,
        cityOptions,
        cityIndex: Math.max(0, cityOptions.findIndex(item => item.id === draftCityId)),
        industryGroups: catalog.industryGroups.map(group => ({
          id: group.id,
          label: group.label,
          options: group.options.map(item => ({
            id: item.id,
            label: item.label,
            selected: this.data.draftIndustryTagIds.includes(item.id),
          })),
        })),
        abilityOptions: catalog.abilityTags.map(item => ({
          id: item.id,
          label: item.label,
          selected: this.data.draftAbilityTagIds.includes(item.id),
        })),
      })
    }
    catch {
      // Filtering remains optional when the replaceable catalog is unavailable.
    }
  },

  async loadContent(reset = false) {
    const sequence = this.requestSequence + 1
    this.requestSequence = sequence
    if (reset) {
      this.setData({ state: 'loading', nextCursor: '', message: '' })
    }
    else {
      this.setData({ loadingMore: true, message: '' })
    }
    try {
      if (this.data.mode === 'opportunities') {
        const page = await opportunityModule.list({
          status: this.data.status,
          keyword: this.data.keyword,
          cityTagId: this.data.selectedCityTagId || undefined,
          roleKey: this.data.selectedRoleKey || undefined,
          industryTagIds: this.data.selectedIndustryTagIds,
          abilityTagIds: this.data.selectedAbilityTagIds,
          cursor: reset ? undefined : this.data.nextCursor || undefined,
          limit: 12,
        })
        if (sequence !== this.requestSequence || this.data.mode !== 'opportunities') {
          return
        }
        this.setData({
          state: 'ready',
          opportunities: reset ? page.items : [...this.data.opportunities, ...page.items],
          nextCursor: page.nextCursor || '',
        })
      }
      else {
        const page = await cooperationModule.list(
          {
            keyword: this.data.keyword,
            branchId: this.data.selectedCooperationBranchId || undefined,
            roleKey: this.data.selectedRoleKey || undefined,
            industryTagIds: this.data.selectedIndustryTagIds,
            cursor: reset ? undefined : this.data.nextCursor || undefined,
            limit: 16,
          },
        )
        if (sequence !== this.requestSequence || this.data.mode !== 'cooperation') {
          return
        }
        const cards = page.items.map(item => ({
          ...item,
          roleName: cooperationRoles.find(role => role.key === item.roleKey)?.name || item.roleKey,
        }))
        this.setData({
          state: 'ready',
          cooperationCards: reset ? cards : [...this.data.cooperationCards, ...cards],
          nextCursor: page.nextCursor || '',
        })
      }
    }
    catch (error) {
      if (sequence !== this.requestSequence) {
        return
      }
      const hasContent = this.data.mode === 'opportunities'
        ? this.data.opportunities.length > 0
        : this.data.cooperationCards.length > 0
      this.setData(hasContent
        ? { message: '内容更新失败，已保留当前结果。' }
        : {
            state: 'error',
            message: error instanceof Error ? error.message : '内容加载失败',
          })
    }
    finally {
      if (sequence === this.requestSequence) {
        this.setData({ loadingMore: false })
      }
    }
  },

  onReachBottom() {
    if (this.data.nextCursor && !this.data.loadingMore) {
      void this.loadContent(false)
    }
  },

  async onPullDownRefresh() {
    try {
      await Promise.all([this.loadCatalogs(), this.loadContent(true)])
    }
    finally {
      wx.stopPullDownRefresh()
    }
  },

  changeMode(event: WechatMiniprogram.TouchEvent) {
    const mode = String(event.currentTarget.dataset.mode || '') as PageMode
    if (!['opportunities', 'cooperation'].includes(mode) || mode === this.data.mode) {
      return
    }
    const cityOptions = cityOptionsFor(mode, this.data.catalog)
    const cityId = mode === 'cooperation'
      ? this.data.selectedCooperationBranchId
      : this.data.selectedCityTagId
    const hasAppliedFilters = Boolean(
      this.data.keyword
      || this.data.selectedRoleKey
      || this.data.selectedIndustryTagIds.length
      || (mode === 'cooperation' ? this.data.selectedCooperationBranchId : this.data.selectedCityTagId)
      || (mode === 'opportunities' && this.data.selectedAbilityTagIds.length),
    )
    this.setData({
      mode,
      cityOptions,
      cityIndex: Math.max(0, cityOptions.findIndex(item => item.id === cityId)),
      keywordInput: this.data.keyword,
      draftOpportunityCityTagId: this.data.selectedCityTagId,
      draftCooperationBranchId: this.data.selectedCooperationBranchId,
      draftRoleKey: this.data.selectedRoleKey,
      draftIndustryTagIds: [...this.data.selectedIndustryTagIds],
      draftAbilityTagIds: [...this.data.selectedAbilityTagIds],
      industryGroups: this.data.industryGroups.map(group => ({
        ...group,
        options: group.options.map(item => ({
          ...item,
          selected: this.data.selectedIndustryTagIds.includes(item.id),
        })),
      })),
      abilityOptions: this.data.abilityOptions.map(item => ({
        ...item,
        selected: this.data.selectedAbilityTagIds.includes(item.id),
      })),
      filterOpen: false,
      hasAppliedFilters,
      nextCursor: '',
      message: '',
    }, () => void this.loadContent(true))
  },

  changeStatus(event: WechatMiniprogram.TouchEvent) {
    const status = String(event.currentTarget.dataset.status || '') as OpportunityFilter['status']
    if (!['RECRUITING', 'COMPLETED'].includes(status) || status === this.data.status) {
      return
    }
    this.setData({ status })
    void this.loadContent(true)
  },

  onKeywordInput(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    this.setData({ keywordInput: event.detail.value })
  },

  onSearchConfirm() {
    this.applyFilters()
  },

  clearSearch() {
    const cityId = this.data.mode === 'cooperation'
      ? this.data.selectedCooperationBranchId
      : this.data.selectedCityTagId
    this.setData({
      keywordInput: '',
      draftOpportunityCityTagId: this.data.selectedCityTagId,
      draftCooperationBranchId: this.data.selectedCooperationBranchId,
      draftRoleKey: this.data.selectedRoleKey,
      draftIndustryTagIds: [...this.data.selectedIndustryTagIds],
      draftAbilityTagIds: [...this.data.selectedAbilityTagIds],
      cityIndex: Math.max(0, this.data.cityOptions.findIndex(item => item.id === cityId)),
      industryGroups: this.data.industryGroups.map(group => ({
        ...group,
        options: group.options.map(item => ({
          ...item,
          selected: this.data.selectedIndustryTagIds.includes(item.id),
        })),
      })),
      abilityOptions: this.data.abilityOptions.map(item => ({
        ...item,
        selected: this.data.selectedAbilityTagIds.includes(item.id),
      })),
      filterOpen: true,
    })
  },

  changeCity(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    const cityIndex = Number(event.detail.value)
    const option = this.data.cityOptions[cityIndex]
    if (!option) {
      return
    }
    this.setData(this.data.mode === 'cooperation'
      ? { cityIndex, draftCooperationBranchId: option.id as '' | BranchId, filterOpen: true }
      : { cityIndex, draftOpportunityCityTagId: option.id, filterOpen: true })
  },

  toggleFilters() {
    if (!this.data.filterOpen) {
      this.setData({ filterOpen: true })
      return
    }
    const cityId = this.data.mode === 'cooperation'
      ? this.data.selectedCooperationBranchId
      : this.data.selectedCityTagId
    this.setData({
      filterOpen: false,
      keywordInput: this.data.keyword,
      draftOpportunityCityTagId: this.data.selectedCityTagId,
      draftCooperationBranchId: this.data.selectedCooperationBranchId,
      draftRoleKey: this.data.selectedRoleKey,
      draftIndustryTagIds: [...this.data.selectedIndustryTagIds],
      draftAbilityTagIds: [...this.data.selectedAbilityTagIds],
      cityIndex: Math.max(0, this.data.cityOptions.findIndex(item => item.id === cityId)),
      industryGroups: this.data.industryGroups.map(group => ({
        ...group,
        options: group.options.map(item => ({
          ...item,
          selected: this.data.selectedIndustryTagIds.includes(item.id),
        })),
      })),
      abilityOptions: this.data.abilityOptions.map(item => ({
        ...item,
        selected: this.data.selectedAbilityTagIds.includes(item.id),
      })),
    })
  },

  chooseRole(event: WechatMiniprogram.TouchEvent) {
    const key = String(event.currentTarget.dataset.key || '') as '' | CooperationRoleKey
    if (key === this.data.draftRoleKey) {
      return
    }
    this.setData({ draftRoleKey: key })
  },

  toggleTag(event: WechatMiniprogram.TouchEvent) {
    const type = String(event.currentTarget.dataset.type || '')
    const id = String(event.currentTarget.dataset.id || '')
    if (!id || !['industry', 'ability'].includes(type)) {
      return
    }
    if (type === 'industry') {
      const next = this.data.draftIndustryTagIds.includes(id)
        ? this.data.draftIndustryTagIds.filter(item => item !== id)
        : [...this.data.draftIndustryTagIds, id]
      this.setData({
        draftIndustryTagIds: next,
        industryGroups: this.data.industryGroups.map(group => ({
          ...group,
          options: group.options.map(item => item.id === id ? { ...item, selected: !item.selected } : item),
        })),
      })
    }
    else {
      const next = this.data.draftAbilityTagIds.includes(id)
        ? this.data.draftAbilityTagIds.filter(item => item !== id)
        : [...this.data.draftAbilityTagIds, id]
      this.setData({
        draftAbilityTagIds: next,
        abilityOptions: this.data.abilityOptions.map(item => item.id === id ? { ...item, selected: !item.selected } : item),
      })
    }
  },

  resetFilters() {
    const cityOptions = cityOptionsFor(this.data.mode, this.data.catalog)
    this.setData({
      keywordInput: '',
      cityIndex: 0,
      cityOptions,
      draftOpportunityCityTagId: '',
      draftCooperationBranchId: '',
      draftRoleKey: '',
      draftIndustryTagIds: [],
      draftAbilityTagIds: [],
      industryGroups: this.data.industryGroups.map(group => ({
        ...group,
        options: group.options.map(item => ({ ...item, selected: false })),
      })),
      abilityOptions: this.data.abilityOptions.map(item => ({ ...item, selected: false })),
    })
  },

  applyFilters() {
    const keyword = this.data.keywordInput.trim()
    const selectedCityTagId = this.data.mode === 'opportunities'
      ? this.data.draftOpportunityCityTagId
      : this.data.selectedCityTagId
    const selectedCooperationBranchId = this.data.mode === 'cooperation'
      ? this.data.draftCooperationBranchId
      : this.data.selectedCooperationBranchId
    const selectedAbilityTagIds = this.data.mode === 'opportunities'
      ? this.data.draftAbilityTagIds
      : this.data.selectedAbilityTagIds
    const hasAppliedFilters = Boolean(
      keyword
      || this.data.draftRoleKey
      || this.data.draftIndustryTagIds.length
      || (this.data.mode === 'cooperation' ? selectedCooperationBranchId : selectedCityTagId)
      || (this.data.mode === 'opportunities' && selectedAbilityTagIds.length),
    )
    this.setData({
      keyword,
      selectedCityTagId,
      selectedCooperationBranchId,
      selectedRoleKey: this.data.draftRoleKey,
      selectedIndustryTagIds: [...this.data.draftIndustryTagIds],
      selectedAbilityTagIds,
      hasAppliedFilters,
      filterOpen: false,
    }, () => void this.loadContent(true))
  },

  clearAppliedFilters() {
    const cityOptions = cityOptionsFor(this.data.mode, this.data.catalog)
    this.setData({
      keywordInput: '',
      keyword: '',
      cityOptions,
      cityIndex: 0,
      draftOpportunityCityTagId: '',
      draftCooperationBranchId: '',
      selectedCityTagId: '',
      selectedCooperationBranchId: '',
      draftRoleKey: '',
      selectedRoleKey: '',
      draftIndustryTagIds: [],
      selectedIndustryTagIds: [],
      draftAbilityTagIds: [],
      selectedAbilityTagIds: [],
      industryGroups: this.data.industryGroups.map(group => ({
        ...group,
        options: group.options.map(item => ({ ...item, selected: false })),
      })),
      abilityOptions: this.data.abilityOptions.map(item => ({ ...item, selected: false })),
      hasAppliedFilters: false,
      filterOpen: false,
    }, () => void this.loadContent(true))
  },

  retryLoad() {
    void this.loadContent(true)
  },

  openOpportunity(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id || '') as OpportunityId
    if (id) {
      caseNavigateTo({ url: `/packages/member/mip-opportunities/detail/index?id=${encodeURIComponent(id)}` })
    }
  },

  openCooperationCard(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id || '')
    if (id) {
      caseNavigateTo({ url: `/packages/member/mip-cooperation/detail/index?id=${encodeURIComponent(id)}` })
    }
  },

  async openProtected(destination: string, action: ProtectedActionKey) {
    this.resumeDestination = destination
    try {
      const session = await mipIdentityModule.beginProtectedAction({
        action,
        source: { navigation: 'navigateBack' },
      })
      if (session.decision.ready) {
        this.resumeDestination = ''
        caseNavigateTo({ url: destination })
        return
      }
      caseNavigateTo({ url: mipAccessPageUrl(session.token) })
    }
    catch {
      this.resumeDestination = ''
      this.setData({ message: '身份状态暂时无法确认，请稍后重试。' })
    }
  },

  publish() {
    const url = this.data.mode === 'opportunities'
      ? '/packages/member/mip-opportunities/editor/index'
      : '/packages/member/mip-cooperation/editor/index'
    void this.openProtected(url, 'PUBLISH_OPPORTUNITY')
  },

  openMine() {
    const url = this.data.mode === 'opportunities'
      ? '/packages/member/mip-opportunities/mine/index'
      : '/packages/member/mip-cooperation/list/index?mine=1'
    void this.openProtected(url, 'INTERACT')
  },

  openCases() {
    caseNavigateTo({ url: '/packages/member/mip-cases/list/index' })
  },
})
