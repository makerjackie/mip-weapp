'use strict'

const cloud = require('wx-server-sdk')
const { createHandler } = require('./domain/handler')
const { createGrowthRepository } = require('./domain/repository')
const { createGrowthService } = require('./domain/service')
const { resolveMipUser, trustedWechatIdentity } = require('./lib/identity')
const { verifyInternalEvent } = require('./lib/internal-auth')
const { mysqlDatabase } = require('./lib/mysql')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const allowedAppIds = new Set(
  String(process.env.MIP_ALLOWED_APP_IDS || '').split(',').map(value => value.trim()).filter(Boolean),
)
const database = mysqlDatabase()
const service = createGrowthService(createGrowthRepository(database))

exports.main = createHandler({
  service,
  async health() {
    await database.one('SELECT 1 AS ok')
    return { service: 'mip-growth-api', persistence: 'cloudbase-mysql' }
  },
  verifyInternal: event => verifyInternalEvent(event, {
    secret: process.env.MIP_GROWTH_HMAC_SECRET,
    allowedAppIds,
  }),
  async resolveCaller() {
    const identity = trustedWechatIdentity(cloud.getWXContext(), {
      allowedAppIds,
      pepper: process.env.MIP_IDENTITY_PEPPER,
    })
    return resolveMipUser(database, identity)
  },
})
