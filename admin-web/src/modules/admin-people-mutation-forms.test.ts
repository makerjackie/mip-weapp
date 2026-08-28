import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  ADMIN_PEOPLE_MUTATION_ACTIONS,
  buildAdminPeopleMutationInput,
  createAdminPeopleMutationDefinition,
} from './admin-people-mutation-forms.ts'

function detailReader(values: Record<string, string>) {
  return (sectionTitle: string, label: string) => values[`${sectionTitle}:${label}`] || ''
}

describe('admin people mutation forms', () => {
  it('exposes the reviewed user, role, policy, and branch actions with typed fields', () => {
    assert.deepEqual([...ADMIN_PEOPLE_MUTATION_ACTIONS], [
      'mip.admin.users.update',
      'mip.admin.users.changePrimaryBranch',
      'mip.admin.users.setControl',
      'mip.admin.roles.set',
      'mip.admin.rolePolicies.update',
      'mip.admin.branches.create',
      'mip.admin.branches.update',
      'mip.admin.branches.changeStatus',
    ])
    const definition = createAdminPeopleMutationDefinition(
      'mip.admin.branches.create', '', detailReader({}),
    )
    assert.equal(definition.fields.find(field => field.name === 'branchKey')?.kind, 'text')
    assert.equal(definition.fields.find(field => field.name === 'summary')?.kind, 'textarea')
    assert.equal(definition.title, '创建服务器')
  })

  it('reads profile and account versions from separate detail fields', () => {
    const profile = createAdminPeopleMutationDefinition(
      'mip.admin.users.update', 'user-a',
      detailReader({ '基本信息:资料版本': '7', '基本信息:用户版本': '11' }),
    )
    const account = createAdminPeopleMutationDefinition(
      'mip.admin.users.changePrimaryBranch', 'user-a',
      detailReader({ '基本信息:资料版本': '7', '基本信息:用户版本': '11' }),
    )
    assert.equal(profile.expectedVersion, 7)
    assert.deepEqual(profile.versionSource, { sectionTitle: '基本信息', label: '资料版本', minimum: 0 })
    assert.equal(account.expectedVersion, 11)
    assert.deepEqual(account.versionSource, { sectionTitle: '基本信息', label: '用户版本', minimum: 1 })
  })

  it('does not build a versioned mutation when the detail has no version', () => {
    const definition = createAdminPeopleMutationDefinition(
      'mip.admin.branches.update', 'branch-a', detailReader({}),
    )
    assert.equal(definition.expectedVersion, undefined)
    assert.equal(buildAdminPeopleMutationInput(definition, {
      name: '深圳分会', cityName: '深圳', summary: '',
    }), null)
  })

  it('accepts profile version zero when the profile record is not initialized', () => {
    const definition = createAdminPeopleMutationDefinition(
      'mip.admin.users.update', 'user-a', detailReader({ '基本信息:资料版本': '0' }),
    )
    assert.deepEqual(buildAdminPeopleMutationInput(definition, { nickname: '新用户' }), {
      userId: 'user-a', expectedVersion: 0, fields: { nickname: '新用户' },
    })
  })

  it('builds profile fields strictly and uses the profile version', () => {
    const definition = createAdminPeopleMutationDefinition(
      'mip.admin.users.update', 'user-a',
      detailReader({ '基本信息:资料版本': '7' }),
    )
    assert.deepEqual(buildAdminPeopleMutationInput(definition, {
      nickname: ' 林晓 ',
      headline: '品牌顾问',
      unknown: '不能写入',
      expectedVersion: 999,
    }), {
      userId: 'user-a', expectedVersion: 7,
      fields: { nickname: '林晓', headline: '品牌顾问' },
    })
    assert.equal(buildAdminPeopleMutationInput(definition, { nickname: '' }), null)
  })

  it('supports the server-approved visibility object without forwarding unknown keys', () => {
    const definition = createAdminPeopleMutationDefinition(
      'mip.admin.users.update', 'user-a',
      detailReader({ '基本信息:资料版本': '7' }),
    )
    assert.deepEqual(buildAdminPeopleMutationInput(definition, {
      fields: { visibility: { nickname: false, headline: true, cardContacts: { phone: true } } },
      forged: 'ignored',
    }), {
      userId: 'user-a', expectedVersion: 7,
      fields: { visibility: { nickname: false, headline: true, cardContacts: { phone: true } } },
    })
    assert.equal(buildAdminPeopleMutationInput(definition, {
      visibility: { nickname: false, unknown: true },
    }), null)
  })

  it('builds primary-branch and access-control inputs with exact server keys', () => {
    const branchDefinition = createAdminPeopleMutationDefinition(
      'mip.admin.users.changePrimaryBranch', 'user-a',
      detailReader({ '基本信息:用户版本': '11' }),
    )
    assert.deepEqual(buildAdminPeopleMutationInput(branchDefinition, {
      targetBranchId: ' branch-b ', reason: '资料调整', forged: 'ignored',
    }), {
      userId: 'user-a', targetBranchId: 'branch-b', expectedVersion: 11, reason: '资料调整',
    })

    const controlDefinition = createAdminPeopleMutationDefinition(
      'mip.admin.users.setControl', 'user-a', detailReader({}),
    )
    assert.deepEqual(buildAdminPeopleMutationInput(controlDefinition, {
      controlType: 'BLOCKLIST', active: 'false', reason: '暂时限制', expectedVersion: 9,
    }), { userId: 'user-a', controlType: 'BLOCKLIST', active: false, reason: '暂时限制' })
    assert.equal(buildAdminPeopleMutationInput(controlDefinition, {
      controlType: 'ALLOWLIST', active: true, reason: '',
    }), null)
  })

  it('builds role bindings according to role scope and strips irrelevant scope fields', () => {
    const definition = createAdminPeopleMutationDefinition(
      'mip.admin.roles.set', 'user-a', detailReader({}),
    )
    assert.deepEqual(buildAdminPeopleMutationInput(definition, {
      roleKey: 'PLATFORM_OPERATIONS', active: true, scopeId: 'ignored', branchId: 'ignored',
    }), { userId: 'user-a', roleKey: 'PLATFORM_OPERATIONS', active: true })
    assert.deepEqual(buildAdminPeopleMutationInput(definition, {
      roleKey: 'BRANCH_ADMIN', active: true, scopeId: 'branch-a', branchId: 'forbidden',
    }), { userId: 'user-a', roleKey: 'BRANCH_ADMIN', active: true, scopeId: 'branch-a' })
    assert.deepEqual(buildAdminPeopleMutationInput(definition, {
      roleKey: 'EVENT_MANAGER', active: false, scopeId: 'event-a', branchId: 'branch-a',
    }), { userId: 'user-a', roleKey: 'EVENT_MANAGER', active: false, scopeId: 'event-a', branchId: 'branch-a' })
    assert.equal(buildAdminPeopleMutationInput(definition, {
      roleKey: 'BRANCH_ADMIN', active: true, scopeId: '',
    }), null)
  })

  it('builds a custom or reset role policy using the policy version', () => {
    const definition = createAdminPeopleMutationDefinition(
      'mip.admin.rolePolicies.update', '',
      detailReader({ '权限策略:版本': '0' }),
      { allowedCapabilities: ['admin.dashboard', 'users.read'] },
    )
    assert.deepEqual(buildAdminPeopleMutationInput(definition, {
      roleKey: 'EVENT_STAFF', capabilities: ['users.read'], reset: false, version: 99,
    }), { roleKey: 'EVENT_STAFF', expectedVersion: 0, capabilities: ['users.read'] })
    assert.deepEqual(buildAdminPeopleMutationInput(definition, {
      roleKey: 'EVENT_STAFF', capabilities: ['users.read'], reset: true,
    }), { roleKey: 'EVENT_STAFF', expectedVersion: 0, reset: true })
    assert.equal(buildAdminPeopleMutationInput(definition, {
      roleKey: 'EVENT_STAFF', capabilities: ['events.write'], reset: false,
    }), null)
  })

  it('uses a validated list-row version when opening policy or branch actions', () => {
    const policy = createAdminPeopleMutationDefinition(
      'mip.admin.rolePolicies.update', '', detailReader({}),
      { expectedVersion: 0, allowedCapabilities: ['events.read'] },
    )
    assert.deepEqual(policy.versionSource, {
      sectionTitle: '列表当前数据', label: '版本', minimum: 0,
    })
    assert.deepEqual(buildAdminPeopleMutationInput(policy, {
      roleKey: 'EVENT_STAFF', capabilities: ['events.read'], reset: false,
    }), {
      roleKey: 'EVENT_STAFF', expectedVersion: 0, capabilities: ['events.read'],
    })

    const branch = createAdminPeopleMutationDefinition(
      'mip.admin.branches.changeStatus', 'branch-a', detailReader({}),
      { expectedVersion: 4 },
    )
    assert.deepEqual(buildAdminPeopleMutationInput(branch, { status: 'INACTIVE' }), {
      branchId: 'branch-a', expectedVersion: 4, status: 'INACTIVE',
    })
  })

  it('builds branch create, update, and status inputs with the server schema', () => {
    const create = createAdminPeopleMutationDefinition(
      'mip.admin.branches.create', '', detailReader({}),
    )
    assert.deepEqual(buildAdminPeopleMutationInput(create, {
      branchKey: ' SHENZHEN-FUTIAN ', name: '深圳福田分会', cityName: '深圳', summary: '福田', status: 'INACTIVE',
    }), { branchKey: 'shenzhen-futian', name: '深圳福田分会', cityName: '深圳', summary: '福田' })
    assert.deepEqual(buildAdminPeopleMutationInput(create, {
      branchKey: 'guangzhou', name: '广州分会', cityName: '广州',
    }), { branchKey: 'guangzhou', name: '广州分会', cityName: '广州', summary: '' })

    const update = createAdminPeopleMutationDefinition(
      'mip.admin.branches.update', 'branch-a', detailReader({ '分会信息:版本': '4' }),
    )
    assert.deepEqual(buildAdminPeopleMutationInput(update, {
      name: '福田分会', cityName: '深圳', summary: '', branchKey: 'cannot-change',
    }), { branchId: 'branch-a', expectedVersion: 4, name: '福田分会', cityName: '深圳', summary: '' })

    const status = createAdminPeopleMutationDefinition(
      'mip.admin.branches.changeStatus', 'branch-a', detailReader({ '分会信息:版本': '4' }),
    )
    assert.deepEqual(buildAdminPeopleMutationInput(status, { status: 'INACTIVE', name: 'ignored' }), {
      branchId: 'branch-a', expectedVersion: 4, status: 'INACTIVE',
    })
  })
})
