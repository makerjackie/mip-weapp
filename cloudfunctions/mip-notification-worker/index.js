'use strict'

const cloud = require('wx-server-sdk')
const { createHandler } = require('./domain/handler')
const { createNotificationRepository } = require('./domain/repository')
const { createNotificationService } = require('./domain/service')
const { verifyInternalEvent } = require('./lib/internal-auth')
const {
  createServiceAccountSender,
  parseServiceAccountConfig,
} = require('./lib/channel-adapters')
const { mysqlDatabase } = require('./lib/mysql')
const { parseTemplateConfig } = require('./lib/templates')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const allowedAppIds = new Set(
  String(process.env.MIP_ALLOWED_APP_IDS || '').split(',').map(value => value.trim()).filter(Boolean),
)
const database = mysqlDatabase()
const serviceAccountConfig = parseServiceAccountConfig(
  process.env.MIP_SERVICE_ACCOUNT_ADAPTER_JSON || '',
)
const senders = {
  async WECHAT_SUBSCRIPTION(request) {
    const result = await cloud.openapi.subscribeMessage.send(request)
    assertWechatSuccess(result)
  },
}
const customerServiceEnabled = process.env.MIP_CUSTOMER_SERVICE_ENABLED === 'true'
if (customerServiceEnabled) {
  senders.WECHAT_CUSTOMER_SERVICE = async (request) => {
    const result = await cloud.openapi.customerServiceMessage.send(request)
    assertWechatSuccess(result)
  }
}
if (serviceAccountConfig) {
  senders.WECHAT_SERVICE_ACCOUNT = createServiceAccountSender({
    config: serviceAccountConfig,
    secret: process.env.MIP_SERVICE_ACCOUNT_ADAPTER_SECRET,
  })
}
const service = createNotificationService({
  repository: createNotificationRepository(database),
  encryptionKey: process.env.MIP_NOTIFICATION_ENCRYPTION_KEY,
  templates: parseTemplateConfig(process.env.MIP_SUBSCRIBE_TEMPLATES_JSON || ''),
  customerServiceEnabled,
  serviceAccountConfig,
  miniprogramState: process.env.MIP_MINIPROGRAM_STATE || 'trial',
  senders,
})

function assertWechatSuccess(result) {
  const errorCode = Number(result?.errCode ?? result?.errcode ?? 0)
  if (errorCode !== 0) throw new Error('WECHAT_DELIVERY_FAILED')
}

exports.main = createHandler({
  service,
  async health() {
    await database.one('SELECT 1 AS ok')
    return { service: 'mip-notification-worker', persistence: 'cloudbase-mysql' }
  },
  verifyInternal: event => verifyInternalEvent(event, {
    secret: process.env.MIP_NOTIFICATION_HMAC_SECRET,
    allowedAppIds,
  }),
})
