import type {
  AssignableGameMember,
  GameBranchFilter,
  GameMatch,
  GameMemberAssignment,
  GamePeriodKind,
  GameRankingType,
  GameSeason,
  GameTeam,
} from '../../../modules/mip-game'
import { mipGameModule } from '../../../modules/mip-game'

interface MemberView extends AssignableGameMember { selected: boolean, selectedRole: 'CAPTAIN' | 'MEMBER' }

function dateText(value: string) {
  return value ? new Date(value).toISOString().slice(0, 10) : ''
}
function isoDay(value: string, end = false) {
  return new Date(`${value}T${end ? '23:59:59' : '00:00:00'}+08:00`).toISOString()
}

Page({
  data: {
    state: 'loading' as 'loading' | 'ready' | 'error' | 'forbidden',
    seasons: [] as GameSeason[],
    selectedSeasonId: '',
    teams: [] as GameTeam[],
    branches: [] as GameBranchFilter[],
    matches: [] as GameMatch[],
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
    members: [] as MemberView[],
    processing: false,
    message: '',
  },

  onShow() { void this.load() },
  async onPullDownRefresh() {
    try {
      await this.load()
    }
    finally {
      wx.stopPullDownRefresh()
    }
  },

  async load() {
    this.setData({ state: 'loading', message: '' })
    try {
      await mipGameModule.gateway.getAdminSession()
      const result = await mipGameModule.gateway.listSeasons()
      const selectedSeasonId = this.data.selectedSeasonId && result.items.some(item => item.id === this.data.selectedSeasonId)
        ? this.data.selectedSeasonId
        : (result.items[0]?.id || '')
      this.setData({ seasons: result.items, selectedSeasonId, state: 'ready' })
      if (selectedSeasonId) {
        await this.loadSeasonData()
      }
      else {
        this.setData({ teams: [], matches: [], branches: [] })
      }
    }
    catch (error) {
      const code = (error as { code?: string })?.code
      this.setData({
        state: code === 'FORBIDDEN' ? 'forbidden' : 'error',
        message: error instanceof Error ? error.message : '赛季管理加载失败',
      })
    }
  },

  async loadSeasonData() {
    const seasonId = this.data.selectedSeasonId
    if (!seasonId) {
      return
    }
    const season = this.data.seasons.find(item => item.id === seasonId)
    const rankingType: GameRankingType = season?.periodKind === 'YEAR' ? 'TEAM_YEAR' : 'TEAM_HALF_YEAR'
    const [teams, matches, ranking] = await Promise.all([
      mipGameModule.gateway.listTeams(seasonId),
      mipGameModule.gateway.listAdminMatches(seasonId),
      mipGameModule.gateway.listAdminRankings(seasonId, rankingType),
    ])
    this.setData({ teams: teams.items, matches: matches.items, branches: ranking.branches })
  },

  async chooseSeason(event: WechatMiniprogram.TouchEvent) {
    const selectedSeasonId = String(event.currentTarget.dataset.id || '')
    this.setData({ selectedSeasonId, memberPanelOpen: false, message: '' })
    try {
      await this.loadSeasonData()
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
      const saved = await mipGameModule.gateway.saveSeason({
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
      await mipGameModule.gateway.changeSeasonStatus(season.id, season.version, status)
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
      await mipGameModule.gateway.saveTeam({ team: {
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
    this.setData({ processing: true, message: '' })
    try {
      const result = await mipGameModule.gateway.listAssignableMembers(this.data.selectedSeasonId)
      this.setData({
        memberPanelOpen: true,
        memberTeamId: team.id,
        memberTeamName: team.name,
        memberTeamVersion: team.version,
        members: result.items.map(item => ({
          ...item,
          selected: item.teamId === team.id,
          selectedRole: item.teamId === team.id && item.role === 'CAPTAIN' ? 'CAPTAIN' : 'MEMBER',
        })),
      })
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '成员列表加载失败' })
    }
    finally {
      this.setData({ processing: false })
    }
  },

  toggleMember(event: WechatMiniprogram.TouchEvent) {
    const index = Number(event.currentTarget.dataset.index)
    const key = `members[${index}].selected`
    this.setData({ [key]: !this.data.members[index].selected })
  },
  setCaptain(event: WechatMiniprogram.TouchEvent) {
    const index = Number(event.currentTarget.dataset.index)
    const members = this.data.members.map((item, itemIndex) => ({
      ...item,
      selected: itemIndex === index ? true : item.selected,
      selectedRole: itemIndex === index ? 'CAPTAIN' as const : 'MEMBER' as const,
    }))
    this.setData({ members })
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
      await mipGameModule.gateway.replaceTeamMembers(
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
      await mipGameModule.gateway.saveWeeklyMatch({
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
      await mipGameModule.gateway.finalizeWeeklyMatch(match.id, match.version)
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
    if (!this.data.selectedSeasonId || this.data.processing) {
      return
    }
    this.setData({ processing: true, message: '' })
    try {
      const result = await mipGameModule.gateway.generateRankingSnapshot(this.data.selectedSeasonId, type)
      wx.showToast({ title: `已生成 ${result.entryCount} 条`, icon: 'none' })
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '排行榜生成失败' })
    }
    finally {
      this.setData({ processing: false })
    }
  },
})
