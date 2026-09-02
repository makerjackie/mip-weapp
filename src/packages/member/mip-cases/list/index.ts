import type { SuperCaseSummary } from '../../../../modules/mip-cases'
import { superCaseModule } from '../../../../modules/mip-cases'
import { caseNavigateTo } from '../../../../platform/navigation/client'

interface SuperCaseListItem extends SuperCaseSummary {
  publishedText: string
  statusText: string
  classificationText: string
}

const CASE_STATUS_LABELS = {
  DRAFT: '草稿',
  PUBLISHED: '已发布',
  UNPUBLISHED: '已下架',
  ARCHIVED: '已删除',
} as const

function formatPublishedMonth(value: string) {
  const match = /^(\d{4})-(\d{2})/.exec(value)
  if (!match) {
    return ''
  }
  return `${match[1]}年 ${Number(match[2])}月`
}

function presentCase(item: SuperCaseSummary): SuperCaseListItem {
  return {
    ...item,
    publishedText: formatPublishedMonth(item.publishedAt),
    statusText: CASE_STATUS_LABELS[item.status],
    classificationText: [item.cityLabel, item.industryLabel || item.caseType]
      .filter(Boolean)
      .join(' · '),
  }
}

Page({
  data: {
    mine: false,
    state: 'loading' as 'loading' | 'ready' | 'error',
    items: [] as SuperCaseListItem[],
    nextCursor: '',
    loadingMore: false,
    archivingId: '',
    message: '',
  },
  requestSeq: 0,

  onLoad(options: Record<string, string | undefined>) {
    this.setData({ mine: options.mine === '1' })
  },

  onShow() { void this.load(true) },

  onHide() { this.requestSeq += 1 },
  onUnload() { this.requestSeq += 1 },

  async load(reset = false) {
    const requestSeq = this.requestSeq + 1
    this.requestSeq = requestSeq
    const mine = this.data.mine
    const cursor = reset ? undefined : this.data.nextCursor || undefined
    if (reset) {
      this.setData({ state: 'loading', nextCursor: '', loadingMore: false, message: '' })
    }
    else {
      this.setData({ loadingMore: true })
    }
    try {
      const page = mine
        ? await superCaseModule.listMine(cursor)
        : await superCaseModule.list(cursor)
      if (requestSeq !== this.requestSeq || mine !== this.data.mine) {
        return
      }
      const currentItems = reset ? [] : this.data.items
      const knownIds = new Set(currentItems.map(item => item.id))
      this.setData({
        state: 'ready',
        items: [
          ...currentItems,
          ...page.items.filter(item => !knownIds.has(item.id)).map(presentCase),
        ],
        nextCursor: page.nextCursor || '',
        message: '',
      })
    }
    catch (error) {
      if (requestSeq !== this.requestSeq || mine !== this.data.mine) {
        return
      }
      this.setData({
        state: reset ? 'error' : 'ready',
        message: error instanceof Error ? error.message : '案例加载失败',
      })
    }
    finally {
      if (requestSeq === this.requestSeq && mine === this.data.mine) {
        this.setData({ loadingMore: false })
      }
    }
  },

  onReachBottom() {
    if (this.data.nextCursor && !this.data.loadingMore) {
      void this.load(false)
    }
  },

  selectScope(event: WechatMiniprogram.TouchEvent) {
    const mine = String(event.currentTarget.dataset.mine || '') === '1'
    if (mine === this.data.mine) {
      return
    }
    this.requestSeq += 1
    this.setData({ mine })
    void this.load(true)
  },

  retry() { void this.load(true) },

  retryMore() {
    if (this.data.nextCursor && !this.data.loadingMore) {
      void this.load(false)
    }
  },

  create() { caseNavigateTo({ url: '/packages/member/mip-cases/editor/index' }) },

  async deleteCase(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id || '')
    const item = this.data.items.find(entry => entry.id === id)
    const expectedVersion = Number(item?.version)
    if (!item?.mine || !Number.isInteger(expectedVersion) || this.data.archivingId) {
      return
    }
    const confirmation = await wx.showModal({
      title: '删除案例',
      content: '删除后，这个案例将不再显示，且无法恢复。',
      confirmText: '删除',
      confirmColor: '#B30516',
    })
    if (!confirmation.confirm) {
      return
    }
    this.setData({ archivingId: id, message: '' })
    try {
      await superCaseModule.archive(item.id, expectedVersion)
      await this.load(true)
      wx.showToast({ title: '已删除', icon: 'success' })
    }
    catch (error) {
      const message = error instanceof Error ? error.message : '案例删除失败'
      await this.load(true)
      wx.showToast({ title: message, icon: 'none' })
    }
    finally {
      this.setData({ archivingId: '' })
    }
  },

  open(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id || '')
    if (id) {
      caseNavigateTo({ url: `/packages/member/mip-cases/detail/index?id=${encodeURIComponent(id)}` })
    }
  },
})
