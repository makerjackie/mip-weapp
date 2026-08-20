import type { EventDetail, RegistrationHistoryItem } from '../../../modules/membership/types'
import { membershipModule } from '../../../modules/membership/client'
import { formatLocalDateTime } from '../../../utils/date'
import { createQrMatrix } from '../../../utils/qr-matrix'

const QR_SIZE_PX = 180
const QR_QUIET_ZONE = 4

interface Canvas2dNode {
  width: number
  height: number
  requestAnimationFrame?: (callback: () => void) => number
  getContext: (type: '2d') => {
    scale: (x: number, y: number) => void
    fillStyle: string
    fillRect: (x: number, y: number, width: number, height: number) => void
  }
}

function statusCopy(registration: RegistrationHistoryItem, event: EventDetail | null) {
  if (registration.registrationState === 'CANCELLATION_PENDING') {
    return {
      headline: '退款处理中',
      detail: '退款已提交，到账后报名会自动取消。',
      canCancel: false,
    }
  }
  if (registration.cancelledByType === 'EVENT' || registration.eventState === 'CANCELLED' || event?.eventState === 'CANCELLED') {
    const reason = registration.cancellationReason || event?.cancellationReason
    return {
      headline: '主办方已取消',
      detail: reason
        ? `原因：${reason}${registration.cancelledAt ? ` · ${formatLocalDateTime(registration.cancelledAt)}` : ''}`
        : '本场活动已由主办方取消，凭证仅供历史查看。',
      canCancel: false,
    }
  }
  if (registration.registrationState === 'CANCELLED' || registration.cancelledByType === 'MEMBER') {
    return {
      headline: '你已取消报名',
      detail: registration.cancelledAt
        ? `取消时间：${formatLocalDateTime(registration.cancelledAt)}`
        : '这张凭证已失效，名额已释放。',
      canCancel: false,
    }
  }
  if (registration.registrationState === 'ATTENDED') {
    return {
      headline: '已签到',
      detail: '到场记录已确认。如有问题请联系主理人。',
      canCancel: false,
    }
  }
  return {
    headline: '报名成功',
    detail: '到场时出示本页即可。具体集合方式如有变化，主理人会通过小程序客服联系你。',
    canCancel: registration.canCancel,
  }
}

Page({
  data: {
    state: 'loading' as 'loading' | 'ready' | 'error',
    eventId: '',
    event: null as EventDetail | null,
    registration: null as RegistrationHistoryItem | null,
    startsText: '',
    credentialText: '',
    headline: '',
    detail: '',
    canCancel: false,
    passValue: '',
    passImagePath: '',
    passExpiresText: '',
    passLoading: false,
    passRendered: false,
    busy: false,
    message: '',
  },
  requestSeq: 0,

  onLoad(query: Record<string, string>) {
    this.setData({ eventId: query.eventId || '' })
  },
  onShow() {
    void this.load()
  },
  async load() {
    const cachedEvent = membershipModule.peekEvent(this.data.eventId)
    const cachedRegistrations = membershipModule.peekRegistrations()
    const cachedRegistration = cachedRegistrations?.find(item => item.eventId === this.data.eventId) || null
    if (cachedEvent && cachedRegistration && this.data.state !== 'ready') {
      const copy = statusCopy(cachedRegistration, cachedEvent)
      this.setData({
        state: 'ready',
        event: cachedEvent,
        registration: cachedRegistration,
        startsText: formatLocalDateTime(cachedEvent.startsAt),
        credentialText: cachedRegistration.ticketCodeMasked || '动态签到凭证',
        headline: copy.headline,
        detail: copy.detail,
        canCancel: copy.canCancel,
        message: '',
      })
      if (cachedRegistration.registrationState === 'REGISTERED') {
        void this.refreshPass()
      }
    }
    else if (this.data.state !== 'ready') {
      this.setData({ state: 'loading', message: '' })
    }
    const seq = this.requestSeq + 1
    this.requestSeq = seq
    try {
      const [event, registrations] = await Promise.all([
        membershipModule.getEvent(this.data.eventId),
        membershipModule.listRegistrations(),
      ])
      if (seq !== this.requestSeq) {
        return
      }
      const registration = registrations.find(item => item.eventId === this.data.eventId) || null
      if (!registration) {
        // Empty ticket: ready + null registration drives the empty-state UI.
        this.setData({
          state: 'ready',
          event,
          registration: null,
          startsText: formatLocalDateTime(event.startsAt),
          credentialText: '',
          headline: '',
          detail: '',
          canCancel: false,
          message: '',
        })
        return
      }
      const copy = statusCopy(registration, event)
      this.setData({
        state: 'ready',
        event,
        registration,
        startsText: formatLocalDateTime(event.startsAt),
        credentialText: registration.ticketCodeMasked || '动态签到凭证',
        headline: copy.headline,
        detail: copy.detail,
        canCancel: copy.canCancel,
        message: '',
      })
      if (registration.registrationState === 'REGISTERED') {
        void this.refreshPass()
      }
    }
    catch (error) {
      if (seq !== this.requestSeq) {
        return
      }
      this.setData(this.data.state === 'ready'
        ? { message: '凭证更新失败，已保留上次结果。' }
        : { state: 'error', message: error instanceof Error ? error.message : '凭证加载失败' })
    }
  },
  async refreshPass() {
    if (this.data.passLoading || this.data.registration?.registrationState !== 'REGISTERED') {
      return
    }
    this.setData({ passLoading: true })
    try {
      const pass = await membershipModule.issueCheckInPass(this.data.eventId)
      this.setData({
        passValue: pass.value,
        passImagePath: '',
        passExpiresText: `有效至 ${formatLocalDateTime(pass.expiresAt)}`,
        passRendered: false,
      }, () => {
        wx.nextTick(() => {
          void this.drawCheckInCode(pass.value)
        })
      })
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '签到码生成失败' })
    }
    finally {
      this.setData({ passLoading: false })
    }
  },
  async drawCheckInCode(value: string) {
    try {
      const modules = createQrMatrix(value)
      const payload = await new Promise<{ node: Canvas2dNode }>((resolve, reject) => {
        this.createSelectorQuery()
          .select('#checkin-qrcode-canvas')
          .fields({ node: true, size: true })
          .exec((results) => {
            const result = results?.[0] as { node?: Canvas2dNode } | undefined
            if (!result?.node) {
              reject(new Error('SIGNIN_QR_CANVAS_NOT_READY'))
              return
            }
            resolve({ node: result.node })
          })
      })
      const pixelRatio = wx.getWindowInfo().pixelRatio || 1
      payload.node.width = QR_SIZE_PX * pixelRatio
      payload.node.height = QR_SIZE_PX * pixelRatio
      const context = payload.node.getContext('2d')
      context.scale(pixelRatio, pixelRatio)
      context.fillStyle = '#FFFFFF'
      context.fillRect(0, 0, QR_SIZE_PX, QR_SIZE_PX)
      const cellCount = modules.length + QR_QUIET_ZONE * 2
      const cellSize = QR_SIZE_PX / cellCount
      context.fillStyle = '#17382A'
      modules.forEach((row, rowIndex) => {
        row.forEach((active, columnIndex) => {
          if (active) {
            context.fillRect(
              (columnIndex + QR_QUIET_ZONE) * cellSize,
              (rowIndex + QR_QUIET_ZONE) * cellSize,
              cellSize + 0.15,
              cellSize + 0.15,
            )
          }
        })
      })
      if (payload.node.requestAnimationFrame) {
        await new Promise<void>(resolve => payload.node.requestAnimationFrame?.(resolve))
      }
      const passImagePath = await new Promise<string>((resolve, reject) => {
        wx.canvasToTempFilePath({
          canvas: payload.node,
          fileType: 'png',
          destWidth: QR_SIZE_PX * pixelRatio,
          destHeight: QR_SIZE_PX * pixelRatio,
          success: result => resolve(result.tempFilePath),
          fail: reject,
        })
      })
      this.setData({ passImagePath, passRendered: true })
    }
    catch {
      this.setData({
        passRendered: false,
        message: '签到码绘制失败，请点击刷新重试。',
      })
    }
  },
  async cancel() {
    if (!this.data.canCancel || this.data.busy) {
      return
    }
    // Confirm latch before showModal so stacked taps cannot open parallel dialogs.
    this.setData({ busy: true, message: '' })
    try {
      const result = await wx.showModal({
        title: '取消报名',
        content: '取消后名额会释放给其他成员，确认继续吗？',
        confirmText: '取消报名',
        confirmColor: '#B84A43',
      })
      if (!result.confirm) {
        return
      }
      const cancellation = await membershipModule.cancelRegistration(this.data.eventId)
      wx.showToast({
        title: cancellation.status === 'CANCELLATION_PENDING' ? '退款已提交' : '已取消',
        icon: 'success',
      })
      await this.load()
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '取消失败' })
    }
    finally {
      this.setData({ busy: false })
    }
  },
})
