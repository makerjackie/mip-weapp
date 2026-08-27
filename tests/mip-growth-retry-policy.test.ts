import type { MipGrowthTransport } from '../src/modules/mip-growth/cloudbase-gateway'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMipGrowthGateway } from '../src/modules/mip-growth/cloudbase-gateway'
import { resolveMipGrowthRetryOptions } from '../src/modules/mip-growth/retry-policy'
import { requireCloudClient } from '../src/modules/platform/cloudbase'

vi.mock('../src/modules/platform/cloudbase', () => ({
  requireCloudClient: vi.fn(),
}))

describe('MIP growth gateway retry policy', () => {
  afterEach(() => {
    vi.mocked(requireCloudClient).mockReset()
  })

  it('retries a declared read after a cold-start transport failure', async () => {
    vi.useFakeTimers()
    try {
      const snapshot = { source: 'server-snapshot' }
      const invoke = vi.fn()
        .mockRejectedValueOnce(new Error('cold start'))
        .mockResolvedValueOnce({ ok: true, data: snapshot })
      const gateway = createMipGrowthGateway('mip-growth-api', { invoke })

      const pending = gateway.getSnapshot()
      await vi.runAllTimersAsync()

      await expect(pending).resolves.toBe(snapshot)
      expect(invoke).toHaveBeenCalledTimes(2)
      expect(invoke).toHaveBeenNthCalledWith(1, 'getSnapshot', {})
      expect(invoke).toHaveBeenNthCalledWith(2, 'getSnapshot', {})
    }
    finally {
      vi.useRealTimers()
    }
  })

  it('does not replay equipBadges when the response is lost', async () => {
    let writes = 0
    const transport: MipGrowthTransport = {
      invoke: vi.fn(async () => {
        writes += 1
        throw new Error('response lost')
      }),
    }
    const gateway = createMipGrowthGateway('mip-growth-api', transport)

    await expect(gateway.equipBadges(['badge-1'], 4)).rejects.toMatchObject({
      name: 'MipGrowthError',
      code: 'SERVICE_UNAVAILABLE',
      retryable: true,
    })
    expect(writes).toBe(1)
    expect(transport.invoke).toHaveBeenCalledOnce()
    expect(transport.invoke).toHaveBeenCalledWith('equipBadges', {
      badgeIds: ['badge-1'],
      expectedVersion: 4,
    })
  })

  it('does not classify writes or unknown actions as retryable reads', () => {
    expect(resolveMipGrowthRetryOptions('getSnapshot').attempts).toBeGreaterThan(1)
    expect(resolveMipGrowthRetryOptions('listEntries').attempts).toBeGreaterThan(1)
    expect(resolveMipGrowthRetryOptions('listBadgeCollection').attempts).toBeGreaterThan(1)
    expect(resolveMipGrowthRetryOptions('equipBadges')).toEqual({ attempts: 1 })
    expect(resolveMipGrowthRetryOptions('futureUnknownAction')).toEqual({ attempts: 1 })
  })

  it('unwraps valid envelopes and preserves business errors without replay', async () => {
    const invoke = vi.fn()
      .mockResolvedValueOnce({ ok: true, data: { items: [], nextCursor: 'cursor-2' } })
      .mockResolvedValueOnce({
        ok: false,
        error: { code: 'CONFLICT', message: '成长记录正在处理', retryable: true },
      })
    const gateway = createMipGrowthGateway('mip-growth-api', { invoke })

    await expect(gateway.listEntries()).resolves.toEqual({ items: [], nextCursor: 'cursor-2' })
    await expect(gateway.listBadgeCollection()).rejects.toMatchObject({
      name: 'MipGrowthError',
      code: 'CONFLICT',
      message: '成长记录正在处理',
      retryable: true,
    })
    expect(invoke).toHaveBeenCalledTimes(2)
  })

  it('resolves CloudBase badge media before returning the collection', async () => {
    const fileId = 'cloud://mip-env/badges/player.png'
    const cloud = {
      callFunction: vi.fn().mockResolvedValue({
        result: { ok: true, data: { items: [{ id: 'badge-1', imageUrl: fileId }] } },
      }),
      getTempFileURL: vi.fn().mockResolvedValue({ fileList: [] }),
      downloadFile: vi.fn().mockResolvedValue({ tempFilePath: '/tmp/player-badge.png' }),
    }
    vi.mocked(requireCloudClient).mockResolvedValue(cloud as never)

    const gateway = createMipGrowthGateway()
    await expect(gateway.listBadgeCollection()).resolves.toEqual({
      items: [{ id: 'badge-1', imageUrl: '/tmp/player-badge.png' }],
    })
    expect(cloud.downloadFile).toHaveBeenCalledWith({ fileID: fileId })
  })
})
