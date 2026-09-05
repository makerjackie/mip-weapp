import type { CatalogSelectorGroup } from '../../components/catalog-selector/model'
import type { BranchId, CooperationRoleKey, OpportunityId } from '../../modules/mip'
import type { CooperationTalentSummary } from '../../modules/mip-cooperation'
import type { ProtectedActionKey } from '../../modules/mip-identity'
import type {
  OpportunityCatalog,
  OpportunityFilter,
  OpportunityLocationType,
  OpportunitySummary,
} from '../../modules/mip-opportunities'
import { catalogSelectorView } from '../../components/catalog-selector/model'
import { cooperationRoles } from '../../config/mip-catalogs'
import { cooperationModule } from '../../modules/mip-cooperation'
import { mergeCooperationTalents } from '../../modules/mip-cooperation/validation'
import { mipAccessPageUrl } from '../../modules/mip-identity'
import { mipIdentityModule } from '../../modules/mip-identity/client'
import { groupedCityBranches, opportunityModule } from '../../modules/mip-opportunities'
import { caseNavigateTo, syncCaseNavigation } from '../../platform/navigation/client'

type PageMode = 'opportunities' | 'cooperation'
interface CooperationTalentView extends Omit<CooperationTalentSummary, 'cards'> {
  cards: Array<CooperationTalentSummary['cards'][number] & { roleName: string }>
  roleNames: string[]
  primaryPositioning: string
  primaryTargetSummary: string
}
interface TagView { id: string, label: string, selected: boolean, popular?: boolean }
interface IndustryGroupView { id: string, label: string, options: TagView[] }
interface CityOption { id: string, label: string, popular?: boolean }
interface AppliedFilterChip { key: string, label: string }
type LocationPreset = 'ALL' | OpportunityLocationType

const allRoleOptions = [{ key: '', name: '全部角色' }, ...cooperationRoles]
const nationwideOption: CityOption = { id: '', label: '全国' }
const OPPORTUNITY_REFRESH_INTERVAL_MS = 30_000

function locationPreset(types: OpportunityLocationType[]): LocationPreset {
  if (types.includes('CITY')) {
    return 'CITY'
  }
  if (types.includes('NATIONAL')) {
    return 'NATIONAL'
  }
  if (types.includes('REMOTE')) {
    return 'REMOTE'
  }
  return 'ALL'
}

function locationTypesForPreset(preset: LocationPreset): OpportunityLocationType[] {
  return preset === 'ALL' ? [] : [preset]
}

function yuanFromCents(value: number) {
  return Number.isInteger(value / 100) ? String(value / 100) : (value / 100).toFixed(2)
}

function appliedFilterPresentation(input: {
  mode: PageMode
  cityOptions: CityOption[]
  selectedCityTagId: string
  selectedCooperationBranchId: string
  selectedRoleKey: '' | CooperationRoleKey
  selectedIndustryTagIds: string[]
  selectedAbilityTagIds: string[]
  selectedLocationTypes: OpportunityLocationType[]
  selectedMinAmountCents?: number
  selectedMaxAmountCents?: number
}) {
  const chips: AppliedFilterChip[] = []
  const cityId = input.mode === 'opportunities'
    ? input.selectedCityTagId
    : input.selectedCooperationBranchId
  const cityLabel = input.cityOptions.find(item => item.id === cityId)?.label
  const selectedLocation = input.selectedLocationTypes[0]
  const locationFilterLabel = input.mode === 'cooperation'
    ? (cityLabel || '全国')
    : selectedLocation === 'REMOTE'
      ? '远程'
      : selectedLocation === 'CITY'
        ? (cityLabel || '城市')
        : selectedLocation === 'NATIONAL' ? '全国' : '不限'

  if (input.mode === 'opportunities') {
    const locationLabels = input.selectedLocationTypes.map(type => (
      type === 'CITY' ? (cityLabel || '城市') : type === 'NATIONAL' ? '全国' : '远程'
    ))
    if (locationLabels.length) {
      chips.push({ key: 'location', label: locationLabels.join('、') })
    }
    else if (cityLabel) {
      chips.push({ key: 'location', label: cityLabel })
    }
  }
  else if (cityLabel) {
    chips.push({ key: 'branch', label: cityLabel })
  }

  const roleName = cooperationRoles.find(item => item.key === input.selectedRoleKey)?.name
  if (roleName) {
    chips.push({ key: 'role', label: roleName })
  }
  if (input.selectedIndustryTagIds.length) {
    chips.push({ key: 'industry', label: `${input.selectedIndustryTagIds.length} 个行业` })
  }
  if (input.mode === 'opportunities' && input.selectedAbilityTagIds.length) {
    chips.push({ key: 'ability', label: `${input.selectedAbilityTagIds.length} 项能力` })
  }
  if (input.mode === 'opportunities'
    && (input.selectedMinAmountCents !== undefined || input.selectedMaxAmountCents !== undefined)) {
    const label = input.selectedMinAmountCents !== undefined && input.selectedMaxAmountCents !== undefined
      ? `¥${yuanFromCents(input.selectedMinAmountCents)}–${yuanFromCents(input.selectedMaxAmountCents)}`
      : input.selectedMinAmountCents !== undefined
        ? `¥${yuanFromCents(input.selectedMinAmountCents)}以上`
        : `¥${yuanFromCents(input.selectedMaxAmountCents || 0)}以下`
    chips.push({ key: 'amount', label })
  }

  return {
    locationFilterLabel,
    appliedFilterChips: chips,
    appliedFilterCount: chips.length,
  }
}

function amountRange(minimum: string, maximum: string) {
  const toCents = (value: string) => {
    if (!value.trim()) {
      return undefined
    }
    const yuan = Number(value)
    const cents = Math.round(yuan * 100)
    if (!Number.isFinite(yuan) || yuan < 0 || !Number.isSafeInteger(cents)) {
      throw new Error('请填写有效的金额区间。')
    }
    return cents
  }
  const minAmountCents = toCents(minimum)
  const maxAmountCents = toCents(maximum)
  if (minAmountCents !== undefined && maxAmountCents !== undefined && minAmountCents > maxAmountCents) {
    throw new Error('最低金额不能大于最高金额。')
  }
  return { minAmountCents, maxAmountCents }
}

function cityOptionsFor(mode: PageMode, catalog: OpportunityCatalog): CityOption[] {
  const branchGroup = groupedCityBranches(catalog.branches, catalog.cityTags)[0]
  return mode === 'cooperation'
    ? [nationwideOption, ...(branchGroup?.options || [])]
    : [nationwideOption, ...catalog.cityTags.map(item => ({
        id: item.id,
        label: item.label,
        popular: item.popular,
      }))]
}

function cityGroupsFor(mode: PageMode, cityOptions: CityOption[]): CatalogSelectorGroup[] {
  return [{
    id: mode === 'cooperation' ? 'city-branches' : 'cities',
    label: mode === 'cooperation' ? '城市分会' : '城市',
    options: cityOptions.slice(1),
  }]
}

Page({
  data: {
    state: 'loading' as 'loading' | 'ready' | 'error',
    mode: 'opportunities' as PageMode,
    status: 'RECRUITING' as OpportunityFilter['status'],
    keywordInput: '',
    keyword: '',
    filterOpen: false,
    industryPickerOpen: false,
    expandedIndustryGroupId: '',
    moreFiltersOpen: false,
    catalog: { branches: [], cityTags: [], industryGroups: [], industryTags: [], abilityTags: [] } as OpportunityCatalog,
    cityOptions: [nationwideOption] as CityOption[],
    cityGroups: [] as CatalogSelectorGroup[],
    citySelectionIds: [] as string[],
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
    draftLocationTypes: [] as OpportunityLocationType[],
    selectedLocationTypes: [] as OpportunityLocationType[],
    draftLocationPreset: 'ALL' as LocationPreset,
    draftMinAmountYuan: '',
    draftMaxAmountYuan: '',
    selectedMinAmountCents: undefined as number | undefined,
    selectedMaxAmountCents: undefined as number | undefined,
    industryGroups: [] as IndustryGroupView[],
    popularIndustryOptions: [] as TagView[],
    abilityOptions: [] as TagView[],
    hasAppliedFilters: false,
    locationFilterLabel: '不限',
    appliedFilterCount: 0,
    appliedFilterChips: [] as AppliedFilterChip[],
    opportunities: [] as OpportunitySummary[],
    cooperationTalents: [] as CooperationTalentView[],
    nextCursor: '',
    loadingMore: false,
    message: '',
  },
  requestSequence: 0,
  resumeDestination: '',
  lastSuccessfulRefreshAt: 0,

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
    const refreshIsDue = Date.now() - this.lastSuccessfulRefreshAt >= OPPORTUNITY_REFRESH_INTERVAL_MS
    if (this.data.state !== 'ready' || refreshIsDue) {
      void this.loadContent(true, { preserveContent: this.data.state === 'ready' })
    }
  },

  async loadCatalogs() {
    try {
      const catalog = await opportunityModule.getCatalogs()
      const cityOptions = cityOptionsFor(this.data.mode, catalog)
      const industryView = catalogSelectorView(catalog.industryGroups, this.data.draftIndustryTagIds)
      const draftCityId = this.data.mode === 'cooperation'
        ? this.data.draftCooperationBranchId
        : this.data.draftOpportunityCityTagId
      this.setData({
        catalog,
        cityOptions,
        cityGroups: cityGroupsFor(this.data.mode, cityOptions),
        citySelectionIds: draftCityId ? [draftCityId] : [],
        cityIndex: Math.max(0, cityOptions.findIndex(item => item.id === draftCityId)),
        industryGroups: industryView.viewGroups,
        popularIndustryOptions: industryView.popularOptions,
        abilityOptions: catalog.abilityTags.map(item => ({
          id: item.id,
          label: item.label,
          selected: this.data.draftAbilityTagIds.includes(item.id),
        })),
      }, () => this.refreshAppliedFilterPresentation())
    }
    catch {
      // Filtering remains optional when the replaceable catalog is unavailable.
    }
  },

  async loadContent(reset = false, options: { preserveContent?: boolean } = {}) {
    const sequence = this.requestSequence + 1
    this.requestSequence = sequence
    if (reset && !options.preserveContent) {
      this.setData({ state: 'loading', nextCursor: '', message: '' })
    }
    else if (reset) {
      this.setData({ nextCursor: '', message: '' })
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
          locationTypes: this.data.selectedLocationTypes,
          minAmountCents: this.data.selectedMinAmountCents,
          maxAmountCents: this.data.selectedMaxAmountCents,
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
        this.lastSuccessfulRefreshAt = Date.now()
      }
      else {
        const page = await cooperationModule.listTalents(
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
        const talents = page.items.map((item): CooperationTalentView => {
          const cards = item.cards.map(card => ({
            ...card,
            roleName: cooperationRoles.find(role => role.key === card.roleKey)?.name || card.roleKey,
          }))
          return {
            ...item,
            cards,
            roleNames: cards.map(card => card.roleName),
            primaryPositioning: cards[0]?.positioning || '',
            primaryTargetSummary: cards[0]?.targetSummary || '',
          }
        })
        this.setData({
          state: 'ready',
          cooperationTalents: reset
            ? talents
            : mergeCooperationTalents(this.data.cooperationTalents, talents),
          nextCursor: page.nextCursor || '',
        })
        this.lastSuccessfulRefreshAt = Date.now()
      }
    }
    catch (error) {
      if (sequence !== this.requestSequence) {
        return
      }
      const hasContent = this.data.mode === 'opportunities'
        ? this.data.opportunities.length > 0
        : this.data.cooperationTalents.length > 0
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
    if (!this.data.filterOpen && this.data.nextCursor && !this.data.loadingMore) {
      void this.loadContent(false)
    }
  },

  async onPullDownRefresh() {
    if (this.data.filterOpen) {
      wx.stopPullDownRefresh()
      return
    }
    try {
      await Promise.all([this.loadCatalogs(), this.loadContent(true, { preserveContent: this.data.state === 'ready' })])
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
    const industryView = catalogSelectorView(this.data.catalog.industryGroups, this.data.selectedIndustryTagIds)
    const selectedLocationPreset = locationPreset(this.data.selectedLocationTypes)
    const hasAppliedFilters = Boolean(
      this.data.keyword
      || this.data.selectedRoleKey
      || this.data.selectedIndustryTagIds.length
      || (mode === 'cooperation' ? this.data.selectedCooperationBranchId : this.data.selectedCityTagId)
      || (mode === 'opportunities' && (
        this.data.selectedAbilityTagIds.length
        || this.data.selectedLocationTypes.length
        || this.data.selectedMinAmountCents !== undefined
        || this.data.selectedMaxAmountCents !== undefined
      )),
    )
    this.setData({
      mode,
      cityOptions,
      cityGroups: cityGroupsFor(mode, cityOptions),
      citySelectionIds: cityId ? [cityId] : [],
      cityIndex: Math.max(0, cityOptions.findIndex(item => item.id === cityId)),
      keywordInput: this.data.keyword,
      draftOpportunityCityTagId: this.data.selectedCityTagId,
      draftCooperationBranchId: this.data.selectedCooperationBranchId,
      draftRoleKey: this.data.selectedRoleKey,
      draftIndustryTagIds: [...this.data.selectedIndustryTagIds],
      draftAbilityTagIds: [...this.data.selectedAbilityTagIds],
      draftLocationTypes: locationTypesForPreset(selectedLocationPreset),
      draftLocationPreset: selectedLocationPreset,
      draftMinAmountYuan: this.data.selectedMinAmountCents === undefined ? '' : yuanFromCents(this.data.selectedMinAmountCents),
      draftMaxAmountYuan: this.data.selectedMaxAmountCents === undefined ? '' : yuanFromCents(this.data.selectedMaxAmountCents),
      industryGroups: industryView.viewGroups,
      popularIndustryOptions: industryView.popularOptions,
      abilityOptions: this.data.abilityOptions.map(item => ({
        ...item,
        selected: this.data.selectedAbilityTagIds.includes(item.id),
      })),
      filterOpen: false,
      industryPickerOpen: false,
      expandedIndustryGroupId: '',
      moreFiltersOpen: false,
      hasAppliedFilters,
      nextCursor: '',
      message: '',
    }, () => {
      this.refreshAppliedFilterPresentation()
      void this.loadContent(true)
    })
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
    const keyword = this.data.keywordInput.trim()
    this.setData({
      keyword,
      keywordInput: keyword,
      hasAppliedFilters: Boolean(keyword || this.data.appliedFilterCount),
    }, () => void this.loadContent(true))
  },

  clearSearch() {
    if (!this.data.keywordInput && !this.data.keyword) {
      return
    }
    this.setData({
      keywordInput: '',
      keyword: '',
      hasAppliedFilters: this.data.appliedFilterCount > 0,
    }, () => void this.loadContent(true))
  },

  changeCity(event: WechatMiniprogram.CustomEvent<{ selectedIds: string[] }>) {
    const cityId = event.detail.selectedIds[0] || ''
    const cityIndex = Math.max(0, this.data.cityOptions.findIndex(item => item.id === cityId))
    const option = this.data.cityOptions[cityIndex]
    if (!option) {
      return
    }
    this.setData(this.data.mode === 'cooperation'
      ? {
          cityIndex,
          citySelectionIds: cityId ? [cityId] : [],
          draftCooperationBranchId: option.id as '' | BranchId,
          filterOpen: true,
        }
      : {
          cityIndex,
          citySelectionIds: cityId ? [cityId] : [],
          draftOpportunityCityTagId: option.id,
          draftLocationTypes: ['CITY'] as OpportunityLocationType[],
          draftLocationPreset: 'CITY' as LocationPreset,
          filterOpen: true,
        })
  },

  changeIndustry(event: WechatMiniprogram.CustomEvent<{ selectedIds: string[] }>) {
    const draftIndustryTagIds = event.detail.selectedIds.slice(0, 8)
    const industryView = catalogSelectorView(this.data.catalog.industryGroups, draftIndustryTagIds)
    this.setData({
      draftIndustryTagIds,
      industryGroups: industryView.viewGroups,
      popularIndustryOptions: industryView.popularOptions,
    })
  },

  toggleFilters() {
    if (!this.data.filterOpen) {
      const cityId = this.data.mode === 'cooperation'
        ? this.data.selectedCooperationBranchId
        : this.data.selectedCityTagId
      const industryView = catalogSelectorView(this.data.catalog.industryGroups, this.data.selectedIndustryTagIds)
      const selectedLocationPreset = locationPreset(this.data.selectedLocationTypes)
      this.setData({
        filterOpen: true,
        industryPickerOpen: false,
        expandedIndustryGroupId: '',
        moreFiltersOpen: Boolean(
          this.data.selectedAbilityTagIds.length
          || this.data.selectedMinAmountCents !== undefined
          || this.data.selectedMaxAmountCents !== undefined,
        ),
        draftOpportunityCityTagId: this.data.selectedCityTagId,
        draftCooperationBranchId: this.data.selectedCooperationBranchId,
        draftRoleKey: this.data.selectedRoleKey,
        draftIndustryTagIds: [...this.data.selectedIndustryTagIds],
        draftAbilityTagIds: [...this.data.selectedAbilityTagIds],
        draftLocationTypes: locationTypesForPreset(selectedLocationPreset),
        draftLocationPreset: selectedLocationPreset,
        draftMinAmountYuan: this.data.selectedMinAmountCents === undefined ? '' : yuanFromCents(this.data.selectedMinAmountCents),
        draftMaxAmountYuan: this.data.selectedMaxAmountCents === undefined ? '' : yuanFromCents(this.data.selectedMaxAmountCents),
        cityIndex: Math.max(0, this.data.cityOptions.findIndex(item => item.id === cityId)),
        citySelectionIds: cityId ? [cityId] : [],
        industryGroups: industryView.viewGroups,
        popularIndustryOptions: industryView.popularOptions,
        abilityOptions: this.data.abilityOptions.map(item => ({
          ...item,
          selected: this.data.selectedAbilityTagIds.includes(item.id),
        })),
        message: '',
      })
      return
    }
    const cityId = this.data.mode === 'cooperation'
      ? this.data.selectedCooperationBranchId
      : this.data.selectedCityTagId
    const industryView = catalogSelectorView(this.data.catalog.industryGroups, this.data.selectedIndustryTagIds)
    this.setData({
      filterOpen: false,
      draftOpportunityCityTagId: this.data.selectedCityTagId,
      draftCooperationBranchId: this.data.selectedCooperationBranchId,
      draftRoleKey: this.data.selectedRoleKey,
      draftIndustryTagIds: [...this.data.selectedIndustryTagIds],
      draftAbilityTagIds: [...this.data.selectedAbilityTagIds],
      draftLocationTypes: locationTypesForPreset(locationPreset(this.data.selectedLocationTypes)),
      draftLocationPreset: locationPreset(this.data.selectedLocationTypes),
      draftMinAmountYuan: this.data.selectedMinAmountCents === undefined ? '' : yuanFromCents(this.data.selectedMinAmountCents),
      draftMaxAmountYuan: this.data.selectedMaxAmountCents === undefined ? '' : yuanFromCents(this.data.selectedMaxAmountCents),
      cityIndex: Math.max(0, this.data.cityOptions.findIndex(item => item.id === cityId)),
      citySelectionIds: cityId ? [cityId] : [],
      industryGroups: industryView.viewGroups,
      popularIndustryOptions: industryView.popularOptions,
      abilityOptions: this.data.abilityOptions.map(item => ({
        ...item,
        selected: this.data.selectedAbilityTagIds.includes(item.id),
      })),
      industryPickerOpen: false,
      expandedIndustryGroupId: '',
      moreFiltersOpen: false,
      message: '',
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
      const selected = this.data.draftIndustryTagIds.includes(id)
      if (!selected && this.data.draftIndustryTagIds.length >= 8) {
        this.setData({ message: '行业最多选择 8 项。' })
        return
      }
      const draftIndustryTagIds = selected
        ? this.data.draftIndustryTagIds.filter(item => item !== id)
        : [...this.data.draftIndustryTagIds, id]
      const industryView = catalogSelectorView(this.data.catalog.industryGroups, draftIndustryTagIds)
      this.setData({
        draftIndustryTagIds,
        industryGroups: industryView.viewGroups,
        popularIndustryOptions: industryView.popularOptions,
        message: '',
      })
      return
    }
    const next = this.data.draftAbilityTagIds.includes(id)
      ? this.data.draftAbilityTagIds.filter(item => item !== id)
      : [...this.data.draftAbilityTagIds, id]
    this.setData({
      draftAbilityTagIds: next,
      abilityOptions: this.data.abilityOptions.map(item => item.id === id ? { ...item, selected: !item.selected } : item),
    })
  },

  chooseLocationPreset(event: WechatMiniprogram.TouchEvent) {
    const preset = String(event.currentTarget.dataset.preset || '') as LocationPreset
    if (!['ALL', 'CITY', 'NATIONAL', 'REMOTE'].includes(preset)) {
      return
    }
    const keepsCity = preset === 'CITY'
    const cityId = keepsCity ? this.data.draftOpportunityCityTagId : ''
    this.setData({
      draftLocationPreset: preset,
      draftLocationTypes: locationTypesForPreset(preset),
      draftOpportunityCityTagId: cityId,
      citySelectionIds: cityId ? [cityId] : [],
      cityIndex: keepsCity ? Math.max(0, this.data.cityOptions.findIndex(item => item.id === cityId)) : 0,
    })
  },

  toggleIndustryPicker() {
    this.setData({
      industryPickerOpen: !this.data.industryPickerOpen,
      expandedIndustryGroupId: this.data.industryPickerOpen ? '' : this.data.expandedIndustryGroupId,
    })
  },

  toggleIndustryGroup(event: WechatMiniprogram.TouchEvent) {
    const groupId = String(event.currentTarget.dataset.groupId || '')
    if (!this.data.industryGroups.some(group => group.id === groupId)) {
      return
    }
    this.setData({
      expandedIndustryGroupId: this.data.expandedIndustryGroupId === groupId ? '' : groupId,
    })
  },

  clearIndustrySelection() {
    if (!this.data.draftIndustryTagIds.length) {
      return
    }
    const industryView = catalogSelectorView(this.data.catalog.industryGroups, [])
    this.setData({
      draftIndustryTagIds: [],
      industryGroups: industryView.viewGroups,
      popularIndustryOptions: industryView.popularOptions,
      message: '',
    })
  },

  toggleMoreFilters() {
    this.setData({ moreFiltersOpen: !this.data.moreFiltersOpen })
  },

  updateAmount(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    const field = String(event.currentTarget.dataset.field || '')
    if (field === 'draftMinAmountYuan' || field === 'draftMaxAmountYuan') {
      this.setData({ [field]: event.detail.value })
    }
  },

  resetFilters() {
    const cityOptions = cityOptionsFor(this.data.mode, this.data.catalog)
    const industryView = catalogSelectorView(this.data.catalog.industryGroups, [])
    this.setData({
      cityIndex: 0,
      cityOptions,
      cityGroups: cityGroupsFor(this.data.mode, cityOptions),
      citySelectionIds: [],
      draftOpportunityCityTagId: '',
      draftCooperationBranchId: '',
      draftRoleKey: '',
      draftIndustryTagIds: [],
      draftAbilityTagIds: [],
      draftLocationTypes: [],
      draftLocationPreset: 'ALL',
      draftMinAmountYuan: '',
      draftMaxAmountYuan: '',
      industryGroups: industryView.viewGroups,
      popularIndustryOptions: industryView.popularOptions,
      abilityOptions: this.data.abilityOptions.map(item => ({ ...item, selected: false })),
      industryPickerOpen: false,
      expandedIndustryGroupId: '',
      moreFiltersOpen: false,
      message: '',
    })
  },

  applyFilters() {
    let amounts: ReturnType<typeof amountRange>
    try {
      amounts = amountRange(this.data.draftMinAmountYuan, this.data.draftMaxAmountYuan)
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '金额区间无效' })
      return
    }
    const keyword = this.data.keywordInput.trim()
    const selectedCityTagId = this.data.mode === 'opportunities'
      ? this.data.draftLocationPreset === 'CITY' ? this.data.draftOpportunityCityTagId : ''
      : this.data.selectedCityTagId
    const selectedCooperationBranchId = this.data.mode === 'cooperation'
      ? this.data.draftCooperationBranchId
      : this.data.selectedCooperationBranchId
    const selectedAbilityTagIds = this.data.mode === 'opportunities'
      ? this.data.draftAbilityTagIds
      : this.data.selectedAbilityTagIds
    const selectedLocationTypes = this.data.mode === 'opportunities'
      ? locationTypesForPreset(this.data.draftLocationPreset)
      : this.data.selectedLocationTypes
    const selectedMinAmountCents = this.data.mode === 'opportunities'
      ? amounts.minAmountCents
      : this.data.selectedMinAmountCents
    const selectedMaxAmountCents = this.data.mode === 'opportunities'
      ? amounts.maxAmountCents
      : this.data.selectedMaxAmountCents
    const presentation = appliedFilterPresentation({
      mode: this.data.mode,
      cityOptions: this.data.cityOptions,
      selectedCityTagId,
      selectedCooperationBranchId,
      selectedRoleKey: this.data.draftRoleKey,
      selectedIndustryTagIds: this.data.draftIndustryTagIds,
      selectedAbilityTagIds,
      selectedLocationTypes,
      selectedMinAmountCents,
      selectedMaxAmountCents,
    })
    this.setData({
      keyword,
      keywordInput: keyword,
      selectedCityTagId,
      selectedCooperationBranchId,
      selectedRoleKey: this.data.draftRoleKey,
      selectedIndustryTagIds: [...this.data.draftIndustryTagIds],
      selectedAbilityTagIds: [...selectedAbilityTagIds],
      selectedLocationTypes,
      selectedMinAmountCents,
      selectedMaxAmountCents,
      ...presentation,
      hasAppliedFilters: Boolean(keyword || presentation.appliedFilterCount),
      filterOpen: false,
      industryPickerOpen: false,
      expandedIndustryGroupId: '',
      moreFiltersOpen: false,
      message: '',
    }, () => void this.loadContent(true))
  },

  clearAppliedFilters() {
    const cityOptions = cityOptionsFor(this.data.mode, this.data.catalog)
    const industryView = catalogSelectorView(this.data.catalog.industryGroups, [])
    this.setData({
      keywordInput: '',
      keyword: '',
      cityOptions,
      cityGroups: cityGroupsFor(this.data.mode, cityOptions),
      cityIndex: 0,
      citySelectionIds: [],
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
      draftLocationTypes: [],
      selectedLocationTypes: [],
      draftLocationPreset: 'ALL',
      draftMinAmountYuan: '',
      draftMaxAmountYuan: '',
      selectedMinAmountCents: undefined,
      selectedMaxAmountCents: undefined,
      industryGroups: industryView.viewGroups,
      popularIndustryOptions: industryView.popularOptions,
      abilityOptions: this.data.abilityOptions.map(item => ({ ...item, selected: false })),
      hasAppliedFilters: false,
      locationFilterLabel: this.data.mode === 'cooperation' ? '全国' : '不限',
      appliedFilterCount: 0,
      appliedFilterChips: [],
      filterOpen: false,
      industryPickerOpen: false,
      expandedIndustryGroupId: '',
      moreFiltersOpen: false,
      message: '',
    }, () => void this.loadContent(true))
  },

  refreshAppliedFilterPresentation() {
    const presentation = appliedFilterPresentation({
      mode: this.data.mode,
      cityOptions: this.data.cityOptions,
      selectedCityTagId: this.data.selectedCityTagId,
      selectedCooperationBranchId: this.data.selectedCooperationBranchId,
      selectedRoleKey: this.data.selectedRoleKey,
      selectedIndustryTagIds: this.data.selectedIndustryTagIds,
      selectedAbilityTagIds: this.data.selectedAbilityTagIds,
      selectedLocationTypes: this.data.selectedLocationTypes,
      selectedMinAmountCents: this.data.selectedMinAmountCents,
      selectedMaxAmountCents: this.data.selectedMaxAmountCents,
    })
    this.setData({
      ...presentation,
      hasAppliedFilters: Boolean(this.data.keyword || presentation.appliedFilterCount),
    })
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

  openTalent(event: WechatMiniprogram.TouchEvent) {
    const profileRef = String(event.currentTarget.dataset.profileRef || '')
    if (profileRef) {
      caseNavigateTo({ url: `/packages/member/mip-public-profile/index?profileRef=${encodeURIComponent(profileRef)}` })
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

  openDiscoveryMenu() {
    const entries: Array<{
      label: string
      action: 'people' | 'matching' | 'mine' | 'cases'
    }> = this.data.mode === 'opportunities'
      ? [
          { label: '找人才', action: 'people' },
          { label: '机会撮合', action: 'matching' },
          { label: '我的机会', action: 'mine' },
        ]
      : [
          { label: '人才名录', action: 'people' },
          { label: '机会撮合', action: 'matching' },
          { label: '我的合作卡', action: 'mine' },
          { label: '超级案例', action: 'cases' },
        ]
    wx.showActionSheet({
      itemList: entries.map(item => item.label),
      success: ({ tapIndex }) => {
        const action = entries[tapIndex]?.action
        if (action === 'people') {
          this.openPeople()
        }
        else if (action === 'matching') {
          this.openMatching()
        }
        else if (action === 'mine') {
          this.openMine()
        }
        else if (action === 'cases') {
          this.openCases()
        }
      },
    })
  },

  openMine() {
    const url = this.data.mode === 'opportunities'
      ? '/packages/member/mip-opportunities/mine/index'
      : '/packages/member/mip-cooperation/list/index?mine=1'
    void this.openProtected(url, 'INTERACT')
  },

  openMatching() {
    void this.openProtected('/packages/member/mip-opportunity-matching/index', 'INTERACT')
  },

  openCases() {
    caseNavigateTo({ url: '/packages/member/mip-cases/list/index' })
  },

  openPeople() {
    caseNavigateTo({ url: '/packages/member/mip-people/index' })
  },
})
