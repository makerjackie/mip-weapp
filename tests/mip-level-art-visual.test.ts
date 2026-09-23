import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const read = (relativePath: string) => fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8')

describe('MIP level artwork presentation', () => {
  it('keeps profile level facts above the baked banner deco on the brand surface', () => {
    const markup = read('src/pages/profile/index.wxml')
    const styles = read('src/pages/profile/index.wxss')
    const bannerMarkup = read('src/components/mip-level-banner/index.wxml')
    const bannerStyles = read('src/components/mip-level-banner/index.wxss')

    // The profile delegates the level band to the baked-card component instead of
    // blending level-art.png itself (references/wechat-component-contracts.md).
    expect(markup).toContain('<mip-level-banner')
    expect(markup).toContain('level="{{levelName}}" current="{{experience}}" target="{{growthTarget}}"')
    expect(styles).not.toContain('profile-level-art')
    expect(bannerMarkup).toContain('src="/assets/mip/level-banner-deco@3x.png"')
    expect(bannerMarkup).toContain('mode="scaleToFill"')
    expect(bannerMarkup).toContain('{{level}}')
    expect(bannerMarkup).toContain('{{current}} / {{target}}')
    expect(bannerStyles).toContain('background: var(--color-brand);')
    expect(bannerStyles).toContain('border-radius: 32rpx 32rpx 0 0;')
    expect(bannerStyles).toContain('.mip-level-banner__base {')
  })

  it('uses the current baked growth hero without layering obsolete artwork', () => {
    const markup = read('src/packages/member/mip-growth/index.wxml')

    expect(markup).toContain('src="/packages/member/assets/figma/growth/hero-bg.webp"')
    expect(markup).not.toContain('growth-level-art')
    expect(markup).toContain('bg-brand px-5 py-6 text-on-brand')
    expect(markup).toContain('relative z-10')
  })
})
