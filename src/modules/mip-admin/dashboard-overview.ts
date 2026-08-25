import { MipAdminError } from './types'

export type AdminDashboardOverviewPreset
  = | 'TODAY'
    | 'THIS_WEEK'
    | 'THIS_MONTH'
    | 'LAST_30_DAYS'
    | 'CUSTOM'
export type AdminDashboardOverviewGranularity = 'DAY' | 'WEEK' | 'MONTH'
export type AdminDashboardOverviewScopeType = 'AUTHORIZED' | 'PLATFORM' | 'BRANCH' | 'EVENT'
export type AdminDashboardAvailability
  = | 'AVAILABLE'
    | 'RESTRICTED'
    | 'NOT_TRACKED'
    | 'NOT_APPLICABLE'
    | 'NOT_PROVIDED'

export type AdminDashboardOverviewScopeInput = {
  type: 'AUTHORIZED' | 'PLATFORM'
} | {
  type: 'BRANCH' | 'EVENT'
  id: string
}

export type AdminDashboardOverviewPeriodInput = {
  preset: Exclude<AdminDashboardOverviewPreset, 'CUSTOM'>
  granularity?: AdminDashboardOverviewGranularity
} | {
  preset: 'CUSTOM'
  startDate: string
  endDate: string
  granularity?: AdminDashboardOverviewGranularity
}

export interface AdminDashboardOverviewInput {
  scope?: AdminDashboardOverviewScopeInput
  period?: AdminDashboardOverviewPeriodInput
}

export type AdminDashboardCountComparison = {
  availability: 'AVAILABLE'
  previousCount: number
  deltaCount: number
  changeBasisPoints: number | null
} | {
  availability: 'NOT_PROVIDED'
  previousCount: null
  deltaCount: null
  changeBasisPoints: null
}

export type AdminDashboardCountMetric = {
  availability: 'AVAILABLE'
  count: number
  comparison: AdminDashboardCountComparison
} | {
  availability: Exclude<AdminDashboardAvailability, 'AVAILABLE'>
  count: null
}

export interface AdminDashboardMoneyMetric {
  availability: 'AVAILABLE'
  amountCents: number
  currency: 'CNY'
  comparison: {
    availability: 'AVAILABLE'
    previousAmountCents: number
    deltaAmountCents: number
    changeBasisPoints: number | null
  } | {
    availability: 'NOT_PROVIDED'
    previousAmountCents: null
    deltaAmountCents: null
    changeBasisPoints: null
  }
}

export type AdminDashboardRateMetric = {
  availability: 'AVAILABLE'
  basisPoints: number | null
  numerator: number
  denominator: number
  comparison: {
    availability: 'NOT_PROVIDED'
    previousBasisPoints: null
    deltaBasisPoints: null
  }
} | {
  availability: Exclude<AdminDashboardAvailability, 'AVAILABLE'>
  basisPoints: null
  numerator: null
  denominator: null
}

export interface AdminDashboardUnavailableSection {
  availability: Exclude<AdminDashboardAvailability, 'AVAILABLE'>
  reasonCode?: string
}

export type AdminDashboardPeople = AdminDashboardUnavailableSection | {
  availability: 'AVAILABLE'
  activeAccounts: AdminDashboardCountMetric
  activePlayers: AdminDashboardCountMetric
  guests: AdminDashboardCountMetric
  newAccounts: AdminDashboardCountMetric
  profiledUsers: AdminDashboardCountMetric
  interactingPlayers30d: AdminDashboardCountMetric
  playerInteractionRate30d: AdminDashboardRateMetric
  recordedProfileVisits: AdminDashboardCountMetric
  distinctProfileVisitors: AdminDashboardCountMetric
}

export type AdminDashboardMembershipPurchaseFlow = AdminDashboardUnavailableSection | {
  availability: 'AVAILABLE'
  initialPurchases: AdminDashboardCountMetric
  firstRenewals: AdminDashboardCountMetric
  repeatRenewals: AdminDashboardCountMetric
  eligiblePurchases: AdminDashboardCountMetric
  eligiblePaidAmount: AdminDashboardMoneyMetric
  series: Array<{
    bucketStartDate: string
    initialPurchaseCount: number
    firstRenewalCount: number
    repeatRenewalCount: number
    eligiblePurchaseCount: number
    eligiblePaidAmountCents: number
  }>
}

type AdminDashboardMembershipSeriesItem = Extract<
  AdminDashboardMembershipPurchaseFlow,
  { availability: 'AVAILABLE' }
>['series'][number]

export interface AdminDashboardMembership {
  availability: AdminDashboardAvailability
  currentPlayers: AdminDashboardCountMetric
  expiringPlayers30d: AdminDashboardCountMetric
  purchaseFlow: AdminDashboardMembershipPurchaseFlow
}

export type AdminDashboardEvents = AdminDashboardUnavailableSection | {
  availability: 'AVAILABLE'
  totalEvents: AdminDashboardCountMetric
  registrationOpenEvents: AdminDashboardCountMetric
  effectiveRegistrations: AdminDashboardCountMetric
  pendingReviewRegistrations: AdminDashboardCountMetric
  quality: {
    availability: 'AVAILABLE'
    endedEvents: AdminDashboardCountMetric
    effectiveRegistrations: AdminDashboardCountMetric
    checkedInParticipants: AdminDashboardCountMetric
    checkInRate: AdminDashboardRateMetric
  }
  feedback: AdminDashboardUnavailableSection | {
    availability: 'AVAILABLE'
    submissions: AdminDashboardCountMetric
    eligibleCheckIns: AdminDashboardCountMetric
    submissionRate: AdminDashboardRateMetric
    ratedSubmissions: AdminDashboardCountMetric
    averageRating: number | null
  }
  financials: AdminDashboardUnavailableSection | {
    availability: 'AVAILABLE'
    paidOrders: AdminDashboardCountMetric
    grossAmount: AdminDashboardMoneyMetric
    refundedAmount: AdminDashboardMoneyMetric
    netAmount: AdminDashboardMoneyMetric
  }
  traffic: {
    views: AdminDashboardCountMetric
    shares: AdminDashboardCountMetric
  }
  series: Array<{
    bucketStartDate: string
    scheduledEventCount: number
    effectiveRegistrationCount: number
  }>
}

export type AdminDashboardOpportunities = AdminDashboardUnavailableSection | {
  availability: 'AVAILABLE'
  totalOpportunities: AdminDashboardCountMetric
  publishedOpportunities: AdminDashboardCountMetric
  publishedLifecycleOpportunities: AdminDashboardCountMetric
  opportunitiesWithActiveTeam: AdminDashboardCountMetric
  teamFormationRate: AdminDashboardRateMetric
  activeReferrals: AdminDashboardCountMetric
  publishedCooperationCards: AdminDashboardCountMetric
  publishedSuperCases: AdminDashboardCountMetric
  trueConversionRate: AdminDashboardRateMetric
}

export type AdminDashboardTasks = AdminDashboardUnavailableSection | {
  availability: 'AVAILABLE'
  publishedTasks: AdminDashboardCountMetric
  successfulCompletions: AdminDashboardCountMetric
  awardedExperience: AdminDashboardCountMetric
  pendingReview: AdminDashboardCountMetric
}

export interface AdminDashboardActivity {
  id: string
  kind: string
  occurredAt: string
  actor: { userId: string | null, displayName: string | null }
  resource: { type: string, id: string | null, title: string | null }
  scope: { type: 'PLATFORM' | 'BRANCH' | 'EVENT' | 'RESOURCE', id: string | null }
}

export type AdminDashboardOperations = AdminDashboardUnavailableSection | {
  availability: 'AVAILABLE'
  activity: AdminDashboardActivity[]
}

export interface AdminDashboardOverview {
  schemaVersion: 1
  asOf: string
  timeZone: 'Asia/Shanghai'
  scope: {
    type: AdminDashboardOverviewScopeType
    id: string | null
    name?: string
    status?: string
    branchId?: string | null
  }
  period: {
    preset: AdminDashboardOverviewPreset
    startAt: string
    endAt: string
    comparisonStartAt: string
    comparisonEndAt: string
    granularity: AdminDashboardOverviewGranularity
  }
  people: AdminDashboardPeople
  membership: AdminDashboardMembership
  events: AdminDashboardEvents
  opportunities: AdminDashboardOpportunities
  tasks: AdminDashboardTasks
  operations: AdminDashboardOperations
}

const availabilities = new Set<AdminDashboardAvailability>([
  'AVAILABLE',
  'RESTRICTED',
  'NOT_TRACKED',
  'NOT_APPLICABLE',
  'NOT_PROVIDED',
])
const unavailableStates = new Set<AdminDashboardAvailability>([
  'RESTRICTED',
  'NOT_TRACKED',
  'NOT_APPLICABLE',
  'NOT_PROVIDED',
])
const presets = new Set<AdminDashboardOverviewPreset>([
  'TODAY',
  'THIS_WEEK',
  'THIS_MONTH',
  'LAST_30_DAYS',
  'CUSTOM',
])
const granularities = new Set<AdminDashboardOverviewGranularity>(['DAY', 'WEEK', 'MONTH'])
const activityKinds = new Set([
  'event.registration_confirmed',
  'membership.payment_confirmed',
  'task.completed',
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
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const datePattern = /^\d{4}-\d{2}-\d{2}$/
const dayMs = 86_400_000

function invalid(): never {
  throw new MipAdminError('INVALID_RESPONSE', '运营服务返回了无效的数据概览')
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  const allowed = new Set(keys)
  const actual = Reflect.ownKeys(value)
  return actual.length === allowed.size
    && actual.every(key => typeof key === 'string' && allowed.has(key))
}

function optionalExactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
) {
  const allowed = new Set([...required, ...optional])
  const actual = Reflect.ownKeys(value)
  return required.every(key => Object.hasOwn(value, key))
    && actual.every(key => typeof key === 'string' && allowed.has(key))
}

function safeCount(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0
}

function safeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value)
}

function instant(value: unknown): value is string {
  return typeof value === 'string'
    && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString() === value
}

function text(value: unknown, maximum: number, nullable = false): value is string | null {
  return (nullable && value === null)
    || (typeof value === 'string' && value.length > 0 && value.length <= maximum)
}

function expectedChangeBasisPoints(current: number, previous: number) {
  return previous === 0 ? null : Math.round(((current - previous) / previous) * 10_000)
}

function parseCountComparison(value: unknown, current: number): AdminDashboardCountComparison {
  if (!record(value)
    || !exactKeys(value, ['availability', 'previousCount', 'deltaCount', 'changeBasisPoints'])) {
    invalid()
  }
  if (value.availability === 'NOT_PROVIDED') {
    if (value.previousCount !== null || value.deltaCount !== null || value.changeBasisPoints !== null) {
      invalid()
    }
    return value as unknown as AdminDashboardCountComparison
  }
  if (value.availability !== 'AVAILABLE'
    || !safeCount(value.previousCount)
    || !safeInteger(value.deltaCount)
    || value.deltaCount !== current - value.previousCount
    || !(value.changeBasisPoints === null || safeInteger(value.changeBasisPoints))
    || value.changeBasisPoints !== expectedChangeBasisPoints(current, value.previousCount)) {
    invalid()
  }
  return value as unknown as AdminDashboardCountComparison
}

function parseCountMetric(value: unknown): AdminDashboardCountMetric {
  if (!record(value) || !availabilities.has(value.availability as AdminDashboardAvailability)) {
    invalid()
  }
  if (value.availability !== 'AVAILABLE') {
    if (!unavailableStates.has(value.availability as AdminDashboardAvailability)
      || !exactKeys(value, ['availability', 'count'])
      || value.count !== null) {
      invalid()
    }
    return value as AdminDashboardCountMetric
  }
  if (!exactKeys(value, ['availability', 'count', 'comparison']) || !safeCount(value.count)) {
    invalid()
  }
  return {
    availability: 'AVAILABLE',
    count: value.count,
    comparison: parseCountComparison(value.comparison, value.count),
  }
}

function parseMoneyComparison(value: unknown, current: number): AdminDashboardMoneyMetric['comparison'] {
  if (!record(value)
    || !exactKeys(value, [
      'availability',
      'previousAmountCents',
      'deltaAmountCents',
      'changeBasisPoints',
    ])) {
    invalid()
  }
  if (value.availability === 'NOT_PROVIDED') {
    if (value.previousAmountCents !== null
      || value.deltaAmountCents !== null
      || value.changeBasisPoints !== null) {
      invalid()
    }
    return value as AdminDashboardMoneyMetric['comparison']
  }
  if (value.availability !== 'AVAILABLE'
    || !safeCount(value.previousAmountCents)
    || !safeInteger(value.deltaAmountCents)
    || value.deltaAmountCents !== current - value.previousAmountCents
    || !(value.changeBasisPoints === null || safeInteger(value.changeBasisPoints))
    || value.changeBasisPoints !== expectedChangeBasisPoints(current, value.previousAmountCents)) {
    invalid()
  }
  return value as AdminDashboardMoneyMetric['comparison']
}

function parseMoneyMetric(value: unknown): AdminDashboardMoneyMetric {
  if (!record(value)
    || !exactKeys(value, ['availability', 'amountCents', 'currency', 'comparison'])
    || value.availability !== 'AVAILABLE'
    || !safeCount(value.amountCents)
    || value.currency !== 'CNY') {
    invalid()
  }
  return {
    availability: 'AVAILABLE',
    amountCents: value.amountCents,
    currency: 'CNY',
    comparison: parseMoneyComparison(value.comparison, value.amountCents),
  }
}

function parseRateMetric(value: unknown): AdminDashboardRateMetric {
  if (!record(value) || !availabilities.has(value.availability as AdminDashboardAvailability)) {
    invalid()
  }
  if (value.availability !== 'AVAILABLE') {
    if (!unavailableStates.has(value.availability as AdminDashboardAvailability)
      || !exactKeys(value, ['availability', 'basisPoints', 'numerator', 'denominator'])
      || value.basisPoints !== null
      || value.numerator !== null
      || value.denominator !== null) {
      invalid()
    }
    return value as AdminDashboardRateMetric
  }
  if (!exactKeys(value, ['availability', 'basisPoints', 'numerator', 'denominator', 'comparison'])
    || !safeCount(value.numerator)
    || !safeCount(value.denominator)
    || value.numerator > value.denominator
    || !(value.basisPoints === null || safeInteger(value.basisPoints))
    || value.basisPoints !== (value.denominator === 0
      ? null
      : Math.round((value.numerator / value.denominator) * 10_000))
    || !record(value.comparison)
    || !exactKeys(value.comparison, [
      'availability',
      'previousBasisPoints',
      'deltaBasisPoints',
    ])
    || value.comparison.availability !== 'NOT_PROVIDED'
    || value.comparison.previousBasisPoints !== null
    || value.comparison.deltaBasisPoints !== null) {
    invalid()
  }
  return value as unknown as AdminDashboardRateMetric
}

function parseUnavailableSection(value: unknown): AdminDashboardUnavailableSection {
  if (!record(value)
    || !optionalExactKeys(value, ['availability'], ['reasonCode'])
    || !unavailableStates.has(value.availability as AdminDashboardAvailability)
    || !(value.reasonCode === undefined
      || (value.availability === 'NOT_PROVIDED'
        && typeof value.reasonCode === 'string'
        && /^[A-Z][A-Z0-9_]{2,80}$/.test(value.reasonCode)))) {
    invalid()
  }
  return value as unknown as AdminDashboardUnavailableSection
}

function parsePeople(value: unknown): AdminDashboardPeople {
  if (!record(value) || value.availability !== 'AVAILABLE') {
    return parseUnavailableSection(value)
  }
  const keys = [
    'availability',
    'activeAccounts',
    'activePlayers',
    'guests',
    'newAccounts',
    'profiledUsers',
    'interactingPlayers30d',
    'playerInteractionRate30d',
    'recordedProfileVisits',
    'distinctProfileVisitors',
  ]
  if (!exactKeys(value, keys)) {
    invalid()
  }
  return {
    availability: 'AVAILABLE',
    activeAccounts: parseCountMetric(value.activeAccounts),
    activePlayers: parseCountMetric(value.activePlayers),
    guests: parseCountMetric(value.guests),
    newAccounts: parseCountMetric(value.newAccounts),
    profiledUsers: parseCountMetric(value.profiledUsers),
    interactingPlayers30d: parseCountMetric(value.interactingPlayers30d),
    playerInteractionRate30d: parseRateMetric(value.playerInteractionRate30d),
    recordedProfileVisits: parseCountMetric(value.recordedProfileVisits),
    distinctProfileVisitors: parseCountMetric(value.distinctProfileVisitors),
  }
}

function parseMembershipSeries(value: unknown): AdminDashboardMembershipSeriesItem[] {
  if (!Array.isArray(value) || value.length > 370) {
    invalid()
  }
  let previous = ''
  return value.map((item) => {
    if (!record(item)
      || !exactKeys(item, [
        'bucketStartDate',
        'initialPurchaseCount',
        'firstRenewalCount',
        'repeatRenewalCount',
        'eligiblePurchaseCount',
        'eligiblePaidAmountCents',
      ])
      || typeof item.bucketStartDate !== 'string'
      || !datePattern.test(item.bucketStartDate)
      || item.bucketStartDate <= previous
      || !safeCount(item.initialPurchaseCount)
      || !safeCount(item.firstRenewalCount)
      || !safeCount(item.repeatRenewalCount)
      || !safeCount(item.eligiblePurchaseCount)
      || item.initialPurchaseCount + item.firstRenewalCount + item.repeatRenewalCount
      !== item.eligiblePurchaseCount
      || !safeCount(item.eligiblePaidAmountCents)) {
      invalid()
    }
    previous = item.bucketStartDate
    return item as unknown as AdminDashboardMembershipSeriesItem
  })
}

function parseMembershipPurchaseFlow(value: unknown): AdminDashboardMembershipPurchaseFlow {
  if (!record(value) || value.availability !== 'AVAILABLE') {
    return parseUnavailableSection(value)
  }
  if (!exactKeys(value, [
    'availability',
    'initialPurchases',
    'firstRenewals',
    'repeatRenewals',
    'eligiblePurchases',
    'eligiblePaidAmount',
    'series',
  ])) {
    invalid()
  }
  return {
    availability: 'AVAILABLE',
    initialPurchases: parseCountMetric(value.initialPurchases),
    firstRenewals: parseCountMetric(value.firstRenewals),
    repeatRenewals: parseCountMetric(value.repeatRenewals),
    eligiblePurchases: parseCountMetric(value.eligiblePurchases),
    eligiblePaidAmount: parseMoneyMetric(value.eligiblePaidAmount),
    series: parseMembershipSeries(value.series),
  }
}

function parseMembership(value: unknown): AdminDashboardMembership {
  if (!record(value)
    || !exactKeys(value, [
      'availability',
      'currentPlayers',
      'expiringPlayers30d',
      'purchaseFlow',
    ])
    || !availabilities.has(value.availability as AdminDashboardAvailability)) {
    invalid()
  }
  return {
    availability: value.availability as AdminDashboardAvailability,
    currentPlayers: parseCountMetric(value.currentPlayers),
    expiringPlayers30d: parseCountMetric(value.expiringPlayers30d),
    purchaseFlow: parseMembershipPurchaseFlow(value.purchaseFlow),
  }
}

function parseEventSeries(value: unknown) {
  if (!Array.isArray(value) || value.length > 370) {
    invalid()
  }
  let previous = ''
  return value.map((item) => {
    if (!record(item)
      || !exactKeys(item, [
        'bucketStartDate',
        'scheduledEventCount',
        'effectiveRegistrationCount',
      ])
      || typeof item.bucketStartDate !== 'string'
      || !datePattern.test(item.bucketStartDate)
      || item.bucketStartDate <= previous
      || !safeCount(item.scheduledEventCount)
      || !safeCount(item.effectiveRegistrationCount)) {
      invalid()
    }
    previous = item.bucketStartDate
    return item as { bucketStartDate: string, scheduledEventCount: number, effectiveRegistrationCount: number }
  })
}

function parseEventQuality(value: unknown) {
  if (!record(value)
    || !exactKeys(value, [
      'availability',
      'endedEvents',
      'effectiveRegistrations',
      'checkedInParticipants',
      'checkInRate',
    ])
    || value.availability !== 'AVAILABLE') {
    invalid()
  }
  return {
    availability: 'AVAILABLE' as const,
    endedEvents: parseCountMetric(value.endedEvents),
    effectiveRegistrations: parseCountMetric(value.effectiveRegistrations),
    checkedInParticipants: parseCountMetric(value.checkedInParticipants),
    checkInRate: parseRateMetric(value.checkInRate),
  }
}

function parseEventFeedback(value: unknown): Extract<AdminDashboardEvents, { availability: 'AVAILABLE' }>['feedback'] {
  if (!record(value) || value.availability !== 'AVAILABLE') {
    return parseUnavailableSection(value)
  }
  if (!exactKeys(value, [
    'availability',
    'submissions',
    'eligibleCheckIns',
    'submissionRate',
    'ratedSubmissions',
    'averageRating',
  ])
  || !(value.averageRating === null
    || (typeof value.averageRating === 'number'
      && Number.isFinite(value.averageRating)
      && value.averageRating >= 1
      && value.averageRating <= 5))) {
    invalid()
  }
  return {
    availability: 'AVAILABLE',
    submissions: parseCountMetric(value.submissions),
    eligibleCheckIns: parseCountMetric(value.eligibleCheckIns),
    submissionRate: parseRateMetric(value.submissionRate),
    ratedSubmissions: parseCountMetric(value.ratedSubmissions),
    averageRating: value.averageRating,
  }
}

function parseEventFinancials(value: unknown): Extract<AdminDashboardEvents, { availability: 'AVAILABLE' }>['financials'] {
  if (!record(value) || value.availability !== 'AVAILABLE') {
    return parseUnavailableSection(value)
  }
  if (!exactKeys(value, [
    'availability',
    'paidOrders',
    'grossAmount',
    'refundedAmount',
    'netAmount',
  ])) {
    invalid()
  }
  return {
    availability: 'AVAILABLE',
    paidOrders: parseCountMetric(value.paidOrders),
    grossAmount: parseMoneyMetric(value.grossAmount),
    refundedAmount: parseMoneyMetric(value.refundedAmount),
    netAmount: parseMoneyMetric(value.netAmount),
  }
}

function parseEvents(value: unknown): AdminDashboardEvents {
  if (!record(value) || value.availability !== 'AVAILABLE') {
    return parseUnavailableSection(value)
  }
  if (!exactKeys(value, [
    'availability',
    'totalEvents',
    'registrationOpenEvents',
    'effectiveRegistrations',
    'pendingReviewRegistrations',
    'quality',
    'feedback',
    'financials',
    'traffic',
    'series',
  ])
  || !record(value.traffic)
  || !exactKeys(value.traffic, ['views', 'shares'])) {
    invalid()
  }
  return {
    availability: 'AVAILABLE',
    totalEvents: parseCountMetric(value.totalEvents),
    registrationOpenEvents: parseCountMetric(value.registrationOpenEvents),
    effectiveRegistrations: parseCountMetric(value.effectiveRegistrations),
    pendingReviewRegistrations: parseCountMetric(value.pendingReviewRegistrations),
    quality: parseEventQuality(value.quality),
    feedback: parseEventFeedback(value.feedback),
    financials: parseEventFinancials(value.financials),
    traffic: {
      views: parseCountMetric(value.traffic.views),
      shares: parseCountMetric(value.traffic.shares),
    },
    series: parseEventSeries(value.series),
  }
}

function parseOpportunities(value: unknown): AdminDashboardOpportunities {
  if (!record(value) || value.availability !== 'AVAILABLE') {
    return parseUnavailableSection(value)
  }
  if (!exactKeys(value, [
    'availability',
    'totalOpportunities',
    'publishedOpportunities',
    'publishedLifecycleOpportunities',
    'opportunitiesWithActiveTeam',
    'teamFormationRate',
    'activeReferrals',
    'publishedCooperationCards',
    'publishedSuperCases',
    'trueConversionRate',
  ])) {
    invalid()
  }
  return {
    availability: 'AVAILABLE',
    totalOpportunities: parseCountMetric(value.totalOpportunities),
    publishedOpportunities: parseCountMetric(value.publishedOpportunities),
    publishedLifecycleOpportunities: parseCountMetric(value.publishedLifecycleOpportunities),
    opportunitiesWithActiveTeam: parseCountMetric(value.opportunitiesWithActiveTeam),
    teamFormationRate: parseRateMetric(value.teamFormationRate),
    activeReferrals: parseCountMetric(value.activeReferrals),
    publishedCooperationCards: parseCountMetric(value.publishedCooperationCards),
    publishedSuperCases: parseCountMetric(value.publishedSuperCases),
    trueConversionRate: parseRateMetric(value.trueConversionRate),
  }
}

function parseTasks(value: unknown): AdminDashboardTasks {
  if (!record(value) || value.availability !== 'AVAILABLE') {
    return parseUnavailableSection(value)
  }
  if (!exactKeys(value, [
    'availability',
    'publishedTasks',
    'successfulCompletions',
    'awardedExperience',
    'pendingReview',
  ])) {
    invalid()
  }
  return {
    availability: 'AVAILABLE',
    publishedTasks: parseCountMetric(value.publishedTasks),
    successfulCompletions: parseCountMetric(value.successfulCompletions),
    awardedExperience: parseCountMetric(value.awardedExperience),
    pendingReview: parseCountMetric(value.pendingReview),
  }
}

function parseActivity(value: unknown): AdminDashboardActivity {
  if (!record(value)
    || !exactKeys(value, ['id', 'kind', 'occurredAt', 'actor', 'resource', 'scope'])
    || !text(value.id, 160)
    || !activityKinds.has(String(value.kind))
    || !instant(value.occurredAt)
    || !record(value.actor)
    || !exactKeys(value.actor, ['userId', 'displayName'])
    || !(value.actor.userId === null || text(value.actor.userId, 64))
    || !(value.actor.displayName === null || text(value.actor.displayName, 64))
    || !record(value.resource)
    || !exactKeys(value.resource, ['type', 'id', 'title'])
    || !text(value.resource.type, 64)
    || !(value.resource.id === null || text(value.resource.id, 160))
    || !(value.resource.title === null || text(value.resource.title, 200))
    || !record(value.scope)
    || !exactKeys(value.scope, ['type', 'id'])
    || !['PLATFORM', 'BRANCH', 'EVENT', 'RESOURCE'].includes(String(value.scope.type))
    || !(value.scope.id === null || text(value.scope.id, 160))) {
    invalid()
  }
  return value as unknown as AdminDashboardActivity
}

function parseOperations(value: unknown): AdminDashboardOperations {
  if (!record(value) || value.availability !== 'AVAILABLE') {
    return parseUnavailableSection(value)
  }
  if (!exactKeys(value, ['availability', 'activity'])
    || !Array.isArray(value.activity)
    || value.activity.length > 20) {
    invalid()
  }
  return {
    availability: 'AVAILABLE',
    activity: value.activity.map(parseActivity),
  }
}

function parseScope(value: unknown): AdminDashboardOverview['scope'] {
  if (!record(value) || typeof value.type !== 'string') {
    invalid()
  }
  if (value.type === 'AUTHORIZED' || value.type === 'PLATFORM') {
    if (!exactKeys(value, ['type', 'id']) || value.id !== null) {
      invalid()
    }
    return value as AdminDashboardOverview['scope']
  }
  if (value.type === 'BRANCH') {
    if (!exactKeys(value, ['type', 'id', 'name', 'status'])
      || typeof value.id !== 'string'
      || !uuidPattern.test(value.id)
      || !text(value.name, 120)
      || !text(value.status, 32)) {
      invalid()
    }
    return value as AdminDashboardOverview['scope']
  }
  if (value.type === 'EVENT') {
    if (!exactKeys(value, ['type', 'id', 'name', 'status', 'branchId'])
      || typeof value.id !== 'string'
      || !uuidPattern.test(value.id)
      || !text(value.name, 200)
      || !text(value.status, 32)
      || !(value.branchId === null
        || (typeof value.branchId === 'string' && uuidPattern.test(value.branchId)))) {
      invalid()
    }
    return value as AdminDashboardOverview['scope']
  }
  invalid()
}

function parsePeriod(value: unknown, asOf: string): AdminDashboardOverview['period'] {
  if (!record(value)
    || !exactKeys(value, [
      'preset',
      'startAt',
      'endAt',
      'comparisonStartAt',
      'comparisonEndAt',
      'granularity',
    ])
    || !presets.has(value.preset as AdminDashboardOverviewPreset)
    || !granularities.has(value.granularity as AdminDashboardOverviewGranularity)
    || !instant(value.startAt)
    || !instant(value.endAt)
    || !instant(value.comparisonStartAt)
    || !instant(value.comparisonEndAt)) {
    invalid()
  }
  const startAt = Date.parse(value.startAt)
  const endAt = Date.parse(value.endAt)
  const comparisonStartAt = Date.parse(value.comparisonStartAt)
  const comparisonEndAt = Date.parse(value.comparisonEndAt)
  if (startAt >= endAt
    || endAt > Date.parse(asOf)
    || comparisonStartAt >= comparisonEndAt
    || comparisonEndAt !== startAt
    || comparisonEndAt - comparisonStartAt !== endAt - startAt) {
    invalid()
  }
  return value as AdminDashboardOverview['period']
}

function countValue(metric: AdminDashboardCountMetric) {
  return metric.availability === 'AVAILABLE' ? metric.count : null
}

function requiredCount(metric: AdminDashboardCountMetric) {
  const value = countValue(metric)
  if (value === null) {
    invalid()
  }
  return value
}

function safeSum(values: number[]) {
  let total = 0
  for (const value of values) {
    total += value
    if (!safeCount(total)) {
      invalid()
    }
  }
  return total
}

function calendarInstant(value: string) {
  if (!datePattern.test(value)) {
    invalid()
  }
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day) {
    invalid()
  }
  return Date.parse(`${value}T00:00:00.000+08:00`)
}

function validateSeriesBuckets(
  series: Array<{ bucketStartDate: string }>,
  period: AdminDashboardOverview['period'],
) {
  const leadDays = period.granularity === 'MONTH' ? 31 : period.granularity === 'WEEK' ? 6 : 0
  const lowerBound = Date.parse(period.startAt) - leadDays * dayMs
  const upperBound = Date.parse(period.endAt)
  for (const item of series) {
    const bucket = calendarInstant(item.bucketStartDate)
    if (bucket < lowerBound || bucket >= upperBound) {
      invalid()
    }
  }
}

function validateOverviewRelations(overview: AdminDashboardOverview) {
  if (overview.people.availability === 'AVAILABLE') {
    const activeAccounts = requiredCount(overview.people.activeAccounts)
    const activePlayers = requiredCount(overview.people.activePlayers)
    const guests = requiredCount(overview.people.guests)
    const newAccounts = requiredCount(overview.people.newAccounts)
    const profiledUsers = requiredCount(overview.people.profiledUsers)
    const interactingPlayers = requiredCount(overview.people.interactingPlayers30d)
    const recordedVisits = requiredCount(overview.people.recordedProfileVisits)
    const distinctVisitors = requiredCount(overview.people.distinctProfileVisitors)
    const interactionRate = overview.people.playerInteractionRate30d
    if (activePlayers > activeAccounts
      || guests !== activeAccounts - activePlayers
      || newAccounts > activeAccounts
      || profiledUsers > activeAccounts
      || interactingPlayers > activePlayers
      || distinctVisitors > recordedVisits
      || interactionRate.availability !== 'AVAILABLE'
      || interactionRate.numerator !== interactingPlayers
      || interactionRate.denominator !== activePlayers) {
      invalid()
    }
  }

  const currentPlayers = countValue(overview.membership.currentPlayers)
  const expiringPlayers = countValue(overview.membership.expiringPlayers30d)
  if (currentPlayers !== null && expiringPlayers !== null && expiringPlayers > currentPlayers) {
    invalid()
  }
  if (overview.membership.purchaseFlow.availability === 'AVAILABLE') {
    const flow = overview.membership.purchaseFlow
    const initial = requiredCount(flow.initialPurchases)
    const firstRenewal = requiredCount(flow.firstRenewals)
    const repeatRenewal = requiredCount(flow.repeatRenewals)
    const eligible = requiredCount(flow.eligiblePurchases)
    const seriesInitial = safeSum(flow.series.map(item => item.initialPurchaseCount))
    const seriesFirstRenewal = safeSum(flow.series.map(item => item.firstRenewalCount))
    const seriesRepeatRenewal = safeSum(flow.series.map(item => item.repeatRenewalCount))
    const seriesEligible = safeSum(flow.series.map(item => item.eligiblePurchaseCount))
    const seriesAmount = safeSum(flow.series.map(item => item.eligiblePaidAmountCents))
    if (initial + firstRenewal + repeatRenewal !== eligible
      || initial !== seriesInitial
      || firstRenewal !== seriesFirstRenewal
      || repeatRenewal !== seriesRepeatRenewal
      || eligible !== seriesEligible
      || flow.eligiblePaidAmount.amountCents !== seriesAmount) {
      invalid()
    }
    validateSeriesBuckets(flow.series, overview.period)
  }

  if (overview.events.availability === 'AVAILABLE') {
    const events = overview.events
    const totalEvents = requiredCount(events.totalEvents)
    const openEvents = requiredCount(events.registrationOpenEvents)
    const effectiveRegistrations = requiredCount(events.effectiveRegistrations)
    const seriesRegistrations = safeSum(events.series.map(item => item.effectiveRegistrationCount))
    const qualityRegistrations = requiredCount(events.quality.effectiveRegistrations)
    const checkedIn = requiredCount(events.quality.checkedInParticipants)
    const checkInRate = events.quality.checkInRate
    if (openEvents > totalEvents
      || effectiveRegistrations !== seriesRegistrations
      || checkedIn > qualityRegistrations
      || checkInRate.availability !== 'AVAILABLE'
      || checkInRate.numerator !== checkedIn
      || checkInRate.denominator !== qualityRegistrations) {
      invalid()
    }
    if (events.feedback.availability === 'AVAILABLE') {
      const submissions = requiredCount(events.feedback.submissions)
      const eligibleCheckIns = requiredCount(events.feedback.eligibleCheckIns)
      const rated = requiredCount(events.feedback.ratedSubmissions)
      const submissionRate = events.feedback.submissionRate
      if (rated > submissions
        || submissions > eligibleCheckIns
        || submissionRate.availability !== 'AVAILABLE'
        || submissionRate.numerator !== submissions
        || submissionRate.denominator !== eligibleCheckIns
        || (events.feedback.averageRating === null) !== (rated === 0)) {
        invalid()
      }
    }
    if (events.financials.availability === 'AVAILABLE') {
      const gross = events.financials.grossAmount.amountCents
      const refunded = events.financials.refundedAmount.amountCents
      const net = events.financials.netAmount.amountCents
      if (refunded > gross || net !== gross - refunded) {
        invalid()
      }
    }
    validateSeriesBuckets(events.series, overview.period)
  }

  if (overview.opportunities.availability === 'AVAILABLE') {
    const opportunities = overview.opportunities
    const total = requiredCount(opportunities.totalOpportunities)
    const published = requiredCount(opportunities.publishedOpportunities)
    const lifecycle = requiredCount(opportunities.publishedLifecycleOpportunities)
    const withTeam = requiredCount(opportunities.opportunitiesWithActiveTeam)
    const teamRate = opportunities.teamFormationRate
    if (published > total
      || lifecycle > total
      || withTeam > lifecycle
      || teamRate.availability !== 'AVAILABLE'
      || teamRate.numerator !== withTeam
      || teamRate.denominator !== lifecycle) {
      invalid()
    }
  }

  if (overview.operations.availability === 'AVAILABLE') {
    const seen = new Set<string>()
    let previous = Number.POSITIVE_INFINITY
    const lowerBound = Date.parse(overview.period.startAt)
    const upperBound = Date.parse(overview.period.endAt)
    for (const activity of overview.operations.activity) {
      const occurredAt = Date.parse(activity.occurredAt)
      if (seen.has(activity.id)
        || occurredAt < lowerBound
        || occurredAt >= upperBound
        || occurredAt > previous) {
        invalid()
      }
      seen.add(activity.id)
      previous = occurredAt
    }
  }
}

export function parseDashboardOverview(value: unknown): AdminDashboardOverview {
  if (!record(value)
    || !exactKeys(value, [
      'schemaVersion',
      'asOf',
      'timeZone',
      'scope',
      'period',
      'people',
      'membership',
      'events',
      'opportunities',
      'tasks',
      'operations',
    ])
    || value.schemaVersion !== 1
    || !instant(value.asOf)
    || value.timeZone !== 'Asia/Shanghai') {
    invalid()
  }
  const overview: AdminDashboardOverview = {
    schemaVersion: 1,
    asOf: value.asOf,
    timeZone: 'Asia/Shanghai',
    scope: parseScope(value.scope),
    period: parsePeriod(value.period, value.asOf),
    people: parsePeople(value.people),
    membership: parseMembership(value.membership),
    events: parseEvents(value.events),
    opportunities: parseOpportunities(value.opportunities),
    tasks: parseTasks(value.tasks),
    operations: parseOperations(value.operations),
  }
  validateOverviewRelations(overview)
  return overview
}
