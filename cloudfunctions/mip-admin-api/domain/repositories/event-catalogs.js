'use strict'

const { randomUUID } = require('node:crypto')
const { encodeCursor } = require('../pagination')

const PLATFORM_SCOPE = Object.freeze({ scopeType: 'PLATFORM', scopeId: null })
const TAG_ASSIGNMENT_EDITABLE_EVENT_STATUSES = Object.freeze([
  'DRAFT',
  'PUBLISHED',
  'UNPUBLISHED',
])
const TAG_ASSIGNMENT_EDITABLE_EVENT_STATUS_SQL = TAG_ASSIGNMENT_EDITABLE_EVENT_STATUSES
  .map(() => '?')
  .join(', ')

function createEventCatalogRepository(database, dependencies) {
  const createId = dependencies.createId || randomUUID
  const assertScope = dependencies.assertMutationScope
  const lockMutation = dependencies.lockMutationAuthorization
  const writeAudit = dependencies.writeAudit
  const { codeError, escapeLike, iso } = dependencies.repositorySupport

  async function listEventCatalogs(appId, kind, filters, pageLimit) {
    const clauses = []
    const params = [appId]
    if (filters.status) {
      clauses.push('catalog.status = ?')
      params.push(filters.status)
    }
    else {
      clauses.push("catalog.status <> 'ARCHIVED'")
    }
    if (filters.query) {
      const query = `%${escapeLike(filters.query)}%`
      const keyColumn = kind === 'TYPE' ? 'catalog.type_key' : 'catalog.tag_key'
      clauses.push(`(${keyColumn} LIKE ? OR catalog.name LIKE ? OR catalog.description LIKE ?)`)
      params.push(query, query, query)
    }
    addCursor(clauses, params, 'catalog.updated_at', 'catalog.id', filters.cursor)

    const rows = kind === 'TYPE'
      ? await database.query(
          `SELECT catalog.id, catalog.type_key AS catalog_key, catalog.name,
                  catalog.description, catalog.sort_order, catalog.status,
                  catalog.version, catalog.archived_at, catalog.created_at, catalog.updated_at,
                  COUNT(event.id) AS usage_count
           FROM mip_event_types catalog
           LEFT JOIN mip_events event
             ON event.app_id = catalog.app_id AND event.event_type_key = catalog.type_key
           WHERE catalog.app_id = ? AND ${clauses.join(' AND ')}
           GROUP BY catalog.app_id, catalog.id
           ORDER BY catalog.updated_at DESC, catalog.id DESC LIMIT ?`,
          [...params, pageLimit + 1],
        )
      : await database.query(
          `SELECT catalog.id, catalog.tag_key AS catalog_key, catalog.name,
                  catalog.description, catalog.sort_order, catalog.status,
                  catalog.version, catalog.archived_at, catalog.created_at, catalog.updated_at,
                  COUNT(CASE WHEN assignment.status = 'ACTIVE' THEN 1 END) AS usage_count
           FROM mip_event_tags catalog
           LEFT JOIN mip_event_tag_assignments assignment
             ON assignment.app_id = catalog.app_id AND assignment.tag_id = catalog.id
           WHERE catalog.app_id = ? AND ${clauses.join(' AND ')}
           GROUP BY catalog.app_id, catalog.id
           ORDER BY catalog.updated_at DESC, catalog.id DESC LIMIT ?`,
          [...params, pageLimit + 1],
        )
    return page(rows.map(row => catalogRecord(row, kind)), filters.cursorContext, pageLimit)
  }

  async function getEventCatalog(appId, kind, catalogId, adapter = database) {
    const row = kind === 'TYPE'
      ? await adapter.one(
          `SELECT catalog.id, catalog.type_key AS catalog_key, catalog.name,
                  catalog.description, catalog.sort_order, catalog.status,
                  catalog.version, catalog.archived_at, catalog.created_at, catalog.updated_at,
                  (SELECT COUNT(*) FROM mip_events event
                   WHERE event.app_id = catalog.app_id
                     AND event.event_type_key = catalog.type_key) AS usage_count
           FROM mip_event_types catalog WHERE catalog.app_id = ? AND catalog.id = ?`,
          [appId, catalogId],
        )
      : await adapter.one(
          `SELECT catalog.id, catalog.tag_key AS catalog_key, catalog.name,
                  catalog.description, catalog.sort_order, catalog.status,
                  catalog.version, catalog.archived_at, catalog.created_at, catalog.updated_at,
                  (SELECT COUNT(*) FROM mip_event_tag_assignments assignment
                   WHERE assignment.app_id = catalog.app_id AND assignment.tag_id = catalog.id
                     AND assignment.status = 'ACTIVE') AS usage_count
           FROM mip_event_tags catalog WHERE catalog.app_id = ? AND catalog.id = ?`,
          [appId, catalogId],
        )
    return row ? publicCatalog(catalogRecord(row, kind)) : null
  }

  async function getEventTagAssignments(appId, eventId, adapter = database) {
    const event = await adapter.one(
      'SELECT id, version FROM mip_events WHERE app_id = ? AND id = ?',
      [appId, eventId],
    )
    if (!event) return null
    const rows = await adapter.query(
      `SELECT tag.id, tag.tag_key, tag.name, tag.description, tag.sort_order,
              tag.status AS catalog_status,
              CASE WHEN assignment.status = 'ACTIVE' THEN 1 ELSE 0 END AS assignment_selected,
              CASE WHEN assignment.status = 'ACTIVE' THEN assignment.version ELSE NULL END AS assignment_version
       FROM mip_event_tags tag
       LEFT JOIN mip_event_tag_assignments assignment
         ON assignment.app_id = tag.app_id AND assignment.event_id = ?
           AND assignment.tag_id = tag.id
       WHERE tag.app_id = ?
         AND (tag.status = 'ACTIVE' OR assignment.status = 'ACTIVE')
       ORDER BY CASE WHEN tag.status = 'ACTIVE' THEN 0 ELSE 1 END,
                tag.sort_order, tag.name, tag.id`,
      [eventId, appId],
    )
    return {
      eventId: String(event.id),
      eventVersion: Number(event.version),
      tags: rows.map(tagAssignmentRecord),
    }
  }

  async function replaceEventTagAssignments(input) {
    return database.transaction(async (tx) => {
      const authorization = await lockMutation(tx, input)
      assertScope(authorization, PLATFORM_SCOPE)
      const event = await tx.one(
        `SELECT id, status, version FROM mip_events
         WHERE app_id = ? AND id = ? FOR UPDATE`,
        [input.appId, input.eventId],
      )
      if (!event) throw codeError('NOT_FOUND')
      if (Number(event.version) !== input.expectedVersion) throw codeError('CONFLICT')
      if (!TAG_ASSIGNMENT_EDITABLE_EVENT_STATUSES.includes(event.status)) {
        throw codeError('INVALID_STATE')
      }

      const currentRows = await tx.query(
        `SELECT assignment.tag_id, tag.tag_key
         FROM mip_event_tag_assignments assignment
         INNER JOIN mip_event_tags tag
           ON tag.app_id = assignment.app_id AND tag.id = assignment.tag_id
         WHERE assignment.app_id = ? AND assignment.event_id = ?
           AND assignment.status = 'ACTIVE'
         ORDER BY assignment.tag_id FOR UPDATE`,
        [input.appId, input.eventId],
      )
      const selectedRows = input.tagIds.length
        ? await tx.query(
            `SELECT id, tag_key, status FROM mip_event_tags
             WHERE app_id = ? AND id IN (${input.tagIds.map(() => '?').join(', ')})
             ORDER BY id FOR UPDATE`,
            [input.appId, ...input.tagIds],
          )
        : []
      if (selectedRows.length !== input.tagIds.length
        || selectedRows.some(row => row.status !== 'ACTIVE')) {
        throw codeError('CONFLICT')
      }

      const currentIds = new Set(currentRows.map(row => String(row.tag_id)))
      const selectedIds = new Set(selectedRows.map(row => String(row.id)))
      const addedRows = selectedRows.filter(row => !currentIds.has(String(row.id)))
      const removedRows = currentRows.filter(row => !selectedIds.has(String(row.tag_id)))
      if (!addedRows.length && !removedRows.length) {
        const state = await getEventTagAssignments(input.appId, input.eventId, tx)
        return { ...state, idempotent: true }
      }

      const nextVersion = input.expectedVersion + 1
      const eventUpdate = await tx.query(
        `UPDATE mip_events SET version = version + 1
         WHERE app_id = ? AND id = ? AND version = ?
           AND status IN (${TAG_ASSIGNMENT_EDITABLE_EVENT_STATUS_SQL})`,
        [input.appId, input.eventId, input.expectedVersion,
          ...TAG_ASSIGNMENT_EDITABLE_EVENT_STATUSES],
      )
      if (Number(eventUpdate?.affectedRows) !== 1) throw codeError('CONFLICT')

      if (removedRows.length) {
        await tx.query(
          `UPDATE mip_event_tag_assignments
           SET status = 'INACTIVE', removed_by_user_id = ?, removed_at = UTC_TIMESTAMP(3),
               version = version + 1
           WHERE app_id = ? AND event_id = ? AND status = 'ACTIVE'
             AND tag_id IN (${removedRows.map(() => '?').join(', ')})`,
          [input.actorUserId, input.appId, input.eventId,
            ...removedRows.map(row => row.tag_id)],
        )
      }
      for (const row of addedRows) {
        await tx.query(
          `INSERT INTO mip_event_tag_assignments (
             app_id, event_id, tag_id, status, version, assigned_by_user_id,
             removed_by_user_id, assigned_at, removed_at
           ) VALUES (?, ?, ?, 'ACTIVE', 1, ?, NULL, UTC_TIMESTAMP(3), NULL)
           ON DUPLICATE KEY UPDATE
             status = 'ACTIVE', version = version + 1,
             assigned_by_user_id = VALUES(assigned_by_user_id), removed_by_user_id = NULL,
             assigned_at = UTC_TIMESTAMP(3), removed_at = NULL`,
          [input.appId, input.eventId, row.id, input.actorUserId],
        )
      }

      await tx.query(
        `INSERT INTO mip_event_changes (
           id, app_id, event_id, source_version, change_type, summary,
           changed_fields_json, actor_user_id
         ) VALUES (?, ?, ?, ?, 'CONTENT', ?, ?, ?)`,
        [createId(), input.appId, input.eventId, nextVersion, '活动标签已更新',
          JSON.stringify(['tags']), input.actorUserId],
      )
      const change = {
        addedTagKeys: addedRows.map(row => String(row.tag_key)),
        removedTagKeys: removedRows.map(row => String(row.tag_key)),
      }
      await writeAudit(tx, input.audit(input.eventId, change))
      const state = await getEventTagAssignments(input.appId, input.eventId, tx)
      return { ...state, idempotent: false }
    })
  }

  async function saveEventCatalog(input) {
    return database.transaction(async (tx) => {
      const authorization = await lockMutation(tx, input)
      assertScope(authorization, PLATFORM_SCOPE)
      const catalogId = input.catalogId || createId()
      if (input.catalogId) {
        const current = await lockedCatalog(tx, input.appId, input.kind, catalogId)
        assertMutable(current, input.expectedVersion)
        const result = input.kind === 'TYPE'
          ? await tx.query(
              `UPDATE mip_event_types
               SET name = ?, description = ?, sort_order = ?, updated_by_user_id = ?,
                   version = version + 1
               WHERE app_id = ? AND id = ? AND version = ? AND status <> 'ARCHIVED'`,
              [input.name, input.description, input.sortOrder, input.actorUserId,
                input.appId, catalogId, input.expectedVersion],
            )
          : await tx.query(
              `UPDATE mip_event_tags
               SET name = ?, description = ?, sort_order = ?, updated_by_user_id = ?,
                   version = version + 1
               WHERE app_id = ? AND id = ? AND version = ? AND status <> 'ARCHIVED'`,
              [input.name, input.description, input.sortOrder, input.actorUserId,
                input.appId, catalogId, input.expectedVersion],
            )
        if (Number(result?.affectedRows) !== 1) throw codeError('CONFLICT')
      }
      else {
        try {
          if (input.kind === 'TYPE') {
            await tx.query(
              `INSERT INTO mip_event_types (
                id, app_id, type_key, name, description, sort_order, status,
                created_by_user_id, updated_by_user_id
              ) VALUES (?, ?, ?, ?, ?, ?, 'INACTIVE', ?, ?)`,
              [catalogId, input.appId, input.key, input.name, input.description,
                input.sortOrder, input.actorUserId, input.actorUserId],
            )
          }
          else {
            await tx.query(
              `INSERT INTO mip_event_tags (
                id, app_id, tag_key, name, description, sort_order, status,
                created_by_user_id, updated_by_user_id
              ) VALUES (?, ?, ?, ?, ?, ?, 'INACTIVE', ?, ?)`,
              [catalogId, input.appId, input.key, input.name, input.description,
                input.sortOrder, input.actorUserId, input.actorUserId],
            )
          }
        }
        catch (error) {
          if (error?.code === 'ER_DUP_ENTRY') throw codeError('CONFLICT')
          throw error
        }
      }
      await writeAudit(tx, input.audit(catalogId))
      return getEventCatalog(input.appId, input.kind, catalogId, tx)
    })
  }

  async function changeEventCatalogStatus(input) {
    return database.transaction(async (tx) => {
      const authorization = await lockMutation(tx, input)
      assertScope(authorization, PLATFORM_SCOPE)
      const current = await lockedCatalog(tx, input.appId, input.kind, input.catalogId)
      assertMutable(current, input.expectedVersion)
      if (current.status === input.status) {
        return getEventCatalog(input.appId, input.kind, input.catalogId, tx)
      }
      const result = input.kind === 'TYPE'
        ? await tx.query(
            `UPDATE mip_event_types SET status = ?, updated_by_user_id = ?, version = version + 1
             WHERE app_id = ? AND id = ? AND version = ? AND status <> 'ARCHIVED'`,
            [input.status, input.actorUserId, input.appId, input.catalogId, input.expectedVersion],
          )
        : await tx.query(
            `UPDATE mip_event_tags SET status = ?, updated_by_user_id = ?, version = version + 1
             WHERE app_id = ? AND id = ? AND version = ? AND status <> 'ARCHIVED'`,
            [input.status, input.actorUserId, input.appId, input.catalogId, input.expectedVersion],
          )
      if (Number(result?.affectedRows) !== 1) throw codeError('CONFLICT')
      await writeAudit(tx, input.audit(input.catalogId, current.status))
      return getEventCatalog(input.appId, input.kind, input.catalogId, tx)
    })
  }

  async function archiveEventCatalog(input) {
    return database.transaction(async (tx) => {
      const authorization = await lockMutation(tx, input)
      assertScope(authorization, PLATFORM_SCOPE)
      const current = await lockedCatalog(tx, input.appId, input.kind, input.catalogId)
      assertMutable(current, input.expectedVersion)
      const result = input.kind === 'TYPE'
        ? await tx.query(
            `UPDATE mip_event_types
             SET status = 'ARCHIVED', archived_at = UTC_TIMESTAMP(3),
                 updated_by_user_id = ?, version = version + 1
             WHERE app_id = ? AND id = ? AND version = ? AND status <> 'ARCHIVED'`,
            [input.actorUserId, input.appId, input.catalogId, input.expectedVersion],
          )
        : await tx.query(
            `UPDATE mip_event_tags
             SET status = 'ARCHIVED', archived_at = UTC_TIMESTAMP(3),
                 updated_by_user_id = ?, version = version + 1
             WHERE app_id = ? AND id = ? AND version = ? AND status <> 'ARCHIVED'`,
            [input.actorUserId, input.appId, input.catalogId, input.expectedVersion],
          )
      if (Number(result?.affectedRows) !== 1) throw codeError('CONFLICT')
      await writeAudit(tx, input.audit(input.catalogId, current.status))
      return getEventCatalog(input.appId, input.kind, input.catalogId, tx)
    })
  }

  async function listEventVideoRecaps(appId, filters, pageLimit) {
    const clauses = ['recap.app_id = ?']
    const params = [appId]
    if (filters.eventId) {
      clauses.push('recap.event_id = ?')
      params.push(filters.eventId)
    }
    if (filters.status) {
      clauses.push('recap.status = ?')
      params.push(filters.status)
    }
    else {
      clauses.push("recap.status <> 'ARCHIVED'")
    }
    if (filters.query) {
      const query = `%${escapeLike(filters.query)}%`
      clauses.push('(recap.title LIKE ? OR recap.summary LIKE ? OR event.title LIKE ?)')
      params.push(query, query, query)
    }
    addCursor(clauses, params, 'recap.updated_at', 'recap.id', filters.cursor)
    const rows = await database.query(
      `${recapSelect()} WHERE ${clauses.join(' AND ')}
       ORDER BY recap.updated_at DESC, recap.id DESC LIMIT ?`,
      [...params, pageLimit + 1],
    )
    return page(rows.map(recapRecord), filters.cursorContext, pageLimit)
  }

  async function getEventVideoRecap(appId, recapId, adapter = database) {
    const row = await adapter.one(
      `${recapSelect()} WHERE recap.app_id = ? AND recap.id = ?`,
      [appId, recapId],
    )
    return row ? publicRecap(recapRecord(row)) : null
  }

  async function saveEventVideoRecap(input) {
    return database.transaction(async (tx) => {
      const authorization = await lockMutation(tx, input)
      assertScope(authorization, PLATFORM_SCOPE)
      await assertEventExists(tx, input.appId, input.eventId)
      const recapId = input.recapId || createId()
      if (input.recapId) {
        const current = await lockedRecap(tx, input.appId, recapId)
        assertMutable(current, input.expectedVersion)
        const result = await tx.query(
          `UPDATE mip_event_video_recaps
           SET event_id = ?, title = ?, summary = ?, destination_provider = ?,
               destination_kind = ?, finder_user_name = ?, feed_id = ?, sort_order = ?,
               updated_by_user_id = ?, version = version + 1
           WHERE app_id = ? AND id = ? AND version = ? AND status <> 'ARCHIVED'`,
          [input.eventId, input.title, input.summary, input.destination.provider,
            input.destination.type, input.destination.finderUserName, input.destination.feedId,
            input.sortOrder, input.actorUserId, input.appId, recapId, input.expectedVersion],
        )
        if (Number(result?.affectedRows) !== 1) throw codeError('CONFLICT')
      }
      else {
        await tx.query(
          `INSERT INTO mip_event_video_recaps (
            id, app_id, event_id, title, summary, destination_provider,
            destination_kind, finder_user_name, feed_id, sort_order, status,
            created_by_user_id, updated_by_user_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'INACTIVE', ?, ?)`,
          [recapId, input.appId, input.eventId, input.title, input.summary,
            input.destination.provider, input.destination.type, input.destination.finderUserName,
            input.destination.feedId, input.sortOrder, input.actorUserId, input.actorUserId],
        )
      }
      await writeAudit(tx, input.audit(recapId))
      return getEventVideoRecap(input.appId, recapId, tx)
    })
  }

  async function changeEventVideoRecapStatus(input) {
    return database.transaction(async (tx) => {
      const authorization = await lockMutation(tx, input)
      assertScope(authorization, PLATFORM_SCOPE)
      const current = await lockedRecap(tx, input.appId, input.recapId)
      assertMutable(current, input.expectedVersion)
      if (current.status === input.status) {
        return getEventVideoRecap(input.appId, input.recapId, tx)
      }
      const result = await tx.query(
        `UPDATE mip_event_video_recaps
         SET status = ?,
             activated_at = CASE WHEN ? = 'ACTIVE' THEN UTC_TIMESTAMP(3) ELSE activated_at END,
             updated_by_user_id = ?, version = version + 1
         WHERE app_id = ? AND id = ? AND version = ? AND status <> 'ARCHIVED'`,
        [input.status, input.status, input.actorUserId, input.appId,
          input.recapId, input.expectedVersion],
      )
      if (Number(result?.affectedRows) !== 1) throw codeError('CONFLICT')
      await writeAudit(tx, input.audit(current.status))
      return getEventVideoRecap(input.appId, input.recapId, tx)
    })
  }

  async function archiveEventVideoRecap(input) {
    return database.transaction(async (tx) => {
      const authorization = await lockMutation(tx, input)
      assertScope(authorization, PLATFORM_SCOPE)
      const current = await lockedRecap(tx, input.appId, input.recapId)
      assertMutable(current, input.expectedVersion)
      const result = await tx.query(
        `UPDATE mip_event_video_recaps
         SET status = 'ARCHIVED', archived_at = UTC_TIMESTAMP(3),
             updated_by_user_id = ?, version = version + 1
         WHERE app_id = ? AND id = ? AND version = ? AND status <> 'ARCHIVED'`,
        [input.actorUserId, input.appId, input.recapId, input.expectedVersion],
      )
      if (Number(result?.affectedRows) !== 1) throw codeError('CONFLICT')
      await writeAudit(tx, input.audit(current.status))
      return getEventVideoRecap(input.appId, input.recapId, tx)
    })
  }

  async function lockedCatalog(tx, appId, kind, catalogId) {
    return kind === 'TYPE'
      ? tx.one(
          `SELECT id, status, version FROM mip_event_types
           WHERE app_id = ? AND id = ? FOR UPDATE`,
          [appId, catalogId],
        )
      : tx.one(
          `SELECT id, status, version FROM mip_event_tags
           WHERE app_id = ? AND id = ? FOR UPDATE`,
          [appId, catalogId],
        )
  }

  async function lockedRecap(tx, appId, recapId) {
    return tx.one(
      `SELECT id, status, version FROM mip_event_video_recaps
       WHERE app_id = ? AND id = ? FOR UPDATE`,
      [appId, recapId],
    )
  }

  async function assertEventExists(tx, appId, eventId) {
    const event = await tx.one(
      'SELECT id FROM mip_events WHERE app_id = ? AND id = ?',
      [appId, eventId],
    )
    if (!event) throw codeError('NOT_FOUND')
  }

  function assertMutable(current, expectedVersion) {
    if (!current) throw codeError('NOT_FOUND')
    if (Number(current.version) !== expectedVersion) throw codeError('CONFLICT')
    if (current.status === 'ARCHIVED') throw codeError('INVALID_STATE')
  }

  return {
    archiveEventCatalog,
    archiveEventVideoRecap,
    changeEventCatalogStatus,
    changeEventVideoRecapStatus,
    getEventCatalog,
    getEventTagAssignments,
    getEventVideoRecap,
    listEventCatalogs,
    listEventVideoRecaps,
    saveEventCatalog,
    saveEventVideoRecap,
    replaceEventTagAssignments,
  }

  function catalogRecord(row, kind) {
    return {
      id: String(row.id),
      kind,
      key: String(row.catalog_key),
      name: row.name || '',
      description: row.description || '',
      sortOrder: Number(row.sort_order),
      status: row.status,
      usageCount: Number(row.usage_count || 0),
      version: Number(row.version),
      archivedAt: iso(row.archived_at),
      createdAt: iso(row.created_at),
      updatedAt: iso(row.updated_at),
      cursorUpdatedAt: sqlDateTime(row.updated_at),
    }
  }

  function recapRecord(row) {
    return {
      id: String(row.id),
      eventId: String(row.event_id),
      eventTitle: row.event_title || '',
      title: row.title || '',
      summary: row.summary || '',
      destination: {
        provider: row.destination_provider,
        type: row.destination_kind,
        finderUserName: row.finder_user_name,
        feedId: row.feed_id || null,
      },
      sortOrder: Number(row.sort_order),
      status: row.status,
      version: Number(row.version),
      activatedAt: iso(row.activated_at),
      archivedAt: iso(row.archived_at),
      createdAt: iso(row.created_at),
      updatedAt: iso(row.updated_at),
      cursorUpdatedAt: sqlDateTime(row.updated_at),
    }
  }

  function tagAssignmentRecord(row) {
    const selected = Number(row.assignment_selected) === 1
    return {
      id: String(row.id),
      key: String(row.tag_key),
      name: row.name || '',
      description: row.description || '',
      sortOrder: Number(row.sort_order),
      catalogStatus: row.catalog_status,
      selectable: row.catalog_status === 'ACTIVE',
      selected,
      assignmentVersion: selected ? Number(row.assignment_version) : null,
    }
  }
}

function recapSelect() {
  return `SELECT recap.id, recap.event_id, event.title AS event_title,
                 recap.title, recap.summary, recap.destination_provider,
                 recap.destination_kind, recap.finder_user_name, recap.feed_id,
                 recap.sort_order, recap.status, recap.version, recap.activated_at,
                 recap.archived_at, recap.created_at, recap.updated_at
          FROM mip_event_video_recaps recap
          INNER JOIN mip_events event
            ON event.app_id = recap.app_id AND event.id = recap.event_id`
}

function addCursor(clauses, params, timeColumn, idColumn, cursor) {
  if (!cursor) return
  clauses.push(`(${timeColumn} < ? OR (${timeColumn} = ? AND ${idColumn} < ?))`)
  params.push(cursor.updatedAt, cursor.updatedAt, cursor.id)
}

function page(items, cursorContext, pageLimit) {
  const hasMore = items.length > pageLimit
  const visible = hasMore ? items.slice(0, pageLimit) : items
  const last = visible[visible.length - 1]
  return {
    items: visible.map(item => item.kind ? publicCatalog(item) : publicRecap(item)),
    nextCursor: hasMore && last
      ? encodeCursor({ ...cursorContext, updatedAt: last.cursorUpdatedAt, id: last.id })
      : null,
  }
}

function publicCatalog(item) {
  const { cursorUpdatedAt: _cursorUpdatedAt, ...value } = item
  return value
}

function publicRecap(item) {
  const { cursorUpdatedAt: _cursorUpdatedAt, ...value } = item
  return value
}

function sqlDateTime(value) {
  if (!value) return ''
  const date = value instanceof Date ? value : new Date(value)
  return Number.isFinite(date.getTime())
    ? date.toISOString().slice(0, 23).replace('T', ' ')
    : ''
}

module.exports = { createEventCatalogRepository }
