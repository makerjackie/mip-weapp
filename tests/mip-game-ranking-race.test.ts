import { beforeAll, describe, expect, it, vi } from 'vitest'

const rankings = vi.hoisted(() => vi.fn())
vi.mock('../src/modules/mip-game', () => ({ mipGameModule: { query: { listRankings: rankings } }, rankingTeamRoute: vi.fn() }))
let definition: Record<string, any>
beforeAll(async () => {
  vi.stubGlobal('Page', (page: Record<string, any>) => {
    definition = page
  })
  await import('../src/packages/member/mip-game/index')
  vi.unstubAllGlobals()
})
function deferred() {
  let resolve!: (value: unknown) => void
  const promise = new Promise((done) => {
    resolve = done
  })
  return { promise, resolve }
}
describe('game ranking selection', () => {
  it('keeps the latest tab response when a previous tab finishes later', async () => {
    const first = deferred()
    const last = deferred()
    rankings.mockReturnValueOnce(first.promise).mockReturnValueOnce(last.promise)
    const page = Object.assign(Object.create(definition), {
      data: structuredClone(definition.data),
      setData(patch: object) { Object.assign(this.data, patch) },
    })
    page.data.overview = { season: { id: 'season-1' } }
    const earlier = page.changeRanking({ currentTarget: { dataset: { type: 'INDIVIDUAL_SEASON' } } })
    const latest = page.changeRanking({ currentTarget: { dataset: { type: 'INDIVIDUAL_ALL_TIME' } } })
    expect(rankings).toHaveBeenCalledTimes(2)
    last.resolve({ items: [{ id: 'all-time-user', score: 1600 }], branches: [] })
    await latest
    first.resolve({ items: [{ id: 'season-user', score: 50 }], branches: [] })
    await earlier
    expect(page.data.rankingType).toBe('INDIVIDUAL_ALL_TIME')
    expect(page.data.rankings).toEqual([{ id: 'all-time-user', score: 1600 }])
    expect(page.data.loadingRanking).toBe(false)
  })
})
