'use strict'

const purposeFields = {
  PROFILE: new Set(['nickname', 'identityStatus', 'headline', 'introduction', 'companies', 'organizations']),
  COOPERATION_CARD: new Set(['roleKey', 'positioning', 'targetSummary', 'roleFields', 'abilityScores']),
  SUPER_CASE: new Set(['projectName', 'summary', 'responsibility', 'description', 'startedOn', 'endedOn', 'caseType']),
}

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
  return { purpose: normalizePurpose(event.purpose), transcriptText }
}

function normalizeVoiceIntent(event) {
  if (!isUuid(event.audioAssetId)) throw new Error('VALIDATION_FAILED')
  return { purpose: normalizePurpose(event.purpose), audioAssetId: event.audioAssetId }
}

function normalizeVoiceUploadIntent(event) {
  if (event.contentType !== 'audio/mpeg' || typeof event.audioBase64 !== 'string') {
    throw new Error('VALIDATION_FAILED')
  }
  return {
    purpose: normalizePurpose(event.purpose),
    audioBase64: event.audioBase64,
    contentType: event.contentType,
  }
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
  isUuid,
  normalizePurpose,
  normalizeStructuredDraft,
  normalizeTextIntent,
  normalizeVoiceIntent,
  normalizeVoiceUploadIntent,
}
