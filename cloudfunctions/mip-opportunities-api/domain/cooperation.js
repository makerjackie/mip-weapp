'use strict'

const { randomUUID } = require('node:crypto')
const { lockActiveContributor } = require('../lib/auth')
const { createProfileRef } = require('../lib/profile-ref')
const {
  createTalentCursor,
  createTalentKey,
  readTalentCursor,
} = require('../lib/talent-cursor')
const { confirmAiDraft, normalizeAiConfirmation } = require('./ai-confirmation')
const { assertSelectableTags } = require('./opportunities')
const {
  ABILITY_KEYS,
  ROLE_KEYS,
  appendAudit,
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

const REQUIRED_ROLE_FIELDS = {
  connector: ['circles', 'resources', 'target'],
  business_builder: ['industries', 'business_models', 'target'],
  capital_operator: ['investment_fields', 'capital_range', 'target'],
  strategist: ['planning_types', 'methods', 'target'],
  visual_designer: ['visual_types', 'portfolio_summary', 'target'],
  delivery_lead: ['project_types', 'delivery_experience', 'target'],
}

function limit(value, fallback = 16) {
  const parsed = Number(value)
  return Math.min(30, Math.max(1, Number.isInteger(parsed) ? parsed : fallback))
}

function likePattern(value) {
  return `%${String(value).replace(/=/g, '==').replace(/%/g, '=%').replace(/_/g, '=_')}%`
}

function normalizeFilter(value = {}) {
  const keyword = stringValue(value.keyword, 80, 'VALIDATION_FAILED', false)
  const branchId = stringValue(value.branchId, 36, 'VALIDATION_FAILED', false)
  const roleKey = stringValue(value.roleKey, 32, 'VALIDATION_FAILED', false)
  if ((branchId && !uuid(branchId)) || (roleKey && !ROLE_KEYS.has(roleKey))) {
    throw new Error('VALIDATION_FAILED')
  }
  return {
    keyword,
    branchId,
    roleKey,
    industryTagIds: stringList(value.industryTagIds, 8, 'VALIDATION_FAILED', uuid),
    cursor: decodeCursor(value.cursor),
    limit: limit(value.limit),
  }
}

function normalizeTalentFilter(value = {}) {
  const filter = normalizeFilter({ ...value, cursor: undefined })
  const cursor = stringValue(value.cursor, 768, 'VALIDATION_FAILED', false)
  return {
    ...filter,
    industryTagIds: [...filter.industryTagIds].sort(),
    cursor: cursor || null,
  }
}

function talentFilterContext(appId, viewerId, filter) {
  return {
    appId,
    viewerId: viewerId || '',
    keyword: filter.keyword || '',
    branchId: filter.branchId || '',
    roleKey: filter.roleKey || '',
    industryTagIds: filter.industryTagIds,
  }
}

function mysqlTimestamp(value) {
  return String(value).replace('T', ' ').replace(/Z$/, '')
}

function normalizeRoleFields(roleKey, value) {
  const source = jsonObject(value)
  const result = {}
  for (const key of REQUIRED_ROLE_FIELDS[roleKey]) {
    const raw = source[key]
    if (Array.isArray(raw)) {
      const items = [...new Set(raw.map(item => String(item).trim()).filter(Boolean))].slice(0, 12)
      if (!items.length || items.some(item => item.length > 80)) throw new Error('VALIDATION_FAILED')
      result[key] = items
    }
    else {
      result[key] = stringValue(raw, 1000, 'VALIDATION_FAILED')
    }
  }
  return result
}

function normalizeScores(value) {
  const source = jsonObject(value)
  const result = {}
  for (const key of ABILITY_KEYS) {
    const score = Number(source[key])
    if (!Number.isInteger(score) || score < 0 || score > 5) {
      throw new Error('VALIDATION_FAILED')
    }
    result[key] = score
  }
  if (Object.keys(source).some(key => !ABILITY_KEYS.has(key))) {
    throw new Error('VALIDATION_FAILED')
  }
  return result
}

function normalizeDraft(value = {}) {
  const roleKey = String(value.roleKey || '')
  if (!ROLE_KEYS.has(roleKey)) throw new Error('VALIDATION_FAILED')
  return {
    id: value.id && uuid(value.id) ? value.id : null,
    expectedVersion: value.expectedVersion === undefined ? null : Number(value.expectedVersion),
    roleKey,
    positioning: stringValue(value.positioning, 500, 'VALIDATION_FAILED'),
    targetSummary: stringValue(value.targetSummary, 500, 'VALIDATION_FAILED'),
    roleFields: normalizeRoleFields(roleKey, value.roleFields),
    abilityScores: normalizeScores(value.abilityScores),
    publish: Boolean(value.publish),
  }
}

const cardFields = `
  c.id, c.owner_user_id, c.role_key, c.positioning, c.target_summary,
  c.role_fields_json, c.ability_scores_json, c.status, c.version,
  c.published_at, c.updated_at, p.nickname, p.headline, p.visibility_json,
  avatar.cloud_file_id AS avatar_file_id, branch.city_name,
  industry.id AS industry_tag_id, industry.tag_key AS industry_key,
  industry.label AS industry_label`

const cardFrom = `
  FROM mip_cooperation_cards c
  INNER JOIN mip_profiles p ON p.app_id = c.app_id AND p.user_id = c.owner_user_id
  INNER JOIN mip_users u ON u.app_id = c.app_id AND u.id = c.owner_user_id
  LEFT JOIN mip_city_branches branch
    ON branch.app_id = u.app_id AND branch.id = u.primary_branch_id AND branch.status = 'ACTIVE'
  LEFT JOIN mip_media_assets avatar
    ON avatar.app_id = p.app_id AND avatar.id = p.avatar_asset_id AND avatar.status = 'READY'
  LEFT JOIN mip_profile_tags primary_industry
    ON primary_industry.app_id = c.app_id
      AND primary_industry.user_id = c.owner_user_id
      AND primary_industry.relation = 'PRIMARY_INDUSTRY'
      AND primary_industry.tag_id = (
        SELECT MIN(selected_industry.tag_id)
        FROM mip_profile_tags selected_industry
        INNER JOIN mip_tags selected_tag
          ON selected_tag.app_id = selected_industry.app_id
            AND selected_tag.id = selected_industry.tag_id
            AND selected_tag.kind = 'INDUSTRY'
            AND selected_tag.enabled = 1
        WHERE selected_industry.app_id = c.app_id
          AND selected_industry.user_id = c.owner_user_id
          AND selected_industry.relation = 'PRIMARY_INDUSTRY'
      )
  LEFT JOIN mip_tags industry
    ON industry.app_id = primary_industry.app_id
      AND industry.id = primary_industry.tag_id
      AND industry.kind = 'INDUSTRY'
      AND industry.enabled = 1`

const cardSelect = `SELECT ${cardFields} ${cardFrom}`

function author(row, caller, { includeProfileRef = true } = {}) {
  const profileVisibility = jsonObject(row.visibility_json)
  return {
    ...(includeProfileRef
      ? { profileRef: createProfileRef({ appId: caller.appId, userId: row.owner_user_id }, caller.profileRefSecret) }
      : {}),
    nickname: profileVisibility.nickname === false ? 'MIP 用户' : (row.nickname || 'MIP 用户'),
    avatarUrl: profileVisibility.avatar === false ? undefined : (row.avatar_file_id || undefined),
    headline: profileVisibility.headline === false ? undefined : (row.headline || undefined),
    cityName: profileVisibility.primaryBranch === false ? undefined : (row.city_name || undefined),
    primaryIndustry: profileVisibility.industry === false || !row.industry_tag_id
      ? undefined
      : { id: row.industry_tag_id, key: row.industry_key, label: row.industry_label },
  }
}

function summary(row, caller) {
  const mine = Boolean(caller.userId && caller.userId === row.owner_user_id)
  return {
    id: row.id,
    roleKey: row.role_key,
    positioning: row.positioning,
    targetSummary: row.target_summary,
    abilityScores: jsonObject(row.ability_scores_json),
    status: row.status,
    publishedAt: iso(row.published_at),
    author: author(row, caller),
    mine,
    ...(mine ? { version: Number(row.version) } : {}),
  }
}

function talentSummaries(rows, caller) {
  const talents = new Map()
  for (const row of rows) {
    let talent = talents.get(row.owner_user_id)
    if (!talent) {
      talent = {
        ownerUserId: row.owner_user_id,
        joinedAt: iso(row.user_created_at),
        item: {
          talentKey: createTalentKey(
            { appId: caller.appId, userId: row.owner_user_id },
            caller.profileRefSecret,
          ),
          profileRef: createProfileRef(
            { appId: caller.appId, userId: row.owner_user_id },
            caller.profileRefSecret,
          ),
          author: author(row, caller, { includeProfileRef: false }),
          joinedAt: iso(row.user_created_at),
          cards: [],
        },
      }
      talents.set(row.owner_user_id, talent)
    }
    talent.item.cards.push({
      id: row.id,
      roleKey: row.role_key,
      positioning: row.positioning,
      targetSummary: row.target_summary,
      abilityScores: jsonObject(row.ability_scores_json),
      publishedAt: iso(row.published_at),
    })
  }
  return [...talents.values()]
}

async function listCooperationCards(database, caller, rawFilter = {}) {
  const filter = normalizeFilter(rawFilter)
  await assertSelectableTags(
    database,
    caller.appId,
    filter.industryTagIds.map(id => [id, 'INDUSTRY']),
  )
  if (filter.branchId) {
    const branch = await database.one(
      `SELECT id FROM mip_city_branches
       WHERE app_id = ? AND id = ? AND status = 'ACTIVE'`,
      [caller.appId, filter.branchId],
    )
    if (!branch) throw new Error('VALIDATION_FAILED')
  }
  const where = ["c.app_id = ?", "c.status = 'PUBLISHED'"]
  const params = [caller.appId]
  const blockFilter = mutualBlockFilter(caller.userId, 'c.owner_user_id', 'c.app_id')
  if (blockFilter.sql) {
    where.push(blockFilter.sql)
    params.push(...blockFilter.params)
  }
  if (filter.keyword) {
    const pattern = likePattern(filter.keyword)
    where.push(`(
      c.positioning LIKE ? ESCAPE '=' OR c.target_summary LIKE ? ESCAPE '='
      OR CAST(c.role_fields_json AS CHAR) LIKE ? ESCAPE '='
      OR (
        COALESCE(JSON_UNQUOTE(JSON_EXTRACT(p.visibility_json, '$.nickname')), 'true') <> 'false'
        AND p.nickname LIKE ? ESCAPE '='
      )
      OR (
        COALESCE(JSON_UNQUOTE(JSON_EXTRACT(p.visibility_json, '$.headline')), 'true') <> 'false'
        AND p.headline LIKE ? ESCAPE '='
      )
    )`)
    params.push(pattern, pattern, pattern, pattern, pattern)
  }
  if (filter.branchId) {
    where.push(`u.primary_branch_id = ?
      AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(p.visibility_json, '$.primaryBranch')), 'true') <> 'false'`)
    params.push(filter.branchId)
  }
  if (filter.roleKey) {
    where.push('c.role_key = ?')
    params.push(filter.roleKey)
  }
  if (filter.industryTagIds.length) {
    where.push(`COALESCE(JSON_UNQUOTE(JSON_EXTRACT(p.visibility_json, '$.industry')), 'true') <> 'false'
      AND EXISTS (
        SELECT 1
        FROM mip_profile_tags industry_filter
        INNER JOIN mip_tags industry_tag
          ON industry_tag.app_id = industry_filter.app_id
            AND industry_tag.id = industry_filter.tag_id
            AND industry_tag.kind = 'INDUSTRY'
            AND industry_tag.enabled = 1
        WHERE industry_filter.app_id = c.app_id
          AND industry_filter.user_id = c.owner_user_id
          AND industry_filter.relation = 'PRIMARY_INDUSTRY'
          AND industry_filter.tag_id IN (${filter.industryTagIds.map(() => '?').join(', ')})
      )`)
    params.push(...filter.industryTagIds)
  }
  if (filter.cursor) {
    where.push('(c.published_at < ? OR (c.published_at = ? AND c.id < ?))')
    params.push(filter.cursor.timestamp, filter.cursor.timestamp, filter.cursor.id)
  }
  const rows = await database.query(
    `${cardSelect}
     WHERE ${where.join(' AND ')}
     ORDER BY c.published_at DESC, c.id DESC
     LIMIT ${filter.limit + 1}`,
    params,
  )
  const pageRows = rows.slice(0, filter.limit)
  return {
    items: pageRows.map(row => summary(row, caller)),
    nextCursor: rows.length > filter.limit && pageRows.length
      ? encodeCursor(pageRows.at(-1).published_at, pageRows.at(-1).id)
      : undefined,
  }
}

async function listCooperationTalents(database, caller, rawFilter = {}) {
  const filter = normalizeTalentFilter(rawFilter)
  await assertSelectableTags(
    database,
    caller.appId,
    filter.industryTagIds.map(id => [id, 'INDUSTRY']),
  )
  if (filter.branchId) {
    const branch = await database.one(
      `SELECT id FROM mip_city_branches
       WHERE app_id = ? AND id = ? AND status = 'ACTIVE'`,
      [caller.appId, filter.branchId],
    )
    if (!branch) throw new Error('VALIDATION_FAILED')
  }
  const context = talentFilterContext(caller.appId, caller.userId, filter)
  const cursor = filter.cursor
    ? readTalentCursor(filter.cursor, context, caller.profileRefSecret)
    : null
  const where = [
    'c.app_id = ?',
    "c.status = 'PUBLISHED'",
    "u.status = 'ACTIVE'",
    'u.created_at <= snapshot.snapshot_at',
    'c.published_at <= snapshot.snapshot_at',
  ]
  const params = [caller.appId]
  const blockFilter = mutualBlockFilter(caller.userId, 'c.owner_user_id', 'c.app_id')
  if (blockFilter.sql) {
    where.push(blockFilter.sql)
    params.push(...blockFilter.params)
  }
  const visibleWhere = [
    'c.app_id = ?',
    "c.status = 'PUBLISHED'",
    "u.status = 'ACTIVE'",
    'u.created_at <= talent_page.snapshot_at',
    'c.published_at <= talent_page.snapshot_at',
  ]
  const visibleParams = [caller.appId]
  if (blockFilter.sql) {
    visibleWhere.push(blockFilter.sql)
    visibleParams.push(...blockFilter.params)
  }
  if (filter.keyword) {
    const pattern = likePattern(filter.keyword)
    where.push(`(
      c.positioning LIKE ? ESCAPE '=' OR c.target_summary LIKE ? ESCAPE '='
      OR CAST(c.role_fields_json AS CHAR) LIKE ? ESCAPE '='
      OR (
        COALESCE(JSON_UNQUOTE(JSON_EXTRACT(p.visibility_json, '$.nickname')), 'true') <> 'false'
        AND p.nickname LIKE ? ESCAPE '='
      )
      OR (
        COALESCE(JSON_UNQUOTE(JSON_EXTRACT(p.visibility_json, '$.headline')), 'true') <> 'false'
        AND p.headline LIKE ? ESCAPE '='
      )
    )`)
    params.push(pattern, pattern, pattern, pattern, pattern)
  }
  if (filter.branchId) {
    where.push(`u.primary_branch_id = ?
      AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(p.visibility_json, '$.primaryBranch')), 'true') <> 'false'`)
    params.push(filter.branchId)
  }
  if (filter.roleKey) {
    where.push('c.role_key = ?')
    params.push(filter.roleKey)
  }
  if (filter.industryTagIds.length) {
    where.push(`COALESCE(JSON_UNQUOTE(JSON_EXTRACT(p.visibility_json, '$.industry')), 'true') <> 'false'
      AND EXISTS (
        SELECT 1
        FROM mip_profile_tags industry_filter
        INNER JOIN mip_tags industry_tag
          ON industry_tag.app_id = industry_filter.app_id
            AND industry_tag.id = industry_filter.tag_id
            AND industry_tag.kind = 'INDUSTRY'
            AND industry_tag.enabled = 1
        WHERE industry_filter.app_id = c.app_id
          AND industry_filter.user_id = c.owner_user_id
          AND industry_filter.relation = 'PRIMARY_INDUSTRY'
          AND industry_filter.tag_id IN (${filter.industryTagIds.map(() => '?').join(', ')})
      )`)
    params.push(...filter.industryTagIds)
  }
  const rows = await database.query(
    `WITH snapshot AS (
       SELECT ${cursor ? 'CAST(? AS DATETIME(3))' : 'UTC_TIMESTAMP(3)'} AS snapshot_at
     ), matching_cards AS (
       SELECT c.owner_user_id, u.created_at AS user_created_at, snapshot.snapshot_at
       ${cardFrom}
       CROSS JOIN snapshot
       WHERE ${where.join(' AND ')}
     ), talent_page AS (
       SELECT owner_user_id, user_created_at, snapshot_at
       FROM matching_cards
       GROUP BY owner_user_id, user_created_at, snapshot_at
       ${cursor
         ? `HAVING user_created_at < ?
           OR (user_created_at = ? AND owner_user_id < ?)`
         : ''}
       ORDER BY user_created_at DESC, owner_user_id DESC
       LIMIT ${filter.limit + 1}
     )
     SELECT ${cardFields}, talent_page.user_created_at, talent_page.snapshot_at
     ${cardFrom}
     INNER JOIN talent_page ON talent_page.owner_user_id = c.owner_user_id
     WHERE ${visibleWhere.join(' AND ')}
     ORDER BY talent_page.user_created_at DESC, talent_page.owner_user_id DESC,
              c.published_at DESC, c.id DESC`,
    cursor
      ? [
          mysqlTimestamp(cursor.snapshotAt),
          ...params,
          mysqlTimestamp(cursor.createdAt),
          mysqlTimestamp(cursor.createdAt),
          cursor.userId,
          ...visibleParams,
        ]
      : [...params, ...visibleParams],
  )
  const talents = talentSummaries(rows, caller)
  const pageTalents = talents.slice(0, filter.limit)
  return {
    items: pageTalents.map(talent => talent.item),
    nextCursor: talents.length > filter.limit && pageTalents.length
      ? createTalentCursor(context, {
          snapshotAt: rows[0].snapshot_at,
          createdAt: pageTalents.at(-1).joinedAt,
          userId: pageTalents.at(-1).ownerUserId,
        }, caller.profileRefSecret)
      : undefined,
  }
}

async function listMyCooperationCards(database, caller, input = {}) {
  if (!caller.userId) throw new Error('AUTH_REQUIRED')
  const pageLimit = limit(input.limit, 20)
  const cursor = decodeCursor(input.cursor)
  const params = [caller.appId, caller.userId]
  const cursorSql = cursor
    ? 'AND (c.updated_at < ? OR (c.updated_at = ? AND c.id < ?))'
    : ''
  if (cursor) params.push(cursor.timestamp, cursor.timestamp, cursor.id)
  const rows = await database.query(
    `${cardSelect}
     WHERE c.app_id = ? AND c.owner_user_id = ? AND c.status <> 'ARCHIVED' ${cursorSql}
     ORDER BY c.updated_at DESC, c.id DESC
     LIMIT ${pageLimit + 1}`,
    params,
  )
  const pageRows = rows.slice(0, pageLimit)
  return {
    items: pageRows.map(row => summary(row, caller)),
    nextCursor: rows.length > pageLimit && pageRows.length
      ? encodeCursor(pageRows.at(-1).updated_at, pageRows.at(-1).id)
      : undefined,
  }
}

async function getCooperationCard(database, caller, id) {
  if (!uuid(id)) throw new Error('NOT_FOUND')
  const blockFilter = mutualBlockFilter(caller.userId, 'c.owner_user_id', 'c.app_id')
  const row = await database.one(
    `${cardSelect} WHERE c.app_id = ? AND c.id = ?
       ${blockFilter.sql ? `AND ${blockFilter.sql}` : ''}`,
    [caller.appId, id, ...blockFilter.params],
  )
  if (!row) throw new Error('NOT_FOUND')
  if (row.status === 'ARCHIVED') throw new Error('NOT_FOUND')
  const mine = Boolean(caller.userId && caller.userId === row.owner_user_id)
  if (row.status !== 'PUBLISHED' && !mine) throw new Error('NOT_FOUND')
  let interestActive = false
  if (caller.userId) {
    const interest = await database.one(
      `SELECT status FROM mip_profile_interests
       WHERE app_id = ? AND actor_user_id = ? AND target_user_id = ?`,
      [caller.appId, caller.userId, row.owner_user_id],
    )
    interestActive = interest?.status === 'ACTIVE'
  }
  return {
    ...summary(row, caller),
    roleFields: jsonObject(row.role_fields_json),
    version: Number(row.version),
    interestActive,
    canEdit: mine,
  }
}

async function saveCooperationCard(database, contentSafety, caller, input) {
  const draft = normalizeDraft(input.draft)
  const aiConfirmation = normalizeAiConfirmation(input.aiConfirmation, 'COOPERATION_CARD')
  await contentSafety.assertSafe(caller, [
    draft.positioning,
    draft.targetSummary,
    ...Object.values(draft.roleFields).flat(),
  ])
  return idempotentTransaction(database, {
    appId: caller.appId,
    userId: caller.userId,
    operation: 'cooperation-card.save',
    idempotencyKey: input.idempotencyKey,
    request: aiConfirmation ? { draft, aiConfirmation } : draft,
  }, async (tx) => {
    await lockActiveContributor(tx, caller)
    const id = draft.id || randomUUID()
    let existing = null
    if (draft.id) {
      existing = await tx.one(
        `SELECT owner_user_id, role_key, status, version
         FROM mip_cooperation_cards
         WHERE app_id = ? AND id = ? FOR UPDATE`,
        [caller.appId, draft.id],
      )
      if (!existing) throw new Error('NOT_FOUND')
      if (existing.owner_user_id !== caller.userId) throw new Error('FORBIDDEN')
      if (existing.status === 'ARCHIVED') throw new Error('FORBIDDEN')
      if (existing.role_key !== draft.roleKey) throw new Error('CONFLICT')
      if (Number(existing.version) !== draft.expectedVersion) throw new Error('CONFLICT')
    }
    else {
      const sameRole = await tx.one(
        `SELECT id FROM mip_cooperation_cards
         WHERE app_id = ? AND owner_user_id = ? AND role_key = ?
           AND status <> 'ARCHIVED' FOR UPDATE`,
        [caller.appId, caller.userId, draft.roleKey],
      )
      if (sameRole) throw new Error('COOPERATION_ROLE_EXISTS')
    }
    const status = draft.publish
      ? 'PUBLISHED'
      : (['PUBLISHED', 'UNPUBLISHED'].includes(existing?.status) ? existing.status : 'DRAFT')
    const published = status === 'PUBLISHED'
    if (existing) {
      await tx.query(
        `UPDATE mip_cooperation_cards
         SET positioning = ?, target_summary = ?, role_fields_json = ?,
             ability_scores_json = ?, status = ?, content_safety_status = 'APPROVED',
             published_at = CASE WHEN ? = 1 THEN UTC_TIMESTAMP(3) ELSE published_at END,
             version = version + 1
         WHERE app_id = ? AND id = ? AND version = ?`,
        [
          draft.positioning, draft.targetSummary, JSON.stringify(draft.roleFields),
          JSON.stringify(draft.abilityScores), status, published ? 1 : 0,
          caller.appId, id, draft.expectedVersion,
        ],
      )
    }
    else {
      await tx.query(
        `INSERT INTO mip_cooperation_cards (
           id, app_id, owner_user_id, role_key, positioning, target_summary,
           role_fields_json, ability_scores_json, status, content_safety_status,
           published_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'APPROVED',
           CASE WHEN ? = 1 THEN UTC_TIMESTAMP(3) ELSE NULL END)`,
        [
          id, caller.appId, caller.userId, draft.roleKey, draft.positioning,
          draft.targetSummary, JSON.stringify(draft.roleFields), JSON.stringify(draft.abilityScores),
          status, published ? 1 : 0,
        ],
      )
    }
    const version = existing ? Number(existing.version) + 1 : 1
    await appendAudit(tx, {
      appId: caller.appId,
      actorUserId: caller.userId,
      action: existing ? 'COOPERATION_CARD_UPDATED' : 'COOPERATION_CARD_CREATED',
      resourceType: 'COOPERATION_CARD',
      resourceId: id,
      metadata: { roleKey: draft.roleKey, status, version },
    })
    await confirmAiDraft(tx, {
      appId: caller.appId,
      userId: caller.userId,
      confirmation: aiConfirmation,
      resourceId: id,
      structuredDraft: {
        roleKey: draft.roleKey,
        positioning: draft.positioning,
        targetSummary: draft.targetSummary,
        roleFields: draft.roleFields,
        abilityScores: draft.abilityScores,
      },
    })
    return { id, status, version }
  })
}

async function unpublishCooperationCard(database, caller, input = {}) {
  const id = stringValue(input.id, 36, 'VALIDATION_FAILED')
  const expectedVersion = Number(input.expectedVersion)
  if (!uuid(id) || !Number.isInteger(expectedVersion) || expectedVersion < 1) {
    throw new Error('VALIDATION_FAILED')
  }
  return idempotentTransaction(database, {
    appId: caller.appId,
    userId: caller.userId,
    operation: 'cooperation-card.unpublish',
    idempotencyKey: input.idempotencyKey,
    request: { id, expectedVersion },
  }, async (tx) => {
    await lockActiveContributor(tx, caller)
    const existing = await tx.one(
      `SELECT owner_user_id, status, version
       FROM mip_cooperation_cards
       WHERE app_id = ? AND id = ? FOR UPDATE`,
      [caller.appId, id],
    )
    if (!existing) throw new Error('NOT_FOUND')
    if (existing.owner_user_id !== caller.userId) throw new Error('FORBIDDEN')
    if (Number(existing.version) !== expectedVersion || existing.status !== 'PUBLISHED') {
      throw new Error('CONFLICT')
    }
    await tx.query(
      `UPDATE mip_cooperation_cards
       SET status = 'UNPUBLISHED', version = version + 1
       WHERE app_id = ? AND id = ? AND version = ?`,
      [caller.appId, id, expectedVersion],
    )
    const version = expectedVersion + 1
    await appendAudit(tx, {
      appId: caller.appId,
      actorUserId: caller.userId,
      action: 'COOPERATION_CARD_UNPUBLISHED',
      resourceType: 'COOPERATION_CARD',
      resourceId: id,
      metadata: { version },
    })
    return { id, status: 'UNPUBLISHED', version }
  })
}

async function archiveCooperationCard(database, caller, input = {}) {
  const id = stringValue(input.id, 36, 'VALIDATION_FAILED')
  const expectedVersion = Number(input.expectedVersion)
  if (!uuid(id) || !Number.isInteger(expectedVersion) || expectedVersion < 1) {
    throw new Error('VALIDATION_FAILED')
  }
  return idempotentTransaction(database, {
    appId: caller.appId,
    userId: caller.userId,
    operation: 'cooperation-card.archive',
    idempotencyKey: input.idempotencyKey,
    request: { id, expectedVersion },
  }, async (tx) => {
    await lockActiveContributor(tx, caller)
    const existing = await tx.one(
      `SELECT owner_user_id, status, version
       FROM mip_cooperation_cards
       WHERE app_id = ? AND id = ? FOR UPDATE`,
      [caller.appId, id],
    )
    if (!existing) throw new Error('NOT_FOUND')
    if (existing.owner_user_id !== caller.userId) throw new Error('FORBIDDEN')
    if (Number(existing.version) !== expectedVersion || existing.status === 'ARCHIVED') {
      throw new Error('CONFLICT')
    }
    const result = await tx.query(
      `UPDATE mip_cooperation_cards
       SET status = 'ARCHIVED', archived_at = UTC_TIMESTAMP(3), version = version + 1
       WHERE app_id = ? AND id = ? AND version = ? AND status <> 'ARCHIVED'`,
      [caller.appId, id, expectedVersion],
    )
    if (result.affectedRows !== 1) throw new Error('CONFLICT')
    const version = expectedVersion + 1
    await appendAudit(tx, {
      appId: caller.appId,
      actorUserId: caller.userId,
      action: 'COOPERATION_CARD_ARCHIVED',
      resourceType: 'COOPERATION_CARD',
      resourceId: id,
      metadata: { version },
    })
    return { id, status: 'ARCHIVED', version }
  })
}

module.exports = {
  archiveCooperationCard,
  getCooperationCard,
  listCooperationCards,
  listCooperationTalents,
  listMyCooperationCards,
  normalizeDraft,
  normalizeFilter,
  normalizeTalentFilter,
  saveCooperationCard,
  talentSummaries,
  unpublishCooperationCard,
}
