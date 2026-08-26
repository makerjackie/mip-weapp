import type { AdminRequest } from '../src/modules/mip-admin/request-contract'
import type { AdminTransport } from '../src/modules/mip-admin/transport'
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createMipAdminGateway } from '../src/modules/mip-admin/cloudbase-gateway'
import { parseDashboardOverview } from '../src/modules/mip-admin/dashboard-overview'
import { MipAdminError } from '../src/modules/mip-admin/types'
import { buildDashboardViewModel } from '../src/packages/admin/dashboard/model'

vi.mock('../src/modules/platform/cloudbase', () => ({
  requireCloudClient: vi.fn(),
}))

vi.mock('../src/config/runtime', () => ({
  runtimeConfig: { cloudbase: { adminFunctionName: 'mip-admin-api' } },
}))

const unavailableComparison = {
  availability: 'NOT_PROVIDED',
  previousCount: null,
  deltaCount: null,
  changeBasisPoints: null,
}

function countMetric(count: number, previous?: number) {
  return {
    availability: 'AVAILABLE',
    count,
    comparison: previous === undefined
      ? unavailableComparison
      : {
          availability: 'AVAILABLE',
          previousCount: previous,
          deltaCount: count - previous,
          changeBasisPoints: previous === 0
            ? null
            : Math.round(((count - previous) / previous) * 10_000),
        },
  }
}

function unavailableCount(availability = 'NOT_PROVIDED') {
  return { availability, count: null }
}

function rateMetric(numerator: number, denominator: number) {
  return {
    availability: 'AVAILABLE',
    basisPoints: denominator === 0 ? null : Math.round((numerator / denominator) * 10_000),
    numerator,
    denominator,
    comparison: {
      availability: 'NOT_PROVIDED',
      previousBasisPoints: null,
      deltaBasisPoints: null,
    },
  }
}

function moneyMetric(amountCents: number) {
  return {
    availability: 'AVAILABLE',
    amountCents,
    currency: 'CNY',
    comparison: {
      availability: 'NOT_PROVIDED',
      previousAmountCents: null,
      deltaAmountCents: null,
      changeBasisPoints: null,
    },
  }
}

function overview() {
  return {
    schemaVersion: 1,
    asOf: '2030-08-26T04:00:00.000Z',
    timeZone: 'Asia/Shanghai',
    scope: { type: 'AUTHORIZED', id: null },
    period: {
      preset: 'TODAY',
      startAt: '2030-08-25T16:00:00.000Z',
      endAt: '2030-08-26T04:00:00.000Z',
      comparisonStartAt: '2030-08-25T04:00:00.000Z',
      comparisonEndAt: '2030-08-25T16:00:00.000Z',
      granularity: 'DAY',
    },
    people: {
      availability: 'AVAILABLE',
      activeAccounts: countMetric(12),
      activePlayers: countMetric(8),
      guests: countMetric(4),
      newAccounts: countMetric(3, 2),
      profiledUsers: countMetric(10),
      interactingPlayers30d: countMetric(4),
      playerInteractionRate30d: rateMetric(4, 8),
      recordedProfileVisits: countMetric(6),
      distinctProfileVisitors: countMetric(5),
    },
    membership: {
      availability: 'AVAILABLE',
      currentPlayers: countMetric(8),
      expiringPlayers30d: countMetric(2),
      purchaseFlow: {
        availability: 'AVAILABLE',
        initialPurchases: countMetric(2),
        firstRenewals: countMetric(1),
        repeatRenewals: countMetric(1),
        eligiblePurchases: countMetric(4),
        eligiblePaidAmount: moneyMetric(39_600),
        series: [{
          bucketStartDate: '2030-08-26',
          initialPurchaseCount: 2,
          firstRenewalCount: 1,
          repeatRenewalCount: 1,
          eligiblePurchaseCount: 4,
          eligiblePaidAmountCents: 39_600,
        }],
      },
    },
    events: {
      availability: 'AVAILABLE',
      totalEvents: countMetric(5),
      registrationOpenEvents: countMetric(2),
      effectiveRegistrations: countMetric(7, 5),
      pendingReviewRegistrations: countMetric(1),
      quality: {
        availability: 'AVAILABLE',
        endedEvents: countMetric(1),
        effectiveRegistrations: countMetric(5),
        checkedInParticipants: countMetric(4),
        checkInRate: rateMetric(4, 5),
      },
      feedback: {
        availability: 'AVAILABLE',
        submissions: countMetric(3),
        eligibleCheckIns: countMetric(4),
        submissionRate: rateMetric(3, 4),
        ratedSubmissions: countMetric(3),
        averageRating: 4.7,
      },
      financials: {
        availability: 'AVAILABLE',
        paidOrders: countMetric(3),
        grossAmount: moneyMetric(30_000),
        refundedAmount: moneyMetric(5_000),
        netAmount: moneyMetric(25_000),
      },
      traffic: {
        views: unavailableCount('NOT_TRACKED'),
        shares: unavailableCount('NOT_TRACKED'),
      },
      series: [{
        bucketStartDate: '2030-08-26',
        scheduledEventCount: 1,
        effectiveRegistrationCount: 7,
      }],
    },
    opportunities: {
      availability: 'AVAILABLE',
      totalOpportunities: countMetric(6),
      publishedOpportunities: countMetric(4),
      publishedLifecycleOpportunities: countMetric(5),
      opportunitiesWithActiveTeam: countMetric(3),
      teamFormationRate: rateMetric(3, 5),
      activeReferrals: countMetric(8),
      publishedCooperationCards: countMetric(9),
      publishedSuperCases: countMetric(7),
      trueConversionRate: {
        availability: 'NOT_TRACKED',
        basisPoints: null,
        numerator: null,
        denominator: null,
      },
    },
    tasks: {
      availability: 'AVAILABLE',
      publishedTasks: countMetric(4),
      successfulCompletions: countMetric(6),
      awardedExperience: countMetric(120),
      pendingReview: unavailableCount(),
    },
    operations: {
      availability: 'AVAILABLE',
      activity: [{
        id: 'outbox:event-a',
        kind: 'event.registration_confirmed',
        occurredAt: '2030-08-26T03:00:00.000Z',
        actor: { userId: 'user-a', displayName: '运营成员' },
        resource: { type: 'EVENT', id: 'event-a', title: '长期测试活动' },
        scope: { type: 'EVENT', id: 'event-a' },
      }],
    },
  }
}

describe('MIP admin dashboard overview client and page', () => {
  it('strictly parses the factual v1 projection and rejects nested drift', () => {
    const parsed = parseDashboardOverview(overview())

    expect(parsed.membership.currentPlayers).toMatchObject({ count: 8 })
    expect(parsed.events).toMatchObject({ availability: 'AVAILABLE' })
    expect(() => parseDashboardOverview({ ...overview(), openId: 'sensitive' })).toThrow(MipAdminError)
    expect(() => parseDashboardOverview({
      ...overview(),
      people: { ...overview().people, totalRevenue: 99 },
    })).toThrow(MipAdminError)
    expect(() => parseDashboardOverview({
      ...overview(),
      people: {
        ...overview().people,
        newAccounts: {
          ...overview().people.newAccounts,
          comparison: {
            availability: 'AVAILABLE',
            previousCount: 2,
            deltaCount: 99,
            changeBasisPoints: 5_000,
          },
        },
      },
    })).toThrow(MipAdminError)
  })

  it('rejects contradictory facts and out-of-window series or activity', () => {
    const inconsistentPeople = overview()
    inconsistentPeople.people.guests = countMetric(5)

    const inconsistentMoney = overview()
    inconsistentMoney.events.financials.netAmount = moneyMetric(25_001)

    const futureActivity = overview()
    futureActivity.operations.activity[0].occurredAt = futureActivity.period.endAt

    const invalidBucket = overview()
    invalidBucket.membership.purchaseFlow.series[0].bucketStartDate = '2030-99-99'

    for (const value of [inconsistentPeople, inconsistentMoney, futureActivity, invalidBucket]) {
      expect(() => parseDashboardOverview(value)).toThrow(MipAdminError)
    }
  })

  it('uses the new neutral action with v1 nested input while retaining the legacy gateway', async () => {
    const requests: AdminRequest[] = []
    const transport: AdminTransport = {
      request: vi.fn(async (request: AdminRequest) => {
        requests.push(request)
        return request.action === 'mip.admin.dashboard.overview.get'
          ? overview()
          : { session: { enabled: true, capabilities: [], roles: [] }, counts: {} }
      }) as AdminTransport['request'],
    }
    const gateway = createMipAdminGateway(transport)

    await gateway.getDashboardOverview({ period: { preset: 'LAST_30_DAYS' } })
    await gateway.getDashboard()

    expect(requests).toEqual([
      {
        contractVersion: 1,
        action: 'mip.admin.dashboard.overview.get',
        input: { period: { preset: 'LAST_30_DAYS' } },
      },
      {
        contractVersion: 1,
        action: 'mip.admin.dashboard',
        input: {},
      },
    ])
  })

  it('formats only server-returned facts and keeps unknown metrics explicit', () => {
    const view = buildDashboardViewModel(parseDashboardOverview(overview()))

    expect(view.summaryMetrics.map(item => item.value)).toEqual(['8', '3', '2', '7', '4', '6'])
    expect(view.opportunityMetrics.find(item => item.key === 'opportunities-conversion'))
      .toMatchObject({ value: '—', detail: '暂未统计', available: false })
    expect(view.activities[0]).toMatchObject({
      title: '活动报名已确认',
      actor: '运营成员',
      resource: '长期测试活动',
      scope: '活动',
    })
  })

  it('keeps visible membership facts when purchase attribution is unavailable', () => {
    const parsed = parseDashboardOverview(overview())
    parsed.membership.purchaseFlow = { availability: 'NOT_PROVIDED' }
    const view = buildDashboardViewModel(parsed)

    expect(view.membershipMetrics[0]).toMatchObject({
      key: 'membership-expiring',
      value: '2',
      available: true,
    })
    expect(view.membershipMetrics[1]).toMatchObject({
      key: 'membership-purchase-flow',
      value: '—',
      available: false,
    })
  })

  it('distinguishes unnamed users from system activity and formats custom Shanghai dates', () => {
    const value = overview()
    value.operations.activity[0].actor.displayName = null
    value.period = {
      preset: 'CUSTOM',
      startAt: '2030-08-24T16:00:00.000Z',
      endAt: '2030-08-26T04:00:00.000Z',
      comparisonStartAt: '2030-08-23T04:00:00.000Z',
      comparisonEndAt: '2030-08-24T16:00:00.000Z',
      granularity: 'DAY',
    }
    const view = buildDashboardViewModel(parseDashboardOverview(value))

    expect(view.activities[0].actor).toBe('未命名用户')
    expect(view.periodLabel).toBe('2030-08-25 至 2030-08-26')
  })

  it('uses responsive record and detail primitives without replacing existing admin routes', () => {
    const root = path.resolve(import.meta.dirname, '../src/packages/admin/dashboard')
    const script = fs.readFileSync(path.join(root, 'index.ts'), 'utf8')
    const template = fs.readFileSync(path.join(root, 'index.wxml'), 'utf8')
    const config = JSON.parse(fs.readFileSync(path.join(root, 'index.json'), 'utf8'))

    expect(script).toContain('getDashboardOverview')
    expect(script).toContain('getSession(force)')
    expect(script).toContain('seq !== this.requestSeq')
    expect(script).toContain('isAdminForbiddenError(error)')
    expect(script).toContain('view: emptyDashboardViewModel')
    expect(script).not.toContain('counts: emptyCounts')
    expect(template).toContain('class="mip-admin-record-list mt-4"')
    expect(template).toContain('<mip-admin-responsive-panel')
    expect(template).toContain('数据概览')
    expect(template).toContain('/packages/admin/managed-events/index')
    expect(template).toContain('/packages/admin/event-catalogs/index')
    expect(template).toContain('/packages/admin/event-recaps/index')
    expect(template).toContain('/packages/admin/opportunities/index')
    expect(script).toContain(`hasPlatformCapability(grants, 'events.catalog.manage')`)
    expect(script).toContain(`hasPlatformCapability(grants, 'events.recaps.manage')`)
    expect(template).not.toContain('opportunityConversionRate')
    expect(config.usingComponents['mip-admin-responsive-panel'])
      .toBe('/packages/admin/components/responsive-panel/index')
  })
})
