import type { AssignableGameMember, GameRankingType, MipGameGateway } from './types'
import { createQueryCache } from '@weapp/shared/cache'
import { MipGameError } from './types'

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
    cursor?: string,
    limit?: number,
    force?: boolean,
  ) => ReturnType<MipGameGateway['listAssignableMembers']>
  listAllAssignableMembers: (
    seasonId: string,
    query?: string,
    force?: boolean,
  ) => Promise<{ items: AssignableGameMember[], maxTeamMembers: number }>
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

const ASSIGNABLE_MEMBER_PAGE_SIZE = 100
const MAX_ASSIGNABLE_MEMBER_PAGES = 50
const MAX_ASSIGNABLE_MEMBERS = ASSIGNABLE_MEMBER_PAGE_SIZE * MAX_ASSIGNABLE_MEMBER_PAGES
const PROFILE_REF_PATTERN = /^p1\.[\w-]{16}\.[\w-]{48}\.[\w-]{22}$/
const CANDIDATE_KEY_PATTERN = /^gmk1\.[\w-]{43}$/
const MEMBER_CURSOR_PATTERN = /^gm1\.[\w-]{16}\.[\w-]{1,500}\.[\w-]{22}$/
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function memberProtocolError(message = '成员分页协议暂时不可用，请稍后重试') {
  return new MipGameError('SERVICE_UNAVAILABLE', message, true)
}

function boundedMemberText(value: unknown, maximum: number, required = false): value is string {
  return typeof value === 'string'
    && value.length <= maximum
    && (!required || value.trim().length > 0)
}

function validateAssignableMember(value: unknown): AssignableGameMember {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw memberProtocolError()
  }
  const item = value as Record<string, unknown>
  const memberRef = item.memberRef
  const candidateKey = item.candidateKey
  const nickname = item.nickname
  const branchName = item.branchName
  const teamId = item.teamId
  const teamName = item.teamName
  const role = item.role
  if (Object.keys(item).some(key => ![
    'memberRef',
    'candidateKey',
    'nickname',
    'branchName',
    'teamId',
    'teamName',
    'role',
  ].includes(key))
  || !boundedMemberText(memberRef, 200, true) || !PROFILE_REF_PATTERN.test(memberRef)
  || !boundedMemberText(candidateKey, 80, true) || !CANDIDATE_KEY_PATTERN.test(candidateKey)
  || !boundedMemberText(nickname, 80, true)
  || !boundedMemberText(branchName, 100)
  || !boundedMemberText(teamId, 36) || (teamId !== '' && !UUID_PATTERN.test(teamId))
  || !boundedMemberText(teamName, 100)
  || !boundedMemberText(role, 16)
  || !['', 'CAPTAIN', 'MEMBER'].includes(role)
  || (teamId === '' && (teamName !== '' || role !== ''))
  || (teamId !== '' && (!teamName.trim() || role === ''))) {
    throw memberProtocolError()
  }
  return { memberRef, candidateKey, nickname, branchName, teamId, teamName, role } as AssignableGameMember
}

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

  function listAssignableMemberPage(
    seasonId: string,
    memberQuery: string | undefined,
    cursor: string | undefined,
    limit: number | undefined,
    force: boolean,
  ) {
    return queryCached(
      'season',
      'assignable-members',
      { seasonId, query: memberQuery, cursor, limit },
      () => gateway.listAssignableMembers(seasonId, memberQuery, cursor, limit),
      force,
    )
  }

  async function listAllAssignableMembers(
    seasonId: string,
    memberQuery: string | undefined,
    force: boolean,
  ) {
    const items: AssignableGameMember[] = []
    const seenCursors = new Set<string>()
    const seenCandidateKeys = new Set<string>()
    let cursor: string | undefined
    let maxTeamMembers = 0
    let pageCount = 0
    do {
      pageCount += 1
      const page = await listAssignableMemberPage(
        seasonId,
        memberQuery,
        cursor,
        ASSIGNABLE_MEMBER_PAGE_SIZE,
        force,
      )
      if (!Array.isArray(page.items)
        || typeof page.hasMore !== 'boolean'
        || typeof page.nextCursor !== 'string'
        || !Number.isSafeInteger(page.maxTeamMembers)
        || page.maxTeamMembers < 1
        || page.maxTeamMembers > 100
        || !Number.isSafeInteger(page.limit)
        || page.limit !== ASSIGNABLE_MEMBER_PAGE_SIZE
        || page.items.length > page.limit
        || (page.hasMore && page.items.length !== page.limit)
        || (!page.hasMore && page.nextCursor !== '')) {
        throw memberProtocolError()
      }
      if (maxTeamMembers && maxTeamMembers !== page.maxTeamMembers) {
        throw memberProtocolError('成员上限已变化，请重新加载')
      }
      maxTeamMembers = page.maxTeamMembers
      for (const rawItem of page.items) {
        const item = validateAssignableMember(rawItem)
        if (seenCandidateKeys.has(item.candidateKey)) {
          throw memberProtocolError('成员分页包含重复记录，请稍后重试')
        }
        seenCandidateKeys.add(item.candidateKey)
        items.push(item)
      }
      if (items.length > MAX_ASSIGNABLE_MEMBERS) {
        throw memberProtocolError('成员数量超过当前可管理范围')
      }
      if (!page.hasMore) {
        break
      }
      if (pageCount >= MAX_ASSIGNABLE_MEMBER_PAGES
        || !MEMBER_CURSOR_PATTERN.test(page.nextCursor)
        || page.items.length === 0
        || seenCursors.has(page.nextCursor)) {
        throw memberProtocolError('成员分页未完整返回，请稍后重试')
      }
      seenCursors.add(page.nextCursor)
      cursor = page.nextCursor
    } while (cursor)
    const sorted = items
      .map((item, index) => ({ item, index }))
      .sort((left, right) => left.item.nickname.localeCompare(right.item.nickname, 'zh-CN') || left.index - right.index)
      .map(entry => entry.item)
    return { items: sorted, maxTeamMembers }
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
    listAssignableMembers: (seasonId, memberQuery, cursor, limit, force = false) =>
      listAssignableMemberPage(seasonId, memberQuery, cursor, limit, force),
    listAllAssignableMembers: (seasonId, memberQuery, force = false) =>
      listAllAssignableMembers(seasonId, memberQuery, force),
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
