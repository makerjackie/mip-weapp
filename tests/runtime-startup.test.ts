import { describe, expect, it, vi } from 'vitest'
import { RUNTIME_SERVICE_PORT_NOT_LISTENING_ERROR } from '../scripts/lib/runtime-preflight.mjs'
import {
  isRuntimeServicePortNotListeningError,
  prepareRuntimeDevtools,
} from '../scripts/lib/runtime-startup.mjs'

describe('runtime DevTools startup', () => {
  it('keeps the listening service-port path free of extra project opens', async () => {
    const result = { servicePort: 16816 }
    const preflight = vi.fn().mockResolvedValue(result)
    const warmProject = vi.fn()

    await expect(prepareRuntimeDevtools({ preflight, warmProject })).resolves.toEqual({
      preflight: result,
      projectPrewarmedBeforePreflight: false,
    })
    expect(preflight).toHaveBeenCalledTimes(1)
    expect(warmProject).not.toHaveBeenCalled()
  })

  it('opens the isolated host once before retrying a non-listening service port', async () => {
    const calls: string[] = []
    const result = { servicePort: 16816 }
    const preflight = vi.fn()
      .mockImplementationOnce(async () => {
        calls.push('preflight')
        throw new Error(RUNTIME_SERVICE_PORT_NOT_LISTENING_ERROR)
      })
      .mockImplementationOnce(async () => {
        calls.push('preflight')
        return result
      })
    const warmProject = vi.fn(async () => {
      calls.push('warm-project')
    })

    await expect(prepareRuntimeDevtools({ preflight, warmProject })).resolves.toEqual({
      preflight: result,
      projectPrewarmedBeforePreflight: true,
    })
    expect(calls).toEqual(['preflight', 'warm-project', 'preflight'])
    expect(warmProject).toHaveBeenCalledTimes(1)
  })

  it('does not open a project for disabled ports or unrelated preflight failures', async () => {
    for (const error of [
      new Error('WeChat DevTools service port is disabled.'),
      new Error('Runtime routes are incomplete.'),
    ]) {
      const warmProject = vi.fn()

      await expect(prepareRuntimeDevtools({
        preflight: vi.fn().mockRejectedValue(error),
        warmProject,
      })).rejects.toBe(error)
      expect(warmProject).not.toHaveBeenCalled()
    }
  })

  it('recognizes only the exact recoverable preflight failure', () => {
    expect(isRuntimeServicePortNotListeningError(
      new Error(RUNTIME_SERVICE_PORT_NOT_LISTENING_ERROR),
    )).toBe(true)
    expect(isRuntimeServicePortNotListeningError(new Error('service port error'))).toBe(false)
    expect(isRuntimeServicePortNotListeningError(RUNTIME_SERVICE_PORT_NOT_LISTENING_ERROR)).toBe(false)
  })
})
