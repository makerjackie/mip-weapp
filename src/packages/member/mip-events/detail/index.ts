import type { EventId } from '../../../../modules/mip'
import type { MipEventDetail } from '../../../../modules/mip-events'
import type { MipGuestLoginProceedContext } from '../../../../modules/mip-identity'
import { brand } from '../../../../config/brand'
import { mipOperationsConfig } from '../../../../config/mip-operations'
import { decodeInvitationToken, eventInvitationPath, eventRichTextNodes, extractRichTextCloudImageIds, isEventAccessRequirementError, MipEventsError, publicEventTypeLabel, safeHttpsEventUrl } from '../../../../modules/mip-events'
import { mipCheckInResumeStore, mipEventsModule } from '../../../../modules/mip-events/client'
import { createMipGuestLoginFlow } from '../../../../modules/mip-identity'
import { mipIdentityModule } from '../../../../modules/mip-identity/client'
import { caseNavigateTo } from '../../../../platform/navigation/client'
import { peekCloudFileUrls, resolveCloudFileUrls } from '../../../../platform/storage/cloud-media'
import { clearComponentMedia, updateComponentMedia } from '../../../../platform/storage/component-media'
import { openWechatChannelsDestination } from '../../../../platform/wechat/channels'
import { formatBusinessDateTime as formatChineseDateTime, formatBusinessMonthDay as formatChineseMonthDay, formatBusinessMonthDayTime as formatChineseMonthDayTime, formatBusinessTime as formatLocalTime } from '../../../../utils/business-date'

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

/**
 * MIW-103：早到扫码不再报错。服务端 CHECKIN_NOT_OPEN 携带 opensAt（开始前 6 小时起），
 * 据此生成详情页「活动未开始」引导文案；时间缺失时退化为不带时间的通用提示。
 */
function checkinNoticeFromDetails(kind: 'NOT_OPEN' | 'EXPIRED', details: Record<string, unknown> | null) {
  if (kind === 'NOT_OPEN') {
    const opensAt = Date.parse(String(details?.opensAt || ''))
    const opensText = Number.isFinite(opensAt) ? formatChineseMonthDayTime(new Date(opensAt)) : ''
    return opensText
      ? `活动未开始，${opensText}起可现场扫码签到（开始前 6 小时开放）。`
      : '活动未开始，开始前 6 小时起可现场扫码签到。'
  }
  return '现场活动码已过期，请向工作人员获取最新活动码。'
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
    event: null as (Omit<MipEventDetail, 'organizer' | 'description' | 'organizerIntroduction'> & { hasDescription?: boolean }) | null,
    descriptionNodes: [] as ReturnType<typeof eventRichTextNodes>,
    organizerIntroductionNodes: [] as ReturnType<typeof eventRichTextNodes>,
    noticesNodes: [] as ReturnType<typeof eventRichTextNodes>,
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
    // MIW-103：扫码签到被服务端判定为「活动未开始/码过期」时的页内引导横幅；
    // NOT_OPEN 态在 onShow 重试（用户在开放点后回到页面即自动补签）。
    checkinNotice: '',
    checkinNoticeKind: '' as '' | 'NOT_OPEN' | 'EXPIRED',
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
  // 富文本插图水合代际：applyEvent 重入或页面卸载时推进，旧解析回包不再覆盖新内容。
  richTextMediaSeq: 0,
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
      // BUG-12.2（审计 2026-10-12）：loadInvitationScene 内部成功后会 loadEvent({force:true})，
      // 外层再无条件 loadEvent 会把同一活动并发请求两次（多耗一次详情子查询与云存储临时
      // 链接批取）。邀请路径统一交给 loadInvitationScene，失败兜底见其 catch。
      void this.loadInvitationScene(inviteRef)
      return
    }
    void this.loadEvent()
  },

  onShow() {
    this.refreshCheckInIntent()
    // MIW-103：早到扫码停在「活动未开始」横幅后，用户在开放点（开始前 6 小时）之后
    // 回到本页即自动补签；凭证过期的横幅（EXPIRED）不重试，只引导重扫。
    if (this.data.checkinNoticeKind === 'NOT_OPEN' && this.data.hasCheckInIntent
      && this.data.state === 'ready' && !this.data.busy) {
      void this.attemptAutoCheckIn()
    }
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
    this.richTextMediaSeq += 1
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
      this.setData({ hasCheckInIntent: false, checkinNotice: '', checkinNoticeKind: '' })
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
      // MIW-103：早到扫码（开始前 6 小时之外）给出「活动未开始」页内引导而非报错；
      // 码过期则提示找工作人员换新码并清掉失效意图。其余校验失败仍不打断浏览：
      // 签到意图保留，重新扫码进入本页即可再次自动签到。
      if (error instanceof MipEventsError && error.code === 'CHECKIN_NOT_OPEN') {
        this.setData({
          checkinNotice: checkinNoticeFromDetails('NOT_OPEN', error.details),
          checkinNoticeKind: 'NOT_OPEN',
        })
        return
      }
      if (error instanceof MipEventsError && error.code === 'CHECKIN_EXPIRED') {
        this.clearCheckInIntent(eventId, 'EXPIRED')
        return
      }
      if (this.data.checkinNoticeKind === 'NOT_OPEN' && error instanceof MipEventsError
        && /活动码|凭证|失效|签到时间|token|credential/i.test(error.message)) {
        // 签到意图超过 30 分钟本地有效期后重试会拿到凭证失效：海报码本身没过期，
        // 文案引导重扫同一张码，而不是误导用户去找工作人员换码。
        mipCheckInResumeStore.clear(eventId)
        this.setData({
          hasCheckInIntent: false,
          checkinNotice: '签到等待超时，请重新扫描现场活动码完成签到。',
          checkinNoticeKind: 'EXPIRED',
        })
        return
      }
    }
    finally {
      this.setData({ busy: false })
    }
  },

  /** MIW-103：清除签到意图并把横幅切到对应文案（EXPIRED = 引导重扫）。 */
  clearCheckInIntent(eventId: string, kind: 'NOT_OPEN' | 'EXPIRED') {
    mipCheckInResumeStore.clear(eventId)
    this.setData({
      hasCheckInIntent: false,
      checkinNotice: checkinNoticeFromDetails(kind, null),
      checkinNoticeKind: kind,
    })
  },

  async loadInvitationScene(scene: string) {
    // BUG-12.2：onLoad 后微信会紧跟 onShow；eventId 已随 query 写入而 loadEvent 尚未启动，
    // 不占用 loadingEvent 的话 onShow 的 30s 复验会立刻再发一次详情请求。邀请解析窗口内
    // 持有该标志挡住复验，随后由内部/兜底的 loadEvent 在 finally 按最新 seq 复位。
    this.loadingEvent = true
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
        // BUG-12.2 兜底：onLoad 在 inviteRef 路径不再无条件 loadEvent，邀请解析失败时这里
        // 必须自行加载，否则无缓存的详情页会停在 loading。先加载后提示，避免提示被
        // applyEvent 的 message 复位清掉（loadEvent 内部自捕获，不会向外抛错）。
        await this.loadEvent({ force: true })
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
    // MIW-103：签到意图随报名态收敛失效时，「活动未开始」横幅同步撤下，避免死提示。
    const checkinNoticeReset = shouldClearCheckInIntent || (!hasCheckInIntent && this.data.checkinNoticeKind !== '')
      ? { checkinNotice: '', checkinNoticeKind: '' as const }
      : {}
    const action = primaryAction(event)
    const onlineUrl = safeHttpsEventUrl(event.onlineUrl)
    const guideUrl = safeHttpsEventUrl(event.guideUrl)
    const contentMedia = (event.contentMedia || []).map((item, index) => ({ ...item, renderKey: `media-${index}` }))
    // MIW-53：主办方资料卡已从详情页下线，organizer（含头像 cloud file id）不再进页面数据；
    // 运行时验收的敏感值断言（cloud:// 模式）同样依赖这里的最小化。
    // MIW-79：服务端把富文本插图重写成 cloud:// 稳定引用，description / organizerIntroduction
    // 原始 markdown 同样不得进页面数据，只在构建 rich-text 节点与水合时本地使用。
    const {
      organizer: _retiredOrganizer,
      description: richDescription,
      organizerIntroduction: richOrganizerIntroduction,
      notices: richNotices,
      ...eventWithoutRichText
    } = event
    const normalizedEvent = {
      ...eventWithoutRichText,
      eventTypeLabel: publicEventTypeLabel(event.eventTypeLabel),
      coverUrl: peekCloudFileUrls(event.coverUrl || ''),
      contentMedia: peekCloudFileUrls(contentMedia),
      tags: event.tags || [],
      videoRecaps: event.videoRecaps || [],
      participantPreview: peekCloudFileUrls(event.participantPreview || []),
      hasDescription: Boolean(richDescription),
    }
    this.setData({
      state: 'ready',
      event: normalizedEvent,
      descriptionNodes: eventRichTextNodes(richDescription || ''),
      // 小程序需求 C1（TC-C-01）：主办方 Tab 与后台配置的主办方介绍一致，原样渲染富文本。
      organizerIntroductionNodes: eventRichTextNodes(richOrganizerIntroduction || ''),
      noticesNodes: eventRichTextNodes(richNotices || ''),
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
      ...checkinNoticeReset,
      message: this.onlineRequested && !onlineUrl ? '当前暂不能进入线上活动。' : this.guideRequested && !guideUrl ? '当前暂无路线指引。' : '',
    })
    updateComponentMedia(this, 'event.coverUrl', event.coverUrl || '')
    updateComponentMedia(this, 'event.participantPreview', event.participantPreview || [])
    updateComponentMedia(this, 'event.contentMedia', contentMedia)
    this.hydrateRichTextMedia(richDescription || '', richOrganizerIntroduction || '', richNotices || '')
  },

  /**
   * 富文本插图（description / organizerIntroduction 里的 cloud:// 引用）与封面走同一条
   * 本地下载管道：先按原始 markdown 渲染文本（未解析图先隐藏），解析完成后把 cloud://
   * 替换成 wxfile:// 本地路径再重建节点，避免把云存储 ID 或短时效签名直链直接喂给 rich-text。
   */
  hydrateRichTextMedia(description: string, organizerIntroduction: string, notices = '') {
    const fileIds = [...new Set([
      ...extractRichTextCloudImageIds(description),
      ...extractRichTextCloudImageIds(organizerIntroduction),
      ...extractRichTextCloudImageIds(notices),
    ])]
    if (!fileIds.length) {
      return
    }
    const seq = this.richTextMediaSeq + 1
    this.richTextMediaSeq = seq
    void resolveCloudFileUrls(fileIds, undefined, true).then((resolvedIds) => {
      if (seq !== this.richTextMediaSeq) {
        return
      }
      const localPaths = new Map<string, string>()
      fileIds.forEach((fileId, index) => {
        const local = resolvedIds[index]
        if (local) {
          localPaths.set(fileId, local)
        }
      })
      if (!localPaths.size) {
        return
      }
      const substitute = (content: string) => content
        // 新格式：受限 HTML 的 <img src="cloud://…">
        .replace(
          /src\s*=\s*"(cloud:\/\/[^"]+)"/gi,
          (whole, fileId: string) => localPaths.get(fileId) ? `src="${localPaths.get(fileId)}"` : whole,
        )
        // 存量格式：markdown 图片语法
        .replace(
          /!\[([^\]]{0,120})\]\((cloud:\/\/[^)\s]+)\)/g,
          (whole, alt: string, fileId: string) => localPaths.get(fileId) ? `![${alt}](${localPaths.get(fileId)})` : whole,
        )
      this.setData({
        descriptionNodes: eventRichTextNodes(substitute(description)),
        ...(organizerIntroduction
          ? { organizerIntroductionNodes: eventRichTextNodes(substitute(organizerIntroduction)) }
          : {}),
        ...(notices ? { noticesNodes: eventRichTextNodes(substitute(notices)) } : {}),
      })
    }).catch(() => {
      // 解析失败保持已渲染的文本内容，不阻塞详情页。
    })
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

  /**
   * MIW-53：主按钮只剩「立刻报名」，走 J1-01 游客登录门禁后进入报名页。
   * BUG-04.1（审计 2026-10-12）：requireAuthIntent 的 begin() 要等一次身份快照网络往返，
   * 期间守卫读到的 busy 仍为 false，双击会两次 begin 双双 ready → 报名页叠两层（两次
   * 生成的 token 不同、URL 相同，仅靠导航去重拦不住）。复用本页唯一的动作闩锁 busy
   * （主按钮已绑 loading="{{busy}}"），在首个 await 前同步置位，finally 复位；游客路径
   * begin 短路返回 sheet，弹层幂等行为不变。
   */
  async handlePrimary() {
    if (this.data.busy || this.data.primaryAction !== 'register') {
      return
    }
    this.setData({ busy: true })
    try {
      const allowed = await this.requireAuthIntent('register')
      if (allowed) {
        this.openRegistration()
      }
    }
    finally {
      this.setData({ busy: false })
    }
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

  /** BUG-04.1：同 handlePrimary——参与人数入口在身份检查往返窗口内无锁，双击双开参与人页。 */
  async openParticipants() {
    if (this.data.busy) {
      return
    }
    this.setData({ busy: true })
    try {
      const allowed = await this.requireAuthIntent('participants')
      if (allowed) {
        this.openParticipantsNow()
      }
    }
    finally {
      this.setData({ busy: false })
    }
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
