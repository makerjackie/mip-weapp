'use strict'

const cloud = require('wx-server-sdk')
const { createHandler } = require('./domain/handler')
const { createNotificationsRepository } = require('./domain/repository')
const { createNotificationsService } = require('./domain/service')
const { resolveMipUser, trustedWechatIdentity } = require('./lib/identity')
const { mysqlDatabase } = require('./lib/mysql')
const { parseTemplateConfig } = require('./lib/templates')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const allowedAppIds = new Set(
  String(process.env.MIP_ALLOWED_APP_IDS || '').split(',').map(value => value.trim()).filter(Boolean),
)
const database = mysqlDatabase()
const service = createNotificationsService({
  repository: createNotificationsRepository(database),
  encryptionKey: process.env.MIP_NOTIFICATION_ENCRYPTION_KEY,
  templates: parseTemplateConfig(process.env.MIP_SUBSCRIBE_TEMPLATES_JSON || ''),
  customerServiceEnabled: process.env.MIP_CUSTOMER_SERVICE_ENABLED === 'true',
})

exports.main = createHandler({
  service,
  async health() {
    await database.one('SELECT 1 AS ok')
    return { service: 'mip-notifications-api', persistence: 'cloudbase-mysql' }
  },
  async resolveCaller() {
    const identity = trustedWechatIdentity(cloud.getWXContext(), {
      allowedAppIds,
      pepper: process.env.MIP_IDENTITY_PEPPER,
    })
    return resolveMipUser(database, identity)
  },
})
