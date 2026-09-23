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
      }, createId)
      if (claim.replay) return claim.replay
      const row = input.draftId
        ? await tx.one(`SELECT draft_id, event_uid, version FROM mip_event_drafts
          WHERE app_id = ? AND operator_user_id = ? AND draft_id = ? FOR UPDATE`,
        [input.appId, input.actorUserId, input.draftId])
        : await tx.one(`SELECT draft_id, event_uid, version FROM mip_event_drafts
          WHERE app_id = ? AND operator_user_id = ? AND event_uid ${input.eventId ? '= ?' : 'IS NULL'}
          ORDER BY updated_at DESC, draft_id DESC LIMIT 1 FOR UPDATE`,
        [input.appId, input.actorUserId, ...(input.eventId ? [input.eventId] : [])])
      if (input.draftId && !row) throw codeError('NOT_FOUND')
      if (row && (row.event_uid || null) !== input.eventId) throw codeError('CONFLICT')
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

  async function getEventDraft(appId, actorUserId) {
    const row = await database.one(`SELECT draft_id, event_uid, draft_data_json, version, updated_at
      FROM mip_event_drafts WHERE app_id = ? AND operator_user_id = ?
      ORDER BY updated_at DESC, draft_id DESC LIMIT 1`, [appId, actorUserId])
    if (!row) return null
    return { draftId: String(row.draft_id), eventId: row.event_uid || null,
      draftData: json(row.draft_data_json, {}), version: Number(row.version), updatedAt: iso(row.updated_at) }
  }
  return { saveEventDraft, getEventDraft }
}

module.exports = { createEventDraftRepository }
