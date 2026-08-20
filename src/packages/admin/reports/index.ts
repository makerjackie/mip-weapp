import type { AdminMemberReport, MemberReportStatus } from '../../../modules/admin/types'
import { adminModule } from '../../../modules/admin/client'
import { formatLocalMonthDayTime } from '../../../utils/date'
import { adminLoadFailure } from '../shared/page-state'

interface ReportView extends AdminMemberReport {
  categoryText: string
  createdText: string
}

const categoryLabels: Record<AdminMemberReport['category'], string> = {
  HARASSMENT: '骚扰或攻击',
  SPAM: '广告刷屏',
  FRAUD: '诈骗风险',
  INAPPROPRIATE: '不适宜内容',
  PRIVACY: '泄露隐私',
  OTHER: '其他',
}

Page({
  data: {
    state: 'loading' as 'loading' | 'ready' | 'error' | 'forbidden',
    status: 'PENDING' as MemberReportStatus,
    items: [] as ReportView[],
    processingId: '',
    message: '',
  },

  onLoad() {
    void this.loadItems()
  },

  changeStatus(event: WechatMiniprogram.CustomEvent<{ value: MemberReportStatus }>) {
    this.setData({ status: event.detail.value })
    void this.loadItems()
  },

  async loadItems(force = false) {
    const cached = adminModule.peekMemberReports(this.data.status)
    if (cached) {
      this.applyItems(cached)
    }
    else if (this.data.state !== 'ready') {
      this.setData({ state: 'loading', message: '' })
    }
    try {
      this.applyItems(await adminModule.listMemberReports(this.data.status, { force }))
    }
    catch (error) {
      this.setData(adminLoadFailure(error, {
        hasContent: Boolean(cached) || this.data.items.length > 0,
        fallbackMessage: '举报列表加载失败',
      }))
    }
  },

  applyItems(items: AdminMemberReport[]) {
    this.setData({
      state: 'ready',
      items: items.map(item => ({
        ...item,
        categoryText: categoryLabels[item.category],
        createdText: item.createdAt ? formatLocalMonthDayTime(item.createdAt) : '',
      })),
      message: '',
    })
  },

  async decide(event: WechatMiniprogram.TouchEvent) {
    const item = this.data.items[Number(event.currentTarget.dataset.index)]
    const decision = String(event.currentTarget.dataset.decision || '') as 'DISMISS' | 'HIDE_PROFILE'
    if (!item || this.data.processingId) {
      return
    }
    const modal = await wx.showModal({
      title: decision === 'DISMISS' ? '不作处理' : '暂停公开资料',
      content: decision === 'DISMISS'
        ? '请填写判断理由，记录会保留。'
        : '成员资料会立即从公开推荐中隐藏，请填写处理理由。',
      editable: true,
      placeholderText: '必填，最多 200 字',
      confirmText: decision === 'DISMISS' ? '确认' : '暂停展示',
      confirmColor: decision === 'DISMISS' ? '#235B43' : '#B8453E',
    }).catch(() => null)
    if (!modal?.confirm) {
      return
    }
    this.setData({ processingId: item.id, message: '' })
    try {
      await adminModule.resolveMemberReport(
        item.id,
        decision,
        modal.content || '',
        item.version,
      )
      await this.loadItems(true)
      wx.showToast({ title: '已完成处理', icon: 'success' })
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '处理失败' })
    }
    finally {
      this.setData({ processingId: '' })
    }
  },

  async onPullDownRefresh() {
    try {
      await this.loadItems(true)
    }
    finally {
      wx.stopPullDownRefresh()
    }
  },
})
