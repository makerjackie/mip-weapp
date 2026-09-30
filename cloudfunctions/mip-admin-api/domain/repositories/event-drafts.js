'use strict'

const { claimOptional, complete } = require('../idempotency')

function createEventDraftRepository(database, dependencies) {
  const { lockMutationAuthorization, assertMutationScope, assertAuthorizedScope,
    eventScopeFromRow, writeAudit, createId } = dependencies
  const { codeError, iso, json } = dependencies.repositorySupport

  async function saveEventDraft(input) {
    return database.transaction(async tx => {
      const authorization = await lockMutationAuthorization(tx, input)
      if (input.eventId) {
        const event = await tx.one('SELECT * FROM mip_events WHERE app_id = ? AND id = ? FOR UPDATE',
          [input.appId, input.eventId])
        if (!event) throw codeError('NOT_FOUND')
        const scope = eventScopeFromRow(event, input.eventId)
        assertMutationScope(authorization, scope)
        assertAuthorizedScope(scope, input.authorizedScope)
      }
      const claim = await claimOptional(tx, input, 'events.drafts.save', {
        draftId: input.draftId, eventId: input.eventId, dataJson: input.dataJson,
        ...(input.expectedVersion != null ? { expectedVersion: input.expectedVersion } : {}),
      }, createId)
      if (claim.replay) return claim.replay
      const row = input.draftId
        ? await tx.one(`SELECT draft_id, event_uid, version, draft_data_json FROM mip_event_drafts
          WHERE app_id = ? AND operator_user_id = ? AND draft_id = ? FOR UPDATE`,
        [input.appId, input.actorUserId, input.draftId])
        : null
      if (input.draftId && !row) throw codeError('NOT_FOUND')
      if (row && (row.event_uid || null) !== input.eventId) throw codeError('CONFLICT')
      if (row && json(row.draft_data_json, {})._submittedEventId) throw codeError('INVALID_STATE')
      if (row && input.expectedVersion != null && Number(row.version) !== input.expectedVersion) throw codeError('CONFLICT')
      let draftId
      let version
      if (row) {
        draftId = String(row.draft_id)
        version = Number(row.version) + 1
        const updated = await tx.query(`UPDATE mip_event_drafts SET draft_data_json = ?, version = version + 1
          WHERE app_id = ? AND operator_user_id = ? AND draft_id = ? AND version = ?`,
        [input.dataJson, input.appId, input.actorUserId, draftId, row.version])
        if (Number(updated.affectedRows) !== 1) throw codeError('CONFLICT')
      }
      else {
        const inserted = await tx.query(`INSERT INTO mip_event_drafts
          (app_id, operator_user_id, event_uid, operator_id, event_id, draft_data_json)
          VALUES (?, ?, ?, 0, NULL, ?)`,
        [input.appId, input.actorUserId, input.eventId, input.dataJson])
        draftId = String(inserted.insertId)
        version = 1
      }
      await writeAudit(tx, input.audit(draftId))
      const result = { draftId, eventId: input.eventId, version }
      await complete(tx, input, 'events.drafts.save', claim.requestHash, result)
      return result
    })
  }

  async function getEventDraft(appId, actorUserId, selector = {}) {
    const clauses = []; const params = [appId, actorUserId]
    if (selector.draftId) { clauses.push('draft_id = ?'); params.push(selector.draftId) }
    if (Object.hasOwn(selector, 'eventId')) {
      clauses.push(selector.eventId ? 'event_uid = ?' : 'event_uid IS NULL')
      if (selector.eventId) params.push(selector.eventId)
    }
    const row = await database.one(`SELECT draft_id, event_uid, draft_data_json, version, updated_at
      FROM mip_event_drafts WHERE app_id = ? AND operator_user_id = ?
      AND JSON_EXTRACT(draft_data_json, '$._submittedEventId') IS NULL
      ${clauses.length ? `AND ${clauses.join(' AND ')}` : ''}
      ORDER BY updated_at DESC, draft_id DESC LIMIT 1`, params)
    if (!row) return null
    return { draftId: String(row.draft_id), eventId: row.event_uid || null,
      draftData: json(row.draft_data_json, {}), version: Number(row.version), updatedAt: iso(row.updated_at) }
  }
  return { saveEventDraft, getEventDraft }
}

module.exports = { createEventDraftRepository }
