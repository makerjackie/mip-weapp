'use strict'

const cloud = require('wx-server-sdk')
const { createContentSafety } = require('./domain/content-safety')
const { createHandler } = require('./domain/handler')
const { createBannerRepository } = require('./domain/repository')
const { createBannerService } = require('./domain/service')
const { assertFullAccessReady, configuredAgreements } = require('./lib/full-access')
const { resolveCaller, trustedWechatContext, trustedWechatIdentity } = require('./lib/identity')
const { mysqlDatabase } = require('./lib/mysql')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const allowedAppIds = new Set(
  String(process.env.MIP_ALLOWED_APP_IDS || '').split(',').map(value => value.trim()).filter(Boolean),
)
const database = mysqlDatabase()
const service = createBannerService(createBannerRepository(database), createContentSafety(cloud))

function contextOptions() {
  return { allowedAppIds, pepper: process.env.MIP_IDENTITY_PEPPER }
}

exports.main = createHandler({
  service,
  async health() {
    await database.one('SELECT 1 AS ok')
    return { service: 'mip-banners-api', persistence: 'cloudbase-mysql' }
  },
  resolveAppId() {
    return trustedWechatContext(cloud.getWXContext(), contextOptions()).appId
  },
  async resolveCaller() {
    const identity = trustedWechatIdentity(cloud.getWXContext(), contextOptions())
    return resolveCaller(database, identity)
  },
  assertAdminReady: caller => assertFullAccessReady(database, caller, configuredAgreements()),
})
