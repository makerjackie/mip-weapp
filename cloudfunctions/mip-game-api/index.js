'use strict'

const cloud = require('wx-server-sdk')
const { createHandler } = require('./domain/handler')
const { createGameRepository } = require('./domain/repository')
const { createGameService } = require('./domain/service')
const { assertFullAccessReady, configuredAgreements } = require('./lib/full-access')
const { resolveCaller, trustedWechatIdentity } = require('./lib/identity')
const { mysqlDatabase } = require('./lib/mysql')
const { assertPlayerReady } = require('./lib/player-access')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const allowedAppIds = new Set(
  String(process.env.MIP_ALLOWED_APP_IDS || '').split(',').map(value => value.trim()).filter(Boolean),
)
const database = mysqlDatabase()
const service = createGameService(createGameRepository(database))

exports.main = createHandler({
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
  assertAdminReady: caller => assertFullAccessReady(database, caller, configuredAgreements()),
})
