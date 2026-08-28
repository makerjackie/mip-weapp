'use strict'

const { createHmac, randomBytes } = require('node:crypto')

const GAME_ADMIN_TRANSPORT = 'MIP_GAME_ADMIN_V1'
const GAME_ADMIN_PROTOCOL = 'mip-game-admin/v1'
const DEFAULT_TIMEOUT_MS = 45_000
const MAX_TIMEOUT_MS = 50_000

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

const OPERATION_SPECS = Object.freeze({
  'mip.admin.game.session': operation('admin.getSession', objectSchema([])),
  'mip.admin.game.rankings.list': operation(
    'admin.listRankings',
    objectSchema(['seasonId', 'rankingType', 'branchId', 'limit']),
  ),
  'mip.admin.game.seasons.list': operation('admin.listSeasons', objectSchema([])),
  'mip.admin.game.seasons.save': operation(
    'admin.saveSeason',
    objectSchema(['seasonId', 'expectedVersion', 'season'], { season: seasonSchema }),
  ),
  'mip.admin.game.seasons.changeStatus': operation(
    'admin.changeSeasonStatus',
    objectSchema(['seasonId', 'expectedVersion', 'status']),
  ),
  'mip.admin.game.teams.list': operation('admin.listTeams', objectSchema(['seasonId'])),
  'mip.admin.game.teams.save': operation(
    'admin.saveTeam',
    objectSchema(['teamId', 'expectedVersion', 'team'], { team: teamSchema }),
  ),
  'mip.admin.game.teams.changeStatus': operation(
    'admin.changeTeamStatus',
    objectSchema(['seasonId', 'teamId', 'expectedVersion', 'status']),
  ),
  'mip.admin.game.members.assignable.list': operation(
    'admin.listAssignableMembers',
    objectSchema(['seasonId', 'teamId', 'query', 'cursor', 'limit']),
  ),
  'mip.admin.game.teams.members.replace': operation(
    'admin.replaceTeamMembers',
    objectSchema(['seasonId', 'teamId', 'expectedVersion', 'members'], {
      members: arraySchema(memberSchema),
    }),
  ),
  'mip.admin.game.matches.list': operation('admin.listMatches', objectSchema(['seasonId'])),
  'mip.admin.game.matches.save': operation(
    'admin.saveWeeklyMatch',
    objectSchema(['match'], { match: matchSchema }),
  ),
  'mip.admin.game.matches.finalize': operation(
    'admin.finalizeWeeklyMatch',
    objectSchema(['matchId', 'expectedVersion']),
  ),
  'mip.admin.game.rankings.generate': operation(
    'admin.generateRankingSnapshot',
    objectSchema(['seasonId', 'rankingType']),
  ),
  'mip.admin.game.blindBoxes.catalogs.list': operation('admin.listBlindBoxCatalogs', objectSchema([])),
  'mip.admin.game.blindBoxes.catalogs.save': operation(
    'admin.saveBlindBoxCatalog',
    objectSchema(['catalogId', 'expectedVersion', 'catalog'], { catalog: catalogSchema }),
  ),
  'mip.admin.game.blindBoxes.catalogs.changeStatus': operation(
    'admin.changeBlindBoxCatalogStatus',
    objectSchema(['catalogId', 'expectedVersion', 'status']),
  ),
  'mip.admin.game.blindBoxes.cards.list': operation(
    'admin.listBlindBoxCards',
    objectSchema(['catalogId']),
  ),
  'mip.admin.game.blindBoxes.cards.save': operation(
    'admin.saveBlindBoxCard',
    objectSchema(['cardId', 'expectedVersion', 'card'], { card: cardSchema }),
  ),
  'mip.admin.game.blindBoxes.cards.changeStatus': operation(
    'admin.changeBlindBoxCardStatus',
    objectSchema(['cardId', 'expectedVersion', 'status']),
  ),
})
const MUTATION_OPERATIONS = new Set([
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
])
const EXECUTE_KEYS = new Set(['appId', 'actorUserId', 'action', 'input', 'idempotencyKey'])

function operation(internalAction, inputSchema) {
  return Object.freeze({ internalAction, inputSchema })
}

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

function createGameAdminClient(options = {}) {
  const functionName = text(options.functionName) || 'mip-game-api'
  const sourceFunction = text(options.sourceFunction) || 'mip-admin-api'
  const timeoutMs = boundedTimeout(options.timeoutMs)
  const configured = Boolean(
    options.cloud
    && typeof options.cloud.callFunction === 'function'
    && typeof options.secret === 'string'
    && options.secret.length >= 32
    && validFunctionName(functionName)
    && validFunctionName(sourceFunction)
    && functionName !== sourceFunction,
  )
  const now = options.now || Date.now
  const nonce = options.nonce || (() => randomBytes(18).toString('base64url'))

  return Object.freeze({
    configured,
    async execute(request = {}) {
      if (!isPlainRecord(request)
        || Reflect.ownKeys(request).some(key => typeof key !== 'string' || !EXECUTE_KEYS.has(key))) {
        throw codedError('VALIDATION_FAILED')
      }
      const { appId, actorUserId, action, input = {}, idempotencyKey } = request
      const operationSpec = OPERATION_SPECS[action]
      if (!operationSpec) throw codedError('GAME_OPERATION_NOT_ALLOWED')
      assertSchema(input, operationSpec.inputSchema)
      const mutation = MUTATION_OPERATIONS.has(action)
      const hasIdempotencyKey = Object.hasOwn(request, 'idempotencyKey')
      if ((mutation && !validIdempotencyKey(idempotencyKey)) || (!mutation && hasIdempotencyKey)) {
        throw codedError('VALIDATION_FAILED')
      }
      if (!configured || typeof now !== 'function' || typeof nonce !== 'function') {
        throw codedError('GAME_DISPATCH_CONFIG_REQUIRED')
      }
      if (!trustedIdentifier(appId, 64) || !uuid(actorUserId)) {
        throw codedError('AUTH_REQUIRED')
      }
      const timestamp = Number(now())
      const requestNonce = nonce()
      if (!Number.isSafeInteger(timestamp) || !/^[A-Za-z0-9_-]{24,128}$/.test(requestNonce)) {
        throw codedError('GAME_DISPATCH_CONFIG_REQUIRED')
      }
      const envelope = {
        transport: GAME_ADMIN_TRANSPORT,
        protocol: GAME_ADMIN_PROTOCOL,
        timestamp,
        nonce: requestNonce,
        appId,
        actorUserId,
        action: operationSpec.internalAction,
        input: { ...input },
        sourceFunction,
      }
      if (mutation) envelope.idempotencyKey = idempotencyKey.trim()
      envelope.signature = signGameAdminRequest(envelope, options.secret)
      let response
      try {
        response = await invokeWithTimeout(
          options.cloud.callFunction({ name: functionName, data: envelope }),
          timeoutMs,
        )
      }
      catch {
        throw codedError('GAME_DISPATCH_UNAVAILABLE')
      }
      if (response?.result?.ok !== true) {
        throw codedError(publicErrorCode(response?.result?.error?.code))
      }
      return response.result.data
    },
  })
}

function assertSchema(value, schema) {
  if (schema.kind === 'array') {
    if (!Array.isArray(value)) throw codedError('VALIDATION_FAILED')
    for (const item of value) assertSchema(item, schema.item)
    return
  }
  if (!isPlainRecord(value)) throw codedError('VALIDATION_FAILED')
  const allowed = new Set(schema.keys)
  if (Reflect.ownKeys(value).some(key => typeof key !== 'string' || !allowed.has(key))) {
    throw codedError('VALIDATION_FAILED')
  }
  for (const [key, nestedSchema] of Object.entries(schema.nested)) {
    if (Object.hasOwn(value, key)) assertSchema(value[key], nestedSchema)
  }
}

function signGameAdminRequest(value, secret) {
  if (typeof secret !== 'string' || secret.length < 32) {
    throw codedError('GAME_DISPATCH_CONFIG_REQUIRED')
  }
  const unsigned = Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'signature'))
  return createHmac('sha256', secret).update(`${GAME_ADMIN_PROTOCOL}\0${stableJson(unsigned)}`).digest('hex')
}

async function invokeWithTimeout(invocation, timeoutMs) {
  let timer
  try {
    return await Promise.race([
      invocation,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('GAME_DISPATCH_TIMEOUT')), timeoutMs)
        timer.unref?.()
      }),
    ])
  }
  finally {
    clearTimeout(timer)
  }
}

function boundedTimeout(value) {
  const requested = Number(value)
  return Number.isInteger(requested) && requested >= 250 && requested <= MAX_TIMEOUT_MS
    ? requested
    : DEFAULT_TIMEOUT_MS
}

function validFunctionName(value) {
  return /^mip-[a-z0-9][a-z0-9-]{0,55}$/.test(value)
}

function trustedIdentifier(value, maximum) {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum
    && /^[A-Za-z0-9_-]+$/.test(value)
}

function uuid(value) {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function validIdempotencyKey(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_.:-]{12,128}$/.test(value.trim())
}

function publicErrorCode(value) {
  const code = text(value)
  return /^[A-Z][A-Z0-9_]{2,63}$/.test(code) ? code : 'GAME_DISPATCH_UNAVAILABLE'
}

function codedError(code) {
  const error = new Error(code)
  error.code = code
  error.retryable = code === 'GAME_DISPATCH_UNAVAILABLE'
  return error
}

function stableJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`
}

function isPlainRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function text(value) {
  return typeof value === 'string' ? value.trim() : ''
}

module.exports = {
  DEFAULT_TIMEOUT_MS,
  GAME_ADMIN_PROTOCOL,
  GAME_ADMIN_TRANSPORT,
  MAX_TIMEOUT_MS,
  MUTATION_OPERATIONS,
  OPERATION_SPECS,
  boundedTimeout,
  createGameAdminClient,
  signGameAdminRequest,
}
