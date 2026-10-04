import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(path, 'utf8')

// MIW-24：嘉宾卡/人才卡统一业务组件契约。
// 勋章只接服务端佩戴口径，组件兜底最多 3 枚；邀请人必显两种形态：玩家（昵称+头像）、
// MIP 平台（平台名+平台系统头像）；玩家/平台判定规则在服务端，组件不判定。
describe('talent-card component contract', () => {
  const component = read('src/components/talent-card/index.ts')
  const template = read('src/components/talent-card/index.wxml')
  const styles = read('src/components/talent-card/index.wxss')

  it('caps worn medals at three without fabricating values', () => {
    expect(component).toContain('MAX_MEDALS = 3')
    expect(component).toContain('slice(0, MAX_MEDALS)')
    expect(component).toContain('medals: { type: Array, value: [] }')
    expect(template).toContain('mip-talent-card__medals')
  })

  it('keeps the horizontal talent shell for cooperation and people discovery', () => {
    expect(template).toContain('mip-talent-card__roles')
    expect(template).toContain('{{inviter.name}}邀请')
    expect(styles).toContain('.mip-talent-card__bottom')
  })

  it('renders the grid guest shell with corner and body slots for page-owned facts', () => {
    expect(template).toContain('layout === \'grid\'')
    expect(template).toContain('<slot name="corner" />')
    expect(template).toContain('<slot name="body" />')
    expect(styles).toContain('.mip-talent-card--grid')
    expect(styles).toContain('pointer-events: none')
    // 活动参与人卡（figma 1818_17230）头像是描边环；嘉宾/心动/访客卡（1732_19323）无环。
    expect(component).toContain('avatarRing: { type: Boolean, value: false }')
    expect(styles).toContain('.mip-talent-card__figure-avatar--ring')
    expect(component).toContain('leadLabel: { type: String, value: \'\' }')
    expect(component).toContain('statusText: { type: String, value: \'\' }')
  })

  it('shows the platform inviter with platform name and system avatar fallback', () => {
    expect(component).toContain('inviterKind: { type: String, value: \'PLAYER\' }')
    expect(component).toContain('PLATFORM_INVITER_NAME = \'MIP平台\'')
    expect(component).toContain('PLATFORM_INVITER_AVATAR = \'/assets/brand/mip-logo-yellow.png\'')
    expect(template).toContain('邀请人{{inviter.name}}')
  })

  it('falls back to target text only when no inviter is known', () => {
    const inviterBlocks = template.match(/wx:if="\{\{inviter\.name\}\}"/g) || []
    const targetBlocks = template.match(/wx:elif="\{\{targetText\}\}"/g) || []
    expect(inviterBlocks.length).toBe(2)
    expect(targetBlocks.length).toBe(2)
  })
})
