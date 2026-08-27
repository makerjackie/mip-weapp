import type { AiCapability, AiDraft, AiDraftId, AiDraftPurpose, MipVoiceRecorder } from '../../../modules/mip-ai'
import { cooperationRoles } from '../../../config/mip-catalogs'
import { createMipVoiceRecorder } from '../../../modules/mip-ai'
import { mipAiModule } from '../../../modules/mip-ai/client'
import { caseNavigateTo } from '../../../modules/platform/case-navigation'

const purposeOptions: Array<{ label: string, value: AiDraftPurpose }> = [
  { label: '个人档案', value: 'PROFILE' },
  { label: '合作卡', value: 'COOPERATION_CARD' },
  { label: '超级案例', value: 'SUPER_CASE' },
]

const statusLabels = {
  UPLOADED: '等待处理',
  TRANSCRIBING: '正在转写',
  STRUCTURING: '正在整理',
  DRAFT_READY: '草稿可用',
  FAILED: '整理失败',
  CONFIRMED: '已用于正式内容',
  EXPIRED: '已过期',
  DELETED: '已删除',
} as const

interface DraftView extends AiDraft {
  purposeLabel: string
  statusLabel: string
  expiresText: string
  summary: string
  copyText: string
  canUse: boolean
  fieldRows: Array<{ key: string, label: string, value: string }>
}

const fieldLabels: Record<AiDraftPurpose, Record<string, string>> = {
  PROFILE: {
    nickname: '昵称',
    identityStatus: '身份状态',
    headline: '个人标题',
    introduction: '个人介绍',
    companies: '公司经历',
    organizations: '组织经历',
  },
  COOPERATION_CARD: {
    roleKey: '合作角色',
    positioning: '定位',
    targetSummary: '目标',
    roleFields: '合作信息',
    abilityScores: '能力评分',
  },
  SUPER_CASE: {
    projectName: '项目名称',
    summary: '案例摘要',
    responsibility: '负责内容',
    description: '案例说明',
    startedOn: '开始日期',
    endedOn: '结束日期',
    caseType: '案例类型',
  },
}

function readableValue(value: unknown): string {
  if (typeof value === 'string') {
    return value
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  if (Array.isArray(value)) {
    return value.map(readableValue).join('、')
  }
  if (value && typeof value === 'object') {
    return Object.values(value).map(readableValue).filter(Boolean).join('；')
  }
  return ''
}

function draftView(draft: AiDraft): DraftView {
  const fields = Object.entries(draft.structuredDraft || {})
  const fieldRows = fields.map(([key, value]) => ({
    key,
    label: fieldLabels[draft.purpose][key] || '补充信息',
    value: draft.purpose === 'COOPERATION_CARD' && key === 'roleKey' && typeof value === 'string'
      ? cooperationRoles.find(role => role.key === value)?.name || readableValue(value)
      : readableValue(value),
  })).filter(item => item.value)
  const copyText = fieldRows.map(item => `${item.label}：${item.value}`).join('\n')
  const expiry = new Date(draft.expiresAt)
  return {
    ...draft,
    purposeLabel: purposeOptions.find(item => item.value === draft.purpose)?.label || '草稿',
    statusLabel: statusLabels[draft.status],
    expiresText: Number.isFinite(expiry.getTime()) ? `${expiry.getMonth() + 1}月${expiry.getDate()}日到期` : '',
    summary: fields.slice(0, 2).map(([, value]) => readableValue(value)).filter(Boolean).join(' · '),
    copyText,
    canUse: draft.status === 'DRAFT_READY',
    fieldRows,
  }
}

function editorRoute(draft: DraftView) {
  const routes: Record<AiDraftPurpose, string> = {
    PROFILE: '/packages/member/mip-profile/index',
    COOPERATION_CARD: '/packages/member/mip-cooperation/editor/index',
    SUPER_CASE: '/packages/member/mip-cases/editor/index',
  }
  return `${routes[draft.purpose]}?aiDraftId=${encodeURIComponent(draft.id)}`
}

function recordingDurationText(elapsedSeconds: number) {
  const hours = Math.floor(elapsedSeconds / 3600)
  const minutes = Math.floor((elapsedSeconds % 3600) / 60)
  const seconds = elapsedSeconds % 60
  return [hours, minutes, seconds].map(value => String(value).padStart(2, '0')).join(':')
}

Page({
  data: {
    state: 'loading' as 'loading' | 'ready' | 'error',
    capability: null as AiCapability | null,
    purposeOptions,
    purposeIndex: 0,
    sourceText: '',
    drafts: [] as DraftView[],
    nextCursor: '',
    loadingMore: false,
    generating: false,
    recording: false,
    recordingElapsedText: '00:00:00',
    refining: false,
    activeDraft: null as DraftView | null,
    supplementalText: '',
    message: '',
  },
  voiceRecorder: null as MipVoiceRecorder | null,
  recordingStartedAt: 0,
  recordingTimer: null as ReturnType<typeof setInterval> | null,
  pageActive: true,

  onLoad() {
    this.pageActive = true
    void this.loadDrafts()
  },

  onUnload() {
    this.pageActive = false
    this.clearRecordingTimer()
    if (this.data.recording) {
      this.voiceRecorder?.stop()
    }
  },

  clearRecordingTimer() {
    if (this.recordingTimer) {
      clearInterval(this.recordingTimer)
      this.recordingTimer = null
    }
  },

  async loadDrafts() {
    if (!this.data.drafts.length) {
      this.setData({ state: 'loading', message: '' })
    }
    try {
      const [capability, page] = await Promise.all([
        mipAiModule.getCapability(),
        mipAiModule.listDrafts(),
      ])
      if (!this.pageActive) {
        return
      }
      this.setData({
        state: 'ready',
        capability,
        drafts: page.items.map(draftView),
        activeDraft: this.data.activeDraft
          ? page.items.map(draftView).find(item => item.id === this.data.activeDraft?.id && item.canUse) || null
          : null,
        nextCursor: page.nextCursor || '',
        message: '',
      })
    }
    catch (error) {
      if (!this.pageActive) {
        return
      }
      this.setData(this.data.drafts.length
        ? { message: '草稿更新失败，已保留上次结果。' }
        : { state: 'error', message: error instanceof Error ? error.message : '草稿加载失败' })
    }
  },

  async loadMore() {
    if (!this.data.nextCursor || this.data.loadingMore) {
      return
    }
    this.setData({ loadingMore: true, message: '' })
    try {
      const page = await mipAiModule.listDrafts(this.data.nextCursor)
      if (!this.pageActive) {
        return
      }
      this.setData({
        drafts: [...this.data.drafts, ...page.items.map(draftView)],
        nextCursor: page.nextCursor || '',
      })
    }
    catch {
      if (!this.pageActive) {
        return
      }
      this.setData({ message: '更多草稿加载失败。' })
    }
    finally {
      if (this.pageActive) {
        this.setData({ loadingMore: false })
      }
    }
  },

  changePurpose(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    this.setData({ purposeIndex: Number(event.detail.value) })
  },

  updateSource(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    this.setData({ sourceText: event.detail.value, message: '' })
  },

  async generateFromText() {
    if (this.data.generating || !this.data.capability?.textDrafts) {
      return
    }
    const purpose = purposeOptions[this.data.purposeIndex]?.value
    const transcriptText = this.data.sourceText.trim()
    if (!purpose || !transcriptText) {
      this.setData({ message: '请输入需要整理的内容。' })
      return
    }
    this.setData({ generating: true, message: '' })
    try {
      const draft = await mipAiModule.createTextDraft({ purpose, transcriptText })
      if (!this.pageActive) {
        return
      }
      const view = draftView(draft)
      this.setData({ sourceText: '', drafts: [view, ...this.data.drafts], activeDraft: view, supplementalText: '' })
      wx.showToast({ title: '草稿已生成', icon: 'success' })
    }
    catch (error) {
      if (!this.pageActive) {
        return
      }
      this.setData({ message: error instanceof Error ? error.message : '草稿生成失败' })
    }
    finally {
      if (this.pageActive) {
        this.setData({ generating: false })
      }
    }
  },

  startRecording() {
    if (this.data.recording || this.data.generating || !this.data.capability?.voiceDrafts) {
      return
    }
    const purpose = purposeOptions[this.data.purposeIndex]?.value
    if (!purpose) {
      return
    }
    const recorder = createMipVoiceRecorder()
    this.voiceRecorder = recorder
    this.recordingStartedAt = Date.now()
    this.clearRecordingTimer()
    this.setData({ recording: true, recordingElapsedText: '00:00:00', message: '' })
    this.recordingTimer = setInterval(() => {
      if (!this.pageActive) {
        return
      }
      const elapsedSeconds = Math.max(0, Math.floor((Date.now() - this.recordingStartedAt) / 1000))
      this.setData({ recordingElapsedText: recordingDurationText(elapsedSeconds) })
    }, 1000)
    void recorder.result.then(async (voice) => {
      this.clearRecordingTimer()
      if (!this.pageActive) {
        return
      }
      this.setData({ recording: false, generating: true })
      if (voice.durationMs < 1000) {
        throw new Error('录音时间太短，请重新录制')
      }
      const draft = await mipAiModule.createVoiceDraftUpload({
        purpose,
        audioBase64: voice.audioBase64,
        contentType: voice.contentType,
      })
      if (!this.pageActive) {
        return
      }
      const view = draftView(draft)
      this.setData({ drafts: [view, ...this.data.drafts], activeDraft: view, supplementalText: '' })
      wx.showToast({ title: '语音草稿已生成', icon: 'success' })
    }).catch((error) => {
      this.clearRecordingTimer()
      if (this.pageActive) {
        this.setData({ recording: false, message: error instanceof Error ? error.message : '录音整理失败' })
      }
    }).finally(() => {
      this.clearRecordingTimer()
      this.voiceRecorder = null
      if (this.pageActive) {
        this.setData({ generating: false })
      }
    })
    try {
      recorder.start()
    }
    catch {
      // The recorder result owns the user-visible error path and resets page state.
    }
  },

  stopRecording() {
    if (!this.data.recording) {
      return
    }
    this.voiceRecorder?.stop()
  },

  copyDraft(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id || '')
    const draft = this.data.drafts.find(item => item.id === id)
    if (!draft?.copyText) {
      return
    }
    wx.setClipboardData({ data: draft.copyText })
  },

  openRefinement(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id || '')
    const draft = this.data.drafts.find(item => item.id === id)
    if (!draft?.canUse) {
      return
    }
    this.setData({ activeDraft: draft, supplementalText: '', message: '' })
  },

  closeRefinement() {
    if (!this.data.refining) {
      this.setData({ activeDraft: null, supplementalText: '' })
    }
  },

  updateSupplement(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    this.setData({ supplementalText: event.detail.value, message: '' })
  },

  async continueDraft() {
    const draft = this.data.activeDraft
    const supplementalText = this.data.supplementalText.trim()
    if (!draft || this.data.refining || !this.data.capability?.refinementDrafts) {
      return
    }
    if (!supplementalText) {
      this.setData({ message: '请输入补充内容。' })
      return
    }
    this.setData({ refining: true, message: '' })
    try {
      const updated = draftView(await mipAiModule.continueDraft({
        draftId: draft.id,
        expectedVersion: draft.version,
        supplementalText,
      }))
      if (!this.pageActive) {
        return
      }
      this.setData({
        drafts: this.data.drafts.map(item => item.id === updated.id ? updated : item),
        activeDraft: updated,
        supplementalText: '',
      })
      wx.showToast({ title: '草稿已更新', icon: 'success' })
    }
    catch (error) {
      const message = error instanceof Error ? error.message : '草稿更新失败'
      if (this.pageActive) {
        await this.loadDrafts()
        if (this.pageActive) {
          this.setData({ message })
        }
      }
    }
    finally {
      if (this.pageActive) {
        this.setData({ refining: false })
      }
    }
  },

  useDraft(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id || '')
    const draft = this.data.drafts.find(item => item.id === id)
    if (!draft?.canUse) {
      return
    }
    caseNavigateTo({ url: editorRoute(draft) })
  },

  async deleteDraft(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id || '') as AiDraftId
    const draft = this.data.drafts.find(item => item.id === id)
    if (!draft) {
      return
    }
    const modal = await wx.showModal({ title: '删除草稿', content: '确认删除这份草稿？', confirmText: '删除', confirmColor: '#E65C5C' })
    if (!modal.confirm || !this.pageActive) {
      return
    }
    try {
      await mipAiModule.deleteDraft(id, draft.version)
      if (!this.pageActive) {
        return
      }
      this.setData({
        drafts: this.data.drafts.filter(item => item.id !== id),
        activeDraft: this.data.activeDraft?.id === id ? null : this.data.activeDraft,
        supplementalText: this.data.activeDraft?.id === id ? '' : this.data.supplementalText,
      })
    }
    catch (error) {
      if (this.pageActive) {
        this.setData({ message: error instanceof Error ? error.message : '草稿删除失败' })
      }
    }
  },
})
