import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const adminMocks = vi.hoisted(() => {
  class MipAdminError extends Error {
    readonly code: string

    constructor(code: string, message: string) {
      super(message)
      this.name = 'MipAdminError'
      this.code = code
    }
  }
  let keyIndex = 0
  return {
    MipAdminError,
    getSession: vi.fn(),
    getMembership: vi.fn(),
    grantMembership: vi.fn(),
    resetKeys() { keyIndex = 0 },
    retainIntent(
      current: { fingerprint: string, idempotencyKey: string } | null,
      draft: Record<string, unknown>,
    ) {
      const fingerprint = JSON.stringify({ ...draft, reason: String(draft.reason || '').trim() })
      if (current?.fingerprint === fingerprint) {
        return current
      }
      keyIndex += 1
      return { fingerprint, idempotencyKey: `intent-${keyIndex}` }
    },
  }
})

vi.mock('../src/modules/mip-admin', () => ({
  MipAdminError: adminMocks.MipAdminError,
  hasCapability: (grants: Array<{ capability: string }>, capability: string) => (
    grants.some(grant => grant.capability === capability)
  ),
  retainAdminMembershipGrantIntent: adminMocks.retainIntent,
  createAdminMembershipDetailView: (value: Record<string, unknown>) => value,
  mipAdminModule: {
    getSession: adminMocks.getSession,
    memberships: {
      get: adminMocks.getMembership,
      grant: adminMocks.grantMembership,
    },
  },
}))

type PageData = Record<string, unknown>
type PageDefinition = PageData & {
  data: PageData
  setData: (patch: PageData) => void
}

let definition: PageDefinition
const showToast = vi.fn()
const USER_ID = '10000000-0000-4000-8000-000000000001'

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

function session(...capabilities: string[]) {
  return {
    enabled: true,
    roles: [],
    capabilities: capabilities.map(capability => ({ capability, scopeType: 'PLATFORM', scopeId: null })),
  }
}

function detail(chainVersion = 4, status: 'ACTIVE' | 'CLOSED' = 'ACTIVE') {
  return {
    user: { id: USER_ID, nickname: '林然', status, statusText: status === 'ACTIVE' ? '正常' : '已关闭' },
    chainVersion,
    membership: {
      status: 'ACTIVE',
      active: true,
      currentEndsAt: '2030-06-01T00:00:00.000Z',
      nextStartsAt: null,
      statusText: '有效',
      currentEndsText: '2030-06-01 08:00',
      nextStartsText: '无',
    },
    entitlements: [],
  }
}

beforeAll(async () => {
  vi.stubGlobal('wx', { showToast })
  vi.stubGlobal('Page', (input: PageDefinition) => {
    definition = input
  })
  await import('../src/packages/admin/membership/index')
})

beforeEach(() => {
  adminMocks.getSession.mockReset()
  adminMocks.getMembership.mockReset()
  adminMocks.grantMembership.mockReset()
  adminMocks.resetKeys()
  showToast.mockClear()
})

describe('MIP admin membership page', () => {
  it('starts loading and gates reads and grants with separate capabilities', async () => {
    const forbidden = createPage({ userId: USER_ID })
    expect(forbidden.data.state).toBe('loading')
    adminMocks.getSession.mockResolvedValueOnce(session())
    await callPage(forbidden, 'loadMembership')
    expect(forbidden.data.state).toBe('forbidden')
    expect(adminMocks.getMembership).not.toHaveBeenCalled()

    const readOnly = createPage({ userId: USER_ID })
    adminMocks.getSession.mockResolvedValueOnce(session('memberships.read'))
    adminMocks.getMembership.mockResolvedValueOnce(detail())
    await callPage(readOnly, 'loadMembership')
    expect(readOnly.data).toMatchObject({ state: 'ready', canGrant: false, detail: { chainVersion: 4 } })

    const adjustable = createPage({ userId: USER_ID })
    adminMocks.getSession.mockResolvedValueOnce(session('memberships.read', 'memberships.adjust'))
    adminMocks.getMembership.mockResolvedValueOnce(detail())
    await callPage(adjustable, 'loadMembership')
    expect(adjustable.data).toMatchObject({ state: 'ready', canGrant: true })
  })

  it('shows error and closed-user states without submitting a grant', async () => {
    const failed = createPage({ userId: USER_ID })
    adminMocks.getSession.mockRejectedValueOnce(new Error('网络不可用'))
    await callPage(failed, 'loadMembership')
    expect(failed.data).toMatchObject({ state: 'error', message: '网络不可用' })

    const closed = createPage({
      userId: USER_ID,
      detail: detail(4, 'CLOSED'),
      state: 'ready',
      canGrant: true,
      reason: '补录会员',
    })
    await callPage(closed, 'grantMembership')
    expect(adminMocks.grantMembership).not.toHaveBeenCalled()
  })

  it('keeps the idempotency key stable for an unchanged retry and refetches after success', async () => {
    const page = createPage({
      userId: USER_ID,
      detail: detail(),
      state: 'ready',
      canGrant: true,
      durationMonths: 3,
      reason: ' 线下协议会员 ',
    })
    adminMocks.grantMembership
      .mockRejectedValueOnce(new Error('网络不可用'))
      .mockResolvedValueOnce({
        adjustmentId: 'adjustment-a',
        resultChainVersion: 5,
        startsAt: '2030-06-01T00:00:00.000Z',
        endsAt: '2030-09-01T00:00:00.000Z',
        idempotent: true,
      })
    adminMocks.getSession.mockResolvedValueOnce(session('memberships.read', 'memberships.adjust'))
    adminMocks.getMembership.mockResolvedValueOnce(detail(5))

    await callPage(page, 'grantMembership')
    await callPage(page, 'grantMembership')

    expect(adminMocks.grantMembership).toHaveBeenCalledTimes(2)
    expect(adminMocks.grantMembership.mock.calls[0]?.[0].idempotencyKey).toBe('intent-1')
    expect(adminMocks.grantMembership.mock.calls[1]?.[0].idempotencyKey).toBe('intent-1')
    expect(adminMocks.getMembership).toHaveBeenCalledWith(USER_ID, true)
    expect(page.data).toMatchObject({ state: 'ready', reason: '', detail: { chainVersion: 5 } })
    expect(showToast).toHaveBeenCalledWith({ title: '会员已开通', icon: 'success' })
  })

  it('refetches the latest chain and shows conflict after VERSION_CONFLICT', async () => {
    const page = createPage({
      userId: USER_ID,
      detail: detail(),
      state: 'ready',
      canGrant: true,
      durationMonths: 6,
      reason: '活动合作会员',
    })
    adminMocks.grantMembership.mockRejectedValueOnce(
      new adminMocks.MipAdminError('VERSION_CONFLICT', '会员链版本已变化'),
    )
    adminMocks.getSession.mockResolvedValueOnce(session('memberships.read', 'memberships.adjust'))
    adminMocks.getMembership.mockResolvedValueOnce(detail(5))

    await callPage(page, 'grantMembership')

    expect(adminMocks.grantMembership).toHaveBeenCalledWith(expect.objectContaining({
      expectedChainVersion: 4,
      idempotencyKey: 'intent-1',
    }))
    expect(adminMocks.getMembership).toHaveBeenCalledWith(USER_ID, true)
    expect(page.data).toMatchObject({
      state: 'conflict',
      detail: { chainVersion: 5 },
      message: '会员记录已更新，请确认最新有效期后重新提交。',
    })
  })

  it('clears the intent and disables the form after an ACTIVE to CLOSED race', async () => {
    const page = createPage({
      userId: USER_ID,
      detail: detail(),
      state: 'ready',
      canGrant: true,
      durationMonths: 3,
      reason: '线下协议会员',
    })
    adminMocks.grantMembership.mockRejectedValueOnce(
      new adminMocks.MipAdminError('INVALID_STATE', '用户状态不允许开通会员'),
    )
    adminMocks.getSession.mockResolvedValueOnce(session('memberships.read', 'memberships.adjust'))
    adminMocks.getMembership.mockResolvedValueOnce(detail(5, 'CLOSED'))

    await callPage(page, 'grantMembership')

    expect(adminMocks.getMembership).toHaveBeenCalledWith(USER_ID, true)
    expect(page.grantIntent).toBeNull()
    expect(page.data).toMatchObject({
      state: 'ready',
      canGrant: true,
      detail: { chainVersion: 5, user: { status: 'CLOSED' } },
      message: '用户账号已关闭，不能人工开通会员。',
    })

    await callPage(page, 'grantMembership')
    expect(adminMocks.grantMembership).toHaveBeenCalledTimes(1)
  })
})
