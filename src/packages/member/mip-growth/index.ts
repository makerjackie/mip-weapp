import type { GrowthEntry, GrowthLevel, GrowthRule, GrowthSnapshot } from '../../../modules/mip-growth'
import { mipGrowthModule } from '../../../modules/mip-growth/client'

const metricLabels = {
  EXPERIENCE: '经验值',
  CONTRIBUTION: '贡献值',
  COIN: '游戏币',
} as const

interface GrowthEntryView extends GrowthEntry {
  metricLabel: string
  deltaText: string
  createdText: string
}

interface GrowthLevelView extends GrowthLevel {
  thresholdText: string
  current: boolean
}

interface GrowthRuleView extends GrowthRule {
  metricLabel: string
  deltaText: string
  dailyLimitText: string
}

function dateText(value: string) {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) {
    return ''
  }
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

function entryView(entry: GrowthEntry): GrowthEntryView {
  return {
    ...entry,
    metricLabel: metricLabels[entry.metric],
    deltaText: entry.deltaValue > 0 ? `+${entry.deltaValue}` : String(entry.deltaValue),
    createdText: dateText(entry.createdAt),
  }
}

function levelView(level: GrowthLevel, currentLevelId: string): GrowthLevelView {
  return {
    ...level,
    thresholdText: level.minimumExperience === 0 ? '基础等级' : `${level.minimumExperience} 经验值`,
    current: level.id === currentLevelId,
  }
}

function ruleView(rule: GrowthRule): GrowthRuleView {
  const metricLabel = metricLabels[rule.metric]
  return {
    ...rule,
    metricLabel,
    deltaText: `${rule.deltaValue > 0 ? '+' : ''}${rule.deltaValue} ${metricLabel}`,
    dailyLimitText: rule.dailyLimitValue === undefined
      ? '无每日上限'
      : `每日最多 ${rule.dailyLimitValue} ${metricLabel}`,
  }
}

Page({
  data: {
    state: 'loading' as 'loading' | 'ready' | 'error',
    snapshot: null as GrowthSnapshot | null,
    levels: [] as GrowthLevelView[],
    earningRules: [] as GrowthRuleView[],
    entries: [] as GrowthEntryView[],
    nextCursor: '',
    loadingMore: false,
    message: '',
  },

  onLoad() {
    const cached = mipGrowthModule.peekSnapshot()
    if (cached) {
      this.presentSnapshot(cached)
    }
    void this.loadGrowth()
  },

  async onPullDownRefresh() {
    await this.loadGrowth(true)
    wx.stopPullDownRefresh()
  },

  async loadGrowth(force = false) {
    if (!this.data.snapshot) {
      this.setData({ state: 'loading', message: '' })
    }
    try {
      const [snapshot, page] = await Promise.all([
        mipGrowthModule.getSnapshot({ force }),
        mipGrowthModule.listEntries(undefined, 20),
      ])
      this.setData({
        state: 'ready',
        snapshot,
        levels: snapshot.levels.map(level => levelView(level, snapshot.currentLevel.id)),
        earningRules: snapshot.earningRules.map(ruleView),
        entries: page.items.map(entryView),
        nextCursor: page.nextCursor || '',
        message: '',
      })
    }
    catch (error) {
      this.setData(this.data.snapshot
        ? { message: '成长记录更新失败，已保留上次结果。' }
        : { state: 'error', message: error instanceof Error ? error.message : '成长记录加载失败' })
    }
  },

  presentSnapshot(snapshot: GrowthSnapshot) {
    this.setData({
      state: 'ready',
      snapshot,
      levels: snapshot.levels.map(level => levelView(level, snapshot.currentLevel.id)),
      earningRules: snapshot.earningRules.map(ruleView),
    })
  },

  async loadMore() {
    if (!this.data.nextCursor || this.data.loadingMore) {
      return
    }
    this.setData({ loadingMore: true, message: '' })
    try {
      const page = await mipGrowthModule.listEntries(this.data.nextCursor, 20)
      this.setData({
        entries: [...this.data.entries, ...page.items.map(entryView)],
        nextCursor: page.nextCursor || '',
      })
    }
    catch {
      this.setData({ message: '更多成长记录加载失败。' })
    }
    finally {
      this.setData({ loadingMore: false })
    }
  },
})
