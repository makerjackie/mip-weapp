import type { EventId } from '../../../../modules/mip'
import type {
  MyRegistrationCategory,
  RegistrationStatus,
  RegistrationSummary,
} from '../../../../modules/mip-events'
import { mipCheckInResumeStore, mipEventsModule } from '../../../../modules/mip-events/client'
import { caseNavigateTo } from '../../../../modules/platform/case-navigation'
import { resolveMyRegistrationCategory } from './category'

interface RegistrationView extends RegistrationSummary {
  statusText: string
  startsText: string
  locationText: string
  accessText: string
  participantCountText: string
  card: RegistrationCardView
}

interface RegistrationCardView {
  id: EventId
  status: RegistrationStatus
  title: string
  coverUrl?: string
  startsText: string
  locationText: string
  participantPreview: RegistrationSummary['event']['participantPreview']
  registrationCount: number
  accessLabel: string
  eventTypeLabel: string
  statusLabel: string
}

const statusLabels: Record<RegistrationStatus, string> = {
  PENDING_REVIEW: '待审核',
  WAITLISTED: '候补中',
  PAYMENT_PENDING: '待支付',
  REGISTERED: '已报名',
  CANCELLATION_PENDING: '退款处理中',
  CANCELLED: '已取消',
  REJECTED: '未通过',
  ATTENDED: '已参加',
}

function uniqueText(values: Array<string | undefined>) {
  return [...new Set(values.map(value => value?.trim()).filter(Boolean))].join(' · ')
}

function present(item: RegistrationSummary): RegistrationView {
  const startsAt = new Date(item.event.startsAt)
  const accessText = item.event.accessType === 'MEMBER_INCLUDED'
    ? '仅玩家'
    : item.event.accessType === 'PAID' ? '付费' : '免费'
  return {
    ...item,
    statusText: statusLabels[item.status],
    startsText: Number.isFinite(startsAt.getTime())
      ? `${startsAt.getMonth() + 1}月${startsAt.getDate()}日 ${String(startsAt.getHours()).padStart(2, '0')}:${String(startsAt.getMinutes()).padStart(2, '0')}`
      : '',
    locationText: uniqueText([item.event.cityName, item.event.venueName, item.venueAddress]),
    accessText,
    participantCountText: item.event.registrationCount > 0 ? `${item.event.registrationCount} 人参加` : '',
    card: {
      id: item.event.id,
      status: item.status,
      title: item.event.title,
      coverUrl: item.event.coverUrl,
      startsText: Number.isFinite(startsAt.getTime())
        ? `${startsAt.getMonth() + 1}月${startsAt.getDate()}日 ${String(startsAt.getHours()).padStart(2, '0')}:${String(startsAt.getMinutes()).padStart(2, '0')}`
        : '',
      locationText: uniqueText([item.event.cityName, item.event.venueName, item.venueAddress]),
      participantPreview: item.event.participantPreview,
      registrationCount: item.event.registrationCount,
      accessLabel: accessText,
      eventTypeLabel: item.event.eventTypeLabel,
      statusLabel: statusLabels[item.status],
    },
  }
}

Page({
  data: {
    state: 'loading' as 'loading' | 'ready' | 'error',
    activeCategory: 'UPCOMING' as MyRegistrationCategory,
    counts: { upcoming: 0, attended: 0 },
    registrations: [] as RegistrationView[],
    nextCursor: '',
    loadingMore: false,
    cancelingId: '',
    message: '',
  },
  requestSeq: 0,

  onLoad(query: Record<string, string | undefined>) {
    this.setData({ activeCategory: resolveMyRegistrationCategory(query.category) })
  },

  onShow() {
    void this.loadRegistrations()
  },

  async loadRegistrations() {
    if (!this.data.registrations.length) {
      this.setData({ state: 'loading', message: '' })
    }
    const requestSeq = this.requestSeq + 1
    this.requestSeq = requestSeq
    const category = this.data.activeCategory
    try {
      const result = await mipEventsModule.listMyRegistrations(undefined, category)
      if (requestSeq !== this.requestSeq || category !== this.data.activeCategory) {
        return
      }
      this.setData({
        state: 'ready',
        counts: result.counts || this.data.counts,
        registrations: result.items.map(present),
        nextCursor: result.nextCursor || '',
        message: '',
      })
    }
    catch (error) {
      if (requestSeq !== this.requestSeq) {
        return
      }
      this.setData(this.data.registrations.length
        ? { message: '活动状态更新失败，已保留上次结果。' }
        : { state: 'error', message: error instanceof Error ? error.message : '活动加载失败' })
    }
  },

  changeCategory(event: WechatMiniprogram.TouchEvent) {
    const category = String(event.currentTarget.dataset.category || '') as MyRegistrationCategory
    if (!['UPCOMING', 'ATTENDED'].includes(category) || category === this.data.activeCategory) {
      return
    }
    this.requestSeq += 1
    this.setData({
      activeCategory: category,
      state: 'loading',
      registrations: [],
      nextCursor: '',
      message: '',
    })
    void this.loadRegistrations()
  },

  async loadMore() {
    if (!this.data.nextCursor || this.data.loadingMore) {
      return
    }
    const category = this.data.activeCategory
    this.setData({ loadingMore: true })
    try {
      const result = await mipEventsModule.listMyRegistrations(this.data.nextCursor, category)
      if (category !== this.data.activeCategory) {
        return
      }
      this.setData({
        counts: result.counts || this.data.counts,
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
    const detail = (event as unknown as { detail?: { id?: string, status?: string } }).detail
    const eventId = String(detail?.id || event.currentTarget?.dataset?.eventId || '') as EventId
    const status = String(detail?.status || event.currentTarget?.dataset?.status || '') as RegistrationStatus
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

  async cancelRegistration(event: WechatMiniprogram.TouchEvent) {
    const eventId = String(event.currentTarget.dataset.eventId || '') as EventId
    const registrationId = String(event.currentTarget.dataset.registrationId || '')
    const version = Number(event.currentTarget.dataset.version)
    const retryRefund = event.currentTarget.dataset.refundRetry === true
      || event.currentTarget.dataset.refundRetry === 'true'
    if (!eventId || !registrationId || this.data.cancelingId) {
      return
    }
    if (!Number.isInteger(version) || version < 1) {
      this.setData({ message: '报名状态已变化，正在加载最新状态。' })
      await this.loadRegistrations()
      return
    }
    const confirmation = await wx.showModal({
      title: retryRefund ? '继续处理退款' : '取消报名',
      content: retryRefund ? '将继续查询或提交现有退款，不会重复创建退款。' : '取消资格和退款状态将由服务端核对。',
      confirmText: retryRefund ? '继续处理' : '确认取消',
      confirmColor: '#E65C5C',
    })
    if (!confirmation.confirm) {
      return
    }
    this.setData({ cancelingId: registrationId, message: '' })
    try {
      const result = await mipEventsModule.cancelRegistration(
        eventId,
        version,
      )
      mipCheckInResumeStore.clear(String(eventId))
      wx.showToast({
        title: result.refundSubmission === 'SUBMITTED'
          ? '退款已提交'
          : result.status === 'CANCELLATION_PENDING' ? '退款处理中' : '报名已取消',
        icon: 'none',
      })
      await this.loadRegistrations()
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '暂时无法取消报名。' })
    }
    finally {
      this.setData({ cancelingId: '' })
    }
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
