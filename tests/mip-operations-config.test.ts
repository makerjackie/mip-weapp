import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { mipOperationsConfig } from '../src/config/mip-operations'

const root = process.cwd()

describe('replaceable MIP operations configuration', () => {
  it('keeps support contacts and promotional content in one replaceable config', () => {
    expect(mipOperationsConfig.replaceBeforeProduction).toBe(true)
    expect(mipOperationsConfig).toHaveProperty('supportPhone')
    expect(mipOperationsConfig).toHaveProperty('videoChannelFinderUserName')
    expect(mipOperationsConfig.homeBanner).toHaveProperty('imagePath')
    expect(mipOperationsConfig.defaultCoverPaths.event).toMatch(/^\/assets\//)
    expect(mipOperationsConfig.defaultCoverPaths.superCase).toMatch(/^\/assets\//)
  })

  it('uses configured defaults without making them server-side facts', () => {
    const eventPage = fs.readFileSync(path.join(root, 'src/pages/events/index.ts'), 'utf8')
    const caseDetail = fs.readFileSync(path.join(root, 'src/packages/member/mip-cases/detail/index.ts'), 'utf8')
    const helpPage = fs.readFileSync(path.join(root, 'src/packages/member/help/index.ts'), 'utf8')
    expect(eventPage).toContain('mipOperationsConfig.defaultCoverPaths.event')
    expect(caseDetail).toContain('mipOperationsConfig.defaultCoverPaths.superCase')
    expect(helpPage).toContain('wx.makePhoneCall')
    expect(helpPage).toContain('wx.openChannelsUserProfile')
  })
})
