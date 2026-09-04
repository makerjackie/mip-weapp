import type {
  GameOverview,
  GameTeamDetail,
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

function invalidContext(): never {
  throw new MipGameError('SERVICE_UNAVAILABLE', '赛季服务返回了无效响应', true)
}

function bindOverviewContext(value: unknown, expectedSeasonId?: string): GameOverview {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    invalidContext()
  }
  const overview = value as Record<string, unknown>
  const season = overview.season
  const team = overview.team
  if (season !== null && (!season || typeof season !== 'object' || Array.isArray(season))) {
    invalidContext()
  }
  if (team !== null && (!team || typeof team !== 'object' || Array.isArray(team))) {
    invalidContext()
  }
  const actualSeasonId = season === null ? '' : String((season as Record<string, unknown>).id || '')
  const teamSeasonId = team === null ? '' : String((team as Record<string, unknown>).seasonId || '')
  if ((expectedSeasonId && actualSeasonId !== expectedSeasonId)
    || (teamSeasonId && teamSeasonId !== (expectedSeasonId || actualSeasonId))
    || (!actualSeasonId && teamSeasonId)) {
    invalidContext()
  }
  return value as GameOverview
}

function bindTeamContext(value: unknown, expectedTeamId: string): GameTeamDetail {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || (value as Record<string, unknown>).id !== expectedTeamId) {
    invalidContext()
  }
  return value as GameTeamDetail
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
  async function callParsed<A extends MipGameAction>(
    action: A,
    input: MipGameActionInputMap[A],
    parse: (value: unknown) => MipGameActionResultMap[A],
  ): Promise<MipGameActionResultMap[A]> {
    return parse(unwrap<unknown>(await transport.invoke({
      contractVersion: MIP_GAME_CONTRACT_VERSION,
      action,
      input,
    })))
  }
  return {
    listBlindBoxes: () => call('listBlindBoxes', {}),
    getBlindBox: catalogId => call('getBlindBox', { catalogId }),
    drawBlindBox: (catalogId, requestId) => call('drawBlindBox', { catalogId, requestId }),
    getBlindBoxInventory: catalogId => call('getBlindBoxInventory', { catalogId }),
    listBlindBoxCoinEntries: limit => call('listBlindBoxCoinEntries', { limit }),
    getOverview: seasonId => callParsed(
      'getOverview',
      { seasonId },
      value => bindOverviewContext(value, seasonId),
    ),
    getRules: seasonId => call('getRules', { seasonId }),
    getTeam: teamId => callParsed('getTeam', { teamId }, value => bindTeamContext(value, teamId)),
    listHistory: seasonId => call('listHistory', { seasonId }),
    listRankings: (seasonId, rankingType, branchId) => call('listRankings', { seasonId, rankingType, branchId }),
  }
}
