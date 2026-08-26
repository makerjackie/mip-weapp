import type { GameRankingType, MipGameGateway } from './types'
import { createQueryCache } from '@weapp/shared/cache'

export interface MipGameQueryFacade {
  listBlindBoxes: (force?: boolean) => ReturnType<MipGameGateway['listBlindBoxes']>
  getBlindBox: (catalogId: string, force?: boolean) => ReturnType<MipGameGateway['getBlindBox']>
  getBlindBoxInventory: (
    catalogId?: string,
    force?: boolean,
  ) => ReturnType<MipGameGateway['getBlindBoxInventory']>
  listBlindBoxCoinEntries: (
    limit?: number,
    force?: boolean,
  ) => ReturnType<MipGameGateway['listBlindBoxCoinEntries']>
  getOverview: (seasonId?: string, force?: boolean) => ReturnType<MipGameGateway['getOverview']>
  getRules: (seasonId?: string, force?: boolean) => ReturnType<MipGameGateway['getRules']>
  getTeam: (teamId: string, force?: boolean) => ReturnType<MipGameGateway['getTeam']>
  listHistory: (seasonId?: string, force?: boolean) => ReturnType<MipGameGateway['listHistory']>
  listRankings: (
    seasonId: string,
    rankingType: GameRankingType,
    branchId?: string,
    force?: boolean,
  ) => ReturnType<MipGameGateway['listRankings']>
  getAdminSession: (force?: boolean) => ReturnType<MipGameGateway['getAdminSession']>
  listAdminRankings: (
    seasonId: string,
    rankingType: GameRankingType,
    branchId?: string,
    force?: boolean,
  ) => ReturnType<MipGameGateway['listAdminRankings']>
  listSeasons: (force?: boolean) => ReturnType<MipGameGateway['listSeasons']>
  listTeams: (seasonId: string, force?: boolean) => ReturnType<MipGameGateway['listTeams']>
  listAssignableMembers: (
    seasonId: string,
    query?: string,
    force?: boolean,
  ) => ReturnType<MipGameGateway['listAssignableMembers']>
  listAdminMatches: (
    seasonId: string,
    force?: boolean,
  ) => ReturnType<MipGameGateway['listAdminMatches']>
  adminListBlindBoxCatalogs: (
    force?: boolean,
  ) => ReturnType<MipGameGateway['adminListBlindBoxCatalogs']>
  adminListBlindBoxCards: (
    catalogId: string,
    force?: boolean,
  ) => ReturnType<MipGameGateway['adminListBlindBoxCards']>
}

export interface MipGameMutationFacade {
  drawBlindBox: MipGameGateway['drawBlindBox']
  saveSeason: MipGameGateway['saveSeason']
  changeSeasonStatus: MipGameGateway['changeSeasonStatus']
  saveTeam: MipGameGateway['saveTeam']
  replaceTeamMembers: MipGameGateway['replaceTeamMembers']
  saveWeeklyMatch: MipGameGateway['saveWeeklyMatch']
  finalizeWeeklyMatch: MipGameGateway['finalizeWeeklyMatch']
  generateRankingSnapshot: MipGameGateway['generateRankingSnapshot']
  adminSaveBlindBoxCatalog: MipGameGateway['adminSaveBlindBoxCatalog']
  adminChangeBlindBoxCatalogStatus: MipGameGateway['adminChangeBlindBoxCatalogStatus']
  adminSaveBlindBoxCard: MipGameGateway['adminSaveBlindBoxCard']
  adminChangeBlindBoxCardStatus: MipGameGateway['adminChangeBlindBoxCardStatus']
}

type GameQueryScope = 'season' | 'blind-box'

export function createMipGameModule(gateway: MipGameGateway) {
  const cache = createQueryCache(15_000)

  function cacheKey(scope: GameQueryScope | 'session', name: string, input: unknown = {}) {
    return `mip-game:${scope}:${name}:${JSON.stringify(input)}`
  }

  function queryCached<T>(
    scope: GameQueryScope | 'session',
    name: string,
    input: unknown,
    loader: () => Promise<T>,
    force: boolean,
  ) {
    return cache.query(cacheKey(scope, name, input), loader, { force })
  }

  async function mutate<T>(scope: GameQueryScope, work: () => Promise<T>) {
    const result = await work()
    cache.invalidate(`mip-game:${scope}`)
    return result
  }

  const query: MipGameQueryFacade = {
    listBlindBoxes: (force = false) => queryCached(
      'blind-box',
      'catalogs',
      {},
      gateway.listBlindBoxes,
      force,
    ),
    getBlindBox: (catalogId, force = false) => queryCached(
      'blind-box',
      'catalog',
      { catalogId },
      () => gateway.getBlindBox(catalogId),
      force,
    ),
    getBlindBoxInventory: (catalogId, force = false) => queryCached(
      'blind-box',
      'inventory',
      { catalogId },
      () => gateway.getBlindBoxInventory(catalogId),
      force,
    ),
    listBlindBoxCoinEntries: (limit, force = false) => queryCached(
      'blind-box',
      'coin-entries',
      { limit },
      () => gateway.listBlindBoxCoinEntries(limit),
      force,
    ),
    getOverview: (seasonId, force = false) => queryCached(
      'season',
      'overview',
      { seasonId },
      () => gateway.getOverview(seasonId),
      force,
    ),
    getRules: (seasonId, force = false) => queryCached(
      'season',
      'rules',
      { seasonId },
      () => gateway.getRules(seasonId),
      force,
    ),
    getTeam: (teamId, force = false) => queryCached(
      'season',
      'team',
      { teamId },
      () => gateway.getTeam(teamId),
      force,
    ),
    listHistory: (seasonId, force = false) => queryCached(
      'season',
      'history',
      { seasonId },
      () => gateway.listHistory(seasonId),
      force,
    ),
    listRankings: (seasonId, rankingType, branchId, force = false) => queryCached(
      'season',
      'rankings',
      { seasonId, rankingType, branchId },
      () => gateway.listRankings(seasonId, rankingType, branchId),
      force,
    ),
    getAdminSession: (force = false) => queryCached(
      'session',
      'admin',
      {},
      gateway.getAdminSession,
      force,
    ),
    listAdminRankings: (seasonId, rankingType, branchId, force = false) => queryCached(
      'season',
      'admin-rankings',
      { seasonId, rankingType, branchId },
      () => gateway.listAdminRankings(seasonId, rankingType, branchId),
      force,
    ),
    listSeasons: (force = false) => queryCached(
      'season',
      'admin-seasons',
      {},
      gateway.listSeasons,
      force,
    ),
    listTeams: (seasonId, force = false) => queryCached(
      'season',
      'admin-teams',
      { seasonId },
      () => gateway.listTeams(seasonId),
      force,
    ),
    listAssignableMembers: (seasonId, memberQuery, force = false) => queryCached(
      'season',
      'assignable-members',
      { seasonId, query: memberQuery },
      () => gateway.listAssignableMembers(seasonId, memberQuery),
      force,
    ),
    listAdminMatches: (seasonId, force = false) => queryCached(
      'season',
      'admin-matches',
      { seasonId },
      () => gateway.listAdminMatches(seasonId),
      force,
    ),
    adminListBlindBoxCatalogs: (force = false) => queryCached(
      'blind-box',
      'admin-catalogs',
      {},
      gateway.adminListBlindBoxCatalogs,
      force,
    ),
    adminListBlindBoxCards: (catalogId, force = false) => queryCached(
      'blind-box',
      'admin-cards',
      { catalogId },
      () => gateway.adminListBlindBoxCards(catalogId),
      force,
    ),
  }

  const mutation: MipGameMutationFacade = {
    drawBlindBox: (catalogId, requestId) => mutate(
      'blind-box',
      () => gateway.drawBlindBox(catalogId, requestId),
    ),
    saveSeason: input => mutate('season', () => gateway.saveSeason(input)),
    changeSeasonStatus: (seasonId, expectedVersion, status) => mutate(
      'season',
      () => gateway.changeSeasonStatus(seasonId, expectedVersion, status),
    ),
    saveTeam: input => mutate('season', () => gateway.saveTeam(input)),
    replaceTeamMembers: (seasonId, teamId, expectedVersion, members) => mutate(
      'season',
      () => gateway.replaceTeamMembers(seasonId, teamId, expectedVersion, members),
    ),
    saveWeeklyMatch: match => mutate('season', () => gateway.saveWeeklyMatch(match)),
    finalizeWeeklyMatch: (matchId, expectedVersion) => mutate(
      'season',
      () => gateway.finalizeWeeklyMatch(matchId, expectedVersion),
    ),
    generateRankingSnapshot: (seasonId, rankingType) => mutate(
      'season',
      () => gateway.generateRankingSnapshot(seasonId, rankingType),
    ),
    adminSaveBlindBoxCatalog: input => mutate(
      'blind-box',
      () => gateway.adminSaveBlindBoxCatalog(input),
    ),
    adminChangeBlindBoxCatalogStatus: (catalogId, expectedVersion, status) => mutate(
      'blind-box',
      () => gateway.adminChangeBlindBoxCatalogStatus(catalogId, expectedVersion, status),
    ),
    adminSaveBlindBoxCard: input => mutate(
      'blind-box',
      () => gateway.adminSaveBlindBoxCard(input),
    ),
    adminChangeBlindBoxCardStatus: (cardId, expectedVersion, status) => mutate(
      'blind-box',
      () => gateway.adminChangeBlindBoxCardStatus(cardId, expectedVersion, status),
    ),
  }

  return {
    mutation,
    query,
    invalidate() {
      cache.invalidate()
    },
    rankingLabels: {
      TEAM_HALF_YEAR: '团队半年榜',
      TEAM_YEAR: '团队年度榜',
      INDIVIDUAL_SEASON: '个人赛季榜',
      INDIVIDUAL_ALL_TIME: '个人累计榜',
    } as const,
  }
}
