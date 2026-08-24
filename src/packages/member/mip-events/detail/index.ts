import type { EventId, OrderId } from '../../../../modules/mip'
import type { RefundId } from '../../../../modules/mip-commerce'
import type { MipEventDetail } from '../../../../modules/mip-events'
import { mipCommerceModule } from '../../../../modules/mip-commerce/client'
import { safeHttpsEventUrl } from '../../../../modules/mip-events'
import { mipEventsModule } from '../../../../modules/mip-events/client'
import { caseNavigateTo } from '../../../../modules/platform/case-navigation'

function formatDateTime(value?: string) {
  if (!value) {
    return ''
  }
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) {
    return ''
  }
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

function accessText(event: MipEventDetail) {
  if (event.accessType === 'MEMBER_INCLUDED') {
    return '玩家活动'
  }
  if (event.accessType === 'PAID') {
    return `¥${(event.priceCents / 100).toFixed(2)}`
  }
  return '免费活动'
}

function primaryAction(event: MipEventDetail, hasCheckInScene = false) {
  if (event.status === 'CANCELLED') {
    return { key: 'disabled', label: '活动已取消' }
  }
  if (event.status === 'ENDED') {
    return { key: 'disabled', label: '活动已结束' }
  }
  if (event.registrationStatus === 'ATTENDED') {
    return { key: 'interact', label: '心动与反馈' }
  }
  if (event.registrationStatus === 'REGISTERED') {
    if (hasCheckInScene) {
      return { key: 'checkin', label: '确认现场签到' }
    }
    return { key: 'registration', label: '查看报名' }
  }
  if (event.registrationStatus === 'PAYMENT_PENDING') {
    return { key: 'order', label: '查看待支付订单' }
  }
  if (event.registrationStatus === 'PENDING_REVIEW') {
    return { key: 'registration', label: '报名审核中' }
  }
  if (event.registrationStatus === 'WAITLISTED') {
    return { key: 'registration', label: '查看候补状态' }
  }
  return event.canRegister
    ? { key: 'register', label: event.accessType === 'PAID' ? '提交付费报名' : '报名活动' }
    : { key: 'disabled', label: '暂不可报名' }
}

Page({
  data: {
    state: 'loading' as 'loading' | 'ready' | 'error',
    eventId: '' as EventId,
    orderId: '' as OrderId | '',
    event: null as MipEventDetail | null,
    startsText: '',
    endsText: '',
    accessText: '',
    locationText: '',
    primaryAction: 'disabled',
    primaryLabel: '',
    busy: false,
    message: '',
    invitationToken: '',
    incomingInvitationToken: '',
    checkInToken: '',
    onlineMode: false,
    onlineUrl: '',
    hasCoordinates: false,
  },
  requestSeq: 0,
  onlineRequested: false,

  onLoad(query: Record<string, string>) {
    this.onlineRequested = query.online === '1'
    const scene = String(query.scene || '').trim()
    if (scene) {
      void this.loadCheckInScene(scene)
      return
    }
    const eventId = String(query.eventId || '') as EventId
    this.setData({
      eventId,
      incomingInvitationToken: query.invitationToken ? decodeURIComponent(query.invitationToken) : '',
    })
    const cached = mipEventsModule.peekEvent(eventId)
    if (cached) {
      this.applyEvent(cached)
    }
    void this.loadEvent()
  },

  async loadCheckInScene(scene: string) {
    this.setData({ state: 'loading', message: '' })
    try {
      const resolved = await mipEventsModule.resolveCheckInScene(scene)
      this.setData({
        eventId: resolved.eventId,
        checkInToken: resolved.scanToken,
      })
      await this.loadEvent({ force: true })
    }
    catch (error) {
      this.setData({ state: 'error', message: error instanceof Error ? error.message : '活动码无效' })
    }
  },

  async loadEvent(options: { force?: boolean } = {}) {
    if (!this.data.event) {
      this.setData({ state: 'loading', message: '' })
    }
    const requestSeq = this.requestSeq + 1
    this.requestSeq = requestSeq
    try {
      const event = await mipEventsModule.getEvent(this.data.eventId, options)
      if (requestSeq === this.requestSeq) {
        this.applyEvent(event)
        void this.loadInvitation()
      }
    }
    catch (error) {
      if (requestSeq !== this.requestSeq) {
        return
      }
      this.setData(this.data.event
        ? { message: '活动更新失败，已保留上次结果。' }
        : { state: 'error', message: error instanceof Error ? error.message : '活动加载失败' })
    }
  },

  applyEvent(event: MipEventDetail) {
    const action = primaryAction(event, Boolean(this.data.checkInToken))
    const onlineUrl = safeHttpsEventUrl(event.onlineUrl)
    this.setData({
      state: 'ready',
      event,
      startsText: formatDateTime(event.startsAt),
      endsText: formatDateTime(event.endsAt),
      accessText: accessText(event),
      locationText: [event.cityName, event.venueName, event.address].filter(Boolean).join(' · ')
        || (event.mode === 'ONLINE' ? '线上活动' : '地点待公布'),
      primaryAction: action.key,
      primaryLabel: action.label,
      onlineMode: this.onlineRequested && Boolean(onlineUrl),
      onlineUrl,
      hasCoordinates: Number.isFinite(event.latitude) && Number.isFinite(event.longitude),
      message: this.onlineRequested && !onlineUrl ? '当前暂不能进入线上活动。' : '',
    })
  },

  async loadInvitation() {
    try {
      const result = await mipEventsModule.createInvitation(this.data.eventId)
      this.setData({ invitationToken: result.token })
    }
    catch {
      this.setData({ invitationToken: '' })
    }
  },

  handlePrimary() {
    if (this.data.primaryAction === 'register') {
      const invitation = this.data.incomingInvitationToken
        ? `&invitationToken=${encodeURIComponent(this.data.incomingInvitationToken)}`
        : ''
      const checkIn = this.data.checkInToken
        ? `&checkInToken=${encodeURIComponent(this.data.checkInToken)}`
        : ''
      caseNavigateTo({ url: `/packages/member/mip-events/registration/index?eventId=${encodeURIComponent(this.data.eventId)}${invitation}${checkIn}` })
      return
    }
    if (this.data.primaryAction === 'checkin') {
      this.openCheckIn()
      return
    }
    if (this.data.primaryAction === 'interact') {
      caseNavigateTo({ url: `/packages/member/mip-events/interaction/index?eventId=${encodeURIComponent(this.data.eventId)}` })
      return
    }
    if (this.data.primaryAction === 'order') {
      void this.openOrder()
      return
    }
    if (this.data.primaryAction === 'registration') {
      caseNavigateTo({ url: '/packages/member/mip-events/mine/index' })
    }
  },

  async openOrder() {
    if (this.data.busy) {
      return
    }
    if (this.data.orderId) {
      caseNavigateTo({
        url: `/packages/member/order-detail/index?orderId=${encodeURIComponent(this.data.orderId)}`,
      })
      return
    }
    let orderId: OrderId | '' = ''
    this.setData({ busy: true, message: '' })
    try {
      let cursor: string | undefined
      do {
        const result = await mipEventsModule.listMyRegistrations(cursor)
        const registration = result.items.find(item => item.event.id === this.data.eventId)
        if (registration) {
          orderId = registration.orderId || ''
          break
        }
        cursor = result.nextCursor
      } while (cursor)
      if (!orderId) {
        this.setData({ message: '暂时无法找到待支付订单，请稍后重试。' })
        return
      }
      this.setData({ orderId })
      caseNavigateTo({
        url: `/packages/member/order-detail/index?orderId=${encodeURIComponent(orderId)}`,
      })
    }
    catch {
      this.setData({ message: '待支付订单暂时无法加载，请稍后重试。' })
    }
    finally {
      this.setData({ busy: false })
    }
  },

  openCheckIn() {
    const token = this.data.checkInToken
      ? `&token=${encodeURIComponent(this.data.checkInToken)}`
      : ''
    caseNavigateTo({ url: `/packages/member/mip-events/check-in/index?eventId=${encodeURIComponent(this.data.eventId)}${token}` })
  },

  openParticipants() {
    caseNavigateTo({ url: `/packages/member/mip-events/participants/index?eventId=${encodeURIComponent(this.data.eventId)}` })
  },

  openAlbum() {
    if (!this.data.event?.albumEnabled) {
      return
    }
    caseNavigateTo({ url: `/packages/member/event-album/index?eventId=${encodeURIComponent(this.data.eventId)}` })
  },

  async addToCalendar() {
    const event = this.data.event
    if (!event) {
      return
    }
    const startTime = Math.floor(new Date(event.startsAt).getTime() / 1000)
    const endTime = Math.floor(new Date(event.endsAt).getTime() / 1000)
    if (!Number.isFinite(startTime) || !Number.isFinite(endTime)) {
      this.setData({ message: '活动时间暂时无法加入日历。' })
      return
    }
    try {
      await wx.addPhoneCalendar({
        title: event.title,
        startTime,
        endTime: String(Math.max(endTime, startTime + 1800)),
        location: [event.venueName, event.address].filter(Boolean).join(' · '),
        description: event.summary,
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

  async openLocation() {
    const event = this.data.event
    if (!event || event.mode === 'ONLINE') {
      return
    }
    if (Number.isFinite(event.latitude) && Number.isFinite(event.longitude)) {
      try {
        await wx.openLocation({
          latitude: event.latitude as number,
          longitude: event.longitude as number,
          name: event.venueName || event.title,
          address: event.address || '',
          scale: 16,
        })
      }
      catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (!message.includes('cancel')) {
          this.setData({ message: '暂时无法打开地图，请稍后重试。' })
        }
      }
      return
    }
    if (event.address) {
      wx.setClipboardData({
        data: event.address,
        success: () => wx.showToast({ title: '地址已复制', icon: 'success' }),
      })
    }
  },

  openOrganizer() {
    const profileRef = this.data.event?.organizer?.profileRef
    if (profileRef) {
      caseNavigateTo({ url: `/packages/member/mip-public-profile/index?profileRef=${encodeURIComponent(profileRef)}` })
    }
  },

  openOnlineEvent() {
    const onlineUrl = safeHttpsEventUrl(this.data.event?.onlineUrl)
    if (!onlineUrl || !this.data.event?.onlineAccessAvailable) {
      this.setData({ message: '当前暂不能进入线上活动。' })
      return
    }
    caseNavigateTo({
      url: `/packages/member/mip-events/detail/index?eventId=${encodeURIComponent(this.data.eventId)}&online=1`,
    })
  },

  handleOnlineError() {
    this.setData({
      onlineMode: false,
      message: '线上活动暂时无法打开，请稍后重试。',
    })
  },

  async cancelRegistration() {
    if (!this.data.event?.canCancel || this.data.busy) {
      return
    }
    this.setData({ busy: true, message: '' })
    try {
      const modal = await wx.showModal({
        title: '取消报名',
        content: this.data.event.accessType === 'PAID' ? '取消后将进入退款流程。' : '确认取消本次报名？',
        confirmText: '确认取消',
      })
      if (!modal.confirm) {
        return
      }
      const result = await mipEventsModule.cancelRegistration(this.data.eventId)
      if (result.refundRequired && result.refundId && result.paymentAvailable) {
        try {
          await mipCommerceModule.submitRefund(result.refundId as RefundId)
          wx.showToast({ title: '退款已提交', icon: 'success' })
        }
        catch {
          wx.showToast({ title: '退款申请已创建', icon: 'none' })
        }
      }
      else {
        wx.showToast({
          title: result.refundRequired ? '退款申请已创建' : '报名已取消',
          icon: result.refundRequired ? 'none' : 'success',
        })
      }
      await this.loadEvent({ force: true })
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '暂时无法取消报名' })
    }
    finally {
      this.setData({ busy: false })
    }
  },

  onShareAppMessage() {
    return {
      title: this.data.event?.title || 'MIP 活动',
      path: `/packages/member/mip-events/detail/index?eventId=${encodeURIComponent(this.data.eventId)}${this.data.invitationToken ? `&invitationToken=${encodeURIComponent(this.data.invitationToken)}` : ''}`,
    }
  },
})
