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
import { MipGameError } from '../src/modules/mip-game/types'

const seasonId = '10000000-0000-4000-8000-000000000001'
const teamAId = '20000000-0000-4000-8000-000000000001'
const teamBId = '20000000-0000-4000-8000-000000000002'
const catalogId = '30000000-0000-4000-8000-000000000001'
const drawRequestId = '40000000-0000-4000-8000-000000000001'

function opaquePart(index: number, length: number) {
  return index.toString(36).padStart(length, 'A')
}

function profileRef(index: number) {
  return `p1.${opaquePart(index, 16)}.${opaquePart(index, 48)}.${opaquePart(index, 22)}`
}

function candidateKey(index: number) {
  return `gmk1.${opaquePart(index, 43)}`
}

function memberCursor(index: number) {
  return `gm1.${opaquePart(index, 16)}.${opaquePart(index, 48)}.${opaquePart(index, 22)}`
}

function assignableMember(index: number, nickname = `玩家${String(index).padStart(4, '0')}`) {
  return {
    memberRef: profileRef(index),
    candidateKey: candidateKey(index),
    nickname,
    branchName: '',
    teamId: '',
    teamName: '',
    role: '' as const,
  }
}

describe('MIP game client contract', () => {
  it('submits matchup intent without any client score', async () => {
    const calls: MipGameRequest[] = []
    const gateway = createMipGameGateway({
      async invoke(request) {
        calls.push(request)
        return { ok: true, data: { id: 'match', status: 'SCHEDULED' } }
      },
    })
    await gateway.saveWeeklyMatch({
      seasonId,
      weekStart: '2026-08-24',
      weekEnd: '2026-08-30',
      teamAId,
      teamBId,
    })
    expect(calls[0]).toEqual({
      contractVersion: 1,
      action: 'admin.saveWeeklyMatch',
      input: {
        match: { seasonId, weekStart: '2026-08-24', weekEnd: '2026-08-30', teamAId, teamBId },
      },
    })
    expect(JSON.stringify(calls[0])).not.toMatch(/score|points/i)
  })

  it('generates a typed snapshot without a score or date range payload', async () => {
    const calls: MipGameRequest[] = []
    const gateway = createMipGameGateway({
      async invoke(request) {
        calls.push(request)
        return { ok: true, data: { snapshotId: 'snapshot', rankingType: 'TEAM_HALF_YEAR', entryCount: 2, generatedAt: '' } }
      },
    })
    await gateway.generateRankingSnapshot(seasonId, 'TEAM_HALF_YEAR')
    expect(calls[0]).toEqual({
      contractVersion: 1,
      action: 'admin.generateRankingSnapshot',
      input: { seasonId, rankingType: 'TEAM_HALF_YEAR' },
    })
  })

  it('uses a capability-protected action for admin ranking previews', async () => {
    const calls: MipGameRequest[] = []
    const gateway = createMipGameGateway({
      async invoke(request) {
        calls.push(request)
        return { ok: true, data: { rankingType: 'TEAM_YEAR', generatedAt: '', branches: [], items: [] } }
      },
    })
    await gateway.listAdminRankings(seasonId, 'TEAM_YEAR')
    expect(calls[0]).toEqual({
      contractVersion: 1,
      action: 'admin.listRankings',
      input: { seasonId, rankingType: 'TEAM_YEAR', branchId: undefined },
    })
  })

  it('keeps assignable-member pagination explicit in the neutral transport contract', async () => {
    const calls: MipGameRequest[] = []
    const gateway = createMipGameGateway({
      async invoke(request) {
        calls.push(request)
        return {
          ok: true,
          data: { items: [], hasMore: false, nextCursor: '', limit: 75, maxTeamMembers: 100 },
        }
      },
    })
    await gateway.listAssignableMembers(seasonId, '玩家', 'opaque-cursor', 75)
    expect(calls).toEqual([{
      contractVersion: 1,
      action: 'admin.listAssignableMembers',
      input: { seasonId, query: '玩家', cursor: 'opaque-cursor', limit: 75 },
    }])
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

  it('keeps blind-box configuration behind game.manage admin actions', async () => {
    const calls: MipGameRequest[] = []
    const gateway = createMipGameGateway({
      async invoke(request) {
        calls.push(request)
        return { ok: true, data: { items: [] } }
      },
    })
    await gateway.adminListBlindBoxCatalogs()
    await gateway.adminListBlindBoxCards(catalogId)
    expect(calls).toEqual([
      { contractVersion: 1, action: 'admin.listBlindBoxCatalogs', input: {} },
      { contractVersion: 1, action: 'admin.listBlindBoxCards', input: { catalogId } },
    ])
  })

  it('retries every read action and never retries draws or mutations', () => {
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
      'admin.getSession',
      'admin.listRankings',
      'admin.listSeasons',
      'admin.listTeams',
      'admin.listAssignableMembers',
      'admin.listMatches',
      'admin.listBlindBoxCatalogs',
      'admin.listBlindBoxCards',
    ] as const) {
      expect(isRetryableGameAction(action), action).toBe(true)
    }
    for (const action of [
      'drawBlindBox',
      'admin.saveSeason',
      'admin.changeSeasonStatus',
      'admin.saveTeam',
      'admin.replaceTeamMembers',
      'admin.saveWeeklyMatch',
      'admin.finalizeWeeklyMatch',
      'admin.generateRankingSnapshot',
      'admin.saveBlindBoxCatalog',
      'admin.changeBlindBoxCatalogStatus',
      'admin.saveBlindBoxCard',
      'admin.changeBlindBoxCardStatus',
    ] as const) {
      expect(isRetryableGameAction(action), action).toBe(false)
    }
  })

  it('invalidates only the successful mutation dependency', async () => {
    let seasonReads = 0
    let blindBoxReads = 0
    const gateway = {
      async listSeasons() {
        seasonReads += 1
        return { items: [] }
      },
      async listBlindBoxes() {
        blindBoxReads += 1
        return { coinBalance: 0, items: [] }
      },
      async saveSeason() {
        return { id: seasonId }
      },
      async drawBlindBox() {
        return { drawId: 'draw-1' }
      },
    } as unknown as MipGameGateway
    const module = createMipGameModule(gateway)

    await module.query.listSeasons()
    await module.query.listSeasons()
    await module.query.listBlindBoxes()
    await module.query.listBlindBoxes()
    expect({ blindBoxReads, seasonReads }).toEqual({ blindBoxReads: 1, seasonReads: 1 })

    await module.mutation.saveSeason({
      season: {
        seasonKey: 'season-1',
        name: '赛季',
        summary: '',
        rulesText: '规则',
        periodKind: 'HALF_YEAR',
        startsAt: '2026-01-01T00:00:00.000Z',
        endsAt: '2026-06-30T23:59:59.000Z',
      },
    })
    await module.query.listSeasons()
    await module.query.listBlindBoxes()
    expect({ blindBoxReads, seasonReads }).toEqual({ blindBoxReads: 1, seasonReads: 2 })

    await module.mutation.drawBlindBox(catalogId, drawRequestId)
    await module.query.listSeasons()
    await module.query.listBlindBoxes()
    expect({ blindBoxReads, seasonReads }).toEqual({ blindBoxReads: 2, seasonReads: 2 })
  })

  it('invalidates the cached admin ranking read after snapshot generation', async () => {
    let rankingReads = 0
    const gateway = {
      async listAdminRankings(_seasonId: string, rankingType: string, branchId?: string) {
        rankingReads += 1
        return {
          rankingType,
          generatedAt: `2026-08-25T0${rankingReads}:00:00.000Z`,
          branches: [{ id: 'branch-1', name: '深圳分会', cityName: '深圳' }],
          items: branchId ? [{ rank: 1, displayName: '测试队伍', score: rankingReads }] : [],
        }
      },
      async generateRankingSnapshot() {
        return {
          snapshotId: 'snapshot-1',
          rankingType: 'TEAM_HALF_YEAR',
          entryCount: 1,
          generatedAt: '2026-08-25T02:00:00.000Z',
        }
      },
    } as unknown as MipGameGateway
    const module = createMipGameModule(gateway)

    const first = await module.query.listAdminRankings(seasonId, 'TEAM_HALF_YEAR', 'branch-1')
    const cached = await module.query.listAdminRankings(seasonId, 'TEAM_HALF_YEAR', 'branch-1')
    expect({ first, cached, rankingReads }).toMatchObject({ rankingReads: 1 })

    await module.mutation.generateRankingSnapshot(seasonId, 'TEAM_HALF_YEAR')
    const refreshed = await module.query.listAdminRankings(seasonId, 'TEAM_HALF_YEAR', 'branch-1')
    expect(rankingReads).toBe(2)
    expect(refreshed.generatedAt).not.toBe(first.generatedAt)
  })

  it('loads every assignable-member cursor page before a roster can be replaced', async () => {
    const pageCalls: Array<{ cursor?: string, limit?: number }> = []
    const gateway = {
      async listAssignableMembers(
        _seasonId: string,
        _query?: string,
        cursor?: string,
        limit?: number,
      ) {
        pageCalls.push({ cursor, limit })
        return cursor
          ? { items: [assignableMember(101)], hasMore: false, nextCursor: '', limit: 100, maxTeamMembers: 100 }
          : {
              items: Array.from({ length: 100 }, (_, index) => assignableMember(index + 1)),
              hasMore: true,
              nextCursor: memberCursor(2),
              limit: 100,
              maxTeamMembers: 100,
            }
      },
    } as unknown as MipGameGateway
    const module = createMipGameModule(gateway)
    const result = await module.query.listAllAssignableMembers(seasonId, undefined, true)
    expect(result.items).toHaveLength(101)
    expect(result.items[0]?.memberRef).toBe(profileRef(1))
    expect(result.items[100]?.memberRef).toBe(profileRef(101))
    expect(result.maxTeamMembers).toBe(100)
    expect(pageCalls).toEqual([
      { cursor: undefined, limit: 100 },
      { cursor: memberCursor(2), limit: 100 },
    ])
  })

  it('fails visibly when an older roster endpoint omits the pagination contract', async () => {
    const gateway = {
      async listAssignableMembers() { return { items: [] } },
    } as unknown as MipGameGateway
    const module = createMipGameModule(gateway)
    await expect(module.query.listAllAssignableMembers(seasonId, undefined, true)).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
    })
  })

  it('rejects malformed and logically duplicated assignable-member pages', async () => {
    const malformed = createMipGameModule({
      async listAssignableMembers() {
        return {
          items: [{ ...assignableMember(1), memberRef: 'public-user-id' }],
          hasMore: false,
          nextCursor: '',
          limit: 100,
          maxTeamMembers: 100,
        }
      },
    } as unknown as MipGameGateway)
    await expect(
      malformed.query.listAllAssignableMembers(seasonId, undefined, true),
    ).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' })

    let page = 0
    const duplicated = createMipGameModule({
      async listAssignableMembers() {
        page += 1
        const items = Array.from({ length: 100 }, (_, index) => assignableMember(index + 1))
        if (page === 2) {
          items[0] = { ...assignableMember(101), candidateKey: candidateKey(1) }
        }
        return {
          items,
          hasMore: page === 1,
          nextCursor: page === 1 ? memberCursor(2) : '',
          limit: 100,
          maxTeamMembers: 100,
        }
      },
    } as unknown as MipGameGateway)
    await expect(
      duplicated.query.listAllAssignableMembers(seasonId, undefined, true),
    ).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' })
  })

  it('bounds endless unique member pages and sorts a completed list by nickname', async () => {
    let page = 0
    const endless = createMipGameModule({
      async listAssignableMembers() {
        page += 1
        return {
          items: Array.from(
            { length: 100 },
            (_, index) => assignableMember((page - 1) * 100 + index + 1),
          ),
          hasMore: true,
          nextCursor: memberCursor(page + 1),
          limit: 100,
          maxTeamMembers: 100,
        }
      },
    } as unknown as MipGameGateway)
    await expect(
      endless.query.listAllAssignableMembers(seasonId, undefined, true),
    ).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' })
    expect(page).toBe(50)

    const sorted = createMipGameModule({
      async listAssignableMembers() {
        return {
          items: [assignableMember(1, '周明'), assignableMember(2, '安然'), assignableMember(3, '安然')],
          hasMore: false,
          nextCursor: '',
          limit: 100,
          maxTeamMembers: 100,
        }
      },
    } as unknown as MipGameGateway)
    const result = await sorted.query.listAllAssignableMembers(seasonId, undefined, true)
    expect(result.items.map(item => item.memberRef)).toEqual([profileRef(2), profileRef(3), profileRef(1)])
  })

  it.each(['CONFLICT', 'FORBIDDEN'] as const)(
    'preserves %s mutation errors without clearing cached reads',
    async (code) => {
      let reads = 0
      const failure = new MipGameError(code, `${code} message`, code === 'CONFLICT')
      const gateway = {
        async listSeasons() {
          reads += 1
          return { items: [] }
        },
        async saveSeason() {
          throw failure
        },
      } as unknown as MipGameGateway
      const module = createMipGameModule(gateway)
      const input = {
        season: {
          seasonKey: 'season-1',
          name: '赛季',
          summary: '',
          rulesText: '规则',
          periodKind: 'HALF_YEAR' as const,
          startsAt: '2026-01-01T00:00:00.000Z',
          endsAt: '2026-06-30T23:59:59.000Z',
        },
      }

      await module.query.listSeasons()
      await expect(module.mutation.saveSeason(input)).rejects.toBe(failure)
      await module.query.listSeasons()
      expect(reads).toBe(1)
    },
  )

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

  it('keeps the full member and admin vertical slice in independently integrable files', () => {
    const root = process.cwd()
    for (const file of [
      'cloudfunctions/mip-game-api/index.js',
      'database/mysql/mip/029_gamification_foundation.sql',
      'database/mysql/mip/rollback/029_gamification_foundation.sql',
      'database/mysql/mip/035_mip_blind_box.sql',
      'database/mysql/mip/rollback/035_mip_blind_box.sql',
      'src/modules/mip-game/index.ts',
      'src/packages/member/mip-game/index.wxml',
      'src/packages/member/mip-game/team/index.wxml',
      'src/packages/admin/game/index.wxml',
      'src/packages/member/mip-blind-box/index.wxml',
      'src/packages/member/mip-blind-box/detail/index.wxml',
      'src/packages/member/mip-blind-box/backpack/index.wxml',
      'src/packages/member/mip-blind-box/coin-entries/index.wxml',
      'src/packages/admin/blind-box/index.wxml',
    ]) {
      expect(fs.existsSync(path.join(root, file)), file).toBe(true)
    }
    const member = fs.readFileSync(path.join(root, 'src/packages/member/mip-game/index.wxml'), 'utf8')
    const team = fs.readFileSync(path.join(root, 'src/packages/member/mip-game/team/index.wxml'), 'utf8')
    const admin = fs.readFileSync(path.join(root, 'src/packages/admin/game/index.wxml'), 'utf8')
    const adminPage = fs.readFileSync(path.join(root, 'src/packages/admin/game/index.ts'), 'utf8')
    const app = fs.readFileSync(path.join(root, 'src/app.json'), 'utf8')
    const discover = fs.readFileSync(path.join(root, 'src/pages/index/index.wxml'), 'utf8')
    const blindBoxDetail = fs.readFileSync(path.join(root, 'src/packages/member/mip-blind-box/detail/index.wxml'), 'utf8')
    const blindBoxAdmin = fs.readFileSync(path.join(root, 'src/packages/admin/blind-box/index.wxml'), 'utf8')
    const blindBoxDetailPage = fs.readFileSync(path.join(root, 'src/packages/member/mip-blind-box/detail/index.ts'), 'utf8')
    const pageSources = [
      'src/packages/admin/game/index.ts',
      'src/packages/admin/blind-box/index.ts',
      'src/packages/member/mip-game/index.ts',
      'src/packages/member/mip-game/team/index.ts',
      'src/packages/member/mip-blind-box/index.ts',
      'src/packages/member/mip-blind-box/detail/index.ts',
      'src/packages/member/mip-blind-box/backpack/index.ts',
      'src/packages/member/mip-blind-box/coin-entries/index.ts',
    ].map(file => fs.readFileSync(path.join(root, file), 'utf8'))
    const moduleSource = fs.readFileSync(path.join(root, 'src/modules/mip-game/module.ts'), 'utf8')
    const cloudbaseTransport = fs.readFileSync(path.join(root, 'src/modules/mip-game/cloudbase-gateway.ts'), 'utf8')
    const migration = fs.readFileSync(path.join(root, 'database/mysql/mip/035_mip_blind_box.sql'), 'utf8')
    const rollback = fs.readFileSync(path.join(root, 'database/mysql/mip/rollback/035_mip_blind_box.sql'), 'utf8')
    expect(member).toContain('每周对阵')
    expect(member).toContain('历史对阵')
    expect(member).toContain('排行榜')
    expect(member).toContain('全部分会')
    expect(team).toContain('队伍大本营')
    expect(team).toContain('历史成员')
    expect(admin).toContain('新增赛季')
    expect(admin).toContain('生成排行榜')
    expect(admin).toContain('分数')
    expect(admin).toContain('排行榜快照')
    expect(admin).toContain('生成时间：{{rankingGeneratedText}}')
    expect(admin).toContain('全部分会')
    expect(admin).toContain('mip-admin-record-list')
    expect(admin).toMatch(/rankingState === 'conflict'/)
    expect(adminPage).toMatch(/key: 'TEAM_HALF_YEAR', label: '团队半年榜'/)
    expect(adminPage).toMatch(/key: 'TEAM_YEAR', label: '团队年度榜'/)
    expect(adminPage).toMatch(/key: 'INDIVIDUAL_SEASON', label: '个人赛季榜'/)
    expect(adminPage).toMatch(/key: 'INDIVIDUAL_ALL_TIME', label: '个人累计榜'/)
    expect(adminPage).toContain('mipGameModule.query.listAdminRankings')
    expect(adminPage).toContain('mipGameModule.query.listAllAssignableMembers')
    expect(adminPage).toMatch(/requestKey !== this\.data\.memberRequestKey[\s\S]+currentTeam\?\.version !== team\.version/)
    expect(adminPage).toMatch(/generateRankingSnapshot[\s\S]+await this\.loadRanking\(true\)/)
    expect(app).toContain('mip-blind-box/detail/index')
    expect(app).toContain('blind-box/index')
    expect(discover).toContain('bind:tap="openBlindBoxes"')
    expect(blindBoxDetail).toContain('抽取盲盒')
    expect(blindBoxDetail).toContain('draw-stage--result')
    expect(blindBoxDetail).toContain('普通抽取概率')
    expect(blindBoxDetail).toContain('保底最低')
    expect(blindBoxDetailPage).toContain('mipGamePendingDrawStore.ensure')
    expect(blindBoxDetailPage).toContain('shouldRetainPendingDraw(error)')
    for (const source of pageSources) {
      expect(source).not.toContain('mipGameModule.gateway')
      expect(source).toContain('mipGameModule.query')
    }
    expect(pageSources.join('\n')).toContain('mipGameModule.mutation.drawBlindBox')
    expect(moduleSource).not.toMatch(/return\s*\{\s*gateway,/)
    expect(cloudbaseTransport).toContain('data: request')
    expect(cloudbaseTransport).not.toContain('{ action, ...data }')
    expect(blindBoxAdmin).toContain('概率权重')
    expect(blindBoxAdmin).toContain('总库存')
    expect(migration).toContain('mip_blind_box_draws')
    expect(migration).toContain('mip_blind_box_inventory')
    expect(migration).toContain('UNIQUE KEY mip_blind_box_draws_request_uk')
    expect(migration).toContain('card_name_snapshot')
    expect(migration).toContain('inventory_quantity_after')
    expect(migration).toContain('catalog_version_snapshot')
    expect(migration).toContain('pity_threshold_snapshot')
    expect(migration).toContain('pity_min_rarity_snapshot')
    expect(migration).toContain('random_roll')
    expect(rollback).toContain('mip_blind_box_rollback_guard')
    expect(rollback.indexOf('SELECT 1 FROM mip_blind_box_draws LIMIT 1'))
      .toBeLessThan(rollback.indexOf('DROP TABLE IF EXISTS mip_blind_box_draws'))
  })
})
