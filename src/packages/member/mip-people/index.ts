import type { CatalogSelectorGroup } from '../../../components/catalog-selector/model'
import type { BranchId, CooperationRoleKey } from '../../../modules/mip'
import type {
  OpportunityCatalog,
  PeopleSearchScope,
  PublicPerson,
} from '../../../modules/mip-opportunities'
import { cooperationRoles } from '../../../config/mip-catalogs'
import { groupedCityBranches, opportunityModule } from '../../../modules/mip-opportunities'
import { caseNavigateTo } from '../../../modules/platform/case-navigation'

interface PersonView extends PublicPerson {
  displayName: string
  kindLabel: string
  branchText: string
  joinedText: string
  abilityText: string
  abilities: NonNullable<PublicPerson['abilities']>
  badges: NonNullable<PublicPerson['badges']>
}

interface FilterOption { id: string, label: string }
interface TagOption extends FilterOption { selected: boolean }
interface CatalogGroupView { id: string, label: string, options: TagOption[] }

const allBranches: FilterOption = { id: '', label: '全部城市与分会' }

function dateText(value: string) {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) {
    return ''
  }
  return `${date.getFullYear()}年${date.getMonth() + 1}月加入`
}

function presentPerson(person: PublicPerson): PersonView {
  return {
    ...person,
    displayName: person.nickname || 'MIP 用户',
    kindLabel: person.userKind === 'PLAYER' ? '玩家' : '嘉宾',
    branchText: person.primaryBranch
      ? [person.primaryBranch.cityName, person.primaryBranch.name].filter(Boolean).join(' · ')
      : '',
    joinedText: dateText(person.joinedAt),
    abilityText: (person.abilities || [])[0]?.label || dateText(person.joinedAt),
    abilities: person.abilities || [],
    badges: person.badges || [],
  }
}

function catalogGroupViews(groups: CatalogSelectorGroup[], selectedIds: string[]): CatalogGroupView[] {
  return groups.map(group => ({
    id: group.id,
    label: group.label,
    options: group.options.map(item => ({
      id: item.id,
      label: item.label,
      selected: selectedIds.includes(item.id),
    })),
  }))
}

Page({
  data: {
    state: 'loading' as 'loading' | 'ready' | 'empty' | 'error',
    searchScope: 'GLOBAL' as PeopleSearchScope,
    keywordInput: '',
    keyword: '',
    filterOpen: false,
    branchOptions: [allBranches] as FilterOption[],
    branchGroups: [] as CatalogSelectorGroup[],
    draftBranchIds: [] as string[],
    branchIndex: 0,
    selectedBranchId: '' as '' | BranchId,
    roleOptions: cooperationRoles,
    draftRoleKey: '' as '' | CooperationRoleKey,
    selectedRoleKey: '' as '' | CooperationRoleKey,
    draftIndustryTagIds: [] as string[],
    selectedIndustryTagIds: [] as string[],
    industryGroups: [] as CatalogSelectorGroup[],
    industryViewGroups: [] as CatalogGroupView[],
    draftAbilityTagIds: [] as string[],
    selectedAbilityTagIds: [] as string[],
    abilityOptions: [] as TagOption[],
    people: [] as PersonView[],
    nextCursor: '',
    loadingMore: false,
    message: '',
  },
  requestSequence: 0,

  onLoad() {
    void this.loadCatalogs()
    void this.loadPeople(true)
  },

  onPullDownRefresh() {
    Promise.all([this.loadCatalogs(), this.loadPeople(true)])
      .finally(() => wx.stopPullDownRefresh())
  },

  onReachBottom() {
    if (this.data.nextCursor && !this.data.loadingMore && this.data.state === 'ready') {
      void this.loadPeople(false)
    }
  },

  async loadCatalogs() {
    try {
      const catalog = await opportunityModule.getCatalogs()
      this.applyCatalog(catalog)
    }
    catch {
      if (!this.data.industryGroups.length) {
        this.setData({ message: '筛选项暂时无法加载，仍可浏览全部档案。' })
      }
    }
  },

  applyCatalog(catalog: OpportunityCatalog) {
    const branchGroups = groupedCityBranches(catalog.branches, catalog.cityTags)
    const branchOptions = [allBranches, ...branchGroups[0].options]
    const industryGroups = catalog.industryGroups.map(group => ({
      id: group.id,
      label: group.label,
      options: group.options.map(item => ({
        id: item.id,
        label: item.label,
        popular: item.popular,
      })),
    }))
    this.setData({
      branchOptions,
      branchGroups,
      branchIndex: Math.max(0, branchOptions.findIndex(item => item.id === this.data.selectedBranchId)),
      industryGroups,
      industryViewGroups: catalogGroupViews(industryGroups, this.data.draftIndustryTagIds),
      abilityOptions: catalog.abilityTags.map(item => ({
        id: item.id,
        label: item.label,
        selected: this.data.draftAbilityTagIds.includes(item.id),
      })),
    })
  },

  async loadPeople(reset: boolean) {
    const sequence = this.requestSequence + 1
    this.requestSequence = sequence
    if (reset) {
      this.setData({ state: 'loading', people: [], nextCursor: '', message: '' })
    }
    else {
      this.setData({ loadingMore: true, message: '' })
    }
    try {
      const page = await opportunityModule.listPeople({
        scope: this.data.searchScope,
        keyword: this.data.keyword || undefined,
        branchId: this.data.selectedBranchId || undefined,
        roleKey: this.data.selectedRoleKey || undefined,
        industryTagIds: this.data.selectedIndustryTagIds,
        abilityTagIds: this.data.selectedAbilityTagIds,
        cursor: reset ? undefined : this.data.nextCursor || undefined,
        limit: 20,
      })
      if (sequence !== this.requestSequence) {
        return
      }
      const people = reset
        ? page.items.map(presentPerson)
        : [...this.data.people, ...page.items.map(presentPerson)]
      this.setData({
        state: people.length ? 'ready' : 'empty',
        people,
        nextCursor: page.nextCursor || '',
        loadingMore: false,
        message: '',
      })
    }
    catch (error) {
      if (sequence !== this.requestSequence) {
        return
      }
      this.setData({
        state: reset ? 'error' : this.data.state,
        loadingMore: false,
        message: error instanceof Error ? error.message : '人才档案加载失败。',
      })
    }
  },

  changeSearchScope(event: WechatMiniprogram.TouchEvent) {
    const searchScope = String(event.currentTarget.dataset.scope || '') as PeopleSearchScope
    if (!['GLOBAL', 'PLAYER'].includes(searchScope) || searchScope === this.data.searchScope) {
      return
    }
    this.setData({ searchScope }, () => void this.loadPeople(true))
  },

  onKeywordInput(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    this.setData({ keywordInput: String(event.detail.value || '') })
  },

  submitSearch() {
    this.setData({ keyword: this.data.keywordInput.trim() }, () => void this.loadPeople(true))
  },

  clearSearch() {
    this.setData({ keywordInput: '', keyword: '' }, () => void this.loadPeople(true))
  },

  changeBranch(event: WechatMiniprogram.CustomEvent<{ selectedIds: string[] }>) {
    this.setData({ draftBranchIds: event.detail.selectedIds.slice(0, 1) })
  },

  toggleFilters() {
    this.setData({ filterOpen: !this.data.filterOpen })
  },

  changeIndustry(event: WechatMiniprogram.CustomEvent<{ selectedIds: string[] }>) {
    const draftIndustryTagIds = event.detail.selectedIds.slice(0, 8)
    this.setData({
      draftIndustryTagIds,
      industryViewGroups: catalogGroupViews(this.data.industryGroups, draftIndustryTagIds),
    })
  },

  toggleIndustry(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id || '')
    if (!this.data.industryGroups.some(group => group.options.some(item => item.id === id))) {
      return
    }
    const selected = this.data.draftIndustryTagIds.includes(id)
    if (!selected && this.data.draftIndustryTagIds.length >= 8) {
      wx.showToast({ title: '最多选择 8 个行业标签', icon: 'none' })
      return
    }
    const draftIndustryTagIds = selected
      ? this.data.draftIndustryTagIds.filter(item => item !== id)
      : [...this.data.draftIndustryTagIds, id]
    this.setData({
      draftIndustryTagIds,
      industryViewGroups: catalogGroupViews(this.data.industryGroups, draftIndustryTagIds),
    })
  },

  chooseRole(event: WechatMiniprogram.TouchEvent) {
    const roleKey = String(event.currentTarget.dataset.key || '') as CooperationRoleKey
    if (!cooperationRoles.some(role => role.key === roleKey)) {
      return
    }
    this.setData({ draftRoleKey: this.data.draftRoleKey === roleKey ? '' : roleKey })
  },

  toggleAbility(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id || '')
    if (!id) {
      return
    }
    const draftAbilityTagIds = this.data.draftAbilityTagIds.includes(id)
      ? this.data.draftAbilityTagIds.filter(item => item !== id)
      : [...this.data.draftAbilityTagIds, id].slice(0, 8)
    this.setData({
      draftAbilityTagIds,
      abilityOptions: this.data.abilityOptions.map(item => ({
        ...item,
        selected: draftAbilityTagIds.includes(item.id),
      })),
    })
  },

  resetFilterDraft() {
    this.setData({
      draftBranchIds: [],
      draftRoleKey: '',
      draftIndustryTagIds: [],
      draftAbilityTagIds: [],
      abilityOptions: this.data.abilityOptions.map(item => ({ ...item, selected: false })),
      industryViewGroups: catalogGroupViews(this.data.industryGroups, []),
    })
  },

  applyFilters() {
    const selectedBranchId = (this.data.draftBranchIds[0] || '') as '' | BranchId
    this.setData({
      selectedBranchId,
      branchIndex: Math.max(0, this.data.branchOptions.findIndex(item => item.id === selectedBranchId)),
      selectedRoleKey: this.data.draftRoleKey,
      selectedIndustryTagIds: [...this.data.draftIndustryTagIds],
      selectedAbilityTagIds: [...this.data.draftAbilityTagIds],
      filterOpen: false,
    }, () => void this.loadPeople(true))
  },

  clearAllFilters() {
    this.setData({
      searchScope: 'GLOBAL',
      keywordInput: '',
      keyword: '',
      branchIndex: 0,
      draftBranchIds: [],
      selectedBranchId: '',
      draftRoleKey: '',
      selectedRoleKey: '',
      draftIndustryTagIds: [],
      selectedIndustryTagIds: [],
      draftAbilityTagIds: [],
      selectedAbilityTagIds: [],
      filterOpen: false,
      abilityOptions: this.data.abilityOptions.map(item => ({ ...item, selected: false })),
      industryViewGroups: catalogGroupViews(this.data.industryGroups, []),
    }, () => void this.loadPeople(true))
  },

  retryLoad() {
    void this.loadPeople(true)
  },

  openProfile(event: WechatMiniprogram.TouchEvent) {
    const profileRef = String(event.currentTarget.dataset.profileRef || '')
    if (profileRef) {
      caseNavigateTo({
        url: `/packages/member/mip-public-profile/index?profileRef=${encodeURIComponent(profileRef)}`,
      })
    }
  },
})
