import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { mipOperationsConfig } from '../src/config/mip-operations'

const root = process.cwd()

describe('replaceable MIP operations configuration', () => {
  it('keeps support contacts and promotional content in one replaceable config', () => {
    expect(mipOperationsConfig.replaceBeforeProduction).toBe(true)
    expect(mipOperationsConfig.supportPhone).toBe('18819253403')
    expect(mipOperationsConfig).toHaveProperty('videoChannelFinderUserName')
    expect(mipOperationsConfig.homeBanner).toHaveProperty('imagePath')
    // MIW-49：超级案例 banner 统一品牌图，封面兜底配置随案例管理一起移除。
    expect(mipOperationsConfig).not.toHaveProperty('defaultCoverPaths')
    expect(mipOperationsConfig).not.toHaveProperty('eventBanners')
  })

  it('uses configured defaults without making them server-side facts', () => {
    const eventPage = fs.readFileSync(path.join(root, 'src/pages/events/index.ts'), 'utf8')
    const caseDetail = fs.readFileSync(path.join(root, 'src/packages/member/mip-cases/detail/index.ts'), 'utf8')
    const helpPage = fs.readFileSync(path.join(root, 'src/packages/member/help/index.ts'), 'utf8')
    const eventDetail = fs.readFileSync(path.join(root, 'src/packages/member/mip-events/detail/index.ts'), 'utf8')
    expect(eventPage).not.toContain('mipOperationsConfig.defaultCoverPaths.event')
    // MIW-49（figma 2704_13347 + 标注 2127_2198）：超级案例详情 banner 统一品牌图，不走封面兜底。
    expect(caseDetail).not.toContain('mipOperationsConfig')
    expect(helpPage).toMatch(/callSupport\(\)[\s\S]*mipOperationsConfig\.supportPhone[\s\S]*wx\.makePhoneCall/)
    expect(eventDetail).toMatch(/callSupport\(\)[\s\S]*const supportPhone = mipOperationsConfig\.supportPhone[\s\S]*wx\.makePhoneCall\(\{ phoneNumber: supportPhone \}\)/)
    expect(helpPage).not.toContain(mipOperationsConfig.supportPhone)
    expect(eventDetail).not.toContain(mipOperationsConfig.supportPhone)
    expect(helpPage).not.toMatch(/\bsupportPhone\s*:/)
    expect(eventDetail).not.toMatch(/\bsupportPhone\s*:/)
    expect(helpPage).toContain('wx.openChannelsUserProfile')
  })
})
