'use strict'

const cloud = require('wx-server-sdk')
const { createHandler } = require('./domain/handler')
const { configuredAgreements } = require('./domain/full-access')
const { createAdminRepository } = require('./domain/repository')
const { createAdminService } = require('./domain/service')
const { resolveTrustedIdentity } = require('./lib/identity')
const { mysqlDatabase } = require('./lib/mysql')
const { createRefundWorkerClient } = require('./lib/refund-worker-client')
const { createCloudExportStorage } = require('./lib/export-storage')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const allowedAppIds = new Set(
  String(process.env.MIP_ALLOWED_APP_IDS || '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean),
)

async function contentSafety(draft, caller) {
  const checker = cloud.openapi?.security?.msgSecCheck
  const content = [draft.title, draft.summary, draft.body, draft.description, draft.notices]
    .filter(value => typeof value === 'string' && value.trim())
    .join('\n')
    .slice(0, 4000)
  if (!content || typeof checker !== 'function') return 'ERROR'
  try {
    const result = await checker({ content, version: 2, scene: 2, openid: caller.openId })
    const errorCode = Number(result?.errCode ?? result?.errcode)
    return errorCode === 0 && result?.result?.suggest === 'pass' ? 'PASSED' : 'REJECTED'
  }
  catch {
    return 'ERROR'
  }
}

const repository = createAdminRepository(mysqlDatabase(), {
  agreements: configuredAgreements(),
})
const exportStorage = createCloudExportStorage(cloud)
let initializedRefundWorkerClient
function dispatchRefund(input) {
  initializedRefundWorkerClient ||= createRefundWorkerClient({
    cloud,
    functionName: process.env.MIP_REFUND_FUNCTION_NAME || 'mip-refund-worker',
    secret: process.env.MIP_REFUND_WORKER_HMAC_SECRET || '',
  })
  return initializedRefundWorkerClient.dispatchRefund(input)
}
function dispatchRefunds(input) {
  initializedRefundWorkerClient ||= createRefundWorkerClient({
    cloud,
    functionName: process.env.MIP_REFUND_FUNCTION_NAME || 'mip-refund-worker',
    secret: process.env.MIP_REFUND_WORKER_HMAC_SECRET || '',
  })
  return initializedRefundWorkerClient.dispatchRefunds(input)
}
const service = createAdminService({
  repository,
  phoneEncryptionKey: process.env.MIP_PHONE_ENCRYPTION_KEY,
  contentSafety,
  dispatchRefund,
  dispatchRefunds,
  exportStorage,
  exportMaxRows: boundedInteger(process.env.MIP_EXPORT_MAX_ROWS, 5_000, 100, 20_000),
  exportMaxBytes: boundedInteger(process.env.MIP_EXPORT_MAX_BYTES, 8 * 1024 * 1024, 1_048_576, 10_485_760),
})

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number(value || fallback)
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback
}

exports.main = createHandler({
  service,
  getContext: () => cloud.getWXContext(),
  resolveCaller: context => resolveTrustedIdentity(context, {
    allowedAppIds,
    pepper: process.env.MIP_IDENTITY_PEPPER,
  }),
})

exports._test = { configuredAgreements, contentSafety, resolveTrustedIdentity }
