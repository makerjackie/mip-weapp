'use strict'

const { cursorPredicateFor, decodeCursor, pageRows } = require('../pagination')

function createAdminUserContentRepository(database, options = {}) {
  const assertScope = options.assertMutationScope
  const lockMutation = options.lockMutationAuthorization
  const writeAudit = options.writeAudit
  if (typeof assertScope !== 'function'
    || typeof lockMutation !== 'function'
    || typeof writeAudit !== 'function') {
    throw new TypeError('User content governance repository is invalid')
  }

  async function listUserContent(appId, visibility, filters, pageLimit) {
    const cursor = decodeCursor(filters.cursor, ['updatedAt', 'id'])
    const params = [appId, appId]

    const clauses = ['content.published_at IS NOT NULL']
    if (filters.kind !== 'ALL') {
      clauses.push('content.kind = ?')
      params.push(filters.kind)
    }
    if (filters.status !== 'ALL') {
      clauses.push('content.status = ?')
      params.push(filters.status)
    }
    const access = visibleOwnerWhere(visibility, 'content.owner_branch_id')
    clauses.push(access.sql)
    params.push(...access.params)
    if (filters.branchId) {
      clauses.push('content.owner_branch_id = ?')
      params.push(filters.branchId)
    }
    if (filters.ownerUserId) {
      clauses.push('content.owner_user_id = ?')
      params.push(filters.ownerUserId)
    }
    if (filters.roleKey) {
      clauses.push('content.role_key = ?')
      params.push(filters.roleKey)
    }
    if (filters.contentSafetyStatus) {
      clauses.push('content.content_safety_status = ?')
      params.push(filters.contentSafetyStatus)
    }
    if (filters.query) {
      clauses.push(`(content.title LIKE ? ESCAPE '\\\\'
        OR content.summary LIKE ? ESCAPE '\\\\'
        OR content.owner_nickname LIKE ? ESCAPE '\\\\')`)
      const query = `%${escapeLike(filters.query)}%`
      params.push(query, query, query)
    }
    const cursorWhere = cursorPredicateFor(
      'content.updated_at',
      cursor,
      'updatedAt',
      'content.cursor_id',
    )
    const rows = await database.query(
      `SELECT content.* FROM (
         SELECT 'COOPERATION_CARD' AS kind, CONCAT('1:', c.id) AS cursor_id,
           c.id, c.owner_user_id, u.primary_branch_id AS owner_branch_id,
           COALESCE(p.nickname, '未填写昵称') AS owner_nickname,
           COALESCE(branch.name, '') AS branch_name,
           COALESCE(branch.city_name, '') AS city_name,
           c.positioning AS title, c.target_summary AS summary, c.role_key,
           c.status, c.content_safety_status, c.version,
           c.published_at, c.archived_at, c.updated_at
         FROM mip_cooperation_cards c
         INNER JOIN mip_users u ON u.app_id = c.app_id AND u.id = c.owner_user_id
         LEFT JOIN mip_profiles p ON p.app_id = u.app_id AND p.user_id = u.id
         LEFT JOIN mip_city_branches branch
           ON branch.app_id = u.app_id AND branch.id = u.primary_branch_id
         WHERE c.app_id = ?
         UNION ALL
         SELECT 'SUPER_CASE' AS kind, CONCAT('2:', c.id) AS cursor_id,
           c.id, c.owner_user_id, u.primary_branch_id AS owner_branch_id,
           COALESCE(p.nickname, '未填写昵称') AS owner_nickname,
           COALESCE(branch.name, '') AS branch_name,
           COALESCE(branch.city_name, '') AS city_name,
           c.project_name AS title, c.summary, CAST(NULL AS CHAR(32)) AS role_key,
           c.status, c.content_safety_status, c.version,
           c.published_at, c.archived_at, c.updated_at
         FROM mip_super_cases c
         INNER JOIN mip_users u ON u.app_id = c.app_id AND u.id = c.owner_user_id
         LEFT JOIN mip_profiles p ON p.app_id = u.app_id AND p.user_id = u.id
         LEFT JOIN mip_city_branches branch
           ON branch.app_id = u.app_id AND branch.id = u.primary_branch_id
         WHERE c.app_id = ?
       ) content
       WHERE ${clauses.join(' AND ')}${cursorWhere.sql}
       ORDER BY content.updated_at DESC, content.cursor_id DESC
       LIMIT ?`,
      [...params, ...cursorWhere.params, pageLimit + 1],
    )
    const items = rows.map(listItem)
    const page = pageRows(items, pageLimit, row => ({
      updatedAt: row.updatedAt,
      id: row.cursorId,
    }))
    return {
      items: page.items.map(({ cursorId, ...item }) => item),
      nextCursor: page.nextCursor,
    }
  }

  async function getUserContent(appId, visibility, kind, contentId) {
    const access = visibleOwnerWhere(visibility, 'u.primary_branch_id')
    const row = kind === 'COOPERATION_CARD'
      ? await database.one(
          `${cardDetailSelect()}
           WHERE c.app_id = ? AND c.id = ? AND c.published_at IS NOT NULL AND ${access.sql}`,
          [appId, contentId, ...access.params],
        )
      : await database.one(
          `${caseDetailSelect()}
           WHERE c.app_id = ? AND c.id = ? AND c.published_at IS NOT NULL AND ${access.sql}`,
          [appId, contentId, ...access.params],
        )
    if (!row) return null

    const [media, history] = await Promise.all([
      kind === 'SUPER_CASE' ? listCaseMedia(appId, contentId) : Promise.resolve([]),
      listModerationHistory(appId, kind, contentId),
    ])
    return detailItem(kind, row, media, history)
  }

  async function getUserContentScope(appId, visibility, kind, contentId) {
    const access = visibleOwnerWhere(visibility, 'u.primary_branch_id')
    const row = kind === 'COOPERATION_CARD'
      ? await database.one(
          `SELECT content.owner_user_id, u.primary_branch_id
           FROM mip_cooperation_cards content
           INNER JOIN mip_users u
             ON u.app_id = content.app_id AND u.id = content.owner_user_id
           WHERE content.app_id = ? AND content.id = ? AND content.published_at IS NOT NULL
             AND ${access.sql}`,
          [appId, contentId, ...access.params],
        )
      : await database.one(
          `SELECT content.owner_user_id, u.primary_branch_id
           FROM mip_super_cases content
           INNER JOIN mip_users u
             ON u.app_id = content.app_id AND u.id = content.owner_user_id
           WHERE content.app_id = ? AND content.id = ? AND content.published_at IS NOT NULL
             AND ${access.sql}`,
          [appId, contentId, ...access.params],
        )
    return row ? {
      ownerUserId: String(row.owner_user_id),
      scope: ownerScope(row.primary_branch_id),
    } : null
  }

  async function unpublishUserContent(input) {
    return database.transaction(async (tx) => {
      const authorization = await lockMutation(tx, input)
      const row = await lockContent(tx, input)
      if (!row || !row.published_at) throw codeError('NOT_FOUND')
      const currentScope = ownerScope(row.primary_branch_id)
      assertScope(authorization, currentScope)
      if (!sameScope(currentScope, input.authorizedScope)) throw codeError('CONFLICT')
      if (row.status !== 'PUBLISHED') throw codeError('INVALID_STATE')
      if (Number(row.version) !== input.expectedVersion) throw codeError('CONFLICT')

      const result = await updatePublishedContent(tx, input)
      if (Number(result.affectedRows) !== 1) throw codeError('CONFLICT')
      await writeAudit(tx, input.audit(input.expectedVersion + 1))
      return {
        id: input.contentId,
        kind: input.kind,
        status: 'UNPUBLISHED',
        version: input.expectedVersion + 1,
      }
    })
  }

  async function listCaseMedia(appId, contentId) {
    const rows = await database.query(
      `SELECT media.media_asset_id, media.caption, asset.cloud_file_id
       FROM mip_super_case_media media
       INNER JOIN mip_media_assets asset
         ON asset.app_id = media.app_id AND asset.id = media.media_asset_id
         AND asset.status = 'READY'
       WHERE media.app_id = ? AND media.super_case_id = ?
       ORDER BY media.sort_order, media.media_asset_id`,
      [appId, contentId],
    )
    return rows.map(row => ({
      assetId: String(row.media_asset_id),
      url: String(row.cloud_file_id),
      caption: row.caption || '',
    }))
  }

  async function listModerationHistory(appId, kind, contentId) {
    const rows = await database.query(
      `SELECT audit.action, audit.metadata_json, audit.created_at,
              profile.nickname AS actor_nickname
       FROM mip_audit_logs audit
       LEFT JOIN mip_profiles profile
         ON profile.app_id = audit.app_id AND profile.user_id = audit.actor_user_id
       WHERE audit.app_id = ? AND audit.resource_type = ? AND audit.resource_id = ?
         AND audit.action = 'admin.user_content.unpublish'
       ORDER BY audit.created_at DESC, audit.id DESC
       LIMIT 50`,
      [appId, kind, contentId],
    )
    return rows.map(row => {
      const metadata = json(row.metadata_json, {})
      return {
        action: 'UNPUBLISH',
        actorNickname: row.actor_nickname || '运营成员',
        reason: typeof metadata.reason === 'string' ? metadata.reason : '',
        createdAt: iso(row.created_at),
      }
    })
  }

  return {
    getUserContent,
    getUserContentScope,
    listUserContent,
    unpublishUserContent,
  }
}

async function lockContent(tx, input) {
  const sql = input.kind === 'COOPERATION_CARD'
    ? `SELECT content.owner_user_id, content.status, content.version,
              content.published_at, u.primary_branch_id
       FROM mip_cooperation_cards content
       INNER JOIN mip_users u
         ON u.app_id = content.app_id AND u.id = content.owner_user_id
       WHERE content.app_id = ? AND content.id = ? FOR UPDATE`
    : `SELECT content.owner_user_id, content.status, content.version,
              content.published_at, u.primary_branch_id
       FROM mip_super_cases content
       INNER JOIN mip_users u
         ON u.app_id = content.app_id AND u.id = content.owner_user_id
       WHERE content.app_id = ? AND content.id = ? FOR UPDATE`
  return tx.one(sql, [input.appId, input.contentId])
}

async function updatePublishedContent(tx, input) {
  const sql = input.kind === 'COOPERATION_CARD'
    ? `UPDATE mip_cooperation_cards
       SET status = 'UNPUBLISHED', version = version + 1
       WHERE app_id = ? AND id = ? AND status = 'PUBLISHED' AND version = ?`
    : `UPDATE mip_super_cases
       SET status = 'UNPUBLISHED', version = version + 1
       WHERE app_id = ? AND id = ? AND status = 'PUBLISHED' AND version = ?`
  return tx.query(sql, [input.appId, input.contentId, input.expectedVersion])
}

function cardDetailSelect() {
  return `SELECT c.id, c.owner_user_id, c.role_key, c.positioning, c.target_summary,
      c.role_fields_json, c.ability_scores_json, c.status, c.content_safety_status,
      c.version, c.published_at, c.archived_at, c.updated_at,
      u.primary_branch_id, COALESCE(p.nickname, '未填写昵称') AS owner_nickname,
      COALESCE(branch.name, '') AS branch_name, COALESCE(branch.city_name, '') AS city_name
    FROM mip_cooperation_cards c
    INNER JOIN mip_users u ON u.app_id = c.app_id AND u.id = c.owner_user_id
    LEFT JOIN mip_profiles p ON p.app_id = u.app_id AND p.user_id = u.id
    LEFT JOIN mip_city_branches branch
      ON branch.app_id = u.app_id AND branch.id = u.primary_branch_id`
}

function caseDetailSelect() {
  return `SELECT c.id, c.owner_user_id, c.project_name, c.summary, c.started_on, c.ended_on,
      c.responsibility, c.case_type, c.description, c.status, c.content_safety_status,
      c.version, c.published_at, c.archived_at, c.updated_at,
      u.primary_branch_id, COALESCE(p.nickname, '未填写昵称') AS owner_nickname,
      COALESCE(branch.name, '') AS branch_name, COALESCE(branch.city_name, '') AS city_name,
      city.label AS city_label, industry.label AS industry_label,
      cover.cloud_file_id AS cover_url
    FROM mip_super_cases c
    INNER JOIN mip_users u ON u.app_id = c.app_id AND u.id = c.owner_user_id
    LEFT JOIN mip_profiles p ON p.app_id = u.app_id AND p.user_id = u.id
    LEFT JOIN mip_city_branches branch
      ON branch.app_id = u.app_id AND branch.id = u.primary_branch_id
    LEFT JOIN mip_tags city ON city.app_id = c.app_id AND city.id = c.city_tag_id
    LEFT JOIN mip_tags industry ON industry.app_id = c.app_id AND industry.id = c.industry_tag_id
    LEFT JOIN mip_media_assets cover
      ON cover.app_id = c.app_id AND cover.id = c.cover_asset_id AND cover.status = 'READY'`
}

function listItem(row) {
  return {
    cursorId: String(row.cursor_id),
    id: String(row.id),
    kind: row.kind,
    title: String(row.title || ''),
    summary: String(row.summary || ''),
    roleKey: row.role_key || null,
    status: row.status,
    contentSafetyStatus: row.content_safety_status,
    version: Number(row.version),
    owner: owner(row),
    publishedAt: iso(row.published_at),
    archivedAt: iso(row.archived_at),
    updatedAt: iso(row.updated_at),
  }
}

function detailItem(kind, row, media, history) {
  const common = {
    id: String(row.id),
    kind,
    status: row.status,
    contentSafetyStatus: row.content_safety_status,
    version: Number(row.version),
    owner: owner(row),
    publishedAt: iso(row.published_at),
    archivedAt: iso(row.archived_at),
    updatedAt: iso(row.updated_at),
    moderationHistory: history,
  }
  if (kind === 'COOPERATION_CARD') {
    return {
      ...common,
      roleKey: row.role_key,
      positioning: row.positioning,
      targetSummary: row.target_summary,
      roleFields: json(row.role_fields_json, {}),
      abilityScores: json(row.ability_scores_json, {}),
    }
  }
  return {
    ...common,
    projectName: row.project_name,
    summary: row.summary,
    startedOn: date(row.started_on),
    endedOn: date(row.ended_on),
    responsibility: row.responsibility,
    cityLabel: row.city_label || '',
    industryLabel: row.industry_label || '',
    caseType: row.case_type || '',
    description: row.description,
    coverUrl: row.cover_url || '',
    media,
  }
}

function owner(row) {
  return {
    userId: String(row.owner_user_id),
    nickname: String(row.owner_nickname || '未填写昵称'),
    branchId: row.owner_branch_id || row.primary_branch_id || null,
    branchName: String(row.branch_name || ''),
    cityName: String(row.city_name || ''),
  }
}

function visibleOwnerWhere(visibility, column) {
  if (visibility.platform) return { sql: '1 = 1', params: [] }
  if (!visibility.branchIds.length) return { sql: '0 = 1', params: [] }
  return {
    sql: `${column} IN (${visibility.branchIds.map(() => '?').join(', ')})`,
    params: [...visibility.branchIds],
  }
}

function ownerScope(branchId) {
  return branchId
    ? { scopeType: 'BRANCH', scopeId: String(branchId) }
    : { scopeType: 'PLATFORM', scopeId: null }
}

function sameScope(left, right) {
  return left?.scopeType === right?.scopeType
    && (left?.scopeId || null) === (right?.scopeId || null)
}

function escapeLike(value) {
  return value.replace(/[\\%_]/g, '\\$&')
}

function json(value, fallback) {
  if (value === null || value === undefined) return fallback
  if (typeof value === 'object') return value
  try { return JSON.parse(value) }
  catch { return fallback }
}

function iso(value) {
  if (!value) return null
  const parsed = value instanceof Date ? value : new Date(value)
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null
}

function date(value) {
  if (!value) return null
  if (typeof value === 'string') return value.slice(0, 10)
  return value instanceof Date ? value.toISOString().slice(0, 10) : null
}

function codeError(code) {
  const error = new Error(code)
  error.code = code
  return error
}

module.exports = { createAdminUserContentRepository }
