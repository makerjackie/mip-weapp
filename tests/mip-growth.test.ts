import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('MIP growth', () => {
  it('renders the complete server-provided level and active reward facts', () => {
    const page = fs.readFileSync(path.join(process.cwd(), 'src/packages/member/mip-growth/index.wxml'), 'utf8')
    const controller = fs.readFileSync(path.join(process.cwd(), 'src/packages/member/mip-growth/index.ts'), 'utf8')
    expect(page).toContain('等级与权益')
    expect(page).toContain('wx:for="{{levels}}"')
    expect(page).toContain('成长规则')
    expect(page).toContain('wx:for="{{earningRules}}"')
    expect(controller).toContain('snapshot.levels.map')
    expect(controller).toContain('snapshot.earningRules.map')
    expect(page).toContain('游戏币')
    expect(page).toContain('snapshot.account.coinBalance')
  })
})
