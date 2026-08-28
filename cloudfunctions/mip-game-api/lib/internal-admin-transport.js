'use strict'

const { createHmac, timingSafeEqual } = require('node:crypto')
const { failure } = require('../domain/handler')

const GAME_ADMIN_TRANSPORT = 'MIP_GAME_ADMIN_V1'
const GAME_ADMIN_PROTOCOL = 'mip-game-admin/v1'
const MAX_CLOCK_SKEW_MS = 60_000

const thresholdSchema = objectSchema(['level', 'minimumExperience', 'label'])
const seasonSchema = objectSchema(
  ['seasonKey', 'name', 'summary', 'rulesText', 'rules', 'periodKind', 'startsAt', 'endsAt'],
  {
    rules: objectSchema(['scoreMetric', 'headquartersThresholds'], {
      headquartersThresholds: arraySchema(thresholdSchema),
    }),
  },
)
const teamSchema = objectSchema(['seasonId', 'branchId', 'name', 'summary', 'memberLimit'])
const memberSchema = objectSchema(['memberRef', 'role'])
const matchSchema = objectSchema(['seasonId', 'weekStart', 'weekEnd', 'teamAId', 'teamBId'])
const catalogSchema = objectSchema([
  'catalogKey', 'name', 'summary', 'rulesText', 'redemptionRulesText',
  'drawCostCoin', 'dailyDrawLimit', 'pityThreshold', 'pityMinRarity',
])
const cardSchema = objectSchema([
  'catalogId', 'cardKey', 'name', 'summary', 'rarity', 'weight', 'stockTotal', 'displayOrder',
])

const ACTION_SPECS = Object.freeze({
  'admin.getSession': objectSchema([]),
  'admin.listRankings': objectSchema(['seasonId', 'rankingType', 'branchId', 'limit']),
  'admin.listSeasons': objectSchema([]),
  'admin.saveSeason': objectSchema(
    ['seasonId', 'expectedVersion', 'season'],
    { season: seasonSchema },
  ),
  'admin.changeSeasonStatus': objectSchema(['seasonId', 'expectedVersion', 'status']),
  'admin.listTeams': objectSchema(['seasonId']),
  'admin.saveTeam': objectSchema(['teamId', 'expectedVersion', 'team'], { team: teamSchema }),
  'admin.changeTeamStatus': objectSchema(['seasonId', 'teamId', 'expectedVersion', 'status']),
  'admin.listAssignableMembers': objectSchema(['seasonId', 'teamId', 'query', 'cursor', 'limit']),
  'admin.replaceTeamMembers': objectSchema(
    ['seasonId', 'teamId', 'expectedVersion', 'members'],
    { members: arraySchema(memberSchema) },
  ),
  'admin.listMatches': objectSchema(['seasonId']),
  'admin.saveWeeklyMatch': objectSchema(['match'], { match: matchSchema }),
  'admin.finalizeWeeklyMatch': objectSchema(['matchId', 'expectedVersion']),
  'admin.generateRankingSnapshot': objectSchema(['seasonId', 'rankingType']),
  'admin.listBlindBoxCatalogs': objectSchema([]),
  'admin.saveBlindBoxCatalog': objectSchema(
    ['catalogId', 'expectedVersion', 'catalog'],
    { catalog: catalogSchema },
  ),
  'admin.changeBlindBoxCatalogStatus': objectSchema(['catalogId', 'expectedVersion', 'status']),
  'admin.listBlindBoxCards': objectSchema(['catalogId']),
  'admin.saveBlindBoxCard': objectSchema(
    ['cardId', 'expectedVersion', 'card'],
    { card: cardSchema },
  ),
  'admin.changeBlindBoxCardStatus': objectSchema(['cardId', 'expectedVersion', 'status']),
})
const MUTATION_ACTIONS = new Set([
  'admin.saveSeason',
  'admin.changeSeasonStatus',
  'admin.saveTeam',
  'admin.changeTeamStatus',
  'admin.replaceTeamMembers',
  'admin.saveWeeklyMatch',
  'admin.finalizeWeeklyMatch',
  'admin.generateRankingSnapshot',
  'admin.saveBlindBoxCatalog',
  'admin.changeBlindBoxCatalogStatus',
  'admin.saveBlindBoxCard',
  'admin.changeBlindBoxCardStatus',
])
const QUERY_SIGNED_KEYS = new Set([
  'transport', 'protocol', 'timestamp', 'nonce', 'appId', 'actorUserId',
  'action', 'input', 'sourceFunction',
])
const MUTATION_SIGNED_KEYS = new Set([...QUERY_SIGNED_KEYS, 'idempotencyKey'])
const ALLOWED_SIGNED_KEYS = new Set(MUTATION_SIGNED_KEYS)
const FRAMEWORK_KEYS = new Set(['userInfo', 'tcbContext', 'frameworkContext'])

function objectSchema(keys, nested = {}) {
  return Object.freeze({
    kind: 'object',
    keys: Object.freeze([...keys]),
    nested: Object.freeze({ ...nested }),
  })
}

function arraySchema(item) {
  return Object.freeze({ kind: 'array', item })
}

function verifyGameAdminRequest(
  value,
  { secret, allowedAppIds, sourceFunction = 'mip-admin-api', now = Date.now } = {},
) {
  if (typeof secret !== 'string' || secret.length < 32) {
    throw new Error('GAME_INTERNAL_AUTH_CONFIG_REQUIRED')
  }
  if (!isPlainRecord(value)) throw new Error('AUTH_REQUIRED')
  const signed = {}
  for (const [key, item] of Object.entries(value)) {
    if (key === 'signature') continue
    if (FRAMEWORK_KEYS.has(key)) continue
    if (!ALLOWED_SIGNED_KEYS.has(key)) throw new Error('AUTH_REQUIRED')
    signed[key] = item
  }
  const inputSchema = ACTION_SPECS[signed.action]
  const expectedKeys = MUTATION_ACTIONS.has(signed.action) ? MUTATION_SIGNED_KEYS : QUERY_SIGNED_KEYS
  if (!hasExactKeys(signed, expectedKeys)
    || value.signature === undefined
    || typeof value.signature !== 'string'
    || !/^[a-f0-9]{64}$/.test(value.signature)
    || signed.transport !== GAME_ADMIN_TRANSPORT
    || signed.protocol !== GAME_ADMIN_PROTOCOL
    || !Number.isSafeInteger(signed.timestamp)
    || typeof now !== 'function'
    || Math.abs(Number(now()) - signed.timestamp) > MAX_CLOCK_SKEW_MS
    || typeof signed.nonce !== 'string'
    || !/^[A-Za-z0-9_-]{24,128}$/.test(signed.nonce)
    || !(allowedAppIds instanceof Set)
    || !allowedAppIds.has(signed.appId)
    || !uuid(signed.actorUserId)
    || !inputSchema
    || (MUTATION_ACTIONS.has(signed.action) && !validIdempotencyKey(signed.idempotencyKey))
    || !validSchema(signed.input, inputSchema)
    || !trustedFunctionName(signed.sourceFunction)
    || signed.sourceFunction !== sourceFunction) {
    throw new Error('AUTH_REQUIRED')
  }
  const expected = createHmac('sha256', secret)
    .update(`${GAME_ADMIN_PROTOCOL}\0${stableJson(signed)}`)
    .digest()
  const supplied = Buffer.from(value.signature, 'hex')
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    throw new Error('AUTH_REQUIRED')
  }
  return signed
}

function validSchema(value, schema) {
  if (schema.kind === 'array') {
    return Array.isArray(value) && value.every(item => validSchema(item, schema.item))
  }
  if (!isPlainRecord(value)) return false
  const allowed = new Set(schema.keys)
  if (Reflect.ownKeys(value).some(key => typeof key !== 'string' || !allowed.has(key))) return false
  return Object.entries(schema.nested).every(([key, nestedSchema]) => (
    !Object.hasOwn(value, key) || validSchema(value[key], nestedSchema)
  ))
}

function createInternalGameHandler({
  service,
  secret,
  allowedAppIds,
  assertAdminReady,
  afterSuccessfulMutation,
  profileRefSecret,
  sourceFunction = 'mip-admin-api',
  now = Date.now,
} = {}) {
  if (!service || typeof assertAdminReady !== 'function') {
    throw new Error('GAME_INTERNAL_HANDLER_CONFIG_INVALID')
  }
  const dispatch = Object.freeze({
    'admin.getSession': caller => service.getAdminSession(caller),
    'admin.listRankings': (caller, input) => service.listAdminRankings(caller, input),
    'admin.listSeasons': caller => service.listSeasons(caller),
    'admin.saveSeason': (caller, input) => service.saveSeason(caller, input),
    'admin.changeSeasonStatus': (caller, input) => service.changeSeasonStatus(caller, input),
    'admin.listTeams': (caller, input) => service.listTeams(caller, input),
    'admin.saveTeam': (caller, input) => service.saveTeam(caller, input),
    'admin.changeTeamStatus': (caller, input) => service.changeTeamStatus(caller, input),
    'admin.listAssignableMembers': (caller, input) => service.listAssignableMembers(caller, input),
    'admin.replaceTeamMembers': (caller, input) => service.replaceTeamMembers(caller, input),
    'admin.listMatches': (caller, input) => service.listAdminMatches(caller, input),
    'admin.saveWeeklyMatch': (caller, input) => service.saveWeeklyMatch(caller, input),
    'admin.finalizeWeeklyMatch': (caller, input) => service.finalizeWeeklyMatch(caller, input),
    'admin.generateRankingSnapshot': (caller, input) => service.generateRankingSnapshot(caller, input),
    'admin.listBlindBoxCatalogs': caller => service.adminListBlindBoxCatalogs(caller),
    'admin.saveBlindBoxCatalog': (caller, input) => service.adminSaveBlindBoxCatalog(caller, input),
    'admin.changeBlindBoxCatalogStatus': (caller, input) => service.adminChangeBlindBoxCatalogStatus(caller, input),
    'admin.listBlindBoxCards': (caller, input) => service.adminListBlindBoxCards(caller, input),
    'admin.saveBlindBoxCard': (caller, input) => service.adminSaveBlindBoxCard(caller, input),
    'admin.changeBlindBoxCardStatus': (caller, input) => service.adminChangeBlindBoxCardStatus(caller, input),
  })
  return async function handle(event = {}) {
    try {
      const request = verifyGameAdminRequest(event, {
        secret,
        allowedAppIds,
        sourceFunction,
        now,
      })
      const caller = {
        appId: request.appId,
        userId: request.actorUserId,
        profileRefSecret,
      }
      await assertAdminReady(caller)
      const run = dispatch[request.action]
      if (!run) throw new Error('NOT_FOUND')
      const input = MUTATION_ACTIONS.has(request.action)
        ? { ...request.input, idempotencyKey: request.idempotencyKey }
        : request.input
      const data = await run(caller, input)
      if (typeof afterSuccessfulMutation === 'function') {
        await afterSuccessfulMutation({ request, data })
      }
      return { ok: true, data }
    }
    catch (error) {
      return failure(error)
    }
  }
}

function signGameAdminRequest(value, secret) {
  if (typeof secret !== 'string' || secret.length < 32) {
    throw new Error('GAME_INTERNAL_AUTH_CONFIG_REQUIRED')
  }
  const unsigned = Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'signature'))
  return createHmac('sha256', secret).update(`${GAME_ADMIN_PROTOCOL}\0${stableJson(unsigned)}`).digest('hex')
}

function hasExactKeys(value, allowed) {
  const keys = Reflect.ownKeys(value)
  return keys.length === allowed.size
    && keys.every(key => typeof key === 'string' && allowed.has(key))
}

function trustedFunctionName(value) {
  return typeof value === 'string' && /^mip-[a-z0-9][a-z0-9-]{0,55}$/.test(value)
}

function uuid(value) {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function validIdempotencyKey(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_.:-]{12,128}$/.test(value.trim())
}

function isPlainRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function stableJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`
}

module.exports = {
  ACTION_SPECS,
  GAME_ADMIN_PROTOCOL,
  GAME_ADMIN_TRANSPORT,
  MAX_CLOCK_SKEW_MS,
  MUTATION_ACTIONS,
  createInternalGameHandler,
  signGameAdminRequest,
  verifyGameAdminRequest,
}
