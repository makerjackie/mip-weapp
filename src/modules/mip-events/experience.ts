import type { BranchId, CityBranchSummary } from '../mip'

const HTTPS_EVENT_URL = /^https:\/\/(?![^/?#\s]*@)[a-z\d](?:[a-z\d.-]*[a-z\d])?(?::[1-9]\d{0,4})?(?:[/?#]\S*)?$/i

export function resolvePrimaryBranchCity(
  primaryBranchId: BranchId | undefined,
  branches: readonly CityBranchSummary[],
) {
  if (!primaryBranchId) {
    return ''
  }
  const branch = branches.find(item => item.id === primaryBranchId && item.status === 'ACTIVE')
  return branch?.cityName.trim() || ''
}

export function safeHttpsEventUrl(value: string | undefined) {
  const normalized = value?.trim() || ''
  return HTTPS_EVENT_URL.test(normalized) ? normalized : ''
}

export function eventInvitationPath(eventId: string, invitationToken = '') {
  const normalizedEventId = eventId.trim()
  if (!normalizedEventId || normalizedEventId.length > 64) {
    throw new Error('EVENT_ID_REQUIRED')
  }
  const path = `/packages/member/mip-events/detail/index?eventId=${encodeURIComponent(normalizedEventId)}`
  const normalizedToken = invitationToken.trim()
  return normalizedToken
    ? `${path}&invitationToken=${encodeURIComponent(normalizedToken)}`
    : path
}

export function decodeInvitationToken(value: string | undefined) {
  if (!value || value.length > 1536) {
    return ''
  }
  try {
    return decodeURIComponent(value).slice(0, 1024)
  }
  catch {
    return ''
  }
}

export function isEventAccessRequirementError(error: unknown) {
  return Boolean(error
    && typeof error === 'object'
    && 'code' in error
    && ['AUTH_REQUIRED', 'AGREEMENT_REQUIRED', 'PHONE_REQUIRED', 'PROFILE_REQUIRED']
      .includes(String((error as { code?: unknown }).code || '')))
}

export function checkInCredentialCountdown(validUntil: string, now = Date.now()) {
  const expiresAt = Date.parse(validUntil)
  const remainingSeconds = Number.isFinite(expiresAt)
    ? Math.max(0, Math.ceil((expiresAt - now) / 1000))
    : 0
  const minutes = Math.floor(remainingSeconds / 60)
  const seconds = remainingSeconds % 60
  return {
    expired: remainingSeconds === 0,
    remainingSeconds,
    text: remainingSeconds === 0
      ? '已失效'
      : `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`,
  }
}
