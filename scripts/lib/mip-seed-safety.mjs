const SEED_TABLES = Object.freeze({
  branches: 'mip_city_branches',
  tags: 'mip_tags',
  membershipPlans: 'mip_membership_plans',
  growthLevels: 'mip_growth_levels',
  growthRules: 'mip_growth_rules',
  badges: 'mip_badges',
  users: 'mip_users',
  mediaAssets: 'mip_media_assets',
  banners: 'mip_banners',
  membershipOrders: 'mip_orders',
  eventOrders: 'mip_orders',
  entitlements: 'mip_membership_entitlements',
  eventTags: 'mip_event_tags',
  events: 'mip_events',
  eventRegistrations: 'mip_event_registrations',
  eventCheckins: 'mip_event_checkins',
  eventCheckinTransitions: 'mip_event_checkin_transitions',
  opportunities: 'mip_opportunities',
  opportunityTeamMembers: 'mip_opportunity_team_members',
  referralIntents: 'mip_referral_intents',
  profileInterests: 'mip_profile_interests',
  opportunityComments: 'mip_opportunity_comments',
  opportunityCommentReports: 'mip_opportunity_comment_reports',
  matchingRequests: 'mip_matching_requests',
  matchingFeedback: 'mip_matching_feedback',
  cooperationCards: 'mip_cooperation_cards',
  superCases: 'mip_super_cases',
  announcements: 'mip_announcements',
  knowledgeSources: 'mip_knowledge_sources',
  knowledgeCategories: 'mip_knowledge_categories',
  knowledgeContents: 'mip_knowledge_contents',
  knowledgeProducts: 'mip_knowledge_products',
  inboxMessages: 'mip_inbox_messages',
  deliveryTasks: 'mip_delivery_tasks',
  messageTemplates: 'mip_message_templates',
  messageCampaigns: 'mip_message_campaigns',
  tasks: 'mip_task_cards',
  taskAssignments: 'mip_task_assignments',
  taskCompletions: 'mip_task_completions',
  badgeAwards: 'mip_user_badges',
  growthEntries: 'mip_growth_entries',
  gameSeasons: 'mip_game_seasons',
  gameTeams: 'mip_game_teams',
  gameTeamMemberships: 'mip_game_team_memberships',
  gameWeeklyMatches: 'mip_game_weekly_matches',
  gameRankingSnapshots: 'mip_game_ranking_snapshots',
  blindBoxCatalogs: 'mip_blind_box_catalogs',
  blindBoxCards: 'mip_blind_box_cards',
})

export function buildSeedOwnershipQuery(appId, seed) {
  if (!/^wx[0-9a-f]{16}$/i.test(String(appId || ''))) {
    throw new Error('MINI_PROGRAM_APP_ID is invalid')
  }
  const selects = []
  for (const [group, table] of Object.entries(SEED_TABLES)) {
    const ids = Array.isArray(seed?.[group]) ? seed[group].map(item => String(item?.id || '')) : []
    if (!ids.length || ids.some(id => !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))) {
      throw new Error(`MIP demo seed ${group} identities are invalid`)
    }
    selects.push(`SELECT id FROM ${table}
      WHERE id IN (${ids.map(id => `'${id}'`).join(', ')}) AND app_id <> '${appId}'`)
  }
  selects.push(`SELECT media_asset_id AS id FROM mip_event_content_media
    WHERE media_asset_id IN (${seed.eventContentMedia.map(item => literal(item.mediaAssetId)).join(', ')})
      AND event_id IN (${seed.eventContentMedia.map(item => literal(item.eventId)).join(', ')})
      AND app_id <> ${literal(appId)}`)
  selects.push(`SELECT user_id AS id FROM mip_membership_chains
    WHERE user_id IN (${seedIds(seed, 'users').map(literal).join(', ')})
      AND app_id <> ${literal(appId)}`)
  const influence = userInfluenceFixtures(seed)
  selects.push(`SELECT registration_id AS id FROM mip_event_invitation_attributions
    WHERE registration_id IN (${influence.eventInvitationAttributions.map(item => literal(item.registrationId)).join(', ')})
      AND app_id <> ${literal(appId)}`)
  selects.push(`SELECT id FROM mip_event_hearts
    WHERE id IN (${influence.eventHearts.map(item => literal(item.id)).join(', ')})
      AND app_id <> ${literal(appId)}`)
  selects.push(`SELECT id FROM mip_profile_visits
    WHERE id IN (${influence.profileVisits.map(item => literal(item.id)).join(', ')})
      AND app_id <> ${literal(appId)}`)
  return `SELECT COUNT(*) AS conflicts FROM (\n${selects.join('\nUNION ALL\n')}\n) seed_ownership_conflicts`
}

export function buildSeedCollisionQuery(appId, seed) {
  if (!/^wx[0-9a-f]{16}$/i.test(String(appId || ''))) {
    throw new Error('MINI_PROGRAM_APP_ID is invalid')
  }
  const selects = []
  for (const [group, table] of Object.entries(SEED_TABLES)) {
    const ids = seedIds(seed, group)
    selects.push(`SELECT id FROM ${table} candidate
      WHERE candidate.app_id = ${literal(appId)}
        AND candidate.id IN (${ids.map(literal).join(', ')})
        AND NOT EXISTS (
          SELECT 1 FROM mip_app_settings demo_manifest
          WHERE demo_manifest.app_id = candidate.app_id
            AND demo_manifest.setting_key LIKE 'demo_seed_manifest%'
            AND JSON_UNQUOTE(JSON_EXTRACT(demo_manifest.value_json, '$.is_demo')) = '1'
            AND JSON_SEARCH(
              JSON_EXTRACT(demo_manifest.value_json, '$.recordsByTable.${table}'),
              'one', candidate.id
            ) IS NOT NULL
        )`)
  }
  selects.push(`SELECT CONCAT(candidate.event_id, ':', candidate.media_asset_id) AS id
    FROM mip_event_content_media candidate
    WHERE candidate.app_id = ${literal(appId)}
      AND (${seed.eventContentMedia.map(item => `(candidate.event_id = ${literal(item.eventId)} AND candidate.media_asset_id = ${literal(item.mediaAssetId)})`).join(' OR ')})
      AND NOT EXISTS (
        SELECT 1 FROM mip_app_settings demo_manifest
        WHERE demo_manifest.app_id = candidate.app_id
          AND demo_manifest.setting_key LIKE 'demo_seed_manifest%'
          AND JSON_UNQUOTE(JSON_EXTRACT(demo_manifest.value_json, '$.is_demo')) = '1'
          AND JSON_CONTAINS(
            JSON_EXTRACT(demo_manifest.value_json, '$.recordsByTable.mip_event_content_media'),
            JSON_OBJECT('eventId', candidate.event_id, 'mediaAssetId', candidate.media_asset_id), '$'
          )
      )`)
  selects.push(`SELECT membership_chain.user_id AS id
    FROM mip_membership_chains membership_chain
    WHERE membership_chain.app_id = ${literal(appId)}
      AND membership_chain.user_id IN (${seedIds(seed, 'users').map(literal).join(', ')})
      AND NOT EXISTS (
        SELECT 1 FROM mip_app_settings demo_manifest
        WHERE demo_manifest.app_id = membership_chain.app_id
          AND demo_manifest.setting_key LIKE 'demo_seed_manifest%'
          AND JSON_UNQUOTE(JSON_EXTRACT(demo_manifest.value_json, '$.is_demo')) = '1'
          AND JSON_SEARCH(
            JSON_EXTRACT(demo_manifest.value_json, '$.recordsByTable.mip_membership_chains'),
            'one', membership_chain.user_id
          ) IS NOT NULL
      )`)
  selects.push(alternateKeySelect(appId, 'mip_city_branches', seed.branches, item => `branch_key = ${literal(item.key)}`))
  selects.push(alternateKeySelect(appId, 'mip_tags', seed.tags, item => `kind = ${literal(item.kind)} AND tag_key = ${literal(item.key)}`))
  selects.push(alternateKeySelect(appId, 'mip_membership_plans', seed.membershipPlans, item => `catalog_stage = 'TEST' AND plan_key = ${literal(item.key)}`))
  selects.push(alternateKeySelect(appId, 'mip_growth_levels', seed.growthLevels, item => `(level_key = ${literal(item.key)} OR minimum_experience = ${Number(item.minimumExperience)})`))
  selects.push(alternateKeySelect(appId, 'mip_growth_rules', seed.growthRules, item => `rule_key = ${literal(item.key)}`))
  selects.push(alternateKeySelect(appId, 'mip_badges', seed.badges, item => `badge_key = ${literal(item.key)}`))
  selects.push(alternateKeySelect(
    appId,
    'mip_media_assets',
    seed.mediaAssets,
    item => `object_key LIKE ${literal(`%/${item.id}.${item.extension}`)}`,
  ))
  selects.push(alternateKeySelect(appId, 'mip_orders', seed.membershipOrders, (item, index) => `(merchant_order_no = ${literal(`MIP-DEMO-MEMBER-${index + 1}`)}
      OR (user_id = ${literal(item.userId)} AND order_type = 'MEMBERSHIP'
        AND idempotency_key = ${literal(item.key)}))`))
  selects.push(alternateKeySelect(appId, 'mip_orders', seed.eventOrders, item => `(resource_id = ${literal(item.eventId)}
      AND user_id = ${literal(item.userId)} AND order_type = 'EVENT'
      AND idempotency_key = ${literal(item.key)})`))
  selects.push(alternateKeySelect(appId, 'mip_membership_entitlements', seed.entitlements, item => `order_id = ${literal(item.orderId)}`))
  selects.push(alternateKeySelect(appId, 'mip_event_tags', seed.eventTags, item => `tag_key = ${literal(item.key)}`))
  selects.push(alternateKeySelect(appId, 'mip_event_registrations', seed.eventRegistrations, item => `event_id = ${literal(item.eventId)} AND user_id = ${literal(item.userId)}`))
  selects.push(alternateKeySelect(appId, 'mip_event_checkins', seed.eventCheckins, item => `registration_id = ${literal(item.registrationId)}`))
  selects.push(alternateKeySelect(
    appId,
    'mip_event_checkin_transitions',
    seed.eventCheckinTransitions,
    item => `checkin_id = ${literal(item.checkinId)} AND checkin_version = ${Number(item.checkinVersion)}`,
  ))
  selects.push(alternateKeySelect(appId, 'mip_opportunity_team_members', seed.opportunityTeamMembers, item => `opportunity_id = ${literal(item.opportunityId)}
      AND user_id = ${literal(item.userId)}`))
  selects.push(alternateKeySelect(appId, 'mip_referral_intents', seed.referralIntents, item => `opportunity_id = ${literal(item.opportunityId)}
      AND actor_user_id = ${literal(item.actorUserId)}`))
  selects.push(alternateKeySelect(appId, 'mip_profile_interests', seed.profileInterests, item => `actor_user_id = ${literal(item.actorUserId)}
      AND target_user_id = ${literal(item.targetUserId)}`))
  selects.push(alternateKeySelect(appId, 'mip_opportunity_comment_reports', seed.opportunityCommentReports, item => `reporter_user_id = ${literal(item.reporterUserId)}
      AND request_id = ${literal(item.requestId)}`))
  selects.push(alternateKeySelect(appId, 'mip_matching_requests', seed.matchingRequests, item => `requested_by_user_id = ${literal(item.requestedByUserId)}
      AND idempotency_key = ${literal(item.idempotencyKey)}`))
  selects.push(alternateKeySelect(appId, 'mip_matching_feedback', seed.matchingFeedback, item => `actor_user_id = ${literal(item.actorUserId)}
      AND idempotency_key = ${literal(item.idempotencyKey)}`))
  selects.push(alternateKeySelect(appId, 'mip_cooperation_cards', seed.cooperationCards, item => `owner_user_id = ${literal(item.ownerUserId)}
      AND role_key = ${literal(item.roleKey)} AND status <> 'ARCHIVED'`))
  selects.push(alternateKeySelect(appId, 'mip_announcements', seed.announcements, item => item.isPinned
    ? `pin_scope_key = ${literal(item.scopeType === 'PLATFORM' ? 'PLATFORM' : `BRANCH:${item.branchId}`)}`
    : 'FALSE'))
  selects.push(alternateKeySelect(appId, 'mip_knowledge_sources', seed.knowledgeSources, item => `source_key = ${literal(item.key)}`))
  selects.push(alternateKeySelect(appId, 'mip_knowledge_categories', seed.knowledgeCategories, item => `category_key = ${literal(item.key)}`))
  selects.push(alternateKeySelect(appId, 'mip_knowledge_contents', seed.knowledgeContents, item => `source_id = ${literal(item.sourceId)}
      AND source_external_id = ${literal(item.sourceExternalId)}`))
  selects.push(alternateKeySelect(appId, 'mip_knowledge_products', seed.knowledgeProducts, item => `content_id = ${literal(item.contentId)} AND catalog_stage = 'TEST'`))
  selects.push(alternateKeySelect(appId, 'mip_inbox_messages', seed.inboxMessages, item => `recipient_user_id = ${literal(item.recipientUserId)}
      AND dedupe_key = ${literal(item.dedupeKey)}`))
  selects.push(alternateKeySelect(appId, 'mip_delivery_tasks', seed.deliveryTasks, item => `inbox_message_id = ${literal(item.inboxMessageId)}
      AND channel = ${literal(item.channel)}`))
  selects.push(alternateKeySelect(appId, 'mip_task_assignments', seed.taskAssignments, item => `task_id = ${literal(item.taskId)}
      AND user_id = ${literal(item.userId)}`))
  selects.push(alternateKeySelect(appId, 'mip_task_completions', seed.taskCompletions, item => `task_id = ${literal(item.taskId)}
      AND user_id = ${literal(item.userId)}`))
  selects.push(alternateKeySelect(appId, 'mip_user_badges', seed.badgeAwards, item => `user_id = ${literal(item.userId)}
      AND badge_id = ${literal(item.badgeId)}`))
  selects.push(compositeManifestCollisionSelect({
    appId,
    table: 'mip_user_badge_profiles',
    alias: 'badge_profile',
    items: seed.badgeProfiles,
    condition: item => `user_id = ${literal(item.userId)}`,
    recordFields: { userId: 'user_id' },
  }))
  selects.push(compositeManifestCollisionSelect({
    appId,
    table: 'mip_user_badge_equipment',
    alias: 'badge_equipment',
    items: seed.badgeEquipment,
    condition: item => `user_id = ${literal(item.userId)} AND slot_no = ${Number(item.slotNo)}`,
    recordFields: { userId: 'user_id', slotNo: 'slot_no' },
  }))
  selects.push(alternateKeySelect(appId, 'mip_growth_entries', seed.growthEntries, item => `user_id = ${literal(item.userId)}
      AND source_event_type = ${literal(item.sourceEventType)}
      AND source_event_id = ${literal(item.sourceEventId)} AND metric = ${literal(item.metric)}`))
  selects.push(alternateKeySelect(appId, 'mip_game_seasons', seed.gameSeasons, item => `season_key = ${literal(item.key)}`))
  selects.push(alternateKeySelect(appId, 'mip_game_teams', seed.gameTeams, item => `season_id = ${literal(item.seasonId)}
      AND name = ${literal(item.name)}`))
  selects.push(alternateKeySelect(appId, 'mip_game_team_memberships', seed.gameTeamMemberships, item => `season_id = ${literal(item.seasonId)}
      AND user_id = ${literal(item.userId)} AND status = 'ACTIVE'`))
  selects.push(alternateKeySelect(appId, 'mip_game_weekly_matches', seed.gameWeeklyMatches, item => `season_id = ${literal(item.seasonId)}
      AND week_start = ${literal(item.weekStart)} AND team_a_id = ${literal(item.teamAId)}
      AND team_b_id = ${literal(item.teamBId)}`))
  selects.push(alternateKeySelect(appId, 'mip_blind_box_catalogs', seed.blindBoxCatalogs, item => `catalog_key = ${literal(item.key)}`))
  selects.push(alternateKeySelect(appId, 'mip_blind_box_cards', seed.blindBoxCards, item => `catalog_id = ${literal(item.catalogId)}
      AND card_key = ${literal(item.cardKey)}`))
  const interactions = seed.opportunityInteractions
  const influence = userInfluenceFixtures(seed)
  selects.push(compositeManifestCollisionSelect({
    appId,
    table: 'mip_event_tag_assignments',
    alias: 'event_tag_assignment',
    items: eventTagAssignmentFixtures(seed),
    condition: item => `event_id = ${literal(item.eventId)} AND tag_id = ${literal(item.tagId)}`,
    recordFields: { eventId: 'event_id', tagId: 'tag_id' },
  }))
  selects.push(compositeManifestCollisionSelect({
    appId,
    table: 'mip_event_invitation_attributions',
    alias: 'event_invitation',
    items: influence.eventInvitationAttributions,
    condition: item => `registration_id = ${literal(item.registrationId)}`,
    recordFields: { registrationId: 'registration_id' },
  }))
  selects.push(compositeManifestCollisionSelect({
    appId,
    table: 'mip_event_hearts',
    alias: 'event_heart',
    items: influence.eventHearts,
    condition: item => `id = ${literal(item.id)}`,
    recordFields: { id: 'id' },
  }))
  selects.push(alternateKeySelect(
    appId,
    'mip_event_hearts',
    influence.eventHearts,
    item => `event_id = ${literal(item.eventId)} AND voter_user_id = ${literal(item.voterUserId)}`,
  ))
  selects.push(compositeManifestCollisionSelect({
    appId,
    table: 'mip_profile_visits',
    alias: 'profile_visit',
    items: influence.profileVisits,
    condition: item => `id = ${literal(item.id)}`,
    recordFields: { id: 'id' },
  }))
  selects.push(alternateKeySelect(
    appId,
    'mip_profile_visits',
    influence.profileVisits,
    item => `visitor_user_id = ${literal(item.visitorUserId)}
      AND profile_user_id = ${literal(item.profileUserId)} AND visit_key = ${literal(item.visitKey)}`,
  ))
  selects.push(compositeManifestCollisionSelect({
    appId,
    table: 'mip_opportunity_comment_settings',
    alias: 'comment_setting',
    items: interactions.commentSettings,
    condition: item => `opportunity_id = ${literal(item.opportunityId)}`,
    recordFields: { opportunityId: 'opportunity_id' },
  }))
  selects.push(compositeManifestCollisionSelect({
    appId,
    table: 'mip_opportunity_comment_calls',
    alias: 'comment_call',
    items: interactions.commentCalls,
    condition: item => `comment_id = ${literal(item.commentId)} AND actor_user_id = ${literal(item.actorUserId)}`,
    recordFields: { commentId: 'comment_id', actorUserId: 'actor_user_id' },
  }))
  selects.push(compositeManifestCollisionSelect({
    appId,
    table: 'mip_user_blocks',
    alias: 'user_block',
    items: interactions.userBlocks,
    condition: item => `blocker_user_id = ${literal(item.blockerUserId)} AND blocked_user_id = ${literal(item.blockedUserId)}`,
    recordFields: { blockerUserId: 'blocker_user_id', blockedUserId: 'blocked_user_id' },
  }))
  selects.push(compositeManifestCollisionSelect({
    appId,
    table: 'mip_user_opportunity_preferences',
    alias: 'matching_preference',
    items: interactions.userOpportunityPreferences,
    condition: item => `user_id = ${literal(item.userId)}`,
    recordFields: { userId: 'user_id' },
  }))
  selects.push(compositeManifestCollisionSelect({
    appId,
    table: 'mip_matching_settings',
    alias: 'matching_setting',
    items: interactions.matchingSettings,
    condition: item => `scope_key = ${literal(item.scopeKey)}`,
    recordFields: { scopeKey: 'scope_key' },
  }))
  selects.push(compositeManifestCollisionSelect({
    appId,
    table: 'mip_matching_results',
    alias: 'matching_result',
    items: interactions.matchingResults,
    condition: item => `request_id = ${literal(item.requestId)} AND result_version = ${Number(item.resultVersion)}
      AND candidate_type = ${literal(item.candidateType)}
      AND (candidate_id = ${literal(item.candidateId)} OR rank_no = ${Number(item.rankNo)})`,
    recordFields: {
      requestId: 'request_id',
      resultVersion: 'result_version',
      candidateType: 'candidate_type',
      candidateId: 'candidate_id',
    },
  }))
  return `SELECT COUNT(*) AS conflicts FROM (\n${selects.join('\nUNION ALL\n')}\n) seed_same_app_collisions`
}

export function assertSeedSqlScope(statements) {
  if (!Array.isArray(statements) || statements.length === 0) {
    throw new Error('MIP demo seed SQL plan is empty')
  }
  const tables = new Set()
  const tablePatterns = [
    /\b(?:INSERT\s+INTO|DELETE\s+FROM|FROM|JOIN)\s+`?(\w+)`?/gi,
    /^\s*UPDATE\s+`?(\w+)`?/gi,
  ]
  for (const statement of statements) {
    if (typeof statement !== 'string' || !statement.trim()) {
      throw new Error('MIP demo seed SQL statement is invalid')
    }
    for (const tablePattern of tablePatterns) {
      for (const match of statement.matchAll(tablePattern)) {
        const table = match[1]
        if (!table.startsWith('mip_')) {
          throw new Error(`MIP demo seed SQL references non-MIP table ${table}`)
        }
        tables.add(table)
      }
    }
    if (/\b(?:INSERT|UPDATE|DELETE)\b/i.test(statement) && !/\bapp_id\b/i.test(statement)) {
      throw new Error('MIP demo seed write is missing AppID scope')
    }
  }
  return Object.freeze({ statementCount: statements.length, tables: Object.freeze([...tables].sort()) })
}

function seedIds(seed, group) {
  const ids = Array.isArray(seed?.[group]) ? seed[group].map(item => String(item?.id || '')) : []
  if (!ids.length || ids.some(id => !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))) {
    throw new Error(`MIP demo seed ${group} identities are invalid`)
  }
  return ids
}

function userInfluenceFixtures(seed) {
  const influence = seed?.userInfluence
  if (!influence || typeof influence !== 'object' || Array.isArray(influence)) {
    throw new Error('MIP demo seed user influence fixtures are invalid')
  }
  for (const group of ['eventInvitationAttributions', 'eventHearts', 'profileVisits']) {
    if (!Array.isArray(influence[group]) || influence[group].length === 0) {
      throw new Error(`MIP demo seed user influence ${group} fixtures are invalid`)
    }
  }
  if (influence.eventInvitationAttributions.some(item => !isUuid(item?.registrationId))
    || influence.eventHearts.some(item => !isUuid(item?.id))
    || influence.profileVisits.some(item => !isUuid(item?.id))) {
    throw new Error('MIP demo seed user influence identities are invalid')
  }
  return influence
}

function eventTagAssignmentFixtures(seed) {
  if (!Array.isArray(seed?.events) || !seed.events.length) {
    throw new Error('MIP demo event tag assignments are invalid')
  }
  const assignments = seed.events.flatMap(event => (
    Array.isArray(event?.tagIds)
      ? event.tagIds.map(tagId => ({ eventId: event.id, tagId }))
      : []
  ))
  if (!assignments.length || assignments.some(item => !isUuid(item.eventId) || !isUuid(item.tagId))) {
    throw new Error('MIP demo event tag assignments are invalid')
  }
  return assignments
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(String(value || ''))
}

function alternateKeySelect(appId, table, items, condition) {
  if (!Array.isArray(items) || !items.length) {
    throw new Error(`MIP demo seed ${table} alternate identities are invalid`)
  }
  return `SELECT id FROM ${table}
    WHERE app_id = ${literal(appId)}
      AND (${items.map((item, index) => `((${condition(item, index)}) AND id <> ${literal(item.id)})`).join('\n        OR ')})`
}

function compositeManifestCollisionSelect({ appId, table, alias, items, condition, recordFields }) {
  if (!Array.isArray(items) || !items.length) {
    throw new Error(`MIP demo seed ${table} composite identities are invalid`)
  }
  const jsonObject = Object.entries(recordFields)
    .flatMap(([key, column]) => [literal(key), `${alias}.${column}`])
    .join(', ')
  return `SELECT ${alias}.app_id AS id FROM ${table} ${alias}
    WHERE ${alias}.app_id = ${literal(appId)}
      AND (${items.map(item => `((${condition(item)}))`).join('\n        OR ')})
      AND NOT EXISTS (
        SELECT 1 FROM mip_app_settings demo_manifest
        WHERE demo_manifest.app_id = ${alias}.app_id
          AND demo_manifest.setting_key LIKE 'demo_seed_manifest%'
          AND JSON_UNQUOTE(JSON_EXTRACT(demo_manifest.value_json, '$.is_demo')) = '1'
          AND JSON_CONTAINS(
            JSON_EXTRACT(demo_manifest.value_json, '$.recordsByTable.${table}'),
            JSON_OBJECT(${jsonObject})
          ) = 1
      )`
}

function literal(value) {
  return `'${String(value).replaceAll('\\', '\\\\').replaceAll('\'', '\\\'')}'`
}

export function seedOwnershipConflictCount(value) {
  if (!value || typeof value !== 'object') {
    return null
  }
  if (!Array.isArray(value) && Object.hasOwn(value, 'conflicts')) {
    const count = Number(value.conflicts)
    return Number.isInteger(count) && count >= 0 ? count : null
  }
  for (const child of Object.values(value)) {
    const found = seedOwnershipConflictCount(child)
    if (found !== null) {
      return found
    }
  }
  return null
}

export { SEED_TABLES }
