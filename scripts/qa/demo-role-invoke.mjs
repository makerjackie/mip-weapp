import { createRequire } from 'node:module'
/** LOCAL QA ONLY. Never import from src or cloudfunctions. No real WeChat impersonation. */
import path from 'node:path'
import { loadCaseEnv } from '../lib/example-cloudbase.mjs'
import { demoUserId, requireTestEnvironment } from './demo-role-policy.mjs'
import { createReadOnlyDatabase } from './read-only-database.mjs'

const require = createRequire(import.meta.url)
const root = path.resolve(import.meta.dirname, '../..')
const env = loadCaseEnv(root)
requireTestEnvironment(env)
const { db: liveDb } = createReadOnlyDatabase(root)
const { createCommerceRepository } = require('../../cloudfunctions/mip-commerce-api/domain/repository.js')
const { createCommerceService } = require('../../cloudfunctions/mip-commerce-api/domain/service.js')
const events = require('../../cloudfunctions/mip-events-api/domain/event-service.js')
const { createGrowthRepository } = require('../../cloudfunctions/mip-growth-api/domain/repository.js')
const { createGrowthService } = require('../../cloudfunctions/mip-growth-api/domain/service.js')
const { createIdentityRepository } = require('../../cloudfunctions/mip-identity-api/domain/repository.js')
const { createIdentityService } = require('../../cloudfunctions/mip-identity-api/domain/service.js')
const cases = require('../../cloudfunctions/mip-opportunities-api/domain/cases.js')
const cooperation = require('../../cloudfunctions/mip-opportunities-api/domain/cooperation.js')
const discovery = require('../../cloudfunctions/mip-opportunities-api/domain/discovery.js')
const journey = require('../../cloudfunctions/mip-opportunities-api/domain/journey-access.js')
const opportunities = require('../../cloudfunctions/mip-opportunities-api/domain/opportunities.js')
const influence = require('../../cloudfunctions/mip-opportunities-api/domain/profile-influence.js')
const interactions = require('../../cloudfunctions/mip-opportunities-api/domain/received-interactions.js')

const secret = 'local-role-qa-signatures-only-20260926'
const profileRefs = require('../../cloudfunctions/mip-identity-api/lib/profile-ref.js')

export async function invoke({ name, data = {} }, role = 'member') {
  if (data.contractVersion === 1 && data.input && typeof data.input === 'object') {
    data = { ...data, ...data.input, action: data.action }
  }
  const userId = demoUserId(role)
  // Guest is explicitly derived from attended demo-3 with membership removed in memory.
  const db = { ...liveDb, async query(sql, values) {
    if (role === 'guest' && /^\s*SELECT\s+(?:id|status\s*,\s*starts_at\s*,\s*ends_at)\s+FROM\s+mip_membership_entitlements\b/i.test(sql)) {
      return []
    }
    // Public review screenshots must contain only seeded demo visitors.
    sql = sql.replace('WHERE visit.app_id = ? AND visit.profile_user_id = ?', 'WHERE visit.app_id = ? AND visit.profile_user_id = ? AND visit.visitor_user_id LIKE \'50000000-0000-4000-8000-00000000000_\'')
    if (data.action === 'listPublicProfileInterests') {
      sql = sql.replace('interest.app_id = ? AND interest.target_user_id = ? AND interest.status = \'ACTIVE\'', 'interest.app_id = ? AND interest.target_user_id = ? AND interest.status = \'ACTIVE\' AND actor.id LIKE \'50000000-0000-4000-8000-00000000000_\'')
    }
    return liveDb.query(sql, values)
  } }
  const caller = { appId: env.MINI_PROGRAM_APP_ID, userId, profileRefSecret: secret, tokenSecret: secret }
  const action = data.action
  if (name === 'mip-identity-api') {
    const allowed = ['getAccessSnapshot', 'getProfile', 'getPublicProfile', 'listBranches', 'listProfileTags', 'getMembershipAgreement', 'getProfileCardSettings']
    if (!allowed.includes(action)) {
      throw new Error(`QA_UNSUPPORTED_ACTION:${name}:${action}`)
    }
    const repository = createIdentityRepository(db)
    const user = userId ? await db.one('SELECT id, status, primary_branch_id, version FROM mip_users WHERE app_id = ? AND id = ?', [caller.appId, userId]) : null
    const service = createIdentityService({ repository: { ...repository, findUserByIdentity: async () => user, ensureUser: async () => {
      if (!user) {
        throw new Error('AUTH_REQUIRED')
      }
      return user
    } }, profileRefReader: (ref, appId) => profileRefs.readProfileRef(ref, appId, secret), profileRefWriter: ({ appId, userId }) => profileRefs.createProfileRef({ appId, userId }, secret) })
    const result = await service[action](caller, data)
    if (action === 'getAccessSnapshot' && result.authenticated) {
      // Explicitly simulated onboarding readiness
      // These accounts have no WeChat binding.
      result.phoneBound = true
      result.agreements = result.agreements.map(item => ({ ...item, accepted: true }))
      if (role === 'new-user') {
        result.profile = newUserProfile(result.profile)
        result.primaryBranchId = undefined
      }
    }
    if (action === 'getProfile' && role === 'new-user') {
      return newUserProfile(result)
    }
    if (action === 'getAccessSnapshot' && role === 'renewal') {
      result.membership.entitlement.endsAt = new Date(Date.now() + 86400000).toISOString()
    }
    return result
  }
  if (name === 'mip-notifications-api' && ['markAllRead', 'markRead'].includes(action)) {
    const { markDemoNotificationsRead } = await import('./demo-notification-read.mjs')
    const result = markDemoNotificationsRead(userId, action === 'markRead' ? data.messageId : undefined)
    liveDb.clearCache()
    return result
  }
  if (name === 'mip-notifications-api' && action === 'listInbox') {
    const { createNotificationsRepository } = require('../../cloudfunctions/mip-notifications-api/domain/repository.js')
    const { createNotificationsService } = require('../../cloudfunctions/mip-notifications-api/domain/service.js')
    return createNotificationsService({ repository: createNotificationsRepository(db) }).listInbox(caller, data)
  }
  if (name === 'mip-community-api' && action === 'listAnnouncements') {
    const { createCommunityService } = require('../../cloudfunctions/mip-community-api/domain/service.js')
    return createCommunityService(db, { readProfileRef: profileRefs.readProfileRef, createProfileRef: profileRefs.createProfileRef, profileRefSecret: secret, catalogStage: 'TEST' }).listAnnouncements(caller, data)
  }
  if (name === 'mip-banners-api' && action === 'mip.banners.listActive') {
    const { createBannerRepository } = require('../../cloudfunctions/mip-banners-api/domain/repository.js')
    const { createBannerService } = require('../../cloudfunctions/mip-banners-api/domain/service.js')
    return createBannerService(createBannerRepository(db)).listActive(caller.appId)
  }
  if (name === 'mip-commerce-api') {
    // Local adapter only: map the already selected demo actor, without storing any WeChat identity.
    const identityKey = `qa-local-${userId || 'visitor'}`
    const commerceDb = {
      ...db,
      async query(sql, values) {
        if (/FROM mip_user_identities i\b/.test(sql)) {
          if (!userId) {
            throw new Error('AUTH_REQUIRED')
          }
          const mapped = sql.replace('FROM mip_user_identities i', 'FROM (SELECT app_id, id AS user_id, \'WECHAT_MINIPROGRAM\' AS provider, ? AS identity_key FROM mip_users WHERE id = ?) i')
          return db.query(mapped, [identityKey, userId, ...values])
        }
        return db.query(sql, values)
      },
      async one(sql, values) {
        if (/SELECT user_id\s+FROM mip_user_identities\b/.test(sql)) {
          if (!userId) {
            throw new Error('AUTH_REQUIRED')
          }
          return { user_id: userId }
        }
        return (await this.query(sql, values))[0] || null
      },
    }
    const service = createCommerceService({ repository: createCommerceRepository(commerceDb), catalogStage: 'TEST', paymentMode: 'test' })
    const method = action?.replace(/^mip\.commerce\./, '')
    if (!['listPlans', 'getMembershipBenefits', 'listMyOrders', 'getOrder'].includes(method)) {
      throw new Error(`QA_UNSUPPORTED_ACTION:${name}:${action}`)
    }
    const result = await service[method]({ ...caller, identityKey }, data)
    if (role === 'renewal' && method === 'getMembershipBenefits' && result.status === 'ACTIVE') {
      // Same explicit local expiry projection as getAccessSnapshot; persisted entitlement is unchanged.
      const endsAt = new Date(Date.now() + 86400000).toISOString()
      return { ...result, endsAt, membershipEndsAt: endsAt }
    }
    return result
  }
  if (name === 'mip-events-api') {
    const actions = { 'mip.events.list': 'listEvents', 'mip.events.discoveryFilters': 'getEventDiscoveryFilters', 'mip.events.detail': 'getEvent', 'mip.events.publicParticipants': 'listPublicParticipants', 'mip.events.mine': 'listMyRegistrations', 'mip.events.myRegistration': 'getMyRegistration', 'mip.events.feedback': 'getFeedback', 'mip.events.heartCandidates': 'listHeartCandidates', 'mip.events.heart': 'getHeart', 'mip.events.hearts.mine': 'listHeartHistory' }
    const method = actions[action]
    if (!method) {
      throw new Error(`QA_UNSUPPORTED_ACTION:${name}:${action}`)
    }
    return events[method](db, { ...data, ...caller, query: data.query || {} })
  }
  if (name === 'mip-opportunities-api' && action === 'markReceivedInteractionRead' && data.category === 'VISITOR') {
    const { markDemoVisitorRead } = await import('./demo-notification-read.mjs')
    const result = markDemoVisitorRead(userId)
    liveDb.clearCache()
    return result
  }
  if (name === 'mip-opportunities-api') {
    const catalog = { ...opportunities, ...cooperation, ...cases, ...influence, ...discovery, ...interactions, getProfileInfluence: influence.getOwnProfileInfluence }
    const allowed = ['listMySuperCases', 'listSuperCases', 'getSuperCase', 'getCatalogs', 'listOpportunities', 'getOpportunity', 'listMine', 'listMyCooperations', 'listCooperationCards', 'listCooperationTalents', 'listMyCooperationCards', 'getCooperationCard', 'getProfileInfluence', 'listPublicProfileInterests', 'listReceivedInteractions', 'listPeople', 'getPublicProfileAggregate']
    if (!allowed.includes(action)) {
      throw new Error(`QA_UNSUPPORTED_ACTION:${name}:${action}`)
    }
    if (action === 'listOpportunities' && !(await journey.canBrowsePlatformOpportunities(db, caller))) {
      return { items: [] }
    }
    if (['listCooperationCards', 'listCooperationTalents'].includes(action) && !(await journey.canBrowseTalents(db, caller))) {
      return { items: [] }
    }
    const input = ['listOpportunities', 'listCooperationCards', 'listCooperationTalents', 'listPeople'].includes(action) ? data.filter : ['getOpportunity', 'getCooperationCard', 'getSuperCase'].includes(action) ? data.id : data
    return catalog[action](db, caller, input)
  }
  if (name === 'mip-tasks-api') {
    const { createTaskRepository } = require('../../cloudfunctions/mip-tasks-api/domain/repository.js')
    const { createTaskService } = require('../../cloudfunctions/mip-tasks-api/domain/service.js')
    const methods = { 'mip.tasks.list': 'listTasks', 'mip.tasks.detail': 'getTask', 'listTasks': 'listTasks', 'getTask': 'getTask' }
    const method = methods[action]
    if (!method) {
      throw new Error(`QA_UNSUPPORTED_ACTION:${name}:${action}`)
    }
    return createTaskService(createTaskRepository(db))[method](caller, data)
  }
  if (name === 'mip-growth-api') {
    if (!['getSnapshot', 'listEntries', 'listBadgeCollection'].includes(action)) {
      throw new Error(`QA_UNSUPPORTED_ACTION:${name}:${action}`)
    }
    const growthDb = { ...db, async query(sql, values) {
      // The production read initializes a missing account. QA refuses creation and requires it exists.
      const initializingTable = sql.match(/^\s*INSERT INTO (mip_growth_accounts|mip_user_badge_profiles)\b/)?.[1]
      if (initializingTable) {
        const existing = await db.one(`SELECT user_id FROM ${initializingTable} WHERE app_id = ? AND user_id = ?`, values)
        if (!existing && initializingTable === 'mip_growth_accounts') {
          throw new Error('QA_GROWTH_ACCOUNT_MISSING')
        }
        // Missing badge profile is read as the production DTO default version 1
        // No award is simulated.
        return { affectedRows: 0 }
      }
      return db.query(sql, values)
    } }
    return createGrowthService(createGrowthRepository(growthDb))[action](caller, data)
  }
  throw new Error(`QA_UNSUPPORTED_ACTION:${name}:${action}`)
}

function newUserProfile(profile) {
  return {
    ...profile,
    exists: false,
    version: 0,
    nickname: '',
    realName: '',
    identityStatus: '',
    headline: '',
    introduction: '',
    companies: [],
    organizations: [],
    avatarBound: false,
    avatarAssetId: undefined,
    avatarUrl: undefined,
    abilityTagIds: [],
    primaryIndustryTagId: undefined,
    complete: false,
    missingFields: ['NICKNAME', 'PRIMARY_BRANCH'],
  }
}
