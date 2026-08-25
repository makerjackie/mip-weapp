import type { AdminPageState } from '../shared/page-state'
import { hasScopedCapability, mipAdminModule } from '../../../modules/mip-admin'
import { adminLoadFailure } from '../shared/page-state'
import {
  emptyPendingExportPresentation,
  pendingExportFailurePresentation,
  pendingExportProgressPresentation,
  pendingExportStatusPresentation,
} from './state'

Page({
  data: {
    state: 'loading' as AdminPageState,
    eventId: '',
    canExport: false,
    canPhone: false,
    processing: '',
    recovering: false,
    lastTicketId: '',
    expiresAt: '',
    message: '',
    ...emptyPendingExportPresentation,
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
        ...(!canExport ? emptyPendingExportPresentation : {}),
      })
      if (canExport) {
        await this.loadPendingExportStatus()
      }
    }
    catch (error) {
      this.setData(adminLoadFailure(error, { hasContent: false, fallbackMessage: '导出权限加载失败' }))
    }
  },
  async loadPendingExportStatus() {
    if (this.data.processing || this.data.recovering) {
      return
    }
    this.setData(pendingExportProgressPresentation('checking'))
    try {
      const pending = await mipAdminModule.getPendingExportStatus()
      this.setData(pendingExportStatusPresentation(pending))
    }
    catch (error) {
      this.setData(pendingExportFailurePresentation(error))
    }
  },
  async resumePendingExport() {
    if (this.data.processing || this.data.recovering) {
      return
    }
    this.setData({
      recovering: true,
      message: '',
      ...pendingExportProgressPresentation('checking'),
    })
    try {
      const result = await mipAdminModule.mutate(() => mipAdminModule.resumePendingExport((progress) => {
        this.setData(pendingExportProgressPresentation(progress))
      }))
      if (!result) {
        this.setData(emptyPendingExportPresentation)
        return
      }
      this.setData({
        ...emptyPendingExportPresentation,
        lastTicketId: result.ticketId,
        expiresAt: `${result.rowCount} 条记录`,
      })
      wx.showToast({ title: '导出文件已打开', icon: 'success' })
    }
    catch (error) {
      this.setData(pendingExportFailurePresentation(error))
    }
    finally {
      this.setData({ recovering: false })
    }
  },
  async discardPendingExport() {
    if (this.data.processing || this.data.recovering) {
      return
    }
    const result = await wx.showModal({
      title: '不再继续导出',
      content: '清除后需要重新创建导出，当前文件将在有效期结束后不可用。',
      confirmText: '确认清除',
      cancelText: '返回',
    })
    if (!result.confirm) {
      return
    }
    mipAdminModule.clearPendingExport()
    this.setData(emptyPendingExportPresentation)
  },
  async createExport(event: WechatMiniprogram.TouchEvent) {
    const exportType = String(event.currentTarget.dataset.type || '')
    const includesPhone = exportType === 'EVENT_ROSTER' && this.data.canPhone
    if (!['EVENT_ROSTER', 'EVENT_ORDERS'].includes(exportType) || this.data.processing) {
      return
    }
    this.setData({ processing: exportType, message: '' })
    let failed = false
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
      failed = true
      this.setData({ message: error instanceof Error ? error.message : '导出任务创建失败' })
    }
    finally {
      this.setData({ processing: '' })
    }
    if (failed) {
      await this.loadPendingExportStatus()
    }
  },
})
