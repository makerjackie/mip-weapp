import type { MipGameGateway, MipGameRequest } from '../src/modules/mip-game/types'
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createMipGameGateway } from '../src/modules/mip-game/gateway'
import { createMipGameModule } from '../src/modules/mip-game/module'
import {
  createBlindBoxPendingDrawStore,
  shouldRetainPendingDraw,
} from '../src/modules/mip-game/pending-draw'
import { isRetryableGameAction } from '../src/modules/mip-game/retry-policy'

const seasonId = '10000000-0000-4000-8000-000000000001'
const teamAId = '20000000-0000-4000-8000-000000000001'
const teamBId = '20000000-0000-4000-8000-000000000002'
const catalogId = '30000000-0000-4000-8000-000000000001'
const drawRequestId = '40000000-0000-4000-8000-000000000001'

describe('MIP game client contract', () => {
  it('fails closed when overview or team reads return another requested context', async () => {
    const gateway = createMipGameGateway({
      async invoke(request) {
        if (request.action === 'getOverview') {
          return {
            ok: true,
            data: {
              season: { id: '10000000-0000-4000-8000-000000000002' },
              team: null,
              matches: [],
              standings: [],
            },
          }
        }
        return { ok: true, data: { id: teamBId } }
      },
    })
    await expect(gateway.getOverview(seasonId)).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' })
    await expect(gateway.getTeam(teamAId)).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' })
  })

  it('submits only a catalog and idempotency intent for a blind-box draw', async () => {
    const calls: MipGameRequest[] = []
    const gateway = createMipGameGateway({
      async invoke(request) {
        calls.push(request)
        return {
          ok: true,
          data: {
            drawId: '50000000-0000-4000-8000-000000000001',
            catalogId,
            card: { id: '60000000-0000-4000-8000-000000000001', name: '卡牌', summary: '', rarity: 'COMMON' },
            costCoin: 5,
            balanceAfter: 15,
            inventoryQuantity: 1,
            pityBefore: 0,
            pityAfter: 1,
            pityTriggered: false,
            drawnAt: '2026-08-25T00:00:00.000Z',
            idempotent: false,
          },
        }
      },
    })

    await gateway.drawBlindBox(catalogId, drawRequestId)
    expect(calls).toEqual([{
      contractVersion: 1,
      action: 'drawBlindBox',
      input: { catalogId, requestId: drawRequestId },
    }])
    expect(calls[0]?.input).not.toHaveProperty('costCoin')
    expect(calls[0]?.input).not.toHaveProperty('rarity')
    expect(calls[0]?.input).not.toHaveProperty('cardId')
  })

  it('retries player reads and never retries a draw', () => {
    for (const action of [
      'listBlindBoxes',
      'getBlindBox',
      'getBlindBoxInventory',
      'listBlindBoxCoinEntries',
      'getOverview',
      'getRules',
      'getTeam',
      'listHistory',
      'listRankings',
    ] as const) {
      expect(isRetryableGameAction(action), action).toBe(true)
    }
    expect(isRetryableGameAction('drawBlindBox')).toBe(false)
  })

  it('refreshes player blind-box data after a successful draw', async () => {
    let blindBoxReads = 0
    const gateway = {
      async listBlindBoxes() {
        blindBoxReads += 1
        return { coinBalance: 0, items: [] }
      },
      async drawBlindBox() {
        return { drawId: 'draw-1' }
      },
    } as unknown as MipGameGateway
    const module = createMipGameModule(gateway)

    await module.query.listBlindBoxes()
    await module.query.listBlindBoxes()
    expect(blindBoxReads).toBe(1)

    await module.mutation.drawBlindBox(catalogId, drawRequestId)
    await module.query.listBlindBoxes()
    expect(blindBoxReads).toBe(2)
  })

  it('persists one pending draw per user and catalog until a matching clear', () => {
    const values = new Map<string, unknown>()
    const store = createBlindBoxPendingDrawStore({
      read: key => values.get(key),
      write: (key, value) => values.set(key, value),
      clear: key => values.delete(key),
    })
    const userId = '10000000-0000-4000-8000-000000000009'
    const first = store.ensure(userId, catalogId, () => drawRequestId)
    const replay = store.ensure(userId, catalogId, () => '50000000-0000-4000-8000-000000000009')
    expect(replay).toBe(first)
    store.clear(userId, catalogId, '50000000-0000-4000-8000-000000000009')
    expect(store.read(userId, catalogId)).toBe(drawRequestId)
    store.clear(userId, catalogId, drawRequestId)
    expect(store.read(userId, catalogId)).toBe('')
    expect(shouldRetainPendingDraw({ code: 'SERVICE_UNAVAILABLE' })).toBe(true)
    expect(shouldRetainPendingDraw({ code: 'INSUFFICIENT_GAME_COIN_BALANCE' })).toBe(false)
  })

  it('keeps the member game and blind-box journeys visible', () => {
    const root = process.cwd()
    const member = fs.readFileSync(path.join(root, 'src/packages/member/mip-game/index.wxml'), 'utf8')
    const team = fs.readFileSync(path.join(root, 'src/packages/member/mip-game/team/index.wxml'), 'utf8')
    const blindBoxDetail = fs.readFileSync(path.join(root, 'src/packages/member/mip-blind-box/detail/index.wxml'), 'utf8')

    expect(member).toContain('每周对阵')
    expect(member).toContain('历史对阵')
    expect(member).toContain('排行榜')
    expect(member).toContain('全部分会')
    expect(team).toContain('队伍大本营')
    expect(team).toContain('历史成员')
    expect(blindBoxDetail).toContain('抽取盲盒')
    expect(blindBoxDetail).toContain('普通抽取概率')
    expect(blindBoxDetail).toContain('保底最低')
  })
})
