import type { SuperCaseId } from '../../../../modules/mip'
import type { AiDraftSourceConfirmation } from '../../../../modules/mip-ai'
import type { SuperCaseDetail, SuperCaseDraft, SuperCaseProject, SuperCaseStatus } from '../../../../modules/mip-cases'
import type { OpportunityCatalog } from '../../../../modules/mip-opportunities'
import { aiText } from '../../../../modules/mip-ai/editor'
import { loadAiEditorDraft } from '../../../../modules/mip-ai/editor-loader'
import { superCaseModule } from '../../../../modules/mip-cases'
import { collectMissingProjectFields, MAX_SUPER_CASE_PROJECTS } from '../../../../modules/mip-cases/validation'
import { opportunityModule } from '../../../../modules/mip-opportunities'
import { EDITOR_HOT_CITY_COUNT, HOT_CITY_LABELS } from '../city-selector/city-directory'

// 单个项目的编辑态（figma 2173_42605：整块 panel 表单，「主营城市」行 + 热门城市标签 + 选择城市二级页）。
interface ProjectForm {
  projectName: string
  summary: string
  startedOn: string
  responsibility: string
  cityLabel: string
  cityTagId: string
  region: string
  caseType: string
  description: string
}

interface HotCityOption {
  label: string
  tagId: string
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
    cityLabel: '',
    cityTagId: '',
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
    message: '',
    publicationStatus: 'NEW' as CaseEditorPublicationStatus,
    publicationStatusText: publicationStatusText('NEW'),
    aiDraftId: '',
    aiConfirmation: null as AiDraftSourceConfirmation | null,
    aiDraftLoaded: false,
    projects: [emptyProject()] as ProjectForm[],
    hotCities: [] as HotCityOption[],
    coverAssetId: '',
    mediaAssetIds: [] as string[],
    cityOptions: [{ id: '', label: '未选择' }],
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
    const cityTagIdOf = (label: string) => catalog.cityTags.find(tag => tag.label === label)?.id || ''
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
      cityLabel: project.cityLabel || '',
      cityTagId: cityTagIdOf(project.cityLabel || ''),
      region: project.region || '',
      caseType: project.caseType || '',
      description: project.description || '',
    }))
    const status = publicationStatus(detail?.status)
    this.setData({
      cityOptions,
      // 标注 2127_2195：热门城市走城市标签库，仅展示标签库中能对上 id 的前 8 个。
      hotCities: HOT_CITY_LABELS.slice(0, EDITOR_HOT_CITY_COUNT)
        .map(label => ({ label, tagId: cityTagIdOf(label) })),
      projects,
      coverAssetId: detail?.coverAssetId || '',
      mediaAssetIds: detail?.mediaAssetIds || [],
      version: detail?.version || 0,
      publicationStatus: status,
      publicationStatusText: publicationStatusText(status),
    })
  },

  // AI 语音填写入口(设计稿 2173_42605 AI助手卡):进入录音页,完成后带 aiDraftId 回跳。
  onAiAssistant() {
    if (this.data.id) {
      wx.showToast({ title: 'AI 语音填写仅用于新建案例', icon: 'none' })
      return
    }
    wx.navigateTo({ url: '/packages/member/mip-ai/voice/index?purpose=SUPER_CASE' })
  },

  updateProjectText(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    const groupIndex = Number(event.currentTarget.dataset.groupIndex)
    const field = String(event.currentTarget.dataset.field || '')
    if (!Number.isInteger(groupIndex) || !PROJECT_TEXT_FIELDS.includes(field)) {
      return
    }
    this.dismissSaveError()
    this.setData({ [`projects[${groupIndex}].${field}`]: event.detail.value })
  },

  changeProjectStart(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    const groupIndex = Number(event.currentTarget.dataset.groupIndex)
    if (Number.isInteger(groupIndex)) {
      this.dismissSaveError()
      this.setData({ [`projects[${groupIndex}].startedOn`]: event.detail.value })
    }
  },

  applyCity(groupIndex: number, label: string, tagId = '') {
    const knownTagId = this.data.cityOptions.find(option => option.label === label)?.id || ''
    this.dismissSaveError()
    this.setData({
      [`projects[${groupIndex}].cityLabel`]: label,
      // 标签库为主：标签库暂缺该城市时 tagId 留空，发布校验会给出明确提示。
      [`projects[${groupIndex}].cityTagId`]: tagId || knownTagId,
    })
  },

  // figma 2215_4618：主营城市不再用原生滚动选择，跳「选择城市」二级页，EventChannel 带回结果。
  openCitySelector(event: WechatMiniprogram.TouchEvent) {
    const groupIndex = Number(event.currentTarget.dataset.groupIndex)
    if (!Number.isInteger(groupIndex)) {
      return
    }
    wx.navigateTo({
      url: `/packages/member/mip-cases/city-selector/index?selected=${encodeURIComponent(this.data.projects[groupIndex]?.cityLabel || '')}`,
      events: {
        citySelected: (payload: { label?: string, tagId?: string }) => {
          const label = String(payload?.label || '')
          if (label) {
            this.applyCity(groupIndex, label, String(payload?.tagId || ''))
          }
        },
      },
    })
  },

  applyHotCity(event: WechatMiniprogram.CustomEvent<{ label: string }>) {
    const groupIndex = Number(event.currentTarget.dataset.groupIndex)
    const label = String(event.detail.label || '')
    if (!Number.isInteger(groupIndex) || !label) {
      return
    }
    this.applyCity(groupIndex, label)
  },

  addProject() {
    if (this.data.projects.length >= MAX_SUPER_CASE_PROJECTS) {
      wx.showToast({ title: `最多 ${MAX_SUPER_CASE_PROJECTS} 个项目`, icon: 'none' })
      return
    }
    this.dismissSaveError()
    this.setData({ projects: [...this.data.projects, emptyProject()] })
  },

  removeProject(event: WechatMiniprogram.TouchEvent) {
    const groupIndex = Number(event.currentTarget.dataset.groupIndex)
    if (!Number.isInteger(groupIndex) || groupIndex <= 0 || this.data.projects.length <= 1) {
      return
    }
    this.dismissSaveError()
    const projects = this.data.projects.filter((_, index) => index !== groupIndex)
    this.setData({ projects })
  },

  draftProjects(): SuperCaseProject[] {
    return this.data.projects.map((project) => {
      const draft: SuperCaseProject = {
        projectName: project.projectName,
        summary: project.summary,
        startedOn: project.startedOn || undefined,
        responsibility: project.responsibility,
        cityTagId: project.cityTagId || this.data.cityOptions.find(option => option.label === project.cityLabel)?.id || undefined,
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

  // figma 2173_42605 底部唯一操作：保存（必填校验通过后直接保存发布，草稿通道随「保存草稿」一起移除）。
  saveCase() {
    const missing = collectMissingProjectFields(this.draftProjects())
    if (missing.length) {
      wx.showModal({
        title: '还有必填项未填写',
        content: missing.join('；'),
        showCancel: false,
        confirmText: '去填写',
      })
      return
    }
    void this.save()
  },

  // MIP-3：保存失败横幅（save-error-banner）持久展示，修改任一字段后清除；
  // 下一次保存则在 save() 开始时清除。
  dismissSaveError() {
    if (this.data.message) {
      this.setData({ message: '' })
    }
  },

  async save() {
    if (this.data.saving) {
      return
    }
    const projects = this.draftProjects()
    const [first] = projects
    this.setData({
      saving: true,
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
        publish: true,
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
      wx.showToast({ title: result.status === 'PUBLISHED' ? '案例已发布' : '案例已保存', icon: 'success' })
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
