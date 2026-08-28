import type { AdminRequestInput } from '../domain/contracts.ts'
import type {
  AdminDetailRequest,
  AdminDetailView,
} from './admin-details.ts'
import type { OperationField, OperationValues } from './admin-operation-ui.ts'
import type { AdminRowOperation } from './admin-row-operations.ts'
import type {
  AdminListQuery,
  AdminReadPage,
  AdminRequest,
} from './admin-read-contracts.ts'
import {
  columns,
  formatDateTime,
  numberLabel,
  record,
  valueOf,
} from './admin-read-formatters.ts'

export const ADMIN_GAME_QUERY_ACTIONS = [
  'mip.admin.game.session',
  'mip.admin.game.rankings.list',
  'mip.admin.game.seasons.list',
  'mip.admin.game.teams.list',
  'mip.admin.game.members.assignable.list',
  'mip.admin.game.matches.list',
  'mip.admin.game.blindBoxes.catalogs.list',
  'mip.admin.game.blindBoxes.cards.list',
] as const

export const ADMIN_GAME_MUTATION_ACTIONS = [
  'mip.admin.game.seasons.save',
  'mip.admin.game.seasons.changeStatus',
  'mip.admin.game.teams.save',
  'mip.admin.game.teams.changeStatus',
  'mip.admin.game.teams.members.replace',
  'mip.admin.game.matches.save',
  'mip.admin.game.matches.finalize',
  'mip.admin.game.rankings.generate',
  'mip.admin.game.blindBoxes.catalogs.save',
  'mip.admin.game.blindBoxes.catalogs.changeStatus',
  'mip.admin.game.blindBoxes.cards.save',
  'mip.admin.game.blindBoxes.cards.changeStatus',
] as const

export type AdminGameMutationAction = typeof ADMIN_GAME_MUTATION_ACTIONS[number]

export interface GameMemberPageQuery {
  query?: string
  cursor?: string | null
  limit?: number
}

export interface AdminGameMutationDefinition {
  action: AdminGameMutationAction
  capability: 'game.manage'
  title: string
  description: string
  fields: readonly OperationField[]
  values: OperationValues
}

const rankingTypes = [
  { value: 'TEAM_HALF_YEAR', label: '团队半年榜' },
  { value: 'TEAM_YEAR', label: '团队年度榜' },
  { value: 'INDIVIDUAL_SEASON', label: '个人赛季榜' },
  { value: 'INDIVIDUAL_ALL_TIME', label: '个人累计榜' },
] as const

const rarityOptions = [
  { value: 'COMMON', label: '普通' },
  { value: 'RARE', label: '稀有' },
  { value: 'EPIC', label: '史诗' },
  { value: 'LEGENDARY', label: '传说' },
] as const

export async function loadGameManagementPage(
  query: AdminListQuery,
  request: AdminRequest,
): Promise<AdminReadPage> {
  const [sessionValue, seasonValue, catalogValue] = await Promise.all([
    request('mip.admin.game.session'),
    request('mip.admin.game.seasons.list'),
    request('mip.admin.game.blindBoxes.catalogs.list'),
  ])
  assertGameSession(sessionValue)
  const seasons = records(record(seasonValue).items).filter(item => matchesQuery(item, query))
  const catalogs = records(record(catalogValue).items).filter(item => matchesQuery(item, query))
  return {
    sections: [
      {
        title: '赛季',
        rows: seasons.map(item => ({
          detailId: valueOf(item, 'id'),
          name: valueOf(item, 'name'),
          period: `${periodKindLabel(item.periodKind)} · ${dateRange(item.startsAt, item.endsAt)}`,
          rules: valueOf(item, 'rulesText'),
          version: numberLabel(item.version),
          state: statusLabel(item.status),
          rowActions: seasonRowActions(item),
        })),
        columns: columns([
          ['name', '赛季'], ['period', '周期'], ['rules', '规则说明'], ['version', '版本'], ['state', '状态'],
        ]),
        detailTarget: 'gameSeasons',
      },
      {
        title: '盲盒目录',
        rows: catalogs.map(item => ({
          detailId: valueOf(item, 'id'),
          name: valueOf(item, 'name'),
          cost: `${numberLabel(item.drawCostCoin)} 游戏币`,
          cards: numberLabel(item.cardCount),
          stock: `${numberLabel(item.stockRemaining)} / ${numberLabel(item.stockTotal)}`,
          version: numberLabel(item.version),
          state: statusLabel(item.status),
          rowActions: catalogRowActions(item),
        })),
        columns: columns([
          ['name', '目录'], ['cost', '抽取消耗'], ['cards', '卡片数'], ['stock', '剩余库存'], ['version', '版本'], ['state', '状态'],
        ]),
        detailTarget: 'gameCatalogs',
      },
    ],
    nextCursor: null,
  }
}

export async function loadGameSeasonDetail(
  seasonId: string,
  request: AdminDetailRequest,
): Promise<AdminDetailView> {
  const seasons = records(record(await request('mip.admin.game.seasons.list')).items)
  const season = seasons.find(item => item.id === seasonId)
  if (!season) throw new Error('NOT_FOUND')
  const rankingType = season.periodKind === 'YEAR' ? 'TEAM_YEAR' : 'TEAM_HALF_YEAR'
  const [teamValue, matchValue, rankingValue] = await Promise.all([
    request('mip.admin.game.teams.list', { seasonId }),
    request('mip.admin.game.matches.list', { seasonId }),
    request('mip.admin.game.rankings.list', { seasonId, rankingType, limit: 100 }),
  ])
  const teams = records(record(teamValue).items)
  const matches = records(record(matchValue).items)
  const ranking = record(rankingValue)
  const rankings = records(ranking.items)
  const branches = records(ranking.branches)
  return {
    route: 'gameSeasons',
    title: text(season.name) || '赛季详情',
    subtitle: `${periodKindLabel(season.periodKind)} · ${dateRange(season.startsAt, season.endsAt)}`,
    status: statusLabel(season.status),
    sections: [
      {
        title: '赛季规则',
        fields: fields([
          ['赛季标识', season.seasonKey], ['周期类型', periodKindLabel(season.periodKind)],
          ['开始时间', formatDateTime(season.startsAt)], ['结束时间', formatDateTime(season.endsAt)],
          ['规则说明', season.rulesText], ['版本', numberLabel(season.version)],
        ]),
      },
      {
        title: '战队',
        rows: teams.map(item => ({
          detailId: `${seasonId}:${valueOf(item, 'id')}`,
          name: valueOf(item, 'name'), branch: valueOf(item, 'branchName'),
          members: `${numberLabel(item.memberCount)} / ${numberLabel(item.memberLimit)}`,
          headquarters: valueOf(record(item.headquartersLevel), 'label'),
          version: numberLabel(item.version), state: statusLabel(item.status),
          rowActions: teamRowActions(item),
        })),
        columns: columns([
          ['name', '战队'], ['branch', '所属服务器'], ['members', '成员'], ['headquarters', '大本营'], ['version', '版本'], ['state', '状态'],
        ]),
        detailTarget: 'gameTeams',
      },
      {
        title: '周赛',
        rows: matches.map(item => ({
          week: dateRange(item.weekStart, item.weekEnd),
          teams: `${valueOf(record(item.teamA), 'name')} vs ${valueOf(record(item.teamB), 'name')}`,
          result: matchResult(item), version: numberLabel(item.version), state: statusLabel(item.status),
          rowActions: matchRowActions(item),
        })),
        columns: columns([['week', '周次'], ['teams', '对阵'], ['result', '结果'], ['version', '版本'], ['state', '状态']]),
      },
      {
        title: '排行快照',
        rows: rankings.map(item => ({
          rank: numberLabel(item.rank), name: valueOf(item, 'displayName'),
          branch: valueOf(item, 'branchName'), score: numberLabel(item.score),
          level: valueOf(item, 'levelLabel'),
        })),
        columns: columns([['rank', '排名'], ['name', '名称'], ['branch', '服务器'], ['score', '经验值'], ['level', '等级']]),
        fields: fields([['排行类型', rankingTypeLabel(ranking.rankingType)], ['生成时间', formatDateTime(ranking.generatedAt)]]),
      },
    ],
    source: { season, teams, branches, rankingType },
  }
}

export async function loadGameTeamDetail(
  compositeId: string,
  request: AdminDetailRequest,
  pageQuery: GameMemberPageQuery = {},
): Promise<AdminDetailView> {
  const [seasonId, teamId, extra] = compositeId.split(':')
  if (extra || !uuid(seasonId) || !uuid(teamId)) throw new Error('VALIDATION_FAILED')
  const query = normalizeMemberQuery(pageQuery)
  const [teamValue, memberValue] = await Promise.all([
    request('mip.admin.game.teams.list', { seasonId }),
    request('mip.admin.game.members.assignable.list', {
      seasonId,
      teamId,
      query: query.query,
      limit: query.limit,
      ...(query.cursor ? { cursor: query.cursor } : {}),
    }),
  ])
  const team = records(record(teamValue).items).find(item => item.id === teamId)
  if (!team) throw new Error('NOT_FOUND')
  const memberPage = record(memberValue)
  const members = records(memberPage.items)
  return {
    route: 'gameTeams',
    title: text(team.name) || '战队详情',
    subtitle: `${text(team.branchName) || '平台战队'} · ${numberLabel(team.memberCount)} / ${numberLabel(team.memberLimit)} 人`,
    status: statusLabel(team.status),
    sections: [
      {
        title: '战队信息',
        fields: fields([
          ['所属服务器', team.branchName], ['简介', team.summary],
          ['成员上限', numberLabel(team.memberLimit)], ['当前人数', numberLabel(team.memberCount)],
          ['大本营', valueOf(record(team.headquartersLevel), 'label')], ['版本', numberLabel(team.version)],
        ]),
      },
      {
        title: '可分配成员',
        rows: members.map(item => ({
          memberRef: valueOf(item, 'memberRef'), name: valueOf(item, 'nickname'),
          branch: valueOf(item, 'branchName'), currentTeam: valueOf(item, 'teamName'),
          role: roleLabel(item.role),
        })),
        columns: columns([
          ['name', '成员'], ['branch', '服务器'], ['currentTeam', '当前战队'], ['role', '角色'], ['memberRef', '成员引用'],
        ]),
        pager: {
          key: 'gameMembers',
          query: query.query,
          nextCursor: memberPage.hasMore === true && typeof memberPage.nextCursor === 'string' ? memberPage.nextCursor : null,
          placeholder: '搜索成员或服务器',
        },
      },
    ],
    source: { team, seasonId, assignableMembers: members, memberPage },
  }
}

export async function loadGameCatalogDetail(
  catalogId: string,
  request: AdminDetailRequest,
): Promise<AdminDetailView> {
  const [catalogValue, cardValue] = await Promise.all([
    request('mip.admin.game.blindBoxes.catalogs.list'),
    request('mip.admin.game.blindBoxes.cards.list', { catalogId }),
  ])
  const catalog = records(record(catalogValue).items).find(item => item.id === catalogId)
  if (!catalog) throw new Error('NOT_FOUND')
  const cards = records(record(cardValue).items)
  return {
    route: 'gameCatalogs',
    title: text(catalog.name) || '盲盒目录',
    subtitle: `${numberLabel(catalog.drawCostCoin)} 游戏币 / 次 · 剩余 ${numberLabel(catalog.stockRemaining)}`,
    status: statusLabel(catalog.status),
    sections: [
      {
        title: '目录规则',
        fields: fields([
          ['目录标识', catalog.catalogKey], ['说明', catalog.summary],
          ['抽取规则', catalog.rulesText], ['兑换规则', catalog.redemptionRulesText],
          ['单次消耗', `${numberLabel(catalog.drawCostCoin)} 游戏币`],
          ['每日上限', numberLabel(catalog.dailyDrawLimit)],
          ['保底次数', numberLabel(catalog.pityThreshold)], ['保底最低稀有度', rarityLabel(catalog.pityMinRarity)],
          ['库存', `${numberLabel(catalog.stockRemaining)} / ${numberLabel(catalog.stockTotal)}`],
          ['版本', numberLabel(catalog.version)],
        ]),
      },
      {
        title: '卡片',
        rows: cards.map(item => ({
          name: valueOf(item, 'name'), key: valueOf(item, 'cardKey'), rarity: rarityLabel(item.rarity),
          weight: numberLabel(item.weight), stock: `${numberLabel(item.stockRemaining)} / ${numberLabel(item.stockTotal)}`,
          order: numberLabel(item.displayOrder), version: numberLabel(item.version), state: statusLabel(item.status),
          rowActions: cardRowActions(item),
        })),
        columns: columns([
          ['name', '卡片'], ['key', '标识'], ['rarity', '稀有度'], ['weight', '权重'],
          ['stock', '库存'], ['order', '顺序'], ['version', '版本'], ['state', '状态'],
        ]),
      },
    ],
    source: { catalog, cards },
  }
}

export function createGameMutationDefinition(
  action: AdminGameMutationAction,
  targetId = '',
  source: Record<string, unknown> = {},
): AdminGameMutationDefinition {
  const season = record(source.season)
  const team = record(source.team)
  const catalog = record(source.catalog)
  const card = record(source.card)
  if (action === 'mip.admin.game.seasons.save') return seasonSaveDefinition(targetId, season)
  if (action === 'mip.admin.game.teams.save') return teamSaveDefinition(targetId, source, team)
  if (action === 'mip.admin.game.teams.members.replace') return teamMembersDefinition(targetId, source, team)
  if (action === 'mip.admin.game.matches.save') return matchSaveDefinition(source)
  if (action === 'mip.admin.game.rankings.generate') return rankingDefinition(source)
  if (action === 'mip.admin.game.blindBoxes.catalogs.save') return catalogSaveDefinition(targetId, catalog)
  if (action === 'mip.admin.game.blindBoxes.cards.save') return cardSaveDefinition(targetId, source, card)
  const resource = statusResource(action, source, { season, team, catalog, card })
  const values: OperationValues = { ...resource.identifiers, expectedVersion: positiveInteger(resource.item.version) }
  if (action.endsWith('.changeStatus')) values.status = nextStatus(action, resource.item.status)
  return definition(action, mutationTitle(action), mutationDescription(action), [], values)
}

export function buildGameMutationInput(
  definitionValue: AdminGameMutationDefinition,
  values: OperationValues,
): AdminRequestInput | null {
  const action = definitionValue.action
  if (action === 'mip.admin.game.seasons.save') return seasonSaveInput(values)
  if (action === 'mip.admin.game.teams.save') return teamSaveInput(values)
  if (action === 'mip.admin.game.teams.members.replace') return teamMembersInput(values)
  if (action === 'mip.admin.game.matches.save') return matchSaveInput(values)
  if (action === 'mip.admin.game.rankings.generate') return rankingInput(values)
  if (action === 'mip.admin.game.blindBoxes.catalogs.save') return catalogSaveInput(values)
  if (action === 'mip.admin.game.blindBoxes.cards.save') return cardSaveInput(values)
  const expectedVersion = positiveInteger(values.expectedVersion)
  if (!expectedVersion) return null
  if (action === 'mip.admin.game.seasons.changeStatus') {
    return statusInput(values, 'seasonId', ['ACTIVE', 'CLOSED'], expectedVersion)
  }
  if (action === 'mip.admin.game.teams.changeStatus') {
    const seasonId = uuid(values.seasonId)
    const result = statusInput(values, 'teamId', ['ACTIVE', 'INACTIVE'], expectedVersion)
    return seasonId && result ? { seasonId, ...result } : null
  }
  if (action === 'mip.admin.game.matches.finalize') {
    const matchId = uuid(values.matchId)
    return matchId ? { matchId, expectedVersion } : null
  }
  if (action === 'mip.admin.game.blindBoxes.catalogs.changeStatus') {
    return statusInput(values, 'catalogId', ['PUBLISHED', 'UNPUBLISHED'], expectedVersion)
  }
  return statusInput(values, 'cardId', ['PUBLISHED', 'UNPUBLISHED'], expectedVersion)
}

function seasonSaveDefinition(targetId: string, season: Record<string, unknown>) {
  return definition('mip.admin.game.seasons.save', targetId ? '编辑赛季' : '新增赛季', '排行与周赛积分始终由服务端经验值事实生成。', [
    { name: 'seasonKey', label: '赛季标识', kind: 'text', required: true, maxLength: 64 },
    { name: 'name', label: '赛季名称', kind: 'text', required: true, maxLength: 100 },
    { name: 'summary', label: '简介', kind: 'textarea', maxLength: 500, wide: true },
    { name: 'rulesText', label: '规则说明', kind: 'textarea', required: true, maxLength: 4000, wide: true },
    { name: 'periodKind', label: '周期类型', kind: 'select', required: true, options: [
      { value: 'HALF_YEAR', label: '半年' }, { value: 'YEAR', label: '全年' }, { value: 'CUSTOM', label: '自定义' },
    ] },
    { name: 'startsAt', label: '开始时间', kind: 'datetime', required: true },
    { name: 'endsAt', label: '结束时间', kind: 'datetime', required: true },
  ], {
    seasonId: targetId, expectedVersion: positiveInteger(season.version),
    seasonKey: text(season.seasonKey), name: text(season.name), summary: text(season.summary),
    rulesText: text(season.rulesText), rules: season.rules,
    periodKind: text(season.periodKind) || 'HALF_YEAR', startsAt: text(season.startsAt), endsAt: text(season.endsAt),
  })
}

function teamSaveDefinition(targetId: string, source: Record<string, unknown>, team: Record<string, unknown>) {
  const branches = records(source.branches)
  return definition('mip.admin.game.teams.save', targetId ? '编辑战队' : '新增战队', '战队成员和比赛积分由独立操作维护。', [
    { name: 'seasonId', label: '赛季 ID', kind: 'text', hidden: true },
    { name: 'branchId', label: '所属服务器', kind: branches.length ? 'select' : 'text', options: branches.map(item => ({ value: String(item.id || ''), label: String(item.name || item.id || '') })) },
    { name: 'name', label: '战队名称', kind: 'text', required: true, maxLength: 100 },
    { name: 'summary', label: '简介', kind: 'textarea', maxLength: 500, wide: true },
    { name: 'memberLimit', label: '成员上限', kind: 'integer' },
  ], {
    teamId: targetId, expectedVersion: positiveInteger(team.version),
    seasonId: text(team.seasonId) || text(record(source.season).id) || text(source.seasonId),
    branchId: text(team.branchId), name: text(team.name), summary: text(team.summary), memberLimit: integer(team.memberLimit) || 100,
  })
}

function teamMembersDefinition(targetId: string, source: Record<string, unknown>, team: Record<string, unknown>) {
  return definition('mip.admin.game.teams.members.replace', '替换战队成员', '这是全量替换操作。请填写全部成员引用；未填写的现有成员会离队。服务端不会接受客户端积分或奖励。', [
    { name: 'memberRefs', label: '全部成员引用', kind: 'profile-ref-list', wide: true },
    { name: 'captainRef', label: '队长成员引用', kind: 'text' },
  ], {
    seasonId: text(team.seasonId) || text(source.seasonId), teamId: targetId,
    expectedVersion: positiveInteger(team.version), memberRefs: [], captainRef: '',
  })
}

function matchSaveDefinition(source: Record<string, unknown>) {
  const teams = records(source.teams).filter(item => item.status === 'ACTIVE')
  const options = teams.map(item => ({ value: String(item.id || ''), label: String(item.name || item.id || '') }))
  return definition('mip.admin.game.matches.save', '新增周赛', '只配置周次和对阵；比分与胜者由服务端在结算时计算。', [
    { name: 'seasonId', label: '赛季 ID', kind: 'text', hidden: true },
    { name: 'weekStart', label: '周开始日期', kind: 'date', required: true },
    { name: 'weekEnd', label: '周结束日期', kind: 'date', required: true },
    { name: 'teamAId', label: '战队 A', kind: 'select', required: true, options },
    { name: 'teamBId', label: '战队 B', kind: 'select', required: true, options },
  ], { seasonId: text(record(source.season).id), weekStart: '', weekEnd: '', teamAId: options[0]?.value || '', teamBId: options[1]?.value || '' })
}

function rankingDefinition(source: Record<string, unknown>) {
  return definition('mip.admin.game.rankings.generate', '生成排行快照', '根据服务端经验值事实生成当前快照，不在浏览器计算或发放奖励。', [
    { name: 'seasonId', label: '赛季 ID', kind: 'text', hidden: true },
    { name: 'rankingType', label: '排行类型', kind: 'select', required: true, options: rankingTypes },
  ], { seasonId: text(record(source.season).id), rankingType: text(source.rankingType) || 'TEAM_HALF_YEAR' })
}

function catalogSaveDefinition(targetId: string, catalog: Record<string, unknown>) {
  return definition('mip.admin.game.blindBoxes.catalogs.save', targetId ? '编辑盲盒目录' : '新增盲盒目录', '目录只配置抽取与兑换规则，不模拟真实抽取或奖励发放。', [
    { name: 'catalogKey', label: '目录标识', kind: 'text', required: true, maxLength: 64 },
    { name: 'name', label: '目录名称', kind: 'text', required: true, maxLength: 100 },
    { name: 'summary', label: '简介', kind: 'textarea', maxLength: 500, wide: true },
    { name: 'rulesText', label: '抽取规则', kind: 'textarea', required: true, maxLength: 4000, wide: true },
    { name: 'redemptionRulesText', label: '兑换规则', kind: 'textarea', required: true, maxLength: 4000, wide: true },
    { name: 'drawCostCoin', label: '单次游戏币', kind: 'integer', required: true },
    { name: 'dailyDrawLimit', label: '每日次数上限', kind: 'integer', required: true },
    { name: 'pityThreshold', label: '保底次数', kind: 'integer', required: true },
    { name: 'pityMinRarity', label: '保底最低稀有度', kind: 'select', required: true, options: rarityOptions },
  ], {
    catalogId: targetId, expectedVersion: positiveInteger(catalog.version), catalogKey: text(catalog.catalogKey),
    name: text(catalog.name), summary: text(catalog.summary), rulesText: text(catalog.rulesText),
    redemptionRulesText: text(catalog.redemptionRulesText), drawCostCoin: integer(catalog.drawCostCoin) || 1,
    dailyDrawLimit: integer(catalog.dailyDrawLimit) || 20, pityThreshold: integer(catalog.pityThreshold) || 10,
    pityMinRarity: text(catalog.pityMinRarity) || 'RARE',
  })
}

function cardSaveDefinition(targetId: string, source: Record<string, unknown>, card: Record<string, unknown>) {
  return definition('mip.admin.game.blindBoxes.cards.save', targetId ? '编辑盲盒卡片' : '新增盲盒卡片', '这里只配置卡片权重与库存，不伪造用户中奖或奖励发放。', [
    { name: 'catalogId', label: '目录 ID', kind: 'text', hidden: true },
    { name: 'cardKey', label: '卡片标识', kind: 'text', required: true, maxLength: 64 },
    { name: 'name', label: '卡片名称', kind: 'text', required: true, maxLength: 100 },
    { name: 'summary', label: '说明', kind: 'textarea', maxLength: 500, wide: true },
    { name: 'rarity', label: '稀有度', kind: 'select', required: true, options: rarityOptions },
    { name: 'weight', label: '权重', kind: 'integer', required: true },
    { name: 'stockTotal', label: '总库存', kind: 'integer', required: true },
    { name: 'displayOrder', label: '展示顺序', kind: 'integer', required: true },
  ], {
    cardId: targetId, expectedVersion: positiveInteger(card.version), catalogId: text(card.catalogId) || text(record(source.catalog).id),
    cardKey: text(card.cardKey), name: text(card.name), summary: text(card.summary), rarity: text(card.rarity) || 'COMMON',
    weight: integer(card.weight) || 1, stockTotal: integer(card.stockTotal), displayOrder: integer(card.displayOrder),
  })
}

function seasonSaveInput(values: OperationValues) {
  const seasonId = optionalUuid(values.seasonId)
  const expectedVersion = positiveInteger(values.expectedVersion)
  const startsAt = isoDate(values.startsAt)
  const endsAt = isoDate(values.endsAt)
  const periodKind = enumText(values.periodKind, ['HALF_YEAR', 'YEAR', 'CUSTOM'])
  const seasonKey = keyText(values.seasonKey)
  const name = boundedText(values.name, 100, true)
  const rulesText = boundedText(values.rulesText, 4000, true)
  if (seasonId === null || !startsAt || !endsAt || new Date(startsAt) >= new Date(endsAt) || !periodKind || !seasonKey || !name || !rulesText) return null
  const input: AdminRequestInput = { season: {
    seasonKey, name, summary: boundedText(values.summary, 500), rulesText,
    ...(validRules(values.rules) ? { rules: values.rules } : {}), periodKind, startsAt, endsAt,
  } }
  if (seasonId) {
    if (!expectedVersion) return null
    input.seasonId = seasonId
    input.expectedVersion = expectedVersion
  }
  return input
}

function teamSaveInput(values: OperationValues) {
  const teamId = optionalUuid(values.teamId)
  const expectedVersion = positiveInteger(values.expectedVersion)
  const seasonId = uuid(values.seasonId)
  const branchId = optionalUuid(values.branchId)
  const name = boundedText(values.name, 100, true)
  const memberLimit = boundedInteger(values.memberLimit, 1, 100, true)
  if (teamId === null || !seasonId || branchId === null || !name || memberLimit === null) return null
  const input: AdminRequestInput = { team: { seasonId, ...(branchId ? { branchId } : {}), name, summary: boundedText(values.summary, 500), memberLimit } }
  if (teamId) {
    if (!expectedVersion) return null
    input.teamId = teamId
    input.expectedVersion = expectedVersion
  }
  return input
}

function teamMembersInput(values: OperationValues) {
  const seasonId = uuid(values.seasonId)
  const teamId = uuid(values.teamId)
  const expectedVersion = positiveInteger(values.expectedVersion)
  const refs = profileRefs(values.memberRefs)
  const captainRef = text(values.captainRef)
  if (!seasonId || !teamId || !expectedVersion || refs === null || (captainRef && !refs.includes(captainRef))) return null
  return { seasonId, teamId, expectedVersion, members: refs.map(memberRef => ({ memberRef, role: memberRef === captainRef ? 'CAPTAIN' : 'MEMBER' })) }
}

function matchSaveInput(values: OperationValues) {
  const seasonId = uuid(values.seasonId)
  const teamAId = uuid(values.teamAId)
  const teamBId = uuid(values.teamBId)
  const weekStart = dateOnly(values.weekStart)
  const weekEnd = dateOnly(values.weekEnd)
  if (!seasonId || !teamAId || !teamBId || teamAId === teamBId || !weekStart || !weekEnd) return null
  const days = (new Date(`${weekEnd}T00:00:00Z`).getTime() - new Date(`${weekStart}T00:00:00Z`).getTime()) / 86_400_000
  return days === 6 ? { match: { seasonId, weekStart, weekEnd, teamAId, teamBId } } : null
}

function rankingInput(values: OperationValues) {
  const seasonId = uuid(values.seasonId)
  const rankingType = enumText(values.rankingType, rankingTypes.map(item => item.value))
  return seasonId && rankingType ? { seasonId, rankingType } : null
}

function catalogSaveInput(values: OperationValues) {
  const catalogId = optionalUuid(values.catalogId)
  const expectedVersion = positiveInteger(values.expectedVersion)
  const catalogKey = keyText(values.catalogKey)
  const name = boundedText(values.name, 100, true)
  const rulesText = boundedText(values.rulesText, 4000, true)
  const redemptionRulesText = boundedText(values.redemptionRulesText, 4000, true)
  const drawCostCoin = boundedInteger(values.drawCostCoin, 1, 100000, true)
  const dailyDrawLimit = boundedInteger(values.dailyDrawLimit, 1, 100, true)
  const pityThreshold = boundedInteger(values.pityThreshold, 1, 100, true)
  const pityMinRarity = enumText(values.pityMinRarity, rarityOptions.map(item => item.value))
  if (catalogId === null || !catalogKey || !name || !rulesText || !redemptionRulesText || drawCostCoin === null || dailyDrawLimit === null || pityThreshold === null || !pityMinRarity) return null
  const input: AdminRequestInput = { catalog: {
    catalogKey, name, summary: boundedText(values.summary, 500), rulesText, redemptionRulesText,
    drawCostCoin, dailyDrawLimit, pityThreshold, pityMinRarity,
  } }
  if (catalogId) {
    if (!expectedVersion) return null
    input.catalogId = catalogId
    input.expectedVersion = expectedVersion
  }
  return input
}

function cardSaveInput(values: OperationValues) {
  const cardId = optionalUuid(values.cardId)
  const expectedVersion = positiveInteger(values.expectedVersion)
  const catalogId = uuid(values.catalogId)
  const cardKey = keyText(values.cardKey)
  const name = boundedText(values.name, 100, true)
  const rarity = enumText(values.rarity, rarityOptions.map(item => item.value))
  const weight = boundedInteger(values.weight, 1, 1000000, true)
  const stockTotal = boundedInteger(values.stockTotal, 0, 100000000, true)
  const displayOrder = boundedInteger(values.displayOrder, 0, 1000000, true)
  if (cardId === null || !catalogId || !cardKey || !name || !rarity || weight === null || stockTotal === null || displayOrder === null) return null
  const input: AdminRequestInput = { card: {
    catalogId, cardKey, name, summary: boundedText(values.summary, 500), rarity, weight, stockTotal, displayOrder,
  } }
  if (cardId) {
    if (!expectedVersion) return null
    input.cardId = cardId
    input.expectedVersion = expectedVersion
  }
  return input
}

function seasonRowActions(item: Record<string, unknown>): AdminRowOperation[] {
  const id = uuid(item.id)
  const version = positiveInteger(item.version)
  if (!id || !version) return []
  const actions: AdminRowOperation[] = item.status !== 'CLOSED' ? [{
    action: 'mip.admin.game.seasons.save', label: '编辑', targetId: id, expectedVersion: version,
    values: seasonValues(item),
  }] : []
  if (item.status === 'DRAFT') actions.push({ action: 'mip.admin.game.seasons.changeStatus', label: '启用', targetId: id, expectedVersion: version, values: { seasonId: id, status: 'ACTIVE' } })
  if (item.status === 'ACTIVE') actions.push({ action: 'mip.admin.game.seasons.changeStatus', label: '结束', targetId: id, expectedVersion: version, values: { seasonId: id, status: 'CLOSED' } })
  return actions
}

function teamRowActions(item: Record<string, unknown>): AdminRowOperation[] {
  const id = uuid(item.id)
  const seasonId = uuid(item.seasonId)
  const version = positiveInteger(item.version)
  if (!id || !seasonId || !version) return []
  return [
    { action: 'mip.admin.game.teams.save', label: '编辑', targetId: id, expectedVersion: version, values: teamValues(item) },
    { action: 'mip.admin.game.teams.changeStatus', label: item.status === 'ACTIVE' ? '停用' : '启用', targetId: id, expectedVersion: version, values: { seasonId, teamId: id, status: item.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' } },
  ]
}

function matchRowActions(item: Record<string, unknown>): AdminRowOperation[] {
  const id = uuid(item.id)
  const version = positiveInteger(item.version)
  return id && version && item.status === 'SCHEDULED' ? [{
    action: 'mip.admin.game.matches.finalize', label: '结算', targetId: id, expectedVersion: version, values: { matchId: id },
  }] : []
}

function catalogRowActions(item: Record<string, unknown>): AdminRowOperation[] {
  const id = uuid(item.id)
  const version = positiveInteger(item.version)
  if (!id || !version) return []
  return [
    { action: 'mip.admin.game.blindBoxes.catalogs.save', label: '编辑', targetId: id, expectedVersion: version, values: catalogValues(item) },
    { action: 'mip.admin.game.blindBoxes.catalogs.changeStatus', label: item.status === 'PUBLISHED' ? '下架' : '发布', targetId: id, expectedVersion: version, values: { catalogId: id, status: item.status === 'PUBLISHED' ? 'UNPUBLISHED' : 'PUBLISHED' } },
  ]
}

function cardRowActions(item: Record<string, unknown>): AdminRowOperation[] {
  const id = uuid(item.id)
  const version = positiveInteger(item.version)
  if (!id || !version) return []
  return [
    { action: 'mip.admin.game.blindBoxes.cards.save', label: '编辑', targetId: id, expectedVersion: version, values: cardValues(item) },
    { action: 'mip.admin.game.blindBoxes.cards.changeStatus', label: item.status === 'PUBLISHED' ? '下架' : '发布', targetId: id, expectedVersion: version, values: { cardId: id, status: item.status === 'PUBLISHED' ? 'UNPUBLISHED' : 'PUBLISHED' } },
  ]
}

function statusResource(action: AdminGameMutationAction, source: Record<string, unknown>, resources: Record<string, Record<string, unknown>>) {
  if (action.startsWith('mip.admin.game.seasons.')) return { item: resources.season, identifiers: { seasonId: text(resources.season.id) || text(source.seasonId) } }
  if (action.startsWith('mip.admin.game.teams.')) return { item: resources.team, identifiers: { seasonId: text(resources.team.seasonId) || text(source.seasonId), teamId: text(resources.team.id) } }
  if (action === 'mip.admin.game.matches.finalize') return { item: record(source.match), identifiers: { matchId: text(record(source.match).id) } }
  if (action.startsWith('mip.admin.game.blindBoxes.catalogs.')) return { item: resources.catalog, identifiers: { catalogId: text(resources.catalog.id) } }
  return { item: resources.card, identifiers: { cardId: text(resources.card.id) } }
}

function seasonValues(item: Record<string, unknown>) { return { ...item, seasonId: item.id, rules: item.rules } }
function teamValues(item: Record<string, unknown>) { return { ...item, teamId: item.id } }
function catalogValues(item: Record<string, unknown>) { return { ...item, catalogId: item.id } }
function cardValues(item: Record<string, unknown>) { return { ...item, cardId: item.id } }

function statusInput(values: OperationValues, idKey: string, statuses: string[], expectedVersion: number) {
  const id = uuid(values[idKey])
  const status = enumText(values.status, statuses)
  return id && status ? { [idKey]: id, expectedVersion, status } : null
}

function nextStatus(action: AdminGameMutationAction, status: unknown) {
  if (action === 'mip.admin.game.seasons.changeStatus') return status === 'DRAFT' ? 'ACTIVE' : 'CLOSED'
  if (action === 'mip.admin.game.teams.changeStatus') return status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE'
  return status === 'PUBLISHED' ? 'UNPUBLISHED' : 'PUBLISHED'
}

function mutationTitle(action: AdminGameMutationAction) {
  const labels: Partial<Record<AdminGameMutationAction, string>> = {
    'mip.admin.game.seasons.changeStatus': '更新赛季状态',
    'mip.admin.game.teams.changeStatus': '更新战队状态',
    'mip.admin.game.matches.finalize': '结算周赛',
    'mip.admin.game.blindBoxes.catalogs.changeStatus': '更新盲盒目录状态',
    'mip.admin.game.blindBoxes.cards.changeStatus': '更新盲盒卡片状态',
  }
  return labels[action] || '更新战队管理数据'
}

function mutationDescription(action: AdminGameMutationAction) {
  return action === 'mip.admin.game.matches.finalize'
    ? '服务端根据经验值事实计算双方得分和胜者；浏览器不提交比分。'
    : '提交时按服务端版本检查当前状态，避免覆盖其他运营成员的更新。'
}

function definition(action: AdminGameMutationAction, title: string, description: string, fieldsValue: readonly OperationField[], values: OperationValues): AdminGameMutationDefinition {
  return { action, capability: 'game.manage', title, description, fields: fieldsValue, values }
}

function assertGameSession(value: unknown) {
  const session = record(value)
  if (session.capability !== 'game.manage' || !['PLATFORM_OWNER', 'PLATFORM_OPERATIONS'].includes(String(session.roleKey || ''))) {
    throw new Error('INVALID_GAME_SESSION')
  }
}

function matchesQuery(item: Record<string, unknown>, query: AdminListQuery) {
  const keyword = query.query.trim().toLocaleLowerCase('zh-CN')
  const status = query.status
  return (!keyword || Object.values(item).some(value => String(value).toLocaleLowerCase('zh-CN').includes(keyword)))
    && (!status || item.status === status)
}

function normalizeMemberQuery(value: GameMemberPageQuery) {
  const query = text(value.query).slice(0, 80)
  const cursor = typeof value.cursor === 'string' && value.cursor.length <= 512 ? value.cursor : ''
  const limit = boundedInteger(value.limit ?? 30, 1, 100, true) || 30
  return { query, cursor, limit }
}

function matchResult(item: Record<string, unknown>) {
  const teamA = record(item.teamA)
  const teamB = record(item.teamB)
  if (item.status !== 'FINALIZED') return '待结算'
  return `${numberLabel(teamA.score)} : ${numberLabel(teamB.score)}`
}

function statusLabel(value: unknown) {
  const labels: Record<string, string> = {
    DRAFT: '草稿', ACTIVE: '启用', CLOSED: '已结束', INACTIVE: '停用',
    SCHEDULED: '待结算', FINALIZED: '已结算', PUBLISHED: '已发布', UNPUBLISHED: '已下架',
  }
  const key = String(value || '')
  return labels[key] || key || '—'
}

function periodKindLabel(value: unknown) {
  return ({ HALF_YEAR: '半年', YEAR: '全年', CUSTOM: '自定义' } as Record<string, string>)[String(value || '')] || '—'
}
function rankingTypeLabel(value: unknown) { return rankingTypes.find(item => item.value === value)?.label || String(value || '—') }
function rarityLabel(value: unknown) { return rarityOptions.find(item => item.value === value)?.label || String(value || '—') }
function roleLabel(value: unknown) { return value === 'CAPTAIN' ? '队长' : value === 'MEMBER' ? '成员' : '未分配' }
function dateRange(from: unknown, to: unknown) { return `${formatDateTime(from)} – ${formatDateTime(to)}` }
function fields(entries: Array<[string, unknown]>) { return entries.map(([label, value]) => ({ label, value: value === undefined || value === null || value === '' ? '—' : String(value) })) }
function records(value: unknown) { return Array.isArray(value) ? value.map(record) : [] }
function text(value: unknown) { return typeof value === 'string' ? value.trim() : '' }
function boundedText(value: unknown, maximum: number, required = false) { const result = text(value); return (!required || result) && result.length <= maximum ? result : '' }
function enumText(value: unknown, allowed: readonly string[]) { const result = text(value); return allowed.includes(result) ? result : '' }
function keyText(value: unknown) { const result = text(value); return /^[a-z][a-z0-9_-]{2,63}$/.test(result) ? result : '' }
function integer(value: unknown) { const result = Number(value); return Number.isSafeInteger(result) ? result : 0 }
function positiveInteger(value: unknown) { const result = Number(value); return Number.isSafeInteger(result) && result >= 1 ? result : null }
function boundedInteger(value: unknown, minimum: number, maximum: number, required = false) { if ((value === '' || value === undefined || value === null) && !required) return undefined; const result = Number(value); return Number.isSafeInteger(result) && result >= minimum && result <= maximum ? result : null }
function uuid(value: unknown) { const result = text(value); return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(result) ? result : '' }
function optionalUuid(value: unknown): string | null { const result = text(value); return result ? uuid(result) || null : '' }
function isoDate(value: unknown) { const date = new Date(text(value)); return Number.isFinite(date.getTime()) ? date.toISOString() : '' }
function dateOnly(value: unknown) { const result = text(value); return /^\d{4}-\d{2}-\d{2}$/.test(result) && Number.isFinite(new Date(`${result}T00:00:00Z`).getTime()) ? result : '' }
function profileRefs(value: unknown): string[] | null { if (!Array.isArray(value) || value.length > 100) return null; const refs = [...new Set(value.map(text))]; return refs.every(item => item && item.length <= 200) ? refs : null }
function validRules(value: unknown) { return Boolean(value && typeof value === 'object' && !Array.isArray(value)) }
