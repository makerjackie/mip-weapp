import type {
  AssignableGameMember,
  BlindBoxCardAdmin,
  BlindBoxCardDraft,
  BlindBoxCatalogAdmin,
  BlindBoxCatalogDraft,
  BlindBoxCatalogSummary,
  BlindBoxCoinEntry,
  BlindBoxDetail,
  BlindBoxDrawResult,
  BlindBoxInventoryItem,
  GameAdminSession,
  GameMatch,
  GameMemberAssignment,
  GameOverview,
  GameRankingPage,
  GameRankingType,
  GameRules,
  GameSeason,
  GameSeasonDraft,
  GameTeam,
  GameTeamDetail,
  GameTeamDraft,
  MipGameGateway,
} from './types'
import { MipGameError } from './types'

interface GameEnvelope<T> {
  ok: boolean
  data?: T
  error?: { code?: string, message?: string, retryable?: boolean }
}

export interface MipGameTransport {
  invoke: (action: string, data?: Record<string, unknown>) => Promise<unknown>
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
  async function call<T>(action: string, data: Record<string, unknown> = {}) {
    return unwrap<T>(await transport.invoke(action, data))
  }
  return {
    listBlindBoxes: () => call<{ coinBalance: number, items: BlindBoxCatalogSummary[] }>('listBlindBoxes'),
    getBlindBox: catalogId => call<BlindBoxDetail>('getBlindBox', { catalogId }),
    drawBlindBox: (catalogId, requestId) => call<BlindBoxDrawResult>('drawBlindBox', { catalogId, requestId }),
    getBlindBoxInventory: catalogId => call<{ items: BlindBoxInventoryItem[] }>('getBlindBoxInventory', { catalogId }),
    listBlindBoxCoinEntries: limit => call<{ coinBalance: number, items: BlindBoxCoinEntry[] }>('listBlindBoxCoinEntries', { limit }),
    getOverview: seasonId => call<GameOverview>('getOverview', { seasonId }),
    getRules: seasonId => call<{ seasonId: string, seasonName: string, rulesText: string, rules: GameRules }>('getRules', { seasonId }),
    getTeam: teamId => call<GameTeamDetail>('getTeam', { teamId }),
    listHistory: seasonId => call<{ season: GameSeason | null, items: GameMatch[] }>('listHistory', { seasonId }),
    listRankings: (seasonId, rankingType, branchId) => call<GameRankingPage>('listRankings', { seasonId, rankingType, branchId }),
    getAdminSession: () => call<GameAdminSession>('admin.getSession'),
    listAdminRankings: (seasonId, rankingType, branchId) => call<GameRankingPage>('admin.listRankings', { seasonId, rankingType, branchId }),
    listSeasons: () => call<{ items: GameSeason[] }>('admin.listSeasons'),
    saveSeason: (input: { seasonId?: string, expectedVersion?: number, season: GameSeasonDraft }) => call<GameSeason>('admin.saveSeason', input),
    changeSeasonStatus: (seasonId, expectedVersion, status) => call<GameSeason>('admin.changeSeasonStatus', { seasonId, expectedVersion, status }),
    listTeams: seasonId => call<{ items: GameTeam[] }>('admin.listTeams', { seasonId }),
    saveTeam: (input: { teamId?: string, expectedVersion?: number, team: GameTeamDraft }) => call<GameTeam>('admin.saveTeam', input),
    listAssignableMembers: (seasonId, query) => call<{ items: AssignableGameMember[] }>('admin.listAssignableMembers', { seasonId, query }),
    replaceTeamMembers: (seasonId: string, teamId: string, expectedVersion: number, members: GameMemberAssignment[]) => call('admin.replaceTeamMembers', { seasonId, teamId, expectedVersion, members }),
    listAdminMatches: seasonId => call<{ items: GameMatch[] }>('admin.listMatches', { seasonId }),
    saveWeeklyMatch: match => call<GameMatch>('admin.saveWeeklyMatch', { match }),
    finalizeWeeklyMatch: (matchId, expectedVersion) => call<GameMatch>('admin.finalizeWeeklyMatch', { matchId, expectedVersion }),
    generateRankingSnapshot: (seasonId: string, rankingType: GameRankingType) => call('admin.generateRankingSnapshot', { seasonId, rankingType }),
    adminListBlindBoxCatalogs: () => call<{ items: BlindBoxCatalogAdmin[] }>('admin.listBlindBoxCatalogs'),
    adminSaveBlindBoxCatalog: (input: { catalogId?: string, expectedVersion?: number, catalog: BlindBoxCatalogDraft }) => call<BlindBoxCatalogAdmin>('admin.saveBlindBoxCatalog', input),
    adminChangeBlindBoxCatalogStatus: (catalogId, expectedVersion, status) => call('admin.changeBlindBoxCatalogStatus', { catalogId, expectedVersion, status }),
    adminListBlindBoxCards: catalogId => call<{ items: BlindBoxCardAdmin[] }>('admin.listBlindBoxCards', { catalogId }),
    adminSaveBlindBoxCard: (input: { cardId?: string, expectedVersion?: number, card: BlindBoxCardDraft }) => call<BlindBoxCardAdmin>('admin.saveBlindBoxCard', input),
    adminChangeBlindBoxCardStatus: (cardId, expectedVersion, status) => call('admin.changeBlindBoxCardStatus', { cardId, expectedVersion, status }),
  }
}
