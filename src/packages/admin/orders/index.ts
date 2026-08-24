import type { AdminOrder } from '../../../modules/mip-admin'
import type { AdminPageState } from '../shared/page-state'
import { hasCapability, hasScopedCapability, mipAdminModule } from '../../../modules/mip-admin'
import { adminLoadFailure } from '../shared/page-state'

type OrderView = AdminOrder & { amountText: string, refundedText: string }

Page({
  data: {
    state: 'loading' as AdminPageState,
    eventId: '',
    orders: [] as OrderView[],
    status: '',
    canRefund: false,
    canExport: false,
    processingId: '',
    exportPending: false,
    message: '',
    nextCursor: null as string | null,
    loadingMore: false,
  },
  onLoad(query: Record<string, string>) { this.setData({ eventId: query.eventId || '' }) },
  onShow() { void this.loadOrders() },
  chooseStatus(event: WechatMiniprogram.TouchEvent) {
    this.setData({ status: String(event.currentTarget.dataset.value || '') })
    void this.loadOrders(true)
  },
  async loadOrders(force = false) {
    const hasContent = this.data.orders.length > 0
    if (!hasContent) {
      this.setData({ state: 'loading', message: '' })
    }
    try {
      const [session, response, event] = await Promise.all([
        mipAdminModule.getSession(force),
        mipAdminModule.listOrders({ filters: { status: this.data.status, eventId: this.data.eventId } }, force),
        this.data.eventId ? mipAdminModule.getEvent(this.data.eventId, force) : Promise.resolve(null),
      ])
      const eventScope = event
        ? { scopeType: 'EVENT' as const, scopeId: event.id, branchId: event.branchId }
        : null
      this.setData({
        state: 'ready',
        orders: response.items.map(item => ({
          ...item,
          amountText: `${item.currency} ${(item.amountCents / 100).toFixed(2)}`,
          refundedText: `${item.currency} ${(item.refundedAmountCents / 100).toFixed(2)}`,
        })),
        canRefund: eventScope
          ? hasScopedCapability(session.capabilities, 'refunds.submit', eventScope)
          : hasCapability(session.capabilities, 'refunds.submit'),
        canExport: eventScope
          ? hasScopedCapability(session.capabilities, 'exports.create', eventScope)
          : hasCapability(session.capabilities, 'exports.create'),
        nextCursor: response.nextCursor || null,
        loadingMore: false,
        message: '',
      })
    }
    catch (error) {
      this.setData(adminLoadFailure(error, { hasContent, fallbackMessage: '订单列表加载失败' }))
    }
  },
  async loadMoreOrders() {
    if (!this.data.nextCursor || this.data.loadingMore || this.data.state !== 'ready') {
      return
    }
    this.setData({ loadingMore: true, message: '' })
    try {
      const response = await mipAdminModule.listOrders({
        cursor: this.data.nextCursor,
        filters: { status: this.data.status, eventId: this.data.eventId },
      })
      const orders = response.items.map(item => ({
        ...item,
        amountText: `${item.currency} ${(item.amountCents / 100).toFixed(2)}`,
        refundedText: `${item.currency} ${(item.refundedAmountCents / 100).toFixed(2)}`,
      }))
      this.setData({ orders: this.data.orders.concat(orders), nextCursor: response.nextCursor || null })
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '更多订单加载失败' })
    }
    finally {
      this.setData({ loadingMore: false })
    }
  },
  onReachBottom() { void this.loadMoreOrders() },
  async submitRefund(event: WechatMiniprogram.TouchEvent) {
    const orderId = String(event.currentTarget.dataset.id || '')
    if (!orderId || !this.data.canRefund || this.data.processingId) {
      return
    }
    this.setData({ processingId: orderId, message: '' })
    try {
      const modal = await wx.showModal({ title: '提交退款', editable: true, placeholderText: '填写退款原因' })
      if (!modal.confirm || !modal.content.trim()) {
        return
      }
      const result = await mipAdminModule.mutate(() => mipAdminModule.gateway.submitRefund({
        orderId,
        reason: modal.content,
        idempotencyKey: `admin-refund-${orderId}-${Date.now()}`,
      }))
      const dispatchStatus = (result.providerDispatch as { status?: string } | undefined)?.status
      const title = dispatchStatus === 'SUCCEEDED'
        ? '退款已完成'
        : dispatchStatus === 'FAILED'
          ? '退款处理失败'
          : dispatchStatus === 'PENDING_RETRY'
            ? '退款请求已记录'
            : '退款已提交'
      wx.showToast({
        title,
        icon: dispatchStatus === 'FAILED' ? 'none' : 'success',
      })
      await this.loadOrders(true)
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '退款请求提交失败' })
    }
    finally {
      this.setData({ processingId: '' })
    }
  },
  async retryRefund(event: WechatMiniprogram.TouchEvent) {
    const orderId = String(event.currentTarget.dataset.orderId || '')
    const refundId = String(event.currentTarget.dataset.refundId || '')
    if (!orderId || !refundId || !this.data.canRefund || this.data.processingId) {
      return
    }
    this.setData({ processingId: orderId, message: '' })
    try {
      const result = await mipAdminModule.mutate(() => mipAdminModule.gateway.retryRefund(refundId))
      const status = (result.providerDispatch as { status?: string } | undefined)?.status
      wx.showToast({
        title: status === 'SUCCEEDED'
          ? '退款已完成'
          : status === 'FAILED'
            ? '退款处理失败'
            : status === 'PENDING_RETRY'
              ? '退款仍待处理'
              : '退款处理已更新',
        icon: 'none',
      })
      await this.loadOrders(true)
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '退款重试失败' })
    }
    finally {
      this.setData({ processingId: '' })
    }
  },
  async createExport() {
    if (!this.data.canExport || this.data.exportPending || this.data.processingId) {
      return
    }
    this.setData({ exportPending: true, message: '' })
    try {
      const result = await mipAdminModule.mutate(() => mipAdminModule.exportAndOpen({
        exportType: this.data.eventId ? 'EVENT_ORDERS' : 'ORDERS',
        eventId: this.data.eventId || undefined,
        includesPhone: false,
        filters: { status: this.data.status },
      }))
      wx.showToast({ title: `已导出 ${result.rowCount} 条`, icon: 'success' })
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '导出任务创建失败' })
    }
    finally {
      this.setData({ exportPending: false })
    }
  },
})
