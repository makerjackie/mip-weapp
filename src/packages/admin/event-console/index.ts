import type { EventId } from '../../../modules/mip'
import type { AdminEventDetail } from '../../../modules/mip-admin'
import type { CheckInCredentialMode } from '../../../modules/mip-events'
import type { AdminPageState } from '../shared/page-state'
import { hasScopedCapability, mipAdminModule } from '../../../modules/mip-admin'
import { checkInCredentialCountdown } from '../../../modules/mip-events'
import { mipEventsModule } from '../../../modules/mip-events/client'
import { adminLoadFailure } from '../shared/page-state'

const POSTER_WIDTH = 375
const POSTER_HEIGHT = 560

interface Canvas2dNode {
  width: number
  height: number
  createImage: () => WechatMiniprogram.Image
  getContext: (type: '2d') => WechatMiniprogram.CanvasRenderingContext.CanvasRenderingContext2D
  requestAnimationFrame?: (callback: () => void) => number
}

function localDateTime(value: string) {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) {
    return ''
  }
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

function wrappedLines(context: WechatMiniprogram.CanvasRenderingContext.CanvasRenderingContext2D, value: string, maxWidth: number, limit: number) {
  const lines: string[] = []
  let current = ''
  for (const character of value) {
    const next = `${current}${character}`
    if (current && context.measureText(next).width > maxWidth) {
      lines.push(current)
      current = character
      if (lines.length === limit - 1) {
        break
      }
    }
    else {
      current = next
    }
  }
  if (current && lines.length < limit) {
    lines.push(current)
  }
  return lines
}

function loadCanvasImage(node: Canvas2dNode, source: string) {
  return new Promise<WechatMiniprogram.Image>((resolve, reject) => {
    const image = node.createImage()
    image.onload = () => resolve(image)
    image.onerror = reject
    image.src = source
  })
}

function reminderRequestKey(eventId: string) {
  return `event-reminder:${eventId}:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`
}

function cloneRequestKey(eventId: string) {
  return `event-clone:${eventId}:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`
}

Page({
  data: {
    state: 'loading' as AdminPageState,
    eventId: '',
    event: null as AdminEventDetail | null,
    canEdit: false,
    canRoster: false,
    canTeam: false,
    canAlbum: false,
    canFeedback: false,
    canOrders: false,
    canExport: false,
    canCheckIn: false,
    canPublishCommunications: false,
    processing: false,
    cloneBusy: false,
    cloneRequestKey: '',
    cloneRequestVersion: 0,
    reminderBusy: false,
    reminderSummary: '',
    reminderRequestKey: '',
    reminderRequestVersion: 0,
    reminderRequestWechat: false,
    posterBusy: false,
    posterPath: '',
    posterMode: '' as CheckInCredentialMode | '',
    posterValidUntil: '',
    posterValidText: '',
    posterCountdownText: '',
    posterExpired: false,
    message: '',
  },
  posterCountdownTimer: 0 as number | ReturnType<typeof setInterval>,
  onLoad(query: Record<string, string>) { this.setData({ eventId: query.eventId || '' }) },
  onShow() {
    if (this.data.posterMode === 'ROTATING' && this.data.posterValidUntil) {
      this.startPosterCountdown(this.data.posterValidUntil)
    }
    if (this.data.eventId) {
      void this.loadEvent()
    }
  },
  onHide() {
    this.clearPosterCountdown()
  },
  onUnload() {
    this.clearPosterCountdown()
  },
  async loadEvent(force = false) {
    const hasContent = Boolean(this.data.event)
    if (!hasContent) {
      this.setData({ state: 'loading', message: '' })
    }
    try {
      const [session, event] = await Promise.all([
        mipAdminModule.getSession(force),
        mipAdminModule.events.get(this.data.eventId, force),
      ])
      const scope = { scopeType: 'EVENT' as const, scopeId: event.id, branchId: event.branchId }
      this.setData({
        state: 'ready',
        event,
        canEdit: hasScopedCapability(session.capabilities, 'events.write', scope),
        canRoster: hasScopedCapability(session.capabilities, 'events.roster.read', scope),
        canTeam: hasScopedCapability(session.capabilities, 'events.team.manage', scope),
        canAlbum: hasScopedCapability(session.capabilities, 'events.album.manage', scope),
        canFeedback: hasScopedCapability(session.capabilities, 'events.feedback.read', scope),
        canOrders: hasScopedCapability(session.capabilities, 'orders.read', scope),
        canExport: hasScopedCapability(session.capabilities, 'exports.create', scope),
        canCheckIn: hasScopedCapability(session.capabilities, 'events.checkin.manage', scope),
        canPublishCommunications: hasScopedCapability(session.capabilities, 'communications.publish', scope),
        message: '',
      })
    }
    catch (error) {
      this.setData(adminLoadFailure(error, { hasContent, fallbackMessage: '活动信息加载失败' }))
    }
  },

  clearPosterCountdown() {
    if (this.posterCountdownTimer) {
      clearInterval(this.posterCountdownTimer)
      this.posterCountdownTimer = 0
    }
  },

  updatePosterCountdown(validUntil: string) {
    const countdown = checkInCredentialCountdown(validUntil)
    this.setData({
      posterCountdownText: countdown.text,
      posterExpired: countdown.expired,
    })
    if (countdown.expired) {
      this.clearPosterCountdown()
    }
    return countdown
  },

  startPosterCountdown(validUntil: string) {
    this.clearPosterCountdown()
    const countdown = this.updatePosterCountdown(validUntil)
    if (!countdown.expired) {
      this.posterCountdownTimer = setInterval(() => this.updatePosterCountdown(validUntil), 1000)
    }
  },

  createStaticCheckInPoster() {
    return this.createCheckInPoster('STATIC')
  },

  createRotatingCheckInPoster() {
    return this.createCheckInPoster('ROTATING')
  },

  async createCheckInPoster(mode: CheckInCredentialMode) {
    const event = this.data.event
    if (!event || !this.data.canCheckIn || this.data.posterBusy || event.status !== 'PUBLISHED') {
      return
    }
    this.setData({ posterBusy: true, message: '' })
    try {
      const credential = await mipEventsModule.createCheckInPoster(event.id as EventId, mode)
      const posterPath = await this.drawCheckInPoster(credential.codeUrl, event, credential.mode)
      const rotating = credential.mode === 'ROTATING'
      this.setData({
        posterPath,
        posterMode: credential.mode,
        posterValidUntil: credential.validUntil,
        posterValidText: `有效至 ${localDateTime(credential.validUntil)}`,
        posterCountdownText: '',
        posterExpired: false,
      })
      if (rotating) {
        this.startPosterCountdown(credential.validUntil)
      }
      else {
        this.clearPosterCountdown()
      }
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '签到海报生成失败' })
    }
    finally {
      this.setData({ posterBusy: false })
    }
  },

  async drawCheckInPoster(codeUrl: string, event: AdminEventDetail, mode: CheckInCredentialMode) {
    const node = await new Promise<Canvas2dNode>((resolve, reject) => {
      this.createSelectorQuery()
        .select('#admin-checkin-poster-canvas')
        .fields({ node: true, size: true })
        .exec((results) => {
          const result = results?.[0] as { node?: Canvas2dNode } | undefined
          if (!result?.node) {
            reject(new Error('签到海报画布不可用'))
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
    context.fillText(localDateTime(event.startsAt), 28, 158)
    context.fillText(event.cityName || '地点待公布', 28, 182)
    context.fillStyle = '#FFFFFF'
    context.fillRect(28, 208, 319, 286)
    const codeImage = await loadCanvasImage(node, codeUrl)
    context.drawImage(codeImage, 78, 228, 219, 219)
    context.fillStyle = '#111111'
    context.font = '600 15px sans-serif'
    context.textAlign = 'center'
    context.fillText(mode === 'ROTATING' ? '短时签到码，请在有效期内使用' : '使用微信扫码进入活动详情', POSTER_WIDTH / 2, 474)
    context.textAlign = 'start'
    context.font = '400 12px sans-serif'
    context.fillText('仅限已报名参与者使用', 28, 526)
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

  previewCheckInPoster() {
    if (this.data.posterPath) {
      wx.previewImage({ current: this.data.posterPath, urls: [this.data.posterPath] })
    }
  },

  async saveCheckInPoster() {
    if (!this.data.posterPath || this.data.posterBusy || this.data.posterExpired) {
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
  async publishEventReminder() {
    const event = this.data.event
    if (!event || !this.data.canPublishCommunications || this.data.reminderBusy || event.status !== 'PUBLISHED') {
      return
    }
    this.setData({ reminderBusy: true })
    const retrying = Boolean(this.data.reminderRequestKey)
      && this.data.reminderRequestVersion === event.version
    let sendWechatReminder = retrying ? this.data.reminderRequestWechat : false
    if (!retrying) {
      try {
        const choice = await wx.showActionSheet({
          itemList: ['站内提醒并尝试微信提醒', '仅发送站内提醒'],
        })
        sendWechatReminder = choice.tapIndex === 0
      }
      catch {
        this.setData({ reminderBusy: false })
        return
      }
    }
    const confirmation = await wx.showModal({
      title: '发送活动提醒',
      content: sendWechatReminder
        ? '将向已确认参与者创建站内提醒，并在参与者已授权且服务可用时尝试发送微信提醒。'
        : '将向已确认参与者创建站内提醒。',
      confirmText: '发送',
    }).catch(() => null)
    if (!confirmation?.confirm) {
      this.setData({ reminderBusy: false })
      return
    }
    const idempotencyKey = retrying
      ? this.data.reminderRequestKey
      : reminderRequestKey(event.id)
    this.setData({
      reminderSummary: '',
      reminderRequestKey: idempotencyKey,
      reminderRequestVersion: event.version,
      reminderRequestWechat: sendWechatReminder,
      message: '',
    })
    try {
      const result = await mipAdminModule.events.publishReminder({
        eventId: event.id,
        expectedVersion: event.version,
        idempotencyKey,
        sendWechatReminder,
      })
      const reminderSummary = result.recipientCount === 0
        ? '当前没有已确认参与者，未创建提醒。'
        : result.wechatDelivery === 'BEST_EFFORT'
          ? `已为 ${result.recipientCount} 位参与者创建站内提醒。微信提醒会在参与者已授权且服务可用时尝试发送。`
          : `已为 ${result.recipientCount} 位参与者创建站内提醒。`
      this.setData({
        reminderSummary,
        reminderRequestKey: '',
        reminderRequestVersion: 0,
        reminderRequestWechat: false,
      })
      wx.showToast({ title: '提醒已创建', icon: 'success' })
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '活动提醒发送失败' })
    }
    finally {
      this.setData({ reminderBusy: false })
    }
  },
  openPage(event: WechatMiniprogram.TouchEvent) {
    const page = String(event.currentTarget.dataset.page || '')
    const allowed = new Set(['events', 'event-registrations', 'event-managers', 'event-album', 'event-feedback', 'exports', 'orders'])
    if (allowed.has(page)) {
      void wx.navigateTo({ url: `/packages/admin/${page}/index?eventId=${encodeURIComponent(this.data.eventId)}` })
    }
  },
  async cloneEvent() {
    const event = this.data.event
    if (!event || !this.data.canEdit || this.data.cloneBusy || this.data.processing) {
      return
    }
    const retrying = Boolean(this.data.cloneRequestKey)
      && this.data.cloneRequestVersion === event.version
    if (!retrying) {
      const modal = await wx.showModal({
        title: '复制活动',
        content: '将复制活动内容和配置，并自动顺延时间。报名、订单、签到、相册和消息不会复制。',
        confirmText: '复制',
      }).catch(() => null)
      if (!modal?.confirm) {
        return
      }
    }
    const idempotencyKey = retrying
      ? this.data.cloneRequestKey
      : cloneRequestKey(event.id)
    this.setData({
      cloneBusy: true,
      cloneRequestKey: idempotencyKey,
      cloneRequestVersion: event.version,
      message: '',
    })
    try {
      const result = await mipAdminModule.events.clone({
        sourceEventId: event.id,
        expectedVersion: event.version,
        idempotencyKey,
      })
      this.setData({ cloneRequestKey: '', cloneRequestVersion: 0 })
      wx.showToast({ title: '草稿已创建', icon: 'success' })
      await wx.navigateTo({ url: `/packages/admin/events/index?eventId=${encodeURIComponent(result.id)}` })
    }
    catch (error) {
      const failure = adminLoadFailure(error, { hasContent: true, fallbackMessage: '活动复制失败' })
      this.setData({ message: failure.message, state: failure.state || 'ready' })
    }
    finally {
      this.setData({ cloneBusy: false })
    }
  },
  async changeStatus(event: WechatMiniprogram.TouchEvent) {
    if (!this.data.event || !this.data.canEdit || this.data.processing || this.data.cloneBusy) {
      return
    }
    const status = String(event.currentTarget.dataset.status || '')
    if (!['PUBLISHED', 'UNPUBLISHED', 'ENDED'].includes(status)) {
      return
    }
    this.setData({ processing: true, message: '' })
    try {
      const modal = await wx.showModal({ title: '确认状态变更', content: '状态变更会立即影响用户端展示和后续操作。' })
      if (!modal.confirm) {
        return
      }
      await mipAdminModule.events.changeStatus({
        eventId: this.data.eventId,
        status,
        expectedVersion: this.data.event?.version,
      })
      wx.showToast({ title: '状态已更新', icon: 'success' })
      await this.loadEvent(true)
    }
    catch (error) {
      const failure = adminLoadFailure(error, { hasContent: true, fallbackMessage: '状态更新失败' })
      this.setData({ message: failure.message, state: failure.state || 'ready' })
    }
    finally {
      this.setData({ processing: false })
    }
  },
  async cancelEvent() {
    if (!this.data.event || !this.data.canEdit || this.data.processing || this.data.cloneBusy) {
      return
    }
    this.setData({ processing: true, message: '' })
    try {
      const modal = await wx.showModal({
        title: '取消活动',
        editable: true,
        placeholderText: '填写取消原因',
      })
      const reason = modal.content.trim()
      if (!modal.confirm) {
        return
      }
      if (!reason) {
        this.setData({ message: '请填写取消原因。' })
        return
      }
      await mipAdminModule.events.changeStatus({
        eventId: this.data.eventId,
        status: 'CANCELLED',
        reason,
        expectedVersion: this.data.event?.version,
      })
      wx.showToast({ title: '活动已取消', icon: 'success' })
      await this.loadEvent(true)
    }
    catch (error) {
      const failure = adminLoadFailure(error, { hasContent: true, fallbackMessage: '活动取消失败' })
      this.setData({ message: failure.message, state: failure.state || 'ready' })
    }
    finally {
      this.setData({ processing: false })
    }
  },
})
