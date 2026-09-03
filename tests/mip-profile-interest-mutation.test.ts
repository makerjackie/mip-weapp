import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { MipOpportunityError } from '../src/modules/mip-opportunities/error'
import {
  createProfileInterestMutationStore,
  PROFILE_INTEREST_MUTATION_STORAGE_KEY,
} from '../src/modules/mip-opportunities/profile-interest-mutation'

const targetProfileRef = `p1.${'a'.repeat(16)}.${'b'.repeat(48)}.${'c'.repeat(22)}`
const opportunityId = '10000000-0000-4000-8000-000000000001'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, reject, resolve }
}

function memoryStorage(initial?: unknown) {
  let value = initial
  return {
    adapter: {
      read: () => value,
      write: (next: unknown) => { value = next },
      clear: () => { value = undefined },
    },
    read: () => value,
  }
}

function mutation(active: boolean, currentActive = false) {
  return {
    targetProfileRef,
    active,
    currentActive,
    source: { sourceType: 'OPPORTUNITY' as const, sourceId: opportunityId },
  }
}

describe('profile interest optimistic mutation', () => {
  it('persists and reuses one idempotency key while a result is unknown', async () => {
    const storage = memoryStorage()
    const keys: string[] = []
    const send = vi.fn(async (intent: { active: boolean, idempotencyKey: string }) => {
      keys.push(intent.idempotencyKey)
      if (keys.length === 1) {
        throw new MipOpportunityError('SERVICE_UNAVAILABLE', '暂时不可用', true, true)
      }
      return { active: intent.active, version: 1 }
    })
    const store = createProfileInterestMutationStore({
      send,
      storage: storage.adapter,
      createKey: () => 'profile-interest:stable-key',
    })

    expect(store.mutate(mutation(true))).toEqual({ active: true, pending: true })
    await store.flush()
    expect(storage.read()).toMatchObject({
      version: 1,
      entries: [{ inFlight: { idempotencyKey: 'profile-interest:stable-key' } }],
    })

    await store.flush()
    expect(keys).toEqual(['profile-interest:stable-key', 'profile-interest:stable-key'])
    expect(store.get(targetProfileRef)).toEqual({ active: true, pending: false })
    expect(storage.read()).toBeUndefined()
  })

  it('restores a pending request and reconciles it from a server read', () => {
    const storage = memoryStorage({
      version: 1,
      entries: [{
        targetProfileRef,
        confirmedActive: false,
        desiredActive: true,
        source: { sourceType: 'PROFILE', profileRef: targetProfileRef },
        inFlight: {
          sourceType: 'PROFILE',
          profileRef: targetProfileRef,
          active: true,
          idempotencyKey: 'profile-interest:restored-key',
          createdAt: 1_000,
        },
      }],
    })
    const store = createProfileInterestMutationStore({
      send: vi.fn(),
      storage: storage.adapter,
      now: () => 2_000,
    })

    expect(store.mergeServer(targetProfileRef, true)).toEqual({ active: true, pending: false })
    expect(storage.read()).toBeUndefined()
  })

  it('retries a restored request with the same key when a server read is still stale', async () => {
    const send = vi.fn(async (intent: { active: boolean }) => ({ active: intent.active, version: 1 }))
    const storage = memoryStorage({
      version: 1,
      entries: [{
        targetProfileRef,
        confirmedActive: false,
        desiredActive: true,
        source: { sourceType: 'PROFILE', profileRef: targetProfileRef },
        inFlight: {
          sourceType: 'PROFILE',
          profileRef: targetProfileRef,
          active: true,
          idempotencyKey: 'profile-interest:restored-key',
          createdAt: 1_000,
        },
      }],
    })
    const store = createProfileInterestMutationStore({
      send,
      storage: storage.adapter,
      now: () => 2_000,
    })

    expect(store.mergeServer(targetProfileRef, false)).toEqual({ active: true, pending: true })
    await store.flush()

    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      active: true,
      idempotencyKey: 'profile-interest:restored-key',
    }))
    expect(store.get(targetProfileRef)).toEqual({ active: true, pending: false })
  })

  it('rolls back a definite rejection but keeps an unknown result optimistic', async () => {
    const definite = createProfileInterestMutationStore({
      send: async () => {
        throw new MipOpportunityError('PHONE_REQUIRED', '请先绑定手机号', false, false)
      },
    })
    definite.mutate(mutation(true))
    await definite.flush()
    expect(definite.get(targetProfileRef)).toEqual({
      active: false,
      pending: false,
      error: { code: 'PHONE_REQUIRED', message: '请先绑定手机号' },
    })

    const unknown = createProfileInterestMutationStore({
      send: async () => {
        throw new MipOpportunityError('SERVICE_UNAVAILABLE', '暂时不可用', true, true)
      },
    })
    unknown.mutate(mutation(true))
    await unknown.flush()
    expect(unknown.get(targetProfileRef)).toEqual({ active: true, pending: true })
  })

  it('serializes a fast second tap and sends only the final follow-up state', async () => {
    const first = deferred<{ active: boolean, version: number }>()
    const calls: Array<{ active: boolean, idempotencyKey: string }> = []
    let keyIndex = 0
    const store = createProfileInterestMutationStore({
      createKey: () => `profile-interest:fast-${++keyIndex}`,
      send: vi.fn((intent: { active: boolean, idempotencyKey: string }) => {
        calls.push({ active: intent.active, idempotencyKey: intent.idempotencyKey })
        return calls.length === 1
          ? first.promise
          : Promise.resolve({ active: intent.active, version: 2 })
      }),
    })

    store.mutate(mutation(true))
    expect(store.mutate(mutation(false))).toEqual({ active: false, pending: true })
    expect(calls).toHaveLength(1)

    first.resolve({ active: true, version: 1 })
    await store.flush()

    expect(calls.map(call => call.active)).toEqual([true, false])
    expect(calls[0].idempotencyKey).not.toBe(calls[1].idempotencyKey)
    expect(store.get(targetProfileRef)).toEqual({ active: false, pending: false })
  })

  it('ignores an older completion after reset and clears persisted user state', async () => {
    const storage = memoryStorage()
    const request = deferred<{ active: boolean, version: number }>()
    const store = createProfileInterestMutationStore({
      storage: storage.adapter,
      createKey: () => 'profile-interest:logout-key',
      send: () => request.promise,
    })

    store.mutate(mutation(true))
    expect(storage.read()).toBeDefined()
    store.reset()
    request.resolve({ active: true, version: 1 })
    await request.promise
    await Promise.resolve()

    expect(store.get(targetProfileRef, false)).toEqual({ active: false, pending: false })
    expect(storage.read()).toBeUndefined()
    expect(PROFILE_INTEREST_MUTATION_STORAGE_KEY).toBe('mip:profile-interest-mutations:v1')
  })

  it('keeps every profile-interest surface on the shared optimistic path', () => {
    const surfaces = [
      ['../src/packages/member/mip-public-profile/index.ts', 'sourceType: \'PROFILE\''],
      ['../src/packages/member/mip-opportunities/detail/index.ts', 'sourceType: \'OPPORTUNITY\''],
      ['../src/packages/member/mip-cooperation/detail/index.ts', 'sourceType: \'COOPERATION_CARD\''],
      ['../src/packages/member/mip-cases/detail/index.ts', 'sourceType: \'SUPER_CASE\''],
    ] as const

    for (const [path, sourceType] of surfaces) {
      const source = readFileSync(new URL(path, import.meta.url), 'utf8')
      expect(source).toContain('profileInterestMutations.mutate({')
      expect(source).toContain(sourceType)
    }

    const publicProfileView = readFileSync(
      new URL('../src/packages/member/mip-public-profile/index.wxml', import.meta.url),
      'utf8',
    )
    const caseView = readFileSync(
      new URL('../src/packages/member/mip-cases/detail/index.wxml', import.meta.url),
      'utf8',
    )
    expect(publicProfileView).not.toContain('interestState === \'processing\'')
    expect(caseView).not.toContain('{{acting ? \'处理中\' : (item.interestActive')
  })
})
