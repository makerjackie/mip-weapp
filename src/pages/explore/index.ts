import type { QueryOptions } from '@weapp/shared/cache'
import type { MemberFeedFilter, RecommendationSummary } from '../../modules/membership/types'
import { membershipModule } from '../../modules/membership/client'
import { caseNavigateTo, syncCaseNavigation } from '../../modules/platform/case-navigation'

interface DisplayRecommendation extends RecommendationSummary {
  initial: string
}

function displayRecommendations(recommendations: RecommendationSummary[]) {
  return recommendations.map(item => ({
    ...item,
    initial: item.nickname.slice(0, 1) || '友',
  }))
}

function recommendationSignature(filter: MemberFeedFilter, recommendations: RecommendationSummary[]) {
  return `${filter}:${recommendations.map(item => [item.id, item.avatarUrl, item.nickname, item.city, item.headline, item.detailLocked, ...item.tags].join('|')).join('::')}`
}

Page({
  data: {
    state: 'loading' as 'loading' | 'ready' | 'error',
    filter: 'recommended' as MemberFeedFilter,
    recommendations: [] as DisplayRecommendation[],
    emptyTitle: '完善资料，遇见同路人',
    emptyDescription: '填写城市和兴趣后，我们会为你推荐更合适的成员。',
    recommendationSignature: '',
    message: '',
    isEmbeddedCase: false,
  },
  requestSeq: 0,

  onShow() {
    syncCaseNavigation(this, 'pages/explore/index')
    void this.loadRecommendations()
  },

  async loadRecommendations(options: QueryOptions = {}) {
    const filter = this.data.filter
    const cached = membershipModule.peekMembers(filter)
    if (cached) {
      this.applyRecommendations(cached)
    }
    else if (this.data.state !== 'ready') {
      this.setData({ state: 'loading', message: '' })
    }
    const seq = this.requestSeq + 1
    this.requestSeq = seq
    try {
      let recommendations = await membershipModule.listMembers(filter, options)
      if (filter === 'recommended' && recommendations.length === 0) {
        const overview = await membershipModule.load(options)
        recommendations = overview.recommendations
      }
      if (seq !== this.requestSeq || this.data.filter !== filter) {
        return
      }
      this.applyRecommendations(recommendations)
    }
    catch (error) {
      if (seq !== this.requestSeq || this.data.filter !== filter) {
        return
      }
      this.setData(cached || this.data.state === 'ready'
        ? { message: '成员列表更新失败，已保留上次结果。' }
        : { state: 'error', message: error instanceof Error ? error.message : '成员列表加载失败' })
    }
  },

  applyRecommendations(recommendations: RecommendationSummary[]) {
    const signature = recommendationSignature(this.data.filter, recommendations)
    if (this.data.state === 'ready' && this.data.recommendationSignature === signature) {
      if (this.data.message) {
        this.setData({ message: '' })
      }
      return
    }
    this.setData({
      state: 'ready',
      message: '',
      recommendationSignature: signature,
      recommendations: displayRecommendations(recommendations),
    })
  },

  async onPullDownRefresh() {
    try {
      await this.loadRecommendations({ force: true })
    }
    finally {
      wx.stopPullDownRefresh()
    }
  },

  changeFilter(event: WechatMiniprogram.CustomEvent<{ value: MemberFeedFilter }>) {
    const filter = event.detail.value
    const emptyCopy = filter === 'same-city'
      ? { emptyTitle: '同城成员还在加入', emptyDescription: '完善所在城市后，我们会优先展示附近的同路人。' }
      : filter === 'new'
        ? { emptyTitle: '暂时没有新成员', emptyDescription: '新成员通过资料审核后会出现在这里。' }
        : { emptyTitle: '完善资料，遇见同路人', emptyDescription: '填写城市和兴趣后，我们会为你推荐更合适的成员。' }
    this.setData({ filter, ...emptyCopy })
    void this.loadRecommendations()
  },

  openMember(event: WechatMiniprogram.CustomEvent<{ id: string }>) {
    const memberId = event.detail.id
    if (!memberId) {
      return
    }
    caseNavigateTo({ url: `/packages/member/member-detail/index?memberId=${encodeURIComponent(memberId)}` })
  },
})
