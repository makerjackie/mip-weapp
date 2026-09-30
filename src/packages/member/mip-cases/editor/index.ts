import type { SuperCaseId } from '../../../../modules/mip'
import type { AiDraftSourceConfirmation } from '../../../../modules/mip-ai'
import type { SuperCaseDetail, SuperCaseDraft, SuperCaseProject, SuperCaseStatus } from '../../../../modules/mip-cases'
import type { OpportunityCatalog } from '../../../../modules/mip-opportunities'
import { aiText } from '../../../../modules/mip-ai/editor'
import { loadAiEditorDraft } from '../../../../modules/mip-ai/editor-loader'
import { superCaseModule } from '../../../../modules/mip-cases'
import { collectMissingProjectFields, MAX_SUPER_CASE_PROJECTS } from '../../../../modules/mip-cases/validation'
import { mipMediaModule } from '../../../../modules/mip-media/client'
import { opportunityModule } from '../../../../modules/mip-opportunities'
import { chooseMultipleImages, chooseSingleImage } from '../../../../platform/wechat/image-upload'

interface CaseMediaDraft { assetId: string, imageUrl: string }

// 单个项目的编辑态（figma 2173_42605：「添加项目」整组追加，城市下拉共享目录）。
interface ProjectForm {
  projectName: string
  summary: string
  startedOn: string
  responsibility: string
  cityIndex: number
  region: string
  caseType: string
  description: string
}

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

function emptyProject(): ProjectForm {
  return {
    projectName: '',
    summary: '',
    startedOn: '',
    responsibility: '',
    cityIndex: 0,
    region: '',
    caseType: '',
    description: '',
  }
}

const PROJECT_TEXT_FIELDS = ['projectName', 'summary', 'responsibility', 'region', 'caseType', 'description']

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
    projects: [emptyProject()] as ProjectForm[],
    coverAssetId: '',
    coverUrl: '',
    coverUploading: false,
    mediaAssetIds: [] as string[],
    mediaAssets: [] as CaseMediaDraft[],
    mediaUploading: false,
    cityOptions: [{ id: '', label: '未选择' }],
  },
  navigationTimer: undefined as ReturnType<typeof setTimeout> | undefined,

  onLoad(options: Record<string, string | undefined>) {
    this.setData({
      id: String(options.id || '') as SuperCaseId | '',
      aiDraftId: '',
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
          'projects[0].projectName': aiText(aiSource.fields, 'projectName', 120),
          'projects[0].summary': aiText(aiSource.fields, 'summary', 240),
          'projects[0].responsibility': aiText(aiSource.fields, 'responsibility', 500),
          'projects[0].description': aiText(aiSource.fields, 'description', 300),
          'projects[0].startedOn': aiDate(aiSource.fields.startedOn),
          'projects[0].caseType': aiText(aiSource.fields, 'caseType', 80),
          'aiConfirmation': aiSource.confirmation,
          'aiDraftLoaded': true,
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
    const storedProjects = detail?.projects?.length
      ? detail.projects
      : [{
          projectName: detail?.projectName || '',
          summary: detail?.summary || '',
          startedOn: detail?.startedOn || '',
          responsibility: detail?.responsibility || '',
          cityLabel: detail?.cityLabel,
          region: '',
          caseType: detail?.caseType || '',
          description: detail?.description || '',
        }]
    const projects: ProjectForm[] = storedProjects.map(project => ({
      projectName: project.projectName || '',
      summary: project.summary || '',
      startedOn: project.startedOn || '',
      responsibility: project.responsibility || '',
      cityIndex: project.cityLabel
        ? Math.max(0, cityOptions.findIndex(item => item.label === project.cityLabel))
        : 0,
      region: project.region || '',
      caseType: project.caseType || '',
      description: project.description || '',
    }))
    const status = publicationStatus(detail?.status)
    this.setData({
      cityOptions,
      projects,
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

  // AI 语音填写入口(设计稿 2173_42605 AI助手卡)。语音转草稿能力尚未开放 UI 流程,
  // 先给出明确反馈,不静默失效。
  onAiAssistant() {
    wx.showToast({ title: 'AI 语音填写即将开放', icon: 'none' })
  },

  updateProjectText(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    const groupIndex = Number(event.currentTarget.dataset.groupIndex)
    const field = String(event.currentTarget.dataset.field || '')
    if (!Number.isInteger(groupIndex) || !PROJECT_TEXT_FIELDS.includes(field)) {
      return
    }
    this.setData({ [`projects[${groupIndex}].${field}`]: event.detail.value })
  },

  changeProjectStart(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    const groupIndex = Number(event.currentTarget.dataset.groupIndex)
    if (Number.isInteger(groupIndex)) {
      this.setData({ [`projects[${groupIndex}].startedOn`]: event.detail.value })
    }
  },

  changeProjectCity(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    const groupIndex = Number(event.currentTarget.dataset.groupIndex)
    const cityIndex = Number(event.detail.value)
    if (Number.isInteger(groupIndex) && this.data.cityOptions[cityIndex]) {
      this.setData({ [`projects[${groupIndex}].cityIndex`]: cityIndex })
    }
  },

  addProject() {
    if (this.data.projects.length >= MAX_SUPER_CASE_PROJECTS) {
      wx.showToast({ title: `最多 ${MAX_SUPER_CASE_PROJECTS} 个项目`, icon: 'none' })
      return
    }
    this.setData({ projects: [...this.data.projects, emptyProject()] })
  },

  removeProject(event: WechatMiniprogram.TouchEvent) {
    const groupIndex = Number(event.currentTarget.dataset.groupIndex)
    if (!Number.isInteger(groupIndex) || groupIndex <= 0 || this.data.projects.length <= 1) {
      return
    }
    const projects = this.data.projects.filter((_, index) => index !== groupIndex)
    this.setData({ projects })
  },

  draftProjects(cityOptions: Array<{ id: string, label: string }>): SuperCaseProject[] {
    return this.data.projects.map((project) => {
      const draft: SuperCaseProject = {
        projectName: project.projectName,
        summary: project.summary,
        startedOn: project.startedOn || undefined,
        responsibility: project.responsibility,
        cityTagId: cityOptions[project.cityIndex]?.id || undefined,
        description: project.description,
      }
      if (project.region) {
        draft.region = project.region
      }
      if (project.caseType) {
        draft.caseType = project.caseType
      }
      return draft
    })
  },

  publish() {
    const missing = collectMissingProjectFields(this.draftProjects(this.data.cityOptions))
    if (missing.length) {
      wx.showModal({
        title: '还有必填项未填写',
        content: missing.join('；'),
        showCancel: false,
        confirmText: '去填写',
      })
      return
    }
    void this.save(true)
  },

  saveDraft() { void this.save(false) },

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

  async save(publish: boolean) {
    if (this.data.saving || this.data.coverUploading || this.data.mediaUploading) {
      return
    }
    const projects = this.draftProjects(this.data.cityOptions)
    const [first] = projects
    this.setData({
      saving: true,
      savingIntent: publish ? 'publish' : 'draft',
      message: '',
    })
    try {
      const draft: SuperCaseDraft = {
        id: this.data.id || undefined,
        expectedVersion: this.data.id ? this.data.version : undefined,
        projectName: first.projectName,
        summary: first.summary,
        responsibility: first.responsibility,
        description: first.description,
        projects,
        coverAssetId: this.data.coverAssetId || undefined,
        mediaAssetIds: this.data.mediaAssetIds,
        publish,
        aiConfirmation: this.data.aiConfirmation || undefined,
      }
      const result = await superCaseModule.save(draft)
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
