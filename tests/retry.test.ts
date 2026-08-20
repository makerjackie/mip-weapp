import { retryTransport } from '@weapp/shared/retry'
import { describe, expect, it, vi } from 'vitest'

describe('transport retry', () => {
  it('recovers from a transient cold-start failure', async () => {
    const operation = vi.fn()
      .mockRejectedValueOnce(new Error('cloud handshake is warming up'))
      .mockResolvedValueOnce('ready')

    await expect(retryTransport(operation, { attempts: 3, delaysMs: [0, 0] })).resolves.toBe('ready')
    expect(operation).toHaveBeenCalledTimes(2)
  })

  it('stops after the configured attempt limit', async () => {
    const operation = vi.fn(async () => {
      throw new Error('offline')
    })

    await expect(retryTransport(operation, { attempts: 2, delaysMs: [0] })).rejects.toThrow('offline')
    expect(operation).toHaveBeenCalledTimes(2)
  })
})
