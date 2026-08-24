import type { AdminPageState } from '../shared/page-state'
import { hasScopedCapability, mipAdminModule } from '../../../modules/mip-admin'
import { adminLoadFailure } from '../shared/page-state'

Page({
  data: {
    state: 'loading' as AdminPageState,
    eventId: '',
    canExport: false,
    canPhone: false,
    processing: '',
    lastTicketId: '',
    expiresAt: '',
    message: '',
  },
  onLoad(query: Record<string, string>) { this.setData({ eventId: query.eventId || '' }) },
  onShow() { void this.loadCapabilities() },
  async loadCapabilities(force = false) {
    try {
      const [session, event] = await Promise.all([
        mipAdminModule.getSession(force),
        mipAdminModule.getEvent(this.data.eventId, force),
      ])
      const scope = { scopeType: 'EVENT' as const, scopeId: this.data.eventId, branchId: event.branchId }
      const canExport = hasScopedCapability(session.capabilities, 'exports.create', scope)
      this.setData({
        state: canExport ? 'ready' : 'forbidden',
        canExport,
        canPhone: hasScopedCapability(session.capabilities, 'users.phone.read', scope),
        message: '',
      })
    }
    catch (error) {
      this.setData(adminLoadFailure(error, { hasContent: false, fallbackMessage: '导出权限加载失败' }))
    }
  },
  async createExport(event: WechatMiniprogram.TouchEvent) {
    const exportType = String(event.currentTarget.dataset.type || '')
    const includesPhone = exportType === 'EVENT_ROSTER' && this.data.canPhone
    if (!['EVENT_ROSTER', 'EVENT_ORDERS'].includes(exportType) || this.data.processing) {
      return
    }
    this.setData({ processing: exportType, message: '' })
    try {
      const result = await mipAdminModule.mutate(() => mipAdminModule.exportAndOpen({
        exportType,
        eventId: this.data.eventId,
        includesPhone,
        filters: {},
      }))
      this.setData({ lastTicketId: result.ticketId, expiresAt: `${result.rowCount} 条记录` })
      wx.showToast({ title: '导出文件已打开', icon: 'success' })
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '导出任务创建失败' })
    }
    finally {
      this.setData({ processing: '' })
    }
  },
})
