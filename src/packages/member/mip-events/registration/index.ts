import type { EventId, OrderId } from '../../../../modules/mip'
import type { MipEventDetail, MyEventRegistration, RegistrationField } from '../../../../modules/mip-events'
import { mipCommerceModule } from '../../../../modules/mip-commerce/client'
import { decodeInvitationToken, MipEventsError, publicEventTypeLabel } from '../../../../modules/mip-events'
import { mipCheckInResumeStore, mipEventsModule, mipRegistrationDraftStore } from '../../../../modules/mip-events/client'
import { mipAccessPageUrl } from '../../../../modules/mip-identity'
import { mipBranchesModule, mipIdentityModule } from '../../../../modules/mip-identity/client'
import { requestEntrySubscription } from '../../../../modules/mip-messaging/entry-subscription'
import { GUIDE_EVENT_REGISTER_KEY } from '../../../../modules/mip-messaging/guide-policy'
import { showErrorFeedback } from '../../../../platform/feedback/client'
import { caseNavigateTo, caseRedirectTo } from '../../../../platform/navigation/client'
import { canNavigateBack } from '../../../../platform/navigation/leave'
import { clearPageMedia, updatePageMedia } from '../../../../platform/storage/component-media'
import { formatBusinessDateTime as formatChineseDateTime, formatBusinessMonthDay as formatChineseMonthDay, formatBusinessMonthDayTime as formatChineseMonthDayTime, formatBusinessTime as formatLocalTime } from '../../../../utils/business-date'

interface RegistrationFieldView extends RegistrationField {
  value: string
  checked: boolean
  selectedIndex: number
  selectedLabel: string
  currentLength: number
  error: string
}

function initialField(field: RegistrationField, answer?: string | boolean): RegistrationFieldView {
  const selectedIndex = field.type === 'SELECT' && typeof answer === 'string'
    ? (field.options || []).indexOf(answer)
    : -1
  const value = typeof answer === 'string'
    && (field.type !== 'SELECT' || selectedIndex >= 0)
    ? answer
    : ''
  return {
    ...field,
    value,
    checked: field.type === 'BOOLEAN' && answer === true,
    selectedIndex,
    selectedLabel: selectedIndex >= 0 ? field.options?.[selectedIndex] || '请选择' : '请选择',
    currentLength: value.length,
    error: '',
  }
}

function fieldsFromAnswers(event: MipEventDetail, answers: Record<string, string | boolean> = {}) {
  return event.registrationSchema.map(field => initialField(field, answers[field.key]))
}

function answersFromFields(fields: RegistrationFieldView[]) {
  return Object.fromEntries(fields.map(field => [
    field.key,
    field.type === 'BOOLEAN' ? field.checked : field.value.trim(),
  ]))
}

function requestKey(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function registrationAccessText(event: MipEventDetail) {
  if (event.accessType === 'MEMBER_INCLUDED') {
    return '玩家活动'
  }
  if (event.accessType === 'PAID') {
    return '仅玩家'
  }
  return '免费活动'
}

function registrationPriceText(event: MipEventDetail) {
  return event.accessType === 'PAID'
    ? `¥${(event.priceCents / 100).toFixed(2)}`
    : '免费'
}

/** Whole yuan prices drop the decimals (figma 1821_19274: ¥589). */
function priceAmountText(event: MipEventDetail) {
  const value = event.priceCents / 100
  return Number.isInteger(value) ? String(value) : value.toFixed(2)
}

/* Bottom-bar price follows the Figma frame: small currency symbol, large amount. */
function registrationPriceParts(event: MipEventDetail) {
  return {
    priceSymbol: event.accessType === 'PAID' ? '¥' : '',
    priceAmount: event.accessType === 'PAID' ? priceAmountText(event) : '免费',
  }
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

/** journey-review J2-08（figma 1821_19274）：订单确认页价格明细行。 */
function orderPriceTexts(event: MipEventDetail) {
  if (event.accessType === 'PAID') {
    return {
      ticketPriceText: `¥${priceAmountText(event)}`,
      totalSymbol: '¥',
      totalAmount: priceAmountText(event),
    }
  }
  const label = event.accessType === 'MEMBER_INCLUDED' ? '会员已含' : '免费'
  return { ticketPriceText: label, totalSymbol: '', totalAmount: label }
}

const DEFAULT_PURCHASE_NOTICES = [
  '一、订单确认与支付',
  '提交订单并成功支付后报名才会生效；未完成支付的订单不会保留名额，重新发起即重新创建。',
  '二、支付方式',
  '微信支付。',
  '三、订单修改与退款',
  '支付前可返回放弃本次报名；支付后如需退款，请按活动取消政策在「我的活动」中申请。',
].join('\n')

interface OrderDerived {
  startsText: string
  locationText: string
  orderNumberText: string
  orderIdText: string
  ticketPriceText: string
  totalSymbol: string
  totalAmount: string
  noticesText: string
  payLabel: string
}

function orderDerived(event: MipEventDetail, registration: MyEventRegistration | null, editing: boolean): OrderDerived {
  const orderIdText = registration?.orderId || ''
  return {
    startsText: compactEventTime(event.startsAt, event.endsAt) || formatChineseDateTime(event.startsAt),
    locationText: [event.cityName, event.venueName, event.address].filter(Boolean).join(' · ')
      || (event.mode === 'ONLINE' ? '线上活动' : '地点待公布'),
    orderNumberText: orderIdText || '支付后生成',
    orderIdText,
    ...orderPriceTexts(event),
    noticesText: event.notices || DEFAULT_PURCHASE_NOTICES,
    payLabel: editing ? '保存修改' : event.accessType === 'PAID' ? '立即支付' : '提交报名',
  }
}

function isAccessRequired(error: unknown) {
  return error instanceof MipEventsError && error.code === 'AUTH_REQUIRED'
}

Page({
  data: {
    state: 'loading' as 'loading' | 'ready' | 'blocked' | 'error' | 'submitted',
    eventId: '' as EventId,
    event: null as (Omit<MipEventDetail, 'description' | 'organizerIntroduction'>) | null,
    registration: null as MyEventRegistration | null,
    fields: [] as RegistrationFieldView[],
    editing: false,
    busy: false,
    resultTitle: '',
    resultDescription: '',
    orderId: '' as OrderId | '',
    message: '',
    invitationToken: '',
    inviteRef: '',
    resumeCheckIn: false,
    canContinueCheckIn: false,
    checkingRegistration: false,
    profileNickname: '',
    profilePhoneText: '',
    profileBranchText: '',
    cancellationText: '',
    accessText: '',
    priceText: '',
    startsText: '',
    locationText: '',
    orderNumberText: '',
    orderIdText: '',
    ticketPriceText: '',
    totalSymbol: '',
    totalAmount: '',
    noticesText: '',
    payLabel: '',
    figmaLayout: false,
  },
  submissionIdempotencyKey: '',
  pendingAccessResume: false,
  draftUserId: '',
  invitationResolution: null as Promise<void> | null,

  onLoad(query: Record<string, string>) {
    const eventId = String(query.eventId || '') as EventId
    const resumeCheckIn = query.resumeCheckIn === '1' && Boolean(mipCheckInResumeStore.peek(String(eventId)))
    this.setData({
      eventId,
      inviteRef: String(query.inviteRef || '').trim(),
      invitationToken: decodeInvitationToken(query.invitationToken),
      resumeCheckIn,
    })
    if (query.inviteRef) {
      this.invitationResolution = this.resolveInvitationRef(String(query.inviteRef))
    }
    void this.loadEvent()
  },

  async resolveInvitationRef(ref: string) {
    try {
      const resolved = await mipEventsModule.resolveInvitationScene(ref)
      if (resolved.eventId === this.data.eventId) {
        this.setData({ invitationToken: resolved.invitationToken })
      }
    }
    catch {
      this.setData({ message: '活动邀请无效或已失效，报名将不记录邀请来源。' })
    }
  },

  async onShow() {
    if (this.data.state === 'ready') {
      await this.loadProfileSummary(true)
    }
    const resume = mipIdentityModule.consumePendingResume()
    if (resume?.action === 'REGISTER_EVENT') {
      if (this.data.state === 'ready' && this.data.event) {
        void this.submit()
      }
      else {
        this.pendingAccessResume = true
      }
    }
  },

  onHide() {
    this.persistDraft()
  },

  onUnload() {
    this.persistDraft()
    clearPageMedia(this)
  },

  persistDraft() {
    if (this.data.state !== 'ready' || this.data.busy || !this.draftUserId) {
      return
    }
    mipRegistrationDraftStore.save({
      userId: this.draftUserId,
      eventId: this.data.eventId,
      registrationVersion: this.data.registration?.version ?? null,
      answers: answersFromFields(this.data.fields),
    })
  },

  async loadEvent() {
    this.setData({ state: 'loading', message: '' })
    try {
      const event = await mipEventsModule.getEvent(this.data.eventId)
      // MIW-79：富文本原始 markdown（可能含 cloud:// 插图引用）不进页面数据，
      // 页面只消费下方派生字段（noticesText/startsText/locationText 等）。
      const { description: _richDescription, organizerIntroduction: _richOrganizerIntroduction, ...presentableEvent } = event
      const presentedEvent = {
        ...presentableEvent,
        eventTypeLabel: publicEventTypeLabel(event.eventTypeLabel),
      }
      let registration: MyEventRegistration | null = null
      try {
        registration = await mipEventsModule.getMyRegistration(this.data.eventId)
      }
      catch (error) {
        if (!isAccessRequired(error)) {
          throw error
        }
      }
      const editing = registration?.canEdit === true
      const resumingPayment = registration?.status === 'PAYMENT_PENDING'
      const canCreate = !registration || ['CANCELLED', 'REJECTED'].includes(registration.status)
      if (!editing && !resumingPayment && (!canCreate || !event.canRegister)) {
        this.submissionIdempotencyKey = ''
        this.setData({
          state: 'blocked',
          event: presentedEvent,
          registration,
          fields: [],
          editing: false,
          message: registration
            ? '当前报名状态或活动时间不支持修改。'
            : '当前不在报名时间内。',
        })
        return
      }
      this.submissionIdempotencyKey = ''
      await this.loadProfileSummary(true)
      wx.setNavigationBarTitle({ title: editing ? '修改报名' : '活动报名' })
      this.setData({
        state: 'ready',
        event: presentedEvent,
        registration: editing || resumingPayment ? registration : null,
        fields: fieldsFromAnswers(event, editing || resumingPayment ? registration?.answers : undefined),
        editing,
        cancellationText: event.cancellationDeadline
          ? `${formatChineseDateTime(event.cancellationDeadline)} 前可申请取消`
          : '是否可以取消以活动当前状态为准',
        accessText: registrationAccessText(event),
        priceText: registrationPriceText(event),
        ...registrationPriceParts(event),
        ...orderDerived(event, editing || resumingPayment ? registration : null, editing),
      })
      // 封面与详情页同一条本地下载管道：cloud:// 先隐藏，解析成临时路径后再渲染。
      updatePageMedia(this, 'event.coverUrl', event.coverUrl || '')
      if (this.pendingAccessResume) {
        this.pendingAccessResume = false
        this.setData({ message: '身份已确认，请核对报名信息后提交。' })
      }
      const draft = mipRegistrationDraftStore.load(this.draftUserId, this.data.eventId, this.data.registration?.version ?? null)
      if (draft) {
        this.setData({ fields: fieldsFromAnswers(event, draft.answers), message: '已恢复未提交的报名信息，请核对后提交。' })
      }
    }
    catch (error) {
      this.setData({ state: 'error', message: error instanceof Error ? error.message : '活动加载失败' })
    }
  },

  onTextInput(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    if (this.data.busy) {
      return
    }
    const index = Number(event.currentTarget.dataset.index)
    const fields = this.data.fields.map((field, fieldIndex) => fieldIndex === index
      ? { ...field, value: event.detail.value, currentLength: event.detail.value.length, error: '' }
      : field)
    this.submissionIdempotencyKey = ''
    this.setData({ fields, message: '' })
    this.persistDraft()
  },

  onSelectChange(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    if (this.data.busy) {
      return
    }
    const index = Number(event.currentTarget.dataset.index)
    const selectedIndex = Number(event.detail.value)
    const fields = this.data.fields.map((field, fieldIndex) => fieldIndex === index
      ? {
          ...field,
          selectedIndex,
          selectedLabel: field.options?.[selectedIndex] || '请选择',
          value: field.options?.[selectedIndex] || '',
          error: '',
        }
      : field)
    this.submissionIdempotencyKey = ''
    this.setData({ fields, message: '' })
    this.persistDraft()
  },

  onBooleanChange(event: WechatMiniprogram.CustomEvent<{ value: boolean }>) {
    if (this.data.busy) {
      return
    }
    const index = Number(event.currentTarget.dataset.index)
    const fields = this.data.fields.map((field, fieldIndex) => fieldIndex === index
      ? { ...field, checked: event.detail.value, error: '' }
      : field)
    this.submissionIdempotencyKey = ''
    this.setData({ fields, message: '' })
    this.persistDraft()
  },

  validate() {
    let firstInvalidLabel = ''
    const fields = this.data.fields.map((field) => {
      const missing = field.required && (field.type === 'BOOLEAN' ? !field.checked : !field.value.trim())
      const tooLong = Boolean(field.maxLength && field.value.length > field.maxLength)
      const error = missing
        ? `${field.label}为必填项`
        : tooLong
          ? `${field.label}不能超过 ${field.maxLength} 个字`
          : ''
      if (error && !firstInvalidLabel) {
        firstInvalidLabel = field.label
      }
      return { ...field, error }
    })
    this.setData({ fields })
    if (firstInvalidLabel) {
      const message = `请检查${firstInvalidLabel}`
      this.setData({ message })
      showErrorFeedback(message)
      wx.pageScrollTo({ selector: `#registration-field-${fields.findIndex(field => Boolean(field.error))}`, duration: 200 })
      return false
    }
    return true
  },

  async submit() {
    const event = this.data.event
    if (!event || this.data.busy || !this.validate()) {
      return
    }
    // MIW-77：订阅授权不做开屏弹层/常驻模块（设计稿无此形态），只在「提交报名」
    // tap 手势内同步拉起原生活动提醒面板（validate 全同步，手势上下文未断）。
    // 节奏 24h 一次、已入账/总是拒绝静默跳过；面板结果与失败都不拦截报名。
    void requestEntrySubscription('EVENT_REMINDER', GUIDE_EVENT_REGISTER_KEY)
    const answers = answersFromFields(this.data.fields)
    if (!this.submissionIdempotencyKey) {
      this.submissionIdempotencyKey = requestKey(this.data.editing ? 'event-registration-update' : 'event-registration')
    }
    this.setData({ busy: true, message: '' })
    try {
      await this.invitationResolution
      if (this.data.editing) {
        const registration = this.data.registration
        if (!registration?.canEdit) {
          this.setData({ state: 'blocked', message: '当前报名状态或活动时间不支持修改。' })
          return
        }
        const updated = await mipEventsModule.updateRegistration({
          eventId: this.data.eventId,
          formVersion: event.formVersion,
          expectedVersion: registration.version,
          answers,
          idempotencyKey: this.submissionIdempotencyKey,
        })
        this.submissionIdempotencyKey = ''
        mipRegistrationDraftStore.remove(this.draftUserId, this.data.eventId)
        this.setData({
          state: 'submitted',
          registration: updated,
          resultTitle: '报名已修改',
          resultDescription: '报名信息已保存。',
          canContinueCheckIn: updated.status === 'REGISTERED' && this.data.resumeCheckIn,
        })
        return
      }
      const result = await mipEventsModule.register({
        eventId: this.data.eventId,
        formVersion: event.formVersion,
        answers,
        invitationToken: this.data.invitationToken || undefined,
        idempotencyKey: this.submissionIdempotencyKey,
      })
      mipRegistrationDraftStore.remove(this.draftUserId, this.data.eventId)
      void this.refreshInvitationAttribution()
      this.submissionIdempotencyKey = ''
      if (result.kind === 'PAYMENT_REQUIRED') {
        let resultTitle = '报名待支付'
        let canContinueCheckIn = false
        let resultDescription = result.paymentAvailable
          ? '订单尚未支付，报名尚未生效。完成支付并确认报名资格后，报名才会生效。'
          : '支付服务尚未配置，报名尚未生效。'
        if (result.paymentAvailable) {
          try {
            const payment = await mipCommerceModule.payOrder(result.orderId)
            if (payment.kind === 'CONFIRMED') {
              // MIW-106（客户口径 2026-10-14）：报名支付成功直接 toast「支付成功」并返回
              // 活动详情页（onShow 缓存已被 register() 失效，回页即呈现已报名态），不再停在
              // 结果态等手动返回。签到续办流除外：结果态「继续签到」是唯一动线，自动返回会
              // 迫使用户重新扫码。state 先置 submitted，避免 finally 的 persistDraft 把已完成
              // 的报名回写成草稿。
              if (!this.data.resumeCheckIn) {
                this.setData({
                  state: 'submitted',
                  resultTitle: '支付成功',
                  resultDescription: '支付已确认，活动报名资格已生效。',
                  orderId: result.orderId,
                })
                wx.showToast({ title: '支付成功', icon: 'success' })
                this.returnToEventDetail()
                return
              }
              const registrationReady = await this.registrationReadyForCheckIn()
              resultTitle = registrationReady ? '报名成功' : '支付已确认'
              resultDescription = registrationReady
                ? '支付已确认，报名资格已生效。'
                : '支付已确认，报名资格仍在同步，请稍后重新核对。'
              canContinueCheckIn = registrationReady && this.data.resumeCheckIn
            }
            else if (payment.kind === 'CANCELLED') {
              resultTitle = '报名待支付'
              resultDescription = '支付已取消，订单尚未支付，报名尚未生效。完成支付并确认报名资格后，报名才会生效。'
            }
            else {
              resultTitle = '报名待确认'
              resultDescription = '支付结果正在确认，可在订单中查看状态。'
            }
          }
          catch {
            resultTitle = '报名待确认'
            resultDescription = '订单已创建，可在订单中继续支付。'
          }
        }
        this.setData({
          state: 'submitted',
          resultTitle,
          resultDescription,
          orderId: result.orderId,
          canContinueCheckIn,
        })
      }
      else {
        const presentation = result.kind === 'REGISTERED'
          ? { title: '报名成功', description: '报名资格已确认。' }
          : result.kind === 'WAITLISTED'
            ? { title: '已进入候补', description: result.waitlistPosition ? `当前候补第 ${result.waitlistPosition} 位。` : '有名额后会更新报名状态。' }
            : { title: '报名已提交', description: '审核结果会通过站内消息通知。' }
        this.setData({
          state: 'submitted',
          resultTitle: presentation.title,
          resultDescription: presentation.description,
          orderId: '',
          canContinueCheckIn: result.kind === 'REGISTERED' && this.data.resumeCheckIn,
        })
      }
    }
    catch (error) {
      if (error instanceof MipEventsError && error.code === 'CONFLICT') {
        await this.recoverUpdateConflict(answers)
      }
      else if (error instanceof MipEventsError && ['AUTH_REQUIRED', 'AGREEMENT_REQUIRED', 'PHONE_REQUIRED', 'PROFILE_REQUIRED'].includes(error.code)) {
        try {
          const session = await mipIdentityModule.beginProtectedAction({
            action: 'REGISTER_EVENT',
            source: {
              navigation: 'navigateBack',
              route: '/packages/member/mip-events/registration/index',
              query: {
                eventId: this.data.eventId,
                ...(this.data.inviteRef ? { inviteRef: this.data.inviteRef } : {}),
                ...(this.data.resumeCheckIn ? { resumeCheckIn: '1' } : {}),
              },
            },
          })
          if (session.decision.ready) {
            this.setData({ message: '身份状态已更新，请重新提交。' })
          }
          else {
            caseNavigateTo({ url: mipAccessPageUrl(session.token) })
          }
        }
        catch {
          const message = '身份状态暂时无法确认，请稍后重试。'
          this.setData({ message })
          showErrorFeedback(message)
        }
      }
      else {
        const message = showErrorFeedback(error, '报名提交失败，请稍后重试。')
        this.setData({ message })
      }
    }
    finally {
      this.setData({ busy: false })
      this.persistDraft()
    }
  },

  async loadProfileSummary(force = false) {
    try {
      const snapshot = force ? await mipIdentityModule.loadSnapshot() : mipIdentityModule.peekSnapshot() || await mipIdentityModule.loadSnapshot()
      this.draftUserId = snapshot.userId || ''
      let profileBranchText = snapshot.primaryBranchId ? '主分会已设置' : '主分会未设置'
      if (snapshot.primaryBranchId) {
        const branchSnapshot = mipBranchesModule.peek()
          || await mipBranchesModule.load(snapshot.primaryBranchId, snapshot.userVersion)
        const branch = branchSnapshot.branches.find(item => item.id === snapshot.primaryBranchId)
        profileBranchText = branch ? `${branch.name} · ${branch.cityName}` : profileBranchText
      }
      this.setData({
        profileNickname: snapshot.profile.nickname || '昵称未设置',
        profilePhoneText: snapshot.phoneBound ? '手机号已绑定' : '手机号未绑定',
        profileBranchText,
      })
    }
    catch {
      this.setData({
        profileNickname: '资料尚未完成',
        profilePhoneText: '手机号状态待确认',
        profileBranchText: '主分会状态待确认',
      })
    }
  },

  async refreshInvitationAttribution() {
    try {
      const event = await mipEventsModule.getEvent(this.data.eventId, { force: true })
      this.setData({ event })
    }
    catch {}
  },

  copyOrderId() {
    const orderId = this.data.orderIdText
    if (!orderId) {
      return
    }
    wx.setClipboardData({
      data: orderId,
      success: () => wx.showToast({ title: '订单号已复制', icon: 'success' }),
    })
  },

  openAgreement() {
    caseNavigateTo({ url: '/packages/member/user-agreement/index' })
  },

  openPrivacy() {
    caseNavigateTo({ url: '/packages/member/privacy-policy/index' })
  },

  async recoverUpdateConflict(
    draftAnswers: Record<string, string | boolean>,
  ) {
    this.submissionIdempotencyKey = ''
    try {
      const event = await mipEventsModule.getEvent(this.data.eventId, { force: true })
      const registration = await mipEventsModule.getMyRegistration(this.data.eventId)
      const editing = registration?.canEdit === true
      const resumingPayment = registration?.status === 'PAYMENT_PENDING'
      const canCreate = resumingPayment || ((!registration || ['CANCELLED', 'REJECTED'].includes(registration.status)) && event.canRegister)
      if (!editing && !canCreate) {
        this.setData({
          state: 'blocked',
          event,
          registration,
          message: '报名状态或活动时间已变化，当前不能提交报名。',
        })
        return
      }
      this.setData({
        state: 'ready',
        event,
        registration: editing || resumingPayment ? registration : null,
        fields: fieldsFromAnswers(event, { ...(registration?.answers || {}), ...draftAnswers }),
        editing,
        accessText: registrationAccessText(event),
        priceText: registrationPriceText(event),
        ...registrationPriceParts(event),
        ...orderDerived(event, editing || resumingPayment ? registration : null, editing),
        message: '报名信息已更新，当前填写内容已保留，请确认后重新保存。',
      })
      this.persistDraft()
    }
    catch {
      this.setData({ message: '报名信息已变化，最新内容加载失败。请稍后重试。' })
    }
  },

  async registrationReadyForCheckIn() {
    try {
      const registration = await mipEventsModule.getMyRegistration(this.data.eventId)
      return registration !== null && ['REGISTERED', 'ATTENDED'].includes(registration.status)
    }
    catch {
      return false
    }
  },

  async retryRegistration() {
    if (this.data.checkingRegistration) {
      return
    }
    this.setData({ checkingRegistration: true })
    const registrationReady = await this.registrationReadyForCheckIn()
    this.setData({
      checkingRegistration: false,
      canContinueCheckIn: registrationReady && this.data.resumeCheckIn,
      resultTitle: registrationReady ? '报名成功' : this.data.resultTitle,
      resultDescription: registrationReady
        ? '报名资格已生效，可以继续签到。'
        : '报名资格尚未生效，请稍后重试或查看订单详情。',
    })
  },

  async continueCheckIn() {
    if (!this.data.canContinueCheckIn || !mipCheckInResumeStore.peek(String(this.data.eventId))) {
      this.setData({
        canContinueCheckIn: false,
        resultDescription: '请重新扫描现场签到码。',
      })
      return
    }
    caseNavigateTo({
      url: `/packages/member/mip-events/check-in/index?eventId=${encodeURIComponent(this.data.eventId)}&resumeCheckIn=1`,
    })
  },

  /** MIW-106：支付成功返回活动详情页；分享直达报名页（无返回栈）时落地到详情页。 */
  returnToEventDetail() {
    if (canNavigateBack()) {
      wx.navigateBack()
      return
    }
    caseRedirectTo({ url: `/packages/member/mip-events/detail/index?eventId=${encodeURIComponent(this.data.eventId)}` })
  },

  openMine() {
    caseNavigateTo({ url: '/packages/member/mip-events/mine/index' })
  },

  openOrder() {
    if (!this.data.orderId) {
      return
    }
    caseNavigateTo({
      url: `/packages/member/order-detail/index?orderId=${encodeURIComponent(this.data.orderId)}`,
    })
  },
})
