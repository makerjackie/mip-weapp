import type { BranchId } from '../../../modules/mip'
import type {
  OpportunityCatalog,
  PeopleSearchScope,
  PublicPerson,
} from '../../../modules/mip-opportunities'
import { opportunityModule } from '../../../modules/mip-opportunities'
import { caseNavigateTo } from '../../../modules/platform/case-navigation'

interface PersonView extends PublicPerson {
  displayName: string
  kindLabel: string
  branchText: string
  joinedText: string
  abilities: NonNullable<PublicPerson['abilities']>
}

interface FilterOption { id: string, label: string }
interface TagOption extends FilterOption { selected: boolean }
interface IndustryGroupView extends FilterOption { options: TagOption[] }

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
    abilities: person.abilities || [],
  }
}

Page({
  data: {
    state: 'loading' as 'loading' | 'ready' | 'empty' | 'error',
    searchScope: 'GLOBAL' as PeopleSearchScope,
    keywordInput: '',
    keyword: '',
    filterOpen: false,
    branchOptions: [allBranches] as FilterOption[],
    branchIndex: 0,
    selectedBranchId: '' as '' | BranchId,
    draftIndustryTagIds: [] as string[],
    selectedIndustryTagIds: [] as string[],
    industryGroups: [] as IndustryGroupView[],
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
    const branchOptions = [allBranches, ...catalog.branches.map(item => ({
      id: item.id,
      label: item.name === item.cityName ? item.cityName : `${item.cityName} · ${item.name}`,
    }))]
    this.setData({
      branchOptions,
      branchIndex: Math.max(0, branchOptions.findIndex(item => item.id === this.data.selectedBranchId)),
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

  changeBranch(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    const branchIndex = Number(event.detail.value)
    const selected = this.data.branchOptions[branchIndex] || allBranches
    this.setData({
      branchIndex,
      selectedBranchId: selected.id as '' | BranchId,
    }, () => void this.loadPeople(true))
  },

  toggleFilters() {
    this.setData({ filterOpen: !this.data.filterOpen })
  },

  toggleIndustry(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id || '')
    if (!id) {
      return
    }
    const draftIndustryTagIds = this.data.draftIndustryTagIds.includes(id)
      ? this.data.draftIndustryTagIds.filter(item => item !== id)
      : [...this.data.draftIndustryTagIds, id].slice(0, 8)
    this.setData({
      draftIndustryTagIds,
      industryGroups: this.data.industryGroups.map(group => ({
        ...group,
        options: group.options.map(item => ({ ...item, selected: draftIndustryTagIds.includes(item.id) })),
      })),
    })
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

  resetIndustryDraft() {
    this.setData({
      draftIndustryTagIds: [],
      draftAbilityTagIds: [],
      industryGroups: this.data.industryGroups.map(group => ({
        ...group,
        options: group.options.map(item => ({ ...item, selected: false })),
      })),
      abilityOptions: this.data.abilityOptions.map(item => ({ ...item, selected: false })),
    })
  },

  applyIndustryFilters() {
    this.setData({
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
      selectedBranchId: '',
      draftIndustryTagIds: [],
      selectedIndustryTagIds: [],
      draftAbilityTagIds: [],
      selectedAbilityTagIds: [],
      filterOpen: false,
      industryGroups: this.data.industryGroups.map(group => ({
        ...group,
        options: group.options.map(item => ({ ...item, selected: false })),
      })),
      abilityOptions: this.data.abilityOptions.map(item => ({ ...item, selected: false })),
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
