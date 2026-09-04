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
}

export interface MipGameMutationFacade {
  drawBlindBox: MipGameGateway['drawBlindBox']
}

type GameQueryScope = 'season' | 'blind-box'

export function createMipGameModule(gateway: MipGameGateway) {
  const cache = createQueryCache(15_000)

  function cacheKey(scope: GameQueryScope, name: string, input: unknown = {}) {
    return `mip-game:${scope}:${name}:${JSON.stringify(input)}`
  }

  function queryCached<T>(
    scope: GameQueryScope,
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
  }

  const mutation: MipGameMutationFacade = {
    drawBlindBox: (catalogId, requestId) => mutate(
      'blind-box',
      () => gateway.drawBlindBox(catalogId, requestId),
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
