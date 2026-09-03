import type { CooperationCardPage } from '../src/modules/mip-cooperation'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cooperationModule } from '../src/modules/mip-cooperation'

const transportMocks = vi.hoisted(() => ({
  callOpportunityApi: vi.fn(),
}))

vi.mock('../src/modules/mip-opportunities/transport', () => transportMocks)

function page(): CooperationCardPage {
  return { items: [], nextCursor: 'next-page' }
}

describe('MIP cooperation first-page cache', () => {
  beforeEach(() => {
    cooperationModule.invalidateMine()
    transportMocks.callOpportunityApi.mockReset()
  })

  it('shares an in-flight request and exposes the completed page to the next page', async () => {
    let resolve!: (value: CooperationCardPage) => void
    transportMocks.callOpportunityApi.mockReturnValueOnce(new Promise<CooperationCardPage>((promiseResolve) => {
      resolve = promiseResolve
    }))

    const firstRequest = cooperationModule.listMine()
    const secondRequest = cooperationModule.listMine()

    expect(secondRequest).toBe(firstRequest)
    expect(transportMocks.callOpportunityApi).toHaveBeenCalledOnce()
    expect(cooperationModule.peekMine()).toBeUndefined()

    resolve(page())
    await firstRequest

    expect(cooperationModule.peekMine()).toEqual(page())
  })

  it('clears cached data after a successful card mutation', async () => {
    transportMocks.callOpportunityApi
      .mockResolvedValueOnce(page())
      .mockResolvedValueOnce({ id: 'card-1', status: 'PUBLISHED', version: 1 })

    await cooperationModule.listMine()
    expect(cooperationModule.peekMine()).toEqual(page())

    await cooperationModule.save({
      roleKey: 'strategist',
      positioning: '产品策划',
      targetSummary: '完成一个合作项目',
      roleFields: {
        planning_types: ['产品策划'],
        methods: '用户访谈',
        target: '完成一个项目',
      },
      abilityScores: {},
      publish: true,
    })

    expect(cooperationModule.peekMine()).toBeUndefined()
  })
})
