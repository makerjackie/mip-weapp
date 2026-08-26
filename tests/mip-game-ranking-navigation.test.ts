import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { rankingTeamRoute } from '../src/modules/mip-game/navigation'

const runtime = JSON.parse(fs.readFileSync(
  new URL('../config/runtime-pages.json', import.meta.url),
  'utf8',
))

describe('MIP game ranking team navigation', () => {
  it('opens TEAM entries and never treats USER entries as teams', () => {
    expect(rankingTeamRoute('TEAM', 'team/a')).toBe(
      '/packages/member/mip-game/team/index?teamId=team%2Fa',
    )
    expect(rankingTeamRoute('USER', 'team/a')).toBe('')
    expect(rankingTeamRoute('TEAM', '')).toBe('')
  })

  it('binds ranking rows and resolves the first real TEAM fixture', () => {
    const page = fs.readFileSync(
      new URL('../src/packages/member/mip-game/index.ts', import.meta.url),
      'utf8',
    )
    const view = fs.readFileSync(
      new URL('../src/packages/member/mip-game/index.wxml', import.meta.url),
      'utf8',
    )
    const route = runtime.routes.find((item: { id: string }) => item.id === 'M35')

    expect(page).toContain('openRankingTeam')
    expect(page).toContain('rankingTeamRoute(')
    expect(view).toContain('data-subject-type="{{item.subjectType}}"')
    expect(view).toContain('data-team-id="{{item.teamId}}"')
    expect(view).toContain('bind:tap="openRankingTeam"')
    expect(route.queryFixture).toEqual({
      sourceRoute: 'packages/member/mip-game/index',
      dataPath: 'rankings',
      where: { subjectType: 'TEAM' },
      values: { teamId: 'teamId' },
    })
  })
})
