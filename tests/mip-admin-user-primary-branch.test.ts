import type { AdminTransport } from '../src/modules/mip-admin/transport'
import type { AdminUserDetail } from '../src/modules/mip-admin/types'
import fs from 'node:fs'
import path from 'node:path'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMipAdminGateway } from '../src/modules/mip-admin/cloudbase-gateway'

const adminMocks = vi.hoisted(() => {
  class MipAdminError extends Error {
    readonly code: string
    readonly retryable: boolean

    constructor(code: string, message: string, retryable = false) {
      super(message)
      this.code = code
      this.retryable = retryable
    }
  }
  return {
    MipAdminError,
    getSession: vi.fn(),
    listUsers: vi.fn(),
    getUser: vi.fn(),
    listInfluence: vi.fn(),
    changePrimaryBranch: vi.fn(),
    listBranches: vi.fn(),
    clearSensitive: vi.fn(),
  }
})

vi.mock('../src/modules/mip-admin', () => ({
  MipAdminError: adminMocks.MipAdminError,
  hasCapability: (grants: Array<{ capability: string }>, capability: string) => (
    grants.some(grant => grant.capability === capability)
  ),
  mipAdminModule: {
    getSession: adminMocks.getSession,
    listBranches: adminMocks.listBranches,
    listGrowthLevels: vi.fn(),
    clearSensitive: adminMocks.clearSensitive,
    exportAndOpen: vi.fn(),
    users: {
      list: adminMocks.listUsers,
      get: adminMocks.getUser,
      listInfluence: adminMocks.listInfluence,
      update: vi.fn(),
      changePrimaryBranch: adminMocks.changePrimaryBranch,
      setControl: vi.fn(),
    },
  },
}))

vi.mock('../src/modules/platform/cloudbase', () => ({
  requireCloudClient: vi.fn(),
}))

vi.mock('../src/config/runtime', () => ({
  runtimeConfig: { cloudbase: { adminFunctionName: 'mip-admin-api' } },
}))

type PageData = Record<string, unknown>
type PageDefinition = Record<string, unknown> & {
  data: PageData
  setData: (patch: PageData) => void
}

let definition: PageDefinition
const showToast = vi.fn()

function record(value: unknown): value is PageData {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function userDetailResponse(): AdminUserDetail {
  return {
    id: 'user-a',
    status: 'ACTIVE',
    kind: 'GUEST',
    nickname: '用户',
    headline: '',
    introduction: '',
    primaryBranchId: 'branch-a',
    branchName: '广州分会',
    cityName: '广州',
    phoneBound: false,
    phoneNumber: null,
    controls: [],
    levelId: null,
    levelName: '',
    experience: 0,
    visibility: {},
    userVersion: 1,
    profileVersion: 1,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-25T00:00:00.000Z',
    primaryBranchOptions: [{ id: 'branch-b', name: '深圳分会', cityName: '深圳' }],
    companies: [],
    organizations: [],
    membership: null,
    growth: { levelName: '', experience: 0, contribution: 0, coin: 0 },
    counts: {
      registrations: 0,
      attended: 0,
      orders: 0,
      opportunities: 0,
      cooperationCards: 0,
      superCases: 0,
    },
    influence: { guestCount: 0, interactionCount: 0, interestCount: 0, visitorCount: 0 },
    tags: [],
    roles: [],
    relatedRecords: { superCases: [], opportunities: [], registrations: [], orders: [] },
  }
}

function setPath(target: PageData, key: string, value: unknown) {
  const parts = key.split('.')
  const leaf = parts.pop()
  if (!leaf) {
    return
  }
  let cursor = target
  for (const part of parts) {
    if (!record(cursor[part])) {
      cursor[part] = {}
    }
    cursor = cursor[part] as PageData
  }
  cursor[leaf] = value
}

function createPage(overrides: PageData = {}) {
  const page = Object.create(definition) as PageDefinition
  page.data = { ...structuredClone(definition.data), ...structuredClone(overrides) }
  page.setData = (patch) => {
    for (const [key, value] of Object.entries(patch)) {
      setPath(page.data, key, value)
    }
  }
  return page
}

function callPage(page: PageDefinition, method: string, ...args: unknown[]) {
  const handler = page[method]
  if (typeof handler !== 'function') {
    throw new TypeError(`Missing page method: ${method}`)
  }
  return Reflect.apply(handler, page, args) as Promise<unknown>
}

beforeAll(async () => {
  vi.stubGlobal('wx', {
    showToast,
    navigateTo: vi.fn(),
    showActionSheet: vi.fn(),
    showModal: vi.fn(),
    setClipboardData: vi.fn(),
  })
  vi.stubGlobal('Page', (input: PageDefinition) => {
    definition = input
  })
  await import('../src/packages/admin/profiles/index')
})

beforeEach(() => {
  for (const mock of Object.values(adminMocks)) {
    if (typeof mock === 'function' && 'mockReset' in mock) {
      ;(mock as ReturnType<typeof vi.fn>).mockReset()
    }
  }
  showToast.mockClear()
  adminMocks.listUsers.mockResolvedValue({ items: [], nextCursor: null })
  adminMocks.listInfluence.mockResolvedValue({
    items: [],
    nextCursor: null,
    unavailableFacts: [],
  })
})

describe('MIP admin user primary branch contract', () => {
  it('sends the neutral mutation input and accepts only the matching strict result', async () => {
    const input = {
      userId: 'user-a',
      targetBranchId: 'branch-b',
      expectedVersion: 4,
      reason: '工作城市调整',
    }
    const requests: unknown[] = []
    const transport: AdminTransport = {
      async request(request) {
        requests.push(request)
        return { userId: 'user-a', primaryBranchId: 'branch-b', version: 5 } as never
      },
    }

    await expect(createMipAdminGateway(transport).changeUserPrimaryBranch(input)).resolves.toEqual({
      userId: 'user-a',
      primaryBranchId: 'branch-b',
      version: 5,
    })
    expect(requests).toEqual([{
      contractVersion: 1,
      action: 'mip.admin.users.changePrimaryBranch',
      input,
    }])
  })

  it.each([
    ['unexpected field', { userId: 'user-a', primaryBranchId: 'branch-b', version: 5, phone: '18800000000' }],
    ['wrong user', { userId: 'user-c', primaryBranchId: 'branch-b', version: 5 }],
    ['wrong branch', { userId: 'user-a', primaryBranchId: 'branch-c', version: 5 }],
    ['wrong version', { userId: 'user-a', primaryBranchId: 'branch-b', version: 4 }],
  ])('rejects malformed or mismatched mutation result: %s', async (_name, result) => {
    const gateway = createMipAdminGateway({ request: vi.fn(async () => result) })
    await expect(gateway.changeUserPrimaryBranch({
      userId: 'user-a',
      targetBranchId: 'branch-b',
      expectedVersion: 4,
      reason: '调整',
    })).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
  })

  it('accepts only public active-branch option fields on the user detail DTO', async () => {
    const valid = userDetailResponse()
    const validGateway = createMipAdminGateway({ request: vi.fn(async () => valid) })
    await expect(validGateway.getUser('user-a')).resolves.toMatchObject(valid)

    const invalidGateway = createMipAdminGateway({
      request: vi.fn(async () => ({
        ...valid,
        primaryBranchOptions: [{
          id: 'branch-b',
          name: '深圳分会',
          cityName: '深圳',
          activeMemberships: 12,
        }],
      })),
    })
    await expect(invalidGateway.getUser('user-a')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
  })

  it('shows the editor only for a platform-scoped users-edit grant', async () => {
    const branchPage = createPage()
    branchPage.loadBranches = vi.fn()
    adminMocks.getSession.mockResolvedValueOnce({
      enabled: true,
      capabilities: [{ capability: 'users.fields.edit', scopeType: 'BRANCH', scopeId: 'branch-a' }],
      roles: [],
    })
    await callPage(branchPage, 'loadUsers')
    expect(branchPage.data.canChangePrimaryBranch).toBe(false)
    expect(branchPage.loadBranches).not.toHaveBeenCalled()

    const platformPage = createPage()
    platformPage.loadBranches = vi.fn()
    adminMocks.getSession.mockResolvedValueOnce({
      enabled: true,
      capabilities: [{ capability: 'users.fields.edit', scopeType: 'PLATFORM', scopeId: null }],
      roles: [],
    })
    await callPage(platformPage, 'loadUsers')
    expect(platformPage.data.canChangePrimaryBranch).toBe(true)
    expect(platformPage.loadBranches).not.toHaveBeenCalled()
  })

  it('refreshes list and detail after success and recovers the latest version after conflict', async () => {
    const page = createPage({
      canChangePrimaryBranch: true,
      detailOpen: true,
      detail: { id: 'user-a', primaryBranchId: 'branch-a', userVersion: 4 },
      primaryBranchOptions: [
        { id: 'branch-a', label: '广州分会 · 广州' },
        { id: 'branch-b', label: '深圳分会 · 深圳' },
      ],
      primaryBranchIndex: 1,
      primaryBranchReason: ' 工作城市调整 ',
    })
    page.loadUsers = vi.fn(async () => undefined)
    page.loadUserDetail = vi.fn(async () => undefined)
    adminMocks.changePrimaryBranch.mockResolvedValueOnce({
      userId: 'user-a',
      primaryBranchId: 'branch-b',
      version: 5,
    })

    await callPage(page, 'changePrimaryBranch')
    expect(adminMocks.changePrimaryBranch).toHaveBeenCalledWith({
      userId: 'user-a',
      targetBranchId: 'branch-b',
      expectedVersion: 4,
      reason: '工作城市调整',
    })
    expect(page.loadUsers).toHaveBeenCalledWith(true)
    expect(page.loadUserDetail).toHaveBeenCalledWith('user-a', true)
    expect(showToast).toHaveBeenCalledWith({ title: '主分会已更新', icon: 'success' })

    adminMocks.changePrimaryBranch.mockRejectedValueOnce(
      new adminMocks.MipAdminError('CONFLICT', '记录状态已变化，请刷新后重试', true),
    )
    await callPage(page, 'changePrimaryBranch')
    expect(page.loadUsers).toHaveBeenCalledTimes(2)
    expect(page.loadUserDetail).toHaveBeenCalledTimes(2)
    expect(page.data.primaryBranchReason).toBe('工作城市调整')
    expect(page.data.primaryBranchMessage).toBe('用户信息已更新，请确认当前分会后重试。')
  })

  it('keeps the editor inside the shared 375/960 responsive detail shell', () => {
    const root = path.resolve(import.meta.dirname, '..')
    const template = fs.readFileSync(path.join(root, 'src/packages/admin/profiles/index.wxml'), 'utf8')
    const panelStyle = fs.readFileSync(
      path.join(root, 'src/packages/admin/components/responsive-panel/index.wxss'),
      'utf8',
    )
    const panelStart = template.indexOf('<mip-admin-responsive-panel')
    const editor = template.indexOf('wx:if="{{canChangePrimaryBranch}}"')
    const panelEnd = template.indexOf('</mip-admin-responsive-panel>')

    expect(panelStart).toBeGreaterThan(-1)
    expect(editor).toBeGreaterThan(panelStart)
    expect(editor).toBeLessThan(panelEnd)
    expect(template).toContain('maxlength="300"')
    expect(template).toContain('bind:tap="changePrimaryBranch"')
    expect(panelStyle).toContain('@media (min-width: 960px)')
    expect(panelStyle).toContain('width: 100vw')
  })

  it('loads exact influence facts with filters and appends the next cursor page', async () => {
    const page = createPage({
      detailOpen: true,
      detail: { id: 'user-a' },
      influenceKind: 'HEART',
      influenceDirection: 'INCOMING',
      influenceFromDate: '2026-08-01',
      influenceToDate: '2026-08-31',
    })
    adminMocks.listInfluence.mockResolvedValueOnce({
      items: [{
        reference: `if1.${'a'.repeat(22)}`,
        kind: 'HEART',
        direction: 'INCOMING',
        status: 'ACTIVE',
        occurredAt: '2026-08-25T08:30:00.000Z',
        eventTitle: '城市聚会',
        counterpartNickname: '林然',
        counterpartKind: 'PLAYER',
        counterpartState: 'AVAILABLE',
        sourceType: null,
      }],
      nextCursor: 'cursor-b',
      unavailableFacts: ['CANCELLED_INCOMING_HEART'],
    })

    await callPage(page, 'loadUserInfluence', 'user-a', true)

    expect(adminMocks.listInfluence).toHaveBeenNthCalledWith(1, {
      userId: 'user-a',
      kind: 'HEART',
      direction: 'INCOMING',
      occurredFrom: new Date(2026, 7, 1, 0, 0, 0, 0).toISOString(),
      occurredTo: new Date(2026, 7, 31, 23, 59, 59, 999).toISOString(),
      limit: 10,
    }, true)
    expect(page.data.influenceState).toBe('ready')
    expect(page.data.influenceNextCursor).toBe('cursor-b')
    expect(page.data.influenceUnavailableMessage).toContain('已取消的入向心动')
    expect(page.data.influenceItems).toEqual([
      expect.objectContaining({
        reference: `if1.${'a'.repeat(22)}`,
        kindText: '心动关系',
        directionText: '对该用户发起',
        statusText: '有效',
        counterpartText: '林然',
        counterpartMetaText: '玩家',
      }),
    ])

    adminMocks.listInfluence.mockResolvedValueOnce({
      items: [{
        reference: `if1.${'b'.repeat(22)}`,
        kind: 'HEART',
        direction: 'INCOMING',
        status: 'ACTIVE',
        occurredAt: '2026-08-24T08:30:00.000Z',
        eventTitle: '行业交流',
        counterpartNickname: 'MIP 用户',
        counterpartKind: 'GUEST',
        counterpartState: 'REDACTED',
        sourceType: null,
      }],
      nextCursor: null,
      unavailableFacts: ['CANCELLED_INCOMING_HEART'],
    })

    await callPage(page, 'loadUserInfluence', 'user-a', false)

    expect(adminMocks.listInfluence).toHaveBeenNthCalledWith(2, {
      userId: 'user-a',
      kind: 'HEART',
      direction: 'INCOMING',
      occurredFrom: new Date(2026, 7, 1, 0, 0, 0, 0).toISOString(),
      occurredTo: new Date(2026, 7, 31, 23, 59, 59, 999).toISOString(),
      cursor: 'cursor-b',
      limit: 10,
    }, false)
    expect(page.data.influenceItems).toHaveLength(2)
    expect(page.data.influenceNextCursor).toBeNull()
  })

  it('shows a local error for an invalid influence date range without issuing a read', async () => {
    const page = createPage({
      detailOpen: true,
      detail: { id: 'user-a' },
      influenceFromDate: '2026-09-01',
      influenceToDate: '2026-08-01',
    })

    await callPage(page, 'loadUserInfluence', 'user-a', true)

    expect(adminMocks.listInfluence).not.toHaveBeenCalled()
    expect(page.data.influenceState).toBe('error')
    expect(page.data.influenceMessage).toBe('开始日期不能晚于结束日期。')
  })

  it('keeps influence filters, explicit empty state, and pagination inside the 375/960 shell', () => {
    const root = path.resolve(import.meta.dirname, '..')
    const template = fs.readFileSync(path.join(root, 'src/packages/admin/profiles/index.wxml'), 'utf8')
    const panelStyle = fs.readFileSync(
      path.join(root, 'src/packages/admin/components/responsive-panel/index.wxss'),
      'utf8',
    )
    const panelStart = template.indexOf('<mip-admin-responsive-panel')
    const influence = template.indexOf('影响力明细')
    const panelEnd = template.indexOf('</mip-admin-responsive-panel>')

    expect(influence).toBeGreaterThan(panelStart)
    expect(influence).toBeLessThan(panelEnd)
    expect(template).toContain('aria-label="影响力类型"')
    expect(template).toContain('aria-label="影响力方向"')
    expect(template).toMatch(/<view class="flex min-h-\[88rpx\] items-center"[^>]*data-field="influenceKind"[^>]*bind:tap="chooseInfluenceFilter"><t-tag/)
    expect(template).not.toMatch(/<t-tag[^>]*bind:tap="chooseInfluenceFilter"/)
    expect(template).toContain('bindchange="changeInfluenceDate"')
    expect(template).toContain('title="{{influenceEmptyTitle}}"')
    expect(template).toContain('bind:tap="loadMoreInfluence"')
    expect(panelStyle).toContain('@media (min-width: 960px)')
    expect(panelStyle).toContain('width: 100vw')
  })
})
