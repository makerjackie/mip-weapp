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
import { cooperationRoles } from '../../config/mip-catalogs'
import { cooperationModule } from '../../modules/mip-cooperation'
import { mergeCooperationTalents } from '../../modules/mip-cooperation/validation'
import { mipAccessPageUrl } from '../../modules/mip-identity'
import { mipIdentityModule } from '../../modules/mip-identity/client'
import { groupedCityBranches, opportunityModule } from '../../modules/mip-opportunities'
import { caseNavigateTo, syncCaseNavigation } from '../../modules/platform/case-navigation'
import { getCustomNavigationStatusBarHeight } from '../../platform/navigation/status-bar'

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

const allRoleOptions = [{ key: '', name: '全部角色' }, ...cooperationRoles]
const nationwideOption: CityOption = { id: '', label: '全国' }
const OPPORTUNITY_REFRESH_INTERVAL_MS = 30_000

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
  return mode === 'cooperation'
    ? [nationwideOption, ...groupedCityBranches(catalog.branches, catalog.cityTags)[0].options]
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
    statusBarHeight: getCustomNavigationStatusBarHeight(),
    state: 'loading' as 'loading' | 'ready' | 'error',
    mode: 'opportunities' as PageMode,
    status: 'RECRUITING' as OpportunityFilter['status'],
    keywordInput: '',
    keyword: '',
    filterOpen: false,
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
    draftMinAmountYuan: '',
    draftMaxAmountYuan: '',
    selectedMinAmountCents: undefined as number | undefined,
    selectedMaxAmountCents: undefined as number | undefined,
    industryGroups: [] as IndustryGroupView[],
    abilityOptions: [] as TagView[],
    hasAppliedFilters: false,
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
      const draftCityId = this.data.mode === 'cooperation'
        ? this.data.draftCooperationBranchId
        : this.data.draftOpportunityCityTagId
      this.setData({
        catalog,
        cityOptions,
        cityGroups: cityGroupsFor(this.data.mode, cityOptions),
        citySelectionIds: draftCityId ? [draftCityId] : [],
        cityIndex: Math.max(0, cityOptions.findIndex(item => item.id === draftCityId)),
        industryGroups: catalog.industryGroups.map(group => ({
          id: group.id,
          label: group.label,
          options: group.options.map(item => ({
            id: item.id,
            label: item.label,
            selected: this.data.draftIndustryTagIds.includes(item.id),
            popular: item.popular,
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
    if (this.data.nextCursor && !this.data.loadingMore) {
      void this.loadContent(false)
    }
  },

  async onPullDownRefresh() {
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
      draftLocationTypes: [...this.data.selectedLocationTypes],
      draftMinAmountYuan: this.data.selectedMinAmountCents === undefined ? '' : String(this.data.selectedMinAmountCents / 100),
      draftMaxAmountYuan: this.data.selectedMaxAmountCents === undefined ? '' : String(this.data.selectedMaxAmountCents / 100),
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
      draftLocationTypes: [...this.data.selectedLocationTypes],
      draftMinAmountYuan: this.data.selectedMinAmountCents === undefined ? '' : String(this.data.selectedMinAmountCents / 100),
      draftMaxAmountYuan: this.data.selectedMaxAmountCents === undefined ? '' : String(this.data.selectedMaxAmountCents / 100),
      cityIndex: Math.max(0, this.data.cityOptions.findIndex(item => item.id === cityId)),
      citySelectionIds: cityId ? [cityId] : [],
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
          filterOpen: true,
        })
  },

  changeIndustry(event: WechatMiniprogram.CustomEvent<{ selectedIds: string[] }>) {
    const draftIndustryTagIds = event.detail.selectedIds.slice(0, 8)
    this.setData({
      draftIndustryTagIds,
      industryGroups: this.data.industryGroups.map(group => ({
        ...group,
        options: group.options.map(item => ({
          ...item,
          selected: draftIndustryTagIds.includes(item.id),
        })),
      })),
    })
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
      draftLocationTypes: [...this.data.selectedLocationTypes],
      draftMinAmountYuan: this.data.selectedMinAmountCents === undefined ? '' : String(this.data.selectedMinAmountCents / 100),
      draftMaxAmountYuan: this.data.selectedMaxAmountCents === undefined ? '' : String(this.data.selectedMaxAmountCents / 100),
      cityIndex: Math.max(0, this.data.cityOptions.findIndex(item => item.id === cityId)),
      citySelectionIds: cityId ? [cityId] : [],
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
    if (!id || type !== 'ability') {
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

  toggleLocationType(event: WechatMiniprogram.TouchEvent) {
    const type = String(event.currentTarget.dataset.type || '') as OpportunityLocationType
    if (!['CITY', 'NATIONAL', 'REMOTE'].includes(type)) {
      return
    }
    const selected = new Set(this.data.draftLocationTypes)
    if (selected.has(type)) {
      selected.delete(type)
    }
    else { selected.add(type) }
    this.setData({ draftLocationTypes: [...selected] })
  },

  updateAmount(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    const field = String(event.currentTarget.dataset.field || '')
    if (field === 'draftMinAmountYuan' || field === 'draftMaxAmountYuan') {
      this.setData({ [field]: event.detail.value })
    }
  },

  resetFilters() {
    const cityOptions = cityOptionsFor(this.data.mode, this.data.catalog)
    this.setData({
      keywordInput: '',
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
      draftMinAmountYuan: '',
      draftMaxAmountYuan: '',
      industryGroups: this.data.industryGroups.map(group => ({
        ...group,
        options: group.options.map(item => ({ ...item, selected: false })),
      })),
      abilityOptions: this.data.abilityOptions.map(item => ({ ...item, selected: false })),
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
      || (this.data.mode === 'opportunities' && (
        selectedAbilityTagIds.length
        || this.data.draftLocationTypes.length
        || amounts.minAmountCents !== undefined
        || amounts.maxAmountCents !== undefined
      )),
    )
    this.setData({
      keyword,
      selectedCityTagId,
      selectedCooperationBranchId,
      selectedRoleKey: this.data.draftRoleKey,
      selectedIndustryTagIds: [...this.data.draftIndustryTagIds],
      selectedAbilityTagIds,
      selectedLocationTypes: this.data.mode === 'opportunities' ? [...this.data.draftLocationTypes] : this.data.selectedLocationTypes,
      selectedMinAmountCents: this.data.mode === 'opportunities' ? amounts.minAmountCents : this.data.selectedMinAmountCents,
      selectedMaxAmountCents: this.data.mode === 'opportunities' ? amounts.maxAmountCents : this.data.selectedMaxAmountCents,
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
      draftMinAmountYuan: '',
      draftMaxAmountYuan: '',
      selectedMinAmountCents: undefined,
      selectedMaxAmountCents: undefined,
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
