import type { AuditItem } from '../../../modules/admin/types'
import type { AdminPageState } from '../shared/page-state'
import { adminModule } from '../../../modules/admin/client'
import { formatLocalDateTime } from '../../../utils/date'
import { adminLoadFailure } from '../shared/page-state'

const actionLabels: Record<string, string> = {
  PROFILE_APPROVED: '通过成员资料',
  PROFILE_REJECTED: '驳回成员资料',
  PROFILE_SUSPENDED: '暂停展示成员',
  EVENT_CREATED: '创建活动草稿',
  EVENT_UPDATED: '更新活动',
  EVENT_PUBLISHED: '发布活动',
  EVENT_CANCELLED: '取消活动',
  REFUND_REQUESTED: '发起退款',
  ACCOUNT_DELETED: '注销账号',
}
const resourceLabels: Record<string, string> = {
  profile: '成员资料',
  event: '活动',
  order: '订单',
}
const roleLabels: Record<string, string> = {
  owner: '主理人',
  manager: '管理员',
  reviewer: '审核员',
  support: '客服',
  member: '成员',
}

interface DisplayAudit extends AuditItem { createdText: string, actionText: string, resourceText: string, roleText: string }

function displayAudit(items: AuditItem[]) {
  return items.map(item => ({
    ...item,
    createdText: formatLocalDateTime(item.createdAt),
    actionText: actionLabels[item.action] || '运营操作',
    resourceText: resourceLabels[item.resourceType] || '记录',
    roleText: roleLabels[item.actorRole] || '运营人员',
  }))
}

Page({
  data: { state: 'loading' as AdminPageState, items: [] as DisplayAudit[], message: '' },
  onShow() {
    void this.loadAudit()
  },
  async loadAudit(force = false) {
    const cached = adminModule.peekAudit()
    if (cached) {
      this.setData({ state: 'ready', items: displayAudit(cached), message: '' })
    }
    else if (this.data.state !== 'ready') {
      this.setData({ state: 'loading', message: '' })
    }
    try {
      const items = await adminModule.listAudit({ force })
      this.setData({
        state: 'ready',
        items: displayAudit(items),
      })
    }
    catch (error) {
      this.setData(adminLoadFailure(error, {
        hasContent: Boolean(cached) || this.data.state === 'ready',
        fallbackMessage: '审计日志加载失败',
      }))
    }
  },
  async onPullDownRefresh() {
    try {
      await this.loadAudit(true)
    }
    finally {
      wx.stopPullDownRefresh()
    }
  },
})
