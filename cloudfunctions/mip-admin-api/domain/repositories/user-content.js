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

    const clauses = ["(content.published_at IS NOT NULL OR content.status IN ('DRAFT', 'ARCHIVED'))"]
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
           WHERE c.app_id = ? AND c.id = ?
             AND (c.published_at IS NOT NULL OR c.status IN ('DRAFT', 'ARCHIVED')) AND ${access.sql}`,
          [appId, contentId, ...access.params],
        )
      : await database.one(
          `${caseDetailSelect()}
           WHERE c.app_id = ? AND c.id = ?
             AND (c.published_at IS NOT NULL OR c.status IN ('DRAFT', 'ARCHIVED')) AND ${access.sql}`,
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
           WHERE content.app_id = ? AND content.id = ?
             AND (content.published_at IS NOT NULL OR content.status IN ('DRAFT', 'ARCHIVED'))
             AND ${access.sql}`,
          [appId, contentId, ...access.params],
        )
      : await database.one(
          `SELECT content.owner_user_id, u.primary_branch_id
           FROM mip_super_cases content
           INNER JOIN mip_users u
             ON u.app_id = content.app_id AND u.id = content.owner_user_id
           WHERE content.app_id = ? AND content.id = ?
             AND (content.published_at IS NOT NULL OR content.status IN ('DRAFT', 'ARCHIVED'))
             AND ${access.sql}`,
          [appId, contentId, ...access.params],
        )
    return row ? {
      ownerUserId: String(row.owner_user_id),
      scope: ownerScope(row.primary_branch_id),
    } : null
  }

  async function getUserContentOwnerScope(appId, visibility, ownerUserId) {
    const access = visibleOwnerWhere(visibility, 'u.primary_branch_id')
    const row = await database.one(
      `SELECT u.id AS owner_user_id, u.primary_branch_id
       FROM mip_users u
       WHERE u.app_id = ? AND u.id = ? AND u.status = 'ACTIVE' AND ${access.sql}`,
      [appId, ownerUserId, ...access.params],
    )
    return row ? {
      ownerUserId: String(row.owner_user_id),
      scope: ownerScope(row.primary_branch_id),
    } : null
  }

  async function saveUserContent(input) {
    return database.transaction(async tx => {
      const authorization = await lockMutation(tx, input)
      const ownerRow = await tx.one(
        `SELECT id, status, primary_branch_id
         FROM mip_users WHERE app_id = ? AND id = ? FOR UPDATE`,
        [input.appId, input.ownerUserId],
      )
      if (!ownerRow || ownerRow.status !== 'ACTIVE') throw codeError('NOT_FOUND')
      const currentScope = ownerScope(ownerRow.primary_branch_id)
      assertScope(authorization, currentScope)
      if (!sameScope(currentScope, input.authorizedScope)) throw codeError('CONFLICT')

      let existing = null
      if (input.contentId) {
        existing = await lockContent(tx, input)
        if (!existing) throw codeError('NOT_FOUND')
        if (existing.owner_user_id !== input.ownerUserId) throw codeError('CONFLICT')
        if (existing.status === 'ARCHIVED') throw codeError('INVALID_STATE')
        if (Number(existing.version) !== input.expectedVersion) throw codeError('CONFLICT')
        if (input.kind === 'COOPERATION_CARD' && existing.role_key !== input.draft.roleKey) {
          throw codeError('CONFLICT')
        }
      }
      await assertDraftReferences(tx, input)
      const status = input.draft.status || (existing?.status || 'DRAFT')
      if (status === 'PUBLISHED' && input.contentSafetyStatus !== 'APPROVED') {
        throw codeError('CONTENT_SAFETY_REQUIRED')
      }
      const id = input.contentId || require('node:crypto').randomUUID()
      if (input.kind === 'COOPERATION_CARD') {
        const d = input.draft
        if (existing) {
          await tx.query(
            `UPDATE mip_cooperation_cards
             SET positioning = ?, target_summary = ?, role_fields_json = ?, ability_scores_json = ?,
                 status = ?, content_safety_status = ?,
                 published_at = CASE WHEN ? = 'DRAFT' THEN NULL ELSE COALESCE(published_at, UTC_TIMESTAMP(3)) END,
                 archived_at = NULL, version = version + 1
             WHERE app_id = ? AND id = ? AND version = ?`,
            [d.positioning, d.targetSummary, JSON.stringify(d.roleFields), JSON.stringify(d.abilityScores),
              status, input.contentSafetyStatus, status, input.appId, id, input.expectedVersion],
          )
        }
        else {
          await tx.query(
            `INSERT INTO mip_cooperation_cards
             (id, app_id, owner_user_id, role_key, positioning, target_summary, role_fields_json,
              ability_scores_json, status, content_safety_status, published_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CASE WHEN ? = 'DRAFT' THEN NULL ELSE UTC_TIMESTAMP(3) END)`,
            [id, input.appId, input.ownerUserId, d.roleKey, d.positioning, d.targetSummary,
              JSON.stringify(d.roleFields), JSON.stringify(d.abilityScores), status,
              input.contentSafetyStatus, status],
          )
        }
      }
      else {
        const d = input.draft
        if (existing) {
          await tx.query(
            `UPDATE mip_super_cases
             SET project_name = ?, summary = ?, started_on = ?, ended_on = ?, responsibility = ?,
                 city_tag_id = ?, industry_tag_id = ?, case_type = ?, description = ?, cover_asset_id = ?,
                 status = ?, content_safety_status = ?,
                 published_at = CASE WHEN ? = 'DRAFT' THEN NULL ELSE COALESCE(published_at, UTC_TIMESTAMP(3)) END,
                 archived_at = NULL, version = version + 1
             WHERE app_id = ? AND id = ? AND version = ?`,
            [d.projectName, d.summary, d.startedOn, d.endedOn, d.responsibility, d.cityTagId,
              d.industryTagId, d.caseType, d.description, d.coverAssetId, status,
              input.contentSafetyStatus, status, input.appId, id, input.expectedVersion],
          )
        }
        else {
          await tx.query(
            `INSERT INTO mip_super_cases
             (id, app_id, owner_user_id, project_name, summary, started_on, ended_on, responsibility,
              city_tag_id, industry_tag_id, case_type, description, cover_asset_id, status,
              content_safety_status, published_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                     CASE WHEN ? = 'DRAFT' THEN NULL ELSE UTC_TIMESTAMP(3) END)`,
            [id, input.appId, input.ownerUserId, d.projectName, d.summary, d.startedOn, d.endedOn,
              d.responsibility, d.cityTagId, d.industryTagId, d.caseType, d.description,
              d.coverAssetId, status, input.contentSafetyStatus, status],
          )
        }
        await tx.query('DELETE FROM mip_super_case_media WHERE app_id = ? AND super_case_id = ?', [input.appId, id])
        for (const [sortOrder, mediaAssetId] of d.mediaAssetIds.entries()) {
          await tx.query(
            `INSERT INTO mip_super_case_media (app_id, super_case_id, media_asset_id, sort_order)
             VALUES (?, ?, ?, ?)`,
            [input.appId, id, mediaAssetId, sortOrder],
          )
        }
      }
      const version = existing ? Number(existing.version) + 1 : 1
      await writeAudit(tx, input.audit(id, version, status))
      return { id, kind: input.kind, status, version }
    })
  }

  async function archiveUserContent(input) {
    return database.transaction(async tx => {
      const authorization = await lockMutation(tx, input)
      const row = await lockContent(tx, input)
      if (!row) throw codeError('NOT_FOUND')
      const currentScope = ownerScope(row.primary_branch_id)
      assertScope(authorization, currentScope)
      if (!sameScope(currentScope, input.authorizedScope)) throw codeError('CONFLICT')
      if (row.status === 'ARCHIVED') throw codeError('INVALID_STATE')
      if (Number(row.version) !== input.expectedVersion) throw codeError('CONFLICT')
      const table = input.kind === 'COOPERATION_CARD' ? 'mip_cooperation_cards' : 'mip_super_cases'
      const result = await tx.query(
        `UPDATE ${table} SET status = 'ARCHIVED', archived_at = UTC_TIMESTAMP(3), version = version + 1
         WHERE app_id = ? AND id = ? AND status <> 'ARCHIVED' AND version = ?`,
        [input.appId, input.contentId, input.expectedVersion],
      )
      if (Number(result.affectedRows) !== 1) throw codeError('CONFLICT')
      await writeAudit(tx, input.audit(input.expectedVersion + 1))
      return { id: input.contentId, kind: input.kind, status: 'ARCHIVED', version: input.expectedVersion + 1 }
    })
  }

  async function assertDraftReferences(tx, input) {
    if (input.kind !== 'SUPER_CASE') return
    const draft = input.draft
    const tagPairs = [
      ...(draft.cityTagId ? [[draft.cityTagId, 'CITY']] : []),
      ...(draft.industryTagId ? [[draft.industryTagId, 'INDUSTRY']] : []),
    ]
    if (tagPairs.length) {
      const rows = await tx.query(
        `SELECT id, kind FROM mip_tags
         WHERE app_id = ? AND id IN (${tagPairs.map(() => '?').join(', ')})
           AND enabled = 1 AND selectable = 1`,
        [input.appId, ...tagPairs.map(([id]) => id)],
      )
      const byId = new Map(rows.map(row => [row.id, row.kind]))
      if (tagPairs.some(([id, kind]) => byId.get(id) !== kind)) throw codeError('VALIDATION_FAILED')
    }
    const assets = [...new Set([draft.coverAssetId, ...draft.mediaAssetIds].filter(Boolean))]
    if (!assets.length) return
    const rows = await tx.query(
      `SELECT id, purpose FROM mip_media_assets
       WHERE app_id = ? AND owner_user_id = ? AND status = 'READY'
         AND id IN (${assets.map(() => '?').join(', ')})`,
      [input.appId, input.ownerUserId, ...assets],
    )
    const byId = new Map(rows.map(row => [row.id, row.purpose]))
    if (rows.length !== assets.length
      || (draft.coverAssetId && byId.get(draft.coverAssetId) !== 'SUPER_CASE_COVER')
      || draft.mediaAssetIds.some(assetId => byId.get(assetId) !== 'SUPER_CASE_MEDIA')) {
      throw codeError('VALIDATION_FAILED')
    }
  }

  async function unpublishUserContent(input) {
    return database.transaction(async (tx) => {
      const authorization = await lockMutation(tx, input)
      const row = await lockContent(tx, input)
      if (!row) throw codeError('NOT_FOUND')
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
         AND audit.action IN ('admin.user_content.unpublish', 'admin.user_content.archive')
       ORDER BY audit.created_at DESC, audit.id DESC
       LIMIT 50`,
      [appId, kind, contentId],
    )
    return rows.map(row => {
      const metadata = json(row.metadata_json, {})
      return {
        action: row.action.endsWith('.archive') ? 'ARCHIVE' : 'UNPUBLISH',
        actorNickname: row.actor_nickname || '运营成员',
        reason: typeof metadata.reason === 'string' ? metadata.reason : '',
        createdAt: iso(row.created_at),
      }
    })
  }

  return {
    archiveUserContent,
    getUserContent,
    getUserContentOwnerScope,
    getUserContentScope,
    listUserContent,
    saveUserContent,
    unpublishUserContent,
  }
}

async function lockContent(tx, input) {
  const sql = input.kind === 'COOPERATION_CARD'
    ? `SELECT content.owner_user_id, content.role_key, content.status, content.version,
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
      c.city_tag_id, c.industry_tag_id, c.cover_asset_id,
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
    cityTagId: row.city_tag_id || null,
    industryTagId: row.industry_tag_id || null,
    coverAssetId: row.cover_asset_id || null,
    mediaAssetIds: media.map(item => item.assetId),
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
