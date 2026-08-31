'use strict'

const { randomUUID } = require('node:crypto')
const { lockActiveContributor } = require('../lib/auth')
const { createProfileRef, readProfileRef } = require('../lib/profile-ref')
const { confirmAiDraft, normalizeAiConfirmation } = require('./ai-confirmation')
const {
  assertCommercialTerms,
  legacyTerms,
  loadCommercialTerms,
  normalizeCommercialTerms,
  syncCommercialTerms,
} = require('./commercial-terms')
const {
  ROLE_KEYS,
  appendAudit,
  appendOutbox,
  decodeCursor,
  encodeCursor,
  idempotentTransaction,
  iso,
  jsonObject,
  mutualBlockFilter,
  stringList,
  stringValue,
  uuid,
} = require('./common')

const OWNER_EDITABLE_OPPORTUNITY_STATUSES = new Set(['DRAFT', 'PUBLISHED'])

function canOwnerEditOpportunity(status) {
  return OWNER_EDITABLE_OPPORTUNITY_STATUSES.has(status)
}

function limit(value, fallback = 12) {
  const parsed = Number(value)
  return Math.min(30, Math.max(1, Number.isInteger(parsed) ? parsed : fallback))
}

function likePattern(value) {
  return `%${String(value).replace(/=/g, '==').replace(/%/g, '=%').replace(/_/g, '=_')}%`
}

function normalizeFilter(value = {}) {
  const status = value.status === 'COMPLETED' ? 'ENDED' : 'PUBLISHED'
  const keyword = stringValue(value.keyword, 80, 'VALIDATION_FAILED', false)
  const cityTagId = stringValue(value.cityTagId, 64, 'VALIDATION_FAILED', false)
  const branchId = stringValue(value.branchId, 36, 'VALIDATION_FAILED', false)
  const roleKey = stringValue(value.roleKey, 32, 'VALIDATION_FAILED', false)
  if (roleKey && !ROLE_KEYS.has(roleKey)) throw new Error('VALIDATION_FAILED')
  const locationTypes = [...new Set(Array.isArray(value.locationTypes) ? value.locationTypes : [])]
  if (locationTypes.some(item => !['CITY', 'NATIONAL', 'REMOTE'].includes(item)) || locationTypes.length > 3) {
    throw new Error('VALIDATION_FAILED')
  }
  const locationCityTagIds = stringList(value.locationCityTagIds, 8, 'VALIDATION_FAILED', uuid)
  const minAmountCents = value.minAmountCents === undefined || value.minAmountCents === ''
    ? undefined
    : Number(value.minAmountCents)
  const maxAmountCents = value.maxAmountCents === undefined || value.maxAmountCents === ''
    ? undefined
    : Number(value.maxAmountCents)
  if ((minAmountCents !== undefined && (!Number.isSafeInteger(minAmountCents) || minAmountCents < 0))
    || (maxAmountCents !== undefined && (!Number.isSafeInteger(maxAmountCents) || maxAmountCents < 0))
    || (minAmountCents !== undefined && maxAmountCents !== undefined && minAmountCents > maxAmountCents)) {
    throw new Error('VALIDATION_FAILED')
  }
  return {
    status,
    keyword,
    cityTagId,
    locationTypes,
    locationCityTagIds,
    minAmountCents,
    maxAmountCents,
    branchId,
    roleKey,
    industryTagIds: stringList(value.industryTagIds, 8, 'VALIDATION_FAILED', uuid),
    abilityTagIds: stringList(value.abilityTagIds, 8, 'VALIDATION_FAILED', uuid),
    cursor: decodeCursor(value.cursor),
    limit: limit(value.limit),
  }
}

function normalizeDraft(value = {}) {
  const roleKeys = stringList(value.roleKeys, 6, 'VALIDATION_FAILED', key => ROLE_KEYS.has(key))
  if (!roleKeys.length) throw new Error('VALIDATION_FAILED')
  const scopeType = value.scopeType === 'BRANCH' ? 'BRANCH' : 'PLATFORM'
  const branchId = scopeType === 'BRANCH' ? stringValue(value.branchId, 36, 'VALIDATION_FAILED') : null
  if (branchId && !uuid(branchId)) throw new Error('VALIDATION_FAILED')
  const cityTagId = stringValue(value.cityTagId, 36, 'VALIDATION_FAILED', false) || null
  const coverAssetId = stringValue(value.coverAssetId, 36, 'VALIDATION_FAILED', false) || null
  if ((cityTagId && !uuid(cityTagId)) || (coverAssetId && !uuid(coverAssetId))) {
    throw new Error('VALIDATION_FAILED')
  }
  return {
    id: value.id && uuid(value.id) ? value.id : null,
    expectedVersion: value.expectedVersion === undefined ? null : Number(value.expectedVersion),
    title: stringValue(value.title, 120, 'VALIDATION_FAILED'),
    valueSummary: stringValue(value.valueSummary, 240, 'VALIDATION_FAILED'),
    targetSummary: stringValue(value.targetSummary, 500, 'VALIDATION_FAILED'),
    description: stringValue(value.description, 6000, 'VALIDATION_FAILED'),
    scopeType,
    branchId,
    cityTagId,
    commercialTerms: normalizeCommercialTerms(value.commercialTerms),
    coverAssetId,
    roleKeys,
    industryTagIds: stringList(value.industryTagIds, 8, 'VALIDATION_FAILED', uuid),
    abilityTagIds: stringList(value.abilityTagIds, 8, 'VALIDATION_FAILED', uuid),
    teamProfileRefs: profileRefList(value.teamProfileRefs),
    publish: Boolean(value.publish),
  }
}

function profileRefList(value) {
  const result = Array.isArray(value)
    ? [...new Set(value.map(item => String(item).trim()).filter(Boolean))]
    : []
  if (result.length > 8 || result.some(item => item.length < 20 || item.length > 200 || !item.startsWith('p1.'))) {
    throw new Error('VALIDATION_FAILED')
  }
  return result
}

async function getCatalogs(database, caller) {
  const [branches, tags] = await Promise.all([
    database.query(
      `SELECT id, name, city_name
       FROM mip_city_branches
       WHERE app_id = ? AND status = 'ACTIVE'
       ORDER BY city_name, id`,
      [caller.appId],
    ),
    database.query(
      `SELECT t.id, t.kind, t.parent_id, t.tag_key, t.label, t.selectable, t.popular
       FROM mip_tags t
       LEFT JOIN mip_tags parent
         ON parent.app_id = t.app_id AND parent.id = t.parent_id
       WHERE t.app_id = ? AND t.enabled = 1
         AND (
           (t.kind IN ('CITY', 'ABILITY') AND t.selectable = 1)
           OR (
             t.kind = 'INDUSTRY'
             AND (
               (t.parent_id IS NULL AND t.selectable = 0)
               OR (
                 t.selectable = 1
                 AND parent.kind = 'INDUSTRY'
                 AND parent.parent_id IS NULL
                 AND parent.selectable = 0
                 AND parent.enabled = 1
               )
             )
           )
         )
       ORDER BY t.kind,
         COALESCE(parent.sort_order, t.sort_order),
         CASE WHEN t.parent_id IS NULL THEN 0 ELSE 1 END,
         t.sort_order, t.id`,
      [caller.appId],
    ),
  ])
  const tag = row => ({
    id: row.id,
    key: row.tag_key,
    label: row.label,
    popular: Boolean(row.popular),
  })
  const industryParents = tags.filter(row => row.kind === 'INDUSTRY' && !row.parent_id)
  const industryChildren = tags.filter(row => row.kind === 'INDUSTRY' && row.parent_id)
  const industryGroups = industryParents.map(parent => ({
    ...tag(parent),
    options: industryChildren
      .filter(child => child.parent_id === parent.id)
      .map(tag),
  })).filter(group => group.options.length)
  return {
    branches: branches.map(row => ({ id: row.id, name: row.name, cityName: row.city_name })),
    cityTags: tags.filter(row => row.kind === 'CITY').map(tag),
    industryGroups,
    industryTags: industryGroups.flatMap(group => group.options),
    abilityTags: tags.filter(row => row.kind === 'ABILITY').map(tag),
  }
}

async function relatedData(database, caller, ids) {
  if (!ids.length) return { roles: new Map(), industry: new Map(), ability: new Map(), team: new Map(), commercialTerms: new Map() }
  const placeholders = ids.map(() => '?').join(', ')
  const blockFilter = mutualBlockFilter(caller.userId, 'u.id', 'u.app_id')
  const [roles, tags, team, commercialTerms] = await Promise.all([
    database.query(
      `SELECT opportunity_id, role_key
       FROM mip_opportunity_roles
       WHERE app_id = ? AND opportunity_id IN (${placeholders})
       ORDER BY role_key`,
      [caller.appId, ...ids],
    ),
    database.query(
      `SELECT ot.opportunity_id, ot.relation, t.id, t.tag_key, t.label
       FROM mip_opportunity_tags ot
       INNER JOIN mip_tags t ON t.app_id = ot.app_id AND t.id = ot.tag_id
       WHERE ot.app_id = ? AND ot.opportunity_id IN (${placeholders})
       ORDER BY ot.relation, t.sort_order, t.id`,
      [caller.appId, ...ids],
    ),
    database.query(
      `SELECT member.opportunity_id, member.user_id,
              p.nickname, p.headline, p.visibility_json,
              avatar.cloud_file_id AS avatar_file_id
       FROM mip_opportunity_team_members member
       INNER JOIN mip_users u
         ON u.app_id = member.app_id AND u.id = member.user_id AND u.status = 'ACTIVE'
       INNER JOIN mip_profiles p ON p.app_id = u.app_id AND p.user_id = u.id
       LEFT JOIN mip_media_assets avatar
         ON avatar.app_id = p.app_id AND avatar.id = p.avatar_asset_id AND avatar.status = 'READY'
       WHERE member.app_id = ? AND member.opportunity_id IN (${placeholders})
         AND member.status = 'ACTIVE'
         AND EXISTS (
           SELECT 1 FROM mip_membership_entitlements entitlement
           WHERE entitlement.app_id = u.app_id AND entitlement.user_id = u.id
             AND entitlement.status = 'ACTIVE'
             AND entitlement.starts_at <= UTC_TIMESTAMP(3)
             AND entitlement.ends_at > UTC_TIMESTAMP(3)
         )
         ${blockFilter.sql ? `AND ${blockFilter.sql}` : ''}
       ORDER BY member.opportunity_id, member.sort_order, member.id`,
      [caller.appId, ...ids, ...blockFilter.params],
    ),
    loadCommercialTerms(database, caller.appId, ids),
  ])
  const result = { roles: new Map(), industry: new Map(), ability: new Map(), team: new Map(), commercialTerms }
  for (const row of roles) {
    const list = result.roles.get(row.opportunity_id) || []
    list.push(row.role_key)
    result.roles.set(row.opportunity_id, list)
  }
  for (const row of tags) {
    const target = row.relation === 'INDUSTRY' ? result.industry : result.ability
    const list = target.get(row.opportunity_id) || []
    list.push({ id: row.id, key: row.tag_key, label: row.label })
    target.set(row.opportunity_id, list)
  }
  for (const row of team) {
    const visibility = jsonObject(row.visibility_json)
    const list = result.team.get(row.opportunity_id) || []
    list.push({
      profileRef: createProfileRef({ appId: caller.appId, userId: row.user_id }, caller.profileRefSecret),
      nickname: visibility.nickname === false ? 'MIP 用户' : (row.nickname || 'MIP 用户'),
      avatarUrl: visibility.avatar === false ? undefined : (row.avatar_file_id || undefined),
      headline: visibility.headline === false ? undefined : (row.headline || undefined),
      userKind: 'PLAYER',
    })
    result.team.set(row.opportunity_id, list)
  }
  return result
}

function opportunitySummary(row, related, caller) {
  const profileVisibility = jsonObject(row.visibility_json)
  const commercialTerms = related.commercialTerms.get(row.id) || legacyTerms(row)
  return {
    id: row.id,
    title: row.title,
    valueSummary: row.value_summary,
    targetSummary: row.target_summary,
    city: row.city_tag_id ? { id: row.city_tag_id, key: row.city_key, label: row.city_label } : undefined,
    ...(commercialTerms ? { commercialTerms } : {}),
    branchId: row.branch_id || undefined,
    branchName: row.branch_name || undefined,
    coverUrl: row.cover_file_id || undefined,
    roles: related.roles.get(row.id) || [],
    industryTags: related.industry.get(row.id) || [],
    abilityTags: related.ability.get(row.id) || [],
    teamMembers: related.team.get(row.id) || [],
    referralCount: Number(row.referral_count || 0),
    status: row.status,
    publishedAt: iso(row.published_at),
    author: {
      profileRef: createProfileRef({ appId: caller.appId, userId: row.owner_user_id }, caller.profileRefSecret),
      nickname: profileVisibility.nickname === false ? 'MIP 用户' : (row.nickname || 'MIP 用户'),
      avatarUrl: profileVisibility.avatar === false ? undefined : (row.avatar_file_id || undefined),
      headline: profileVisibility.headline === false ? undefined : (row.headline || undefined),
    },
    mine: Boolean(caller.userId && caller.userId === row.owner_user_id),
  }
}

const opportunitySelect = `
  SELECT o.id, o.owner_user_id, o.branch_id, o.title, o.value_summary,
         o.target_summary, o.description, o.city_tag_id, o.status,
         o.cover_asset_id, o.referral_count, o.version, o.published_at, o.updated_at,
         b.name AS branch_name,
         city.tag_key AS city_key, city.label AS city_label,
         cover.cloud_file_id AS cover_file_id,
         p.nickname, p.headline, p.visibility_json, avatar.cloud_file_id AS avatar_file_id
  FROM mip_opportunities o
  INNER JOIN mip_profiles p ON p.app_id = o.app_id AND p.user_id = o.owner_user_id
  LEFT JOIN mip_city_branches b ON b.app_id = o.app_id AND b.id = o.branch_id
  LEFT JOIN mip_tags city ON city.app_id = o.app_id AND city.id = o.city_tag_id
  LEFT JOIN mip_media_assets cover
    ON cover.app_id = o.app_id AND cover.id = o.cover_asset_id AND cover.status = 'READY'
  LEFT JOIN mip_media_assets avatar
    ON avatar.app_id = p.app_id AND avatar.id = p.avatar_asset_id AND avatar.status = 'READY'`

async function listOpportunities(database, caller, rawFilter) {
  const filter = normalizeFilter(rawFilter)
  const expectedTags = [
    ...(filter.cityTagId ? [[filter.cityTagId, 'CITY']] : []),
    ...filter.industryTagIds.map(id => [id, 'INDUSTRY']),
    ...filter.abilityTagIds.map(id => [id, 'ABILITY']),
  ]
  await assertSelectableTags(database, caller.appId, expectedTags)
  const where = ['o.app_id = ?', 'o.status = ?']
  const params = [caller.appId, filter.status]
  const blockFilter = mutualBlockFilter(caller.userId, 'o.owner_user_id', 'o.app_id')
  if (blockFilter.sql) {
    where.push(blockFilter.sql)
    params.push(...blockFilter.params)
  }
  if (filter.keyword) {
    const pattern = likePattern(filter.keyword)
    where.push(`(
      o.title LIKE ? ESCAPE '=' OR o.value_summary LIKE ? ESCAPE '='
      OR o.target_summary LIKE ? ESCAPE '=' OR o.description LIKE ? ESCAPE '='
    )`)
    params.push(pattern, pattern, pattern, pattern)
  }
  if (filter.cityTagId) {
    if (!uuid(filter.cityTagId)) throw new Error('VALIDATION_FAILED')
    where.push(`(o.city_tag_id = ? OR EXISTS (
      SELECT 1 FROM mip_opportunity_locations location
      WHERE location.app_id = o.app_id AND location.opportunity_id = o.id
        AND location.location_type = 'CITY' AND location.city_tag_id = ?
    ))`)
    params.push(filter.cityTagId, filter.cityTagId)
  }
  if (filter.locationTypes.length) {
    where.push(`EXISTS (
      SELECT 1 FROM mip_opportunity_locations location
      WHERE location.app_id = o.app_id AND location.opportunity_id = o.id
        AND location.location_type IN (${filter.locationTypes.map(() => '?').join(', ')})
    )`)
    params.push(...filter.locationTypes)
  }
  if (filter.locationCityTagIds.length) {
    where.push(`EXISTS (
      SELECT 1 FROM mip_opportunity_locations location
      WHERE location.app_id = o.app_id AND location.opportunity_id = o.id
        AND location.location_type = 'CITY' AND location.city_tag_id IN (${filter.locationCityTagIds.map(() => '?').join(', ')})
    )`)
    params.push(...filter.locationCityTagIds)
  }
  if (filter.minAmountCents !== undefined) {
    where.push(`EXISTS (
      SELECT 1 FROM mip_opportunity_commercial_terms terms
      WHERE terms.app_id = o.app_id AND terms.opportunity_id = o.id AND terms.status = 'ACTIVE'
        AND COALESCE(terms.max_amount_cents, 18446744073709551615) >= ?
    )`)
    params.push(filter.minAmountCents)
  }
  if (filter.maxAmountCents !== undefined) {
    where.push(`EXISTS (
      SELECT 1 FROM mip_opportunity_commercial_terms terms
      WHERE terms.app_id = o.app_id AND terms.opportunity_id = o.id AND terms.status = 'ACTIVE'
        AND COALESCE(terms.min_amount_cents, 0) <= ?
    )`)
    params.push(filter.maxAmountCents)
  }
  if (filter.branchId) {
    if (!uuid(filter.branchId)) throw new Error('VALIDATION_FAILED')
    where.push('o.branch_id = ?')
    params.push(filter.branchId)
  }
  if (filter.roleKey) {
    where.push(`EXISTS (
      SELECT 1 FROM mip_opportunity_roles r
      WHERE r.app_id = o.app_id AND r.opportunity_id = o.id AND r.role_key = ?
    )`)
    params.push(filter.roleKey)
  }
  for (const [relation, ids] of [['INDUSTRY', filter.industryTagIds], ['ABILITY', filter.abilityTagIds]]) {
    if (ids.length) {
      where.push(`EXISTS (
        SELECT 1 FROM mip_opportunity_tags f
        WHERE f.app_id = o.app_id AND f.opportunity_id = o.id
          AND f.relation = ? AND f.tag_id IN (${ids.map(() => '?').join(', ')})
      )`)
      params.push(relation, ...ids)
    }
  }
  if (filter.cursor) {
    where.push('(o.published_at < ? OR (o.published_at = ? AND o.id < ?))')
    params.push(filter.cursor.timestamp, filter.cursor.timestamp, filter.cursor.id)
  }
  const rows = await database.query(
    `${opportunitySelect}
     WHERE ${where.join(' AND ')}
     ORDER BY o.published_at DESC, o.id DESC
     LIMIT ${filter.limit + 1}`,
    params,
  )
  const pageRows = rows.slice(0, filter.limit)
  const related = await relatedData(database, caller, pageRows.map(row => row.id))
  return {
    items: pageRows.map(row => opportunitySummary(row, related, caller)),
    nextCursor: rows.length > filter.limit && pageRows.length
      ? encodeCursor(pageRows.at(-1).published_at, pageRows.at(-1).id)
      : undefined,
  }
}

async function listMine(database, caller, input = {}) {
  if (!caller.userId) throw new Error('AUTH_REQUIRED')
  const pageLimit = limit(input.limit, 20)
  const cursor = decodeCursor(input.cursor)
  const params = [caller.appId, caller.userId]
  const cursorSql = cursor
    ? 'AND (o.updated_at < ? OR (o.updated_at = ? AND o.id < ?))'
    : ''
  if (cursor) params.push(cursor.timestamp, cursor.timestamp, cursor.id)
  const rows = await database.query(
    `${opportunitySelect}
     WHERE o.app_id = ? AND o.owner_user_id = ? AND o.status <> 'ARCHIVED' ${cursorSql}
     ORDER BY o.updated_at DESC, o.id DESC
     LIMIT ${pageLimit + 1}`,
    params,
  )
  const pageRows = rows.slice(0, pageLimit)
  const related = await relatedData(database, caller, pageRows.map(row => row.id))
  return {
    items: pageRows.map(row => opportunitySummary(row, related, caller)),
    nextCursor: rows.length > pageLimit && pageRows.length
      ? encodeCursor(pageRows.at(-1).updated_at, pageRows.at(-1).id)
      : undefined,
  }
}

async function getOpportunity(database, caller, id) {
  if (!uuid(id)) throw new Error('NOT_FOUND')
  const blockFilter = mutualBlockFilter(caller.userId, 'o.owner_user_id', 'o.app_id')
  const row = await database.one(
    `${opportunitySelect}
     WHERE o.app_id = ? AND o.id = ?
       ${blockFilter.sql ? `AND ${blockFilter.sql}` : ''}`,
    [caller.appId, id, ...blockFilter.params],
  )
  if (!row) throw new Error('NOT_FOUND')
  if (row.status === 'ARCHIVED') throw new Error('NOT_FOUND')
  const mine = Boolean(caller.userId && caller.userId === row.owner_user_id)
  if (!['PUBLISHED', 'ENDED'].includes(row.status) && !mine) {
    throw new Error('NOT_FOUND')
  }
  const related = await relatedData(database, caller, [row.id])
  let referralActive = false
  let referralTarget
  let interestActive = false
  if (caller.userId) {
    const targetBlock = mutualBlockFilter(caller.userId, 'target.id', 'target.app_id')
    const [referral, interest] = await Promise.all([
      database.one(
        `SELECT referral.status, target.id AS visible_target_user_id,
                profile.nickname, profile.headline, profile.visibility_json,
                avatar.cloud_file_id AS avatar_file_id
         FROM mip_referral_intents referral
         LEFT JOIN mip_users target
           ON target.app_id = referral.app_id AND target.id = referral.target_user_id
             AND target.status = 'ACTIVE' AND ${targetBlock.sql}
         LEFT JOIN mip_profiles profile
           ON profile.app_id = target.app_id AND profile.user_id = target.id
         LEFT JOIN mip_media_assets avatar
           ON avatar.app_id = profile.app_id AND avatar.id = profile.avatar_asset_id
             AND avatar.status = 'READY'
         WHERE referral.app_id = ? AND referral.opportunity_id = ?
           AND referral.actor_user_id = ?`,
        [...targetBlock.params, caller.appId, row.id, caller.userId],
      ),
      database.one(
        `SELECT status FROM mip_profile_interests
         WHERE app_id = ? AND actor_user_id = ? AND target_user_id = ?`,
        [caller.appId, caller.userId, row.owner_user_id],
      ),
    ])
    referralActive = referral?.status === 'ACTIVE'
    if (referralActive && referral.visible_target_user_id) {
      const visibility = jsonObject(referral.visibility_json)
      referralTarget = {
        profileRef: createProfileRef(
          { appId: caller.appId, userId: referral.visible_target_user_id },
          caller.profileRefSecret,
        ),
        nickname: visibility.nickname === false ? 'MIP 用户' : (referral.nickname || 'MIP 用户'),
        avatarUrl: visibility.avatar === false ? undefined : (referral.avatar_file_id || undefined),
        headline: visibility.headline === false ? undefined : (referral.headline || undefined),
      }
    }
    interestActive = interest?.status === 'ACTIVE'
  }
  return {
    ...opportunitySummary(row, related, caller),
    description: row.description,
    coverAssetId: mine ? (row.cover_asset_id || undefined) : undefined,
    version: Number(row.version),
    referralActive,
    referralTarget,
    interestActive,
    canEdit: mine && canOwnerEditOpportunity(row.status),
  }
}

async function resolveReferralTarget(tx, caller, profileRef) {
  const targetUserId = readProfileRef(profileRef, caller.appId, caller.profileRefSecret)
  if (targetUserId === caller.userId) throw new Error('CONFLICT')
  const blockFilter = mutualBlockFilter(caller.userId, 'target.id', 'target.app_id')
  const target = await tx.one(
    `SELECT target.id
     FROM mip_users target
     INNER JOIN mip_profiles profile
       ON profile.app_id = target.app_id AND profile.user_id = target.id
     WHERE target.app_id = ? AND target.id = ? AND target.status = 'ACTIVE'
       AND ${blockFilter.sql}
     FOR UPDATE`,
    [caller.appId, targetUserId, ...blockFilter.params],
  )
  if (!target) throw new Error('NOT_FOUND')
  return target.id
}

async function assertReferences(tx, caller, draft) {
  if (draft.branchId) {
    const branch = await tx.one(
      `SELECT 1 AS found FROM mip_city_branches
       WHERE app_id = ? AND id = ? AND status = 'ACTIVE'`,
      [caller.appId, draft.branchId],
    )
    if (!branch) throw new Error('VALIDATION_FAILED')
  }
  if (draft.coverAssetId) {
    const asset = await tx.one(
      `SELECT 1 AS found FROM mip_media_assets
       WHERE app_id = ? AND id = ? AND owner_user_id = ?
         AND purpose = 'OPPORTUNITY_COVER' AND status = 'READY'`,
      [caller.appId, draft.coverAssetId, caller.userId],
    )
    if (!asset) throw new Error('VALIDATION_FAILED')
  }
  const expectedTags = [
    ...(draft.cityTagId ? [[draft.cityTagId, 'CITY']] : []),
    ...draft.industryTagIds.map(id => [id, 'INDUSTRY']),
    ...draft.abilityTagIds.map(id => [id, 'ABILITY']),
  ]
  await assertSelectableTags(tx, caller.appId, expectedTags)
  await assertCommercialTerms(tx, caller.appId, draft.commercialTerms)
}

async function resolveTeamUserIds(tx, caller, profileRefs) {
  if (!profileRefs.length) return []
  let userIds
  try {
    userIds = [...new Set(profileRefs.map(profileRef => (
      readProfileRef(profileRef, caller.appId, caller.profileRefSecret)
    )))]
  }
  catch (error) {
    if (error?.message === 'IDENTITY_CONFIG_REQUIRED') throw error
    throw new Error('VALIDATION_FAILED')
  }
  if (userIds.includes(caller.userId)) throw new Error('VALIDATION_FAILED')
  const blockFilter = mutualBlockFilter(caller.userId, 'u.id', 'u.app_id')
  const rows = await tx.query(
    `SELECT u.id
     FROM mip_users u
     INNER JOIN mip_profiles profile ON profile.app_id = u.app_id AND profile.user_id = u.id
     WHERE u.app_id = ? AND u.id IN (${userIds.map(() => '?').join(', ')})
       AND u.status = 'ACTIVE'
       AND EXISTS (
         SELECT 1 FROM mip_membership_entitlements entitlement
         WHERE entitlement.app_id = u.app_id AND entitlement.user_id = u.id
           AND entitlement.status = 'ACTIVE'
           AND entitlement.starts_at <= UTC_TIMESTAMP(3)
           AND entitlement.ends_at > UTC_TIMESTAMP(3)
       )
       ${blockFilter.sql ? `AND ${blockFilter.sql}` : ''}
     FOR UPDATE`,
    [caller.appId, ...userIds, ...blockFilter.params],
  )
  const available = new Set(rows.map(row => row.id))
  if (available.size !== userIds.length) throw new Error('VALIDATION_FAILED')
  return userIds.filter(id => available.has(id))
}

async function syncOpportunityTeam(tx, caller, opportunityId, userIds) {
  const stored = await tx.query(
    `SELECT id, user_id, status
     FROM mip_opportunity_team_members
     WHERE app_id = ? AND opportunity_id = ?
     FOR UPDATE`,
    [caller.appId, opportunityId],
  )
  const byUser = new Map(stored.map(row => [row.user_id, row]))
  const desired = new Set(userIds)
  for (const row of stored) {
    if (desired.has(row.user_id)) continue
    if (row.status === 'ACTIVE') {
      await tx.query(
        `UPDATE mip_opportunity_team_members
         SET status = 'REMOVED', removed_at = UTC_TIMESTAMP(3)
         WHERE app_id = ? AND id = ?`,
        [caller.appId, row.id],
      )
    }
  }
  for (const [sortOrder, userId] of userIds.entries()) {
    const row = byUser.get(userId)
    if (row) {
      await tx.query(
        `UPDATE mip_opportunity_team_members
         SET status = 'ACTIVE', sort_order = ?, removed_at = NULL
         WHERE app_id = ? AND id = ?`,
        [sortOrder, caller.appId, row.id],
      )
    }
    else {
      await tx.query(
        `INSERT INTO mip_opportunity_team_members (
           id, app_id, opportunity_id, user_id, status, sort_order
         ) VALUES (?, ?, ?, ?, 'ACTIVE', ?)`,
        [randomUUID(), caller.appId, opportunityId, userId, sortOrder],
      )
    }
  }
}

async function assertSelectableTags(adapter, appId, expectedTags) {
  if (!expectedTags.length) return
  const ids = [...new Set(expectedTags.map(([id]) => id))]
  if (ids.some(id => !uuid(id))) throw new Error('VALIDATION_FAILED')
  const rows = await adapter.query(
    `SELECT t.id, t.kind, t.selectable, t.parent_id,
            parent.kind AS parent_kind, parent.parent_id AS parent_parent_id,
            parent.selectable AS parent_selectable, parent.enabled AS parent_enabled
     FROM mip_tags t
     LEFT JOIN mip_tags parent
       ON parent.app_id = t.app_id AND parent.id = t.parent_id
     WHERE t.app_id = ? AND t.id IN (${ids.map(() => '?').join(', ')})
       AND t.enabled = 1`,
    [appId, ...ids],
  )
  const byId = new Map(rows.map(row => [row.id, row]))
  if (expectedTags.some(([id, kind]) => !isSelectableTag(byId.get(id), kind))) {
    throw new Error('VALIDATION_FAILED')
  }
}

function isSelectableTag(tag, kind) {
  if (!tag || tag.kind !== kind || Number(tag.selectable) !== 1) return false
  if (kind !== 'INDUSTRY') return true
  return Boolean(tag.parent_id)
    && tag.parent_kind === 'INDUSTRY'
    && !tag.parent_parent_id
    && Number(tag.parent_selectable) === 0
    && Number(tag.parent_enabled) === 1
}

async function saveOpportunity(database, contentSafety, caller, input) {
  const draft = normalizeDraft(input.draft)
  const aiConfirmation = normalizeAiConfirmation(input.aiConfirmation, 'OPPORTUNITY')
  await contentSafety.assertSafe(caller, [
    draft.title,
    draft.valueSummary,
    draft.targetSummary,
    draft.description,
  ])
  return idempotentTransaction(database, {
    appId: caller.appId,
    userId: caller.userId,
    operation: 'opportunity.save',
    idempotencyKey: input.idempotencyKey,
    request: aiConfirmation ? { draft, aiConfirmation } : draft,
  }, async (tx) => {
    await lockActiveContributor(tx, caller)
    await assertReferences(tx, caller, draft)
    const teamUserIds = await resolveTeamUserIds(tx, caller, draft.teamProfileRefs)
    const id = draft.id || randomUUID()
    let existing = null
    if (draft.id) {
      existing = await tx.one(
        `SELECT owner_user_id, branch_id, status, version
         FROM mip_opportunities
         WHERE app_id = ? AND id = ? FOR UPDATE`,
        [caller.appId, draft.id],
      )
      if (!existing) throw new Error('NOT_FOUND')
      if (existing.owner_user_id !== caller.userId) throw new Error('FORBIDDEN')
      if (!canOwnerEditOpportunity(existing.status)) throw new Error('FORBIDDEN')
      if (!Number.isInteger(draft.expectedVersion) || draft.expectedVersion !== Number(existing.version)) {
        throw new Error('CONFLICT')
      }
    }
    const status = draft.publish ? 'PUBLISHED' : (existing?.status === 'PUBLISHED' ? 'PUBLISHED' : 'DRAFT')
    const published = status === 'PUBLISHED'
    const legacyCityTagId = draft.commercialTerms
      ? (draft.commercialTerms.locations.find(location => location.type === 'CITY')?.cityTagId || null)
      : draft.cityTagId
    if (existing) {
      await tx.query(
        `UPDATE mip_opportunities
         SET scope_type = ?, branch_id = ?, title = ?, value_summary = ?,
             target_summary = ?, description = ?, city_tag_id = ?, cover_asset_id = ?,
             status = ?, content_safety_status = 'APPROVED',
             published_at = CASE WHEN ? = 1 THEN UTC_TIMESTAMP(3) ELSE published_at END,
             ended_at = NULL, version = version + 1
         WHERE app_id = ? AND id = ? AND version = ?`,
        [
          draft.scopeType, draft.branchId, draft.title, draft.valueSummary,
          draft.targetSummary, draft.description, legacyCityTagId, draft.coverAssetId,
          status, published ? 1 : 0, caller.appId, id, draft.expectedVersion,
        ],
      )
    }
    else {
      await tx.query(
        `INSERT INTO mip_opportunities (
           id, app_id, owner_user_id, scope_type, branch_id, title,
           value_summary, target_summary, description, city_tag_id, cover_asset_id,
           status, content_safety_status, published_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'APPROVED',
           CASE WHEN ? = 1 THEN UTC_TIMESTAMP(3) ELSE NULL END)`,
        [
          id, caller.appId, caller.userId, draft.scopeType, draft.branchId,
          draft.title, draft.valueSummary, draft.targetSummary, draft.description,
          legacyCityTagId, draft.coverAssetId, status, published ? 1 : 0,
        ],
      )
    }
    await syncCommercialTerms(tx, caller.appId, id, draft.commercialTerms, existing ? Number(existing.version) + 1 : 1)
    await tx.query(
      'DELETE FROM mip_opportunity_roles WHERE app_id = ? AND opportunity_id = ?',
      [caller.appId, id],
    )
    for (const roleKey of draft.roleKeys) {
      await tx.query(
        `INSERT INTO mip_opportunity_roles (app_id, opportunity_id, role_key)
         VALUES (?, ?, ?)`,
        [caller.appId, id, roleKey],
      )
    }
    await tx.query(
      'DELETE FROM mip_opportunity_tags WHERE app_id = ? AND opportunity_id = ?',
      [caller.appId, id],
    )
    for (const [relation, ids] of [['INDUSTRY', draft.industryTagIds], ['ABILITY', draft.abilityTagIds]]) {
      for (const tagId of ids) {
        await tx.query(
          `INSERT INTO mip_opportunity_tags (app_id, opportunity_id, tag_id, relation)
           VALUES (?, ?, ?, ?)`,
          [caller.appId, id, tagId, relation],
        )
      }
    }
    await syncOpportunityTeam(tx, caller, id, teamUserIds)
    const version = existing ? Number(existing.version) + 1 : 1
    await appendAudit(tx, {
      appId: caller.appId,
      actorUserId: caller.userId,
      scopeType: draft.scopeType,
      scopeId: draft.branchId,
      action: existing ? 'OPPORTUNITY_UPDATED' : 'OPPORTUNITY_CREATED',
      resourceType: 'OPPORTUNITY',
      resourceId: id,
      metadata: {
        status,
        version,
        teamMemberCount: teamUserIds.length,
        commercialTermsConfigured: draft.commercialTerms !== undefined && draft.commercialTerms !== null,
        locationCount: draft.commercialTerms?.locations?.length || 0,
      },
    })
    if (published) {
      await appendOutbox(tx, {
        appId: caller.appId,
        aggregateType: 'OPPORTUNITY',
        aggregateId: id,
        eventType: 'opportunity.published',
        sourceVersion: version,
        payload: { opportunityId: id, branchId: draft.branchId },
      })
    }
    await confirmAiDraft(tx, {
      appId: caller.appId,
      userId: caller.userId,
      confirmation: aiConfirmation,
      resourceId: id,
      structuredDraft: {
        title: draft.title,
        valueSummary: draft.valueSummary,
        targetSummary: draft.targetSummary,
        description: draft.description,
      },
    })
    return { id, status, version }
  })
}

async function endOpportunity(database, caller, input) {
  if (!uuid(input.id) || !Number.isInteger(Number(input.expectedVersion))) {
    throw new Error('VALIDATION_FAILED')
  }
  return idempotentTransaction(database, {
    appId: caller.appId,
    userId: caller.userId,
    operation: 'opportunity.end',
    idempotencyKey: input.idempotencyKey,
    request: { id: input.id, expectedVersion: Number(input.expectedVersion) },
  }, async (tx) => {
    await lockActiveContributor(tx, caller)
    const row = await tx.one(
      `SELECT owner_user_id, status, version, branch_id
       FROM mip_opportunities WHERE app_id = ? AND id = ? FOR UPDATE`,
      [caller.appId, input.id],
    )
    if (!row) throw new Error('NOT_FOUND')
    if (row.owner_user_id !== caller.userId) throw new Error('FORBIDDEN')
    if (Number(row.version) !== Number(input.expectedVersion)) throw new Error('CONFLICT')
    if (row.status === 'ENDED') return { id: input.id, status: 'ENDED', version: Number(row.version) }
    if (row.status !== 'PUBLISHED') throw new Error('CONFLICT')
    const version = Number(row.version) + 1
    await tx.query(
      `UPDATE mip_opportunities
       SET status = 'ENDED', ended_at = UTC_TIMESTAMP(3), version = version + 1
       WHERE app_id = ? AND id = ? AND version = ?`,
      [caller.appId, input.id, input.expectedVersion],
    )
    await appendAudit(tx, {
      appId: caller.appId,
      actorUserId: caller.userId,
      scopeType: row.branch_id ? 'BRANCH' : 'PLATFORM',
      scopeId: row.branch_id,
      action: 'OPPORTUNITY_ENDED',
      resourceType: 'OPPORTUNITY',
      resourceId: input.id,
      metadata: { version },
    })
    return { id: input.id, status: 'ENDED', version }
  })
}

async function setReferral(database, caller, input) {
  if (!uuid(input.id)) throw new Error('NOT_FOUND')
  const active = Boolean(input.active)
  const note = stringValue(input.note, 240, 'VALIDATION_FAILED', false)
  const targetProfileRef = stringValue(
    input.targetProfileRef,
    200,
    'VALIDATION_FAILED',
    active,
  )
  return idempotentTransaction(database, {
    appId: caller.appId,
    userId: caller.userId,
    operation: 'opportunity.referral',
    idempotencyKey: input.idempotencyKey,
    request: { id: input.id, active, note, targetProfileRef },
  }, async (tx) => {
    await lockActiveContributor(tx, caller)
    const blockFilter = mutualBlockFilter(caller.userId, 'o.owner_user_id', 'o.app_id')
    const opportunity = await tx.one(
      `SELECT owner_user_id, referral_count, status
       FROM mip_opportunities o WHERE o.app_id = ? AND o.id = ?
         AND ${blockFilter.sql} FOR UPDATE`,
      [caller.appId, input.id, ...blockFilter.params],
    )
    if (!opportunity || opportunity.status !== 'PUBLISHED') throw new Error('NOT_FOUND')
    if (opportunity.owner_user_id === caller.userId) throw new Error('CONFLICT')
    const targetUserId = active
      ? await resolveReferralTarget(tx, caller, targetProfileRef)
      : null
    const stored = await tx.one(
      `SELECT id, status, target_user_id, version FROM mip_referral_intents
       WHERE app_id = ? AND opportunity_id = ? AND actor_user_id = ? FOR UPDATE`,
      [caller.appId, input.id, caller.userId],
    )
    const requestedStatus = active ? 'ACTIVE' : 'CANCELLED'
    if (stored?.status === requestedStatus && (!active || stored.target_user_id === targetUserId)) {
      return {
        active,
        version: Number(stored.version),
        referralCount: Number(opportunity.referral_count),
      }
    }
    const id = stored?.id || randomUUID()
    const version = stored ? Number(stored.version) + 1 : 1
    const countDelta = stored
      ? (stored.status === requestedStatus ? 0 : (active ? 1 : -1))
      : (active ? 1 : 0)
    if (stored) {
      await tx.query(
        `UPDATE mip_referral_intents
         SET status = ?, target_user_id = CASE WHEN ? = 1 THEN ? ELSE target_user_id END,
             note = ?, version = version + 1,
             activated_at = CASE WHEN ? = 1 THEN UTC_TIMESTAMP(3) ELSE activated_at END,
             cancelled_at = CASE WHEN ? = 1 THEN NULL ELSE UTC_TIMESTAMP(3) END
         WHERE app_id = ? AND id = ?`,
        [
          requestedStatus,
          active ? 1 : 0,
          targetUserId,
          note || null,
          active ? 1 : 0,
          active ? 1 : 0,
          caller.appId,
          id,
        ],
      )
    }
    else {
      if (!active) return { active: false, version: 0, referralCount: Number(opportunity.referral_count) }
      await tx.query(
        `INSERT INTO mip_referral_intents (
           id, app_id, opportunity_id, actor_user_id, target_user_id, status, note
         ) VALUES (?, ?, ?, ?, ?, 'ACTIVE', ?)`,
        [id, caller.appId, input.id, caller.userId, targetUserId, note || null],
      )
    }
    if (countDelta) {
      await tx.query(
        `UPDATE mip_opportunities
         SET referral_count = GREATEST(0, referral_count + ?)
         WHERE app_id = ? AND id = ?`,
        [countDelta, caller.appId, input.id],
      )
    }
    const referralCount = Math.max(0, Number(opportunity.referral_count) + countDelta)
    await appendOutbox(tx, {
      appId: caller.appId,
      aggregateType: 'REFERRAL_INTENT',
      aggregateId: id,
      eventType: 'opportunity.referral_changed',
      sourceVersion: version,
      payload: {
        opportunityId: input.id,
        active,
      },
    })
    await appendAudit(tx, {
      appId: caller.appId,
      actorUserId: caller.userId,
      action: active ? 'REFERRAL_ACTIVATED' : 'REFERRAL_CANCELLED',
      resourceType: 'REFERRAL_INTENT',
      resourceId: id,
      metadata: { opportunityId: input.id, version },
    })
    return { active, version, referralCount }
  })
}

async function resolveInterestTarget(tx, caller, sourceType, sourceId, profileRef) {
  if (sourceType === 'PROFILE') {
    const targetUserId = readProfileRef(profileRef, caller.appId, caller.profileRefSecret)
    const blockFilter = mutualBlockFilter(caller.userId, 'target.id', 'target.app_id')
    const target = await tx.one(
      `SELECT target.id AS owner_user_id
       FROM mip_users target
       INNER JOIN mip_profiles profile
         ON profile.app_id = target.app_id AND profile.user_id = target.id
       WHERE target.app_id = ? AND target.id = ? AND target.status = 'ACTIVE'
         AND ${blockFilter.sql}
       FOR UPDATE`,
      [caller.appId, targetUserId, ...blockFilter.params],
    )
    if (!target) throw new Error('NOT_FOUND')
    if (target.owner_user_id === caller.userId) throw new Error('CONFLICT')
    return { targetUserId: target.owner_user_id, sourceId: target.owner_user_id }
  }
  const table = {
    OPPORTUNITY: ['mip_opportunities', ['PUBLISHED', 'ENDED']],
    COOPERATION_CARD: ['mip_cooperation_cards', ['PUBLISHED']],
    SUPER_CASE: ['mip_super_cases', ['PUBLISHED']],
  }[sourceType]
  if (!table || !uuid(sourceId)) throw new Error('NOT_FOUND')
  const [tableName, statuses] = table
  const blockFilter = mutualBlockFilter(caller.userId, 'resource.owner_user_id', 'resource.app_id')
  const row = await tx.one(
    `SELECT resource.owner_user_id, resource.status FROM ${tableName} resource
     WHERE resource.app_id = ? AND resource.id = ?
       AND ${blockFilter.sql} FOR UPDATE`,
    [caller.appId, sourceId, ...blockFilter.params],
  )
  if (!row || !statuses.includes(row.status)) throw new Error('NOT_FOUND')
  if (row.owner_user_id === caller.userId) throw new Error('CONFLICT')
  return { targetUserId: row.owner_user_id, sourceId }
}

async function setProfileInterest(database, caller, input) {
  const sourceType = String(input.sourceType || '')
  const sourceId = String(input.sourceId || '')
  const profileRef = typeof input.profileRef === 'string' ? input.profileRef.trim() : ''
  const active = Boolean(input.active)
  const request = sourceType === 'PROFILE'
    ? { sourceType, profileRef, active }
    : { sourceType, sourceId, active }
  return idempotentTransaction(database, {
    appId: caller.appId,
    userId: caller.userId,
    operation: 'profile.interest',
    idempotencyKey: input.idempotencyKey,
    request,
  }, async (tx) => {
    await lockActiveContributor(tx, caller)
    const resolved = await resolveInterestTarget(tx, caller, sourceType, sourceId, profileRef)
    const targetUserId = resolved.targetUserId
    const storedSourceId = resolved.sourceId
    const stored = await tx.one(
      `SELECT id, status, version FROM mip_profile_interests
       WHERE app_id = ? AND actor_user_id = ? AND target_user_id = ? FOR UPDATE`,
      [caller.appId, caller.userId, targetUserId],
    )
    if (stored?.status === (active ? 'ACTIVE' : 'CANCELLED')) {
      return { active, version: Number(stored.version) }
    }
    const id = stored?.id || randomUUID()
    const version = stored ? Number(stored.version) + 1 : 1
    if (stored) {
      await tx.query(
        `UPDATE mip_profile_interests
         SET status = ?, source_type = ?, source_id = ?, version = version + 1,
             activated_at = CASE WHEN ? = 1 THEN UTC_TIMESTAMP(3) ELSE activated_at END,
             cancelled_at = CASE WHEN ? = 1 THEN NULL ELSE UTC_TIMESTAMP(3) END
         WHERE app_id = ? AND id = ?`,
        [active ? 'ACTIVE' : 'CANCELLED', sourceType, storedSourceId, active ? 1 : 0, active ? 1 : 0, caller.appId, id],
      )
    }
    else {
      if (!active) return { active: false, version: 0 }
      await tx.query(
        `INSERT INTO mip_profile_interests (
           id, app_id, actor_user_id, target_user_id, status, source_type, source_id
         ) VALUES (?, ?, ?, ?, 'ACTIVE', ?, ?)`,
        [id, caller.appId, caller.userId, targetUserId, sourceType, storedSourceId],
      )
    }
    await appendOutbox(tx, {
      appId: caller.appId,
      aggregateType: 'PROFILE_INTEREST',
      aggregateId: id,
      eventType: 'profile.interest_changed',
      sourceVersion: version,
      payload: { recipientUserId: active ? targetUserId : null, sourceType, sourceId: storedSourceId, active },
    })
    await appendAudit(tx, {
      appId: caller.appId,
      actorUserId: caller.userId,
      action: active ? 'PROFILE_INTEREST_ACTIVATED' : 'PROFILE_INTEREST_CANCELLED',
      resourceType: 'PROFILE_INTEREST',
      resourceId: id,
      metadata: { sourceType, sourceId: storedSourceId, version },
    })
    return { active, version }
  })
}

module.exports = {
  assertReferences,
  assertSelectableTags,
  canOwnerEditOpportunity,
  endOpportunity,
  getCatalogs,
  getOpportunity,
  listMine,
  listOpportunities,
  normalizeDraft,
  normalizeFilter,
  profileRefList,
  relatedData,
  resolveReferralTarget,
  resolveTeamUserIds,
  saveOpportunity,
  setProfileInterest,
  setReferral,
  syncOpportunityTeam,
}
