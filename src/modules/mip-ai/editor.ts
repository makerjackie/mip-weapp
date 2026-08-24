import type { AiDraft, AiDraftPurpose, AiDraftSourceConfirmation } from './types'

export interface AiEditorDraft {
  draft: AiDraft
  confirmation: AiDraftSourceConfirmation
  fields: Record<string, unknown>
}

export function requireAiEditorDraft(
  draft: AiDraft,
  purpose: AiDraftPurpose,
  now = Date.now(),
): AiEditorDraft {
  if (draft.purpose !== purpose
    || draft.status !== 'DRAFT_READY'
    || Date.parse(draft.expiresAt) <= now
    || !draft.structuredDraft) {
    throw new Error('AI 草稿已过期或不适用于当前编辑器')
  }
  return {
    draft,
    confirmation: { draftId: draft.id, expectedVersion: draft.version },
    fields: draft.structuredDraft,
  }
}

export function aiText(fields: Record<string, unknown>, key: string, maximum: number) {
  const value = fields[key]
  return typeof value === 'string' ? value.trim().slice(0, maximum) : ''
}

export function aiObject(fields: Record<string, unknown>, key: string) {
  const value = fields[key]
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

export function aiOrganizations(fields: Record<string, unknown>, key: string) {
  const value = fields[key]
  if (!Array.isArray(value)) {
    return []
  }
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return []
    }
    const record = item as Record<string, unknown>
    const name = typeof record.name === 'string' ? record.name.trim().slice(0, 120) : ''
    const role = typeof record.role === 'string' ? record.role.trim().slice(0, 80) : ''
    return name ? [{ name, role }] : []
  }).slice(0, 12)
}
