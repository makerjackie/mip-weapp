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
    expect(markup).toContain('level="{{levelBannerText}}" current="{{experience}}" target="{{growthTarget}}"')
    // 昵称旁徽标与横幅同源，玩家态展示 Lv.数字而非等级名（MIW-51）。
    expect(markup).toContain('{{growthState === \'ready\' ? levelBannerText : membershipLabel}}')
    expect(styles).not.toContain('profile-level-art')
    expect(bannerMarkup).toContain('src="/assets/mip/level-banner-deco@3x.png"')
    expect(bannerMarkup).toContain('mode="scaleToFill"')
    expect(bannerMarkup).toContain('{{level}}')
    expect(bannerMarkup).toContain('{{current}} / {{target}}')
    expect(bannerStyles).toContain('background: var(--color-brand);')
    expect(bannerStyles).toContain('border-radius: 32rpx 32rpx 0 0;')
    expect(bannerStyles).toContain('.mip-level-banner__base {')
  })

  it('renders the unlock-now banner for non-player members instead of the copy card (MIW-81)', () => {
    const markup = read('src/pages/profile/index.wxml')

    // 嘉宾变体复用同一组件：等级位「立即解锁」、经验 0/100，整卡点击进会员页（openMembership）。
    expect(markup).toContain('wx:else class="profile-level-banner"')
    expect(markup).toContain('level="立即解锁"')
    expect(markup).toContain('current="{{0}}" target="{{100}}"')
    expect(markup).toContain('bind:tap="openMembership"')
    expect(markup).not.toContain('profile-membership-card')
    expect(markup).not.toContain('当前没有有效会员权益')
  })

  it('keeps the growth illustration proportional and the experience control accessible', () => {
    const markup = read('src/packages/member/mip-growth/index.wxml')

    expect(markup).toContain('src="/packages/member/assets/figma/growth/hero-character.png"')
    expect(markup).toContain('mode="aspectFit"')
    expect(markup).toContain('aria-label="经验值详情"')
    expect(markup).not.toContain('hero-bg.webp')
    expect(markup).toContain('bg-brand px-5 py-6 text-on-brand')
    expect(markup).toContain('relative z-10')
  })
})
