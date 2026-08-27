'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const {
  createIdentityService,
  defaultAgreements,
  membershipProjection,
  normalizeProfileInput,
} = require('../domain/service')

const caller = { appId: 'wx0000000000000001', identityKey: 'a'.repeat(64) }

function facts(overrides = {}) {
  return {
    user: {
      id: '10000000-0000-4000-8000-000000000001',
      status: 'ACTIVE',
      primary_branch_id: '20000000-0000-4000-8000-000000000001',
      version: 2,
    },
    profile: {
      nickname: '测试用户',
      avatar_status: null,
      identity_status: '创业者',
      headline: '',
      introduction: '',
      companies_json: '[]',
      organizations_json: '[]',
      visibility_json: '{}',
      version: 1,
    },
    privateProfile: { phone_verified_at: new Date() },
    acceptances: [
      { agreement_key: 'SERVICE_AGREEMENT', agreement_version: 'draft-2026-08-24' },
      { agreement_key: 'PRIVACY_POLICY', agreement_version: 'draft-2026-08-24' },
    ],
    profileTags: [],
    roles: [{
      scope_type: 'BRANCH',
      scope_id: '20000000-0000-4000-8000-000000000001',
      role_key: 'BRANCH_ADMIN',
    }],
    ...overrides,
  }
}

function repository(overrides = {}) {
  return {
    ensureUser: async () => facts().user,
    loadFacts: async () => facts(),
    loadEntitlement: async () => ({ source: 'NONE', entitlement: null }),
    acceptAgreements: async () => {},
    bindPhone: async () => {},
    closeAccount: async () => ({
      status: 'CLOSED',
      version: 3,
      closedAt: '2026-08-24T00:00:00.000Z',
      idempotent: false,
    }),
    updateProfile: async () => {},
    listProfileTags: async () => [],
    listBranches: async () => [],
    setPrimaryBranch: async () => {},
    ...overrides,
  }
}

describe('MIP identity service', () => {
  it('accepts every current agreement exactly once and persists only the server catalog', async () => {
    const writes = []
    const service = createIdentityService({
      repository: repository({
        acceptAgreements: async (appId, userId, agreements) => {
          writes.push({ appId, userId, agreements })
        },
      }),
    })
    const submitted = defaultAgreements
      .map(({ key, version }) => ({ key, version }))
      .reverse()

    await service.acceptAgreements(caller, { agreements: submitted })

    assert.deepEqual(writes, [{
      appId: caller.appId,
      userId: facts().user.id,
      agreements: defaultAgreements,
    }])
  })

  it('rejects missing, duplicate, stale, extra, arbitrary, and loosely shaped agreements', async () => {
    const current = defaultAgreements.map(({ key, version }) => ({ key, version }))
    const invalidInputs = [
      { agreements: current.slice(0, 1) },
      { agreements: [current[0], current[0]] },
      { agreements: [{ ...current[0], version: 'draft-older' }, current[1]] },
      { agreements: [...current, { key: 'EXTRA_AGREEMENT', version: '1' }] },
      { agreements: [{ key: current[0].key, version: 'client-selected' }, current[1]] },
      { agreements: [{ ...current[0], accepted: true }, current[1]] },
      { agreements: current, acceptedByClient: true },
      { input: { agreements: current } },
    ]

    for (const input of invalidInputs) {
      let writes = 0
      const service = createIdentityService({
        repository: repository({
          acceptAgreements: async () => {
            writes += 1
          },
        }),
      })
      await assert.rejects(
        () => service.acceptAgreements(caller, input),
        /AGREEMENT_VERSION_CHANGED/,
      )
      assert.equal(writes, 0)
    }
  })

  it('returns an opaque self profile reference for card sharing', async () => {
    const service = createIdentityService({
      repository: repository(),
      profileRefWriter(input) {
        assert.deepEqual(input, { appId: caller.appId, userId: facts().user.id })
        return 'p1.self-profile-reference'
      },
    })

    const snapshot = await service.getAccessSnapshot(caller)
    assert.equal(snapshot.profileRef, 'p1.self-profile-reference')
  })

  it('projects PLAYER only from an active server entitlement window', async () => {
    const service = createIdentityService({
      repository: repository(),
      entitlementReader: {
        async load() {
          return {
            source: 'ENTITLEMENT',
            entitlement: {
              status: 'ACTIVE',
              startsAt: '2020-01-01T00:00:00.000Z',
              endsAt: '2099-01-01T00:00:00.000Z',
            },
          }
        },
      },
    })

    const snapshot = await service.getAccessSnapshot(caller)
    assert.equal(snapshot.membership.kind, 'PLAYER')
    assert.equal(snapshot.membership.source, 'ENTITLEMENT')
  })

  it('fails safe as GUEST when the entitlement table is unavailable', async () => {
    const service = createIdentityService({
      repository: repository({
        loadEntitlement: async () => ({ source: 'UNAVAILABLE', entitlement: null }),
      }),
    })

    const snapshot = await service.getAccessSnapshot(caller)
    assert.deepEqual(snapshot.membership, { kind: 'GUEST', source: 'UNAVAILABLE' })
  })

  it('projects refunded and expired entitlements as GUEST', async () => {
    const refunded = await membershipProjection({
      async load() {
        return {
          source: 'ENTITLEMENT',
          entitlement: {
            status: 'REFUNDED',
            startsAt: '2020-01-01T00:00:00.000Z',
            endsAt: '2099-01-01T00:00:00.000Z',
          },
        }
      },
    }, caller.appId, facts().user.id)
    const expired = await membershipProjection({
      async load() {
        return {
          source: 'ENTITLEMENT',
          entitlement: {
            status: 'ACTIVE',
            startsAt: '2020-01-01T00:00:00.000Z',
            endsAt: '2021-01-01T00:00:00.000Z',
          },
        }
      },
    }, caller.appId, facts().user.id)

    assert.equal(refunded.kind, 'GUEST')
    assert.equal(expired.kind, 'GUEST')
  })

  it('returns branch capabilities only inside the bound branch scope', async () => {
    const service = createIdentityService({ repository: repository() })
    const snapshot = await service.getAccessSnapshot(caller)

    assert.deepEqual(snapshot.grants, [{
      scopeType: 'BRANCH',
      scopeId: '20000000-0000-4000-8000-000000000001',
      roles: ['BRANCH_ADMIN'],
      capabilities: ['admin:enter', 'branch:manage_members', 'branch:operate'],
    }])
  })

  it('removes projected admin entry grants when the effective policy removes them', async () => {
    const restrictedFacts = facts({
      roles: [{
        scope_type: 'BRANCH',
        scope_id: '20000000-0000-4000-8000-000000000001',
        role_key: 'BRANCH_ADMIN',
        policy_capabilities_json: JSON.stringify(['users.read']),
      }],
    })
    const service = createIdentityService({
      repository: repository({ loadFacts: async () => restrictedFacts }),
    })
    const snapshot = await service.getAccessSnapshot(caller)
    assert.deepEqual(snapshot.grants[0].capabilities, ['branch:manage_members'])
  })
})

describe('MIP profile input', () => {
  it('normalizes influence visibility as an explicit public-profile choice', () => {
    const normalized = normalizeProfileInput({
      expectedVersion: 0,
      nickname: '测试用户',
      identityStatus: '',
      headline: '',
      introduction: '',
      companies: [],
      organizations: [],
      visibility: { influence: false },
      abilityTagIds: [],
    })
    assert.equal(normalized.visibility.influence, false)
    assert.equal(normalizeProfileInput({
      expectedVersion: 0,
      nickname: '历史用户',
      identityStatus: '',
      headline: '',
      introduction: '',
      companies: [],
      organizations: [],
      visibility: {},
      abilityTagIds: [],
    }).visibility.influence, false)
  })

  it('accepts up to twelve companies and organizations', () => {
    const base = {
      expectedVersion: 0,
      nickname: '测试用户',
      identityStatus: '',
      headline: '',
      introduction: '',
      visibility: {},
      abilityTagIds: [],
    }
    const entries = Array.from({ length: 12 }, (_, index) => ({
      name: `组织 ${index + 1}`,
      role: '成员',
    }))
    assert.equal(normalizeProfileInput({
      ...base,
      companies: entries,
      organizations: entries,
    }).organizations.length, 12)
    assert.throws(
      () => normalizeProfileInput({
        ...base,
        companies: [...entries, { name: '第十三项' }],
        organizations: [],
      }),
      /VALIDATION_FAILED/,
    )
  })

  it('accepts the configured uppercase career identity keys', () => {
    const normalized = normalizeProfileInput({
      expectedVersion: 0,
      nickname: '测试用户',
      careerIdentityKey: 'BRAND_PRINCIPAL',
      identityStatus: '',
      headline: '',
      introduction: '',
      companies: [],
      organizations: [],
      visibility: {},
      abilityTagIds: [],
    })
    assert.equal(normalized.careerIdentityKey, 'BRAND_PRINCIPAL')
    assert.throws(
      () => normalizeProfileInput({
        expectedVersion: 0,
        nickname: '测试用户',
        careerIdentityKey: 'brand-principal',
        identityStatus: '',
        headline: '',
        introduction: '',
        companies: [],
        organizations: [],
        visibility: {},
        abilityTagIds: [],
      }),
      /VALIDATION_FAILED/,
    )
  })

  it('requires branch and user version to be supplied as one optimistic-lock pair', () => {
    const base = {
      expectedVersion: 0,
      nickname: '测试用户',
      identityStatus: '',
      headline: '',
      introduction: '',
      companies: [],
      organizations: [],
      visibility: {},
      abilityTagIds: [],
    }
    assert.throws(
      () => normalizeProfileInput({
        ...base,
        primaryBranchId: '20000000-0000-4000-8000-000000000001',
      }),
      /VALIDATION_FAILED/,
    )
    assert.equal(normalizeProfileInput({
      ...base,
      expectedUserVersion: 2,
      primaryBranchId: '20000000-0000-4000-8000-000000000001',
    }).expectedUserVersion, 2)
  })

  it('accepts one primary industry scalar and rejects a plural industry field', () => {
    const base = {
      expectedVersion: 0,
      nickname: '测试用户',
      identityStatus: '',
      headline: '',
      introduction: '',
      companies: [],
      organizations: [],
      visibility: {},
      abilityTagIds: [],
    }
    const industryId = '21000000-0000-4000-8000-000000000001'
    assert.equal(normalizeProfileInput({
      ...base,
      primaryIndustryTagId: industryId,
    }).primaryIndustryTagId, industryId)
    assert.throws(
      () => normalizeProfileInput({
        ...base,
        primaryIndustryTagIds: [industryId],
      }),
      /VALIDATION_FAILED/,
    )
  })

  it('returns grouping and selectable profile tags as one ordered catalog', async () => {
    const service = createIdentityService({
      repository: repository({
        async listProfileTags() {
          return [
            {
              id: '21900000-0000-4000-8000-000000000001',
              kind: 'INDUSTRY',
              parent_id: null,
              tag_key: 'internet_ai',
              label: '互联网与人工智能',
              selectable: 0,
              popular: 0,
            },
            {
              id: '21000000-0000-4000-8000-000000000001',
              kind: 'INDUSTRY',
              parent_id: '21900000-0000-4000-8000-000000000001',
              tag_key: 'internet',
              label: '互联网',
              selectable: 1,
              popular: 1,
            },
          ]
        },
      }),
    })

    assert.deepEqual(await service.listProfileTags(caller), [
      {
        id: '21900000-0000-4000-8000-000000000001',
        kind: 'INDUSTRY',
        parentId: undefined,
        key: 'internet_ai',
        label: '互联网与人工智能',
        selectable: false,
        popular: false,
      },
      {
        id: '21000000-0000-4000-8000-000000000001',
        kind: 'INDUSTRY',
        parentId: '21900000-0000-4000-8000-000000000001',
        key: 'internet',
        label: '互联网',
        selectable: true,
        popular: true,
      },
    ])
  })
})
