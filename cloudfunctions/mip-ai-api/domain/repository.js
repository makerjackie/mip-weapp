'use strict'

const { createHash, randomUUID } = require('node:crypto')
const { isUuid, normalizeStructuredDraft } = require('./validation')

function createAiRepository(database, options = {}) {
  const createId = options.createId || randomUUID
  const draftTtlHours = normalizeDraftTtlHours(options.draftTtlHours)
  const expiryExpression = `DATE_ADD(UTC_TIMESTAMP(3), INTERVAL ${draftTtlHours} HOUR)`

  async function expireDrafts(appId, userId) {
    return database.query(
      `UPDATE mip_ai_drafts SET status = 'EXPIRED', version = version + 1
       WHERE app_id = ? AND user_id = ? AND expires_at <= UTC_TIMESTAMP(3)
         AND status IN ('UPLOADED', 'TRANSCRIBING', 'STRUCTURING', 'DRAFT_READY', 'FAILED')`,
      [appId, userId],
    )
  }

  async function expireDraftsForApp(appId, limit = 20) {
    const boundedLimit = cleanupLimit(limit)
    return database.transaction(async (tx) => {
      const rows = await tx.query(
        `SELECT id FROM mip_ai_drafts
         WHERE app_id = ? AND expires_at <= UTC_TIMESTAMP(3)
           AND status IN ('UPLOADED', 'TRANSCRIBING', 'STRUCTURING', 'DRAFT_READY', 'FAILED')
         ORDER BY expires_at, id LIMIT ? FOR UPDATE SKIP LOCKED`,
        [appId, boundedLimit],
      )
      let expired = 0
      for (const row of rows) {
        const result = await tx.query(
          `UPDATE mip_ai_drafts SET status = 'EXPIRED', version = version + 1
           WHERE app_id = ? AND id = ? AND expires_at <= UTC_TIMESTAMP(3)
             AND status IN ('UPLOADED', 'TRANSCRIBING', 'STRUCTURING', 'DRAFT_READY', 'FAILED')`,
          [appId, row.id],
        )
        expired += Number(result.affectedRows) === 1 ? 1 : 0
      }
      return expired
    })
  }

  async function listDrafts(appId, userId, options = {}) {
    const limit = Math.min(30, Math.max(1, Number(options.limit) || 20))
    const cursor = decodeCursor(options.cursor)
    const params = [appId, userId]
    let cursorSql = ''
    if (cursor) {
      cursorSql = 'AND (created_at < ? OR (created_at = ? AND id < ?))'
      params.push(cursor.createdAt, cursor.createdAt, cursor.id)
    }
    params.push(limit + 1)
    const rows = await database.query(
      `SELECT id, user_id, purpose, transcript_text, structured_draft_json,
              status, expires_at, version, created_at, updated_at
       FROM mip_ai_drafts
       WHERE app_id = ? AND user_id = ? AND status <> 'DELETED' ${cursorSql}
       ORDER BY created_at DESC, id DESC LIMIT ?`,
      params,
    )
    const page = rows.slice(0, limit)
    return {
      items: page.map(draftDto),
      nextCursor: rows.length > limit ? encodeCursor(page.at(-1)) : undefined,
    }
  }

  async function getDraft(appId, userId, draftId) {
    if (!isUuid(draftId)) throw new Error('VALIDATION_FAILED')
    return readDraft(database, appId, userId, draftId)
  }

  async function readDraft(store, appId, userId, draftId) {
    const row = await store.one(
      `SELECT id, user_id, purpose, transcript_text, structured_draft_json,
              status, expires_at, version, created_at, updated_at
       FROM mip_ai_drafts
       WHERE app_id = ? AND user_id = ? AND id = ? AND status <> 'DELETED'`,
      [appId, userId, draftId],
    )
    if (!row) throw new Error('NOT_FOUND')
    return draftDto(row)
  }

  async function createTextDraft(appId, userId, input) {
    const id = createId()
    return database.transaction(async (tx) => {
      await requireActiveUser(tx, appId, userId)
      await tx.query(
        `INSERT INTO mip_ai_drafts (
           id, app_id, user_id, purpose, transcript_text, status, expires_at
         ) VALUES (?, ?, ?, ?, ?, 'STRUCTURING', ${expiryExpression})`,
        [id, appId, userId, input.purpose, input.transcriptText],
      )
      return readDraft(tx, appId, userId, id)
    })
  }

  async function createVoiceDraft(appId, userId, input) {
    const id = createId()
    return database.transaction(async (tx) => {
      await requireActiveUser(tx, appId, userId)
      const asset = await tx.one(
        `SELECT id, cloud_file_id, content_type, content_bytes, status
         FROM mip_media_assets
         WHERE app_id = ? AND id = ? AND owner_user_id = ? FOR UPDATE`,
        [appId, input.audioAssetId, userId],
      )
      if (!asset || asset.status !== 'READY' || !String(asset.content_type || '').startsWith('audio/')) {
        throw new Error('AI_AUDIO_NOT_AVAILABLE')
      }
      await tx.query(
        `INSERT INTO mip_ai_drafts (
           id, app_id, user_id, purpose, audio_asset_id, status, expires_at
         ) VALUES (?, ?, ?, ?, ?, 'TRANSCRIBING', ${expiryExpression})`,
        [id, appId, userId, input.purpose, input.audioAssetId],
      )
      return { draft: await readDraft(tx, appId, userId, id), asset }
    })
  }

  async function registerPendingAudioUpload(appId, asset) {
    const pending = await database.query(
      `INSERT INTO mip_media_assets (
         id, app_id, owner_user_id, purpose, object_key, cloud_file_id,
         content_sha256, content_type, content_bytes, status
       ) VALUES (?, ?, NULL, 'AI_AUDIO', ?, ?, ?, ?, ?, 'PENDING')`,
      [
        asset.assetId,
        appId,
        asset.objectKey,
        asset.cloudFileId,
        asset.contentSha256,
        asset.contentType,
        asset.contentBytes,
      ],
    )
    if (Number(pending?.affectedRows) !== 1) throw new Error('AI_AUDIO_UPLOAD_FAILED')
  }

  async function createVoiceDraftFromUpload(appId, userId, asset, purpose) {
    const draftId = createId()
    await registerPendingAudioUpload(appId, asset)
    return database.transaction(async (tx) => {
      await requireActiveUser(tx, appId, userId)
      const activated = await tx.query(
        `UPDATE mip_media_assets
         SET owner_user_id = ?, status = 'READY'
         WHERE app_id = ? AND id = ? AND owner_user_id IS NULL
           AND purpose = 'AI_AUDIO' AND status = 'PENDING'`,
        [userId, appId, asset.assetId],
      )
      if (Number(activated?.affectedRows) !== 1) throw new Error('AI_AUDIO_UPLOAD_FAILED')
      await tx.query(
        `INSERT INTO mip_ai_drafts (
           id, app_id, user_id, purpose, audio_asset_id, status, expires_at
        ) VALUES (?, ?, ?, ?, ?, 'TRANSCRIBING', ${expiryExpression})`,
        [draftId, appId, userId, purpose, asset.assetId],
      )
      return {
        draft: await readDraft(tx, appId, userId, draftId),
        asset: {
          cloud_file_id: asset.cloudFileId,
          content_type: asset.contentType,
          content_bytes: asset.contentBytes,
        },
      }
    })
  }

  async function recoverVoiceDraftFromUpload(appId, userId, assetId) {
    const row = await database.one(
      `SELECT asset.owner_user_id, asset.status AS asset_status,
              asset.cloud_file_id, asset.content_type, asset.content_bytes,
              draft.id, draft.user_id, draft.purpose, draft.transcript_text,
              draft.structured_draft_json, draft.status, draft.expires_at,
              draft.version, draft.created_at, draft.updated_at
       FROM mip_media_assets asset
       LEFT JOIN mip_ai_drafts draft
         ON draft.app_id = asset.app_id AND draft.audio_asset_id = asset.id
           AND draft.user_id = ? AND draft.status <> 'DELETED'
       WHERE asset.app_id = ? AND asset.id = ? AND asset.purpose = 'AI_AUDIO'
       ORDER BY draft.created_at DESC LIMIT 1`,
      [userId, appId, assetId],
    )
    if (!row) return { state: 'MISSING' }
    if (row.asset_status === 'PENDING' && row.owner_user_id == null) {
      return { state: 'PENDING' }
    }
    if (row.asset_status === 'READY' && row.owner_user_id === userId && row.id) {
      return {
        state: 'COMMITTED',
        created: {
          draft: draftDto(row),
          asset: {
            cloud_file_id: row.cloud_file_id,
            content_type: row.content_type,
            content_bytes: row.content_bytes,
          },
        },
      }
    }
    return { state: 'KEEP' }
  }

  async function completeDraft(appId, userId, draftId, expectedVersion, result) {
    const providerHash = result.providerJobKey
      ? createHash('sha256').update(result.providerJobKey).digest('hex')
      : null
    return database.transaction(async (tx) => {
      await requireActiveUser(tx, appId, userId)
      const current = await tx.one(
        `SELECT purpose, status, version, expires_at FROM mip_ai_drafts
         WHERE app_id = ? AND user_id = ? AND id = ? FOR UPDATE`,
        [appId, userId, draftId],
      )
      if (!current) throw new Error('NOT_FOUND')
      if (!['TRANSCRIBING', 'STRUCTURING'].includes(current.status)
        || Number(current.version) !== expectedVersion
        || new Date(current.expires_at).getTime() <= Date.now()
        || current.purpose !== result.purpose) {
        throw new Error('CONFLICT')
      }
      const structured = normalizeStructuredDraft(current.purpose, result.structuredDraft)
      const update = await tx.query(
        `UPDATE mip_ai_drafts SET
           transcript_text = ?, structured_draft_json = ?, provider_job_key_hash = ?,
           status = 'DRAFT_READY', version = version + 1
         WHERE app_id = ? AND user_id = ? AND id = ? AND version = ?
           AND status IN ('TRANSCRIBING', 'STRUCTURING') AND expires_at > UTC_TIMESTAMP(3)`,
        [
          result.transcriptText,
          JSON.stringify(structured),
          providerHash,
          appId,
          userId,
          draftId,
          expectedVersion,
        ],
      )
      if (Number(update.affectedRows) !== 1) throw new Error('CONFLICT')
      return readDraft(tx, appId, userId, draftId)
    })
  }

  async function beginDraftRefinement(appId, userId, input) {
    if (!isUuid(input.draftId) || !Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) {
      throw new Error('VALIDATION_FAILED')
    }
    return database.transaction(async (tx) => {
      await requireActiveUser(tx, appId, userId)
      const current = await tx.one(
        `SELECT id, user_id, purpose, transcript_text, structured_draft_json,
                status, expires_at, version, created_at, updated_at
         FROM mip_ai_drafts
         WHERE app_id = ? AND user_id = ? AND id = ? FOR UPDATE`,
        [appId, userId, input.draftId],
      )
      if (!current) throw new Error('NOT_FOUND')
      if (current.status !== 'DRAFT_READY' || new Date(current.expires_at).getTime() <= Date.now()) {
        throw new Error('AI_DRAFT_NOT_EDITABLE')
      }
      if (Number(current.version) !== input.expectedVersion) throw new Error('CONFLICT')
      const update = await tx.query(
        `UPDATE mip_ai_drafts SET status = 'STRUCTURING', version = version + 1
         WHERE app_id = ? AND user_id = ? AND id = ? AND version = ?
           AND status = 'DRAFT_READY' AND expires_at > UTC_TIMESTAMP(3)`,
        [appId, userId, input.draftId, input.expectedVersion],
      )
      if (Number(update.affectedRows) !== 1) throw new Error('CONFLICT')
      return draftDto({ ...current, status: 'STRUCTURING', version: input.expectedVersion + 1 })
    })
  }

  async function restoreDraftAfterRefinement(appId, userId, draftId, expectedVersion) {
    const update = await database.query(
      `UPDATE mip_ai_drafts SET status = 'DRAFT_READY', version = version + 1
       WHERE app_id = ? AND user_id = ? AND id = ? AND version = ?
         AND status = 'STRUCTURING' AND expires_at > UTC_TIMESTAMP(3)`,
      [appId, userId, draftId, expectedVersion],
    )
    return Number(update.affectedRows) === 1
  }

  async function failDraft(appId, userId, draftId, expectedVersion) {
    await database.query(
      `UPDATE mip_ai_drafts SET status = 'FAILED', version = version + 1
       WHERE app_id = ? AND user_id = ? AND id = ? AND version = ?
         AND status IN ('TRANSCRIBING', 'STRUCTURING')`,
      [appId, userId, draftId, expectedVersion],
    )
  }

  async function updateDraft(appId, userId, input) {
    if (!isUuid(input.draftId) || !Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) {
      throw new Error('VALIDATION_FAILED')
    }
    return database.transaction(async (tx) => {
      await requireActiveUser(tx, appId, userId)
      const current = await tx.one(
        `SELECT purpose, status, version, expires_at FROM mip_ai_drafts
         WHERE app_id = ? AND user_id = ? AND id = ? FOR UPDATE`,
        [appId, userId, input.draftId],
      )
      if (!current) throw new Error('NOT_FOUND')
      if (current.status !== 'DRAFT_READY' || new Date(current.expires_at).getTime() <= Date.now()) {
        throw new Error('AI_DRAFT_NOT_EDITABLE')
      }
      if (Number(current.version) !== input.expectedVersion) throw new Error('CONFLICT')
      const structured = normalizeStructuredDraft(current.purpose, input.editedDraft)
      const update = await tx.query(
        `UPDATE mip_ai_drafts SET structured_draft_json = ?, version = version + 1
         WHERE app_id = ? AND user_id = ? AND id = ? AND version = ? AND status = 'DRAFT_READY'`,
        [JSON.stringify(structured), appId, userId, input.draftId, input.expectedVersion],
      )
      if (Number(update.affectedRows) !== 1) throw new Error('CONFLICT')
      const row = await tx.one(
        `SELECT id, user_id, purpose, transcript_text, structured_draft_json,
                status, expires_at, version, created_at, updated_at
         FROM mip_ai_drafts WHERE app_id = ? AND user_id = ? AND id = ?`,
        [appId, userId, input.draftId],
      )
      return draftDto(row)
    })
  }

  async function deleteDraft(appId, userId, draftId, expectedVersion) {
    if (!isUuid(draftId) || !Number.isInteger(expectedVersion) || expectedVersion < 1) {
      throw new Error('VALIDATION_FAILED')
    }
    return database.transaction(async (tx) => {
      await requireActiveUser(tx, appId, userId)
      const draft = await tx.one(
        `SELECT status, version FROM mip_ai_drafts
         WHERE app_id = ? AND user_id = ? AND id = ? FOR UPDATE`,
        [appId, userId, draftId],
      )
      if (!draft) throw new Error('NOT_FOUND')
      if (draft.status === 'DELETED') return { draftId, status: 'DELETED' }
      if (Number(draft.version) !== expectedVersion) throw new Error('CONFLICT')
      const update = await tx.query(
        `UPDATE mip_ai_drafts SET status = 'DELETED', version = version + 1
         WHERE app_id = ? AND user_id = ? AND id = ? AND version = ? AND status <> 'DELETED'`,
        [appId, userId, draftId, expectedVersion],
      )
      if (Number(update.affectedRows) !== 1) throw new Error('CONFLICT')
      return { draftId, status: 'DELETED' }
    })
  }

  async function leaseAudioCleanup(appId, userId, limit = 20) {
    return leaseAudioCleanupScope(appId, userId, limit)
  }

  async function leaseAppAudioCleanup(appId, limit = 20) {
    return leaseAudioCleanupScope(appId, null, limit)
  }

  async function leaseAudioCleanupScope(appId, userId, limit) {
    const boundedLimit = cleanupLimit(limit)
    const userScoped = typeof userId === 'string' && userId.length > 0
    const leasedAt = new Date()
    return database.transaction(async (tx) => {
      const rows = await tx.query(
        `SELECT DISTINCT asset.id, asset.owner_user_id, asset.object_key,
                         asset.cloud_file_id, asset.created_at
         FROM mip_media_assets asset
         ${userScoped ? 'INNER' : 'LEFT'} JOIN mip_ai_drafts draft
           ON draft.app_id = asset.app_id AND draft.audio_asset_id = asset.id
         WHERE asset.app_id = ?
           AND asset.purpose = 'AI_AUDIO'
           ${userScoped
            ? `AND draft.user_id = ?
               AND draft.status IN ('CONFIRMED', 'EXPIRED', 'DELETED')
               AND asset.owner_user_id = ?`
            : `AND (
                 draft.status IN ('CONFIRMED', 'EXPIRED', 'DELETED')
                 OR (
                   draft.id IS NULL AND asset.status IN ('READY', 'PENDING')
                   AND asset.updated_at < DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 30 MINUTE)
                 )
               )`}
           AND (
             asset.status = 'READY'
             OR (asset.status = 'PENDING' AND asset.updated_at < DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 30 MINUTE))
           )
         ORDER BY asset.created_at, asset.id LIMIT ? FOR UPDATE SKIP LOCKED`,
        userScoped
          ? [appId, userId, userId, boundedLimit]
          : [appId, boundedLimit],
      )
      const leased = []
      for (const row of rows) {
        const ownerUserId = row.owner_user_id || (userScoped ? userId : null)
        const result = ownerUserId
          ? await tx.query(
              `UPDATE mip_media_assets SET status = 'PENDING', updated_at = ?
               WHERE app_id = ? AND owner_user_id = ? AND id = ?
                 AND purpose = 'AI_AUDIO' AND status IN ('READY', 'PENDING')`,
              [leasedAt, appId, ownerUserId, row.id],
            )
          : await tx.query(
              `UPDATE mip_media_assets SET updated_at = ?
               WHERE app_id = ? AND owner_user_id IS NULL AND id = ?
                 AND purpose = 'AI_AUDIO' AND status = 'PENDING'`,
              [leasedAt, appId, row.id],
            )
        if (Number(result.affectedRows) === 1) leased.push(row)
      }
      return leased.map(row => ({ ...row, lease_updated_at: leasedAt }))
    })
  }

  async function markAudioDeleted(appId, userId, assetId, leaseUpdatedAt) {
    if (!(leaseUpdatedAt instanceof Date) || !Number.isFinite(leaseUpdatedAt.getTime())) {
      throw new Error('VALIDATION_FAILED')
    }
    const result = typeof userId === 'string' && userId
      ? await database.query(
          `UPDATE mip_media_assets SET status = 'DELETED'
           WHERE app_id = ? AND owner_user_id = ? AND id = ?
             AND purpose = 'AI_AUDIO' AND status = 'PENDING' AND updated_at = ?`,
          [appId, userId, assetId, leaseUpdatedAt],
        )
      : await database.query(
          `UPDATE mip_media_assets SET status = 'DELETED'
           WHERE app_id = ? AND owner_user_id IS NULL AND id = ?
             AND purpose = 'AI_AUDIO' AND status = 'PENDING' AND updated_at = ?`,
          [appId, assetId, leaseUpdatedAt],
        )
    return Number(result.affectedRows) === 1
  }

  async function markPendingAudioUploadDeleted(appId, assetId) {
    const result = await database.query(
      `UPDATE mip_media_assets SET status = 'DELETED'
       WHERE app_id = ? AND id = ? AND owner_user_id IS NULL
         AND purpose = 'AI_AUDIO' AND status = 'PENDING'`,
      [appId, assetId],
    )
    return Number(result.affectedRows) === 1
  }

  return {
    beginDraftRefinement,
    completeDraft,
    createTextDraft,
    createVoiceDraft,
    createVoiceDraftFromUpload,
    deleteDraft,
    expireDrafts,
    expireDraftsForApp,
    failDraft,
    getDraft,
    leaseAppAudioCleanup,
    listDrafts,
    leaseAudioCleanup,
    markAudioDeleted,
    markPendingAudioUploadDeleted,
    recoverVoiceDraftFromUpload,
    registerPendingAudioUpload,
    restoreDraftAfterRefinement,
    updateDraft,
  }
}

async function requireActiveUser(tx, appId, userId) {
  const user = await tx.one(
    `SELECT id, status FROM mip_users
     WHERE app_id = ? AND id = ? FOR UPDATE`,
    [appId, userId],
  )
  if (!user || user.status !== 'ACTIVE') throw new Error('FORBIDDEN')
  return user
}

function cleanupLimit(value) {
  const limit = Number(value ?? 20)
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    throw new Error('AI_CLEANUP_INVALID')
  }
  return limit
}

function normalizeDraftTtlHours(value) {
  const hours = Number(value ?? 72)
  if (!Number.isInteger(hours) || hours < 1 || hours > 168) {
    throw new Error('AI_DRAFT_TTL_INVALID')
  }
  return hours
}

function draftDto(row) {
  return {
    id: row.id,
    userId: row.user_id,
    purpose: row.purpose,
    status: row.status,
    transcriptText: row.transcript_text || undefined,
    structuredDraft: parseObject(row.structured_draft_json),
    expiresAt: iso(row.expires_at),
    version: Number(row.version),
  }
}

function parseObject(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value
  try {
    const parsed = JSON.parse(value || '{}')
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  }
  catch {
    return {}
  }
}

function iso(value) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : date.toISOString()
}

function encodeCursor(row) {
  if (!row) return undefined
  return Buffer.from(JSON.stringify({ createdAt: iso(row.created_at), id: row.id })).toString('base64url')
}

function decodeCursor(value) {
  if (!value) return null
  try {
    const parsed = JSON.parse(Buffer.from(String(value), 'base64url').toString('utf8'))
    if (!isUuid(parsed.id) || !Number.isFinite(Date.parse(parsed.createdAt))) throw new Error()
    return parsed
  }
  catch {
    throw new Error('VALIDATION_FAILED')
  }
}

module.exports = {
  createAiRepository,
  cleanupLimit,
  decodeCursor,
  draftDto,
  encodeCursor,
  normalizeDraftTtlHours,
}
