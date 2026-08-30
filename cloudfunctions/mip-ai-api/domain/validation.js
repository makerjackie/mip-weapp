'use strict'

const purposeFields = {
  PROFILE: new Set(['nickname', 'identityStatus', 'headline', 'introduction', 'companies', 'organizations']),
  COOPERATION_CARD: new Set(['roleKey', 'positioning', 'targetSummary', 'roleFields', 'abilityScores']),
  SUPER_CASE: new Set(['projectName', 'summary', 'responsibility', 'description', 'startedOn', 'endedOn', 'caseType']),
}

const digitalAvatarStyleKeys = new Set(['PROFESSIONAL', 'ILLUSTRATED', 'MONOCHROME'])

function normalizePurpose(value) {
  const purpose = typeof value === 'string' ? value.trim().toUpperCase() : ''
  if (!purposeFields[purpose]) throw new Error('VALIDATION_FAILED')
  return purpose
}

function normalizeStructuredDraft(purposeValue, value) {
  const purpose = normalizePurpose(purposeValue)
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('AI_DRAFT_CONTENT_INVALID')
  }
  const result = Object.fromEntries(Object.entries(value).filter(([key, item]) => (
    purposeFields[purpose].has(key) && isSupportedValue(item)
  )))
  if (!Object.keys(result).length || JSON.stringify(result).length > 30_000) {
    throw new Error('AI_DRAFT_CONTENT_INVALID')
  }
  return result
}

function normalizeTextIntent(event) {
  const transcriptText = typeof event.transcriptText === 'string' ? event.transcriptText.trim() : ''
  if (!transcriptText || transcriptText.length > 8000) throw new Error('VALIDATION_FAILED')
  const requestId = normalizeOptionalRequestId(event.requestId)
  return {
    purpose: normalizePurpose(event.purpose),
    transcriptText,
    ...(requestId ? { requestId } : {}),
  }
}

function normalizeVoiceIntent(event) {
  if (!isUuid(event.audioAssetId)) throw new Error('VALIDATION_FAILED')
  const requestId = normalizeOptionalRequestId(event.requestId)
  return {
    purpose: normalizePurpose(event.purpose),
    audioAssetId: event.audioAssetId,
    ...(requestId ? { requestId } : {}),
  }
}

function normalizeVoiceUploadIntent(event) {
  if (event.contentType !== 'audio/mpeg' || typeof event.audioBase64 !== 'string') {
    throw new Error('VALIDATION_FAILED')
  }
  const requestId = normalizeOptionalRequestId(event.requestId)
  return {
    purpose: normalizePurpose(event.purpose),
    audioBase64: event.audioBase64,
    contentType: event.contentType,
    ...(requestId ? { requestId } : {}),
  }
}

function normalizeOptionalRequestId(value) {
  if (value === undefined || value === null || value === '') return undefined
  const requestId = typeof value === 'string' ? value.trim() : ''
  if (!/^[\w.:-]{8,128}$/.test(requestId)) throw new Error('VALIDATION_FAILED')
  return requestId
}

function normalizeRefinementIntent(event) {
  if (!isUuid(event.draftId)
    || !Number.isInteger(Number(event.expectedVersion))
    || Number(event.expectedVersion) < 1) {
    throw new Error('VALIDATION_FAILED')
  }
  const supplementalText = typeof event.supplementalText === 'string'
    ? event.supplementalText.trim()
    : ''
  if (!supplementalText || supplementalText.length > 4000) {
    throw new Error('VALIDATION_FAILED')
  }
  return {
    draftId: event.draftId,
    expectedVersion: Number(event.expectedVersion),
    supplementalText,
  }
}

function normalizeDigitalAvatarIntent(event) {
  const sourceAvatarAssetId = typeof event.sourceAvatarAssetId === 'string'
    ? event.sourceAvatarAssetId.trim()
    : ''
  const styleKey = typeof event.styleKey === 'string' ? event.styleKey.trim().toUpperCase() : ''
  const requestId = typeof event.requestId === 'string' ? event.requestId.trim() : ''
  if (!isUuid(sourceAvatarAssetId) || !digitalAvatarStyleKeys.has(styleKey)
    || !/^[\w.:-]{8,128}$/.test(requestId)) {
    throw new Error('VALIDATION_FAILED')
  }
  return { sourceAvatarAssetId, styleKey, requestId }
}

function combineDraftTranscript(currentValue, supplementalText) {
  const current = typeof currentValue === 'string' ? currentValue.trim() : ''
  const supplemental = typeof supplementalText === 'string' ? supplementalText.trim() : ''
  const combined = [current, supplemental].filter(Boolean).join('\n\n')
  if (!combined || combined.length > 20_000) {
    throw new Error('AI_DRAFT_CONTENT_INVALID')
  }
  return combined
}

function isSupportedValue(value) {
  if (typeof value === 'string') return value.trim().length <= 4000
  if (typeof value === 'number') return Number.isFinite(value)
  if (typeof value === 'boolean' || value === null) return true
  if (Array.isArray(value)) return value.length <= 20 && value.every(isSupportedValue)
  if (value && typeof value === 'object') {
    return Object.keys(value).length <= 30 && Object.values(value).every(isSupportedValue)
  }
  return false
}

function isUuid(value) {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

module.exports = {
  combineDraftTranscript,
  isUuid,
  normalizeDigitalAvatarIntent,
  normalizeOptionalRequestId,
  normalizePurpose,
  normalizeRefinementIntent,
  normalizeStructuredDraft,
  normalizeTextIntent,
  normalizeVoiceIntent,
  normalizeVoiceUploadIntent,
}
