import type { AdminEventInsights } from './types'
import { MipAdminError } from './error'

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function invalid(): never {
  throw new MipAdminError('INVALID_RESPONSE', '运营服务返回了无效的活动数据洞察')
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function exactKeys(value: Record<string, unknown>, expected: string[]) {
  const keys = Object.keys(value)
  return keys.length === expected.length && expected.every(key => Object.hasOwn(value, key))
}

function safeCount(value: unknown) {
  return Number.isSafeInteger(value) && Number(value) >= 0
}

function basisPoints(value: unknown) {
  return value === null || (Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 10_000)
}

function rateBasisPoints(numerator: number, denominator: number) {
  return denominator === 0 ? null : Math.round((numerator / denominator) * 10_000)
}

function parseParticipation(value: unknown): AdminEventInsights['participation'] {
  if (!record(value)
    || !exactKeys(value, [
      'effectiveRegistrationCount',
      'checkedInCount',
      'checkInRateBasisPoints',
      'pendingReviewCount',
      'waitlistedCount',
    ])
    || !safeCount(value.effectiveRegistrationCount)
    || !safeCount(value.checkedInCount)
    || !safeCount(value.pendingReviewCount)
    || !safeCount(value.waitlistedCount)
    || !basisPoints(value.checkInRateBasisPoints)) {
    return invalid()
  }
  const participation = value as unknown as AdminEventInsights['participation']
  if (participation.checkedInCount > participation.effectiveRegistrationCount
    || participation.checkInRateBasisPoints !== rateBasisPoints(
      participation.checkedInCount,
      participation.effectiveRegistrationCount,
    )) {
    return invalid()
  }
  return participation
}

function parseInvitations(value: unknown): AdminEventInsights['invitations'] {
  if (!record(value)
    || !exactKeys(value, ['attributedRegistrationCount', 'distinctInviterCount'])
    || !safeCount(value.attributedRegistrationCount)
    || !safeCount(value.distinctInviterCount)) {
    return invalid()
  }
  const invitations = value as unknown as AdminEventInsights['invitations']
  if (invitations.distinctInviterCount > invitations.attributedRegistrationCount) {
    return invalid()
  }
  return invitations
}

function parseComposition(value: unknown): AdminEventInsights['composition'] {
  if (!record(value)
    || !exactKeys(value, ['playerCount', 'guestCount'])
    || !safeCount(value.playerCount)
    || !safeCount(value.guestCount)) {
    return invalid()
  }
  return value as unknown as AdminEventInsights['composition']
}

function parseHearts(value: unknown): AdminEventInsights['hearts'] {
  if (!record(value)
    || !exactKeys(value, ['voterCount', 'activeVoteCount', 'mutualMatchCount'])
    || !safeCount(value.voterCount)
    || !safeCount(value.activeVoteCount)
    || !safeCount(value.mutualMatchCount)) {
    return invalid()
  }
  const hearts = value as unknown as AdminEventInsights['hearts']
  if (hearts.activeVoteCount > hearts.voterCount
    || hearts.mutualMatchCount * 2 > hearts.activeVoteCount) {
    return invalid()
  }
  return hearts
}

function parseFeedback(value: unknown): AdminEventInsights['feedback'] {
  if (!record(value) || value.access === 'RESTRICTED') {
    if (!record(value) || !exactKeys(value, ['access']) || value.access !== 'RESTRICTED') {
      return invalid()
    }
    return { access: 'RESTRICTED' }
  }
  if (value.access !== 'GRANTED'
    || !exactKeys(value, [
      'access',
      'submissionCount',
      'eligibleCheckInCount',
      'submissionRateBasisPoints',
      'ratedCount',
      'averageRating',
    ])
    || !safeCount(value.submissionCount)
    || !safeCount(value.eligibleCheckInCount)
    || !safeCount(value.ratedCount)
    || !basisPoints(value.submissionRateBasisPoints)) {
    return invalid()
  }
  const feedback = value as unknown as Extract<AdminEventInsights['feedback'], { access: 'GRANTED' }>
  if (feedback.ratedCount > feedback.submissionCount
    || feedback.submissionCount > feedback.eligibleCheckInCount
    || feedback.submissionRateBasisPoints !== rateBasisPoints(
      feedback.submissionCount,
      feedback.eligibleCheckInCount,
    )
    || (feedback.ratedCount === 0 && feedback.averageRating !== null)
    || (feedback.ratedCount > 0 && (typeof feedback.averageRating !== 'number'
      || !Number.isFinite(feedback.averageRating)
      || feedback.averageRating < 1
      || feedback.averageRating > 5))) {
    return invalid()
  }
  return feedback
}

function parseFinancials(value: unknown): AdminEventInsights['financials'] {
  if (!record(value) || value.access === 'RESTRICTED') {
    if (!record(value) || !exactKeys(value, ['access']) || value.access !== 'RESTRICTED') {
      return invalid()
    }
    return { access: 'RESTRICTED' }
  }
  if (value.access !== 'GRANTED'
    || !exactKeys(value, [
      'access',
      'currency',
      'paidOrderCount',
      'grossAmountCents',
      'refundedAmountCents',
      'netAmountCents',
    ])
    || value.currency !== 'CNY'
    || !safeCount(value.paidOrderCount)
    || !safeCount(value.grossAmountCents)
    || !safeCount(value.refundedAmountCents)
    || !safeCount(value.netAmountCents)) {
    return invalid()
  }
  const financials = value as unknown as Extract<AdminEventInsights['financials'], { access: 'GRANTED' }>
  if (financials.refundedAmountCents > financials.grossAmountCents
    || financials.netAmountCents !== financials.grossAmountCents - financials.refundedAmountCents) {
    return invalid()
  }
  return financials
}

function parseTraffic(value: unknown): AdminEventInsights['traffic'] {
  if (!record(value) || !exactKeys(value, ['views', 'shares'])) {
    return invalid()
  }
  for (const item of [value.views, value.shares]) {
    if (!record(item)
      || !exactKeys(item, ['availability', 'count'])
      || item.availability !== 'NOT_TRACKED'
      || item.count !== null) {
      return invalid()
    }
  }
  return value as unknown as AdminEventInsights['traffic']
}

export function parseAdminEventInsights(value: unknown): AdminEventInsights {
  if (!record(value)
    || !exactKeys(value, [
      'eventId',
      'calculatedAt',
      'participation',
      'invitations',
      'composition',
      'hearts',
      'feedback',
      'financials',
      'traffic',
    ])
    || typeof value.eventId !== 'string'
    || !uuidPattern.test(value.eventId)
    || typeof value.calculatedAt !== 'string'
    || !Number.isFinite(Date.parse(value.calculatedAt))) {
    return invalid()
  }
  const participation = parseParticipation(value.participation)
  const invitations = parseInvitations(value.invitations)
  const composition = parseComposition(value.composition)
  const hearts = parseHearts(value.hearts)
  if (invitations.attributedRegistrationCount > participation.effectiveRegistrationCount
    || composition.playerCount + composition.guestCount !== participation.effectiveRegistrationCount) {
    return invalid()
  }
  return {
    eventId: value.eventId,
    calculatedAt: value.calculatedAt,
    participation,
    invitations,
    composition,
    hearts,
    feedback: parseFeedback(value.feedback),
    financials: parseFinancials(value.financials),
    traffic: parseTraffic(value.traffic),
  }
}
