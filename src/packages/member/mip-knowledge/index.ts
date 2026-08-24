import type {
  KnowledgeCategory,
  KnowledgeContentSummary,
  KnowledgeContentType,
} from '../../../modules/mip-knowledge'
import { mipKnowledgeModule } from '../../../modules/mip-knowledge'

const typeLabels: Record<KnowledgeContentType, string> = {
  HOT_NEWS: '热点',
  ARTICLE: '图文',
  WEB: '网页',
  VIDEO: '视频',
  PRIVATE_CHANNEL: '私密视频号',
  EXPERT_SHARE: '专家分享',
}

type ContentView = KnowledgeContentSummary & { typeLabel: string, accessLabel: string, priceLabel: string }

function contentView(item: KnowledgeContentSummary): ContentView {
  return {
    ...item,
    typeLabel: typeLabels[item.contentType],
    accessLabel: item.accessType === 'FREE' ? '公开' : item.accessType === 'MEMBER' ? '玩家可读' : '玩家或单独购买',
    priceLabel: item.product ? `¥${(item.product.priceCents / 100).toFixed(2)}` : '',
  }
}

Page({
  data: {
    state: 'loading' as 'loading' | 'ready' | 'empty' | 'error',
    categories: [] as KnowledgeCategory[],
    items: [] as ContentView[],
    categoryId: '',
    contentType: '' as KnowledgeContentType | '',
    queryInput: '',
    query: '',
    nextCursor: '',
    loadingMore: false,
    message: '',
    typeOptions: [
      { value: '', label: '全部' },
      ...Object.entries(typeLabels).map(([value, label]) => ({ value, label })),
    ],
  },

  onLoad() {
    void this.loadFiltersAndContents()
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
    if (!this.data.items.length) {
      this.setData({ state: 'loading', message: '' })
    }
    try {
      const [categories, page] = await Promise.all([
        mipKnowledgeModule.listCategories(),
        mipKnowledgeModule.listContents({
          categoryId: this.data.categoryId || undefined,
          contentType: this.data.contentType,
          query: this.data.query,
          limit: 20,
        }),
      ])
      const items = page.items.map(contentView)
      this.setData({
        state: items.length ? 'ready' : 'empty',
        categories,
        items,
        nextCursor: page.nextCursor || '',
        message: '',
      })
    }
    catch (error) {
      this.setData({
        state: this.data.items.length ? 'ready' : 'error',
        message: error instanceof Error ? error.message : '内容加载失败',
      })
    }
  },

  updateQuery(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    this.setData({ queryInput: event.detail.value })
  },

  search() {
    this.setData({ query: this.data.queryInput.trim() })
    void this.loadFiltersAndContents()
  },

  chooseCategory(event: WechatMiniprogram.TouchEvent) {
    this.setData({ categoryId: String(event.currentTarget.dataset.id || '') })
    void this.loadFiltersAndContents()
  },

  chooseType(event: WechatMiniprogram.TouchEvent) {
    this.setData({ contentType: String(event.currentTarget.dataset.type || '') as KnowledgeContentType | '' })
    void this.loadFiltersAndContents()
  },

  async loadMore() {
    if (!this.data.nextCursor || this.data.loadingMore) {
      return
    }
    this.setData({ loadingMore: true, message: '' })
    try {
      const page = await mipKnowledgeModule.listContents({
        categoryId: this.data.categoryId || undefined,
        contentType: this.data.contentType,
        query: this.data.query,
        cursor: this.data.nextCursor,
        limit: 20,
      })
      this.setData({
        items: this.data.items.concat(page.items.map(contentView)),
        nextCursor: page.nextCursor || '',
      })
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '更多内容加载失败' })
    }
    finally {
      this.setData({ loadingMore: false })
    }
  },

  openContent(event: WechatMiniprogram.TouchEvent) {
    const contentId = String(event.currentTarget.dataset.id || '')
    if (contentId) {
      void wx.navigateTo({ url: `/packages/member/mip-knowledge/detail/index?contentId=${contentId}` })
    }
  },
})
