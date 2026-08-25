'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const {
  createDashboardOverviewRepository,
} = require('../domain/repositories/dashboard-overview')

const APP_ID = 'wx-dashboard'
const ACTOR_USER_ID = '10000000-0000-4000-8000-000000000001'
const BRANCH_ID = '20000000-0000-4000-8000-000000000002'
const OTHER_BRANCH_ID = '30000000-0000-4000-8000-000000000003'
const EVENT_ID = '40000000-0000-4000-8000-000000000004'
const AS_OF = new Date('2030-01-15T12:00:00.000Z')

function overviewInput(overrides = {}) {
  return {
    appId: APP_ID,
    actorUserId: ACTOR_USER_ID,
    scope: { type: 'AUTHORIZED', id: null },
    asOf: AS_OF,
    period: {
      preset: 'CUSTOM',
      startAt: new Date('2029-12-31T16:00:00.000Z'),
      endAt: AS_OF,
      comparisonStartAt: new Date('2029-12-17T20:00:00.000Z'),
      comparisonEndAt: new Date('2029-12-31T16:00:00.000Z'),
      granularity: 'DAY',
      bucketStartDates: ['2030-01-01', '2030-01-02'],
    },
    ...overrides,
  }
}

function defaultState() {
  return {
    actor: { id: ACTOR_USER_ID },
    branch: { id: BRANCH_ID, name: '深圳分会', status: 'ACTIVE' },
    event: { id: EVENT_ID, title: '测试活动', status: 'PUBLISHED', branch_id: BRANCH_ID },
    bindings: [{
      scope_type: 'PLATFORM',
      scope_id: '',
      role_key: 'PLATFORM_OWNER',
      policy_capabilities_json: null,
    }],
    people: {
      active_accounts: 10,
      new_accounts: 2,
      previous_new_accounts: 1,
      active_players: 4,
      profiled_users: 7,
      interacting_players_30d: 3,
    },
    visits: { recorded_profile_visits: 5, distinct_profile_visitors: 4 },
    expiring: { expiring_players: 1 },
    membershipSeries: [{
      bucket_start_date: '2030-01-01',
      initial_purchase_count: 1,
      first_renewal_count: 2,
      repeat_renewal_count: 1,
      eligible_purchase_count: 4,
      eligible_paid_amount_cents: 40_000,
      minimum_currency: 'CNY',
      maximum_currency: 'CNY',
    }],
    membershipComparison: {
      initial_purchase_count: 2,
      first_renewal_count: 1,
      repeat_renewal_count: 0,
      eligible_purchase_count: 3,
      eligible_paid_amount_cents: 25_000,
      minimum_currency: 'CNY',
      maximum_currency: 'CNY',
    },
    eventSummary: {
      total_events: 5,
      registration_open_events: 2,
      pending_review_registrations: 1,
    },
    scheduledSeries: [{ bucket_start_date: '2030-01-01', scheduled_event_count: 2 }],
    registrationSeries: [{ bucket_start_date: '2030-01-01', effective_registration_count: 3 }],
    previousRegistrations: { effective_registration_count: 2 },
    quality: { ended_event_count: 2, effective_registration_count: 4, checked_in_count: 3 },
    feedback: {
      submission_count: 2,
      eligible_checkin_count: 3,
      rated_count: 2,
      average_rating: 4.5,
    },
    financials: [{
      paid_order_count: 2,
      gross_amount_cents: 10_000,
      refunded_amount_cents: 2_000,
      minimum_currency: 'CNY',
      maximum_currency: 'CNY',
    }, {
      paid_order_count: 1,
      gross_amount_cents: 5_000,
      refunded_amount_cents: 0,
      minimum_currency: 'CNY',
      maximum_currency: 'CNY',
    }],
    opportunities: {
      total_opportunities: 4,
      published_opportunities: 2,
      published_lifecycle_opportunities: 3,
      opportunities_with_active_team: 1,
      active_referrals: 5,
    },
    opportunityContent: { published_cooperation_cards: 6, published_super_cases: 7 },
    tasks: { published_tasks: 8, successful_completions: 9, awarded_experience: 100 },
    eventActivity: [activity({
      activity_id: 'outbox:event',
      activity_kind: 'event.registration_confirmed',
      occurred_at: '2030-01-14T10:00:00.000Z',
      resource_type: 'EVENT',
      resource_id: EVENT_ID,
      resource_title: '测试活动',
      scope_type: 'EVENT',
      scope_id: EVENT_ID,
    })],
    membershipActivity: [activity({
      activity_id: 'outbox:membership',
      activity_kind: 'membership.payment_confirmed',
      occurred_at: '2030-01-13T10:00:00.000Z',
      resource_type: 'ORDER',
      resource_id: 'order-a',
      scope_type: 'PLATFORM',
      scope_id: null,
    })],
    taskActivity: [activity({
      activity_id: 'outbox:task',
      activity_kind: 'task.completed',
      occurred_at: '2030-01-12T10:00:00.000Z',
      resource_type: 'TASK',
      resource_id: 'task-a',
      resource_title: '完成档案',
      scope_type: 'PLATFORM',
      scope_id: null,
    })],
    auditActivity: [activity({
      activity_id: 'audit:1',
      activity_kind: 'admin.events.update',
      occurred_at: '2030-01-11T10:00:00.000Z',
      resource_type: 'EVENT',
      resource_id: EVENT_ID,
      scope_type: 'EVENT',
      scope_id: EVENT_ID,
    })],
  }
}

function activity(overrides) {
  return {
    actor_user_id: ACTOR_USER_ID,
    actor_display_name: '运营成员',
    resource_title: null,
    ...overrides,
  }
}

function databaseHarness(overrides = {}) {
  const state = { ...defaultState(), ...overrides }
  const calls = []
  let transactionCount = 0
  let financialRead = 0
  const tx = {
    async one(sql, params) {
      calls.push({ type: 'one', sql, params })
      if (sql.includes('SELECT actor.id')) {
        return state.actor
      }
      if (sql.includes('FROM mip_city_branches branch')) {
        return state.branch
      }
      if (sql.includes('FROM mip_events event') && sql.includes('event.title')) {
        return state.event
      }
      if (sql.includes('AS active_accounts')) {
        return state.people
      }
      if (sql.includes('AS recorded_profile_visits')) {
        return state.visits
      }
      if (sql.includes('AS expiring_players')) {
        return state.expiring
      }
      if (sql.includes('WITH membership_purchases')) {
        return state.membershipComparison
      }
      if (sql.includes('AS registration_open_events')) {
        return state.eventSummary
      }
      if (sql.includes('SELECT COUNT(*) AS effective_registration_count')) {
        return state.previousRegistrations
      }
      if (sql.includes('AS ended_event_count')) {
        return state.quality
      }
      if (sql.includes('AVG(feedback.rating)')) {
        return state.feedback
      }
      if (sql.includes('AS paid_order_count')) {
        const result = state.financials[financialRead]
        financialRead += 1
        return result
      }
      if (sql.includes('AS total_opportunities')) {
        return state.opportunities
      }
      if (sql.includes('AS published_cooperation_cards')) {
        return state.opportunityContent
      }
      if (sql.includes('AS published_tasks')) {
        return state.tasks
      }
      assert.fail(`unexpected one query: ${sql}`)
    },
    async query(sql, params) {
      calls.push({ type: 'query', sql, params })
      if (sql.includes('FROM mip_admin_role_bindings binding')) {
        return state.bindings
      }
      if (sql.includes('WITH membership_purchases')) {
        return state.membershipSeries
      }
      if (sql.includes('AS scheduled_event_count')) {
        return state.scheduledSeries
      }
      if (sql.includes('AS effective_registration_count')) {
        return state.registrationSeries
      }
      if (sql.includes('outbox.event_type = \'event.registration_confirmed\'')) {
        return state.eventActivity
      }
      if (sql.includes('outbox.event_type = \'membership.payment_confirmed\'')) {
        return state.membershipActivity
      }
      if (sql.includes('outbox.event_type = \'task.completed\'')) {
        return state.taskActivity
      }
      if (sql.includes('FROM mip_audit_logs audit')) {
        return state.auditActivity
      }
      assert.fail(`unexpected query: ${sql}`)
    },
  }
  return {
    calls,
    state,
    get transactionCount() {
      return transactionCount
    },
    database: {
      async transaction(work, attempts) {
        transactionCount += 1
        calls.push({ type: 'transaction', attempts })
        return work(tx)
      },
    },
  }
}

function aggregateCalls(harness) {
  return harness.calls.filter(call => call.sql && !call.sql.includes('mip_admin_role_bindings'))
}

function assertPlaceholderCounts(harness) {
  for (const call of harness.calls.filter(item => item.sql)) {
    const placeholderCount = call.sql.match(/\?/g)?.length || 0
    assert.equal(
      call.params.length,
      placeholderCount,
      `placeholder mismatch in ${call.sql.slice(0, 80)}`,
    )
  }
}

describe('dashboard overview repository', () => {
  it('returns app-scoped factual sections, comparisons, and five-state unknowns in one transaction', async () => {
    const harness = databaseHarness()
    const repository = createDashboardOverviewRepository(harness.database)

    const result = await repository.readOverviewSnapshot(overviewInput())

    assert.equal(harness.transactionCount, 1)
    assert.equal(harness.calls[0].attempts, 1)
    assertPlaceholderCounts(harness)
    assert.deepEqual(result.scope, { type: 'AUTHORIZED', id: null })
    const comparisonNotProvided = {
      availability: 'NOT_PROVIDED',
      previousCount: null,
      deltaCount: null,
      changeBasisPoints: null,
    }
    assert.deepEqual(result.people.activePlayers, {
      availability: 'AVAILABLE',
      count: 4,
      comparison: comparisonNotProvided,
    })
    assert.deepEqual(result.people.guests, {
      availability: 'AVAILABLE',
      count: 6,
      comparison: comparisonNotProvided,
    })
    assert.deepEqual(result.people.newAccounts, {
      availability: 'AVAILABLE',
      count: 2,
      comparison: {
        availability: 'AVAILABLE',
        previousCount: 1,
        deltaCount: 1,
        changeBasisPoints: 10_000,
      },
    })
    assert.deepEqual(result.membership.purchaseFlow.firstRenewals.comparison, {
      availability: 'AVAILABLE',
      previousCount: 1,
      deltaCount: 1,
      changeBasisPoints: 10_000,
    })
    assert.deepEqual(result.membership.purchaseFlow.eligiblePaidAmount.comparison, {
      availability: 'AVAILABLE',
      previousAmountCents: 25_000,
      deltaAmountCents: 15_000,
      changeBasisPoints: 6_000,
    })
    assert.deepEqual(result.events.effectiveRegistrations.comparison, {
      availability: 'AVAILABLE',
      previousCount: 2,
      deltaCount: 1,
      changeBasisPoints: 5_000,
    })
    assert.deepEqual(result.events.financials.netAmount, {
      availability: 'AVAILABLE',
      amountCents: 8_000,
      currency: 'CNY',
      comparison: {
        availability: 'AVAILABLE',
        previousAmountCents: 5_000,
        deltaAmountCents: 3_000,
        changeBasisPoints: 6_000,
      },
    })
    assert.deepEqual(result.events.traffic, {
      views: { availability: 'NOT_TRACKED', count: null },
      shares: { availability: 'NOT_TRACKED', count: null },
    })
    assert.deepEqual(result.opportunities.trueConversionRate, {
      availability: 'NOT_TRACKED',
      basisPoints: null,
      numerator: null,
      denominator: null,
    })
    assert.equal(result.tasks.pendingReview.availability, 'NOT_PROVIDED')
    assert.deepEqual(result.operations.activity.map(item => item.kind), [
      'event.registration_confirmed',
      'membership.payment_confirmed',
      'task.completed',
      'admin.events.update',
    ])
    assert.equal(Object.hasOwn(result.operations.activity[0], 'payload'), false)
    assert.equal(Object.hasOwn(result.operations.activity[0], 'metadata'), false)

    for (const call of aggregateCalls(harness)) {
      assert.match(call.sql, /app_id/)
    }
    const activitySql = harness.calls
      .filter(call => /mip_outbox_events|mip_audit_logs/.test(call.sql || ''))
      .map(call => call.sql)
      .join('\n')
    assert.doesNotMatch(activitySql, /payload_json|metadata_json/)
    assert.match(activitySql, /event\.registration_confirmed/)
    assert.match(activitySql, /membership\.payment_confirmed/)
    assert.match(activitySql, /task\.completed/)

    const peopleSql = harness.calls.find(call => call.sql?.includes('AS active_accounts')).sql
    assert.match(peopleSql, /visit\.visited_at >= \? AND visit\.visited_at < \?/)
    assert.match(peopleSql, /interest\.updated_at >= \? AND interest\.updated_at < \?/)
    assert.match(peopleSql, /referral\.updated_at >= \? AND referral\.updated_at < \?/)
    assert.match(peopleSql, /heart\.updated_at >= \? AND heart\.updated_at < \?/)

    const comparisonPurchaseCall = harness.calls.find(call => call.type === 'one'
      && call.sql?.includes('WITH membership_purchases'))
    assert.deepEqual(comparisonPurchaseCall.params.slice(-2), [
      overviewInput().period.comparisonStartAt,
      overviewInput().period.comparisonEndAt,
    ])
    const comparisonRegistrationCall = harness.calls.find(call => call.type === 'one'
      && call.sql?.includes('SELECT COUNT(*) AS effective_registration_count'))
    assert.deepEqual(comparisonRegistrationCall.params.slice(1, 3), [
      overviewInput().period.comparisonStartAt,
      overviewInput().period.comparisonEndAt,
    ])
    const financialCalls = harness.calls.filter(call => call.type === 'one'
      && call.sql?.includes('AS paid_order_count'))
    assert.equal(financialCalls.length, 2)
    assert.deepEqual(financialCalls[1].params.slice(-2), [
      overviewInput().period.comparisonStartAt,
      overviewInput().period.comparisonEndAt,
    ])
  })

  it('returns branch membership history as not provided while retaining reliable branch event revenue', async () => {
    const harness = databaseHarness({
      bindings: [{
        scope_type: 'BRANCH',
        scope_id: BRANCH_ID,
        role_key: 'BRANCH_ADMIN',
        policy_capabilities_json: null,
      }],
    })
    const repository = createDashboardOverviewRepository(harness.database)

    const result = await repository.readOverviewSnapshot(overviewInput({
      scope: { type: 'BRANCH', id: BRANCH_ID },
    }))

    assert.deepEqual(result.scope, {
      type: 'BRANCH',
      id: BRANCH_ID,
      name: '深圳分会',
      status: 'ACTIVE',
    })
    assert.deepEqual(result.membership.purchaseFlow, {
      availability: 'NOT_PROVIDED',
      reasonCode: 'HISTORICAL_BRANCH_ATTRIBUTION_NOT_PROVIDED',
    })
    assert.equal(result.events.financials.availability, 'AVAILABLE')
    assert.equal(result.opportunities.publishedCooperationCards.availability, 'NOT_PROVIDED')
    assert.equal(result.tasks.availability, 'NOT_APPLICABLE')
    assertPlaceholderCounts(harness)
    const sql = harness.calls.map(call => call.sql || '').join('\n')
    assert.doesNotMatch(sql, /WITH membership_purchases/)
    assert.doesNotMatch(sql, /membership\.payment_confirmed/)
    assert.match(sql, /event\.branch_id IN \(\?\)/)
  })

  it('keeps event-owner overview strictly on the selected app-owned event', async () => {
    const harness = databaseHarness({
      bindings: [{
        scope_type: 'EVENT',
        scope_id: EVENT_ID,
        role_key: 'EVENT_OWNER',
        policy_capabilities_json: null,
      }],
    })
    const repository = createDashboardOverviewRepository(harness.database)

    const result = await repository.readOverviewSnapshot(overviewInput({
      scope: { type: 'EVENT', id: EVENT_ID },
    }))

    assert.deepEqual(result.scope, {
      type: 'EVENT',
      id: EVENT_ID,
      name: '测试活动',
      status: 'PUBLISHED',
      branchId: BRANCH_ID,
    })
    assert.equal(result.people.availability, 'NOT_APPLICABLE')
    assert.equal(result.membership.availability, 'NOT_APPLICABLE')
    assert.equal(result.events.availability, 'AVAILABLE')
    assert.equal(result.opportunities.availability, 'NOT_APPLICABLE')
    assert.equal(result.tasks.availability, 'NOT_APPLICABLE')
    assert.deepEqual(result.operations.activity.map(item => item.kind), [
      'event.registration_confirmed',
      'admin.events.update',
    ])
    assertPlaceholderCounts(harness)
    const sql = harness.calls.map(call => call.sql || '').join('\n')
    assert.match(sql, /event\.id IN \(\?\)/)
    assert.doesNotMatch(sql, /membership\.payment_confirmed|task\.completed/)
  })

  it('does not query protected sections when a current custom policy only grants dashboard entry', async () => {
    const harness = databaseHarness({
      bindings: [{
        scope_type: 'PLATFORM',
        scope_id: '',
        role_key: 'PLATFORM_OPERATIONS',
        policy_capabilities_json: ['admin.dashboard'],
      }],
    })
    const repository = createDashboardOverviewRepository(harness.database)

    const result = await repository.readOverviewSnapshot(overviewInput())

    assert.equal(result.people.availability, 'RESTRICTED')
    assert.equal(result.membership.availability, 'RESTRICTED')
    assert.equal(result.events.availability, 'RESTRICTED')
    assert.equal(result.opportunities.availability, 'RESTRICTED')
    assert.equal(result.tasks.availability, 'RESTRICTED')
    assert.equal(result.operations.availability, 'RESTRICTED')
    assert.equal(harness.calls.filter(call => call.sql).length, 2)
  })

  it('fails before aggregates for cross-app targets and unauthorized scopes', async () => {
    const missing = databaseHarness({ branch: null })
    await assert.rejects(
      () => createDashboardOverviewRepository(missing.database).readOverviewSnapshot(overviewInput({
        scope: { type: 'BRANCH', id: BRANCH_ID },
      })),
      error => error?.code === 'NOT_FOUND',
    )
    assert.equal(aggregateCalls(missing).length, 2)

    const denied = databaseHarness({
      bindings: [{
        scope_type: 'BRANCH',
        scope_id: OTHER_BRANCH_ID,
        role_key: 'BRANCH_ADMIN',
        policy_capabilities_json: null,
      }],
    })
    await assert.rejects(
      () => createDashboardOverviewRepository(denied.database).readOverviewSnapshot(overviewInput({
        scope: { type: 'BRANCH', id: BRANCH_ID },
      })),
      error => error?.code === 'FORBIDDEN',
    )
    const deniedSql = denied.calls.map(call => call.sql || '').join('\n')
    assert.doesNotMatch(deniedSql, /AS active_accounts|AS total_opportunities/)
  })

  it('fails closed when aggregate relationships or activity kinds are impossible', async () => {
    const invalidCounts = databaseHarness({
      people: {
        ...defaultState().people,
        active_players: 11,
      },
    })
    await assert.rejects(
      () => createDashboardOverviewRepository(invalidCounts.database)
        .readOverviewSnapshot(overviewInput()),
      error => error?.code === 'DASHBOARD_OVERVIEW_INVALID_STATE',
    )

    const invalidActivity = databaseHarness({
      eventActivity: [activity({
        activity_id: 'outbox:unsafe',
        activity_kind: 'unsafe.raw_event',
        occurred_at: '2030-01-14T10:00:00.000Z',
        resource_type: 'EVENT',
        resource_id: EVENT_ID,
        scope_type: 'EVENT',
        scope_id: EVENT_ID,
      })],
    })
    await assert.rejects(
      () => createDashboardOverviewRepository(invalidActivity.database)
        .readOverviewSnapshot(overviewInput()),
      error => error?.code === 'DASHBOARD_OVERVIEW_INVALID_STATE',
    )
  })
})
