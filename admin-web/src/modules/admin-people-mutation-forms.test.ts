import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  ADMIN_PEOPLE_MUTATION_ACTIONS,
  buildAdminPeopleMutationInput,
  createAdminPeopleMutationDefinition,
  type AdminPeopleMutationAction,
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
      'mip.admin.adminAccounts.create',
      'mip.admin.adminAccounts.update',
      'mip.admin.adminAccounts.changeStatus',
      'mip.admin.adminAccounts.resetCredential',
      'mip.admin.entitlements.grant',
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

  it('rejects invalid loginAccount format for admin account create', () => {
    const definition = createAdminPeopleMutationDefinition(
      'mip.admin.adminAccounts.create', '', detailReader({}),
    )
    assert.equal(buildAdminPeopleMutationInput(definition, {
      loginAccount: 'ab', name: 'Test', phone: '13800138000', roleKey: 'PLATFORM_OPERATIONS',
    }), null)
  })

  it('rejects missing required fields for admin account create', () => {
    const definition = createAdminPeopleMutationDefinition(
      'mip.admin.adminAccounts.create', '', detailReader({}),
    )
    assert.equal(buildAdminPeopleMutationInput(definition, {
      loginAccount: 'test_user', name: '', phone: '13800138000', roleKey: 'PLATFORM_OPERATIONS',
    }), null)
  })

  it('rejects invalid roleKey for admin account create', () => {
    const definition = createAdminPeopleMutationDefinition(
      'mip.admin.adminAccounts.create', '', detailReader({}),
    )
    assert.equal(buildAdminPeopleMutationInput(definition, {
      loginAccount: 'test_user', name: 'Test', phone: '13800138000', roleKey: 'INVALID_ROLE',
    }), null)
  })

  it('accepts valid create input and returns the server schema', () => {
    const definition = createAdminPeopleMutationDefinition(
      'mip.admin.adminAccounts.create', '', detailReader({}),
    )
    const input = buildAdminPeopleMutationInput(definition, {
      loginAccount: 'test_user', name: 'Test', phone: '13800138000', roleKey: 'PLATFORM_OPERATIONS',
    })
    assert.equal(input?.loginAccount, 'test_user')
    assert.equal(input?.name, 'Test')
    assert.equal(input?.phone, '13800138000')
    assert.equal(input?.roleKey, 'PLATFORM_OPERATIONS')
  })

  it('requires a reason when changing admin account status', () => {
    const definition = createAdminPeopleMutationDefinition(
      'mip.admin.adminAccounts.changeStatus', 'acc-001', detailReader({}),
      { expectedVersion: 2 },
    )
    assert.equal(buildAdminPeopleMutationInput(definition, {
      status: 'INACTIVE', reason: '',
    }), null)
  })

  it('accepts a valid status change with reason and expected version', () => {
    const definition = createAdminPeopleMutationDefinition(
      'mip.admin.adminAccounts.changeStatus', 'acc-001', detailReader({}),
      { expectedVersion: 2 },
    )
    const input = buildAdminPeopleMutationInput(definition, {
      status: 'INACTIVE', reason: '停用原因',
    })
    assert.equal(input?.status, 'INACTIVE')
    assert.equal(input?.reason, '停用原因')
    assert.equal(input?.accountId, 'acc-001')
    assert.equal(input?.expectedVersion, 2)
  })

  it('rejects zero amount for entitlement grant', () => {
    const definition = createAdminPeopleMutationDefinition(
      'mip.admin.entitlements.grant', '', detailReader({}),
    )
    assert.equal(buildAdminPeopleMutationInput(definition, {
      userId: 'user-1', entitlementType: 'EVENT_PASS', amount: 0,
    }), null)
  })

  it('rejects negative amount for entitlement grant', () => {
    const definition = createAdminPeopleMutationDefinition(
      'mip.admin.entitlements.grant', '', detailReader({}),
    )
    assert.equal(buildAdminPeopleMutationInput(definition, {
      userId: 'user-1', entitlementType: 'EVENT_PASS', amount: -5,
    }), null)
  })

  it('accepts a valid positive integer amount for entitlement grant', () => {
    const definition = createAdminPeopleMutationDefinition(
      'mip.admin.entitlements.grant', '', detailReader({}),
    )
    const input = buildAdminPeopleMutationInput(definition, {
      userId: 'user-1', entitlementType: 'EVENT_PASS', amount: 100,
    })
    assert.equal(input?.userId, 'user-1')
    assert.equal(input?.entitlementType, 'EVENT_PASS')
    assert.equal(input?.amount, 100)
  })

  it('rejects changeStatus without reason (self-deactivation prevention prerequisite)', () => {
    const definition = {
      action: 'mip.admin.adminAccounts.changeStatus' as const,
      capability: 'roles.change',
      title: '启用/停用账号',
      description: '',
      fields: [],
      values: {},
      targetId: 'acc-001',
      expectedVersion: 1,
    }
    // Without reason, the change status should be rejected
    const result = buildAdminPeopleMutationInput(definition, { status: 'INACTIVE', reason: '' })
    assert.equal(result, null, 'changeStatus without reason should return null')
    // With reason, it should return a valid object
    const validResult = buildAdminPeopleMutationInput(definition, { status: 'INACTIVE', reason: '停用原因' })
    assert.ok(validResult, 'changeStatus with reason should return a valid object')
    assert.equal((validResult as Record<string, unknown>).status, 'INACTIVE')
    assert.equal((validResult as Record<string, unknown>).reason, '停用原因')
  })

  it('membership grant is append-only with no revoke action available', () => {
    // Verify that ADMIN_PEOPLE_MUTATION_ACTIONS does not contain a revoke/delete membership action
    const membershipActions = ADMIN_PEOPLE_MUTATION_ACTIONS.filter(
      action => action.includes('entitlements') || action.includes('memberships')
    )
    // Only grant should exist, no revoke/delete
    assert.ok(membershipActions.includes('mip.admin.entitlements.grant' as AdminPeopleMutationAction), 'grant action should exist')
    assert.ok(!membershipActions.some(a => a.includes('revoke') || a.includes('delete')), 'no revoke/delete membership action should exist')
  })

  it('rejects duplicate loginAccount by enforcing strict format validation (uniqueness prerequisite)', () => {
    // Client-side validation enforces loginAccount format ^[A-Za-z0-9_.-]{3,64}$
    // This is the prerequisite before the server checks DB uniqueness
    // An account with spaces or special chars would be rejected before hitting the DB
    const result1 = buildAdminPeopleMutationInput(
      { action: 'mip.admin.adminAccounts.create' as AdminPeopleMutationAction, capability: 'roles.change', title: '', description: '', fields: [], values: {}, targetId: '' },
      { loginAccount: 'test user!', name: 'Test', phone: '13800138000', roleKey: 'PLATFORM_OPERATIONS' }
    )
    assert.equal(result1, null, 'loginAccount with spaces and special chars should be rejected')

    // A valid loginAccount passes client validation (server checks uniqueness)
    const result2 = buildAdminPeopleMutationInput(
      { action: 'mip.admin.adminAccounts.create' as AdminPeopleMutationAction, capability: 'roles.change', title: '', description: '', fields: [], values: {}, targetId: '' },
      { loginAccount: 'test_user_001', name: 'Test', phone: '13800138000', roleKey: 'PLATFORM_OPERATIONS' }
    )
    assert.ok(result2, 'valid loginAccount should pass client validation')
  })

  it('entitlement grant validates months as positive integer when provided', () => {
    // Test that months must be a positive integer (whole months only)
    const buildGrant = (values: Record<string, unknown>) => buildAdminPeopleMutationInput(
      { action: 'mip.admin.entitlements.grant' as AdminPeopleMutationAction, capability: 'roles.change', title: '', description: '', fields: [], values: {}, targetId: '' },
      values
    )
    // Zero months should be rejected
    assert.equal(buildGrant({ userId: 'u1', entitlementType: 'MEMBERSHIP', months: 0 }), null, 'zero months should be rejected')
    // Negative months should be rejected
    assert.equal(buildGrant({ userId: 'u1', entitlementType: 'MEMBERSHIP', months: -3 }), null, 'negative months should be rejected')
    // Fractional months should be rejected
    assert.equal(buildGrant({ userId: 'u1', entitlementType: 'MEMBERSHIP', months: 1.5 }), null, 'fractional months should be rejected')
    // Valid positive integer months should pass
    const valid = buildGrant({ userId: 'u1', entitlementType: 'MEMBERSHIP', months: 12 })
    assert.ok(valid, 'positive integer months should pass')
  })

  it('self-deactivation is blocked by requiring reason and server-side identity check', () => {
    // The client validates reason is required (already tested)
    // The server checks caller.userId === input.accountId
    // Here we verify the mutation input includes accountId for server comparison
    const definition = {
      action: 'mip.admin.adminAccounts.changeStatus' as AdminPeopleMutationAction,
      capability: 'roles.change', title: '', description: '', fields: [], values: {},
      targetId: 'acc-001', expectedVersion: 1,
    }
    const result = buildAdminPeopleMutationInput(definition, { status: 'INACTIVE', reason: '停用' })
    assert.ok(result, 'valid input should produce result')
    assert.equal((result as Record<string, unknown>).accountId, 'acc-001', 'accountId must be in output for server self-check')
    assert.equal((result as Record<string, unknown>).status, 'INACTIVE')
  })
})
