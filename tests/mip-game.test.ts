import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createMipGameGateway } from '../src/modules/mip-game/gateway'

const seasonId = '10000000-0000-4000-8000-000000000001'
const teamAId = '20000000-0000-4000-8000-000000000001'
const teamBId = '20000000-0000-4000-8000-000000000002'

describe('MIP game client contract', () => {
  it('submits matchup intent without any client score', async () => {
    const calls: Array<{ action: string, data?: Record<string, unknown> }> = []
    const gateway = createMipGameGateway({
      async invoke(action, data) {
        calls.push({ action, data })
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
      action: 'admin.saveWeeklyMatch',
      data: {
        match: { seasonId, weekStart: '2026-08-24', weekEnd: '2026-08-30', teamAId, teamBId },
      },
    })
    expect(JSON.stringify(calls[0])).not.toMatch(/score|points/i)
  })

  it('generates a typed snapshot without a score or date range payload', async () => {
    const calls: Array<{ action: string, data?: Record<string, unknown> }> = []
    const gateway = createMipGameGateway({
      async invoke(action, data) {
        calls.push({ action, data })
        return { ok: true, data: { snapshotId: 'snapshot', rankingType: 'TEAM_HALF_YEAR', entryCount: 2, generatedAt: '' } }
      },
    })
    await gateway.generateRankingSnapshot(seasonId, 'TEAM_HALF_YEAR')
    expect(calls[0]).toEqual({
      action: 'admin.generateRankingSnapshot',
      data: { seasonId, rankingType: 'TEAM_HALF_YEAR' },
    })
  })

  it('uses a capability-protected action for admin ranking previews', async () => {
    const calls: Array<{ action: string, data?: Record<string, unknown> }> = []
    const gateway = createMipGameGateway({
      async invoke(action, data) {
        calls.push({ action, data })
        return { ok: true, data: { rankingType: 'TEAM_YEAR', generatedAt: '', branches: [], items: [] } }
      },
    })
    await gateway.listAdminRankings(seasonId, 'TEAM_YEAR')
    expect(calls[0]).toEqual({
      action: 'admin.listRankings',
      data: { seasonId, rankingType: 'TEAM_YEAR', branchId: undefined },
    })
  })

  it('keeps the full member and admin vertical slice in independently integrable files', () => {
    const root = process.cwd()
    for (const file of [
      'cloudfunctions/mip-game-api/index.js',
      'database/mysql/mip/029_gamification_foundation.sql',
      'database/mysql/mip/rollback/029_gamification_foundation.sql',
      'src/modules/mip-game/index.ts',
      'src/packages/member/mip-game/index.wxml',
      'src/packages/member/mip-game/team/index.wxml',
      'src/packages/admin/game/index.wxml',
    ]) {
      expect(fs.existsSync(path.join(root, file)), file).toBe(true)
    }
    const member = fs.readFileSync(path.join(root, 'src/packages/member/mip-game/index.wxml'), 'utf8')
    const team = fs.readFileSync(path.join(root, 'src/packages/member/mip-game/team/index.wxml'), 'utf8')
    const admin = fs.readFileSync(path.join(root, 'src/packages/admin/game/index.wxml'), 'utf8')
    expect(member).toContain('每周对阵')
    expect(member).toContain('历史对阵')
    expect(member).toContain('排行榜')
    expect(member).toContain('全部分会')
    expect(team).toContain('队伍大本营')
    expect(team).toContain('历史成员')
    expect(admin).toContain('新增赛季')
    expect(admin).toContain('生成排行榜')
    expect(admin).toContain('分数')
  })
})
