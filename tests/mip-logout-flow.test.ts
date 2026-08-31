import type { CheckInOutcome, CheckInScene, MipEventsGateway } from '../src/modules/mip-events'
import type {
  IdentityAccessSnapshot,
  MipIdentityAccessStorage,
  MipIdentityGateway,
} from '../src/modules/mip-identity'
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { createMipEventsModule, MipEventsError } from '../src/modules/mip-events'
import {
  clearMipLocalUserCaches,
  createMipIdentityModule,
  createMipLocalSessionController,
  registerMipLocalUserCache,
} from '../src/modules/mip-identity'
import { createQueryCache } from '../src/shared/cache'

function readySnapshot(): IdentityAccessSnapshot {
  return {
    authenticated: true,
    userVersion: 3,
    userStatus: 'ACTIVE',
    phoneBound: true,
    agreements: [],
    profile: {
      exists: true,
      version: 2,
      nickname: '测试用户',
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
      complete: true,
      missingFields: [],
    },
    membership: { kind: 'GUEST', source: 'NONE' },
    grants: [],
  }
}

function identityGateway() {
  const snapshot = readySnapshot()
  return {
    getAccessSnapshot: vi.fn(async () => snapshot),
    acceptAgreements: vi.fn(async () => snapshot),
    bindWechatPhone: vi.fn(async () => snapshot),
    closeAccount: vi.fn(),
    getProfile: vi.fn(async () => snapshot.profile),
    getPublicProfile: vi.fn(),
    updateProfile: vi.fn(async () => snapshot),
    listProfileTags: vi.fn(async () => []),
    listBranches: vi.fn(async () => []),
    setPrimaryBranch: vi.fn(),
  } as unknown as MipIdentityGateway & {
    getAccessSnapshot: ReturnType<typeof vi.fn>
    closeAccount: ReturnType<typeof vi.fn>
  }
}

function memoryStorage() {
  let value: unknown
  const storage = {
    read: vi.fn(() => structuredClone(value)),
    write: vi.fn((next: unknown) => {
      value = structuredClone(next)
    }),
    clear: vi.fn(() => {
      value = undefined
    }),
  } satisfies MipIdentityAccessStorage
  return { storage, value: () => structuredClone(value) }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

describe('MIP local logout flow', () => {
  it('persists an explicit signed-out boundary and clears protected actions without calling a remote logout', async () => {
    const gateway = identityGateway()
    const memory = memoryStorage()
    const identity = createMipIdentityModule(gateway, {
      storage: memory.storage,
      token: () => 'pending-action',
    })
    const token = identity.prepareProtectedAction({
      action: 'INTERACT',
      source: { navigation: 'navigateBack' },
    })
    await identity.complete(token)

    identity.signOutLocally()

    expect(identity.isSignedOut()).toBe(true)
    expect(identity.peekSnapshot()).toBeUndefined()
    expect(identity.peekIntent(token)).toBeNull()
    expect(identity.consumePendingResume()).toBeNull()
    expect(memory.value()).toEqual({
      version: 1,
      intents: [],
      pendingResume: undefined,
      signedOut: true,
    })
    expect(gateway.closeAccount).not.toHaveBeenCalled()

    const readsBeforeSignedOutRefresh = gateway.getAccessSnapshot.mock.calls.length
    await expect(identity.loadSnapshot()).resolves.toMatchObject({ authenticated: false })
    expect(gateway.getAccessSnapshot).toHaveBeenCalledTimes(readsBeforeSignedOutRefresh)
  })

  it('requires an explicit login action before refreshing the WeChat-backed session', async () => {
    const gateway = identityGateway()
    const memory = memoryStorage()
    const identity = createMipIdentityModule(gateway, {
      storage: memory.storage,
      token: () => 'login-action',
    })
    identity.signOutLocally()

    const restored = createMipIdentityModule(gateway, {
      storage: memory.storage,
      token: () => 'login-action',
    })
    const token = restored.prepareProtectedAction({
      action: 'ENTER_APP',
      source: { navigation: 'reLaunch', route: '/pages/index/index' },
    })
    const callsBeforeAccessPage = gateway.getAccessSnapshot.mock.calls.length

    await expect(restored.loadAccess(token)).resolves.toMatchObject({
      decision: { ready: false, block: 'AUTH_REQUIRED' },
      snapshot: { authenticated: false },
    })
    expect(gateway.getAccessSnapshot).toHaveBeenCalledTimes(callsBeforeAccessPage)

    await expect(restored.signIn(token)).resolves.toMatchObject({
      decision: { ready: true },
      snapshot: { authenticated: true, userStatus: 'ACTIVE' },
    })
    expect(restored.isSignedOut()).toBe(false)
    expect(gateway.getAccessSnapshot).toHaveBeenCalledTimes(callsBeforeAccessPage + 1)
  })

  it('clears revocable local session state while retaining durable recovery ids', () => {
    const keys = [
      'mip.identity.access-state.v1',
      'mip:event-check-in-resume:v1',
      'mip:event-check-in-resume:v2',
      'mip:admin-export-pending:v1',
      'mip:popup-message-presented:v1',
      'mip:blind-box-pending-draw:v1:10000000-0000-4000-8000-000000000001:20000000-0000-4000-8000-000000000001',
      'mip:internal:free-event-runtime-acceptance:v1',
      'unrelated-setting',
    ]
    const removed: string[] = []
    const identity = { signOutLocally: vi.fn() }
    const registeredCache = vi.fn()
    const unregister = registerMipLocalUserCache(registeredCache)
    const laterCache = vi.fn()
    const controller = createMipLocalSessionController(identity, {
      storage: {
        keys: () => keys,
        remove: key => removed.push(key),
      },
      clearUserCaches: [
        () => { throw new Error('cache unavailable') },
        laterCache,
      ],
    })

    controller.signOut()

    expect(identity.signOutLocally).toHaveBeenCalledOnce()
    expect(registeredCache).toHaveBeenCalledOnce()
    expect(laterCache).toHaveBeenCalledOnce()
    expect(removed).toEqual(keys.slice(1, 5))
    expect(removed).not.toContain('mip.identity.access-state.v1')
    expect(removed).not.toContain(keys[5])
    expect(removed).not.toContain('mip:internal:free-event-runtime-acceptance:v1')
    unregister()
  })

  it('does not repopulate an invalidated cache from an older in-flight user request', async () => {
    const cache = createQueryCache()
    let resolve!: (value: string) => void
    const pending = cache.query('private-profile', () => new Promise<string>((done) => {
      resolve = done
    }))

    cache.invalidate()
    resolve('old-user')

    await expect(pending).resolves.toBe('old-user')
    expect(cache.peek('private-profile')).toBeUndefined()
  })

  it('clears user-scoped caches after a successful phone identity migration', async () => {
    const clearMembership = vi.fn()
    const unregister = registerMipLocalUserCache(clearMembership)
    const identity = createMipIdentityModule(identityGateway(), {
      onIdentityBoundary: clearMipLocalUserCaches,
    })

    await identity.rebindWechatPhone('wechat-phone-code')

    expect(clearMembership).toHaveBeenCalledOnce()
    unregister()
  })

  it('rejects a check-in scene resolved after logout before a resume token can be saved', async () => {
    const response = deferred<CheckInScene>()
    const gateway = {
      resolveCheckInScene: vi.fn(() => response.promise),
    } as unknown as MipEventsGateway
    const events = createMipEventsModule(gateway)
    const pending = events.resolveCheckInScene('s1.aaaaaaaaaaa.bbbbbbbbbbb')

    events.invalidate()
    response.resolve({
      eventId: '60000000-0000-4000-8000-000000000001',
      resumeToken: `${'r'.repeat(20)}.${'s'.repeat(43)}`,
      validUntil: '2030-12-31T23:59:59.000Z',
    })

    await expect(pending).rejects.toMatchObject({ code: 'SESSION_ENDED' })
  })

  it('does not expose an old check-in recovery error after logout', async () => {
    const response = deferred<CheckInOutcome>()
    const gateway = {
      checkIn: vi.fn(() => response.promise),
    } as unknown as MipEventsGateway
    const events = createMipEventsModule(gateway)
    const pending = events.checkIn(`${'r'.repeat(20)}.${'s'.repeat(43)}`)

    events.invalidate()
    response.reject(new MipEventsError('REGISTRATION_REQUIRED', '请先完成报名'))

    await expect(pending).rejects.toMatchObject({ code: 'SESSION_ENDED' })
  })

  it('does not restore an authenticated identity snapshot from a request started before logout', async () => {
    let resolveSnapshot!: (snapshot: IdentityAccessSnapshot) => void
    const gateway = identityGateway()
    gateway.getAccessSnapshot.mockImplementationOnce(() => new Promise((resolve) => {
      resolveSnapshot = resolve
    }))
    const identity = createMipIdentityModule(gateway)

    const pending = identity.loadSnapshot()
    identity.signOutLocally()
    resolveSnapshot(readySnapshot())

    await expect(pending).resolves.toMatchObject({ authenticated: false })
    expect(identity.peekSnapshot()).toBeUndefined()
    expect(identity.isSignedOut()).toBe(true)
  })

  it('keeps a later logout authoritative when an explicit login request is still in flight', async () => {
    let resolveSnapshot!: (snapshot: IdentityAccessSnapshot) => void
    const gateway = identityGateway()
    gateway.getAccessSnapshot.mockImplementationOnce(() => new Promise((resolve) => {
      resolveSnapshot = resolve
    }))
    const identity = createMipIdentityModule(gateway, { token: () => 'login-race' })
    identity.signOutLocally()
    const token = identity.prepareProtectedAction({
      action: 'ENTER_APP',
      source: { navigation: 'reLaunch', route: '/pages/index/index' },
    })

    const pending = identity.signIn(token)
    identity.signOutLocally()
    resolveSnapshot(readySnapshot())

    await expect(pending).resolves.toMatchObject({
      decision: { ready: false, block: 'AUTH_REQUIRED' },
      snapshot: { authenticated: false },
    })
    expect(identity.peekSnapshot()).toBeUndefined()
    expect(identity.isSignedOut()).toBe(true)
  })

  it('does not restore identity from agreement acceptance started before logout', async () => {
    let resolveSnapshot!: (snapshot: IdentityAccessSnapshot) => void
    const gateway = identityGateway()
    vi.mocked(gateway.acceptAgreements).mockImplementationOnce(() => new Promise((resolve) => {
      resolveSnapshot = resolve
    }))
    const identity = createMipIdentityModule(gateway, { token: () => 'agreement-race' })
    const token = identity.prepareProtectedAction({
      action: 'ENTER_APP',
      source: { navigation: 'reLaunch', route: '/pages/index/index' },
    })

    const pending = identity.acceptAgreements(token, { agreements: [] })
    identity.signOutLocally()
    resolveSnapshot(readySnapshot())

    await expect(pending).resolves.toMatchObject({
      decision: { ready: false, block: 'AUTH_REQUIRED' },
      snapshot: { authenticated: false },
    })
    expect(identity.peekSnapshot()).toBeUndefined()
    expect(identity.isSignedOut()).toBe(true)
  })

  it('does not restore identity from phone binding started before logout', async () => {
    let resolveSnapshot!: (snapshot: IdentityAccessSnapshot) => void
    const gateway = identityGateway()
    vi.mocked(gateway.bindWechatPhone).mockImplementationOnce(() => new Promise((resolve) => {
      resolveSnapshot = resolve
    }))
    const identity = createMipIdentityModule(gateway, { token: () => 'phone-race' })
    const token = identity.prepareProtectedAction({
      action: 'ENTER_APP',
      source: { navigation: 'reLaunch', route: '/pages/index/index' },
    })

    const pending = identity.bindWechatPhone(token, 'wechat-phone-code')
    identity.signOutLocally()
    resolveSnapshot(readySnapshot())

    await expect(pending).resolves.toMatchObject({
      decision: { ready: false, block: 'AUTH_REQUIRED' },
      snapshot: { authenticated: false },
    })
    expect(identity.peekSnapshot()).toBeUndefined()
    expect(identity.isSignedOut()).toBe(true)
  })

  it('does not restore identity from profile update started before logout', async () => {
    let resolveSnapshot!: (snapshot: IdentityAccessSnapshot) => void
    const gateway = identityGateway()
    vi.mocked(gateway.updateProfile).mockImplementationOnce(() => new Promise((resolve) => {
      resolveSnapshot = resolve
    }))
    const identity = createMipIdentityModule(gateway, { token: () => 'profile-race' })
    const token = identity.prepareProtectedAction({
      action: 'EDIT_PROFILE',
      source: { navigation: 'navigateBack' },
    })

    const pending = identity.updateProfile(
      token,
      {} as Parameters<typeof identity.updateProfile>[1],
    )
    identity.signOutLocally()
    resolveSnapshot(readySnapshot())

    await expect(pending).resolves.toMatchObject({
      decision: { ready: false, block: 'AUTH_REQUIRED' },
      snapshot: { authenticated: false },
    })
    expect(identity.peekSnapshot()).toBeUndefined()
    expect(identity.isSignedOut()).toBe(true)
  })

  it('does not clear a later local logout when account closure finishes afterward', async () => {
    const closureResult = {
      status: 'CLOSED' as const,
      version: 4,
      closedAt: '2026-08-26T00:00:00.000Z',
      idempotent: false,
    }
    let resolveClosure!: (value: typeof closureResult) => void
    const gateway = identityGateway()
    gateway.closeAccount.mockImplementationOnce(() => new Promise((resolve) => {
      resolveClosure = resolve
    }))
    const identity = createMipIdentityModule(gateway)

    const pending = identity.closeAccount({
      confirmationPhrase: '确认注销账号',
      expectedVersion: 3,
      idempotencyKey: 'identity-close-request-1',
    })
    identity.signOutLocally()
    resolveClosure(closureResult)

    await expect(pending).resolves.toEqual(closureResult)
    expect(identity.isSignedOut()).toBe(true)
    expect(identity.peekSnapshot()).toBeUndefined()
  })

  it('keeps cancellation local and exposes logout through the existing profile account entry', () => {
    const privacy = readFileSync(
      new URL('../src/packages/member/privacy/index.ts', import.meta.url),
      'utf8',
    )
    const privacyTemplate = readFileSync(
      new URL('../src/packages/member/privacy/index.wxml', import.meta.url),
      'utf8',
    )
    const access = readFileSync(
      new URL('../src/packages/member/mip-access/index.ts', import.meta.url),
      'utf8',
    )
    const accessTemplate = readFileSync(
      new URL('../src/packages/member/mip-access/index.wxml', import.meta.url),
      'utf8',
    )
    const profile = readFileSync(
      new URL('../src/pages/profile/index.ts', import.meta.url),
      'utf8',
    )
    const messagingClient = readFileSync(
      new URL('../src/modules/mip-messaging/client.ts', import.meta.url),
      'utf8',
    )
    const cloudMedia = readFileSync(
      new URL('../src/modules/platform/cloud-media.ts', import.meta.url),
      'utf8',
    )

    expect(privacy).toContain('title: \'退出登录\'')
    expect(privacy.indexOf('if (!confirmed?.confirm)')).toBeLessThan(
      privacy.indexOf('mipLocalSession.signOut()'),
    )
    expect(privacyTemplate).toContain('bind:tap="signOutLocally"')
    expect(privacyTemplate).toContain('不会删除账号或业务记录')
    expect(profile).toContain('\'/packages/member/privacy/index\'')
    expect(access).toContain('mipIdentityModule.signIn(this.data.token)')
    expect(accessTemplate).toContain('id="mip-access-sign-in"')
    expect(accessTemplate).toContain('bind:tap="signIn"')
    expect(accessTemplate).toContain('>微信登录</t-button>')
    expect(messagingClient).toContain('registerMipLocalUserCache(() => {')
    expect(messagingClient).toContain('mipMessagingModule.invalidate()')
    expect(messagingClient).toContain('mipPopupMessagePresenter.invalidate()')
    expect(cloudMedia).toContain('registerMipLocalUserCache(clearCloudMediaCache)')
  })
})
