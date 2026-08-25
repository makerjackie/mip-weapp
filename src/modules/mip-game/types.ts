export type GameSeasonStatus = 'DRAFT' | 'ACTIVE' | 'CLOSED'
export type GamePeriodKind = 'HALF_YEAR' | 'YEAR' | 'CUSTOM'
export type GameRankingType = 'TEAM_HALF_YEAR' | 'TEAM_YEAR' | 'INDIVIDUAL_SEASON' | 'INDIVIDUAL_ALL_TIME'
export type BlindBoxRarity = 'COMMON' | 'RARE' | 'EPIC' | 'LEGENDARY'
export type BlindBoxPublishStatus = 'DRAFT' | 'PUBLISHED' | 'UNPUBLISHED'

export interface BlindBoxCatalogSummary {
  id: string
  catalogKey: string
  name: string
  summary: string
  drawCostCoin: number
  dailyDrawLimit: number
  pityThreshold: number
  pityMinRarity: BlindBoxRarity
  status: 'PUBLISHED'
  version: number
  cardCount: number
  stockRemaining: number
}

export interface BlindBoxCardPublic {
  id: string
  name: string
  summary: string
  rarity: BlindBoxRarity
  status: BlindBoxPublishStatus
  stockRemaining: number
}

export interface BlindBoxRarityRule {
  rarity: BlindBoxRarity
  label: string
  weight: number
  probabilityBasisPoints: number
  availableCardCount: number
}

export interface BlindBoxDetail extends BlindBoxCatalogSummary {
  rulesText: string
  redemptionRulesText: string
  rarities: BlindBoxRarityRule[]
  cards: BlindBoxCardPublic[]
}

export interface BlindBoxDrawResult {
  drawId: string
  catalogId: string
  card: Pick<BlindBoxCardPublic, 'id' | 'name' | 'summary' | 'rarity'>
  costCoin: number
  balanceAfter: number
  inventoryQuantity: number
  pityBefore: number
  pityAfter: number
  pityTriggered: boolean
  drawnAt: string
  idempotent: boolean
}

export interface BlindBoxInventoryItem {
  cardId: string
  catalogId: string
  catalogName: string
  name: string
  summary: string
  rarity: BlindBoxRarity
  status: BlindBoxPublishStatus
  quantity: number
  firstAcquiredAt: string
  lastAcquiredAt: string
}

export interface BlindBoxCoinEntry {
  id: string
  deltaValue: number
  balanceAfter: number
  reason: string
  createdAt: string
}

export interface BlindBoxCatalogDraft {
  catalogKey: string
  name: string
  summary: string
  rulesText: string
  redemptionRulesText: string
  drawCostCoin: number
  dailyDrawLimit: number
  pityThreshold: number
  pityMinRarity: BlindBoxRarity
}

export interface BlindBoxCatalogAdmin extends Omit<BlindBoxCatalogSummary, 'status'> {
  status: BlindBoxPublishStatus
  rulesText: string
  redemptionRulesText: string
  stockTotal: number
}

export interface BlindBoxCardDraft {
  catalogId: string
  cardKey: string
  name: string
  summary: string
  rarity: BlindBoxRarity
  weight: number
  stockTotal: number
  displayOrder: number
}

export interface BlindBoxCardAdmin extends BlindBoxCardDraft {
  id: string
  stockRemaining: number
  status: BlindBoxPublishStatus
  version: number
}

export interface HeadquartersThreshold {
  level: number
  minimumExperience: number
  label: string
}

export interface GameRules {
  scoreMetric: 'EXPERIENCE'
  headquartersThresholds: HeadquartersThreshold[]
}

export interface GameSeason {
  id: string
  seasonKey: string
  name: string
  summary: string
  rulesText: string
  rules: GameRules
  periodKind: GamePeriodKind
  startsAt: string
  endsAt: string
  status: GameSeasonStatus
  version: number
}

export interface HeadquartersLevel {
  number: number
  label: string
  minimumExperience: number
  styleKey: string
}

export interface GameTeam {
  id: string
  seasonId: string
  branchId: string
  branchName: string
  name: string
  summary: string
  status: 'ACTIVE' | 'INACTIVE'
  version: number
  memberCount: number
  headquartersLevel: HeadquartersLevel
}

export interface GameMatchSide { id: string, name: string, score: number | null }

export interface GameMatch {
  id: string
  seasonId: string
  weekStart: string
  weekEnd: string
  teamA: GameMatchSide
  teamB: GameMatchSide
  winnerTeamId: string
  status: 'SCHEDULED' | 'FINALIZED'
  finalizedAt: string
  version: number
}

export interface GameRankingEntry {
  rank: number
  subjectType: 'TEAM' | 'USER'
  teamId: string
  displayName: string
  score: number
  branchId: string
  branchName: string
  levelNumber: number | null
  levelLabel: string
}

export interface GameBranchFilter { id: string, name: string, cityName: string }

export interface GameRankingPage {
  rankingType: GameRankingType
  generatedAt: string
  periodStart?: string
  periodEnd?: string
  branches: GameBranchFilter[]
  items: GameRankingEntry[]
}

export interface GameOverview {
  season: GameSeason | null
  team: GameTeam | null
  matches: GameMatch[]
  standings: GameRankingEntry[]
  rankingGeneratedAt?: string
}

export interface GameTeamMember {
  memberRef: string
  nickname: string
  avatarUrl: string
  role: 'CAPTAIN' | 'MEMBER'
  status: 'ACTIVE' | 'LEFT'
  joinedAt: string
  leftAt: string
}

export interface GameTeamDetail extends GameTeam {
  seasonName: string
  score: number
  members: GameTeamMember[]
  formerMembers: GameTeamMember[]
}

export interface GameSeasonDraft {
  seasonKey: string
  name: string
  summary: string
  rulesText: string
  rules?: GameRules
  periodKind: GamePeriodKind
  startsAt: string
  endsAt: string
}

export interface GameTeamDraft { seasonId: string, branchId?: string, name: string, summary: string }
export interface GameMemberAssignment { memberRef: string, role: 'CAPTAIN' | 'MEMBER' }
export interface AssignableGameMember {
  memberRef: string
  nickname: string
  branchName: string
  teamId: string
  teamName: string
  role: '' | 'CAPTAIN' | 'MEMBER'
}

export interface GameAdminSession { capability: 'game.manage', roleKey: 'PLATFORM_OWNER' | 'PLATFORM_OPERATIONS' }

export interface GameSeasonSaveInput {
  seasonId?: string
  expectedVersion?: number
  season: GameSeasonDraft
}

export interface GameSeasonStatusInput {
  seasonId: string
  expectedVersion: number
  status: 'ACTIVE' | 'CLOSED'
}

export interface GameTeamSaveInput {
  teamId?: string
  expectedVersion?: number
  team: GameTeamDraft
}

export interface GameTeamMembersInput {
  seasonId: string
  teamId: string
  expectedVersion: number
  members: GameMemberAssignment[]
}

export interface BlindBoxCatalogSaveInput {
  catalogId?: string
  expectedVersion?: number
  catalog: BlindBoxCatalogDraft
}

export interface BlindBoxCatalogStatusInput {
  catalogId: string
  expectedVersion: number
  status: 'PUBLISHED' | 'UNPUBLISHED'
}

export interface BlindBoxCardSaveInput {
  cardId?: string
  expectedVersion?: number
  card: BlindBoxCardDraft
}

export interface BlindBoxCardStatusInput {
  cardId: string
  expectedVersion: number
  status: 'PUBLISHED' | 'UNPUBLISHED'
}

export const MIP_GAME_CONTRACT_VERSION = 1 as const

export interface MipGameActionInputMap {
  'listBlindBoxes': Record<string, never>
  'getBlindBox': { catalogId: string }
  'drawBlindBox': { catalogId: string, requestId: string }
  'getBlindBoxInventory': { catalogId?: string }
  'listBlindBoxCoinEntries': { limit?: number }
  'getOverview': { seasonId?: string }
  'getRules': { seasonId?: string }
  'getTeam': { teamId: string }
  'listHistory': { seasonId?: string }
  'listRankings': { seasonId: string, rankingType: GameRankingType, branchId?: string }
  'admin.getSession': Record<string, never>
  'admin.listRankings': { seasonId: string, rankingType: GameRankingType, branchId?: string }
  'admin.listSeasons': Record<string, never>
  'admin.saveSeason': GameSeasonSaveInput
  'admin.changeSeasonStatus': GameSeasonStatusInput
  'admin.listTeams': { seasonId: string }
  'admin.saveTeam': GameTeamSaveInput
  'admin.listAssignableMembers': { seasonId: string, query?: string }
  'admin.replaceTeamMembers': GameTeamMembersInput
  'admin.listMatches': { seasonId: string }
  'admin.saveWeeklyMatch': { match: { seasonId: string, weekStart: string, weekEnd: string, teamAId: string, teamBId: string } }
  'admin.finalizeWeeklyMatch': { matchId: string, expectedVersion: number }
  'admin.generateRankingSnapshot': { seasonId: string, rankingType: GameRankingType }
  'admin.listBlindBoxCatalogs': Record<string, never>
  'admin.saveBlindBoxCatalog': BlindBoxCatalogSaveInput
  'admin.changeBlindBoxCatalogStatus': BlindBoxCatalogStatusInput
  'admin.listBlindBoxCards': { catalogId: string }
  'admin.saveBlindBoxCard': BlindBoxCardSaveInput
  'admin.changeBlindBoxCardStatus': BlindBoxCardStatusInput
}

export interface MipGameActionResultMap {
  'listBlindBoxes': { coinBalance: number, items: BlindBoxCatalogSummary[] }
  'getBlindBox': BlindBoxDetail
  'drawBlindBox': BlindBoxDrawResult
  'getBlindBoxInventory': { items: BlindBoxInventoryItem[] }
  'listBlindBoxCoinEntries': { coinBalance: number, items: BlindBoxCoinEntry[] }
  'getOverview': GameOverview
  'getRules': { seasonId: string, seasonName: string, rulesText: string, rules: GameRules }
  'getTeam': GameTeamDetail
  'listHistory': { season: GameSeason | null, items: GameMatch[] }
  'listRankings': GameRankingPage
  'admin.getSession': GameAdminSession
  'admin.listRankings': GameRankingPage
  'admin.listSeasons': { items: GameSeason[] }
  'admin.saveSeason': GameSeason
  'admin.changeSeasonStatus': GameSeason
  'admin.listTeams': { items: GameTeam[] }
  'admin.saveTeam': GameTeam
  'admin.listAssignableMembers': { items: AssignableGameMember[] }
  'admin.replaceTeamMembers': { teamId: string, memberCount: number, version: number }
  'admin.listMatches': { items: GameMatch[] }
  'admin.saveWeeklyMatch': GameMatch
  'admin.finalizeWeeklyMatch': GameMatch
  'admin.generateRankingSnapshot': { snapshotId: string, rankingType: GameRankingType, entryCount: number, generatedAt: string }
  'admin.listBlindBoxCatalogs': { items: BlindBoxCatalogAdmin[] }
  'admin.saveBlindBoxCatalog': BlindBoxCatalogAdmin
  'admin.changeBlindBoxCatalogStatus': { catalogId: string, status: 'PUBLISHED' | 'UNPUBLISHED', version: number }
  'admin.listBlindBoxCards': { items: BlindBoxCardAdmin[] }
  'admin.saveBlindBoxCard': BlindBoxCardAdmin
  'admin.changeBlindBoxCardStatus': { cardId: string, status: 'PUBLISHED' | 'UNPUBLISHED', version: number }
}

export type MipGameAction = keyof MipGameActionInputMap

export interface MipGameRequest<A extends MipGameAction = MipGameAction> {
  contractVersion: typeof MIP_GAME_CONTRACT_VERSION
  action: A
  input: MipGameActionInputMap[A]
}

export interface MipGameGateway {
  listBlindBoxes: () => Promise<{ coinBalance: number, items: BlindBoxCatalogSummary[] }>
  getBlindBox: (catalogId: string) => Promise<BlindBoxDetail>
  drawBlindBox: (catalogId: string, requestId: string) => Promise<BlindBoxDrawResult>
  getBlindBoxInventory: (catalogId?: string) => Promise<{ items: BlindBoxInventoryItem[] }>
  listBlindBoxCoinEntries: (limit?: number) => Promise<{ coinBalance: number, items: BlindBoxCoinEntry[] }>
  getOverview: (seasonId?: string) => Promise<GameOverview>
  getRules: (seasonId?: string) => Promise<{ seasonId: string, seasonName: string, rulesText: string, rules: GameRules }>
  getTeam: (teamId: string) => Promise<GameTeamDetail>
  listHistory: (seasonId?: string) => Promise<{ season: GameSeason | null, items: GameMatch[] }>
  listRankings: (seasonId: string, rankingType: GameRankingType, branchId?: string) => Promise<GameRankingPage>
  getAdminSession: () => Promise<GameAdminSession>
  listAdminRankings: (seasonId: string, rankingType: GameRankingType, branchId?: string) => Promise<GameRankingPage>
  listSeasons: () => Promise<{ items: GameSeason[] }>
  saveSeason: (input: GameSeasonSaveInput) => Promise<GameSeason>
  changeSeasonStatus: (seasonId: string, expectedVersion: number, status: 'ACTIVE' | 'CLOSED') => Promise<GameSeason>
  listTeams: (seasonId: string) => Promise<{ items: GameTeam[] }>
  saveTeam: (input: GameTeamSaveInput) => Promise<GameTeam>
  listAssignableMembers: (seasonId: string, query?: string) => Promise<{ items: AssignableGameMember[] }>
  replaceTeamMembers: (seasonId: string, teamId: string, expectedVersion: number, members: GameMemberAssignment[]) => Promise<{ teamId: string, memberCount: number, version: number }>
  listAdminMatches: (seasonId: string) => Promise<{ items: GameMatch[] }>
  saveWeeklyMatch: (match: { seasonId: string, weekStart: string, weekEnd: string, teamAId: string, teamBId: string }) => Promise<GameMatch>
  finalizeWeeklyMatch: (matchId: string, expectedVersion: number) => Promise<GameMatch>
  generateRankingSnapshot: (seasonId: string, rankingType: GameRankingType) => Promise<{ snapshotId: string, rankingType: GameRankingType, entryCount: number, generatedAt: string }>
  adminListBlindBoxCatalogs: () => Promise<{ items: BlindBoxCatalogAdmin[] }>
  adminSaveBlindBoxCatalog: (input: BlindBoxCatalogSaveInput) => Promise<BlindBoxCatalogAdmin>
  adminChangeBlindBoxCatalogStatus: (catalogId: string, expectedVersion: number, status: 'PUBLISHED' | 'UNPUBLISHED') => Promise<{ catalogId: string, status: 'PUBLISHED' | 'UNPUBLISHED', version: number }>
  adminListBlindBoxCards: (catalogId: string) => Promise<{ items: BlindBoxCardAdmin[] }>
  adminSaveBlindBoxCard: (input: BlindBoxCardSaveInput) => Promise<BlindBoxCardAdmin>
  adminChangeBlindBoxCardStatus: (cardId: string, expectedVersion: number, status: 'PUBLISHED' | 'UNPUBLISHED') => Promise<{ cardId: string, status: 'PUBLISHED' | 'UNPUBLISHED', version: number }>
}

export class MipGameError extends Error {
  readonly code: string
  readonly retryable: boolean

  constructor(code: string, message: string, retryable = false) {
    super(message)
    this.name = 'MipGameError'
    this.code = code
    this.retryable = retryable
  }
}
