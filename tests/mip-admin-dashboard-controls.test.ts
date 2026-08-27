import type {
  AdminBranch,
  AdminCapabilityGrant,
  AdminDashboardOverview,
} from '../src/modules/mip-admin'
import { readFileSync } from 'node:fs'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildDashboardMenuGroups,
  buildDashboardScopeOptions,
  buildDashboardViewModel,
  canLoadDashboardBranchCatalog,
  normalizedDashboardTrendWidth,
  validateDashboardCustomPeriod,
} from '../src/packages/admin/dashboard/model'

const adminMocks = vi.hoisted(() => {
  class MipAdminError extends Error {
    readonly code: string

    constructor(code: string, message: string) {
      super(message)
      this.code = code
    }
  }
  return {
    MipAdminError,
    getSession: vi.fn(),
    getDashboardOverview: vi.fn(),
    listBranches: vi.fn(),
  }
})

vi.mock('../src/modules/mip-admin', () => ({
  MipAdminError: adminMocks.MipAdminError,
  hasCapability: (grants: Array<{ capability: string }>, capability: string) => (
    grants.some(grant => grant.capability === capability)
  ),
  mipAdminModule: {
    getSession: adminMocks.getSession,
    getDashboardOverview: adminMocks.getDashboardOverview,
    listBranches: adminMocks.listBranches,
  },
}))

type PageData = Record<string, unknown>
type PageDefinition = PageData & {
  data: PageData
  setData: (patch: PageData) => void
}

let definition: PageDefinition

function createPage(overrides: PageData = {}) {
  const page = Object.create(definition) as PageDefinition
  page.data = { ...structuredClone(definition.data), ...structuredClone(overrides) }
  page.setData = patch => Object.assign(page.data, patch)
  return page
}

function callPage(page: PageDefinition, method: string, ...args: unknown[]) {
  const handler = page[method]
  if (typeof handler !== 'function') {
    throw new TypeError(`Missing page method: ${method}`)
  }
  return Reflect.apply(handler, page, args) as Promise<unknown>
}

function countMetric(count: number) {
  return {
    availability: 'AVAILABLE' as const,
    count,
    comparison: {
      availability: 'NOT_PROVIDED' as const,
      previousCount: null,
      deltaCount: null,
      changeBasisPoints: null,
    },
  }
}

function rateMetric(numerator: number, denominator: number) {
  return {
    availability: 'AVAILABLE' as const,
    basisPoints: denominator === 0 ? null : Math.round((numerator / denominator) * 10_000),
    numerator,
    denominator,
    comparison: {
      availability: 'NOT_PROVIDED' as const,
      previousBasisPoints: null,
      deltaBasisPoints: null,
    },
  }
}

function moneyMetric(amountCents: number) {
  return {
    availability: 'AVAILABLE' as const,
    amountCents,
    currency: 'CNY' as const,
    comparison: {
      availability: 'NOT_PROVIDED' as const,
      previousAmountCents: null,
      deltaAmountCents: null,
      changeBasisPoints: null,
    },
  }
}

function overview(
  preset: AdminDashboardOverview['period']['preset'] = 'THIS_MONTH',
): AdminDashboardOverview {
  return {
    schemaVersion: 1,
    asOf: '2030-08-26T04:00:00.000Z',
    timeZone: 'Asia/Shanghai',
    scope: { type: 'AUTHORIZED', id: null },
    period: {
      preset,
      startAt: '2030-08-01T00:00:00.000Z',
      endAt: '2030-08-26T04:00:00.000Z',
      comparisonStartAt: '2030-07-06T20:00:00.000Z',
      comparisonEndAt: '2030-08-01T00:00:00.000Z',
      granularity: 'DAY',
    },
    people: {
      availability: 'AVAILABLE',
      activeAccounts: countMetric(12),
      activePlayers: countMetric(8),
      guests: countMetric(4),
      newAccounts: countMetric(3),
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
        initialPurchases: countMetric(71),
        firstRenewals: countMetric(20),
        repeatRenewals: countMetric(10),
        eligiblePurchases: countMetric(101),
        eligiblePaidAmount: moneyMetric(101_000),
        series: [{
          bucketStartDate: '2030-08-25',
          initialPurchaseCount: 1,
          firstRenewalCount: 0,
          repeatRenewalCount: 0,
          eligiblePurchaseCount: 1,
          eligiblePaidAmountCents: 1_000,
        }, {
          bucketStartDate: '2030-08-26',
          initialPurchaseCount: 70,
          firstRenewalCount: 20,
          repeatRenewalCount: 10,
          eligiblePurchaseCount: 100,
          eligiblePaidAmountCents: 100_000,
        }],
      },
    },
    events: {
      availability: 'AVAILABLE',
      totalEvents: countMetric(10),
      registrationOpenEvents: countMetric(4),
      effectiveRegistrations: countMetric(2),
      pendingReviewRegistrations: countMetric(1),
      quality: {
        availability: 'AVAILABLE',
        endedEvents: countMetric(1),
        effectiveRegistrations: countMetric(2),
        checkedInParticipants: countMetric(1),
        checkInRate: rateMetric(1, 2),
      },
      feedback: { availability: 'NOT_PROVIDED' },
      financials: { availability: 'NOT_PROVIDED' },
      traffic: {
        views: { availability: 'NOT_TRACKED', count: null },
        shares: { availability: 'NOT_TRACKED', count: null },
      },
      series: [{
        bucketStartDate: '2030-08-25',
        scheduledEventCount: 0,
        effectiveRegistrationCount: 2,
      }, {
        bucketStartDate: '2030-08-26',
        scheduledEventCount: 10,
        effectiveRegistrationCount: 0,
      }],
    },
    opportunities: { availability: 'NOT_PROVIDED' },
    tasks: { availability: 'NOT_PROVIDED' },
    operations: { availability: 'NOT_PROVIDED' },
  }
}

function branch(id: string, name: string, status: AdminBranch['status'] = 'ACTIVE'): AdminBranch {
  return {
    id,
    branchKey: name.toLowerCase(),
    name,
    cityName: name,
    summary: '',
    status,
    version: 1,
    blockers: {
      activeMemberships: 0,
      activeBranchAdmins: 0,
      publishedEvents: 0,
      publishedOpportunities: 0,
    },
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((complete) => {
    resolve = complete
  })
  return { promise, resolve }
}

beforeAll(async () => {
  vi.stubGlobal('wx', {
    navigateTo: vi.fn(),
    stopPullDownRefresh: vi.fn(),
  })
  vi.stubGlobal('Page', (input: PageDefinition) => {
    definition = input
  })
  await import('../src/packages/admin/dashboard/index')
})

beforeEach(() => {
  adminMocks.getSession.mockReset().mockResolvedValue({
    enabled: true,
    capabilities: [{ capability: 'admin.dashboard', scopeType: 'PLATFORM', scopeId: null }],
    roles: [],
  })
  adminMocks.getDashboardOverview.mockReset().mockResolvedValue(overview())
  adminMocks.listBranches.mockReset().mockResolvedValue({ items: [], nextCursor: null })
})

describe('MIP admin dashboard controls and trends', () => {
  it('builds task-first actions and menu groups only from granted capabilities', () => {
    expect(buildDashboardMenuGroups([
      { capability: 'events.read', scopeType: 'PLATFORM', scopeId: null },
      { capability: 'users.read', scopeType: 'PLATFORM', scopeId: null },
      { capability: 'audit.read', scopeType: 'PLATFORM', scopeId: null },
    ])).toEqual([
      {
        key: 'users',
        label: '用户',
        items: [{
          key: 'profiles',
          label: '用户管理',
          description: '筛选用户并查看资料与会员状态',
          path: '/packages/admin/profiles/index',
        }],
      },
      {
        key: 'events',
        label: '活动',
        items: [{
          key: 'managed-events',
          label: '活动管理',
          description: '管理活动、报名、签到和队伍',
          path: '/packages/admin/managed-events/index',
        }],
      },
      {
        key: 'governance',
        label: '治理',
        items: [{
          key: 'audit',
          label: '审计记录',
          description: '查看敏感读取与管理变更',
          path: '/packages/admin/audit/index',
        }],
      },
    ])

    const scopedGroups = buildDashboardMenuGroups([
      { capability: 'messages.delivery.review', scopeType: 'BRANCH', scopeId: 'branch-1' },
      { capability: 'events.catalog.manage', scopeType: 'BRANCH', scopeId: 'branch-1' },
      { capability: 'banners.manage', scopeType: 'PLATFORM', scopeId: null },
    ])
    const scopedItems = scopedGroups.flatMap(group => group.items)

    expect(scopedItems.map(item => item.key)).toEqual(['banners', 'exceptions'])
  })

  it('collapses zero-value attention metrics into the shared empty state', () => {
    const value = overview()
    value.membership.expiringPlayers30d = countMetric(0)
    if (value.events.availability === 'AVAILABLE') {
      value.events.pendingReviewRegistrations = countMetric(0)
    }

    const view = buildDashboardViewModel(value, [
      { capability: 'events.read', scopeType: 'PLATFORM', scopeId: null },
      { capability: 'memberships.read', scopeType: 'PLATFORM', scopeId: null },
    ])

    expect(view.attentionItems).toEqual([])
  })

  it('validates inclusive custom dates locally before using the neutral period input', async () => {
    expect(validateDashboardCustomPeriod('', '', '2030-08-26')).toBe('请选择有效的开始日期和结束日期')
    expect(validateDashboardCustomPeriod('2030-08-27', '2030-08-26', '2030-08-26'))
      .toBe('开始日期不能晚于结束日期')
    expect(validateDashboardCustomPeriod('2030-08-01', '2030-08-27', '2030-08-26'))
      .toBe('结束日期不能晚于今天')
    expect(validateDashboardCustomPeriod('2029-08-25', '2030-08-26', '2030-08-26'))
      .toBe('自定义时间范围不能超过 366 天')
    expect(validateDashboardCustomPeriod('2029-08-27', '2030-08-26', '2030-08-26')).toBe('')

    const invalidPage = createPage({
      customStartDate: '2030-08-27',
      customEndDate: '2030-08-26',
      customMaxDate: '2030-08-26',
    })
    await callPage(invalidPage, 'applyCustomPeriod')
    expect(adminMocks.getDashboardOverview).not.toHaveBeenCalled()
    expect(invalidPage.data.customError).toBe('开始日期不能晚于结束日期')

    const validPage = createPage({
      state: 'ready',
      customStartDate: '2030-08-01',
      customEndDate: '2030-08-26',
      customMaxDate: '2030-08-26',
    })
    await callPage(validPage, 'applyCustomPeriod')
    expect(adminMocks.getDashboardOverview).toHaveBeenCalledWith({
      period: { preset: 'CUSTOM', startDate: '2030-08-01', endDate: '2030-08-26' },
      scope: { type: 'AUTHORIZED' },
    }, true)

    adminMocks.getDashboardOverview.mockClear()
    const clearPage = createPage({
      state: 'ready',
      selectedPreset: 'CUSTOM',
      successfulPeriod: {
        preset: 'CUSTOM',
        startDate: '2030-08-01',
        endDate: '2030-08-26',
      },
      customEditorOpen: true,
      customStartDate: '2030-08-01',
      customEndDate: '2030-08-26',
    })
    await callPage(clearPage, 'clearCustomPeriod')
    expect(adminMocks.getDashboardOverview).toHaveBeenCalledWith({
      period: { preset: 'THIS_MONTH' },
      scope: { type: 'AUTHORIZED' },
    }, true)
    expect(clearPage.data).toMatchObject({
      selectedPreset: 'THIS_MONTH',
      customEditorOpen: false,
      customStartDate: '',
      customEndDate: '',
    })
  })

  it('offers only dashboard-covered scopes and uses catalog names only when available', () => {
    const branchA = '10000000-0000-4000-8000-000000000001'
    const branchB = '20000000-0000-4000-8000-000000000002'
    const platformGrants: AdminCapabilityGrant[] = [{
      capability: 'admin.dashboard',
      scopeType: 'PLATFORM',
      scopeId: null,
    }, {
      capability: 'branches.manage',
      scopeType: 'PLATFORM',
      scopeId: null,
    }]
    expect(canLoadDashboardBranchCatalog(platformGrants)).toBe(true)
    expect(buildDashboardScopeOptions(platformGrants, [
      branch(branchA, '广州分会'),
      branch(branchB, '深圳分会', 'INACTIVE'),
    ]).map(item => [item.key, item.label])).toEqual([
      ['AUTHORIZED', '授权范围'],
      ['PLATFORM', '平台范围'],
      [`BRANCH:${branchA}`, '广州分会'],
      [`BRANCH:${branchB}`, '深圳分会（停用）'],
    ])

    const branchGrants: AdminCapabilityGrant[] = [{
      capability: 'admin.dashboard',
      scopeType: 'BRANCH',
      scopeId: branchA,
    }]
    expect(canLoadDashboardBranchCatalog(branchGrants)).toBe(false)
    expect(buildDashboardScopeOptions(branchGrants, [branch(branchB, '未授权分会')]))
      .toEqual([{
        key: 'AUTHORIZED',
        label: '授权范围',
        input: { type: 'AUTHORIZED' },
      }, {
        key: `BRANCH:${branchA}`,
        label: '当前城市分会',
        input: { type: 'BRANCH', id: branchA },
      }])
  })

  it('keeps the overview usable when the optional branch catalog is unavailable', async () => {
    adminMocks.getSession.mockResolvedValueOnce({
      enabled: true,
      capabilities: [{
        capability: 'admin.dashboard',
        scopeType: 'PLATFORM',
        scopeId: null,
      }, {
        capability: 'branches.manage',
        scopeType: 'PLATFORM',
        scopeId: null,
      }],
      roles: [],
    })
    adminMocks.listBranches.mockRejectedValueOnce(new Error('network'))
    const page = createPage()

    await callPage(page, 'loadDashboard')

    expect(page.data.state).toBe('ready')
    expect(page.data.scopeOptions).toEqual([
      { key: 'AUTHORIZED', label: '授权范围', input: { type: 'AUTHORIZED' } },
      { key: 'PLATFORM', label: '平台范围', input: { type: 'PLATFORM' } },
    ])
    expect(page.data.scopeMessage).toBe('城市分会列表暂不可用，可继续查看授权或平台范围。')
  })

  it('drops an older period response after a newer request wins', async () => {
    const first = deferred<AdminDashboardOverview>()
    const second = deferred<AdminDashboardOverview>()
    adminMocks.getDashboardOverview
      .mockReset()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise)
    const page = createPage({ state: 'ready' })

    const oldRequest = callPage(page, 'loadDashboard', true, { preset: 'TODAY' }, 'AUTHORIZED')
    await vi.waitFor(() => expect(adminMocks.getDashboardOverview).toHaveBeenCalledTimes(1))
    const newRequest = callPage(page, 'loadDashboard', true, { preset: 'THIS_WEEK' }, 'AUTHORIZED')
    await vi.waitFor(() => expect(adminMocks.getDashboardOverview).toHaveBeenCalledTimes(2))
    second.resolve(overview('THIS_WEEK'))
    await newRequest
    first.resolve(overview('TODAY'))
    await oldRequest

    expect(page.data.successfulPeriod).toEqual({ preset: 'THIS_WEEK' })
    expect((page.data.view as { periodLabel: string }).periodLabel).toBe('本周')
  })

  it('derives exact trends with visible nonzero bars and capability-gated downlinks', () => {
    expect(normalizedDashboardTrendWidth(0, 100)).toBe(0)
    expect(normalizedDashboardTrendWidth(1, 100)).toBe(8)
    expect(normalizedDashboardTrendWidth(100, 100)).toBe(100)

    const view = buildDashboardViewModel(overview(), [{
      capability: 'users.read',
      scopeType: 'PLATFORM',
      scopeId: null,
    }, {
      capability: 'events.roster.read',
      scopeType: 'PLATFORM',
      scopeId: null,
    }])
    expect(view.trends[0]).toMatchObject({
      key: 'membership',
      state: 'ready',
    })
    expect(view.trends[0].points[0]).toMatchObject({
      label: '2030-08-25',
      detail: '初购 1 · 首续 0 · 再续 0 · 实付 ¥10.00',
      bars: [{ label: '购买', value: '1', widthPercent: 8 }],
    })
    expect(view.trends[1].points[0].bars).toEqual([
      { key: 'scheduled-events', label: '活动', value: '0', widthPercent: 0 },
      { key: 'effective-registrations', label: '报名', value: '2', widthPercent: 20 },
    ])
    expect(view.summaryMetrics.find(item => item.key === 'current-players')?.path)
      .toBe('/packages/admin/profiles/index')
    expect(view.membershipMetrics.find(item => item.key === 'membership-initial')?.path).toBe('')
    expect(view.summaryMetrics.find(item => item.key === 'effective-registrations')?.path)
      .toBe('/packages/admin/event-participants/index')
    expect(view.eventMetrics.find(item => item.key === 'events-total')?.path).toBe('')
  })

  it('keeps zero-only and unavailable trend sections explicit', () => {
    const value = overview()
    value.membership.purchaseFlow = {
      availability: 'AVAILABLE',
      initialPurchases: countMetric(0),
      firstRenewals: countMetric(0),
      repeatRenewals: countMetric(0),
      eligiblePurchases: countMetric(0),
      eligiblePaidAmount: moneyMetric(0),
      series: [{
        bucketStartDate: '2030-08-26',
        initialPurchaseCount: 0,
        firstRenewalCount: 0,
        repeatRenewalCount: 0,
        eligiblePurchaseCount: 0,
        eligiblePaidAmountCents: 0,
      }],
    }
    value.events = { availability: 'RESTRICTED' }

    expect(buildDashboardViewModel(value).trends).toEqual([{
      key: 'membership',
      title: '会员购买趋势',
      state: 'empty',
      message: '当前时间范围内没有会员购买记录。',
      points: [],
    }, {
      key: 'events',
      title: '活动与报名趋势',
      state: 'unavailable',
      message: '当前权限范围内不可见',
      points: [],
    }])
  })

  it('renders responsive filters, explicit trend states, and only conditional metric affordances', () => {
    const template = readFileSync(
      new URL('../src/packages/admin/dashboard/index.wxml', import.meta.url),
      'utf8',
    )
    const metricTargets = readFileSync(
      new URL('../src/packages/admin/dashboard/metric-targets.ts', import.meta.url),
      'utf8',
    )
    const app = JSON.parse(readFileSync(new URL('../src/app.json', import.meta.url), 'utf8'))
    const adminPages = app.subPackages
      .find((item: { root: string }) => item.root === 'packages/admin')
      .pages as string[]

    expect(template).toContain('mip-admin-dashboard-filter')
    expect(template).toContain('mip-admin-section-grid')
    expect(template).toContain('min-h-[88rpx]')
    expect(template).toContain('mode="date"')
    expect(template).toContain('view.trends')
    expect(template).toContain('style="width: {{bar.widthPercent}}%;"')
    expect(template).toContain('wx:if="{{item.path}}"')
    expect(template).not.toContain('待办队列')
    expect(template).not.toContain('审批队列')
    for (const route of [
      'profiles/index',
      'managed-events/index',
      'event-participants/index',
      'event-registrations/index',
      'orders/index',
      'opportunities/index',
      'tasks/index',
      'task-completions/index',
    ]) {
      expect(adminPages).toContain(route)
      expect(metricTargets).toContain(`/packages/admin/${route}`)
    }
  })
})
