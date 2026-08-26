import type { AdminTransport } from '../src/modules/mip-admin/transport'
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
    const valid = {
      id: 'user-a',
      primaryBranchOptions: [{ id: 'branch-b', name: '深圳分会', cityName: '深圳' }],
    }
    const validGateway = createMipAdminGateway({ request: vi.fn(async () => valid) })
    await expect(validGateway.getUser('user-a')).resolves.toMatchObject(valid)

    const invalidGateway = createMipAdminGateway({
      request: vi.fn(async () => ({
        id: 'user-a',
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
})
