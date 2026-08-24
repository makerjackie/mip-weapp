import type {
  MatchingCandidateType,
  MatchingFeedbackIntent,
  MatchingFeedbackType,
  MatchingRequestIntent,
  MatchingRequestSummary,
  MatchingResult,
  OpportunitySummary,
} from '../../../modules/mip-opportunities'
import {
  opportunityModule,
  retainMatchingFeedbackIntent,
  retainMatchingRequestIntent,
} from '../../../modules/mip-opportunities'
import { caseNavigateTo } from '../../../modules/platform/case-navigation'

type PageState = 'loading' | 'ready' | 'error'
type ResultTab = 'TALENT' | 'PROJECT'

interface MatchingResultView extends MatchingResult {
  explanationText: string
  feedbackText: string
}

function resultView(item: MatchingResult): MatchingResultView {
  const labels: Partial<Record<MatchingFeedbackType, string>> = {
    HELPFUL: '有帮助',
    NOT_RELEVANT: '不相关',
    CONTACTED: '已联系',
    DISMISSED: '已忽略',
  }
  return {
    ...item,
    explanationText: item.explanation.map(reason => reason.label).join(' · '),
    feedbackText: item.feedback ? labels[item.feedback.type] || '' : '',
  }
}

Page({
  data: {
    state: 'loading' as PageState,
    requestId: '',
    tab: 'TALENT' as ResultTab,
    requests: [] as MatchingRequestSummary[],
    opportunities: [] as OpportunitySummary[],
    results: [] as MatchingResultView[],
    nextCursor: '',
    loadingMore: false,
    creatingId: '',
    feedbackKey: '',
    message: '',
  },
  matchingRequestIntent: null as MatchingRequestIntent | null,
  matchingFeedbackIntent: null as MatchingFeedbackIntent | null,

  onLoad(query: Record<string, string | undefined>) {
    const requestId = String(query.requestId || '')
    this.setData({ requestId })
    void this.load(true)
  },

  async onPullDownRefresh() {
    await this.load(true)
    wx.stopPullDownRefresh()
  },

  async load(reset = false) {
    if (reset || !this.data.results.length) {
      this.setData({ state: 'loading', message: '' })
    }
    try {
      if (this.data.requestId) {
        await this.loadResults(true)
      }
      else {
        const [requests, opportunities] = await Promise.all([
          opportunityModule.listMatchingRequests(),
          opportunityModule.listMine(),
        ])
        this.setData({
          state: 'ready',
          requests: requests.items,
          opportunities: opportunities.items.filter(item => item.status === 'PUBLISHED'),
          message: '',
        })
      }
    }
    catch (error) {
      this.setData({
        state: 'error',
        message: error instanceof Error ? error.message : '机会撮合加载失败',
      })
    }
  },

  async loadResults(reset = false) {
    if (!this.data.requestId || (!reset && (!this.data.nextCursor || this.data.loadingMore))) {
      return
    }
    this.setData(reset ? { state: 'loading', nextCursor: '', message: '' } : { loadingMore: true })
    try {
      const page = await opportunityModule.listMatchingResults(
        this.data.requestId,
        this.data.tab,
        reset ? undefined : this.data.nextCursor,
      )
      this.setData({
        state: 'ready',
        results: reset ? page.items.map(resultView) : [...this.data.results, ...page.items.map(resultView)],
        nextCursor: page.nextCursor || '',
        message: '',
      })
    }
    catch (error) {
      this.setData({
        state: this.data.results.length ? 'ready' : 'error',
        message: error instanceof Error ? error.message : '推荐结果加载失败',
      })
    }
    finally {
      this.setData({ loadingMore: false })
    }
  },

  changeTab(event: WechatMiniprogram.TouchEvent) {
    const tab = String(event.currentTarget.dataset.tab || '') as ResultTab
    if (!['TALENT', 'PROJECT'].includes(tab) || tab === this.data.tab) {
      return
    }
    this.setData({ tab, results: [], nextCursor: '' })
    void this.loadResults(true)
  },

  async createRecommendation(event: WechatMiniprogram.TouchEvent) {
    const opportunityId = String(event.currentTarget.dataset.id || '')
    if (!opportunityId || this.data.creatingId) {
      return
    }
    this.setData({ creatingId: opportunityId, message: '' })
    const intent = retainMatchingRequestIntent(this.matchingRequestIntent, opportunityId)
    this.matchingRequestIntent = intent
    try {
      const request = await opportunityModule.createMatchingRequest(
        opportunityId as OpportunitySummary['id'],
        intent.idempotencyKey,
      )
      this.matchingRequestIntent = null
      this.setData({ requestId: request.id, tab: 'TALENT', results: [], nextCursor: '' })
      await this.loadResults(true)
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '推荐生成失败' })
    }
    finally {
      this.setData({ creatingId: '' })
    }
  },

  openRequest(event: WechatMiniprogram.TouchEvent) {
    const requestId = String(event.currentTarget.dataset.id || '')
    if (!requestId) {
      return
    }
    caseNavigateTo({
      url: `/packages/member/mip-opportunity-matching/index?requestId=${encodeURIComponent(requestId)}`,
    })
  },

  openCandidate(event: WechatMiniprogram.TouchEvent) {
    const candidateRef = String(event.currentTarget.dataset.ref || '')
    const type = String(event.currentTarget.dataset.type || '') as MatchingCandidateType
    const item = this.data.results.find(result => result.candidateRef === candidateRef && result.type === type)
    if (item?.type === 'TALENT' && item.talent?.profileRef) {
      caseNavigateTo({
        url: `/packages/member/mip-public-profile/index?profileRef=${encodeURIComponent(item.talent.profileRef)}`,
      })
    }
    else if (item?.type === 'PROJECT') {
      caseNavigateTo({
        url: `/packages/member/mip-opportunities/detail/index?id=${encodeURIComponent(item.project?.id || '')}`,
      })
    }
  },

  async giveFeedback(event: WechatMiniprogram.TouchEvent) {
    const candidateRef = String(event.currentTarget.dataset.ref || '')
    const type = String(event.currentTarget.dataset.type || '') as MatchingCandidateType
    const feedbackType = String(event.currentTarget.dataset.feedback || '') as MatchingFeedbackType
    const key = `${type}:${candidateRef}:${feedbackType}`
    if (!candidateRef || this.data.feedbackKey) {
      return
    }
    this.setData({ feedbackKey: key, message: '' })
    const input = {
      requestId: this.data.requestId,
      candidateType: type,
      candidateRef,
      feedbackType,
    }
    const intent = retainMatchingFeedbackIntent(this.matchingFeedbackIntent, input)
    this.matchingFeedbackIntent = intent
    try {
      await opportunityModule.saveMatchingFeedback(input, intent.idempotencyKey)
      this.matchingFeedbackIntent = null
      const feedbackText = feedbackType === 'HELPFUL' ? '有帮助' : '不相关'
      this.setData({
        results: this.data.results.map(item => item.candidateRef === candidateRef && item.type === type
          ? { ...item, feedback: { type: feedbackType }, feedbackText }
          : item),
      })
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '反馈提交失败' })
    }
    finally {
      this.setData({ feedbackKey: '' })
    }
  },

  loadMore() {
    void this.loadResults(false)
  },

  openSettings() {
    caseNavigateTo({ url: '/packages/member/mip-opportunity-settings/index' })
  },
})
