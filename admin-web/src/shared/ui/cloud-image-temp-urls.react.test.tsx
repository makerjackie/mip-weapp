import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AdminApiClient } from '../../services/admin-api'
import { useCloudImageTempUrls } from './cloud-image-temp-urls'

const id = 'cloud://test/content/a.png'
const html = `<p>介绍</p><img src="${id}">`
const url = 'https://images.example/a.png?sign=first'
const clientWith = (tempUrls: unknown) => ({ tempUrls }) as AdminApiClient
const flush = async () => { await act(async () => { await Promise.resolve() }) }
afterEach(() => { cleanup(); vi.useRealTimers() })

describe('rich text cloud image lifetime', () => {
  it('keeps an in-flight resolution while text changes with the same image IDs', async () => {
    let resolve!: (urls: Record<string, string>) => void
    const tempUrls = vi.fn(() => new Promise<Record<string, string>>(done => { resolve = done }))
    const client = clientWith(tempUrls)
    const { result, rerender } = renderHook(({ value }) => useCloudImageTempUrls(value, client, false), { initialProps: { value: html } })
    rerender({ value: `${html}<p>继续打字</p>` })
    await act(async () => { resolve({ [id]: url }) })
    expect(result.current[id]).toBe(url)
    expect(tempUrls).toHaveBeenCalledTimes(1)
  })

  it('refreshes before the 600-second signature expires without changing stored HTML', async () => {
    vi.useFakeTimers()
    const tempUrls = vi.fn().mockResolvedValueOnce({ [id]: url }).mockResolvedValue({ [id]: `${url}-renewed` })
    const client = clientWith(tempUrls)
    const { result } = renderHook(() => useCloudImageTempUrls(html, client, false))
    await flush()
    expect(result.current[id]).toBe(url)
    await act(async () => { await vi.advanceTimersByTimeAsync(8 * 60_000) })
    expect(result.current[id]).toBe(`${url}-renewed`)
    expect(tempUrls).toHaveBeenCalledTimes(2)
    expect(html).toContain(`src="${id}"`)
  })

  it('retries transient failures after a bounded delay', async () => {
    vi.useFakeTimers()
    const tempUrls = vi.fn().mockRejectedValueOnce(new Error('temporary')).mockResolvedValue({ [id]: url })
    const client = clientWith(tempUrls)
    const { result } = renderHook(() => useCloudImageTempUrls(html, client, false))
    await flush()
    expect(result.current).toEqual({})
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000) })
    expect(result.current[id]).toBe(url)
    expect(tempUrls).toHaveBeenCalledTimes(2)
  })

  it('ignores the old response when image references or session change', async () => {
    let oldResolve!: (urls: Record<string, string>) => void
    const first = clientWith(vi.fn(() => new Promise<Record<string, string>>(done => { oldResolve = done })))
    const second = clientWith(vi.fn(async () => ({ [id]: `${url}-new-session` })))
    const { result, rerender } = renderHook(({ client }) => useCloudImageTempUrls(html, client, false), { initialProps: { client: first } })
    rerender({ client: second }); await flush()
    await act(async () => { oldResolve({ [id]: url }) })
    expect(result.current[id]).toBe(`${url}-new-session`)
  })

  it('cleans timers on unmount and makes no requests in demo mode', async () => {
    vi.useFakeTimers()
    const tempUrls = vi.fn(async () => ({ [id]: url })), client = clientWith(tempUrls)
    const { rerender, unmount, result } = renderHook(({ demo }) => useCloudImageTempUrls(html, client, demo), { initialProps: { demo: false } })
    await flush(); rerender({ demo: true })
    expect(result.current).toEqual({}); unmount()
    await act(async () => { await vi.advanceTimersByTimeAsync(20 * 60_000) })
    expect(tempUrls).toHaveBeenCalledTimes(1)
  })
})
