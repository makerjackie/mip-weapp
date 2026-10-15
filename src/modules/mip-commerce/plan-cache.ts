import type { CatalogStage, MembershipPlan } from './types'

const CACHE_VERSION = 1
const DEFAULT_MAX_STALE_MS = 7 * 24 * 60 * 60 * 1000
const CATALOG_STAGES = new Set<string>(['TEST', 'LIVE'])

export interface MembershipPlanCacheStorage {
  read: () => unknown
  write: (value: unknown) => void
  clear: () => void
}

// MIW-119：目录 stage 改为服务端裁决，缓存不再对照构建期烘焙值；
// 快照记录服务端声明的 stage，交叉校验「整份列表同 stage」一致性。
interface MembershipPlanCacheOptions {
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

function isCatalogStage(value: unknown): value is CatalogStage {
  return typeof value === 'string' && CATALOG_STAGES.has(value)
}

function isPlan(value: unknown, catalogStage: CatalogStage): value is MembershipPlan {
  if (!isRecord(value)) {
    return false
  }
  return typeof value.id === 'string'
    && Boolean(value.id)
    && value.catalogStage === catalogStage
    && typeof value.planKey === 'string'
    && Boolean(value.planKey)
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

// 服务端列表恒为单 stage（repository 按 catalog_stage 过滤）；
// 混 stage 或非法 stage 的载荷一律拒绝缓存。
function plansStage(plans: readonly MembershipPlan[]): CatalogStage | undefined {
  const stages = new Set(plans.map(plan => plan.catalogStage))
  if (stages.size !== 1) {
    return undefined
  }
  const stage = plans[0]?.catalogStage
  return isCatalogStage(stage) ? stage : undefined
}

export function createMembershipPlanCache(options: MembershipPlanCacheOptions = {}) {
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
      || !isCatalogStage(value.catalogStage)
      || !Number.isSafeInteger(value.cachedAt)
      || Number(value.cachedAt) > now()
      || now() - Number(value.cachedAt) > maxStaleMs
      || !Array.isArray(value.plans)) {
      if (value !== undefined && value !== '') {
        clear()
      }
      return
    }
    const catalogStage = value.catalogStage
    const plans = value.plans
    if (!plans.every(plan => isPlan(plan, catalogStage))) {
      clear()
      return
    }
    snapshot = {
      version: CACHE_VERSION,
      catalogStage,
      cachedAt: Number(value.cachedAt),
      plans: clonePlans(plans),
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

  function stage(): CatalogStage | undefined {
    hydrate()
    return snapshot?.catalogStage
  }

  // stage 取自服务端列表本身；空列表沿用现有快照 stage，便于覆写旧 stage 残留。
  function prime(plans: readonly MembershipPlan[]) {
    const catalogStage = plansStage(plans) ?? snapshot?.catalogStage
    if (!isCatalogStage(catalogStage)) {
      return []
    }
    const next: MembershipPlanCacheSnapshot = {
      version: CACHE_VERSION,
      catalogStage,
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

  return { clear, peek, prime, stage }
}

export type MembershipPlanCache = ReturnType<typeof createMembershipPlanCache>
