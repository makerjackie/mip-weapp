'use strict'

const { createProfileRef, readProfileRef } = require('../lib/profile-ref')
const {
  iso,
  jsonObject,
  mutualBlockFilter,
  stringList,
  stringValue,
  uuid,
} = require('./common')
const { assertSelectableTags } = require('./opportunities')

const PEOPLE_KINDS = new Set(['ALL', 'PLAYER', 'GUEST'])
const PEOPLE_SEARCH_SCOPES = new Set(['GLOBAL', 'PLAYER'])

const activeEntitlementSql = `EXISTS (
  SELECT 1 FROM mip_membership_entitlements entitlement
  WHERE entitlement.app_id = u.app_id AND entitlement.user_id = u.id
    AND entitlement.status = 'ACTIVE'
    AND entitlement.starts_at <= UTC_TIMESTAMP(3)
    AND entitlement.ends_at > UTC_TIMESTAMP(3)
)`

const profileSelect = `
  SELECT u.id AS profile_user_id, u.created_at AS joined_at,
         p.nickname, p.identity_status, p.headline, p.introduction,
         p.companies_json, p.organizations_json, p.visibility_json,
         avatar.cloud_file_id AS avatar_file_id,
         branch.id AS branch_id, branch.name AS branch_name, branch.city_name AS branch_city_name,
         industry.id AS industry_tag_id, industry.tag_key AS industry_key,
         industry.label AS industry_label,
         ${activeEntitlementSql} AS is_player
  FROM mip_users u
  INNER JOIN mip_profiles p ON p.app_id = u.app_id AND p.user_id = u.id
  LEFT JOIN mip_media_assets avatar
    ON avatar.app_id = p.app_id AND avatar.id = p.avatar_asset_id AND avatar.status = 'READY'
  LEFT JOIN mip_city_branches branch
    ON branch.app_id = u.app_id AND branch.id = u.primary_branch_id AND branch.status = 'ACTIVE'
  LEFT JOIN mip_profile_tags primary_industry
    ON primary_industry.app_id = u.app_id
      AND primary_industry.user_id = u.id
      AND primary_industry.relation = 'PRIMARY_INDUSTRY'
      AND primary_industry.tag_id = (
        SELECT MIN(selected_industry.tag_id)
        FROM mip_profile_tags selected_industry
        INNER JOIN mip_tags selected_tag
          ON selected_tag.app_id = selected_industry.app_id
            AND selected_tag.id = selected_industry.tag_id
            AND selected_tag.kind = 'INDUSTRY'
            AND selected_tag.enabled = 1
        WHERE selected_industry.app_id = u.app_id
          AND selected_industry.user_id = u.id
          AND selected_industry.relation = 'PRIMARY_INDUSTRY'
      )
  LEFT JOIN mip_tags industry
    ON industry.app_id = primary_industry.app_id
      AND industry.id = primary_industry.tag_id
      AND industry.kind = 'INDUSTRY'
      AND industry.enabled = 1`

function limit(value, fallback = 20) {
  const parsed = Number(value)
  return Math.min(30, Math.max(1, Number.isInteger(parsed) ? parsed : fallback))
}

function likePattern(value) {
  return `%${value.replaceAll('=', '==').replaceAll('%', '=%').replaceAll('_', '=_')}%`
}

function encodePeopleCursor(timestamp, userId, caller) {
  const profileRef = createProfileRef(
    { appId: caller.appId, userId },
    caller.profileRefSecret,
  )
  return Buffer.from(JSON.stringify({ timestamp: iso(timestamp), profileRef }), 'utf8').toString('base64url')
}

function decodePeopleCursor(value, caller) {
  if (!value) return null
  if (typeof value !== 'string' || value.length > 768) throw new Error('VALIDATION_FAILED')
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
    const timestamp = iso(parsed.timestamp)
    if (!timestamp) throw new Error('INVALID_CURSOR')
    const userId = readProfileRef(parsed.profileRef, caller.appId, caller.profileRefSecret)
    return { timestamp, userId }
  }
  catch (error) {
    if (error?.message === 'IDENTITY_CONFIG_REQUIRED') throw error
    throw new Error('VALIDATION_FAILED')
  }
}

function normalizePeopleFilter(value = {}, caller) {
  const kind = String(value.kind || 'ALL').trim().toUpperCase()
  if (!PEOPLE_KINDS.has(kind)) throw new Error('VALIDATION_FAILED')
  const requestedScope = String(value.scope || '').trim().toUpperCase()
  if (requestedScope && !PEOPLE_SEARCH_SCOPES.has(requestedScope)) throw new Error('VALIDATION_FAILED')
  const branchId = stringValue(value.branchId, 36, 'VALIDATION_FAILED', false) || null
  if (branchId && !uuid(branchId)) throw new Error('VALIDATION_FAILED')
  return {
    scope: requestedScope || (kind === 'PLAYER' ? 'PLAYER' : 'GLOBAL'),
    keyword: stringValue(value.keyword, 80, 'VALIDATION_FAILED', false),
    branchId,
    industryTagIds: stringList(value.industryTagIds, 8, 'VALIDATION_FAILED', uuid),
    abilityTagIds: stringList(value.abilityTagIds, 8, 'VALIDATION_FAILED', uuid),
    cursor: decodePeopleCursor(value.cursor, caller),
    limit: limit(value.limit),
  }
}

function visibleFields(value) {
  const source = jsonObject(value)
  return {
    nickname: source.nickname !== false,
    avatar: source.avatar !== false,
    identityStatus: source.identityStatus !== false,
    headline: source.headline !== false,
    introduction: source.introduction !== false,
    companies: source.companies !== false,
    organizations: source.organizations !== false,
    industry: source.industry !== false,
    abilities: source.abilities !== false,
    primaryBranch: source.primaryBranch !== false,
  }
}

function publicOrganizations(value) {
  const source = Array.isArray(value)
    ? value
    : (() => {
        try {
          const parsed = JSON.parse(String(value || '[]'))
          return Array.isArray(parsed) ? parsed : []
        }
        catch {
          return []
        }
      })()
  return source.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return []
    const name = typeof item.name === 'string' ? item.name.trim().slice(0, 120) : ''
    const role = typeof item.role === 'string' ? item.role.trim().slice(0, 80) : ''
    return name ? [{ name, ...(role ? { role } : {}) }] : []
  }).slice(0, 12)
}

function publicProfileDto(row, tags, caller, profileRef) {
  const allowed = visibleFields(row.visibility_json)
  const abilities = tags.filter(tag => tag.relation === 'ABILITY')
  return {
    profileRef: profileRef || createProfileRef(
      { appId: caller.appId, userId: row.profile_user_id },
      caller.profileRefSecret,
    ),
    isSelf: Boolean(caller.userId && caller.userId === row.profile_user_id),
    userKind: Number(row.is_player) === 1 ? 'PLAYER' : 'GUEST',
    joinedAt: iso(row.joined_at),
    ...(allowed.nickname && row.nickname ? { nickname: String(row.nickname).trim() } : {}),
    ...(allowed.avatar && row.avatar_file_id ? { avatarUrl: row.avatar_file_id } : {}),
    ...(allowed.identityStatus && row.identity_status ? { identityStatus: row.identity_status } : {}),
    ...(allowed.headline && row.headline ? { headline: row.headline } : {}),
    ...(allowed.introduction && row.introduction ? { introduction: row.introduction } : {}),
    ...(allowed.companies ? { companies: publicOrganizations(row.companies_json) } : {}),
    ...(allowed.organizations ? { organizations: publicOrganizations(row.organizations_json) } : {}),
    ...(allowed.industry && row.industry_tag_id
      ? {
          primaryIndustry: {
            id: row.industry_tag_id,
            key: row.industry_key,
            label: row.industry_label,
          },
        }
      : {}),
    ...(allowed.abilities
      ? {
          abilities: abilities.map(tag => ({
            id: tag.id,
            key: tag.tag_key,
            label: tag.label,
          })),
        }
      : {}),
    ...(allowed.primaryBranch && row.branch_id
      ? {
          primaryBranch: {
            id: row.branch_id,
            name: row.branch_name,
            cityName: row.branch_city_name,
          },
        }
      : {}),
  }
}

async function loadProfileTags(database, appId, userIds) {
  if (!userIds.length) return new Map()
  const rows = await database.query(
    `SELECT pt.user_id, pt.relation, t.id, t.tag_key, t.label
     FROM mip_profile_tags pt
     INNER JOIN mip_tags t ON t.app_id = pt.app_id AND t.id = pt.tag_id AND t.enabled = 1
     WHERE pt.app_id = ? AND pt.user_id IN (${userIds.map(() => '?').join(', ')})
       AND pt.relation IN ('PRIMARY_INDUSTRY', 'ABILITY')
     ORDER BY pt.user_id, pt.relation, t.sort_order, t.id`,
    [appId, ...userIds],
  )
  const byUser = new Map()
  for (const row of rows) {
    const current = byUser.get(row.user_id) || []
    current.push(row)
    byUser.set(row.user_id, current)
  }
  return byUser
}

async function listPeople(database, caller, rawFilter = {}) {
  const filter = normalizePeopleFilter(rawFilter, caller)
  await assertSelectableTags(database, caller.appId, [
    ...filter.industryTagIds.map(id => [id, 'INDUSTRY']),
    ...filter.abilityTagIds.map(id => [id, 'ABILITY']),
  ])
  const where = ["u.app_id = ?", "u.status = 'ACTIVE'"]
  const params = [caller.appId]
  const blockFilter = mutualBlockFilter(caller.userId, 'u.id', 'u.app_id')
  if (blockFilter.sql) {
    where.push(blockFilter.sql)
    params.push(...blockFilter.params)
  }
  if (filter.scope === 'PLAYER') where.push(activeEntitlementSql)
  if (filter.keyword) {
    const pattern = likePattern(filter.keyword)
    where.push(`(
      (COALESCE(JSON_UNQUOTE(JSON_EXTRACT(p.visibility_json, '$.nickname')), 'true') <> 'false'
        AND p.nickname LIKE ? ESCAPE '=')
      OR (COALESCE(JSON_UNQUOTE(JSON_EXTRACT(p.visibility_json, '$.identityStatus')), 'true') <> 'false'
        AND p.identity_status LIKE ? ESCAPE '=')
      OR (COALESCE(JSON_UNQUOTE(JSON_EXTRACT(p.visibility_json, '$.headline')), 'true') <> 'false'
        AND p.headline LIKE ? ESCAPE '=')
      OR (COALESCE(JSON_UNQUOTE(JSON_EXTRACT(p.visibility_json, '$.introduction')), 'true') <> 'false'
        AND p.introduction LIKE ? ESCAPE '=')
      OR (COALESCE(JSON_UNQUOTE(JSON_EXTRACT(p.visibility_json, '$.companies')), 'true') <> 'false'
        AND CAST(p.companies_json AS CHAR) LIKE ? ESCAPE '=')
      OR (COALESCE(JSON_UNQUOTE(JSON_EXTRACT(p.visibility_json, '$.organizations')), 'true') <> 'false'
        AND CAST(p.organizations_json AS CHAR) LIKE ? ESCAPE '=')
      OR (COALESCE(JSON_UNQUOTE(JSON_EXTRACT(p.visibility_json, '$.primaryBranch')), 'true') <> 'false'
        AND (branch.name LIKE ? ESCAPE '=' OR branch.city_name LIKE ? ESCAPE '='))
      OR (COALESCE(JSON_UNQUOTE(JSON_EXTRACT(p.visibility_json, '$.industry')), 'true') <> 'false'
        AND industry.label LIKE ? ESCAPE '=')
      OR (COALESCE(JSON_UNQUOTE(JSON_EXTRACT(p.visibility_json, '$.abilities')), 'true') <> 'false'
        AND EXISTS (
          SELECT 1 FROM mip_profile_tags ability_search
          INNER JOIN mip_tags ability_search_tag
            ON ability_search_tag.app_id = ability_search.app_id
              AND ability_search_tag.id = ability_search.tag_id
              AND ability_search_tag.kind = 'ABILITY'
              AND ability_search_tag.enabled = 1
          WHERE ability_search.app_id = u.app_id
            AND ability_search.user_id = u.id
            AND ability_search.relation = 'ABILITY'
            AND ability_search_tag.label LIKE ? ESCAPE '='
        ))
    )`)
    params.push(...Array.from({ length: 10 }, () => pattern))
  }
  if (filter.branchId) {
    where.push(`u.primary_branch_id = ?
      AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(p.visibility_json, '$.primaryBranch')), 'true') <> 'false'`)
    params.push(filter.branchId)
  }
  if (filter.industryTagIds.length) {
    where.push(`COALESCE(JSON_UNQUOTE(JSON_EXTRACT(p.visibility_json, '$.industry')), 'true') <> 'false'
      AND EXISTS (
        SELECT 1 FROM mip_profile_tags industry_filter
        INNER JOIN mip_tags industry_filter_tag
          ON industry_filter_tag.app_id = industry_filter.app_id
            AND industry_filter_tag.id = industry_filter.tag_id
            AND industry_filter_tag.kind = 'INDUSTRY'
            AND industry_filter_tag.enabled = 1
        WHERE industry_filter.app_id = u.app_id
          AND industry_filter.user_id = u.id
          AND industry_filter.relation IN ('PRIMARY_INDUSTRY', 'INDUSTRY')
          AND industry_filter.tag_id IN (${filter.industryTagIds.map(() => '?').join(', ')})
      )`)
    params.push(...filter.industryTagIds)
  }
  if (filter.abilityTagIds.length) {
    where.push(`COALESCE(JSON_UNQUOTE(JSON_EXTRACT(p.visibility_json, '$.abilities')), 'true') <> 'false'
      AND EXISTS (
        SELECT 1 FROM mip_profile_tags ability_filter
        INNER JOIN mip_tags ability_filter_tag
          ON ability_filter_tag.app_id = ability_filter.app_id
            AND ability_filter_tag.id = ability_filter.tag_id
            AND ability_filter_tag.kind = 'ABILITY'
            AND ability_filter_tag.enabled = 1
        WHERE ability_filter.app_id = u.app_id
          AND ability_filter.user_id = u.id
          AND ability_filter.relation = 'ABILITY'
          AND ability_filter.tag_id IN (${filter.abilityTagIds.map(() => '?').join(', ')})
      )`)
    params.push(...filter.abilityTagIds)
  }
  if (filter.cursor) {
    where.push('(u.created_at < ? OR (u.created_at = ? AND u.id < ?))')
    params.push(filter.cursor.timestamp, filter.cursor.timestamp, filter.cursor.userId)
  }
  const rows = await database.query(
    `${profileSelect}
     WHERE ${where.join(' AND ')}
     ORDER BY u.created_at DESC, u.id DESC
     LIMIT ${filter.limit + 1}`,
    params,
  )
  const pageRows = rows.slice(0, filter.limit)
  const tags = await loadProfileTags(database, caller.appId, pageRows.map(row => row.profile_user_id))
  return {
    items: pageRows.map(row => publicProfileDto(row, tags.get(row.profile_user_id) || [], caller)),
    nextCursor: rows.length > filter.limit && pageRows.length
      ? encodePeopleCursor(pageRows.at(-1).joined_at, pageRows.at(-1).profile_user_id, caller)
      : undefined,
  }
}

async function getPublicProfileAggregate(database, caller, input = {}) {
  const profileRef = typeof input.profileRef === 'string' ? input.profileRef.trim() : ''
  const targetUserId = readProfileRef(profileRef, caller.appId, caller.profileRefSecret)
  const blockFilter = mutualBlockFilter(caller.userId, 'u.id', 'u.app_id')
  const row = await database.one(
    `${profileSelect}
     WHERE u.app_id = ? AND u.id = ? AND u.status = 'ACTIVE'
       ${blockFilter.sql ? `AND ${blockFilter.sql}` : ''}
     LIMIT 1`,
    [caller.appId, targetUserId, ...blockFilter.params],
  )
  if (!row) throw new Error('NOT_FOUND')

  const [tags, cooperationCards, superCases, opportunities, interest] = await Promise.all([
    loadProfileTags(database, caller.appId, [targetUserId]),
    database.query(
      `SELECT id, role_key, positioning, target_summary, ability_scores_json, published_at
       FROM mip_cooperation_cards
       WHERE app_id = ? AND owner_user_id = ? AND status = 'PUBLISHED'
       ORDER BY published_at DESC, id DESC`,
      [caller.appId, targetUserId],
    ),
    database.query(
      `SELECT c.id, c.project_name, c.summary, c.responsibility, c.case_type,
              c.published_at, city.label AS city_label, industry.label AS industry_label,
              cover.cloud_file_id AS cover_file_id
       FROM mip_super_cases c
       LEFT JOIN mip_tags city ON city.app_id = c.app_id AND city.id = c.city_tag_id AND city.enabled = 1
       LEFT JOIN mip_tags industry ON industry.app_id = c.app_id AND industry.id = c.industry_tag_id AND industry.enabled = 1
       LEFT JOIN mip_media_assets cover
         ON cover.app_id = c.app_id AND cover.id = c.cover_asset_id AND cover.status = 'READY'
       WHERE c.app_id = ? AND c.owner_user_id = ? AND c.status = 'PUBLISHED'
       ORDER BY c.published_at DESC, c.id DESC`,
      [caller.appId, targetUserId],
    ),
    database.query(
      `SELECT o.id, o.title, o.value_summary, o.target_summary, o.referral_count,
              o.published_at, branch.name AS branch_name, city.label AS city_label,
              cover.cloud_file_id AS cover_file_id
       FROM mip_opportunities o
       LEFT JOIN mip_city_branches branch
         ON branch.app_id = o.app_id AND branch.id = o.branch_id AND branch.status = 'ACTIVE'
       LEFT JOIN mip_tags city ON city.app_id = o.app_id AND city.id = o.city_tag_id AND city.enabled = 1
       LEFT JOIN mip_media_assets cover
         ON cover.app_id = o.app_id AND cover.id = o.cover_asset_id AND cover.status = 'READY'
       WHERE o.app_id = ? AND o.owner_user_id = ? AND o.status = 'PUBLISHED'
       ORDER BY o.published_at DESC, o.id DESC`,
      [caller.appId, targetUserId],
    ),
    caller.userId && caller.userId !== targetUserId
      ? database.one(
          `SELECT status FROM mip_profile_interests
           WHERE app_id = ? AND actor_user_id = ? AND target_user_id = ?`,
          [caller.appId, caller.userId, targetUserId],
        )
      : Promise.resolve(null),
  ])

  return {
    profile: publicProfileDto(row, tags.get(targetUserId) || [], caller, profileRef),
    cooperationCards: cooperationCards.map(item => ({
      id: item.id,
      roleKey: item.role_key,
      positioning: item.positioning,
      targetSummary: item.target_summary,
      abilityScores: jsonObject(item.ability_scores_json),
      status: 'PUBLISHED',
      publishedAt: iso(item.published_at),
    })),
    superCases: superCases.map(item => ({
      id: item.id,
      projectName: item.project_name,
      summary: item.summary,
      responsibility: item.responsibility,
      caseType: item.case_type || undefined,
      cityLabel: item.city_label || undefined,
      industryLabel: item.industry_label || undefined,
      coverUrl: item.cover_file_id || undefined,
      status: 'PUBLISHED',
      publishedAt: iso(item.published_at),
    })),
    opportunities: opportunities.map(item => ({
      id: item.id,
      title: item.title,
      valueSummary: item.value_summary,
      targetSummary: item.target_summary,
      referralCount: Number(item.referral_count || 0),
      branchName: item.branch_name || undefined,
      cityLabel: item.city_label || undefined,
      coverUrl: item.cover_file_id || undefined,
      status: 'PUBLISHED',
      publishedAt: iso(item.published_at),
    })),
    interestActive: interest?.status === 'ACTIVE',
  }
}

module.exports = {
  decodePeopleCursor,
  encodePeopleCursor,
  getPublicProfileAggregate,
  listPeople,
  normalizePeopleFilter,
  publicProfileDto,
}
