'use strict'

const assert = require('node:assert/strict')
const { DatabaseSync } = require('node:sqlite')
const { describe, it } = require('node:test')
const { createAdminEvents } = require('../domain/events')
const {
  createEventInsightsRepository,
  eventInsightsDto,
} = require('../domain/event-insights')

const appId = 'wx-app'
const eventId = '11111111-1111-4111-8111-111111111111'
const actorUserId = 'user-a'
const branchId = 'branch-a'
const calculatedAt = new Date('2026-08-25T12:00:00.000Z')

function insightRows(sql, state) {
  if (sql.includes('SELECT id, scope_type, branch_id')) return state.event
  if (sql.includes('FROM mip_users')) return state.actor
  if (sql.includes('CURRENT_TIMESTAMP(3)')) {
    return {
      calculated_at: calculatedAt,
      effective_registration_count: 4,
      pending_review_count: 1,
      waitlisted_count: 2,
    }
  }
  if (sql.includes('AS checked_in_count')) return { checked_in_count: 3 }
  if (sql.includes('AS attributed_registration_count')) {
    return { attributed_registration_count: 2, distinct_inviter_count: 1 }
  }
  if (sql.includes('FROM mip_membership_entitlements')) {
    return { effective_registration_count: 4, player_count: 3 }
  }
  if (sql.includes('AS voter_count')) return { voter_count: 3, active_vote_count: 2 }
  if (sql.includes('AS mutual_match_count')) return { mutual_match_count: 1 }
  if (sql.includes('AS submission_count')) {
    return {
      submission_count: 2,
      eligible_checkin_count: 3,
      rated_count: 2,
      average_rating: 4.5,
    }
  }
  if (sql.includes('AS paid_order_count')) {
    return state.order
  }
  if (sql.includes('AS refunded_amount_cents')) return { refunded_amount_cents: 3_000 }
  assert.fail(`unexpected query: ${sql}`)
}

function databaseHarness(overrides = {}) {
  const calls = []
  let transactions = 0
  const state = {
    actor: { id: actorUserId },
    event: { id: eventId, scope_type: 'BRANCH', branch_id: branchId },
    bindings: [{
      scope_type: 'BRANCH',
      scope_id: branchId,
      role_key: 'BRANCH_ADMIN',
      policy_capabilities_json: null,
    }],
    order: {
      paid_order_count: 2,
      gross_amount_cents: 10_000,
      minimum_currency: 'CNY',
      maximum_currency: 'CNY',
    },
    ...overrides,
  }
  const tx = {
    async one(sql, params) {
      calls.push({ sql, params })
      return insightRows(sql, state)
    },
    async query(sql, params) {
      calls.push({ sql, params })
      if (sql.includes('FROM mip_admin_role_bindings')) return state.bindings
      assert.fail(`unexpected query: ${sql}`)
    },
  }
  return {
    calls,
    get transactions() { return transactions },
    database: {
      async transaction(work, attempts) {
        transactions += 1
        assert.equal(attempts, 1)
        return work(tx)
      },
    },
  }
}

function expectedResult(optionalAccess = 'GRANTED') {
  return {
    eventId,
    calculatedAt: calculatedAt.toISOString(),
    participation: {
      effectiveRegistrationCount: 4,
      checkedInCount: 3,
      checkInRateBasisPoints: 7_500,
      pendingReviewCount: 1,
      waitlistedCount: 2,
    },
    invitations: { attributedRegistrationCount: 2, distinctInviterCount: 1 },
    composition: { playerCount: 3, guestCount: 1 },
    hearts: { voterCount: 3, activeVoteCount: 2, mutualMatchCount: 1 },
    feedback: optionalAccess === 'GRANTED'
      ? {
          access: 'GRANTED',
          submissionCount: 2,
          eligibleCheckInCount: 3,
          submissionRateBasisPoints: 6_667,
          ratedCount: 2,
          averageRating: 4.5,
        }
      : { access: 'RESTRICTED' },
    financials: optionalAccess === 'GRANTED'
      ? {
          access: 'GRANTED',
          currency: 'CNY',
          paidOrderCount: 2,
          grossAmountCents: 10_000,
          refundedAmountCents: 3_000,
          netAmountCents: 7_000,
        }
      : { access: 'RESTRICTED' },
    traffic: {
      views: { availability: 'NOT_TRACKED', count: null },
      shares: { availability: 'NOT_TRACKED', count: null },
    },
  }
}

function executeFeedbackFixture(sql) {
  const fixture = new DatabaseSync(':memory:')
  try {
    fixture.exec(`
      CREATE TABLE mip_event_registrations (
        app_id TEXT, id TEXT, event_id TEXT, user_id TEXT
      );
      CREATE TABLE mip_event_checkins (
        app_id TEXT, event_id TEXT, registration_id TEXT, user_id TEXT, status TEXT
      );
      CREATE TABLE mip_event_feedback (
        id TEXT, app_id TEXT, event_id TEXT, user_id TEXT, rating INTEGER
      );
      INSERT INTO mip_event_registrations VALUES
        ('wx-app', 'registration-a', '${eventId}', 'user-valid'),
        ('wx-app', 'registration-b', '22222222-2222-4222-8222-222222222222', 'user-cross-event');
      INSERT INTO mip_event_checkins VALUES
        ('wx-app', '${eventId}', 'registration-a', 'user-valid', 'REVOKED'),
        ('wx-app', '${eventId}', 'registration-b', 'user-cross-event', 'ACTIVE'),
        ('wx-app', '${eventId}', 'registration-a', 'user-cross-user', 'ACTIVE');
      INSERT INTO mip_event_feedback VALUES
        ('feedback-valid', 'wx-app', '${eventId}', 'user-valid', 5),
        ('feedback-cross-event', 'wx-app', '${eventId}', 'user-cross-event', 1),
        ('feedback-cross-user', 'wx-app', '${eventId}', 'user-cross-user', 2);
    `)
    return { ...fixture.prepare(sql).get(appId, eventId) }
  }
  finally {
    fixture.close()
  }
}

describe('event insights repository', () => {
  it('calculates independent aggregates in one read-only app-scoped transaction', async () => {
    const harness = databaseHarness()
    const repository = createEventInsightsRepository(harness.database)

    const result = await repository.getEventInsights({
      appId,
      actorUserId,
      eventId,
    })

    assert.deepEqual(result, expectedResult())
    assert.equal(harness.transactions, 1)
    assert.equal(harness.calls.length, 12)
    for (const call of harness.calls) {
      assert.match(call.sql.trim(), /^SELECT/)
      assert.match(call.sql, /app_id/)
      assert.equal(call.params.includes(appId), true)
    }
    const compositionCall = harness.calls.find(call => call.sql.includes('mip_membership_entitlements'))
    assert.deepEqual(compositionCall.params, [calculatedAt, calculatedAt, appId, eventId])
    assert.match(compositionCall.sql, /status = 'ACTIVE'/)
    assert.match(compositionCall.sql, /starts_at <= \?/)
    assert.match(compositionCall.sql, /ends_at > \?/)
    const checkInCall = harness.calls.find(call => call.sql.includes('AS checked_in_count'))
    assert.match(checkInCall.sql, /r\.event_id = c\.event_id/)
    assert.match(checkInCall.sql, /r\.user_id = c\.user_id/)
    const invitationCall = harness.calls.find(call => call.sql.includes('AS attributed_registration_count'))
    assert.match(invitationCall.sql, /r\.event_id = a\.event_id/)
    assert.match(invitationCall.sql, /r\.user_id = a\.guest_user_id/)
    const feedbackCall = harness.calls.find(call => call.sql.includes('AS eligible_checkin_count'))
    assert.match(feedbackCall.sql, /r\.app_id = c\.app_id/)
    assert.match(feedbackCall.sql, /r\.id = c\.registration_id/)
    assert.match(feedbackCall.sql, /r\.event_id = c\.event_id/)
    assert.match(feedbackCall.sql, /r\.user_id = c\.user_id/)
    assert.match(feedbackCall.sql, /f\.app_id = c\.app_id/)
    assert.match(feedbackCall.sql, /f\.event_id = c\.event_id/)
    assert.match(feedbackCall.sql, /f\.user_id = c\.user_id/)
    assert.doesNotMatch(feedbackCall.sql, /c\.status = 'ACTIVE'/)
    assert.deepEqual(executeFeedbackFixture(feedbackCall.sql), {
      submission_count: 1,
      eligible_checkin_count: 1,
      rated_count: 1,
      average_rating: 5,
    })
    const orderCall = harness.calls.find(call => call.sql.includes('AS paid_order_count'))
    assert.match(orderCall.sql, /MIN\(o\.currency\) AS minimum_currency/)
    assert.match(orderCall.sql, /MAX\(o\.currency\) AS maximum_currency/)
  })

  it('re-evaluates custom policies in the transaction and skips restricted SQL', async () => {
    const harness = databaseHarness({
      bindings: [{
        scope_type: 'BRANCH',
        scope_id: branchId,
        role_key: 'BRANCH_ADMIN',
        policy_capabilities_json: ['events.read'],
      }],
    })
    const repository = createEventInsightsRepository(harness.database)

    const result = await repository.getEventInsights({
      appId,
      actorUserId,
      eventId,
    })

    assert.deepEqual(result, expectedResult('RESTRICTED'))
    assert.equal(harness.transactions, 1)
    assert.equal(harness.calls.length, 9)
    const sql = harness.calls.map(call => call.sql).join('\n')
    assert.doesNotMatch(sql, /mip_event_feedback/)
    assert.doesNotMatch(sql, /mip_orders/)
    assert.doesNotMatch(sql, /mip_refunds/)
    assert.match(harness.calls[0].sql, /FROM mip_events/)
    assert.match(harness.calls[1].sql, /FROM mip_users/)
    assert.match(harness.calls[2].sql, /mip_admin_role_bindings/)
    assert.match(harness.calls[2].sql, /mip_role_capability_policies/)
  })

  it('fails before aggregates when the current event scope or role no longer authorizes reads', async () => {
    for (const harness of [
      databaseHarness({
        event: { id: eventId, scope_type: 'BRANCH', branch_id: 'branch-b' },
      }),
      databaseHarness({ bindings: [] }),
      databaseHarness({ actor: null }),
    ]) {
      const repository = createEventInsightsRepository(harness.database)
      await assert.rejects(
        () => repository.getEventInsights({ appId, actorUserId, eventId }),
        error => error?.code === 'FORBIDDEN',
      )
      const sql = harness.calls.map(call => call.sql).join('\n')
      assert.doesNotMatch(sql, /CURRENT_TIMESTAMP/)
      assert.doesNotMatch(sql, /mip_event_feedback/)
      assert.doesNotMatch(sql, /mip_orders/)
      assert.doesNotMatch(sql, /mip_refunds/)
    }
  })

  it('fails closed when aggregate invariants disagree', () => {
    assert.throws(() => eventInsightsDto({
      eventId,
      calculatedAt,
      participationRow: {
        effective_registration_count: 1,
        pending_review_count: 0,
        waitlisted_count: 0,
      },
      checkInRow: { checked_in_count: 2 },
      invitationRow: { attributed_registration_count: 0, distinct_inviter_count: 0 },
      compositionRow: { effective_registration_count: 1, player_count: 0 },
      heartRow: { voter_count: 0, active_vote_count: 0 },
      mutualHeartRow: { mutual_match_count: 0 },
      feedback: { access: 'RESTRICTED' },
      financials: { access: 'RESTRICTED' },
    }), /EVENT_INSIGHTS_INVALID_STATE/)
  })

  it('does not label non-CNY order facts as CNY', async () => {
    const harness = databaseHarness({
      order: {
        paid_order_count: 1,
        gross_amount_cents: 1_000,
        minimum_currency: 'USD',
        maximum_currency: 'USD',
      },
    })
    const repository = createEventInsightsRepository(harness.database)

    await assert.rejects(
      () => repository.getEventInsights({ appId, actorUserId, eventId }),
      error => error?.code === 'EVENT_INSIGHTS_INVALID_STATE',
    )
  })
})

describe('event insights authorization', () => {
  function service(capture) {
    return createAdminEvents({
      access: {
        session: async () => ({
          caller: { appId, userId: actorUserId },
          bindings: [{ roleKey: 'EVENT_STAFF', scopeType: 'EVENT', scopeId: eventId }],
        }),
        eventAuthorization: async () => assert.fail('insight authorization must be transactional'),
      },
      repository: {
        getEventInsights: async (input) => {
          capture.push(input)
          return expectedResult('RESTRICTED')
        },
      },
      phoneEncryptionKey: 'unused',
    })
  }

  it('passes only the resolved actor to transactional authorization', async () => {
    const calls = []
    await service(calls).getEventInsights({}, { eventId })
    assert.deepEqual(calls, [{
      appId,
      actorUserId,
      eventId,
    }])
  })
})
