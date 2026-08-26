import type { EventId } from '../../../../modules/mip'
import type { EventFeedback, HeartCandidate, HeartState } from '../../../../modules/mip-events'
import { isEventAccessRequirementError, MipEventsError } from '../../../../modules/mip-events'
import { mipEventsModule } from '../../../../modules/mip-events/client'
import { mipAccessPageUrl } from '../../../../modules/mip-identity'
import { mipIdentityModule } from '../../../../modules/mip-identity/client'
import { caseNavigateTo } from '../../../../modules/platform/case-navigation'

type InteractionView = 'SENT' | 'RECEIVED' | 'FEEDBACK'
type PendingInteractionAction
  = | { kind: 'HEART', targetRef: string }
    | { kind: 'FEEDBACK' }

function filteredCandidates(items: HeartCandidate[], keyword: string) {
  const normalized = keyword.trim().toLocaleLowerCase()
  if (!normalized) {
    return items
  }
  return items.filter(item => [item.nickname, item.headline]
    .filter(Boolean)
    .some(value => String(value).toLocaleLowerCase().includes(normalized)))
}

Page({
  data: {
    state: 'loading' as 'loading' | 'ready' | 'error',
    eventId: '' as EventId,
    candidates: [] as HeartCandidate[],
    visibleCandidates: [] as HeartCandidate[],
    heart: null as HeartState | null,
    received: [] as HeartCandidate[],
    visibleReceived: [] as HeartCandidate[],
    feedback: null as EventFeedback | null,
    activeView: 'SENT' as InteractionView,
    searchInput: '',
    ratingOptions: ['1 分', '2 分', '3 分', '4 分', '5 分'],
    rating: 5,
    body: '',
    savingHeart: false,
    savingFeedback: false,
    message: '',
  },
  pendingInteractionAction: null as PendingInteractionAction | null,
  pendingAccessResume: false,
  accessRetryAttempted: false,

  onLoad(query: Record<string, string>) {
    const activeView = ['SENT', 'RECEIVED', 'FEEDBACK'].includes(query.viewMode)
      ? query.viewMode as InteractionView
      : 'SENT'
    this.setData({ eventId: String(query.eventId || '') as EventId, activeView })
    void this.loadInteraction()
  },

  onShow() {
    const resume = mipIdentityModule.consumePendingResume('packages/member/mip-events/interaction/index')
    if (resume?.action !== 'INTERACT') {
      return
    }
    const pending = this.pendingInteractionAction
    this.pendingInteractionAction = null
    if (!pending) {
      if (this.data.state === 'ready') {
        this.setData({ message: '身份已确认，请继续刚才的操作。' })
      }
      else {
        this.pendingAccessResume = true
      }
      return
    }
    this.accessRetryAttempted = true
    if (pending.kind === 'HEART') {
      void this.saveHeartTarget(pending.targetRef)
    }
    else {
      void this.submitFeedback()
    }
  },

  async loadInteraction() {
    this.setData({ state: 'loading', message: '' })
    try {
      const [candidates, heart, feedback] = await Promise.all([
        mipEventsModule.listHeartCandidates(this.data.eventId),
        mipEventsModule.getHeart(this.data.eventId),
        mipEventsModule.getFeedback(this.data.eventId),
      ])
      this.setData({
        state: 'ready',
        candidates,
        visibleCandidates: filteredCandidates(candidates, this.data.searchInput),
        heart,
        received: heart.received,
        visibleReceived: filteredCandidates(heart.received, this.data.searchInput),
        feedback,
        rating: feedback?.rating || 5,
        body: feedback?.body || '',
        message: this.pendingAccessResume ? '身份已确认，请继续刚才的操作。' : '',
      })
      this.pendingAccessResume = false
    }
    catch (error) {
      this.setData({ state: 'error', message: error instanceof Error ? error.message : '互动内容加载失败' })
    }
  },

  chooseHeart(event: WechatMiniprogram.TouchEvent) {
    const targetRef = String(event.currentTarget.dataset.targetRef || '')
    if (!targetRef) {
      return
    }
    this.accessRetryAttempted = false
    void this.saveHeartTarget(targetRef)
  },

  async saveHeartTarget(targetRef: string) {
    if (this.data.savingHeart) {
      return
    }
    const selectedCandidate = this.data.candidates
      .find(candidate => candidate.participantRef === targetRef)
    const submittedTargetRef = selectedCandidate?.selected
      ? null
      : targetRef
    this.setData({ savingHeart: true, message: '' })
    try {
      const heart = await mipEventsModule.setHeart(
        this.data.eventId,
        submittedTargetRef,
        this.data.heart?.version,
      )
      const candidates = this.data.candidates.map(candidate => ({
        ...candidate,
        selected: Boolean(heart.targetRef)
          && submittedTargetRef !== null
          && candidate.participantRef === submittedTargetRef,
      }))
      this.setData({
        heart,
        received: heart.received,
        visibleReceived: filteredCandidates(heart.received, this.data.searchInput),
        candidates,
        visibleCandidates: filteredCandidates(candidates, this.data.searchInput),
      })
      wx.showToast({ title: heart.targetRef ? '已保存' : '已取消', icon: 'success' })
    }
    catch (error) {
      if (isEventAccessRequirementError(error)) {
        this.setData({ savingHeart: false })
        await this.recoverInteractionAccess({ kind: 'HEART', targetRef })
      }
      else if (error instanceof MipEventsError && error.code === 'CONFLICT') {
        await this.recoverHeartConflict()
      }
      else {
        this.setData({ message: error instanceof Error ? error.message : '心动状态保存失败' })
      }
    }
    finally {
      this.setData({ savingHeart: false })
    }
  },

  changeView(event: WechatMiniprogram.TouchEvent) {
    const activeView = String(event.currentTarget.dataset.view || '') as InteractionView
    if (!['SENT', 'RECEIVED', 'FEEDBACK'].includes(activeView)) {
      return
    }
    this.setData({ activeView, message: '' })
  },

  onSearchInput(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    const searchInput = String(event.detail.value || '').slice(0, 80)
    this.setData({
      searchInput,
      visibleCandidates: filteredCandidates(this.data.candidates, searchInput),
      visibleReceived: filteredCandidates(this.data.received, searchInput),
    })
  },

  clearSearch() {
    this.setData({
      searchInput: '',
      visibleCandidates: this.data.candidates,
      visibleReceived: this.data.received,
    })
  },

  onRatingChange(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    this.setData({ rating: Number(event.detail.value) + 1 })
  },

  onBodyInput(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    this.setData({ body: event.detail.value, message: '' })
  },

  saveFeedback() {
    this.accessRetryAttempted = false
    void this.submitFeedback()
  },

  async submitFeedback() {
    if (this.data.savingFeedback) {
      return
    }
    this.setData({ savingFeedback: true, message: '' })
    try {
      const feedback = await mipEventsModule.saveFeedback(this.data.eventId, {
        rating: this.data.rating,
        body: this.data.body,
        expectedVersion: this.data.feedback?.version || 0,
      })
      this.setData({ feedback, body: feedback.body, rating: feedback.rating || 5 })
      wx.showToast({ title: '反馈已保存', icon: 'success' })
    }
    catch (error) {
      if (isEventAccessRequirementError(error)) {
        this.setData({ savingFeedback: false })
        await this.recoverInteractionAccess({ kind: 'FEEDBACK' })
      }
      else if (error instanceof MipEventsError && error.code === 'CONFLICT') {
        await this.recoverFeedbackConflict()
      }
      else {
        this.setData({ message: error instanceof Error ? error.message : '反馈保存失败' })
      }
    }
    finally {
      this.setData({ savingFeedback: false })
    }
  },

  async recoverInteractionAccess(pending: PendingInteractionAction) {
    if (this.accessRetryAttempted) {
      this.setData({ message: '身份状态仍未满足互动条件，请稍后重试。' })
      return
    }
    this.pendingInteractionAction = pending
    try {
      const session = await mipIdentityModule.beginProtectedAction({
        action: 'INTERACT',
        source: {
          navigation: 'navigateBack',
          route: '/packages/member/mip-events/interaction/index',
          query: {
            eventId: this.data.eventId,
            viewMode: pending.kind === 'FEEDBACK' ? 'FEEDBACK' : this.data.activeView,
            resumeInteraction: '1',
          },
        },
      })
      if (!session.decision.ready) {
        caseNavigateTo({ url: mipAccessPageUrl(session.token) })
        return
      }
      this.pendingInteractionAction = null
      this.accessRetryAttempted = true
      if (pending.kind === 'HEART') {
        await this.saveHeartTarget(pending.targetRef)
      }
      else {
        await this.submitFeedback()
      }
    }
    catch {
      this.pendingInteractionAction = null
      this.setData({ message: '身份状态暂时无法确认，请稍后重试。' })
    }
  },

  async recoverHeartConflict() {
    try {
      const [candidates, heart] = await Promise.all([
        mipEventsModule.listHeartCandidates(this.data.eventId),
        mipEventsModule.getHeart(this.data.eventId),
      ])
      this.setData({
        heart,
        candidates,
        visibleCandidates: filteredCandidates(candidates, this.data.searchInput),
        received: heart.received,
        visibleReceived: filteredCandidates(heart.received, this.data.searchInput),
        message: '心动状态已更新，请重新选择。',
      })
    }
    catch {
      this.setData({ message: '心动状态已变化，最新状态加载失败，请稍后重试。' })
    }
  },

  async recoverFeedbackConflict() {
    try {
      const feedback = await mipEventsModule.getFeedback(this.data.eventId)
      this.setData({
        feedback,
        message: '反馈已在其他位置更新，当前填写内容已保留，请确认后重新保存。',
      })
    }
    catch {
      this.setData({ message: '反馈已变化，最新版本加载失败，请稍后重试。' })
    }
  },
})
