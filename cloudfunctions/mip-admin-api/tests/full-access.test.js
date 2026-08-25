'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const {
  assertFullAccessUser,
  configuredAgreements,
  createFullAccessPolicy,
} = require('../domain/full-access')
const { actions, createHandler } = require('../domain/handler')
const { createAdminService } = require('../domain/service')

const caller = { appId: 'wx-app', identityKey: 'identity-key' }

describe('admin full access', () => {
  it('loads current AppID-scoped identity facts without exposing private values', async () => {
    const calls = []
    const policy = createFullAccessPolicy({
      agreements: [{ key: 'PRIVACY_POLICY', version: 'privacy-v3' }],
    })
    const user = await policy.loadByIdentity({
      async one(sql, params) {
        calls.push({ sql, params })
        return {
          id: 'admin-user',
          status: 'ACTIVE',
          primary_branch_id: 'branch-a',
          nickname: '运营人员',
          phone_verified_at: new Date('2026-08-24T00:00:00.000Z'),
          agreement_0_accepted: 1,
        }
      },
    }, caller)

    assert.deepEqual(user, {
      id: 'admin-user',
      status: 'ACTIVE',
      phoneBound: true,
      profileComplete: true,
      agreementsAccepted: true,
    })
    assert.deepEqual(calls[0].params, [
      'PRIVACY_POLICY', 'privacy-v3', caller.appId, caller.identityKey,
    ])
    assert.match(calls[0].sql, /FROM mip_user_identities identity/)
    assert.match(calls[0].sql, /identity\.app_id = \?/)
    assert.doesNotMatch(calls[0].sql, /FOR UPDATE/)
    assert.equal(Object.hasOwn(user, 'phone_verified_at'), false)
    assert.equal(Object.hasOwn(user, 'nickname'), false)
  })

  it('requires every configured current agreement version', async () => {
    const policy = createFullAccessPolicy({
      agreements: [
        { key: 'SERVICE_AGREEMENT', version: 'service-v2' },
        { key: 'PRIVACY_POLICY', version: 'privacy-v3' },
      ],
    })
    const user = await policy.loadByIdentity({
      async one(_sql, params) {
        assert.deepEqual(params, [
          'SERVICE_AGREEMENT', 'service-v2',
          'PRIVACY_POLICY', 'privacy-v3',
          caller.appId, caller.identityKey,
        ])
        return {
          id: 'admin-user',
          status: 'ACTIVE',
          primary_branch_id: 'branch-a',
          nickname: '运营人员',
          phone_verified_at: new Date('2026-08-24T00:00:00.000Z'),
          agreement_0_accepted: 1,
          agreement_1_accepted: 0,
        }
      },
    }, caller)

    assert.equal(user.agreementsAccepted, false)
    assert.throws(() => assertFullAccessUser(user), /AGREEMENT_REQUIRED/)
  })

  it('does not treat an acceptance for an old agreement version as current', async () => {
    const policy = createFullAccessPolicy({
      agreements: [{ key: 'SERVICE_AGREEMENT', version: 'service-v2' }],
    })
    const user = await policy.loadByIdentity({
      async one(_sql, params) {
        const acceptedVersion = 'service-v1'
        return {
          id: 'admin-user',
          status: 'ACTIVE',
          primary_branch_id: 'branch-a',
          nickname: '运营人员',
          phone_verified_at: new Date('2026-08-24T00:00:00.000Z'),
          agreement_0_accepted: Number(params[1] === acceptedVersion),
        }
      },
    }, caller)

    assert.equal(user.agreementsAccepted, false)
    assert.throws(() => assertFullAccessUser(user), /AGREEMENT_REQUIRED/)
  })

  it('requires a primary branch even when nickname, phone, and agreements are current', async () => {
    const policy = createFullAccessPolicy({
      agreements: [{ key: 'SERVICE_AGREEMENT', version: 'service-v2' }],
    })
    const user = await policy.loadByIdentity({
      async one() {
        return {
          id: 'admin-user',
          status: 'ACTIVE',
          primary_branch_id: null,
          nickname: '运营人员',
          phone_verified_at: new Date('2026-08-24T00:00:00.000Z'),
          agreement_0_accepted: 1,
        }
      },
    }, caller)

    assert.equal(user.profileComplete, false)
    assert.throws(() => assertFullAccessUser(user), /PROFILE_REQUIRED/)
  })

  it('locks the identity facts only when the caller requests a transaction recheck', async () => {
    const calls = []
    const policy = createFullAccessPolicy({
      agreements: [{ key: 'SERVICE_AGREEMENT', version: 'service-v2' }],
    })
    const queryable = {
      async one(sql) {
        calls.push(sql)
        return null
      },
    }

    await policy.loadByIdentity(queryable, caller)
    await policy.loadByIdentity(queryable, caller, { lock: true })

    assert.doesNotMatch(calls[0], /FOR UPDATE/)
    assert.match(calls[1], /LIMIT 1 FOR UPDATE/)
  })

  it('checks all non-health actions before role, capability, or input handling', async () => {
    let roleReads = 0
    const service = createAdminService({
      repository: {
        async resolveUser() {
          return {
            id: 'admin-user',
            status: 'ACTIVE',
            agreementsAccepted: false,
            phoneBound: false,
            profileComplete: false,
          }
        },
        async listRoleBindings() {
          roleReads += 1
          throw new Error('role lookup must not run')
        },
      },
    })
    const handler = createHandler({
      service,
      getContext: () => ({}),
      resolveCaller: () => caller,
    })

    for (const action of Object.keys(actions).filter(action => action !== 'health')) {
      const response = await handler({ action })
      assert.equal(response.ok, false, action)
      assert.equal(response.error.code, 'AGREEMENT_REQUIRED', action)
    }
    assert.equal(roleReads, 0)
  })

  it('fails in the client requirement order before checking roles', () => {
    assert.throws(() => assertFullAccessUser(null), /AUTH_REQUIRED/)
    assert.throws(() => assertFullAccessUser({ status: 'SUSPENDED' }), /FORBIDDEN/)
    assert.throws(() => assertFullAccessUser({
      status: 'ACTIVE', agreementsAccepted: false, phoneBound: true, profileComplete: true,
    }), /AGREEMENT_REQUIRED/)
    assert.throws(() => assertFullAccessUser({
      status: 'ACTIVE', agreementsAccepted: true, phoneBound: false, profileComplete: true,
    }), /PHONE_REQUIRED/)
    assert.throws(() => assertFullAccessUser({
      status: 'ACTIVE', agreementsAccepted: true, phoneBound: true, profileComplete: false,
    }), /PROFILE_REQUIRED/)
  })

  it('keeps agreement parsing aligned with the identity function contract', () => {
    assert.deepEqual(configuredAgreements().map(({ key, version }) => ({ key, version })), [
      { key: 'SERVICE_AGREEMENT', version: 'draft-2026-08-24' },
      { key: 'PRIVACY_POLICY', version: 'draft-2026-08-24' },
    ])
    assert.throws(() => configuredAgreements('[]'), /AGREEMENT_CONFIG_INVALID/)
  })
})
