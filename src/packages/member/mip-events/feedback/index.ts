import type { CooperationRoleKey, EventId } from '../../../../modules/mip'
import type { EventFeedback, EventFeedbackAnswers, MipEventDetail } from '../../../../modules/mip-events'
import { cooperationRoles } from '../../../../config/mip-catalogs'
import { isEventAccessRequirementError, MipEventsError, publicEventTypeLabel } from '../../../../modules/mip-events'
import { mipEventsModule } from '../../../../modules/mip-events/client'
import { mipAccessPageUrl } from '../../../../modules/mip-identity'
import { mipIdentityModule } from '../../../../modules/mip-identity/client'
import { caseNavigateTo } from '../../../../platform/navigation/client'
import { formatChineseMonthDay, formatChineseMonthDayTime, formatLocalTime } from '../../../../utils/date'

type PageState = 'loading' | 'ready' | 'access' | 'blocked' | 'error' | 'conflict'
type Recommendation = EventFeedbackAnswers['recommendation'] | ''
type JoinIntent = EventFeedbackAnswers['joinIntent'] | ''
type ExplorationMethod = EventFeedbackAnswers['explorationMethods'][number]
type RosterConsent = EventFeedbackAnswers['rosterConsent'] | ''

interface SelectableRole {
  key: CooperationRoleKey
  name: string
  selected: boolean
}

interface SelectableStar {
  value: number
  selected: boolean
}

interface SelectableExplorationMethod {
  key: ExplorationMethod
  label: string
  selected: boolean
}

interface JoinIntentOption {
  value: Exclude<JoinIntent, ''>
  label: string
}

const PAGE_ROUTE = 'packages/member/mip-events/feedback/index'
const ATTENDANCE_REQUIRED_MESSAGE = '完成签到后可填写本场活动反馈。'
const starValues = [1, 2, 3, 4, 5]
const roleDisplayOrder: CooperationRoleKey[] = [
  'connector',
  'strategist',
  'capital_operator',
  'visual_designer',
  'business_builder',
  'delivery_lead',
]
const explorationDefinitions: Array<{ key: ExplorationMethod, label: string }> = [
  { key: 'ATTEND_EVENT', label: '再来参加 MIP 的早会' },
  { key: 'COMMUNITY_CHAT', label: '跟我的邀请人和 MIP 其他玩家一起聊聊' },
]
const joinIntentOptions: JoinIntentOption[] = [
  { value: 'JOIN_NOW', label: '有意愿，立即加入' },
  { value: 'LEARN_MORE', label: '不明确，待深入了解' },
  { value: 'NOT_INTERESTED', label: '无意愿' },
]

function eventAccessText(event: MipEventDetail) {
  if (event.accessType === 'MEMBER_INCLUDED') {
    return '仅玩家'
  }
  if (event.accessType === 'PAID') {
    return '付费活动'
  }
  return '免费活动'
}

function eventTimeText(startsAt: string, endsAt: string) {
  const startsDay = formatChineseMonthDay(startsAt)
  const endsDay = formatChineseMonthDay(endsAt)
  if (!startsDay || !endsDay) {
    return ''
  }
  return startsDay === endsDay
    ? `${startsDay} ${formatLocalTime(startsAt)}-${formatLocalTime(endsAt)}`
    : `${formatChineseMonthDayTime(startsAt)} 至 ${formatChineseMonthDayTime(endsAt)}`
}

function roleOptions(selected: readonly CooperationRoleKey[] = []): SelectableRole[] {
  const selectedKeys = new Set(selected)
  return roleDisplayOrder.flatMap((key) => {
    const role = cooperationRoles.find(item => item.key === key)
    return role
      ? [{ key: role.key, name: role.name, selected: selectedKeys.has(role.key) }]
      : []
  })
}

function starOptions(rating = 0): SelectableStar[] {
  return starValues.map(value => ({ value, selected: value <= rating }))
}

function explorationOptions(selected: readonly ExplorationMethod[] = []): SelectableExplorationMethod[] {
  const selectedKeys = new Set(selected)
  return explorationDefinitions.map(item => ({ ...item, selected: selectedKeys.has(item.key) }))
}

function isForbidden(error: unknown) {
  return error instanceof MipEventsError && error.code === 'FORBIDDEN'
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message.trim() ? error.message : fallback
}

Page({
  data: {
    state: 'loading' as PageState,
    eventId: '' as EventId,
    event: null as MipEventDetail | null,
    feedback: null as EventFeedback | null,
    eventTypeText: '',
    accessText: '',
    timeText: '',
    locationText: '',
    rating: 0,
    starOptions: starOptions(),
    recommendation: '' as Recommendation,
    roleOptions: roleOptions(),
    selectedRoleCount: 0,
    body: '',
    bodyLength: 0,
    joinIntent: '' as JoinIntent,
    joinIntentOptions,
    explorationOptions: explorationOptions(),
    rosterConsent: '' as RosterConsent,
    accessToken: '',
    saving: false,
    message: '',
  },
  accessReady: false,
  checkingAccess: false,
  pendingSave: false,
  accessRetryAttempted: false,

  onLoad(query: Record<string, string | undefined>) {
    const eventId = String(query.eventId || '').trim() as EventId
    this.setData(eventId
      ? { eventId }
      : { state: 'error', message: '活动参数无效，请从活动详情重新进入。' })
  },

  onShow() {
    if (!this.data.eventId) {
      return
    }
    const resumed = mipIdentityModule.consumePendingResume(PAGE_ROUTE)
    if (this.accessReady && resumed?.action !== 'INTERACT') {
      return
    }
    void this.checkAccess(resumed?.action === 'INTERACT')
  },

  async checkAccess(resumed = false) {
    if (this.checkingAccess || !this.data.eventId) {
      return
    }
    this.checkingAccess = true
    if (!this.data.event) {
      this.setData({ state: 'loading', message: '' })
    }
    try {
      const session = await mipIdentityModule.beginProtectedAction({
        action: 'INTERACT',
        source: {
          navigation: 'navigateBack',
          route: `/${PAGE_ROUTE}`,
          query: { eventId: this.data.eventId, resumeFeedback: '1' },
        },
      })
      if (!session.decision.ready) {
        this.accessReady = false
        this.setData({ state: 'access', accessToken: session.token, message: '' })
        return
      }
      this.accessReady = true
      this.setData({ accessToken: '' })
      await this.loadFeedback({
        preserveDraft: resumed && this.pendingSave && Boolean(this.data.event),
      })
      if (resumed && this.pendingSave) {
        this.pendingSave = false
        this.accessRetryAttempted = true
        await this.submitFeedback()
      }
    }
    catch {
      this.accessReady = false
      this.setData({ state: 'error', message: '身份状态暂时无法确认，请稍后重试。' })
    }
    finally {
      this.checkingAccess = false
    }
  },

  openAccess() {
    if (this.data.accessToken) {
      caseNavigateTo({ url: mipAccessPageUrl(this.data.accessToken) })
    }
  },

  retry() {
    if (this.data.state === 'access') {
      this.openAccess()
      return
    }
    if (this.accessReady) {
      void this.loadFeedback({ preserveDraft: this.data.state === 'conflict' })
      return
    }
    void this.checkAccess()
  },

  async loadFeedback(options: { preserveDraft?: boolean } = {}) {
    if (!this.accessReady) {
      return
    }
    if (!this.data.event) {
      this.setData({ state: 'loading', message: '' })
    }
    try {
      const [event, feedback] = await Promise.all([
        mipEventsModule.getEvent(this.data.eventId, { force: true }),
        mipEventsModule.getFeedback(this.data.eventId),
      ])
      const presentedEvent = {
        ...event,
        eventTypeLabel: publicEventTypeLabel(event.eventTypeLabel),
      }
      const answers = feedback?.answers
      const draftData = options.preserveDraft
        ? {}
        : {
            rating: feedback?.rating || 0,
            starOptions: starOptions(feedback?.rating || 0),
            recommendation: answers?.recommendation || '' as Recommendation,
            roleOptions: roleOptions(answers?.roleKeys || []),
            selectedRoleCount: answers?.roleKeys.length || 0,
            body: feedback?.body || '',
            bodyLength: (feedback?.body || '').length,
            joinIntent: answers?.joinIntent || '' as JoinIntent,
            explorationOptions: explorationOptions(answers?.explorationMethods || []),
            rosterConsent: answers?.rosterConsent || '' as RosterConsent,
          }
      this.setData({
        state: 'ready',
        event: presentedEvent,
        feedback,
        eventTypeText: presentedEvent.eventTypeLabel,
        accessText: eventAccessText(event),
        timeText: eventTimeText(event.startsAt, event.endsAt),
        locationText: [event.cityName, event.venueName, event.address].filter(Boolean).join(' · ')
          || (event.mode === 'ONLINE' ? '线上活动' : '地点待公布'),
        message: '',
        ...draftData,
      })
    }
    catch (error) {
      if (isEventAccessRequirementError(error)) {
        this.accessReady = false
        await this.recoverAccess(false)
        return
      }
      if (isForbidden(error)) {
        this.setData({ state: 'blocked', message: ATTENDANCE_REQUIRED_MESSAGE })
        return
      }
      this.setData(this.data.event
        ? { state: 'ready', message: '反馈更新失败，已保留当前填写内容。' }
        : { state: 'error', message: errorMessage(error, '活动反馈暂时无法加载。') })
    }
  },

  selectRating(event: WechatMiniprogram.TouchEvent) {
    const rating = Number(event.currentTarget.dataset.value)
    if (!Number.isInteger(rating) || rating < 1 || rating > 5 || this.data.saving) {
      return
    }
    this.setData({ rating, starOptions: starOptions(rating), message: '' })
  },

  selectRecommendation(event: WechatMiniprogram.TouchEvent) {
    const recommendation = String(event.currentTarget.dataset.value || '') as Recommendation
    if (!['RECOMMEND', 'NOT_RECOMMEND'].includes(recommendation) || this.data.saving) {
      return
    }
    this.setData({ recommendation, message: '' })
  },

  toggleRole(event: WechatMiniprogram.TouchEvent) {
    const key = String(event.currentTarget.dataset.key || '') as CooperationRoleKey
    if (!cooperationRoles.some(role => role.key === key) || this.data.saving) {
      return
    }
    const roleOptions = this.data.roleOptions.map(role => role.key === key
      ? { ...role, selected: !role.selected }
      : role)
    this.setData({
      roleOptions,
      selectedRoleCount: roleOptions.filter(role => role.selected).length,
      message: '',
    })
  },

  onBodyInput(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    const body = String(event.detail.value || '').slice(0, 300)
    this.setData({ body, bodyLength: body.length, message: '' })
  },

  selectJoinIntent(event: WechatMiniprogram.TouchEvent) {
    const joinIntent = String(event.currentTarget.dataset.value || '') as JoinIntent
    if (!['JOIN_NOW', 'LEARN_MORE', 'NOT_INTERESTED'].includes(joinIntent) || this.data.saving) {
      return
    }
    this.setData({ joinIntent, message: '' })
  },

  toggleExplorationMethod(event: WechatMiniprogram.TouchEvent) {
    const key = String(event.currentTarget.dataset.key || '') as ExplorationMethod
    if (!explorationDefinitions.some(item => item.key === key) || this.data.saving) {
      return
    }
    this.setData({
      explorationOptions: this.data.explorationOptions.map(item => item.key === key
        ? { ...item, selected: !item.selected }
        : item),
      message: '',
    })
  },

  selectRosterConsent(event: WechatMiniprogram.TouchEvent) {
    const rosterConsent = String(event.currentTarget.dataset.value || '') as RosterConsent
    if (!['MATCH_OPPORTUNITIES', 'PRIVATE'].includes(rosterConsent) || this.data.saving) {
      return
    }
    this.setData({ rosterConsent, message: '' })
  },

  validationMessage() {
    if (!this.data.rating) {
      return '请选择活动评分。'
    }
    if (!this.data.recommendation) {
      return '请选择是否愿意推荐 MIP。'
    }
    if (!this.data.roleOptions.some(role => role.selected)) {
      return '请至少选择一个能力角色。'
    }
    if (this.data.body.length > 300) {
      return '合作或引荐内容不能超过 300 个字。'
    }
    if (!this.data.joinIntent) {
      return '请选择加入 MIP 的意愿。'
    }
    if (!this.data.rosterConsent) {
      return '请选择花名册信息的使用方式。'
    }
    return ''
  },

  saveFeedback() {
    this.accessRetryAttempted = false
    void this.submitFeedback()
  },

  async submitFeedback() {
    if (this.data.saving || !['ready', 'conflict'].includes(this.data.state)) {
      return
    }
    const validationMessage = this.validationMessage()
    if (validationMessage) {
      this.setData({ message: validationMessage })
      wx.showToast({ title: validationMessage, icon: 'none' })
      return
    }
    const answers: EventFeedbackAnswers = {
      recommendation: this.data.recommendation as EventFeedbackAnswers['recommendation'],
      roleKeys: this.data.roleOptions.filter(role => role.selected).map(role => role.key),
      joinIntent: this.data.joinIntent as EventFeedbackAnswers['joinIntent'],
      explorationMethods: this.data.explorationOptions.filter(item => item.selected).map(item => item.key),
      rosterConsent: this.data.rosterConsent as EventFeedbackAnswers['rosterConsent'],
    }
    this.setData({ saving: true, message: '' })
    try {
      const body = this.data.body.trim()
      const feedback = await mipEventsModule.saveFeedback(this.data.eventId, {
        rating: this.data.rating,
        ...(body ? { body } : {}),
        answers,
        expectedVersion: this.data.feedback?.version || 0,
      })
      const savedAnswers = feedback.answers || answers
      const savedRating = feedback.rating || this.data.rating
      this.pendingSave = false
      this.setData({
        state: 'ready',
        feedback,
        rating: savedRating,
        starOptions: starOptions(savedRating),
        recommendation: savedAnswers.recommendation,
        roleOptions: roleOptions(savedAnswers.roleKeys),
        selectedRoleCount: savedAnswers.roleKeys.length,
        body: feedback.body || '',
        bodyLength: (feedback.body || '').length,
        joinIntent: savedAnswers.joinIntent,
        explorationOptions: explorationOptions(savedAnswers.explorationMethods),
        rosterConsent: savedAnswers.rosterConsent,
        message: '',
      })
      wx.showToast({ title: '反馈已保存', icon: 'success' })
    }
    catch (error) {
      if (isEventAccessRequirementError(error)) {
        this.setData({ saving: false })
        await this.recoverAccess(true)
      }
      else if (error instanceof MipEventsError && error.code === 'CONFLICT') {
        await this.recoverConflict()
      }
      else if (isForbidden(error)) {
        this.setData({ state: 'blocked', message: ATTENDANCE_REQUIRED_MESSAGE })
      }
      else {
        this.setData({ message: errorMessage(error, '反馈保存失败，已保留当前填写内容。') })
      }
    }
    finally {
      this.setData({ saving: false })
    }
  },

  async recoverAccess(pendingSave: boolean) {
    if (this.accessRetryAttempted) {
      this.setData({ message: '身份状态仍未满足反馈条件，请稍后重试。' })
      return
    }
    this.pendingSave = pendingSave
    try {
      const session = await mipIdentityModule.beginProtectedAction({
        action: 'INTERACT',
        source: {
          navigation: 'navigateBack',
          route: `/${PAGE_ROUTE}`,
          query: { eventId: this.data.eventId, resumeFeedback: '1' },
        },
      })
      if (!session.decision.ready) {
        this.accessReady = false
        this.setData({ state: 'access', accessToken: session.token, message: '' })
        caseNavigateTo({ url: mipAccessPageUrl(session.token) })
        return
      }
      this.accessReady = true
      this.accessRetryAttempted = true
      if (pendingSave) {
        await this.submitFeedback()
      }
      else {
        await this.loadFeedback({ preserveDraft: Boolean(this.data.event) })
      }
    }
    catch {
      this.setData({ message: '身份状态暂时无法确认，请稍后重试。' })
    }
  },

  async recoverConflict() {
    try {
      const feedback = await mipEventsModule.getFeedback(this.data.eventId)
      this.setData({
        state: 'conflict',
        feedback,
        message: '反馈已在其他位置更新，当前填写内容已保留，请确认后重新保存。',
      })
    }
    catch {
      this.setData({
        state: 'conflict',
        message: '反馈已变化，最新版本加载失败，当前填写内容已保留。',
      })
    }
  },
})
