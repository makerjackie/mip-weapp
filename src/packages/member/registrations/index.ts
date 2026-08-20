import type { RegistrationHistoryItem } from '../../../modules/membership/types'
import { membershipModule } from '../../../modules/membership/client'
import { caseNavigateTo } from '../../../modules/platform/case-navigation'
import { formatLocalDateTime } from '../../../utils/date'

interface DisplayRegistration extends RegistrationHistoryItem {
  startsText: string
  statusText: string
  reasonText: string
}

function statusText(item: RegistrationHistoryItem) {
  if (item.registrationState === 'PENDING_REVIEW') {
    return '待审核'
  }
  if (item.registrationState === 'WAITLISTED') {
    return '候补中'
  }
  if (item.registrationState === 'REJECTED') {
    return '未通过'
  }
  if (item.registrationState === 'CANCELLATION_PENDING') {
    return '退款处理中'
  }
  if (item.eventState === 'COMPLETED' && item.registrationState === 'ATTENDED') {
    return '已完成'
  }
  if (item.registrationState === 'ATTENDED') {
    return '已签到'
  }
  if (item.registrationState === 'REGISTERED') {
    if (item.eventState === 'COMPLETED') {
      return '已结束'
    }
    return '已报名'
  }
  if (item.cancelledByType === 'EVENT' || item.eventState === 'CANCELLED') {
    return '主办方已取消'
  }
  if (item.cancelledByType === 'MEMBER') {
    return '你已取消'
  }
  return '已取消'
}

function reasonText(item: RegistrationHistoryItem) {
  if (item.registrationState === 'PENDING_REVIEW') {
    return '主办方审核后会更新结果'
  }
  if (item.registrationState === 'WAITLISTED') {
    return '有空余名额后会按候补顺序补位'
  }
  if (item.registrationState === 'REJECTED') {
    return item.cancellationReason ? `原因：${item.cancellationReason}` : ''
  }
  if (item.registrationState === 'CANCELLATION_PENDING') {
    return item.cancellationReason
      ? `退款提交中 · ${item.cancellationReason}`
      : '退款已提交，到账后会自动更新'
  }
  if (item.registrationState !== 'CANCELLED' && item.eventState !== 'CANCELLED') {
    return ''
  }
  const reason = item.cancellationReason ? `原因：${item.cancellationReason}` : ''
  const when = item.cancelledAt ? formatLocalDateTime(item.cancelledAt) : ''
  if (reason && when) {
    return `${reason} · ${when}`
  }
  return reason || when
}

function displayRegistrations(items: RegistrationHistoryItem[]): DisplayRegistration[] {
  return items.map(item => ({
    ...item,
    startsText: item.startsAt ? formatLocalDateTime(item.startsAt) : '',
    statusText: statusText(item),
    reasonText: reasonText(item),
  }))
}

Page({
  data: {
    state: 'loading' as 'loading' | 'ready' | 'error',
    items: [] as DisplayRegistration[],
    cancellingId: '',
    message: '',
  },
  requestSeq: 0,

  onShow() {
    void this.loadItems()
  },
  async loadItems(force = false) {
    const cached = membershipModule.peekRegistrations()
    if (cached) {
      this.setData({ state: 'ready', items: displayRegistrations(cached), message: '' })
    }
    else if (this.data.state !== 'ready') {
      this.setData({ state: 'loading', message: '' })
    }
    const seq = this.requestSeq + 1
    this.requestSeq = seq
    try {
      const items = await membershipModule.listRegistrations({ force })
      if (seq !== this.requestSeq) {
        return
      }
      this.setData({
        state: 'ready',
        items: displayRegistrations(items),
      })
    }
    catch (error) {
      if (seq !== this.requestSeq) {
        return
      }
      this.setData(cached || this.data.state === 'ready'
        ? { message: '报名记录更新失败，已保留上次结果。' }
        : { state: 'error', message: error instanceof Error ? error.message : '报名记录加载失败' })
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
  openRegistration(event: WechatMiniprogram.TouchEvent) {
    const eventId = String(event.currentTarget.dataset.eventId || '')
    const status = String(event.currentTarget.dataset.status || '')
    if (eventId) {
      const route = ['REGISTERED', 'ATTENDED', 'CANCELLATION_PENDING'].includes(status)
        ? '/packages/member/ticket/index'
        : '/packages/member/event-detail/index'
      caseNavigateTo({ url: `${route}?eventId=${encodeURIComponent(eventId)}` })
    }
  },
})
