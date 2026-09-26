import type { OpportunitySummary } from '../../../../modules/mip-opportunities'
import { opportunityModule, opportunityStatusLabel } from '../../../../modules/mip-opportunities'
import { caseNavigateTo } from '../../../../platform/navigation/client'

type OpportunityTab = 'PUBLISHED' | 'COOPERATING'
type SectionState = 'loading' | 'ready' | 'error'

interface PublishedView extends OpportunitySummary {
  statusLabel: string
  /** journey-review J6-03：已下架机会卡片置灰（招募中列表也不再展示）。 */
  dimmed: boolean
}

function presentPublished(item: OpportunitySummary): PublishedView {
  const label = opportunityStatusLabel(item)
  return {
    ...item,
    statusLabel: label,
    dimmed: label === '已下架',
  }
}

Page({
  data: {
    state: 'loading' as SectionState,
    tab: 'PUBLISHED' as OpportunityTab,
    publishedState: 'loading' as SectionState,
    publishedItems: [] as PublishedView[],
    publishedNextCursor: '',
    cooperatingState: 'loading' as SectionState,
    cooperatingItems: [] as PublishedView[],
    cooperatingNextCursor: '',
    loadingMore: false,
    removingId: '',
    message: '',
  },
  publishedRequestSeq: 0,
  cooperatingRequestSeq: 0,

  onLoad(query: { tab?: string }) {
    if (query.tab === 'COOPERATING') {
      this.setData({ tab: 'COOPERATING' })
    }
  },

  onShow() {
    void Promise.allSettled([
      this.loadPublished(true),
      this.loadCooperating(true),
    ])
  },

  onHide() {
    this.publishedRequestSeq += 1
    this.cooperatingRequestSeq += 1
  },

  onUnload() {
    this.publishedRequestSeq += 1
    this.cooperatingRequestSeq += 1
  },

  changeTab(event: WechatMiniprogram.TouchEvent) {
    const tab = String(event.currentTarget.dataset.tab || '') as OpportunityTab
    if (['PUBLISHED', 'COOPERATING'].includes(tab)) {
      this.setData({
        tab,
        state: tab === 'PUBLISHED' ? this.data.publishedState : this.data.cooperatingState,
        message: '',
      })
    }
  },

  async loadPublished(reset = false) {
    if (!reset && (!this.data.publishedNextCursor || this.data.loadingMore)) {
      return
    }
    const sequence = this.publishedRequestSeq + 1
    this.publishedRequestSeq = sequence
    const cursor = reset ? undefined : this.data.publishedNextCursor || undefined
    this.setData(reset
      ? {
          publishedState: 'loading',
          publishedNextCursor: '',
          loadingMore: false,
          message: '',
          ...(this.data.tab === 'PUBLISHED' ? { state: 'loading' as SectionState } : {}),
        }
      : { loadingMore: true, message: '' })
    try {
      const page = await opportunityModule.listMine(cursor)
      if (sequence !== this.publishedRequestSeq) {
        return
      }
      this.setData({
        publishedState: 'ready',
        ...(this.data.tab === 'PUBLISHED' ? { state: 'ready' as SectionState } : {}),
        publishedItems: reset
          ? page.items.map(presentPublished)
          : [...this.data.publishedItems, ...page.items.map(presentPublished)],
        publishedNextCursor: page.nextCursor || '',
      })
    }
    catch (error) {
      if (sequence !== this.publishedRequestSeq) {
        return
      }
      this.setData({
        publishedState: this.data.publishedItems.length ? 'ready' : 'error',
        ...(this.data.tab === 'PUBLISHED'
          ? { state: this.data.publishedItems.length ? 'ready' as SectionState : 'error' as SectionState }
          : {}),
        message: error instanceof Error ? error.message : '已发布机会加载失败',
      })
    }
    finally {
      if (sequence === this.publishedRequestSeq) {
        this.setData({ loadingMore: false })
      }
    }
  },

  async loadCooperating(reset = false) {
    if (!reset && (!this.data.cooperatingNextCursor || this.data.loadingMore)) {
      return
    }
    const sequence = this.cooperatingRequestSeq + 1
    this.cooperatingRequestSeq = sequence
    const cursor = reset ? undefined : this.data.cooperatingNextCursor || undefined
    this.setData(reset
      ? {
          cooperatingState: 'loading',
          cooperatingNextCursor: '',
          loadingMore: false,
          message: '',
          ...(this.data.tab === 'COOPERATING' ? { state: 'loading' as SectionState } : {}),
        }
      : { loadingMore: true, message: '' })
    try {
      const page = await opportunityModule.listMyCooperations(cursor)
      if (sequence !== this.cooperatingRequestSeq) {
        return
      }
      this.setData({
        cooperatingState: 'ready',
        ...(this.data.tab === 'COOPERATING' ? { state: 'ready' as SectionState } : {}),
        cooperatingItems: reset
          ? page.items.map(presentPublished)
          : [...this.data.cooperatingItems, ...page.items.map(presentPublished)],
        cooperatingNextCursor: page.nextCursor || '',
      })
    }
    catch (error) {
      if (sequence !== this.cooperatingRequestSeq) {
        return
      }
      this.setData({
        cooperatingState: this.data.cooperatingItems.length ? 'ready' : 'error',
        ...(this.data.tab === 'COOPERATING'
          ? { state: this.data.cooperatingItems.length ? 'ready' as SectionState : 'error' as SectionState }
          : {}),
        message: error instanceof Error ? error.message : '合作意向加载失败',
      })
    }
    finally {
      if (sequence === this.cooperatingRequestSeq) {
        this.setData({ loadingMore: false })
      }
    }
  },

  retry() {
    if (this.data.tab === 'PUBLISHED') {
      void this.loadPublished(true)
    }
    else {
      void this.loadCooperating(true)
    }
  },

  onReachBottom() {
    if (this.data.tab === 'PUBLISHED') {
      void this.loadPublished(false)
    }
    else {
      void this.loadCooperating(false)
    }
  },

  create() {
    caseNavigateTo({ url: '/packages/member/mip-opportunities/editor/index' })
  },

  /** journey-review J6-03（C5 拍板）：长按卡片删除 + 微信原生确认弹窗 + 系统 toast。 */
  confirmDeletePublished(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id || '')
    const item = this.data.publishedItems.find(entry => entry.id === id)
    if (!item || this.data.removingId) {
      return
    }
    wx.showModal({
      title: '删除提示',
      content: '删除后将无法恢复，是否删除？',
      confirmText: '删除',
      confirmColor: '#FF4D5E',
      success: (result) => {
        if (result.confirm) {
          void this.deletePublished(item)
        }
      },
    })
  },

  async deletePublished(item: PublishedView) {
    if (this.data.removingId) {
      return
    }
    this.setData({ removingId: item.id, message: '' })
    try {
      // 列表 DTO 不带 version，先取详情拿并发版本再归档。
      const detail = await opportunityModule.get(item.id)
      await opportunityModule.remove(item.id, detail.version)
      this.setData({
        publishedItems: this.data.publishedItems.filter(entry => entry.id !== item.id),
      })
      wx.showToast({ title: '已删除', icon: 'success', duration: 1800 })
    }
    catch (error) {
      wx.showToast({ title: error instanceof Error ? error.message : '删除失败，请稍后重试', icon: 'none' })
    }
    finally {
      this.setData({ removingId: '' })
    }
  },

  openPublished(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id || '')
    if (id) {
      caseNavigateTo({ url: `/packages/member/mip-opportunities/detail/index?id=${encodeURIComponent(id)}` })
    }
  },

  editPublished(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id || '')
    const item = this.data.publishedItems.find(entry => entry.id === id)
    if (item && ['DRAFT', 'PUBLISHED'].includes(item.status)) {
      caseNavigateTo({ url: `/packages/member/mip-opportunities/editor/index?id=${encodeURIComponent(id)}` })
    }
  },

  openAllReceived() {
    caseNavigateTo({ url: '/packages/member/mip-received/index' })
  },
})
