'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')

const { createAdminAccess } = require('../domain/access')
const { CAPABILITIES } = require('../domain/capabilities')

const caller = {
  appId: 'wx-trusted',
  identityKey: 'wechat-identity',
  roleKey: 'PLATFORM_OWNER',
  capabilities: [CAPABILITIES.USERS_EDIT],
}

function fullUser() {
  return {
    id: 'admin-user',
    status: 'ACTIVE',
    agreementsAccepted: true,
    phoneBound: true,
    profileComplete: true,
  }
}

function ownerBinding() {
  return { roleKey: 'PLATFORM_OWNER', scopeType: 'PLATFORM', scopeId: null }
}

describe('admin access module', () => {
  it('reloads current role facts for every session and ignores caller-supplied roles', async () => {
    let roleReads = 0
    const repository = {
      resolveUser: async received => {
        assert.equal(received, caller)
        return fullUser()
      },
      listRoleBindings: async (appId, userId) => {
        assert.deepEqual([appId, userId], ['wx-trusted', 'admin-user'])
        roleReads += 1
        return roleReads === 1
          ? [{
              roleKey: 'PLATFORM_OPERATIONS',
              scopeType: 'PLATFORM',
              scopeId: null,
              capabilities: [CAPABILITIES.DASHBOARD],
            }]
          : [{ roleKey: 'EVENT_STAFF', scopeType: 'EVENT', scopeId: 'event-a' }]
      },
    }
    const access = createAdminAccess({ repository })

    const first = await access.session(caller)
    const second = await access.session(caller)

    assert.equal(roleReads, 2)
    assert.deepEqual(first.capabilities.map(item => item.capability), [CAPABILITIES.DASHBOARD])
    assert.equal(second.bindings[0].roleKey, 'EVENT_STAFF')
    assert.equal(second.capabilities.some(item => item.capability === CAPABILITIES.USERS_EDIT), false)
  })

  it('enforces full access before reading role facts', async () => {
    let roleReads = 0
    const access = createAdminAccess({
      repository: {
        resolveUser: async () => ({
          ...fullUser(),
          agreementsAccepted: false,
        }),
        listRoleBindings: async () => {
          roleReads += 1
          return [ownerBinding()]
        },
      },
    })

    await assert.rejects(() => access.session(caller), /AGREEMENT_REQUIRED/)
    assert.equal(roleReads, 0)
  })

  it('projects public bindings and constructs server-owned authorization facts', async () => {
    const access = createAdminAccess({ repository: {} })
    const grant = {
      ...ownerBinding(),
      capabilities: [CAPABILITIES.USERS_READ],
    }
    const context = {
      caller: { appId: 'wx-trusted', userId: 'admin-user' },
      bindings: [grant],
    }

    assert.deepEqual(access.publicBindings(context.bindings), [ownerBinding()])
    assert.deepEqual(access.mutationAuthorization(grant, CAPABILITIES.USERS_EDIT), {
      capability: CAPABILITIES.USERS_EDIT,
      effectiveGrant: ownerBinding(),
    })
    assert.deepEqual(access.audit(context, grant, {
      appId: 'wx-forged',
      actorUserId: 'forged-user',
      scopeType: 'PLATFORM',
      scopeId: null,
      action: 'admin.users.fields.update',
      resourceType: 'USER',
      resourceId: 'target-user',
      effectiveRole: 'FORGED_ROLE',
    }), {
      appId: 'wx-trusted',
      actorUserId: 'admin-user',
      scopeType: 'PLATFORM',
      scopeId: null,
      action: 'admin.users.fields.update',
      resourceType: 'USER',
      resourceId: 'target-user',
      effectiveRole: 'PLATFORM_OWNER',
      metadata: {},
    })
  })

  it('requires an exact platform-owner binding', () => {
    const access = createAdminAccess({ repository: {} })
    const platformOwner = ownerBinding()
    assert.equal(access.requirePlatformOwner({ bindings: [platformOwner] }), platformOwner)
    for (const binding of [
      { ...platformOwner, scopeType: 'BRANCH', scopeId: 'branch-a' },
      { roleKey: 'PLATFORM_OPERATIONS', scopeType: 'PLATFORM', scopeId: null },
    ]) {
      assert.throws(
        () => access.requirePlatformOwner({ bindings: [binding] }),
        error => error?.code === 'FORBIDDEN',
      )
    }
  })

  it('returns NOT_FOUND before checking event or user scope permissions', async () => {
    const repository = {
      getEventScope: async (_appId, eventId) => eventId === 'missing-event'
        ? null
        : { scopeType: 'EVENT', scopeId: eventId, branchId: 'branch-a' },
      getUserScope: async (_appId, userId) => userId === 'missing-user'
        ? null
        : { scopeType: 'BRANCH', scopeId: 'branch-a' },
    }
    const access = createAdminAccess({ repository })
    const context = {
      caller: { appId: 'wx-trusted', userId: 'admin-user' },
      bindings: [{ roleKey: 'BRANCH_ADMIN', scopeType: 'BRANCH', scopeId: 'branch-b' }],
    }

    await assert.rejects(
      () => access.eventAuthorization(context, 'missing-event', CAPABILITIES.EVENTS_READ),
      error => error?.code === 'NOT_FOUND',
    )
    await assert.rejects(
      () => access.userAuthorization(context, 'missing-user', CAPABILITIES.USERS_READ),
      error => error?.code === 'NOT_FOUND',
    )
    await assert.rejects(
      () => access.eventAuthorization(context, 'event-a', CAPABILITIES.EVENTS_READ),
      error => error?.code === 'FORBIDDEN',
    )
    await assert.rejects(
      () => access.userAuthorization(context, 'user-a', CAPABILITIES.USERS_READ),
      error => error?.code === 'FORBIDDEN',
    )
  })
})
