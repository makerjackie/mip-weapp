import type { SuperCaseId } from '../../../../modules/mip'
import type { AiDraftSourceConfirmation } from '../../../../modules/mip-ai'
import type { SuperCaseDetail, SuperCaseStatus } from '../../../../modules/mip-cases'
import type { OpportunityCatalog } from '../../../../modules/mip-opportunities'
import { aiText } from '../../../../modules/mip-ai/editor'
import { loadAiEditorDraft } from '../../../../modules/mip-ai/editor-loader'
import { superCaseModule } from '../../../../modules/mip-cases'
import { mipMediaModule } from '../../../../modules/mip-media/client'
import { opportunityModule } from '../../../../modules/mip-opportunities'
import { caseNavigateTo } from '../../../../platform/navigation/client'
import { chooseMultipleImages, chooseSingleImage } from '../../../../platform/wechat/image-upload'

interface CaseMediaDraft { assetId: string, imageUrl: string }

type CaseEditorPublicationStatus = SuperCaseStatus | 'NEW'

function publicationStatus(value: unknown): CaseEditorPublicationStatus {
  const status = String(value)
  return ['DRAFT', 'PUBLISHED', 'UNPUBLISHED', 'ARCHIVED'].includes(status)
    ? status as SuperCaseStatus
    : 'NEW'
}

function publicationStatusText(value: CaseEditorPublicationStatus) {
  return {
    NEW: '新案例',
    DRAFT: '草稿',
    PUBLISHED: '已发布',
    UNPUBLISHED: '已下架',
    ARCHIVED: '已归档',
  }[value]
}

function aiDate(value: unknown) {
  const text = typeof value === 'string' ? value.trim() : ''
  return /^\d{4}-\d{2}-\d{2}$/.test(text) && !Number.isNaN(Date.parse(`${text}T00:00:00Z`))
    ? text
    : ''
}

Page({
  data: {
    id: '' as SuperCaseId | '',
    version: 0,
    state: 'loading' as 'loading' | 'ready' | 'error',
    saving: false,
    savingIntent: '' as '' | 'draft' | 'publish',
    message: '',
    publicationStatus: 'NEW' as CaseEditorPublicationStatus,
    publicationStatusText: publicationStatusText('NEW'),
    aiDraftId: '',
    aiConfirmation: null as AiDraftSourceConfirmation | null,
    aiDraftLoaded: false,
    projectName: '',
    summary: '',
    startedOn: '',
    endedOn: '',
    responsibility: '',
    cityTagId: '',
    cityIndex: 0,
    industryTagId: '',
    industryIndex: 0,
    caseType: '',
    description: '',
    coverAssetId: '',
    coverUrl: '',
    coverUploading: false,
    mediaAssetIds: [] as string[],
    mediaAssets: [] as CaseMediaDraft[],
    mediaUploading: false,
    cityOptions: [{ id: '', label: '未选择' }],
    industryOptions: [{ id: '', label: '未选择' }],
  },
  navigationTimer: undefined as ReturnType<typeof setTimeout> | undefined,

  onLoad(options: Record<string, string | undefined>) {
    this.setData({
      id: String(options.id || '') as SuperCaseId | '',
      aiDraftId: String(options.aiDraftId || ''),
    })
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

  openAiAssistant() {
    caseNavigateTo({ url: '/packages/member/mip-ai/index' })
  },

  async initialize() {
    this.setData({ state: 'loading', message: '' })
    try {
      if (this.data.id && this.data.aiDraftId) {
        throw new Error('AI 草稿不能覆盖已有案例')
      }
      const [catalog, detail, aiSource] = await Promise.all([
        opportunityModule.getCatalogs(),
        this.data.id ? superCaseModule.get(this.data.id) : Promise.resolve(null),
        this.data.aiDraftId ? loadAiEditorDraft(this.data.aiDraftId, 'SUPER_CASE') : Promise.resolve(null),
      ])
      this.applyData(catalog, detail)
      if (aiSource) {
        this.setData({
          projectName: aiText(aiSource.fields, 'projectName', 120),
          summary: aiText(aiSource.fields, 'summary', 240),
          responsibility: aiText(aiSource.fields, 'responsibility', 500),
          description: aiText(aiSource.fields, 'description', 8000),
          startedOn: aiDate(aiSource.fields.startedOn),
          endedOn: aiDate(aiSource.fields.endedOn),
          caseType: aiText(aiSource.fields, 'caseType', 80),
          aiConfirmation: aiSource.confirmation,
          aiDraftLoaded: true,
        })
      }
      this.setData({ state: 'ready' })
    }
    catch (error) {
      this.setData({ state: 'error', message: error instanceof Error ? error.message : '页面加载失败' })
    }
  },

  applyData(catalog: OpportunityCatalog, detail: SuperCaseDetail | null) {
    const cityOptions = [{ id: '', label: '未选择' }, ...catalog.cityTags]
    const industryOptions = [{ id: '', label: '未选择' }, ...catalog.industryTags]
    const cityIndex = detail?.cityLabel
      ? Math.max(0, cityOptions.findIndex(item => item.label === detail.cityLabel))
      : 0
    const industryIndex = detail?.industryLabel
      ? Math.max(0, industryOptions.findIndex(item => item.label === detail.industryLabel))
      : 0
    const status = publicationStatus(detail?.status)
    this.setData({
      cityOptions,
      industryOptions,
      cityIndex,
      industryIndex,
      projectName: detail?.projectName || '',
      summary: detail?.summary || '',
      startedOn: detail?.startedOn || '',
      endedOn: detail?.endedOn || '',
      responsibility: detail?.responsibility || '',
      cityTagId: cityOptions[cityIndex]?.id || '',
      industryTagId: industryOptions[industryIndex]?.id || '',
      caseType: detail?.caseType || '',
      description: detail?.description || '',
      coverAssetId: detail?.coverAssetId || '',
      coverUrl: detail?.coverUrl || '',
      mediaAssetIds: detail?.mediaAssetIds || [],
      mediaAssets: (detail?.mediaAssetIds || []).map((assetId, index) => ({
        assetId,
        imageUrl: detail?.media[index]?.url || '',
      })),
      version: detail?.version || 0,
      publicationStatus: status,
      publicationStatusText: publicationStatusText(status),
    })
  },

  updateText(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    const field = String(event.currentTarget.dataset.field || '')
    if (!['projectName', 'summary', 'responsibility', 'caseType', 'description'].includes(field)) {
      return
    }
    this.setData({ [field]: event.detail.value })
  },

  changeStart(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    this.setData({ startedOn: event.detail.value })
  },

  changeEnd(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    this.setData({ endedOn: event.detail.value })
  },

  clearDates() { this.setData({ startedOn: '', endedOn: '' }) },

  changeCity(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    const cityIndex = Number(event.detail.value)
    const item = this.data.cityOptions[cityIndex]
    if (item) {
      this.setData({ cityIndex, cityTagId: item.id })
    }
  },

  changeIndustry(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    const industryIndex = Number(event.detail.value)
    const item = this.data.industryOptions[industryIndex]
    if (item) {
      this.setData({ industryIndex, industryTagId: item.id })
    }
  },

  async chooseCover() {
    if (this.data.coverUploading || this.data.mediaUploading || this.data.saving) {
      return
    }
    this.setData({ coverUploading: true, message: '' })
    try {
      const sourcePath = await chooseSingleImage()
      const asset = await mipMediaModule.uploadImageFromPath('SUPER_CASE_COVER', sourcePath)
      this.setData({ coverAssetId: asset.assetId, coverUrl: asset.imageUrl })
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '封面上传失败，请重试。' })
    }
    finally {
      this.setData({ coverUploading: false })
    }
  },

  async addMedia() {
    const remaining = 12 - this.data.mediaAssets.length
    if (remaining <= 0) {
      this.setData({ message: '最多上传 12 张展示素材。' })
      return
    }
    if (this.data.mediaUploading || this.data.coverUploading || this.data.saving) {
      return
    }
    this.setData({ mediaUploading: true, message: '' })
    try {
      const paths = await chooseMultipleImages(Math.min(9, remaining))
      for (const sourcePath of paths) {
        const asset = await mipMediaModule.uploadImageFromPath('SUPER_CASE_MEDIA', sourcePath)
        const mediaAssets = [...this.data.mediaAssets, {
          assetId: asset.assetId,
          imageUrl: asset.imageUrl,
        }]
        this.setData({
          mediaAssets,
          mediaAssetIds: mediaAssets.map(item => item.assetId),
        })
      }
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '案例素材上传失败，请重试。' })
    }
    finally {
      this.setData({ mediaUploading: false })
    }
  },

  removeMedia(event: WechatMiniprogram.TouchEvent) {
    if (this.data.mediaUploading || this.data.saving) {
      return
    }
    const assetId = String(event.currentTarget.dataset.assetId || '')
    const mediaAssets = this.data.mediaAssets.filter(item => item.assetId !== assetId)
    this.setData({
      mediaAssets,
      mediaAssetIds: mediaAssets.map(item => item.assetId),
    })
  },

  previewMedia(event: WechatMiniprogram.TouchEvent) {
    const current = String(event.currentTarget.dataset.url || '')
    const urls = this.data.mediaAssets.map(item => item.imageUrl).filter(Boolean)
    if (current && urls.includes(current)) {
      wx.previewImage({ current, urls })
    }
  },

  saveDraft() { void this.save(false) },
  publish() { void this.save(true) },

  async save(publish: boolean) {
    if (this.data.saving || this.data.coverUploading || this.data.mediaUploading) {
      return
    }
    this.setData({
      saving: true,
      savingIntent: publish ? 'publish' : 'draft',
      message: '',
    })
    try {
      const result = await superCaseModule.save({
        id: this.data.id || undefined,
        expectedVersion: this.data.id ? this.data.version : undefined,
        projectName: this.data.projectName,
        summary: this.data.summary,
        startedOn: this.data.startedOn || undefined,
        endedOn: this.data.endedOn || undefined,
        responsibility: this.data.responsibility,
        cityTagId: this.data.cityTagId || undefined,
        industryTagId: this.data.industryTagId || undefined,
        caseType: this.data.caseType || undefined,
        description: this.data.description,
        coverAssetId: this.data.coverAssetId || undefined,
        mediaAssetIds: this.data.mediaAssetIds,
        publish,
        aiConfirmation: this.data.aiConfirmation || undefined,
      })
      const status = publicationStatus(result.status)
      this.setData({
        id: result.id,
        version: result.version,
        publicationStatus: status,
        publicationStatusText: publicationStatusText(status),
      })
      wx.showToast({ title: result.status === 'PUBLISHED' ? '案例已发布' : '草稿已保存', icon: 'success' })
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
      this.setData({ saving: false, savingIntent: '' })
    }
  },
})
