import type { EventId, OrderId } from '../../../../modules/mip'
import type { MipEventDetail, MyEventRegistration, RegistrationField } from '../../../../modules/mip-events'
import { mipCommerceModule } from '../../../../modules/mip-commerce/client'
import { MipEventsError } from '../../../../modules/mip-events'
import { mipEventsModule } from '../../../../modules/mip-events/client'
import { mipAccessPageUrl } from '../../../../modules/mip-identity'
import { mipBranchesModule, mipIdentityModule } from '../../../../modules/mip-identity/client'
import { mipMessagingModule } from '../../../../modules/mip-messaging/client'
import { caseNavigateTo } from '../../../../modules/platform/case-navigation'

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

function formatDateTime(value: string) {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) {
    return ''
  }
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

function isAccessRequired(error: unknown) {
  return error instanceof MipEventsError && error.code === 'AUTH_REQUIRED'
}

Page({
  data: {
    state: 'loading' as 'loading' | 'ready' | 'blocked' | 'error' | 'submitted',
    eventId: '' as EventId,
    event: null as MipEventDetail | null,
    registration: null as MyEventRegistration | null,
    fields: [] as RegistrationFieldView[],
    editing: false,
    shareProfile: false,
    busy: false,
    resultTitle: '',
    resultDescription: '',
    orderId: '' as OrderId | '',
    message: '',
    invitationToken: '',
    checkInToken: '',
    canContinueCheckIn: false,
    profileNickname: '',
    profilePhoneText: '',
    profileBranchText: '',
    cancellationText: '',
  },
  submissionIdempotencyKey: '',
  pendingAccessResume: false,

  onLoad(query: Record<string, string>) {
    this.setData({
      eventId: String(query.eventId || '') as EventId,
      invitationToken: query.invitationToken ? decodeURIComponent(query.invitationToken) : '',
      checkInToken: query.checkInToken ? decodeURIComponent(query.checkInToken) : '',
    })
    void this.loadEvent()
  },

  onShow() {
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

  async loadEvent() {
    this.setData({ state: 'loading', message: '' })
    try {
      const event = await mipEventsModule.getEvent(this.data.eventId)
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
      const canCreate = !registration || ['CANCELLED', 'REJECTED'].includes(registration.status)
      if (!editing && (!canCreate || !event.canRegister)) {
        this.submissionIdempotencyKey = ''
        this.setData({
          state: 'blocked',
          event,
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
      wx.setNavigationBarTitle({ title: editing ? '修改报名' : '确认报名' })
      this.setData({
        state: 'ready',
        event,
        registration: editing ? registration : null,
        fields: fieldsFromAnswers(event, editing ? registration?.answers : undefined),
        editing,
        shareProfile: editing ? registration?.shareProfile === true : false,
        cancellationText: event.cancellationDeadline
          ? `${formatDateTime(event.cancellationDeadline)} 前可申请取消`
          : '是否可以取消以活动当前状态为准',
      })
      if (this.pendingAccessResume) {
        this.pendingAccessResume = false
        this.setData({ message: '身份已确认，请核对报名信息后提交。' })
      }
      void this.loadProfileSummary()
    }
    catch (error) {
      this.setData({ state: 'error', message: error instanceof Error ? error.message : '活动加载失败' })
    }
  },

  onTextInput(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    const index = Number(event.currentTarget.dataset.index)
    const fields = this.data.fields.map((field, fieldIndex) => fieldIndex === index
      ? { ...field, value: event.detail.value, currentLength: event.detail.value.length, error: '' }
      : field)
    this.submissionIdempotencyKey = ''
    this.setData({ fields, message: '' })
  },

  onSelectChange(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
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
  },

  onBooleanChange(event: WechatMiniprogram.CustomEvent<{ value: boolean }>) {
    const index = Number(event.currentTarget.dataset.index)
    const fields = this.data.fields.map((field, fieldIndex) => fieldIndex === index
      ? { ...field, checked: event.detail.value, error: '' }
      : field)
    this.submissionIdempotencyKey = ''
    this.setData({ fields, message: '' })
  },

  onShareProfileChange(event: WechatMiniprogram.CustomEvent<{ value: boolean }>) {
    this.submissionIdempotencyKey = ''
    this.setData({ shareProfile: event.detail.value, message: '' })
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
      this.setData({ message: `请检查${firstInvalidLabel}` })
      return false
    }
    return true
  },

  async submit() {
    const event = this.data.event
    if (!event || this.data.busy || !this.validate()) {
      return
    }
    const answers = answersFromFields(this.data.fields)
    if (!this.submissionIdempotencyKey) {
      this.submissionIdempotencyKey = requestKey(this.data.editing ? 'event-registration-update' : 'event-registration')
    }
    this.setData({ busy: true, message: '' })
    try {
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
          shareProfile: this.data.shareProfile,
          idempotencyKey: this.submissionIdempotencyKey,
        })
        this.submissionIdempotencyKey = ''
        this.setData({
          state: 'submitted',
          registration: updated,
          resultTitle: '报名已修改',
          resultDescription: '报名信息已保存。',
          canContinueCheckIn: updated.status === 'REGISTERED' && Boolean(this.data.checkInToken),
        })
        return
      }
      const result = await mipEventsModule.register({
        eventId: this.data.eventId,
        formVersion: event.formVersion,
        answers,
        shareProfile: this.data.shareProfile,
        invitationToken: this.data.invitationToken || undefined,
        idempotencyKey: this.submissionIdempotencyKey,
      })
      void this.refreshInvitationAttribution()
      this.submissionIdempotencyKey = ''
      if (result.kind === 'PAYMENT_REQUIRED') {
        let resultTitle = '报名订单已创建'
        let canContinueCheckIn = false
        let resultDescription = result.paymentAvailable
          ? '请完成支付。支付确认后报名生效。'
          : '支付服务尚未配置，报名尚未生效。'
        if (result.paymentAvailable) {
          try {
            const payment = await mipCommerceModule.payOrder(result.orderId)
            if (payment.kind === 'CONFIRMED') {
              resultTitle = '报名成功'
              resultDescription = '支付已确认，报名资格已生效。'
              canContinueCheckIn = Boolean(this.data.checkInToken)
            }
            else if (payment.kind === 'CANCELLED') {
              resultDescription = '支付已取消，可在订单中继续支付。'
            }
            else {
              resultDescription = '支付结果正在确认，可在订单中查看状态。'
            }
          }
          catch {
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
          canContinueCheckIn: result.kind === 'REGISTERED' && Boolean(this.data.checkInToken),
        })
      }
    }
    catch (error) {
      if (this.data.editing && error instanceof MipEventsError && error.code === 'CONFLICT') {
        await this.recoverUpdateConflict(answers, this.data.shareProfile)
      }
      else if (error instanceof MipEventsError && ['AUTH_REQUIRED', 'AGREEMENT_REQUIRED', 'PHONE_REQUIRED', 'PROFILE_REQUIRED'].includes(error.code)) {
        try {
          const session = await mipIdentityModule.beginProtectedAction({
            action: 'REGISTER_EVENT',
            source: {
              navigation: 'navigateBack',
              route: '/packages/member/mip-events/registration/index',
              query: { eventId: this.data.eventId },
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
          this.setData({ message: '身份状态暂时无法确认，请稍后重试。' })
        }
      }
      else {
        this.setData({ message: error instanceof Error ? error.message : '报名提交失败' })
      }
    }
    finally {
      this.setData({ busy: false })
    }
  },

  async loadProfileSummary() {
    try {
      const snapshot = mipIdentityModule.peekSnapshot() || await mipIdentityModule.loadSnapshot()
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

  openProfile() {
    caseNavigateTo({ url: '/packages/member/mip-profile/index' })
  },

  openAgreement() {
    caseNavigateTo({ url: '/packages/member/user-agreement/index' })
  },

  openPrivacy() {
    caseNavigateTo({ url: '/packages/member/privacy/index' })
  },

  async recoverUpdateConflict(
    draftAnswers: Record<string, string | boolean>,
    draftShareProfile: boolean,
  ) {
    this.submissionIdempotencyKey = ''
    try {
      const event = await mipEventsModule.getEvent(this.data.eventId, { force: true })
      const registration = await mipEventsModule.getMyRegistration(this.data.eventId)
      if (!registration?.canEdit) {
        this.setData({
          state: 'blocked',
          event,
          registration,
          message: '报名状态或活动时间已变化，当前不能继续修改。',
        })
        return
      }
      this.setData({
        state: 'ready',
        event,
        registration,
        fields: fieldsFromAnswers(event, { ...registration.answers, ...draftAnswers }),
        shareProfile: draftShareProfile,
        editing: true,
        message: '报名信息已更新，当前填写内容已保留，请确认后重新保存。',
      })
    }
    catch {
      this.setData({ message: '报名信息已变化，最新内容加载失败。请稍后重试。' })
    }
  },

  async continueCheckIn() {
    if (!this.data.canContinueCheckIn || !this.data.checkInToken) {
      return
    }
    if (mipMessagingModule.subscriptionCapability('CHECKIN_RESULT').available) {
      await mipMessagingModule.requestWechatSubscription('CHECKIN_RESULT').catch(() => undefined)
    }
    caseNavigateTo({
      url: `/packages/member/mip-events/check-in/index?eventId=${encodeURIComponent(this.data.eventId)}&token=${encodeURIComponent(this.data.checkInToken)}`,
    })
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
