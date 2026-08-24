import type { EventId } from '../../../../modules/mip'
import type { RegistrationStatus, RegistrationSummary } from '../../../../modules/mip-events'
import { mipEventsModule } from '../../../../modules/mip-events/client'
import { caseNavigateTo } from '../../../../modules/platform/case-navigation'

interface RegistrationView extends RegistrationSummary {
  statusText: string
  startsText: string
}

const statusLabels: Record<RegistrationStatus, string> = {
  PENDING_REVIEW: '待审核',
  WAITLISTED: '候补中',
  PAYMENT_PENDING: '待支付',
  REGISTERED: '已报名',
  CANCELLATION_PENDING: '退款处理中',
  CANCELLED: '已取消',
  REJECTED: '未通过',
  ATTENDED: '已签到',
}

function present(item: RegistrationSummary): RegistrationView {
  const startsAt = new Date(item.event.startsAt)
  return {
    ...item,
    statusText: statusLabels[item.status],
    startsText: Number.isFinite(startsAt.getTime())
      ? `${startsAt.getMonth() + 1}月${startsAt.getDate()}日 ${String(startsAt.getHours()).padStart(2, '0')}:${String(startsAt.getMinutes()).padStart(2, '0')}`
      : '',
  }
}

Page({
  data: {
    state: 'loading' as 'loading' | 'ready' | 'error',
    registrations: [] as RegistrationView[],
    nextCursor: '',
    loadingMore: false,
    message: '',
  },

  onShow() {
    void this.loadRegistrations()
  },

  async loadRegistrations() {
    if (!this.data.registrations.length) {
      this.setData({ state: 'loading', message: '' })
    }
    try {
      const result = await mipEventsModule.listMyRegistrations()
      this.setData({
        state: 'ready',
        registrations: result.items.map(present),
        nextCursor: result.nextCursor || '',
        message: '',
      })
    }
    catch (error) {
      this.setData(this.data.registrations.length
        ? { message: '活动状态更新失败，已保留上次结果。' }
        : { state: 'error', message: error instanceof Error ? error.message : '活动加载失败' })
    }
  },

  async loadMore() {
    if (!this.data.nextCursor || this.data.loadingMore) {
      return
    }
    this.setData({ loadingMore: true })
    try {
      const result = await mipEventsModule.listMyRegistrations(this.data.nextCursor)
      this.setData({
        registrations: [...this.data.registrations, ...result.items.map(present)],
        nextCursor: result.nextCursor || '',
      })
    }
    catch {
      this.setData({ message: '暂时无法加载更多活动。' })
    }
    finally {
      this.setData({ loadingMore: false })
    }
  },

  openRegistration(event: WechatMiniprogram.TouchEvent) {
    const eventId = String(event.currentTarget.dataset.eventId || '') as EventId
    const status = String(event.currentTarget.dataset.status || '') as RegistrationStatus
    const path = status === 'ATTENDED'
      ? `/packages/member/mip-events/interaction/index?eventId=${encodeURIComponent(eventId)}`
      : `/packages/member/mip-events/detail/index?eventId=${encodeURIComponent(eventId)}`
    caseNavigateTo({ url: path })
  },

  editRegistration(event: WechatMiniprogram.TouchEvent) {
    const eventId = String(event.currentTarget.dataset.eventId || '') as EventId
    if (!eventId) {
      return
    }
    caseNavigateTo({
      url: `/packages/member/mip-events/registration/index?eventId=${encodeURIComponent(eventId)}`,
    })
  },

  openOrder(event: WechatMiniprogram.TouchEvent) {
    const orderId = String(event.currentTarget.dataset.orderId || '')
    if (!orderId) {
      return
    }
    caseNavigateTo({
      url: `/packages/member/order-detail/index?orderId=${encodeURIComponent(orderId)}`,
    })
  },
})
