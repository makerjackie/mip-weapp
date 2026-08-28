#!/usr/bin/env node

import { Buffer } from 'node:buffer'
import { createHash, createHmac } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import {
  bindAndRequireMysqlEnvironment,
  callCloudbase,
  loadCaseEnv,
  sqlJson,
  sqlLiteral,
} from './lib/example-cloudbase.mjs'
import {
  assertSeedSqlScope,
  buildSeedCollisionQuery,
  buildSeedOwnershipQuery,
  seedOwnershipConflictCount,
} from './lib/mip-seed-safety.mjs'

const root = path.resolve(import.meta.dirname, '..')
const env = loadCaseEnv(root)
const envId = String(env.CLOUDBASE_ENV_ID || '').trim()
const validateOnly = process.argv.includes('--validate-only')
const reuseExistingMedia = process.argv.includes('--reuse-existing-media')
const configuredAppId = String(env.MINI_PROGRAM_APP_ID || '').trim()
const appId = validateOnly && !/^wx[0-9a-f]{16}$/i.test(configuredAppId)
  ? ['wx', '0000000000000000'].join('')
  : configuredAppId
const stage = String(env.MIP_DEPLOYMENT_STAGE || '').trim().toLowerCase()
const catalogStage = String(env.MIP_CATALOG_STAGE || 'TEST').trim().toUpperCase()
const confirmedEnv = process.argv.find(value => value.startsWith('--confirm-env='))?.slice('--confirm-env='.length)

if (!validateOnly) {
  if (!process.argv.includes('--confirm-demo') || !envId || confirmedEnv !== envId) {
    throw new Error('MIP demo seed requires --confirm-demo and --confirm-env=<exact CLOUDBASE_ENV_ID>')
  }
  if (!/^wx[0-9a-f]{16}$/i.test(appId)) {
    throw new Error('MINI_PROGRAM_APP_ID is invalid')
  }
  if (!['development', 'test'].includes(stage) || catalogStage !== 'TEST') {
    throw new Error('MIP demo seed is restricted to development/test with MIP_CATALOG_STAGE=TEST')
  }
  if (String(env.MIP_PAYMENT_MODE || 'disabled').trim().toLowerCase() === 'live') {
    throw new Error('MIP demo seed cannot run while live payment is enabled')
  }
}

const seedPath = path.join(root, 'database', 'mysql', 'mip', 'seed.demo.json')
const seedSource = fs.readFileSync(seedPath, 'utf8')
const seed = JSON.parse(seedSource)
const seedSha256 = createHash('sha256').update(seedSource).digest('hex')
assertSeed(seed)
const opportunityInteractions = seed.opportunityInteractions

if (validateOnly) {
  seed.mediaAssets = resolveDemoMediaAssets(seed.mediaAssets, {
    appId,
    bucket: 'demo-bucket',
    envId: 'demo-env',
    scopeSecret: 'demo-media-scope-secret-000000000000',
    stage: 'test',
  })
  const statements = buildSeedStatements()
  const statementBytes = statements.map(statement => Buffer.byteLength(statement, 'utf8'))
  const scope = assertSeedSqlScope([
    buildSeedOwnershipQuery(appId, seed),
    buildSeedCollisionQuery(appId, seed),
    ...statements,
  ])
  console.log(JSON.stringify({
    valid: true,
    seedVersion: seed.version,
    fixtureGroups: Object.keys(seed).filter(key => Array.isArray(seed[key])).length,
    statementCount: scope.statementCount,
    tableCount: scope.tables.length,
    firstStatementBytes: statementBytes[0],
    maxStatementBytes: Math.max(...statementBytes),
  }))
  process.exit(0)
}

const { environment } = bindAndRequireMysqlEnvironment(root, envId, { development: true, stage })
seed.mediaAssets = resolveDemoMediaAssets(seed.mediaAssets, {
  appId,
  bucket: findStorageBucket(environment),
  envId,
  scopeSecret: String(env.MIP_MEDIA_SCOPE_SECRET || ''),
  stage,
})
assertTablesExist([
  'mip_city_branches',
  'mip_tags',
  'mip_membership_plans',
  'mip_growth_levels',
  'mip_growth_rules',
  'mip_badges',
  'mip_users',
  'mip_media_assets',
  'mip_membership_chains',
  'mip_branch_memberships',
  'mip_profiles',
  'mip_profile_tags',
  'mip_growth_accounts',
  'mip_orders',
  'mip_event_seat_holds',
  'mip_membership_entitlements',
  'mip_event_types',
  'mip_event_tags',
  'mip_event_tag_assignments',
  'mip_events',
  'mip_event_registrations',
  'mip_event_invitation_attributions',
  'mip_event_checkins',
  'mip_event_checkin_transitions',
  'mip_event_hearts',
  'mip_profile_visits',
  'mip_opportunities',
  'mip_opportunity_roles',
  'mip_opportunity_tags',
  'mip_opportunity_team_members',
  'mip_referral_intents',
  'mip_profile_interests',
  'mip_opportunity_comment_settings',
  'mip_opportunity_comments',
  'mip_opportunity_comment_calls',
  'mip_opportunity_comment_reports',
  'mip_user_blocks',
  'mip_user_opportunity_preferences',
  'mip_matching_settings',
  'mip_matching_requests',
  'mip_matching_results',
  'mip_matching_feedback',
  'mip_cooperation_cards',
  'mip_super_cases',
  'mip_announcements',
  'mip_knowledge_sources',
  'mip_knowledge_categories',
  'mip_knowledge_contents',
  'mip_knowledge_products',
  'mip_inbox_messages',
  'mip_delivery_tasks',
  'mip_message_templates',
  'mip_message_template_revisions',
  'mip_message_campaigns',
  'mip_task_cards',
  'mip_task_assignments',
  'mip_task_completions',
  'mip_user_badges',
  'mip_user_badge_profiles',
  'mip_user_badge_equipment',
  'mip_growth_entries',
  'mip_game_seasons',
  'mip_game_teams',
  'mip_game_team_memberships',
  'mip_game_weekly_matches',
  'mip_game_ranking_snapshots',
  'mip_game_ranking_entries',
  'mip_blind_box_catalogs',
  'mip_blind_box_cards',
  'mip_app_settings',
])

const ownershipProbe = callCloudbase(root, 'queryMysqlDatabase', {
  action: 'runQuery',
  sql: buildSeedOwnershipQuery(appId, seed),
})
const ownershipConflicts = seedOwnershipConflictCount(ownershipProbe)
if (ownershipConflicts === null) {
  throw new Error('MIP demo seed ownership preflight could not be verified')
}
if (ownershipConflicts > 0) {
  throw new Error('MIP demo seed IDs already belong to another AppID; no seed writes were attempted')
}
const collisionProbe = callCloudbase(root, 'queryMysqlDatabase', {
  action: 'runQuery',
  sql: buildSeedCollisionQuery(appId, seed),
})
const sameAppCollisions = seedOwnershipConflictCount(collisionProbe)
if (sameAppCollisions === null) {
  throw new Error('MIP demo seed same-AppID collision preflight could not be verified')
}
if (sameAppCollisions > 0) {
  throw new Error('MIP demo seed conflicts with records outside the demo manifest; no seed writes were attempted')
}

const mediaUploadSummary = reuseExistingMedia
  ? verifyExistingDemoMediaAssets(seed.mediaAssets)
  : uploadDemoMediaAssets(seed.mediaAssets)
const statements = buildSeedStatements()
assertSeedSqlScope(statements)

for (const [index, sql] of statements.entries()) {
  try {
    const result = callCloudbase(root, 'manageMysqlDatabase', {
      action: 'runStatement',
      sql,
    }, 300000)
    if (result?.success === false) {
      throw new Error('management API reported failure')
    }
  }
  catch (error) {
    throw new Error(`MIP demo seed step ${index + 1}/${statements.length} did not converge: ${error instanceof Error ? error.message : String(error)}`)
  }
}

const verification = callCloudbase(root, 'queryMysqlDatabase', {
  action: 'runQuery',
  sql: `SELECT
    (SELECT COUNT(*) FROM mip_city_branches
      WHERE app_id = ${sqlLiteral(appId)}
        AND branch_key IN (${seed.branches.map(item => sqlLiteral(item.key)).join(', ')})) AS branches,
    (SELECT COUNT(*) FROM mip_tags
      WHERE app_id = ${sqlLiteral(appId)}
        AND CONCAT(kind, ':', tag_key) IN (${seed.tags.map(item => sqlLiteral(`${item.kind}:${item.key}`)).join(', ')})) AS tags,
    (SELECT COUNT(*) FROM mip_membership_plans
      WHERE app_id = ${sqlLiteral(appId)} AND catalog_stage = 'TEST'
        AND plan_key IN (${seed.membershipPlans.map(item => sqlLiteral(item.key)).join(', ')})) AS plans,
    (SELECT COUNT(*) FROM mip_growth_levels
      WHERE app_id = ${sqlLiteral(appId)}
        AND level_key IN (${seed.growthLevels.map(item => sqlLiteral(item.key)).join(', ')})) AS levels,
    (SELECT COUNT(*) FROM mip_growth_rules
      WHERE app_id = ${sqlLiteral(appId)}
        AND rule_key IN (${seed.growthRules.map(item => sqlLiteral(item.key)).join(', ')})) AS rules,
    (SELECT COUNT(*) FROM mip_badges
      WHERE app_id = ${sqlLiteral(appId)}
        AND badge_key IN (${seed.badges.map(item => sqlLiteral(item.key)).join(', ')})) AS badges,
    (SELECT COUNT(*) FROM mip_users
      WHERE app_id = ${sqlLiteral(appId)}
        AND id IN (${seed.users.map(item => sqlLiteral(item.id)).join(', ')})) AS users,
    (SELECT COUNT(*) FROM mip_media_assets
      WHERE app_id = ${sqlLiteral(appId)}
        AND (${seed.mediaAssets.map(item => `(
          id = ${sqlLiteral(item.id)} AND owner_user_id = ${sqlLiteral(item.ownerUserId)}
          AND purpose = ${sqlLiteral(item.purpose)} AND object_key = ${sqlLiteral(item.objectKey)}
          AND cloud_file_id = ${sqlLiteral(item.cloudFileId)}
          AND content_sha256 = ${sqlLiteral(item.contentSha256)}
          AND content_type = ${sqlLiteral(item.contentType)}
          AND content_bytes = ${Number(item.contentBytes)}
          AND width_px = ${Number(item.width)} AND height_px = ${Number(item.height)}
          AND status = 'READY'
        )`).join(' OR ')})) AS mediaAssets,
    (SELECT COUNT(*) FROM mip_profiles
      WHERE app_id = ${sqlLiteral(appId)}
        AND (${seed.users.map(item => `(
          user_id = ${sqlLiteral(item.id)} AND avatar_asset_id = ${sqlLiteral(item.avatarAssetId)}
        )`).join(' OR ')})) AS profilesWithAvatars,
    (SELECT COUNT(*) FROM mip_membership_chains
      WHERE app_id = ${sqlLiteral(appId)}
        AND user_id IN (${seed.users.map(item => sqlLiteral(item.id)).join(', ')})) AS membershipChains,
    (SELECT COUNT(*) FROM mip_orders
      WHERE app_id = ${sqlLiteral(appId)}
        AND id IN (${seed.membershipOrders.map(item => sqlLiteral(item.id)).join(', ')})) AS membershipOrders,
    (SELECT COUNT(*) FROM mip_orders
      WHERE app_id = ${sqlLiteral(appId)}
        AND id IN (${seed.eventOrders.map(item => sqlLiteral(item.id)).join(', ')})) AS eventOrders,
    (SELECT COUNT(*) FROM mip_membership_entitlements
      WHERE app_id = ${sqlLiteral(appId)}
        AND id IN (${seed.entitlements.map(item => sqlLiteral(item.id)).join(', ')})) AS entitlements,
    (SELECT COUNT(*) FROM mip_event_types
      WHERE app_id = ${sqlLiteral(appId)}
        AND type_key IN (${demoEventTypes(seed.events).map(item => sqlLiteral(item.key)).join(', ')})) AS eventTypes,
    (SELECT COUNT(*) FROM mip_event_tags
      WHERE app_id = ${sqlLiteral(appId)}
        AND (${seed.eventTags.map(item => `(
          id = ${sqlLiteral(item.id)} AND tag_key = ${sqlLiteral(item.key)}
          AND name = ${sqlLiteral(item.name)} AND description = ${sqlLiteral(item.description)}
          AND sort_order = ${Number(item.sortOrder)} AND status = 'ACTIVE'
          AND created_by_user_id = ${sqlLiteral(item.actorUserId)}
          AND updated_by_user_id = ${sqlLiteral(item.actorUserId)} AND archived_at IS NULL
        )`).join(' OR ')})) AS eventTags,
    (SELECT COUNT(*) FROM mip_event_tag_assignments
      WHERE app_id = ${sqlLiteral(appId)}
        AND (${demoEventTagAssignments(seed.events).map(item => `(
          event_id = ${sqlLiteral(item.eventId)} AND tag_id = ${sqlLiteral(item.tagId)}
          AND status = 'ACTIVE' AND assigned_by_user_id = ${sqlLiteral(item.actorUserId)}
          AND removed_by_user_id IS NULL AND removed_at IS NULL
        )`).join(' OR ')})) AS eventTagAssignments,
    (SELECT COUNT(*) FROM mip_events
      WHERE app_id = ${sqlLiteral(appId)}
        AND id IN (${seed.events.map(item => sqlLiteral(item.id)).join(', ')})) AS events,
    (SELECT COUNT(*) FROM mip_events
      WHERE app_id = ${sqlLiteral(appId)}
        AND (${seed.events.filter(item => item.coverAssetId).map(item => `(
          id = ${sqlLiteral(item.id)} AND cover_asset_id = ${sqlLiteral(item.coverAssetId)}
        )`).join(' OR ')})) AS eventsWithCovers,
    (SELECT COUNT(*) FROM mip_events
      WHERE app_id = ${sqlLiteral(appId)}
        AND (${seed.events.map(item => `(
          id = ${sqlLiteral(item.id)} AND status = ${sqlLiteral(item.status)}
          AND starts_at = ${sqlLiteral(item.startsAt)} AND ends_at = ${sqlLiteral(item.endsAt)}
          AND published_at = ${sqlLiteral(item.publishedAt)}
          AND ${item.endedAt ? `ended_at = ${sqlLiteral(item.endedAt)}` : 'ended_at IS NULL'}
        )`).join(' OR ')})) AS eventTimelineSettings,
    (SELECT COUNT(*) FROM mip_events
      WHERE app_id = ${sqlLiteral(appId)}
        AND (${seed.events.map(item => `(id = ${sqlLiteral(item.id)} AND album_enabled = ${item.albumEnabled ? 1 : 0} AND album_submission_policy = ${sqlLiteral(item.albumSubmissionPolicy)})`).join(' OR ')})) AS eventAlbumSettings,
    (SELECT COUNT(*) FROM mip_events
      WHERE app_id = ${sqlLiteral(appId)}
        AND id IN (${seed.events.filter(item => item.albumEnabled).map(item => sqlLiteral(item.id)).join(', ')})
        AND status = 'PUBLISHED' AND album_enabled = 1
        AND starts_at >= '2030-01-01 00:00:00.000'
        AND starts_at < '2031-01-01 00:00:00.000') AS eventAlbumRuntimeFixtures,
    (SELECT COUNT(*) FROM mip_event_registrations
      WHERE app_id = ${sqlLiteral(appId)}
        AND id IN (${seed.eventRegistrations.map(item => sqlLiteral(item.id)).join(', ')})) AS eventRegistrations,
    (SELECT COUNT(*) FROM mip_event_registrations
      WHERE app_id = ${sqlLiteral(appId)}
        AND (${seed.eventRegistrations.map(item => `(
          id = ${sqlLiteral(item.id)}
          AND event_id = ${sqlLiteral(item.eventId)} AND user_id = ${sqlLiteral(item.userId)}
          AND status = ${sqlLiteral(demoRegistrationStatus(item))}
          AND registered_at = ${sqlLiteral(demoRegistrationTime(item))}
          AND version = ${demoRegistrationVersion(item)}
        )`).join(' OR ')})) AS eventRegistrationStates,
    (SELECT COUNT(*) FROM mip_task_completions
      WHERE app_id = ${sqlLiteral(appId)}
        AND id IN (${seed.taskCompletions.map(item => sqlLiteral(item.id)).join(', ')})) AS taskCompletions,
    (SELECT COUNT(*) FROM mip_user_badges
      WHERE app_id = ${sqlLiteral(appId)}
        AND id IN (${seed.badgeAwards.map(item => sqlLiteral(item.id)).join(', ')})) AS badgeAwards,
    (SELECT COUNT(*) FROM mip_user_badge_profiles
      WHERE app_id = ${sqlLiteral(appId)}
        AND user_id IN (${seed.badgeProfiles.map(item => sqlLiteral(item.userId)).join(', ')})) AS badgeProfiles,
    (SELECT COUNT(*) FROM mip_user_badge_equipment
      WHERE app_id = ${sqlLiteral(appId)}
        AND user_id IN (${seed.badgeEquipment.map(item => sqlLiteral(item.userId)).join(', ')})) AS badgeEquipment,
    (SELECT COUNT(*) FROM mip_event_checkins
      WHERE app_id = ${sqlLiteral(appId)}
        AND (${seed.eventCheckins.map(item => `(
          id = ${sqlLiteral(item.id)}
          AND event_id = ${sqlLiteral(item.eventId)}
          AND registration_id = ${sqlLiteral(item.registrationId)}
          AND user_id = ${sqlLiteral(item.userId)}
          AND credential_id IS NULL
          AND source = ${sqlLiteral(item.source)}
          AND status = ${sqlLiteral(item.status)}
          AND checked_in_at = ${sqlLiteral(item.checkedInAt)}
          AND revoked_at IS NULL AND revoked_by_user_id IS NULL AND revoke_reason IS NULL
          AND version = ${Number(item.version)}
        )`).join(' OR ')})) AS eventCheckins,
    (SELECT COUNT(*) FROM mip_event_checkin_transitions
      WHERE app_id = ${sqlLiteral(appId)}
        AND (${seed.eventCheckinTransitions.map(item => `(
          id = ${sqlLiteral(item.id)}
          AND checkin_id = ${sqlLiteral(item.checkinId)}
          AND registration_id = ${sqlLiteral(item.registrationId)}
          AND event_id = ${sqlLiteral(item.eventId)}
          AND user_id = ${sqlLiteral(item.userId)}
          AND transition_type = ${sqlLiteral(item.transitionType)}
          AND checkin_version = ${Number(item.checkinVersion)}
          AND registration_version = ${Number(item.registrationVersion)}
          AND reversal_of_transition_id IS NULL
          AND actor_user_id = ${sqlLiteral(item.actorUserId)}
          AND source = ${sqlLiteral(item.source)} AND revoke_reason IS NULL
          AND occurred_at = ${sqlLiteral(item.occurredAt)}
        )`).join(' OR ')})) AS eventCheckinTransitions,
    (SELECT COUNT(*) FROM mip_event_invitation_attributions
      WHERE app_id = ${sqlLiteral(appId)}
        AND (${seed.userInfluence.eventInvitationAttributions.map(item => `(
          registration_id = ${sqlLiteral(item.registrationId)}
          AND event_id = ${sqlLiteral(item.eventId)}
          AND guest_user_id = ${sqlLiteral(item.guestUserId)}
          AND source_type = ${sqlLiteral(item.sourceType)}
          AND inviter_user_id = ${sqlLiteral(item.inviterUserId)}
          AND captured_at = ${sqlLiteral(item.capturedAt)}
        )`).join(' OR ')})) AS eventInvitationAttributions,
    (SELECT COUNT(*) FROM mip_event_hearts
      WHERE app_id = ${sqlLiteral(appId)}
        AND (${seed.userInfluence.eventHearts.map(item => `(
          id = ${sqlLiteral(item.id)}
          AND event_id = ${sqlLiteral(item.eventId)}
          AND voter_user_id = ${sqlLiteral(item.voterUserId)}
          AND target_user_id = ${sqlLiteral(item.targetUserId)}
          AND status = ${sqlLiteral(item.status)}
          AND version = 1
          AND cancelled_at IS NULL
          AND created_at = ${sqlLiteral(item.occurredAt)}
          AND updated_at = ${sqlLiteral(item.occurredAt)}
        )`).join(' OR ')})) AS eventHearts,
    (SELECT COUNT(*) FROM mip_profile_visits
      WHERE app_id = ${sqlLiteral(appId)}
        AND (${seed.userInfluence.profileVisits.map(item => `(
          id = ${sqlLiteral(item.id)}
          AND visitor_user_id = ${sqlLiteral(item.visitorUserId)}
          AND profile_user_id = ${sqlLiteral(item.profileUserId)}
          AND visit_key = ${sqlLiteral(item.visitKey)}
          AND visited_at = ${sqlLiteral(item.visitedAt)}
          AND ${item.readAt ? `read_at = ${sqlLiteral(item.readAt)}` : 'read_at IS NULL'}
        )`).join(' OR ')})) AS profileVisits,
    (SELECT COUNT(*) FROM mip_opportunities
      WHERE app_id = ${sqlLiteral(appId)}
        AND id IN (${seed.opportunities.map(item => sqlLiteral(item.id)).join(', ')})) AS opportunities,
    (SELECT COUNT(*) FROM mip_opportunity_team_members
      WHERE app_id = ${sqlLiteral(appId)}
        AND id IN (${seed.opportunityTeamMembers.map(item => sqlLiteral(item.id)).join(', ')})) AS opportunityTeamMembers,
    (SELECT COUNT(*) FROM mip_referral_intents
      WHERE app_id = ${sqlLiteral(appId)}
        AND id IN (${seed.referralIntents.map(item => sqlLiteral(item.id)).join(', ')})) AS referralIntents,
    (SELECT COUNT(*) FROM mip_profile_interests
      WHERE app_id = ${sqlLiteral(appId)}
        AND id IN (${seed.profileInterests.map(item => sqlLiteral(item.id)).join(', ')})) AS profileInterests,
    (SELECT COUNT(*) FROM mip_opportunity_comment_settings
      WHERE app_id = ${sqlLiteral(appId)}
        AND opportunity_id IN (${opportunityInteractions.commentSettings.map(item => sqlLiteral(item.opportunityId)).join(', ')})) AS opportunityCommentSettings,
    (SELECT COUNT(*) FROM mip_opportunity_comments
      WHERE app_id = ${sqlLiteral(appId)}
        AND id IN (${seed.opportunityComments.map(item => sqlLiteral(item.id)).join(', ')})) AS opportunityComments,
    (SELECT COUNT(*) FROM mip_opportunity_comment_calls
      WHERE app_id = ${sqlLiteral(appId)}
        AND (${opportunityInteractions.commentCalls.map(item => `(comment_id = ${sqlLiteral(item.commentId)} AND actor_user_id = ${sqlLiteral(item.actorUserId)})`).join(' OR ')})) AS opportunityCommentCalls,
    (SELECT COUNT(*) FROM mip_opportunity_comment_reports
      WHERE app_id = ${sqlLiteral(appId)}
        AND id IN (${seed.opportunityCommentReports.map(item => sqlLiteral(item.id)).join(', ')})) AS opportunityCommentReports,
    (SELECT COUNT(*) FROM mip_user_blocks
      WHERE app_id = ${sqlLiteral(appId)}
        AND (${opportunityInteractions.userBlocks.map(item => `(blocker_user_id = ${sqlLiteral(item.blockerUserId)} AND blocked_user_id = ${sqlLiteral(item.blockedUserId)})`).join(' OR ')})) AS userBlocks,
    (SELECT COUNT(*) FROM mip_user_opportunity_preferences
      WHERE app_id = ${sqlLiteral(appId)}
        AND user_id IN (${opportunityInteractions.userOpportunityPreferences.map(item => sqlLiteral(item.userId)).join(', ')})) AS userOpportunityPreferences,
    (SELECT COUNT(*) FROM mip_matching_settings
      WHERE app_id = ${sqlLiteral(appId)}
        AND scope_key IN (${opportunityInteractions.matchingSettings.map(item => sqlLiteral(item.scopeKey)).join(', ')})) AS matchingSettings,
    (SELECT COUNT(*) FROM mip_matching_requests
      WHERE app_id = ${sqlLiteral(appId)}
        AND id IN (${seed.matchingRequests.map(item => sqlLiteral(item.id)).join(', ')})) AS matchingRequests,
    (SELECT COUNT(*) FROM mip_matching_results
      WHERE app_id = ${sqlLiteral(appId)}
        AND (${opportunityInteractions.matchingResults.map(item => `(request_id = ${sqlLiteral(item.requestId)} AND result_version = ${Number(item.resultVersion)} AND candidate_type = ${sqlLiteral(item.candidateType)} AND candidate_id = ${sqlLiteral(item.candidateId)})`).join(' OR ')})) AS matchingResults,
    (SELECT COUNT(*) FROM mip_matching_feedback
      WHERE app_id = ${sqlLiteral(appId)}
        AND id IN (${seed.matchingFeedback.map(item => sqlLiteral(item.id)).join(', ')})) AS matchingFeedback,
    (SELECT COUNT(*) FROM mip_opportunities opportunity
      WHERE opportunity.app_id = ${sqlLiteral(appId)}
        AND opportunity.id IN (${seed.opportunities.map(item => sqlLiteral(item.id)).join(', ')})
        AND opportunity.referral_count = (
          SELECT COUNT(*) FROM mip_referral_intents referral
          WHERE referral.app_id = opportunity.app_id
            AND referral.opportunity_id = opportunity.id AND referral.status = 'ACTIVE'
        )) AS opportunityReferralCountsSynced,
    (SELECT COUNT(*) FROM mip_opportunity_comments comment
      WHERE comment.app_id = ${sqlLiteral(appId)}
        AND comment.id IN (${seed.opportunityComments.map(item => sqlLiteral(item.id)).join(', ')})
        AND comment.call_count = (
          SELECT COUNT(*) FROM mip_opportunity_comment_calls comment_call
          WHERE comment_call.app_id = comment.app_id
            AND comment_call.comment_id = comment.id AND comment_call.status = 'ACTIVE'
        )) AS opportunityCommentCallCountsSynced,
    (SELECT COUNT(*) FROM mip_cooperation_cards
      WHERE app_id = ${sqlLiteral(appId)}
        AND id IN (${seed.cooperationCards.map(item => sqlLiteral(item.id)).join(', ')})) AS cooperationCards,
    (SELECT COUNT(*) FROM mip_super_cases
      WHERE app_id = ${sqlLiteral(appId)}
        AND id IN (${seed.superCases.map(item => sqlLiteral(item.id)).join(', ')})) AS superCases,
    (SELECT COUNT(*) FROM mip_announcements
      WHERE app_id = ${sqlLiteral(appId)}
        AND id IN (${seed.announcements.map(item => sqlLiteral(item.id)).join(', ')})) AS announcements,
    (SELECT COUNT(*) FROM mip_knowledge_sources
      WHERE app_id = ${sqlLiteral(appId)}
        AND id IN (${seed.knowledgeSources.map(item => sqlLiteral(item.id)).join(', ')})) AS knowledgeSources,
    (SELECT COUNT(*) FROM mip_knowledge_categories
      WHERE app_id = ${sqlLiteral(appId)}
        AND id IN (${seed.knowledgeCategories.map(item => sqlLiteral(item.id)).join(', ')})) AS knowledgeCategories,
    (SELECT COUNT(*) FROM mip_knowledge_contents
      WHERE app_id = ${sqlLiteral(appId)}
        AND id IN (${seed.knowledgeContents.map(item => sqlLiteral(item.id)).join(', ')})) AS knowledgeContents,
    (SELECT COUNT(*) FROM mip_knowledge_products
      WHERE app_id = ${sqlLiteral(appId)}
        AND id IN (${seed.knowledgeProducts.map(item => sqlLiteral(item.id)).join(', ')})) AS knowledgeProducts,
    (SELECT COUNT(*) FROM mip_inbox_messages
      WHERE app_id = ${sqlLiteral(appId)}
        AND id IN (${seed.inboxMessages.map(item => sqlLiteral(item.id)).join(', ')})) AS inboxMessages,
    (SELECT COUNT(*) FROM mip_delivery_tasks
      WHERE app_id = ${sqlLiteral(appId)}
        AND id IN (${seed.deliveryTasks.map(item => sqlLiteral(item.id)).join(', ')})) AS deliveryTasks,
    (SELECT COUNT(*) FROM mip_message_templates
      WHERE app_id = ${sqlLiteral(appId)}
        AND id IN (${seed.messageTemplates.map(item => sqlLiteral(item.id)).join(', ')})) AS messageTemplates,
    (SELECT COUNT(*) FROM mip_message_template_revisions
      WHERE app_id = ${sqlLiteral(appId)}
        AND template_id IN (${seed.messageTemplates.map(item => sqlLiteral(item.id)).join(', ')})) AS messageTemplateRevisions,
    (SELECT COUNT(*) FROM mip_message_campaigns
      WHERE app_id = ${sqlLiteral(appId)}
        AND id IN (${seed.messageCampaigns.map(item => sqlLiteral(item.id)).join(', ')})) AS messageCampaigns,
    (SELECT COUNT(*) FROM mip_task_cards
      WHERE app_id = ${sqlLiteral(appId)}
        AND id IN (${seed.tasks.map(item => sqlLiteral(item.id)).join(', ')})) AS tasks,
    (SELECT COUNT(*) FROM mip_task_assignments
      WHERE app_id = ${sqlLiteral(appId)}
        AND id IN (${seed.taskAssignments.map(item => sqlLiteral(item.id)).join(', ')})) AS taskAssignments,
    (SELECT COUNT(*) FROM mip_growth_entries
      WHERE app_id = ${sqlLiteral(appId)}
        AND id IN (${seed.growthEntries.map(item => sqlLiteral(item.id)).join(', ')})) AS growthEntries,
    (SELECT COUNT(*) FROM mip_game_seasons
      WHERE app_id = ${sqlLiteral(appId)}
        AND id IN (${seed.gameSeasons.map(item => sqlLiteral(item.id)).join(', ')})) AS gameSeasons,
    (SELECT COUNT(*) FROM mip_game_teams
      WHERE app_id = ${sqlLiteral(appId)}
        AND id IN (${seed.gameTeams.map(item => sqlLiteral(item.id)).join(', ')})) AS gameTeams,
    (SELECT COUNT(*) FROM mip_game_team_memberships
      WHERE app_id = ${sqlLiteral(appId)}
        AND id IN (${seed.gameTeamMemberships.map(item => sqlLiteral(item.id)).join(', ')})) AS gameTeamMemberships,
    (SELECT COUNT(*) FROM mip_game_weekly_matches
      WHERE app_id = ${sqlLiteral(appId)}
        AND id IN (${seed.gameWeeklyMatches.map(item => sqlLiteral(item.id)).join(', ')})) AS gameWeeklyMatches,
    (SELECT COUNT(*) FROM mip_game_ranking_snapshots
      WHERE app_id = ${sqlLiteral(appId)}
        AND id IN (${seed.gameRankingSnapshots.map(item => sqlLiteral(item.id)).join(', ')})) AS gameRankingSnapshots,
    (SELECT COUNT(*) FROM mip_game_ranking_entries
      WHERE app_id = ${sqlLiteral(appId)}
        AND snapshot_id IN (${seed.gameRankingSnapshots.map(item => sqlLiteral(item.id)).join(', ')})) AS gameRankingEntries,
    (SELECT COUNT(*) FROM mip_blind_box_catalogs
      WHERE app_id = ${sqlLiteral(appId)}
        AND id IN (${seed.blindBoxCatalogs.map(item => sqlLiteral(item.id)).join(', ')})) AS blindBoxCatalogs,
    (SELECT COUNT(*) FROM mip_blind_box_cards
      WHERE app_id = ${sqlLiteral(appId)}
        AND id IN (${seed.blindBoxCards.map(item => sqlLiteral(item.id)).join(', ')})) AS blindBoxCards`,
})
const expected = {
  branches: seed.branches.length,
  tags: seed.tags.length,
  plans: seed.membershipPlans.length,
  levels: seed.growthLevels.length,
  rules: seed.growthRules.length,
  badges: seed.badges.length,
  users: seed.users.length,
  mediaAssets: seed.mediaAssets.length,
  profilesWithAvatars: seed.users.length,
  membershipChains: seed.users.length,
  membershipOrders: seed.membershipOrders.length,
  eventOrders: seed.eventOrders.length,
  entitlements: seed.entitlements.length,
  eventTypes: demoEventTypes(seed.events).length,
  eventTags: seed.eventTags.length,
  eventTagAssignments: demoEventTagAssignments(seed.events).length,
  events: seed.events.length,
  eventsWithCovers: seed.events.filter(item => item.coverAssetId).length,
  eventTimelineSettings: seed.events.length,
  eventAlbumSettings: seed.events.length,
  eventAlbumRuntimeFixtures: seed.events.filter(item => item.albumEnabled).length,
  eventRegistrations: seed.eventRegistrations.length,
  eventRegistrationStates: seed.eventRegistrations.length,
  taskCompletions: seed.taskCompletions.length,
  badgeAwards: seed.badgeAwards.length,
  badgeProfiles: seed.badgeProfiles.length,
  badgeEquipment: seed.badgeEquipment.length,
  eventCheckins: seed.eventCheckins.length,
  eventCheckinTransitions: seed.eventCheckinTransitions.length,
  eventInvitationAttributions: seed.userInfluence.eventInvitationAttributions.length,
  eventHearts: seed.userInfluence.eventHearts.length,
  profileVisits: seed.userInfluence.profileVisits.length,
  opportunities: seed.opportunities.length,
  opportunityTeamMembers: seed.opportunityTeamMembers.length,
  referralIntents: seed.referralIntents.length,
  profileInterests: seed.profileInterests.length,
  opportunityCommentSettings: opportunityInteractions.commentSettings.length,
  opportunityComments: seed.opportunityComments.length,
  opportunityCommentCalls: opportunityInteractions.commentCalls.length,
  opportunityCommentReports: seed.opportunityCommentReports.length,
  userBlocks: opportunityInteractions.userBlocks.length,
  userOpportunityPreferences: opportunityInteractions.userOpportunityPreferences.length,
  matchingSettings: opportunityInteractions.matchingSettings.length,
  matchingRequests: seed.matchingRequests.length,
  matchingResults: opportunityInteractions.matchingResults.length,
  matchingFeedback: seed.matchingFeedback.length,
  opportunityReferralCountsSynced: seed.opportunities.length,
  opportunityCommentCallCountsSynced: seed.opportunityComments.length,
  cooperationCards: seed.cooperationCards.length,
  superCases: seed.superCases.length,
  announcements: seed.announcements.length,
  knowledgeSources: seed.knowledgeSources.length,
  knowledgeCategories: seed.knowledgeCategories.length,
  knowledgeContents: seed.knowledgeContents.length,
  knowledgeProducts: seed.knowledgeProducts.length,
  inboxMessages: seed.inboxMessages.length,
  deliveryTasks: seed.deliveryTasks.length,
  messageTemplates: seed.messageTemplates.length,
  messageTemplateRevisions: seed.messageTemplates.length,
  messageCampaigns: seed.messageCampaigns.length,
  tasks: seed.tasks.length,
  taskAssignments: seed.taskAssignments.length,
  growthEntries: seed.growthEntries.length,
  gameSeasons: seed.gameSeasons.length,
  gameTeams: seed.gameTeams.length,
  gameTeamMemberships: seed.gameTeamMemberships.length,
  gameWeeklyMatches: seed.gameWeeklyMatches.length,
  gameRankingSnapshots: seed.gameRankingSnapshots.length,
  gameRankingEntries: seed.gameRankingSnapshots.reduce((count, item) => count + item.entries.length, 0),
  blindBoxCatalogs: seed.blindBoxCatalogs.length,
  blindBoxCards: seed.blindBoxCards.length,
}
const counts = findCountRow(verification, Object.keys(expected))
if (!counts || Object.entries(expected).some(([key, value]) => Number(counts[key]) !== value)) {
  throw new Error('MIP demo catalog verification failed')
}

fs.mkdirSync(path.join(root, '.tmp'), { recursive: true })
fs.writeFileSync(path.join(root, '.tmp', 'seed-demo-result.json'), `${JSON.stringify({
  environmentVerified: true,
  catalogStage: 'TEST',
  seedVersion: seed.version,
  replaceBeforeProduction: true,
  recordsVerified: expected,
  mediaObjects: mediaUploadSummary,
  seededAt: new Date().toISOString(),
}, null, 2)}\n`)
console.log('[mip-seed] placeholder catalogs and fixed-ID demo fixtures verified; no environment or AppID was persisted')

function resolveDemoMediaAssets(items, runtime) {
  const { appId: runtimeAppId, bucket, envId: runtimeEnvId, scopeSecret, stage: runtimeStage } = runtime
  if (!/^wx[0-9a-f]{16}$/i.test(runtimeAppId)
    || !/^[\w-]{3,80}$/.test(runtimeEnvId)
    || !/^[a-z0-9.-]{3,128}$/i.test(bucket)
    || !['development', 'test'].includes(runtimeStage)
    || typeof scopeSecret !== 'string' || scopeSecret.length < 32) {
    throw new Error('Demo media runtime configuration is invalid')
  }
  const assetRoot = path.join(root, 'database', 'mysql', 'mip', 'demo-assets')
  const appScope = mediaObjectScope(scopeSecret, runtimeAppId)
  return items.map((item) => {
    const localPath = path.resolve(root, item.sourcePath)
    if (!localPath.startsWith(`${assetRoot}${path.sep}`) || item.extension !== 'jpg') {
      throw new Error('Demo media source path is invalid')
    }
    const stat = fs.statSync(localPath)
    if (!stat.isFile() || stat.size <= 0 || stat.size > 1024 * 1024) {
      throw new Error('Demo media source file is invalid')
    }
    const content = fs.readFileSync(localPath)
    const dimensions = inspectDemoJpeg(content)
    if (dimensions.width !== item.width || dimensions.height !== item.height) {
      throw new Error('Demo media source dimensions do not match the fixture')
    }
    const directory = item.purpose === 'AVATAR' ? 'avatars' : 'event-covers'
    const userScope = mediaObjectScope(scopeSecret, `${runtimeAppId}\0${item.ownerUserId}`)
    const objectKey = `mip/${runtimeStage}/${appScope}/${directory}/${userScope}/${item.id}.jpg`
    const cloudFileId = `cloud://${runtimeEnvId}.${bucket}/${objectKey}`
    return {
      ...item,
      localPath,
      objectKey,
      cloudFileId,
      contentBytes: stat.size,
      contentSha256: createHash('sha256').update(content).digest('hex'),
      contentMd5: createHash('md5').update(content).digest('hex'),
      contentType: 'image/jpeg',
    }
  })
}

function mediaObjectScope(secret, value) {
  return createHmac('sha256', secret).update(value).digest('hex').slice(0, 24)
}

function inspectDemoJpeg(buffer) {
  if (buffer.length < 4 || buffer[0] !== 0xFF || buffer[1] !== 0xD8) {
    throw new Error('Demo media source must be a JPEG image')
  }
  const sofMarkers = new Set([0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF])
  let offset = 2
  while (offset + 3 < buffer.length) {
    if (buffer[offset] !== 0xFF) {
      offset += 1
      continue
    }
    while (buffer[offset] === 0xFF) {
      offset += 1
    }
    const marker = buffer[offset]
    offset += 1
    if (marker === 0xD9 || marker === 0xDA) {
      break
    }
    if (marker === 0x00 || marker === 0x01 || (marker >= 0xD0 && marker <= 0xD7)) {
      continue
    }
    if (offset + 2 > buffer.length) {
      break
    }
    const length = buffer.readUInt16BE(offset)
    if (length < 2 || offset + length > buffer.length) {
      break
    }
    if (sofMarkers.has(marker) && length >= 7) {
      return {
        height: buffer.readUInt16BE(offset + 3),
        width: buffer.readUInt16BE(offset + 5),
      }
    }
    offset += length
  }
  throw new Error('Demo media JPEG dimensions could not be read')
}

function findStorageBucket(value) {
  if (!value || typeof value !== 'object') {
    return ''
  }
  if (Array.isArray(value.Storages) && typeof value.Storages[0]?.Bucket === 'string') {
    return value.Storages[0].Bucket.trim()
  }
  for (const child of Object.values(value)) {
    const bucket = findStorageBucket(child)
    if (bucket) {
      return bucket
    }
  }
  return ''
}

function uploadDemoMediaAssets(items) {
  let uploaded = 0
  let reused = 0
  for (const item of items) {
    if (demoStorageObjectMatches(item)) {
      reused += 1
      continue
    }
    const result = callCloudbase(root, 'manageStorage', {
      action: 'upload',
      localPath: item.localPath,
      cloudPath: item.objectKey,
    }, 300000)
    if (result?.success !== true || !demoStorageObjectMatches(item)) {
      throw new Error(`Demo media upload did not converge for ${item.key}`)
    }
    uploaded += 1
  }
  return { uploaded, reused, total: items.length }
}

function verifyExistingDemoMediaAssets(items) {
  const exactAssets = items.map(item => `(
    id = ${sqlLiteral(item.id)}
    AND owner_user_id = ${sqlLiteral(item.ownerUserId)}
    AND purpose = ${sqlLiteral(item.purpose)}
    AND object_key = ${sqlLiteral(item.objectKey)}
    AND cloud_file_id = ${sqlLiteral(item.cloudFileId)}
    AND content_sha256 = ${sqlLiteral(item.contentSha256)}
    AND content_type = ${sqlLiteral(item.contentType)}
    AND content_bytes = ${Number(item.contentBytes)}
    AND width_px = ${Number(item.width)}
    AND height_px = ${Number(item.height)}
    AND status = 'READY'
  )`).join(' OR ')
  const verification = callCloudbase(root, 'queryMysqlDatabase', {
    action: 'runQuery',
    sql: `SELECT
      (SELECT COUNT(*) FROM mip_app_settings
        WHERE app_id = ${sqlLiteral(appId)}
          AND setting_key = 'demo_seed_manifest'
          AND JSON_EXTRACT(value_json, '$.is_demo') = 1
          AND JSON_UNQUOTE(JSON_EXTRACT(value_json, '$.state')) = 'READY') AS readyManifest,
      (SELECT COUNT(*) FROM mip_media_assets
        WHERE app_id = ${sqlLiteral(appId)}
          AND (${exactAssets})) AS readyMedia`,
  })
  const counts = findCountRow(verification, ['readyManifest', 'readyMedia'])
  if (!counts || Number(counts.readyManifest) !== 1 || Number(counts.readyMedia) !== items.length) {
    throw new Error('Existing demo media cannot be reused without one READY manifest and exact READY database facts')
  }
  return { uploaded: 0, reused: items.length, total: items.length }
}

function demoStorageObjectMatches(item) {
  const response = callCloudbase(root, 'queryStorage', {
    action: 'info',
    cloudPath: item.objectKey,
  })
  const fileInfo = findStorageFileInfo(response)
  if (!fileInfo) {
    return false
  }
  const etag = String(fileInfo.ETag || fileInfo.etag || '').replaceAll('"', '').toLowerCase()
  const remoteSize = Number(fileInfo.Size ?? fileInfo.size)
  const sizeMatches = remoteSize === item.contentBytes
    || remoteSize === Number((item.contentBytes / 1024).toFixed(2))
  return sizeMatches && etag === item.contentMd5
}

function findStorageFileInfo(value) {
  if (!value || typeof value !== 'object') {
    return null
  }
  if (!Array.isArray(value)
    && ('Size' in value || 'size' in value)
    && ('ETag' in value || 'etag' in value)) {
    return value
  }
  for (const child of Object.values(value)) {
    const found = findStorageFileInfo(child)
    if (found) {
      return found
    }
  }
  return null
}

function buildSeedStatements() {
  return [
    ...demoManifestStatements(seed, 'PENDING'),
    branchStatement(seed.branches),
    ...tagStatements(seed.tags),
    membershipPlanStatement(seed.membershipPlans),
    growthLevelStatement(seed.growthLevels),
    growthRuleStatement(seed.growthRules),
    badgeStatement(seed.badges),
    userStatement(seed.users),
    membershipChainStatement(seed.users),
    mediaAssetStatement(seed.mediaAssets),
    branchMembershipResetStatement(seed.users),
    branchMembershipStatement(seed.users),
    userPrimaryBranchStatement(seed.users),
    profileStatement(seed.users),
    profileTagResetStatement(seed.users),
    profileTagStatement(seed.users),
    growthAccountStatement(seed.users),
    growthEntryStatement(seed.growthEntries),
    membershipOrderStatement(seed.membershipOrders, seed.membershipPlans),
    eventOrderStatement(seed.eventOrders, seed.events),
    entitlementStatement(seed.entitlements, seed.membershipPlans),
    eventTypeStatement(seed.events),
    eventStatement(seed.events),
    eventTagStatement(seed.eventTags),
    eventTagAssignmentStatement(seed.events),
    eventRegistrationStatement(seed.eventRegistrations),
    eventInvitationAttributionStatement(seed.userInfluence.eventInvitationAttributions),
    eventCheckinStatement(seed.eventCheckins),
    eventCheckinTransitionStatement(seed.eventCheckinTransitions),
    eventHeartStatement(seed.userInfluence.eventHearts),
    profileVisitStatement(seed.userInfluence.profileVisits),
    opportunityStatement(seed.opportunities, seed.referralIntents),
    opportunityRoleResetStatement(seed.opportunities),
    opportunityRoleStatement(seed.opportunities),
    opportunityTagResetStatement(seed.opportunities),
    opportunityTagStatement(seed.opportunities, seed.tags),
    opportunityTeamMemberStatement(seed.opportunityTeamMembers),
    referralIntentStatement(seed.referralIntents),
    opportunityReferralCountStatement(seed.opportunities),
    profileInterestStatement(seed.profileInterests),
    cooperationCardStatement(seed.cooperationCards),
    superCaseStatement(seed.superCases),
    opportunityCommentSettingsStatement(opportunityInteractions.commentSettings),
    opportunityCommentStatement(seed.opportunityComments, opportunityInteractions.commentCalls),
    opportunityCommentCallStatement(opportunityInteractions.commentCalls),
    opportunityCommentCallCountStatement(seed.opportunityComments),
    opportunityCommentReportStatement(seed.opportunityCommentReports),
    userBlockStatement(opportunityInteractions.userBlocks),
    userOpportunityPreferenceStatement(opportunityInteractions.userOpportunityPreferences),
    matchingSettingStatement(opportunityInteractions.matchingSettings),
    matchingRequestStatement(seed.matchingRequests, opportunityInteractions.matchingResults),
    matchingResultStatement(opportunityInteractions.matchingResults),
    matchingFeedbackStatement(seed.matchingFeedback),
    announcementStatement(seed.announcements),
    knowledgeSourceStatement(seed.knowledgeSources),
    knowledgeCategoryStatement(seed.knowledgeCategories),
    knowledgeContentStatement(seed.knowledgeContents),
    knowledgeProductStatement(seed.knowledgeProducts),
    inboxMessageStatement(seed.inboxMessages),
    deliveryTaskStatement(seed.deliveryTasks),
    messageTemplateStatement(seed.messageTemplates),
    messageTemplateRevisionStatement(seed.messageTemplates),
    messageCampaignStatement(seed.messageCampaigns),
    taskStatement(seed.tasks),
    taskAssignmentStatement(seed.taskAssignments),
    taskCompletionStatement(seed.taskCompletions, seed.tasks),
    badgeAwardStatement(seed.badgeAwards),
    badgeProfileStatement(seed.badgeProfiles),
    badgeEquipmentStatement(seed.badgeEquipment),
    gameSeasonStatement(seed.gameSeasons),
    gameTeamStatement(seed.gameTeams),
    gameTeamMembershipStatement(seed.gameTeamMemberships),
    gameWeeklyMatchStatement(seed.gameWeeklyMatches),
    gameRankingSnapshotStatement(seed.gameRankingSnapshots),
    gameRankingEntryResetStatement(seed.gameRankingSnapshots),
    gameRankingEntryStatement(seed.gameRankingSnapshots),
    blindBoxCatalogStatement(seed.blindBoxCatalogs),
    blindBoxCardStatement(seed.blindBoxCards),
    `INSERT INTO mip_app_settings (
       app_id, setting_key, value_json, version, updated_by_user_id
     ) VALUES (
       ${sqlLiteral(appId)}, 'placeholder_catalog',
       ${sqlJson({ version: seed.version, replaceBeforeProduction: true })}, 1, NULL
     ) ON DUPLICATE KEY UPDATE
       value_json = VALUES(value_json), version = version + 1, updated_by_user_id = NULL`,
    ...demoManifestStatements(seed, 'READY'),
  ]
}

function branchStatement(items) {
  const values = items.map(item => `(
    ${sqlLiteral(item.id)}, ${sqlLiteral(appId)}, ${sqlLiteral(item.key)},
    ${sqlLiteral(item.name)}, ${sqlLiteral(item.cityName)}, ${sqlLiteral(item.summary)},
    'ACTIVE', NULL, 1
  )`).join(',\n')
  return `INSERT INTO mip_city_branches (
    id, app_id, branch_key, name, city_name, summary, status, created_by_user_id, version
  ) VALUES ${values}
  ON DUPLICATE KEY UPDATE
    app_id = IF(app_id = VALUES(app_id), app_id, NULL),
    id = IF(id = VALUES(id), id, NULL),
    name = VALUES(name), city_name = VALUES(city_name), summary = VALUES(summary),
    status = 'ACTIVE', version = version + 1`
}

function tagStatements(items) {
  const roots = items.filter(item => !item.parentId)
  const children = items.filter(item => item.parentId)
  return [roots, children].filter(group => group.length).map(tagStatement)
}

function tagStatement(items) {
  const values = items.map(item => `(
    ${sqlLiteral(item.id)}, ${sqlLiteral(appId)}, ${sqlLiteral(item.kind)}, ${sqlLiteral(item.parentId)},
    ${sqlLiteral(item.key)}, ${sqlLiteral(item.label)}, ${item.selectable ? 1 : 0}, ${item.popular ? 1 : 0}, 1,
    ${Number(item.sortOrder)}
  )`).join(',\n')
  return `INSERT INTO mip_tags (
    id, app_id, kind, parent_id, tag_key, label, selectable, popular, enabled, sort_order
  ) VALUES ${values}
  ON DUPLICATE KEY UPDATE
    app_id = IF(app_id = VALUES(app_id), app_id, NULL),
    id = IF(id = VALUES(id), id, NULL),
    parent_id = VALUES(parent_id), label = VALUES(label), selectable = VALUES(selectable),
    popular = VALUES(popular), enabled = 1,
    sort_order = VALUES(sort_order)`
}

function membershipPlanStatement(items) {
  const values = items.map(item => `(
    ${sqlLiteral(item.id)}, ${sqlLiteral(appId)}, ${sqlLiteral(item.key)}, 'TEST',
    ${sqlLiteral(item.name)}, ${sqlLiteral(item.description)}, ${Number(item.durationDays)},
    ${Number(item.priceCents)}, 'CNY', ${sqlJson(item.benefits)}, 'ACTIVE', 1
  )`).join(',\n')
  return `INSERT INTO mip_membership_plans (
    id, app_id, plan_key, catalog_stage, name, description, duration_days,
    price_cents, currency, benefits_json, status, version
  ) VALUES ${values}
  ON DUPLICATE KEY UPDATE
    app_id = IF(app_id = VALUES(app_id), app_id, NULL),
    id = IF(id = VALUES(id), id, NULL),
    plan_key = VALUES(plan_key), name = VALUES(name), description = VALUES(description),
    duration_days = VALUES(duration_days), price_cents = VALUES(price_cents),
    benefits_json = VALUES(benefits_json), status = 'ACTIVE', version = version + 1`
}

function growthLevelStatement(items) {
  const values = items.map(item => `(
    ${sqlLiteral(item.id)}, ${sqlLiteral(appId)}, ${sqlLiteral(item.key)}, ${sqlLiteral(item.name)},
    ${sqlLiteral(item.displayBadge)}, ${Number(item.minimumExperience)}, ${Number(item.sortOrder)},
    ${sqlJson(item.benefits)}, 'ACTIVE', 1
  )`).join(',\n')
  return `INSERT INTO mip_growth_levels (
    id, app_id, level_key, name, display_badge, minimum_experience, sort_order,
    benefits_json, status, version
  ) VALUES ${values}
  ON DUPLICATE KEY UPDATE
    app_id = IF(app_id = VALUES(app_id), app_id, NULL),
    id = IF(id = VALUES(id), id, NULL),
    level_key = VALUES(level_key), name = VALUES(name), display_badge = VALUES(display_badge),
    minimum_experience = VALUES(minimum_experience), sort_order = VALUES(sort_order),
    benefits_json = VALUES(benefits_json), status = 'ACTIVE', version = version + 1`
}

function growthRuleStatement(items) {
  const values = items.map(item => `(
    ${sqlLiteral(item.id)}, ${sqlLiteral(appId)}, ${sqlLiteral(item.key)}, ${sqlLiteral(item.name)},
    ${sqlLiteral(item.metric)}, ${Number(item.deltaValue)},
    ${item.dailyLimitValue === null ? 'NULL' : Number(item.dailyLimitValue)},
    ${sqlLiteral(item.sourceEventType)}, ${sqlLiteral(item.status)}, 1
  )`).join(',\n')
  return `INSERT INTO mip_growth_rules (
    id, app_id, rule_key, name, metric, delta_value, daily_limit_value,
    source_event_type, status, version
  ) VALUES ${values}
  ON DUPLICATE KEY UPDATE
    app_id = IF(app_id = VALUES(app_id), app_id, NULL),
    id = IF(id = VALUES(id), id, NULL),
    name = VALUES(name), metric = VALUES(metric), delta_value = VALUES(delta_value),
    daily_limit_value = VALUES(daily_limit_value), source_event_type = VALUES(source_event_type),
    status = VALUES(status), version = version + 1`
}

function badgeStatement(items) {
  const values = items.map(item => `(
    ${sqlLiteral(item.id)}, ${sqlLiteral(appId)}, ${sqlLiteral(item.key)}, ${sqlLiteral(item.name)},
    ${sqlLiteral(item.description)}, ${sqlLiteral(item.iconName)}, ${sqlLiteral(item.imageUrl)},
    ${sqlLiteral(item.placeholderShape)}, ${sqlLiteral(item.category || 'IDENTITY')}, ${Number(item.sortOrder)}, 'ACTIVE', 1, NULL
  )`).join(',\n')
  return `INSERT INTO mip_badges (
    id, app_id, badge_key, name, description, icon_name, image_url,
    placeholder_shape, category, sort_order, status, version, created_by_user_id
  ) VALUES ${values}
  ON DUPLICATE KEY UPDATE
    app_id = IF(app_id = VALUES(app_id), app_id, NULL),
    id = IF(id = VALUES(id), id, NULL),
    name = VALUES(name), description = VALUES(description), icon_name = VALUES(icon_name),
    image_url = VALUES(image_url), placeholder_shape = VALUES(placeholder_shape),
    category = VALUES(category),
    sort_order = VALUES(sort_order), status = 'ACTIVE', version = version + 1`
}

function userStatement(items) {
  const values = items.map(item => `(
    ${sqlLiteral(item.id)}, ${sqlLiteral(appId)}, 'ACTIVE', NULL, NULL, 1
  )`).join(',\n')
  return `INSERT INTO mip_users (
    id, app_id, status, closed_at, primary_branch_id, version
  ) VALUES ${values}
  ON DUPLICATE KEY UPDATE
    app_id = IF(app_id = VALUES(app_id), app_id, NULL),
    id = IF(id = VALUES(id), id, NULL),
    status = 'ACTIVE', closed_at = NULL, primary_branch_id = NULL, version = version + 1`
}

function mediaAssetStatement(items) {
  const values = items.map(item => `(
    ${sqlLiteral(item.id)}, ${sqlLiteral(appId)}, ${sqlLiteral(item.ownerUserId)},
    ${sqlLiteral(item.purpose)}, ${sqlLiteral(item.objectKey)}, ${sqlLiteral(item.cloudFileId)},
    ${sqlLiteral(item.contentSha256)}, ${sqlLiteral(item.contentType)}, ${Number(item.contentBytes)},
    ${Number(item.width)}, ${Number(item.height)}, 'READY'
  )`).join(',\n')
  return `INSERT INTO mip_media_assets (
    id, app_id, owner_user_id, purpose, object_key, cloud_file_id,
    content_sha256, content_type, content_bytes, width_px, height_px, status
  ) VALUES ${values}
  ON DUPLICATE KEY UPDATE
    app_id = IF(app_id = VALUES(app_id), app_id, NULL),
    id = IF(id = VALUES(id), id, NULL),
    owner_user_id = VALUES(owner_user_id), purpose = VALUES(purpose),
    object_key = VALUES(object_key), cloud_file_id = VALUES(cloud_file_id),
    content_sha256 = VALUES(content_sha256), content_type = VALUES(content_type),
    content_bytes = VALUES(content_bytes), width_px = VALUES(width_px),
    height_px = VALUES(height_px), status = 'READY'`
}

function membershipChainStatement(items) {
  return `INSERT INTO mip_membership_chains (
    app_id, user_id, version, created_at, updated_at
  )
  SELECT membership_user.app_id, membership_user.id, 1,
    UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)
  FROM mip_users membership_user
  WHERE membership_user.app_id = ${sqlLiteral(appId)}
    AND membership_user.id IN (${items.map(item => sqlLiteral(item.id)).join(', ')})
  ON DUPLICATE KEY UPDATE user_id = mip_membership_chains.user_id`
}

function branchMembershipResetStatement(items) {
  return `DELETE FROM mip_branch_memberships
    WHERE app_id = ${sqlLiteral(appId)}
      AND user_id IN (${items.map(item => sqlLiteral(item.id)).join(', ')})`
}

function branchMembershipStatement(items) {
  const values = items.map(item => `(
    ${sqlLiteral(appId)}, ${sqlLiteral(item.branchId)}, ${sqlLiteral(item.id)},
    'ACTIVE', '2026-08-25 00:00:00.000', NULL
  )`).join(',\n')
  return `INSERT INTO mip_branch_memberships (
    app_id, branch_id, user_id, status, joined_at, ended_at
  ) VALUES ${values}
  ON DUPLICATE KEY UPDATE
    status = 'ACTIVE', joined_at = VALUES(joined_at), ended_at = NULL`
}

function userPrimaryBranchStatement(items) {
  const cases = items
    .map(item => `WHEN ${sqlLiteral(item.id)} THEN ${sqlLiteral(item.branchId)}`)
    .join('\n      ')
  return `UPDATE mip_users
    SET primary_branch_id = CASE id
      ${cases}
      ELSE primary_branch_id
    END
    WHERE app_id = ${sqlLiteral(appId)}
      AND id IN (${items.map(item => sqlLiteral(item.id)).join(', ')})`
}

function profileStatement(items) {
  const visibility = {
    nickname: true,
    realName: true,
    gender: true,
    careerIdentity: true,
    avatar: true,
    identityStatus: true,
    headline: true,
    introduction: true,
    companies: true,
    organizations: true,
    primaryBranch: true,
    industry: true,
    abilities: true,
    influence: true,
  }
  const values = items.map(item => `(
    ${sqlLiteral(appId)}, ${sqlLiteral(item.id)}, ${sqlLiteral(item.nickname)}, ${sqlLiteral(item.realName)},
    ${sqlLiteral(item.gender)}, ${sqlLiteral(item.careerIdentityKey)}, ${sqlLiteral(item.avatarAssetId)},
    ${sqlLiteral(item.identityStatus)}, ${sqlLiteral(item.headline)}, ${sqlLiteral(item.introduction)},
    ${sqlJson(item.companies)}, ${sqlJson(item.organizations)}, ${sqlJson(visibility)}, 1
  )`).join(',\n')
  return `INSERT INTO mip_profiles (
    app_id, user_id, nickname, real_name, gender, career_identity_key,
    avatar_asset_id, identity_status, headline, introduction,
    companies_json, organizations_json, visibility_json, version
  ) VALUES ${values}
  ON DUPLICATE KEY UPDATE
    nickname = VALUES(nickname), real_name = VALUES(real_name), gender = VALUES(gender),
    career_identity_key = VALUES(career_identity_key), avatar_asset_id = VALUES(avatar_asset_id),
    identity_status = VALUES(identity_status), headline = VALUES(headline),
    introduction = VALUES(introduction), companies_json = VALUES(companies_json),
    organizations_json = VALUES(organizations_json), visibility_json = VALUES(visibility_json),
    version = version + 1`
}

function profileTagStatement(items) {
  const relations = items.flatMap(item => [
    { userId: item.id, tagId: item.industryTagId, relation: 'PRIMARY_INDUSTRY' },
    ...item.abilityTagIds.map(tagId => ({ userId: item.id, tagId, relation: 'ABILITY' })),
  ])
  const values = relations.map(item => `(
    ${sqlLiteral(appId)}, ${sqlLiteral(item.userId)}, ${sqlLiteral(item.tagId)}, ${sqlLiteral(item.relation)}
  )`).join(',\n')
  return `INSERT INTO mip_profile_tags (
    app_id, user_id, tag_id, relation
  ) VALUES ${values}
  ON DUPLICATE KEY UPDATE tag_id = VALUES(tag_id)`
}

function profileTagResetStatement(items) {
  return `DELETE FROM mip_profile_tags
    WHERE app_id = ${sqlLiteral(appId)}
      AND user_id IN (${items.map(item => sqlLiteral(item.id)).join(', ')})`
}

function growthAccountStatement(items) {
  const values = items.map(item => `(
    ${sqlLiteral(appId)}, ${sqlLiteral(item.id)}, ${Number(item.experienceBalance)},
    ${Number(item.contributionBalance)}, ${Number(item.coinBalance)}, 1
  )`).join(',\n')
  return `INSERT INTO mip_growth_accounts (
    app_id, user_id, experience_balance, contribution_balance, coin_balance, version
  ) VALUES ${values}
  ON DUPLICATE KEY UPDATE
    experience_balance = VALUES(experience_balance),
    contribution_balance = VALUES(contribution_balance),
    coin_balance = VALUES(coin_balance), version = version + 1`
}

function growthEntryStatement(items) {
  const values = items.map(item => `(
    ${sqlLiteral(item.id)}, ${sqlLiteral(appId)}, ${sqlLiteral(item.userId)}, NULL,
    ${sqlLiteral(item.sourceEventId)}, ${sqlLiteral(item.sourceEventType)},
    ${sqlLiteral(item.metric)}, ${Number(item.deltaValue)}, ${Number(item.balanceAfter)},
    ${sqlLiteral(item.adjustmentReason)}, NULL, '2026-08-25 12:30:00.000'
  )`).join(',\n')
  return `INSERT INTO mip_growth_entries (
    id, app_id, user_id, rule_id, source_event_id, source_event_type,
    metric, delta_value, balance_after, adjustment_reason, actor_user_id, created_at
  ) VALUES ${values}
  ON DUPLICATE KEY UPDATE
    app_id = IF(app_id = VALUES(app_id), app_id, NULL),
    id = IF(id = VALUES(id), id, NULL)`
}

function membershipOrderStatement(items, plans) {
  const planById = new Map(plans.map(item => [item.id, item]))
  const values = items.map((item, index) => {
    const plan = planById.get(item.planId)
    const snapshot = {
      planKey: plan.key,
      name: plan.name,
      durationDays: plan.durationDays,
      priceCents: plan.priceCents,
      currency: 'CNY',
      catalogStage: 'TEST',
      benefits: plan.benefits,
      seedVersion: seed.version,
      demo: true,
    }
    return `(
    ${sqlLiteral(item.id)}, ${sqlLiteral(appId)}, ${sqlLiteral(item.userId)},
    'MEMBERSHIP', NULL, ${sqlLiteral(item.planId)}, ${sqlLiteral(`MIP-DEMO-MEMBER-${index + 1}`)},
    NULL, ${sqlLiteral(item.key)}, ${Number(plan.priceCents)}, 'CNY', 'PAID',
    ${sqlJson(snapshot)}, '2026-08-25 12:00:00.000', NULL, 1
  )`
  }).join(',\n')
  return `INSERT INTO mip_orders (
    id, app_id, user_id, order_type, resource_id, membership_plan_id,
    merchant_order_no, provider_transaction_id, idempotency_key, amount_cents,
    currency, status, product_snapshot_json, paid_at, closed_at, version
  ) VALUES ${values}
  ON DUPLICATE KEY UPDATE
    app_id = IF(app_id = VALUES(app_id), app_id, NULL),
    id = IF(id = VALUES(id), id, NULL),
    user_id = VALUES(user_id), order_type = 'MEMBERSHIP', resource_id = NULL,
    membership_plan_id = VALUES(membership_plan_id), merchant_order_no = VALUES(merchant_order_no),
    provider_transaction_id = NULL, idempotency_key = VALUES(idempotency_key),
    amount_cents = VALUES(amount_cents), currency = 'CNY', status = 'PAID',
    product_snapshot_json = VALUES(product_snapshot_json), paid_at = VALUES(paid_at),
    closed_at = NULL, version = version + 1`
}

function eventOrderStatement(items, events) {
  const eventById = new Map(events.map(item => [item.id, item]))
  const values = items.map((item) => {
    const event = eventById.get(item.eventId)
    const snapshot = {
      eventId: item.eventId,
      eventTitle: event?.title,
      priceCents: item.amountCents,
      currency: 'CNY',
      catalogStage: 'TEST',
      seedVersion: seed.version,
      demo: true,
    }
    return `(
    ${sqlLiteral(item.id)}, ${sqlLiteral(appId)}, ${sqlLiteral(item.userId)},
    'EVENT', ${sqlLiteral(item.eventId)}, NULL, ${sqlLiteral(`MIP-DEMO-EVENT-${item.id.slice(-4)}`)},
    NULL, ${sqlLiteral(item.key)}, ${Number(item.amountCents)}, 'CNY', ${sqlLiteral(item.status)},
    ${sqlJson(snapshot)}, '2026-08-26 10:30:00.000', NULL, 1
  )`
  }).join(',\n')
  return `INSERT INTO mip_orders (
    id, app_id, user_id, order_type, resource_id, membership_plan_id,
    merchant_order_no, provider_transaction_id, idempotency_key, amount_cents,
    currency, status, product_snapshot_json, paid_at, closed_at, version
  ) VALUES ${values}
  ON DUPLICATE KEY UPDATE
    app_id = IF(app_id = VALUES(app_id), app_id, NULL),
    id = IF(id = VALUES(id), id, NULL),
    user_id = VALUES(user_id), order_type = 'EVENT', resource_id = VALUES(resource_id),
    membership_plan_id = NULL, merchant_order_no = VALUES(merchant_order_no),
    provider_transaction_id = NULL, idempotency_key = VALUES(idempotency_key),
    amount_cents = VALUES(amount_cents), currency = 'CNY', status = VALUES(status),
    product_snapshot_json = VALUES(product_snapshot_json), paid_at = VALUES(paid_at),
    closed_at = NULL, version = version + 1`
}

function entitlementStatement(items, plans) {
  const planById = new Map(plans.map(item => [item.id, item]))
  const values = items.map(item => `(
    ${sqlLiteral(item.id)}, ${sqlLiteral(appId)}, ${sqlLiteral(item.userId)},
    ${sqlLiteral(item.orderId)}, ${sqlLiteral(planById.has(item.planId) ? item.planId : null)},
    'ORDER', NULL, 'ACTIVE',
    '2026-08-25 12:00:00.000', DATE_ADD('2026-08-25 12:00:00.000', INTERVAL ${Number(planById.get(item.planId)?.durationDays || 0)} DAY), NULL, NULL, 1
  )`).join(',\n')
  return `INSERT INTO mip_membership_entitlements (
    id, app_id, user_id, order_id, plan_id, source_type, source_adjustment_id,
    status, starts_at, ends_at, revoked_at, revocation_reason, version
  ) VALUES ${values}
  ON DUPLICATE KEY UPDATE
    app_id = IF(app_id = VALUES(app_id), app_id, NULL),
    id = IF(id = VALUES(id), id, NULL),
    user_id = VALUES(user_id), order_id = VALUES(order_id), plan_id = VALUES(plan_id),
    source_type = 'ORDER', source_adjustment_id = NULL,
    status = 'ACTIVE', starts_at = VALUES(starts_at), ends_at = VALUES(ends_at),
    revoked_at = NULL, revocation_reason = NULL, version = version + 1`
}

function demoEventTypes(items) {
  const byKey = new Map()
  for (const item of items) {
    if (!byKey.has(item.eventTypeKey)) {
      byKey.set(item.eventTypeKey, {
        key: item.eventTypeKey,
        organizerUserId: item.organizerUserId,
      })
    }
  }
  return [...byKey.values()]
}

function eventTypeStatement(items) {
  const selects = demoEventTypes(items).map(item => `SELECT
    UUID(), ${sqlLiteral(appId)}, ${sqlLiteral(item.key)}, ${sqlLiteral(item.key)},
    '', 0, 'ACTIVE', 1, ${sqlLiteral(item.organizerUserId)}, ${sqlLiteral(item.organizerUserId)}
  WHERE NOT EXISTS (
    SELECT 1 FROM mip_event_types existing
    WHERE existing.app_id = ${sqlLiteral(appId)} AND existing.type_key = ${sqlLiteral(item.key)}
  )`)
  return `INSERT INTO mip_event_types (
    id, app_id, type_key, name, description, sort_order, status, version,
    created_by_user_id, updated_by_user_id
  )
  ${selects.join('\n  UNION ALL\n  ')}`
}

function eventTagStatement(items) {
  const values = items.map(item => `(
    ${sqlLiteral(item.id)}, ${sqlLiteral(appId)}, ${sqlLiteral(item.key)},
    ${sqlLiteral(item.name)}, ${sqlLiteral(item.description)}, ${Number(item.sortOrder)},
    'ACTIVE', 1, ${sqlLiteral(item.actorUserId)}, ${sqlLiteral(item.actorUserId)}, NULL
  )`).join(',\n')
  return `INSERT INTO mip_event_tags (
    id, app_id, tag_key, name, description, sort_order, status, version,
    created_by_user_id, updated_by_user_id, archived_at
  ) VALUES ${values}
  ON DUPLICATE KEY UPDATE
    app_id = IF(app_id = VALUES(app_id), app_id, NULL),
    id = IF(id = VALUES(id), id, NULL),
    version = IF(
      name = VALUES(name) AND description = VALUES(description)
      AND sort_order = VALUES(sort_order) AND status = 'ACTIVE'
      AND created_by_user_id = VALUES(created_by_user_id)
      AND updated_by_user_id = VALUES(updated_by_user_id) AND archived_at IS NULL,
      version, version + 1
    ),
    name = VALUES(name), description = VALUES(description), sort_order = VALUES(sort_order),
    status = 'ACTIVE', created_by_user_id = VALUES(created_by_user_id),
    updated_by_user_id = VALUES(updated_by_user_id), archived_at = NULL`
}

function demoEventTagAssignments(items) {
  return items.flatMap(item => item.tagIds.map(tagId => ({
    eventId: item.id,
    tagId,
    actorUserId: item.organizerUserId,
  })))
}

function eventTagAssignmentStatement(items) {
  const values = demoEventTagAssignments(items).map(item => `(
    ${sqlLiteral(appId)}, ${sqlLiteral(item.eventId)}, ${sqlLiteral(item.tagId)},
    'ACTIVE', 1, ${sqlLiteral(item.actorUserId)}, NULL, NULL
  )`).join(',\n')
  return `INSERT INTO mip_event_tag_assignments (
    app_id, event_id, tag_id, status, version,
    assigned_by_user_id, removed_by_user_id, removed_at
  ) VALUES ${values}
  ON DUPLICATE KEY UPDATE
    version = IF(
      status = 'ACTIVE' AND assigned_by_user_id = VALUES(assigned_by_user_id)
      AND removed_by_user_id IS NULL AND removed_at IS NULL,
      version, version + 1
    ),
    status = 'ACTIVE', assigned_by_user_id = VALUES(assigned_by_user_id),
    removed_by_user_id = NULL, removed_at = NULL`
}

function eventStatement(items) {
  const values = items.map(item => `(
    ${sqlLiteral(item.id)}, ${sqlLiteral(appId)}, 'BRANCH', ${sqlLiteral(item.branchId)},
    ${sqlLiteral(item.organizerUserId)}, ${sqlLiteral(item.title)}, ${sqlLiteral(item.summary)},
    ${sqlLiteral(item.description)}, ${sqlLiteral(item.notices)}, ${sqlLiteral(item.coverAssetId)},
    ${sqlLiteral(item.eventTypeKey)}, ${sqlLiteral(item.eventMode)}, ${sqlLiteral(item.accessType)},
    'AUTO', ${item.albumEnabled ? 1 : 0}, ${sqlLiteral(item.albumSubmissionPolicy)},
    ${sqlLiteral(item.status)}, 'PASSED', ${sqlLiteral(item.startsAt)}, ${sqlLiteral(item.endsAt)},
    ${sqlLiteral(item.registrationOpensAt)}, ${sqlLiteral(item.registrationDeadline)},
    ${sqlLiteral(item.cancellationDeadline)}, ${sqlLiteral(item.venueName)}, ${sqlLiteral(item.address)},
    ${sqlLiteral(item.cityName)}, NULL, NULL, NULL, ${Number(item.capacity)}, 0, ${Number(item.priceCents || 0)}, 'CNY',
    ${sqlJson([])}, 1, 1, ${sqlLiteral(item.publishedAt)}, NULL, NULL,
    ${item.endedAt ? sqlLiteral(item.endedAt) : 'NULL'}
  )`).join(',\n')
  return `INSERT INTO mip_events (
    id, app_id, scope_type, branch_id, organizer_user_id, title, summary, description,
    notices, cover_asset_id, event_type_key, event_mode, access_type, registration_policy,
    album_enabled, album_submission_policy, status, content_safety_status, starts_at, ends_at, registration_opens_at,
    registration_deadline, cancellation_deadline, venue_name, address, city_name,
    latitude, longitude, online_url, capacity, waitlist_enabled, price_cents, currency,
    registration_schema_json, form_version, version, published_at, unpublished_at,
    cancelled_at, ended_at
  ) VALUES ${values}
  ON DUPLICATE KEY UPDATE
    app_id = IF(app_id = VALUES(app_id), app_id, NULL),
    id = IF(id = VALUES(id), id, NULL),
    scope_type = 'BRANCH', branch_id = VALUES(branch_id), organizer_user_id = VALUES(organizer_user_id),
    title = VALUES(title), summary = VALUES(summary), description = VALUES(description),
    notices = VALUES(notices), cover_asset_id = VALUES(cover_asset_id), event_type_key = VALUES(event_type_key),
    event_mode = VALUES(event_mode), access_type = VALUES(access_type), registration_policy = 'AUTO',
    album_enabled = VALUES(album_enabled), album_submission_policy = VALUES(album_submission_policy),
    status = VALUES(status), content_safety_status = 'PASSED', starts_at = VALUES(starts_at),
    ends_at = VALUES(ends_at), registration_opens_at = VALUES(registration_opens_at),
    registration_deadline = VALUES(registration_deadline),
    cancellation_deadline = VALUES(cancellation_deadline), venue_name = VALUES(venue_name),
    address = VALUES(address), city_name = VALUES(city_name), latitude = NULL, longitude = NULL,
    online_url = NULL, capacity = VALUES(capacity), waitlist_enabled = 0, price_cents = VALUES(price_cents),
    currency = 'CNY', registration_schema_json = VALUES(registration_schema_json),
    form_version = 1, version = version + 1, published_at = VALUES(published_at),
    unpublished_at = NULL, cancelled_at = NULL, ended_at = VALUES(ended_at),
    archived_at = NULL, archived_by_user_id = NULL, archive_reason = NULL`
}

function eventRegistrationStatement(items) {
  const values = items.map(item => `(
    ${sqlLiteral(item.id)}, ${sqlLiteral(appId)}, ${sqlLiteral(item.eventId)},
    ${sqlLiteral(item.userId)}, ${sqlLiteral(item.orderId || null)}, ${sqlLiteral(demoRegistrationStatus(item))},
    ${sqlJson({})}, 1, 1, NULL, NULL,
    ${sqlLiteral(demoRegistrationTime(item))},
    NULL, NULL, NULL, ${demoRegistrationVersion(item)}
  )`).join(',\n')
  return `INSERT INTO mip_event_registrations (
    id, app_id, event_id, user_id, order_id, status, answers_json, form_version,
    share_profile, ticket_hash, waitlisted_at, registered_at, cancelled_at,
    cancellation_reason, cancelled_by_type, version
  ) VALUES ${values}
  ON DUPLICATE KEY UPDATE
    app_id = IF(app_id = VALUES(app_id), app_id, NULL),
    id = IF(id = VALUES(id), id, NULL),
    event_id = VALUES(event_id), user_id = VALUES(user_id), order_id = VALUES(order_id),
    status = VALUES(status), answers_json = VALUES(answers_json), form_version = 1,
    share_profile = 1, ticket_hash = NULL, waitlisted_at = NULL,
    registered_at = VALUES(registered_at), cancelled_at = NULL,
    cancellation_reason = NULL, cancelled_by_type = NULL, version = VALUES(version)`
}

function demoRegistrationStatus(item) {
  return item?.status || 'REGISTERED'
}

function demoRegistrationTime(item) {
  return item?.registeredAt || '2026-08-25 13:00:00.000'
}

function demoRegistrationVersion(item) {
  return Number(item?.version || 1)
}

function eventInvitationAttributionStatement(items) {
  const values = items.map(item => `(
    ${sqlLiteral(appId)}, ${sqlLiteral(item.registrationId)}, ${sqlLiteral(item.eventId)},
    ${sqlLiteral(item.guestUserId)}, ${sqlLiteral(item.sourceType)},
    ${sqlLiteral(item.inviterUserId)}, ${sqlLiteral(item.capturedAt)}
  )`).join(',\n')
  return `INSERT INTO mip_event_invitation_attributions (
    app_id, registration_id, event_id, guest_user_id, source_type,
    inviter_user_id, captured_at
  ) VALUES ${values}
  ON DUPLICATE KEY UPDATE
    event_id = VALUES(event_id), guest_user_id = VALUES(guest_user_id),
    source_type = VALUES(source_type), inviter_user_id = VALUES(inviter_user_id),
    captured_at = VALUES(captured_at)`
}

function eventCheckinStatement(items) {
  const values = items.map(item => `(
    ${sqlLiteral(item.id)}, ${sqlLiteral(appId)}, ${sqlLiteral(item.eventId)},
    ${sqlLiteral(item.registrationId)}, ${sqlLiteral(item.userId)}, NULL,
    ${sqlLiteral(item.source)}, ${sqlLiteral(item.status)}, ${sqlLiteral(item.checkedInAt)},
    NULL, NULL, NULL, ${Number(item.version)},
    ${sqlLiteral(item.checkedInAt)}, ${sqlLiteral(item.checkedInAt)}
  )`).join(',\n')
  return `INSERT INTO mip_event_checkins (
    id, app_id, event_id, registration_id, user_id, credential_id, source,
    status, checked_in_at, revoked_at, revoked_by_user_id, revoke_reason, version,
    created_at, updated_at
  ) VALUES ${values}
  ON DUPLICATE KEY UPDATE
    app_id = IF(app_id = VALUES(app_id), app_id, NULL),
    id = IF(id = VALUES(id), id, NULL),
    event_id = VALUES(event_id), registration_id = VALUES(registration_id),
    user_id = VALUES(user_id), credential_id = NULL, source = VALUES(source),
    status = 'ACTIVE', checked_in_at = VALUES(checked_in_at), revoked_at = NULL,
    revoked_by_user_id = NULL, revoke_reason = NULL, version = VALUES(version),
    created_at = VALUES(created_at), updated_at = VALUES(updated_at)`
}

function eventCheckinTransitionStatement(items) {
  const values = items.map(item => `(
    ${sqlLiteral(item.id)}, ${sqlLiteral(appId)}, ${sqlLiteral(item.checkinId)},
    ${sqlLiteral(item.registrationId)}, ${sqlLiteral(item.eventId)}, ${sqlLiteral(item.userId)},
    ${sqlLiteral(item.transitionType)}, ${Number(item.checkinVersion)},
    ${Number(item.registrationVersion)}, NULL, ${sqlLiteral(item.actorUserId)},
    ${sqlLiteral(item.source)}, NULL, ${sqlLiteral(item.occurredAt)},
    ${sqlLiteral(item.occurredAt)}
  )`).join(',\n')
  return `INSERT INTO mip_event_checkin_transitions (
    id, app_id, checkin_id, registration_id, event_id, user_id,
    transition_type, checkin_version, registration_version,
    reversal_of_transition_id, actor_user_id, source, revoke_reason,
    occurred_at, created_at
  ) VALUES ${values}
  ON DUPLICATE KEY UPDATE
    app_id = IF(app_id = VALUES(app_id), app_id, NULL),
    id = IF(id = VALUES(id), id, NULL),
    checkin_id = VALUES(checkin_id), registration_id = VALUES(registration_id),
    event_id = VALUES(event_id), user_id = VALUES(user_id),
    transition_type = 'CHECKED_IN', checkin_version = VALUES(checkin_version),
    registration_version = VALUES(registration_version), reversal_of_transition_id = NULL,
    actor_user_id = VALUES(actor_user_id), source = 'ADMIN', revoke_reason = NULL,
    occurred_at = VALUES(occurred_at), created_at = VALUES(created_at)`
}

function eventHeartStatement(items) {
  const values = items.map(item => `(
    ${sqlLiteral(item.id)}, ${sqlLiteral(appId)}, ${sqlLiteral(item.eventId)},
    ${sqlLiteral(item.voterUserId)}, ${sqlLiteral(item.targetUserId)},
    ${sqlLiteral(item.status)}, 1, NULL,
    ${sqlLiteral(item.occurredAt)}, ${sqlLiteral(item.occurredAt)}
  )`).join(',\n')
  return `INSERT INTO mip_event_hearts (
    id, app_id, event_id, voter_user_id, target_user_id, status, version,
    cancelled_at, created_at, updated_at
  ) VALUES ${values}
  ON DUPLICATE KEY UPDATE
    app_id = IF(app_id = VALUES(app_id), app_id, NULL),
    id = IF(id = VALUES(id), id, NULL),
    event_id = VALUES(event_id), voter_user_id = VALUES(voter_user_id),
    target_user_id = VALUES(target_user_id), status = 'ACTIVE',
    version = VALUES(version), cancelled_at = NULL,
    created_at = VALUES(created_at), updated_at = VALUES(updated_at)`
}

function profileVisitStatement(items) {
  const values = items.map(item => `(
    ${sqlLiteral(item.id)}, ${sqlLiteral(appId)}, ${sqlLiteral(item.visitorUserId)},
    ${sqlLiteral(item.profileUserId)}, ${sqlLiteral(item.visitKey)},
    ${sqlLiteral(item.visitedAt)}, ${item.readAt ? sqlLiteral(item.readAt) : 'NULL'}
  )`).join(',\n')
  return `INSERT INTO mip_profile_visits (
    id, app_id, visitor_user_id, profile_user_id, visit_key, visited_at, read_at
  ) VALUES ${values}
  ON DUPLICATE KEY UPDATE
    app_id = IF(app_id = VALUES(app_id), app_id, NULL),
    id = IF(id = VALUES(id), id, NULL),
    visitor_user_id = VALUES(visitor_user_id), profile_user_id = VALUES(profile_user_id),
    visit_key = VALUES(visit_key), visited_at = VALUES(visited_at), read_at = VALUES(read_at)`
}

function opportunityStatement(items, referrals) {
  const activeReferralCountByOpportunity = new Map()
  for (const referral of referrals) {
    if (referral.status !== 'ACTIVE') {
      continue
    }
    activeReferralCountByOpportunity.set(
      referral.opportunityId,
      (activeReferralCountByOpportunity.get(referral.opportunityId) || 0) + 1,
    )
  }
  const values = items.map(item => `(
    ${sqlLiteral(item.id)}, ${sqlLiteral(appId)}, ${sqlLiteral(item.ownerUserId)},
    'BRANCH', ${sqlLiteral(item.branchId)}, ${sqlLiteral(item.title)},
    ${sqlLiteral(item.valueSummary)}, ${sqlLiteral(item.targetSummary)}, ${sqlLiteral(item.description)},
    ${sqlLiteral(item.cityTagId)}, NULL, 'PUBLISHED', 'APPROVED', ${activeReferralCountByOpportunity.get(item.id) || 0}, 1,
    '2026-08-25 12:00:00.000', NULL, NULL, NULL, NULL, '2030-12-31 23:59:59.000',
    NULL, NULL, NULL
  )`).join(',\n')
  return `INSERT INTO mip_opportunities (
    id, app_id, owner_user_id, scope_type, branch_id, title, value_summary,
    target_summary, description, city_tag_id, cover_asset_id, status,
    content_safety_status, referral_count, version, published_at, ended_at,
    moderated_at, moderated_by_user_id, moderation_reason, deadline_at,
    archived_at, archived_by_user_id, archive_reason
  ) VALUES ${values}
  ON DUPLICATE KEY UPDATE
    app_id = IF(app_id = VALUES(app_id), app_id, NULL),
    id = IF(id = VALUES(id), id, NULL),
    owner_user_id = VALUES(owner_user_id), scope_type = 'BRANCH', branch_id = VALUES(branch_id),
    title = VALUES(title), value_summary = VALUES(value_summary), target_summary = VALUES(target_summary),
    description = VALUES(description), city_tag_id = VALUES(city_tag_id), cover_asset_id = NULL,
    status = 'PUBLISHED', content_safety_status = 'APPROVED', referral_count = VALUES(referral_count),
    version = version + 1, published_at = VALUES(published_at), ended_at = NULL,
    moderated_at = NULL, moderated_by_user_id = NULL, moderation_reason = NULL,
    deadline_at = VALUES(deadline_at), archived_at = NULL, archived_by_user_id = NULL,
    archive_reason = NULL`
}

function opportunityRoleStatement(items) {
  const values = items.flatMap(item => item.roleKeys.map(roleKey => `(
    ${sqlLiteral(appId)}, ${sqlLiteral(item.id)}, ${sqlLiteral(roleKey)}
  )`)).join(',\n')
  return `INSERT INTO mip_opportunity_roles (
    app_id, opportunity_id, role_key
  ) VALUES ${values}
  ON DUPLICATE KEY UPDATE role_key = VALUES(role_key)`
}

function opportunityRoleResetStatement(items) {
  return `DELETE FROM mip_opportunity_roles
    WHERE app_id = ${sqlLiteral(appId)}
      AND opportunity_id IN (${items.map(item => sqlLiteral(item.id)).join(', ')})`
}

function opportunityTagStatement(items, tags) {
  const kindById = new Map(tags.map(item => [item.id, item.kind]))
  const values = items.flatMap(item => item.tagIds.map(tagId => `(
    ${sqlLiteral(appId)}, ${sqlLiteral(item.id)}, ${sqlLiteral(tagId)},
    ${sqlLiteral(kindById.get(tagId) === 'ABILITY' ? 'ABILITY' : 'INDUSTRY')}
  )`)).join(',\n')
  return `INSERT INTO mip_opportunity_tags (
    app_id, opportunity_id, tag_id, relation
  ) VALUES ${values}
  ON DUPLICATE KEY UPDATE tag_id = VALUES(tag_id)`
}

function opportunityTagResetStatement(items) {
  return `DELETE FROM mip_opportunity_tags
    WHERE app_id = ${sqlLiteral(appId)}
      AND opportunity_id IN (${items.map(item => sqlLiteral(item.id)).join(', ')})`
}

function opportunityTeamMemberStatement(items) {
  const values = items.map(item => `(
    ${sqlLiteral(item.id)}, ${sqlLiteral(appId)}, ${sqlLiteral(item.opportunityId)},
    ${sqlLiteral(item.userId)}, 'ACTIVE', ${Number(item.sortOrder)},
    '2026-08-25 14:30:00.000', NULL
  )`).join(',\n')
  return `INSERT INTO mip_opportunity_team_members (
    id, app_id, opportunity_id, user_id, status, sort_order, added_at, removed_at
  ) VALUES ${values}
  ON DUPLICATE KEY UPDATE
    app_id = IF(app_id = VALUES(app_id), app_id, NULL),
    id = IF(id = VALUES(id), id, NULL),
    opportunity_id = VALUES(opportunity_id), user_id = VALUES(user_id),
    status = 'ACTIVE', sort_order = VALUES(sort_order),
    added_at = VALUES(added_at), removed_at = NULL`
}

function referralIntentStatement(items) {
  const values = items.map(item => `(
    ${sqlLiteral(item.id)}, ${sqlLiteral(appId)}, ${sqlLiteral(item.opportunityId)},
    ${sqlLiteral(item.actorUserId)}, ${sqlLiteral(item.targetUserId)}, ${sqlLiteral(item.status)},
    ${sqlLiteral(item.note)}, 1, '2026-08-25 14:35:00.000',
    ${item.status === 'CANCELLED' ? '\'2026-08-25 14:40:00.000\'' : 'NULL'}
  )`).join(',\n')
  return `INSERT INTO mip_referral_intents (
    id, app_id, opportunity_id, actor_user_id, target_user_id, status, note,
    version, activated_at, cancelled_at
  ) VALUES ${values}
  ON DUPLICATE KEY UPDATE
    app_id = IF(app_id = VALUES(app_id), app_id, NULL),
    id = IF(id = VALUES(id), id, NULL),
    opportunity_id = VALUES(opportunity_id), actor_user_id = VALUES(actor_user_id),
    target_user_id = VALUES(target_user_id), status = VALUES(status), note = VALUES(note),
    activated_at = VALUES(activated_at), cancelled_at = VALUES(cancelled_at),
    version = version + 1`
}

function opportunityReferralCountStatement(items) {
  return `UPDATE mip_opportunities opportunity
    SET referral_count = (
      SELECT COUNT(*) FROM mip_referral_intents referral
      WHERE referral.app_id = opportunity.app_id
        AND referral.opportunity_id = opportunity.id AND referral.status = 'ACTIVE'
    )
    WHERE opportunity.app_id = ${sqlLiteral(appId)}
      AND opportunity.id IN (${items.map(item => sqlLiteral(item.id)).join(', ')})`
}

function profileInterestStatement(items) {
  const values = items.map(item => `(
    ${sqlLiteral(item.id)}, ${sqlLiteral(appId)}, ${sqlLiteral(item.actorUserId)},
    ${sqlLiteral(item.targetUserId)}, ${sqlLiteral(item.status)}, ${sqlLiteral(item.sourceType)},
    ${sqlLiteral(item.sourceId)}, 1, '2026-08-25 14:45:00.000',
    ${item.status === 'CANCELLED' ? '\'2026-08-25 14:50:00.000\'' : 'NULL'}
  )`).join(',\n')
  return `INSERT INTO mip_profile_interests (
    id, app_id, actor_user_id, target_user_id, status, source_type, source_id,
    version, activated_at, cancelled_at
  ) VALUES ${values}
  ON DUPLICATE KEY UPDATE
    app_id = IF(app_id = VALUES(app_id), app_id, NULL),
    id = IF(id = VALUES(id), id, NULL),
    actor_user_id = VALUES(actor_user_id), target_user_id = VALUES(target_user_id),
    status = VALUES(status), source_type = VALUES(source_type), source_id = VALUES(source_id),
    activated_at = VALUES(activated_at), cancelled_at = VALUES(cancelled_at),
    version = version + 1`
}

function opportunityCommentSettingsStatement(items) {
  const values = items.map(item => `(
    ${sqlLiteral(appId)}, ${sqlLiteral(item.opportunityId)},
    ${item.commentsEnabled ? 1 : 0}, ${item.reviewsEnabled ? 1 : 0}, ${item.callsEnabled ? 1 : 0},
    ${sqlLiteral(item.moderationMode)}, 1, ${sqlLiteral(item.updatedByUserId)}
  )`).join(',\n')
  return `INSERT INTO mip_opportunity_comment_settings (
    app_id, opportunity_id, comments_enabled, reviews_enabled, calls_enabled,
    moderation_mode, version, updated_by_user_id
  ) VALUES ${values}
  ON DUPLICATE KEY UPDATE
    comments_enabled = VALUES(comments_enabled), reviews_enabled = VALUES(reviews_enabled),
    calls_enabled = VALUES(calls_enabled), moderation_mode = VALUES(moderation_mode),
    updated_by_user_id = VALUES(updated_by_user_id), version = version + 1`
}

function opportunityCommentStatement(items, calls) {
  const activeCallsByComment = new Map()
  for (const call of calls) {
    if (call.status !== 'ACTIVE') {
      continue
    }
    activeCallsByComment.set(call.commentId, (activeCallsByComment.get(call.commentId) || 0) + 1)
  }
  const values = items.map(item => `(
    ${sqlLiteral(item.id)}, ${sqlLiteral(appId)}, ${sqlLiteral(item.opportunityId)},
    ${sqlLiteral(item.authorUserId)}, ${sqlLiteral(item.type)}, ${sqlLiteral(item.body)},
    ${sqlLiteral(item.rating)}, ${item.authorIsParticipant ? 1 : 0}, ${sqlLiteral(item.status)},
    'PASSED', ${activeCallsByComment.get(item.id) || 0}, 1, ${sqlLiteral(item.publishedAt)},
    NULL, NULL, NULL, NULL, NULL, ${sqlLiteral(item.createdAt)}
  )`).join(',\n')
  return `INSERT INTO mip_opportunity_comments (
    id, app_id, opportunity_id, author_user_id, comment_type, body, rating,
    author_is_participant, status, content_safety_status, call_count, version,
    published_at, edited_at, deleted_at, moderated_at, moderated_by_user_id,
    moderation_reason, created_at
  ) VALUES ${values}
  ON DUPLICATE KEY UPDATE
    app_id = IF(app_id = VALUES(app_id), app_id, NULL),
    id = IF(id = VALUES(id), id, NULL),
    opportunity_id = VALUES(opportunity_id), author_user_id = VALUES(author_user_id),
    comment_type = VALUES(comment_type), body = VALUES(body), rating = VALUES(rating),
    author_is_participant = VALUES(author_is_participant), status = VALUES(status),
    content_safety_status = 'PASSED', call_count = VALUES(call_count),
    published_at = VALUES(published_at), edited_at = NULL, deleted_at = NULL,
    moderated_at = NULL, moderated_by_user_id = NULL, moderation_reason = NULL,
    version = version + 1`
}

function opportunityCommentCallStatement(items) {
  const values = items.map(item => `(
    ${sqlLiteral(appId)}, ${sqlLiteral(item.commentId)}, ${sqlLiteral(item.actorUserId)},
    ${sqlLiteral(item.status)}, 1, ${sqlLiteral(item.calledAt)},
    ${item.status === 'CANCELLED' ? sqlLiteral(item.calledAt) : 'NULL'}
  )`).join(',\n')
  return `INSERT INTO mip_opportunity_comment_calls (
    app_id, comment_id, actor_user_id, status, version, called_at, cancelled_at
  ) VALUES ${values}
  ON DUPLICATE KEY UPDATE
    status = VALUES(status), called_at = VALUES(called_at),
    cancelled_at = VALUES(cancelled_at), version = version + 1`
}

function opportunityCommentCallCountStatement(items) {
  return `UPDATE mip_opportunity_comments comment
    SET call_count = (
      SELECT COUNT(*) FROM mip_opportunity_comment_calls comment_call
      WHERE comment_call.app_id = comment.app_id
        AND comment_call.comment_id = comment.id AND comment_call.status = 'ACTIVE'
    )
    WHERE comment.app_id = ${sqlLiteral(appId)}
      AND comment.id IN (${items.map(item => sqlLiteral(item.id)).join(', ')})`
}

function opportunityCommentReportStatement(items) {
  const values = items.map(item => `(
    ${sqlLiteral(item.id)}, ${sqlLiteral(appId)}, ${sqlLiteral(item.commentId)},
    ${sqlLiteral(item.reporterUserId)}, ${sqlLiteral(item.category)},
    ${sqlLiteral(item.description)}, ${sqlLiteral(item.requestId)}, 'PENDING', 1,
    NULL, NULL, NULL, ${sqlLiteral(item.createdAt)}
  )`).join(',\n')
  return `INSERT INTO mip_opportunity_comment_reports (
    id, app_id, comment_id, reporter_user_id, category, description, request_id,
    status, version, reviewed_by_user_id, reviewed_at, resolution_reason, created_at
  ) VALUES ${values}
  ON DUPLICATE KEY UPDATE
    app_id = IF(app_id = VALUES(app_id), app_id, NULL),
    id = IF(id = VALUES(id), id, NULL),
    comment_id = VALUES(comment_id), reporter_user_id = VALUES(reporter_user_id),
    category = VALUES(category), description = VALUES(description), request_id = VALUES(request_id),
    status = 'PENDING', reviewed_by_user_id = NULL, reviewed_at = NULL,
    resolution_reason = NULL, version = version + 1`
}

function userBlockStatement(items) {
  const values = items.map(item => `(
    ${sqlLiteral(appId)}, ${sqlLiteral(item.blockerUserId)}, ${sqlLiteral(item.blockedUserId)},
    ${sqlLiteral(item.status)}, 1, ${sqlLiteral(item.blockedAt)},
    ${item.status === 'INACTIVE' ? sqlLiteral(item.blockedAt) : 'NULL'}
  )`).join(',\n')
  return `INSERT INTO mip_user_blocks (
    app_id, blocker_user_id, blocked_user_id, status, version, blocked_at, unblocked_at
  ) VALUES ${values}
  ON DUPLICATE KEY UPDATE
    status = VALUES(status), blocked_at = VALUES(blocked_at),
    unblocked_at = VALUES(unblocked_at), version = version + 1`
}

function userOpportunityPreferenceStatement(items) {
  const values = items.map(item => `(
    ${sqlLiteral(appId)}, ${sqlLiteral(item.userId)}, ${item.matchingEnabled ? 1 : 0},
    ${item.talentRecommendationsEnabled ? 1 : 0}, ${item.projectRecommendationsEnabled ? 1 : 0},
    ${item.discoverableForMatching ? 1 : 0}, ${sqlLiteral(item.matchingScope)}, 1
  )`).join(',\n')
  return `INSERT INTO mip_user_opportunity_preferences (
    app_id, user_id, matching_enabled, talent_recommendations_enabled,
    project_recommendations_enabled, discoverable_for_matching, matching_scope, version
  ) VALUES ${values}
  ON DUPLICATE KEY UPDATE
    matching_enabled = VALUES(matching_enabled),
    talent_recommendations_enabled = VALUES(talent_recommendations_enabled),
    project_recommendations_enabled = VALUES(project_recommendations_enabled),
    discoverable_for_matching = VALUES(discoverable_for_matching),
    matching_scope = VALUES(matching_scope), version = version + 1`
}

function matchingSettingStatement(items) {
  const values = items.map(item => `(
    ${sqlLiteral(appId)}, ${sqlLiteral(item.scopeKey)}, ${sqlLiteral(item.scopeType)},
    ${sqlLiteral(item.scopeId)}, ${Number(item.talentMinScore)}, ${Number(item.projectMinScore)},
    ${Number(item.maximumCandidates)}, ${item.externalProviderEnabled ? 1 : 0}, 1,
    ${sqlLiteral(item.updatedByUserId)}
  )`).join(',\n')
  return `INSERT INTO mip_matching_settings (
    app_id, scope_key, scope_type, scope_id, talent_min_score, project_min_score,
    maximum_candidates, external_provider_enabled, version, updated_by_user_id
  ) VALUES ${values}
  ON DUPLICATE KEY UPDATE
    scope_type = VALUES(scope_type), scope_id = VALUES(scope_id),
    talent_min_score = VALUES(talent_min_score), project_min_score = VALUES(project_min_score),
    maximum_candidates = VALUES(maximum_candidates),
    external_provider_enabled = VALUES(external_provider_enabled),
    updated_by_user_id = VALUES(updated_by_user_id), version = version + 1`
}

function matchingRequestStatement(items, results) {
  const resultCountByRequest = new Map()
  for (const result of results) {
    resultCountByRequest.set(result.requestId, (resultCountByRequest.get(result.requestId) || 0) + 1)
  }
  const values = items.map((item) => {
    const requestHash = createHash('sha256').update(JSON.stringify({
      sourceId: item.sourceOpportunityId,
      requestedByType: item.requestedByType,
      requesterUserId: item.requesterUserId,
    })).digest('hex')
    return `(
    ${sqlLiteral(item.id)}, ${sqlLiteral(appId)}, ${sqlLiteral(item.requesterUserId)},
    ${sqlLiteral(item.sourceOpportunityId)}, ${sqlLiteral(item.requestedByType)},
    ${sqlLiteral(item.requestedByUserId)}, ${sqlLiteral(item.idempotencyKey)},
    ${sqlLiteral(requestHash)}, 'COMPLETED', ${sqlLiteral(item.providerKey)}, NULL,
    ${sqlLiteral(item.settingsScopeKey)},
    (SELECT version FROM mip_matching_settings WHERE app_id = ${sqlLiteral(appId)} AND scope_key = ${sqlLiteral(item.settingsScopeKey)}),
    (SELECT version FROM mip_opportunities WHERE app_id = ${sqlLiteral(appId)} AND id = ${sqlLiteral(item.sourceOpportunityId)}),
    ${Number(item.resultVersion)}, ${resultCountByRequest.get(item.id) || 0}, NULL,
    ${sqlLiteral(item.completedAt)}, ${sqlLiteral(item.createdAt)}
  )`
  }).join(',\n')
  return `INSERT INTO mip_matching_requests (
    id, app_id, requester_user_id, source_opportunity_id, requested_by_type,
    requested_by_user_id, idempotency_key, request_hash, status, provider_key,
    provider_fallback_reason, settings_scope_key, settings_version, source_version,
    result_version, result_count, error_code, completed_at, created_at
  ) VALUES ${values}
  ON DUPLICATE KEY UPDATE
    app_id = IF(app_id = VALUES(app_id), app_id, NULL),
    id = IF(id = VALUES(id), id, NULL),
    requester_user_id = VALUES(requester_user_id),
    source_opportunity_id = VALUES(source_opportunity_id),
    requested_by_type = VALUES(requested_by_type),
    requested_by_user_id = VALUES(requested_by_user_id),
    idempotency_key = VALUES(idempotency_key), request_hash = VALUES(request_hash),
    status = 'COMPLETED', provider_key = VALUES(provider_key), provider_fallback_reason = NULL,
    settings_scope_key = VALUES(settings_scope_key), settings_version = VALUES(settings_version),
    source_version = VALUES(source_version), result_version = VALUES(result_version),
    result_count = VALUES(result_count), error_code = NULL, completed_at = VALUES(completed_at)`
}

function matchingResultStatement(items) {
  const values = items.map(item => `(
    ${sqlLiteral(appId)}, ${sqlLiteral(item.requestId)}, ${Number(item.resultVersion)},
    ${sqlLiteral(item.candidateType)}, ${sqlLiteral(item.candidateId)},
    ${Number(item.rankNo)}, ${Number(item.score)}, ${sqlJson(item.explanation)},
    '2026-08-25 15:30:00.000'
  )`).join(',\n')
  return `INSERT INTO mip_matching_results (
    app_id, request_id, result_version, candidate_type, candidate_id,
    rank_no, score, explanation_json, created_at
  ) VALUES ${values}
  ON DUPLICATE KEY UPDATE
    rank_no = VALUES(rank_no), score = VALUES(score), explanation_json = VALUES(explanation_json)`
}

function matchingFeedbackStatement(items) {
  const values = items.map((item) => {
    const requestHash = createHash('sha256').update(JSON.stringify({
      requestId: item.requestId,
      resultVersion: item.resultVersion,
      candidateType: item.candidateType,
      candidateId: item.candidateId,
      feedbackType: item.feedbackType,
      reason: item.reason,
    })).digest('hex')
    return `(
    ${sqlLiteral(item.id)}, ${sqlLiteral(appId)}, ${sqlLiteral(item.requestId)},
    ${Number(item.resultVersion)}, ${sqlLiteral(item.candidateType)},
    ${sqlLiteral(item.candidateId)}, ${sqlLiteral(item.actorUserId)},
    ${sqlLiteral(item.feedbackType)}, ${sqlLiteral(item.reason)},
    ${sqlLiteral(item.idempotencyKey)}, ${sqlLiteral(requestHash)}, ${sqlLiteral(item.createdAt)}
  )`
  }).join(',\n')
  return `INSERT INTO mip_matching_feedback (
    id, app_id, request_id, result_version, candidate_type, candidate_id,
    actor_user_id, feedback_type, reason, idempotency_key, request_hash, created_at
  ) VALUES ${values}
  ON DUPLICATE KEY UPDATE
    app_id = IF(app_id = VALUES(app_id), app_id, NULL),
    id = IF(id = VALUES(id), id, NULL)`
}

function cooperationCardStatement(items) {
  const scores = {
    connector: [5, 5, 2, 3, 2, 3],
    business_builder: [4, 4, 3, 5, 2, 4],
    capital_operator: [3, 5, 5, 4, 1, 3],
    strategist: [3, 3, 2, 5, 4, 4],
    visual_designer: [2, 2, 1, 4, 5, 4],
    delivery_lead: [3, 4, 2, 4, 3, 5],
  }
  const dimensions = [
    'business_development',
    'resource_integration',
    'capital_operation',
    'strategy_planning',
    'visual_design',
    'delivery_management',
  ]
  const values = items.map(item => `(
    ${sqlLiteral(item.id)}, ${sqlLiteral(appId)}, ${sqlLiteral(item.ownerUserId)},
    ${sqlLiteral(item.roleKey)}, ${sqlLiteral(item.positioning)}, ${sqlLiteral(item.targetSummary)},
    ${sqlJson(item.roleFields)},
    ${sqlJson(Object.fromEntries(dimensions.map((key, index) => [key, scores[item.roleKey][index]])))},
    'PUBLISHED', 'APPROVED', 1, '2026-08-25 12:00:00.000', NULL
  )`).join(',\n')
  return `INSERT INTO mip_cooperation_cards (
    id, app_id, owner_user_id, role_key, positioning, target_summary,
    role_fields_json, ability_scores_json, status, content_safety_status,
    version, published_at, archived_at
  ) VALUES ${values}
  ON DUPLICATE KEY UPDATE
    app_id = IF(app_id = VALUES(app_id), app_id, NULL),
    id = IF(id = VALUES(id), id, NULL),
    owner_user_id = VALUES(owner_user_id), role_key = VALUES(role_key),
    positioning = VALUES(positioning), target_summary = VALUES(target_summary),
    role_fields_json = VALUES(role_fields_json), ability_scores_json = VALUES(ability_scores_json),
    status = 'PUBLISHED', content_safety_status = 'APPROVED', version = version + 1,
    published_at = VALUES(published_at), archived_at = NULL`
}

function superCaseStatement(items) {
  const values = items.map(item => `(
    ${sqlLiteral(item.id)}, ${sqlLiteral(appId)}, ${sqlLiteral(item.ownerUserId)},
    ${sqlLiteral(item.projectName)}, ${sqlLiteral(item.summary)}, ${sqlLiteral(item.startedOn)},
    ${sqlLiteral(item.endedOn)}, ${sqlLiteral(item.responsibility)}, ${sqlLiteral(item.cityTagId)},
    ${sqlLiteral(item.industryTagId)}, ${sqlLiteral(item.caseType)}, ${sqlLiteral(item.description)},
    NULL, 'PUBLISHED', 'APPROVED', 1, '2026-08-25 12:00:00.000', NULL
  )`).join(',\n')
  return `INSERT INTO mip_super_cases (
    id, app_id, owner_user_id, project_name, summary, started_on, ended_on,
    responsibility, city_tag_id, industry_tag_id, case_type, description,
    cover_asset_id, status, content_safety_status, version, published_at, archived_at
  ) VALUES ${values}
  ON DUPLICATE KEY UPDATE
    app_id = IF(app_id = VALUES(app_id), app_id, NULL),
    id = IF(id = VALUES(id), id, NULL),
    owner_user_id = VALUES(owner_user_id), project_name = VALUES(project_name),
    summary = VALUES(summary), started_on = VALUES(started_on), ended_on = VALUES(ended_on),
    responsibility = VALUES(responsibility), city_tag_id = VALUES(city_tag_id),
    industry_tag_id = VALUES(industry_tag_id), case_type = VALUES(case_type),
    description = VALUES(description), cover_asset_id = NULL, status = 'PUBLISHED',
    content_safety_status = 'APPROVED', version = version + 1,
    published_at = VALUES(published_at), archived_at = NULL`
}

function announcementStatement(items) {
  const values = items.map(item => `(
    ${sqlLiteral(item.id)}, ${sqlLiteral(appId)}, ${sqlLiteral(item.scopeType)},
    ${sqlLiteral(item.branchId)}, ${sqlLiteral(item.title)}, ${sqlLiteral(item.summary)},
    ${sqlLiteral(item.body)}, ${sqlLiteral(item.targetType)}, ${sqlLiteral(item.targetId)},
    'PUBLISHED', 'PASSED', ${item.isPinned ? 1 : 0}, ${sqlLiteral(item.visibleFrom)},
    ${sqlLiteral(item.visibleUntil)}, '2026-08-25 12:00:00.000', NULL,
    ${sqlLiteral(item.actorUserId)}, ${sqlLiteral(item.actorUserId)}, 1
  )`).join(',\n')
  return `INSERT INTO mip_announcements (
    id, app_id, scope_type, branch_id, title, summary, body, target_type, target_id,
    status, content_safety_status, is_pinned, visible_from, visible_until,
    published_at, withdrawn_at, created_by_user_id, updated_by_user_id, version
  ) VALUES ${values}
  ON DUPLICATE KEY UPDATE
    app_id = IF(app_id = VALUES(app_id), app_id, NULL),
    id = IF(id = VALUES(id), id, NULL),
    scope_type = VALUES(scope_type), branch_id = VALUES(branch_id), title = VALUES(title),
    summary = VALUES(summary), body = VALUES(body), target_type = VALUES(target_type),
    target_id = VALUES(target_id), status = 'PUBLISHED', content_safety_status = 'PASSED',
    is_pinned = VALUES(is_pinned), visible_from = VALUES(visible_from),
    visible_until = VALUES(visible_until), published_at = VALUES(published_at),
    withdrawn_at = NULL, updated_by_user_id = VALUES(updated_by_user_id), version = version + 1`
}

function knowledgeSourceStatement(items) {
  const values = items.map(item => `(
    ${sqlLiteral(item.id)}, ${sqlLiteral(appId)}, ${sqlLiteral(item.key)}, ${sqlLiteral(item.name)},
    ${sqlLiteral(item.sourceType)}, ${sqlLiteral(item.endpointUrl)}, 'ACTIVE',
    ${sqlJson(item.fetchConfig)}, NULL, 1, ${sqlLiteral(item.actorUserId)}, ${sqlLiteral(item.actorUserId)}
  )`).join(',\n')
  return `INSERT INTO mip_knowledge_sources (
    id, app_id, source_key, name, source_type, endpoint_url, status, fetch_config_json,
    last_fetched_at, version, created_by_user_id, updated_by_user_id
  ) VALUES ${values}
  ON DUPLICATE KEY UPDATE
    app_id = IF(app_id = VALUES(app_id), app_id, NULL),
    id = IF(id = VALUES(id), id, NULL),
    source_key = VALUES(source_key), name = VALUES(name), source_type = VALUES(source_type),
    endpoint_url = VALUES(endpoint_url), status = 'ACTIVE',
    fetch_config_json = VALUES(fetch_config_json), last_fetched_at = NULL,
    updated_by_user_id = VALUES(updated_by_user_id), version = version + 1`
}

function knowledgeCategoryStatement(items) {
  const values = items.map(item => `(
    ${sqlLiteral(item.id)}, ${sqlLiteral(appId)}, ${sqlLiteral(item.key)}, ${sqlLiteral(item.name)},
    ${sqlLiteral(item.summary)}, ${Number(item.sortOrder)}, 'ACTIVE', 1,
    ${sqlLiteral(item.actorUserId)}, ${sqlLiteral(item.actorUserId)}
  )`).join(',\n')
  return `INSERT INTO mip_knowledge_categories (
    id, app_id, category_key, name, summary, sort_order, status, version,
    created_by_user_id, updated_by_user_id
  ) VALUES ${values}
  ON DUPLICATE KEY UPDATE
    app_id = IF(app_id = VALUES(app_id), app_id, NULL),
    id = IF(id = VALUES(id), id, NULL),
    category_key = VALUES(category_key), name = VALUES(name), summary = VALUES(summary),
    sort_order = VALUES(sort_order), status = 'ACTIVE',
    updated_by_user_id = VALUES(updated_by_user_id), version = version + 1`
}

function knowledgeContentStatement(items) {
  const values = items.map(item => `(
    ${sqlLiteral(item.id)}, ${sqlLiteral(appId)}, ${sqlLiteral(item.sourceId)},
    ${sqlLiteral(item.categoryId)}, ${sqlLiteral(item.contentType)}, ${sqlLiteral(item.title)},
    ${sqlLiteral(item.summary)}, ${sqlLiteral(item.bodyText)}, NULL, NULL, NULL, NULL,
    ${sqlLiteral(item.authorName)}, ${sqlLiteral(item.accessType)},
    ${sqlLiteral(item.sourceExternalId)}, NULL, ${sqlLiteral(item.publishedAt)},
    'PUBLISHED', 'PASSED', 1, ${sqlLiteral(item.actorUserId)}, ${sqlLiteral(item.actorUserId)},
    ${sqlLiteral(item.actorUserId)}, NULL, '2026-08-25 11:50:00.000',
    ${sqlLiteral(item.publishedAt)}, NULL
  )`).join(',\n')
  return `INSERT INTO mip_knowledge_contents (
    id, app_id, source_id, category_id, content_type, title, summary, body_text,
    external_url, channel_finder_username, channel_feed_id, cover_asset_id, author_name,
    access_type, source_external_id, source_content_hash, source_published_at, status,
    content_safety_status, version, created_by_user_id, updated_by_user_id,
    reviewed_by_user_id, review_reason, reviewed_at, published_at, withdrawn_at
  ) VALUES ${values}
  ON DUPLICATE KEY UPDATE
    app_id = IF(app_id = VALUES(app_id), app_id, NULL),
    id = IF(id = VALUES(id), id, NULL),
    source_id = VALUES(source_id), category_id = VALUES(category_id),
    content_type = VALUES(content_type), title = VALUES(title), summary = VALUES(summary),
    body_text = VALUES(body_text), external_url = NULL, channel_finder_username = NULL,
    channel_feed_id = NULL, cover_asset_id = NULL, author_name = VALUES(author_name),
    access_type = VALUES(access_type), source_external_id = VALUES(source_external_id),
    source_content_hash = NULL, source_published_at = VALUES(source_published_at),
    status = 'PUBLISHED', content_safety_status = 'PASSED',
    updated_by_user_id = VALUES(updated_by_user_id), reviewed_by_user_id = VALUES(reviewed_by_user_id),
    review_reason = NULL, reviewed_at = VALUES(reviewed_at), published_at = VALUES(published_at),
    withdrawn_at = NULL, version = version + 1`
}

function knowledgeProductStatement(items) {
  const values = items.map(item => `(
    ${sqlLiteral(item.id)}, ${sqlLiteral(appId)}, ${sqlLiteral(item.contentId)}, 'TEST',
    ${sqlLiteral(item.name)}, ${Number(item.priceCents)}, 'CNY', ${Number(item.unlockDays)},
    ${sqlLiteral(item.refundPolicy)}, ${Number(item.refundWindowHours)}, 'ACTIVE', 1,
    ${sqlLiteral(item.actorUserId)}
  )`).join(',\n')
  return `INSERT INTO mip_knowledge_products (
    id, app_id, content_id, catalog_stage, name, price_cents, currency, unlock_days,
    refund_policy, refund_window_hours, status, version, updated_by_user_id
  ) VALUES ${values}
  ON DUPLICATE KEY UPDATE
    app_id = IF(app_id = VALUES(app_id), app_id, NULL),
    id = IF(id = VALUES(id), id, NULL),
    content_id = VALUES(content_id), catalog_stage = 'TEST', name = VALUES(name),
    price_cents = VALUES(price_cents), currency = 'CNY', unlock_days = VALUES(unlock_days),
    refund_policy = VALUES(refund_policy), refund_window_hours = VALUES(refund_window_hours),
    status = 'ACTIVE', updated_by_user_id = VALUES(updated_by_user_id), version = version + 1`
}

function inboxMessageStatement(items) {
  const values = items.map(item => `(
    ${sqlLiteral(item.id)}, ${sqlLiteral(appId)}, ${sqlLiteral(item.recipientUserId)},
    ${sqlLiteral(item.messageType)}, ${sqlLiteral(item.title)}, ${sqlLiteral(item.body)},
    ${sqlLiteral(item.targetType)}, ${sqlLiteral(item.targetId)}, ${sqlLiteral(item.targetRoute)},
    ${sqlLiteral(item.dedupeKey)}, ${sqlLiteral(item.readAt)}, ${sqlLiteral(item.createdAt)}
  )`).join(',\n')
  return `INSERT INTO mip_inbox_messages (
    id, app_id, recipient_user_id, message_type, title, body, target_type,
    target_id, target_route, dedupe_key, read_at, created_at
  ) VALUES ${values}
  ON DUPLICATE KEY UPDATE
    app_id = IF(app_id = VALUES(app_id), app_id, NULL),
    id = IF(id = VALUES(id), id, NULL),
    recipient_user_id = VALUES(recipient_user_id), message_type = VALUES(message_type),
    title = VALUES(title), body = VALUES(body), target_type = VALUES(target_type),
    target_id = VALUES(target_id), target_route = VALUES(target_route),
    dedupe_key = VALUES(dedupe_key), read_at = VALUES(read_at)`
}

function deliveryTaskStatement(items) {
  const values = items.map(item => `(
    ${sqlLiteral(item.id)}, ${sqlLiteral(appId)}, ${sqlLiteral(item.inboxMessageId)},
    ${sqlLiteral(item.channel)}, ${sqlLiteral(item.templateKey)}, ${sqlJson(item.payload)},
    ${sqlLiteral(item.status)}, ${Number(item.attempts)}, ${sqlLiteral(item.availableAt)}, NULL,
    ${sqlLiteral(item.deliveredAt)}, ${sqlLiteral(item.lastErrorCode)},
    ${sqlLiteral(item.lastOutcome)}, ${sqlLiteral(item.retryDisposition)},
    ${sqlLiteral(item.outcomeUpdatedAt)}, '2026-08-25 13:00:00.000'
  )`).join(',\n')
  return `INSERT INTO mip_delivery_tasks (
    id, app_id, inbox_message_id, channel, template_key, payload_json, status, attempts,
    available_at, lease_expires_at, delivered_at, last_error_code, last_outcome,
    retry_disposition, outcome_updated_at, created_at
  ) VALUES ${values}
  ON DUPLICATE KEY UPDATE
    app_id = IF(app_id = VALUES(app_id), app_id, NULL),
    id = IF(id = VALUES(id), id, NULL),
    inbox_message_id = VALUES(inbox_message_id), channel = VALUES(channel),
    template_key = VALUES(template_key), payload_json = VALUES(payload_json),
    status = VALUES(status), attempts = VALUES(attempts), available_at = VALUES(available_at),
    lease_expires_at = NULL, delivered_at = VALUES(delivered_at),
    last_error_code = VALUES(last_error_code), last_outcome = VALUES(last_outcome),
    retry_disposition = VALUES(retry_disposition), outcome_updated_at = VALUES(outcome_updated_at)`
}

function messageTemplateStatement(items) {
  const values = items.map(item => `(
    ${sqlLiteral(item.id)}, ${sqlLiteral(appId)}, ${sqlLiteral(item.scopeType)},
    ${sqlLiteral(item.branchId)}, ${sqlLiteral(item.status)}, ${Number(item.revision.number)}, 1,
    ${sqlLiteral(item.actorUserId)}, ${sqlLiteral(item.actorUserId)}
  )`).join(',\n')
  return `INSERT INTO mip_message_templates (
    id, app_id, scope_type, branch_id, status, current_revision_number, version,
    created_by_user_id, updated_by_user_id
  ) VALUES ${values}
  ON DUPLICATE KEY UPDATE
    app_id = IF(app_id = VALUES(app_id), app_id, NULL),
    id = IF(id = VALUES(id), id, NULL),
    scope_type = VALUES(scope_type), branch_id = VALUES(branch_id), status = VALUES(status),
    current_revision_number = VALUES(current_revision_number),
    updated_by_user_id = VALUES(updated_by_user_id), version = version + 1`
}

function messageTemplateRevisionStatement(items) {
  const values = items.map(item => `(
    ${sqlLiteral(appId)}, ${sqlLiteral(item.id)}, ${Number(item.revision.number)},
    ${sqlLiteral(item.revision.name)}, ${sqlLiteral(item.revision.title)},
    ${sqlLiteral(item.revision.body)}, 'PASSED', ${sqlLiteral(item.actorUserId)},
    '2026-08-25 12:00:00.000'
  )`).join(',\n')
  return `INSERT INTO mip_message_template_revisions (
    app_id, template_id, revision_number, name, title, body,
    content_safety_status, created_by_user_id, created_at
  ) VALUES ${values}
  ON DUPLICATE KEY UPDATE
    name = VALUES(name), title = VALUES(title), body = VALUES(body),
    content_safety_status = 'PASSED', created_by_user_id = VALUES(created_by_user_id)`
}

function messageCampaignStatement(items) {
  const values = items.map(item => `(
    ${sqlLiteral(item.id)}, ${sqlLiteral(appId)}, ${sqlLiteral(item.actorUserId)},
    ${sqlLiteral(item.actorUserId)}, ${sqlLiteral(item.scopeType)}, ${sqlLiteral(item.branchId)},
    ${sqlLiteral(item.audienceType)}, ${sqlJson(item.audienceUserIds)}, ${sqlLiteral(item.name)},
    ${sqlLiteral(item.title)}, ${sqlLiteral(item.body)}, 'DRAFT', 'PASSED', 0,
    NULL, NULL, NULL, NULL, NULL, NULL, NULL, 1
  )`).join(',\n')
  return `INSERT INTO mip_message_campaigns (
    id, app_id, created_by_user_id, updated_by_user_id, scope_type, branch_id,
    audience_type, audience_user_ids_json, name, title, body, status,
    content_safety_status, recipient_count, snapshot_at, published_at, withdrawn_at,
    withdrawal_reason, publish_idempotency_key, publish_request_hash, active_dispatch_id, version
  ) VALUES ${values}
  ON DUPLICATE KEY UPDATE
    app_id = IF(app_id = VALUES(app_id), app_id, NULL),
    id = IF(id = VALUES(id), id, NULL),
    updated_by_user_id = VALUES(updated_by_user_id), scope_type = VALUES(scope_type),
    branch_id = VALUES(branch_id), audience_type = VALUES(audience_type),
    audience_user_ids_json = VALUES(audience_user_ids_json), name = VALUES(name),
    title = VALUES(title), body = VALUES(body), status = 'DRAFT',
    content_safety_status = 'PASSED', recipient_count = 0, snapshot_at = NULL,
    published_at = NULL, withdrawn_at = NULL, withdrawal_reason = NULL,
    publish_idempotency_key = NULL, publish_request_hash = NULL,
    active_dispatch_id = NULL, version = version + 1`
}

function taskStatement(items) {
  const values = items.map(item => `(
    ${sqlLiteral(item.id)}, ${sqlLiteral(appId)}, ${sqlLiteral(item.name)},
    ${sqlLiteral(item.content)}, ${Number(item.rewardExperience)},
    ${item.attachmentRequired ? 1 : 0}, ${sqlLiteral(item.assignmentMode)},
    ${sqlLiteral(item.endsAt)}, ${sqlLiteral(item.templateAssetId || null)}, 'PUBLISHED', 1, ${sqlLiteral(item.actorUserId)},
    '2026-08-25 12:00:00.000', NULL
  )`).join(',\n')
  return `INSERT INTO mip_task_cards (
    id, app_id, name, content, reward_experience, attachment_required,
    assignment_mode, ends_at, template_asset_id, status, version,
    created_by_user_id, published_at, deleted_at
  ) VALUES ${values}
  ON DUPLICATE KEY UPDATE
    app_id = IF(app_id = VALUES(app_id), app_id, NULL),
    id = IF(id = VALUES(id), id, NULL),
    name = VALUES(name), content = VALUES(content), reward_experience = VALUES(reward_experience),
    attachment_required = VALUES(attachment_required), assignment_mode = VALUES(assignment_mode),
    ends_at = VALUES(ends_at), template_asset_id = VALUES(template_asset_id), status = 'PUBLISHED',
    published_at = VALUES(published_at), deleted_at = NULL, version = version + 1`
}

function taskAssignmentStatement(items) {
  const values = items.map(item => `(
    ${sqlLiteral(item.id)}, ${sqlLiteral(appId)}, ${sqlLiteral(item.taskId)},
    ${sqlLiteral(item.userId)}, 'ACTIVE', 1, ${sqlLiteral(item.actorUserId)},
    '2026-08-25 12:00:00.000', NULL, NULL
  )`).join(',\n')
  return `INSERT INTO mip_task_assignments (
    id, app_id, task_id, user_id, status, version, assigned_by_user_id,
    assigned_at, revoked_by_user_id, revoked_at
  ) VALUES ${values}
  ON DUPLICATE KEY UPDATE
    app_id = IF(app_id = VALUES(app_id), app_id, NULL),
    id = IF(id = VALUES(id), id, NULL),
    task_id = VALUES(task_id), user_id = VALUES(user_id), status = 'ACTIVE',
    assigned_by_user_id = VALUES(assigned_by_user_id), assigned_at = VALUES(assigned_at),
    revoked_by_user_id = NULL, revoked_at = NULL, version = version + 1`
}

function taskCompletionStatement(items, tasks) {
  const taskById = new Map(tasks.map(item => [item.id, item]))
  const values = items.map((item) => {
    const task = taskById.get(item.taskId)
    return `(
    ${sqlLiteral(item.id)}, ${sqlLiteral(appId)}, ${sqlLiteral(item.taskId)}, ${sqlLiteral(item.userId)},
    1, ${sqlLiteral(task?.name || '')}, ${sqlLiteral(task?.content || '')}, NULL,
    ${Number(task?.rewardExperience || 0)}, ${sqlLiteral(item.growthEntryId || null)}, 'SUCCESS', NULL,
    ${sqlLiteral(item.completedAt)}, ${sqlLiteral(item.completedAt)}
  )`
  }).join(',\n')
  return `INSERT INTO mip_task_completions (
    id, app_id, task_id, user_id, task_version, task_name_snapshot,
    task_content_snapshot, attachment_asset_id, reward_experience, growth_entry_id,
    result_status, result_message, completed_at, created_at
  ) VALUES ${values}
  ON DUPLICATE KEY UPDATE
    app_id = IF(app_id = VALUES(app_id), app_id, NULL),
    id = IF(id = VALUES(id), id, NULL), task_id = VALUES(task_id), user_id = VALUES(user_id),
    task_version = VALUES(task_version), task_name_snapshot = VALUES(task_name_snapshot),
    task_content_snapshot = VALUES(task_content_snapshot), attachment_asset_id = NULL,
    reward_experience = VALUES(reward_experience), growth_entry_id = VALUES(growth_entry_id),
    result_status = 'SUCCESS', result_message = NULL, completed_at = VALUES(completed_at)`
}

function badgeAwardStatement(items) {
  const values = items.map(item => `(
    ${sqlLiteral(item.id)}, ${sqlLiteral(appId)}, ${sqlLiteral(item.userId)}, ${sqlLiteral(item.badgeId)},
    'ACTIVE', ${sqlLiteral(item.reason)}, ${sqlLiteral(item.userId)}, ${sqlLiteral(item.awardedAt)},
    NULL, NULL, NULL, 1
  )`).join(',\n')
  return `INSERT INTO mip_user_badges (
    id, app_id, user_id, badge_id, status, award_reason, awarded_by_user_id, awarded_at,
    revoked_by_user_id, revoke_reason, revoked_at, version
  ) VALUES ${values}
  ON DUPLICATE KEY UPDATE
    app_id = IF(app_id = VALUES(app_id), app_id, NULL), id = IF(id = VALUES(id), id, NULL),
    user_id = VALUES(user_id), badge_id = VALUES(badge_id), status = 'ACTIVE',
    award_reason = VALUES(award_reason), awarded_by_user_id = VALUES(awarded_by_user_id),
    awarded_at = VALUES(awarded_at), revoked_by_user_id = NULL, revoke_reason = NULL,
    revoked_at = NULL, version = version + 1`
}

function badgeProfileStatement(items) {
  const values = items.map(item => `(
    ${sqlLiteral(appId)}, ${sqlLiteral(item.userId)}, ${Number(item.version)}, '2026-08-25 12:00:00.000'
  )`).join(',\n')
  return `INSERT INTO mip_user_badge_profiles (app_id, user_id, version, updated_at)
  VALUES ${values}
  ON DUPLICATE KEY UPDATE version = VALUES(version), updated_at = VALUES(updated_at)`
}

function badgeEquipmentStatement(items) {
  const values = items.map(item => `(
    ${sqlLiteral(appId)}, ${sqlLiteral(item.userId)}, ${Number(item.slotNo)},
    ${sqlLiteral(item.badgeId)}, '2026-08-25 12:00:00.000'
  )`).join(',\n')
  return `INSERT INTO mip_user_badge_equipment (app_id, user_id, slot_no, badge_id, equipped_at)
  VALUES ${values}
  ON DUPLICATE KEY UPDATE badge_id = VALUES(badge_id), equipped_at = VALUES(equipped_at)`
}

function gameSeasonStatement(items) {
  const values = items.map(item => `(
    ${sqlLiteral(item.id)}, ${sqlLiteral(appId)}, ${sqlLiteral(item.key)}, ${sqlLiteral(item.name)},
    ${sqlLiteral(item.summary)}, ${sqlLiteral(item.rulesText)}, ${sqlJson(item.rules)},
    ${sqlLiteral(item.periodKind)}, ${sqlLiteral(item.startsAt)}, ${sqlLiteral(item.endsAt)},
    'ACTIVE', 1, ${sqlLiteral(item.actorUserId)}, ${sqlLiteral(item.actorUserId)}
  )`).join(',\n')
  return `INSERT INTO mip_game_seasons (
    id, app_id, season_key, name, summary, rules_text, rules_json, period_kind,
    starts_at, ends_at, status, version, created_by_user_id, updated_by_user_id
  ) VALUES ${values}
  ON DUPLICATE KEY UPDATE
    app_id = IF(app_id = VALUES(app_id), app_id, NULL),
    id = IF(id = VALUES(id), id, NULL),
    season_key = VALUES(season_key), name = VALUES(name), summary = VALUES(summary),
    rules_text = VALUES(rules_text), rules_json = VALUES(rules_json),
    period_kind = VALUES(period_kind), starts_at = VALUES(starts_at), ends_at = VALUES(ends_at),
    status = 'ACTIVE', updated_by_user_id = VALUES(updated_by_user_id), version = version + 1`
}

function gameTeamStatement(items) {
  const values = items.map(item => `(
    ${sqlLiteral(item.id)}, ${sqlLiteral(appId)}, ${sqlLiteral(item.seasonId)},
    ${sqlLiteral(item.branchId)}, ${sqlLiteral(item.name)}, ${sqlLiteral(item.summary)},
    'ACTIVE', 1, ${sqlLiteral(item.actorUserId)}, ${sqlLiteral(item.actorUserId)}
  )`).join(',\n')
  return `INSERT INTO mip_game_teams (
    id, app_id, season_id, branch_id, name, summary, status, version,
    created_by_user_id, updated_by_user_id
  ) VALUES ${values}
  ON DUPLICATE KEY UPDATE
    app_id = IF(app_id = VALUES(app_id), app_id, NULL),
    id = IF(id = VALUES(id), id, NULL),
    season_id = VALUES(season_id), branch_id = VALUES(branch_id), name = VALUES(name),
    summary = VALUES(summary), status = 'ACTIVE',
    updated_by_user_id = VALUES(updated_by_user_id), version = version + 1`
}

function gameTeamMembershipStatement(items) {
  const values = items.map(item => `(
    ${sqlLiteral(item.id)}, ${sqlLiteral(appId)}, ${sqlLiteral(item.seasonId)},
    ${sqlLiteral(item.teamId)}, ${sqlLiteral(item.userId)}, ${sqlLiteral(item.role)},
    'ACTIVE', '2026-08-25 12:00:00.000', NULL, 1
  )`).join(',\n')
  return `INSERT INTO mip_game_team_memberships (
    id, app_id, season_id, team_id, user_id, role, status, joined_at, left_at, version
  ) VALUES ${values}
  ON DUPLICATE KEY UPDATE
    app_id = IF(app_id = VALUES(app_id), app_id, NULL),
    id = IF(id = VALUES(id), id, NULL),
    season_id = VALUES(season_id), team_id = VALUES(team_id), user_id = VALUES(user_id),
    role = VALUES(role), status = 'ACTIVE', joined_at = VALUES(joined_at),
    left_at = NULL, version = version + 1`
}

function gameWeeklyMatchStatement(items) {
  const values = items.map(item => `(
    ${sqlLiteral(item.id)}, ${sqlLiteral(appId)}, ${sqlLiteral(item.seasonId)},
    ${sqlLiteral(item.weekStart)}, ${sqlLiteral(item.weekEnd)}, ${sqlLiteral(item.teamAId)},
    ${sqlLiteral(item.teamBId)}, NULL, NULL, 'SCHEDULED', NULL, 1,
    ${sqlLiteral(item.actorUserId)}
  )`).join(',\n')
  return `INSERT INTO mip_game_weekly_matches (
    id, app_id, season_id, week_start, week_end, team_a_id, team_b_id,
    team_a_score, team_b_score, status, finalized_at, version, created_by_user_id
  ) VALUES ${values}
  ON DUPLICATE KEY UPDATE
    app_id = IF(app_id = VALUES(app_id), app_id, NULL),
    id = IF(id = VALUES(id), id, NULL),
    season_id = VALUES(season_id), week_start = VALUES(week_start), week_end = VALUES(week_end),
    team_a_id = VALUES(team_a_id), team_b_id = VALUES(team_b_id), team_a_score = NULL,
    team_b_score = NULL, status = 'SCHEDULED', finalized_at = NULL, version = version + 1`
}

function gameRankingSnapshotStatement(items) {
  const values = items.map(item => `(
    ${sqlLiteral(item.id)}, ${sqlLiteral(appId)}, ${sqlLiteral(item.seasonId)},
    ${sqlLiteral(item.rankingType)}, ${sqlLiteral(item.periodKey)},
    ${sqlLiteral(item.periodStart)}, ${sqlLiteral(item.periodEnd)}, 'CURRENT',
    ${sqlLiteral(item.actorUserId)}, '2026-08-25 12:00:00.000', 1
  )`).join(',\n')
  return `INSERT INTO mip_game_ranking_snapshots (
    id, app_id, season_id, ranking_type, period_key, period_start, period_end,
    status, generated_by_user_id, generated_at, version
  ) VALUES ${values}
  ON DUPLICATE KEY UPDATE
    app_id = IF(app_id = VALUES(app_id), app_id, NULL),
    id = IF(id = VALUES(id), id, NULL),
    season_id = VALUES(season_id), ranking_type = VALUES(ranking_type),
    period_key = VALUES(period_key), period_start = VALUES(period_start),
    period_end = VALUES(period_end), status = 'CURRENT',
    generated_by_user_id = VALUES(generated_by_user_id), generated_at = VALUES(generated_at),
    version = version + 1`
}

function gameRankingEntryResetStatement(items) {
  return `DELETE FROM mip_game_ranking_entries
    WHERE app_id = ${sqlLiteral(appId)}
      AND snapshot_id IN (${items.map(item => sqlLiteral(item.id)).join(', ')})`
}

function gameRankingEntryStatement(items) {
  const values = items.flatMap(item => item.entries.map(entry => `(
    ${sqlLiteral(appId)}, ${sqlLiteral(item.id)}, ${Number(entry.rankNo)},
    ${sqlLiteral(entry.subjectType)}, ${sqlLiteral(entry.teamId)}, ${sqlLiteral(entry.userId)},
    ${sqlLiteral(entry.branchId)}, ${sqlLiteral(entry.displayName)}, ${Number(entry.score)},
    ${entry.levelNumber === null ? 'NULL' : Number(entry.levelNumber)}, ${sqlLiteral(entry.levelLabel)}
  )`)).join(',\n')
  return `INSERT INTO mip_game_ranking_entries (
    app_id, snapshot_id, rank_no, subject_type, team_id, user_id, branch_id,
    display_name_snapshot, score, level_number, level_label
  ) VALUES ${values}
  ON DUPLICATE KEY UPDATE
    subject_type = VALUES(subject_type), team_id = VALUES(team_id), user_id = VALUES(user_id),
    branch_id = VALUES(branch_id), display_name_snapshot = VALUES(display_name_snapshot),
    score = VALUES(score), level_number = VALUES(level_number), level_label = VALUES(level_label)`
}

function blindBoxCatalogStatement(items) {
  const values = items.map(item => `(
    ${sqlLiteral(item.id)}, ${sqlLiteral(appId)}, ${sqlLiteral(item.key)}, ${sqlLiteral(item.name)},
    ${sqlLiteral(item.summary)}, ${sqlLiteral(item.rulesText)}, ${sqlLiteral(item.redemptionRulesText)},
    ${Number(item.drawCostCoin)}, ${Number(item.dailyDrawLimit)}, ${Number(item.pityThreshold)},
    ${sqlLiteral(item.pityMinRarity)}, 'PUBLISHED', 1,
    ${sqlLiteral(item.actorUserId)}, ${sqlLiteral(item.actorUserId)}
  )`).join(',\n')
  return `INSERT INTO mip_blind_box_catalogs (
    id, app_id, catalog_key, name, summary, rules_text, redemption_rules_text,
    draw_cost_coin, daily_draw_limit, pity_threshold, pity_min_rarity, status,
    version, created_by_user_id, updated_by_user_id
  ) VALUES ${values}
  ON DUPLICATE KEY UPDATE
    app_id = IF(app_id = VALUES(app_id), app_id, NULL),
    id = IF(id = VALUES(id), id, NULL),
    catalog_key = VALUES(catalog_key), name = VALUES(name), summary = VALUES(summary),
    rules_text = VALUES(rules_text), redemption_rules_text = VALUES(redemption_rules_text),
    draw_cost_coin = VALUES(draw_cost_coin), daily_draw_limit = VALUES(daily_draw_limit),
    pity_threshold = VALUES(pity_threshold), pity_min_rarity = VALUES(pity_min_rarity),
    status = 'PUBLISHED', updated_by_user_id = VALUES(updated_by_user_id), version = version + 1`
}

function blindBoxCardStatement(items) {
  const values = items.map(item => `(
    ${sqlLiteral(item.id)}, ${sqlLiteral(appId)}, ${sqlLiteral(item.catalogId)},
    ${sqlLiteral(item.cardKey)}, ${sqlLiteral(item.name)}, ${sqlLiteral(item.summary)},
    ${sqlLiteral(item.rarity)}, ${Number(item.weight)}, ${Number(item.stockTotal)},
    ${Number(item.stockRemaining)}, ${Number(item.displayOrder)}, 'PUBLISHED', 1,
    ${sqlLiteral(item.actorUserId)}, ${sqlLiteral(item.actorUserId)}
  )`).join(',\n')
  return `INSERT INTO mip_blind_box_cards (
    id, app_id, catalog_id, card_key, name, summary, rarity, weight,
    stock_total, stock_remaining, display_order, status, version,
    created_by_user_id, updated_by_user_id
  ) VALUES ${values}
  ON DUPLICATE KEY UPDATE
    app_id = IF(app_id = VALUES(app_id), app_id, NULL),
    id = IF(id = VALUES(id), id, NULL),
    catalog_id = VALUES(catalog_id), card_key = VALUES(card_key), name = VALUES(name),
    summary = VALUES(summary), rarity = VALUES(rarity), weight = VALUES(weight),
    stock_total = VALUES(stock_total), stock_remaining = VALUES(stock_remaining),
    display_order = VALUES(display_order), status = 'PUBLISHED',
    updated_by_user_id = VALUES(updated_by_user_id), version = version + 1`
}

function demoManifestStatements(value, state) {
  const manifest = buildDemoManifest(value, state)
  return ['demo_seed_manifest', `demo_seed_manifest:${value.version}`].map(settingKey => `INSERT INTO mip_app_settings (
    app_id, setting_key, value_json, version, updated_by_user_id
  ) VALUES (
    ${sqlLiteral(appId)}, ${sqlLiteral(settingKey)}, ${sqlJson(manifest)}, 1, NULL
  )
  ON DUPLICATE KEY UPDATE
    value_json = VALUES(value_json), version = version + 1, updated_by_user_id = NULL`)
}

function buildDemoManifest(value, state) {
  const tagKindById = new Map(value.tags.map(item => [item.id, item.kind]))
  return {
    is_demo: 1,
    version: value.version,
    seedSha256,
    state,
    replaceBeforeProduction: true,
    recordsByTable: {
      mip_city_branches: value.branches.map(item => ({ id: item.id })),
      mip_tags: value.tags.map(item => ({ id: item.id })),
      mip_membership_plans: value.membershipPlans.map(item => ({ id: item.id })),
      mip_growth_levels: value.growthLevels.map(item => ({ id: item.id })),
      mip_growth_rules: value.growthRules.map(item => ({ id: item.id })),
      mip_badges: value.badges.map(item => ({ id: item.id })),
      mip_users: value.users.map(item => ({ id: item.id })),
      mip_media_assets: value.mediaAssets.map(item => ({ id: item.id })),
      mip_membership_chains: value.users.map(item => ({ userId: item.id })),
      mip_branch_memberships: value.users.map(item => ({ branchId: item.branchId, userId: item.id })),
      mip_profiles: value.users.map(item => ({ userId: item.id })),
      mip_profile_tags: value.users.flatMap(item => [
        { userId: item.id, tagId: item.industryTagId, relation: 'PRIMARY_INDUSTRY' },
        ...item.abilityTagIds.map(tagId => ({ userId: item.id, tagId, relation: 'ABILITY' })),
      ]),
      mip_growth_accounts: value.users.map(item => ({ userId: item.id })),
      mip_growth_entries: value.growthEntries.map(item => ({ id: item.id })),
      mip_orders: [...value.membershipOrders, ...value.eventOrders].map(item => ({ id: item.id })),
      mip_membership_entitlements: value.entitlements.map(item => ({ id: item.id })),
      mip_event_tags: value.eventTags.map(item => ({ id: item.id })),
      mip_events: value.events.map(item => ({ id: item.id })),
      mip_event_tag_assignments: demoEventTagAssignments(value.events).map(item => ({
        eventId: item.eventId,
        tagId: item.tagId,
      })),
      mip_event_registrations: value.eventRegistrations.map(item => ({ id: item.id })),
      mip_event_checkins: value.eventCheckins.map(item => ({ id: item.id })),
      mip_event_checkin_transitions: value.eventCheckinTransitions.map(item => ({ id: item.id })),
      mip_event_invitation_attributions: value.userInfluence.eventInvitationAttributions
        .map(item => ({ registrationId: item.registrationId })),
      mip_event_hearts: value.userInfluence.eventHearts.map(item => ({ id: item.id })),
      mip_profile_visits: value.userInfluence.profileVisits.map(item => ({ id: item.id })),
      mip_opportunities: value.opportunities.map(item => ({ id: item.id })),
      mip_opportunity_roles: value.opportunities.flatMap(item => item.roleKeys
        .map(roleKey => ({ opportunityId: item.id, roleKey }))),
      mip_opportunity_tags: value.opportunities.flatMap(item => item.tagIds.map(tagId => ({
        opportunityId: item.id,
        tagId,
        relation: tagKindById.get(tagId) === 'ABILITY' ? 'ABILITY' : 'INDUSTRY',
      }))),
      mip_opportunity_team_members: value.opportunityTeamMembers.map(item => ({ id: item.id })),
      mip_referral_intents: value.referralIntents.map(item => ({ id: item.id })),
      mip_profile_interests: value.profileInterests.map(item => ({ id: item.id })),
      mip_opportunity_comment_settings: value.opportunityInteractions.commentSettings.map(item => ({
        opportunityId: item.opportunityId,
      })),
      mip_opportunity_comments: value.opportunityComments.map(item => ({ id: item.id })),
      mip_opportunity_comment_calls: value.opportunityInteractions.commentCalls.map(item => ({
        commentId: item.commentId,
        actorUserId: item.actorUserId,
      })),
      mip_opportunity_comment_reports: value.opportunityCommentReports.map(item => ({ id: item.id })),
      mip_user_blocks: value.opportunityInteractions.userBlocks.map(item => ({
        blockerUserId: item.blockerUserId,
        blockedUserId: item.blockedUserId,
      })),
      mip_user_opportunity_preferences: value.opportunityInteractions.userOpportunityPreferences
        .map(item => ({ userId: item.userId })),
      mip_matching_settings: value.opportunityInteractions.matchingSettings.map(item => ({
        scopeKey: item.scopeKey,
      })),
      mip_matching_requests: value.matchingRequests.map(item => ({ id: item.id })),
      mip_matching_results: value.opportunityInteractions.matchingResults.map(item => ({
        requestId: item.requestId,
        resultVersion: item.resultVersion,
        candidateType: item.candidateType,
        candidateId: item.candidateId,
      })),
      mip_matching_feedback: value.matchingFeedback.map(item => ({ id: item.id })),
      mip_cooperation_cards: value.cooperationCards.map(item => ({ id: item.id })),
      mip_super_cases: value.superCases.map(item => ({ id: item.id })),
      mip_announcements: value.announcements.map(item => ({ id: item.id })),
      mip_knowledge_sources: value.knowledgeSources.map(item => ({ id: item.id })),
      mip_knowledge_categories: value.knowledgeCategories.map(item => ({ id: item.id })),
      mip_knowledge_contents: value.knowledgeContents.map(item => ({ id: item.id })),
      mip_knowledge_products: value.knowledgeProducts.map(item => ({ id: item.id })),
      mip_inbox_messages: value.inboxMessages.map(item => ({ id: item.id })),
      mip_delivery_tasks: value.deliveryTasks.map(item => ({ id: item.id })),
      mip_message_templates: value.messageTemplates.map(item => ({ id: item.id })),
      mip_message_template_revisions: value.messageTemplates.map(item => ({
        templateId: item.id,
        revisionNumber: item.revision.number,
      })),
      mip_message_campaigns: value.messageCampaigns.map(item => ({ id: item.id })),
      mip_task_cards: value.tasks.map(item => ({ id: item.id })),
      mip_task_assignments: value.taskAssignments.map(item => ({ id: item.id })),
      mip_task_completions: value.taskCompletions.map(item => ({ id: item.id })),
      mip_user_badges: value.badgeAwards.map(item => ({ id: item.id })),
      mip_user_badge_profiles: value.badgeProfiles.map(item => ({ userId: item.userId })),
      mip_user_badge_equipment: value.badgeEquipment.map(item => ({ userId: item.userId, slotNo: item.slotNo })),
      mip_game_seasons: value.gameSeasons.map(item => ({ id: item.id })),
      mip_game_teams: value.gameTeams.map(item => ({ id: item.id })),
      mip_game_team_memberships: value.gameTeamMemberships.map(item => ({ id: item.id })),
      mip_game_weekly_matches: value.gameWeeklyMatches.map(item => ({ id: item.id })),
      mip_game_ranking_snapshots: value.gameRankingSnapshots.map(item => ({ id: item.id })),
      mip_game_ranking_entries: value.gameRankingSnapshots.flatMap(item => item.entries.map(entry => ({
        snapshotId: item.id,
        rankNo: entry.rankNo,
      }))),
      mip_blind_box_catalogs: value.blindBoxCatalogs.map(item => ({ id: item.id })),
      mip_blind_box_cards: value.blindBoxCards.map(item => ({ id: item.id })),
      mip_app_settings: [{ settingKey: 'placeholder_catalog' }],
    },
  }
}

function assertSeed(value) {
  if (!value || value.replaceBeforeProduction !== true || typeof value.version !== 'string') {
    throw new Error('MIP demo seed metadata is invalid')
  }
  const groups = [
    'branches',
    'tags',
    'membershipPlans',
    'growthLevels',
    'growthRules',
    'badges',
    'mediaAssets',
    'users',
    'membershipOrders',
    'eventOrders',
    'entitlements',
    'eventTags',
    'events',
    'eventRegistrations',
    'eventCheckins',
    'eventCheckinTransitions',
    'opportunities',
    'opportunityTeamMembers',
    'referralIntents',
    'profileInterests',
    'opportunityComments',
    'opportunityCommentReports',
    'matchingRequests',
    'matchingFeedback',
    'cooperationCards',
    'superCases',
    'announcements',
    'knowledgeSources',
    'knowledgeCategories',
    'knowledgeContents',
    'knowledgeProducts',
    'inboxMessages',
    'deliveryTasks',
    'messageTemplates',
    'messageCampaigns',
    'tasks',
    'taskAssignments',
    'taskCompletions',
    'badgeAwards',
    'badgeProfiles',
    'badgeEquipment',
    'growthEntries',
    'gameSeasons',
    'gameTeams',
    'gameTeamMemberships',
    'gameWeeklyMatches',
    'gameRankingSnapshots',
    'blindBoxCatalogs',
    'blindBoxCards',
  ]
  const allIds = new Set()
  for (const key of groups) {
    if (!Array.isArray(value[key]) || value[key].length === 0) {
      throw new Error(`MIP demo seed ${key} is empty`)
    }
    for (const item of value[key]) {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(item.id)
        || !/^[a-z][a-z0-9_]{1,79}$/.test(item.key)) {
        throw new Error(`MIP demo seed contains an invalid ${key} identity`)
      }
      if (allIds.has(item.id)) {
        throw new Error('MIP demo seed contains duplicate fixed IDs')
      }
      allIds.add(item.id)
    }
  }
  const influence = value.userInfluence
  if (!influence || typeof influence !== 'object' || Array.isArray(influence)
    || Object.keys(influence).sort().join(',') !== [
      'eventHearts',
      'eventInvitationAttributions',
      'profileVisits',
    ].join(',')) {
    throw new Error('MIP demo seed user influence fixtures are invalid')
  }
  for (const key of ['eventHearts', 'profileVisits']) {
    if (!Array.isArray(influence[key]) || influence[key].length === 0) {
      throw new Error(`MIP demo seed user influence ${key} is empty`)
    }
    for (const item of influence[key]) {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(item.id)
        || !/^[a-z][a-z0-9_]{1,79}$/.test(item.key)
        || allIds.has(item.id)) {
        throw new Error(`MIP demo seed contains an invalid user influence ${key} identity`)
      }
      allIds.add(item.id)
    }
  }
  if (!Array.isArray(influence.eventInvitationAttributions)
    || influence.eventInvitationAttributions.length === 0) {
    throw new Error('MIP demo seed user influence invitations are empty')
  }
  if (value.growthRules.some(item => !['ACTIVE', 'DRAFT'].includes(item.status))) {
    throw new Error('Demo growth rule status must be ACTIVE or DRAFT')
  }
  assertTagCatalog(value.tags)
  assertDemoRelations(value)
}

function assertDemoRelations(value) {
  const branchIds = new Set(value.branches.map(item => item.id))
  const tagById = new Map(value.tags.map(item => [item.id, item]))
  const userIds = new Set(value.users.map(item => item.id))
  const mediaById = new Map(value.mediaAssets.map(item => [item.id, item]))
  const planById = new Map(value.membershipPlans.map(item => [item.id, item]))
  const orderById = new Map(value.membershipOrders.map(item => [item.id, item]))
  const eventOrderById = new Map(value.eventOrders.map(item => [item.id, item]))
  const eventIds = new Set(value.events.map(item => item.id))
  const eventById = new Map(value.events.map(item => [item.id, item]))
  const eventTagById = new Map(value.eventTags.map(item => [item.id, item]))
  const opportunityIds = new Set(value.opportunities.map(item => item.id))
  const opportunityById = new Map(value.opportunities.map(item => [item.id, item]))
  const playerIds = new Set(value.entitlements.map(item => item.userId))
  const roleKeys = new Set([
    'connector',
    'business_builder',
    'capital_operator',
    'strategist',
    'visual_designer',
    'delivery_lead',
  ])
  const avatarAssets = value.mediaAssets.filter(item => item.purpose === 'AVATAR')
  const eventCoverAssets = value.mediaAssets.filter(item => item.purpose === 'EVENT_COVER')
  const taskTemplateAssets = value.mediaAssets.filter(item => item.purpose === 'TASK_TEMPLATE')
  if (mediaById.size !== value.mediaAssets.length
    || avatarAssets.length !== value.users.length
    || eventCoverAssets.length !== 4
    || taskTemplateAssets.length !== 1
    || value.mediaAssets.some(item => !userIds.has(item.ownerUserId)
      || !['AVATAR', 'EVENT_COVER', 'TASK_TEMPLATE'].includes(item.purpose)
      || item.extension !== 'jpg'
      || !/^database\/mysql\/mip\/demo-assets\/(?:avatars|events|tasks)\/[a-z0-9-]+\.jpg$/.test(item.sourcePath)
      || !Number.isInteger(item.width) || !Number.isInteger(item.height)
      || item.width < 64 || item.height < 64)) {
    throw new Error('Demo media asset references are invalid')
  }
  if (value.eventTags.length < 3 || eventTagById.size !== value.eventTags.length) {
    throw new Error('Demo event tags require at least three unique fixtures')
  }
  const eventTagKeys = new Set()
  for (const tag of value.eventTags) {
    if (eventTagKeys.has(tag.key)
      || typeof tag.name !== 'string' || !tag.name.trim() || tag.name.length > 80
      || typeof tag.description !== 'string' || tag.description.length > 300
      || !Number.isInteger(tag.sortOrder) || tag.sortOrder < 0
      || !userIds.has(tag.actorUserId)) {
      throw new Error('Demo event tag catalog is invalid')
    }
    eventTagKeys.add(tag.key)
  }
  for (const user of value.users) {
    if (!branchIds.has(user.branchId)
      || mediaById.get(user.avatarAssetId)?.purpose !== 'AVATAR'
      || mediaById.get(user.avatarAssetId)?.ownerUserId !== user.id
      || tagById.get(user.industryTagId)?.kind !== 'INDUSTRY'
      || !Array.isArray(user.abilityTagIds)
      || user.abilityTagIds.some(tagId => tagById.get(tagId)?.kind !== 'ABILITY')
      || typeof user.realName !== 'string' || !user.realName.trim() || user.realName.length > 64
      || !['MALE', 'FEMALE', 'UNKNOWN'].includes(user.gender)
      || ![
        'BRAND_PRINCIPAL',
        'PROFESSIONAL_INVESTOR',
        'BIG_TECH_ELITE',
        'STUDENT',
        'PASSIONATE_FOUNDER',
        'FREE_EXPLORER',
        'COMPANY_OWNER',
        'SLASH_YOUTH',
      ].includes(user.careerIdentityKey)
      || !Number.isInteger(user.experienceBalance)
      || !Number.isInteger(user.contributionBalance)
      || !Number.isInteger(user.coinBalance)
      || user.experienceBalance < 0
      || user.contributionBalance < 0
      || user.coinBalance < 0) {
      throw new Error('Demo user references are invalid')
    }
  }
  for (const order of value.membershipOrders) {
    if (!userIds.has(order.userId) || !planById.has(order.planId)) {
      throw new Error('Demo membership order user is invalid')
    }
  }
  for (const entitlement of value.entitlements) {
    if (!userIds.has(entitlement.userId)
      || orderById.get(entitlement.orderId)?.userId !== entitlement.userId
      || orderById.get(entitlement.orderId)?.planId !== entitlement.planId
      || !planById.has(entitlement.planId)) {
      throw new Error('Demo membership entitlement references are invalid')
    }
  }
  if (value.membershipOrders.length !== value.entitlements.length) {
    throw new Error('Demo players require one order and one entitlement each')
  }
  for (const order of value.eventOrders) {
    const event = eventById.get(order.eventId)
    if (!userIds.has(order.userId) || !event || event.accessType !== 'PAID'
      || order.status !== 'PAID' || order.amountCents !== event.priceCents
      || !Number.isInteger(order.amountCents) || order.amountCents <= 0) {
      throw new Error('Demo event order references are invalid')
    }
  }
  for (const event of value.events) {
    const cover = event.coverAssetId ? mediaById.get(event.coverAssetId) : null
    if (!branchIds.has(event.branchId)
      || !userIds.has(event.organizerUserId)
      || (event.startsAt.startsWith('2030-')
        ? cover?.purpose !== 'EVENT_COVER' || cover.ownerUserId !== event.organizerUserId
        : event.coverAssetId !== null)
      || !Array.isArray(event.tagIds) || event.tagIds.length === 0 || event.tagIds.length > 12
      || new Set(event.tagIds).size !== event.tagIds.length
      || event.tagIds.some(tagId => !eventTagById.has(tagId))
      || typeof event.albumEnabled !== 'boolean'
      || !['AUTO', 'REVIEW'].includes(event.albumSubmissionPolicy)
      || !['PUBLISHED', 'ENDED'].includes(event.status)
      || !isSqlTimestamp(event.startsAt) || !isSqlTimestamp(event.endsAt)
      || !isSqlTimestamp(event.registrationOpensAt)
      || !isSqlTimestamp(event.registrationDeadline)
      || !isSqlTimestamp(event.cancellationDeadline)
      || !isSqlTimestamp(event.publishedAt)
      || event.endsAt <= event.startsAt
      || event.registrationOpensAt >= event.startsAt
      || event.registrationDeadline > event.startsAt
      || event.cancellationDeadline > event.startsAt
      || event.publishedAt > event.startsAt
      || (event.accessType === 'PAID' && (!Number.isInteger(event.priceCents) || event.priceCents <= 0))
      || (event.accessType !== 'PAID' && Number(event.priceCents || 0) !== 0)
      || (event.status === 'PUBLISHED' && event.endedAt !== null)
      || (event.status === 'ENDED'
        && (!isSqlTimestamp(event.endedAt) || event.endedAt < event.endsAt))) {
      throw new Error('Demo event timeline is invalid')
    }
  }
  if (!value.events.some(event => event.status === 'PUBLISHED'
    && event.startsAt.startsWith('2030-') && event.albumEnabled)
  || !value.events.some(event => event.status === 'ENDED'
    && event.endsAt < '2026-08-26 00:00:00.000')) {
    throw new Error('Demo events require both long-lived and historical interaction fixtures')
  }
  const longLivedEvents = value.events.filter(event => event.startsAt.startsWith('2030-'))
  if (!longLivedEvents.length
    || new Set(longLivedEvents.map(event => event.coverAssetId)).size !== longLivedEvents.length
    || !longLivedEvents.some(event => event.tagIds.length === 1)
    || !longLivedEvents.some(event => event.tagIds.length > 1)
    || value.eventTags.some(tag => !value.events.some(event => event.tagIds.includes(tag.id)))) {
    throw new Error('Demo event tags require single-tag, multi-tag, and complete catalog coverage')
  }
  const registrationById = new Map()
  const registrationByEventUser = new Map()
  for (const registration of value.eventRegistrations) {
    const event = eventById.get(registration.eventId)
    const status = demoRegistrationStatus(registration)
    const registeredAt = demoRegistrationTime(registration)
    const version = demoRegistrationVersion(registration)
    if (!event || !userIds.has(registration.userId)
      || !['REGISTERED', 'ATTENDED'].includes(status)
      || !isSqlTimestamp(registeredAt)
      || registeredAt < event.registrationOpensAt
      || registeredAt > event.registrationDeadline
      || !Number.isInteger(version) || version < 1
      || (status === 'ATTENDED' && version < 2)) {
      throw new Error('Demo event registration references are invalid')
    }
    if (registration.orderId) {
      const order = eventOrderById.get(registration.orderId)
      if (!order || order.eventId !== registration.eventId || order.userId !== registration.userId
        || order.status !== 'PAID') {
        throw new Error('Demo paid event registration order is invalid')
      }
    }
    registrationById.set(registration.id, registration)
    registrationByEventUser.set(`${registration.eventId}:${registration.userId}`, registration)
  }
  const checkinById = new Map()
  const checkinByRegistrationId = new Map()
  for (const item of value.eventCheckins) {
    const registration = registrationById.get(item.registrationId)
    const event = eventById.get(item.eventId)
    if (!registration || !event
      || registration.eventId !== item.eventId || registration.userId !== item.userId
      || demoRegistrationStatus(registration) !== 'ATTENDED'
      || item.source !== 'ADMIN' || item.status !== 'ACTIVE'
      || item.version !== 1 || !isSqlTimestamp(item.checkedInAt)
      || item.checkedInAt < demoRegistrationTime(registration)
      || item.checkedInAt > event.endsAt
      || checkinByRegistrationId.has(item.registrationId)) {
      throw new Error('Demo event check-in references are invalid')
    }
    checkinById.set(item.id, item)
    checkinByRegistrationId.set(item.registrationId, item)
  }
  const transitionedCheckins = new Set()
  for (const item of value.eventCheckinTransitions) {
    const checkin = checkinById.get(item.checkinId)
    const registration = registrationById.get(item.registrationId)
    if (!checkin || !registration
      || checkin.registrationId !== item.registrationId
      || checkin.eventId !== item.eventId || checkin.userId !== item.userId
      || item.transitionType !== 'CHECKED_IN'
      || item.checkinVersion !== checkin.version
      || item.registrationVersion !== demoRegistrationVersion(registration)
      || !userIds.has(item.actorUserId)
      || item.source !== checkin.source || item.occurredAt !== checkin.checkedInAt
      || transitionedCheckins.has(item.checkinId)) {
      throw new Error('Demo event check-in transition references are invalid')
    }
    transitionedCheckins.add(item.checkinId)
  }
  const attendedRegistrations = value.eventRegistrations
    .filter(item => demoRegistrationStatus(item) === 'ATTENDED')
  if (attendedRegistrations.length !== 3
    || value.eventCheckins.length !== attendedRegistrations.length
    || value.eventCheckinTransitions.length !== value.eventCheckins.length
    || attendedRegistrations.some(item => !checkinByRegistrationId.has(item.id))
    || value.eventCheckins.some(item => !transitionedCheckins.has(item.id))) {
    throw new Error('Demo attended registrations require one active check-in transition each')
  }
  const influence = value.userInfluence
  const invitationRegistrations = new Set()
  const incomingInvitations = new Set()
  const outgoingInvitations = new Set()
  for (const item of influence.eventInvitationAttributions) {
    const registration = registrationById.get(item.registrationId)
    const event = eventById.get(item.eventId)
    if (!registration || registration.eventId !== item.eventId
      || registration.userId !== item.guestUserId
      || !event || item.capturedAt !== demoRegistrationTime(registration)
      || item.capturedAt < event.registrationOpensAt
      || item.capturedAt > event.registrationDeadline
      || item.sourceType !== 'USER'
      || !userIds.has(item.inviterUserId)
      || item.inviterUserId === item.guestUserId
      || !isSqlTimestamp(item.capturedAt)
      || invitationRegistrations.has(item.registrationId)) {
      throw new Error('Demo event invitation attribution references are invalid')
    }
    invitationRegistrations.add(item.registrationId)
    incomingInvitations.add(item.guestUserId)
    outgoingInvitations.add(item.inviterUserId)
  }
  if (![...incomingInvitations].some(userId => outgoingInvitations.has(userId))) {
    throw new Error('Demo event invitation fixtures must exercise incoming and outgoing directions')
  }
  const eventHeartVoters = new Set()
  for (const item of influence.eventHearts) {
    const event = eventById.get(item.eventId)
    const voterRegistration = registrationByEventUser.get(`${item.eventId}:${item.voterUserId}`)
    const targetRegistration = registrationByEventUser.get(`${item.eventId}:${item.targetUserId}`)
    const voterCheckin = voterRegistration
      ? checkinByRegistrationId.get(voterRegistration.id)
      : null
    const targetCheckin = targetRegistration
      ? checkinByRegistrationId.get(targetRegistration.id)
      : null
    const voterKey = `${item.eventId}:${item.voterUserId}`
    if (item.status !== 'ACTIVE' || event?.status !== 'ENDED'
      || !userIds.has(item.voterUserId) || !userIds.has(item.targetUserId)
      || item.voterUserId === item.targetUserId
      || demoRegistrationStatus(voterRegistration) !== 'ATTENDED'
      || demoRegistrationStatus(targetRegistration) !== 'ATTENDED'
      || !voterCheckin || !targetCheckin
      || !isSqlTimestamp(item.occurredAt)
      || item.occurredAt <= voterCheckin.checkedInAt
      || item.occurredAt <= targetCheckin.checkedInAt
      || item.occurredAt < event.endedAt
      || eventHeartVoters.has(voterKey)) {
      throw new Error('Demo event heart references are invalid')
    }
    eventHeartVoters.add(voterKey)
  }
  const visitKeys = new Set()
  for (const item of influence.profileVisits) {
    const scopedKey = `${item.visitorUserId}:${item.profileUserId}:${item.visitKey}`
    if (!userIds.has(item.visitorUserId) || !userIds.has(item.profileUserId)
      || item.visitorUserId === item.profileUserId
      || typeof item.visitKey !== 'string' || item.visitKey.length < 12
      || item.visitKey.length > 128 || !isSqlTimestamp(item.visitedAt)
      || (item.readAt !== null
        && (!isSqlTimestamp(item.readAt) || item.readAt < item.visitedAt))
      || visitKeys.has(scopedKey)) {
      throw new Error('Demo profile visit references are invalid')
    }
    visitKeys.add(scopedKey)
  }
  if (!influence.profileVisits.some(item => item.readAt === null)
    || !influence.profileVisits.some(item => item.readAt !== null)) {
    throw new Error('Demo profile visits must exercise read and unread states')
  }
  for (const opportunity of value.opportunities) {
    if (!userIds.has(opportunity.ownerUserId)
      || !branchIds.has(opportunity.branchId)
      || tagById.get(opportunity.cityTagId)?.kind !== 'CITY'
      || opportunity.roleKeys.some(roleKey => !roleKeys.has(roleKey))
      || opportunity.tagIds.some(tagId => !['INDUSTRY', 'ABILITY'].includes(tagById.get(tagId)?.kind))) {
      throw new Error('Demo opportunity references are invalid')
    }
  }
  if (value.cooperationCards.length !== roleKeys.size
    || new Set(value.cooperationCards.map(item => item.roleKey)).size !== roleKeys.size
    || value.cooperationCards.some(item => !userIds.has(item.ownerUserId) || !roleKeys.has(item.roleKey))) {
    throw new Error('Demo cooperation cards must cover the six roles')
  }
  const activeTeamUsersByOpportunity = new Map()
  for (const item of value.opportunityTeamMembers) {
    const opportunity = opportunityById.get(item.opportunityId)
    if (!opportunity || !playerIds.has(item.userId)
      || item.userId === opportunity.ownerUserId
      || !Number.isInteger(item.sortOrder) || item.sortOrder < 0) {
      throw new Error('Demo opportunity team references are invalid')
    }
    const members = activeTeamUsersByOpportunity.get(item.opportunityId) || new Set()
    if (members.has(item.userId)) {
      throw new Error('Demo opportunity team contains duplicate users')
    }
    members.add(item.userId)
    activeTeamUsersByOpportunity.set(item.opportunityId, members)
  }

  for (const item of value.referralIntents) {
    const opportunity = opportunityById.get(item.opportunityId)
    if (!opportunity || !userIds.has(item.actorUserId) || !userIds.has(item.targetUserId)
      || item.actorUserId === opportunity.ownerUserId || item.actorUserId === item.targetUserId
      || !['ACTIVE', 'CANCELLED'].includes(item.status)) {
      throw new Error('Demo referral references are invalid')
    }
  }

  for (const item of value.profileInterests) {
    const source = opportunityById.get(item.sourceId)
    if (!userIds.has(item.actorUserId) || !userIds.has(item.targetUserId)
      || item.actorUserId === item.targetUserId || item.sourceType !== 'OPPORTUNITY'
      || source?.ownerUserId !== item.targetUserId
      || !['ACTIVE', 'CANCELLED'].includes(item.status)) {
      throw new Error('Demo profile interest references are invalid')
    }
  }

  const interactions = value.opportunityInteractions
  if (!interactions || typeof interactions !== 'object' || Array.isArray(interactions)) {
    throw new Error('Demo opportunity interactions are invalid')
  }
  for (const key of [
    'commentSettings',
    'commentCalls',
    'userBlocks',
    'userOpportunityPreferences',
    'matchingSettings',
    'matchingResults',
  ]) {
    if (!Array.isArray(interactions[key]) || interactions[key].length === 0) {
      throw new Error(`Demo opportunity interaction ${key} is empty`)
    }
  }
  const commentSettingsByOpportunity = new Map()
  for (const item of interactions.commentSettings) {
    if (!opportunityIds.has(item.opportunityId) || !userIds.has(item.updatedByUserId)
      || !['AUTO', 'REVIEW'].includes(item.moderationMode)
      || [item.commentsEnabled, item.reviewsEnabled, item.callsEnabled]
        .some(flag => typeof flag !== 'boolean')
        || commentSettingsByOpportunity.has(item.opportunityId)) {
      throw new Error('Demo opportunity comment settings are invalid')
    }
    commentSettingsByOpportunity.set(item.opportunityId, item)
  }

  const commentById = new Map()
  for (const item of value.opportunityComments) {
    const opportunity = opportunityById.get(item.opportunityId)
    const participant = item.authorUserId === opportunity?.ownerUserId
      || activeTeamUsersByOpportunity.get(item.opportunityId)?.has(item.authorUserId)
    const ratingValid = item.type === 'COMMENT'
      ? item.rating === null
      : item.type === 'REVIEW' && Number.isInteger(item.rating)
        && item.rating >= 1 && item.rating <= 5
    if (!opportunity || !userIds.has(item.authorUserId)
      || !commentSettingsByOpportunity.has(item.opportunityId)
      || !ratingValid || item.status !== 'PUBLISHED' || !item.publishedAt
      || Boolean(item.authorIsParticipant) !== Boolean(participant)) {
      throw new Error('Demo opportunity comment references are invalid')
    }
    commentById.set(item.id, item)
  }

  const activeCallCountByComment = new Map()
  for (const item of interactions.commentCalls) {
    const comment = commentById.get(item.commentId)
    const opportunity = comment && opportunityById.get(comment.opportunityId)
    const participant = item.actorUserId === opportunity?.ownerUserId
      || activeTeamUsersByOpportunity.get(comment?.opportunityId)?.has(item.actorUserId)
    if (!comment || !participant || item.actorUserId === comment.authorUserId
      || !['ACTIVE', 'CANCELLED'].includes(item.status)) {
      throw new Error('Demo opportunity comment call references are invalid')
    }
    if (item.status === 'ACTIVE') {
      activeCallCountByComment.set(item.commentId, (activeCallCountByComment.get(item.commentId) || 0) + 1)
    }
  }
  if ([...commentById].some(([id]) => !Number.isInteger(activeCallCountByComment.get(id) || 0))) {
    throw new Error('Demo opportunity comment call counts are invalid')
  }

  const reportCategories = new Set([
    'SPAM',
    'HARASSMENT',
    'FRAUD',
    'INAPPROPRIATE_CONTENT',
    'IMPERSONATION',
    'OTHER',
  ])
  for (const item of value.opportunityCommentReports) {
    const comment = commentById.get(item.commentId)
    if (!comment || !userIds.has(item.reporterUserId)
      || item.reporterUserId === comment.authorUserId || !reportCategories.has(item.category)
      || item.status !== 'PENDING' || String(item.requestId || '').length < 12) {
      throw new Error('Demo opportunity comment report references are invalid')
    }
  }

  const preferenceByUser = new Map()
  for (const item of interactions.userOpportunityPreferences) {
    if (!userIds.has(item.userId) || !['PLATFORM', 'PRIMARY_BRANCH'].includes(item.matchingScope)
      || [item.matchingEnabled, item.talentRecommendationsEnabled, item.projectRecommendationsEnabled, item.discoverableForMatching]
        .some(flag => typeof flag !== 'boolean')
        || preferenceByUser.has(item.userId)) {
      throw new Error('Demo user opportunity preferences are invalid')
    }
    preferenceByUser.set(item.userId, item)
  }

  const matchingSettingByKey = new Map()
  for (const item of interactions.matchingSettings) {
    const scopeValid = item.scopeType === 'PLATFORM'
      ? item.scopeKey === 'PLATFORM' && item.scopeId === null
      : item.scopeType === 'BRANCH' && branchIds.has(item.scopeId)
        && item.scopeKey === `BRANCH:${item.scopeId}`
    if (!scopeValid || !userIds.has(item.updatedByUserId)
      || !Number.isInteger(item.talentMinScore) || item.talentMinScore < 0 || item.talentMinScore > 100
      || !Number.isInteger(item.projectMinScore) || item.projectMinScore < 0 || item.projectMinScore > 100
      || !Number.isInteger(item.maximumCandidates)
      || item.maximumCandidates < 10 || item.maximumCandidates > 500
      || typeof item.externalProviderEnabled !== 'boolean'
      || matchingSettingByKey.has(item.scopeKey)) {
      throw new Error('Demo matching settings are invalid')
    }
    matchingSettingByKey.set(item.scopeKey, item)
  }

  const matchingRequestById = new Map()
  for (const item of value.matchingRequests) {
    const source = opportunityById.get(item.sourceOpportunityId)
    const requesterCanUseSource = item.requesterUserId === source?.ownerUserId
      || activeTeamUsersByOpportunity.get(item.sourceOpportunityId)?.has(item.requesterUserId)
    if (!source || !userIds.has(item.requesterUserId) || !userIds.has(item.requestedByUserId)
      || !['USER', 'ADMIN'].includes(item.requestedByType)
      || (item.requestedByType === 'USER' && !requesterCanUseSource)
      || !matchingSettingByKey.has(item.settingsScopeKey)
      || item.providerKey !== 'LOCAL' || item.resultVersion !== 1) {
      throw new Error('Demo matching request references are invalid')
    }
    matchingRequestById.set(item.id, item)
  }

  const matchingResultKeys = new Set()
  const matchingRankKeys = new Set()
  for (const item of interactions.matchingResults) {
    const request = matchingRequestById.get(item.requestId)
    const source = request && opportunityById.get(request.sourceOpportunityId)
    const candidateValid = item.candidateType === 'TALENT'
      ? userIds.has(item.candidateId)
      && value.cooperationCards.some(card => card.ownerUserId === item.candidateId)
      && (preferenceByUser.get(item.candidateId)?.matchingScope === 'PLATFORM'
        || value.users.find(user => user.id === item.candidateId)?.branchId === source?.branchId)
      : item.candidateType === 'PROJECT'
        ? opportunityIds.has(item.candidateId) && item.candidateId !== source?.id
        && opportunityById.get(item.candidateId)?.branchId === source?.branchId
        : false
    const setting = request && matchingSettingByKey.get(request.settingsScopeKey)
    const minimumScore = item.candidateType === 'TALENT'
      ? setting?.talentMinScore
      : setting?.projectMinScore
    const resultKey = `${item.requestId}:${item.resultVersion}:${item.candidateType}:${item.candidateId}`
    const rankKey = `${item.requestId}:${item.resultVersion}:${item.candidateType}:${item.rankNo}`
    const explanationScore = Array.isArray(item.explanation)
      ? item.explanation.reduce((sum, entry) => sum + Number(entry.weight), 0)
      : Number.NaN
    if (!request || item.resultVersion !== request.resultVersion || !candidateValid
      || !Number.isInteger(item.rankNo) || item.rankNo < 1
      || !Number.isInteger(item.score) || item.score < minimumScore || item.score > 100
      || !Array.isArray(item.explanation) || !item.explanation.length
      || explanationScore !== item.score || matchingResultKeys.has(resultKey)
      || matchingRankKeys.has(rankKey)) {
      throw new Error('Demo matching result references are invalid')
    }
    matchingResultKeys.add(resultKey)
    matchingRankKeys.add(rankKey)
  }
  if (value.matchingRequests.some(item => !interactions.matchingResults
    .some(result => result.requestId === item.id))) {
    throw new Error('Demo matching requests require results')
  }

  const feedbackTypes = new Set(['HELPFUL', 'NOT_RELEVANT', 'CONTACTED', 'DISMISSED'])
  for (const item of value.matchingFeedback) {
    const request = matchingRequestById.get(item.requestId)
    const resultKey = `${item.requestId}:${item.resultVersion}:${item.candidateType}:${item.candidateId}`
    if (!request || item.actorUserId !== request.requesterUserId
      || !matchingResultKeys.has(resultKey) || !feedbackTypes.has(item.feedbackType)) {
      throw new Error('Demo matching feedback references are invalid')
    }
  }

  const interactionUsers = new Set([
    ...value.opportunities.map(item => item.ownerUserId),
    ...value.opportunityTeamMembers.map(item => item.userId),
    ...value.referralIntents.flatMap(item => [item.actorUserId, item.targetUserId]),
    ...value.profileInterests.flatMap(item => [item.actorUserId, item.targetUserId]),
    ...value.opportunityComments.map(item => item.authorUserId),
    ...interactions.commentCalls.map(item => item.actorUserId),
    ...value.opportunityCommentReports.map(item => item.reporterUserId),
    ...value.matchingRequests.flatMap(item => [item.requesterUserId, item.requestedByUserId]),
    ...interactions.matchingResults.map(item => item.candidateType === 'TALENT'
      ? item.candidateId
      : opportunityById.get(item.candidateId)?.ownerUserId),
  ])
  for (const item of interactions.userBlocks) {
    if (!userIds.has(item.blockerUserId) || !userIds.has(item.blockedUserId)
      || item.blockerUserId === item.blockedUserId || item.status !== 'ACTIVE'
      || interactionUsers.has(item.blockerUserId) || interactionUsers.has(item.blockedUserId)) {
      throw new Error('Demo user block must remain isolated from primary opportunity fixtures')
    }
  }

  for (const item of value.superCases) {
    if (!userIds.has(item.ownerUserId)
      || tagById.get(item.cityTagId)?.kind !== 'CITY'
      || tagById.get(item.industryTagId)?.kind !== 'INDUSTRY') {
      throw new Error('Demo case references are invalid')
    }
  }

  for (const item of value.announcements) {
    const scopeValid = item.scopeType === 'PLATFORM'
      ? item.branchId === null
      : item.scopeType === 'BRANCH' && branchIds.has(item.branchId)
    const targetValid = item.targetType === 'EVENT'
      ? eventIds.has(item.targetId)
      : item.targetType === 'OPPORTUNITY' && opportunityIds.has(item.targetId)
    if (!scopeValid || !targetValid || !userIds.has(item.actorUserId)
      || item.visibleUntil <= item.visibleFrom) {
      throw new Error('Demo announcement references are invalid')
    }
  }

  const sourceIds = new Set(value.knowledgeSources.map(item => item.id))
  const categoryIds = new Set(value.knowledgeCategories.map(item => item.id))
  const contentIds = new Set(value.knowledgeContents.map(item => item.id))
  const hasInvalidKnowledgeSource = value.knowledgeSources.some(item => item.sourceType !== 'MANUAL'
    || item.endpointUrl !== null || !userIds.has(item.actorUserId))
  const hasInvalidKnowledgeCategory = value.knowledgeCategories
    .some(item => !userIds.has(item.actorUserId))
  if (hasInvalidKnowledgeSource || hasInvalidKnowledgeCategory) {
    throw new Error('Demo knowledge catalog references are invalid')
  }
  for (const item of value.knowledgeContents) {
    if (!sourceIds.has(item.sourceId) || !categoryIds.has(item.categoryId)
      || !userIds.has(item.actorUserId) || !String(item.bodyText || '').trim()
      || !['HOT_NEWS', 'ARTICLE', 'EXPERT_SHARE'].includes(item.contentType)
      || !['FREE', 'MEMBER', 'MEMBER_OR_PAID'].includes(item.accessType)) {
      throw new Error('Demo knowledge content references are invalid')
    }
  }
  if (value.knowledgeProducts.some(item => !contentIds.has(item.contentId)
    || !userIds.has(item.actorUserId) || !Number.isInteger(item.priceCents)
    || item.priceCents <= 0)) {
    throw new Error('Demo knowledge product references are invalid')
  }

  const inboxIds = new Set(value.inboxMessages.map(item => item.id))
  for (const item of value.inboxMessages) {
    const targetPairValid = (item.targetType === null && item.targetId === null)
      || (item.targetType === 'EVENT' && eventIds.has(item.targetId))
    if (!userIds.has(item.recipientUserId) || !targetPairValid) {
      throw new Error('Demo inbox message references are invalid')
    }
  }
  for (const item of value.deliveryTasks) {
    const failedStateValid = item.status === 'FAILED'
      && item.lastOutcome === 'UNKNOWN' && item.retryDisposition === 'MANUAL_REVIEW'
      && item.lastErrorCode && item.deliveredAt === null
    const deliveredStateValid = item.status === 'DELIVERED'
      && item.lastOutcome === 'SUCCEEDED' && item.retryDisposition === 'TERMINAL'
      && item.lastErrorCode === null && item.deliveredAt
    const stateValid = failedStateValid || deliveredStateValid
    if (!inboxIds.has(item.inboxMessageId) || !stateValid
      || !Number.isInteger(item.attempts) || item.attempts < 0 || item.attempts > 5) {
      throw new Error('Demo delivery task references are invalid')
    }
  }

  for (const item of value.messageTemplates) {
    const scopeValid = item.scopeType === 'PLATFORM'
      ? item.branchId === null
      : item.scopeType === 'BRANCH' && branchIds.has(item.branchId)
    if (!scopeValid || !userIds.has(item.actorUserId)
      || !Number.isInteger(item.revision?.number) || item.revision.number < 1
      || !String(item.revision?.body || '').trim()) {
      throw new Error('Demo message template references are invalid')
    }
  }
  for (const item of value.messageCampaigns) {
    const scopeValid = item.scopeType === 'PLATFORM'
      ? item.branchId === null
      : item.scopeType === 'BRANCH' && branchIds.has(item.branchId)
    if (!scopeValid || !userIds.has(item.actorUserId)
      || item.audienceType !== 'ALL' || item.audienceUserIds.length !== 0) {
      throw new Error('Demo message campaign references are invalid')
    }
  }

  const taskById = new Map(value.tasks.map(item => [item.id, item]))
  if (value.tasks.some(item => !userIds.has(item.actorUserId)
    || !['ALL', 'SELECTED'].includes(item.assignmentMode)
    || !isSqlTimestamp(item.endsAt)
    || (item.templateAssetId && mediaById.get(item.templateAssetId)?.purpose !== 'TASK_TEMPLATE'))) {
    throw new Error('Demo task references are invalid')
  }
  if (value.taskAssignments.some(item => taskById.get(item.taskId)?.assignmentMode !== 'SELECTED'
    || !userIds.has(item.userId) || !userIds.has(item.actorUserId))) {
    throw new Error('Demo task assignment references are invalid')
  }
  const taskCompletionIds = new Set()
  for (const item of value.taskCompletions) {
    const task = taskById.get(item.taskId)
    const assignment = value.taskAssignments.find(candidate => candidate.taskId === item.taskId
      && candidate.userId === item.userId)
    if (!task || (task.assignmentMode === 'SELECTED' && !assignment) || !userIds.has(item.userId)
      || !isSqlTimestamp(item.completedAt)
      || item.growthEntryId === null
      || !value.growthEntries.some(entry => entry.id === item.growthEntryId
        && entry.userId === item.userId && entry.metric === 'EXPERIENCE'
        && entry.deltaValue === task.rewardExperience)
      || taskCompletionIds.has(`${item.taskId}:${item.userId}`)) {
      throw new Error('Demo task completion references are invalid')
    }
    taskCompletionIds.add(`${item.taskId}:${item.userId}`)
  }
  const badgeIds = new Set(value.badges.map(item => item.id))
  const badgeAwardKeys = new Set()
  for (const item of value.badgeAwards) {
    const pair = `${item.userId}:${item.badgeId}`
    if (!userIds.has(item.userId) || !badgeIds.has(item.badgeId)
      || !String(item.reason || '').trim() || !isSqlTimestamp(item.awardedAt)
      || badgeAwardKeys.has(pair)) {
      throw new Error('Demo badge award references are invalid')
    }
    badgeAwardKeys.add(pair)
  }
  for (const item of value.badgeProfiles) {
    if (!userIds.has(item.userId) || !Number.isInteger(item.version) || item.version < 1) {
      throw new Error('Demo badge profile references are invalid')
    }
  }
  const equipmentKeys = new Set()
  for (const item of value.badgeEquipment) {
    const key = `${item.userId}:${item.slotNo}`
    if (!userIds.has(item.userId) || !badgeIds.has(item.badgeId)
      || !Number.isInteger(item.slotNo) || item.slotNo < 1 || item.slotNo > 3
      || !badgeAwardKeys.has(`${item.userId}:${item.badgeId}`) || equipmentKeys.has(key)) {
      throw new Error('Demo badge equipment references are invalid')
    }
    equipmentKeys.add(key)
  }

  const metricField = {
    EXPERIENCE: 'experienceBalance',
    CONTRIBUTION: 'contributionBalance',
    COIN: 'coinBalance',
  }
  const growthTotals = new Map()
  for (const item of value.growthEntries) {
    const key = `${item.userId}:${item.metric}`
    const balanceAfter = (growthTotals.get(key) || 0) + item.deltaValue
    if (!userIds.has(item.userId) || !metricField[item.metric]
      || !Number.isInteger(item.deltaValue) || item.deltaValue <= 0
      || item.balanceAfter !== balanceAfter) {
      throw new Error('Demo growth entry references are invalid')
    }
    growthTotals.set(key, balanceAfter)
  }
  for (const user of value.users) {
    for (const [metric, field] of Object.entries(metricField)) {
      if ((growthTotals.get(`${user.id}:${metric}`) || 0) !== user[field]) {
        throw new Error('Demo growth account balances do not match the growth ledger')
      }
    }
  }

  const seasonIds = new Set(value.gameSeasons.map(item => item.id))
  const teamById = new Map(value.gameTeams.map(item => [item.id, item]))
  if (value.gameSeasons.some(item => !userIds.has(item.actorUserId)
    || item.endsAt <= item.startsAt)) {
    throw new Error('Demo game season references are invalid')
  }
  if (value.gameTeams.some(item => !seasonIds.has(item.seasonId)
    || !branchIds.has(item.branchId) || !userIds.has(item.actorUserId))) {
    throw new Error('Demo game team references are invalid')
  }
  if (value.gameTeamMemberships.some(item => teamById.get(item.teamId)?.seasonId !== item.seasonId
    || !playerIds.has(item.userId) || !['CAPTAIN', 'MEMBER'].includes(item.role))) {
    throw new Error('Demo game membership references are invalid')
  }
  for (const item of value.gameWeeklyMatches) {
    if (!seasonIds.has(item.seasonId)
      || teamById.get(item.teamAId)?.seasonId !== item.seasonId
      || teamById.get(item.teamBId)?.seasonId !== item.seasonId
      || item.teamAId >= item.teamBId || !userIds.has(item.actorUserId)) {
      throw new Error('Demo game match references are invalid')
    }
  }
  for (const item of value.gameRankingSnapshots) {
    const ranks = new Set()
    if (!seasonIds.has(item.seasonId) || !userIds.has(item.actorUserId)
      || !Array.isArray(item.entries) || item.entries.length === 0
      || item.periodEnd <= item.periodStart) {
      throw new Error('Demo game ranking snapshot references are invalid')
    }
    for (const entry of item.entries) {
      const subjectValid = entry.subjectType === 'TEAM'
        ? teamById.has(entry.teamId) && entry.userId === null
        : entry.subjectType === 'USER' && userIds.has(entry.userId) && entry.teamId === null
      if (!subjectValid || !branchIds.has(entry.branchId)
        || !Number.isInteger(entry.rankNo) || ranks.has(entry.rankNo)) {
        throw new Error('Demo game ranking entry references are invalid')
      }
      ranks.add(entry.rankNo)
    }
  }

  const blindCatalogIds = new Set(value.blindBoxCatalogs.map(item => item.id))
  if (value.blindBoxCatalogs.some(item => !userIds.has(item.actorUserId))) {
    throw new Error('Demo blind box catalog references are invalid')
  }
  const rarityRank = { COMMON: 1, RARE: 2, EPIC: 3, LEGENDARY: 4 }
  for (const item of value.blindBoxCards) {
    if (!blindCatalogIds.has(item.catalogId) || !userIds.has(item.actorUserId)
      || !rarityRank[item.rarity] || item.stockRemaining > item.stockTotal) {
      throw new Error('Demo blind box card references are invalid')
    }
  }
  for (const catalog of value.blindBoxCatalogs) {
    if (!value.blindBoxCards.some(item => item.catalogId === catalog.id
      && rarityRank[item.rarity] >= rarityRank[catalog.pityMinRarity]
      && item.stockRemaining > 0)) {
      throw new Error('Demo blind box catalog has no pity-eligible stock')
    }
  }
}

function assertTagCatalog(tags) {
  const byId = new Map(tags.map(item => [item.id, item]))
  const keys = new Set()
  if (byId.size !== tags.length) {
    throw new Error('Demo tags contain duplicate IDs')
  }
  for (const tag of tags) {
    const scopedKey = `${tag.kind}:${tag.key}`
    if (keys.has(scopedKey)
      || !['CITY', 'INDUSTRY', 'ABILITY'].includes(tag.kind)
      || typeof tag.selectable !== 'boolean'
      || !Number.isInteger(tag.sortOrder)) {
      throw new Error('Demo tag catalog is invalid')
    }
    keys.add(scopedKey)
    if (tag.kind === 'INDUSTRY') {
      if (!tag.parentId && tag.selectable) {
        throw new Error('Top-level industry tags must be grouping-only')
      }
      if (tag.parentId) {
        const parent = byId.get(tag.parentId)
        if (!tag.selectable
          || parent?.kind !== 'INDUSTRY'
          || parent.parentId
          || parent.selectable) {
          throw new Error('Selectable industries require one non-selectable industry parent')
        }
      }
    }
    else if (tag.parentId || !tag.selectable) {
      throw new Error('City and ability tags must be selectable roots')
    }
  }
}

function isSqlTimestamp(value) {
  return typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}$/.test(value)
    && Number.isFinite(new Date(`${value.replace(' ', 'T')}Z`).getTime())
}

function assertTablesExist(tableNames) {
  const result = callCloudbase(root, 'queryMysqlDatabase', {
    action: 'runQuery',
    sql: `SELECT table_name AS tableName FROM information_schema.tables
      WHERE table_schema = DATABASE()
        AND table_name IN (${tableNames.map(sqlLiteral).join(', ')})`,
  })
  const found = new Set(collectFieldValues(result, ['tableName', 'table_name']))
  const missing = tableNames.filter(table => !found.has(table))
  if (missing.length) {
    throw new Error(`Apply MIP migrations before seeding; missing table ${missing[0]}`)
  }
}

function collectFieldValues(value, names, output = []) {
  if (!value || typeof value !== 'object') {
    return output
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectFieldValues(item, names, output)
    }
    return output
  }
  const expected = new Set(names.map(name => name.toLowerCase()))
  for (const [key, child] of Object.entries(value)) {
    if (expected.has(key.toLowerCase()) && typeof child === 'string') {
      output.push(child)
    }
    else if (child && typeof child === 'object') {
      collectFieldValues(child, names, output)
    }
  }
  return output
}

function findCountRow(value, keys) {
  if (!value || typeof value !== 'object') {
    return null
  }
  if (!Array.isArray(value)
    && keys.every(key => key in value)) {
    return value
  }
  for (const child of Object.values(value)) {
    const found = findCountRow(child, keys)
    if (found) {
      return found
    }
  }
  return null
}
