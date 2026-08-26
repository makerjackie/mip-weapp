import { describe, expect, it, vi } from 'vitest'
import { observeRepresentativeState } from '../scripts/verify-runtime.mjs'

const loadingScenario = {
  id: 'loading',
  dataAssertions: [{ path: 'state', equals: 'loading' }],
  visibleAssertion: { selector: '#page #loading-state' },
}

describe('runtime representative state evidence', () => {
  it('requires route-only page data to bracket the rendered WXML observation', async () => {
    const routeOnly = { routeOnly: true }
    const page = {
      data: vi.fn()
        .mockResolvedValueOnce({ state: 'loading' })
        .mockResolvedValueOnce({ state: 'loading' }),
      renderedNodes: vi.fn().mockResolvedValue([{ id: 'loading-state' }]),
    }

    await expect(observeRepresentativeState(page, loadingScenario)).resolves.toEqual({
      data: { state: 'loading' },
      renderedNodeCount: 1,
    })
    expect(page.data).toHaveBeenNthCalledWith(1, undefined, routeOnly)
    expect(page.renderedNodes).toHaveBeenCalledWith('#page #loading-state', routeOnly)
    expect(page.data).toHaveBeenNthCalledWith(2, undefined, routeOnly)
    expect(page.data.mock.invocationCallOrder[0]).toBeLessThan(page.renderedNodes.mock.invocationCallOrder[0])
    expect(page.renderedNodes.mock.invocationCallOrder[0]).toBeLessThan(page.data.mock.invocationCallOrder[1])
  })

  it('rejects a visible node observed while an async response overwrites the target state', async () => {
    const page = {
      data: vi.fn()
        .mockResolvedValueOnce({ state: 'loading' })
        .mockResolvedValueOnce({ state: 'ready' }),
      renderedNodes: vi.fn().mockResolvedValue([{ id: 'loading-state' }]),
    }

    await expect(observeRepresentativeState(page, loadingScenario)).resolves.toBeNull()
  })

  it('rejects matching page data when the corresponding WXML node is not rendered', async () => {
    const page = {
      data: vi.fn()
        .mockResolvedValueOnce({ state: 'loading' })
        .mockResolvedValueOnce({ state: 'loading' }),
      renderedNodes: vi.fn().mockResolvedValue([]),
    }

    await expect(observeRepresentativeState(page, loadingScenario)).resolves.toBeNull()
  })
})
