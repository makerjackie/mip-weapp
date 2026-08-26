'use strict'

const cloud = require('wx-server-sdk')
const { createHandler } = require('./domain/handler')
const { createAiRepository } = require('./domain/repository')
const { createAiService } = require('./domain/service')
const { resolveMipUser, trustedWechatIdentity } = require('./lib/identity')
const { mysqlDatabase } = require('./lib/mysql')
const { createAiProviderAdapter } = require('./lib/provider')
const { createAudioStore } = require('./lib/audio-store')
const { createAvatarStore } = require('./lib/avatar-store')
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
  provider: createAiProviderAdapter({
    cloud,
    adapter: process.env.MIP_AI_PROVIDER_ADAPTER,
    functionName: process.env.MIP_AI_PROVIDER_FUNCTION_NAME,
    avatarFunctionName: process.env.MIP_AI_AVATAR_PROVIDER_FUNCTION_NAME,
    secret: process.env.MIP_AI_DRAFT_PROVIDER_HMAC_SECRET,
    avatarSecret: process.env.MIP_AI_AVATAR_PROVIDER_HMAC_SECRET,
    avatarTimeoutMs: process.env.MIP_AI_AVATAR_PROVIDER_TIMEOUT_MS,
    timeoutMs: process.env.MIP_AI_PROVIDER_TIMEOUT_MS,
  }),
  audioStore: createAudioStore(cloud, {
    storageKey: process.env.MIP_AI_STORAGE_KEY,
    stage: process.env.MIP_DEPLOYMENT_STAGE,
  }),
  avatarStore: createAvatarStore(cloud, {
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
