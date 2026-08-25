'use strict'

const {
  CAPABILITIES,
  capabilitiesForBinding,
  coversScope,
  isValidRoleBinding,
} = require('../capabilities')

const EFFECTIVE_REGISTRATION_STATUSES = Object.freeze([
  'REGISTERED',
  'CANCELLATION_PENDING',
  'ATTENDED',
])
const EFFECTIVE_REGISTRATION_SQL = EFFECTIVE_REGISTRATION_STATUSES
  .map(status => `'${status}'`)
  .join(', ')
const VALID_ENTITLEMENT_STATUSES = Object.freeze(['ACTIVE', 'EXPIRED'])
const VALID_ENTITLEMENT_SQL = VALID_ENTITLEMENT_STATUSES.map(status => `'${status}'`).join(', ')
const AVAILABILITY = Object.freeze({
  AVAILABLE: 'AVAILABLE',
  RESTRICTED: 'RESTRICTED',
  NOT_TRACKED: 'NOT_TRACKED',
  NOT_APPLICABLE: 'NOT_APPLICABLE',
  NOT_PROVIDED: 'NOT_PROVIDED',
})
const AUDIT_ACTIVITY_ACTIONS = Object.freeze([
  'admin.branches.create',
  'admin.branches.status.change',
  'admin.branches.update',
  'admin.events.create',
  'admin.events.status.change',
  'admin.events.update',
  'admin.opportunities.create',
  'admin.opportunities.end',
  'admin.opportunities.publish',
  'admin.users.access.activate',
  'admin.users.access.revoke',
  'admin.users.fields.update',
])
const OUTBOX_ACTIVITY_TYPES = Object.freeze([
  'event.registration_confirmed',
  'membership.payment_confirmed',
  'task.completed',
])
const OUTBOX_ACTIVITY_SHAPES = Object.freeze({
  'event.registration_confirmed': Object.freeze({ resourceType: 'EVENT', scopeType: 'EVENT' }),
  'membership.payment_confirmed': Object.freeze({ resourceType: 'ORDER', scopeType: 'PLATFORM' }),
  'task.completed': Object.freeze({ resourceType: 'TASK', scopeType: 'PLATFORM' }),
})
const ACTIVITY_SCOPE_TYPES = Object.freeze(['PLATFORM', 'BRANCH', 'EVENT', 'RESOURCE'])
const DAY_MS = 86_400_000

function createDashboardOverviewRepository(database) {
  if (!database || typeof database.transaction !== 'function') {
    throw new TypeError('DASHBOARD_OVERVIEW_DATABASE_REQUIRED')
  }

  async function readOverviewSnapshot(input) {
    return database.transaction(async (tx) => {
      const actor = await tx.one(
        `SELECT actor.id
         FROM mip_users actor
         WHERE actor.app_id = ? AND actor.id = ? AND actor.status = 'ACTIVE'`,
        [input.appId, input.actorUserId],
      )
      if (!actor) {
        throw codeError('FORBIDDEN')
      }

      const rows = await tx.query(
        `SELECT binding.scope_type, binding.scope_id, binding.role_key,
          CASE WHEN policy.policy_mode = 'CUSTOM' THEN policy.capabilities_json ELSE NULL END
            AS policy_capabilities_json
         FROM mip_admin_role_bindings binding
         LEFT JOIN mip_role_capability_policies policy
           ON policy.app_id = binding.app_id AND policy.role_key = binding.role_key
         WHERE binding.app_id = ? AND binding.user_id = ? AND binding.status = 'ACTIVE'
         ORDER BY binding.scope_type, binding.scope_id, binding.role_key`,
        [input.appId, input.actorUserId],
      )
      const bindings = roleBindings(rows)
      const dashboardBindings = bindingsWith(bindings, CAPABILITIES.DASHBOARD)
      if (!dashboardBindings.length) {
        throw codeError('FORBIDDEN')
      }

      const resolvedScope = await resolveScope(tx, input.appId, input.scope)
      if (resolvedScope.target
        && !dashboardBindings.some(binding => coversScope(binding, resolvedScope.target))) {
        throw codeError('FORBIDDEN')
      }

      const visibility = capability => requestVisibility(
        dashboardBindings,
        bindingsWith(bindings, capability),
        resolvedScope.target,
      )
      const peopleResult = await readPeople(tx, input, resolvedScope, visibility(CAPABILITIES.USERS_READ))
      const membership = await readMembership(
        tx,
        input,
        resolvedScope,
        visibility(CAPABILITIES.USERS_READ),
        visibility(CAPABILITIES.ORDERS_READ),
        peopleResult.activePlayers,
      )
      const eventsVisibility = visibility(CAPABILITIES.EVENTS_READ)
      const events = await readEvents(tx, input, resolvedScope, {
        events: eventsVisibility,
        feedback: visibility(CAPABILITIES.EVENTS_FEEDBACK_READ),
        orders: visibility(CAPABILITIES.ORDERS_READ),
      })
      const opportunities = await readOpportunities(
        tx,
        input,
        resolvedScope,
        visibility(CAPABILITIES.OPPORTUNITIES_MODERATE),
      )
      const tasksVisibility = visibility(CAPABILITIES.TASKS_MANAGE)
      const tasks = await readTasks(tx, input, resolvedScope, tasksVisibility)
      const operations = await readOperations(tx, input, resolvedScope, {
        audit: visibility(CAPABILITIES.AUDIT_READ),
        events: eventsVisibility,
        orders: visibility(CAPABILITIES.ORDERS_READ),
        tasks: tasksVisibility,
      })

      return {
        scope: resolvedScope.publicScope,
        people: peopleResult.dto,
        membership,
        events,
        opportunities,
        tasks,
        operations,
      }
    }, 1)
  }

  return { readOverviewSnapshot }
}

async function resolveScope(tx, appId, requested) {
  if (requested.type === 'AUTHORIZED') {
    return { target: null, publicScope: { type: 'AUTHORIZED', id: null } }
  }
  if (requested.type === 'PLATFORM') {
    return {
      target: { scopeType: 'PLATFORM', scopeId: null },
      publicScope: { type: 'PLATFORM', id: null },
    }
  }
  if (requested.type === 'BRANCH') {
    const branch = await tx.one(
      `SELECT branch.id, branch.name, branch.status
       FROM mip_city_branches branch
       WHERE branch.app_id = ? AND branch.id = ?`,
      [appId, requested.id],
    )
    if (!branch) {
      throw codeError('NOT_FOUND')
    }
    return {
      target: { scopeType: 'BRANCH', scopeId: branch.id },
      publicScope: {
        type: 'BRANCH',
        id: branch.id,
        name: safeText(branch.name),
        status: safeText(branch.status),
      },
    }
  }
  const event = await tx.one(
    `SELECT event.id, event.title, event.status, event.branch_id
     FROM mip_events event
     WHERE event.app_id = ? AND event.id = ?`,
    [appId, requested.id],
  )
  if (!event) {
    throw codeError('NOT_FOUND')
  }
  return {
    target: {
      scopeType: 'EVENT',
      scopeId: event.id,
      branchId: event.branch_id || null,
    },
    publicScope: {
      type: 'EVENT',
      id: event.id,
      name: safeText(event.title),
      status: safeText(event.status),
      branchId: event.branch_id || null,
    },
  }
}

function roleBindings(rows) {
  if (!Array.isArray(rows)) {
    throw codeError('DASHBOARD_OVERVIEW_INVALID_STATE')
  }
  return rows.map((row) => {
    const binding = {
      roleKey: row.role_key,
      scopeType: row.scope_type,
      scopeId: row.scope_type === 'PLATFORM' ? null : row.scope_id,
      capabilities: capabilitiesForBinding({
        roleKey: row.role_key,
        policyCapabilities: Object.hasOwn(row, 'policy_capabilities_json')
          ? row.policy_capabilities_json
          : null,
      }),
    }
    return binding
  }).filter(isValidRoleBinding)
}

function bindingsWith(bindings, capability) {
  return bindings.filter(binding => capabilitiesForBinding(binding).includes(capability))
}

function requestVisibility(dashboardBindings, capabilityBindings, target) {
  if (target) {
    const dashboardGranted = dashboardBindings.some(binding => coversScope(binding, target))
    const capabilityGranted = capabilityBindings.some(binding => coversScope(binding, target))
    return dashboardGranted && capabilityGranted ? targetVisibility(target) : null
  }
  return intersectBindings(dashboardBindings, capabilityBindings)
}

function targetVisibility(target) {
  if (target.scopeType === 'PLATFORM') {
    return visibility({ platform: true })
  }
  if (target.scopeType === 'BRANCH') {
    return visibility({ branchIds: [target.scopeId] })
  }
  return visibility({ eventIds: [target.scopeId] })
}

function intersectBindings(dashboardBindings, capabilityBindings) {
  const result = visibility()
  for (const dashboardBinding of dashboardBindings) {
    for (const capabilityBinding of capabilityBindings) {
      addBindingIntersection(result, dashboardBinding, capabilityBinding)
      if (result.platform) {
        return result
      }
    }
  }
  return hasVisibility(result) ? result : null
}

function addBindingIntersection(result, first, second) {
  if (first.scopeType === 'PLATFORM') {
    addBindingScope(result, second)
    return
  }
  if (second.scopeType === 'PLATFORM') {
    addBindingScope(result, first)
    return
  }
  if (first.scopeType === second.scopeType && first.scopeId === second.scopeId) {
    addBindingScope(result, first)
    return
  }
  const branch = first.scopeType === 'BRANCH' ? first : second.scopeType === 'BRANCH' ? second : null
  const event = first.scopeType === 'EVENT' ? first : second.scopeType === 'EVENT' ? second : null
  if (branch && event) {
    result.eventRestrictions.set(`${event.scopeId}:${branch.scopeId}`, {
      eventId: event.scopeId,
      branchId: branch.scopeId,
    })
  }
}

function addBindingScope(result, binding) {
  if (binding.scopeType === 'PLATFORM') {
    result.platform = true
    result.branchIds.clear()
    result.eventIds.clear()
    result.eventRestrictions.clear()
  }
  else if (!result.platform && binding.scopeType === 'BRANCH') {
    result.branchIds.add(binding.scopeId)
  }
  else if (!result.platform && binding.scopeType === 'EVENT') {
    result.eventIds.add(binding.scopeId)
  }
}

function visibility(input = {}) {
  return {
    platform: input.platform === true,
    branchIds: new Set(input.branchIds || []),
    eventIds: new Set(input.eventIds || []),
    eventRestrictions: new Map(),
  }
}

function hasVisibility(value) {
  return Boolean(value?.platform
    || value?.branchIds.size
    || value?.eventIds.size
    || value?.eventRestrictions.size)
}

async function readPeople(tx, input, scope, userVisibility) {
  if (scope.publicScope.type === 'EVENT') {
    return { dto: unavailableSection(AVAILABILITY.NOT_APPLICABLE), activePlayers: null }
  }
  const userScope = userWhere(userVisibility, 'user')
  if (!userScope) {
    return { dto: unavailableSection(AVAILABILITY.RESTRICTED), activePlayers: null }
  }
  const interactionCutoff = new Date(input.asOf.getTime() - 30 * DAY_MS)
  const row = await tx.one(
    `SELECT COUNT(*) AS active_accounts,
      COALESCE(SUM(CASE WHEN user.created_at >= ? AND user.created_at < ? THEN 1 ELSE 0 END), 0)
        AS new_accounts,
      COALESCE(SUM(CASE WHEN user.created_at >= ? AND user.created_at < ? THEN 1 ELSE 0 END), 0)
        AS previous_new_accounts,
      COALESCE(SUM(CASE WHEN EXISTS (
        SELECT 1 FROM mip_membership_entitlements entitlement
        WHERE entitlement.app_id = user.app_id AND entitlement.user_id = user.id
          AND entitlement.status = 'ACTIVE'
          AND entitlement.starts_at <= ? AND entitlement.ends_at > ?
      ) THEN 1 ELSE 0 END), 0) AS active_players,
      COALESCE(SUM(CASE WHEN EXISTS (
        SELECT 1 FROM mip_profiles profile
        WHERE profile.app_id = user.app_id AND profile.user_id = user.id
      ) THEN 1 ELSE 0 END), 0) AS profiled_users,
      COALESCE(SUM(CASE WHEN EXISTS (
        SELECT 1 FROM mip_membership_entitlements entitlement
        WHERE entitlement.app_id = user.app_id AND entitlement.user_id = user.id
          AND entitlement.status = 'ACTIVE'
          AND entitlement.starts_at <= ? AND entitlement.ends_at > ?
      ) AND (
        EXISTS (SELECT 1 FROM mip_profile_visits visit
          WHERE visit.app_id = user.app_id AND visit.visitor_user_id = user.id
            AND visit.visited_at >= ? AND visit.visited_at < ?)
        OR EXISTS (SELECT 1 FROM mip_profile_interests interest
          WHERE interest.app_id = user.app_id AND interest.actor_user_id = user.id
            AND interest.updated_at >= ? AND interest.updated_at < ?)
        OR EXISTS (SELECT 1 FROM mip_referral_intents referral
          WHERE referral.app_id = user.app_id AND referral.actor_user_id = user.id
            AND referral.updated_at >= ? AND referral.updated_at < ?)
        OR EXISTS (SELECT 1 FROM mip_event_hearts heart
          WHERE heart.app_id = user.app_id AND heart.voter_user_id = user.id
            AND heart.updated_at >= ? AND heart.updated_at < ?)
      ) THEN 1 ELSE 0 END), 0) AS interacting_players_30d
     FROM mip_users user
     WHERE user.app_id = ? AND user.status = 'ACTIVE' AND ${userScope.sql}`,
    [
      input.period.startAt,
      input.period.endAt,
      input.period.comparisonStartAt,
      input.period.comparisonEndAt,
      input.asOf,
      input.asOf,
      input.asOf,
      input.asOf,
      interactionCutoff,
      input.asOf,
      interactionCutoff,
      input.asOf,
      interactionCutoff,
      input.asOf,
      interactionCutoff,
      input.asOf,
      input.appId,
      ...userScope.params,
    ],
  )
  const visitRow = await tx.one(
    `SELECT COUNT(*) AS recorded_profile_visits,
      COUNT(DISTINCT visit.visitor_user_id) AS distinct_profile_visitors
     FROM mip_profile_visits visit
     INNER JOIN mip_users user
       ON user.app_id = visit.app_id AND user.id = visit.profile_user_id
     WHERE visit.app_id = ? AND visit.visited_at >= ? AND visit.visited_at < ?
       AND user.status = 'ACTIVE' AND ${userScope.sql}`,
    [input.appId, input.period.startAt, input.period.endAt, ...userScope.params],
  )
  const activeAccounts = count(row, 'active_accounts')
  const activePlayers = count(row, 'active_players')
  const newAccounts = count(row, 'new_accounts')
  const previousNewAccounts = count(row, 'previous_new_accounts')
  const profiledUsers = count(row, 'profiled_users')
  const interactingPlayers30d = count(row, 'interacting_players_30d')
  const recordedProfileVisits = count(visitRow, 'recorded_profile_visits')
  const distinctProfileVisitors = count(visitRow, 'distinct_profile_visitors')
  if (activePlayers > activeAccounts
    || newAccounts > activeAccounts
    || previousNewAccounts > activeAccounts
    || profiledUsers > activeAccounts
    || interactingPlayers30d > activePlayers
    || distinctProfileVisitors > recordedProfileVisits) {
    throw codeError('DASHBOARD_OVERVIEW_INVALID_STATE')
  }
  return {
    activePlayers,
    dto: {
      availability: AVAILABILITY.AVAILABLE,
      activeAccounts: countMetric(activeAccounts),
      activePlayers: countMetric(activePlayers),
      guests: countMetric(activeAccounts - activePlayers),
      newAccounts: countMetric(newAccounts, previousNewAccounts),
      profiledUsers: countMetric(profiledUsers),
      interactingPlayers30d: countMetric(interactingPlayers30d),
      playerInteractionRate30d: rateMetric(interactingPlayers30d, activePlayers),
      recordedProfileVisits: countMetric(recordedProfileVisits),
      distinctProfileVisitors: countMetric(distinctProfileVisitors),
    },
  }
}

async function readMembership(tx, input, scope, userVisibility, orderVisibility, activePlayers) {
  const scopeType = scope.publicScope.type
  if (scopeType === 'EVENT') {
    return {
      availability: AVAILABILITY.NOT_APPLICABLE,
      currentPlayers: unavailableCount(AVAILABILITY.NOT_APPLICABLE),
      expiringPlayers30d: unavailableCount(AVAILABILITY.NOT_APPLICABLE),
      purchaseFlow: unavailableSection(AVAILABILITY.NOT_APPLICABLE),
    }
  }

  let currentPlayers = unavailableCount(AVAILABILITY.RESTRICTED)
  let expiringPlayers30d = unavailableCount(AVAILABILITY.RESTRICTED)
  const userScope = userWhere(userVisibility, 'user')
  if (userScope && activePlayers !== null) {
    const expiryRow = await tx.one(
      `SELECT COUNT(*) AS expiring_players
       FROM (
         SELECT entitlement.user_id, MAX(entitlement.ends_at) AS coverage_ends_at
         FROM mip_membership_entitlements entitlement
         INNER JOIN mip_users user
           ON user.app_id = entitlement.app_id AND user.id = entitlement.user_id
         WHERE entitlement.app_id = ? AND entitlement.status = 'ACTIVE'
           AND user.status = 'ACTIVE' AND ${userScope.sql}
         GROUP BY entitlement.user_id
         HAVING SUM(CASE WHEN entitlement.starts_at <= ? AND entitlement.ends_at > ? THEN 1 ELSE 0 END) > 0
           AND MAX(entitlement.ends_at) >= ? AND MAX(entitlement.ends_at) < ?
       ) expiring`,
      [
        input.appId,
        ...userScope.params,
        input.asOf,
        input.asOf,
        input.asOf,
        new Date(input.asOf.getTime() + 30 * DAY_MS),
      ],
    )
    const expiring = count(expiryRow, 'expiring_players')
    if (expiring > activePlayers) {
      throw codeError('DASHBOARD_OVERVIEW_INVALID_STATE')
    }
    currentPlayers = countMetric(activePlayers)
    expiringPlayers30d = countMetric(expiring)
  }

  const purchaseFlow = await readMembershipPurchases(tx, input, scopeType, orderVisibility)
  const nestedStates = [currentPlayers.availability, purchaseFlow.availability]
  return {
    availability: nestedStates.includes(AVAILABILITY.AVAILABLE)
      ? AVAILABILITY.AVAILABLE
      : nestedStates.includes(AVAILABILITY.NOT_PROVIDED)
        ? AVAILABILITY.NOT_PROVIDED
        : AVAILABILITY.RESTRICTED,
    currentPlayers,
    expiringPlayers30d,
    purchaseFlow,
  }
}

async function readMembershipPurchases(tx, input, scopeType, orderVisibility) {
  if (scopeType === 'BRANCH') {
    return unavailableSection(AVAILABILITY.NOT_PROVIDED, 'HISTORICAL_BRANCH_ATTRIBUTION_NOT_PROVIDED')
  }
  if (!orderVisibility) {
    return unavailableSection(AVAILABILITY.RESTRICTED)
  }
  if (!orderVisibility.platform) {
    return unavailableSection(AVAILABILITY.NOT_PROVIDED, 'HISTORICAL_BRANCH_ATTRIBUTION_NOT_PROVIDED')
  }
  const bucket = bucketExpression('purchase.paid_at', input.period.granularity)
  const rows = await tx.query(
    `WITH membership_purchases AS (
       SELECT order_fact.id, order_fact.user_id, order_fact.amount_cents,
         order_fact.currency, order_fact.paid_at,
         ROW_NUMBER() OVER (
           PARTITION BY order_fact.user_id
           ORDER BY order_fact.paid_at, order_fact.created_at, order_fact.id
         ) AS purchase_ordinal
       FROM mip_orders order_fact
       INNER JOIN mip_membership_entitlements entitlement
         ON entitlement.app_id = order_fact.app_id AND entitlement.order_id = order_fact.id
       WHERE order_fact.app_id = ? AND order_fact.order_type = 'MEMBERSHIP'
         AND order_fact.paid_at IS NOT NULL
         AND entitlement.status IN (${VALID_ENTITLEMENT_SQL})
     )
     SELECT ${bucket} AS bucket_start_date,
       SUM(CASE WHEN purchase.purchase_ordinal = 1 THEN 1 ELSE 0 END) AS initial_purchase_count,
       SUM(CASE WHEN purchase.purchase_ordinal = 2 THEN 1 ELSE 0 END) AS first_renewal_count,
       SUM(CASE WHEN purchase.purchase_ordinal >= 3 THEN 1 ELSE 0 END) AS repeat_renewal_count,
       COUNT(*) AS eligible_purchase_count,
       COALESCE(SUM(purchase.amount_cents), 0) AS eligible_paid_amount_cents,
       MIN(purchase.currency) AS minimum_currency,
       MAX(purchase.currency) AS maximum_currency
     FROM membership_purchases purchase
     WHERE purchase.paid_at >= ? AND purchase.paid_at < ?
     GROUP BY bucket_start_date
     ORDER BY bucket_start_date`,
    [input.appId, input.period.startAt, input.period.endAt],
  )
  const series = fillSeries(input.period.bucketStartDates, rows, membershipPurchaseBucket)
  const totals = sumSeries(series, [
    'initialPurchaseCount',
    'firstRenewalCount',
    'repeatRenewalCount',
    'eligiblePurchaseCount',
    'eligiblePaidAmountCents',
  ])
  const previousTotals = await membershipPurchaseComparison(tx, input)
  if (totals.initialPurchaseCount + totals.firstRenewalCount + totals.repeatRenewalCount
    !== totals.eligiblePurchaseCount) {
    throw codeError('DASHBOARD_OVERVIEW_INVALID_STATE')
  }
  return {
    availability: AVAILABILITY.AVAILABLE,
    initialPurchases: countMetric(totals.initialPurchaseCount, previousTotals.initialPurchaseCount),
    firstRenewals: countMetric(totals.firstRenewalCount, previousTotals.firstRenewalCount),
    repeatRenewals: countMetric(totals.repeatRenewalCount, previousTotals.repeatRenewalCount),
    eligiblePurchases: countMetric(totals.eligiblePurchaseCount, previousTotals.eligiblePurchaseCount),
    eligiblePaidAmount: moneyMetric(totals.eligiblePaidAmountCents, previousTotals.eligiblePaidAmountCents),
    series,
  }
}

async function membershipPurchaseComparison(tx, input) {
  const row = await tx.one(
    `WITH membership_purchases AS (
       SELECT order_fact.id, order_fact.user_id, order_fact.amount_cents,
         order_fact.currency, order_fact.paid_at,
         ROW_NUMBER() OVER (
           PARTITION BY order_fact.user_id
           ORDER BY order_fact.paid_at, order_fact.created_at, order_fact.id
         ) AS purchase_ordinal
       FROM mip_orders order_fact
       INNER JOIN mip_membership_entitlements entitlement
         ON entitlement.app_id = order_fact.app_id AND entitlement.order_id = order_fact.id
       WHERE order_fact.app_id = ? AND order_fact.order_type = 'MEMBERSHIP'
         AND order_fact.paid_at IS NOT NULL
         AND entitlement.status IN (${VALID_ENTITLEMENT_SQL})
     )
     SELECT
       COALESCE(SUM(CASE WHEN purchase_ordinal = 1 THEN 1 ELSE 0 END), 0)
         AS initial_purchase_count,
       COALESCE(SUM(CASE WHEN purchase_ordinal = 2 THEN 1 ELSE 0 END), 0)
         AS first_renewal_count,
       COALESCE(SUM(CASE WHEN purchase_ordinal >= 3 THEN 1 ELSE 0 END), 0)
         AS repeat_renewal_count,
       COUNT(*) AS eligible_purchase_count,
       COALESCE(SUM(amount_cents), 0) AS eligible_paid_amount_cents,
       MIN(currency) AS minimum_currency,
       MAX(currency) AS maximum_currency
     FROM membership_purchases
     WHERE paid_at >= ? AND paid_at < ?`,
    [input.appId, input.period.comparisonStartAt, input.period.comparisonEndAt],
  )
  return membershipPurchaseBucket(row)
}

function membershipPurchaseBucket(row) {
  const initialPurchaseCount = count(row, 'initial_purchase_count')
  const firstRenewalCount = count(row, 'first_renewal_count')
  const repeatRenewalCount = count(row, 'repeat_renewal_count')
  const eligiblePurchaseCount = count(row, 'eligible_purchase_count')
  const eligiblePaidAmountCents = count(row, 'eligible_paid_amount_cents')
  assertCny(row, eligiblePurchaseCount)
  if (initialPurchaseCount + firstRenewalCount + repeatRenewalCount !== eligiblePurchaseCount) {
    throw codeError('DASHBOARD_OVERVIEW_INVALID_STATE')
  }
  return {
    initialPurchaseCount,
    firstRenewalCount,
    repeatRenewalCount,
    eligiblePurchaseCount,
    eligiblePaidAmountCents,
  }
}

async function readEvents(tx, input, scope, visibilityByCapability) {
  const eventScope = eventWhere(visibilityByCapability.events, 'event')
  if (!eventScope) {
    return unavailableSection(AVAILABILITY.RESTRICTED)
  }
  const summaryRow = await tx.one(
    `SELECT COUNT(*) AS total_events,
      COALESCE(SUM(CASE WHEN event.status = 'PUBLISHED'
        AND (event.registration_opens_at IS NULL OR event.registration_opens_at <= ?)
        AND (event.registration_deadline IS NULL OR event.registration_deadline > ?)
        AND event.starts_at > ?
        AND (event.capacity IS NULL OR event.waitlist_enabled = 1 OR (
          SELECT COUNT(*) FROM mip_event_registrations capacity_registration
          WHERE capacity_registration.app_id = event.app_id
            AND capacity_registration.event_id = event.id
            AND capacity_registration.status IN (${EFFECTIVE_REGISTRATION_SQL})
        ) < event.capacity)
      THEN 1 ELSE 0 END), 0) AS registration_open_events,
      COALESCE(SUM((
        SELECT COUNT(*) FROM mip_event_registrations pending_registration
        WHERE pending_registration.app_id = event.app_id
          AND pending_registration.event_id = event.id
          AND pending_registration.status = 'PENDING_REVIEW'
      )), 0) AS pending_review_registrations
     FROM mip_events event
     WHERE event.app_id = ? AND ${eventScope.sql}`,
    [input.asOf, input.asOf, input.asOf, input.appId, ...eventScope.params],
  )
  const scheduledRows = await eventScheduledSeries(tx, input, eventScope)
  const registrationRows = await eventRegistrationSeries(tx, input, eventScope)
  const series = mergeEventSeries(input.period.bucketStartDates, scheduledRows, registrationRows)
  const effectiveRegistrations = series.reduce((total, item) => total + item.effectiveRegistrationCount, 0)
  const previousRegistrationRow = await tx.one(
    `SELECT COUNT(*) AS effective_registration_count
     FROM mip_event_registrations registration
     INNER JOIN mip_events event
       ON event.app_id = registration.app_id AND event.id = registration.event_id
     WHERE registration.app_id = ?
       AND registration.registered_at >= ? AND registration.registered_at < ?
       AND registration.status IN (${EFFECTIVE_REGISTRATION_SQL})
       AND ${eventScope.sql}`,
    [
      input.appId,
      input.period.comparisonStartAt,
      input.period.comparisonEndAt,
      ...eventScope.params,
    ],
  )
  const previousEffectiveRegistrations = count(
    previousRegistrationRow,
    'effective_registration_count',
  )
  const quality = await readEventQuality(tx, input, eventScope)
  const feedback = await readEventFeedback(
    tx,
    input,
    eventWhere(visibilityByCapability.feedback, 'event'),
  )
  const financials = await readEventFinancials(
    tx,
    input,
    eventWhere(visibilityByCapability.orders, 'event'),
  )
  return {
    availability: AVAILABILITY.AVAILABLE,
    totalEvents: countMetric(count(summaryRow, 'total_events')),
    registrationOpenEvents: countMetric(count(summaryRow, 'registration_open_events')),
    effectiveRegistrations: countMetric(effectiveRegistrations, previousEffectiveRegistrations),
    pendingReviewRegistrations: countMetric(count(summaryRow, 'pending_review_registrations')),
    quality,
    feedback,
    financials,
    traffic: {
      views: { availability: AVAILABILITY.NOT_TRACKED, count: null },
      shares: { availability: AVAILABILITY.NOT_TRACKED, count: null },
    },
    series,
  }
}

async function eventScheduledSeries(tx, input, eventScope) {
  const bucket = bucketExpression('event.starts_at', input.period.granularity)
  return tx.query(
    `SELECT ${bucket} AS bucket_start_date, COUNT(*) AS scheduled_event_count
     FROM mip_events event
     WHERE event.app_id = ? AND event.starts_at >= ? AND event.starts_at < ?
       AND ${eventScope.sql}
     GROUP BY bucket_start_date
     ORDER BY bucket_start_date`,
    [input.appId, input.period.startAt, input.period.endAt, ...eventScope.params],
  )
}

async function eventRegistrationSeries(tx, input, eventScope) {
  const bucket = bucketExpression('registration.registered_at', input.period.granularity)
  return tx.query(
    `SELECT ${bucket} AS bucket_start_date, COUNT(*) AS effective_registration_count
     FROM mip_event_registrations registration
     INNER JOIN mip_events event
       ON event.app_id = registration.app_id AND event.id = registration.event_id
     WHERE registration.app_id = ?
       AND registration.registered_at >= ? AND registration.registered_at < ?
       AND registration.status IN (${EFFECTIVE_REGISTRATION_SQL})
       AND ${eventScope.sql}
     GROUP BY bucket_start_date
     ORDER BY bucket_start_date`,
    [input.appId, input.period.startAt, input.period.endAt, ...eventScope.params],
  )
}

function mergeEventSeries(bucketStartDates, scheduledRows, registrationRows) {
  const scheduled = rowMap(scheduledRows, row => ({
    scheduledEventCount: count(row, 'scheduled_event_count'),
  }))
  const registrations = rowMap(registrationRows, row => ({
    effectiveRegistrationCount: count(row, 'effective_registration_count'),
  }))
  assertKnownBuckets(bucketStartDates, scheduled)
  assertKnownBuckets(bucketStartDates, registrations)
  return bucketStartDates.map(bucketStartDate => ({
    bucketStartDate,
    scheduledEventCount: scheduled.get(bucketStartDate)?.scheduledEventCount || 0,
    effectiveRegistrationCount: registrations.get(bucketStartDate)?.effectiveRegistrationCount || 0,
  }))
}

async function readEventQuality(tx, input, eventScope) {
  const row = await tx.one(
    `SELECT COUNT(*) AS ended_event_count,
      COALESCE(SUM((
        SELECT COUNT(*) FROM mip_event_registrations quality_registration
        WHERE quality_registration.app_id = event.app_id
          AND quality_registration.event_id = event.id
          AND quality_registration.status IN (${EFFECTIVE_REGISTRATION_SQL})
      )), 0) AS effective_registration_count,
      COALESCE(SUM((
        SELECT COUNT(*) FROM mip_event_checkins quality_checkin
        INNER JOIN mip_event_registrations checked_registration
          ON checked_registration.app_id = quality_checkin.app_id
          AND checked_registration.id = quality_checkin.registration_id
          AND checked_registration.event_id = quality_checkin.event_id
          AND checked_registration.user_id = quality_checkin.user_id
        WHERE quality_checkin.app_id = event.app_id
          AND quality_checkin.event_id = event.id
          AND quality_checkin.status = 'ACTIVE'
          AND checked_registration.status IN (${EFFECTIVE_REGISTRATION_SQL})
      )), 0) AS checked_in_count
     FROM mip_events event
     WHERE event.app_id = ? AND event.ends_at >= ? AND event.ends_at < ?
       AND event.ends_at <= ? AND ${eventScope.sql}`,
    [input.appId, input.period.startAt, input.period.endAt, input.asOf, ...eventScope.params],
  )
  const effectiveRegistrationCount = count(row, 'effective_registration_count')
  const checkedInCount = count(row, 'checked_in_count')
  if (checkedInCount > effectiveRegistrationCount) {
    throw codeError('DASHBOARD_OVERVIEW_INVALID_STATE')
  }
  return {
    availability: AVAILABILITY.AVAILABLE,
    endedEvents: countMetric(count(row, 'ended_event_count')),
    effectiveRegistrations: countMetric(effectiveRegistrationCount),
    checkedInParticipants: countMetric(checkedInCount),
    checkInRate: rateMetric(checkedInCount, effectiveRegistrationCount),
  }
}

async function readEventFeedback(tx, input, feedbackScope) {
  if (!feedbackScope) {
    return unavailableSection(AVAILABILITY.RESTRICTED)
  }
  const row = await tx.one(
    `SELECT COUNT(feedback.id) AS submission_count,
      COUNT(checkin.id) AS eligible_checkin_count,
      COUNT(feedback.rating) AS rated_count,
      AVG(feedback.rating) AS average_rating
     FROM mip_events event
     INNER JOIN mip_event_checkins checkin
       ON checkin.app_id = event.app_id AND checkin.event_id = event.id
       AND checkin.status = 'ACTIVE'
     INNER JOIN mip_event_registrations registration
       ON registration.app_id = checkin.app_id
       AND registration.id = checkin.registration_id
       AND registration.event_id = checkin.event_id
       AND registration.user_id = checkin.user_id
       AND registration.status IN (${EFFECTIVE_REGISTRATION_SQL})
     LEFT JOIN mip_event_feedback feedback
       ON feedback.app_id = checkin.app_id
       AND feedback.event_id = checkin.event_id
       AND feedback.user_id = checkin.user_id
     WHERE event.app_id = ? AND event.ends_at >= ? AND event.ends_at < ?
       AND event.ends_at <= ? AND ${feedbackScope.sql}`,
    [input.appId, input.period.startAt, input.period.endAt, input.asOf, ...feedbackScope.params],
  )
  const submissions = count(row, 'submission_count')
  const eligibleCheckIns = count(row, 'eligible_checkin_count')
  const rated = count(row, 'rated_count')
  const averageRating = nullableRating(row?.average_rating)
  if (submissions > eligibleCheckIns
    || rated > submissions
    || (rated === 0 && averageRating !== null)
    || (rated > 0 && averageRating === null)) {
    throw codeError('DASHBOARD_OVERVIEW_INVALID_STATE')
  }
  return {
    availability: AVAILABILITY.AVAILABLE,
    submissions: countMetric(submissions),
    eligibleCheckIns: countMetric(eligibleCheckIns),
    submissionRate: rateMetric(submissions, eligibleCheckIns),
    ratedSubmissions: countMetric(rated),
    averageRating,
  }
}

async function readEventFinancials(tx, input, orderScope) {
  if (!orderScope) {
    return unavailableSection(AVAILABILITY.RESTRICTED)
  }
  const row = await eventFinancialRow(
    tx,
    input,
    orderScope,
    input.period.startAt,
    input.period.endAt,
  )
  const previousRow = await eventFinancialRow(
    tx,
    input,
    orderScope,
    input.period.comparisonStartAt,
    input.period.comparisonEndAt,
  )
  const current = eventFinancialValues(row)
  const previous = eventFinancialValues(previousRow)
  return {
    availability: AVAILABILITY.AVAILABLE,
    paidOrders: countMetric(current.paidOrderCount, previous.paidOrderCount),
    grossAmount: moneyMetric(current.grossAmountCents, previous.grossAmountCents),
    refundedAmount: moneyMetric(current.refundedAmountCents, previous.refundedAmountCents),
    netAmount: moneyMetric(current.netAmountCents, previous.netAmountCents),
  }
}

async function eventFinancialRow(tx, input, orderScope, startAt, endAt) {
  return tx.one(
    `SELECT COUNT(*) AS paid_order_count,
      COALESCE(SUM(event_order.amount_cents), 0) AS gross_amount_cents,
      COALESCE(SUM(refund_summary.refunded_amount_cents), 0) AS refunded_amount_cents,
      MIN(event_order.currency) AS minimum_currency,
      MAX(event_order.currency) AS maximum_currency
     FROM mip_orders event_order
     INNER JOIN mip_events event
       ON event.app_id = event_order.app_id AND event.id = event_order.resource_id
     LEFT JOIN (
       SELECT refund.app_id, refund.order_id, SUM(refund.amount_cents) AS refunded_amount_cents
       FROM mip_refunds refund
       WHERE refund.app_id = ? AND refund.status = 'SUCCEEDED' AND refund.refunded_at <= ?
       GROUP BY refund.app_id, refund.order_id
     ) refund_summary
       ON refund_summary.app_id = event_order.app_id AND refund_summary.order_id = event_order.id
     WHERE event_order.app_id = ? AND event_order.order_type = 'EVENT'
       AND event_order.paid_at >= ? AND event_order.paid_at < ?
       AND ${orderScope.sql}`,
    [input.appId, input.asOf, input.appId, startAt, endAt, ...orderScope.params],
  )
}

function eventFinancialValues(row) {
  const paidOrderCount = count(row, 'paid_order_count')
  const grossAmountCents = count(row, 'gross_amount_cents')
  const refundedAmountCents = count(row, 'refunded_amount_cents')
  assertCny(row, paidOrderCount)
  if (refundedAmountCents > grossAmountCents) {
    throw codeError('DASHBOARD_OVERVIEW_INVALID_STATE')
  }
  return {
    paidOrderCount,
    grossAmountCents,
    refundedAmountCents,
    netAmountCents: grossAmountCents - refundedAmountCents,
  }
}

async function readOpportunities(tx, input, scope, opportunityVisibility) {
  if (scope.publicScope.type === 'EVENT') {
    return unavailableSection(AVAILABILITY.NOT_APPLICABLE)
  }
  const opportunityScope = branchResourceWhere(opportunityVisibility, 'opportunity')
  if (!opportunityScope) {
    return unavailableSection(AVAILABILITY.RESTRICTED)
  }
  const row = await tx.one(
    `SELECT COUNT(*) AS total_opportunities,
      COALESCE(SUM(CASE WHEN opportunity.status = 'PUBLISHED' THEN 1 ELSE 0 END), 0)
        AS published_opportunities,
      COALESCE(SUM(CASE WHEN opportunity.published_at IS NOT NULL THEN 1 ELSE 0 END), 0)
        AS published_lifecycle_opportunities,
      COALESCE(SUM(CASE WHEN opportunity.published_at IS NOT NULL AND EXISTS (
        SELECT 1 FROM mip_opportunity_team_members member
        WHERE member.app_id = opportunity.app_id
          AND member.opportunity_id = opportunity.id AND member.status = 'ACTIVE'
      ) THEN 1 ELSE 0 END), 0) AS opportunities_with_active_team,
      COALESCE(SUM((
        SELECT COUNT(*) FROM mip_referral_intents referral
        WHERE referral.app_id = opportunity.app_id
          AND referral.opportunity_id = opportunity.id AND referral.status = 'ACTIVE'
      )), 0) AS active_referrals
     FROM mip_opportunities opportunity
     WHERE opportunity.app_id = ? AND ${opportunityScope.sql}`,
    [input.appId, ...opportunityScope.params],
  )
  const publishedLifecycle = count(row, 'published_lifecycle_opportunities')
  const withActiveTeam = count(row, 'opportunities_with_active_team')
  if (withActiveTeam > publishedLifecycle) {
    throw codeError('DASHBOARD_OVERVIEW_INVALID_STATE')
  }

  let publishedCards = unavailableCount(AVAILABILITY.NOT_PROVIDED)
  let publishedCases = unavailableCount(AVAILABILITY.NOT_PROVIDED)
  if (opportunityVisibility?.platform) {
    const contentRow = await tx.one(
      `SELECT
        (SELECT COUNT(*) FROM mip_cooperation_cards card
          WHERE card.app_id = ? AND card.status = 'PUBLISHED') AS published_cooperation_cards,
        (SELECT COUNT(*) FROM mip_super_cases case_fact
          WHERE case_fact.app_id = ? AND case_fact.status = 'PUBLISHED') AS published_super_cases`,
      [input.appId, input.appId],
    )
    publishedCards = countMetric(count(contentRow, 'published_cooperation_cards'))
    publishedCases = countMetric(count(contentRow, 'published_super_cases'))
  }
  return {
    availability: AVAILABILITY.AVAILABLE,
    totalOpportunities: countMetric(count(row, 'total_opportunities')),
    publishedOpportunities: countMetric(count(row, 'published_opportunities')),
    publishedLifecycleOpportunities: countMetric(publishedLifecycle),
    opportunitiesWithActiveTeam: countMetric(withActiveTeam),
    teamFormationRate: rateMetric(withActiveTeam, publishedLifecycle),
    activeReferrals: countMetric(count(row, 'active_referrals')),
    publishedCooperationCards: publishedCards,
    publishedSuperCases: publishedCases,
    trueConversionRate: unavailableRate(AVAILABILITY.NOT_TRACKED),
  }
}

async function readTasks(tx, input, scope, taskVisibility) {
  if (scope.publicScope.type === 'BRANCH' || scope.publicScope.type === 'EVENT') {
    return unavailableSection(AVAILABILITY.NOT_APPLICABLE)
  }
  if (!taskVisibility?.platform) {
    return unavailableSection(AVAILABILITY.RESTRICTED)
  }
  const row = await tx.one(
    `SELECT
      (SELECT COUNT(*) FROM mip_task_cards task
        WHERE task.app_id = ? AND task.status = 'PUBLISHED') AS published_tasks,
      (SELECT COUNT(*) FROM mip_task_completions completion
        WHERE completion.app_id = ? AND completion.result_status = 'SUCCESS'
          AND completion.completed_at >= ? AND completion.completed_at < ?) AS successful_completions,
      (SELECT COALESCE(SUM(completion.reward_experience), 0)
        FROM mip_task_completions completion
        WHERE completion.app_id = ? AND completion.result_status = 'SUCCESS'
          AND completion.completed_at >= ? AND completion.completed_at < ?) AS awarded_experience`,
    [
      input.appId,
      input.appId,
      input.period.startAt,
      input.period.endAt,
      input.appId,
      input.period.startAt,
      input.period.endAt,
    ],
  )
  return {
    availability: AVAILABILITY.AVAILABLE,
    publishedTasks: countMetric(count(row, 'published_tasks')),
    successfulCompletions: countMetric(count(row, 'successful_completions')),
    awardedExperience: countMetric(count(row, 'awarded_experience')),
    pendingReview: unavailableCount(AVAILABILITY.NOT_PROVIDED),
  }
}

async function readOperations(tx, input, scope, visibilityByCapability) {
  const sources = []
  const eventScope = eventWhere(visibilityByCapability.events, 'event')
  if (eventScope) {
    sources.push(await eventActivity(tx, input, eventScope))
  }
  if (visibilityByCapability.orders?.platform) {
    sources.push(await membershipActivity(tx, input))
  }
  if (visibilityByCapability.tasks?.platform
    && scope.publicScope.type !== 'BRANCH'
    && scope.publicScope.type !== 'EVENT') {
    sources.push(await taskActivity(tx, input))
  }
  const auditScope = auditWhere(visibilityByCapability.audit, 'audit', 'scoped_event')
  if (auditScope) {
    sources.push(await auditActivity(tx, input, auditScope))
  }
  if (!sources.length) {
    return unavailableSection(AVAILABILITY.RESTRICTED)
  }

  const activity = sources.flat()
    .map(activityItem)
    .sort((first, second) => second.occurredAt.localeCompare(first.occurredAt)
      || second.id.localeCompare(first.id))
    .slice(0, 20)
  return { availability: AVAILABILITY.AVAILABLE, activity }
}

async function eventActivity(tx, input, eventScope) {
  return tx.query(
    `SELECT CONCAT('outbox:', outbox.id) AS activity_id,
      outbox.event_type AS activity_kind, outbox.created_at AS occurred_at,
      registration.user_id AS actor_user_id, profile.nickname AS actor_display_name,
      'EVENT' AS resource_type, event.id AS resource_id, event.title AS resource_title,
      'EVENT' AS scope_type, event.id AS scope_id
     FROM mip_outbox_events outbox
     INNER JOIN mip_event_registrations registration
       ON registration.app_id = outbox.app_id AND registration.id = outbox.aggregate_id
     INNER JOIN mip_events event
       ON event.app_id = registration.app_id AND event.id = registration.event_id
     LEFT JOIN mip_profiles profile
       ON profile.app_id = registration.app_id AND profile.user_id = registration.user_id
     WHERE outbox.app_id = ? AND outbox.event_type = 'event.registration_confirmed'
       AND outbox.status <> 'CANCELLED'
       AND outbox.created_at >= ? AND outbox.created_at < ?
       AND ${eventScope.sql}
     ORDER BY outbox.created_at DESC, outbox.id DESC
     LIMIT 20`,
    [input.appId, input.period.startAt, input.period.endAt, ...eventScope.params],
  )
}

async function membershipActivity(tx, input) {
  return tx.query(
    `SELECT CONCAT('outbox:', outbox.id) AS activity_id,
      outbox.event_type AS activity_kind, outbox.created_at AS occurred_at,
      membership_order.user_id AS actor_user_id, profile.nickname AS actor_display_name,
      'ORDER' AS resource_type, membership_order.id AS resource_id,
      NULL AS resource_title, 'PLATFORM' AS scope_type, NULL AS scope_id
     FROM mip_outbox_events outbox
     INNER JOIN mip_orders membership_order
       ON membership_order.app_id = outbox.app_id AND membership_order.id = outbox.aggregate_id
     LEFT JOIN mip_profiles profile
       ON profile.app_id = membership_order.app_id AND profile.user_id = membership_order.user_id
     WHERE outbox.app_id = ? AND outbox.event_type = 'membership.payment_confirmed'
       AND membership_order.order_type = 'MEMBERSHIP'
       AND outbox.status <> 'CANCELLED'
       AND outbox.created_at >= ? AND outbox.created_at < ?
     ORDER BY outbox.created_at DESC, outbox.id DESC
     LIMIT 20`,
    [input.appId, input.period.startAt, input.period.endAt],
  )
}

async function taskActivity(tx, input) {
  return tx.query(
    `SELECT CONCAT('outbox:', outbox.id) AS activity_id,
      outbox.event_type AS activity_kind, outbox.created_at AS occurred_at,
      completion.user_id AS actor_user_id, profile.nickname AS actor_display_name,
      'TASK' AS resource_type, task.id AS resource_id, task.name AS resource_title,
      'PLATFORM' AS scope_type, NULL AS scope_id
     FROM mip_outbox_events outbox
     INNER JOIN mip_task_completions completion
       ON completion.app_id = outbox.app_id AND completion.id = outbox.aggregate_id
     INNER JOIN mip_task_cards task
       ON task.app_id = completion.app_id AND task.id = completion.task_id
     LEFT JOIN mip_profiles profile
       ON profile.app_id = completion.app_id AND profile.user_id = completion.user_id
     WHERE outbox.app_id = ? AND outbox.event_type = 'task.completed'
       AND outbox.status <> 'CANCELLED'
       AND outbox.created_at >= ? AND outbox.created_at < ?
     ORDER BY outbox.created_at DESC, outbox.id DESC
     LIMIT 20`,
    [input.appId, input.period.startAt, input.period.endAt],
  )
}

async function auditActivity(tx, input, auditScope) {
  const placeholders = AUDIT_ACTIVITY_ACTIONS.map(() => '?').join(', ')
  return tx.query(
    `SELECT CONCAT('audit:', audit.id) AS activity_id,
      audit.action AS activity_kind, audit.created_at AS occurred_at,
      audit.actor_user_id, profile.nickname AS actor_display_name,
      audit.resource_type, audit.resource_id, NULL AS resource_title,
      audit.scope_type, audit.scope_id
     FROM mip_audit_logs audit
     LEFT JOIN mip_profiles profile
       ON profile.app_id = audit.app_id AND profile.user_id = audit.actor_user_id
     LEFT JOIN mip_events scoped_event
       ON scoped_event.app_id = audit.app_id
       AND audit.scope_type = 'EVENT' AND scoped_event.id = audit.scope_id
     WHERE audit.app_id = ? AND audit.action IN (${placeholders})
       AND audit.created_at >= ? AND audit.created_at < ?
       AND ${auditScope.sql}
     ORDER BY audit.created_at DESC, audit.id DESC
     LIMIT 20`,
    [
      input.appId,
      ...AUDIT_ACTIVITY_ACTIONS,
      input.period.startAt,
      input.period.endAt,
      ...auditScope.params,
    ],
  )
}

function activityItem(row) {
  const kind = safeText(row?.activity_kind)
  if (!OUTBOX_ACTIVITY_TYPES.includes(kind) && !AUDIT_ACTIVITY_ACTIONS.includes(kind)) {
    throw codeError('DASHBOARD_OVERVIEW_INVALID_STATE')
  }
  const id = safeText(row?.activity_id)
  const occurredAt = iso(row?.occurred_at)
  if (!id || !occurredAt) {
    throw codeError('DASHBOARD_OVERVIEW_INVALID_STATE')
  }
  const resourceType = safeText(row.resource_type)
  const scopeType = safeText(row.scope_type)
  const shape = OUTBOX_ACTIVITY_SHAPES[kind]
  if (!resourceType
    || !ACTIVITY_SCOPE_TYPES.includes(scopeType)
    || (shape && (shape.resourceType !== resourceType || shape.scopeType !== scopeType))) {
    throw codeError('DASHBOARD_OVERVIEW_INVALID_STATE')
  }
  return {
    id,
    kind,
    occurredAt,
    actor: {
      userId: row.actor_user_id || null,
      displayName: safeText(row.actor_display_name) || null,
    },
    resource: {
      type: resourceType,
      id: row.resource_id || null,
      title: safeText(row.resource_title) || null,
    },
    scope: {
      type: scopeType,
      id: row.scope_id || null,
    },
  }
}

function userWhere(value, alias) {
  if (!value) {
    return null
  }
  if (value.platform) {
    return { sql: '1 = 1', params: [] }
  }
  const branchIds = [...value.branchIds]
  if (!branchIds.length) {
    return null
  }
  return {
    sql: `${alias}.primary_branch_id IN (${placeholders(branchIds)})`,
    params: branchIds,
  }
}

function branchResourceWhere(value, alias) {
  if (!value) {
    return null
  }
  if (value.platform) {
    return { sql: '1 = 1', params: [] }
  }
  const branchIds = [...value.branchIds]
  if (!branchIds.length) {
    return null
  }
  return {
    sql: `${alias}.branch_id IN (${placeholders(branchIds)})`,
    params: branchIds,
  }
}

function eventWhere(value, alias) {
  if (!value) {
    return null
  }
  if (value.platform) {
    return { sql: '1 = 1', params: [] }
  }
  const clauses = []
  const params = []
  const branchIds = [...value.branchIds]
  const eventIds = [...value.eventIds]
  if (branchIds.length) {
    clauses.push(`${alias}.branch_id IN (${placeholders(branchIds)})`)
    params.push(...branchIds)
  }
  if (eventIds.length) {
    clauses.push(`${alias}.id IN (${placeholders(eventIds)})`)
    params.push(...eventIds)
  }
  for (const restriction of value.eventRestrictions.values()) {
    clauses.push(`(${alias}.id = ? AND ${alias}.branch_id = ?)`)
    params.push(restriction.eventId, restriction.branchId)
  }
  return clauses.length ? { sql: `(${clauses.join(' OR ')})`, params } : null
}

function auditWhere(value, auditAlias, eventAlias) {
  if (!value) {
    return null
  }
  if (value.platform) {
    return { sql: '1 = 1', params: [] }
  }
  const clauses = []
  const params = []
  const branchIds = [...value.branchIds]
  const eventIds = [...value.eventIds]
  if (branchIds.length) {
    const branchPlaceholders = placeholders(branchIds)
    clauses.push(`((${auditAlias}.scope_type = 'BRANCH'
      AND ${auditAlias}.scope_id IN (${branchPlaceholders}))
      OR (${auditAlias}.scope_type = 'EVENT'
        AND ${eventAlias}.branch_id IN (${branchPlaceholders})))`)
    params.push(...branchIds, ...branchIds)
  }
  if (eventIds.length) {
    clauses.push(`(${auditAlias}.scope_type = 'EVENT'
      AND ${auditAlias}.scope_id IN (${placeholders(eventIds)}))`)
    params.push(...eventIds)
  }
  for (const restriction of value.eventRestrictions.values()) {
    clauses.push(`(${auditAlias}.scope_type = 'EVENT' AND ${auditAlias}.scope_id = ?
      AND ${eventAlias}.branch_id = ?)`)
    params.push(restriction.eventId, restriction.branchId)
  }
  return clauses.length ? { sql: `(${clauses.join(' OR ')})`, params } : null
}

function bucketExpression(column, granularity) {
  const local = `CONVERT_TZ(${column}, '+00:00', '+08:00')`
  if (granularity === 'DAY') {
    return `DATE_FORMAT(${local}, '%Y-%m-%d')`
  }
  if (granularity === 'MONTH') {
    return `DATE_FORMAT(${local}, '%Y-%m-01')`
  }
  return `DATE_FORMAT(DATE_SUB(DATE(${local}), INTERVAL WEEKDAY(${local}) DAY), '%Y-%m-%d')`
}

function fillSeries(bucketStartDates, rows, project) {
  const values = rowMap(rows, project)
  assertKnownBuckets(bucketStartDates, values)
  const zero = project({
    initial_purchase_count: 0,
    first_renewal_count: 0,
    repeat_renewal_count: 0,
    eligible_purchase_count: 0,
    eligible_paid_amount_cents: 0,
    minimum_currency: null,
    maximum_currency: null,
  })
  return bucketStartDates.map(bucketStartDate => ({
    bucketStartDate,
    ...(values.get(bucketStartDate) || zero),
  }))
}

function rowMap(rows, project) {
  if (!Array.isArray(rows)) {
    throw codeError('DASHBOARD_OVERVIEW_INVALID_STATE')
  }
  const result = new Map()
  for (const row of rows) {
    const bucket = safeText(row?.bucket_start_date)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(bucket) || result.has(bucket)) {
      throw codeError('DASHBOARD_OVERVIEW_INVALID_STATE')
    }
    result.set(bucket, project(row))
  }
  return result
}

function assertKnownBuckets(bucketStartDates, values) {
  const allowed = new Set(bucketStartDates)
  if ([...values.keys()].some(key => !allowed.has(key))) {
    throw codeError('DASHBOARD_OVERVIEW_INVALID_STATE')
  }
}

function sumSeries(series, keys) {
  return Object.fromEntries(keys.map(key => [
    key,
    series.reduce((total, item) => total + item[key], 0),
  ]))
}

function countMetric(value, previousValue) {
  const countValue = safeCount(value)
  const metric = {
    availability: AVAILABILITY.AVAILABLE,
    count: countValue,
    comparison: unavailableCountComparison(),
  }
  if (previousValue !== undefined) {
    const previousCount = safeCount(previousValue)
    metric.comparison = countComparison(countValue, previousCount)
  }
  return metric
}

function moneyMetric(value, previousValue) {
  const amountCents = safeCount(value)
  const metric = {
    availability: AVAILABILITY.AVAILABLE,
    amountCents,
    currency: 'CNY',
    comparison: unavailableMoneyComparison(),
  }
  if (previousValue !== undefined) {
    const previousAmountCents = safeCount(previousValue)
    metric.comparison = {
      availability: AVAILABILITY.AVAILABLE,
      previousAmountCents,
      deltaAmountCents: amountCents - previousAmountCents,
      changeBasisPoints: changeBasisPoints(amountCents, previousAmountCents),
    }
  }
  return metric
}

function countComparison(value, previousValue) {
  return {
    availability: AVAILABILITY.AVAILABLE,
    previousCount: previousValue,
    deltaCount: value - previousValue,
    changeBasisPoints: changeBasisPoints(value, previousValue),
  }
}

function unavailableCountComparison() {
  return {
    availability: AVAILABILITY.NOT_PROVIDED,
    previousCount: null,
    deltaCount: null,
    changeBasisPoints: null,
  }
}

function unavailableMoneyComparison() {
  return {
    availability: AVAILABILITY.NOT_PROVIDED,
    previousAmountCents: null,
    deltaAmountCents: null,
    changeBasisPoints: null,
  }
}

function changeBasisPoints(value, previousValue) {
  if (previousValue === 0) {
    return null
  }
  const result = Math.round(((value - previousValue) / previousValue) * 10_000)
  if (!Number.isSafeInteger(result)) {
    throw codeError('DASHBOARD_OVERVIEW_INVALID_STATE')
  }
  return result
}

function rateMetric(numerator, denominator) {
  const safeNumerator = safeCount(numerator)
  const safeDenominator = safeCount(denominator)
  if (safeNumerator > safeDenominator) {
    throw codeError('DASHBOARD_OVERVIEW_INVALID_STATE')
  }
  return {
    availability: AVAILABILITY.AVAILABLE,
    basisPoints: safeDenominator === 0
      ? null
      : Math.round((safeNumerator / safeDenominator) * 10_000),
    numerator: safeNumerator,
    denominator: safeDenominator,
    comparison: unavailableRateComparison(),
  }
}

function unavailableRateComparison() {
  return {
    availability: AVAILABILITY.NOT_PROVIDED,
    previousBasisPoints: null,
    deltaBasisPoints: null,
  }
}

function unavailableCount(availability) {
  return { availability, count: null }
}

function unavailableRate(availability) {
  return { availability, basisPoints: null, numerator: null, denominator: null }
}

function unavailableSection(availability, reasonCode) {
  return reasonCode ? { availability, reasonCode } : { availability }
}

function count(row, key) {
  if (!row || !Object.hasOwn(row, key)) {
    throw codeError('DASHBOARD_OVERVIEW_INVALID_STATE')
  }
  return safeCount(row[key] ?? 0)
}

function safeCount(value) {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw codeError('DASHBOARD_OVERVIEW_INVALID_STATE')
  }
  return parsed
}

function nullableRating(value) {
  if (value === null || value === undefined) {
    return null
  }
  const rating = Number(value)
  if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
    throw codeError('DASHBOARD_OVERVIEW_INVALID_STATE')
  }
  return rating
}

function assertCny(row, countValue) {
  const minimum = row?.minimum_currency ?? null
  const maximum = row?.maximum_currency ?? null
  if (countValue === 0 && (minimum !== null || maximum !== null)) {
    throw codeError('DASHBOARD_OVERVIEW_INVALID_STATE')
  }
  if (countValue > 0 && (minimum !== 'CNY' || maximum !== 'CNY')) {
    throw codeError('DASHBOARD_OVERVIEW_INVALID_STATE')
  }
}

function placeholders(values) {
  return values.map(() => '?').join(', ')
}

function safeText(value) {
  return typeof value === 'string' ? value : ''
}

function iso(value) {
  const date = value instanceof Date ? value : new Date(value)
  return Number.isFinite(date.getTime()) ? date.toISOString() : null
}

function codeError(code) {
  const error = new Error(code)
  error.code = code
  return error
}

module.exports = { createDashboardOverviewRepository }
