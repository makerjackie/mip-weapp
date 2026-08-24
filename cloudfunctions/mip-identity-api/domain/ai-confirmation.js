'use strict'

function uuid(value) {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function normalizeAiConfirmation(value) {
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
  }
}

async function confirmProfileAiDraft(tx, input) {
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
    if (draft.confirmed_resource_type !== 'PROFILE'
      || draft.confirmed_resource_id !== input.userId) {
      throw new Error('AI_DRAFT_CONFLICT')
    }
    return { confirmed: true, idempotent: true }
  }
  if (draft.purpose !== 'PROFILE'
    || draft.status !== 'DRAFT_READY'
    || Number(draft.version) !== confirmation.expectedVersion
    || new Date(draft.expires_at).getTime() <= Date.now()) {
    throw new Error('AI_DRAFT_CONFLICT')
  }
  const structured = {
    nickname: input.profile.nickname,
    identityStatus: input.profile.identityStatus,
    headline: input.profile.headline,
    introduction: input.profile.introduction,
    companies: input.profile.companies,
    organizations: input.profile.organizations,
  }
  const update = await tx.query(
    `UPDATE mip_ai_drafts SET
       structured_draft_json = ?, status = 'CONFIRMED',
       confirmed_resource_type = 'PROFILE', confirmed_resource_id = ?,
       version = version + 1
     WHERE app_id = ? AND user_id = ? AND id = ?
       AND version = ? AND status = 'DRAFT_READY'`,
    [
      JSON.stringify(structured),
      input.userId,
      input.appId,
      input.userId,
      confirmation.draftId,
      confirmation.expectedVersion,
    ],
  )
  if (Number(update.affectedRows) !== 1) throw new Error('AI_DRAFT_CONFLICT')
  return { confirmed: true, idempotent: false }
}

module.exports = { confirmProfileAiDraft, normalizeAiConfirmation }
