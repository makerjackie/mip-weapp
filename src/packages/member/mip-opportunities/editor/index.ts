import type { BranchId, CooperationRoleKey, OpportunityId } from '../../../../modules/mip'
import type { AiDraftId } from '../../../../modules/mip-ai'
import type { OpportunityCatalog, OpportunityDetail, OpportunityLocationType, PublicPerson } from '../../../../modules/mip-opportunities'
import type { OpportunityTextDraft } from '../../../../modules/mip-opportunities/text-parser'
import { cooperationRoles } from '../../../../config/mip-catalogs'
import { mipAiModule } from '../../../../modules/mip-ai/client'
import { loadAiEditorDraft } from '../../../../modules/mip-ai/editor-loader'
import { mipMediaModule } from '../../../../modules/mip-media/client'
import { opportunityModule } from '../../../../modules/mip-opportunities'
import { parseOpportunityAiDraft } from '../../../../modules/mip-opportunities/ai-draft'
import { parseOpportunityText } from '../../../../modules/mip-opportunities/text-parser'
import { chooseSingleImage } from '../../../../platform/wechat/image-upload'

interface SelectOption { id: string, label: string, selected: boolean }
interface IndustryGroupOption { id: string, label: string, options: SelectOption[] }
interface RoleOption { key: CooperationRoleKey, name: string, selected: boolean }
interface TeamSelection { profileRef: string, nickname: string, avatarUrl?: string, headline?: string }
interface TeamCandidate extends PublicPerson { selected: boolean }
interface CityOption { id: string, label: string }
interface PastePreviewRow { key: string, label: string, value: string }
type OpportunityEditorMode = 'CREATE' | 'DRAFT' | 'PUBLISHED'

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

function isCancelledImageSelection(error: unknown) {
  const message = error instanceof Error
    ? error.message
    : typeof (error as { errMsg?: unknown })?.errMsg === 'string'
      ? String((error as { errMsg: string }).errMsg)
      : ''
  return /cancel/i.test(message)
}

Page({
  data: {
    id: '' as OpportunityId | '',
    version: 0,
    state: 'loading' as 'loading' | 'ready' | 'error',
    editorMode: 'CREATE' as OpportunityEditorMode,
    saving: false,
    message: '',
    coverMessage: '',
    title: '',
    valueSummary: '',
    targetSummary: '',
    description: '',
    titleError: '',
    valueSummaryError: '',
    targetSummaryError: '',
    descriptionError: '',
    roleError: '',
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
    pasteRecognizing: false,
    aiDraftId: '',
    pasteAiDraftId: '' as AiDraftId | '',
    pasteAiDraftVersion: 0,
    confirmedAiDraftId: '' as AiDraftId | '',
    confirmedAiDraftVersion: 0,
    pasteRecognitionNotice: '',
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
    const id = String(options.id || '') as OpportunityId | ''
    this.setData({ id, aiDraftId: String(options.aiDraftId || '') })
    wx.setNavigationBarTitle({ title: id ? '编辑机会' : '发布机会' })
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
      if (this.data.id && this.data.aiDraftId) {
        throw new Error('AI 草稿不能覆盖已有机会')
      }
      const [catalog, detail, aiSource] = await Promise.all([
        opportunityModule.getCatalogs(),
        this.data.id ? opportunityModule.get(this.data.id) : Promise.resolve(null),
        this.data.aiDraftId ? loadAiEditorDraft(this.data.aiDraftId, 'OPPORTUNITY') : Promise.resolve(null),
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
      const editorMode: OpportunityEditorMode = detail?.status === 'DRAFT'
        ? 'DRAFT'
        : detail?.status === 'PUBLISHED' ? 'PUBLISHED' : 'CREATE'
      wx.setNavigationBarTitle({
        title: editorMode === 'CREATE' ? '发布机会' : editorMode === 'DRAFT' ? '编辑草稿' : '编辑机会',
      })
      this.setData({ editorMode })
      this.applyCatalog(catalog, detail)
      if (aiSource) {
        const parsed = parseOpportunityAiDraft(aiSource.fields, this.data.cityOptions)
        const cityIndex = parsed.draft.cityTagId
          ? this.data.cityOptions.findIndex(item => item.id === parsed.draft.cityTagId)
          : -1
        this.setData({
          ...(parsed.draft.title ? { title: parsed.draft.title } : {}),
          ...(parsed.draft.valueSummary ? { valueSummary: parsed.draft.valueSummary } : {}),
          ...(parsed.draft.targetSummary ? { targetSummary: parsed.draft.targetSummary } : {}),
          ...(parsed.draft.description ? { description: parsed.draft.description } : {}),
          ...(cityIndex >= 0 ? { cityTagId: parsed.draft.cityTagId, cityIndex } : {}),
          confirmedAiDraftId: aiSource.confirmation.draftId,
          confirmedAiDraftVersion: aiSource.confirmation.expectedVersion,
        })
      }
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
      titleError: '',
      valueSummaryError: '',
      targetSummaryError: '',
      descriptionError: '',
      roleError: '',
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
    this.setData({ [field]: event.detail.value, [`${field}Error`]: '' })
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
    if (this.data.pasteRecognizing) {
      return
    }

    let source = ''
    try {
      const clipboard = await wx.getClipboardData()
      source = typeof clipboard.data === 'string' ? clipboard.data.trim() : ''
      if (!source) {
        wx.showToast({ title: '剪贴板中没有文字', icon: 'none' })
        return
      }
    }
    catch {
      this.setData({ message: '暂时无法读取剪贴板，请手动填写。' })
      return
    }

    this.setData({ pasteRecognizing: true, message: '', pasteRecognitionNotice: '' })
    try {
      const aiDraft = await mipAiModule.createTextDraft({
        purpose: 'OPPORTUNITY',
        transcriptText: source,
      })
      const parsed = parseOpportunityAiDraft(aiDraft.structuredDraft, this.data.cityOptions)
      if (aiDraft.status !== 'DRAFT_READY' || !parsed.recognizedFields.length) {
        throw new Error('智能识别未返回可用内容')
      }
      this.setData({
        pasteDraft: parsed.draft,
        pastePreview: pastePreviewRows(parsed.draft),
        pastePreviewVisible: true,
        pasteAiDraftId: aiDraft.id,
        pasteAiDraftVersion: aiDraft.version,
        pasteRecognitionNotice: '已使用智能识别，请核对结果。',
        message: '',
      })
    }
    catch {
      const parsed = parseOpportunityText(source, this.data.cityOptions)
      if (!parsed.recognizedFields.length) {
        this.setData({ message: '暂时无法识别这段内容，请手动填写。' })
        return
      }
      this.setData({
        pasteDraft: parsed.draft,
        pastePreview: pastePreviewRows(parsed.draft),
        pastePreviewVisible: true,
        pasteAiDraftId: '',
        pasteAiDraftVersion: 0,
        pasteRecognitionNotice: '智能识别暂时不可用，已使用基础识别，请重点核对。',
        message: '',
      })
    }
    finally {
      this.setData({ pasteRecognizing: false })
    }
  },

  closePastePreview() {
    this.setData({
      pastePreviewVisible: false,
      pasteAiDraftId: '',
      pasteAiDraftVersion: 0,
      pasteRecognitionNotice: '',
    })
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
      ...(draft.title ? { titleError: '' } : {}),
      ...(draft.valueSummary ? { valueSummaryError: '' } : {}),
      ...(draft.targetSummary ? { targetSummaryError: '' } : {}),
      ...(draft.description ? { descriptionError: '' } : {}),
      ...(cityIndex >= 0 ? { cityTagId: draft.cityTagId, cityIndex } : {}),
      pastePreviewVisible: false,
      confirmedAiDraftId: this.data.pasteAiDraftId,
      confirmedAiDraftVersion: this.data.pasteAiDraftVersion,
      pasteAiDraftId: '',
      pasteAiDraftVersion: 0,
      pasteRecognitionNotice: '',
    })
    wx.showToast({ title: '已填入，请确认内容', icon: 'none' })
  },

  toggleRole(event: WechatMiniprogram.TouchEvent) {
    const key = String(event.currentTarget.dataset.key || '')
    const roleOptions = this.data.roleOptions.map(item => item.key === key ? { ...item, selected: !item.selected } : item)
    this.setData({
      roleOptions,
      roleError: roleOptions.some(item => item.selected) ? '' : this.data.roleError,
    })
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
    this.setData({ coverUploading: true, coverMessage: '' })
    try {
      const sourcePath = await chooseSingleImage()
      const asset = await mipMediaModule.uploadImageFromPath('OPPORTUNITY_COVER', sourcePath)
      this.setData({ coverAssetId: asset.assetId, coverUrl: asset.imageUrl })
    }
    catch (error) {
      if (isCancelledImageSelection(error)) {
        return
      }
      this.setData({
        coverMessage: `${error instanceof Error ? error.message : '封面上传失败，请重试。'} 封面为选填，可以稍后补充。`,
      })
    }
    finally {
      this.setData({ coverUploading: false })
    }
  },

  saveDraft() { void this.save(false) },
  publish() { void this.save(true) },

  validateRequiredFields() {
    const titleError = this.data.title.trim() ? '' : '请输入项目名称。'
    const valueSummaryError = this.data.valueSummary.trim() ? '' : '请输入价值金额或价值说明。'
    const targetSummaryError = this.data.targetSummary.trim() ? '' : '请输入寻找合作方的说明。'
    const descriptionError = this.data.description.trim() ? '' : '请输入项目说明。'
    const roleError = this.data.roleOptions.some(item => item.selected) ? '' : '请至少选择一种合作角色。'
    const firstIssue = [
      { message: titleError, selector: '#opportunity-field-title' },
      { message: valueSummaryError, selector: '#opportunity-field-value-summary' },
      { message: targetSummaryError, selector: '#opportunity-field-target-summary' },
      { message: descriptionError, selector: '#opportunity-field-description' },
      { message: roleError, selector: '#opportunity-field-roles' },
    ].find(issue => issue.message)

    this.setData({
      titleError,
      valueSummaryError,
      targetSummaryError,
      descriptionError,
      roleError,
      message: '',
    })
    if (!firstIssue) {
      return true
    }
    wx.showToast({ title: firstIssue.message, icon: 'none' })
    wx.pageScrollTo({ selector: firstIssue.selector, duration: 200 })
    return false
  },

  async save(publish: boolean) {
    if (this.data.saving || this.data.coverUploading) {
      return
    }
    if (!this.validateRequiredFields()) {
      return
    }
    const wasExisting = Boolean(this.data.id)
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
        ...(this.data.confirmedAiDraftId
          ? {
              aiConfirmation: {
                draftId: this.data.confirmedAiDraftId,
                expectedVersion: this.data.confirmedAiDraftVersion,
              },
            }
          : {}),
      })
      this.setData({
        id: result.id,
        version: result.version,
        confirmedAiDraftId: '',
        confirmedAiDraftVersion: 0,
      })
      wx.showToast({ title: result.status === 'PUBLISHED' ? '机会已发布' : '草稿已保存', icon: 'success' })
      this.clearNavigationTimer()
      this.navigationTimer = setTimeout(() => {
        this.navigationTimer = undefined
        const detailRoute = 'packages/member/mip-opportunities/detail/index'
        const pages = getCurrentPages()
        const previousPage = pages.length > 1 ? pages[pages.length - 2] : undefined
        if (wasExisting && previousPage?.route === detailRoute) {
          wx.navigateBack()
          return
        }
        wx.redirectTo({
          url: `/packages/member/mip-opportunities/detail/index?id=${encodeURIComponent(result.id)}`,
        })
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
