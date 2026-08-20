interface CacheEntry<T> {
  value?: T
  updatedAt: number
  pending?: Promise<T>
}

export interface QueryOptions {
  force?: boolean
  maxAgeMs?: number
}

export function createQueryCache(defaultMaxAgeMs = 30_000, now = () => Date.now()) {
  const entries = new Map<string, CacheEntry<unknown>>()

  function peek<T>(key: string): T | undefined {
    return entries.get(key)?.value as T | undefined
  }

  function prime<T>(key: string, value: T) {
    entries.set(key, { value, updatedAt: now() })
    return value
  }

  async function query<T>(key: string, loader: () => Promise<T>, options: QueryOptions = {}) {
    const entry = entries.get(key) as CacheEntry<T> | undefined
    const maxAgeMs = options.maxAgeMs ?? defaultMaxAgeMs
    if (!options.force && entry?.value !== undefined && now() - entry.updatedAt < maxAgeMs) {
      return entry.value
    }
    if (entry?.pending) {
      return entry.pending
    }
    const pending = loader()
      .then(value => prime(key, value))
      .finally(() => {
        const current = entries.get(key)
        if (current?.pending === pending) {
          current.pending = undefined
        }
      })
    entries.set(key, { value: entry?.value, updatedAt: entry?.updatedAt || 0, pending })
    return pending
  }

  function invalidate(prefix?: string) {
    if (!prefix) {
      entries.clear()
      return
    }
    for (const key of entries.keys()) {
      if (key === prefix || key.startsWith(`${prefix}:`)) {
        entries.delete(key)
      }
    }
  }

  return { invalidate, peek, prime, query }
}
