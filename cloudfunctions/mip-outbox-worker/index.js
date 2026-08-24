'use strict'

const cloud = require('wx-server-sdk')
const { createHandler } = require('./domain/handler')
const { projectEvent } = require('./domain/projector')
const { createOutboxRepository } = require('./domain/repository')
const { createOutboxService } = require('./domain/service')
const { createInternalClients } = require('./lib/internal-clients')
const { verifyInternalEvent } = require('./lib/internal-auth')
const { mysqlDatabase } = require('./lib/mysql')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const allowedAppIds = new Set(
  String(process.env.MIP_ALLOWED_APP_IDS || '').split(',').map(value => value.trim()).filter(Boolean),
)
const database = mysqlDatabase()
const repository = createOutboxRepository(database)
const clients = createInternalClients({
  cloud,
  notificationFunctionName: process.env.MIP_NOTIFICATION_FUNCTION_NAME || 'mip-notification-worker',
  notificationSecret: process.env.MIP_NOTIFICATION_HMAC_SECRET,
  growthFunctionName: process.env.MIP_GROWTH_FUNCTION_NAME || 'mip-growth-api',
  growthSecret: process.env.MIP_GROWTH_HMAC_SECRET,
})
const service = createOutboxService({
  repository,
  clients,
  projectEvent: event => projectEvent(database, event),
})

exports.main = createHandler({
  service,
  async health() {
    await database.one('SELECT 1 AS ok')
    return {
      service: 'mip-outbox-worker',
      persistence: 'cloudbase-mysql',
      triggerMode: 'controlled-invocation',
    }
  },
  verifyInternal: event => verifyInternalEvent(event, {
    secret: process.env.MIP_OUTBOX_HMAC_SECRET,
    allowedAppIds,
  }),
})
