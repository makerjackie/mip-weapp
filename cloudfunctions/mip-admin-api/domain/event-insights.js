'use strict'

const {
  CAPABILITIES,
  capabilitiesForBinding,
  coversScope,
} = require('./capabilities')

const EFFECTIVE_REGISTRATION_STATUSES = Object.freeze([
  'REGISTERED',
  'CANCELLATION_PENDING',
  'ATTENDED',
])
const EFFECTIVE_REGISTRATION_SQL = EFFECTIVE_REGISTRATION_STATUSES
  .map(status => `'${status}'`)
  .join(', ')

function createEventInsightsRepository(database) {
  async function getEventInsights(input) {
    return database.transaction(async (tx) => {
      const event = await tx.one(
        `SELECT id, scope_type, branch_id
         FROM mip_events
         WHERE app_id = ? AND id = ?`,
        [input.appId, input.eventId],
      )
      if (!event) throw codeError('NOT_FOUND')

      const actor = await tx.one(
        `SELECT id
         FROM mip_users
         WHERE app_id = ? AND id = ? AND status = 'ACTIVE'`,
        [input.appId, input.actorUserId],
      )
      if (!actor) throw codeError('FORBIDDEN')

      const bindingRows = await tx.query(
        `SELECT r.scope_type, r.scope_id, r.role_key,
          CASE WHEN p.policy_mode = 'CUSTOM' THEN p.capabilities_json ELSE NULL END
            AS policy_capabilities_json
         FROM mip_admin_role_bindings r
         LEFT JOIN mip_role_capability_policies p
           ON p.app_id = r.app_id AND p.role_key = r.role_key
         WHERE r.app_id = ? AND r.user_id = ? AND r.status = 'ACTIVE'
         ORDER BY r.scope_type, r.scope_id, r.role_key`,
        [input.appId, input.actorUserId],
      )
      const authorization = currentAuthorization(bindingRows, {
        scopeType: 'EVENT',
        scopeId: input.eventId,
        branchId: event.branch_id || null,
      })

      const participationRow = await tx.one(
        `SELECT CURRENT_TIMESTAMP(3) AS calculated_at,
          SUM(CASE WHEN r.status IN (${EFFECTIVE_REGISTRATION_SQL}) THEN 1 ELSE 0 END)
            AS effective_registration_count,
          SUM(CASE WHEN r.status = 'PENDING_REVIEW' THEN 1 ELSE 0 END) AS pending_review_count,
          SUM(CASE WHEN r.status = 'WAITLISTED' THEN 1 ELSE 0 END) AS waitlisted_count
         FROM mip_events e
         LEFT JOIN mip_event_registrations r
           ON r.app_id = e.app_id AND r.event_id = e.id
         WHERE e.app_id = ? AND e.id = ?
         GROUP BY e.id`,
        [input.appId, input.eventId],
      )
      if (!participationRow) throw codeError('NOT_FOUND')

      const calculatedAt = dateValue(participationRow.calculated_at)
      const checkInRow = await tx.one(
        `SELECT COUNT(*) AS checked_in_count
         FROM mip_event_checkins c
         INNER JOIN mip_event_registrations r
           ON r.app_id = c.app_id
           AND r.id = c.registration_id
           AND r.event_id = c.event_id
           AND r.user_id = c.user_id
         WHERE c.app_id = ? AND c.event_id = ? AND c.status = 'ACTIVE'
           AND r.status IN (${EFFECTIVE_REGISTRATION_SQL})`,
        [input.appId, input.eventId],
      )
      const invitationRow = await tx.one(
        `SELECT COUNT(*) AS attributed_registration_count,
          COUNT(DISTINCT a.inviter_user_id) AS distinct_inviter_count
         FROM mip_event_invitation_attributions a
         INNER JOIN mip_event_registrations r
           ON r.app_id = a.app_id
           AND r.id = a.registration_id
           AND r.event_id = a.event_id
           AND r.user_id = a.guest_user_id
         WHERE a.app_id = ? AND a.event_id = ? AND a.source_type = 'USER'
           AND a.inviter_user_id IS NOT NULL
           AND r.status IN (${EFFECTIVE_REGISTRATION_SQL})`,
        [input.appId, input.eventId],
      )
      const compositionRow = await tx.one(
        `SELECT COUNT(*) AS effective_registration_count,
          SUM(CASE WHEN EXISTS (
            SELECT 1
            FROM mip_membership_entitlements entitlement
            WHERE entitlement.app_id = r.app_id
              AND entitlement.user_id = r.user_id
              AND entitlement.status = 'ACTIVE'
              AND entitlement.starts_at <= ?
              AND entitlement.ends_at > ?
          ) THEN 1 ELSE 0 END) AS player_count
         FROM mip_event_registrations r
         WHERE r.app_id = ? AND r.event_id = ?
           AND r.status IN (${EFFECTIVE_REGISTRATION_SQL})`,
        [calculatedAt, calculatedAt, input.appId, input.eventId],
      )
      const heartRow = await tx.one(
        `SELECT COUNT(*) AS voter_count,
          SUM(CASE WHEN h.status = 'ACTIVE' THEN 1 ELSE 0 END) AS active_vote_count
         FROM mip_event_hearts h
         WHERE h.app_id = ? AND h.event_id = ?`,
        [input.appId, input.eventId],
      )
      const mutualHeartRow = await tx.one(
        `SELECT COUNT(*) AS mutual_match_count
         FROM mip_event_hearts first_vote
         INNER JOIN mip_event_hearts reciprocal_vote
           ON reciprocal_vote.app_id = first_vote.app_id
           AND reciprocal_vote.event_id = first_vote.event_id
           AND reciprocal_vote.voter_user_id = first_vote.target_user_id
           AND reciprocal_vote.target_user_id = first_vote.voter_user_id
           AND reciprocal_vote.status = 'ACTIVE'
         WHERE first_vote.app_id = ? AND first_vote.event_id = ?
           AND first_vote.status = 'ACTIVE'
           AND first_vote.voter_user_id < reciprocal_vote.voter_user_id`,
        [input.appId, input.eventId],
      )

      let feedback = { access: 'RESTRICTED' }
      if (authorization.includeFeedback) {
        const feedbackRow = await tx.one(
          `SELECT COUNT(f.id) AS submission_count,
            COUNT(*) AS eligible_checkin_count,
            COUNT(f.rating) AS rated_count,
            AVG(f.rating) AS average_rating
           FROM mip_event_checkins c
           INNER JOIN mip_event_registrations r
             ON r.app_id = c.app_id
             AND r.id = c.registration_id
             AND r.event_id = c.event_id
             AND r.user_id = c.user_id
           LEFT JOIN mip_event_feedback f
             ON f.app_id = c.app_id
             AND f.event_id = c.event_id
             AND f.user_id = c.user_id
           WHERE c.app_id = ? AND c.event_id = ?`,
          [input.appId, input.eventId],
        )
        feedback = grantedFeedback(feedbackRow)
      }

      let financials = { access: 'RESTRICTED' }
      if (authorization.includeFinancials) {
        const orderRow = await tx.one(
          `SELECT COUNT(*) AS paid_order_count,
            COALESCE(SUM(o.amount_cents), 0) AS gross_amount_cents,
            MIN(o.currency) AS minimum_currency,
            MAX(o.currency) AS maximum_currency
           FROM mip_orders o
           WHERE o.app_id = ? AND o.order_type = 'EVENT' AND o.resource_id = ?
             AND o.paid_at IS NOT NULL`,
          [input.appId, input.eventId],
        )
        const refundRow = await tx.one(
          `SELECT COALESCE(SUM(refund.amount_cents), 0) AS refunded_amount_cents
           FROM mip_refunds refund
           INNER JOIN mip_orders o
             ON o.app_id = refund.app_id AND o.id = refund.order_id
           WHERE refund.app_id = ? AND o.app_id = ?
             AND o.order_type = 'EVENT' AND o.resource_id = ?
             AND refund.status = 'SUCCEEDED'`,
          [input.appId, input.appId, input.eventId],
        )
        financials = grantedFinancials(orderRow, refundRow)
      }

      return eventInsightsDto({
        eventId: input.eventId,
        calculatedAt,
        participationRow,
        checkInRow,
        invitationRow,
        compositionRow,
        heartRow,
        mutualHeartRow,
        feedback,
        financials,
      })
    }, 1)
  }

  return { getEventInsights }
}

function currentAuthorization(rows, scope) {
  const bindings = rows.map(row => ({
    scopeType: row.scope_type,
    scopeId: row.scope_type === 'PLATFORM' ? null : row.scope_id,
    roleKey: row.role_key,
    capabilities: capabilitiesForBinding({
      roleKey: row.role_key,
      policyCapabilities: Object.hasOwn(row, 'policy_capabilities_json')
        ? row.policy_capabilities_json
        : null,
    }),
  }))
  if (!hasScopedCapability(bindings, CAPABILITIES.EVENTS_READ, scope)) {
    throw codeError('FORBIDDEN')
  }
  return {
    includeFeedback: hasScopedCapability(bindings, CAPABILITIES.EVENTS_FEEDBACK_READ, scope),
    includeFinancials: hasScopedCapability(bindings, CAPABILITIES.ORDERS_READ, scope),
  }
}

function hasScopedCapability(bindings, capability, scope) {
  return bindings.some(binding => capabilitiesForBinding(binding).includes(capability)
    && coversScope(binding, scope))
}

function eventInsightsDto(input) {
  const effectiveRegistrationCount = count(input.participationRow, 'effective_registration_count')
  const checkedInCount = count(input.checkInRow, 'checked_in_count')
  const attributedRegistrationCount = count(input.invitationRow, 'attributed_registration_count')
  const distinctInviterCount = count(input.invitationRow, 'distinct_inviter_count')
  const compositionEffectiveCount = count(input.compositionRow, 'effective_registration_count')
  const playerCount = count(input.compositionRow, 'player_count')
  const voterCount = count(input.heartRow, 'voter_count')
  const activeVoteCount = count(input.heartRow, 'active_vote_count')
  const mutualMatchCount = count(input.mutualHeartRow, 'mutual_match_count')

  if (checkedInCount > effectiveRegistrationCount
    || attributedRegistrationCount > effectiveRegistrationCount
    || distinctInviterCount > attributedRegistrationCount
    || compositionEffectiveCount !== effectiveRegistrationCount
    || playerCount > effectiveRegistrationCount
    || activeVoteCount > voterCount
    || mutualMatchCount * 2 > activeVoteCount) {
    throw codeError('EVENT_INSIGHTS_INVALID_STATE')
  }

  return {
    eventId: input.eventId,
    calculatedAt: input.calculatedAt.toISOString(),
    participation: {
      effectiveRegistrationCount,
      checkedInCount,
      checkInRateBasisPoints: rateBasisPoints(checkedInCount, effectiveRegistrationCount),
      pendingReviewCount: count(input.participationRow, 'pending_review_count'),
      waitlistedCount: count(input.participationRow, 'waitlisted_count'),
    },
    invitations: { attributedRegistrationCount, distinctInviterCount },
    composition: {
      playerCount,
      guestCount: effectiveRegistrationCount - playerCount,
    },
    hearts: { voterCount, activeVoteCount, mutualMatchCount },
    feedback: input.feedback,
    financials: input.financials,
    traffic: {
      views: { availability: 'NOT_TRACKED', count: null },
      shares: { availability: 'NOT_TRACKED', count: null },
    },
  }
}

function grantedFeedback(row) {
  const submissionCount = count(row, 'submission_count')
  const eligibleCheckInCount = count(row, 'eligible_checkin_count')
  const ratedCount = count(row, 'rated_count')
  const averageRating = row?.average_rating === null || row?.average_rating === undefined
    ? null
    : Number(row.average_rating)
  if (ratedCount > submissionCount
    || submissionCount > eligibleCheckInCount
    || (ratedCount === 0 && averageRating !== null)
    || (ratedCount > 0 && (!Number.isFinite(averageRating) || averageRating < 1 || averageRating > 5))) {
    throw codeError('EVENT_INSIGHTS_INVALID_STATE')
  }
  return {
    access: 'GRANTED',
    submissionCount,
    eligibleCheckInCount,
    submissionRateBasisPoints: rateBasisPoints(submissionCount, eligibleCheckInCount),
    ratedCount,
    averageRating,
  }
}

function grantedFinancials(orderRow, refundRow) {
  const paidOrderCount = count(orderRow, 'paid_order_count')
  const grossAmountCents = count(orderRow, 'gross_amount_cents')
  const refundedAmountCents = count(refundRow, 'refunded_amount_cents')
  const minimumCurrency = orderRow?.minimum_currency ?? null
  const maximumCurrency = orderRow?.maximum_currency ?? null
  if (refundedAmountCents > grossAmountCents
    || (paidOrderCount === 0 && (minimumCurrency !== null || maximumCurrency !== null))
    || (paidOrderCount > 0 && (minimumCurrency !== 'CNY' || maximumCurrency !== 'CNY'))) {
    throw codeError('EVENT_INSIGHTS_INVALID_STATE')
  }
  return {
    access: 'GRANTED',
    currency: 'CNY',
    paidOrderCount,
    grossAmountCents,
    refundedAmountCents,
    netAmountCents: grossAmountCents - refundedAmountCents,
  }
}

function count(row, key) {
  const value = Number(row?.[key] || 0)
  if (!Number.isSafeInteger(value) || value < 0) throw codeError('EVENT_INSIGHTS_INVALID_STATE')
  return value
}

function rateBasisPoints(numerator, denominator) {
  return denominator === 0 ? null : Math.round((numerator / denominator) * 10_000)
}

function dateValue(value) {
  const date = value instanceof Date ? value : new Date(value)
  if (!Number.isFinite(date.getTime())) throw codeError('EVENT_INSIGHTS_INVALID_STATE')
  return date
}

function codeError(code) {
  const error = new Error(code)
  error.code = code
  return error
}

module.exports = {
  EFFECTIVE_REGISTRATION_STATUSES,
  createEventInsightsRepository,
  eventInsightsDto,
}
