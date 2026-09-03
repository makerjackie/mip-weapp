import type { BranchId, CooperationRoleKey } from '../../../../modules/mip'
import type {
  CooperationCardSummary,
  CooperationCatalog,
  CooperationTalentSummary,
} from '../../../../modules/mip-cooperation'
import { cooperationRoles } from '../../../../config/mip-catalogs'
import { cooperationModule } from '../../../../modules/mip-cooperation'
import { mergeCooperationTalents } from '../../../../modules/mip-cooperation/validation'
import { caseNavigateTo } from '../../../../platform/navigation/client'

interface CardView extends CooperationCardSummary { roleName: string }
interface TalentView extends Omit<CooperationTalentSummary, 'cards'> {
  cards: Array<CooperationTalentSummary['cards'][number] & { roleName: string }>
  primaryPositioning: string
  primaryTargetSummary: string
}
interface TagView { id: string, label: string, selected: boolean }
interface IndustryGroupView { id: string, label: string, options: TagView[] }

const emptyCatalog: CooperationCatalog = {
  branches: [],
  industryGroups: [],
  industryTags: [],
}

function cardViews(items: CooperationCardSummary[]): CardView[] {
  return items.map(item => ({
    ...item,
    roleName: cooperationRoles.find(role => role.key === item.roleKey)?.name || item.roleKey,
  }))
}

Page({
  data: {
    mine: false,
    state: 'loading' as 'loading' | 'ready' | 'error',
    cards: [] as CardView[],
    talents: [] as TalentView[],
    filterOpen: false,
    filterMessage: '',
    keywordInput: '',
    appliedKeyword: '',
    catalog: emptyCatalog,
    branchOptions: [{ id: '', label: '全部城市' }] as Array<{ id: string, label: string }>,
    branchIndex: 0,
    draftBranchId: '' as '' | BranchId,
    selectedBranchId: '' as '' | BranchId,
    roleOptions: [{ key: '', name: '全部角色' }, ...cooperationRoles],
    draftRoleKey: '' as '' | CooperationRoleKey,
    selectedRoleKey: '' as '' | CooperationRoleKey,
    draftIndustryTagIds: [] as string[],
    selectedIndustryTagIds: [] as string[],
    industryGroups: [] as IndustryGroupView[],
    hasAppliedFilters: false,
    nextCursor: '',
    loadingMore: false,
    archivingId: '',
    message: '',
  },
  requestSequence: 0,

  onLoad(options: Record<string, string | undefined>) {
    const mine = options.mine === '1'
    const cached = mine ? cooperationModule.peekMine() : undefined
    this.setData({ mine })
    if (cached) {
      this.setData({
        state: 'ready',
        cards: cardViews(cached.items),
        nextCursor: cached.nextCursor || '',
      })
    }
    if (!mine) {
      void this.loadCatalogs()
    }
  },

  onShow() {
    void this.load(true)
  },

  async onPullDownRefresh() {
    try {
      await Promise.all([
        this.data.mine ? Promise.resolve() : this.loadCatalogs(),
        this.load(true),
      ])
    }
    finally {
      wx.stopPullDownRefresh()
    }
  },

  async loadCatalogs() {
    try {
      const catalog = await cooperationModule.getCatalogs()
      const branchOptions = [
        { id: '', label: '全部城市' },
        ...catalog.branches.map(item => ({
          id: item.id,
          label: item.name === item.cityName ? item.cityName : `${item.cityName} · ${item.name}`,
        })),
      ]
      this.setData({
        catalog,
        branchOptions,
        branchIndex: Math.max(0, branchOptions.findIndex(item => item.id === this.data.draftBranchId)),
        industryGroups: catalog.industryGroups.map(group => ({
          id: group.id,
          label: group.label,
          options: group.options.map(item => ({
            id: item.id,
            label: item.label,
            selected: this.data.draftIndustryTagIds.includes(item.id),
          })),
        })),
        filterMessage: '',
      })
    }
    catch {
      this.setData({ filterMessage: '城市和行业筛选暂时不可用。' })
    }
  },

  async load(reset = false) {
    if (!reset && (!this.data.nextCursor || this.data.loadingMore)) {
      return
    }
    const sequence = this.requestSequence + 1
    this.requestSequence = sequence
    if (reset) {
      this.setData({
        state: this.data.state === 'ready' ? 'ready' : 'loading',
        message: '',
        nextCursor: '',
      })
    }
    else {
      this.setData({ loadingMore: true, message: '' })
    }
    try {
      if (this.data.mine) {
        const page = await cooperationModule.listMine(reset ? undefined : this.data.nextCursor || undefined)
        if (sequence !== this.requestSequence) {
          return
        }
        const cards = cardViews(page.items)
        this.setData({
          state: 'ready',
          cards: reset ? cards : [...this.data.cards, ...cards],
          nextCursor: page.nextCursor || '',
        })
      }
      else {
        const page = await cooperationModule.listTalents({
          keyword: this.data.appliedKeyword,
          branchId: this.data.selectedBranchId || undefined,
          roleKey: this.data.selectedRoleKey || undefined,
          industryTagIds: this.data.selectedIndustryTagIds,
          cursor: reset ? undefined : this.data.nextCursor || undefined,
          limit: 16,
        })
        if (sequence !== this.requestSequence) {
          return
        }
        const talents = page.items.map((item): TalentView => {
          const cards = item.cards.map(card => ({
            ...card,
            roleName: cooperationRoles.find(role => role.key === card.roleKey)?.name || card.roleKey,
          }))
          return {
            ...item,
            cards,
            primaryPositioning: cards[0]?.positioning || '',
            primaryTargetSummary: cards[0]?.targetSummary || '',
          }
        })
        this.setData({
          state: 'ready',
          talents: reset ? talents : mergeCooperationTalents(this.data.talents, talents),
          nextCursor: page.nextCursor || '',
        })
      }
    }
    catch (error) {
      if (sequence !== this.requestSequence) {
        return
      }
      const message = error instanceof Error ? error.message : '合作卡加载失败'
      const hasItems = this.data.mine ? this.data.cards.length > 0 : this.data.talents.length > 0
      this.setData(hasItems
        ? { state: 'ready', message: `合作卡更新失败，已保留当前结果。${message}` }
        : { state: 'error', message })
    }
    finally {
      if (sequence === this.requestSequence) {
        this.setData({ loadingMore: false })
      }
    }
  },

  retryLoad() {
    void this.load(true)
  },

  toggleFilters() {
    if (!this.data.filterOpen) {
      this.setData({ filterOpen: true })
      return
    }
    this.setData({
      filterOpen: false,
      keywordInput: this.data.appliedKeyword,
      branchIndex: Math.max(0, this.data.branchOptions.findIndex(item => item.id === this.data.selectedBranchId)),
      draftBranchId: this.data.selectedBranchId,
      draftRoleKey: this.data.selectedRoleKey,
      draftIndustryTagIds: [...this.data.selectedIndustryTagIds],
      industryGroups: this.data.industryGroups.map(group => ({
        ...group,
        options: group.options.map(item => ({
          ...item,
          selected: this.data.selectedIndustryTagIds.includes(item.id),
        })),
      })),
    })
  },

  onKeywordInput(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    this.setData({ keywordInput: event.detail.value })
  },

  onSearchConfirm() {
    this.applyFilters()
  },

  clearKeywordDraft() {
    this.setData({
      keywordInput: '',
      branchIndex: Math.max(0, this.data.branchOptions.findIndex(item => item.id === this.data.selectedBranchId)),
      draftBranchId: this.data.selectedBranchId,
      draftRoleKey: this.data.selectedRoleKey,
      draftIndustryTagIds: [...this.data.selectedIndustryTagIds],
      industryGroups: this.data.industryGroups.map(group => ({
        ...group,
        options: group.options.map(item => ({
          ...item,
          selected: this.data.selectedIndustryTagIds.includes(item.id),
        })),
      })),
      filterOpen: true,
    })
  },

  changeBranch(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    const branchIndex = Number(event.detail.value)
    const branch = this.data.branchOptions[branchIndex]
    if (branch) {
      this.setData({ branchIndex, draftBranchId: branch.id as '' | BranchId })
    }
  },

  chooseRole(event: WechatMiniprogram.TouchEvent) {
    const roleKey = String(event.currentTarget.dataset.key || '') as '' | CooperationRoleKey
    this.setData({ draftRoleKey: roleKey })
  },

  toggleIndustry(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id || '')
    if (!id) {
      return
    }
    const selected = this.data.draftIndustryTagIds.includes(id)
    const draftIndustryTagIds = selected
      ? this.data.draftIndustryTagIds.filter(item => item !== id)
      : [...this.data.draftIndustryTagIds, id]
    this.setData({
      draftIndustryTagIds,
      industryGroups: this.data.industryGroups.map(group => ({
        ...group,
        options: group.options.map(item => item.id === id ? { ...item, selected: !selected } : item),
      })),
    })
  },

  resetFilterDraft() {
    this.setData({
      keywordInput: '',
      branchIndex: 0,
      draftBranchId: '',
      draftRoleKey: '',
      draftIndustryTagIds: [],
      industryGroups: this.data.industryGroups.map(group => ({
        ...group,
        options: group.options.map(item => ({ ...item, selected: false })),
      })),
    })
  },

  applyFilters() {
    const appliedKeyword = this.data.keywordInput.trim()
    const selectedIndustryTagIds = [...this.data.draftIndustryTagIds]
    this.setData({
      appliedKeyword,
      selectedBranchId: this.data.draftBranchId,
      selectedRoleKey: this.data.draftRoleKey,
      selectedIndustryTagIds,
      hasAppliedFilters: Boolean(
        appliedKeyword
        || this.data.draftBranchId
        || this.data.draftRoleKey
        || selectedIndustryTagIds.length,
      ),
      filterOpen: false,
    }, () => void this.load(true))
  },

  clearAppliedFilters() {
    this.setData({
      keywordInput: '',
      appliedKeyword: '',
      branchIndex: 0,
      draftBranchId: '',
      selectedBranchId: '',
      draftRoleKey: '',
      selectedRoleKey: '',
      draftIndustryTagIds: [],
      selectedIndustryTagIds: [],
      hasAppliedFilters: false,
      filterOpen: false,
      industryGroups: this.data.industryGroups.map(group => ({
        ...group,
        options: group.options.map(item => ({ ...item, selected: false })),
      })),
    }, () => void this.load(true))
  },

  onReachBottom() {
    void this.load(false)
  },

  create() {
    caseNavigateTo({ url: '/packages/member/mip-cooperation/editor/index' })
  },

  openCases() {
    caseNavigateTo({ url: '/packages/member/mip-cases/list/index' })
  },

  async deleteCard(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id || '')
    const item = this.data.cards.find(card => card.id === id)
    const expectedVersion = Number(item?.version)
    if (!item?.mine || !Number.isInteger(expectedVersion) || this.data.archivingId) {
      return
    }
    const confirmation = await wx.showModal({
      title: '删除合作卡',
      content: '删除后，这张合作卡将不再显示，且无法恢复。',
      confirmText: '删除',
      confirmColor: '#B30516',
    })
    if (!confirmation.confirm) {
      return
    }
    this.setData({ archivingId: id, message: '' })
    try {
      await cooperationModule.archive(item.id, expectedVersion)
      await this.load(true)
      wx.showToast({ title: '已删除', icon: 'success' })
    }
    catch (error) {
      const message = error instanceof Error ? error.message : '合作卡删除失败'
      await this.load(true)
      wx.showToast({ title: message, icon: 'none' })
    }
    finally {
      this.setData({ archivingId: '' })
    }
  },

  openCard(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id || '')
    if (id) {
      caseNavigateTo({ url: `/packages/member/mip-cooperation/detail/index?id=${encodeURIComponent(id)}` })
    }
  },

  openTalent(event: WechatMiniprogram.TouchEvent) {
    const profileRef = String(event.currentTarget.dataset.profileRef || '')
    if (profileRef) {
      caseNavigateTo({ url: `/packages/member/mip-public-profile/index?profileRef=${encodeURIComponent(profileRef)}` })
    }
  },
})
