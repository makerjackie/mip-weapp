import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  ADMIN_GAME_MUTATION_ACTIONS,
  ADMIN_GAME_QUERY_ACTIONS,
  buildGameMutationInput,
  createGameMutationDefinition,
  loadGameCatalogDetail,
  loadGameManagementPage,
  loadGameSeasonDetail,
  loadGameTeamDetail,
  type AdminGameMutationAction,
} from './admin-game-management.ts'

const seasonId = '30000000-0000-4000-8000-000000000001'
const teamAId = '30000000-0000-4000-8000-000000000002'
const teamBId = '30000000-0000-4000-8000-000000000003'
const matchId = '30000000-0000-4000-8000-000000000004'
const catalogId = '30000000-0000-4000-8000-000000000005'
const cardId = '30000000-0000-4000-8000-000000000006'
const branchId = '30000000-0000-4000-8000-000000000007'

const season = {
  id: seasonId, seasonKey: 'season_2030', name: '2030 上半年赛季', summary: '', rulesText: '按经验值排行',
  rules: { scoreMetric: 'EXPERIENCE', headquartersThresholds: [{ level: 1, minimumExperience: 0, label: '一级大本营' }] },
  periodKind: 'HALF_YEAR', startsAt: '2030-01-01T00:00:00.000Z', endsAt: '2030-06-30T23:59:59.000Z',
  status: 'ACTIVE', version: 2,
}

const team = {
  id: teamAId, seasonId, branchId, branchName: '深圳分会', name: '深圳一队', summary: '',
  memberCount: 1, memberLimit: 20, headquartersLevel: { label: '一级大本营' }, status: 'ACTIVE', version: 3,
}

const catalog = {
  id: catalogId, catalogKey: 'mip_cards', name: 'MIP 卡片', summary: '', rulesText: '消耗游戏币抽取',
  redemptionRulesText: '按运营规则兑换', drawCostCoin: 10, dailyDrawLimit: 20, pityThreshold: 10,
  pityMinRarity: 'RARE', status: 'PUBLISHED', version: 4, cardCount: 1, stockRemaining: 90, stockTotal: 100,
}

const card = {
  id: cardId, catalogId, cardKey: 'growth_card', name: '成长卡', summary: '', rarity: 'COMMON',
  weight: 100, stockTotal: 100, stockRemaining: 90, displayOrder: 0, status: 'PUBLISHED', version: 5,
}

describe('admin game management', () => {
  it('loads the exact game session, season, and catalog queries and fails closed on the game session', async () => {
    const calls: Array<[string, unknown]> = []
    const request = async (action: string, input?: unknown) => {
      calls.push([action, input])
      if (action === 'mip.admin.game.session') return { capability: 'game.manage', roleKey: 'PLATFORM_OPERATIONS' }
      if (action === 'mip.admin.game.seasons.list') return { items: [season] }
      if (action === 'mip.admin.game.blindBoxes.catalogs.list') return { items: [catalog] }
      throw new Error(`UNEXPECTED:${action}`)
    }
    const page = await loadGameManagementPage({ query: '', status: '', cursor: null, limit: 20 }, request)
    assert.deepEqual(calls, [
      ['mip.admin.game.session', undefined],
      ['mip.admin.game.seasons.list', undefined],
      ['mip.admin.game.blindBoxes.catalogs.list', undefined],
    ])
    assert.deepEqual(page.sections.map(item => item.detailTarget), ['gameSeasons', 'gameCatalogs'])
    assert.deepEqual((page.sections[0].rows[0].rowActions as Array<{ action: string }>).map(item => item.action), [
      'mip.admin.game.seasons.save', 'mip.admin.game.seasons.changeStatus',
    ])
    await assert.rejects(
      () => loadGameManagementPage({ query: '', status: '', cursor: null, limit: 20 }, async action => action === 'mip.admin.game.session' ? { capability: 'game.manage', roleKey: 'BRANCH_ADMIN' } : { items: [] }),
      /INVALID_GAME_SESSION/,
    )
  })

  it('loads one season with teams, matches, and a server-generated ranking snapshot', async () => {
    const calls: Array<[string, unknown]> = []
    const detail = await loadGameSeasonDetail(seasonId, async (action, input) => {
      calls.push([action, input])
      if (action === 'mip.admin.game.seasons.list') return { items: [season] }
      if (action === 'mip.admin.game.teams.list') return { items: [team, { ...team, id: teamBId, name: '深圳二队' }] }
      if (action === 'mip.admin.game.matches.list') return { items: [{
        id: matchId, weekStart: '2030-01-03', weekEnd: '2030-01-09',
        teamA: { id: teamAId, name: '深圳一队', score: null }, teamB: { id: teamBId, name: '深圳二队', score: null },
        status: 'SCHEDULED', version: 1,
      }] }
      if (action === 'mip.admin.game.rankings.list') return {
        rankingType: 'TEAM_HALF_YEAR', generatedAt: '2030-01-10T00:00:00.000Z',
        branches: [{ id: branchId, name: '深圳分会' }], items: [{ rank: 1, displayName: '深圳一队', branchName: '深圳分会', score: 100 }],
      }
      throw new Error(`UNEXPECTED:${action}`)
    })
    assert.deepEqual(calls, [
      ['mip.admin.game.seasons.list', undefined],
      ['mip.admin.game.teams.list', { seasonId }],
      ['mip.admin.game.matches.list', { seasonId }],
      ['mip.admin.game.rankings.list', { seasonId, rankingType: 'TEAM_HALF_YEAR', limit: 100 }],
    ])
    assert.equal(detail.route, 'gameSeasons')
    assert.equal(detail.sections.find(item => item.title === '战队')?.detailTarget, 'gameTeams')
    assert.equal(detail.sections.find(item => item.title === '周赛')?.rows?.[0].state, '待结算')
    assert.deepEqual((detail.sections.find(item => item.title === '周赛')?.rows?.[0].rowActions as Array<{ action: string }>).map(item => item.action), ['mip.admin.game.matches.finalize'])
  })

  it('paginates assignable members independently and builds a full replacement input', async () => {
    const calls: Array<[string, unknown]> = []
    const detail = await loadGameTeamDetail(`${seasonId}:${teamAId}`, async (action, input) => {
      calls.push([action, input])
      if (action === 'mip.admin.game.teams.list') return { items: [team] }
      return {
        items: [{ memberRef: 'profile-owner', nickname: '运营成员', branchName: '深圳分会', teamName: '深圳一队', role: 'CAPTAIN' }],
        hasMore: true, nextCursor: 'next_member_cursor', limit: 30,
      }
    }, { query: '运营', cursor: 'current_member_cursor', limit: 30 })
    assert.deepEqual(calls, [
      ['mip.admin.game.teams.list', { seasonId }],
      ['mip.admin.game.members.assignable.list', { seasonId, teamId: teamAId, query: '运营', limit: 30, cursor: 'current_member_cursor' }],
    ])
    assert.deepEqual(detail.sections[1].pager, {
      key: 'gameMembers', query: '运营', nextCursor: 'next_member_cursor', placeholder: '搜索成员或分会',
    })
    const definition = createGameMutationDefinition('mip.admin.game.teams.members.replace', teamAId, { team, seasonId })
    assert.deepEqual(buildGameMutationInput(definition, {
      ...definition.values, memberRefs: ['profile-owner', 'profile-member'], captainRef: 'profile-owner',
    }), {
      seasonId, teamId: teamAId, expectedVersion: 3,
      members: [{ memberRef: 'profile-owner', role: 'CAPTAIN' }, { memberRef: 'profile-member', role: 'MEMBER' }],
    })
  })

  it('loads blind-box cards and builds all reviewed game mutation inputs without score or reward fields', async () => {
    const detail = await loadGameCatalogDetail(catalogId, async (action, input) => {
      if (action === 'mip.admin.game.blindBoxes.catalogs.list') return { items: [catalog] }
      assert.deepEqual(input, { catalogId })
      return { items: [card] }
    })
    assert.equal(detail.sections[1].rows?.[0].state, '已发布')
    assert.deepEqual((detail.sections[1].rows?.[0].rowActions as Array<{ action: string }>).map(item => item.action), [
      'mip.admin.game.blindBoxes.cards.save', 'mip.admin.game.blindBoxes.cards.changeStatus',
    ])

    const build = (action: AdminGameMutationAction, values: Record<string, unknown>, source: Record<string, unknown> = {}, targetId = '') => {
      const definition = createGameMutationDefinition(action, targetId, source)
      return buildGameMutationInput(definition, { ...definition.values, ...values })
    }
    const inputs = new Map<AdminGameMutationAction, unknown>([
      ['mip.admin.game.seasons.save', build('mip.admin.game.seasons.save', season, {}, '')],
      ['mip.admin.game.seasons.changeStatus', build('mip.admin.game.seasons.changeStatus', { seasonId, expectedVersion: 2, status: 'CLOSED' })],
      ['mip.admin.game.teams.save', build('mip.admin.game.teams.save', team, { season, branches: [{ id: branchId, name: '深圳分会' }] }, '')],
      ['mip.admin.game.teams.changeStatus', build('mip.admin.game.teams.changeStatus', { seasonId, teamId: teamAId, expectedVersion: 3, status: 'INACTIVE' })],
      ['mip.admin.game.teams.members.replace', build('mip.admin.game.teams.members.replace', { seasonId, teamId: teamAId, expectedVersion: 3, memberRefs: [], captainRef: '' })],
      ['mip.admin.game.matches.save', build('mip.admin.game.matches.save', { seasonId, weekStart: '2030-01-03', weekEnd: '2030-01-09', teamAId, teamBId })],
      ['mip.admin.game.matches.finalize', build('mip.admin.game.matches.finalize', { matchId, expectedVersion: 1 })],
      ['mip.admin.game.rankings.generate', build('mip.admin.game.rankings.generate', { seasonId, rankingType: 'TEAM_HALF_YEAR' })],
      ['mip.admin.game.blindBoxes.catalogs.save', build('mip.admin.game.blindBoxes.catalogs.save', catalog)],
      ['mip.admin.game.blindBoxes.catalogs.changeStatus', build('mip.admin.game.blindBoxes.catalogs.changeStatus', { catalogId, expectedVersion: 4, status: 'UNPUBLISHED' })],
      ['mip.admin.game.blindBoxes.cards.save', build('mip.admin.game.blindBoxes.cards.save', card)],
      ['mip.admin.game.blindBoxes.cards.changeStatus', build('mip.admin.game.blindBoxes.cards.changeStatus', { cardId, expectedVersion: 5, status: 'UNPUBLISHED' })],
    ])
    assert.deepEqual([...inputs.keys()], [...ADMIN_GAME_MUTATION_ACTIONS])
    for (const [action, input] of inputs) {
      assert.ok(input, action)
      const json = JSON.stringify(input)
      assert.equal(/"(?:score|teamAScore|teamBScore|reward)"/.test(json), false, action)
    }
    assert.deepEqual(ADMIN_GAME_QUERY_ACTIONS.length, 8)
  })
})
