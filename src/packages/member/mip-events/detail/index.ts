import type { EventId } from '../../../../modules/mip'
import type { MipEventDetail } from '../../../../modules/mip-events'
import type { MipGuestLoginProceedContext } from '../../../../modules/mip-identity'
import { brand } from '../../../../config/brand'
import { mipOperationsConfig } from '../../../../config/mip-operations'
import { decodeInvitationToken, eventInvitationPath, eventRichTextNodes, isEventAccessRequirementError, MipEventsError, publicEventTypeLabel, safeHttpsEventUrl } from '../../../../modules/mip-events'
import { mipCheckInResumeStore, mipEventsModule } from '../../../../modules/mip-events/client'
import { createMipGuestLoginFlow } from '../../../../modules/mip-identity'
import { mipIdentityModule } from '../../../../modules/mip-identity/client'
import { caseNavigateTo } from '../../../../platform/navigation/client'
import { peekCloudFileUrls } from '../../../../platform/storage/cloud-media'
import { clearComponentMedia, updateComponentMedia } from '../../../../platform/storage/component-media'
import { openWechatChannelsDestination } from '../../../../platform/wechat/channels'
import { formatChineseDateTime, formatChineseMonthDay, formatChineseMonthDayTime, formatLocalTime } from '../../../../utils/date'

const POSTER_WIDTH = 375
const POSTER_HEIGHT = 560

/**
 * MIW-36：onShow 缓存新鲜窗口。详情 ↔ 参与人/心动页一次往返通常在数秒内，窗口内
 * 不再重发 mip.events.detail；超过窗口仍会后台重验证，外部变化（他人报名、活动编辑）
 * 最迟在窗口结束后反映。
 */
const SHOW_REVALIDATE_MAX_AGE_MS = 30_000

const DETAIL_ROUTE = 'packages/member/mip-events/detail/index'

/** journey-review J1-01：游客触发分享 / 参与人数 / 立刻报名后要恢复的原意图；checkin 为 J0-02 扫码自动签到授权。 */
type AuthIntent = 'register' | 'share' | 'participants' | 'checkin'

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
      if (lines.length === maxLines) {
        let lastLine = lines[maxLines - 1] || ''
        while (lastLine && context.measureText(`${lastLine}…`).width > maxWidth) {
          lastLine = Array.from(lastLine).slice(0, -1).join('')
        }
        lines[maxLines - 1] = `${lastLine}…`
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

function accessText(event: MipEventDetail) {
  if (event.accessType === 'MEMBER_INCLUDED') {
    return '玩家活动'
  }
  if (event.accessType === 'PAID') {
    return `¥${(event.priceCents / 100).toFixed(2)}`
  }
  return '免费活动'
}

/**
 * Access chip copy per figma 1861_17860: the chip names WHO may join (仅玩家)
 * while the price line separately shows the amount for PAID events.
 */
function accessLabel(event: MipEventDetail) {
  if (event.accessType === 'MEMBER_INCLUDED') {
    return '玩家活动'
  }
  if (event.accessType === 'PAID') {
    return '仅玩家'
  }
  return '免费活动'
}

/** Price amount without the ¥ sign; whole yuan prices drop the decimals (figma: ¥589). */
function priceText(event: MipEventDetail) {
  const value = event.priceCents / 100
  return Number.isInteger(value) ? String(value) : value.toFixed(2)
}

/** 与你互动 pill labels (figma 1818_17142); counts render once the API supplies a summary. */
function interactionLabels(event: MipEventDetail) {
  const summary = event.interactionSummary
  return {
    heartMineLabel: summary ? `我的心动 ${summary.myInterestCount}` : '我的心动',
    heartReceivedLabel: summary ? `对我心动 ${summary.receivedInterestCount}` : '对我心动',
  }
}

/**
 * MIW-28（客户确认 2026-10-05）：未签到整卡隐藏；已签到即展示，0/0 也显示——
 * 胶囊本身就是进入参与人页心动 tab 的入口。旧口径（J0-01 仅在有心动数据时展示）
 * 随服务端下发 interactionSummary 一并废止。签到门槛由服务端 canInteract 决定，
 * 页面不再重复推导 registrationStatus。
 */
function interactionVisible(event: MipEventDetail) {
  return Boolean(event.canInteract) && Boolean(event.interactionSummary)
}

function compactEventTime(startsAt: string, endsAt: string) {
  const startsDay = formatChineseMonthDay(startsAt)
  const endsDay = formatChineseMonthDay(endsAt)
  if (!startsDay || !endsDay) {
    return ''
  }
  return startsDay === endsDay
    ? `${startsDay} ${formatLocalTime(startsAt)}-${formatLocalTime(endsAt)}`
    : `${formatChineseMonthDayTime(startsAt)} 至 ${formatChineseMonthDayTime(endsAt)}`
}

/**
 * MIW-53（客户确认 2026-10-08，figma 1818_17142「活动详情（以签到）」）：底部 sticky
 * 只保留两种状态——未报名且服务端允许报名时展示「立刻报名」；其余（已报名、待支付、
 * 审核中、候补、已签到、已结束/已取消、暂不可报名）一律只保留客服与转发两个胶囊，
 * 不再出现任何黄色主按钮（订单 / 互动 / 签到等旧主按钮均随本口径废止，与你互动已并入
 * 参与人模块）。报名可能性完全由服务端 canRegister 决定。
 */
function primaryAction(event: MipEventDetail): { key: 'register', label: string } | null {
  return event.canRegister
    ? { key: 'register', label: '立刻报名' }
    : null
}

Page({
  data: {
    state: 'loading' as 'loading' | 'ready' | 'error',
    eventId: '' as EventId,
    event: null as MipEventDetail | null,
    descriptionNodes: [] as ReturnType<typeof eventRichTextNodes>,
    startsText: '',
    endsText: '',
    shareTimeText: '',
    accessText: '',
    accessLabel: '',
    priceText: '',
    interactionVisible: false,
    heartMineLabel: '我的心动',
    heartReceivedLabel: '对我心动',
    locationText: '',
    primaryAction: '' as '' | 'register',
    primaryLabel: '',
    busy: false,
    message: '',
    inviteRef: '',
    incomingInvitationToken: '',
    invitationLoading: false,
    outgoingInviteRef: '',
    shareLinkBusy: false,
    shareOpen: false,
    posterBusy: false,
    posterPath: '',
    shareOverlayProps: {
      backgroundColor: 'rgba(8, 8, 8, 0.7)',
    },
    hasCheckInIntent: false,
    onlineMode: false,
    onlineUrl: '',
    guideMode: false,
    guideUrl: '',
    hasCoordinates: false,
    videoRecapBusyId: '',
    contentSection: 'INTRO' as 'INTRO' | 'ORGANIZER' | 'NOTICE',
    loginSheetOpen: false,
    loginSheetBusy: false,
    loginSheetRestoreFirst: false,
    logoPath: brand.logoPath,
  },
  requestSeq: 0,
  loadingEvent: false,
  onlineRequested: false,
  guideRequested: false,
  entryScene: '',
  authToken: '' as string,
  authIntent: '' as AuthIntent | '',
  guestLoginFlow: null as ReturnType<typeof createMipGuestLoginFlow> | null,
  checkInAuthRetryAttempted: false,
  invitationUrl: null as { eventId: string, url: string, validUntil: string } | null,
  // Page 自定义属性在多实例间按引用共享，这里带 eventId 标记，防止把别的活动实例的 ref 用到当前转发。
  shareInviteRequest: null as { eventId: EventId, promise: Promise<string> } | null,

  /** 通用游客登录引导（src/modules/mip-identity/guest-login-flow.ts）的本页接入点。 */
  requireGuestLoginFlow() {
    if (!this.guestLoginFlow) {
      this.guestLoginFlow = createMipGuestLoginFlow({
        route: DETAIL_ROUTE,
        getAuthToken: () => this.authToken,
        setAuthToken: (token: string) => { this.authToken = token },
        isSheetActive: () => this.data.loginSheetOpen || this.data.loginSheetBusy,
        setSheetState: state => this.setData(state),
        proceed: context => this.proceedGuestLogin(context),
      }, mipIdentityModule)
    }
    return this.guestLoginFlow
  },

  /** 身份就绪后在本页就地继续授权前的原意图；经 access 页回来时按 resume 映射。 */
  proceedGuestLogin({ resume }: MipGuestLoginProceedContext) {
    const pending = this.authIntent
    this.authIntent = ''
    if (resume) {
      const intent = String(resume.source.query?.intent || '') as AuthIntent | ''
      if (resume.action === 'REGISTER_EVENT') {
        this.runAuthIntent('register')
        return
      }
      if (intent === 'share' || intent === 'participants' || intent === 'checkin') {
        this.runAuthIntent(intent)
      }
      return
    }
    this.runAuthIntent(pending)
  },

  onLoad(query: Record<string, string>) {
    this.onlineRequested = query.online === '1'
    this.guideRequested = query.guide === '1'
    const scene = String(query.scene || '').trim()
    const inviteRef = String(query.inviteRef || '').trim()
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
      inviteRef,
      incomingInvitationToken: decodeInvitationToken(query.invitationToken),
      hasCheckInIntent,
    })
    const cached = mipEventsModule.peekEvent(eventId)
    if (cached) {
      this.applyEvent(cached)
    }
    if (inviteRef) {
      void this.loadInvitationScene(inviteRef)
    }
    void this.loadEvent()
  },

  onShow() {
    this.refreshCheckInIntent()
    if (!this.loadingEvent && this.data.eventId) {
      // MIW-36：cache-and-revalidate——30s 内回到本页直接应用模块缓存（心动页已把
      // getHeart/setHeart 的服务端计数回填进缓存），不再每次 onShow 丢弃缓存强刷全部
      // 详情子查询（含互动计数被反复执行）。报名/取消/签到等状态变更会主动失效缓存，
      // 缓存缺失时这里照常发起真实拉取，签到态与报名态的即时感知不变。
      void this.loadEvent({ maxAgeMs: SHOW_REVALIDATE_MAX_AGE_MS })
    }
    this.resumeAuthIntent()
  },

  onUnload() {
    this.requestSeq += 1
    clearComponentMedia(this)
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
      // journey-review J0-01：扫码直达已定位详情页，紧接着自动完成签到校验。
      if (intent && this.data.state === 'ready') {
        void this.attemptAutoCheckIn()
      }
    }
    catch {
      this.setData({
        state: 'error',
        message: '未识别到有效活动码，请打开微信扫一扫重新扫码。',
      })
    }
  },

  /**
   * journey-review J0-01（M1 00:46:24）：扫码进入详情页后自动发起签到，成功即弹
   * 微信原生「签到成功」toast 并转入已签到态（与你互动 / 活动反馈出现）。服务端
   * 要求人工处理（未报名、非现场、时间不符等）时仅保留提示，签到意图留待重新扫码；
   * 未登录（J0-02）先走手机号授权，回本页后重试签到并提示结果。
   * （MIW-53：详情页活动签到模块与签到主按钮已按设计稿删除，扫码直达仍是唯一入口。）
   */
  async attemptAutoCheckIn() {
    const eventId = String(this.data.eventId || '')
    const intent = mipCheckInResumeStore.peek(eventId)
    if (!intent || intent.eventId !== eventId || this.data.busy) {
      return
    }
    this.setData({ busy: true, message: '' })
    try {
      const outcome = await mipEventsModule.checkIn(intent.resumeToken)
      mipCheckInResumeStore.clear(String(outcome.eventId))
      this.setData({ hasCheckInIntent: false })
      wx.showToast({ title: '签到成功', icon: 'success' })
      await this.loadEvent({ force: true })
    }
    catch (error) {
      if (isEventAccessRequirementError(error)) {
        // 对齐 feedback 页 recoverAccess 的单次重试上限：身份会话 ready 而活动服务仍
        // 要求授权（状态分裂）时，requireAuthIntent 会直接放行并立刻重试，无上限即
        // 无界循环；重试一次后停在提示兜底（MIW-53：主按钮不再提供签到入口）。
        if (this.checkInAuthRetryAttempted) {
          this.setData({ message: '自动签到暂时未能完成，请稍后重新扫描现场活动码进入本页重试。' })
          return
        }
        void this.requireAuthIntent('checkin').then((allowed: boolean) => {
          if (allowed) {
            this.checkInAuthRetryAttempted = true
            void this.attemptAutoCheckIn()
          }
        })
        return
      }
      // 其余校验失败不打断浏览：签到意图保留，重新扫码进入本页即可再次自动签到。
    }
    finally {
      this.setData({ busy: false })
    }
  },

  async loadInvitationScene(scene: string) {
    this.setData({ state: 'loading', message: '' })
    try {
      const resolved = await mipEventsModule.resolveInvitationScene(scene)
      this.setData({
        eventId: resolved.eventId,
        inviteRef: scene,
        incomingInvitationToken: resolved.invitationToken,
      })
      await this.loadEvent({ force: true })
    }
    catch {
      if (this.data.eventId) {
        this.entryScene = ''
        this.setData({ message: '活动邀请无效或已失效，已按普通活动打开。' })
        return
      }
      this.setData({ state: 'error', message: '活动邀请无效或已失效，请通过活动列表重新进入。' })
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

  async loadEvent(options: { force?: boolean, maxAgeMs?: number } = {}) {
    this.loadingEvent = true
    if (!this.data.event) {
      this.setData({ state: 'loading', message: '' })
    }
    const requestSeq = this.requestSeq + 1
    this.requestSeq = requestSeq
    try {
      const event = await mipEventsModule.getEvent(this.data.eventId, { ...options, progressiveMedia: true })
      if (requestSeq === this.requestSeq) {
        this.applyEvent(event)
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
    finally {
      if (requestSeq === this.requestSeq) {
        this.loadingEvent = false
      }
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
    const action = primaryAction(event)
    const onlineUrl = safeHttpsEventUrl(event.onlineUrl)
    const guideUrl = safeHttpsEventUrl(event.guideUrl)
    const contentMedia = (event.contentMedia || []).map((item, index) => ({ ...item, renderKey: `media-${index}` }))
    const normalizedEvent = {
      ...event,
      eventTypeLabel: publicEventTypeLabel(event.eventTypeLabel),
      coverUrl: peekCloudFileUrls(event.coverUrl || ''),
      contentMedia: peekCloudFileUrls(contentMedia),
      tags: event.tags || [],
      videoRecaps: event.videoRecaps || [],
      participantPreview: peekCloudFileUrls(event.participantPreview || []),
      organizer: peekCloudFileUrls(event.organizer),
    }
    this.setData({
      state: 'ready',
      event: normalizedEvent,
      descriptionNodes: eventRichTextNodes(event.description),
      // figma 1861_17860 shows the compact range ("12月12日 10:00-12:00") on the
      // date row; compactEventTime already folds same-day and multi-day forms.
      startsText: compactEventTime(event.startsAt, event.endsAt) || formatChineseDateTime(event.startsAt),
      endsText: '',
      shareTimeText: compactEventTime(event.startsAt, event.endsAt),
      accessText: accessText(event),
      accessLabel: accessLabel(event),
      priceText: priceText(event),
      // figma 1818_17142: the checked-in state fuses a 与你互动 card under the
      // participant card; MIW-28: shown for every attended viewer once the API
      // supplies interactionSummary (0/0 included).
      interactionVisible: interactionVisible(event),
      ...interactionLabels(event),
      locationText: [event.cityName, event.venueName, event.address].filter(Boolean).join(' · ')
        || (event.mode === 'ONLINE' ? '线上活动' : '地点待公布'),
      primaryAction: action ? action.key : '',
      primaryLabel: action ? action.label : '',
      onlineMode: this.onlineRequested && Boolean(onlineUrl),
      onlineUrl,
      guideMode: this.guideRequested && Boolean(guideUrl),
      guideUrl,
      hasCoordinates: Number.isFinite(event.latitude) && Number.isFinite(event.longitude),
      hasCheckInIntent,
      message: this.onlineRequested && !onlineUrl ? '当前暂不能进入线上活动。' : this.guideRequested && !guideUrl ? '当前暂无路线指引。' : '',
    })
    updateComponentMedia(this, 'event.coverUrl', event.coverUrl || '')
    updateComponentMedia(this, 'event.participantPreview', event.participantPreview || [])
    updateComponentMedia(this, 'event.contentMedia', contentMedia)
    updateComponentMedia(this, 'event.organizer', event.organizer)
  },

  refreshCheckInIntent() {
    const eventId = String(this.data.eventId || '')
    if (!eventId) {
      return
    }
    // MIW-53：签到意图只影响扫码链路的自动签到与报名续签（resumeCheckIn），
    // 不再驱动底部主按钮（两态口径见 primaryAction）。
    this.setData({ hasCheckInIntent: Boolean(mipCheckInResumeStore.peek(eventId)) })
  },

  async loadInvitation() {
    if (this.data.invitationLoading || this.data.outgoingInviteRef) {
      return
    }
    this.setData({ invitationLoading: true })
    try {
      const inviteRef = await this.ensureOutgoingInviteRef()
      if (!inviteRef) {
        this.setData({ message: '邀请信息准备失败，请重新打开分享重试。' })
      }
    }
    finally {
      this.setData({ invitationLoading: false })
    }
  },

  buildShareContent(inviteRef: string) {
    return {
      title: this.data.event?.title || 'MIP 活动',
      path: eventInvitationPath(this.data.eventId, inviteRef),
      imageUrl: this.data.event?.coverUrl || brand.logoPath,
    }
  },

  // MIW-23：右上角原生转发无法过 J1-01 登录门禁。服务端凭 openid 认人，任何 ACTIVE
  // 用户（含已退出登录的会员）都能补建邀请链接，让转发带上归属；失败回落无 ref 路径。
  ensureOutgoingInviteRef() {
    const eventId = this.data.eventId
    if (!eventId) {
      return Promise.resolve('')
    }
    if (this.data.outgoingInviteRef) {
      return Promise.resolve(this.data.outgoingInviteRef)
    }
    const pending = this.shareInviteRequest
    if (pending && pending.eventId === eventId) {
      return pending.promise
    }
    const promise = mipEventsModule.createInvitation(eventId).then(
      (result) => {
        if (this.shareInviteRequest?.promise === promise) {
          this.shareInviteRequest = null
        }
        if (this.data.eventId === eventId) {
          this.setData({ outgoingInviteRef: result.inviteRef })
        }
        return result.inviteRef
      },
      () => {
        if (this.shareInviteRequest?.promise === promise) {
          this.shareInviteRequest = null
        }
        return ''
      },
    )
    this.shareInviteRequest = { eventId, promise }
    return promise
  },

  openShare() {
    void this.requireAuthIntent('share').then((allowed: boolean) => {
      if (allowed) {
        this.openShareNow()
      }
    })
  },

  openShareNow() {
    this.setData({ shareOpen: true })
    void this.loadInvitation()
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

  async copyInvitation(asText: boolean) {
    const event = this.data.event
    if (!event || this.data.shareLinkBusy) {
      return
    }
    this.setData({ shareLinkBusy: true, message: '' })
    try {
      const eventId = this.data.eventId
      let cached = this.invitationUrl
      if (!cached || cached.eventId !== eventId || Date.parse(cached.validUntil) <= Date.now() + 60_000) {
        const envVersion = wx.getAccountInfoSync().miniProgram.envVersion
        const result = await mipEventsModule.createInvitationUrl(eventId, envVersion)
        cached = { eventId, url: result.url, validUntil: result.validUntil }
        this.invitationUrl = cached
        this.setData({ outgoingInviteRef: result.inviteRef })
      }
      await wx.setClipboardData({
        data: asText
          ? [event.title, `时间：${this.data.shareTimeText}`, `地址：${this.data.locationText}`, `报名链接：${cached.url}`].join('\n')
          : cached.url,
      })
      this.closeShare()
      wx.showToast({ title: asText ? '活动信息已复制' : '活动链接已复制', icon: 'success' })
    }
    catch {
      this.setData({ message: '暂时无法复制报名链接，请使用微信分享或下载活动二维码。' })
      wx.showToast({ title: '链接暂不可用，请用微信分享', icon: 'none' })
    }
    finally {
      this.setData({ shareLinkBusy: false })
    }
  },

  copyShareText() {
    return this.copyInvitation(true)
  },

  copyEventLink() {
    return this.copyInvitation(false)
  },

  async downloadInvitationCode() {
    const event = this.data.event
    if (!event || this.data.posterBusy) {
      return
    }
    this.setData({ posterBusy: true, message: '' })
    try {
      const credential = await mipEventsModule.createInvitationCode(this.data.eventId)
      const posterPath = await this.drawInvitationPoster(credential.codeUrl, credential.inviterName)
      this.setData({ posterPath })
      await wx.saveImageToPhotosAlbum({ filePath: posterPath })
      this.closeShare()
      wx.showToast({ title: '二维码已保存', icon: 'success' })
    }
    catch {
      this.setData({ message: '活动二维码暂时无法保存，请稍后重试。' })
      wx.showToast({ title: '保存失败，请检查相册权限', icon: 'none' })
    }
    finally {
      this.setData({ posterBusy: false })
    }
  },

  async drawInvitationPoster(codeUrl: string, inviterName: string) {
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
    context.fillStyle = '#FCDF03'
    context.fillRect(0, 0, POSTER_WIDTH, POSTER_HEIGHT)
    context.fillStyle = '#080808'
    context.font = '700 34px sans-serif'
    context.fillText('MIP', 28, 52)
    context.font = '600 15px sans-serif'
    const invitationLines = wrappedLines(context, `${inviterName.trim() || 'MIP 用户'} 邀请你一起参加`, POSTER_WIDTH - 56, 2)
    let textY = 76
    invitationLines.forEach((line) => {
      context.fillText(line, 28, textY)
      textY += 19
    })
    textY += 9
    context.font = '700 22px sans-serif'
    const titleLines = wrappedLines(context, event.title, POSTER_WIDTH - 56, 2)
    titleLines.forEach((line) => {
      context.fillText(line, 28, textY)
      textY += 27
    })
    textY += 8
    context.font = '400 14px sans-serif'
    for (const line of wrappedLines(context, this.data.startsText, POSTER_WIDTH - 56, 2)) {
      context.fillText(line, 28, textY)
      textY += 18
    }
    for (const line of wrappedLines(context, this.data.locationText, POSTER_WIDTH - 56, 3)) {
      context.fillText(line, 28, textY)
      textY += 18
    }
    const codeCardTop = Math.max(240, textY + 10)
    context.fillStyle = '#FFFFFF'
    context.fillRect(28, codeCardTop, 319, 232)
    const codeImage = await loadCanvasImage(node, codeUrl)
    context.drawImage(codeImage, 99.5, codeCardTop + 10, 176, 176)
    context.fillStyle = '#080808'
    context.font = '600 15px sans-serif'
    context.textAlign = 'center'
    context.fillText('使用微信扫码查看活动详情', POSTER_WIDTH / 2, codeCardTop + 210)
    context.textAlign = 'start'
    context.font = '400 12px sans-serif'
    context.fillText('MIP 活动邀请', 28, 548)
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

  /** MIW-53：主按钮只剩「立刻报名」，走 J1-01 游客登录门禁后进入报名页。 */
  handlePrimary() {
    if (this.data.busy || this.data.primaryAction !== 'register') {
      return
    }
    void this.requireAuthIntent('register').then((allowed: boolean) => {
      if (allowed) {
        this.openRegistration()
      }
    })
  },

  openRegistration() {
    const invitation = this.data.inviteRef
      ? `&inviteRef=${encodeURIComponent(this.data.inviteRef)}`
      : ''
    const checkIn = this.data.hasCheckInIntent
      ? '&resumeCheckIn=1'
      : ''
    caseNavigateTo({ url: `/packages/member/mip-events/registration/index?eventId=${encodeURIComponent(this.data.eventId)}${invitation}${checkIn}` })
  },

  openParticipants() {
    void this.requireAuthIntent('participants').then((allowed: boolean) => {
      if (allowed) {
        this.openParticipantsNow()
      }
    })
  },

  openParticipantsNow() {
    // journey-review J0-01：参与人数入口直达参与人列表默认「玩家」tab。
    caseNavigateTo({ url: `/packages/member/mip-events/participants/index?eventId=${encodeURIComponent(this.data.eventId)}&view=PUBLIC&kind=PLAYER` })
  },

  /**
   * journey-review J0-01：与你互动胶囊直达 participants 对应 tab（我的心动/对我心动），
   * 互动卡其余区域按参与人数同口径进默认「玩家」tab；互动页已并入 participants。
   */
  openInteractionView(event: WechatMiniprogram.TouchEvent) {
    if (!this.data.event?.canInteract) {
      return
    }
    const view = String(event.currentTarget.dataset.view || 'PUBLIC')
    const suffix = view === 'SENT' || view === 'RECEIVED'
      ? `&view=${view}`
      : '&view=PUBLIC&kind=PLAYER'
    caseNavigateTo({ url: `/packages/member/mip-events/participants/index?eventId=${encodeURIComponent(this.data.eventId)}${suffix}` })
  },

  /**
   * journey-review J1-01/J1-02（2026-09-21 终审）：游客点分享 / 参与人数 / 立刻报名先弹
   * 手机号授权弹层；手机号未绑定的会话留在本页等待弹层结果，其余未完成项交给 access 页。
   * 引导骨架已提取为通用 `createMipGuestLoginFlow`，本页只保留意图来源与就地执行。
   */
  async requireAuthIntent(intent: AuthIntent): Promise<boolean> {
    if (!this.authToken) {
      // 已有挂起会话（弹层等待中）时保留首个意图，与弹层里挂着的 token 保持一致。
      this.authIntent = intent
    }
    const result = await this.requireGuestLoginFlow().begin({
      action: intent === 'register' ? 'REGISTER_EVENT' : 'INTERACT',
      source: {
        navigation: 'navigateBack',
        route: `/${DETAIL_ROUTE}`,
        query: {
          eventId: String(this.data.eventId),
          intent,
          ...(this.data.inviteRef ? { inviteRef: this.data.inviteRef } : {}),
        },
      },
    })
    if (result.outcome === 'unavailable') {
      wx.showToast({ title: '身份状态暂时无法确认，请稍后重试。', icon: 'none' })
    }
    return result.outcome === 'ready'
  },

  onLoginSheetPhone(event: WechatMiniprogram.CustomEvent<{ code?: string, errMsg?: string }>) {
    return this.requireGuestLoginFlow().phone(event)
  },

  onLoginSheetSignIn() {
    return this.requireGuestLoginFlow().signIn()
  },

  onLoginSheetDismiss() {
    this.requireGuestLoginFlow().dismiss()
  },

  runAuthIntent(intent: AuthIntent) {
    if (intent === 'share') {
      this.openShareNow()
      return
    }
    if (intent === 'participants') {
      this.openParticipantsNow()
      return
    }
    if (intent === 'checkin') {
      void this.attemptAutoCheckIn()
      return
    }
    this.openRegistration()
  },

  /** 返回本页时恢复授权前的原意图：access 页经 pendingResume 回来，或从「填写信息」回来。 */
  resumeAuthIntent() {
    void this.requireGuestLoginFlow().resume()
  },

  openFeedback() {
    if (!this.data.event?.canInteract) {
      return
    }
    caseNavigateTo({ url: `/packages/member/mip-events/feedback/index?eventId=${encodeURIComponent(this.data.eventId)}` })
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

  openGuide() {
    const guideUrl = safeHttpsEventUrl(this.data.event?.guideUrl)
    if (!guideUrl) {
      this.setData({ message: '当前暂无路线指引。' })
      return
    }
    caseNavigateTo({
      url: `/packages/member/mip-events/detail/index?eventId=${encodeURIComponent(this.data.eventId)}&guide=1`,
    })
  },

  handleGuideError() {
    this.setData({
      guideMode: false,
      message: '路线指引暂时无法打开，请稍后重试。',
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
    if (this.data.outgoingInviteRef) {
      return this.buildShareContent(this.data.outgoingInviteRef)
    }
    const fallback = this.buildShareContent('')
    return {
      ...fallback,
      promise: this.ensureOutgoingInviteRef().then((inviteRef: string) => (
        this.buildShareContent(inviteRef || this.data.outgoingInviteRef)
      )),
    }
  },
})
