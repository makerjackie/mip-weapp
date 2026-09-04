import type { BranchId, UserId } from '../src/modules/mip'
import type {
  IdentityAccessSnapshot,
  MipIdentityAccessStorage,
  MipIdentityGateway,
  ProfileUpdateInput,
} from '../src/modules/mip-identity'
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import {
  accountClosureConfirmationPhrase,
  createAccountClosureRequestTracker,
  createMipGlobalAccessGuard,
  createMipGlobalAccessIntent,
  createMipIdentityGateway,
  createMipIdentityModule,
  evaluateAccess,
  isMipGlobalAccessExemptRoute,
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

function memoryAccessStorage(initial?: unknown) {
  let value = initial
  const clone = <T>(input: T): T => structuredClone(input)
  const storage = {
    read: vi.fn(() => value === undefined ? undefined : clone(value)),
    write: vi.fn((state) => {
      value = clone(state)
    }),
    clear: vi.fn(() => {
      value = undefined
    }),
  } satisfies MipIdentityAccessStorage
  return {
    storage,
    value: () => value === undefined ? undefined : clone(value),
  }
}

const protectedIntent = {
  action: 'REGISTER_EVENT' as const,
  source: {
    navigation: 'redirectTo' as const,
    route: '/packages/member/mip-events/detail/index',
    query: { id: 'event-1' },
  },
}

describe('MIP resumable identity access', () => {
  it('coalesces concurrent snapshot reads into one request', async () => {
    let resolve!: (value: IdentityAccessSnapshot) => void
    const source = gateway()
    source.getAccessSnapshot = vi.fn(() => new Promise<IdentityAccessSnapshot>((done) => {
      resolve = done
    }))
    const module = createMipIdentityModule(source)
    const first = module.loadSnapshot()
    const second = module.loadSnapshot()
    expect(source.getAccessSnapshot).toHaveBeenCalledOnce()
    resolve(accessSnapshot({ agreements: [] }))
    await expect(Promise.all([first, second])).resolves.toHaveLength(2)
  })

  it('fences an old snapshot read across a mutation and keeps the newer flight alive', async () => {
    let resolveOld!: (value: IdentityAccessSnapshot) => void
    let resolveNew!: (value: IdentityAccessSnapshot) => void
    const source = gateway()
    source.getAccessSnapshot = vi.fn()
      .mockReturnValueOnce(new Promise<IdentityAccessSnapshot>((resolve) => { resolveOld = resolve }))
      .mockReturnValueOnce(new Promise<IdentityAccessSnapshot>((resolve) => { resolveNew = resolve }))
    const updated = accessSnapshot({ phoneBound: true })
    source.updateProfile = vi.fn(async () => updated)
    const module = createMipIdentityModule(source)

    const oldRead = module.loadSnapshot()
    await module.saveProfile({ nickname: '新用户' } as ProfileUpdateInput)
    const newRead = module.loadSnapshot()
    resolveOld(accessSnapshot({ phoneBound: false }))
    await oldRead
    expect(source.getAccessSnapshot).toHaveBeenCalledTimes(2)
    expect(module.peekSnapshot()).toEqual(updated)
    resolveNew(updated)
    await expect(newRead).resolves.toEqual(updated)
    expect(module.peekSnapshot()).toEqual(updated)
  })

  it('fences a snapshot read started during a pending access-session mutation', async () => {
    let resolveMutation!: (value: IdentityAccessSnapshot) => void
    let resolveRead!: (value: IdentityAccessSnapshot) => void
    const source = gateway()
    const updated = accessSnapshot({ agreements: [{ ...accessSnapshot().agreements[0], accepted: true }] })
    source.acceptAgreements = vi.fn(() => new Promise<IdentityAccessSnapshot>((resolve) => {
      resolveMutation = resolve
    }))
    source.getAccessSnapshot = vi.fn(() => new Promise<IdentityAccessSnapshot>((resolve) => {
      resolveRead = resolve
    }))
    const module = createMipIdentityModule(source, { token: () => 'access-mutation' })
    const token = module.prepareProtectedAction(protectedIntent)
    const mutation = module.acceptAgreements(token, { agreements: [{ key: 'SERVICE_AGREEMENT', version: '1' }] })
    const read = module.loadSnapshot()
    resolveMutation(updated)
    await expect(mutation).resolves.toMatchObject({ snapshot: updated })
    resolveRead(accessSnapshot({ agreements: [] }))
    await read
    expect(module.peekSnapshot()).toEqual(updated)
  })

  it('fences a snapshot read started during a pending profile save', async () => {
    let resolveMutation!: (value: IdentityAccessSnapshot) => void
    let resolveRead!: (value: IdentityAccessSnapshot) => void
    const source = gateway()
    const updated = accessSnapshot({ phoneBound: true })
    source.updateProfile = vi.fn(() => new Promise<IdentityAccessSnapshot>((resolve) => {
      resolveMutation = resolve
    }))
    source.getAccessSnapshot = vi.fn(() => new Promise<IdentityAccessSnapshot>((resolve) => {
      resolveRead = resolve
    }))
    const module = createMipIdentityModule(source)
    const mutation = module.saveProfile({ nickname: '新用户' } as ProfileUpdateInput)
    const read = module.loadSnapshot()
    resolveMutation(updated)
    await expect(mutation).resolves.toEqual(updated)
    resolveRead(accessSnapshot({ phoneBound: false }))
    await read
    expect(module.peekSnapshot()).toEqual(updated)
  })

  it('requires only authentication and current agreements before public browsing', () => {
    const intent = createMipGlobalAccessIntent({
      path: 'packages/member/mip-events/detail/index',
      query: { id: 'event-1' },
    })
    const ready = accessSnapshot({
      agreements: [],
      phoneBound: false,
      profile: { ...accessSnapshot().profile, complete: false },
    })

    expect(evaluateAccess(ready, intent)).toEqual({ ready: true })
    expect(evaluateAccess(accessSnapshot(), intent)).toMatchObject({
      ready: false,
      block: 'AGREEMENT_REQUIRED',
    })
    expect(evaluateAccess(accessSnapshot(), { ...intent, requirements: [] })).toEqual({ ready: true })
  })

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

  it('normalizes an internal fallback route while matching the page route without a leading slash', async () => {
    const ready = accessSnapshot({
      agreements: [],
      phoneBound: true,
      profile: { ...accessSnapshot().profile, complete: true, missingFields: [] },
    })
    const module = createMipIdentityModule(gateway(ready), { token: () => 'relative-resume' })
    const token = module.prepareProtectedAction({
      action: 'INTERACT',
      source: {
        navigation: 'navigateBack',
        route: 'packages/member/mip-events/check-in/index',
        query: { scene: 's1.abcdefghijk.abcdefghijk' },
      },
    })
    await module.complete(token)

    expect(module.consumePendingResume('packages/member/mip-events/check-in/index')).toEqual({
      action: 'INTERACT',
      source: {
        navigation: 'navigateBack',
        route: '/packages/member/mip-events/check-in/index',
        query: { scene: 's1.abcdefghijk.abcdefghijk' },
      },
    })
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

  it('restores a minimal versioned intent after cold start and clears it on cancel', () => {
    const memory = memoryAccessStorage()
    const first = createMipIdentityModule(gateway(), {
      now: () => 10_000,
      token: () => 'cold-intent',
      storage: memory.storage,
    })
    first.prepareProtectedAction({
      ...protectedIntent,
      source: {
        ...protectedIntent.source,
        query: {
          id: 'event-1',
          scene: 'branch-qr',
          openid: 'must-not-persist',
          phone: '13800000000',
          apiKey: 'must-not-persist',
          accessToken: 'must-not-persist',
        },
      },
    })

    const persisted = memory.value() as {
      version: number
      intents: Array<{ intent: typeof protectedIntent }>
    }
    expect(persisted.version).toBe(1)
    expect(persisted.intents[0].intent.source.query).toEqual({
      id: 'event-1',
      scene: 'branch-qr',
    })
    expect(JSON.stringify(persisted)).not.toContain('must-not-persist')
    expect(JSON.stringify(persisted)).not.toContain('13800000000')

    const restored = createMipIdentityModule(gateway(), {
      now: () => 10_001,
      storage: memory.storage,
    })
    expect(restored.peekIntent('cold-intent')).toMatchObject({
      action: 'REGISTER_EVENT',
      source: { route: '/packages/member/mip-events/detail/index' },
    })
    restored.cancel('cold-intent')
    expect(memory.value()).toBeUndefined()
  })

  it('expires persisted intents after 30 minutes', () => {
    let now = 20_000
    const memory = memoryAccessStorage()
    const first = createMipIdentityModule(gateway(), {
      now: () => now,
      token: () => 'expiring-intent',
      storage: memory.storage,
    })
    first.prepareProtectedAction(protectedIntent)

    now += 30 * 60 * 1000 + 1
    const restored = createMipIdentityModule(gateway(), {
      now: () => now,
      storage: memory.storage,
    })
    expect(restored.peekIntent('expiring-intent')).toBeNull()
    expect(memory.value()).toBeUndefined()
  })

  it('restores one pending resume after cold start and clears it after consumption', async () => {
    const memory = memoryAccessStorage()
    const ready = accessSnapshot({
      agreements: [],
      phoneBound: true,
      profile: { ...accessSnapshot().profile, complete: true, missingFields: [] },
    })
    const first = createMipIdentityModule(gateway(ready), {
      now: () => 30_000,
      token: () => 'pending-intent',
      storage: memory.storage,
    })
    const token = first.prepareProtectedAction({
      ...protectedIntent,
      source: { navigation: 'navigateBack' },
    })
    await first.complete(token)

    const restored = createMipIdentityModule(gateway(ready), {
      now: () => 30_001,
      storage: memory.storage,
    })
    expect(restored.consumePendingResume()).toEqual({
      action: 'REGISTER_EVENT',
      source: { navigation: 'navigateBack' },
    })
    expect(memory.value()).toBeUndefined()
  })

  it('keeps a safe navigate-back fallback route across a cold start', async () => {
    const memory = memoryAccessStorage()
    const first = createMipIdentityModule(gateway(), {
      now: () => 32_000,
      token: () => 'registration-intent',
      storage: memory.storage,
    })
    first.prepareProtectedAction({
      action: 'REGISTER_EVENT',
      source: {
        navigation: 'navigateBack',
        route: '/packages/member/mip-events/registration/index',
        query: {
          eventId: 'event-1',
          inviteRef: 'invite-ref-1',
          invitationToken: 'must-not-persist',
        },
      },
    })

    const restored = createMipIdentityModule(gateway(), {
      now: () => 32_001,
      storage: memory.storage,
    })
    expect(restored.peekIntent('registration-intent')).toMatchObject({
      source: {
        navigation: 'navigateBack',
        route: '/packages/member/mip-events/registration/index',
        query: { eventId: 'event-1', inviteRef: 'invite-ref-1' },
      },
    })
  })

  it('retains inviteRef through a persisted protected action and pending resume', async () => {
    const memory = memoryAccessStorage()
    const ready = accessSnapshot({
      agreements: [],
      phoneBound: true,
      profile: { ...accessSnapshot().profile, complete: true, missingFields: [] },
    })
    const first = createMipIdentityModule(gateway(ready), {
      now: () => 33_000,
      token: () => 'invite-intent',
      storage: memory.storage,
    })
    const token = first.prepareProtectedAction({
      action: 'REGISTER_EVENT',
      source: {
        navigation: 'navigateBack',
        route: '/packages/member/mip-events/registration/index',
        query: { eventId: 'event-1', inviteRef: 'invite-ref-2', invitationToken: 'signed-secret' },
      },
    })
    const restored = createMipIdentityModule(gateway(ready), {
      now: () => 33_001,
      storage: memory.storage,
    })
    expect(restored.peekIntent(token)?.source.query).toEqual({
      eventId: 'event-1',
      inviteRef: 'invite-ref-2',
    })
    await restored.complete(token)
    expect(restored.consumePendingResume()?.source.query).toEqual({
      eventId: 'event-1',
      inviteRef: 'invite-ref-2',
    })
  })

  it('clears a completed direct-return intent without persisting identity facts', async () => {
    const memory = memoryAccessStorage()
    const ready = accessSnapshot({ agreements: [] })
    const module = createMipIdentityModule(gateway(ready), {
      now: () => 35_000,
      token: () => 'global-complete',
      storage: memory.storage,
    })
    const token = module.prepareProtectedAction(createMipGlobalAccessIntent({
      path: 'pages/index/index',
    }))

    await expect(module.complete(token)).resolves.toMatchObject({
      navigation: 'reLaunch',
      route: '/pages/index/index',
    })
    expect(memory.value()).toBeUndefined()
  })
})

describe('MIP global access guard', () => {
  it('wires the guard to app lifecycle and removes unguarded exits from exempt pages', () => {
    const app = readFileSync(new URL('../src/app.ts', import.meta.url), 'utf8')
    const access = readFileSync(
      new URL('../src/packages/member/mip-access/index.ts', import.meta.url),
      'utf8',
    )
    const accessTemplate = readFileSync(
      new URL('../src/packages/member/mip-access/index.wxml', import.meta.url),
      'utf8',
    )
    const agreement = readFileSync(
      new URL('../src/packages/member/user-agreement/index.ts', import.meta.url),
      'utf8',
    )
    const privacyPolicy = readFileSync(
      new URL('../src/packages/member/privacy-policy/index.ts', import.meta.url),
      'utf8',
    )

    expect(app).toContain('onLaunch(options)')
    expect(app).toContain('onShow(options)')
    expect(app).toContain('mipGlobalAccessGuard.restore(options)')
    expect(access).toContain('context.navigation === \'reLaunch\'')
    expect(access).toContain('exitMipMiniProgram()')
    expect(accessTemplate).toContain('<app-page-exit managed')
    expect(accessTemplate).toContain('bind:exit="cancel"')
    expect(agreement).toContain('mipGlobalAccessGuard.leaveDocument()')
    expect(privacyPolicy).toContain('mipGlobalAccessGuard.leaveDocument()')
  })

  it('exempts access-control documents without exempting public pages', () => {
    expect(isMipGlobalAccessExemptRoute('/packages/member/mip-access/index')).toBe(true)
    expect(isMipGlobalAccessExemptRoute('packages/member/user-agreement/index')).toBe(true)
    expect(isMipGlobalAccessExemptRoute('/packages/member/privacy-policy/index')).toBe(true)
    expect(isMipGlobalAccessExemptRoute('/packages/admin/web-login-confirm/index')).toBe(true)
    expect(isMipGlobalAccessExemptRoute('/packages/member/privacy/index')).toBe(false)
    expect(isMipGlobalAccessExemptRoute('/pages/index/index')).toBe(false)
  })

  it('does not redirect while an agreement page is active', () => {
    const module = createMipIdentityModule(gateway())
    const reLaunch = vi.fn()
    const navigateBack = vi.fn()
    const guard = createMipGlobalAccessGuard(module, {
      currentPage: () => ({ path: 'packages/member/user-agreement/index' }),
      reLaunch,
      canNavigateBack: () => true,
      navigateBack,
    })

    expect(guard.ensureLaunch({ path: 'pages/index/index' })).toBe('EXEMPT')
    expect(reLaunch).not.toHaveBeenCalled()
    expect(guard.leaveDocument()).toBe('BACK')
    expect(navigateBack).toHaveBeenCalledOnce()
  })

  it('redirects a deep link to one durable gate intent until a snapshot is ready', async () => {
    const module = createMipIdentityModule(gateway(accessSnapshot({ agreements: [] })), {
      now: () => 40_000,
      token: () => 'global-intent',
    })
    const prepare = vi.spyOn(module, 'prepareProtectedAction')
    const reLaunch = vi.fn()
    const guard = createMipGlobalAccessGuard(module, {
      currentPage: () => undefined,
      reLaunch,
      canNavigateBack: () => false,
      navigateBack: vi.fn(),
    })
    const launch = {
      path: 'packages/member/mip-events/detail/index',
      query: { id: 'event-1', phone: '13800000000' },
    }

    expect(guard.ensureLaunch(launch)).toBe('READY')
    expect(guard.ensureLaunch(launch)).toBe('READY')
    expect(prepare).not.toHaveBeenCalled()
    expect(reLaunch).not.toHaveBeenCalled()

    await module.loadSnapshot()
    expect(guard.ensureLaunch(launch)).toBe('READY')
  })

  it('returns directly from an exempt document when the cached access snapshot is ready', async () => {
    const module = createMipIdentityModule(gateway(accessSnapshot({ agreements: [] })))
    await module.loadSnapshot()
    const reLaunch = vi.fn()
    const guard = createMipGlobalAccessGuard(module, {
      currentPage: () => ({ path: 'packages/member/user-agreement/index' }),
      reLaunch,
      canNavigateBack: () => false,
      navigateBack: vi.fn(),
    })

    expect(guard.enterTarget({
      path: 'packages/member/mip-events/detail/index',
      query: { id: 'event-1' },
    })).toBe('READY')
    expect(reLaunch).toHaveBeenCalledWith(
      '/packages/member/mip-events/detail/index?id=event-1',
    )
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
