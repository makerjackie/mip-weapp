import type { RecommendationSummary } from '../../../modules/membership/types'
import { membershipModule } from '../../../modules/membership/client'
import { caseNavigateTo } from '../../../modules/platform/case-navigation'

interface ConnectionItem extends RecommendationSummary {
  initial: string
  identityText: string
}

function present(items: RecommendationSummary[]): ConnectionItem[] {
  return items.map(item => ({
    ...item,
    initial: item.nickname.slice(0, 1) || '友',
    identityText: [item.organization, item.roleTitle].filter(Boolean).join(' · ')
      || item.industry
      || item.city
      || '社区成员',
  }))
}

Page({
  data: {
    state: 'loading' as 'loading' | 'ready' | 'error',
    direction: 'following' as 'following' | 'followers',
    items: [] as ConnectionItem[],
    message: '',
  },

  onLoad(query: Record<string, string>) {
    this.setData({ direction: query.direction === 'followers' ? 'followers' : 'following' })
  },

  onShow() {
    void this.load()
  },

  async onPullDownRefresh() {
    try {
      await this.load(true)
    }
    finally {
      wx.stopPullDownRefresh()
    }
  },

  async load(force = false) {
    if (!this.data.items.length) {
      this.setData({ state: 'loading', message: '' })
    }
    try {
      const items = await membershipModule.listConnections(this.data.direction, { force })
      this.setData({ state: 'ready', items: present(items), message: '' })
    }
    catch (error) {
      this.setData({
        state: this.data.items.length ? 'ready' : 'error',
        message: error instanceof Error ? error.message : '暂时无法加载',
      })
    }
  },

  changeDirection(event: WechatMiniprogram.CustomEvent<{ value: 'following' | 'followers' }>) {
    const direction = event.detail.value
    if (direction === this.data.direction) {
      return
    }
    this.setData({ direction, items: [], state: 'loading', message: '' })
    void this.load(true)
  },

  openMember(event: WechatMiniprogram.BaseEvent) {
    const memberId = String(event.currentTarget.dataset.memberId || '')
    if (!memberId) {
      return
    }
    caseNavigateTo({
      url: `/packages/member/member-detail/index?memberId=${encodeURIComponent(memberId)}`,
    })
  },
})
