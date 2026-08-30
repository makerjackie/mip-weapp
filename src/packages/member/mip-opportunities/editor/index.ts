import type { BranchId, CooperationRoleKey, OpportunityId } from '../../../../modules/mip'
import type { OpportunityCatalog, OpportunityDetail, OpportunityLocationType, PublicPerson } from '../../../../modules/mip-opportunities'
import type { OpportunityTextDraft } from '../../../../modules/mip-opportunities/text-parser'
import { cooperationRoles } from '../../../../config/mip-catalogs'
import { mipMediaModule } from '../../../../modules/mip-media/client'
import { opportunityModule } from '../../../../modules/mip-opportunities'
import { parseOpportunityText } from '../../../../modules/mip-opportunities/text-parser'
import { chooseSingleImage } from '../../../../modules/platform/image-upload'

interface SelectOption { id: string, label: string, selected: boolean }
interface IndustryGroupOption { id: string, label: string, options: SelectOption[] }
interface RoleOption { key: CooperationRoleKey, name: string, selected: boolean }
interface TeamSelection { profileRef: string, nickname: string, avatarUrl?: string, headline?: string }
interface TeamCandidate extends PublicPerson { selected: boolean }
interface CityOption { id: string, label: string }
interface PastePreviewRow { key: string, label: string, value: string }

const cityPriority = ['深圳', '北京', '上海', '成都', '广州', '中国香港', '中国澳门', '海外']

function cityGridOptions(options: CityOption[], selectedId = '') {
  const order = new Map(cityPriority.map((label, index) => [label, index]))
  const sorted = options.filter(option => option.id).sort((left, right) => {
    const leftOrder = order.get(left.label) ?? cityPriority.length
    const rightOrder = order.get(right.label) ?? cityPriority.length
    return leftOrder - rightOrder
  })
  const visible = sorted.slice(0, 8)
  const selected = sorted.find(option => option.id === selectedId)
  if (selected && !visible.some(option => option.id === selected.id)) {
    visible[visible.length - 1] = selected
  }
  return visible
}

function pastePreviewRows(draft: OpportunityTextDraft): PastePreviewRow[] {
  return [
    { key: 'title', label: '项目名称', value: draft.title || '' },
    { key: 'valueSummary', label: '价值金额', value: draft.valueSummary || '' },
    { key: 'cityTagId', label: '主营城市', value: draft.cityLabel || '' },
    { key: 'targetSummary', label: '寻找合作方', value: draft.targetSummary || '' },
    { key: 'description', label: '展开讲讲', value: draft.description || '' },
  ].filter(item => item.value)
}

Page({
  data: {
    id: '' as OpportunityId | '',
    version: 0,
    state: 'loading' as 'loading' | 'ready' | 'error',
    saving: false,
    message: '',
    title: '',
    valueSummary: '',
    targetSummary: '',
    description: '',
    scopeType: 'PLATFORM' as 'PLATFORM' | 'BRANCH',
    branchId: '' as BranchId | '',
    branchIndex: 0,
    cityTagId: '',
    cityIndex: 0,
    minAmountYuan: '',
    maxAmountYuan: '',
    locationTypes: [] as OpportunityLocationType[],
    locationCityTagIds: [] as string[],
    coverAssetId: '',
    coverUrl: '',
    coverUploading: false,
    catalog: { branches: [], cityTags: [], industryGroups: [], industryTags: [], abilityTags: [] } as OpportunityCatalog,
    branchOptions: [{ id: '', name: 'MIP 平台', cityName: '全国' }],
    cityOptions: [{ id: '', label: '全国' }],
    cityGridOptions: [] as CityOption[],
    pastePreviewVisible: false,
    pasteDraft: {} as OpportunityTextDraft,
    pastePreview: [] as PastePreviewRow[],
    advancedOpen: false,
    roleOptions: cooperationRoles.map(item => ({ key: item.key, name: item.name, selected: false })) as RoleOption[],
    industryGroups: [] as IndustryGroupOption[],
    abilityOptions: [] as SelectOption[],
    teamMembers: [] as TeamSelection[],
    teamPickerVisible: false,
    teamKeyword: '',
    teamCandidates: [] as TeamCandidate[],
    teamLoading: false,
  },
  navigationTimer: undefined as ReturnType<typeof setTimeout> | undefined,

  onLoad(options: Record<string, string | undefined>) {
    this.setData({ id: String(options.id || '') as OpportunityId | '' })
    void this.initialize()
  },

  onHide() {
    this.clearNavigationTimer()
  },

  onUnload() {
    this.clearNavigationTimer()
  },

  clearNavigationTimer() {
    if (this.navigationTimer !== undefined) {
      clearTimeout(this.navigationTimer)
      this.navigationTimer = undefined
    }
  },

  async initialize() {
    this.setData({ state: 'loading', message: '' })
    try {
      const [catalog, detail] = await Promise.all([
        opportunityModule.getCatalogs(),
        this.data.id ? opportunityModule.get(this.data.id) : Promise.resolve(null),
      ])
      if (detail && !detail.canEdit) {
        this.setData({
          state: 'error',
          message: detail.status === 'ENDED'
            ? '机会已结束，不能继续编辑。'
            : '当前机会不能继续编辑。',
        })
        return
      }
      this.applyCatalog(catalog, detail)
      this.setData({ state: 'ready' })
    }
    catch (error) {
      this.setData({ state: 'error', message: error instanceof Error ? error.message : '页面加载失败' })
    }
  },

  applyCatalog(catalog: OpportunityCatalog, detail: OpportunityDetail | null) {
    const branchOptions = [{ id: '', name: 'MIP 平台', cityName: '全国' }, ...catalog.branches]
    const cityOptions = [{ id: '', label: '全国' }, ...catalog.cityTags]
    const roleKeys = new Set(detail?.roles || [])
    const industryIds = new Set(detail?.industryTags.map(item => item.id) || [])
    const abilityIds = new Set(detail?.abilityTags.map(item => item.id) || [])
    const branchIndex = detail?.branchId
      ? Math.max(0, branchOptions.findIndex(item => item.id === detail.branchId))
      : 0
    const cityIndex = detail?.city?.id
      ? Math.max(0, cityOptions.findIndex(item => item.id === detail.city?.id))
      : 0
    const terms = detail?.commercialTerms
    const locationTypes = terms?.locations.filter(item => item.type !== 'CITY').map(item => item.type) || []
    const locationCityTagIds = terms?.locations.filter(item => item.type === 'CITY').map(item => item.city?.id || item.cityTagId || '').filter(Boolean) || []
    this.setData({
      catalog,
      branchOptions,
      cityOptions,
      cityGridOptions: cityGridOptions(cityOptions, detail?.city?.id || ''),
      branchIndex,
      cityIndex,
      title: detail?.title || '',
      valueSummary: detail?.valueSummary || '',
      targetSummary: detail?.targetSummary || '',
      description: detail?.description || '',
      scopeType: detail?.branchId ? 'BRANCH' : 'PLATFORM',
      branchId: detail?.branchId || '',
      cityTagId: detail?.city?.id || '',
      minAmountYuan: terms?.minAmountCents === undefined ? '' : String(terms.minAmountCents / 100),
      maxAmountYuan: terms?.maxAmountCents === undefined ? '' : String(terms.maxAmountCents / 100),
      locationTypes,
      locationCityTagIds,
      coverAssetId: detail?.coverAssetId || '',
      coverUrl: detail?.coverUrl || '',
      version: detail?.version || 0,
      roleOptions: cooperationRoles.map(item => ({ key: item.key, name: item.name, selected: roleKeys.has(item.key) })),
      industryGroups: catalog.industryGroups.map(group => ({
        id: group.id,
        label: group.label,
        options: group.options.map(item => ({ id: item.id, label: item.label, selected: industryIds.has(item.id) })),
      })),
      abilityOptions: catalog.abilityTags.map(item => ({ id: item.id, label: item.label, selected: abilityIds.has(item.id) })),
      teamMembers: (detail?.teamMembers || []).map(item => ({
        profileRef: item.profileRef,
        nickname: item.nickname,
        ...(item.avatarUrl ? { avatarUrl: item.avatarUrl } : {}),
        ...(item.headline ? { headline: item.headline } : {}),
      })),
    })
  },

  updateText(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    const field = String(event.currentTarget.dataset.field || '')
    if (!['title', 'valueSummary', 'targetSummary', 'description'].includes(field)) {
      return
    }
    this.setData({ [field]: event.detail.value })
  },

  chooseScope(event: WechatMiniprogram.TouchEvent) {
    const scopeType = String(event.currentTarget.dataset.scope || '') as 'PLATFORM' | 'BRANCH'
    if (!['PLATFORM', 'BRANCH'].includes(scopeType)) {
      return
    }
    this.setData({
      scopeType,
      branchId: scopeType === 'PLATFORM' ? '' : this.data.branchId,
      branchIndex: scopeType === 'PLATFORM' ? 0 : this.data.branchIndex,
    })
  },

  changeBranch(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    const branchIndex = Number(event.detail.value)
    const branch = this.data.branchOptions[branchIndex]
    if (!branch) {
      return
    }
    this.setData({ branchIndex, branchId: branch.id as BranchId | '', scopeType: branch.id ? 'BRANCH' : 'PLATFORM' })
  },

  changeCity(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    const cityIndex = Number(event.detail.value)
    const city = this.data.cityOptions[cityIndex]
    if (city) {
      this.setData({ cityIndex, cityTagId: city.id })
    }
  },

  chooseCity(event: WechatMiniprogram.TouchEvent) {
    const cityTagId = String(event.currentTarget.dataset.id || '')
    const cityIndex = this.data.cityOptions.findIndex(item => item.id === cityTagId)
    if (cityIndex < 0) {
      return
    }
    this.setData({ cityIndex, cityTagId })
  },

  updateAmount(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    const field = String(event.currentTarget.dataset.field || '')
    if (field === 'minAmountYuan' || field === 'maxAmountYuan') {
      this.setData({ [field]: event.detail.value })
    }
  },

  toggleLocationType(event: WechatMiniprogram.TouchEvent) {
    const type = String(event.currentTarget.dataset.type || '') as OpportunityLocationType
    if (!['NATIONAL', 'REMOTE'].includes(type)) {
      return
    }
    const selected = new Set(this.data.locationTypes)
    if (selected.has(type)) {
      selected.delete(type)
    }
    else { selected.add(type) }
    this.setData({ locationTypes: [...selected] })
  },

  toggleLocationCity(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id || '')
    if (!id) {
      return
    }
    const selected = new Set(this.data.locationCityTagIds)
    if (selected.has(id)) {
      selected.delete(id)
    }
    else if (selected.size < 16) {
      selected.add(id)
    }
    this.setData({ locationCityTagIds: [...selected] })
  },

  async pasteAndRecognize() {
    try {
      const clipboard = await wx.getClipboardData()
      const source = typeof clipboard.data === 'string' ? clipboard.data.trim() : ''
      if (!source) {
        wx.showToast({ title: '剪贴板中没有文字', icon: 'none' })
        return
      }
      const parsed = parseOpportunityText(source, this.data.cityOptions)
      if (!parsed.recognizedFields.length) {
        this.setData({ message: '未识别到可填写的机会信息，请按字段名称分行粘贴。' })
        return
      }
      this.setData({
        pasteDraft: parsed.draft,
        pastePreview: pastePreviewRows(parsed.draft),
        pastePreviewVisible: true,
        message: '',
      })
    }
    catch {
      this.setData({ message: '暂时无法读取剪贴板，请手动填写。' })
    }
  },

  closePastePreview() {
    this.setData({ pastePreviewVisible: false })
  },

  toggleAdvancedSettings() {
    this.setData({ advancedOpen: !this.data.advancedOpen })
  },

  handlePastePreviewVisibility(event: WechatMiniprogram.CustomEvent<{ visible?: boolean }>) {
    if (!event.detail.visible) {
      this.closePastePreview()
    }
  },

  confirmPasteDraft() {
    const draft = this.data.pasteDraft
    const cityIndex = draft.cityTagId
      ? this.data.cityOptions.findIndex(item => item.id === draft.cityTagId)
      : -1
    this.setData({
      ...(draft.title ? { title: draft.title } : {}),
      ...(draft.valueSummary ? { valueSummary: draft.valueSummary } : {}),
      ...(draft.targetSummary ? { targetSummary: draft.targetSummary } : {}),
      ...(draft.description ? { description: draft.description } : {}),
      ...(cityIndex >= 0 ? { cityTagId: draft.cityTagId, cityIndex } : {}),
      pastePreviewVisible: false,
    })
    wx.showToast({ title: '已填入，请确认内容', icon: 'none' })
  },

  toggleRole(event: WechatMiniprogram.TouchEvent) {
    const key = String(event.currentTarget.dataset.key || '')
    this.setData({ roleOptions: this.data.roleOptions.map(item => item.key === key ? { ...item, selected: !item.selected } : item) })
  },

  toggleTag(event: WechatMiniprogram.TouchEvent) {
    const type = String(event.currentTarget.dataset.type || '')
    const id = String(event.currentTarget.dataset.id || '')
    if (!id || !['industry', 'ability'].includes(type)) {
      return
    }
    if (type === 'industry') {
      this.setData({
        industryGroups: this.data.industryGroups.map(group => ({
          ...group,
          options: group.options.map(item => item.id === id ? { ...item, selected: !item.selected } : item),
        })),
      })
    }
    else {
      this.setData({ abilityOptions: this.data.abilityOptions.map(item => item.id === id ? { ...item, selected: !item.selected } : item) })
    }
  },

  openTeamPicker() {
    this.setData({ teamPickerVisible: true })
    void this.searchTeam()
  },

  closeTeamPicker() {
    this.setData({ teamPickerVisible: false })
  },

  handleTeamPickerVisibility(event: WechatMiniprogram.CustomEvent<{ visible?: boolean }>) {
    if (!event.detail.visible) {
      this.closeTeamPicker()
    }
  },

  updateTeamKeyword(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    this.setData({ teamKeyword: event.detail.value })
  },

  async searchTeam() {
    if (this.data.teamLoading) {
      return
    }
    this.setData({ teamLoading: true, message: '' })
    try {
      const selected = new Set(this.data.teamMembers.map(item => item.profileRef))
      const page = await opportunityModule.listPeople({
        kind: 'PLAYER',
        keyword: this.data.teamKeyword.trim() || undefined,
        limit: 20,
      })
      this.setData({
        teamCandidates: page.items
          .filter(item => !item.isSelf)
          .map(item => ({ ...item, selected: selected.has(item.profileRef) })),
      })
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '团队成员加载失败' })
    }
    finally {
      this.setData({ teamLoading: false })
    }
  },

  toggleTeamMember(event: WechatMiniprogram.TouchEvent) {
    const profileRef = String(event.currentTarget.dataset.profileRef || '')
    const candidate = this.data.teamCandidates.find(item => item.profileRef === profileRef)
    if (!candidate) {
      return
    }
    const exists = this.data.teamMembers.some(item => item.profileRef === profileRef)
    if (!exists && this.data.teamMembers.length >= 8) {
      wx.showToast({ title: '最多选择 8 名成员', icon: 'none' })
      return
    }
    const teamMembers = exists
      ? this.data.teamMembers.filter(item => item.profileRef !== profileRef)
      : [...this.data.teamMembers, {
          profileRef: candidate.profileRef,
          nickname: candidate.nickname || 'MIP 用户',
          ...(candidate.avatarUrl ? { avatarUrl: candidate.avatarUrl } : {}),
          ...(candidate.headline ? { headline: candidate.headline } : {}),
        }]
    this.setData({
      teamMembers,
      teamCandidates: this.data.teamCandidates.map(item => (
        item.profileRef === profileRef ? { ...item, selected: !exists } : item
      )),
    })
  },

  removeTeamMember(event: WechatMiniprogram.TouchEvent) {
    const profileRef = String(event.currentTarget.dataset.profileRef || '')
    this.setData({
      teamMembers: this.data.teamMembers.filter(item => item.profileRef !== profileRef),
      teamCandidates: this.data.teamCandidates.map(item => (
        item.profileRef === profileRef ? { ...item, selected: false } : item
      )),
    })
  },

  async chooseCover() {
    if (this.data.coverUploading || this.data.saving) {
      return
    }
    this.setData({ coverUploading: true, message: '' })
    try {
      const sourcePath = await chooseSingleImage()
      const asset = await mipMediaModule.uploadImageFromPath('OPPORTUNITY_COVER', sourcePath)
      this.setData({ coverAssetId: asset.assetId, coverUrl: asset.imageUrl })
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '封面上传失败，请重试。' })
    }
    finally {
      this.setData({ coverUploading: false })
    }
  },

  saveDraft() { void this.save(false) },
  publish() { void this.save(true) },

  async save(publish: boolean) {
    if (this.data.saving || this.data.coverUploading) {
      return
    }
    this.setData({ saving: true, message: '' })
    try {
      const minAmountCents = this.data.minAmountYuan.trim() ? Math.round(Number(this.data.minAmountYuan) * 100) : undefined
      const maxAmountCents = this.data.maxAmountYuan.trim() ? Math.round(Number(this.data.maxAmountYuan) * 100) : undefined
      const structuredLocations = [
        ...this.data.locationCityTagIds.map(cityTagId => ({ type: 'CITY' as const, cityTagId })),
        ...this.data.locationTypes.map(type => ({ type })),
      ]
      const hasCommercialTerms = structuredLocations.length > 0 || minAmountCents !== undefined || maxAmountCents !== undefined
      const result = await opportunityModule.save({
        id: this.data.id || undefined,
        expectedVersion: this.data.id ? this.data.version : undefined,
        title: this.data.title,
        valueSummary: this.data.valueSummary,
        targetSummary: this.data.targetSummary,
        description: this.data.description,
        scopeType: this.data.scopeType,
        branchId: this.data.branchId || undefined,
        cityTagId: this.data.cityTagId || undefined,
        ...(hasCommercialTerms
          ? {
              commercialTerms: { currency: 'CNY' as const, amountUnit: 'CNY_CENTS' as const, minAmountCents, maxAmountCents, locations: structuredLocations },
            }
          : {}),
        coverAssetId: this.data.coverAssetId || undefined,
        roleKeys: this.data.roleOptions.filter(item => item.selected).map(item => item.key),
        industryTagIds: this.data.industryGroups
          .flatMap(group => group.options)
          .filter(item => item.selected)
          .map(item => item.id),
        abilityTagIds: this.data.abilityOptions.filter(item => item.selected).map(item => item.id),
        teamProfileRefs: this.data.teamMembers.map(item => item.profileRef),
        publish,
      })
      this.setData({ id: result.id, version: result.version })
      wx.showToast({ title: result.status === 'PUBLISHED' ? '机会已发布' : '草稿已保存', icon: 'success' })
      this.clearNavigationTimer()
      this.navigationTimer = setTimeout(() => {
        this.navigationTimer = undefined
        wx.navigateBack()
      }, 500)
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '保存失败' })
    }
    finally {
      this.setData({ saving: false })
    }
  },
})
