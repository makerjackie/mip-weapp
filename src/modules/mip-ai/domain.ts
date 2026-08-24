import type { AiDraft, AiDraftConfirmation, AiDraftStatus } from './types'

const allowedFields = {
  PROFILE: new Set(['nickname', 'identityStatus', 'headline', 'introduction', 'companies', 'organizations']),
  COOPERATION_CARD: new Set(['roleKey', 'positioning', 'targetSummary', 'roleFields', 'abilityScores']),
  SUPER_CASE: new Set(['projectName', 'summary', 'responsibility', 'description', 'startedOn', 'endedOn', 'caseType']),
} as const

const transitions: Readonly<Record<AiDraftStatus, readonly AiDraftStatus[]>> = {
  UPLOADED: ['TRANSCRIBING', 'FAILED', 'EXPIRED', 'DELETED'],
  TRANSCRIBING: ['STRUCTURING', 'FAILED', 'EXPIRED', 'DELETED'],
  STRUCTURING: ['DRAFT_READY', 'FAILED', 'EXPIRED', 'DELETED'],
  DRAFT_READY: ['CONFIRMED', 'EXPIRED', 'DELETED'],
  FAILED: ['TRANSCRIBING', 'EXPIRED', 'DELETED'],
  CONFIRMED: ['DELETED'],
  EXPIRED: ['DELETED'],
  DELETED: [],
}

export function assertAiDraftTransition(from: AiDraftStatus, to: AiDraftStatus) {
  if (from === to) {
    return
  }
  if (!transitions[from].includes(to)) {
    throw new Error(`AI_DRAFT_TRANSITION_NOT_ALLOWED:${from}:${to}`)
  }
}

function isSupportedValue(value: unknown): boolean {
  if (typeof value === 'string') {
    return value.trim().length <= 4000
  }
  if (typeof value === 'number') {
    return Number.isFinite(value)
  }
  if (typeof value === 'boolean' || value === null) {
    return true
  }
  if (Array.isArray(value)) {
    return value.length <= 20 && value.every(isSupportedValue)
  }
  if (value && typeof value === 'object') {
    return Object.keys(value).length <= 30 && Object.values(value).every(isSupportedValue)
  }
  return false
}

export function normalizeStructuredDraft(
  purpose: AiDraft['purpose'],
  value: Record<string, unknown>,
) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('AI_DRAFT_CONTENT_INVALID')
  }
  const permitted = allowedFields[purpose]
  const result = Object.fromEntries(Object.entries(value).filter(([key, item]) => (
    permitted.has(key as never) && isSupportedValue(item)
  )))
  if (!Object.keys(result).length || JSON.stringify(result).length > 30_000) {
    throw new Error('AI_DRAFT_CONTENT_INVALID')
  }
  return result
}

export function confirmAiDraft(
  draft: AiDraft,
  confirmation: AiDraftConfirmation,
  now = new Date(),
) {
  if (draft.id !== confirmation.draftId || draft.version !== confirmation.expectedVersion) {
    throw new Error('AI_DRAFT_VERSION_CONFLICT')
  }
  if (draft.status !== 'DRAFT_READY' || Date.parse(draft.expiresAt) <= now.getTime()) {
    throw new Error('AI_DRAFT_NOT_CONFIRMABLE')
  }
  const keys = Object.keys(confirmation.editedDraft)
  if (!keys.length || JSON.stringify(confirmation.editedDraft).length > 30_000) {
    throw new Error('AI_DRAFT_CONTENT_INVALID')
  }
  return {
    purpose: draft.purpose,
    structuredDraft: normalizeStructuredDraft(draft.purpose, confirmation.editedDraft),
    nextStatus: 'CONFIRMED' as const,
    nextVersion: draft.version + 1,
  }
}

export function shouldExpireAiDraft(draft: AiDraft, now = new Date()) {
  return !['CONFIRMED', 'EXPIRED', 'DELETED'].includes(draft.status)
    && Date.parse(draft.expiresAt) <= now.getTime()
}
