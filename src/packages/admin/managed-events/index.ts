import type { AdminEvent } from '../../../modules/mip-admin'
import type { AdminPageState } from '../shared/page-state'
import { mipAdminModule } from '../../../modules/mip-admin'
import { adminLoadFailure } from '../shared/page-state'

Page({
  data: {
    state: 'loading' as AdminPageState,
    events: [] as AdminEvent[],
    query: '',
    status: '',
    canCreate: false,
    canManagePolicy: false,
    cancellationHoursBeforeStart: '24',
    policyVersion: 0,
    policySaving: false,
    message: '',
    nextCursor: null as string | null,
    loadingMore: false,
  },
  onShow() { void this.loadEvents() },
  updateQuery(event: WechatMiniprogram.CustomEvent<{ value: string }>) { this.setData({ query: event.detail.value }) },
  changeStatus(event: WechatMiniprogram.TouchEvent) {
    const status = String(event.currentTarget.dataset.value || '')
    this.setData({ status })
    void this.loadEvents(true)
  },
  search() { void this.loadEvents(true) },
  async loadEvents(force = false) {
    const hasContent = this.data.events.length > 0
    if (!hasContent) {
      this.setData({ state: 'loading', message: '' })
    }
    try {
      const [session, response, policy] = await Promise.all([
        mipAdminModule.getSession(force),
        mipAdminModule.listEvents({
          filters: { query: this.data.query.trim(), status: this.data.status },
        }, force),
        mipAdminModule.getEventPolicy(force),
      ])
      const canCreate = session.capabilities.some(item =>
        item.capability === 'events.write' && (item.scopeType === 'PLATFORM' || item.scopeType === 'BRANCH'))
      const canManagePolicy = session.capabilities.some(item =>
        item.capability === 'events.write' && item.scopeType === 'PLATFORM')
      this.setData({
        state: 'ready',
        events: response.items,
        canCreate,
        canManagePolicy,
        cancellationHoursBeforeStart: String(policy.cancellationHoursBeforeStart),
        policyVersion: policy.version,
        nextCursor: response.nextCursor || null,
        loadingMore: false,
        message: '',
      })
    }
    catch (error) {
      this.setData(adminLoadFailure(error, { hasContent, fallbackMessage: '活动列表加载失败' }))
    }
  },
  async loadMoreEvents() {
    if (!this.data.nextCursor || this.data.loadingMore || this.data.state !== 'ready') {
      return
    }
    this.setData({ loadingMore: true, message: '' })
    try {
      const response = await mipAdminModule.listEvents({
        cursor: this.data.nextCursor,
        filters: { query: this.data.query.trim(), status: this.data.status },
      })
      this.setData({ events: this.data.events.concat(response.items), nextCursor: response.nextCursor || null })
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '更多活动加载失败' })
    }
    finally {
      this.setData({ loadingMore: false })
    }
  },
  onReachBottom() { void this.loadMoreEvents() },
  async onPullDownRefresh() {
    try {
      await this.loadEvents(true)
    }
    finally {
      wx.stopPullDownRefresh()
    }
  },
  openEvent(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id || '')
    if (id) {
      void wx.navigateTo({ url: `/packages/admin/event-console/index?eventId=${encodeURIComponent(id)}` })
    }
  },
  createEvent() {
    if (this.data.canCreate) {
      void wx.navigateTo({ url: '/packages/admin/events/index' })
    }
  },
  updateCancellationHours(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    this.setData({ cancellationHoursBeforeStart: event.detail.value })
  },
  async saveEventPolicy() {
    if (!this.data.canManagePolicy || this.data.policySaving) {
      return
    }
    const cancellationHoursBeforeStart = Number(this.data.cancellationHoursBeforeStart)
    if (!Number.isInteger(cancellationHoursBeforeStart)
      || cancellationHoursBeforeStart < 0
      || cancellationHoursBeforeStart > 720) {
      this.setData({ message: '默认取消时间应为 0 至 720 的整数小时。' })
      return
    }
    this.setData({ policySaving: true, message: '' })
    try {
      const policy = await mipAdminModule.mutate(() => mipAdminModule.gateway.saveEventPolicy({
        cancellationHoursBeforeStart,
        version: this.data.policyVersion,
      }))
      this.setData({ policyVersion: policy.version })
      wx.showToast({ title: '取消规则已保存', icon: 'success' })
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '取消规则保存失败' })
    }
    finally {
      this.setData({ policySaving: false })
    }
  },
})
