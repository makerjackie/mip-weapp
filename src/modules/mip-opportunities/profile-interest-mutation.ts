import type { OpportunityInteractionResult } from './types'
import { MipOpportunityError } from './error'
import { createMutationKey } from './validation'

export const PROFILE_INTEREST_MUTATION_STORAGE_KEY = 'mip:profile-interest-mutations:v1'

const STORAGE_VERSION = 1
const PENDING_LIFETIME_MS = 24 * 60 * 60 * 1000
const MAX_PENDING_ENTRIES = 50
const profileRefPattern = /^p1\.[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}$/
const resourceIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export type ProfileInterestSource
  = | { sourceType: 'PROFILE', profileRef: string }
    | { sourceType: 'OPPORTUNITY' | 'COOPERATION_CARD' | 'SUPER_CASE', sourceId: string }

export interface ProfileInterestMutationInput {
  targetProfileRef: string
  active: boolean
  currentActive: boolean
  source: ProfileInterestSource
}

export interface ProfileInterestMutationSnapshot {
  active: boolean
  pending: boolean
  error?: { code: string, message: string }
}

export interface ProfileInterestMutationStorage {
  read: () => unknown
  write: (value: unknown) => void
  clear: () => void
}

export type ProfileInterestMutationIntent = ProfileInterestSource & {
  active: boolean
  idempotencyKey: string
  createdAt: number
}

interface InterestEntry {
  targetProfileRef: string
  confirmedActive: boolean
  desiredActive: boolean
  source: ProfileInterestSource
  inFlight?: ProfileInterestMutationIntent
  error?: { code: string, message: string }
}

interface StoredInterestEntry {
  targetProfileRef: string
  confirmedActive: boolean
  desiredActive: boolean
  source: ProfileInterestSource
  inFlight: ProfileInterestMutationIntent
}

export interface ProfileInterestMutationOptions {
  send: (intent: ProfileInterestMutationIntent) => Promise<OpportunityInteractionResult>
  storage?: ProfileInterestMutationStorage
  now?: () => number
  createKey?: () => string
}

type Listener = (snapshot: ProfileInterestMutationSnapshot) => void

function validProfileRef(value: unknown): value is string {
  return typeof value === 'string'
    && value.length >= 20
    && value.length <= 200
    && profileRefPattern.test(value)
}

function validSource(value: unknown): value is ProfileInterestSource {
  if (!value || typeof value !== 'object') {
    return false
  }
  const source = value as Record<string, unknown>
  if (source.sourceType === 'PROFILE') {
    return validProfileRef(source.profileRef)
  }
  return ['OPPORTUNITY', 'COOPERATION_CARD', 'SUPER_CASE'].includes(String(source.sourceType))
    && typeof source.sourceId === 'string'
    && resourceIdPattern.test(source.sourceId)
}

function sameIntent(left: ProfileInterestMutationIntent | undefined, right: ProfileInterestMutationIntent): boolean {
  return left?.idempotencyKey === right.idempotencyKey
}

function publicError(error: unknown) {
  if (error instanceof MipOpportunityError) {
    return { code: error.code, message: error.message }
  }
  return { code: 'SERVICE_UNAVAILABLE', message: '机会服务暂时不可用，请稍后重试' }
}

export function createProfileInterestMutationStore(options: ProfileInterestMutationOptions) {
  const now = options.now || Date.now
  const createKey = options.createKey || (() => createMutationKey('profile-interest'))
  const entries = new Map<string, InterestEntry>()
  const listeners = new Map<string, Set<Listener>>()
  const activeDrains = new Map<string, Promise<void>>()
  let generation = 0

  function snapshot(entry: InterestEntry): ProfileInterestMutationSnapshot {
    return {
      active: entry.desiredActive,
      pending: Boolean(entry.inFlight) || entry.desiredActive !== entry.confirmedActive,
      ...(entry.error ? { error: { ...entry.error } } : {}),
    }
  }

  function emit(entry: InterestEntry) {
    const next = snapshot(entry)
    for (const listener of listeners.get(entry.targetProfileRef) || []) {
      try {
        listener(next)
      }
      catch {
        // A stale page listener must not interrupt persistence or mutation ordering.
      }
    }
  }

  function safeClearStorage() {
    try {
      options.storage?.clear()
    }
    catch {}
  }

  function persist() {
    if (!options.storage) {
      return
    }
    const pending = [...entries.values()]
      .filter((entry): entry is InterestEntry & { inFlight: ProfileInterestMutationIntent } => Boolean(entry.inFlight))
      .slice(-MAX_PENDING_ENTRIES)
      .map(entry => ({
        targetProfileRef: entry.targetProfileRef,
        confirmedActive: entry.confirmedActive,
        desiredActive: entry.desiredActive,
        source: entry.source,
        inFlight: entry.inFlight,
      }))
    if (!pending.length) {
      safeClearStorage()
      return
    }
    try {
      options.storage.write({ version: STORAGE_VERSION, entries: pending })
    }
    catch {}
  }

  function restore() {
    if (!options.storage) {
      return
    }
    let raw: unknown
    try {
      raw = options.storage.read()
    }
    catch {
      return
    }
    if (!raw || typeof raw !== 'object') {
      return
    }
    const stored = raw as { version?: unknown, entries?: unknown }
    if (stored.version !== STORAGE_VERSION || !Array.isArray(stored.entries)) {
      safeClearStorage()
      return
    }
    const currentTime = now()
    for (const value of stored.entries.slice(-MAX_PENDING_ENTRIES)) {
      if (!value || typeof value !== 'object') {
        continue
      }
      const item = value as Partial<StoredInterestEntry>
      const intent = item.inFlight
      if (!validProfileRef(item.targetProfileRef)
        || typeof item.confirmedActive !== 'boolean'
        || typeof item.desiredActive !== 'boolean'
        || !validSource(item.source)
        || !intent
        || !validSource(intent)
        || typeof intent.active !== 'boolean'
        || typeof intent.idempotencyKey !== 'string'
        || intent.idempotencyKey.length < 12
        || intent.idempotencyKey.length > 128
        || !Number.isInteger(intent.createdAt)
        || intent.createdAt > currentTime + 60_000
        || currentTime - intent.createdAt > PENDING_LIFETIME_MS) {
        continue
      }
      entries.set(item.targetProfileRef, {
        targetProfileRef: item.targetProfileRef,
        confirmedActive: item.confirmedActive,
        desiredActive: item.desiredActive,
        source: item.source,
        inFlight: intent,
      })
    }
    persist()
  }

  function ensureEntry(targetProfileRef: string, currentActive: boolean, source: ProfileInterestSource) {
    const existing = entries.get(targetProfileRef)
    if (existing) {
      existing.source = source
      return existing
    }
    const entry: InterestEntry = {
      targetProfileRef,
      confirmedActive: currentActive,
      desiredActive: currentActive,
      source,
    }
    entries.set(targetProfileRef, entry)
    return entry
  }

  function nextIntent(entry: InterestEntry): ProfileInterestMutationIntent {
    return {
      ...entry.source,
      active: entry.desiredActive,
      idempotencyKey: createKey(),
      createdAt: now(),
    }
  }

  async function runDrain(targetProfileRef: string, drainGeneration: number) {
    while (true) {
      if (drainGeneration !== generation) {
        return
      }
      const entry = entries.get(targetProfileRef)
      if (!entry) {
        return
      }
      if (!entry.inFlight) {
        if (entry.desiredActive === entry.confirmedActive) {
          persist()
          return
        }
        entry.inFlight = nextIntent(entry)
        persist()
      }
      const intent = entry.inFlight
      try {
        const result = await options.send(intent)
        if (drainGeneration !== generation) {
          return
        }
        const current = entries.get(targetProfileRef)
        if (!current || !sameIntent(current.inFlight, intent)) {
          return
        }
        if (typeof result?.active !== 'boolean' || result.active !== intent.active) {
          throw new MipOpportunityError('INVALID_RESPONSE', '机会服务返回了无效响应', true, true)
        }
        current.confirmedActive = result.active
        current.inFlight = undefined
        current.error = undefined
        emit(current)
        persist()
      }
      catch (error) {
        if (drainGeneration !== generation) {
          return
        }
        const current = entries.get(targetProfileRef)
        if (!current || !sameIntent(current.inFlight, intent)) {
          return
        }
        if (!(error instanceof MipOpportunityError) || error.resultUnknown) {
          persist()
          emit(current)
          return
        }
        current.inFlight = undefined
        if (current.desiredActive === intent.active) {
          current.desiredActive = current.confirmedActive
          current.error = publicError(error)
        }
        else {
          current.error = undefined
        }
        emit(current)
        persist()
      }
    }
  }

  function drain(targetProfileRef: string) {
    const running = activeDrains.get(targetProfileRef)
    if (running) {
      return running
    }
    const drainGeneration = generation
    const task = runDrain(targetProfileRef, drainGeneration).finally(() => {
      if (activeDrains.get(targetProfileRef) === task) {
        activeDrains.delete(targetProfileRef)
      }
    })
    activeDrains.set(targetProfileRef, task)
    return task
  }

  restore()

  return {
    get(targetProfileRef: string, currentActive = false): ProfileInterestMutationSnapshot {
      const entry = entries.get(targetProfileRef)
      return entry ? snapshot(entry) : { active: currentActive, pending: false }
    },

    mergeServer(targetProfileRef: string, active: boolean): ProfileInterestMutationSnapshot {
      if (!validProfileRef(targetProfileRef)) {
        throw new Error('INVALID_PROFILE_INTEREST_TARGET')
      }
      const entry = entries.get(targetProfileRef)
      if (!entry) {
        return { active, pending: false }
      }
      entry.confirmedActive = active
      entry.error = undefined
      if (!entry.inFlight) {
        entry.desiredActive = active
      }
      else if (!activeDrains.has(targetProfileRef) && entry.inFlight.active === active) {
        entry.inFlight = undefined
        if (entry.desiredActive !== active) {
          void drain(targetProfileRef)
        }
      }
      else if (!activeDrains.has(targetProfileRef)) {
        void drain(targetProfileRef)
      }
      emit(entry)
      persist()
      return snapshot(entry)
    },

    mutate(input: ProfileInterestMutationInput): ProfileInterestMutationSnapshot {
      if (!validProfileRef(input.targetProfileRef) || !validSource(input.source)) {
        throw new Error('INVALID_PROFILE_INTEREST_INTENT')
      }
      const entry = ensureEntry(input.targetProfileRef, input.currentActive, input.source)
      entry.desiredActive = input.active
      entry.source = input.source
      entry.error = undefined
      emit(entry)
      void drain(input.targetProfileRef)
      return snapshot(entry)
    },

    subscribe(targetProfileRef: string, listener: Listener) {
      const targetListeners = listeners.get(targetProfileRef) || new Set<Listener>()
      targetListeners.add(listener)
      listeners.set(targetProfileRef, targetListeners)
      return () => {
        targetListeners.delete(listener)
        if (!targetListeners.size) {
          listeners.delete(targetProfileRef)
        }
      }
    },

    async flush() {
      await Promise.all([...entries.values()]
        .filter(entry => entry.inFlight || entry.desiredActive !== entry.confirmedActive)
        .map(entry => drain(entry.targetProfileRef)))
    },

    reset() {
      generation += 1
      entries.clear()
      activeDrains.clear()
      safeClearStorage()
    },
  }
}

export type ProfileInterestMutationStore = ReturnType<typeof createProfileInterestMutationStore>
