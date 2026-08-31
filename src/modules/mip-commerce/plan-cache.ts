import type { CatalogStage, MembershipPlan } from './types'

const CACHE_VERSION = 1
const DEFAULT_MAX_STALE_MS = 7 * 24 * 60 * 60 * 1000

export interface MembershipPlanCacheStorage {
  read: () => unknown
  write: (value: unknown) => void
  clear: () => void
}

interface MembershipPlanCacheOptions {
  catalogStage: CatalogStage
  storage?: MembershipPlanCacheStorage
  maxStaleMs?: number
  now?: () => number
}

interface MembershipPlanCacheSnapshot {
  version: typeof CACHE_VERSION
  catalogStage: CatalogStage
  cachedAt: number
  plans: MembershipPlan[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isPlan(value: unknown, catalogStage: CatalogStage): value is MembershipPlan {
  if (!isRecord(value)) {
    return false
  }
  return typeof value.id === 'string'
    && Boolean(value.id)
    && typeof value.planKey === 'string'
    && Boolean(value.planKey)
    && value.catalogStage === catalogStage
    && typeof value.name === 'string'
    && Boolean(value.name)
    && (value.description === undefined || typeof value.description === 'string')
    && Number.isSafeInteger(value.durationDays)
    && Number(value.durationDays) > 0
    && Number.isSafeInteger(value.priceCents)
    && Number(value.priceCents) >= 0
    && value.currency === 'CNY'
    && Array.isArray(value.benefits)
    && value.benefits.every(item => typeof item === 'string')
    && value.status === 'ACTIVE'
    && Number.isSafeInteger(value.version)
    && Number(value.version) >= 1
}

function clonePlans(plans: readonly MembershipPlan[]): MembershipPlan[] {
  return plans.map(plan => ({ ...plan, benefits: [...plan.benefits] }))
}

export function createMembershipPlanCache(options: MembershipPlanCacheOptions) {
  const now = options.now || (() => Date.now())
  const maxStaleMs = options.maxStaleMs ?? DEFAULT_MAX_STALE_MS
  let hydrated = false
  let snapshot: MembershipPlanCacheSnapshot | undefined

  function clear() {
    snapshot = undefined
    hydrated = true
    try {
      options.storage?.clear()
    }
    catch {}
  }

  function hydrate() {
    if (hydrated) {
      return
    }
    hydrated = true
    if (!options.storage) {
      return
    }
    let value: unknown
    try {
      value = options.storage.read()
    }
    catch {
      return
    }
    if (!isRecord(value)
      || value.version !== CACHE_VERSION
      || value.catalogStage !== options.catalogStage
      || !Number.isSafeInteger(value.cachedAt)
      || Number(value.cachedAt) > now()
      || now() - Number(value.cachedAt) > maxStaleMs
      || !Array.isArray(value.plans)
      || !value.plans.every(plan => isPlan(plan, options.catalogStage))) {
      if (value !== undefined && value !== '') {
        clear()
      }
      return
    }
    snapshot = {
      version: CACHE_VERSION,
      catalogStage: options.catalogStage,
      cachedAt: Number(value.cachedAt),
      plans: clonePlans(value.plans),
    }
  }

  function peek(): MembershipPlan[] | undefined {
    hydrate()
    if (!snapshot) {
      return undefined
    }
    if (now() - snapshot.cachedAt > maxStaleMs) {
      clear()
      return undefined
    }
    return clonePlans(snapshot.plans)
  }

  function prime(plans: readonly MembershipPlan[]) {
    const next: MembershipPlanCacheSnapshot = {
      version: CACHE_VERSION,
      catalogStage: options.catalogStage,
      cachedAt: now(),
      plans: clonePlans(plans),
    }
    snapshot = next
    hydrated = true
    try {
      options.storage?.write(next)
    }
    catch {}
    return clonePlans(next.plans)
  }

  return { clear, peek, prime }
}

export type MembershipPlanCache = ReturnType<typeof createMembershipPlanCache>
