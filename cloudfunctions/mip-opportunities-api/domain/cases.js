'use strict'

const { randomUUID } = require('node:crypto')
const { lockActiveContributor } = require('../lib/auth')
const { createProfileRef } = require('../lib/profile-ref')
const { confirmAiDraft, normalizeAiConfirmation } = require('./ai-confirmation')
const {
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

function limit(value, fallback = 16) {
  const parsed = Number(value)
  return Math.min(30, Math.max(1, Number.isInteger(parsed) ? parsed : fallback))
}

function dateValue(value) {
  const result = stringValue(value, 10, 'VALIDATION_FAILED', false)
  if (!result) return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result) || Number.isNaN(Date.parse(`${result}T00:00:00Z`))) {
    throw new Error('VALIDATION_FAILED')
  }
  return result
}

// 一个超级案例可包含 1..12 个项目（figma 2173_42605「添加项目」整组追加）。
// 展开讲讲是设计稿唯一选填字段；发布时其余项目字段必填，草稿允许留空。
const MAX_PROJECTS = 12
const MAX_PROJECT_DESCRIPTION = 300

function optionalText(value, maximum) {
  return stringValue(value, maximum, 'VALIDATION_FAILED', false) || ''
}

function normalizeProject(value = {}, publish) {
  const cityTagId = stringValue(value.cityTagId, 36, 'VALIDATION_FAILED', false) || null
  if (cityTagId && !uuid(cityTagId)) throw new Error('VALIDATION_FAILED')
  const startedOn = dateValue(value.startedOn)
  const projectName = optionalText(value.projectName, 120)
  const summary = optionalText(value.summary, 240)
  const responsibility = optionalText(value.responsibility, 500)
  const region = optionalText(value.region, 120)
  const caseType = optionalText(value.caseType, 80)
  const description = optionalText(value.description, MAX_PROJECT_DESCRIPTION)
  if (publish && [projectName, summary, startedOn, responsibility, cityTagId, region, caseType]
    .some(field => !field)) {
    throw new Error('VALIDATION_FAILED')
  }
  return {
    projectName,
    summary,
    startedOn,
    responsibility,
    cityTagId,
    ...(region ? { region } : {}),
    ...(caseType ? { caseType } : {}),
    description,
  }
}

function normalizeProjects(value, publish) {
  const rawProjects = Array.isArray(value.projects) && value.projects.length
    ? value.projects
    : [{
        projectName: value.projectName,
        summary: value.summary,
        startedOn: value.startedOn,
        responsibility: value.responsibility,
        cityTagId: value.cityTagId,
        region: value.region,
        caseType: value.caseType,
        description: value.description,
      }]
  if (rawProjects.length > MAX_PROJECTS) throw new Error('VALIDATION_FAILED')
  return rawProjects.map(project => normalizeProject(project, publish))
}

function parseStoredProjects(value) {
  if (!value) return []
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value
    return Array.isArray(parsed) ? parsed : []
  }
  catch {
    return []
  }
}

function normalizeDraft(value = {}) {
  const publish = Boolean(value.publish)
  const endedOn = dateValue(value.endedOn)
  const industryTagId = stringValue(value.industryTagId, 36, 'VALIDATION_FAILED', false) || null
  const coverAssetId = stringValue(value.coverAssetId, 36, 'VALIDATION_FAILED', false) || null
  if ([industryTagId, coverAssetId].some(id => id && !uuid(id))) {
    throw new Error('VALIDATION_FAILED')
  }
  const legacyFlatOnly = !(Array.isArray(value.projects) && value.projects.length)
  const projects = normalizeProjects(value, publish)
  const [first] = projects
  if (first.startedOn && endedOn && endedOn < first.startedOn) throw new Error('VALIDATION_FAILED')
  return {
    id: value.id && uuid(value.id) ? value.id : null,
    expectedVersion: value.expectedVersion === undefined ? null : Number(value.expectedVersion),
    projectName: first.projectName,
    summary: first.summary,
    startedOn: first.startedOn,
    endedOn,
    responsibility: first.responsibility,
    cityTagId: first.cityTagId,
    industryTagId,
    caseType: first.caseType || null,
    description: first.description,
    projects,
    legacyFlatOnly,
    coverAssetId,
    mediaAssetIds: stringList(value.mediaAssetIds, 12, 'VALIDATION_FAILED', uuid),
    publish,
  }
}

const caseSelect = `
  SELECT c.id, c.owner_user_id, c.project_name, c.summary, c.started_on,
         c.ended_on, c.responsibility, c.city_tag_id, c.industry_tag_id,
         c.case_type, c.description, c.projects, c.cover_asset_id, c.status, c.version, c.published_at, c.updated_at,
         city.label AS city_label, industry.label AS industry_label,
         cover.cloud_file_id AS cover_file_id,
         p.nickname, p.headline, p.visibility_json, avatar.cloud_file_id AS avatar_file_id
  FROM mip_super_cases c
  INNER JOIN mip_profiles p ON p.app_id = c.app_id AND p.user_id = c.owner_user_id
  LEFT JOIN mip_tags city ON city.app_id = c.app_id AND city.id = c.city_tag_id
  LEFT JOIN mip_tags industry ON industry.app_id = c.app_id AND industry.id = c.industry_tag_id
  LEFT JOIN mip_media_assets cover
    ON cover.app_id = c.app_id AND cover.id = c.cover_asset_id AND cover.status = 'READY'
  LEFT JOIN mip_media_assets avatar
    ON avatar.app_id = p.app_id AND avatar.id = p.avatar_asset_id AND avatar.status = 'READY'`

function dateText(value) {
  if (!value) return undefined
  if (typeof value === 'string') return value.slice(0, 10)
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString().slice(0, 10)
}

function summary(row, caller) {
  const profileVisibility = jsonObject(row.visibility_json)
  const mine = Boolean(caller.userId && caller.userId === row.owner_user_id)
  return {
    id: row.id,
    projectName: row.project_name,
    summary: row.summary,
    responsibility: row.responsibility,
    cityLabel: row.city_label || undefined,
    industryLabel: row.industry_label || undefined,
    caseType: row.case_type || undefined,
    coverUrl: row.cover_file_id || undefined,
    status: row.status,
    publishedAt: iso(row.published_at),
    author: {
      profileRef: createProfileRef({ appId: caller.appId, userId: row.owner_user_id }, caller.profileRefSecret),
      nickname: profileVisibility.nickname === false ? 'MIP 用户' : (row.nickname || 'MIP 用户'),
      avatarUrl: profileVisibility.avatar === false ? undefined : (row.avatar_file_id || undefined),
      headline: profileVisibility.headline === false ? undefined : (row.headline || undefined),
    },
    mine,
    ...(mine ? { version: Number(row.version) } : {}),
  }
}

// 详情项目块：优先使用存储的 projects JSON；缺失时回退顶层镜像列，包装成单项目。
async function projectViews(database, appId, stored, row) {
  const projects = stored.length
    ? stored
    : [{
        projectName: row.project_name,
        summary: row.summary,
        startedOn: dateText(row.started_on),
        responsibility: row.responsibility,
        cityTagId: row.city_tag_id,
        caseType: row.case_type || undefined,
        description: row.description,
      }]
  const cityIds = [...new Set(projects.map(project => project.cityTagId).filter(Boolean))]
  const cityLabels = new Map()
  if (cityIds.length) {
    const rows = await database.query(
      `SELECT id, label FROM mip_tags
       WHERE app_id = ? AND id IN (${cityIds.map(() => '?').join(', ')})`,
      [appId, ...cityIds],
    )
    for (const item of rows) cityLabels.set(item.id, item.label)
  }
  return projects.map(project => ({
    projectName: project.projectName || '',
    summary: project.summary || '',
    startedOn: dateText(project.startedOn),
    responsibility: project.responsibility || '',
    cityLabel: cityLabels.get(project.cityTagId) || undefined,
    region: project.region || undefined,
    caseType: project.caseType || undefined,
    description: project.description || '',
  }))
}

async function listSuperCases(database, caller, input = {}) {
  const pageLimit = limit(input.limit)
  const cursor = decodeCursor(input.cursor)
  const params = [caller.appId]
  const blockFilter = mutualBlockFilter(caller.userId, 'c.owner_user_id', 'c.app_id')
  const blockSql = blockFilter.sql ? `AND ${blockFilter.sql}` : ''
  params.push(...blockFilter.params)
  const cursorSql = cursor
    ? 'AND (c.published_at < ? OR (c.published_at = ? AND c.id < ?))'
    : ''
  if (cursor) params.push(cursor.timestamp, cursor.timestamp, cursor.id)
  const rows = await database.query(
    `${caseSelect}
     WHERE c.app_id = ? AND c.status = 'PUBLISHED' ${blockSql} ${cursorSql}
     ORDER BY c.published_at DESC, c.id DESC
     LIMIT ${pageLimit + 1}`,
    params,
  )
  const pageRows = rows.slice(0, pageLimit)
  return {
    items: pageRows.map(row => summary(row, caller)),
    nextCursor: rows.length > pageLimit && pageRows.length
      ? encodeCursor(pageRows.at(-1).published_at, pageRows.at(-1).id)
      : undefined,
  }
}

async function listMySuperCases(database, caller, input = {}) {
  if (!caller.userId) throw new Error('AUTH_REQUIRED')
  const pageLimit = limit(input.limit, 20)
  const cursor = decodeCursor(input.cursor)
  const params = [caller.appId, caller.userId]
  const cursorSql = cursor
    ? 'AND (c.updated_at < ? OR (c.updated_at = ? AND c.id < ?))'
    : ''
  if (cursor) params.push(cursor.timestamp, cursor.timestamp, cursor.id)
  const rows = await database.query(
    `${caseSelect}
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

async function getSuperCase(database, caller, id) {
  if (!uuid(id)) throw new Error('NOT_FOUND')
  const blockFilter = mutualBlockFilter(caller.userId, 'c.owner_user_id', 'c.app_id')
  const row = await database.one(
    `${caseSelect} WHERE c.app_id = ? AND c.id = ?
       ${blockFilter.sql ? `AND ${blockFilter.sql}` : ''}`,
    [caller.appId, id, ...blockFilter.params],
  )
  if (!row) throw new Error('NOT_FOUND')
  if (row.status === 'ARCHIVED') throw new Error('NOT_FOUND')
  const mine = Boolean(caller.userId && caller.userId === row.owner_user_id)
  if (row.status !== 'PUBLISHED' && !mine) throw new Error('NOT_FOUND')
  const media = await database.query(
    `SELECT media.media_asset_id, asset.cloud_file_id, media.caption
     FROM mip_super_case_media media
     INNER JOIN mip_media_assets asset
       ON asset.app_id = media.app_id AND asset.id = media.media_asset_id
       AND asset.status = 'READY'
     WHERE media.app_id = ? AND media.super_case_id = ?
     ORDER BY media.sort_order, media.media_asset_id`,
    [caller.appId, id],
  )
  let interestActive = false
  if (caller.userId) {
    const interest = await database.one(
      `SELECT status FROM mip_profile_interests
       WHERE app_id = ? AND actor_user_id = ? AND target_user_id = ?`,
      [caller.appId, caller.userId, row.owner_user_id],
    )
    interestActive = interest?.status === 'ACTIVE'
  }
  const projects = await projectViews(database, caller.appId, parseStoredProjects(row.projects), row)
  return {
    ...summary(row, caller),
    startedOn: dateText(row.started_on),
    endedOn: dateText(row.ended_on),
    description: row.description,
    projects,
    media: media.map(item => ({ url: item.cloud_file_id, caption: item.caption || undefined })),
    coverAssetId: mine ? (row.cover_asset_id || undefined) : undefined,
    mediaAssetIds: mine ? media.map(item => item.media_asset_id) : undefined,
    version: Number(row.version),
    interestActive,
    canEdit: mine,
  }
}

async function assertReferences(tx, caller, draft) {
  const tagPairs = [
    ...draft.projects.map(project => project.cityTagId).filter(Boolean)
      .map(id => [id, 'CITY']),
    ...(draft.industryTagId ? [[draft.industryTagId, 'INDUSTRY']] : []),
  ]
  if (tagPairs.length) {
    const rows = await tx.query(
      `SELECT id, kind FROM mip_tags
       WHERE app_id = ? AND id IN (${tagPairs.map(() => '?').join(', ')})
         AND enabled = 1 AND selectable = 1`,
      [caller.appId, ...tagPairs.map(([id]) => id)],
    )
    const byId = new Map(rows.map(row => [row.id, row.kind]))
    if (tagPairs.some(([id, kind]) => byId.get(id) !== kind)) throw new Error('VALIDATION_FAILED')
  }
  const assets = [...new Set([draft.coverAssetId, ...draft.mediaAssetIds].filter(Boolean))]
  if (assets.length) {
    const rows = await tx.query(
      `SELECT id, purpose FROM mip_media_assets
       WHERE app_id = ? AND owner_user_id = ? AND status = 'READY'
         AND id IN (${assets.map(() => '?').join(', ')})`,
      [caller.appId, caller.userId, ...assets],
    )
    const byId = new Map(rows.map(row => [row.id, row.purpose]))
    if (rows.length !== assets.length
      || (draft.coverAssetId && byId.get(draft.coverAssetId) !== 'SUPER_CASE_COVER')
      || draft.mediaAssetIds.some(assetId => byId.get(assetId) !== 'SUPER_CASE_MEDIA')) {
      throw new Error('VALIDATION_FAILED')
    }
  }
}

async function saveSuperCase(database, contentSafety, caller, input) {
  const draft = normalizeDraft(input.draft)
  const aiConfirmation = normalizeAiConfirmation(input.aiConfirmation, 'SUPER_CASE')
  await contentSafety.assertSafe(caller, draft.projects.flatMap(project => [
    project.projectName,
    project.summary,
    project.responsibility,
    project.region,
    project.caseType,
    project.description,
  ]).filter(Boolean))
  return idempotentTransaction(database, {
    appId: caller.appId,
    userId: caller.userId,
    operation: 'super-case.save',
    idempotencyKey: input.idempotencyKey,
    request: aiConfirmation ? { draft, aiConfirmation } : draft,
  }, async (tx) => {
    await lockActiveContributor(tx, caller)
    await assertReferences(tx, caller, draft)
    const id = draft.id || randomUUID()
    let existing = null
    if (draft.id) {
      existing = await tx.one(
        `SELECT owner_user_id, status, version, published_at, projects FROM mip_super_cases
         WHERE app_id = ? AND id = ? FOR UPDATE`,
        [caller.appId, draft.id],
      )
      if (!existing) throw new Error('NOT_FOUND')
      if (existing.owner_user_id !== caller.userId) throw new Error('FORBIDDEN')
      if (existing.status === 'ARCHIVED') throw new Error('FORBIDDEN')
      if (Number(existing.version) !== draft.expectedVersion) throw new Error('CONFLICT')
    }
    // 旧客户端/管理端只提交平铺字段时，平铺值映射为第一个项目，保留已存的其余项目。
    const projects = draft.legacyFlatOnly && existing
      ? [draft.projects[0], ...parseStoredProjects(existing.projects).slice(1)]
      : draft.projects
    const [mirror] = projects
    const status = draft.publish
      ? 'PUBLISHED'
      : (['PUBLISHED', 'UNPUBLISHED'].includes(existing?.status) ? existing.status : 'DRAFT')
    const published = status === 'PUBLISHED'
    const projectsJson = JSON.stringify(projects)
    if (existing) {
      await tx.query(
        `UPDATE mip_super_cases
         SET project_name = ?, summary = ?, started_on = ?, ended_on = ?,
             responsibility = ?, city_tag_id = ?, industry_tag_id = ?, case_type = ?,
             description = ?, projects = ?, cover_asset_id = ?, status = ?, content_safety_status = 'APPROVED',
             published_at = CASE WHEN ? = 1 THEN COALESCE(published_at, UTC_TIMESTAMP(3)) ELSE published_at END,
             version = version + 1
         WHERE app_id = ? AND id = ? AND version = ?`,
        [
          mirror.projectName, mirror.summary, mirror.startedOn, draft.endedOn,
          mirror.responsibility, mirror.cityTagId, draft.industryTagId, mirror.caseType,
          mirror.description, projectsJson, draft.coverAssetId, status, published ? 1 : 0,
          caller.appId, id, draft.expectedVersion,
        ],
      )
    }
    else {
      await tx.query(
        `INSERT INTO mip_super_cases (
           id, app_id, owner_user_id, project_name, summary, started_on, ended_on,
           responsibility, city_tag_id, industry_tag_id, case_type, description, projects,
           cover_asset_id, status, content_safety_status, published_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'APPROVED',
           CASE WHEN ? = 1 THEN UTC_TIMESTAMP(3) ELSE NULL END)`,
        [
          id, caller.appId, caller.userId, mirror.projectName, mirror.summary,
          mirror.startedOn, draft.endedOn, mirror.responsibility, mirror.cityTagId,
          draft.industryTagId, mirror.caseType, mirror.description, projectsJson,
          draft.coverAssetId,
          status, published ? 1 : 0,
        ],
      )
    }
    await tx.query(
      'DELETE FROM mip_super_case_media WHERE app_id = ? AND super_case_id = ?',
      [caller.appId, id],
    )
    for (const [sortOrder, mediaAssetId] of draft.mediaAssetIds.entries()) {
      await tx.query(
        `INSERT INTO mip_super_case_media (
           app_id, super_case_id, media_asset_id, sort_order
         ) VALUES (?, ?, ?, ?)`,
        [caller.appId, id, mediaAssetId, sortOrder],
      )
    }
    const version = existing ? Number(existing.version) + 1 : 1
    if (published && !existing?.published_at) {
      await appendOutbox(tx, {
        appId: caller.appId,
        aggregateType: 'SUPER_CASE',
        aggregateId: id,
        eventType: 'super_case.published',
        sourceVersion: version,
      })
    }
    await appendAudit(tx, {
      appId: caller.appId,
      actorUserId: caller.userId,
      action: existing ? 'SUPER_CASE_UPDATED' : 'SUPER_CASE_CREATED',
      resourceType: 'SUPER_CASE',
      resourceId: id,
      metadata: { status, version, mediaCount: draft.mediaAssetIds.length },
    })
    await confirmAiDraft(tx, {
      appId: caller.appId,
      userId: caller.userId,
      confirmation: aiConfirmation,
      resourceId: id,
      structuredDraft: {
        projectName: draft.projectName,
        summary: draft.summary,
        responsibility: draft.responsibility,
        description: draft.description,
        startedOn: draft.startedOn,
        endedOn: draft.endedOn,
        caseType: draft.caseType,
      },
    })
    return { id, status, version }
  })
}

async function unpublishSuperCase(database, caller, input = {}) {
  const id = stringValue(input.id, 36, 'VALIDATION_FAILED')
  const expectedVersion = Number(input.expectedVersion)
  if (!uuid(id) || !Number.isInteger(expectedVersion) || expectedVersion < 1) {
    throw new Error('VALIDATION_FAILED')
  }
  return idempotentTransaction(database, {
    appId: caller.appId,
    userId: caller.userId,
    operation: 'super-case.unpublish',
    idempotencyKey: input.idempotencyKey,
    request: { id, expectedVersion },
  }, async (tx) => {
    await lockActiveContributor(tx, caller)
    const existing = await tx.one(
      `SELECT owner_user_id, status, version
       FROM mip_super_cases
       WHERE app_id = ? AND id = ? FOR UPDATE`,
      [caller.appId, id],
    )
    if (!existing) throw new Error('NOT_FOUND')
    if (existing.owner_user_id !== caller.userId) throw new Error('FORBIDDEN')
    if (Number(existing.version) !== expectedVersion || existing.status !== 'PUBLISHED') {
      throw new Error('CONFLICT')
    }
    await tx.query(
      `UPDATE mip_super_cases
       SET status = 'UNPUBLISHED', version = version + 1
       WHERE app_id = ? AND id = ? AND version = ?`,
      [caller.appId, id, expectedVersion],
    )
    const version = expectedVersion + 1
    await appendAudit(tx, {
      appId: caller.appId,
      actorUserId: caller.userId,
      action: 'SUPER_CASE_UNPUBLISHED',
      resourceType: 'SUPER_CASE',
      resourceId: id,
      metadata: { version },
    })
    return { id, status: 'UNPUBLISHED', version }
  })
}

async function archiveSuperCase(database, caller, input = {}) {
  const id = stringValue(input.id, 36, 'VALIDATION_FAILED')
  const expectedVersion = Number(input.expectedVersion)
  if (!uuid(id) || !Number.isInteger(expectedVersion) || expectedVersion < 1) {
    throw new Error('VALIDATION_FAILED')
  }
  return idempotentTransaction(database, {
    appId: caller.appId,
    userId: caller.userId,
    operation: 'super-case.archive',
    idempotencyKey: input.idempotencyKey,
    request: { id, expectedVersion },
  }, async (tx) => {
    await lockActiveContributor(tx, caller)
    const existing = await tx.one(
      `SELECT owner_user_id, status, version
       FROM mip_super_cases
       WHERE app_id = ? AND id = ? FOR UPDATE`,
      [caller.appId, id],
    )
    if (!existing) throw new Error('NOT_FOUND')
    if (existing.owner_user_id !== caller.userId) throw new Error('FORBIDDEN')
    if (Number(existing.version) !== expectedVersion || existing.status === 'ARCHIVED') {
      throw new Error('CONFLICT')
    }
    const result = await tx.query(
      `UPDATE mip_super_cases
       SET status = 'ARCHIVED', archived_at = UTC_TIMESTAMP(3), version = version + 1
       WHERE app_id = ? AND id = ? AND version = ? AND status <> 'ARCHIVED'`,
      [caller.appId, id, expectedVersion],
    )
    if (result.affectedRows !== 1) throw new Error('CONFLICT')
    const version = expectedVersion + 1
    await appendAudit(tx, {
      appId: caller.appId,
      actorUserId: caller.userId,
      action: 'SUPER_CASE_ARCHIVED',
      resourceType: 'SUPER_CASE',
      resourceId: id,
      metadata: { version },
    })
    return { id, status: 'ARCHIVED', version }
  })
}

module.exports = {
  archiveSuperCase,
  assertReferences,
  getSuperCase,
  listMySuperCases,
  listSuperCases,
  normalizeDraft,
  saveSuperCase,
  unpublishSuperCase,
}
