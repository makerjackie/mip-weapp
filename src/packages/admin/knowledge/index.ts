import type { KnowledgeAdminSection } from '../../../modules/mip-knowledge'
import { mipKnowledgeAdminModule } from '../../../modules/mip-knowledge'
import { adminLoadFailure } from '../shared/page-state'

type EditorKind = '' | 'SOURCE' | 'CATEGORY' | 'CONTENT'

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

function presentItems(section: KnowledgeAdminSection, rows: Array<Record<string, unknown>>): AdminItem[] {
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

function optionIndex(options: Array<{ value: string }>, value: unknown) {
  return Math.max(0, options.findIndex(option => option.value === value))
}

Page({
  data: {
    state: 'loading' as 'loading' | 'ready' | 'error' | 'forbidden' | 'conflict',
    sectionOptions,
    section: 'CONTENTS' as KnowledgeAdminSection,
    items: [] as AdminItem[],
    sources: [] as AdminItem[],
    sourcePickerOptions: [{ id: '', name: '不关联信息源' }] as PickerItem[],
    categories: [] as AdminItem[],
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
    processing: false,
    message: '',
  },

  onShow() {
    void this.load()
  },

  async onPullDownRefresh() {
    try {
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
      const [sourcePage, categoryPage, currentPage] = await Promise.all([
        mipKnowledgeAdminModule.list('SOURCES'),
        mipKnowledgeAdminModule.list('CATEGORIES'),
        mipKnowledgeAdminModule.list(this.data.section),
      ])
      const sources = presentItems('SOURCES', sourcePage.items)
      this.setData({
        state: 'ready',
        sources,
        sourcePickerOptions: [{ id: '', name: '不关联信息源' }].concat(
          sources.map(source => ({ id: source.id, name: source.name || source.sourceKey || '信息源' })),
        ),
        categories: presentItems('CATEGORIES', categoryPage.items),
        items: presentItems(this.data.section, currentPage.items),
        message: '',
      })
    }
    catch (error) {
      this.setData(adminLoadFailure(error, { hasContent, fallbackMessage: '知识内容管理加载失败' }))
    }
  },

  chooseSection(event: WechatMiniprogram.TouchEvent) {
    const section = String(event.currentTarget.dataset.section || '') as KnowledgeAdminSection
    if (!sectionOptions.some(option => option.value === section) || section === this.data.section) {
      return
    }
    this.setData({ section, editorKind: '', items: [], state: 'loading', message: '' })
    void this.load()
  },

  openCreate() {
    const editorKind = this.data.section === 'SOURCES'
      ? 'SOURCE'
      : this.data.section === 'CATEGORIES' ? 'CATEGORY' : 'CONTENT'
    if (!['SOURCE', 'CATEGORY', 'CONTENT'].includes(editorKind)) {
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
      message: '',
    })
  },

  closeEditor() {
    this.setData({ editorKind: '' })
  },

  async editItem(event: WechatMiniprogram.TouchEvent) {
    const item = this.data.items.find(row => row.id === String(event.currentTarget.dataset.id || ''))
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

  async saveEditor() {
    if (this.data.processing) {
      return
    }
    this.setData({ processing: true, message: '' })
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
      else {
        return
      }
      this.setData({ editorKind: '' })
      wx.showToast({ title: '已保存', icon: 'success' })
      await this.load()
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '保存失败' })
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
