import type { AdminAuditItem } from '../../../modules/mip-admin'
import type { AdminPageState } from '../shared/page-state'
import { mipAdminModule } from '../../../modules/mip-admin'
import { adminLoadFailure } from '../shared/page-state'

const roleLabels: Record<string, string> = {
  PLATFORM_OWNER: '平台超级管理员',
  PLATFORM_OPERATIONS: '平台运营',
  PLATFORM_FINANCE: '平台财务',
  BRANCH_ADMIN: '城市管理员',
  EVENT_OWNER: '活动负责人',
  EVENT_MANAGER: '活动管理员',
  EVENT_STAFF: '现场人员',
}

const actionLabels: Record<string, string> = {
  'admin.session.enter': '进入运营管理',
  'admin.roles.view': '查看角色列表',
  'admin.roles.grant': '设置角色',
  'admin.roles.revoke': '撤销角色',
}

type AuditView = AdminAuditItem & {
  actionLabel: string
  roleLabel: string
  scopeLabel: string
  metadataText: string
}

function auditView(item: AdminAuditItem): AuditView {
  return {
    ...item,
    actionLabel: actionLabels[item.action] || item.action,
    roleLabel: item.effectiveRole ? roleLabels[item.effectiveRole] || item.effectiveRole : '系统',
    scopeLabel: item.scopeType === 'PLATFORM' ? '平台' : item.scopeType === 'BRANCH' ? '城市分会' : '活动',
    metadataText: JSON.stringify(item.metadata),
  }
}

Page({
  data: {
    state: 'loading' as AdminPageState,
    items: [] as AuditView[],
    action: '',
    resourceType: '',
    message: '',
    nextCursor: null as string | null,
    loadingMore: false,
  },
  onShow() { void this.loadAudit() },
  updateAction(event: WechatMiniprogram.CustomEvent<{ value: string }>) { this.setData({ action: event.detail.value }) },
  updateResource(event: WechatMiniprogram.CustomEvent<{ value: string }>) { this.setData({ resourceType: event.detail.value }) },
  search() { void this.loadAudit(true) },
  async loadAudit(force = false) {
    const hasContent = this.data.items.length > 0
    if (!hasContent) {
      this.setData({ state: 'loading', message: '' })
    }
    try {
      const response = await mipAdminModule.governance.listAudit({
        filters: { action: this.data.action.trim(), resourceType: this.data.resourceType.trim() },
      }, force)
      this.setData({
        state: 'ready',
        items: response.items.map(auditView),
        nextCursor: response.nextCursor || null,
        loadingMore: false,
        message: '',
      })
    }
    catch (error) {
      this.setData(adminLoadFailure(error, { hasContent, fallbackMessage: '审计记录加载失败' }))
    }
  },
  async loadMoreAudit() {
    if (!this.data.nextCursor || this.data.loadingMore || this.data.state !== 'ready') {
      return
    }
    this.setData({ loadingMore: true, message: '' })
    try {
      const response = await mipAdminModule.governance.listAudit({
        cursor: this.data.nextCursor,
        filters: { action: this.data.action.trim(), resourceType: this.data.resourceType.trim() },
      })
      this.setData({
        items: this.data.items.concat(response.items.map(auditView)),
        nextCursor: response.nextCursor || null,
      })
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '更多审计记录加载失败' })
    }
    finally {
      this.setData({ loadingMore: false })
    }
  },
  onReachBottom() { void this.loadMoreAudit() },
  async onPullDownRefresh() {
    try {
      await this.loadAudit(true)
    }
    finally {
      wx.stopPullDownRefresh()
    }
  },
})
