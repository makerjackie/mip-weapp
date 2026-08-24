import type { AiCapability, AiDraft, AiDraftId, AiDraftPurpose, MipVoiceRecorder } from '../../../modules/mip-ai'
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
    return Object.entries(value).map(([key, item]) => `${key}：${readableValue(item)}`).join('\n')
  }
  return ''
}

function draftView(draft: AiDraft): DraftView {
  const fields = Object.entries(draft.structuredDraft || {})
  const copyText = fields.map(([key, value]) => `${key}：${readableValue(value)}`).join('\n')
  const expiry = new Date(draft.expiresAt)
  return {
    ...draft,
    purposeLabel: purposeOptions.find(item => item.value === draft.purpose)?.label || '草稿',
    statusLabel: statusLabels[draft.status],
    expiresText: Number.isFinite(expiry.getTime()) ? `${expiry.getMonth() + 1}月${expiry.getDate()}日到期` : '',
    summary: fields.slice(0, 2).map(([, value]) => readableValue(value)).filter(Boolean).join(' · '),
    copyText,
    canUse: draft.status === 'DRAFT_READY',
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
    message: '',
  },
  voiceRecorder: null as MipVoiceRecorder | null,

  onLoad() {
    void this.loadDrafts()
  },

  onUnload() {
    if (this.data.recording) {
      this.voiceRecorder?.stop()
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
      this.setData({
        state: 'ready',
        capability,
        drafts: page.items.map(draftView),
        nextCursor: page.nextCursor || '',
        message: '',
      })
    }
    catch (error) {
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
      this.setData({
        drafts: [...this.data.drafts, ...page.items.map(draftView)],
        nextCursor: page.nextCursor || '',
      })
    }
    catch {
      this.setData({ message: '更多草稿加载失败。' })
    }
    finally {
      this.setData({ loadingMore: false })
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
      this.setData({ sourceText: '', drafts: [draftView(draft), ...this.data.drafts] })
      wx.showToast({ title: '草稿已生成', icon: 'success' })
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '草稿生成失败' })
    }
    finally {
      this.setData({ generating: false })
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
    this.setData({ recording: true, message: '' })
    recorder.start()
    void recorder.result.then(async (voice) => {
      this.setData({ recording: false, generating: true })
      if (voice.durationMs < 1000) {
        throw new Error('录音时间太短，请重新录制')
      }
      const draft = await mipAiModule.createVoiceDraftUpload({
        purpose,
        audioBase64: voice.audioBase64,
        contentType: voice.contentType,
      })
      this.setData({ drafts: [draftView(draft), ...this.data.drafts] })
      wx.showToast({ title: '语音草稿已生成', icon: 'success' })
    }).catch((error) => {
      this.setData({ recording: false, message: error instanceof Error ? error.message : '录音整理失败' })
    }).finally(() => {
      this.voiceRecorder = null
      this.setData({ generating: false })
    })
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
    if (!modal.confirm) {
      return
    }
    try {
      await mipAiModule.deleteDraft(id, draft.version)
      this.setData({ drafts: this.data.drafts.filter(item => item.id !== id) })
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '草稿删除失败' })
    }
  },
})
