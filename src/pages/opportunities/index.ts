import type { CatalogSelectorGroup } from '../../components/catalog-selector/model'
import type { BranchId, CooperationRoleKey, OpportunityId } from '../../modules/mip'
import type { MipPublicBanner } from '../../modules/mip-banners'
import type { CooperationTalentSummary } from '../../modules/mip-cooperation'
import type { ProtectedActionKey } from '../../modules/mip-identity'
import type {
  OpportunityCatalog,
  OpportunityFilter,
  OpportunityLocationType,
  OpportunitySummary,
} from '../../modules/mip-opportunities'
import { catalogSelectorView } from '../../components/catalog-selector/model'
import { brand } from '../../config/brand'
import { cooperationRoles } from '../../config/mip-catalogs'
import { mipBannerModule } from '../../modules/mip-banners'
import { cooperationModule } from '../../modules/mip-cooperation'
import { mergeCooperationTalents } from '../../modules/mip-cooperation/validation'
import { mipAccessPageUrl } from '../../modules/mip-identity'
import { mipIdentityModule } from '../../modules/mip-identity/client'
import { groupedCityBranches, opportunityModule, opportunityTypeLabel } from '../../modules/mip-opportunities'
import { caseNavigateTo, syncCaseNavigation } from '../../platform/navigation/client'

type PageMode = 'opportunities' | 'cooperation'
/** journey-review J2-06：「我的项目」是机会 Tab 内的第三个 pill 态（列表只看自己发布的机会）。 */
type StatusPill = OpportunityFilter['status'] | 'MINE'
interface OpportunityCardView extends OpportunitySummary {
  typeTagViews: Array<{ key: string, label: string }>
  /** 运行时验收（2026-09-22）：服务端 avatars 形状不可信，presenter 保底数组后才绑给卡片 type: Array 属性。 */
  avatarViews: string[]
}
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
/** journey-review J1-05：游客点筛选先完成身份确认，授权回来后重开筛选面板。 */
const FILTER_AUTH_RESUME = 'auth-intent:open-filters'
/** journey-review J1-04：游客点「我的项目」先完成身份确认，授权回来后切到我的项目 pill。 */
const MINE_AUTH_RESUME = 'auth-intent:open-mine'

function withTypeTagViews(items: OpportunitySummary[]): OpportunityCardView[] {
  return items.map(item => ({
    ...item,
    typeTagViews: (item.typeKeys || []).map(key => ({ key, label: opportunityTypeLabel(key) })),
    avatarViews: avatarViewsOf(item.avatars),
  }))
}

/** 保底数组：非数组（含 null/对象/字符串）与非法元素一律丢弃，杜绝卡片属性收到 non-array 告警。 */
function avatarViewsOf(avatars: OpportunitySummary['avatars']): string[] {
  return Array.isArray(avatars) ? avatars.filter(v => typeof v === 'string' && v) : []
}

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
    authenticated: false,
    mode: 'opportunities' as PageMode,
    status: 'RECRUITING' as StatusPill,
    keywordInput: '',
    keyword: '',
    filterOpen: false,
    industryPickerOpen: false,
    expandedIndustryGroupId: '',
    moreFiltersOpen: false,
    /** journey-review J3-01：导航栏下方的运营 Banner 位（后台可配置，未配置不占位）。 */
    banners: [] as MipPublicBanner[],
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
    opportunities: [] as OpportunityCardView[],
    cooperationTalents: [] as CooperationTalentView[],
    nextCursor: '',
    loadingMore: false,
    message: '',
    loginSheetOpen: false,
    loginSheetBusy: false,
    brandName: brand.productName,
    logoPath: brand.logoPath,
  },
  requestSequence: 0,
  resumeDestination: '',
  lastSuccessfulRefreshAt: 0,
  refreshOnReturn: false,
  authToken: '',

  async onShow() {
    syncCaseNavigation(this, 'pages/opportunities/index')
    const resume = mipIdentityModule.consumePendingResume('pages/opportunities/index')
    if (resume && this.resumeDestination) {
      const destination = this.resumeDestination
      this.resumeDestination = ''
      this.abandonLoginSheet()
      // journey-review J1-04 复审（B1）：必须等登录态刷新完成后再恢复原意图，否则
      // authenticated 仍是过期 false：FILTER 哨兵会再次触发身份确认并被当成页面
      // 路径静默跳转失败，MINE 哨兵则停在游客占位屏。onShow 其余逻辑不在本分支。
      await this.refreshAuthState()
      this.runResumeDestination(destination)
      return
    }
    this.resumeDestination = ''
    void this.resumeLoginSheetIntent()
    if (!this.data.catalog.cityTags.length) {
      void this.loadCatalogs()
    }
    void this.refreshAuthState()
    void this.loadBanners()
    const refreshIsDue = Date.now() - this.lastSuccessfulRefreshAt >= OPPORTUNITY_REFRESH_INTERVAL_MS
    const refreshOnReturn = this.refreshOnReturn
    this.refreshOnReturn = false
    if (this.data.state !== 'ready' || refreshIsDue || refreshOnReturn) {
      void this.loadContent(true, { preserveContent: this.data.state === 'ready' })
    }
  },

  /** journey-review J3-01：Banner 位与活动页共用 mip-banners 模块，失败不阻塞列表。 */
  async loadBanners(force = false) {
    try {
      const banners = await mipBannerModule.listActive(force)
      this.setData({ banners })
    }
    catch {}
  },

  openBanner(event: WechatMiniprogram.TouchEvent) {
    const bannerId = String(event.currentTarget.dataset.bannerId || '')
    const banner = this.data.banners.find(item => item.id === bannerId)
    if (!banner) {
      return
    }
    if (banner.targetType === 'ARTICLE_URL') {
      wx.openOfficialAccountArticle({
        url: banner.targetValue,
        fail: () => wx.showToast({ title: '文章暂未配置', icon: 'none' }),
      })
      return
    }
    if (banner.targetValue && banner.targetValue !== '/pages/opportunities/index') {
      caseNavigateTo({ url: banner.targetValue })
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
      if (this.data.mode === 'opportunities' && this.data.status === 'MINE') {
        // journey-review J2-06：「我的项目」pill 内联态，仅拉自己发布的机会。
        const page = await opportunityModule.listMine(reset ? undefined : this.data.nextCursor || undefined)
        if (sequence !== this.requestSequence || this.data.mode !== 'opportunities' || this.data.status !== 'MINE') {
          return
        }
        this.setData({
          state: 'ready',
          opportunities: reset
            ? withTypeTagViews(page.items)
            : [...this.data.opportunities, ...withTypeTagViews(page.items)],
          nextCursor: page.nextCursor || '',
        })
        this.lastSuccessfulRefreshAt = Date.now()
      }
      else if (this.data.mode === 'opportunities') {
        const page = await opportunityModule.list({
          status: this.data.status as OpportunityFilter['status'],
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
          opportunities: reset
            ? withTypeTagViews(page.items)
            : [...this.data.opportunities, ...withTypeTagViews(page.items)],
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
      await Promise.all([
        this.loadCatalogs(),
        this.loadContent(true, { preserveContent: this.data.state === 'ready' }),
        this.loadBanners(true),
      ])
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
    const status = String(event.currentTarget.dataset.status || '') as StatusPill
    if (!['RECRUITING', 'COMPLETED', 'MINE'].includes(status) || status === this.data.status) {
      return
    }
    // journey-review J1-04：游客点「我的项目」先走身份确认，授权回来后落在我的项目 pill。
    if (status === 'MINE' && !this.data.authenticated) {
      void this.openProtected(MINE_AUTH_RESUME, 'INTERACT')
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
    if (!this.data.filterOpen && !this.data.authenticated) {
      void this.openProtected(FILTER_AUTH_RESUME, 'INTERACT')
      return
    }
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
      this.refreshOnReturn = true
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
    this.refreshOnReturn = true
    this.resumeDestination = destination
    try {
      const session = await mipIdentityModule.beginProtectedAction({
        action,
        source: { navigation: 'navigateBack' },
      })
      if (session.decision.ready) {
        this.resumeDestination = ''
        // B1 双保险：auth-intent:* 哨兵不是页面路径，ready 时按恢复语义执行并同步
        // 登录态（decision.ready 蕴含 snapshot.authenticated），避免跳非法页面静默
        // 失败或落回游客占位屏。
        if (destination.startsWith('auth-intent:')) {
          this.setData({ authenticated: session.snapshot.authenticated })
          this.runResumeDestination(destination)
          return
        }
        caseNavigateTo({ url: destination })
        return
      }
      // journey-review J1-04/J1-05（2026-09-21 终审）：已登录未绑手机的会话就地弹
      // 手机号授权弹层，授权成功后继续原意图；其余未完成项交给 access 页。
      if (
        session.decision.nextRequirement === 'PHONE'
        && session.snapshot.authenticated
        && !session.snapshot.phoneBound
      ) {
        this.authToken = session.token
        this.setData({ loginSheetOpen: true })
        return
      }
      this.authToken = ''
      caseNavigateTo({ url: mipAccessPageUrl(session.token) })
    }
    catch {
      this.resumeDestination = ''
      this.setData({ message: '身份状态暂时无法确认，请稍后重试。' })
    }
  },

  async onLoginSheetPhone(event: WechatMiniprogram.CustomEvent<{ code?: string, errMsg?: string }>) {
    const token = this.authToken
    if (!token || this.data.loginSheetBusy) {
      return
    }
    const code = String(event.detail.code || '')
    if (!code) {
      const cancelled = /cancel|deny|denied/i.test(String(event.detail.errMsg || ''))
      wx.showToast({
        title: cancelled ? '你已取消手机号授权，可以稍后再完成。' : '手机号授权必须在微信真机完成。',
        icon: 'none',
      })
      return
    }
    this.setData({ loginSheetBusy: true })
    try {
      const session = await mipIdentityModule.bindWechatPhone(token, code)
      this.setData({ loginSheetOpen: false })
      const destination = this.resumeDestination
      if (session.decision.ready) {
        this.resumeDestination = ''
        this.authToken = ''
        try {
          await mipIdentityModule.complete(token)
        }
        catch {
          // complete 失败不阻断原意图，授权状态已生效。
        }
        mipIdentityModule.consumePendingResume('pages/opportunities/index')
        this.setData({ authenticated: true })
        void this.loadContent(true, { preserveContent: this.data.state === 'ready' })
        if (destination) {
          this.runResumeDestination(destination)
        }
        return
      }
      this.authToken = ''
      if (session.decision.nextRequirement === 'PROFILE') {
        // journey-review J1-03：新账号完善资料，完成或关闭都回本页并恢复意图。
        caseNavigateTo({ url: `/packages/member/mip-profile/index?token=${encodeURIComponent(token)}` })
        return
      }
      caseNavigateTo({ url: mipAccessPageUrl(token) })
    }
    catch (error) {
      wx.showToast({ title: error instanceof Error ? error.message : '手机号绑定失败，请重试。', icon: 'none' })
    }
    finally {
      this.setData({ loginSheetBusy: false })
    }
  },

  onLoginSheetDismiss() {
    this.abandonLoginSheet()
  },

  abandonLoginSheet() {
    if (this.authToken) {
      mipIdentityModule.cancel(this.authToken)
    }
    this.authToken = ''
    this.resumeDestination = ''
    this.setData({ loginSheetOpen: false, loginSheetBusy: false })
  },

  /** 从「填写信息」或 access 页返回后，若身份已就绪则继续弹层前的原意图。 */
  async resumeLoginSheetIntent() {
    if (!this.authToken) {
      return
    }
    try {
      const session = await mipIdentityModule.loadAccess(this.authToken)
      if (session.decision.ready) {
        const token = this.authToken
        const destination = this.resumeDestination
        this.authToken = ''
        this.resumeDestination = ''
        await mipIdentityModule.complete(token)
        mipIdentityModule.consumePendingResume('pages/opportunities/index')
        this.setData({ authenticated: true })
        void this.loadContent(true, { preserveContent: this.data.state === 'ready' })
        if (destination) {
          this.runResumeDestination(destination)
        }
        return
      }
    }
    catch {
      // 身份确认失败时按「暂不授权」处理，留在本页。
    }
    this.abandonLoginSheet()
  },

  /** 恢复弹层前的原意图：普通目的地直接跳转，筛选/我的项目哨兵则回到对应 pill 态。 */
  runResumeDestination(destination: string) {
    if (destination === FILTER_AUTH_RESUME) {
      this.toggleFilters()
      return
    }
    if (destination === MINE_AUTH_RESUME) {
      this.setData({ mode: 'opportunities', status: 'MINE' }, () => void this.loadContent(true))
      return
    }
    caseNavigateTo({ url: destination })
  },

  publish() {
    const url = this.data.mode === 'opportunities'
      ? '/packages/member/mip-opportunities/editor/index'
      : '/packages/member/mip-cooperation/editor/index'
    void this.openProtected(url, 'PUBLISH_OPPORTUNITY')
  },

  /**
   * figma 2198_44284: signed-out visitors get the player teaser on the
   *  opportunities tab; the identity snapshot decides which surface shows.
   */
  async refreshAuthState() {
    const snapshot = await mipIdentityModule.loadSnapshot().catch(() => null)
    if (snapshot) {
      this.setData({ authenticated: snapshot.authenticated })
    }
  },

  async openLogin() {
    try {
      const session = await mipIdentityModule.beginProtectedAction({
        action: 'ENTER_APP',
        source: { navigation: 'navigateBack' },
      })
      if (session.decision.ready) {
        this.setData({ authenticated: true })
        void this.loadContent(true, { preserveContent: true })
        return
      }
      caseNavigateTo({ url: mipAccessPageUrl(session.token) })
    }
    catch {
      this.setData({ message: '身份状态暂时无法确认，请稍后重试。' })
    }
  },

  /**
   * journey-review J1-06→J1-07：游客点「去成为玩家解锁权限」先完成身份确认，
   * 授权回来后进玩家等级页（真实路由走 openProtected 的 ready/恢复分支，
   * 已登录用户点击则直接进等级页）。
   */
  openBecomePlayerUnlock() {
    void this.openProtected('/packages/member/mip-growth/index', 'ENTER_APP')
  },

  openDiscoveryMenu() {
    const entries: Array<{
      label: string
      action: 'people' | 'mine' | 'cases'
    }> = this.data.mode === 'opportunities'
      ? [
          { label: '找人才', action: 'people' },
          { label: '我的机会', action: 'mine' },
        ]
      : [
          { label: '人才名录', action: 'people' },
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

  openCases() {
    caseNavigateTo({ url: '/packages/member/mip-cases/list/index' })
  },

  openPeople() {
    caseNavigateTo({ url: '/packages/member/mip-people/index' })
  },
})
