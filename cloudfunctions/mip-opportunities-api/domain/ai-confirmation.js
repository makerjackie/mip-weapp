'use strict'

const { uuid } = require('./common')

function normalizeAiConfirmation(value, purpose) {
  if (value === undefined || value === null) return null
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || !uuid(value.draftId)
    || !Number.isInteger(Number(value.expectedVersion))
    || Number(value.expectedVersion) < 1) {
    throw new Error('AI_DRAFT_INVALID')
  }
  return {
    draftId: value.draftId,
    expectedVersion: Number(value.expectedVersion),
    purpose,
  }
}

async function confirmAiDraft(tx, input) {
  const confirmation = input.confirmation
  if (!confirmation) return { confirmed: false }
  const draft = await tx.one(
    `SELECT id, purpose, status, version, expires_at,
            confirmed_resource_type, confirmed_resource_id
     FROM mip_ai_drafts
     WHERE app_id = ? AND user_id = ? AND id = ?
     FOR UPDATE`,
    [input.appId, input.userId, confirmation.draftId],
  )
  if (!draft) throw new Error('AI_DRAFT_NOT_FOUND')
  if (draft.status === 'CONFIRMED') {
    if (draft.confirmed_resource_type !== confirmation.purpose
      || draft.confirmed_resource_id !== input.resourceId) {
      throw new Error('AI_DRAFT_CONFLICT')
    }
    return { confirmed: true, idempotent: true }
  }
  if (draft.purpose !== confirmation.purpose
    || draft.status !== 'DRAFT_READY'
    || Number(draft.version) !== confirmation.expectedVersion
    || new Date(draft.expires_at).getTime() <= Date.now()) {
    throw new Error('AI_DRAFT_CONFLICT')
  }
  const update = await tx.query(
    `UPDATE mip_ai_drafts SET
       structured_draft_json = ?, status = 'CONFIRMED',
       confirmed_resource_type = ?, confirmed_resource_id = ?,
       version = version + 1
     WHERE app_id = ? AND user_id = ? AND id = ?
       AND version = ? AND status = 'DRAFT_READY'`,
    [
      JSON.stringify(input.structuredDraft),
      confirmation.purpose,
      input.resourceId,
      input.appId,
      input.userId,
      confirmation.draftId,
      confirmation.expectedVersion,
    ],
  )
  if (Number(update.affectedRows) !== 1) throw new Error('AI_DRAFT_CONFLICT')
  return { confirmed: true, idempotent: false }
}

module.exports = { confirmAiDraft, normalizeAiConfirmation }
