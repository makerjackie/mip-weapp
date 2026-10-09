import type { BranchId, CooperationRoleKey, OpportunityId } from '../../../../modules/mip'
import type { AiDraftId } from '../../../../modules/mip-ai'
import type { OpportunityCatalog, OpportunityDetail, OpportunityLocationType, OpportunityProjectStatus, OpportunityTypeKey } from '../../../../modules/mip-opportunities'
import type { OpportunityTextDraft } from '../../../../modules/mip-opportunities/text-parser'
import { brand } from '../../../../config/brand'
import { cooperationRoles } from '../../../../config/mip-catalogs'
import { mipAiModule } from '../../../../modules/mip-ai/client'
import { loadAiEditorDraft } from '../../../../modules/mip-ai/editor-loader'
import { mipMediaModule } from '../../../../modules/mip-media/client'
import { GUIDE_PENDING_STORAGE_KEY, writePendingGuideOpportunity } from '../../../../modules/mip-messaging/guide-policy'
import { journeyStatusOf, opportunityModule, opportunityProjectStatusOptions, opportunityTypeOptions } from '../../../../modules/mip-opportunities'
import { parseOpportunityAiDraft } from '../../../../modules/mip-opportunities/ai-draft'
import { parseOpportunityText } from '../../../../modules/mip-opportunities/text-parser'
import { chooseSingleImage } from '../../../../platform/wechat/image-upload'

interface RoleOption { key: CooperationRoleKey, name: string, selected: boolean }
interface TypeOption { key: OpportunityTypeKey, label: string, hint: string, selected: boolean }
interface TeamSelection { profileRef: string, nickname: string, avatarUrl?: string, headline?: string }
interface CityOption { id: string, label: string }
type OpportunityEditorMode = 'CREATE' | 'DRAFT' | 'PUBLISHED'
/** journey-review J4-04 ⑥：顶层可见范围两选项。 */
type VisibilityChoice = 'PLATFORM' | 'INTERNAL'

const cityPriority = ['深圳', '北京', '上海', '成都', '广州', '中国香港', '中国澳门', '海外']

/** figma 3359:6086 机会类型行序：找企业 / 找伙伴 / 找资源（QZ1 三件套仍为多选）。 */
const typeDisplayOrder: OpportunityTypeKey[] = ['COMPANY', 'PARTNER', 'RESOURCE']

/** figma 3359:6086 各类型行的示例说明文案（设计稿原文，「找找」笔误已修）。 */
const typeHints: Record<OpportunityTypeKey, string> = {
  COMPANY: '我想签腾讯的营销年框',
  RESOURCE: '我想和张凌赫吃顿饭',
  PARTNER: '我想找一个AI技术合伙人',
}

function typeOptionViews(selectedKeys: Set<OpportunityTypeKey>) {
  return typeDisplayOrder
    .map((key) => {
      const option = opportunityTypeOptions.find(item => item.key === key)
      return option
        ? { key: option.key, label: option.label, hint: typeHints[option.key], selected: selectedKeys.has(option.key) }
        : undefined
    })
    .filter((item): item is TypeOption => Boolean(item))
}

/** 项目状态收起行的完整文案：状态名 + 终审说明（QZ2 文案单点取自 catalog）；逗号随 figma 3359:6086 用半角。 */
function projectStatusTextOf(key: OpportunityProjectStatus) {
  const option = opportunityProjectStatusOptions.find(item => item.key === key)
  return option ? `${option.label}, ${option.description}` : ''
}

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

function isCancelledImageSelection(error: unknown) {
  const message = error instanceof Error
    ? error.message
    : typeof (error as { errMsg?: unknown })?.errMsg === 'string'
      ? String((error as { errMsg: string }).errMsg)
      : ''
  return /cancel/i.test(message)
}

/** 只有已发布的项目可结束或下架。 */
function projectStatusOptionViews(editorMode: OpportunityEditorMode) {
  return opportunityProjectStatusOptions.map((item) => {
    if (item.key !== 'RECRUITING' && editorMode !== 'PUBLISHED') {
      return { ...item, disabled: true, disabledNote: '发布后可调整状态' }
    }
    return { ...item, disabled: false, disabledNote: '' }
  })
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
    /** journey-review J4-04 ⑤：主营地区（选填），示例「南山十亩地」。 */
    regionText: '',
    titleError: '',
    valueSummaryError: '',
    targetSummaryError: '',
    playersOnly: false,
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
    defaultCoverUrl: brand.opportunityDefaultCoverPath,
    coverUploading: false,
    catalog: { branches: [], cityTags: [], industryGroups: [], industryTags: [], abilityTags: [] } as OpportunityCatalog,
    cityOptions: [{ id: '', label: '全国' }],
    cityGridOptions: [] as CityOption[],
    /** journey-review J4-04 ④：粘贴识别一键完成，就地填入不跳页。 */
    pasteRecognizing: false,
    aiDraftId: '',
    pasteAiDraftId: '' as AiDraftId | '',
    pasteAiDraftVersion: 0,
    confirmedAiDraftId: '' as AiDraftId | '',
    confirmedAiDraftVersion: 0,
    // 「更多设置」已删（2026-10-07 客户确认）：行业/能力不再提供编辑入口，
    // 但保留数据回填与提交组装，编辑存量机会时原值原样带回，避免误清。
    industryTagIds: [] as string[],
    abilityTagIds: [] as string[],
    // MIW-50：合作角色不再是表单项（设计稿无此字段），roleOptions 仅承接
    // 存量机会的角色回填，保存时原样带回，避免误清管理后台维护的数据。
    roleOptions: cooperationRoles.map(item => ({ key: item.key, name: item.name, selected: false })) as RoleOption[],
    /** journey-review QZ1：机会类型三件套（找企业/找伙伴/找资源），多选。 */
    typeOptions: typeOptionViews(new Set()),
    /** journey-review QZ2：项目状态三态半屏（「下架项目」暂置灰，见 projectStatusOptionViews）。 */
    projectStatus: 'RECRUITING' as OpportunityProjectStatus,
    projectStatusText: projectStatusTextOf('RECRUITING'),
    projectStatusOptions: projectStatusOptionViews('CREATE'),
    statusSheetVisible: false,
    teamMembers: [] as TeamSelection[],
  },
  navigationTimer: undefined as ReturnType<typeof setTimeout> | undefined,
  // 返回守卫状态：dirty=有未保存修改，alertArmed=已注册原生返回确认（MIP-4，与合作卡编辑器对称）
  dirty: false,
  alertArmed: false,

  onLoad(options: Record<string, string | undefined>) {
    const id = String(options.id || '') as OpportunityId | ''
    this.setData({ id, aiDraftId: '' })
    wx.setNavigationBarTitle({ title: id ? '编辑机会' : '发布机会' })
    void this.initialize()
  },

  onHide() {
    this.clearNavigationTimer()
  },

  onUnload() {
    this.clearNavigationTimer()
    this.markClean()
  },

  clearNavigationTimer() {
    if (this.navigationTimer !== undefined) {
      clearTimeout(this.navigationTimer)
      this.navigationTimer = undefined
    }
  },

  /** 用户改动任一字段后登记 dirty，并武装原生返回确认（确定=放弃修改并返回，取消=留下）。 */
  touch() {
    if (this.data.state !== 'ready') {
      return
    }
    this.dirty = true
    if (!this.alertArmed) {
      this.alertArmed = true
      wx.enableAlertBeforeUnload({ message: '机会尚未保存，返回将丢失已填写内容' })
    }
  },

  markClean() {
    this.dirty = false
    if (this.alertArmed) {
      this.alertArmed = false
      wx.disableAlertBeforeUnload()
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
      this.setData({ editorMode, projectStatusOptions: projectStatusOptionViews(editorMode) })
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
      if (aiSource) {
        // AI 草稿覆盖了表单内容，视为未保存修改
        this.touch()
      }
    }
    catch (error) {
      this.setData({ state: 'error', message: error instanceof Error ? error.message : '页面加载失败' })
    }
  },

  applyCatalog(catalog: OpportunityCatalog, detail: OpportunityDetail | null) {
    const cityOptions = [{ id: '', label: '全国' }, ...catalog.cityTags]
    const roleKeys = new Set(detail?.roles || [])
    const branchId = detail?.branchId || ''
    const cityIndex = detail?.city?.id
      ? Math.max(0, cityOptions.findIndex(item => item.id === detail.city?.id))
      : 0
    const terms = detail?.commercialTerms
    const locationTypes = terms?.locations.filter(item => item.type !== 'CITY').map(item => item.type) || []
    const locationCityTagIds = terms?.locations.filter(item => item.type === 'CITY').map(item => item.city?.id || item.cityTagId || '').filter(Boolean) || []
    const journeyStatus = detail ? journeyStatusOf(detail) : 'DRAFT'
    const projectStatus: OpportunityProjectStatus = journeyStatus === 'UNPUBLISHED'
      ? 'UNPUBLISHED'
      : journeyStatus === 'ENDED' ? 'ENDED' : 'RECRUITING'
    const typeKeys = new Set(detail?.typeKeys || [])
    this.setData({
      catalog,
      cityOptions,
      cityGridOptions: cityGridOptions(cityOptions, detail?.city?.id || ''),
      branchId,
      cityIndex,
      title: detail?.title || '',
      valueSummary: detail?.valueSummary || '',
      targetSummary: detail?.targetSummary || '',
      description: detail?.description || '',
      regionText: detail?.regionText || '',
      titleError: '',
      valueSummaryError: '',
      targetSummaryError: '',
      playersOnly: detail?.playersOnly === true,
      scopeType: detail?.branchId ? 'BRANCH' : 'PLATFORM',
      cityTagId: detail?.city?.id || '',
      minAmountYuan: terms?.minAmountCents === undefined ? '' : String(terms.minAmountCents / 100),
      maxAmountYuan: terms?.maxAmountCents === undefined ? '' : String(terms.maxAmountCents / 100),
      locationTypes,
      locationCityTagIds,
      coverAssetId: detail?.coverAssetId || '',
      coverUrl: detail?.coverUrl || '',
      version: detail?.version || 0,
      roleOptions: cooperationRoles.map(item => ({ key: item.key, name: item.name, selected: roleKeys.has(item.key) })),
      typeOptions: typeOptionViews(typeKeys),
      projectStatus,
      projectStatusText: projectStatusTextOf(projectStatus),
      industryTagIds: detail?.industryTags.map(item => item.id) || [],
      abilityTagIds: detail?.abilityTags.map(item => item.id) || [],
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
    if (!['title', 'valueSummary', 'targetSummary', 'description', 'regionText'].includes(field)) {
      return
    }
    this.touch()
    this.setData({
      [field]: event.detail.value,
      ...(['title', 'valueSummary', 'targetSummary'].includes(field) ? { [`${field}Error`]: '' } : {}),
    })
  },

  /**
   * journey-review J4-04 ④（figma 3359:6086）：虚线卡「粘贴并识别」一键读取剪贴板，
   * 结构化识别后就地填入，不跳页、不再弹预览层（M1 00:49:25）。
   */
  async pasteAndRecognize() {
    if (this.data.pasteRecognizing) {
      return
    }
    let source = ''
    try {
      const clipboard = await wx.getClipboardData()
      source = typeof clipboard.data === 'string' ? clipboard.data.trim() : ''
    }
    catch {
      this.setData({ message: '暂时无法读取剪贴板，请复制文字后再试。' })
      return
    }
    if (!source) {
      wx.showToast({ title: '剪贴板中没有文字', icon: 'none' })
      return
    }
    this.setData({ pasteRecognizing: true, message: '' })
    try {
      const aiDraft = await mipAiModule.createTextDraft({
        purpose: 'OPPORTUNITY',
        transcriptText: source,
      })
      const parsed = parseOpportunityAiDraft(aiDraft.structuredDraft, this.data.cityOptions)
      if (aiDraft.status !== 'DRAFT_READY' || !parsed.recognizedFields.length) {
        throw new Error('智能识别未返回可用内容')
      }
      this.applyPastedDraft(parsed.draft)
      this.setData({
        pasteAiDraftId: aiDraft.id,
        pasteAiDraftVersion: aiDraft.version,
        confirmedAiDraftId: aiDraft.id,
        confirmedAiDraftVersion: aiDraft.version,
      })
      wx.showToast({ title: '已使用智能识别，请核对结果。', icon: 'none' })
    }
    catch {
      const parsed = parseOpportunityText(source, this.data.cityOptions)
      if (!parsed.recognizedFields.length) {
        this.setData({ message: '暂时无法识别这段内容，请手动填写。' })
        return
      }
      this.applyPastedDraft(parsed.draft)
      this.setData({
        pasteAiDraftId: '',
        pasteAiDraftVersion: 0,
        confirmedAiDraftId: '',
        confirmedAiDraftVersion: 0,
      })
      wx.showToast({ title: '智能识别暂时不可用，已使用基础识别，请重点核对。', icon: 'none' })
    }
    finally {
      this.setData({ pasteRecognizing: false })
    }
  },

  applyPastedDraft(draft: OpportunityTextDraft) {
    const cityIndex = draft.cityTagId
      ? this.data.cityOptions.findIndex(item => item.id === draft.cityTagId)
      : -1
    this.touch()
    this.setData({
      ...(draft.title ? { title: draft.title, titleError: '' } : {}),
      ...(draft.valueSummary ? { valueSummary: draft.valueSummary, valueSummaryError: '' } : {}),
      ...(draft.targetSummary ? { targetSummary: draft.targetSummary, targetSummaryError: '' } : {}),
      ...(draft.description ? { description: draft.description } : {}),
      ...(cityIndex >= 0 ? { cityTagId: draft.cityTagId, cityIndex } : {}),
      message: '',
    })
  },

  changeCity(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    const cityIndex = Number(event.detail.value)
    const city = this.data.cityOptions[cityIndex]
    if (city) {
      this.touch()
      this.setData({ cityIndex, cityTagId: city.id })
    }
  },

  chooseCity(event: WechatMiniprogram.TouchEvent) {
    const cityTagId = String(event.currentTarget.dataset.id || '')
    const cityIndex = this.data.cityOptions.findIndex(item => item.id === cityTagId)
    if (cityIndex < 0) {
      return
    }
    this.touch()
    this.setData({ cityIndex, cityTagId })
  },

  /** journey-review QZ1：机会类型三件套多选。 */
  /** 找资源/找企业/找伙伴单选（figma 1768_37369 详情只挂一个类型标签）。 */
  toggleTypeOption(event: WechatMiniprogram.TouchEvent) {
    const key = String(event.currentTarget.dataset.key || '')
    const typeOptions = this.data.typeOptions.map(item => (
      item.key === key ? { ...item, selected: !item.selected } : { ...item, selected: false }
    ))
    this.touch()
    this.setData({ typeOptions })
  },

  /** journey-review QZ2：项目状态半屏选择。 */
  openStatusSheet() {
    this.setData({ statusSheetVisible: true })
  },

  closeStatusSheet() {
    this.setData({ statusSheetVisible: false })
  },

  handleStatusSheetVisibility(event: WechatMiniprogram.CustomEvent<{ visible?: boolean }>) {
    if (!event.detail.visible) {
      this.closeStatusSheet()
    }
  },

  /** journey-review QZ2：项目状态半屏选择；新建项目只能选择招募中。 */
  chooseProjectStatus(event: WechatMiniprogram.TouchEvent) {
    const key = String(event.currentTarget.dataset.key || '') as OpportunityProjectStatus
    const option = this.data.projectStatusOptions.find(item => item.key === key)
    if (!option || option.disabled) {
      return
    }
    this.touch()
    this.setData({ projectStatus: key, projectStatusText: projectStatusTextOf(key), statusSheetVisible: false })
  },

  /** journey-review J4-04 ⑥：顶层可见范围两选项。 */
  chooseVisibility(event: WechatMiniprogram.TouchEvent) {
    const choice = String(event.currentTarget.dataset.visibility || '') as VisibilityChoice
    if (choice === 'PLATFORM' || choice === 'INTERNAL') {
      this.touch()
      this.setData({ playersOnly: choice === 'INTERNAL' })
    }
  },

  async chooseCover() {
    if (this.data.coverUploading || this.data.saving) {
      return
    }
    this.setData({ coverUploading: true, coverMessage: '' })
    try {
      const sourcePath = await chooseSingleImage()
      const asset = await mipMediaModule.uploadImageFromPath('OPPORTUNITY_COVER', sourcePath)
      this.touch()
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

  // MIW-50：不再提供「保存草稿」入口，表单只以发布收口（publish 恒为 true）。
  publish() { void this.save(true) },

  validateRequiredFields() {
    const titleError = this.data.title.trim() ? '' : '请输入机会名称。'
    const valueSummaryError = this.data.valueSummary.trim() ? '' : '请输入价值金额或价值说明。'
    const targetSummaryError = this.data.targetSummary.trim() ? '' : '请输入寻找合作方的说明。'
    const firstIssue = [
      { message: titleError, selector: '#opportunity-field-title' },
      { message: valueSummaryError, selector: '#opportunity-field-value-summary' },
      { message: targetSummaryError, selector: '#opportunity-field-target-summary' },
    ].find(issue => issue.message)

    this.setData({
      titleError,
      valueSummaryError,
      targetSummaryError,
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
        regionText: this.data.regionText || undefined,
        playersOnly: this.data.playersOnly,
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
        typeKeys: this.data.typeOptions.filter(item => item.selected).map(item => item.key),
        industryTagIds: this.data.industryTagIds,
        abilityTagIds: this.data.abilityTagIds,
        teamProfileRefs: this.data.teamMembers.map(item => item.profileRef),
        publish,
        ...(publish ? { publicationStatus: this.data.projectStatus === 'RECRUITING' ? 'PUBLISHED' as const : this.data.projectStatus } : {}),
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
      // 保存成功先解除返回守卫，避免自动返回详情时误弹确认框
      this.markClean()
      // MIW-40 S8：发布成功记 pending，发布者落地页（机会列表/详情）onShow 消费后
      // 弹订阅授权引导层；带 TTL，错过窗口即回退进详情的既有时机。
      if (publish && result.status === 'PUBLISHED') {
        const pending = writePendingGuideOpportunity(result.id, Date.now())
        if (pending) {
          wx.setStorageSync(GUIDE_PENDING_STORAGE_KEY, pending)
        }
      }
      wx.showToast({
        title: result.status === 'UNPUBLISHED' ? '项目已下架' : result.status === 'ENDED' ? '项目已结束' : '机会已发布',
        icon: 'success',
      })
      this.clearNavigationTimer()
      this.navigationTimer = setTimeout(() => {
        this.navigationTimer = undefined
        // MIW-50：编辑存量机会保存后必须落回该机会的详情页。栈里能找到本机会
        // 的详情就按 delta 返回（顺带清掉栈中夹层的旧编辑页）；新建流程维持
        // journey-review J4-04 口径：确认发布回上级页面，无上级时落详情。
        if (this.data.id === result.id) {
          const pages = getCurrentPages() as Array<{ route?: string, options?: Record<string, string> }>
          const detailRoute = 'packages/member/mip-opportunities/detail/index'
          const currentIndex = pages.length - 1
          for (let index = currentIndex - 1; index >= 0; index -= 1) {
            const page = pages[index]
            if (page.route === detailRoute && page.options?.id === result.id) {
              wx.navigateBack({ delta: currentIndex - index })
              return
            }
          }
          wx.redirectTo({
            url: `/packages/member/mip-opportunities/detail/index?id=${encodeURIComponent(result.id)}`,
          })
          return
        }
        if (getCurrentPages().length > 1) {
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
      wx.showToast({ title: '保存失败，请重试', icon: 'none' })
    }
    finally {
      this.setData({ saving: false })
    }
  },
})
