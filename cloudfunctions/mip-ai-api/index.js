'use strict'

const cloud = require('wx-server-sdk')
const { createHandler } = require('./domain/handler')
const { createAiRepository } = require('./domain/repository')
const { createAiService } = require('./domain/service')
const { resolveMipUser, trustedWechatIdentity } = require('./lib/identity')
const { mysqlDatabase } = require('./lib/mysql')
const { createCloudAiProvider } = require('./lib/provider')
const { createAudioStore } = require('./lib/audio-store')
const { verifyMaintenanceRequest } = require('./lib/internal-auth')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const allowedAppIds = new Set(
  String(process.env.MIP_ALLOWED_APP_IDS || '').split(',').map(value => value.trim()).filter(Boolean),
)
const database = mysqlDatabase()
const service = createAiService({
  repository: createAiRepository(database, {
    draftTtlHours: process.env.MIP_AI_DRAFT_TTL_HOURS || 72,
  }),
  provider: createCloudAiProvider(
    cloud,
    process.env.MIP_AI_PROVIDER_FUNCTION_NAME,
    process.env.MIP_AI_HMAC_SECRET,
  ),
  audioStore: createAudioStore(cloud, {
    storageKey: process.env.MIP_AI_STORAGE_KEY,
    stage: process.env.MIP_DEPLOYMENT_STAGE,
  }),
})

exports.main = createHandler({
  service,
  verifyMaintenance(event) {
    return verifyMaintenanceRequest(event, {
      allowedAppIds,
      secret: process.env.MIP_AI_HMAC_SECRET,
    })
  },
  async health() {
    await database.one('SELECT 1 AS ok')
    return { service: 'mip-ai-api', persistence: 'cloudbase-mysql' }
  },
  async resolveCaller() {
    const identity = trustedWechatIdentity(cloud.getWXContext(), {
      allowedAppIds,
      pepper: process.env.MIP_IDENTITY_PEPPER,
    })
    return resolveMipUser(database, identity)
  },
})
