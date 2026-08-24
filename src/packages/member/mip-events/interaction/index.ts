import type { EventId } from '../../../../modules/mip'
import type { EventFeedback, HeartCandidate, HeartState } from '../../../../modules/mip-events'
import { mipEventsModule } from '../../../../modules/mip-events/client'

Page({
  data: {
    state: 'loading' as 'loading' | 'ready' | 'error',
    eventId: '' as EventId,
    candidates: [] as HeartCandidate[],
    heart: null as HeartState | null,
    received: [] as HeartCandidate[],
    feedback: null as EventFeedback | null,
    ratingOptions: ['1 分', '2 分', '3 分', '4 分', '5 分'],
    rating: 5,
    body: '',
    savingHeart: false,
    savingFeedback: false,
    message: '',
  },

  onLoad(query: Record<string, string>) {
    this.setData({ eventId: String(query.eventId || '') as EventId })
    void this.loadInteraction()
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
        heart,
        received: heart.received,
        feedback,
        rating: feedback?.rating || 5,
        body: feedback?.body || '',
      })
    }
    catch (error) {
      this.setData({ state: 'error', message: error instanceof Error ? error.message : '互动内容加载失败' })
    }
  },

  async chooseHeart(event: WechatMiniprogram.TouchEvent) {
    if (this.data.savingHeart) {
      return
    }
    const targetRef = String(event.currentTarget.dataset.targetRef || '')
    const currentTarget = this.data.heart?.targetRef || ''
    this.setData({ savingHeart: true, message: '' })
    try {
      const heart = await mipEventsModule.setHeart(
        this.data.eventId,
        targetRef === currentTarget ? null : targetRef,
        this.data.heart?.version,
      )
      this.setData({
        heart,
        received: heart.received,
        candidates: this.data.candidates.map(candidate => ({
          ...candidate,
          selected: candidate.participantRef === heart.targetRef,
        })),
      })
      wx.showToast({ title: heart.targetRef ? '已保存' : '已取消', icon: 'success' })
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '心动状态保存失败' })
    }
    finally {
      this.setData({ savingHeart: false })
    }
  },

  onRatingChange(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    this.setData({ rating: Number(event.detail.value) + 1 })
  },

  onBodyInput(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    this.setData({ body: event.detail.value, message: '' })
  },

  async saveFeedback() {
    if (this.data.savingFeedback) {
      return
    }
    this.setData({ savingFeedback: true, message: '' })
    try {
      const feedback = await mipEventsModule.saveFeedback(this.data.eventId, {
        rating: this.data.rating,
        body: this.data.body,
        version: this.data.feedback?.version,
      })
      this.setData({ feedback, body: feedback.body, rating: feedback.rating || 5 })
      wx.showToast({ title: '反馈已保存', icon: 'success' })
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '反馈保存失败' })
    }
    finally {
      this.setData({ savingFeedback: false })
    }
  },
})
