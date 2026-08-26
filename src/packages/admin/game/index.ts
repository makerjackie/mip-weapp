import type {
  AssignableGameMember,
  GameBranchFilter,
  GameMatch,
  GameMemberAssignment,
  GamePeriodKind,
  GameRankingEntry,
  GameRankingType,
  GameSeason,
  GameTeam,
} from '../../../modules/mip-game'
import { MipGameError, mipGameModule } from '../../../modules/mip-game'
import { formatLocalDate, formatLocalDateTime } from '../../../utils/date'

interface MemberView extends AssignableGameMember { selected: boolean, selectedRole: 'CAPTAIN' | 'MEMBER' }

type RankingState = 'loading' | 'ready' | 'empty' | 'error' | 'conflict'

const rankingOptions: Array<{ key: GameRankingType, label: string }> = [
  { key: 'TEAM_HALF_YEAR', label: '团队半年榜' },
  { key: 'TEAM_YEAR', label: '团队年度榜' },
  { key: 'INDIVIDUAL_SEASON', label: '个人赛季榜' },
  { key: 'INDIVIDUAL_ALL_TIME', label: '个人累计榜' },
]

function defaultRankingType(season?: GameSeason): GameRankingType {
  return season?.periodKind === 'YEAR' ? 'TEAM_YEAR' : 'TEAM_HALF_YEAR'
}

function rankingFailure(error: unknown, fallback: string): { state: 'error' | 'conflict', message: string } {
  if (error instanceof MipGameError && error.code === 'CONFLICT') {
    return { state: 'conflict', message: '排行榜状态已变化，请重新加载后再操作。' }
  }
  return { state: 'error', message: error instanceof Error ? error.message : fallback }
}

function dateText(value: string) {
  return value ? new Date(value).toISOString().slice(0, 10) : ''
}
function isoDay(value: string, end = false) {
  return new Date(`${value}T${end ? '23:59:59' : '00:00:00'}+08:00`).toISOString()
}

Page({
  data: {
    state: 'loading' as 'loading' | 'ready' | 'error' | 'forbidden' | 'conflict',
    seasons: [] as GameSeason[],
    selectedSeasonId: '',
    teams: [] as GameTeam[],
    branches: [] as GameBranchFilter[],
    matches: [] as GameMatch[],
    rankingOptions,
    rankingType: 'TEAM_HALF_YEAR' as GameRankingType,
    rankingBranchId: '',
    rankings: [] as GameRankingEntry[],
    rankingState: 'loading' as RankingState,
    rankingGeneratedText: '',
    rankingPeriodText: '',
    rankingLoading: false,
    rankingRequestKey: 0,
    rankingMessage: '',
    editorOpen: false,
    editingSeasonId: '',
    expectedSeasonVersion: 0,
    seasonKey: '',
    seasonName: '',
    seasonSummary: '',
    rulesText: '团队与个人排名均以服务端记录的经验值为准。每周对阵在周期结束后结算，历史结果不随后续经验值变化。',
    periodKind: 'HALF_YEAR' as GamePeriodKind,
    startsDate: '',
    endsDate: '',
    teamName: '',
    teamSummary: '',
    teamBranchIndex: -1,
    matchTeamAIndex: 0,
    matchTeamBIndex: 1,
    matchWeekStart: '',
    matchWeekEnd: '',
    memberPanelOpen: false,
    memberTeamId: '',
    memberTeamName: '',
    memberTeamVersion: 0,
    memberRequestKey: 0,
    members: [] as MemberView[],
    maxTeamMembers: 0,
    selectedMemberCount: 0,
    processing: false,
    generatingRankingType: '' as GameRankingType | '',
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
      await mipGameModule.query.getAdminSession(force)
      const result = await mipGameModule.query.listSeasons(force)
      const selectedSeasonId = this.data.selectedSeasonId && result.items.some(item => item.id === this.data.selectedSeasonId)
        ? this.data.selectedSeasonId
        : (result.items[0]?.id || '')
      const seasonChanged = selectedSeasonId !== this.data.selectedSeasonId
      const selectedSeason = result.items.find(item => item.id === selectedSeasonId)
      this.setData({
        seasons: result.items,
        selectedSeasonId,
        state: 'ready',
        ...(seasonChanged
          ? { rankingType: defaultRankingType(selectedSeason), rankingBranchId: '' }
          : {}),
      })
      if (selectedSeasonId) {
        await this.loadSeasonData(force)
      }
      else {
        this.setData({
          teams: [],
          matches: [],
          branches: [],
          rankings: [],
          rankingState: 'empty',
          rankingGeneratedText: '',
          rankingPeriodText: '',
          rankingMessage: '',
        })
      }
    }
    catch (error) {
      const code = (error as { code?: string })?.code
      this.setData({
        state: code === 'FORBIDDEN' ? 'forbidden' : code === 'CONFLICT' ? 'conflict' : 'error',
        message: error instanceof Error ? error.message : '赛季管理加载失败',
      })
    }
  },

  async loadSeasonData(force = false) {
    const seasonId = this.data.selectedSeasonId
    if (!seasonId) {
      return
    }
    const [teams, matches] = await Promise.all([
      mipGameModule.query.listTeams(seasonId, force),
      mipGameModule.query.listAdminMatches(seasonId, force),
    ])
    if (seasonId !== this.data.selectedSeasonId) {
      return
    }
    this.setData({ teams: teams.items, matches: matches.items })
    await this.loadRanking(force)
  },

  async chooseSeason(event: WechatMiniprogram.TouchEvent) {
    const selectedSeasonId = String(event.currentTarget.dataset.id || '')
    const season = this.data.seasons.find(item => item.id === selectedSeasonId)
    this.setData({
      selectedSeasonId,
      memberPanelOpen: false,
      memberRequestKey: this.data.memberRequestKey + 1,
      processing: false,
      message: '',
      rankingType: defaultRankingType(season),
      rankingBranchId: '',
    })
    try {
      await this.loadSeasonData(true)
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '赛季数据加载失败' })
    }
  },

  openCreateSeason() {
    const now = new Date()
    const end = new Date(now.getFullYear(), now.getMonth() + 6, now.getDate())
    this.setData({
      editorOpen: true,
      editingSeasonId: '',
      expectedSeasonVersion: 0,
      seasonKey: `season-${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`,
      seasonName: '',
      seasonSummary: '',
      rulesText: '团队与个人排名均以服务端记录的经验值为准。每周对阵在周期结束后结算，历史结果不随后续经验值变化。',
      periodKind: 'HALF_YEAR',
      startsDate: dateText(now.toISOString()),
      endsDate: dateText(end.toISOString()),
    })
  },

  editSeason(event: WechatMiniprogram.TouchEvent) {
    const season = this.data.seasons.find(item => item.id === String(event.currentTarget.dataset.id || ''))
    if (!season || season.status === 'CLOSED') {
      return
    }
    this.setData({
      editorOpen: true,
      editingSeasonId: season.id,
      expectedSeasonVersion: season.version,
      seasonKey: season.seasonKey,
      seasonName: season.name,
      seasonSummary: season.summary,
      rulesText: season.rulesText,
      periodKind: season.periodKind,
      startsDate: dateText(season.startsAt),
      endsDate: dateText(season.endsAt),
    })
  },

  closeEditor() {
    this.setData({ editorOpen: false })
  },
  updateField(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    const field = String(event.currentTarget.dataset.field || '')
    if (['seasonKey', 'seasonName', 'seasonSummary', 'rulesText', 'teamName', 'teamSummary'].includes(field)) {
      this.setData({ [field]: event.detail.value })
    }
  },
  choosePeriod(event: WechatMiniprogram.TouchEvent) {
    this.setData({ periodKind: event.currentTarget.dataset.kind as GamePeriodKind })
  },
  updateStartsDate(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    this.setData({ startsDate: event.detail.value })
  },
  updateEndsDate(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    this.setData({ endsDate: event.detail.value })
  },

  async saveSeason() {
    if (this.data.processing || !this.data.seasonName.trim() || !this.data.rulesText.trim()
      || !this.data.startsDate || !this.data.endsDate) {
      return
    }
    this.setData({ processing: true, message: '' })
    try {
      const saved = await mipGameModule.mutation.saveSeason({
        seasonId: this.data.editingSeasonId || undefined,
        expectedVersion: this.data.editingSeasonId ? this.data.expectedSeasonVersion : undefined,
        season: {
          seasonKey: this.data.seasonKey,
          name: this.data.seasonName,
          summary: this.data.seasonSummary,
          rulesText: this.data.rulesText,
          periodKind: this.data.periodKind,
          startsAt: isoDay(this.data.startsDate),
          endsAt: isoDay(this.data.endsDate, true),
        },
      })
      this.setData({ editorOpen: false, selectedSeasonId: saved.id })
      wx.showToast({ title: '赛季已保存', icon: 'success' })
      await this.load()
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '赛季保存失败' })
    }
    finally {
      this.setData({ processing: false })
    }
  },

  async changeSeasonStatus(event: WechatMiniprogram.TouchEvent) {
    const season = this.data.seasons.find(item => item.id === String(event.currentTarget.dataset.id || ''))
    const status = String(event.currentTarget.dataset.status || '') as 'ACTIVE' | 'CLOSED'
    if (!season || !['ACTIVE', 'CLOSED'].includes(status) || this.data.processing) {
      return
    }
    const modal = await wx.showModal({ title: status === 'ACTIVE' ? '启用赛季' : '结束赛季', content: status === 'ACTIVE' ? '启用后用户可以查看赛季内容。' : '结束后赛季配置不可再修改，历史记录继续保留。' })
    if (!modal.confirm) {
      return
    }
    this.setData({ processing: true, message: '' })
    try {
      await mipGameModule.mutation.changeSeasonStatus(season.id, season.version, status)
      await this.load()
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '赛季状态更新失败' })
    }
    finally {
      this.setData({ processing: false })
    }
  },

  updateBranch(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    this.setData({ teamBranchIndex: Number(event.detail.value) })
  },
  async createTeam() {
    if (!this.data.selectedSeasonId || !this.data.teamName.trim() || this.data.processing) {
      return
    }
    this.setData({ processing: true, message: '' })
    try {
      await mipGameModule.mutation.saveTeam({ team: {
        seasonId: this.data.selectedSeasonId,
        branchId: this.data.branches[this.data.teamBranchIndex]?.id,
        name: this.data.teamName,
        summary: this.data.teamSummary,
      } })
      this.setData({ teamName: '', teamSummary: '', teamBranchIndex: -1 })
      await this.loadSeasonData()
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '队伍创建失败' })
    }
    finally {
      this.setData({ processing: false })
    }
  },

  async openMembers(event: WechatMiniprogram.TouchEvent) {
    const team = this.data.teams.find(item => item.id === String(event.currentTarget.dataset.id || ''))
    if (!team) {
      return
    }
    const seasonId = this.data.selectedSeasonId
    const requestKey = this.data.memberRequestKey + 1
    this.setData({
      processing: true,
      memberRequestKey: requestKey,
      message: '',
      memberPanelOpen: false,
      memberTeamId: '',
      memberTeamName: '',
      memberTeamVersion: 0,
      members: [],
      maxTeamMembers: 0,
      selectedMemberCount: 0,
    })
    try {
      const result = await mipGameModule.query.listAllAssignableMembers(
        seasonId,
        undefined,
        true,
      )
      const currentTeam = this.data.teams.find(item => item.id === team.id)
      if (requestKey !== this.data.memberRequestKey
        || seasonId !== this.data.selectedSeasonId
        || currentTeam?.version !== team.version) {
        return
      }
      const members = result.items.map(item => ({
        ...item,
        selected: item.teamId === team.id,
        selectedRole: item.teamId === team.id && item.role === 'CAPTAIN' ? 'CAPTAIN' as const : 'MEMBER' as const,
      }))
      this.setData({
        memberPanelOpen: true,
        memberTeamId: team.id,
        memberTeamName: team.name,
        memberTeamVersion: team.version,
        members,
        maxTeamMembers: result.maxTeamMembers,
        selectedMemberCount: members.filter(item => item.selected).length,
      })
    }
    catch (error) {
      if (requestKey === this.data.memberRequestKey) {
        this.setData({ message: error instanceof Error ? error.message : '成员列表加载失败' })
      }
    }
    finally {
      if (requestKey === this.data.memberRequestKey) {
        this.setData({ processing: false })
      }
    }
  },

  toggleMember(event: WechatMiniprogram.TouchEvent) {
    const index = Number(event.currentTarget.dataset.index)
    const member = this.data.members[index]
    if (!member) {
      return
    }
    if (!member.selected && this.data.selectedMemberCount >= this.data.maxTeamMembers) {
      this.setData({ message: `每个队伍最多可选择 ${this.data.maxTeamMembers} 名成员` })
      return
    }
    const key = `members[${index}].selected`
    this.setData({
      [key]: !member.selected,
      selectedMemberCount: this.data.selectedMemberCount + (member.selected ? -1 : 1),
      message: '',
    })
  },
  setCaptain(event: WechatMiniprogram.TouchEvent) {
    const index = Number(event.currentTarget.dataset.index)
    const member = this.data.members[index]
    if (!member) {
      return
    }
    if (!member.selected && this.data.selectedMemberCount >= this.data.maxTeamMembers) {
      this.setData({ message: `每个队伍最多可选择 ${this.data.maxTeamMembers} 名成员` })
      return
    }
    const members = this.data.members.map((item, itemIndex) => ({
      ...item,
      selected: itemIndex === index ? true : item.selected,
      selectedRole: itemIndex === index ? 'CAPTAIN' as const : 'MEMBER' as const,
    }))
    this.setData({
      members,
      selectedMemberCount: members.filter(item => item.selected).length,
      message: '',
    })
  },
  async saveMembers() {
    if (!this.data.memberTeamId || this.data.processing) {
      return
    }
    const members: GameMemberAssignment[] = this.data.members
      .filter(item => item.selected)
      .map(item => ({ memberRef: item.memberRef, role: item.selectedRole }))
    this.setData({ processing: true, message: '' })
    try {
      await mipGameModule.mutation.replaceTeamMembers(
        this.data.selectedSeasonId,
        this.data.memberTeamId,
        this.data.memberTeamVersion,
        members,
      )
      this.setData({ memberPanelOpen: false })
      await this.loadSeasonData()
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '成员保存失败' })
    }
    finally {
      this.setData({ processing: false })
    }
  },

  updateMatchTeamA(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    this.setData({ matchTeamAIndex: Number(event.detail.value) })
  },
  updateMatchTeamB(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    this.setData({ matchTeamBIndex: Number(event.detail.value) })
  },
  updateMatchStart(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    this.setData({ matchWeekStart: event.detail.value })
  },
  updateMatchEnd(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    this.setData({ matchWeekEnd: event.detail.value })
  },
  async createMatch() {
    const teamA = this.data.teams[this.data.matchTeamAIndex]
    const teamB = this.data.teams[this.data.matchTeamBIndex]
    if (!teamA || !teamB || teamA.id === teamB.id
      || !this.data.matchWeekStart || !this.data.matchWeekEnd || this.data.processing) {
      return
    }
    this.setData({ processing: true, message: '' })
    try {
      await mipGameModule.mutation.saveWeeklyMatch({
        seasonId: this.data.selectedSeasonId,
        teamAId: teamA.id,
        teamBId: teamB.id,
        weekStart: this.data.matchWeekStart,
        weekEnd: this.data.matchWeekEnd,
      })
      await this.loadSeasonData()
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '对阵创建失败' })
    }
    finally {
      this.setData({ processing: false })
    }
  },

  async finalizeMatch(event: WechatMiniprogram.TouchEvent) {
    const match = this.data.matches.find(item => item.id === String(event.currentTarget.dataset.id || ''))
    if (!match || match.status !== 'SCHEDULED' || this.data.processing) {
      return
    }
    this.setData({ processing: true, message: '' })
    try {
      await mipGameModule.mutation.finalizeWeeklyMatch(match.id, match.version)
      await this.loadSeasonData()
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '对阵结算失败' })
    }
    finally {
      this.setData({ processing: false })
    }
  },

  async generateRanking(event: WechatMiniprogram.TouchEvent) {
    const type = String(event.currentTarget.dataset.type || '') as GameRankingType
    await this.generateRankingType(type)
  },

  async generateCurrentRanking() {
    await this.generateRankingType(this.data.rankingType)
  },

  async generateRankingType(type: GameRankingType) {
    if (!this.data.selectedSeasonId || this.data.processing || this.data.rankingLoading
      || !rankingOptions.some(item => item.key === type)) {
      return
    }
    this.setData({ processing: true, generatingRankingType: type, message: '', rankingMessage: '' })
    try {
      const result = await mipGameModule.mutation.generateRankingSnapshot(this.data.selectedSeasonId, type)
      wx.showToast({ title: `已生成 ${result.entryCount} 条`, icon: 'none' })
      this.setData({ rankingType: type, rankingBranchId: '' })
      await this.loadRanking(true)
    }
    catch (error) {
      const failure = rankingFailure(error, '排行榜生成失败')
      this.setData({ rankingState: failure.state, rankingMessage: failure.message })
    }
    finally {
      this.setData({ processing: false, generatingRankingType: '' })
    }
  },

  async changeRanking(event: WechatMiniprogram.TouchEvent) {
    const rankingType = String(event.currentTarget.dataset.type || '') as GameRankingType
    if (!rankingOptions.some(item => item.key === rankingType) || rankingType === this.data.rankingType) {
      return
    }
    this.setData({ rankingType, rankingBranchId: '', rankingMessage: '' })
    await this.loadRanking(true)
  },

  async changeRankingBranch(event: WechatMiniprogram.TouchEvent) {
    const rankingBranchId = String(event.currentTarget.dataset.id || '')
    if (rankingBranchId === this.data.rankingBranchId) {
      return
    }
    this.setData({ rankingBranchId, rankingMessage: '' })
    await this.loadRanking(true)
  },

  async retryRanking() {
    await this.loadRanking(true)
  },

  async loadRanking(force = false) {
    const seasonId = this.data.selectedSeasonId
    if (!seasonId) {
      return
    }
    const rankingType = this.data.rankingType
    const rankingBranchId = this.data.rankingBranchId
    const requestKey = this.data.rankingRequestKey + 1
    this.setData({
      rankingLoading: true,
      rankingRequestKey: requestKey,
      rankingState: 'loading',
      rankings: [],
      rankingGeneratedText: '',
      rankingPeriodText: '',
      rankingMessage: '',
    })
    try {
      const ranking = await mipGameModule.query.listAdminRankings(
        seasonId,
        rankingType,
        rankingBranchId || undefined,
        force,
      )
      if (requestKey !== this.data.rankingRequestKey) {
        return
      }
      const branchStillActive = !rankingBranchId || ranking.branches.some(item => item.id === rankingBranchId)
      if (!branchStillActive) {
        this.setData({ rankingBranchId: '' })
        const unfiltered = await mipGameModule.query.listAdminRankings(seasonId, rankingType, undefined, true)
        if (requestKey !== this.data.rankingRequestKey) {
          return
        }
        this.applyRanking(unfiltered)
        return
      }
      this.applyRanking(ranking)
    }
    catch (error) {
      if (requestKey !== this.data.rankingRequestKey) {
        return
      }
      if (error instanceof MipGameError && error.code === 'FORBIDDEN') {
        this.setData({ state: 'forbidden', rankings: [], branches: [], rankingMessage: '' })
        return
      }
      const failure = rankingFailure(error, '排行榜加载失败')
      this.setData({ rankingState: failure.state, rankingMessage: failure.message })
    }
    finally {
      if (requestKey === this.data.rankingRequestKey) {
        this.setData({ rankingLoading: false })
      }
    }
  },

  applyRanking(ranking: Awaited<ReturnType<typeof mipGameModule.query.listAdminRankings>>) {
    const hasSnapshot = Boolean(ranking.generatedAt)
    const periodStart = ranking.periodStart ? formatLocalDate(ranking.periodStart) : ''
    const periodEnd = ranking.periodEnd ? formatLocalDate(ranking.periodEnd) : ''
    this.setData({
      rankings: ranking.items,
      branches: ranking.branches,
      rankingState: hasSnapshot ? 'ready' : 'empty',
      rankingGeneratedText: hasSnapshot ? formatLocalDateTime(ranking.generatedAt) : '',
      rankingPeriodText: periodStart && periodEnd ? `${periodStart} 至 ${periodEnd}` : '',
      rankingMessage: '',
    })
  },
})
