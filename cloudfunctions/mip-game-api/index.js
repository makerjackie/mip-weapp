'use strict'

const cloud = require('wx-server-sdk')
const { createHandler } = require('./domain/handler')
const { createGameRepository } = require('./domain/repository')
const { assertFullAccessReady, configuredAgreements } = require('./lib/full-access')
const { resolveCaller, trustedWechatIdentity } = require('./lib/identity')
const { mysqlDatabase } = require('./lib/mysql')
const { createOutboxWakeup, trustedContextAppId } = require('./lib/outbox-wakeup')
const { assertPlayerReady } = require('./lib/player-access')
const {
  GAME_ADMIN_TRANSPORT,
  createInternalGameHandler,
} = require('./lib/internal-admin-transport')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const allowedAppIds = new Set(
  String(process.env.MIP_ALLOWED_APP_IDS || '').split(',').map(value => value.trim()).filter(Boolean),
)
const database = mysqlDatabase()
const service = createGameRepository(database)
const outboxMutationActions = new Set(['admin.finalizeWeeklyMatch', 'drawBlindBox'])
const outboxWakeup = createOutboxWakeup({
  cloud,
  functionName: process.env.MIP_OUTBOX_FUNCTION_NAME,
  secret: process.env.MIP_OUTBOX_HMAC_SECRET,
  sourceFunctionName: 'mip-game-api',
  logger: console,
})

const assertAdminReady = caller => assertFullAccessReady(database, caller, configuredAgreements())
const handler = createHandler({
  service,
  async health() {
    await database.one('SELECT 1 AS ok')
    return { service: 'mip-game-api', persistence: 'cloudbase-mysql' }
  },
  async resolveCaller() {
    const identity = trustedWechatIdentity(cloud.getWXContext(), {
      allowedAppIds,
      pepper: process.env.MIP_IDENTITY_PEPPER,
    })
    const caller = await resolveCaller(database, identity)
    return { ...caller, profileRefSecret: process.env.MIP_IDENTITY_PEPPER }
  },
  assertPlayerReady: caller => assertPlayerReady(database, caller),
  assertAdminReady,
})
const internalAdminHandler = createInternalGameHandler({
  service,
  secret: process.env.MIP_GAME_ADMIN_HMAC_SECRET,
  allowedAppIds,
  profileRefSecret: process.env.MIP_IDENTITY_PEPPER,
  assertAdminReady,
  afterSuccessfulMutation({ request }) {
    return outboxWakeup.afterSuccessfulMutation({
      appId: request.appId,
      action: request.action,
      mutationActions: outboxMutationActions,
    })
  },
})

exports.main = async (event = {}) => {
  if (event?.transport === GAME_ADMIN_TRANSPORT) {
    return internalAdminHandler(event)
  }
  const result = await handler(event)
  if (result?.ok === true) {
    await outboxWakeup.afterSuccessfulMutation({
      appId: trustedContextAppId(cloud.getWXContext(), allowedAppIds),
      action: String(event.action || ''),
      mutationActions: outboxMutationActions,
    })
  }
  return result
}

exports._test = { outboxMutationActions }
