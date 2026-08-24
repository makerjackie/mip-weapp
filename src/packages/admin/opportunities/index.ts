import type { AdminOpportunity } from '../../../modules/mip-admin'
import type { AdminPageState } from '../shared/page-state'
import { hasCapability, mipAdminModule } from '../../../modules/mip-admin'
import { adminLoadFailure } from '../shared/page-state'

Page({
  data: {
    state: 'loading' as AdminPageState,
    opportunities: [] as AdminOpportunity[],
    query: '',
    status: '',
    canArchive: false,
    processingId: '',
    message: '',
    nextCursor: null as string | null,
    loadingMore: false,
  },
  onShow() { void this.loadOpportunities() },
  updateQuery(event: WechatMiniprogram.CustomEvent<{ value: string }>) { this.setData({ query: event.detail.value }) },
  chooseStatus(event: WechatMiniprogram.TouchEvent) {
    this.setData({ status: String(event.currentTarget.dataset.value || '') })
    void this.loadOpportunities(true)
  },
  search() { void this.loadOpportunities(true) },
  async loadOpportunities(force = false) {
    const hasContent = this.data.opportunities.length > 0
    if (!hasContent) {
      this.setData({ state: 'loading', message: '' })
    }
    try {
      const [response, session] = await Promise.all([
        mipAdminModule.listOpportunities({
          filters: { query: this.data.query.trim(), status: this.data.status },
        }, force),
        mipAdminModule.getSession(force),
      ])
      this.setData({
        state: 'ready',
        opportunities: response.items,
        canArchive: hasCapability(session.capabilities, 'opportunities.archive'),
        nextCursor: response.nextCursor || null,
        loadingMore: false,
        message: '',
      })
    }
    catch (error) {
      this.setData(adminLoadFailure(error, { hasContent, fallbackMessage: '机会列表加载失败' }))
    }
  },
  async loadMoreOpportunities() {
    if (!this.data.nextCursor || this.data.loadingMore || this.data.state !== 'ready') {
      return
    }
    this.setData({ loadingMore: true, message: '' })
    try {
      const response = await mipAdminModule.listOpportunities({
        cursor: this.data.nextCursor,
        filters: { query: this.data.query.trim(), status: this.data.status },
      })
      this.setData({ opportunities: this.data.opportunities.concat(response.items), nextCursor: response.nextCursor || null })
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '更多机会加载失败' })
    }
    finally {
      this.setData({ loadingMore: false })
    }
  },
  onReachBottom() { void this.loadMoreOpportunities() },
  async unpublish(event: WechatMiniprogram.TouchEvent) {
    const opportunityId = String(event.currentTarget.dataset.id || '')
    const version = Number(event.currentTarget.dataset.version)
    if (!opportunityId || this.data.processingId) {
      return
    }
    this.setData({ processingId: opportunityId, message: '' })
    try {
      const modal = await wx.showModal({ title: '下架机会', editable: true, placeholderText: '填写下架原因' })
      if (!modal.confirm || !modal.content.trim()) {
        return
      }
      await mipAdminModule.mutate(() => mipAdminModule.gateway.unpublishOpportunity({
        opportunityId,
        expectedVersion: version,
        reason: modal.content,
      }))
      wx.showToast({ title: '机会已下架', icon: 'success' })
      await this.loadOpportunities(true)
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '机会下架失败' })
    }
    finally {
      this.setData({ processingId: '' })
    }
  },
  async archive(event: WechatMiniprogram.TouchEvent) {
    const opportunityId = String(event.currentTarget.dataset.id || '')
    const version = Number(event.currentTarget.dataset.version)
    if (!this.data.canArchive || !opportunityId || this.data.processingId) {
      return
    }
    this.setData({ processingId: opportunityId, message: '' })
    try {
      const modal = await wx.showModal({
        title: '归档机会草稿',
        content: '归档后将从用户端隐藏，且不能直接恢复。',
        editable: true,
        placeholderText: '填写归档原因',
      })
      const reason = String(modal.content || '').trim()
      if (!modal.confirm || !reason) {
        return
      }
      await mipAdminModule.mutate(() => mipAdminModule.gateway.archiveOpportunity({
        opportunityId,
        expectedVersion: version,
        reason,
      }))
      wx.showToast({ title: '草稿已归档', icon: 'success' })
      await this.loadOpportunities(true)
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '机会归档失败' })
    }
    finally {
      this.setData({ processingId: '' })
    }
  },
})
