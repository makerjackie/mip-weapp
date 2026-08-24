'use strict'

const cloud = require('wx-server-sdk')
const { createHandler } = require('./domain/handler')
const { configuredAgreements } = require('./domain/full-access')
const { createCommerceRepository } = require('./domain/repository')
const { createCommerceService } = require('./domain/service')
const { resolveTrustedIdentity } = require('./lib/identity')
const { createMembershipInvitationCode } = require('./lib/membership-invitation-code')
const { mysqlDatabase } = require('./lib/mysql')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const allowedAppIds = new Set(
  String(process.env.MIP_ALLOWED_APP_IDS || '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean),
)
const catalogStage = process.env.MIP_CATALOG_STAGE === 'LIVE' ? 'LIVE' : 'TEST'
const repository = createCommerceRepository(mysqlDatabase(), {
  agreements: configuredAgreements(),
})
const service = createCommerceService({
  repository,
  catalogStage,
  invitationSecret: process.env.MIP_IDENTITY_PEPPER,
  createInvitationCode: input => createMembershipInvitationCode({ ...input, cloud }),
})

const handler = createHandler({
  getContext: () => cloud.getWXContext(),
  resolveCaller: context => resolveTrustedIdentity(context, {
    allowedAppIds,
    pepper: process.env.MIP_IDENTITY_PEPPER,
  }),
  service,
})

exports.main = async (event = {}) => {
  if (event.action === 'health') {
    await mysqlDatabase().one('SELECT 1 AS ok')
    return { ok: true, data: { service: 'mip-commerce-api', persistence: 'cloudbase-mysql' } }
  }
  return handler(event)
}

exports._test = { catalogStage, configuredAgreements, resolveTrustedIdentity }
