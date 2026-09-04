import type { EventId } from '../../../../modules/mip'
import type { HeartCandidate, HeartState } from '../../../../modules/mip-events'
import { isEventAccessRequirementError, MipEventsError } from '../../../../modules/mip-events'
import { mipEventsModule } from '../../../../modules/mip-events/client'
import { mipAccessPageUrl } from '../../../../modules/mip-identity'
import { mipIdentityModule } from '../../../../modules/mip-identity/client'
import { caseNavigateTo } from '../../../../platform/navigation/client'

type InteractionView = 'SENT' | 'RECEIVED'
type InteractionState = 'loading' | 'ready' | 'blocked' | 'error'
interface PendingInteractionAction { kind: 'HEART', targetRef: string }

const ATTENDANCE_REQUIRED_MESSAGE = '完成签到后可使用活动互动功能。'

function isInteractionForbidden(error: unknown) {
  return error instanceof MipEventsError && error.code === 'FORBIDDEN'
}

function interactionErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message.trim()
    ? error.message
    : fallback
}

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
    state: 'loading' as InteractionState,
    eventId: '' as EventId,
    candidates: [] as HeartCandidate[],
    visibleCandidates: [] as HeartCandidate[],
    heart: null as HeartState | null,
    received: [] as HeartCandidate[],
    visibleReceived: [] as HeartCandidate[],
    activeView: 'SENT' as InteractionView,
    searchInput: '',
    savingHeart: false,
    errorDescription: '',
    message: '',
  },
  pendingInteractionAction: null as PendingInteractionAction | null,
  pendingAccessResume: false,
  accessRetryAttempted: false,

  onLoad(query: Record<string, string>) {
    const activeView = ['SENT', 'RECEIVED'].includes(query.viewMode)
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
    void this.saveHeartTarget(pending.targetRef)
  },

  async loadInteraction() {
    this.setData({ state: 'loading', errorDescription: '', message: '' })
    try {
      const [candidates, heart] = await Promise.all([
        mipEventsModule.listHeartCandidates(this.data.eventId),
        mipEventsModule.getHeart(this.data.eventId),
      ])
      this.setData({
        state: 'ready',
        candidates,
        visibleCandidates: filteredCandidates(candidates, this.data.searchInput),
        heart,
        received: heart.received,
        visibleReceived: filteredCandidates(heart.received, this.data.searchInput),
        message: this.pendingAccessResume ? '身份已确认，请继续刚才的操作。' : '',
      })
      this.pendingAccessResume = false
    }
    catch (error) {
      if (isInteractionForbidden(error)) {
        this.setData({ state: 'blocked', errorDescription: ATTENDANCE_REQUIRED_MESSAGE })
        return
      }
      this.setData({
        state: 'error',
        errorDescription: interactionErrorMessage(error, '互动内容加载失败，请稍后重试。'),
      })
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
      else if (isInteractionForbidden(error)) {
        this.setData({
          state: 'blocked',
          errorDescription: interactionErrorMessage(error, '当前状态不能使用活动互动功能。'),
        })
      }
      else {
        this.setData({ message: interactionErrorMessage(error, '心动状态保存失败，请稍后重试。') })
      }
    }
    finally {
      this.setData({ savingHeart: false })
    }
  },

  changeView(event: WechatMiniprogram.TouchEvent) {
    const activeView = String(event.currentTarget.dataset.view || '') as InteractionView
    if (!['SENT', 'RECEIVED'].includes(activeView)) {
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
            viewMode: this.data.activeView,
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
      await this.saveHeartTarget(pending.targetRef)
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
})
