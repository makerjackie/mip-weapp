import type {
  KnowledgeAdminListSection,
  KnowledgeAdminSection,
  KnowledgeSchedule,
  KnowledgeScheduleSaveInput,
  KnowledgeScheduleStatus,
} from '../../../modules/mip-knowledge'
import { mipKnowledgeAdminModule } from '../../../modules/mip-knowledge'
import { adminLoadFailure } from '../shared/page-state'

type EditorKind = '' | 'SOURCE' | 'CATEGORY' | 'CONTENT' | 'SCHEDULE'

interface AdminItem extends Record<string, unknown> {
  id: string
  name?: string
  title?: string
  body?: string
  summary?: string
  status?: string
  statusLabel: string
  detailLabel: string
  version: number
  sourceKey?: string
  sourceType?: string
  endpointUrl?: string
  categoryKey?: string
  sortOrder?: number
  contentType?: string
  accessType?: string
  reviewedAt?: string
  contentSafetyStatus?: string
  product?: AdminProduct | null
  priceLabel?: string
}

interface PickerItem {
  id: string
  name: string
}

interface SchedulePickerItem extends PickerItem {
  status: string
  sourceType?: string
}

interface PresentedKnowledgeSchedule extends KnowledgeSchedule {
  statusLabel: string
  nextRunLabel: string
  lastStartedLabel: string
  lastCompletedLabel: string
}

interface PendingScheduleSave {
  input: KnowledgeScheduleSaveInput
}

interface AdminProduct {
  id: string
  name: string
  priceCents: number
  status: string
  unlockDays: number | null
  refundPolicy: string
  refundWindowHours: number
  version: number
}

const sectionOptions: Array<{ value: KnowledgeAdminSection, label: string }> = [
  { value: 'CONTENTS', label: '内容' },
  { value: 'SOURCES', label: '信息源' },
  { value: 'CATEGORIES', label: '分类' },
  { value: 'SCHEDULES', label: '采集计划' },
  { value: 'COMMENTS', label: '评论' },
  { value: 'REPORTS', label: '举报' },
  { value: 'RUNS', label: '抓取记录' },
]
const sourceTypeOptions = [
  { value: 'MANUAL', label: '手动维护' },
  { value: 'JSON_FEED', label: 'JSON Feed' },
  { value: 'RSS', label: 'RSS' },
]
const contentTypeOptions = [
  { value: 'HOT_NEWS', label: '每日热点' },
  { value: 'ARTICLE', label: '图文' },
  { value: 'WEB', label: '网页' },
  { value: 'VIDEO', label: '视频' },
  { value: 'PRIVATE_CHANNEL', label: '私密视频号' },
  { value: 'EXPERT_SHARE', label: '专家分享' },
]
const accessTypeOptions = [
  { value: 'FREE', label: '公开' },
  { value: 'MEMBER', label: '仅玩家' },
  { value: 'MEMBER_OR_PAID', label: '玩家或单独购买' },
]

const statusLabels: Record<string, string> = {
  ACTIVE: '启用',
  PAUSED: '暂停',
  INACTIVE: '停用',
  DRAFT: '草稿',
  PENDING_REVIEW: '待审核',
  PUBLISHED: '已发布',
  REJECTED: '已驳回',
  WITHDRAWN: '已下架',
  PENDING: '待处理',
  HIDDEN: '已隐藏',
  DELETED: '已删除',
  REVIEWING: '处理中',
  RESOLVED: '已处理',
  DISMISSED: '已驳回',
  RUNNING: '执行中',
  COMPLETED: '已完成',
  FAILED: '失败',
}

function numberValue(value: unknown, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function textValue(value: unknown) {
  return typeof value === 'string' ? value : ''
}

function productValue(value: unknown): AdminProduct | null {
  if (!value || typeof value !== 'object') {
    return null
  }
  return value as AdminProduct
}

function presentItems(section: KnowledgeAdminListSection, rows: Array<Record<string, unknown>>): AdminItem[] {
  return rows.map((row) => {
    const status = textValue(row.status)
    let detailLabel = ''
    if (section === 'SOURCES') {
      detailLabel = [textValue(row.sourceType), textValue(row.endpointUrl)].filter(Boolean).join(' · ')
    }
    else if (section === 'CATEGORIES') {
      detailLabel = `${numberValue(row.contentCount)} 条内容 · 排序 ${numberValue(row.sortOrder)}`
    }
    else if (section === 'CONTENTS') {
      const category = row.category as { name?: string } | undefined
      detailLabel = [textValue(row.contentType), textValue(row.accessType), category?.name || ''].filter(Boolean).join(' · ')
    }
    else if (section === 'COMMENTS') {
      detailLabel = `${textValue(row.contentTitle)} · ${numberValue(row.reportCount)} 个举报`
    }
    else if (section === 'REPORTS') {
      detailLabel = `${textValue(row.contentTitle)} · ${textValue(row.category)}`
    }
    else {
      detailLabel = `新增 ${numberValue(row.createdCount)} · 重复 ${numberValue(row.duplicateCount)} · 驳回 ${numberValue(row.rejectedCount)}`
    }
    const product = productValue(row.product)
    return {
      ...row,
      id: textValue(row.id),
      version: numberValue(row.version),
      status,
      statusLabel: statusLabels[status] || status,
      detailLabel,
      product,
      priceLabel: product ? `¥${(product.priceCents / 100).toFixed(2)}` : '',
    } as AdminItem
  })
}

function presentServerTime(value: string | null | undefined) {
  if (!value) {
    return ''
  }
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}):\d{2}(?:\.\d{3})?Z$/.exec(value)
  return match ? `${match[1]} ${match[2]} UTC` : value
}

function presentSchedules(rows: KnowledgeSchedule[]): PresentedKnowledgeSchedule[] {
  return rows.map(row => ({
    ...row,
    statusLabel: statusLabels[row.status] || row.status,
    nextRunLabel: presentServerTime(row.nextRunAt),
    lastStartedLabel: presentServerTime(row.lastStartedAt),
    lastCompletedLabel: presentServerTime(row.lastCompletedAt),
  }))
}

function scheduleRequestId() {
  return `knowledge-schedule-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`
}

function errorCode(error: unknown) {
  return error && typeof error === 'object' && typeof (error as { code?: unknown }).code === 'string'
    ? (error as { code: string }).code
    : ''
}

function optionIndex(options: Array<{ value: string }>, value: unknown) {
  return Math.max(0, options.findIndex(option => option.value === value))
}

Page({
  data: {
    state: 'loading' as 'loading' | 'ready' | 'error' | 'forbidden' | 'conflict',
    sectionOptions,
    section: 'CONTENTS' as KnowledgeAdminSection,
    items: [] as AdminItem[],
    schedules: [] as PresentedKnowledgeSchedule[],
    sources: [] as AdminItem[],
    sourcePickerOptions: [{ id: '', name: '不关联信息源' }] as PickerItem[],
    categories: [] as AdminItem[],
    scheduleSourceOptions: [] as SchedulePickerItem[],
    scheduleCategoryOptions: [] as SchedulePickerItem[],
    sourceTypeOptions,
    contentTypeOptions,
    accessTypeOptions,
    editorKind: '' as EditorKind,
    editorId: '',
    editorVersion: 0,
    editorKey: '',
    editorName: '',
    editorSummary: '',
    editorStatus: 'ACTIVE',
    sourceTypeIndex: 0,
    editorEndpointUrl: '',
    editorSortOrder: '0',
    editorCategoryIndex: 0,
    editorSourceIndex: 0,
    contentTypeIndex: 0,
    accessTypeIndex: 0,
    editorTitle: '',
    editorBody: '',
    editorExternalUrl: '',
    editorFinderUserName: '',
    editorFeedId: '',
    editorAuthorName: '',
    editorCommentsEnabled: true,
    editorReviewMode: false,
    editorProductId: '',
    editorProductVersion: 0,
    editorPriceYuan: '9.90',
    editorProductActive: false,
    editorRefundable: true,
    editorRefundWindowHours: '24',
    editorUnlockDays: '',
    ingestionCategoryIndex: 0,
    scheduleSourceIndex: -1,
    scheduleCategoryIndex: -1,
    scheduleTimeOfDay: '08:30',
    scheduleTimeZone: 'Asia/Shanghai',
    scheduleStatus: 'ACTIVE' as KnowledgeScheduleStatus,
    pendingScheduleSave: null as PendingScheduleSave | null,
    scheduleRetryPending: false,
    processing: false,
    message: '',
  },

  onShow() {
    if (this.data.pendingScheduleSave) {
      return
    }
    void this.load()
  },

  async onPullDownRefresh() {
    try {
      if (this.data.pendingScheduleSave) {
        this.setData({ message: '请先重试确认当前采集计划，再刷新列表。' })
        return
      }
      await this.load()
    }
    finally {
      wx.stopPullDownRefresh()
    }
  },

  async load() {
    const hasContent = this.data.state === 'ready'
    if (!hasContent) {
      this.setData({ state: 'loading', message: '' })
    }
    try {
      const currentPageRequest = this.data.section === 'SCHEDULES'
        ? mipKnowledgeAdminModule.listSchedules()
        : mipKnowledgeAdminModule.list(this.data.section as KnowledgeAdminListSection)
      const [sourcePage, categoryPage, currentPage] = await Promise.all([
        mipKnowledgeAdminModule.list('SOURCES'),
        mipKnowledgeAdminModule.list('CATEGORIES'),
        currentPageRequest,
      ])
      const sources = presentItems('SOURCES', sourcePage.items)
      const categories = presentItems('CATEGORIES', categoryPage.items)
      this.setData({
        state: 'ready',
        sources,
        sourcePickerOptions: [{ id: '', name: '不关联信息源' }].concat(
          sources.map(source => ({ id: source.id, name: source.name || source.sourceKey || '信息源' })),
        ),
        categories,
        scheduleSourceOptions: sources
          .filter(source => source.status === 'ACTIVE' && ['JSON_FEED', 'RSS'].includes(source.sourceType || ''))
          .map(source => ({
            id: source.id,
            name: source.name || source.sourceKey || '信息源',
            sourceType: source.sourceType,
            status: source.status || '',
          })),
        scheduleCategoryOptions: categories
          .filter(category => category.status === 'ACTIVE')
          .map(category => ({ id: category.id, name: category.name || '分类', status: category.status || '' })),
        items: this.data.section === 'SCHEDULES'
          ? []
          : presentItems(
              this.data.section as KnowledgeAdminListSection,
              currentPage.items as Array<Record<string, unknown>>,
            ),
        schedules: this.data.section === 'SCHEDULES'
          ? presentSchedules(currentPage.items as KnowledgeSchedule[])
          : [],
        message: '',
      })
    }
    catch (error) {
      this.setData(adminLoadFailure(error, { hasContent, fallbackMessage: '知识内容管理加载失败' }))
    }
  },

  chooseSection(event: WechatMiniprogram.TouchEvent) {
    const section = String(event.currentTarget.dataset.section || '') as KnowledgeAdminSection
    if (this.data.processing
      || !sectionOptions.some(option => option.value === section)
      || section === this.data.section) {
      return
    }
    if (this.data.pendingScheduleSave) {
      this.setData({ message: '请先重试确认当前采集计划，再进行其他操作。' })
      return
    }
    this.setData({ section, editorKind: '', items: [], schedules: [], state: 'loading', message: '' })
    void this.load()
  },

  openCreate() {
    if (this.data.processing) {
      return
    }
    const editorKind = this.data.section === 'SOURCES'
      ? 'SOURCE'
      : this.data.section === 'CATEGORIES'
        ? 'CATEGORY'
        : this.data.section === 'SCHEDULES' ? 'SCHEDULE' : 'CONTENT'
    if (!['SOURCE', 'CATEGORY', 'CONTENT', 'SCHEDULE'].includes(editorKind)) {
      return
    }
    if (this.data.pendingScheduleSave) {
      this.setData({ message: '请先重试确认当前采集计划，再新增计划。' })
      return
    }
    this.resetEditor(editorKind as EditorKind)
  },

  resetEditor(editorKind: EditorKind) {
    this.setData({
      editorKind,
      editorId: '',
      editorVersion: 0,
      editorKey: '',
      editorName: '',
      editorSummary: '',
      editorStatus: 'ACTIVE',
      sourceTypeIndex: 0,
      editorEndpointUrl: '',
      editorSortOrder: '0',
      editorCategoryIndex: 0,
      editorSourceIndex: 0,
      contentTypeIndex: 0,
      accessTypeIndex: 0,
      editorTitle: '',
      editorBody: '',
      editorExternalUrl: '',
      editorFinderUserName: '',
      editorFeedId: '',
      editorAuthorName: '',
      editorCommentsEnabled: true,
      editorReviewMode: false,
      editorProductId: '',
      editorProductVersion: 0,
      editorPriceYuan: '9.90',
      editorProductActive: false,
      editorRefundable: true,
      editorRefundWindowHours: '24',
      editorUnlockDays: '',
      scheduleSourceIndex: this.data.scheduleSourceOptions.length ? 0 : -1,
      scheduleCategoryIndex: this.data.scheduleCategoryOptions.length ? 0 : -1,
      scheduleTimeOfDay: '08:30',
      scheduleTimeZone: 'Asia/Shanghai',
      scheduleStatus: 'ACTIVE',
      pendingScheduleSave: null,
      scheduleRetryPending: false,
      message: '',
    })
  },

  closeEditor() {
    if (this.data.processing) {
      return
    }
    if (this.data.pendingScheduleSave) {
      this.setData({ message: '请先重试确认当前采集计划。' })
      return
    }
    this.setData({ editorKind: '' })
  },

  async editItem(event: WechatMiniprogram.TouchEvent) {
    if (this.data.processing) {
      return
    }
    if (this.data.pendingScheduleSave) {
      this.setData({ message: '请先重试确认当前采集计划，再编辑其他计划。' })
      return
    }
    const itemId = String(event.currentTarget.dataset.id || '')
    if (this.data.section === 'SCHEDULES') {
      const schedule = this.data.schedules.find(row => row.id === itemId)
      if (!schedule) {
        return
      }
      this.resetEditor('SCHEDULE')
      this.setData({
        editorId: schedule.id,
        editorVersion: schedule.version,
        scheduleSourceIndex: this.data.scheduleSourceOptions.findIndex(row => row.id === schedule.source.id),
        scheduleCategoryIndex: this.data.scheduleCategoryOptions.findIndex(row => row.id === schedule.category.id),
        scheduleTimeOfDay: schedule.dailyTime,
        scheduleTimeZone: schedule.timeZone || 'Asia/Shanghai',
        scheduleStatus: schedule.status,
      })
      return
    }
    const item = this.data.items.find(row => row.id === itemId)
    if (!item) {
      return
    }
    if (this.data.section === 'SOURCES') {
      this.resetEditor('SOURCE')
      this.setData({
        editorId: item.id,
        editorVersion: item.version,
        editorKey: item.sourceKey || '',
        editorName: item.name || '',
        editorStatus: item.status || 'ACTIVE',
        sourceTypeIndex: optionIndex(sourceTypeOptions, item.sourceType),
        editorEndpointUrl: item.endpointUrl || '',
      })
      return
    }
    if (this.data.section === 'CATEGORIES') {
      this.resetEditor('CATEGORY')
      this.setData({
        editorId: item.id,
        editorVersion: item.version,
        editorKey: item.categoryKey || '',
        editorName: item.name || '',
        editorSummary: item.summary || '',
        editorStatus: item.status || 'ACTIVE',
        editorSortOrder: String(item.sortOrder || 0),
      })
      return
    }
    try {
      const content = await mipKnowledgeAdminModule.getContent(item.id)
      const category = content.category as { id?: string } | undefined
      const source = content.source as { id?: string } | undefined
      const product = productValue(content.product)
      this.resetEditor('CONTENT')
      this.setData({
        editorId: item.id,
        editorVersion: numberValue(content.version),
        editorCategoryIndex: Math.max(0, this.data.categories.findIndex(row => row.id === category?.id)),
        editorSourceIndex: Math.max(0, this.data.sourcePickerOptions.findIndex(row => row.id === source?.id)),
        contentTypeIndex: optionIndex(contentTypeOptions, content.contentType),
        accessTypeIndex: optionIndex(accessTypeOptions, content.accessType),
        editorTitle: textValue(content.title),
        editorSummary: textValue(content.summary),
        editorBody: textValue(content.bodyText),
        editorExternalUrl: textValue(content.externalUrl),
        editorFinderUserName: textValue(content.channelFinderUserName),
        editorFeedId: textValue(content.channelFeedId),
        editorAuthorName: textValue(content.authorName),
        editorCommentsEnabled: content.commentsEnabled !== false,
        editorReviewMode: content.moderationMode === 'REVIEW',
        editorProductId: product?.id || '',
        editorProductVersion: product?.version || 0,
        editorPriceYuan: product ? (product.priceCents / 100).toFixed(2) : '9.90',
        editorProductActive: product?.status === 'ACTIVE',
        editorRefundable: product?.refundPolicy !== 'NON_REFUNDABLE',
        editorRefundWindowHours: String(product?.refundWindowHours ?? 24),
        editorUnlockDays: product?.unlockDays ? String(product.unlockDays) : '',
      })
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '内容详情加载失败' })
    }
  },

  updateField(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    const field = String(event.currentTarget.dataset.field || '')
    const allowed = new Set([
      'editorKey',
      'editorName',
      'editorSummary',
      'editorEndpointUrl',
      'editorSortOrder',
      'editorTitle',
      'editorBody',
      'editorExternalUrl',
      'editorFinderUserName',
      'editorFeedId',
      'editorAuthorName',
      'editorPriceYuan',
      'editorRefundWindowHours',
      'editorUnlockDays',
    ])
    if (allowed.has(field)) {
      this.setData({ [field]: event.detail.value })
    }
  },

  chooseSourceType(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    this.setData({ sourceTypeIndex: Number(event.detail.value) })
  },

  chooseContentType(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    this.setData({ contentTypeIndex: Number(event.detail.value) })
  },

  chooseAccessType(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    this.setData({ accessTypeIndex: Number(event.detail.value) })
  },

  chooseEditorCategory(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    this.setData({ editorCategoryIndex: Number(event.detail.value) })
  },

  chooseEditorSource(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    this.setData({ editorSourceIndex: Number(event.detail.value) })
  },

  chooseIngestionCategory(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    this.setData({ ingestionCategoryIndex: Number(event.detail.value) })
  },

  chooseScheduleSource(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    if (!this.data.processing && !this.data.pendingScheduleSave) {
      this.setData({ scheduleSourceIndex: Number(event.detail.value) })
    }
  },

  chooseScheduleCategory(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    if (!this.data.processing && !this.data.pendingScheduleSave) {
      this.setData({ scheduleCategoryIndex: Number(event.detail.value) })
    }
  },

  chooseScheduleTime(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    if (!this.data.processing && !this.data.pendingScheduleSave) {
      this.setData({ scheduleTimeOfDay: event.detail.value })
    }
  },

  toggleEditorActive(event: WechatMiniprogram.CustomEvent<{ value: boolean }>) {
    this.setData({ editorStatus: event.detail.value ? 'ACTIVE' : 'INACTIVE' })
  },

  toggleComments(event: WechatMiniprogram.CustomEvent<{ value: boolean }>) {
    this.setData({ editorCommentsEnabled: event.detail.value })
  },

  toggleReviewMode(event: WechatMiniprogram.CustomEvent<{ value: boolean }>) {
    this.setData({ editorReviewMode: event.detail.value })
  },

  toggleProductActive(event: WechatMiniprogram.CustomEvent<{ value: boolean }>) {
    this.setData({ editorProductActive: event.detail.value })
  },

  toggleRefundable(event: WechatMiniprogram.CustomEvent<{ value: boolean }>) {
    this.setData({ editorRefundable: event.detail.value })
  },

  toggleScheduleActive(event: WechatMiniprogram.CustomEvent<{ value: boolean }>) {
    if (!this.data.processing && !this.data.pendingScheduleSave) {
      this.setData({ scheduleStatus: event.detail.value ? 'ACTIVE' : 'PAUSED' })
    }
  },

  createScheduleSaveInput(): KnowledgeScheduleSaveInput {
    const source = this.data.scheduleSourceOptions[this.data.scheduleSourceIndex]
    const category = this.data.scheduleCategoryOptions[this.data.scheduleCategoryIndex]
    if (!source) {
      throw new Error('请选择启用的 JSON Feed 或 RSS 信息源')
    }
    if (!category) {
      throw new Error('请选择启用的内容分类')
    }
    if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(this.data.scheduleTimeOfDay)) {
      throw new Error('请选择有效的每日执行时间')
    }
    return {
      ...(this.data.editorId ? { scheduleId: this.data.editorId } : {}),
      expectedVersion: this.data.editorId ? this.data.editorVersion : 0,
      sourceId: source.id,
      categoryId: category.id,
      timeOfDay: this.data.scheduleTimeOfDay,
      timeZone: this.data.scheduleTimeZone || 'Asia/Shanghai',
      status: this.data.scheduleStatus,
      idempotencyKey: scheduleRequestId(),
    }
  },

  async saveEditor() {
    if (this.data.processing) {
      return
    }
    this.setData({ processing: true, message: '' })
    let scheduleAttempt: PendingScheduleSave | null = null
    try {
      if (this.data.editorKind === 'SOURCE') {
        const sourceType = sourceTypeOptions[this.data.sourceTypeIndex]?.value || 'MANUAL'
        await mipKnowledgeAdminModule.saveSource({
          sourceId: this.data.editorId || undefined,
          expectedVersion: this.data.editorId ? this.data.editorVersion : undefined,
          sourceKey: this.data.editorKey,
          name: this.data.editorName,
          sourceType,
          endpointUrl: sourceType === 'MANUAL' ? undefined : this.data.editorEndpointUrl,
          status: this.data.editorStatus,
        })
      }
      else if (this.data.editorKind === 'CATEGORY') {
        await mipKnowledgeAdminModule.saveCategory({
          categoryId: this.data.editorId || undefined,
          expectedVersion: this.data.editorId ? this.data.editorVersion : undefined,
          categoryKey: this.data.editorKey,
          name: this.data.editorName,
          summary: this.data.editorSummary,
          sortOrder: numberValue(this.data.editorSortOrder),
          status: this.data.editorStatus,
        })
      }
      else if (this.data.editorKind === 'CONTENT') {
        const category = this.data.categories[this.data.editorCategoryIndex]
        if (!category) {
          throw new Error('请先新增并选择内容分类')
        }
        const source = this.data.sourcePickerOptions[this.data.editorSourceIndex]
        const saved = await mipKnowledgeAdminModule.saveContent({
          contentId: this.data.editorId || undefined,
          expectedVersion: this.data.editorId ? this.data.editorVersion : undefined,
          sourceId: source?.id || undefined,
          categoryId: category.id,
          contentType: contentTypeOptions[this.data.contentTypeIndex]?.value,
          accessType: accessTypeOptions[this.data.accessTypeIndex]?.value,
          title: this.data.editorTitle,
          summary: this.data.editorSummary,
          bodyText: this.data.editorBody,
          externalUrl: this.data.editorExternalUrl,
          channelFinderUserName: this.data.editorFinderUserName,
          channelFeedId: this.data.editorFeedId,
          authorName: this.data.editorAuthorName,
          commentsEnabled: this.data.editorCommentsEnabled,
          moderationMode: this.data.editorReviewMode ? 'REVIEW' : 'AUTO',
        })
        if (accessTypeOptions[this.data.accessTypeIndex]?.value === 'MEMBER_OR_PAID') {
          const price = this.data.editorPriceYuan.trim()
          const priceCents = price ? Math.round(Number(price) * 100) : undefined
          await mipKnowledgeAdminModule.saveProduct({
            contentId: saved.id,
            productId: this.data.editorProductId || undefined,
            expectedVersion: this.data.editorProductId ? this.data.editorProductVersion : undefined,
            priceCents,
            status: this.data.editorProductActive ? 'ACTIVE' : 'DRAFT',
            refundPolicy: this.data.editorRefundable ? 'BEFORE_ACCESS' : 'NON_REFUNDABLE',
            refundWindowHours: numberValue(this.data.editorRefundWindowHours, 24),
            unlockDays: this.data.editorUnlockDays.trim() || null,
          })
        }
      }
      else if (this.data.editorKind === 'SCHEDULE') {
        scheduleAttempt = this.data.pendingScheduleSave || { input: this.createScheduleSaveInput() }
        await mipKnowledgeAdminModule.saveSchedule(scheduleAttempt.input)
      }
      else {
        return
      }
      this.setData({ editorKind: '', pendingScheduleSave: null, scheduleRetryPending: false })
      wx.showToast({ title: '已保存', icon: 'success' })
      await this.load()
    }
    catch (error) {
      const preserveScheduleAttempt = Boolean(
        scheduleAttempt
        && (this.data.pendingScheduleSave || errorCode(error) === 'KNOWLEDGE_SCHEDULE_AUTOMATION_UNVERIFIED'),
      )
      this.setData({
        message: error instanceof Error ? error.message : '保存失败',
        ...(preserveScheduleAttempt
          ? { pendingScheduleSave: scheduleAttempt, scheduleRetryPending: true }
          : {}),
      })
    }
    finally {
      this.setData({ processing: false })
    }
  },

  async transitionContent(event: WechatMiniprogram.TouchEvent) {
    const contentId = String(event.currentTarget.dataset.id || '')
    const expectedVersion = Number(event.currentTarget.dataset.version)
    const decision = String(event.currentTarget.dataset.decision || '')
    let reason = ''
    if (decision === 'REJECT' || decision === 'WITHDRAW') {
      const modal = await wx.showModal({
        title: decision === 'REJECT' ? '驳回内容' : '下架内容',
        editable: true,
        placeholderText: '填写原因',
      })
      if (!modal.confirm || !modal.content.trim()) {
        return
      }
      reason = modal.content.trim()
    }
    await this.runMutation(async () => {
      await mipKnowledgeAdminModule.reviewContent(contentId, expectedVersion, decision, reason)
    }, '内容状态更新失败')
  },

  async moderateComment(event: WechatMiniprogram.TouchEvent) {
    const commentId = String(event.currentTarget.dataset.id || '')
    const expectedVersion = Number(event.currentTarget.dataset.version)
    const decision = String(event.currentTarget.dataset.decision || '') as 'PUBLISH' | 'HIDE'
    const reason = await this.askReason(decision === 'PUBLISH' ? '发布评论' : '隐藏评论')
    if (!reason) {
      return
    }
    await this.runMutation(async () => {
      await mipKnowledgeAdminModule.moderateComment(commentId, expectedVersion, decision, reason)
    }, '评论审核失败')
  },

  async closeReport(event: WechatMiniprogram.TouchEvent) {
    const reportId = String(event.currentTarget.dataset.id || '')
    const expectedVersion = Number(event.currentTarget.dataset.version)
    const status = String(event.currentTarget.dataset.status || '') as 'RESOLVED' | 'DISMISSED'
    const reason = await this.askReason(status === 'RESOLVED' ? '处理举报' : '驳回举报')
    if (!reason) {
      return
    }
    await this.runMutation(async () => {
      await mipKnowledgeAdminModule.closeReport(reportId, expectedVersion, status, reason)
    }, '举报处理失败')
  },

  async runIngestion(event: WechatMiniprogram.TouchEvent) {
    const sourceId = String(event.currentTarget.dataset.id || '')
    const category = this.data.categories[this.data.ingestionCategoryIndex]
    if (!category) {
      this.setData({ message: '请先新增并选择内容分类' })
      return
    }
    await this.runMutation(async () => {
      await mipKnowledgeAdminModule.runIngestion(sourceId, category.id)
    }, '热点抓取失败')
  },

  async askReason(title: string) {
    const modal = await wx.showModal({ title, editable: true, placeholderText: '填写处理原因' })
    return modal.confirm ? modal.content.trim() : ''
  },

  async runMutation(operation: () => Promise<void>, fallback: string) {
    if (this.data.processing) {
      return
    }
    this.setData({ processing: true, message: '' })
    try {
      await operation()
      wx.showToast({ title: '操作完成', icon: 'success' })
      await this.load()
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : fallback })
    }
    finally {
      this.setData({ processing: false })
    }
  },
})
