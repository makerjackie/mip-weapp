'use strict'

const cloud = require('wx-server-sdk')
const { createHandler } = require('./domain/handler')
const { createIdentityRepository } = require('./domain/repository')
const { createIdentityService } = require('./domain/service')
const { resolveTrustedIdentity } = require('./lib/identity')
const { mysqlDatabase } = require('./lib/mysql')
const { createOutboxWakeup, trustedContextAppId } = require('./lib/outbox-wakeup')
const { protectPhone } = require('./lib/private-data')
const { createProfileRef, readProfileRef } = require('./lib/profile-ref')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const allowedAppIds = new Set(
  String(process.env.MIP_ALLOWED_APP_IDS || '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean),
)
const outboxMutationActions = new Set([
  'acceptAgreements',
  'bindWechatPhone',
  'closeAccount',
  'setPrimaryBranch',
  'updateProfile',
])
const outboxWakeup = createOutboxWakeup({
  cloud,
  functionName: process.env.MIP_OUTBOX_FUNCTION_NAME,
  secret: process.env.MIP_OUTBOX_HMAC_SECRET,
  sourceFunctionName: 'mip-identity-api',
  logger: console,
})

function configuredAgreements() {
  const source = String(process.env.MIP_AGREEMENTS_JSON || '').trim()
  if (!source) {
    return undefined
  }
  const parsed = JSON.parse(source)
  if (!Array.isArray(parsed) || parsed.length < 1 || parsed.length > 5) {
    throw new Error('AGREEMENT_CONFIG_INVALID')
  }
  return parsed.map((agreement) => {
    if (!agreement
      || typeof agreement.key !== 'string'
      || !/^[A-Z][A-Z0-9_]{2,63}$/.test(agreement.key)
      || typeof agreement.label !== 'string'
      || typeof agreement.version !== 'string'
      || typeof agreement.documentPath !== 'string'
      || !/^\/[A-Za-z0-9_/-]+$/.test(agreement.documentPath)) {
      throw new Error('AGREEMENT_CONFIG_INVALID')
    }
    return {
      key: agreement.key,
      label: agreement.label.slice(0, 40),
      version: agreement.version.slice(0, 32),
      documentPath: agreement.documentPath,
    }
  })
}

const repository = createIdentityRepository(mysqlDatabase(), {
  allowUnionRebind: process.env.MIP_UNION_ID_REBIND_ENABLED === 'true',
})
const service = createIdentityService({
  repository,
  agreements: configuredAgreements(),
  async phoneResolver(code) {
    const result = await cloud.openapi.phonenumber.getPhoneNumber({ code })
    const phoneInfo = result?.phoneInfo || result?.phone_info
    if (!phoneInfo) {
      throw new Error('PHONE_BIND_FAILED')
    }
    return phoneInfo
  },
  protectPhone(phoneInfo, context) {
    return protectPhone(phoneInfo, process.env.MIP_PHONE_ENCRYPTION_KEY, context)
  },
  profileRefReader(profileRef, appId) {
    return readProfileRef(profileRef, appId, process.env.MIP_IDENTITY_PEPPER)
  },
  profileRefWriter(input) {
    return createProfileRef(input, process.env.MIP_IDENTITY_PEPPER)
  },
})

const handler = createHandler({
  getContext: () => cloud.getWXContext(),
  resolveCaller: context => resolveTrustedIdentity(context, {
    allowedAppIds,
    pepper: process.env.MIP_IDENTITY_PEPPER,
    unionPepper: process.env.MIP_UNION_IDENTITY_PEPPER,
  }),
  service,
})

exports.main = async (event = {}) => {
  if (event.action === 'health') {
    await mysqlDatabase().one('SELECT 1 AS ok')
    return { ok: true, data: { service: 'mip-identity-api', persistence: 'cloudbase-mysql' } }
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
exports._test = {
  configuredAgreements,
  outboxMutationActions,
  resolveTrustedIdentity,
}
