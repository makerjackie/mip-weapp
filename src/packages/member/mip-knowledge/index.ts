import type {
  KnowledgeAccessType,
  KnowledgeCategory,
  KnowledgeContentSummary,
  KnowledgeContentType,
} from '../../../modules/mip-knowledge/types'
import { mipKnowledgeModule } from '../../../modules/mip-knowledge/client'

const typeLabels: Record<KnowledgeContentType, string> = {
  HOT_NEWS: '热点',
  ARTICLE: '图文',
  WEB: '网页',
  VIDEO: '视频',
  PRIVATE_CHANNEL: '私密视频号',
  EXPERT_SHARE: '专家分享',
}

const accessLabels: Record<KnowledgeAccessType, string> = {
  FREE: '公开',
  MEMBER: '玩家可读',
  MEMBER_OR_PAID: '玩家或单独购买',
}

type KnowledgeAccessFilter = KnowledgeAccessType | ''

const accessOptions: Array<{ value: KnowledgeAccessFilter, label: string }> = [
  { value: '', label: '全部' },
  ...Object.entries(accessLabels).map(([value, label]) => ({ value: value as KnowledgeAccessType, label })),
]

type ContentView = KnowledgeContentSummary & { typeLabel: string, accessLabel: string, priceLabel: string }

function contentView(item: KnowledgeContentSummary): ContentView {
  return {
    ...item,
    typeLabel: typeLabels[item.contentType],
    accessLabel: accessLabels[item.accessType],
    priceLabel: item.product ? `¥${(item.product.priceCents / 100).toFixed(2)}` : '',
  }
}

Page({
  contentRequestSequence: 0,

  data: {
    state: 'loading' as 'loading' | 'ready' | 'empty' | 'error',
    categories: [] as KnowledgeCategory[],
    items: [] as ContentView[],
    categoryId: '',
    contentType: '' as KnowledgeContentType | '',
    accessType: '' as KnowledgeAccessFilter,
    queryInput: '',
    query: '',
    nextCursor: '',
    loadingMore: false,
    message: '',
    catalogMessage: '',
    typeOptions: [
      { value: '', label: '全部' },
      ...Object.entries(typeLabels).map(([value, label]) => ({ value, label })),
    ],
    accessOptions,
  },

  onLoad() {
    void this.loadFiltersAndContents()
  },

  onUnload() {
    this.contentRequestSequence += 1
  },

  async onPullDownRefresh() {
    try {
      await this.loadFiltersAndContents()
    }
    finally {
      wx.stopPullDownRefresh()
    }
  },

  async loadFiltersAndContents() {
    const requestSequence = this.contentRequestSequence + 1
    this.contentRequestSequence = requestSequence
    if (!this.data.items.length) {
      this.setData({ state: 'loading', message: '' })
    }
    this.setData({ nextCursor: '', loadingMore: false })
    const categoriesLoad = this.loadCategories(requestSequence)
    try {
      const page = await mipKnowledgeModule.listContents({
        categoryId: this.data.categoryId || undefined,
        contentType: this.data.contentType,
        accessType: this.data.accessType,
        query: this.data.query,
        limit: 20,
      })
      if (requestSequence !== this.contentRequestSequence) {
        return
      }
      const items = page.items.map(contentView)
      this.setData({
        state: items.length ? 'ready' : 'empty',
        items,
        nextCursor: page.nextCursor || '',
        message: '',
      })
    }
    catch (error) {
      if (requestSequence !== this.contentRequestSequence) {
        return
      }
      this.setData({
        state: this.data.items.length ? 'ready' : 'error',
        message: error instanceof Error ? error.message : '内容加载失败',
      })
    }
    finally {
      await categoriesLoad
    }
  },

  async loadCategories(sequence?: number) {
    const requestSequence = sequence ?? this.contentRequestSequence
    try {
      const categories = await mipKnowledgeModule.listCategories()
      if (requestSequence === this.contentRequestSequence) {
        this.setData({ categories, catalogMessage: '' })
      }
    }
    catch {
      if (requestSequence === this.contentRequestSequence) {
        this.setData({ catalogMessage: '分类暂时无法更新，内容仍可浏览。' })
      }
    }
  },

  retryCategories() {
    return this.loadCategories()
  },

  reloadContents() {
    this.setData({
      state: 'loading',
      items: [],
      nextCursor: '',
      loadingMore: false,
      message: '',
    })
    return this.loadFiltersAndContents()
  },

  updateQuery(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    this.setData({ queryInput: event.detail.value })
  },

  search() {
    this.setData({ query: this.data.queryInput.trim() })
    void this.reloadContents()
  },

  chooseCategory(event: WechatMiniprogram.TouchEvent) {
    this.setData({ categoryId: String(event.currentTarget.dataset.id || '') })
    void this.reloadContents()
  },

  chooseType(event: WechatMiniprogram.TouchEvent) {
    this.setData({ contentType: String(event.currentTarget.dataset.type || '') as KnowledgeContentType | '' })
    void this.reloadContents()
  },

  chooseAccess(event: WechatMiniprogram.TouchEvent) {
    const accessType = String(event.currentTarget.dataset.accessType || '') as KnowledgeAccessFilter
    if (!accessOptions.some(item => item.value === accessType) || accessType === this.data.accessType) {
      return
    }
    this.setData({ accessType })
    void this.reloadContents()
  },

  async loadMore() {
    if (!this.data.nextCursor || this.data.loadingMore) {
      return
    }
    const requestSequence = this.contentRequestSequence
    this.setData({ loadingMore: true, message: '' })
    try {
      const page = await mipKnowledgeModule.listContents({
        categoryId: this.data.categoryId || undefined,
        contentType: this.data.contentType,
        accessType: this.data.accessType,
        query: this.data.query,
        cursor: this.data.nextCursor,
        limit: 20,
      })
      if (requestSequence !== this.contentRequestSequence) {
        return
      }
      this.setData({
        items: this.data.items.concat(page.items.map(contentView)),
        nextCursor: page.nextCursor || '',
      })
    }
    catch (error) {
      if (requestSequence !== this.contentRequestSequence) {
        return
      }
      this.setData({ message: error instanceof Error ? error.message : '更多内容加载失败' })
    }
    finally {
      if (requestSequence === this.contentRequestSequence) {
        this.setData({ loadingMore: false })
      }
    }
  },

  openContent(event: WechatMiniprogram.TouchEvent) {
    const contentId = String(event.currentTarget.dataset.id || '')
    if (contentId) {
      void wx.navigateTo({ url: `/packages/member/mip-knowledge/detail/index?contentId=${contentId}` })
    }
  },
})
