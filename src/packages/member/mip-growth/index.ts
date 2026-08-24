import type { GrowthEntry, GrowthSnapshot } from '../../../modules/mip-growth'
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

Page({
  data: {
    state: 'loading' as 'loading' | 'ready' | 'error',
    snapshot: null as GrowthSnapshot | null,
    entries: [] as GrowthEntryView[],
    nextCursor: '',
    loadingMore: false,
    message: '',
  },

  onLoad() {
    const cached = mipGrowthModule.peekSnapshot()
    if (cached) {
      this.setData({ state: 'ready', snapshot: cached })
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
