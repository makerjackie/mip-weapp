import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('MIP growth', () => {
  it('renders the server-provided level facts and delegates details to the experience page', () => {
    const page = fs.readFileSync(path.join(process.cwd(), 'src/packages/member/mip-growth/index.wxml'), 'utf8')
    const controller = fs.readFileSync(path.join(process.cwd(), 'src/packages/member/mip-growth/index.ts'), 'utf8')
    // MIW-83：主页保留服务端等级事实（XP 余额、下一级门槛）；原三点等级刻度升级为
    // 权益差异档位横滑（相邻同权益合并为档，swiper 原生手指跟随，bindchange 联动权益区）；
    // 规则与流水仍收进独立经验值详情页，原「等级与权益/成长数据」展开区块保持移除。
    expect(page).toContain('XP: {{snapshot.account.experienceBalance}}')
    expect(page).toContain('{{nextLevelThreshold}}')
    expect(page).toContain('previous-margin="224rpx"')
    expect(page).toContain('wx:for="{{tiers}}"')
    expect(page).toContain('bindchange="onTierChange"')
    expect(controller).toContain('deriveTierStartIndexes(snapshot.levels)')
    expect(page).not.toContain('等级与权益')
    expect(page).not.toContain('成长规则')
    expect(page).not.toContain('wx:for="{{levels}}"')
    expect(page).not.toContain('experienceDetailsOpen')
  })
})
