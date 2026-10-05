import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('MIP growth', () => {
  it('renders the server-provided level facts and delegates details to the experience page', () => {
    const page = fs.readFileSync(path.join(process.cwd(), 'src/packages/member/mip-growth/index.wxml'), 'utf8')
    const controller = fs.readFileSync(path.join(process.cwd(), 'src/packages/member/mip-growth/index.ts'), 'utf8')
    // MIW-27：主页保留服务端等级事实（EXP 余额、下一级门槛、三点等级刻度）；
    // 规则与流水收进独立经验值详情页，原「等级与权益/成长数据」展开区块随展开交互移除。
    expect(page).toContain('EXP: {{snapshot.account.experienceBalance}}')
    expect(page).toContain('{{nextLevelThreshold}}')
    expect(page).toContain('{{levelScale.centerText}}')
    expect(controller).toContain('levelScaleView(snapshot.levels, currentLevelNumber)')
    expect(page).not.toContain('等级与权益')
    expect(page).not.toContain('成长规则')
    expect(page).not.toContain('wx:for="{{levels}}"')
    expect(page).not.toContain('experienceDetailsOpen')
  })
})
