'use strict'

const { createHash, randomBytes, randomUUID } = require('node:crypto')
const { createOperationsPublisher } = require('../operations-publication')
const { cursorPredicateFor, pageRows } = require('../pagination')

function createAdminEventRepository(database, dependencies) {
  const createId = dependencies.createId || randomUUID
  const bytes = dependencies.randomBytes || randomBytes
  const now = dependencies.now || (() => new Date())
  const authorizeMutation = dependencies.authorizeMutation
  const lockMutation = dependencies.lockMutationAuthorization
  const assertScope = dependencies.assertMutationScope
  const assertAuthorizedScope = dependencies.assertAuthorizedScope
  const eventScopeFromRow = dependencies.eventScopeFromRow
  const sameScope = dependencies.sameScope
  const visibleEventsWhere = dependencies.visibleEventsWhere
  const writeAudit = dependencies.writeAudit
  const writeOutbox = dependencies.writeOutbox
  const {
    codeError,
    duplicateConstraint,
    escapeLike,
    iso,
    json,
  } = dependencies.repositorySupport
  const operationsPublisher = createOperationsPublisher({
    assertMutationScope: assertScope,
    createId,
    lockMutationAuthorization: lockMutation,
    maximumRecipients: dependencies.maximumEventReminderRecipients,
    writeAudit,
  })

  function displayAnswer(value) {
    if (typeof value === 'boolean') return value ? '是' : '否'
    if (typeof value === 'string') return value
    if (value === null || value === undefined) return ''
    try { return JSON.stringify(value) }
    catch { return String(value) }
  }

  function registrationAnswerItems(schemaValue, answersValue) {
    const schema = json(schemaValue, [])
    const answers = json(answersValue, {})
    if (!answers || typeof answers !== 'object' || Array.isArray(answers)) return []
    const labels = new Map(
      (Array.isArray(schema) ? schema : [])
        .filter(field => field && typeof field === 'object' && !Array.isArray(field)
          && typeof field.key === 'string' && typeof field.label === 'string')
        .map(field => [field.key, field.label]),
    )
    return Object.entries(answers).map(([key, value]) => ({
      key,
      label: labels.get(key) || key,
      value: displayAnswer(value),
    }))
  }

  function eventAlbumPhotoDto(row) {
    const visibility = json(row.visibility_json, {})
    return {
      id: String(row.id),
      caption: row.caption || '',
      imageUrl: row.asset_status === 'READY' ? (row.cloud_file_id || '') : '',
      nickname: visibility.nickname === false ? '活动参与者' : (row.nickname || '活动参与者'),
      avatarUrl: visibility.avatar === false ? '' : (row.avatar_file_id || ''),
      status: row.status,
      moderationReason: row.moderation_reason || '',
      version: Number(row.version),
      createdAt: iso(row.created_at),
      reviewedAt: iso(row.reviewed_at),
      publishedAt: iso(row.published_at),
    }
  }

  function eventAlbumAssetReady(row) {
    return row.asset_status === 'READY'
      && row.asset_purpose === 'EVENT_ALBUM'
      && /^image\/(?:png|jpeg)$/.test(row.asset_content_type || '')
      && /^[0-9a-f]{64}$/.test(row.asset_content_sha256 || '')
      && Number(row.asset_content_bytes) > 0
      && Number(row.asset_width_px) > 0
      && Number(row.asset_height_px) > 0
      && typeof row.asset_cloud_file_id === 'string'
      && row.asset_cloud_file_id.startsWith('cloud://')
      && typeof row.asset_object_key === 'string'
      && /^mip\/(?:development|test|staging|production)\//.test(row.asset_object_key)
      && !row.asset_object_key.includes('..')
  }

  function draftResourceScope(draft) {
    return {
      scopeType: draft.scopeType,
      scopeId: draft.scopeType === 'BRANCH' ? draft.branchId : null,
    }
  }

  function merchantRefundNumber(refundId) {
    const compact = String(refundId || '').replace(/[^0-9A-Za-z]/g, '').slice(0, 56)
    if (!compact) throw codeError('REFUND_ID_INVALID')
    return `MIPR${compact}`
  }

  function eventCursorPredicate(cursor, direction) {
    if (!cursor) return { sql: '', params: [] }
    const operator = direction === 'DESC' ? '<' : '>'
    return {
      sql: ` AND (e.starts_at ${operator} ? OR (e.starts_at = ? AND e.id ${operator} ?))`,
      params: [cursor.startsAt, cursor.startsAt, cursor.id],
    }
  }

  function shiftedCloneDates(source, currentTime) {
    const weekMs = 7 * 24 * 60 * 60 * 1000
    const sourceStart = new Date(source.starts_at)
    const sourceEnd = new Date(source.ends_at)
    if (!Number.isFinite(sourceStart.getTime()) || !Number.isFinite(sourceEnd.getTime()) || sourceEnd <= sourceStart) {
      throw codeError('INVALID_STATE')
    }
    const earliest = currentTime.getTime() + weekMs
    let startsAtMs = sourceStart.getTime() + weekMs
    if (startsAtMs < earliest) {
      startsAtMs += Math.ceil((earliest - startsAtMs) / weekMs) * weekMs
    }
    const shiftMs = startsAtMs - sourceStart.getTime()
    const shifted = value => value ? new Date(new Date(value).getTime() + shiftMs) : null
    return {
      startsAt: new Date(startsAtMs),
      endsAt: shifted(sourceEnd),
      registrationOpensAt: shifted(source.registration_opens_at),
      registrationDeadline: shifted(source.registration_deadline),
      cancellationDeadline: shifted(source.cancellation_deadline),
    }
  }

  async function assertEventCover(tx, input, currentCoverId) {
    const coverAssetId = input.draft.coverAssetId
    if (!coverAssetId) return
    const unchanged = Boolean(currentCoverId) && currentCoverId === coverAssetId
    const asset = await tx.one(
      `SELECT id FROM mip_media_assets
       WHERE app_id = ? AND id = ?
         ${unchanged ? '' : 'AND owner_user_id = ?'}
         AND purpose = 'EVENT_COVER' AND status = 'READY'
       FOR UPDATE`,
      unchanged
        ? [input.appId, coverAssetId]
        : [input.appId, coverAssetId, input.actorUserId],
    )
    if (!asset) throw codeError('VALIDATION_FAILED')
  }

  async function assertEventContentMedia(tx, input, eventId) {
    const media = input.draft.contentMedia || []
    if (!media.length) return
    const ids = media.map(item => item.assetId)
    const rows = await tx.query(
      `SELECT asset.id
       FROM mip_media_assets asset
       LEFT JOIN mip_event_content_media current_media
         ON current_media.app_id = asset.app_id
         AND current_media.media_asset_id = asset.id
         AND current_media.event_id = ? AND current_media.status = 'ACTIVE'
       WHERE asset.app_id = ? AND asset.id IN (${ids.map(() => '?').join(', ')})
         AND asset.status = 'READY' AND asset.purpose = 'EVENT_CONTENT'
         AND (asset.owner_user_id = ? OR current_media.event_id IS NOT NULL)
       FOR UPDATE`,
      [eventId || '', input.appId, ...ids, input.actorUserId],
    )
    if (new Set(rows.map(row => row.id)).size !== ids.length) {
      throw codeError('VALIDATION_FAILED')
    }
  }

  async function replaceEventContentMedia(tx, input, eventId) {
    await tx.query(
      `UPDATE mip_event_content_media
       SET status = 'REMOVED', version = version + 1
       WHERE app_id = ? AND event_id = ? AND status = 'ACTIVE'`,
      [input.appId, eventId],
    )
    for (const [sortOrder, media] of (input.draft.contentMedia || []).entries()) {
      await tx.query(
        `INSERT INTO mip_event_content_media (
          app_id, event_id, media_asset_id, sort_order, caption, status
        ) VALUES (?, ?, ?, ?, ?, 'ACTIVE')
        ON DUPLICATE KEY UPDATE sort_order = VALUES(sort_order), caption = VALUES(caption),
          status = 'ACTIVE', version = version + 1`,
        [input.appId, eventId, media.assetId, sortOrder, media.caption || null],
      )
    }
  }

  async function writeEventChange(tx, change) {
    await tx.query(
      `INSERT INTO mip_event_changes (
        id, app_id, event_id, source_version, change_type, summary,
        changed_fields_json, actor_user_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [change.id, change.appId, change.eventId, change.sourceVersion, change.changeType,
        change.summary, JSON.stringify(change.changedFields || []), change.actorUserId],
    )
  }

  async function writeCheckInTransition(tx, transition) {
    await tx.query(
      `INSERT INTO mip_event_checkin_transitions (
        id, app_id, checkin_id, registration_id, event_id, user_id,
        transition_type, checkin_version, registration_version,
        reversal_of_transition_id, actor_user_id, source, revoke_reason, occurred_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [transition.id, transition.appId, transition.checkinId, transition.registrationId,
        transition.eventId, transition.userId, transition.transitionType,
        transition.checkinVersion, transition.registrationVersion,
        transition.reversalOfTransitionId || null, transition.actorUserId || null,
        transition.source, transition.revokeReason || null, transition.occurredAt],
    )
  }

  async function getEventScope(appId, eventId) {
    const row = await database.one(
      'SELECT id, scope_type, branch_id, status, version, content_safety_status FROM mip_events WHERE app_id = ? AND id = ?',
      [appId, eventId],
    )
    return row ? {
      scopeType: 'EVENT',
      scopeId: row.id,
      branchId: row.branch_id || null,
      eventScopeType: row.scope_type,
      status: row.status,
      version: Number(row.version),
      contentSafetyStatus: row.content_safety_status,
    } : null
  }

  async function listEvents(appId, visibility, filters, sort, pageLimit, cursor = null) {
    const visible = visibleEventsWhere(visibility)
    const clauses = ['e.app_id = ?', visible.sql]
    const params = [appId, ...visible.params]
    if (filters.status) {
      clauses.push('e.status = ?')
      params.push(filters.status)
    }
    if (filters.query) {
      clauses.push('e.title LIKE ? ESCAPE \'\\\\\'')
      params.push(`%${escapeLike(filters.query)}%`)
    }
    if (filters.startsFrom) {
      clauses.push('e.starts_at >= ?')
      params.push(filters.startsFrom)
    }
    if (filters.startsTo) {
      clauses.push('e.starts_at <= ?')
      params.push(filters.startsTo)
    }
    if (filters.branchId) {
      clauses.push('e.branch_id = ?')
      params.push(filters.branchId)
    }
    if (filters.cityOrBranch) {
      const location = `%${escapeLike(filters.cityOrBranch)}%`
      clauses.push('(e.city_name LIKE ? ESCAPE \'\\\\\' OR b.name LIKE ? ESCAPE \'\\\\\')')
      params.push(location, location)
    }
    if (filters.eventTypeKey) {
      clauses.push('e.event_type_key = ?')
      params.push(filters.eventTypeKey)
    }
    if (filters.accessType) {
      clauses.push('e.access_type = ?')
      params.push(filters.accessType)
    }
    if (filters.priceMinCents !== null) {
      clauses.push('e.price_cents >= ?')
      params.push(filters.priceMinCents)
    }
    if (filters.priceMaxCents !== null) {
      clauses.push('e.price_cents <= ?')
      params.push(filters.priceMaxCents)
    }
    const direction = sort.direction === 'DESC' ? 'DESC' : 'ASC'
    const cursorWhere = eventCursorPredicate(cursor, direction)
    const rows = await database.query(
      `SELECT e.id, e.title, e.summary, e.scope_type, e.branch_id, b.name AS branch_name,
        e.status, e.content_safety_status, e.starts_at, e.ends_at, e.city_name,
        e.event_type_key, e.access_type, e.price_cents, e.registration_policy,
        e.album_enabled, e.album_submission_policy, e.capacity, e.version,
        SUM(CASE WHEN r.status IN ('REGISTERED', 'CANCELLATION_PENDING', 'ATTENDED')
          THEN 1 ELSE 0 END) AS registration_count,
        SUM(CASE WHEN r.status = 'ATTENDED' THEN 1 ELSE 0 END) AS attended_count
       FROM mip_events e
       LEFT JOIN mip_city_branches b ON b.app_id = e.app_id AND b.id = e.branch_id
       LEFT JOIN mip_event_registrations r ON r.app_id = e.app_id AND r.event_id = e.id
       WHERE ${clauses.join(' AND ')}${cursorWhere.sql}
       GROUP BY e.id, e.title, e.summary, e.scope_type, e.branch_id, b.name, e.status,
        e.content_safety_status, e.starts_at, e.ends_at, e.city_name, e.event_type_key,
        e.access_type, e.price_cents, e.registration_policy, e.album_enabled,
        e.album_submission_policy, e.capacity, e.version
       ORDER BY e.starts_at ${direction}, e.id ${direction} LIMIT ?`,
      [...params, ...cursorWhere.params, pageLimit + 1],
    )
    const items = rows.map(row => ({
      id: row.id,
      title: row.title,
      summary: row.summary,
      scopeType: row.scope_type,
      branchId: row.branch_id || null,
      branchName: row.branch_name || '',
      status: row.status,
      contentSafetyStatus: row.content_safety_status,
      startsAt: iso(row.starts_at),
      endsAt: iso(row.ends_at),
      cityName: row.city_name || '',
      eventTypeKey: row.event_type_key,
      accessType: row.access_type,
      priceCents: Number(row.price_cents || 0),
      registrationPolicy: row.registration_policy,
      albumEnabled: Number(row.album_enabled) === 1,
      albumSubmissionPolicy: row.album_submission_policy,
      capacity: row.capacity === null ? null : Number(row.capacity),
      registrationCount: Number(row.registration_count || 0),
      attendedCount: Number(row.attended_count || 0),
      version: Number(row.version),
    }))
    return pageRows(items, pageLimit, row => ({
      startsAt: row.startsAt,
      id: row.id,
      sortField: 'startsAt',
      sortDirection: direction,
    }))
  }

  async function getEvent(appId, eventId) {
    const row = await database.one(
      `SELECT e.id, e.scope_type, e.branch_id, e.title, e.summary, e.description, e.notices,
        event_type_key, event_mode, access_type, registration_policy,
        album_enabled, album_submission_policy, starts_at, ends_at,
        registration_deadline, cancellation_deadline, venue_name, address, city_name,
        latitude, longitude, online_url, capacity, waitlist_enabled, price_cents, registration_schema_json,
        e.cover_asset_id, cover.cloud_file_id AS cover_file_id,
        e.status, e.content_safety_status, e.version
       FROM mip_events e
       LEFT JOIN mip_media_assets cover
         ON cover.app_id = e.app_id AND cover.id = e.cover_asset_id AND cover.status = 'READY'
       WHERE e.app_id = ? AND e.id = ?`,
      [appId, eventId],
    )
    if (!row) return null
    const contentMedia = await database.query(
      `SELECT media.media_asset_id, media.caption, asset.cloud_file_id
       FROM mip_event_content_media media
       INNER JOIN mip_media_assets asset
         ON asset.app_id = media.app_id AND asset.id = media.media_asset_id
         AND asset.status = 'READY' AND asset.purpose = 'EVENT_CONTENT'
       WHERE media.app_id = ? AND media.event_id = ? AND media.status = 'ACTIVE'
       ORDER BY media.sort_order, media.media_asset_id`,
      [appId, eventId],
    )
    return {
      id: row.id,
      scopeType: row.scope_type,
      branchId: row.branch_id || null,
      title: row.title,
      summary: row.summary,
      description: row.description,
      contentMedia: contentMedia.map(item => ({
        assetId: item.media_asset_id,
        imageUrl: item.cloud_file_id,
        caption: item.caption || '',
      })),
      notices: row.notices || '',
      coverAssetId: row.cover_asset_id || null,
      coverUrl: row.cover_file_id || '',
      eventTypeKey: row.event_type_key,
      eventMode: row.event_mode,
      accessType: row.access_type,
      registrationPolicy: row.registration_policy,
      albumEnabled: Number(row.album_enabled) === 1,
      albumSubmissionPolicy: row.album_submission_policy,
      startsAt: iso(row.starts_at),
      endsAt: iso(row.ends_at),
      registrationDeadline: iso(row.registration_deadline),
      cancellationDeadline: iso(row.cancellation_deadline),
      venueName: row.venue_name || '',
      address: row.address || '',
      cityName: row.city_name || '',
      latitude: row.latitude === null ? null : Number(row.latitude),
      longitude: row.longitude === null ? null : Number(row.longitude),
      onlineUrl: row.online_url || '',
      capacity: row.capacity === null ? null : Number(row.capacity),
      waitlistEnabled: Number(row.waitlist_enabled) === 1,
      priceCents: Number(row.price_cents || 0),
      registrationSchema: json(row.registration_schema_json, []),
      status: row.status,
      contentSafetyStatus: row.content_safety_status,
      version: Number(row.version),
    }
  }

  async function getEventPolicy(appId) {
    const row = await database.one(
      `SELECT value_json, version FROM mip_app_settings
       WHERE app_id = ? AND setting_key = 'EVENT_REGISTRATION_POLICY'`,
      [appId],
    )
    const value = json(row?.value_json, {})
    const cancellationHoursBeforeStart = Number(value.cancellationHoursBeforeStart)
    return {
      cancellationHoursBeforeStart: Number.isInteger(cancellationHoursBeforeStart)
        && cancellationHoursBeforeStart >= 0
        && cancellationHoursBeforeStart <= 720
        ? cancellationHoursBeforeStart
        : 24,
      version: row ? Number(row.version) : 0,
    }
  }

  async function saveEventPolicy(input) {
    return database.transaction(async (tx) => {
      await authorizeMutation(tx, input, { scopeType: 'PLATFORM', scopeId: null })
      const current = await tx.one(
        `SELECT version FROM mip_app_settings
         WHERE app_id = ? AND setting_key = 'EVENT_REGISTRATION_POLICY' FOR UPDATE`,
        [input.appId],
      )
      const currentVersion = current ? Number(current.version) : 0
      if (currentVersion !== input.expectedVersion) throw codeError('CONFLICT')
      const value = JSON.stringify({
        cancellationHoursBeforeStart: input.cancellationHoursBeforeStart,
      })
      if (current) {
        const updated = await tx.query(
          `UPDATE mip_app_settings
           SET value_json = ?, updated_by_user_id = ?, version = version + 1
           WHERE app_id = ? AND setting_key = 'EVENT_REGISTRATION_POLICY' AND version = ?`,
          [value, input.actorUserId, input.appId, input.expectedVersion],
        )
        if (Number(updated.affectedRows) !== 1) throw codeError('CONFLICT')
      }
      else {
        await tx.query(
          `INSERT INTO mip_app_settings (
             app_id, setting_key, value_json, version, updated_by_user_id
           ) VALUES (?, 'EVENT_REGISTRATION_POLICY', ?, 1, ?)`,
          [input.appId, value, input.actorUserId],
        )
      }
      await writeAudit(tx, input.audit)
      return {
        cancellationHoursBeforeStart: input.cancellationHoursBeforeStart,
        version: currentVersion + 1,
      }
    })
  }

  async function listEventAlbumPhotos(appId, eventId, status, pageLimit) {
    const rows = await database.query(
      `SELECT photo.id, photo.caption, photo.status, photo.moderation_reason, photo.version,
        photo.created_at, photo.reviewed_at, photo.published_at,
        asset.status AS asset_status, asset.cloud_file_id,
        profile.nickname, profile.visibility_json, avatar.cloud_file_id AS avatar_file_id
       FROM mip_event_album_photos photo
       LEFT JOIN mip_media_assets asset
         ON asset.app_id = photo.app_id AND asset.id = photo.media_asset_id
         AND asset.purpose = 'EVENT_ALBUM'
       LEFT JOIN mip_profiles profile
         ON profile.app_id = photo.app_id AND profile.user_id = photo.uploader_user_id
       LEFT JOIN mip_media_assets avatar
         ON avatar.app_id = profile.app_id AND avatar.id = profile.avatar_asset_id
         AND avatar.status = 'READY'
       WHERE photo.app_id = ? AND photo.event_id = ? AND photo.status = ?
       ORDER BY photo.created_at DESC, photo.id DESC LIMIT ?`,
      [appId, eventId, status, pageLimit],
    )
    return rows.map(eventAlbumPhotoDto)
  }

  async function reviewEventAlbumPhoto(input) {
    return database.transaction(async (tx) => {
      const authorization = await lockMutation(tx, input)
      const event = await tx.one(
        `SELECT id, branch_id FROM mip_events
         WHERE app_id = ? AND id = ? FOR UPDATE`,
        [input.appId, input.eventId],
      )
      if (!event) throw codeError('NOT_FOUND')
      const currentScope = eventScopeFromRow(event, input.eventId)
      assertScope(authorization, currentScope)
      assertAuthorizedScope(currentScope, input.authorizedScope)
      const photo = await tx.one(
        `SELECT photo.id, photo.event_id, photo.status, photo.version,
          asset.status AS asset_status, asset.purpose AS asset_purpose,
          asset.object_key AS asset_object_key, asset.cloud_file_id AS asset_cloud_file_id,
          asset.content_sha256 AS asset_content_sha256,
          asset.content_type AS asset_content_type, asset.content_bytes AS asset_content_bytes,
          asset.width_px AS asset_width_px, asset.height_px AS asset_height_px
         FROM mip_event_album_photos photo
         LEFT JOIN mip_media_assets asset
           ON asset.app_id = photo.app_id AND asset.id = photo.media_asset_id
         WHERE photo.app_id = ? AND photo.event_id = ? AND photo.id = ? FOR UPDATE`,
        [input.appId, input.eventId, input.photoId],
      )
      if (!photo) throw codeError('NOT_FOUND')
      if (Number(photo.version) !== input.expectedVersion) throw codeError('CONFLICT')
      if (photo.status !== 'PENDING') throw codeError('INVALID_STATE')
      if (input.status === 'PUBLISHED' && !eventAlbumAssetReady(photo)) {
        throw codeError('EVENT_ALBUM_MEDIA_INVALID')
      }
      const result = await tx.query(
        `UPDATE mip_event_album_photos SET status = ?, moderation_reason = ?,
          reviewed_by_user_id = ?, reviewed_at = UTC_TIMESTAMP(3),
          published_at = CASE WHEN ? = 'PUBLISHED' THEN UTC_TIMESTAMP(3) ELSE NULL END,
          version = version + 1
         WHERE app_id = ? AND event_id = ? AND id = ? AND status = 'PENDING' AND version = ?`,
        [input.status, input.reason, input.actorUserId, input.status,
          input.appId, input.eventId, input.photoId, input.expectedVersion],
      )
      if (Number(result?.affectedRows) !== 1) throw codeError('CONFLICT')
      await writeAudit(tx, input.audit)
      const row = await tx.one(
        `SELECT photo.id, photo.caption, photo.status, photo.moderation_reason, photo.version,
          photo.created_at, photo.reviewed_at, photo.published_at,
          asset.status AS asset_status, asset.cloud_file_id,
          profile.nickname, profile.visibility_json, avatar.cloud_file_id AS avatar_file_id
         FROM mip_event_album_photos photo
         LEFT JOIN mip_media_assets asset
           ON asset.app_id = photo.app_id AND asset.id = photo.media_asset_id
           AND asset.purpose = 'EVENT_ALBUM'
         LEFT JOIN mip_profiles profile
           ON profile.app_id = photo.app_id AND profile.user_id = photo.uploader_user_id
         LEFT JOIN mip_media_assets avatar
           ON avatar.app_id = profile.app_id AND avatar.id = profile.avatar_asset_id
           AND avatar.status = 'READY'
         WHERE photo.app_id = ? AND photo.event_id = ? AND photo.id = ?`,
        [input.appId, input.eventId, input.photoId],
      )
      return eventAlbumPhotoDto(row)
    })
  }

  async function saveEvent(input) {
    return database.transaction(async (tx) => {
      const authorization = await lockMutation(tx, input)
      const eventId = input.eventId || createId()
      let status = 'DRAFT'
      let nextVersion = 1
      if (input.eventId) {
        const current = await tx.one(
          `SELECT id, scope_type, branch_id, status, version, cover_asset_id
           FROM mip_events WHERE app_id = ? AND id = ? FOR UPDATE`,
          [input.appId, eventId],
        )
        if (!current) throw codeError('NOT_FOUND')
        const currentScope = eventScopeFromRow(current, eventId)
        assertScope(authorization, currentScope)
        assertAuthorizedScope(currentScope, input.authorizedScope)
        if (authorization.effectiveGrant.scopeType !== 'PLATFORM') {
          const currentOwnedScope = {
            scopeType: current.scope_type,
            scopeId: current.scope_type === 'BRANCH' ? current.branch_id : null,
          }
          if (!sameScope(currentOwnedScope, draftResourceScope(input.draft))) throw codeError('FORBIDDEN')
        }
        if (Number(current.version) !== input.expectedVersion) throw codeError('CONFLICT')
        if (!['DRAFT', 'UNPUBLISHED'].includes(current.status)) throw codeError('INVALID_STATE')
        await assertEventCover(tx, input, current.cover_asset_id || null)
        await assertEventContentMedia(tx, input, eventId)
        status = current.status
        nextVersion = Number(current.version) + 1
        const result = await tx.query(
          `UPDATE mip_events SET scope_type = ?, branch_id = ?,
            title = ?, summary = ?, description = ?, notices = ?,
            cover_asset_id = ?,
            starts_at = ?, ends_at = ?, registration_deadline = ?, cancellation_deadline = ?,
            venue_name = ?, address = ?, city_name = ?, latitude = ?, longitude = ?, capacity = ?,
            event_type_key = ?, event_mode = ?, access_type = ?, registration_policy = ?,
            album_enabled = ?, album_submission_policy = ?,
            online_url = ?, waitlist_enabled = ?, price_cents = ?,
            registration_schema_json = ?, form_version = form_version + 1,
            content_safety_status = ?, version = version + 1
           WHERE app_id = ? AND id = ? AND version = ? AND status IN ('DRAFT', 'UNPUBLISHED')`,
          [input.draft.scopeType, input.draft.branchId || null,
            input.draft.title, input.draft.summary, input.draft.description, input.draft.notices || null,
            input.draft.coverAssetId,
            input.draft.startsAt, input.draft.endsAt, input.draft.registrationDeadline || null,
            input.draft.cancellationDeadline || null, input.draft.venueName || null,
            input.draft.address || null, input.draft.cityName || null,
            input.draft.latitude, input.draft.longitude, input.draft.capacity,
            input.draft.eventTypeKey, input.draft.eventMode, input.draft.accessType,
            input.draft.registrationPolicy, input.draft.albumEnabled ? 1 : 0,
            input.draft.albumSubmissionPolicy, input.draft.onlineUrl || null,
            input.draft.waitlistEnabled ? 1 : 0, input.draft.priceCents,
            JSON.stringify(input.draft.registrationSchema), input.contentSafetyStatus,
            input.appId, eventId, input.expectedVersion],
        )
        if (Number(result.affectedRows) !== 1) throw codeError('CONFLICT')
      }
      else {
        assertScope(authorization, draftResourceScope(input.draft))
        await assertEventCover(tx, input, null)
        await assertEventContentMedia(tx, input, null)
        await tx.query(
          `INSERT INTO mip_events (
            id, app_id, scope_type, branch_id, organizer_user_id, title, summary,
            description, notices, cover_asset_id, event_type_key, event_mode, access_type,
            registration_policy, album_enabled, album_submission_policy,
            status, content_safety_status, starts_at, ends_at,
            registration_deadline, cancellation_deadline, venue_name, address, city_name,
            latitude, longitude, online_url, capacity, waitlist_enabled, price_cents, currency, registration_schema_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'CNY', ?)`,
          [eventId, input.appId, input.draft.scopeType, input.draft.branchId || null,
            input.actorUserId, input.draft.title, input.draft.summary, input.draft.description,
            input.draft.notices || null, input.draft.coverAssetId, input.draft.eventTypeKey, input.draft.eventMode,
            input.draft.accessType, input.draft.registrationPolicy,
            input.draft.albumEnabled ? 1 : 0, input.draft.albumSubmissionPolicy,
            input.contentSafetyStatus,
            input.draft.startsAt,
            input.draft.endsAt, input.draft.registrationDeadline || null,
            input.draft.cancellationDeadline || null, input.draft.venueName || null,
            input.draft.address || null, input.draft.cityName || null,
            input.draft.latitude, input.draft.longitude, input.draft.onlineUrl || null,
            input.draft.capacity, input.draft.waitlistEnabled ? 1 : 0, input.draft.priceCents,
            JSON.stringify(input.draft.registrationSchema || [])],
        )
      }
      await replaceEventContentMedia(tx, input, eventId)
      await writeEventChange(tx, {
        id: createId(),
        appId: input.appId,
        eventId,
        sourceVersion: nextVersion,
        changeType: input.eventId ? 'CONTENT' : 'CREATED',
        summary: input.eventId ? '活动信息已更新' : '活动已创建',
        changedFields: Object.keys(input.draft),
        actorUserId: input.actorUserId,
      })
      await writeAudit(tx, input.audit(eventId))
      await writeOutbox(tx, {
        id: createId(),
        appId: input.appId,
        aggregateType: 'EVENT',
        aggregateId: eventId,
        eventType: input.eventId ? 'event.updated' : 'event.created',
        sourceVersion: nextVersion,
        payload: { eventId, status },
      })
      return { id: eventId, version: nextVersion, status }
    })
  }

  async function cloneEvent(input) {
    return database.transaction(async (tx) => {
      const authorization = await lockMutation(tx, input)
      if (authorization.effectiveGrant.scopeType === 'EVENT') throw codeError('FORBIDDEN')
      const source = await tx.one(
        `SELECT e.id, e.scope_type, e.branch_id, e.title, e.summary, e.description, e.notices,
          e.cover_asset_id, cover.status AS cover_status, e.event_type_key, e.event_mode,
          e.access_type, e.registration_policy, e.album_enabled, e.album_submission_policy,
          e.starts_at, e.ends_at,
          e.registration_opens_at, e.registration_deadline, e.cancellation_deadline,
          e.venue_name, e.address, e.city_name, e.latitude, e.longitude, e.online_url,
          e.capacity, e.waitlist_enabled, e.price_cents, e.currency,
          e.registration_schema_json, e.version, branch.status AS branch_status
         FROM mip_events e
         LEFT JOIN mip_media_assets cover
           ON cover.app_id = e.app_id AND cover.id = e.cover_asset_id
         LEFT JOIN mip_city_branches branch
           ON branch.app_id = e.app_id AND branch.id = e.branch_id
         WHERE e.app_id = ? AND e.id = ? FOR UPDATE`,
        [input.appId, input.sourceEventId],
      )
      if (!source) throw codeError('NOT_FOUND')
      const currentScope = eventScopeFromRow(source, input.sourceEventId)
      assertScope(authorization, currentScope)
      assertAuthorizedScope(currentScope, input.authorizedScope)

      const operation = 'admin.events.clone'
      const requestHash = createHash('sha256')
        .update(`${input.sourceEventId}\0${input.expectedVersion}`)
        .digest('hex')
      const requestId = createId()
      try {
        await tx.query(
          `INSERT INTO mip_idempotency_keys (
            id, app_id, actor_user_id, operation, idempotency_key,
            request_hash, status, expires_at
          ) VALUES (?, ?, ?, ?, ?, ?, 'RUNNING', DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 24 HOUR))`,
          [requestId, input.appId, input.actorUserId, operation, input.idempotencyKey, requestHash],
        )
      }
      catch (error) {
        if (!duplicateConstraint(error)) throw error
        const stored = await tx.one(
          `SELECT request_hash, status, response_json
           FROM mip_idempotency_keys
           WHERE app_id = ? AND actor_user_id = ? AND operation = ? AND idempotency_key = ?
           FOR UPDATE`,
          [input.appId, input.actorUserId, operation, input.idempotencyKey],
        )
        if (!stored || stored.request_hash !== requestHash || stored.status !== 'COMPLETED') {
          throw codeError('CONFLICT')
        }
        const replay = json(stored.response_json, null)
        if (!replay?.id || replay.status !== 'DRAFT' || Number(replay.version) !== 1) {
          throw codeError('CONFLICT')
        }
        return { ...replay, idempotent: true }
      }

      if (Number(source.version) !== input.expectedVersion) throw codeError('CONFLICT')
      if (source.scope_type === 'BRANCH' && source.branch_status !== 'ACTIVE') {
        throw codeError('INVALID_STATE')
      }

      const dates = shiftedCloneDates(source, now())
      const eventId = createId()
      await tx.query(
        `INSERT INTO mip_events (
          id, app_id, scope_type, branch_id, organizer_user_id, title, summary,
          description, notices, cover_asset_id, event_type_key, event_mode, access_type,
          registration_policy, album_enabled, album_submission_policy,
          status, content_safety_status, starts_at, ends_at,
          registration_opens_at, registration_deadline, cancellation_deadline,
          venue_name, address, city_name, latitude, longitude, online_url, capacity,
          waitlist_enabled, price_cents, currency, registration_schema_json,
          form_version, version
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1)`,
        [eventId, input.appId, source.scope_type, source.branch_id || null, input.actorUserId,
          input.title, source.summary, source.description, source.notices || null,
          source.cover_status === 'READY' ? source.cover_asset_id : null,
          source.event_type_key, source.event_mode, source.access_type, source.registration_policy,
          Number(source.album_enabled) === 1 ? 1 : 0, source.album_submission_policy,
          input.contentSafetyStatus, dates.startsAt, dates.endsAt, dates.registrationOpensAt,
          dates.registrationDeadline, dates.cancellationDeadline, source.venue_name || null,
          source.address || null, source.city_name || null, source.latitude ?? null,
          source.longitude ?? null, source.online_url || null, source.capacity,
          Number(source.waitlist_enabled) === 1 ? 1 : 0, Number(source.price_cents || 0),
          source.currency || 'CNY', JSON.stringify(json(source.registration_schema_json, []))],
      )
      await tx.query(
        `INSERT INTO mip_event_content_media (
          app_id, event_id, media_asset_id, sort_order, caption
        )
        SELECT media.app_id, ?, media.media_asset_id, media.sort_order, media.caption
        FROM mip_event_content_media media
        INNER JOIN mip_media_assets asset
          ON asset.app_id = media.app_id AND asset.id = media.media_asset_id
          AND asset.status = 'READY' AND asset.purpose = 'EVENT_CONTENT'
        WHERE media.app_id = ? AND media.event_id = ? AND media.status = 'ACTIVE'`,
        [eventId, input.appId, input.sourceEventId],
      )
      await writeEventChange(tx, {
        id: createId(),
        appId: input.appId,
        eventId,
        sourceVersion: 1,
        changeType: 'CREATED',
        summary: '活动已复制为草稿',
        changedFields: ['sourceEventId'],
        actorUserId: input.actorUserId,
      })
      await writeAudit(tx, input.audit(eventId))
      await writeOutbox(tx, {
        id: createId(),
        appId: input.appId,
        aggregateType: 'EVENT',
        aggregateId: eventId,
        eventType: 'event.created',
        sourceVersion: 1,
        payload: { eventId, status: 'DRAFT', clonedFromEventId: input.sourceEventId },
      })
      const response = {
        id: eventId,
        status: 'DRAFT',
        version: 1,
        startsAt: dates.startsAt.toISOString(),
        idempotent: false,
      }
      const completed = await tx.query(
        `UPDATE mip_idempotency_keys SET status = 'COMPLETED', response_json = ?
         WHERE app_id = ? AND actor_user_id = ? AND operation = ?
           AND idempotency_key = ? AND request_hash = ? AND status = 'RUNNING'`,
        [JSON.stringify(response), input.appId, input.actorUserId, operation,
          input.idempotencyKey, requestHash],
      )
      if (Number(completed.affectedRows) !== 1) throw codeError('CONFLICT')
      return response
    })
  }

  async function changeEventStatus(input) {
    return database.transaction(async (tx) => {
      const authorization = await lockMutation(tx, input)
      const event = await tx.one(
        `SELECT id, branch_id, status, content_safety_status, starts_at, version
         FROM mip_events WHERE app_id = ? AND id = ? FOR UPDATE`,
        [input.appId, input.eventId],
      )
      if (!event) throw codeError('NOT_FOUND')
      const currentScope = eventScopeFromRow(event, input.eventId)
      assertScope(authorization, currentScope)
      assertAuthorizedScope(currentScope, input.authorizedScope)
      if (Number(event.version) !== input.expectedVersion) throw codeError('CONFLICT')
      const allowedTransitions = {
        DRAFT: ['PUBLISHED', 'CANCELLED'],
        PUBLISHED: ['UNPUBLISHED', 'CANCELLED', 'ENDED'],
        UNPUBLISHED: ['PUBLISHED', 'CANCELLED'],
        CANCELLED: [],
        ENDED: [],
      }
      if (!allowedTransitions[event.status]?.includes(input.status)) throw codeError('INVALID_STATE')
      if (input.status === 'PUBLISHED' && event.content_safety_status !== 'PASSED') throw codeError('CONTENT_SAFETY_REQUIRED')
      const changedAt = now()
      if (input.status === 'PUBLISHED' && new Date(event.starts_at) <= changedAt) throw codeError('INVALID_STATE')
      const result = await tx.query(
        `UPDATE mip_events SET status = ?,
          published_at = CASE WHEN ? = 'PUBLISHED' THEN ? ELSE published_at END,
          unpublished_at = CASE WHEN ? = 'UNPUBLISHED' THEN ? ELSE unpublished_at END,
          cancelled_at = CASE WHEN ? = 'CANCELLED' THEN ? ELSE cancelled_at END,
          ended_at = CASE WHEN ? = 'ENDED' THEN ? ELSE ended_at END,
          version = version + 1
         WHERE app_id = ? AND id = ? AND version = ?`,
        [input.status, input.status, changedAt, input.status, changedAt,
          input.status, changedAt, input.status, changedAt,
          input.appId, input.eventId, input.expectedVersion],
      )
      if (Number(result.affectedRows) !== 1) throw codeError('CONFLICT')
      const cancellation = input.status === 'CANCELLED'
        ? await cancelEventRegistrations(tx, input, changedAt)
        : { affectedCount: 0, refundIds: [] }
      const nextVersion = input.expectedVersion + 1
      await writeEventChange(tx, {
        id: createId(),
        appId: input.appId,
        eventId: input.eventId,
        sourceVersion: nextVersion,
        changeType: 'STATUS',
        summary: `活动状态变更为 ${input.status}`,
        changedFields: ['status'],
        actorUserId: input.actorUserId,
      })
      await writeAudit(tx, input.audit)
      await writeOutbox(tx, {
        id: createId(),
        appId: input.appId,
        aggregateType: 'EVENT',
        aggregateId: input.eventId,
        eventType: input.status === 'PUBLISHED' ? 'event.published' : 'event.status_changed',
        sourceVersion: nextVersion,
        payload: { eventId: input.eventId, from: event.status, to: input.status },
      })
      return {
        id: input.eventId,
        status: input.status,
        version: nextVersion,
        affectedCount: cancellation.affectedCount,
        refundIds: cancellation.refundIds,
      }
    })
  }

  async function publishEventReminder(input) {
    return database.transaction(tx => operationsPublisher.publishEventReminder(tx, input))
  }

  async function cancelEventRegistrations(tx, input, cancelledAt) {
    const registrations = await tx.query(
      `SELECT r.id, r.user_id, r.status, r.version, r.order_id,
        o.status AS order_status, o.amount_cents, o.version AS order_version,
        COALESCE((SELECT SUM(ref.amount_cents) FROM mip_refunds ref
          WHERE ref.app_id = o.app_id AND ref.order_id = o.id
            AND ref.status IN ('PENDING', 'PROVIDER_CREATED', 'PROCESSING', 'SUCCEEDED')), 0) AS reserved_refund_cents,
        h.id AS seat_hold_id, h.status AS seat_hold_status,
        active_checkin.id AS active_checkin_id
       FROM mip_event_registrations r
       LEFT JOIN mip_orders o ON o.app_id = r.app_id AND o.id = r.order_id AND o.order_type = 'EVENT'
       LEFT JOIN mip_event_seat_holds h ON h.app_id = o.app_id AND h.order_id = o.id
       LEFT JOIN mip_event_checkins active_checkin
         ON active_checkin.app_id = r.app_id AND active_checkin.event_id = r.event_id
        AND active_checkin.registration_id = r.id AND active_checkin.user_id = r.user_id
        AND active_checkin.status = 'ACTIVE'
       WHERE r.app_id = ? AND r.event_id = ?
         AND r.status IN ('PENDING_REVIEW', 'WAITLISTED', 'PAYMENT_PENDING', 'REGISTERED', 'CANCELLATION_PENDING')
       FOR UPDATE`,
      [input.appId, input.eventId],
    )
    const refundIds = []
    for (const registration of registrations) {
      if (registration.active_checkin_id) throw codeError('INVALID_STATE')
      const remainingRefund = Math.max(
        0,
        Number(registration.amount_cents || 0) - Number(registration.reserved_refund_cents || 0),
      )
      const shouldCreateRefund = ['PAID', 'PARTIALLY_REFUNDED'].includes(registration.order_status)
        && remainingRefund > 0
      const refundPending = shouldCreateRefund || registration.order_status === 'REFUND_PENDING'
      const registrationStatus = refundPending ? 'CANCELLATION_PENDING' : 'CANCELLED'
      const registrationUpdated = await tx.query(
        `UPDATE mip_event_registrations SET status = ?, cancelled_at = ?,
          cancelled_by_type = 'EVENT', cancellation_reason = ?, version = version + 1
         WHERE app_id = ? AND id = ? AND version = ? AND status = ?`,
        [registrationStatus, cancelledAt, input.reason, input.appId,
          registration.id, registration.version, registration.status],
      )
      if (Number(registrationUpdated.affectedRows) !== 1) throw codeError('CONFLICT')
      let refundId = null
      if (shouldCreateRefund) {
        refundId = createId()
        refundIds.push(refundId)
        await tx.query(
          `INSERT INTO mip_refunds (
            id, app_id, order_id, requested_by_user_id, merchant_refund_no,
            idempotency_key, amount_cents, reason, status
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING')`,
          [refundId, input.appId, registration.order_id, registration.user_id,
            merchantRefundNumber(refundId), `event-cancel:${input.eventId}:${registration.id}`,
            remainingRefund, input.reason],
        )
        const orderUpdated = await tx.query(
          `UPDATE mip_orders SET status = 'REFUND_PENDING', version = version + 1
           WHERE app_id = ? AND id = ? AND version = ?
             AND status IN ('PAID', 'PARTIALLY_REFUNDED')`,
          [input.appId, registration.order_id, registration.order_version],
        )
        if (Number(orderUpdated.affectedRows) !== 1) throw codeError('CONFLICT')
        await writeAudit(tx, {
          ...input.audit,
          action: 'admin.refunds.submit',
          resourceType: 'REFUND',
          resourceId: refundId,
          metadata: {
            orderId: registration.order_id,
            eventId: input.eventId,
            amountCents: remainingRefund,
            source: 'EVENT_CANCELLATION',
          },
        })
      }
      else if (registration.order_id && ['CREATED', 'PAYMENT_CREATED'].includes(registration.order_status)) {
        const orderUpdated = await tx.query(
          `UPDATE mip_orders SET status = 'CLOSED', closed_at = ?, version = version + 1
           WHERE app_id = ? AND id = ? AND version = ?
             AND status IN ('CREATED', 'PAYMENT_CREATED')`,
          [cancelledAt, input.appId, registration.order_id, registration.order_version],
        )
        if (Number(orderUpdated.affectedRows) !== 1) throw codeError('CONFLICT')
      }
      if (registration.seat_hold_id && registration.seat_hold_status === 'ACTIVE' && !refundPending) {
        const holdUpdated = await tx.query(
          `UPDATE mip_event_seat_holds SET status = 'CANCELLED', cancelled_at = ?
           WHERE app_id = ? AND id = ? AND status = 'ACTIVE'`,
          [cancelledAt, input.appId, registration.seat_hold_id],
        )
        if (Number(holdUpdated.affectedRows) !== 1) throw codeError('CONFLICT')
      }
      await writeOutbox(tx, {
        id: createId(),
        appId: input.appId,
        aggregateType: 'EVENT_REGISTRATION',
        aggregateId: registration.id,
        eventType: refundPending ? 'event.registration_refund_requested' : 'event.registration_cancelled',
        sourceVersion: Number(registration.version) + 1,
        payload: {
          eventId: input.eventId,
          userId: registration.user_id,
          status: registrationStatus,
          refundId,
          eventCancelled: true,
        },
      })
    }
    return { affectedCount: registrations.length, refundIds }
  }

  async function listRoster(appId, eventId, filters, pageLimit, cursor = null) {
    const clauses = ['r.app_id = ?', 'r.event_id = ?']
    const params = [appId, eventId]
    if (filters.status) {
      clauses.push('r.status = ?')
      params.push(filters.status)
    }
    if (filters.query) {
      clauses.push('p.nickname LIKE ? ESCAPE \'\\\\\'')
      params.push(`%${escapeLike(filters.query)}%`)
    }
    if (filters.createdFrom) { clauses.push('r.created_at >= ?'); params.push(filters.createdFrom) }
    if (filters.createdTo) { clauses.push('r.created_at <= ?'); params.push(filters.createdTo) }
    const cursorWhere = cursorPredicateFor('r.created_at', cursor, 'submittedAt', 'r.id')
    const rows = await database.query(
      `SELECT r.id, r.user_id, r.status, r.answers_json, r.created_at, r.registered_at, r.version,
        p.nickname, b.city_name, pp.phone_ciphertext, pp.phone_verified_at,
        c.checked_in_at, e.registration_schema_json
       FROM mip_event_registrations r
       INNER JOIN mip_events e ON e.app_id = r.app_id AND e.id = r.event_id
       LEFT JOIN mip_profiles p ON p.app_id = r.app_id AND p.user_id = r.user_id
       LEFT JOIN mip_users u ON u.app_id = r.app_id AND u.id = r.user_id
       LEFT JOIN mip_city_branches b ON b.app_id = u.app_id AND b.id = u.primary_branch_id
       LEFT JOIN mip_private_profiles pp ON pp.app_id = r.app_id AND pp.user_id = r.user_id
       LEFT JOIN mip_event_checkins c ON c.app_id = r.app_id AND c.registration_id = r.id AND c.status = 'ACTIVE'
       WHERE ${clauses.join(' AND ')}${cursorWhere.sql} ORDER BY r.created_at DESC, r.id DESC LIMIT ?`,
      [...params, ...cursorWhere.params, pageLimit + 1],
    )
    const items = rows.map(row => ({
      id: row.id,
      userId: row.user_id,
      nickname: row.nickname || '未填写昵称',
      cityName: row.city_name || '',
      status: row.status,
      answers: json(row.answers_json, {}),
      answerItems: registrationAnswerItems(row.registration_schema_json, row.answers_json),
      phoneBound: Boolean(row.phone_verified_at),
      phoneCiphertext: row.phone_ciphertext || null,
      submittedAt: iso(row.created_at),
      registeredAt: iso(row.registered_at),
      checkedInAt: iso(row.checked_in_at),
      version: Number(row.version),
    }))
    return pageRows(items, pageLimit, row => ({ submittedAt: row.submittedAt, id: row.id }))
  }

  async function reviewRegistration(input) {
    return database.transaction(async (tx) => {
      const authorization = await lockMutation(tx, input)
      const event = await tx.one(
        `SELECT id, branch_id, access_type, registration_policy, status, capacity, waitlist_enabled
         FROM mip_events WHERE app_id = ? AND id = ? FOR UPDATE`,
        [input.appId, input.eventId],
      )
      if (!event) throw codeError('NOT_FOUND')
      const currentScope = eventScopeFromRow(event, input.eventId)
      assertScope(authorization, currentScope)
      assertAuthorizedScope(currentScope, input.authorizedScope)
      if (event.status !== 'PUBLISHED'
        || event.registration_policy !== 'APPROVAL'
        || !['FREE', 'MEMBER_INCLUDED'].includes(event.access_type)) {
        throw codeError('INVALID_STATE')
      }
      const registration = await tx.one(
        `SELECT id, user_id, order_id, status, version
         FROM mip_event_registrations
         WHERE app_id = ? AND event_id = ? AND id = ? FOR UPDATE`,
        [input.appId, input.eventId, input.registrationId],
      )
      if (!registration) throw codeError('NOT_FOUND')
      if (Number(registration.version) !== input.expectedVersion) throw codeError('CONFLICT')
      if (registration.status !== 'PENDING_REVIEW' || registration.order_id) throw codeError('INVALID_STATE')

      let nextStatus = 'REJECTED'
      if (input.decision === 'APPROVE') {
        const reviewedAt = now()
        const capacity = await tx.one(
          `SELECT COUNT(*) AS total FROM mip_event_registrations
           WHERE app_id = ? AND event_id = ?
             AND status IN ('REGISTERED', 'CANCELLATION_PENDING', 'ATTENDED')`,
          [input.appId, input.eventId],
        )
        const holds = await tx.one(
          `SELECT COUNT(*) AS total FROM mip_event_seat_holds
           WHERE app_id = ? AND event_id = ? AND status = 'ACTIVE' AND expires_at > ?`,
          [input.appId, input.eventId, reviewedAt],
        )
        const capacityLimit = event.capacity === null ? null : Number(event.capacity)
        const full = capacityLimit !== null
          && Number(capacity?.total || 0) + Number(holds?.total || 0) >= capacityLimit
        if (full && Number(event.waitlist_enabled) !== 1) throw codeError('INVALID_STATE')
        nextStatus = full ? 'WAITLISTED' : 'REGISTERED'
        const updated = await tx.query(
          `UPDATE mip_event_registrations SET status = ?, ticket_hash = ?,
            waitlisted_at = ?, registered_at = ?, version = version + 1
           WHERE app_id = ? AND id = ? AND version = ? AND status = 'PENDING_REVIEW'`,
          [
            nextStatus,
            nextStatus === 'REGISTERED' ? createHash('sha256').update(bytes(24)).digest('hex') : null,
            nextStatus === 'WAITLISTED' ? reviewedAt : null,
            nextStatus === 'REGISTERED' ? reviewedAt : null,
            input.appId,
            input.registrationId,
            input.expectedVersion,
          ],
        )
        if (Number(updated.affectedRows) !== 1) throw codeError('CONFLICT')
      }
      else {
        const updated = await tx.query(
          `UPDATE mip_event_registrations SET status = 'REJECTED', ticket_hash = NULL,
            waitlisted_at = NULL, registered_at = NULL, version = version + 1
           WHERE app_id = ? AND id = ? AND version = ? AND status = 'PENDING_REVIEW'`,
          [input.appId, input.registrationId, input.expectedVersion],
        )
        if (Number(updated.affectedRows) !== 1) throw codeError('CONFLICT')
      }
      const nextVersion = input.expectedVersion + 1
      await writeAudit(tx, input.audit(nextStatus))
      await writeOutbox(tx, {
        id: createId(),
        appId: input.appId,
        aggregateType: 'EVENT_REGISTRATION',
        aggregateId: input.registrationId,
        eventType: nextStatus === 'REGISTERED'
          ? 'event.registration_confirmed'
          : nextStatus === 'WAITLISTED'
            ? 'event.registration_waitlisted'
            : 'event.registration_rejected',
        sourceVersion: nextVersion,
        payload: {
          eventId: input.eventId,
          userId: registration.user_id,
          status: nextStatus,
          reviewedByUserId: input.actorUserId,
        },
      })
      return {
        id: input.registrationId,
        status: nextStatus,
        version: nextVersion,
      }
    })
  }

  async function checkIn(input) {
    return database.transaction(async (tx) => {
      const authorization = await lockMutation(tx, input)
      const event = await tx.one(
        `SELECT id, branch_id FROM mip_events
         WHERE app_id = ? AND id = ? FOR UPDATE`,
        [input.appId, input.eventId],
      )
      if (!event) throw codeError('NOT_FOUND')
      const currentScope = eventScopeFromRow(event, input.eventId)
      assertScope(authorization, currentScope)
      assertAuthorizedScope(currentScope, input.authorizedScope)
      const registration = await tx.one(
        `SELECT id, user_id, status, version FROM mip_event_registrations
         WHERE app_id = ? AND event_id = ? AND id = ? FOR UPDATE`,
        [input.appId, input.eventId, input.registrationId],
      )
      if (!registration) throw codeError('NOT_FOUND')
      if (Number(registration.version) !== input.expectedVersion) throw codeError('CONFLICT')
      if (registration.status === 'ATTENDED') {
        return { id: input.registrationId, status: 'ATTENDED', version: input.expectedVersion, idempotent: true }
      }
      if (registration.status !== 'REGISTERED') throw codeError('INVALID_STATE')
      const existingCheckin = await tx.one(
        `SELECT id, version FROM mip_event_checkins
         WHERE app_id = ? AND event_id = ? AND registration_id = ? FOR UPDATE`,
        [input.appId, input.eventId, input.registrationId],
      )
      const checkinId = existingCheckin?.id || createId()
      const checkinVersion = existingCheckin ? Number(existingCheckin.version) + 1 : 1
      const registrationVersion = input.expectedVersion + 1
      const transitionId = createId()
      const checkedInAt = now()
      if (existingCheckin) {
        const activated = await tx.query(
          `UPDATE mip_event_checkins SET source = 'ADMIN', credential_id = NULL,
             status = 'ACTIVE', checked_in_at = ?, revoked_at = NULL,
             revoked_by_user_id = NULL, revoke_reason = NULL, version = version + 1
           WHERE app_id = ? AND id = ? AND version = ? AND status = 'REVOKED'`,
          [checkedInAt, input.appId, checkinId, existingCheckin.version],
        )
        if (Number(activated.affectedRows) !== 1) throw codeError('CONFLICT')
      }
      else {
        await tx.query(
          `INSERT INTO mip_event_checkins (
            id, app_id, event_id, registration_id, user_id, source, status, checked_in_at
          ) VALUES (?, ?, ?, ?, ?, 'ADMIN', 'ACTIVE', ?)`,
          [checkinId, input.appId, input.eventId, input.registrationId, registration.user_id, checkedInAt],
        )
      }
      const updated = await tx.query(
        `UPDATE mip_event_registrations SET status = 'ATTENDED', version = version + 1
         WHERE app_id = ? AND id = ? AND version = ? AND status = 'REGISTERED'`,
        [input.appId, input.registrationId, input.expectedVersion],
      )
      if (Number(updated.affectedRows) !== 1) throw codeError('CONFLICT')
      await writeCheckInTransition(tx, {
        id: transitionId,
        appId: input.appId,
        checkinId,
        registrationId: input.registrationId,
        eventId: input.eventId,
        userId: registration.user_id,
        transitionType: 'CHECKED_IN',
        checkinVersion,
        registrationVersion,
        actorUserId: input.actorUserId,
        source: 'ADMIN',
        occurredAt: checkedInAt,
      })
      await writeAudit(tx, input.audit)
      await writeOutbox(tx, {
        id: transitionId,
        appId: input.appId,
        aggregateType: 'EVENT_CHECKIN_TRANSITION',
        aggregateId: transitionId,
        eventType: 'event.checked_in',
        sourceVersion: registrationVersion,
        payload: {
          eventId: input.eventId,
          registrationId: input.registrationId,
          userId: registration.user_id,
          checkinId,
        },
      })
      return { id: input.registrationId, status: 'ATTENDED', version: registrationVersion, idempotent: false }
    })
  }

  async function undoCheckIn(input) {
    return database.transaction(async (tx) => {
      const authorization = await lockMutation(tx, input)
      const event = await tx.one(
        `SELECT id, branch_id FROM mip_events
         WHERE app_id = ? AND id = ? FOR UPDATE`,
        [input.appId, input.eventId],
      )
      if (!event) throw codeError('NOT_FOUND')
      const currentScope = eventScopeFromRow(event, input.eventId)
      assertScope(authorization, currentScope)
      assertAuthorizedScope(currentScope, input.authorizedScope)
      const registration = await tx.one(
        `SELECT id, user_id, status, version FROM mip_event_registrations
         WHERE app_id = ? AND event_id = ? AND id = ? FOR UPDATE`,
        [input.appId, input.eventId, input.registrationId],
      )
      if (!registration) throw codeError('NOT_FOUND')
      if (Number(registration.version) !== input.expectedVersion) throw codeError('CONFLICT')
      if (registration.status !== 'ATTENDED') throw codeError('INVALID_STATE')
      const checkin = await tx.one(
        `SELECT id, version FROM mip_event_checkins
         WHERE app_id = ? AND event_id = ? AND registration_id = ? AND status = 'ACTIVE' FOR UPDATE`,
        [input.appId, input.eventId, input.registrationId],
      )
      if (!checkin) throw codeError('CONFLICT')
      const recordedTransition = await tx.one(
        `SELECT id FROM mip_event_checkin_transitions
         WHERE app_id = ? AND checkin_id = ? AND transition_type = 'CHECKED_IN'
           AND checkin_version = ?`,
        [input.appId, checkin.id, checkin.version],
      )
      if (!recordedTransition) throw codeError('CONFLICT')
      const revokedAt = now()
      const transitionId = createId()
      const checkinVersion = Number(checkin.version) + 1
      const registrationVersion = input.expectedVersion + 1
      const revoked = await tx.query(
        `UPDATE mip_event_checkins SET status = 'REVOKED', revoked_at = ?,
           revoked_by_user_id = ?, revoke_reason = ?, version = version + 1
         WHERE app_id = ? AND id = ? AND version = ? AND status = 'ACTIVE'`,
        [revokedAt, input.actorUserId, input.reason, input.appId, checkin.id, checkin.version],
      )
      if (Number(revoked.affectedRows) !== 1) throw codeError('CONFLICT')
      const restored = await tx.query(
        `UPDATE mip_event_registrations SET status = 'REGISTERED', version = version + 1
         WHERE app_id = ? AND id = ? AND version = ? AND status = 'ATTENDED'`,
        [input.appId, input.registrationId, input.expectedVersion],
      )
      if (Number(restored.affectedRows) !== 1) throw codeError('CONFLICT')
      await writeCheckInTransition(tx, {
        id: transitionId,
        appId: input.appId,
        checkinId: checkin.id,
        registrationId: input.registrationId,
        eventId: input.eventId,
        userId: registration.user_id,
        transitionType: 'REVOKED',
        checkinVersion,
        registrationVersion,
        reversalOfTransitionId: recordedTransition.id,
        actorUserId: input.actorUserId,
        source: 'ADMIN',
        revokeReason: input.reason,
        occurredAt: revokedAt,
      })
      await writeAudit(tx, input.audit)
      await writeOutbox(tx, {
        id: transitionId,
        appId: input.appId,
        aggregateType: 'EVENT_CHECKIN_TRANSITION',
        aggregateId: transitionId,
        eventType: 'event.checkin_revoked',
        sourceVersion: registrationVersion,
        payload: {
          eventId: input.eventId,
          registrationId: input.registrationId,
          userId: registration.user_id,
          checkinId: checkin.id,
          reversalOfTransitionId: recordedTransition.id,
        },
      })
      return {
        id: input.registrationId,
        status: 'REGISTERED',
        version: registrationVersion,
      }
    })
  }

  return {
    changeEventStatus,
    checkIn,
    cloneEvent,
    getEvent,
    getEventPolicy,
    getEventScope,
    listEventAlbumPhotos,
    listEvents,
    listRoster,
    publishEventReminder,
    reviewEventAlbumPhoto,
    reviewRegistration,
    saveEvent,
    saveEventPolicy,
    undoCheckIn,
  }
}

module.exports = { createAdminEventRepository }
