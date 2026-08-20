import { createQueryCache } from '@weapp/shared/cache'
import { describe, expect, it, vi } from 'vitest'

describe('query cache', () => {
  it('reuses fresh values and refreshes stale values', async () => {
    let now = 1_000
    const loader = vi.fn(async () => `value-${loader.mock.calls.length}`)
    const cache = createQueryCache(100, () => now)

    await expect(cache.query('overview', loader)).resolves.toBe('value-1')
    await expect(cache.query('overview', loader)).resolves.toBe('value-1')
    now += 101
    await expect(cache.query('overview', loader)).resolves.toBe('value-2')
    expect(loader).toHaveBeenCalledTimes(2)
  })

  it('deduplicates concurrent requests', async () => {
    let resolveRequest: (value: string) => void = () => undefined
    const loader = vi.fn(() => new Promise<string>((resolve) => {
      resolveRequest = resolve
    }))
    const cache = createQueryCache()

    const first = cache.query('members:all', loader)
    const second = cache.query('members:all', loader)
    resolveRequest('ready')

    await expect(Promise.all([first, second])).resolves.toEqual(['ready', 'ready'])
    expect(loader).toHaveBeenCalledOnce()
  })

  it('supports forced refresh and prefix invalidation', async () => {
    const loader = vi.fn(async () => loader.mock.calls.length)
    const cache = createQueryCache()

    await cache.query('events:upcoming', loader)
    await cache.query('events:mine', loader)
    await cache.query('events:upcoming', loader, { force: true })
    expect(loader).toHaveBeenCalledTimes(3)

    cache.invalidate('events')
    expect(cache.peek('events:upcoming')).toBeUndefined()
    expect(cache.peek('events:mine')).toBeUndefined()
  })
})
