'use strict'

const { createHash, randomUUID } = require('node:crypto')
const { isUuid, normalizeStructuredDraft } = require('./validation')

function createAiRepository(database, options = {}) {
  const createId = options.createId || randomUUID
  const createLeaseId = options.createLeaseId || randomUUID
  const draftTtlHours = normalizeDraftTtlHours(options.draftTtlHours)
  const expiryExpression = `DATE_ADD(UTC_TIMESTAMP(3), INTERVAL ${draftTtlHours} HOUR)`
  const requestLeaseSeconds = normalizeRequestLeaseSeconds(options.requestLeaseSeconds)
  const leaseExpression = `DATE_ADD(UTC_TIMESTAMP(3), INTERVAL ${requestLeaseSeconds} SECOND)`

  async function expireDrafts(appId, userId) {
    await database.query(
      `UPDATE mip_ai_draft_requests
       SET status = 'FAILED', lease_token = NULL, lease_expires_at = NULL,
           response_json = NULL, failure_code = 'AI_DRAFT_REQUEST_EXPIRED'
       WHERE app_id = ? AND user_id = ? AND expires_at <= UTC_TIMESTAMP(3)
         AND (status <> 'FAILED' OR failure_code <> 'AI_DRAFT_REQUEST_EXPIRED'
           OR response_json IS NOT NULL OR lease_token IS NOT NULL OR lease_expires_at IS NOT NULL)`,
      [appId, userId],
    )
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
      const requestRows = await tx.query(
        `SELECT id FROM mip_ai_draft_requests
         WHERE app_id = ? AND expires_at <= UTC_TIMESTAMP(3)
           AND (status <> 'FAILED' OR failure_code <> 'AI_DRAFT_REQUEST_EXPIRED'
             OR response_json IS NOT NULL OR lease_token IS NOT NULL OR lease_expires_at IS NOT NULL)
         ORDER BY expires_at, id LIMIT ? FOR UPDATE SKIP LOCKED`,
        [appId, boundedLimit],
      )
      for (const row of requestRows) {
        await tx.query(
          `UPDATE mip_ai_draft_requests
           SET status = 'FAILED', lease_token = NULL, lease_expires_at = NULL,
               response_json = NULL, failure_code = 'AI_DRAFT_REQUEST_EXPIRED'
           WHERE app_id = ? AND id = ? AND expires_at <= UTC_TIMESTAMP(3)
             AND (status <> 'FAILED' OR failure_code <> 'AI_DRAFT_REQUEST_EXPIRED'
               OR response_json IS NOT NULL OR lease_token IS NOT NULL OR lease_expires_at IS NOT NULL)`,
          [appId, row.id],
        )
      }
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

  async function claimDraftRequest(appId, userId, input) {
    assertDraftRequestInput(input)
    const requestRowId = createId()
    const draftId = createId()
    const leaseToken = createLeaseId()
    const createOrResume = async (tx) => {
      await requireActiveUser(tx, appId, userId)
      const existing = await readDraftRequestRow(tx, appId, userId, input.requestId, true)
      if (existing) {
        return resumeDraftRequest(tx, appId, userId, existing, input, leaseToken)
      }

      let draft
      let asset
      if (input.kind === 'TEXT') {
        await tx.query(
          `INSERT INTO mip_ai_drafts (
             id, app_id, user_id, purpose, transcript_text, status, expires_at
           ) VALUES (?, ?, ?, ?, ?, 'STRUCTURING', ${expiryExpression})`,
          [draftId, appId, userId, input.purpose, input.transcriptText],
        )
        draft = await readDraft(tx, appId, userId, draftId)
      }
      else if (input.kind === 'VOICE_ASSET') {
        asset = await requireOwnedAudioAsset(tx, appId, userId, input.audioAssetId)
        await tx.query(
          `INSERT INTO mip_ai_drafts (
             id, app_id, user_id, purpose, audio_asset_id, status, expires_at
           ) VALUES (?, ?, ?, ?, ?, 'TRANSCRIBING', ${expiryExpression})`,
          [draftId, appId, userId, input.purpose, input.audioAssetId],
        )
        draft = await readDraft(tx, appId, userId, draftId)
      }

      await tx.query(
        `INSERT INTO mip_ai_draft_requests (
           id, app_id, user_id, request_id, input_hash, draft_kind, status,
           lease_token, lease_expires_at, draft_id, audio_asset_id, audio_object_key,
           expires_at
         ) VALUES (?, ?, ?, ?, ?, ?, 'PROCESSING', ?, ${leaseExpression}, ?, ?, ?, ${expiryExpression})`,
        [
          requestRowId,
          appId,
          userId,
          input.requestId,
          input.inputHash,
          input.kind,
          leaseToken,
          draftId,
          input.audioAssetId || input.allocation?.assetId || null,
          input.allocation?.objectKey || null,
        ],
      )
      return {
        state: 'CLAIMED',
        requestId: input.requestId,
        leaseToken,
        draftId,
        draft,
        asset,
        ...(input.allocation ? { allocation: input.allocation } : {}),
      }
    }
    try {
      return await database.transaction(createOrResume)
    }
    catch (error) {
      if (error?.code !== 'ER_DUP_ENTRY') throw error
      return database.transaction(async (tx) => {
        await requireActiveUser(tx, appId, userId)
        const existing = await readDraftRequestRow(tx, appId, userId, input.requestId, true)
        if (!existing) throw error
        return resumeDraftRequest(tx, appId, userId, existing, input, createLeaseId())
      })
    }
  }

  async function resumeDraftRequest(tx, appId, userId, row, input, leaseToken) {
    const currentDraft = await readDraftIfPresent(tx, appId, userId, row.draft_id)
    const disposition = draftRequestDisposition(row, input, currentDraft)
    if (disposition === 'CONFLICT') throw new Error('IDEMPOTENCY_CONFLICT')
    if (disposition === 'EXPIRED') throw new Error('AI_DRAFT_REQUEST_EXPIRED')
    if (disposition === 'REPLAY') {
      return { state: 'REPLAY', response: parseObject(row.response_json) }
    }
    if (disposition === 'FAILED') throw new Error(safeFailureCode(row.failure_code))
    if (disposition === 'IN_PROGRESS') throw new Error('AI_DRAFT_REQUEST_IN_PROGRESS')

    const renewed = await tx.query(
      `UPDATE mip_ai_draft_requests
       SET lease_token = ?, lease_expires_at = ${leaseExpression}
       WHERE app_id = ? AND user_id = ? AND request_id = ? AND status = 'PROCESSING'
         AND input_hash = ? AND lease_expires_at <= UTC_TIMESTAMP(3)
         AND expires_at > UTC_TIMESTAMP(3)`,
      [leaseToken, appId, userId, input.requestId, input.inputHash],
    )
    if (Number(renewed?.affectedRows) !== 1) throw new Error('AI_DRAFT_REQUEST_IN_PROGRESS')
    if (disposition === 'RESUME_READY') {
      await completeDraftRequestRow(
        tx,
        appId,
        userId,
        row.request_id,
        currentDraft,
        leaseToken,
      )
      return { state: 'REPLAY', response: currentDraft }
    }
    if (disposition === 'RESUME_FAILED') {
      throw new Error('AI_PROVIDER_RESULT_UNKNOWN')
    }

    let asset
    if (input.kind === 'VOICE_ASSET') {
      asset = await requireOwnedAudioAsset(tx, appId, userId, row.audio_asset_id)
    }
    else if (input.kind === 'VOICE_UPLOAD' && currentDraft) {
      asset = await requireOwnedAudioAsset(tx, appId, userId, row.audio_asset_id)
    }
    return {
      state: 'RESUMED',
      requestId: input.requestId,
      leaseToken,
      draftId: row.draft_id,
      draft: currentDraft,
      asset,
      ...(input.kind === 'VOICE_UPLOAD'
        ? { allocation: { assetId: row.audio_asset_id, objectKey: row.audio_object_key } }
        : {}),
    }
  }

  async function recoverCompletedDraftRequest(appId, userId, input) {
    assertDraftRequestIdentity(input)
    const row = await readDraftRequestRow(database, appId, userId, input.requestId)
    if (!row) return null
    if (row.input_hash !== input.inputHash) throw new Error('IDEMPOTENCY_CONFLICT')
    if (row.status === 'COMPLETED') return parseObject(row.response_json)
    return null
  }

  async function failDraftRequest(appId, userId, input, failureCode) {
    assertDraftRequestIdentity(input)
    const safeCode = safeFailureCode(failureCode)
    const result = await database.query(
      `UPDATE mip_ai_draft_requests
       SET status = 'FAILED', lease_token = NULL, lease_expires_at = NULL,
           response_json = NULL, failure_code = ?
       WHERE app_id = ? AND user_id = ? AND request_id = ? AND input_hash = ?
         AND status = 'PROCESSING' AND lease_token = ?`,
      [safeCode, appId, userId, input.requestId, input.inputHash, input.leaseToken],
    )
    return Number(result?.affectedRows) === 1
  }

  async function readDraftRequestRow(store, appId, userId, requestId, forUpdate = false) {
    return store.one(
      `SELECT request_id, input_hash, draft_kind, status, lease_token,
              lease_expires_at, draft_id, audio_asset_id, audio_object_key,
              response_json, failure_code, expires_at
       FROM mip_ai_draft_requests
       WHERE app_id = ? AND user_id = ? AND request_id = ?${forUpdate ? ' FOR UPDATE' : ''}`,
      [appId, userId, requestId],
    )
  }

  async function readDraftIfPresent(store, appId, userId, draftId) {
    const row = await store.one(
      `SELECT id, user_id, purpose, transcript_text, structured_draft_json,
              status, expires_at, version, created_at, updated_at
       FROM mip_ai_drafts
       WHERE app_id = ? AND user_id = ? AND id = ? AND status <> 'DELETED'`,
      [appId, userId, draftId],
    )
    return row ? draftDto(row) : null
  }

  async function completeDraftRequestRow(store, appId, userId, requestId, response, leaseToken) {
    const result = await store.query(
      `UPDATE mip_ai_draft_requests
       SET status = 'COMPLETED', lease_token = NULL, lease_expires_at = NULL,
           response_json = ?, failure_code = NULL
       WHERE app_id = ? AND user_id = ? AND request_id = ? AND status = 'PROCESSING'
         AND lease_token = ?`,
      [JSON.stringify(response), appId, userId, requestId, leaseToken],
    )
    if (Number(result?.affectedRows) !== 1) throw new Error('AI_DRAFT_REQUEST_IN_PROGRESS')
  }

  async function requireOwnedAudioAsset(store, appId, userId, assetId) {
    const asset = await store.one(
      `SELECT id, cloud_file_id, content_sha256, content_type, content_bytes, status
       FROM mip_media_assets
       WHERE app_id = ? AND id = ? AND owner_user_id = ? FOR UPDATE`,
      [appId, assetId, userId],
    )
    if (!asset || asset.status !== 'READY'
      || asset.content_type !== 'audio/mpeg'
      || !/^[a-f0-9]{64}$/i.test(String(asset.content_sha256 || ''))
      || !Number.isInteger(Number(asset.content_bytes))
      || Number(asset.content_bytes) < 1
      || Number(asset.content_bytes) > 2 * 1024 * 1024) {
      throw new Error('AI_AUDIO_NOT_AVAILABLE')
    }
    return asset
  }

  async function createVoiceDraft(appId, userId, input) {
    const id = createId()
    return database.transaction(async (tx) => {
      await requireActiveUser(tx, appId, userId)
      const asset = await requireOwnedAudioAsset(tx, appId, userId, input.audioAssetId)
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

  async function ensurePendingAudioUpload(appId, asset) {
    try {
      await registerPendingAudioUpload(appId, asset)
      return
    }
    catch (error) {
      const existing = await database.one(
        `SELECT owner_user_id, purpose, object_key, cloud_file_id, content_sha256,
                content_type, content_bytes, status
         FROM mip_media_assets WHERE app_id = ? AND id = ?`,
        [appId, asset.assetId],
      )
      if (existing?.owner_user_id == null
        && existing.purpose === 'AI_AUDIO'
        && existing.object_key === asset.objectKey
        && existing.cloud_file_id === asset.cloudFileId
        && existing.content_sha256 === asset.contentSha256
        && existing.content_type === asset.contentType
        && Number(existing.content_bytes) === Number(asset.contentBytes)
        && existing.status === 'PENDING') {
        return
      }
      throw error
    }
  }

  async function createVoiceDraftFromUpload(appId, userId, asset, purpose, preallocatedDraftId) {
    const draftId = preallocatedDraftId || createId()
    if (!isUuid(draftId)) throw new Error('VALIDATION_FAILED')
    await ensurePendingAudioUpload(appId, asset)
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
          content_sha256: asset.contentSha256,
          content_type: asset.contentType,
          content_bytes: asset.contentBytes,
        },
      }
    })
  }

  async function recoverVoiceDraftFromUpload(appId, userId, assetId) {
    const row = await database.one(
      `SELECT asset.owner_user_id, asset.status AS asset_status,
              asset.cloud_file_id, asset.content_sha256, asset.content_type, asset.content_bytes,
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
            content_sha256: row.content_sha256,
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

  async function completeKeyedDraft(appId, userId, input, result) {
    assertDraftRequestIdentity(input)
    if (!isUuid(input.draftId)
      || !Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) {
      throw new Error('VALIDATION_FAILED')
    }
    const providerHash = result.providerJobKey
      ? createHash('sha256').update(result.providerJobKey).digest('hex')
      : null
    return database.transaction(async (tx) => {
      await requireActiveUser(tx, appId, userId)
      const request = await readDraftRequestRow(tx, appId, userId, input.requestId, true)
      if (!request) throw new Error('NOT_FOUND')
      if (request.input_hash !== input.inputHash || request.draft_id !== input.draftId) {
        throw new Error('IDEMPOTENCY_CONFLICT')
      }
      if (new Date(request.expires_at).getTime() <= Date.now()) {
        throw new Error('AI_DRAFT_REQUEST_EXPIRED')
      }
      if (request.status === 'COMPLETED') return parseObject(request.response_json)
      if (request.status !== 'PROCESSING' || request.lease_token !== input.leaseToken) {
        throw new Error('AI_DRAFT_REQUEST_IN_PROGRESS')
      }
      const current = await tx.one(
        `SELECT purpose, status, version, expires_at FROM mip_ai_drafts
         WHERE app_id = ? AND user_id = ? AND id = ? FOR UPDATE`,
        [appId, userId, input.draftId],
      )
      if (!current) throw new Error('NOT_FOUND')
      if (!['TRANSCRIBING', 'STRUCTURING'].includes(current.status)
        || Number(current.version) !== input.expectedVersion
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
          input.draftId,
          input.expectedVersion,
        ],
      )
      if (Number(update.affectedRows) !== 1) throw new Error('CONFLICT')
      const ready = await readDraft(tx, appId, userId, input.draftId)
      await completeDraftRequestRow(tx, appId, userId, input.requestId, ready, input.leaseToken)
      return ready
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

  async function failKeyedDraft(appId, userId, input, failureCode) {
    assertDraftRequestIdentity(input)
    if (!isUuid(input.draftId)
      || !Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) {
      throw new Error('VALIDATION_FAILED')
    }
    const safeCode = safeFailureCode(failureCode)
    return database.transaction(async (tx) => {
      await requireActiveUser(tx, appId, userId)
      const request = await readDraftRequestRow(tx, appId, userId, input.requestId, true)
      if (!request) throw new Error('NOT_FOUND')
      if (request.input_hash !== input.inputHash || request.draft_id !== input.draftId) {
        throw new Error('IDEMPOTENCY_CONFLICT')
      }
      if (new Date(request.expires_at).getTime() <= Date.now()) {
        throw new Error('AI_DRAFT_REQUEST_EXPIRED')
      }
      if (request.status === 'COMPLETED') return false
      if (request.status !== 'PROCESSING' || request.lease_token !== input.leaseToken) {
        throw new Error('AI_DRAFT_REQUEST_IN_PROGRESS')
      }
      const draft = await tx.one(
        `SELECT status, version FROM mip_ai_drafts
         WHERE app_id = ? AND user_id = ? AND id = ? FOR UPDATE`,
        [appId, userId, input.draftId],
      )
      if (!draft) throw new Error('NOT_FOUND')
      if (!['TRANSCRIBING', 'STRUCTURING'].includes(draft.status)
        || Number(draft.version) !== input.expectedVersion) {
        throw new Error('CONFLICT')
      }
      const failedDraft = await tx.query(
        `UPDATE mip_ai_drafts SET status = 'FAILED', version = version + 1
         WHERE app_id = ? AND user_id = ? AND id = ? AND version = ?
           AND status IN ('TRANSCRIBING', 'STRUCTURING')`,
        [appId, userId, input.draftId, input.expectedVersion],
      )
      if (Number(failedDraft?.affectedRows) !== 1) throw new Error('CONFLICT')
      const failedRequest = await tx.query(
        `UPDATE mip_ai_draft_requests
         SET status = 'FAILED', lease_token = NULL, lease_expires_at = NULL,
             response_json = NULL, failure_code = ?
         WHERE app_id = ? AND user_id = ? AND request_id = ?
           AND input_hash = ? AND status = 'PROCESSING' AND lease_token = ?`,
        [safeCode, appId, userId, input.requestId, input.inputHash, input.leaseToken],
      )
      if (Number(failedRequest?.affectedRows) !== 1) throw new Error('AI_DRAFT_REQUEST_IN_PROGRESS')
      return true
    })
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
         LEFT JOIN mip_ai_draft_requests ai_request
           ON ai_request.app_id = asset.app_id
             AND ai_request.audio_asset_id = asset.id
             AND ai_request.draft_kind = 'VOICE_UPLOAD'
             AND ai_request.status = 'PROCESSING'
             AND ai_request.expires_at > UTC_TIMESTAMP(3)
         WHERE asset.app_id = ?
           AND asset.purpose = 'AI_AUDIO'
           AND ai_request.id IS NULL
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

  async function createAvatarGeneration(appId, userId, input) {
    const generationId = createId()
    return database.transaction(async (tx) => {
      await requireActiveUser(tx, appId, userId)
      const existing = await tx.one(
        `SELECT id, source_avatar_asset_id, style_key, status
         FROM mip_digital_avatar_generations
         WHERE app_id = ? AND user_id = ? AND request_id = ? FOR UPDATE`,
        [appId, userId, input.requestId],
      )
      if (existing) {
        if (existing.source_avatar_asset_id !== input.sourceAvatarAssetId
          || existing.style_key !== input.styleKey) {
          throw new Error('IDEMPOTENCY_CONFLICT')
        }
        return {
          generation: await readAvatarGeneration(tx, appId, userId, existing.id),
          source: null,
          replayed: true,
        }
      }
      const source = await tx.one(
        `SELECT asset.id, asset.cloud_file_id, asset.content_sha256, asset.content_type,
                asset.content_bytes, asset.width_px, asset.height_px
         FROM mip_profiles profile
         INNER JOIN mip_media_assets asset
           ON asset.app_id = profile.app_id AND asset.id = profile.avatar_asset_id
         WHERE profile.app_id = ? AND profile.user_id = ?
           AND profile.avatar_asset_id = ?
           AND asset.owner_user_id = ?
           AND asset.purpose = 'AVATAR'
           AND asset.status = 'READY'
           AND asset.content_type IN ('image/png', 'image/jpeg')
         FOR UPDATE`,
        [appId, userId, input.sourceAvatarAssetId, userId],
      )
      if (!source
        || !String(source.cloud_file_id || '').startsWith('cloud://')
        || !/^[0-9a-f]{64}$/i.test(String(source.content_sha256 || ''))
        || Number(source.content_bytes) < 1
        || !Number.isInteger(Number(source.width_px))
        || !Number.isInteger(Number(source.height_px))) {
        throw new Error('DIGITAL_AVATAR_SOURCE_NOT_AVAILABLE')
      }
      await tx.query(
        `INSERT INTO mip_digital_avatar_generations (
           id, app_id, user_id, request_id, source_avatar_asset_id, style_key, status
         ) VALUES (?, ?, ?, ?, ?, ?, 'PROCESSING')`,
        [generationId, appId, userId, input.requestId, input.sourceAvatarAssetId, input.styleKey],
      )
      return {
        generation: await readAvatarGeneration(tx, appId, userId, generationId),
        source: {
          cloudFileId: source.cloud_file_id,
          contentSha256: String(source.content_sha256).toLowerCase(),
          contentType: source.content_type,
          contentBytes: Number(source.content_bytes),
          width: Number(source.width_px),
          height: Number(source.height_px),
        },
        replayed: false,
      }
    })
  }

  async function listAvatarGenerations(appId, userId, options = {}) {
    const requestedLimit = Number(options.limit ?? 12)
    if (!Number.isInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > 20) {
      throw new Error('VALIDATION_FAILED')
    }
    const limit = requestedLimit
    const rows = await database.query(
      `SELECT generation.id, generation.source_avatar_asset_id,
              generation.style_key, generation.status, generation.output_asset_id,
              generation.failure_code, generation.version, generation.created_at,
              generation.updated_at, output.cloud_file_id AS output_file_id
       FROM mip_digital_avatar_generations generation
       LEFT JOIN mip_media_assets output
         ON output.app_id = generation.app_id AND output.id = generation.output_asset_id
           AND output.owner_user_id = generation.user_id
           AND output.purpose = 'DIGITAL_AVATAR' AND output.status = 'READY'
       WHERE generation.app_id = ? AND generation.user_id = ?
       ORDER BY generation.created_at DESC, generation.id DESC LIMIT ?`,
      [appId, userId, limit],
    )
    return { items: rows.map(avatarGenerationDto) }
  }

  async function getAvatarGeneration(appId, userId, generationId) {
    if (!isUuid(generationId)) throw new Error('VALIDATION_FAILED')
    return readAvatarGeneration(database, appId, userId, generationId)
  }

  async function recoverAvatarGenerationOutput(appId, userId, generationId, assetId) {
    const row = await database.one(
      `SELECT asset.owner_user_id, asset.status AS asset_status,
              generation.status AS generation_status, generation.output_asset_id
       FROM mip_media_assets asset
       LEFT JOIN mip_digital_avatar_generations generation
         ON generation.app_id = asset.app_id AND generation.id = ? AND generation.user_id = ?
       WHERE asset.app_id = ? AND asset.id = ? AND asset.purpose = 'DIGITAL_AVATAR'`,
      [generationId, userId, appId, assetId],
    )
    if (!row) return { state: 'MISSING' }
    if (row.generation_status === 'READY'
      && row.output_asset_id === assetId
      && row.asset_status === 'READY'
      && row.owner_user_id === userId) {
      return {
        state: 'COMMITTED',
        generation: await readAvatarGeneration(database, appId, userId, generationId),
      }
    }
    if (row.asset_status === 'PENDING' && row.owner_user_id == null) return { state: 'PENDING' }
    return { state: 'KEEP' }
  }

  async function readAvatarGeneration(store, appId, userId, generationId) {
    const row = await store.one(
      `SELECT generation.id, generation.source_avatar_asset_id,
              generation.style_key, generation.status, generation.output_asset_id,
              generation.failure_code, generation.version, generation.created_at,
              generation.updated_at, output.cloud_file_id AS output_file_id
       FROM mip_digital_avatar_generations generation
       LEFT JOIN mip_media_assets output
         ON output.app_id = generation.app_id AND output.id = generation.output_asset_id
           AND output.owner_user_id = generation.user_id
           AND output.purpose = 'DIGITAL_AVATAR' AND output.status = 'READY'
       WHERE generation.app_id = ? AND generation.user_id = ? AND generation.id = ?`,
      [appId, userId, generationId],
    )
    if (!row) throw new Error('NOT_FOUND')
    return avatarGenerationDto(row)
  }

  async function completeAvatarGeneration(appId, userId, generationId, expectedVersion, asset, providerJobKey) {
    if (!isUuid(generationId)
      || !Number.isInteger(expectedVersion) || expectedVersion < 1
      || !isUuid(asset?.assetId)
      || typeof providerJobKey !== 'string' || !providerJobKey) {
      throw new Error('VALIDATION_FAILED')
    }
    const providerHash = createHash('sha256').update(providerJobKey).digest('hex')
    return database.transaction(async (tx) => {
      await requireActiveUser(tx, appId, userId)
      const current = await tx.one(
        `SELECT status, version FROM mip_digital_avatar_generations
         WHERE app_id = ? AND user_id = ? AND id = ? FOR UPDATE`,
        [appId, userId, generationId],
      )
      if (!current) throw new Error('NOT_FOUND')
      if (current.status !== 'PROCESSING' || Number(current.version) !== expectedVersion) {
        throw new Error('CONFLICT')
      }
      const activated = await tx.query(
        `UPDATE mip_media_assets
         SET owner_user_id = ?, status = 'READY'
         WHERE app_id = ? AND id = ? AND owner_user_id IS NULL
           AND purpose = 'DIGITAL_AVATAR' AND status = 'PENDING'`,
        [userId, appId, asset.assetId],
      )
      if (Number(activated?.affectedRows) !== 1) throw new Error('DIGITAL_AVATAR_UPLOAD_FAILED')
      const updated = await tx.query(
        `UPDATE mip_digital_avatar_generations
         SET status = 'READY', output_asset_id = ?, provider_job_key_hash = ?,
             failure_code = NULL, version = version + 1
         WHERE app_id = ? AND user_id = ? AND id = ?
           AND status = 'PROCESSING' AND version = ?`,
        [asset.assetId, providerHash, appId, userId, generationId, expectedVersion],
      )
      if (Number(updated?.affectedRows) !== 1) throw new Error('CONFLICT')
      return readAvatarGeneration(tx, appId, userId, generationId)
    })
  }

  async function registerPendingAvatarOutput(appId, asset) {
    const inserted = await database.query(
      `INSERT INTO mip_media_assets (
         id, app_id, owner_user_id, purpose, object_key, cloud_file_id,
         content_sha256, content_type, content_bytes, width_px, height_px, status
       ) VALUES (?, ?, NULL, 'DIGITAL_AVATAR', ?, ?, ?, ?, ?, ?, ?, 'PENDING')`,
      [
        asset.assetId,
        appId,
        asset.objectKey,
        asset.cloudFileId,
        asset.contentSha256,
        asset.contentType,
        asset.contentBytes,
        asset.width,
        asset.height,
      ],
    )
    if (Number(inserted?.affectedRows) !== 1) throw new Error('DIGITAL_AVATAR_UPLOAD_FAILED')
  }

  async function markPendingAvatarOutputDeleted(appId, assetId) {
    const result = await database.query(
      `UPDATE mip_media_assets SET status = 'DELETED'
       WHERE app_id = ? AND id = ? AND owner_user_id IS NULL
         AND purpose = 'DIGITAL_AVATAR' AND status = 'PENDING'`,
      [appId, assetId],
    )
    return Number(result?.affectedRows) === 1
  }

  async function failAvatarGeneration(appId, userId, generationId, expectedVersion, failureCode) {
    const safeCode = typeof failureCode === 'string' && /^[A-Z][A-Z0-9_]{2,63}$/.test(failureCode)
      ? failureCode
      : 'DIGITAL_AVATAR_GENERATION_FAILED'
    const result = await database.query(
      `UPDATE mip_digital_avatar_generations
       SET status = 'FAILED', failure_code = ?, version = version + 1
       WHERE app_id = ? AND user_id = ? AND id = ?
         AND status = 'PROCESSING' AND version = ?`,
      [safeCode, appId, userId, generationId, expectedVersion],
    )
    return Number(result?.affectedRows) === 1
  }

  async function expireAvatarGenerations(appId, userId) {
    await database.query(
      `UPDATE mip_digital_avatar_generations
       SET status = 'FAILED', failure_code = 'DIGITAL_AVATAR_GENERATION_INTERRUPTED',
           version = version + 1
       WHERE app_id = ? AND user_id = ? AND status = 'PROCESSING'
         AND updated_at < DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 15 MINUTE)`,
      [appId, userId],
    )
  }

  return {
    completeAvatarGeneration,
    beginDraftRefinement,
    createAvatarGeneration,
    completeDraft,
    completeKeyedDraft,
    claimDraftRequest,
    createTextDraft,
    createVoiceDraft,
    createVoiceDraftFromUpload,
    deleteDraft,
    expireDrafts,
    expireDraftsForApp,
    expireAvatarGenerations,
    failAvatarGeneration,
    failDraft,
    failKeyedDraft,
    failDraftRequest,
    getDraft,
    getAvatarGeneration,
    leaseAppAudioCleanup,
    listDrafts,
    listAvatarGenerations,
    leaseAudioCleanup,
    markAudioDeleted,
    markPendingAvatarOutputDeleted,
    markPendingAudioUploadDeleted,
    recoverAvatarGenerationOutput,
    recoverCompletedDraftRequest,
    recoverVoiceDraftFromUpload,
    registerPendingAvatarOutput,
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

function normalizeRequestLeaseSeconds(value) {
  const seconds = Number(value ?? 300)
  if (!Number.isInteger(seconds) || seconds < 30 || seconds > 900) {
    throw new Error('AI_DRAFT_REQUEST_LEASE_INVALID')
  }
  return seconds
}

function assertDraftRequestInput(input) {
  assertDraftRequestIdentity(input)
  if (!['TEXT', 'VOICE_ASSET', 'VOICE_UPLOAD'].includes(input.kind)
    || typeof input.purpose !== 'string' || !input.purpose) {
    throw new Error('VALIDATION_FAILED')
  }
  if (input.kind === 'TEXT' && (typeof input.transcriptText !== 'string' || !input.transcriptText)) {
    throw new Error('VALIDATION_FAILED')
  }
  if (input.kind === 'VOICE_ASSET' && !isUuid(input.audioAssetId)) {
    throw new Error('VALIDATION_FAILED')
  }
  if (input.kind === 'VOICE_UPLOAD'
    && (!isUuid(input.allocation?.assetId)
      || typeof input.allocation?.objectKey !== 'string'
      || !input.allocation.objectKey || input.allocation.objectKey.length > 512)) {
    throw new Error('VALIDATION_FAILED')
  }
}

function assertDraftRequestIdentity(input) {
  if (!/^[\w.:-]{8,128}$/.test(String(input?.requestId || ''))
    || !/^[0-9a-f]{64}$/.test(String(input?.inputHash || ''))
    || (input.leaseToken !== undefined && !isUuid(input.leaseToken))) {
    throw new Error('VALIDATION_FAILED')
  }
}

function safeFailureCode(value) {
  return typeof value === 'string' && /^[A-Z][A-Z0-9_]{2,63}$/.test(value)
    ? value
    : 'AI_PROVIDER_RESULT_UNKNOWN'
}

function draftRequestDisposition(row, input, currentDraft, now = Date.now()) {
  if (row.input_hash !== input.inputHash || row.draft_kind !== input.kind) return 'CONFLICT'
  if (new Date(row.expires_at).getTime() <= now) return 'EXPIRED'
  if (row.status === 'COMPLETED') return 'REPLAY'
  if (row.status === 'FAILED') return 'FAILED'
  if (new Date(row.lease_expires_at).getTime() > now) return 'IN_PROGRESS'
  if (currentDraft?.status === 'DRAFT_READY') return 'RESUME_READY'
  if (currentDraft?.status === 'FAILED') return 'RESUME_FAILED'
  if (currentDraft && !['TRANSCRIBING', 'STRUCTURING'].includes(currentDraft.status)) return 'EXPIRED'
  return 'RESUME'
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

function avatarGenerationDto(row) {
  const status = String(row.status || '')
  const outputUrl = status === 'READY' && typeof row.output_file_id === 'string'
    && row.output_file_id.startsWith('cloud://')
    ? row.output_file_id
    : undefined
  if (status === 'READY' && !outputUrl) throw new Error('DIGITAL_AVATAR_RESULT_INVALID')
  return {
    id: row.id,
    sourceAvatarAssetId: row.source_avatar_asset_id,
    styleKey: row.style_key,
    status,
    ...(row.output_asset_id ? { outputAssetId: row.output_asset_id } : {}),
    ...(outputUrl ? { outputUrl } : {}),
    ...(row.failure_code ? { failureCode: row.failure_code } : {}),
    version: Number(row.version),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
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
  avatarGenerationDto,
  createAiRepository,
  cleanupLimit,
  decodeCursor,
  draftDto,
  draftRequestDisposition,
  encodeCursor,
  normalizeDraftTtlHours,
  normalizeRequestLeaseSeconds,
}
