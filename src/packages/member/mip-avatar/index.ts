import type {
  AiCapability,
  DigitalAvatarGeneration,
  DigitalAvatarStyleKey,
} from '../../../modules/mip-ai'
import { digitalAvatarStyles } from '../../../modules/mip-ai'
import { mipAiModule } from '../../../modules/mip-ai/client'
import { mipIdentityModule } from '../../../modules/mip-identity/client'

interface DigitalAvatarView extends DigitalAvatarGeneration {
  styleLabel: string
  statusLabel: string
  createdText: string
  canPreview: boolean
}

function generationRequestId() {
  return `digital-avatar:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 12)}`
}

function generationView(generation: DigitalAvatarGeneration): DigitalAvatarView {
  const date = new Date(generation.createdAt)
  const statusLabels = {
    PROCESSING: '正在生成',
    READY: '已生成',
    FAILED: '生成失败',
  } as const
  return {
    ...generation,
    styleLabel: digitalAvatarStyles.find(item => item.key === generation.styleKey)?.label || '数字分身',
    statusLabel: statusLabels[generation.status],
    createdText: Number.isFinite(date.getTime())
      ? `${date.getMonth() + 1}月${date.getDate()}日 ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
      : '',
    canPreview: generation.status === 'READY' && Boolean(generation.outputUrl),
  }
}

Page({
  data: {
    state: 'loading' as 'loading' | 'ready' | 'unconfigured' | 'error',
    capability: null as AiCapability | null,
    avatarAssetId: '',
    avatarUrl: '',
    styles: digitalAvatarStyles,
    selectedStyleKey: 'PROFESSIONAL' as DigitalAvatarStyleKey,
    generations: [] as DigitalAvatarView[],
    current: null as DigitalAvatarView | null,
    generating: false,
    generationRequestId: '',
    saving: false,
    message: '',
  },

  onLoad() {
    void this.loadPage()
  },

  async onPullDownRefresh() {
    await this.loadPage()
    wx.stopPullDownRefresh()
  },

  async loadPage() {
    if (!this.data.generations.length) {
      this.setData({ state: 'loading', message: '' })
    }
    try {
      const [capability, snapshot, history] = await Promise.all([
        mipAiModule.getCapability(),
        mipIdentityModule.loadSnapshot(),
        mipAiModule.listDigitalAvatars(),
      ])
      const generations = history.items.map(generationView)
      this.setData({
        state: capability.digitalAvatars ? 'ready' : 'unconfigured',
        capability,
        avatarAssetId: snapshot.profile.avatarAssetId || '',
        avatarUrl: snapshot.profile.avatarUrl || '',
        generations,
        current: generations.find(item => item.canPreview) || null,
        message: '',
      })
    }
    catch (error) {
      this.setData(this.data.generations.length
        ? { message: '数字分身记录更新失败，已保留上次结果。' }
        : {
            state: 'error',
            message: error instanceof Error ? error.message : '数字分身加载失败',
          })
    }
  },

  selectStyle(event: WechatMiniprogram.TouchEvent) {
    const styleKey = String(event.currentTarget.dataset.styleKey || '') as DigitalAvatarStyleKey
    if (digitalAvatarStyles.some(item => item.key === styleKey) && !this.data.generating) {
      this.setData({
        selectedStyleKey: styleKey,
        generationRequestId: generationRequestId(),
        message: '',
      }, () => {
        void this.generate()
      })
    }
  },

  async generate() {
    if (this.data.generating || !this.data.capability?.digitalAvatars) {
      return
    }
    if (!this.data.avatarAssetId) {
      this.setData({ message: '请先在个人资料中设置头像。' })
      return
    }
    const requestId = this.data.generationRequestId || generationRequestId()
    this.setData({ generating: true, generationRequestId: requestId, message: '' })
    try {
      const current = generationView(await mipAiModule.generateDigitalAvatar({
        sourceAvatarAssetId: this.data.avatarAssetId,
        styleKey: this.data.selectedStyleKey,
        requestId,
      }))
      this.setData({
        current,
        generationRequestId: '',
        generations: [current, ...this.data.generations.filter(item => item.id !== current.id)],
      })
      wx.showToast({ title: '数字分身已生成', icon: 'success' })
    }
    catch (error) {
      const message = error instanceof Error ? error.message : '数字分身生成失败'
      const code = typeof error === 'object' && error && 'code' in error
        ? String(error.code || '')
        : ''
      this.setData({
        message,
        ...(!['SERVICE_UNAVAILABLE', 'DIGITAL_AVATAR_GENERATION_IN_PROGRESS'].includes(code)
          ? { generationRequestId: '' }
          : {}),
      })
      await this.refreshHistoryAfterFailure()
    }
    finally {
      this.setData({ generating: false })
    }
  },

  async refreshHistoryAfterFailure() {
    try {
      const history = await mipAiModule.listDigitalAvatars()
      this.setData({ generations: history.items.map(generationView) })
    }
    catch {}
  },

  selectGeneration(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id || '')
    const current = this.data.generations.find(item => item.id === id && item.canPreview)
    if (current) {
      this.setData({ current })
    }
  },

  preview() {
    const outputUrl = this.data.current?.outputUrl
    if (outputUrl) {
      wx.previewImage({ current: outputUrl, urls: [outputUrl] })
    }
  },

  async save() {
    const outputUrl = this.data.current?.outputUrl
    if (!outputUrl || this.data.saving) {
      return
    }
    this.setData({ saving: true, message: '' })
    try {
      await mipAiModule.saveDigitalAvatar(outputUrl)
      wx.showToast({ title: '已保存到相册', icon: 'success' })
    }
    catch {
      this.setData({ message: '保存失败，请检查相册权限后重试。' })
    }
    finally {
      this.setData({ saving: false })
    }
  },
})
