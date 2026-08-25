import type {
  AdminMessageCampaign,
  AdminMessageCampaignDispatch,
  AdminMessageCampaignDraft,
  AdminMessageCampaignSafetyStatus,
  AdminMessageCampaignStatus,
  AdminMessageRecipientCandidate,
  AdminMessageTemplate,
  AdminMessageTemplateDraft,
  AdminMessageTemplateSafetyStatus,
  AdminMessageTemplateStatus,
} from '../../../modules/mip-admin'
import type { AdminPageState } from '../shared/page-state'
import { hasCapability, mipAdminModule } from '../../../modules/mip-admin'
import { formatLocalDateTime } from '../../../utils/date'
import {
  adminLoadFailure,
  isAdminForbiddenError,
  isAdminVersionConflict,
} from '../shared/page-state'

type PageState = AdminPageState | 'empty'
type CampaignView = AdminMessageCampaign & {
  statusText: string
  scopeText: string
  updatedText: string
  dispatchText: string
}
type CandidateView = AdminMessageRecipientCandidate & { selected: boolean }
type DispatchView = AdminMessageCampaignDispatch & {
  statusText: string
  scheduledText: string
  noteText: string
  needsManualReview: boolean
  canModify: boolean
  canCancel: boolean
}
type TemplateView = AdminMessageTemplate & {
  statusText: string
  safetyText: string
  scopeText: string
  updatedText: string
}

const statusLabels: Record<AdminMessageCampaignStatus, string> = {
  DRAFT: '草稿',
  READY: '待发布',
  PUBLISHED: '已发布',
  WITHDRAWN: '已撤销',
}
const safetyLabels: Record<AdminMessageCampaignSafetyStatus, string> = {
  PENDING: '待检查',
  PASSED: '已通过',
  REJECTED: '未通过',
  ERROR: '检查失败',
}
const templateStatusLabels: Record<AdminMessageTemplateStatus, string> = {
  DRAFT: '草稿',
  ACTIVE: '启用',
  ARCHIVED: '归档',
}
const templateSafetyLabels: Record<AdminMessageTemplateSafetyStatus, string> = {
  PENDING: '待检查',
  PASSED: '已通过',
  REJECTED: '未通过',
  ERROR: '检查失败',
}
const dispatchStatusLabels: Record<AdminMessageCampaignDispatch['status'], string> = {
  SCHEDULED: '已计划',
  PROCESSING: '正在发送',
  FAILED: '发送未完成',
}
const minimumScheduleLeadMs = 5 * 60 * 1000
const defaultScheduleBufferMs = 60 * 1000

function padDatePart(value: number) {
  return String(value).padStart(2, '0')
}

function localPickerParts(value: Date) {
  return {
    date: `${value.getFullYear()}-${padDatePart(value.getMonth() + 1)}-${padDatePart(value.getDate())}`,
    time: `${padDatePart(value.getHours())}:${padDatePart(value.getMinutes())}`,
  }
}

function minimumScheduleDate() {
  return new Date(Math.ceil((Date.now() + minimumScheduleLeadMs) / 60_000) * 60_000)
}

function defaultScheduleDate() {
  return new Date(Math.ceil(
    (Date.now() + minimumScheduleLeadMs + defaultScheduleBufferMs) / 60_000,
  ) * 60_000)
}

function localPickerDate(date: string, time: string) {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(time)
  if (!dateMatch || !timeMatch) {
    return null
  }
  const parts = [
    Number(dateMatch[1]),
    Number(dateMatch[2]),
    Number(dateMatch[3]),
    Number(timeMatch[1]),
    Number(timeMatch[2]),
  ]
  const [year, month, day, hour, minute] = parts
  const value = new Date(year, month - 1, day, hour, minute, 0, 0)
  if (!Number.isFinite(value.getTime())
    || value.getFullYear() !== year
    || value.getMonth() !== month - 1
    || value.getDate() !== day
    || value.getHours() !== hour
    || value.getMinutes() !== minute) {
    return null
  }
  return value
}

function schedulePickerState(activeDispatch: AdminMessageCampaignDispatch | null) {
  const minimum = minimumScheduleDate()
  const fallback = defaultScheduleDate()
  const scheduled = activeDispatch ? new Date(activeDispatch.scheduledFor) : null
  const value = scheduled && scheduled.getTime() >= minimum.getTime() ? scheduled : fallback
  const selected = localPickerParts(value)
  const lowerBound = localPickerParts(minimum)
  return {
    scheduleDate: selected.date,
    scheduleTime: selected.time,
    scheduleMinDate: lowerBound.date,
    scheduleTimeStart: selected.date === lowerBound.date ? lowerBound.time : '00:00',
  }
}

function dispatchView(item: AdminMessageCampaignDispatch): DispatchView {
  const needsManualReview = item.lastOutcome === 'UNKNOWN'
    || item.retryDisposition === 'MANUAL_REVIEW'
  const canModify = !needsManualReview && (
    item.status === 'SCHEDULED'
    || (item.status === 'FAILED' && item.retryDisposition === 'RETRIABLE')
  )
  const noteText = needsManualReview
    ? '需要人工核对'
    : item.status === 'PROCESSING'
      ? '发送任务正在处理'
      : item.status === 'FAILED' && item.retryDisposition === 'RETRIABLE'
        ? '可修改发送计划'
        : item.status === 'FAILED'
          ? '本次计划不能继续发送'
          : '等待计划时间到达后发送'
  return {
    ...item,
    statusText: dispatchStatusLabels[item.status],
    scheduledText: formatLocalDateTime(item.scheduledFor),
    noteText,
    needsManualReview,
    canModify,
    canCancel: item.status !== 'PROCESSING' && !needsManualReview,
  }
}

function initialDraft(scopeType: 'PLATFORM' | 'BRANCH', branchId: string | null): AdminMessageCampaignDraft {
  return {
    scopeType,
    branchId,
    audienceType: 'ALL',
    recipientRefs: [],
    name: '',
    title: '',
    body: '',
  }
}

function initialTemplateDraft(
  scopeType: 'PLATFORM' | 'BRANCH',
  branchId: string | null,
): AdminMessageTemplateDraft {
  return {
    scopeType,
    branchId,
    name: '',
    title: '',
    body: '',
  }
}

function campaignView(item: AdminMessageCampaign): CampaignView {
  const activeDispatch = item.activeDispatch ? dispatchView(item.activeDispatch) : null
  return {
    ...item,
    statusText: statusLabels[item.status],
    scopeText: item.scopeType === 'PLATFORM' ? '全平台' : item.branchName,
    updatedText: item.updatedAt ? formatLocalDateTime(item.updatedAt) : '—',
    dispatchText: activeDispatch
      ? `${activeDispatch.needsManualReview ? '需要人工核对' : activeDispatch.statusText} · ${activeDispatch.scheduledText}`
      : '',
  }
}

function templateView(item: AdminMessageTemplate): TemplateView {
  return {
    ...item,
    statusText: templateStatusLabels[item.status],
    safetyText: templateSafetyLabels[item.contentSafetyStatus],
    scopeText: item.scopeType === 'PLATFORM' ? '全平台' : item.branchName,
    updatedText: item.updatedAt ? formatLocalDateTime(item.updatedAt) : '—',
  }
}

function compatibleCampaignTemplates(
  items: TemplateView[],
  scopeType: 'PLATFORM' | 'BRANCH',
  branchId: string | null,
) {
  return items.filter((item) => {
    if (item.status !== 'ACTIVE') {
      return false
    }
    if (scopeType === 'PLATFORM') {
      return item.scopeType === 'PLATFORM'
    }
    return item.scopeType === 'PLATFORM'
      || (item.scopeType === 'BRANCH' && item.branchId === branchId)
  })
}

Page({
  data: {
    section: 'campaigns' as 'campaigns' | 'templates',
    state: 'loading' as PageState,
    mode: 'list' as 'list' | 'editor',
    statusFilter: '' as AdminMessageCampaignStatus | '',
    items: [] as CampaignView[],
    platformAllowed: false,
    branches: [] as Array<{ id: string, name: string }>,
    branchIndex: -1,
    campaignId: '',
    version: 0,
    campaignStatus: 'DRAFT' as AdminMessageCampaignStatus,
    statusText: statusLabels.DRAFT,
    safetyStatus: 'PENDING' as AdminMessageCampaignSafetyStatus,
    safetyText: safetyLabels.PENDING,
    recipientCount: 0,
    deliveryStats: { submittedCount: 0, inboxReadyCount: 0, failedCount: 0 },
    activeDispatch: null as DispatchView | null,
    canScheduleCampaign: true,
    scheduleActionText: '定时发送',
    ...schedulePickerState(null),
    draft: initialDraft('PLATFORM', null),
    editable: true,
    candidates: [] as CandidateView[],
    candidateQuery: '',
    candidateLoading: false,
    selectedRecipientCount: 0,
    processing: '' as '' | 'save' | 'snapshot' | 'publish' | 'schedule' | 'cancelSchedule' | 'withdraw',
    publishRequestKey: '',
    scheduleRequestKey: '',
    cancelScheduleRequestKey: '',
    cancelScheduleRequestReason: '',
    message: '',
    campaignTemplatePool: [] as TemplateView[],
    campaignTemplateOptions: [] as TemplateView[],
    campaignTemplateLoading: false,
    campaignTemplateError: '',
    selectedTemplateId: '',
    templateCopyNotice: '',
    templateState: 'loading' as PageState,
    templateMode: 'list' as 'list' | 'editor',
    templateStatusFilter: '' as AdminMessageTemplateStatus | '',
    templateItems: [] as TemplateView[],
    templateId: '',
    templateVersion: 0,
    templateStatus: 'DRAFT' as AdminMessageTemplateStatus,
    templateStatusText: templateStatusLabels.DRAFT,
    templateSafetyStatus: 'PENDING' as AdminMessageTemplateSafetyStatus,
    templateSafetyText: templateSafetyLabels.PENDING,
    templateRevisionNumber: 0,
    templateUpdatedText: '—',
    templateDraft: initialTemplateDraft('PLATFORM', null),
    templateBranchIndex: -1,
    templateEditable: true,
    templateProcessing: '' as '' | 'save' | 'activate' | 'archive',
    templateMessage: '',
  },

  onShow() {
    if (this.data.section === 'templates' && this.data.templateMode === 'list') {
      void this.loadTemplateList()
    }
    else if (this.data.section === 'campaigns' && this.data.mode === 'list') {
      void this.loadList()
    }
  },

  async onPullDownRefresh() {
    try {
      if (this.data.section === 'templates' && this.data.templateMode === 'list') {
        await this.loadTemplateList(true)
      }
      else if (this.data.section === 'templates' && this.data.templateId) {
        await this.openTemplateById(this.data.templateId, true)
      }
      else if (this.data.section === 'templates') {
        const scopes = await this.loadBase(true)
        if (scopes) {
          this.setData({ templateState: 'ready', templateMessage: '' })
        }
      }
      else if (this.data.mode === 'list') {
        await this.loadList(true)
      }
      else if (this.data.campaignId) {
        await this.openCampaignById(this.data.campaignId, true)
      }
    }
    finally {
      wx.stopPullDownRefresh()
    }
  },

  retryLoad() {
    if (this.data.section === 'templates' && this.data.templateMode === 'list') {
      void this.loadTemplateList(true)
    }
    else if (this.data.section === 'templates' && this.data.templateId) {
      void this.openTemplateById(this.data.templateId, true)
    }
    else if (this.data.section === 'templates') {
      void this.createTemplate()
    }
    else if (this.data.mode === 'list') {
      void this.loadList(true)
    }
    else if (this.data.campaignId) {
      void this.openCampaignById(this.data.campaignId, true)
    }
    else {
      void this.createCampaign()
    }
  },

  async loadBase(force = false) {
    const [session, scopes] = await Promise.all([
      mipAdminModule.getSession(force),
      mipAdminModule.messaging.getCampaignScopes(force),
    ])
    if (!hasCapability(session.capabilities, 'messages.manage')
      || (!scopes.platform && !scopes.branches.length)) {
      this.setData({
        state: 'forbidden',
        message: '',
        templateState: 'forbidden',
        templateMessage: '',
      })
      return null
    }
    this.setData({ platformAllowed: scopes.platform, branches: scopes.branches })
    return scopes
  },

  chooseSection(event: WechatMiniprogram.TouchEvent) {
    const section = String(event.currentTarget.dataset.section || '') as 'campaigns' | 'templates'
    if (!['campaigns', 'templates'].includes(section) || section === this.data.section) {
      return
    }
    this.setData({ section })
    if (section === 'templates'
      && this.data.templateMode === 'list'
      && !this.data.templateItems.length) {
      void this.loadTemplateList()
    }
    else if (section === 'campaigns' && this.data.mode === 'list' && !this.data.items.length) {
      void this.loadList()
    }
  },

  async loadList(force = false) {
    const hasContent = this.data.items.length > 0
    if (!hasContent) {
      this.setData({ state: 'loading', message: '' })
    }
    try {
      const scopes = await this.loadBase(force)
      if (!scopes) {
        return
      }
      const page = await mipAdminModule.messaging.listCampaigns({ status: this.data.statusFilter }, force)
      this.setData({
        state: page.items.length ? 'ready' : 'empty',
        items: page.items.map(campaignView),
        message: '',
      })
    }
    catch (error) {
      this.setData(adminLoadFailure(error, { hasContent, fallbackMessage: '消息活动列表加载失败' }))
    }
  },

  async loadTemplateList(force = false) {
    const hasContent = this.data.templateItems.length > 0
    if (!hasContent) {
      this.setData({ templateState: 'loading', templateMessage: '' })
    }
    try {
      const scopes = await this.loadBase(force)
      if (!scopes) {
        return
      }
      const page = await mipAdminModule.messaging.listTemplates({
        status: this.data.templateStatusFilter,
      }, force)
      this.setData({
        templateState: page.items.length ? 'ready' : 'empty',
        templateItems: page.items.map(templateView),
        templateMessage: '',
      })
    }
    catch (error) {
      const failure = adminLoadFailure(error, {
        hasContent,
        fallbackMessage: '消息模板列表加载失败',
      })
      this.setData({
        ...(failure.state ? { templateState: failure.state } : {}),
        templateMessage: failure.message,
      })
    }
  },

  chooseStatus(event: WechatMiniprogram.TouchEvent) {
    const status = String(event.currentTarget.dataset.status || '') as AdminMessageCampaignStatus | ''
    if (status === this.data.statusFilter || !['', 'DRAFT', 'READY', 'PUBLISHED', 'WITHDRAWN'].includes(status)) {
      return
    }
    this.setData({ statusFilter: status, state: 'loading', items: [], message: '' })
    void this.loadList(true)
  },

  chooseTemplateStatus(event: WechatMiniprogram.TouchEvent) {
    const status = String(event.currentTarget.dataset.status || '') as AdminMessageTemplateStatus | ''
    if (status === this.data.templateStatusFilter
      || !['', 'DRAFT', 'ACTIVE', 'ARCHIVED'].includes(status)) {
      return
    }
    this.setData({
      templateStatusFilter: status,
      templateState: 'loading',
      templateItems: [],
      templateMessage: '',
    })
    void this.loadTemplateList(true)
  },

  async createCampaign() {
    try {
      const scopes = await this.loadBase()
      if (!scopes) {
        return
      }
      const branch = scopes.platform ? null : scopes.branches[0] || null
      this.setData({
        state: 'ready',
        mode: 'editor',
        campaignId: '',
        version: 0,
        campaignStatus: 'DRAFT',
        statusText: statusLabels.DRAFT,
        safetyStatus: 'PENDING',
        safetyText: safetyLabels.PENDING,
        recipientCount: 0,
        deliveryStats: { submittedCount: 0, inboxReadyCount: 0, failedCount: 0 },
        activeDispatch: null,
        canScheduleCampaign: true,
        scheduleActionText: '定时发送',
        ...schedulePickerState(null),
        draft: initialDraft(branch ? 'BRANCH' : 'PLATFORM', branch?.id || null),
        branchIndex: branch ? 0 : -1,
        editable: true,
        candidates: [],
        candidateQuery: '',
        selectedRecipientCount: 0,
        processing: '',
        publishRequestKey: '',
        scheduleRequestKey: '',
        cancelScheduleRequestKey: '',
        cancelScheduleRequestReason: '',
        message: '',
        campaignTemplatePool: [],
        campaignTemplateOptions: [],
        campaignTemplateError: '',
        selectedTemplateId: '',
        templateCopyNotice: '',
      })
      await this.loadCampaignTemplates()
    }
    catch (error) {
      this.setData(adminLoadFailure(error, { hasContent: false, fallbackMessage: '消息活动信息加载失败' }))
    }
  },

  openCampaign(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id || '')
    if (id) {
      void this.openCampaignById(id)
    }
  },

  async openCampaignById(campaignId: string, force = false) {
    this.setData({
      mode: 'editor',
      state: 'loading',
      message: '',
      campaignTemplatePool: [],
      campaignTemplateOptions: [],
      campaignTemplateError: '',
      selectedTemplateId: '',
      templateCopyNotice: '',
    })
    try {
      const [, item] = await Promise.all([
        this.loadBase(force),
        mipAdminModule.messaging.getCampaign(campaignId, force),
      ])
      this.applyCampaign(item)
      if (item.status === 'DRAFT') {
        await this.loadCampaignTemplates(force)
      }
      if (item.audienceType === 'EXPLICIT') {
        await this.loadCandidates()
      }
    }
    catch (error) {
      this.setData(adminLoadFailure(error, { hasContent: false, fallbackMessage: '消息活动信息加载失败' }))
    }
  },

  applyCampaign(item: AdminMessageCampaign, preserveTemplateSelection = false) {
    const activeDispatch = item.activeDispatch ? dispatchView(item.activeDispatch) : null
    this.setData({
      state: 'ready',
      mode: 'editor',
      campaignId: item.id,
      version: item.version,
      campaignStatus: item.status,
      statusText: statusLabels[item.status],
      safetyStatus: item.contentSafetyStatus,
      safetyText: safetyLabels[item.contentSafetyStatus],
      recipientCount: item.recipientCount,
      deliveryStats: item.deliveryStats,
      activeDispatch,
      canScheduleCampaign: !activeDispatch || activeDispatch.canModify,
      scheduleActionText: activeDispatch ? '修改计划' : '定时发送',
      ...schedulePickerState(item.activeDispatch),
      draft: {
        campaignId: item.id,
        expectedVersion: item.version,
        scopeType: item.scopeType,
        branchId: item.branchId,
        audienceType: item.audienceType,
        recipientRefs: item.recipientRefs,
        name: item.name,
        title: item.title,
        body: item.body || '',
      },
      branchIndex: this.data.branches.findIndex(branch => branch.id === item.branchId),
      editable: item.status === 'DRAFT',
      selectedRecipientCount: item.recipientRefs.length,
      candidates: [],
      processing: '',
      publishRequestKey: '',
      scheduleRequestKey: '',
      cancelScheduleRequestKey: '',
      cancelScheduleRequestReason: '',
      message: '',
      ...(preserveTemplateSelection
        ? {}
        : { selectedTemplateId: '', templateCopyNotice: '' }),
    })
  },

  backToList() {
    this.setData({ mode: 'list', state: 'loading', candidates: [], message: '' })
    void this.loadList(true)
  },

  async loadCampaignTemplates(force = false) {
    if (!this.data.editable) {
      return
    }
    const hasContent = this.data.campaignTemplatePool.length > 0
    this.setData({ campaignTemplateLoading: true, campaignTemplateError: '' })
    try {
      const page = await mipAdminModule.messaging.listTemplates({ status: 'ACTIVE' }, force)
      const pool = page.items.map(templateView)
      this.setData({ campaignTemplatePool: pool })
      this.syncCampaignTemplateOptions(this.data.draft.scopeType, this.data.draft.branchId)
    }
    catch (error) {
      this.setData({
        campaignTemplateError: hasContent
          ? '消息模板刷新失败，已保留上次结果。'
          : error instanceof Error ? error.message : '消息模板加载失败',
      })
    }
    finally {
      this.setData({ campaignTemplateLoading: false })
    }
  },

  retryCampaignTemplates() {
    void this.loadCampaignTemplates(true)
  },

  syncCampaignTemplateOptions(
    scopeType: 'PLATFORM' | 'BRANCH',
    branchId: string | null,
  ) {
    const options = compatibleCampaignTemplates(
      this.data.campaignTemplatePool,
      scopeType,
      branchId,
    )
    const selectedStillCompatible = !this.data.selectedTemplateId
      || options.some(item => item.id === this.data.selectedTemplateId)
    this.setData({
      campaignTemplateOptions: options,
      ...(selectedStillCompatible
        ? {}
        : {
            selectedTemplateId: '',
            templateCopyNotice: '管理范围已变化，模板选择已清除；已复制的消息标题和正文保持不变。',
          }),
    })
  },

  applyCampaignTemplate(event: WechatMiniprogram.TouchEvent) {
    if (!this.data.editable) {
      return
    }
    const templateId = String(event.currentTarget.dataset.id || '')
    const selected = this.data.campaignTemplateOptions.find(item => item.id === templateId)
    if (!selected) {
      return
    }
    this.setData({
      'draft.title': selected.title,
      'draft.body': selected.body,
      'selectedTemplateId': selected.id,
      'templateCopyNotice': '已复制模板当前标题和正文。模板后续修改不会影响当前消息活动。',
    })
  },

  updateField(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    const field = String(event.currentTarget.dataset.field || '')
    if (!this.data.editable || !['name', 'title', 'body'].includes(field)) {
      return
    }
    this.setData({ [`draft.${field}`]: event.detail.value })
  },

  chooseScope(event: WechatMiniprogram.TouchEvent) {
    if (!this.data.editable) {
      return
    }
    const scope = String(event.currentTarget.dataset.scope || '')
    if (scope === 'PLATFORM' && this.data.platformAllowed) {
      this.setData({
        'draft.scopeType': 'PLATFORM',
        'draft.branchId': null,
        'draft.recipientRefs': [],
        'branchIndex': -1,
        'candidates': [],
        'selectedRecipientCount': 0,
      })
      this.syncCampaignTemplateOptions('PLATFORM', null)
    }
    else if (scope === 'BRANCH' && this.data.branches.length) {
      const index = this.data.branchIndex >= 0 ? this.data.branchIndex : 0
      const branchId = this.data.branches[index].id
      this.setData({
        'draft.scopeType': 'BRANCH',
        'draft.branchId': branchId,
        'draft.recipientRefs': [],
        'branchIndex': index,
        'candidates': [],
        'selectedRecipientCount': 0,
      })
      this.syncCampaignTemplateOptions('BRANCH', branchId)
    }
  },

  changeBranch(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    if (!this.data.editable) {
      return
    }
    const index = Number(event.detail.value)
    const branch = this.data.branches[index]
    if (!branch) {
      return
    }
    this.setData({
      'draft.branchId': branch.id,
      'draft.recipientRefs': [],
      'branchIndex': index,
      'candidates': [],
      'selectedRecipientCount': 0,
    })
    this.syncCampaignTemplateOptions('BRANCH', branch.id)
    if (this.data.draft.audienceType === 'EXPLICIT') {
      void this.loadCandidates()
    }
  },

  chooseAudience(event: WechatMiniprogram.TouchEvent) {
    if (!this.data.editable) {
      return
    }
    const audienceType = String(event.currentTarget.dataset.audience || '') as 'ALL' | 'EXPLICIT'
    if (!['ALL', 'EXPLICIT'].includes(audienceType)) {
      return
    }
    this.setData({
      'draft.audienceType': audienceType,
      'draft.recipientRefs': [],
      'candidates': [],
      'selectedRecipientCount': 0,
    })
    if (audienceType === 'EXPLICIT') {
      void this.loadCandidates()
    }
  },

  updateCandidateQuery(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    this.setData({ candidateQuery: event.detail.value })
  },

  searchCandidates() {
    void this.loadCandidates()
  },

  async loadCandidates() {
    if (this.data.draft.audienceType !== 'EXPLICIT') {
      return
    }
    this.setData({ candidateLoading: true, message: '' })
    try {
      const page = await mipAdminModule.messaging.searchRecipients({
        branchId: this.data.draft.scopeType === 'BRANCH' ? this.data.draft.branchId : null,
        query: this.data.candidateQuery,
      })
      const selected = new Set(this.data.draft.recipientRefs)
      this.setData({
        candidates: page.items.map(item => ({ ...item, selected: selected.has(item.profileRef) })),
      })
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '收件人加载失败' })
    }
    finally {
      this.setData({ candidateLoading: false })
    }
  },

  toggleCandidate(event: WechatMiniprogram.TouchEvent) {
    if (!this.data.editable) {
      return
    }
    const profileRef = String(event.currentTarget.dataset.ref || '')
    const refs = new Set(this.data.draft.recipientRefs)
    if (refs.has(profileRef)) {
      refs.delete(profileRef)
    }
    else if (refs.size < 100) {
      refs.add(profileRef)
    }
    const recipientRefs = [...refs]
    this.setData({
      'draft.recipientRefs': recipientRefs,
      'selectedRecipientCount': recipientRefs.length,
      'candidates': this.data.candidates.map(item => ({ ...item, selected: refs.has(item.profileRef) })),
    })
  },

  async saveDraft() {
    if (!this.data.editable || this.data.processing) {
      return
    }
    this.setData({ processing: 'save', message: '' })
    try {
      const draft = this.data.draft
      const item = await mipAdminModule.messaging.saveCampaign({
        scopeType: draft.scopeType,
        branchId: draft.branchId,
        audienceType: draft.audienceType,
        recipientRefs: [...draft.recipientRefs],
        name: draft.name,
        title: draft.title,
        body: draft.body,
        ...(this.data.campaignId
          ? { campaignId: this.data.campaignId, expectedVersion: this.data.version }
          : {}),
      })
      this.applyCampaign(item, true)
      wx.showToast({ title: '草稿已保存', icon: 'success' })
    }
    catch (error) {
      this.handleMutationFailure(error, '草稿保存失败')
    }
    finally {
      this.setData({ processing: '' })
    }
  },

  async createSnapshot() {
    if (!this.data.campaignId || !this.data.editable || this.data.processing) {
      return
    }
    const confirmed = await wx.showModal({
      title: '生成收件人快照',
      content: '生成后，消息内容和收件范围不能修改。',
      confirmText: '生成快照',
    }).catch(() => null)
    if (!confirmed?.confirm) {
      return
    }
    this.setData({ processing: 'snapshot', message: '' })
    try {
      const item = await mipAdminModule.messaging.snapshotCampaign(
        this.data.campaignId,
        this.data.version,
      )
      this.applyCampaign(item)
      wx.showToast({ title: '快照已生成', icon: 'success' })
    }
    catch (error) {
      this.handleMutationFailure(error, '收件人快照生成失败')
    }
    finally {
      this.setData({ processing: '' })
    }
  },

  changeScheduleDate(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    if (!this.data.canScheduleCampaign || this.data.processing) {
      return
    }
    const requestedDate = String(event.detail.value || '')
    const minimum = localPickerParts(minimumScheduleDate())
    const scheduleDate = requestedDate >= minimum.date ? requestedDate : minimum.date
    const scheduleTimeStart = scheduleDate === minimum.date ? minimum.time : '00:00'
    const scheduleTime = scheduleDate === minimum.date && this.data.scheduleTime < scheduleTimeStart
      ? scheduleTimeStart
      : this.data.scheduleTime
    this.setData({
      scheduleDate,
      scheduleTime,
      scheduleMinDate: minimum.date,
      scheduleTimeStart,
      scheduleRequestKey: '',
      message: '',
    })
  },

  changeScheduleTime(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    if (!this.data.canScheduleCampaign || this.data.processing) {
      return
    }
    const minimum = localPickerParts(minimumScheduleDate())
    const scheduleTimeStart = this.data.scheduleDate === minimum.date ? minimum.time : '00:00'
    const requestedTime = String(event.detail.value || '')
    this.setData({
      scheduleTime: this.data.scheduleDate === minimum.date && requestedTime < scheduleTimeStart
        ? scheduleTimeStart
        : requestedTime,
      scheduleMinDate: minimum.date,
      scheduleTimeStart,
      scheduleRequestKey: '',
      message: '',
    })
  },

  async reloadCampaignAndList(campaignId: string) {
    const [item, page] = await Promise.all([
      mipAdminModule.messaging.getCampaign(campaignId, true),
      mipAdminModule.messaging.listCampaigns({ status: this.data.statusFilter }, true),
    ])
    this.setData({
      items: page.items.map(campaignView),
    })
    this.applyCampaign(item)
  },

  async scheduleCampaign() {
    if (!this.data.campaignId
      || this.data.campaignStatus !== 'READY'
      || !this.data.canScheduleCampaign
      || this.data.processing) {
      return
    }
    const scheduled = localPickerDate(this.data.scheduleDate, this.data.scheduleTime)
    const minimum = minimumScheduleDate()
    if (!scheduled || scheduled.getTime() < minimum.getTime()) {
      const picker = schedulePickerState(null)
      this.setData({
        ...picker,
        scheduleRequestKey: '',
        message: '发送时间需至少晚于当前时间 5 分钟。',
      })
      return
    }
    const activeDispatch = this.data.activeDispatch
    const modifying = Boolean(activeDispatch)
    const confirmed = await wx.showModal({
      title: modifying ? '修改发送计划' : '设置发送计划',
      content: `将于 ${formatLocalDateTime(scheduled.toISOString())} 向快照中的 ${this.data.recipientCount} 名用户发送消息。`,
      confirmText: modifying ? '修改计划' : '定时发送',
    }).catch(() => null)
    if (!confirmed?.confirm) {
      return
    }
    const requestKey = this.data.scheduleRequestKey
      || `message-campaign-schedule-${this.data.campaignId}-${Date.now()}`
    this.setData({ processing: 'schedule', scheduleRequestKey: requestKey, message: '' })
    try {
      await mipAdminModule.messaging.scheduleCampaign({
        campaignId: this.data.campaignId,
        expectedVersion: this.data.version,
        scheduledFor: scheduled.toISOString(),
        idempotencyKey: requestKey,
        ...(activeDispatch
          ? { expectedDispatchVersion: activeDispatch.version }
          : {}),
      })
      await this.reloadCampaignAndList(this.data.campaignId)
      wx.showToast({ title: modifying ? '发送计划已修改' : '发送计划已设置', icon: 'success' })
    }
    catch (error) {
      this.handleMutationFailure(error, '发送计划保存失败')
    }
    finally {
      this.setData({ processing: '' })
    }
  },

  async cancelCampaignSchedule() {
    const activeDispatch = this.data.activeDispatch
    if (!this.data.campaignId
      || this.data.campaignStatus !== 'READY'
      || !activeDispatch?.canCancel
      || this.data.processing) {
      return
    }
    const result = await wx.showModal({
      title: '取消发送计划',
      content: '填写取消原因。取消后不会发送此计划。',
      editable: true,
      placeholderText: '取消原因',
      confirmText: '取消计划',
      confirmColor: '#E65C5C',
    }).catch(() => null)
    const reason = result?.content?.trim() || ''
    if (!result?.confirm || !reason) {
      if (result?.confirm) {
        this.setData({ message: '请填写取消原因。' })
      }
      return
    }
    const requestKey = this.data.cancelScheduleRequestKey
      && this.data.cancelScheduleRequestReason === reason
      ? this.data.cancelScheduleRequestKey
      : `message-campaign-cancel-schedule-${this.data.campaignId}-${Date.now()}`
    this.setData({
      processing: 'cancelSchedule',
      cancelScheduleRequestKey: requestKey,
      cancelScheduleRequestReason: reason,
      message: '',
    })
    try {
      await mipAdminModule.messaging.cancelCampaignSchedule({
        campaignId: this.data.campaignId,
        expectedVersion: this.data.version,
        expectedDispatchVersion: activeDispatch.version,
        reason,
        idempotencyKey: requestKey,
      })
      await this.reloadCampaignAndList(this.data.campaignId)
      wx.showToast({ title: '发送计划已取消', icon: 'success' })
    }
    catch (error) {
      this.handleMutationFailure(error, '发送计划取消失败')
    }
    finally {
      this.setData({ processing: '' })
    }
  },

  async publishCampaign() {
    if (!this.data.campaignId || this.data.campaignStatus !== 'READY' || this.data.processing) {
      return
    }
    if (this.data.activeDispatch) {
      if (this.data.activeDispatch.needsManualReview) {
        await wx.showModal({
          title: '需要人工核对',
          content: '发送结果待人工核对，核对完成前不能立即发布。',
          showCancel: false,
          confirmText: '知道了',
        }).catch(() => null)
        return
      }
      await wx.showModal({
        title: '先取消发送计划',
        content: '当前消息活动已有发送计划。请先取消计划，再立即发布。',
        showCancel: false,
        confirmText: '知道了',
      }).catch(() => null)
      return
    }
    const confirmed = await wx.showModal({
      title: '立即发布',
      content: `将向快照中的 ${this.data.recipientCount} 名用户提交站内消息。`,
      confirmText: '立即发布',
    }).catch(() => null)
    if (!confirmed?.confirm) {
      return
    }
    const requestKey = this.data.publishRequestKey || `message-campaign-${this.data.campaignId}-${Date.now()}`
    this.setData({ processing: 'publish', publishRequestKey: requestKey, message: '' })
    try {
      const result = await mipAdminModule.messaging.publishCampaign(
        this.data.campaignId,
        this.data.version,
        requestKey,
      )
      await this.reloadCampaignAndList(this.data.campaignId)
      wx.showToast({ title: `已提交 ${result.queuedCount} 条`, icon: 'success' })
    }
    catch (error) {
      this.handleMutationFailure(error, '消息发布失败')
    }
    finally {
      this.setData({ processing: '' })
    }
  },

  async withdrawCampaign() {
    if (!this.data.campaignId || this.data.campaignStatus !== 'PUBLISHED' || this.data.processing) {
      return
    }
    const result = await wx.showModal({
      title: '撤销消息活动',
      content: '填写撤销原因。已提交的消息不会删除。',
      editable: true,
      placeholderText: '撤销原因',
      confirmText: '撤销',
      confirmColor: '#E65C5C',
    }).catch(() => null)
    const reason = result?.content?.trim() || ''
    if (!result?.confirm || !reason) {
      return
    }
    this.setData({ processing: 'withdraw', message: '' })
    try {
      const item = await mipAdminModule.messaging.withdrawCampaign(
        this.data.campaignId,
        this.data.version,
        reason,
      )
      this.applyCampaign(item)
      wx.showToast({ title: '消息活动已撤销', icon: 'success' })
    }
    catch (error) {
      this.handleMutationFailure(error, '消息活动撤销失败')
    }
    finally {
      this.setData({ processing: '' })
    }
  },

  async createTemplate() {
    try {
      const scopes = await this.loadBase()
      if (!scopes) {
        return
      }
      const branch = scopes.platform ? null : scopes.branches[0] || null
      this.setData({
        templateState: 'ready',
        templateMode: 'editor',
        templateId: '',
        templateVersion: 0,
        templateStatus: 'DRAFT',
        templateStatusText: templateStatusLabels.DRAFT,
        templateSafetyStatus: 'PENDING',
        templateSafetyText: templateSafetyLabels.PENDING,
        templateRevisionNumber: 0,
        templateUpdatedText: '—',
        templateDraft: initialTemplateDraft(branch ? 'BRANCH' : 'PLATFORM', branch?.id || null),
        templateBranchIndex: branch ? 0 : -1,
        templateEditable: true,
        templateProcessing: '',
        templateMessage: '',
      })
    }
    catch (error) {
      const failure = adminLoadFailure(error, {
        hasContent: false,
        fallbackMessage: '消息模板信息加载失败',
      })
      this.setData({
        templateState: failure.state || 'error',
        templateMessage: failure.message,
      })
    }
  },

  openTemplate(event: WechatMiniprogram.TouchEvent) {
    const templateId = String(event.currentTarget.dataset.id || '')
    if (templateId) {
      void this.openTemplateById(templateId)
    }
  },

  async openTemplateById(templateId: string, force = false) {
    this.setData({ templateMode: 'editor', templateState: 'loading', templateMessage: '' })
    try {
      const [scopes, item] = await Promise.all([
        this.loadBase(force),
        mipAdminModule.messaging.getTemplate(templateId, force),
      ])
      if (!scopes) {
        return
      }
      this.applyTemplate(item)
    }
    catch (error) {
      const failure = adminLoadFailure(error, {
        hasContent: false,
        fallbackMessage: '消息模板信息加载失败',
      })
      this.setData({
        templateState: failure.state || 'error',
        templateMessage: failure.message,
      })
    }
  },

  applyTemplate(item: AdminMessageTemplate) {
    this.setData({
      templateState: 'ready',
      templateMode: 'editor',
      templateId: item.id,
      templateVersion: item.version,
      templateStatus: item.status,
      templateStatusText: templateStatusLabels[item.status],
      templateSafetyStatus: item.contentSafetyStatus,
      templateSafetyText: templateSafetyLabels[item.contentSafetyStatus],
      templateRevisionNumber: item.currentRevisionNumber,
      templateUpdatedText: item.updatedAt ? formatLocalDateTime(item.updatedAt) : '—',
      templateDraft: {
        scopeType: item.scopeType,
        branchId: item.branchId,
        name: item.name,
        title: item.title,
        body: item.body,
      },
      templateBranchIndex: this.data.branches.findIndex(branch => branch.id === item.branchId),
      templateEditable: item.status !== 'ARCHIVED',
      templateProcessing: '',
      templateMessage: '',
    })
  },

  backToTemplateList() {
    this.setData({
      templateMode: 'list',
      templateState: 'loading',
      templateMessage: '',
    })
    void this.loadTemplateList(true)
  },

  updateTemplateField(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    const field = String(event.currentTarget.dataset.field || '')
    if (!this.data.templateEditable || !['name', 'title', 'body'].includes(field)) {
      return
    }
    this.setData({ [`templateDraft.${field}`]: event.detail.value })
  },

  chooseTemplateScope(event: WechatMiniprogram.TouchEvent) {
    if (!this.data.templateEditable) {
      return
    }
    const scope = String(event.currentTarget.dataset.scope || '')
    if (scope === 'PLATFORM' && this.data.platformAllowed) {
      this.setData({
        'templateDraft.scopeType': 'PLATFORM',
        'templateDraft.branchId': null,
        'templateBranchIndex': -1,
      })
    }
    else if (scope === 'BRANCH' && this.data.branches.length) {
      const index = this.data.templateBranchIndex >= 0 ? this.data.templateBranchIndex : 0
      this.setData({
        'templateDraft.scopeType': 'BRANCH',
        'templateDraft.branchId': this.data.branches[index].id,
        'templateBranchIndex': index,
      })
    }
  },

  changeTemplateBranch(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    if (!this.data.templateEditable) {
      return
    }
    const index = Number(event.detail.value)
    const branch = this.data.branches[index]
    if (!branch) {
      return
    }
    this.setData({
      'templateDraft.branchId': branch.id,
      'templateBranchIndex': index,
    })
  },

  async saveTemplateDraft() {
    if (!this.data.templateEditable || this.data.templateProcessing) {
      return
    }
    if (this.data.templateStatus === 'ACTIVE') {
      const confirmed = await wx.showModal({
        title: '保存模板新版本',
        content: '保存后模板会变为草稿，需要重新通过内容检查后启用。',
        confirmText: '继续保存',
      }).catch(() => null)
      if (!confirmed?.confirm) {
        return
      }
    }
    const draft = this.data.templateDraft
    const input: AdminMessageTemplateDraft = this.data.templateId
      ? {
          templateId: this.data.templateId,
          expectedVersion: this.data.templateVersion,
          scopeType: draft.scopeType,
          branchId: draft.branchId,
          name: draft.name,
          title: draft.title,
          body: draft.body,
        }
      : {
          scopeType: draft.scopeType,
          branchId: draft.branchId,
          name: draft.name,
          title: draft.title,
          body: draft.body,
        }
    this.setData({ templateProcessing: 'save', templateMessage: '' })
    try {
      const item = await mipAdminModule.messaging.saveTemplate(input)
      this.applyTemplate(item)
      wx.showToast({ title: '模板已保存', icon: 'success' })
    }
    catch (error) {
      this.handleTemplateMutationFailure(error, '模板保存失败')
    }
    finally {
      this.setData({ templateProcessing: '' })
    }
  },

  async activateTemplate() {
    if (!this.data.templateId
      || this.data.templateStatus !== 'DRAFT'
      || this.data.templateSafetyStatus !== 'PASSED'
      || this.data.templateProcessing) {
      return
    }
    const confirmed = await wx.showModal({
      title: '启用消息模板',
      content: '启用后，创建消息活动时可以选择此模板。',
      confirmText: '启用',
    }).catch(() => null)
    if (!confirmed?.confirm) {
      return
    }
    this.setData({ templateProcessing: 'activate', templateMessage: '' })
    try {
      const item = await mipAdminModule.messaging.activateTemplate(
        this.data.templateId,
        this.data.templateVersion,
      )
      this.applyTemplate(item)
      wx.showToast({ title: '模板已启用', icon: 'success' })
    }
    catch (error) {
      this.handleTemplateMutationFailure(error, '模板启用失败')
    }
    finally {
      this.setData({ templateProcessing: '' })
    }
  },

  async archiveTemplate() {
    if (!this.data.templateId
      || !['DRAFT', 'ACTIVE'].includes(this.data.templateStatus)
      || this.data.templateProcessing) {
      return
    }
    const confirmed = await wx.showModal({
      title: '归档消息模板',
      content: '归档后不能继续编辑，也不会出现在可选模板中。',
      confirmText: '归档',
      confirmColor: '#E65C5C',
    }).catch(() => null)
    if (!confirmed?.confirm) {
      return
    }
    this.setData({ templateProcessing: 'archive', templateMessage: '' })
    try {
      const item = await mipAdminModule.messaging.archiveTemplate(
        this.data.templateId,
        this.data.templateVersion,
      )
      this.applyTemplate(item)
      wx.showToast({ title: '模板已归档', icon: 'success' })
    }
    catch (error) {
      this.handleTemplateMutationFailure(error, '模板归档失败')
    }
    finally {
      this.setData({ templateProcessing: '' })
    }
  },

  handleTemplateMutationFailure(error: unknown, fallback: string) {
    if (isAdminVersionConflict(error)) {
      this.setData({
        templateState: 'conflict',
        templateMessage: '消息模板状态已变化，请重新加载后再操作。',
      })
      return
    }
    if (isAdminForbiddenError(error)) {
      this.setData({
        templateState: 'forbidden',
        templateMessage: '当前账号不能维护消息模板。',
      })
      return
    }
    this.setData({ templateMessage: error instanceof Error ? error.message : fallback })
  },

  handleMutationFailure(error: unknown, fallback: string) {
    if (isAdminVersionConflict(error)) {
      this.setData({ state: 'conflict', message: '消息活动状态已变化，请重新加载后再操作。' })
      return
    }
    this.setData({ message: error instanceof Error ? error.message : fallback })
  },
})
