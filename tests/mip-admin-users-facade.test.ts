import type { AdminUserDetail, MipAdminGateway } from '../src/modules/mip-admin/types'
import type { MipUsersAdmin } from '../src/modules/mip-admin/users-admin'
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createMipAdminModule } from '../src/modules/mip-admin/client'
import { MipAdminError } from '../src/modules/mip-admin/types'

const userDetail: AdminUserDetail = {
  id: 'user-a',
  status: 'ACTIVE',
  kind: 'PLAYER',
  nickname: '林然',
  headline: '产品经理',
  introduction: '负责产品设计。',
  primaryBranchId: 'branch-a',
  branchName: '深圳分会',
  cityName: '深圳',
  phoneBound: true,
  phoneNumber: null,
  controls: [],
  levelId: 'level-a',
  levelName: '一级',
  experience: 100,
  visibility: {},
  userVersion: 1,
  profileVersion: 1,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-25T00:00:00.000Z',
  companies: [],
  organizations: [],
  membership: null,
  growth: { levelName: '一级', experience: 100, contribution: 20, coin: 5 },
  counts: {
    registrations: 0,
    attended: 0,
    orders: 0,
    opportunities: 0,
    cooperationCards: 0,
    superCases: 0,
  },
  tags: [],
  roles: [],
  relatedRecords: { superCases: [], opportunities: [], registrations: [], orders: [] },
  primaryBranchOptions: [
    { id: 'branch-a', name: '深圳分会', cityName: '深圳' },
    { id: 'branch-b', name: '广州分会', cityName: '广州' },
  ],
}

function createHarness() {
  const spies = {
    getSession: vi.fn<MipAdminGateway['getSession']>(async () => ({
      enabled: true,
      capabilities: [],
      roles: [],
    })),
    listUsers: vi.fn<MipAdminGateway['listUsers']>(async input => ({
      items: [{ ...userDetail, phoneNumber: input?.includePhone === true ? '18800000000' : null }],
      nextCursor: null,
    })),
    getUser: vi.fn<MipAdminGateway['getUser']>(async (_userId, includePhone) => ({
      ...userDetail,
      phoneNumber: includePhone === true ? '18800000000' : null,
    })),
    updateUser: vi.fn<MipAdminGateway['updateUser']>(async () => ({ userId: userDetail.id, version: 2 })),
    changeUserPrimaryBranch: vi.fn<MipAdminGateway['changeUserPrimaryBranch']>(async input => ({
      userId: input.userId,
      primaryBranchId: input.targetBranchId,
      version: input.expectedVersion + 1,
    })),
    setUserControl: vi.fn<MipAdminGateway['setUserControl']>(async input => ({
      userId: userDetail.id,
      controlType: String(input.controlType),
      active: input.active === true,
    })),
  }
  const gateway = spies as unknown as MipAdminGateway
  return { module: createMipAdminModule(gateway), spies }
}

const listInput = {
  includePhone: false,
  filters: {
    query: '林',
    kind: 'PLAYER',
    status: 'ACTIVE',
    controlType: 'ALLOWLIST',
    phoneBound: 'BOUND',
    profileComplete: 'COMPLETE',
    joinedWithinDays: 30,
    branchId: 'branch-a',
    levelId: 'level-a',
    experienceMin: '10',
    experienceMax: '200',
    createdFrom: '2026-08-01T00:00:00.000Z',
    createdTo: '2026-08-31T23:59:59.999Z',
  },
  cursor: 'cursor-a',
  limit: 25,
}

const updateInput = {
  userId: userDetail.id,
  expectedVersion: 1,
  fields: { headline: '独立顾问' },
}
const controlInput = {
  userId: userDetail.id,
  controlType: 'ALLOWLIST',
  active: true,
  reason: '运营审核通过',
}
const primaryBranchInput = {
  userId: userDetail.id,
  targetBranchId: 'branch-b',
  expectedVersion: 1,
  reason: '工作城市调整',
}

interface MutationCase {
  name: string
  execute: (users: MipUsersAdmin) => Promise<unknown>
  spy: 'updateUser' | 'changeUserPrimaryBranch' | 'setUserControl'
}

function mutationCases(): MutationCase[] {
  return [
    { name: 'update', execute: users => users.update(updateInput), spy: 'updateUser' },
    {
      name: 'changePrimaryBranch',
      execute: users => users.changePrimaryBranch(primaryBranchInput),
      spy: 'changeUserPrimaryBranch',
    },
    { name: 'setControl', execute: users => users.setControl(controlInput), spy: 'setUserControl' },
  ]
}

async function warmNonSensitiveReads(users: MipUsersAdmin) {
  await users.list(listInput)
  await users.get(userDetail.id)
}

describe('MIP admin users facade', () => {
  it('never caches phone-bearing list or detail responses', async () => {
    const { module, spies } = createHarness()
    const sensitiveInput = { ...listInput, includePhone: true }

    await expect(module.users.list(sensitiveInput)).resolves.toMatchObject({
      items: [{ phoneNumber: '18800000000' }],
    })
    await module.users.list(sensitiveInput)
    await expect(module.users.get(userDetail.id, true)).resolves.toMatchObject({ phoneNumber: '18800000000' })
    await module.users.get(userDetail.id, true)

    expect(spies.listUsers).toHaveBeenCalledTimes(2)
    expect(spies.getUser).toHaveBeenCalledTimes(2)
    expect(spies.listUsers.mock.calls[0]?.[0]).toBe(sensitiveInput)
    expect(spies.getUser.mock.calls).toEqual([
      [userDetail.id, true],
      [userDetail.id, true],
    ])
  })

  it('caches only non-sensitive reads using complete filters, cursor, and limit', async () => {
    const { module, spies } = createHarness()

    await module.users.list(listInput)
    await module.users.list(listInput)
    await module.users.list({ ...listInput, cursor: 'cursor-b' })
    await module.users.list({ ...listInput, limit: 50 })
    await module.users.list({ ...listInput, filters: { ...listInput.filters, status: 'BLOCKED' } })
    await module.users.get(userDetail.id)
    await module.users.get(userDetail.id)

    expect(spies.listUsers).toHaveBeenCalledTimes(4)
    expect(spies.getUser).toHaveBeenCalledTimes(1)
    expect(spies.listUsers.mock.calls[0]?.[0]).toBe(listInput)
  })

  it('does not let a phone-bearing response prime a non-sensitive cache key', async () => {
    const { module, spies } = createHarness()

    await module.users.list({ ...listInput, includePhone: true })
    await expect(module.users.list(listInput)).resolves.toMatchObject({ items: [{ phoneNumber: null }] })
    await module.users.list(listInput)
    await module.users.get(userDetail.id, true)
    await expect(module.users.get(userDetail.id)).resolves.toMatchObject({ phoneNumber: null })
    await module.users.get(userDetail.id)

    expect(spies.listUsers).toHaveBeenCalledTimes(2)
    expect(spies.getUser).toHaveBeenCalledTimes(2)
  })

  it('keeps legacy list and detail aliases on the same non-sensitive cache', async () => {
    const { module, spies } = createHarness()

    await module.listUsers(listInput)
    await module.users.list(listInput)
    await module.getUser(userDetail.id)
    await module.users.get(userDetail.id)

    expect(spies.listUsers).toHaveBeenCalledTimes(1)
    expect(spies.getUser).toHaveBeenCalledTimes(1)
  })

  it('passes mutation inputs to the neutral gateway unchanged', async () => {
    const { module, spies } = createHarness()

    await module.users.update(updateInput)
    await module.users.changePrimaryBranch(primaryBranchInput)
    await module.users.setControl(controlInput)

    expect(spies.updateUser.mock.calls[0]?.[0]).toBe(updateInput)
    expect(spies.changeUserPrimaryBranch.mock.calls[0]?.[0]).toBe(primaryBranchInput)
    expect(spies.setUserControl.mock.calls[0]?.[0]).toBe(controlInput)
  })

  for (const mutation of mutationCases()) {
    it(`invalidates only user lists and details after ${mutation.name} succeeds`, async () => {
      const { module, spies } = createHarness()
      await warmNonSensitiveReads(module.users)
      await warmNonSensitiveReads(module.users)
      await module.getSession()
      await module.getSession()

      await mutation.execute(module.users)
      await warmNonSensitiveReads(module.users)
      await module.getSession()

      expect(spies.listUsers).toHaveBeenCalledTimes(2)
      expect(spies.getUser).toHaveBeenCalledTimes(2)
      expect(spies[mutation.spy]).toHaveBeenCalledTimes(1)
      expect(spies.getSession).toHaveBeenCalledTimes(1)
    })
  }

  it.each([
    ['updateUser', new MipAdminError('CONFLICT', '用户资料已被其他管理员更新')],
    ['changeUserPrimaryBranch', new MipAdminError('CONFLICT', '用户归属已被其他管理员更新')],
    ['setUserControl', new MipAdminError('FORBIDDEN', '当前账号不能设置名单')],
  ] as const)('keeps cached reads and the original %s failure', async (name, failure) => {
    const { module, spies } = createHarness()
    spies[name].mockRejectedValueOnce(failure)
    await warmNonSensitiveReads(module.users)

    const work = name === 'updateUser'
      ? module.users.update(updateInput)
      : name === 'changeUserPrimaryBranch'
        ? module.users.changePrimaryBranch(primaryBranchInput)
        : module.users.setControl(controlInput)
    await expect(work).rejects.toBe(failure)
    await warmNonSensitiveReads(module.users)

    expect(spies.listUsers).toHaveBeenCalledTimes(1)
    expect(spies.getUser).toHaveBeenCalledTimes(1)
  })

  it('keeps the profiles page behind the typed facade and export workflow', () => {
    const root = path.resolve(import.meta.dirname, '..')
    const source = fs.readFileSync(path.join(root, 'src/packages/admin/profiles/index.ts'), 'utf8')

    expect(source).toContain('mipAdminModule.users.list(')
    expect(source).toContain('mipAdminModule.users.get(')
    expect(source).toContain('mipAdminModule.users.update(')
    expect(source).toContain('mipAdminModule.users.changePrimaryBranch(')
    expect(source).toContain('mipAdminModule.users.setControl(')
    expect(source).toContain('mipAdminModule.exportAndOpen(')
    expect(source).not.toContain('mipAdminModule.gateway')
    expect(source).not.toContain('mipAdminModule.mutate')
    expect(source.match(/mipAdminModule\.users\.update\(/g)).toHaveLength(1)
    expect(source.match(/mipAdminModule\.users\.changePrimaryBranch\(/g)).toHaveLength(1)
    expect(source.match(/mipAdminModule\.users\.setControl\(/g)).toHaveLength(1)
  })
})
