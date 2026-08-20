import type {
  EventDetail,
  RegistrationAnswers,
  RegistrationQuestion,
} from '../../../modules/membership/types'
import { membershipModule } from '../../../modules/membership/client'
import { caseNavigateTo, caseRedirectTo } from '../../../modules/platform/case-navigation'

interface RegistrationQuestionView extends RegistrationQuestion {
  value: string | number | boolean | string[] | null
  selectedIndex: number
  selectedText: string
  optionViews: Array<{ label: string, checked: boolean }>
}

function questionViews(event: EventDetail, editing = false): RegistrationQuestionView[] {
  return event.registrationForm.map((question) => {
    const savedValue = editing && Object.hasOwn(event.registrationAnswers, question.id)
      ? event.registrationAnswers[question.id]
      : undefined
    const value = savedValue ?? question.prefillValue ?? (
      question.type === 'MULTI_CHOICE'
        ? []
        : question.type === 'BOOLEAN'
          ? false
          : ''
    )
    const selectedOptionIndex = question.type === 'SINGLE_CHOICE'
      ? question.options.indexOf(String(value || ''))
      : -1
    const selectedIndex = Math.max(0, selectedOptionIndex)
    const selectedValues = Array.isArray(value) ? value : []
    return {
      ...question,
      value,
      selectedIndex,
      selectedText: question.type === 'SINGLE_CHOICE'
        ? (selectedOptionIndex >= 0 ? question.options[selectedOptionIndex] : '请选择')
        : '',
      optionViews: question.options.map(label => ({
        label,
        checked: selectedValues.includes(label),
      })),
    }
  })
}

function missingRequiredValue(question: RegistrationQuestionView) {
  if (!question.required) {
    return false
  }
  if (question.type === 'BOOLEAN') {
    return question.value !== true
  }
  if (question.type === 'MULTI_CHOICE') {
    return !Array.isArray(question.value) || question.value.length === 0
  }
  return typeof question.value !== 'number'
    && (typeof question.value !== 'string' || !question.value.trim())
}

function validIdCard(value: string) {
  const id = value.trim().toUpperCase()
  if (!/^\d{17}[\dX]$/.test(id)) {
    return false
  }
  const weights = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2]
  const checks = ['1', '0', 'X', '9', '8', '7', '6', '5', '4', '3', '2']
  const sum = weights.reduce((total, weight, index) => total + Number(id[index]) * weight, 0)
  return checks[sum % 11] === id[17]
}

function registrationHint(event: EventDetail, editing: boolean) {
  if (editing) {
    return '只修改本次报名资料，不会覆盖个人名片。'
  }
  if (event.registrationMode === 'APPROVAL') {
    return '提交后由主办方审核，结果会显示在“我的活动”。'
  }
  if (event.waitlistEnabled && event.capacity && event.registrationCount >= event.capacity) {
    return '当前名额已满，提交后将按顺序进入候补。'
  }
  return '提交后可在“我的活动”查看报名状态与凭证。'
}

Page({
  data: {
    state: 'loading' as 'loading' | 'ready' | 'error',
    eventId: '',
    event: null as EventDetail | null,
    editing: false,
    priceText: '',
    registrationHint: '',
    profileReady: false,
    shareProfile: true,
    questions: [] as RegistrationQuestionView[],
    busy: false,
    message: '',
  },
  requestSeq: 0,

  onLoad(query: Record<string, string>) {
    this.setData({
      eventId: query.eventId || '',
      editing: query.mode === 'edit',
    })
    void this.load()
  },

  async load() {
    const cached = membershipModule.peekEvent(this.data.eventId)
    if (cached && this.data.state !== 'ready') {
      this.setData({
        state: 'ready',
        event: cached,
        priceText: cached.memberFree ? '会员免费' : cached.priceCents ? `¥${(cached.priceCents / 100).toFixed(2)}` : '免费',
        registrationHint: registrationHint(cached, this.data.editing),
        profileReady: cached.phoneBound,
        shareProfile: this.data.editing ? cached.registrationSharesProfile : true,
        questions: questionViews(cached, this.data.editing),
        message: '',
      })
    }
    else if (this.data.state !== 'ready') {
      this.setData({ state: 'loading', message: '' })
    }
    const seq = this.requestSeq + 1
    this.requestSeq = seq
    try {
      // EventDetail already carries the server-authoritative phone and
      // membership capability needed by this page. Avoid a second overview
      // request so the confirmation surface has one coherent loading state.
      const event = await membershipModule.getEvent(this.data.eventId)
      if (seq !== this.requestSeq) {
        return
      }
      this.setData({
        state: 'ready',
        event,
        priceText: event.memberFree ? '会员免费' : event.priceCents ? `¥${(event.priceCents / 100).toFixed(2)}` : '免费',
        registrationHint: registrationHint(event, this.data.editing),
        profileReady: event.phoneBound,
        shareProfile: this.data.editing ? event.registrationSharesProfile : this.data.shareProfile,
        questions: questionViews(event, this.data.editing),
        message: '',
      })
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

  updateAnswer(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    const index = Number(event.currentTarget.dataset.index)
    if (!Number.isInteger(index) || !this.data.questions[index]) {
      return
    }
    this.setData({ [`questions[${index}].value`]: event.detail.value })
  },

  chooseSingle(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    const index = Number(event.currentTarget.dataset.index)
    const optionIndex = Number(event.detail.value)
    const question = this.data.questions[index]
    if (!question || !Number.isInteger(optionIndex) || !question.options[optionIndex]) {
      return
    }
    this.setData({
      [`questions[${index}].selectedIndex`]: optionIndex,
      [`questions[${index}].selectedText`]: question.options[optionIndex],
      [`questions[${index}].value`]: question.options[optionIndex],
    })
  },

  chooseMultiple(event: WechatMiniprogram.CustomEvent<{ value: string[] }>) {
    const index = Number(event.currentTarget.dataset.index)
    const question = this.data.questions[index]
    if (!Number.isInteger(index) || !question) {
      return
    }
    const values = event.detail.value
    this.setData({
      [`questions[${index}].value`]: values,
      [`questions[${index}].optionViews`]: question.optionViews.map(option => ({
        ...option,
        checked: values.includes(option.label),
      })),
    })
  },

  toggleBoolean(event: WechatMiniprogram.CustomEvent<{ value: boolean }>) {
    const index = Number(event.currentTarget.dataset.index)
    if (!Number.isInteger(index) || !this.data.questions[index]) {
      return
    }
    this.setData({ [`questions[${index}].value`]: Boolean(event.detail.value) })
  },

  toggleShareProfile(event: WechatMiniprogram.CustomEvent<{ value: boolean }>) {
    this.setData({ shareProfile: Boolean(event.detail.value) })
  },

  async confirm() {
    if (!this.data.event || this.data.busy) {
      return
    }
    if (!this.data.profileReady) {
      caseNavigateTo({ url: `/packages/member/access/index?reason=event&eventId=${encodeURIComponent(this.data.eventId)}` })
      return
    }
    if (this.data.event.memberFree && !this.data.event.membershipActive) {
      caseNavigateTo({ url: '/pages/membership/index' })
      return
    }
    const invalidIndex = this.data.questions.findIndex(missingRequiredValue)
    if (invalidIndex >= 0) {
      const question = this.data.questions[invalidIndex]
      const message = question.type === 'BOOLEAN'
        ? `请确认“${question.label}”`
        : `请填写“${question.label}”`
      this.setData({ message })
      wx.showToast({ title: message, icon: 'none' })
      wx.nextTick(() => {
        wx.pageScrollTo({
          selector: `#registration-question-${invalidIndex}`,
          duration: 220,
        })
      })
      return
    }
    const invalidNumberIndex = this.data.questions.findIndex(question =>
      question.type === 'NUMBER'
      && question.value !== ''
      && !Number.isFinite(Number(question.value)),
    )
    if (invalidNumberIndex >= 0) {
      const message = `请填写有效的“${this.data.questions[invalidNumberIndex].label}”`
      this.setData({ message })
      wx.showToast({ title: message, icon: 'none' })
      return
    }
    const invalidIdentityIndex = this.data.questions.findIndex((question) => {
      const value = typeof question.value === 'string' ? question.value.trim() : ''
      if (!value) {
        return false
      }
      return question.type === 'PHONE'
        ? !/^1[3-9]\d{9}$/.test(value)
        : question.type === 'ID_CARD' ? !validIdCard(value) : false
    })
    if (invalidIdentityIndex >= 0) {
      const question = this.data.questions[invalidIdentityIndex]
      const message = `请填写有效的“${question.label}”`
      this.setData({ message })
      wx.showToast({ title: message, icon: 'none' })
      return
    }
    this.setData({ busy: true, message: '' })
    try {
      const answers = Object.fromEntries(
        this.data.questions.map(question => [question.id, question.value]),
      ) as RegistrationAnswers
      if (this.data.editing) {
        if (!this.data.event.canEditRegistration || !this.data.event.registrationVersion) {
          throw new Error('当前报名资料不可修改')
        }
        await membershipModule.updateRegistration(
          this.data.eventId,
          this.data.event.formVersion,
          answers,
          this.data.shareProfile,
          this.data.event.registrationVersion,
        )
        wx.showToast({ title: '报名资料已更新', icon: 'success' })
        caseRedirectTo({
          url: `/packages/member/event-detail/index?eventId=${encodeURIComponent(this.data.eventId)}`,
        })
        return
      }
      const outcome = await membershipModule.registerEvent(
        this.data.eventId,
        this.data.event.formVersion,
        answers,
        this.data.shareProfile,
      )
      if (outcome.kind === 'PAYMENT_CANCELLED') {
        this.setData({ message: '已取消付款，报名名额会在保留时间结束后自动释放。' })
        return
      }
      if (outcome.kind === 'PAYMENT_PENDING') {
        caseRedirectTo({
          url: `/packages/member/payment-result/index?orderId=${encodeURIComponent(outcome.orderId)}&eventId=${encodeURIComponent(this.data.eventId)}`,
        })
        return
      }
      if (outcome.kind === 'REGISTERED'
        && (outcome.status === 'PENDING_REVIEW' || outcome.status === 'WAITLISTED')) {
        wx.showToast({
          title: outcome.status === 'PENDING_REVIEW' ? '报名申请已提交' : '已加入候补',
          icon: 'success',
        })
        caseRedirectTo({
          url: `/packages/member/event-detail/index?eventId=${encodeURIComponent(this.data.eventId)}`,
        })
        return
      }
      caseRedirectTo({
        url: `/packages/member/ticket/index?eventId=${encodeURIComponent(this.data.eventId)}`,
      })
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '报名失败，请重试' })
    }
    finally {
      this.setData({ busy: false })
    }
  },
})
