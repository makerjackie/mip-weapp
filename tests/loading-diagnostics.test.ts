import { afterEach, describe, expect, it, vi } from 'vitest'
import { clearLoadingDiagnostics, getLoadingDiagnostics, measureLoading, recordLoadingFailure } from '../src/platform/cloudbase/loading-diagnostics'

describe('local loading diagnostics', () => {
  it('keeps error codes but excludes error messages and request data', () => {
    recordLoadingFailure('identity.response', { code: 'INTERNAL_ERROR', message: 'private SQL and phone', request: 'secret' })
    recordLoadingFailure('identity.request', { errMsg: 'cloud.callFunction:fail errCode: -504003 private details' })
    expect(getLoadingDiagnostics().map(sample => sample.errorCode)).toEqual(['INTERNAL_ERROR', '-504003'])
    expect(JSON.stringify(getLoadingDiagnostics())).not.toMatch(/private|secret|SQL|phone/)
  })
  afterEach(() => {
    clearLoadingDiagnostics()
    vi.restoreAllMocks()
  })

  it('separates stages, preserves errors and never retains response data', async () => {
    const now = vi.spyOn(Date, 'now')
    now
      .mockReturnValueOnce(100)
      .mockReturnValueOnce(160)
    await expect(measureLoading('events.request', async () => ({ privateData: 'excluded' })))
      .resolves
      .toEqual({ privateData: 'excluded' })
    const error = new Error('failed')
    now
      .mockReturnValueOnce(160)
      .mockReturnValueOnce(1160)
    await expect(measureLoading('media.download', async () => {
      throw error
    })).rejects.toBe(error)
    expect(getLoadingDiagnostics()).toEqual([
      { stage: 'events.request', startedAt: 100, durationMs: 60, succeeded: true },
      { stage: 'media.download', startedAt: 160, durationMs: 1000, succeeded: false },
    ])
  })

  it('bounds memory and exposes copies that cannot mutate recorded samples', async () => {
    for (let index = 0; index < 105; index += 1) {
      await measureLoading('events.request', async () => null)
    }
    const result = getLoadingDiagnostics()
    expect(result).toHaveLength(100)
    result[0].durationMs = -1
    expect(getLoadingDiagnostics()[0].durationMs).toBeGreaterThanOrEqual(0)
    clearLoadingDiagnostics()
    expect(getLoadingDiagnostics()).toEqual([])
  })
})
