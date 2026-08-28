import type { EventId, OrderId } from '../../../../modules/mip'
import type { MipEventDetail } from '../../../../modules/mip-events'
import { mipOperationsConfig } from '../../../../config/mip-operations'
import { eventInvitationPath, eventRichTextNodes, MipEventsError, publicEventTypeLabel, safeHttpsEventUrl } from '../../../../modules/mip-events'
import { mipCheckInResumeStore, mipEventsModule } from '../../../../modules/mip-events/client'
import { mipMessagingModule } from '../../../../modules/mip-messaging/client'
import { caseNavigateTo } from '../../../../modules/platform/case-navigation'
import { openWechatChannelsDestination } from '../../../../platform/wechat/channels'

const POSTER_WIDTH = 375
const POSTER_HEIGHT = 560

interface Canvas2dNode {
  width: number
  height: number
  createImage: () => WechatMiniprogram.Image
  getContext: (type: '2d') => WechatMiniprogram.CanvasRenderingContext.CanvasRenderingContext2D
  requestAnimationFrame?: (callback: () => void) => number
}

function wrappedLines(context: WechatMiniprogram.CanvasRenderingContext.CanvasRenderingContext2D, value: string, maxWidth: number, maxLines: number) {
  const lines: string[] = []
  let current = ''
  for (const character of value) {
    const candidate = current + character
    if (current && context.measureText(candidate).width > maxWidth) {
      lines.push(current)
      current = character
      if (lines.length === maxLines - 1) {
        break
      }
    }
    else {
      current = candidate
    }
  }
  if (current && lines.length < maxLines) {
    lines.push(current)
  }
  return lines
}

function loadCanvasImage(canvas: Canvas2dNode, source: string) {
  return new Promise<WechatMiniprogram.Image>((resolve, reject) => {
    const image = canvas.createImage()
    image.onload = () => resolve(image)
    image.onerror = reject
    image.src = source
  })
}

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
    descriptionNodes: [] as ReturnType<typeof eventRichTextNodes>,
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
    shareOpen: false,
    posterBusy: false,
    posterPath: '',
    hasCheckInIntent: false,
    onlineMode: false,
    onlineUrl: '',
    hasCoordinates: false,
    videoRecapBusyId: '',
    contentSection: 'INTRO' as 'INTRO' | 'ORGANIZER' | 'NOTICE',
  },
  requestSeq: 0,
  onlineRequested: false,
  entryScene: '',

  onLoad(query: Record<string, string>) {
    this.onlineRequested = query.online === '1'
    const scene = String(query.scene || '').trim()
    this.entryScene = scene
    if (scene) {
      if (scene.startsWith('i1.')) {
        void this.loadInvitationScene(scene)
      }
      else {
        void this.loadCheckInScene(scene)
      }
      return
    }
    const eventId = String(query.eventId || '') as EventId
    const hasCheckInIntent = Boolean(mipCheckInResumeStore.peek(String(eventId)))
    this.setData({
      eventId,
      incomingInvitationToken: query.invitationToken ? decodeURIComponent(query.invitationToken) : '',
      hasCheckInIntent,
    })
    const cached = mipEventsModule.peekEvent(eventId)
    if (cached) {
      this.applyEvent(cached)
    }
    void this.loadEvent()
  },

  onShow() {
    this.refreshCheckInIntent()
    if (this.data.state === 'ready' && this.data.eventId) {
      void this.loadEvent({ force: true })
    }
  },

  async loadCheckInScene(scene: string) {
    this.setData({ state: 'loading', message: '' })
    try {
      const resolved = await mipEventsModule.resolveCheckInScene(scene)
      const intent = mipCheckInResumeStore.save(resolved)
      this.entryScene = ''
      this.setData({
        eventId: resolved.eventId,
        hasCheckInIntent: Boolean(intent),
      })
      await this.loadEvent({ force: true })
    }
    catch {
      this.setData({
        state: 'error',
        message: '未识别到有效活动码，请打开微信扫一扫重新扫码。',
      })
    }
  },

  async loadInvitationScene(scene: string) {
    this.setData({ state: 'loading', message: '' })
    try {
      const resolved = await mipEventsModule.resolveInvitationScene(scene)
      this.setData({
        eventId: resolved.eventId,
        incomingInvitationToken: resolved.invitationToken,
      })
      await this.loadEvent({ force: true })
    }
    catch {
      this.setData({
        state: 'error',
        message: '活动邀请无效或已失效，请通过活动列表重新进入。',
      })
    }
  },

  retryLoad() {
    if (this.entryScene) {
      if (this.entryScene.startsWith('i1.')) {
        void this.loadInvitationScene(this.entryScene)
      }
      else {
        void this.loadCheckInScene(this.entryScene)
      }
      return
    }
    void this.loadEvent({ force: true })
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
    const closedRegistration = ['ATTENDED', 'CANCELLATION_PENDING', 'CANCELLED', 'REJECTED']
      .includes(event.registrationStatus || '')
    const shouldClearCheckInIntent = event.status === 'CANCELLED' || closedRegistration
    if (shouldClearCheckInIntent) {
      mipCheckInResumeStore.clear(String(event.id))
    }
    const hasCheckInIntent = shouldClearCheckInIntent
      ? false
      : Boolean(mipCheckInResumeStore.peek(String(event.id)))
    const action = primaryAction(event, hasCheckInIntent)
    const onlineUrl = safeHttpsEventUrl(event.onlineUrl)
    const normalizedEvent = {
      ...event,
      eventTypeLabel: publicEventTypeLabel(event.eventTypeLabel),
      contentMedia: event.contentMedia || [],
      tags: event.tags || [],
      videoRecaps: event.videoRecaps || [],
      participantPreview: event.participantPreview || [],
      changes: event.changes || [],
    }
    this.setData({
      state: 'ready',
      event: normalizedEvent,
      descriptionNodes: eventRichTextNodes(event.description),
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
      hasCheckInIntent,
      message: this.onlineRequested && !onlineUrl ? '当前暂不能进入线上活动。' : '',
    })
  },

  refreshCheckInIntent() {
    const eventId = String(this.data.eventId || '')
    if (!eventId) {
      return
    }
    const hasCheckInIntent = Boolean(mipCheckInResumeStore.peek(eventId))
    const action = this.data.event
      ? primaryAction(this.data.event, hasCheckInIntent)
      : null
    this.setData({
      hasCheckInIntent,
      ...(action ? { primaryAction: action.key, primaryLabel: action.label } : {}),
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

  openShare() {
    this.setData({ shareOpen: true })
  },

  closeShare() {
    this.setData({ shareOpen: false })
  },

  selectContentSection(event: WechatMiniprogram.TouchEvent) {
    const section = String(event.currentTarget.dataset.section || '')
    if (!['INTRO', 'ORGANIZER', 'NOTICE'].includes(section)) {
      return
    }
    this.setData({ contentSection: section as 'INTRO' | 'ORGANIZER' | 'NOTICE' })
  },

  handleShareVisibility(event: WechatMiniprogram.CustomEvent<{ visible?: boolean }>) {
    if (!event.detail.visible) {
      this.closeShare()
    }
  },

  copyShareText() {
    const event = this.data.event
    if (!event) {
      return
    }
    const lines = [
      event.title,
      this.data.startsText,
      this.data.locationText,
      event.summary,
      '请在微信中打开 MIP 小程序查看活动详情。',
      `小程序路径：${eventInvitationPath(this.data.eventId, this.data.invitationToken)}`,
    ].filter(Boolean)
    wx.setClipboardData({
      data: lines.join('\n'),
      success: () => {
        this.closeShare()
        wx.showToast({ title: '活动信息已复制', icon: 'success' })
      },
    })
  },

  async createInvitationPoster() {
    const event = this.data.event
    if (!event || this.data.posterBusy) {
      return
    }
    this.setData({ posterBusy: true, message: '' })
    try {
      const credential = await mipEventsModule.createInvitationCode(this.data.eventId)
      const posterPath = await this.drawInvitationPoster(credential.codeUrl)
      this.setData({ posterPath })
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '邀请海报生成失败' })
    }
    finally {
      this.setData({ posterBusy: false })
    }
  },

  async drawInvitationPoster(codeUrl: string) {
    const event = this.data.event
    if (!event) {
      throw new Error('活动信息不可用')
    }
    const node = await new Promise<Canvas2dNode>((resolve, reject) => {
      this.createSelectorQuery()
        .select('#mip-event-invitation-poster-canvas')
        .fields({ node: true, size: true })
        .exec((results) => {
          const result = results?.[0] as { node?: Canvas2dNode } | undefined
          if (!result?.node) {
            reject(new Error('邀请海报画布不可用'))
            return
          }
          resolve(result.node)
        })
    })
    const ratio = wx.getWindowInfo().pixelRatio || 1
    node.width = POSTER_WIDTH * ratio
    node.height = POSTER_HEIGHT * ratio
    const context = node.getContext('2d')
    context.scale(ratio, ratio)
    context.fillStyle = '#FFD800'
    context.fillRect(0, 0, POSTER_WIDTH, POSTER_HEIGHT)
    context.fillStyle = '#111111'
    context.font = '700 34px sans-serif'
    context.fillText('MIP', 28, 52)
    context.font = '700 22px sans-serif'
    wrappedLines(context, event.title, POSTER_WIDTH - 56, 2)
      .forEach((line, index) => context.fillText(line, 28, 94 + index * 30))
    context.font = '400 14px sans-serif'
    context.fillText(this.data.startsText, 28, 158)
    context.fillText(this.data.locationText, 28, 182, POSTER_WIDTH - 56)
    context.fillStyle = '#FFFFFF'
    context.fillRect(28, 208, 319, 286)
    const codeImage = await loadCanvasImage(node, codeUrl)
    context.drawImage(codeImage, 78, 228, 219, 219)
    context.fillStyle = '#111111'
    context.font = '600 15px sans-serif'
    context.textAlign = 'center'
    context.fillText('使用微信扫码查看活动详情', POSTER_WIDTH / 2, 474)
    context.textAlign = 'start'
    context.font = '400 12px sans-serif'
    context.fillText('邀请关系将在报名时由服务端确认', 28, 526)
    if (node.requestAnimationFrame) {
      await new Promise<void>(resolve => node.requestAnimationFrame?.(resolve))
    }
    return new Promise<string>((resolve, reject) => {
      wx.canvasToTempFilePath({
        canvas: node,
        fileType: 'png',
        destWidth: POSTER_WIDTH * ratio,
        destHeight: POSTER_HEIGHT * ratio,
        success: result => resolve(result.tempFilePath),
        fail: reject,
      })
    })
  },

  previewInvitationPoster() {
    if (this.data.posterPath) {
      wx.previewImage({ current: this.data.posterPath, urls: [this.data.posterPath] })
    }
  },

  previewContentImage(event: WechatMiniprogram.TouchEvent) {
    const current = String(event.currentTarget.dataset.url || '')
    const urls = (this.data.event?.contentMedia || []).map(item => item.imageUrl).filter(Boolean)
    if (current && urls.includes(current)) {
      wx.previewImage({ current, urls })
    }
  },

  async saveInvitationPoster() {
    if (!this.data.posterPath || this.data.posterBusy) {
      return
    }
    try {
      await wx.saveImageToPhotosAlbum({ filePath: this.data.posterPath })
      wx.showToast({ title: '已保存到相册', icon: 'success' })
    }
    catch {
      this.setData({ message: '保存失败，请检查相册权限后重试。' })
    }
  },

  handlePrimary() {
    if (this.data.primaryAction === 'register') {
      const invitation = this.data.incomingInvitationToken
        ? `&invitationToken=${encodeURIComponent(this.data.incomingInvitationToken)}`
        : ''
      const checkIn = this.data.hasCheckInIntent
        ? '&resumeCheckIn=1'
        : ''
      caseNavigateTo({ url: `/packages/member/mip-events/registration/index?eventId=${encodeURIComponent(this.data.eventId)}${invitation}${checkIn}` })
      return
    }
    if (this.data.primaryAction === 'checkin') {
      void this.openCheckIn()
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

  async openCheckIn() {
    if (mipMessagingModule.subscriptionCapability('CHECKIN_RESULT').available) {
      await mipMessagingModule.requestWechatSubscription('CHECKIN_RESULT').catch(() => undefined)
    }
    if (!mipCheckInResumeStore.peek(String(this.data.eventId))) {
      this.setData({
        hasCheckInIntent: false,
        message: '签到意图已失效，请重新扫描现场活动码。',
      })
      return
    }
    caseNavigateTo({ url: `/packages/member/mip-events/check-in/index?eventId=${encodeURIComponent(this.data.eventId)}&resumeCheckIn=1` })
  },

  openParticipants() {
    caseNavigateTo({ url: `/packages/member/mip-events/participants/index?eventId=${encodeURIComponent(this.data.eventId)}` })
  },

  openComments() {
    caseNavigateTo({ url: `/packages/member/mip-events/comments/index?eventId=${encodeURIComponent(this.data.eventId)}` })
  },

  openInteraction() {
    if (!this.data.event?.canInteract) {
      return
    }
    caseNavigateTo({ url: `/packages/member/mip-events/interaction/index?eventId=${encodeURIComponent(this.data.eventId)}` })
  },

  openAlbum() {
    if (!this.data.event?.albumEnabled) {
      return
    }
    caseNavigateTo({ url: `/packages/member/event-album/index?eventId=${encodeURIComponent(this.data.eventId)}` })
  },

  async openVideoRecap(tapEvent: WechatMiniprogram.TouchEvent) {
    if (this.data.videoRecapBusyId) {
      return
    }
    const recapId = String(tapEvent.currentTarget.dataset.id || '')
    const recap = this.data.event?.videoRecaps.find(item => item.id === recapId)
    if (!recap) {
      this.setData({ message: '视频回顾暂时无法打开，请稍后重试。' })
      return
    }
    this.setData({ videoRecapBusyId: recapId, message: '' })
    try {
      const result = await openWechatChannelsDestination(recap.destination)
      if (result.status === 'unsupported') {
        this.setData({ message: '当前微信版本不支持打开视频号，请升级微信后重试。' })
      }
      else if (result.status === 'cancelled') {
        this.setData({ message: '已取消打开视频回顾。' })
      }
      else if (result.status === 'failed') {
        this.setData({ message: '视频回顾暂时无法打开，请稍后重试。' })
      }
    }
    finally {
      if (this.data.videoRecapBusyId === recapId) {
        this.setData({ videoRecapBusyId: '' })
      }
    }
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

  callSupport() {
    const supportPhone = mipOperationsConfig.supportPhone
    if (!supportPhone) {
      wx.showToast({ title: '联系电话暂未配置', icon: 'none' })
      return
    }
    wx.makePhoneCall({ phoneNumber: supportPhone })
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
    const currentEvent = this.data.event
    const retryRefund = currentEvent?.canRetryRefund === true
    if ((!currentEvent?.canCancel && !retryRefund) || this.data.busy) {
      return
    }
    const registrationVersion = currentEvent.registrationVersion
    if (typeof registrationVersion !== 'number'
      || !Number.isInteger(registrationVersion)
      || registrationVersion < 1) {
      this.setData({ message: '报名状态已变化，正在加载最新状态。' })
      await this.loadEvent({ force: true })
      return
    }
    this.setData({ busy: true, message: '' })
    try {
      const modal = await wx.showModal({
        title: retryRefund ? '继续处理退款' : '取消报名',
        content: retryRefund
          ? '将继续查询或提交现有退款，不会重复创建退款。'
          : currentEvent.accessType === 'PAID' ? '取消后将进入退款流程。' : '确认取消本次报名？',
        confirmText: retryRefund ? '继续处理' : '确认取消',
      })
      if (!modal.confirm) {
        return
      }
      const result = await mipEventsModule.cancelRegistration(
        this.data.eventId,
        registrationVersion,
      )
      mipCheckInResumeStore.clear(String(this.data.eventId))
      this.setData({ hasCheckInIntent: false })
      wx.showToast({
        title: result.refundSubmission === 'SUBMITTED'
          ? '退款已提交'
          : result.refundRequired ? '退款申请已创建' : '报名已取消',
        icon: result.refundSubmission === 'SUBMITTED' || !result.refundRequired ? 'success' : 'none',
      })
      await this.loadEvent({ force: true })
    }
    catch (error) {
      if (error instanceof MipEventsError && error.code === 'CONFLICT') {
        await this.loadEvent({ force: true })
        this.setData({ message: '报名状态已变化，已加载最新状态。' })
      }
      else {
        this.setData({ message: error instanceof Error ? error.message : '暂时无法取消报名' })
      }
    }
    finally {
      this.setData({ busy: false })
    }
  },

  onShareAppMessage() {
    this.closeShare()
    return {
      title: this.data.event?.title || 'MIP 活动',
      path: eventInvitationPath(this.data.eventId, this.data.invitationToken),
    }
  },
})
