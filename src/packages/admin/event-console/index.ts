import type { EventId } from '../../../modules/mip'
import type { AdminEventDetail, AdminEventStatus } from '../../../modules/mip-admin'
import type { CheckInCredentialMode } from '../../../modules/mip-events'
import type { AdminPageState } from '../shared/page-state'
import { hasScopedCapability, mipAdminModule } from '../../../modules/mip-admin'
import { checkInCredentialCountdown } from '../../../modules/mip-events'
import { mipEventsModule } from '../../../modules/mip-events/client'
import { formatChineseDateTime } from '../../../utils/date'
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

const statusLabels: Record<AdminEventStatus, string> = {
  DRAFT: '草稿',
  PUBLISHED: '已发布',
  UNPUBLISHED: '已下架',
  CANCELLED: '已取消',
  ENDED: '已结束',
  ARCHIVED: '已归档',
}

function wrappedLines(
  context: WechatMiniprogram.CanvasRenderingContext.CanvasRenderingContext2D,
  value: string,
  maxWidth: number,
  limit: number,
) {
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

Page({
  data: {
    state: 'loading' as AdminPageState,
    eventId: '',
    event: null as AdminEventDetail | null,
    eventStatusText: '',
    eventTimeText: '',
    canRoster: false,
    canCheckIn: false,
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

  onLoad(query: Record<string, string>) {
    this.setData({ eventId: query.eventId || '' })
  },

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
        mipAdminModule.session.get(force),
        mipAdminModule.events.get(this.data.eventId, force),
      ])
      const scope = { scopeType: 'EVENT' as const, scopeId: event.id, branchId: event.branchId }
      this.setData({
        state: 'ready',
        event,
        eventStatusText: statusLabels[event.status],
        eventTimeText: formatChineseDateTime(event.startsAt),
        canRoster: hasScopedCapability(session.capabilities, 'events.roster.read', scope),
        canCheckIn: hasScopedCapability(session.capabilities, 'events.checkin.manage', scope),
        message: '',
      })
    }
    catch (error) {
      this.setData(adminLoadFailure(error, { hasContent, fallbackMessage: '活动信息加载失败' }))
    }
  },

  openRoster() {
    if (!this.data.canRoster || !this.data.eventId) {
      return
    }
    void wx.navigateTo({
      url: `/packages/admin/event-registrations/index?eventId=${encodeURIComponent(this.data.eventId)}`,
    })
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
      this.setData({
        posterPath,
        posterMode: credential.mode,
        posterValidUntil: credential.validUntil,
        posterValidText: `有效至 ${formatChineseDateTime(credential.validUntil)}`,
        posterCountdownText: '',
        posterExpired: false,
      })
      if (credential.mode === 'ROTATING') {
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
    context.fillText(formatChineseDateTime(event.startsAt), 28, 158)
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
})
