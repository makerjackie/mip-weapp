import type { GameTeamDetail, GameTeamMember } from '../../../../modules/mip-game'
import { mipGameModule } from '../../../../modules/mip-game'

interface GameTeamMemberView extends GameTeamMember { joinedDateText: string, leftDateText: string }
interface GameTeamDetailView extends Omit<GameTeamDetail, 'members' | 'formerMembers'> {
  members: GameTeamMemberView[]
  formerMembers: GameTeamMemberView[]
}

function memberView(member: GameTeamMember): GameTeamMemberView {
  return {
    ...member,
    joinedDateText: member.joinedAt.slice(0, 10),
    leftDateText: member.leftAt.slice(0, 10),
  }
}

Page({
  data: {
    state: 'loading' as 'loading' | 'ready' | 'error',
    teamId: '',
    team: null as GameTeamDetailView | null,
    message: '',
  },

  onLoad(options: Record<string, string>) {
    this.setData({ teamId: String(options.teamId || '') })
    void this.loadTeam()
  },

  async loadTeam() {
    if (!this.data.teamId) {
      this.setData({ state: 'error', message: '队伍参数无效' })
      return
    }
    this.setData({ state: 'loading', message: '' })
    try {
      const team = await mipGameModule.query.getTeam(this.data.teamId)
      this.setData({
        state: 'ready',
        team: {
          ...team,
          members: team.members.map(memberView),
          formerMembers: team.formerMembers.map(memberView),
        },
      })
    }
    catch (error) {
      this.setData({ state: 'error', message: error instanceof Error ? error.message : '队伍信息加载失败' })
    }
  },
})
