import type { GrowthEntry, GrowthRule } from '../../../modules/mip-growth'
import { mipGrowthModule } from '../../../modules/mip-growth/client'
import { formatLocalDateTime } from '../../../utils/date'

interface ExperienceEntryView {
  id: string
  title: string
  createdText: string
  deltaPrefix: string
  deltaValue: number
}

interface ExperienceRuleView {
  id: string
  name: string
  detailText: string
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

function experienceRuleView(rule: GrowthRule): ExperienceRuleView {
  return {
    id: rule.id,
    name: rule.name,
    // 规则说明来自管理后台配置；未配置时回退为派生的每日上限文案。
    detailText: rule.description
      || (rule.dailyLimitValue === undefined ? '无每日上限' : `每日最多 ${rule.dailyLimitValue} 经验值`),
    deltaValue: rule.deltaValue,
  }
}

Page({
  data: {
    tab: 'details' as 'rules' | 'details',
    state: 'loading' as 'loading' | 'ready' | 'error',
    entries: [] as ExperienceEntryView[],
    rules: [] as ExperienceRuleView[],
    nextCursor: '',
    loadingMore: false,
    message: '',
  },
  requestSeq: 0,

  onLoad() {
    void this.load()
  },

  onPullDownRefresh() {
    void this.load(true).finally(() => wx.stopPullDownRefresh())
  },

  /** wxml「重新加载」与下拉刷新共用；事件对象作为 truthy force 传入（与玩家等级页同约定）。 */
  async load(force = false) {
    const requestSeq = ++this.requestSeq
    if (!this.data.entries.length) {
      this.setData({ state: 'loading', message: '' })
    }
    try {
      const [snapshot, page] = await Promise.all([
        mipGrowthModule.getSnapshot({ force }),
        mipGrowthModule.listEntries(undefined, 20, 'EXPERIENCE'),
      ])
      if (requestSeq !== this.requestSeq) {
        return
      }
      this.setData({
        state: 'ready',
        entries: page.items.map(entryView),
        rules: snapshot.earningRules.filter(rule => rule.metric === 'EXPERIENCE').map(experienceRuleView),
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
