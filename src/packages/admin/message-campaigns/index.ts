import type {
  AdminMessageCampaign,
  AdminMessageCampaignDraft,
  AdminMessageCampaignSafetyStatus,
  AdminMessageCampaignStatus,
  AdminMessageRecipientCandidate,
} from '../../../modules/mip-admin'
import type { AdminPageState } from '../shared/page-state'
import { hasCapability, mipAdminModule } from '../../../modules/mip-admin'
import { formatLocalDateTime } from '../../../utils/date'
import { adminLoadFailure, isAdminVersionConflict } from '../shared/page-state'

type PageState = AdminPageState | 'empty'
type CampaignView = AdminMessageCampaign & {
  statusText: string
  scopeText: string
  updatedText: string
}
type CandidateView = AdminMessageRecipientCandidate & { selected: boolean }

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

function campaignView(item: AdminMessageCampaign): CampaignView {
  return {
    ...item,
    statusText: statusLabels[item.status],
    scopeText: item.scopeType === 'PLATFORM' ? '全平台' : item.branchName,
    updatedText: item.updatedAt ? formatLocalDateTime(item.updatedAt) : '—',
  }
}

Page({
  data: {
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
    draft: initialDraft('PLATFORM', null),
    editable: true,
    candidates: [] as CandidateView[],
    candidateQuery: '',
    candidateLoading: false,
    selectedRecipientCount: 0,
    processing: '' as '' | 'save' | 'snapshot' | 'publish' | 'withdraw',
    publishRequestKey: '',
    message: '',
  },

  onShow() {
    if (this.data.mode === 'list') {
      void this.loadList()
    }
  },

  async onPullDownRefresh() {
    try {
      if (this.data.mode === 'list') {
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
    if (this.data.mode === 'list') {
      void this.loadList(true)
    }
    else if (this.data.campaignId) {
      void this.openCampaignById(this.data.campaignId, true)
    }
    else {
      void this.loadBase(true)
    }
  },

  async loadBase(force = false) {
    const [session, scopes] = await Promise.all([
      mipAdminModule.getSession(force),
      mipAdminModule.getMessageCampaignScopes(force),
    ])
    if (!hasCapability(session.capabilities, 'messages.manage')
      || (!scopes.platform && !scopes.branches.length)) {
      this.setData({ state: 'forbidden', message: '' })
      return null
    }
    this.setData({ platformAllowed: scopes.platform, branches: scopes.branches })
    return scopes
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
      const page = await mipAdminModule.listMessageCampaigns({ status: this.data.statusFilter }, force)
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

  chooseStatus(event: WechatMiniprogram.TouchEvent) {
    const status = String(event.currentTarget.dataset.status || '') as AdminMessageCampaignStatus | ''
    if (status === this.data.statusFilter || !['', 'DRAFT', 'READY', 'PUBLISHED', 'WITHDRAWN'].includes(status)) {
      return
    }
    this.setData({ statusFilter: status, state: 'loading', items: [], message: '' })
    void this.loadList(true)
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
        draft: initialDraft(branch ? 'BRANCH' : 'PLATFORM', branch?.id || null),
        branchIndex: branch ? 0 : -1,
        editable: true,
        candidates: [],
        candidateQuery: '',
        selectedRecipientCount: 0,
        processing: '',
        publishRequestKey: '',
        message: '',
      })
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
    this.setData({ mode: 'editor', state: 'loading', message: '' })
    try {
      const [, item] = await Promise.all([
        this.loadBase(force),
        mipAdminModule.getMessageCampaign(campaignId, force),
      ])
      this.applyCampaign(item)
      if (item.audienceType === 'EXPLICIT') {
        await this.loadCandidates()
      }
    }
    catch (error) {
      this.setData(adminLoadFailure(error, { hasContent: false, fallbackMessage: '消息活动信息加载失败' }))
    }
  },

  applyCampaign(item: AdminMessageCampaign) {
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
      message: '',
    })
  },

  backToList() {
    this.setData({ mode: 'list', state: 'loading', candidates: [], message: '' })
    void this.loadList(true)
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
    }
    else if (scope === 'BRANCH' && this.data.branches.length) {
      const index = this.data.branchIndex >= 0 ? this.data.branchIndex : 0
      this.setData({
        'draft.scopeType': 'BRANCH',
        'draft.branchId': this.data.branches[index].id,
        'draft.recipientRefs': [],
        'branchIndex': index,
        'candidates': [],
        'selectedRecipientCount': 0,
      })
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
      const page = await mipAdminModule.searchMessageRecipients({
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
      const item = await mipAdminModule.mutate(() => mipAdminModule.gateway.saveMessageCampaign({
        ...this.data.draft,
        ...(this.data.campaignId
          ? { campaignId: this.data.campaignId, expectedVersion: this.data.version }
          : {}),
      }))
      this.applyCampaign(item)
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
      const item = await mipAdminModule.mutate(() => mipAdminModule.gateway.snapshotMessageCampaign(
        this.data.campaignId,
        this.data.version,
      ))
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

  async publishCampaign() {
    if (!this.data.campaignId || this.data.campaignStatus !== 'READY' || this.data.processing) {
      return
    }
    const confirmed = await wx.showModal({
      title: '发布消息',
      content: `将向快照中的 ${this.data.recipientCount} 名用户提交站内消息。`,
      confirmText: '发布',
    }).catch(() => null)
    if (!confirmed?.confirm) {
      return
    }
    const requestKey = this.data.publishRequestKey || `message-campaign-${this.data.campaignId}-${Date.now()}`
    this.setData({ processing: 'publish', publishRequestKey: requestKey, message: '' })
    try {
      const result = await mipAdminModule.mutate(() => mipAdminModule.gateway.publishMessageCampaign(
        this.data.campaignId,
        this.data.version,
        requestKey,
      ))
      const item = await mipAdminModule.getMessageCampaign(this.data.campaignId, true)
      this.applyCampaign(item)
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
      const item = await mipAdminModule.mutate(() => mipAdminModule.gateway.withdrawMessageCampaign(
        this.data.campaignId,
        this.data.version,
        reason,
      ))
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

  handleMutationFailure(error: unknown, fallback: string) {
    if (isAdminVersionConflict(error)) {
      this.setData({ state: 'conflict', message: '消息活动状态已变化，请重新加载后再操作。' })
      return
    }
    this.setData({ message: error instanceof Error ? error.message : fallback })
  },
})
