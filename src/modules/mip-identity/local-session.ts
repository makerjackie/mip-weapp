export const MIP_LOCAL_USER_STORAGE_KEYS = [
  'mip:admin-export-pending:v1',
  'mip:event-check-in-resume:v1',
  'mip:event-check-in-resume:v2',
  'mip:profile-interest-mutations:v1',
  'mip:popup-message-presented:v1',
] as const

export interface MipLocalSessionStorage {
  keys: () => string[]
  remove: (key: string) => void
}

export interface MipLocalSessionIdentity {
  signOutLocally: () => void
}

export interface MipLocalSessionOptions {
  storage: MipLocalSessionStorage
  clearUserCaches?: Array<() => void>
}

const cacheRegistryKey = '__mipLocalUserCacheClearers'
const moduleCacheRegistry = new Set<() => void>()

function cacheRegistry(): Set<() => void> {
  try {
    const app = getApp() as { globalData?: Record<string, unknown> }
    if (!app?.globalData) {
      return moduleCacheRegistry
    }
    const existing = app.globalData[cacheRegistryKey]
    const shared = existing instanceof Set ? existing as Set<() => void> : new Set<() => void>()
    for (const clear of moduleCacheRegistry) {
      shared.add(clear)
    }
    moduleCacheRegistry.clear()
    app.globalData[cacheRegistryKey] = shared
    return shared
  }
  catch {
    return moduleCacheRegistry
  }
}

export function registerMipLocalUserCache(clear: () => void) {
  cacheRegistry().add(clear)
  return () => cacheRegistry().delete(clear)
}

export function clearMipLocalUserCaches() {
  for (const clear of cacheRegistry()) {
    try {
      clear()
    }
    catch {
      // One optional cache must not prevent the identity boundary from taking effect.
    }
  }
}

export function isMipLocalUserStorageKey(key: string): boolean {
  return MIP_LOCAL_USER_STORAGE_KEYS.includes(
    key as (typeof MIP_LOCAL_USER_STORAGE_KEYS)[number],
  )
}

export function createMipLocalSessionController(
  identity: MipLocalSessionIdentity,
  options: MipLocalSessionOptions,
) {
  return {
    signOut() {
      identity.signOutLocally()

      clearMipLocalUserCaches()
      for (const clear of options.clearUserCaches || []) {
        try {
          clear()
        }
        catch {
          // One optional cache must not prevent the signed-out boundary from taking effect.
        }
      }

      let keys: string[] = []
      try {
        keys = options.storage.keys()
      }
      catch {}
      for (const key of keys) {
        if (!isMipLocalUserStorageKey(key)) {
          continue
        }
        try {
          options.storage.remove(key)
        }
        catch {}
      }
    },
  }
}

export type MipLocalSessionController = ReturnType<typeof createMipLocalSessionController>
