import type { BranchId, UserId } from '../src/modules/mip'
import type {
  IdentityAccessSnapshot,
  MipIdentityGateway,
  ProfileUpdateInput,
} from '../src/modules/mip-identity'
import { describe, expect, it, vi } from 'vitest'
import {
  accountClosureConfirmationPhrase,
  createAccountClosureRequestTracker,
  createMipIdentityGateway,
  createMipIdentityModule,
  evaluateAccess,
  mipAccessPageUrl,
} from '../src/modules/mip-identity'

function accessSnapshot(overrides: Partial<IdentityAccessSnapshot> = {}): IdentityAccessSnapshot {
  return {
    authenticated: true,
    userId: '10000000-0000-4000-8000-000000000001' as UserId,
    userVersion: 1,
    userStatus: 'ACTIVE',
    phoneBound: false,
    agreements: [{
      key: 'SERVICE_AGREEMENT',
      label: '用户协议',
      version: '1',
      documentPath: '/packages/member/about/index',
      accepted: false,
    }],
    profile: {
      exists: false,
      version: 0,
      nickname: '',
      avatarBound: false,
      identityStatus: '',
      headline: '',
      introduction: '',
      companies: [],
      organizations: [],
      visibility: {
        headline: true,
        introduction: true,
        companies: true,
        organizations: true,
      },
      abilityTagIds: [],
      complete: false,
      missingFields: ['NICKNAME', 'PRIMARY_BRANCH'],
    },
    membership: { kind: 'GUEST', source: 'NONE' },
    grants: [],
    ...overrides,
  }
}

function gateway(initial = accessSnapshot()) {
  let snapshot = initial
  const source = {
    getAccessSnapshot: vi.fn(async () => snapshot),
    acceptAgreements: vi.fn(async () => {
      snapshot = {
        ...snapshot,
        agreements: snapshot.agreements.map(item => ({ ...item, accepted: true })),
      }
      return snapshot
    }),
    bindWechatPhone: vi.fn(async () => {
      snapshot = { ...snapshot, phoneBound: true }
      return snapshot
    }),
    closeAccount: vi.fn(async input => ({
      status: 'CLOSED' as const,
      version: input.expectedVersion + 1,
      closedAt: '2026-08-24T00:00:00.000Z',
      idempotent: false,
    })),
    getProfile: vi.fn(async () => snapshot.profile),
    updateProfile: vi.fn(async (_input: ProfileUpdateInput) => {
      snapshot = {
        ...snapshot,
        primaryBranchId: '20000000-0000-4000-8000-000000000001' as BranchId,
        profile: {
          ...snapshot.profile,
          exists: true,
          version: 1,
          nickname: '测试用户',
          complete: true,
          missingFields: [],
        },
      }
      return snapshot
    }),
    listProfileTags: vi.fn(async () => []),
    listBranches: vi.fn(async () => []),
    setPrimaryBranch: vi.fn(),
  } satisfies MipIdentityGateway
  return source
}

const protectedIntent = {
  action: 'REGISTER_EVENT' as const,
  source: {
    navigation: 'redirectTo' as const,
    route: '/packages/member/event-detail/index',
    query: { id: 'event-1' },
  },
}

describe('MIP resumable identity access', () => {
  it('checks agreement, phone and profile in order before restoring the source action', async () => {
    const source = gateway()
    const module = createMipIdentityModule(source, { token: () => 'intent-1' })

    const started = await module.beginProtectedAction(protectedIntent)
    expect(started.decision).toMatchObject({ block: 'AGREEMENT_REQUIRED' })

    const agreements = started.snapshot.agreements.map(item => ({
      key: item.key,
      version: item.version,
    }))
    expect((await module.acceptAgreements('intent-1', { agreements })).decision)
      .toMatchObject({ block: 'PHONE_REQUIRED' })
    expect((await module.bindWechatPhone('intent-1', 'phone-code')).decision)
      .toMatchObject({ block: 'PROFILE_REQUIRED' })
    expect((await module.updateProfile('intent-1', {
      expectedVersion: 0,
      nickname: '测试用户',
      identityStatus: '',
      headline: '',
      introduction: '',
      companies: [],
      organizations: [],
      visibility: {
        headline: true,
        introduction: true,
        companies: true,
        organizations: true,
      },
      abilityTagIds: [],
    })).decision.ready).toBe(true)

    await expect(module.complete('intent-1')).resolves.toEqual(protectedIntent.source)
    expect(module.peekIntent('intent-1')).toBeNull()
  })

  it('does not derive PLAYER or admin access on the client', () => {
    const serverSnapshot = accessSnapshot({
      phoneBound: true,
      agreements: [],
      profile: { ...accessSnapshot().profile, complete: true, missingFields: [] },
      membership: { kind: 'GUEST', source: 'UNAVAILABLE' },
    })
    expect(evaluateAccess(serverSnapshot, protectedIntent).ready).toBe(true)
    expect(serverSnapshot.membership.kind).toBe('GUEST')

    expect(evaluateAccess(serverSnapshot, {
      ...protectedIntent,
      action: 'ENTER_ADMIN',
      requiredCapability: 'admin:enter',
    })).toEqual({ ready: false, block: 'FORBIDDEN' })
  })

  it('keeps one resume payload when navigation cannot carry query parameters', async () => {
    const source = gateway()
    const module = createMipIdentityModule(source, { token: () => 'resume-1' })
    const started = await module.beginProtectedAction({
      ...protectedIntent,
      source: { navigation: 'navigateBack' },
    })
    const agreements = started.snapshot.agreements.map(item => ({
      key: item.key,
      version: item.version,
    }))
    await module.acceptAgreements(started.token, { agreements })
    await module.bindWechatPhone(started.token, 'phone-code')
    await module.updateProfile(started.token, {
      expectedVersion: 0,
      nickname: '测试用户',
      identityStatus: '',
      headline: '',
      introduction: '',
      companies: [],
      organizations: [],
      visibility: {
        headline: true,
        introduction: true,
        companies: true,
        organizations: true,
      },
      abilityTagIds: [],
    })
    await module.complete(started.token)

    expect(module.consumePendingResume()).toEqual({
      action: 'REGISTER_EVENT',
      source: { navigation: 'navigateBack' },
    })
    expect(module.consumePendingResume()).toBeNull()
  })

  it('returns an internal access route and keeps no intent when access is already ready', async () => {
    const ready = accessSnapshot({
      phoneBound: true,
      agreements: [],
      profile: { ...accessSnapshot().profile, complete: true, missingFields: [] },
    })
    const module = createMipIdentityModule(gateway(ready), { token: () => 'intent-ready' })
    const session = await module.beginProtectedAction(protectedIntent)

    expect(session.decision.ready).toBe(true)
    expect(module.peekIntent(session.token)).toBeNull()
    expect(mipAccessPageUrl('intent-1')).toBe('/packages/member/mip-access/index?token=intent-1')
  })

  it('refreshes the cached identity snapshot when a bound phone is replaced', async () => {
    const source = gateway(accessSnapshot({ phoneBound: true }))
    const module = createMipIdentityModule(source)

    await module.loadSnapshot()
    const updated = await module.rebindWechatPhone('replacement-code')

    expect(updated.phoneBound).toBe(true)
    expect(module.peekSnapshot()).toBe(updated)
    expect(source.bindWechatPhone).toHaveBeenCalledWith('replacement-code')
    await expect(module.rebindWechatPhone(' ')).rejects.toThrow('PHONE_CODE_REQUIRED')
  })

  it('rejects external return routes and expires transient intents', async () => {
    let now = 1000
    const module = createMipIdentityModule(gateway(), {
      now: () => now,
      token: () => 'intent-1',
      intentLifetimeMs: 50,
    })
    await expect(module.beginProtectedAction({
      ...protectedIntent,
      source: { navigation: 'redirectTo', route: 'https://example.com' },
    })).rejects.toThrow('INVALID_RETURN_ROUTE')

    await module.beginProtectedAction(protectedIntent)
    now = 1051
    await expect(module.loadAccess('intent-1')).rejects.toThrow('ACCESS_INTENT_EXPIRED')
  })
})

describe('MIP identity gateway', () => {
  it('surfaces structured server errors and rejects malformed success envelopes', async () => {
    const denied = createMipIdentityGateway({
      invoke: vi.fn(async () => ({
        ok: false,
        error: { code: 'FORBIDDEN', message: '当前没有权限', retryable: false },
      })),
    })
    await expect(denied.getAccessSnapshot()).rejects.toMatchObject({ code: 'FORBIDDEN' })

    const malformed = createMipIdentityGateway({
      invoke: vi.fn(async () => ({ ok: true, data: { authenticated: true } })),
    })
    await expect(malformed.getAccessSnapshot()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
  })

  it('sanitizes account closure responses and keeps internal identifiers out of the client result', async () => {
    const identityGateway = createMipIdentityGateway({
      invoke: vi.fn(async () => ({
        ok: true,
        data: {
          status: 'CLOSED',
          version: 3,
          closedAt: '2026-08-24T08:00:00.000Z',
          idempotent: false,
          userId: 'internal-user-id',
          openid: 'internal-openid',
        },
      })),
    })
    const result = await identityGateway.closeAccount({
      confirmationPhrase: accountClosureConfirmationPhrase,
      expectedVersion: 2,
      idempotencyKey: 'identity-close-request-1',
    })
    expect(result).toEqual({
      status: 'CLOSED',
      version: 3,
      closedAt: '2026-08-24T08:00:00.000Z',
      idempotent: false,
    })
    expect(result).not.toHaveProperty('userId')
    expect(result).not.toHaveProperty('openid')
  })

  it('keeps one closure request key across retries until the intent is reset', () => {
    const createKey = vi.fn()
      .mockReturnValueOnce('identity-close-request-1')
      .mockReturnValueOnce('identity-close-request-2')
    const tracker = createAccountClosureRequestTracker(createKey)
    expect(tracker.current()).toBe('identity-close-request-1')
    expect(tracker.current()).toBe('identity-close-request-1')
    expect(createKey).toHaveBeenCalledTimes(1)
    tracker.reset()
    expect(tracker.current()).toBe('identity-close-request-2')
  })
})
