import type {
  MipGameAction,
  MipGameActionInputMap,
  MipGameActionResultMap,
  MipGameGateway,
  MipGameRequest,
} from './types'
import { MIP_GAME_CONTRACT_VERSION, MipGameError } from './types'

interface GameEnvelope<T> {
  ok: boolean
  data?: T
  error?: { code?: string, message?: string, retryable?: boolean }
}

export interface MipGameTransport {
  invoke: (request: MipGameRequest) => Promise<unknown>
}

function unwrap<T>(value: unknown): T {
  if (!value || typeof value !== 'object' || typeof (value as GameEnvelope<T>).ok !== 'boolean') {
    throw new MipGameError('SERVICE_UNAVAILABLE', '赛季服务返回了无效响应', true)
  }
  const envelope = value as GameEnvelope<T>
  if (!envelope.ok || envelope.data === undefined) {
    throw new MipGameError(
      envelope.error?.code || 'SERVICE_UNAVAILABLE',
      envelope.error?.message || '赛季服务请求失败',
      envelope.error?.retryable === true,
    )
  }
  return envelope.data
}

export function createMipGameGateway(transport: MipGameTransport): MipGameGateway {
  async function call<A extends MipGameAction>(
    action: A,
    input: MipGameActionInputMap[A],
  ): Promise<MipGameActionResultMap[A]> {
    return unwrap<MipGameActionResultMap[A]>(await transport.invoke({
      contractVersion: MIP_GAME_CONTRACT_VERSION,
      action,
      input,
    }))
  }
  return {
    listBlindBoxes: () => call('listBlindBoxes', {}),
    getBlindBox: catalogId => call('getBlindBox', { catalogId }),
    drawBlindBox: (catalogId, requestId) => call('drawBlindBox', { catalogId, requestId }),
    getBlindBoxInventory: catalogId => call('getBlindBoxInventory', { catalogId }),
    listBlindBoxCoinEntries: limit => call('listBlindBoxCoinEntries', { limit }),
    getOverview: seasonId => call('getOverview', { seasonId }),
    getRules: seasonId => call('getRules', { seasonId }),
    getTeam: teamId => call('getTeam', { teamId }),
    listHistory: seasonId => call('listHistory', { seasonId }),
    listRankings: (seasonId, rankingType, branchId) => call('listRankings', { seasonId, rankingType, branchId }),
    getAdminSession: () => call('admin.getSession', {}),
    listAdminRankings: (seasonId, rankingType, branchId) => call('admin.listRankings', { seasonId, rankingType, branchId }),
    listSeasons: () => call('admin.listSeasons', {}),
    saveSeason: input => call('admin.saveSeason', input),
    changeSeasonStatus: (seasonId, expectedVersion, status) => call('admin.changeSeasonStatus', { seasonId, expectedVersion, status }),
    listTeams: seasonId => call('admin.listTeams', { seasonId }),
    saveTeam: input => call('admin.saveTeam', input),
    listAssignableMembers: (seasonId, query) => call('admin.listAssignableMembers', { seasonId, query }),
    replaceTeamMembers: (seasonId, teamId, expectedVersion, members) => call('admin.replaceTeamMembers', { seasonId, teamId, expectedVersion, members }),
    listAdminMatches: seasonId => call('admin.listMatches', { seasonId }),
    saveWeeklyMatch: match => call('admin.saveWeeklyMatch', { match }),
    finalizeWeeklyMatch: (matchId, expectedVersion) => call('admin.finalizeWeeklyMatch', { matchId, expectedVersion }),
    generateRankingSnapshot: (seasonId, rankingType) => call('admin.generateRankingSnapshot', { seasonId, rankingType }),
    adminListBlindBoxCatalogs: () => call('admin.listBlindBoxCatalogs', {}),
    adminSaveBlindBoxCatalog: input => call('admin.saveBlindBoxCatalog', input),
    adminChangeBlindBoxCatalogStatus: (catalogId, expectedVersion, status) => call('admin.changeBlindBoxCatalogStatus', { catalogId, expectedVersion, status }),
    adminListBlindBoxCards: catalogId => call('admin.listBlindBoxCards', { catalogId }),
    adminSaveBlindBoxCard: input => call('admin.saveBlindBoxCard', input),
    adminChangeBlindBoxCardStatus: (cardId, expectedVersion, status) => call('admin.changeBlindBoxCardStatus', { cardId, expectedVersion, status }),
  }
}
