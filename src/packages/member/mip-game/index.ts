import type { GameBranchFilter, GameMatch, GameOverview, GameRankingEntry, GameRankingType } from '../../../modules/mip-game'
import { mipGameModule } from '../../../modules/mip-game'

interface MatchView extends GameMatch { periodText: string, resultText: string }

const rankingOptions: Array<{ key: GameRankingType, label: string }> = [
  { key: 'TEAM_HALF_YEAR', label: '团队半年榜' },
  { key: 'TEAM_YEAR', label: '团队年度榜' },
  { key: 'INDIVIDUAL_SEASON', label: '个人赛季榜' },
  { key: 'INDIVIDUAL_ALL_TIME', label: '个人累计榜' },
]

function matchView(item: GameMatch): MatchView {
  const resultText = item.status === 'SCHEDULED'
    ? '待结算'
    : `${item.teamA.score ?? 0} : ${item.teamB.score ?? 0}`
  return { ...item, periodText: `${item.weekStart} 至 ${item.weekEnd}`, resultText }
}

Page({
  data: {
    state: 'loading' as 'loading' | 'ready' | 'empty' | 'error',
    overview: null as GameOverview | null,
    matches: [] as MatchView[],
    history: [] as MatchView[],
    rankings: [] as GameRankingEntry[],
    rankingOptions,
    rankingType: 'TEAM_HALF_YEAR' as GameRankingType,
    seasonPeriodText: '',
    branches: [] as GameBranchFilter[],
    branchId: '',
    rulesOpen: false,
    loadingRanking: false,
    message: '',
  },

  onShow() { void this.load(true) },

  async onPullDownRefresh() {
    try {
      await this.load(true)
    }
    finally {
      wx.stopPullDownRefresh()
    }
  },

  async load(force = false) {
    this.setData({ state: 'loading', message: '' })
    try {
      const overview = await mipGameModule.query.getOverview(undefined, force)
      if (!overview.season) {
        this.setData({ state: 'empty', overview, matches: [], rankings: [] })
        return
      }
      const rankingType: GameRankingType = overview.season.periodKind === 'YEAR' ? 'TEAM_YEAR' : 'TEAM_HALF_YEAR'
      const [ranking, history] = await Promise.all([
        mipGameModule.query.listRankings(overview.season.id, rankingType, undefined, force),
        mipGameModule.query.listHistory(overview.season.id, force),
      ])
      this.setData({
        state: 'ready',
        overview,
        matches: overview.matches.map(matchView),
        history: history.items.map(matchView),
        rankings: ranking.items,
        branches: ranking.branches,
        rankingType,
        branchId: '',
        seasonPeriodText: `${overview.season.startsAt.slice(0, 10)} 至 ${overview.season.endsAt.slice(0, 10)}`,
      })
    }
    catch (error) {
      this.setData({ state: 'error', message: error instanceof Error ? error.message : '赛季信息加载失败' })
    }
  },

  async changeRanking(event: WechatMiniprogram.TouchEvent) {
    const rankingType = String(event.currentTarget.dataset.type || '') as GameRankingType
    if (!rankingOptions.some(item => item.key === rankingType) || rankingType === this.data.rankingType) {
      return
    }
    this.setData({ rankingType, branchId: '' })
    await this.loadRanking(true)
  },

  async changeBranch(event: WechatMiniprogram.TouchEvent) {
    this.setData({ branchId: String(event.currentTarget.dataset.id || '') })
    await this.loadRanking(true)
  },

  async loadRanking(force = false) {
    const seasonId = this.data.overview?.season?.id
    if (!seasonId || this.data.loadingRanking) {
      return
    }
    this.setData({ loadingRanking: true, message: '' })
    try {
      const ranking = await mipGameModule.query.listRankings(
        seasonId,
        this.data.rankingType,
        this.data.branchId || undefined,
        force,
      )
      this.setData({ rankings: ranking.items, branches: ranking.branches })
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '排行榜加载失败' })
    }
    finally {
      this.setData({ loadingRanking: false })
    }
  },

  openTeam() {
    const teamId = this.data.overview?.team?.id
    if (teamId) {
      void wx.navigateTo({ url: `/packages/member/mip-game/team/index?teamId=${teamId}` })
    }
  },

  toggleRules() { this.setData({ rulesOpen: !this.data.rulesOpen }) },
})
