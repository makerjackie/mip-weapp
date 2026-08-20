import type { EventDetail } from '../../../modules/membership/types'
import { membershipModule } from '../../../modules/membership/client'
import {
  eventAvailabilityText,
  eventDescriptionNeedsExpansion,
  eventFeatureTags,
  eventSummaryText,
} from '../../../modules/membership/event-detail-presentation'
import { caseNavigateTo } from '../../../modules/platform/case-navigation'
import {
  activitySubscriptionAvailable,
  requestActivitySubscriptions,
} from '../../../modules/platform/subscription-messages'
import { formatLocalDateTime } from '../../../utils/date'

type EventAction
  = | 'registered'
    | 'attended'
    | 'pending'
    | 'waitlisted'
    | 'closed'
    | 'full'
    | 'phone'
    | 'membership'
    | 'payment'
    | 'register'
    | 'event-cancelled'
    | 'member-cancelled'
    | 'history'

function cancelBanner(event: EventDetail) {
  if (event.eventState === 'CANCELLED' || event.cancelledByType === 'EVENT') {
    const reason = event.cancellationReason ? `原因：${event.cancellationReason}` : '主办方已取消本场活动。'
    const when = event.cancelledAt ? `（${formatLocalDateTime(event.cancelledAt)}）` : ''
    return {
      tone: 'event' as const,
      title: '主办方已取消',
      detail: `${reason}${when}`,
    }
  }
  if (event.registrationState === 'CANCELLED' && event.cancelledByType === 'MEMBER') {
    const when = event.cancelledAt ? `（${formatLocalDateTime(event.cancelledAt)}）` : ''
    return {
      tone: 'member' as const,
      title: '你已取消报名',
      detail: `你可以在活动仍开放时重新报名${when}`,
    }
  }
  return null
}

function eventAction(event: EventDetail): { action: EventAction, label: string } {
  if (event.eventState === 'CANCELLED' || event.cancelledByType === 'EVENT') {
    return {
      action: 'event-cancelled',
      label: event.registrationState ? '查看历史凭证' : '活动已取消',
    }
  }
  if (event.registrationState === 'ATTENDED') {
    return { action: 'attended', label: '已签到 · 查看凭证' }
  }
  if (event.registrationState === 'PENDING_REVIEW') {
    return { action: 'pending', label: '报名资料待审核' }
  }
  if (event.registrationState === 'WAITLISTED') {
    return {
      action: 'waitlisted',
      label: event.waitlistPosition ? `候补第 ${event.waitlistPosition} 位` : '候补中',
    }
  }
  if (event.registered || event.registrationState === 'REGISTERED') {
    return { action: 'registered', label: '已持有活动凭证' }
  }
  if (event.registrationState === 'CANCELLED' && event.cancelledByType === 'MEMBER') {
    if (event.canRegister || event.registrationOpen) {
      return { action: 'member-cancelled', label: '重新报名' }
    }
    return { action: 'history', label: '报名已取消' }
  }
  if (event.registrationState === 'REJECTED') {
    return event.canRegister
      ? { action: 'register', label: '重新提交报名申请' }
      : { action: 'history', label: '报名未通过' }
  }
  if (!event.registrationOpen || !event.canRegister) {
    if (event.capacity !== null && event.registrationCount >= event.capacity) {
      return event.waitlistEnabled
        ? { action: 'register', label: '加入候补' }
        : { action: 'full', label: '名额已满' }
    }
    return { action: 'closed', label: '报名已截止' }
  }
  if (!event.phoneBound) {
    return { action: 'phone', label: '确认报名' }
  }
  if (event.memberFree && !event.membershipActive) {
    return { action: 'membership', label: '开通会员后报名' }
  }
  if (!event.memberFree && event.priceCents > 0) {
    return { action: 'payment', label: `支付 ¥${(event.priceCents / 100).toFixed(2)} 报名` }
  }
  return event.registrationMode === 'APPROVAL'
    ? { action: 'register', label: '提交报名申请' }
    : { action: 'register', label: '确认报名' }
}

Page({
  data: {
    state: 'loading' as 'loading' | 'ready' | 'error',
    event: null as EventDetail | null,
    eventId: '',
    startsText: '',
    eventPeriodText: '',
    deadlineText: '',
    priceText: '',
    summaryText: '',
    locationTitle: '',
    locationDetail: '',
    availabilityText: '',
    featureTags: [] as string[],
    descriptionExpanded: false,
    descriptionExpandable: false,
    action: 'register' as EventAction,
    actionLabel: '确认报名',
    bannerTitle: '',
    bannerDetail: '',
    bannerTone: '' as '' | 'event' | 'member',
    changeViews: [] as Array<{ version: number, summary: string, createdText: string }>,
    busy: false,
    phoneSheetVisible: false,
    phoneBinding: false,
    notificationAvailable: activitySubscriptionAvailable(),
    notificationBusy: false,
    notificationEnabled: false,
    message: '',
  },
  requestSeq: 0,

  onLoad(query: Record<string, string>) {
    const eventId = query.eventId || ''
    const cached = membershipModule.peekEvent(eventId)
    this.setData({ eventId })
    if (cached) {
      this.applyEvent(cached)
    }
    void this.loadEvent()
  },

  async loadEvent() {
    if (this.data.state !== 'ready') {
      this.setData({ state: 'loading', message: '' })
    }
    const seq = this.requestSeq + 1
    this.requestSeq = seq
    try {
      const event = await membershipModule.getEvent(this.data.eventId)
      if (seq !== this.requestSeq) {
        return
      }
      this.applyEvent(event)
    }
    catch (error) {
      if (seq !== this.requestSeq) {
        return
      }
      this.setData(this.data.state === 'ready'
        ? { message: '活动更新失败，已保留上次结果。' }
        : { state: 'error', message: error instanceof Error ? error.message : '活动加载失败' })
    }
  },

  applyEvent(event: EventDetail) {
    const action = eventAction(event)
    const banner = cancelBanner(event)
    const startsText = formatLocalDateTime(event.startsAt)
    const endsText = event.endsAt ? formatLocalDateTime(event.endsAt) : ''
    this.setData({
      state: 'ready',
      event,
      startsText,
      eventPeriodText: endsText ? `${startsText} — ${endsText}` : startsText,
      deadlineText: event.registrationDeadline ? formatLocalDateTime(event.registrationDeadline) : '活动开始前',
      priceText: event.memberFree ? '会员免费' : event.priceCents ? `¥${(event.priceCents / 100).toFixed(2)}` : '免费',
      summaryText: eventSummaryText(event.summary, event.description),
      locationTitle: event.venueName || event.location || (event.eventMode === 'ONLINE' ? '线上参与' : ''),
      locationDetail: event.address || (event.eventMode === 'ONLINE' ? '报名后查看参与方式' : ''),
      availabilityText: eventAvailabilityText(event),
      featureTags: eventFeatureTags(event),
      descriptionExpandable: eventDescriptionNeedsExpansion(event.description),
      descriptionExpanded: false,
      action: action.action,
      actionLabel: action.label,
      bannerTitle: banner?.title || '',
      bannerDetail: banner?.detail || '',
      bannerTone: banner?.tone || '',
      changeViews: event.changes.map(item => ({
        version: item.version,
        summary: item.summary,
        createdText: formatLocalDateTime(item.createdAt),
      })),
      message: '',
    })
  },

  toggleDescription() {
    if (this.data.descriptionExpandable) {
      this.setData({ descriptionExpanded: !this.data.descriptionExpanded })
    }
  },

  openOrganizer() {
    const organizerId = this.data.event?.organizer?.id
    if (organizerId) {
      caseNavigateTo({
        url: `/packages/member/member-detail/index?memberId=${encodeURIComponent(organizerId)}`,
      })
    }
  },

  openParticipants() {
    if (!this.data.event?.registrationCount) {
      return
    }
    caseNavigateTo({
      url: `/packages/member/event-participants/index?eventId=${encodeURIComponent(this.data.eventId)}`,
    })
  },

  async addToCalendar() {
    const event = this.data.event
    if (!event) {
      return
    }
    const startTime = Math.floor(new Date(event.startsAt).getTime() / 1000)
    const endTime = Math.floor(new Date(event.endsAt || event.startsAt).getTime() / 1000)
    if (!Number.isFinite(startTime) || !Number.isFinite(endTime)) {
      this.setData({ message: '活动时间暂时无法加入日历。' })
      return
    }
    try {
      await wx.addPhoneCalendar({
        title: event.title,
        startTime,
        endTime: String(Math.max(endTime, startTime + 1800)),
        location: event.address || event.location,
        description: event.summary || event.description.slice(0, 100),
        alarmOffset: 60 * 60,
      })
      wx.showToast({ title: '已加入系统日历', icon: 'success' })
    }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (!message.includes('cancel')) {
        this.setData({ message: '暂时无法加入日历，请稍后重试。' })
      }
    }
  },

  onShareAppMessage() {
    const event = this.data.event
    return {
      title: event?.title || '同行会活动',
      path: `/packages/member/event-detail/index?eventId=${encodeURIComponent(this.data.eventId)}`,
      imageUrl: event?.coverUrl || undefined,
    }
  },

  onShareTimeline() {
    const event = this.data.event
    return {
      title: event?.title || '同行会活动',
      query: `eventId=${encodeURIComponent(this.data.eventId)}`,
      imageUrl: event?.coverUrl || undefined,
    }
  },

  async handleAction() {
    if (this.data.busy || ['closed', 'full', 'history', 'pending', 'waitlisted'].includes(this.data.action)) {
      return
    }
    if (this.data.action === 'event-cancelled') {
      if (this.data.event?.registrationState) {
        caseNavigateTo({ url: `/packages/member/ticket/index?eventId=${encodeURIComponent(this.data.eventId)}` })
      }
      return
    }
    if (this.data.action === 'registered' || this.data.action === 'attended') {
      caseNavigateTo({ url: `/packages/member/ticket/index?eventId=${encodeURIComponent(this.data.eventId)}` })
      return
    }
    if (this.data.action === 'phone') {
      this.setData({ phoneSheetVisible: true, message: '' })
      return
    }
    if (this.data.action === 'membership') {
      caseNavigateTo({ url: '/pages/membership/index' })
      return
    }
    caseNavigateTo({ url: `/packages/member/registration-confirm/index?eventId=${encodeURIComponent(this.data.eventId)}` })
  },

  async enableActivityNotifications() {
    if (this.data.notificationBusy || !this.data.notificationAvailable) {
      return
    }
    this.setData({ notificationBusy: true, message: '' })
    try {
      const results = await requestActivitySubscriptions()
      const saved = await membershipModule.recordNotificationSubscriptions(
        this.data.eventId,
        results,
      )
      this.setData({ notificationEnabled: saved.accepted > 0 })
      wx.showToast({
        title: saved.accepted > 0 ? '已开启活动提醒' : '未开启提醒',
        icon: saved.accepted > 0 ? 'success' : 'none',
      })
    }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.setData({
        message: message.includes('cancel')
          ? '你可以稍后再开启活动提醒。'
          : '活动提醒暂时无法开启，请稍后重试。',
      })
    }
    finally {
      this.setData({ notificationBusy: false })
    }
  },

  closePhoneSheet() {
    if (!this.data.phoneBinding) {
      this.setData({ phoneSheetVisible: false })
    }
  },

  async bindPhone(event: WechatMiniprogram.CustomEvent<{ code?: string, errMsg?: string }>) {
    if (this.data.phoneBinding) {
      return
    }
    const code = event.detail.code
    if (!code) {
      const errMsg = event.detail.errMsg || ''
      this.setData({
        phoneSheetVisible: false,
        message: errMsg.includes('deny') || errMsg.includes('cancel')
          ? '已取消登录，你仍可继续浏览活动。'
          : '手机号授权需在微信真机完成，模拟器无法代替。',
      })
      return
    }
    this.setData({ phoneBinding: true, message: '' })
    try {
      const profile = await membershipModule.bindPhone(code)
      if (!profile.phoneBound) {
        this.setData({ message: '手机号尚未绑定成功，请重试。' })
        return
      }
      const refreshed = await membershipModule.getEvent(this.data.eventId, { force: true })
      this.applyEvent(refreshed)
      this.setData({ phoneSheetVisible: false })
      const next = eventAction(refreshed)
      if (next.action === 'membership') {
        caseNavigateTo({ url: '/pages/membership/index' })
      }
      else if (next.action === 'register' || next.action === 'member-cancelled') {
        caseNavigateTo({ url: `/packages/member/registration-confirm/index?eventId=${encodeURIComponent(this.data.eventId)}` })
      }
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '手机号登录失败，请重试' })
    }
    finally {
      this.setData({ phoneBinding: false })
    }
  },

  openAgreement() {
    caseNavigateTo({ url: '/packages/member/about/index' })
  },

  openPrivacy() {
    caseNavigateTo({ url: '/packages/member/privacy/index' })
  },

  openAlbum() {
    caseNavigateTo({
      url: `/packages/member/event-album/index?eventId=${encodeURIComponent(this.data.eventId)}`,
    })
  },

  copyAddress() {
    const address = this.data.event?.address || this.data.event?.location || ''
    if (!address) {
      return
    }
    wx.setClipboardData({
      data: address,
      success: () => wx.showToast({ title: '地址已复制', icon: 'success' }),
    })
  },

  openMap() {
    const latitude = this.data.event?.latitude
    const longitude = this.data.event?.longitude
    if (latitude === null || latitude === undefined || longitude === null || longitude === undefined) {
      this.copyAddress()
      return
    }
    wx.openLocation({
      latitude,
      longitude,
      name: this.data.event?.venueName || this.data.event?.title || '',
      address: this.data.event?.address || '',
      scale: 16,
    })
  },

  copyOnlineLink() {
    const onlineUrl = this.data.event?.onlineUrl || ''
    if (!onlineUrl) {
      return
    }
    wx.setClipboardData({
      data: onlineUrl,
      success: () => wx.showToast({ title: '线上链接已复制', icon: 'success' }),
    })
  },

  editRegistration() {
    if (!this.data.event?.canEditRegistration) {
      return
    }
    caseNavigateTo({
      url: `/packages/member/registration-confirm/index?eventId=${encodeURIComponent(this.data.eventId)}&mode=edit`,
    })
  },

  async cancelRegistration() {
    if (this.data.busy || !this.data.event?.canCancel) {
      return
    }
    const modal = await wx.showModal({
      title: '取消报名',
      content: this.data.event.activityType === 'PAID'
        ? '取消后将按活动规则发起退款。'
        : '取消后名额可能自动递补给候补成员。',
      confirmText: '确认取消',
      confirmColor: '#C05640',
    })
    if (!modal.confirm) {
      return
    }
    this.setData({ busy: true, message: '' })
    try {
      const result = await membershipModule.cancelRegistration(this.data.eventId, '用户主动取消')
      const refreshed = await membershipModule.getEvent(this.data.eventId, { force: true })
      this.applyEvent(refreshed)
      this.setData({
        message: result.status === 'CANCELLATION_PENDING'
          ? '取消申请已提交，退款状态会自动更新。'
          : '报名已取消。',
      })
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '取消报名失败' })
    }
    finally {
      this.setData({ busy: false })
    }
  },

  openEventOperations() {
    caseNavigateTo({
      url: `/packages/admin/event-registrations/index?eventId=${encodeURIComponent(this.data.eventId)}`,
    })
  },
})
