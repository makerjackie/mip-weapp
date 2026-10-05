import type { GrowthEntry } from '../../../modules/mip-growth'
import type { MembershipAgreement } from '../../../modules/mip-identity'
import { mipGrowthModule } from '../../../modules/mip-growth/client'
import { mipIdentityModule } from '../../../modules/mip-identity/client'
import { formatLocalDateTime } from '../../../utils/date'

interface ExperienceEntryView {
  id: string
  title: string
  createdText: string
  deltaPrefix: string
  deltaValue: number
}

function entryView(entry: GrowthEntry): ExperienceEntryView {
  return {
    id: entry.id,
    title: entry.ruleName || '经验值变动',
    createdText: formatLocalDateTime(entry.createdAt),
    // 逆序回退为负数时不再叠加「+」，由数值自带负号呈现。
    deltaPrefix: entry.deltaValue > 0 ? '+ EXP ' : 'EXP ',
    deltaValue: entry.deltaValue,
  }
}

Page({
  data: {
    tab: 'details' as 'rules' | 'details',
    state: 'loading' as 'loading' | 'ready' | 'error',
    entries: [] as ExperienceEntryView[],
    rulesDetail: null as MembershipAgreement | null,
    nextCursor: '',
    loadingMore: false,
    message: '',
  },
  requestSeq: 0,

  onLoad() {
    void this.load()
  },

  onPullDownRefresh() {
    void this.load().finally(() => wx.stopPullDownRefresh())
  },

  /** wxml「重新加载」与下拉刷新共用；每次都回到第一页并重读规则文档（事件对象入参被忽略）。 */
  async load() {
    const requestSeq = ++this.requestSeq
    if (!this.data.entries.length) {
      this.setData({ state: 'loading', message: '' })
    }
    try {
      const [page, rulesDetail] = await Promise.all([
        mipGrowthModule.listEntries(undefined, 20, 'EXPERIENCE'),
        mipIdentityModule.getMembershipAgreement('experience-rules'),
      ])
      if (requestSeq !== this.requestSeq) {
        return
      }
      this.setData({
        state: 'ready',
        entries: page.items.map(entryView),
        rulesDetail,
        nextCursor: page.nextCursor || '',
        message: '',
      })
    }
    catch (error) {
      if (requestSeq !== this.requestSeq) {
        return
      }
      this.setData(this.data.entries.length
        ? { message: '经验值详情更新失败，已保留上次结果。' }
        : { state: 'error', message: error instanceof Error ? error.message : '经验值详情加载失败' })
    }
  },

  async loadMore() {
    if (!this.data.nextCursor || this.data.loadingMore) {
      return
    }
    const requestSeq = this.requestSeq
    this.setData({ loadingMore: true })
    try {
      const page = await mipGrowthModule.listEntries(this.data.nextCursor, 20, 'EXPERIENCE')
      if (requestSeq !== this.requestSeq) {
        return
      }
      this.setData({
        entries: [...this.data.entries, ...page.items.map(entryView)],
        nextCursor: page.nextCursor || '',
      })
    }
    catch {
      if (requestSeq === this.requestSeq) {
        this.setData({ message: '更多经验值明细加载失败。' })
      }
    }
    finally {
      if (requestSeq === this.requestSeq) {
        this.setData({ loadingMore: false })
      }
    }
  },

  chooseTab(event: WechatMiniprogram.TouchEvent) {
    const tab = String(event.currentTarget.dataset.tab || '')
    if ((tab === 'rules' || tab === 'details') && tab !== this.data.tab) {
      this.setData({ tab })
    }
  },
})
