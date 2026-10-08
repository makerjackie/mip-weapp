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

  // MIW-58 横版人才合作卡（figma 1768_37534 字段重排 + 最新稿对齐）：名称+Lv+≤3 勋章 +
  // 三标签行（城市 | 代表行业 | 身份状态，24rpx 灰）+ 一句话介绍（≤2 行）；下板左角色
  // 黄色小标签、右邀请人（{昵称}邀请 黄字+头像，玩家/平台判定在服务端，组件不区分）。
  it('keeps the horizontal talent shell with the reworked cooperation fields', () => {
    expect(template).toContain('mip-talent-card__name-row')
    expect(template).toContain('mip-talent-card__level')
    expect(template).toContain('mip-talent-card__tags')
    expect(template).toContain('mip-talent-card__tag-divider')
    expect(template).toContain('wx:elif="{{metaText}}"')
    expect(template).toContain('mip-talent-card__supporting')
    expect(template).toContain('mip-talent-card__roles')
    expect(template).toContain('mip-talent-card__bottom')
    expect(template).not.toContain('roleTags')
    expect(template).not.toContain('mip-talent-card__kind')
    // 角色只渲染后台配置名（黄色小标签，狗 icon 暂不做）；一句话介绍两行截断。
    expect(template).toContain('wx:for="{{roleNames}}"')
    expect(styles).toContain('-webkit-line-clamp: 2')
    expect(styles).toContain('background: var(--color-tag-player)')
    // 最新稿（1768:37534）：三标签行 24rpx 灰（#b3b3b3），城市标签不带 MIP 后缀由调用方裁剪。
    expect(styles).toMatch(/\.mip-talent-card__tag\s*\{[^}]*font-size: 24rpx;[^}]*color: var\(--color-muted\);/)
    expect(styles).toMatch(/\.mip-talent-card__tag-divider\s*\{[^}]*background: var\(--color-muted\);/)
  })

  it('renders the horizontal inviter as a yellow suffix while the grid keeps its prefix', () => {
    // 横版（1768_37534）：{昵称}邀请 品牌黄；竖版 grid（1732_19323）沿用「邀请人」前缀白字。
    expect(template).toContain('{{inviter.name}}邀请')
    expect(template).toContain('邀请人{{inviter.name}}')
    expect(template).not.toContain('inviter.platform')
    expect(styles).toMatch(/\.mip-talent-card__inviter-name\s*\{[^}]*color: var\(--color-brand\);/)
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

  // MIW-52 统一竖版卡：固定三标签行（地区MIP | 代表行业 | 身份状态），空值过滤、最多 3 个，
  // 未传 tags 回退旧 metaText；右下角可配置（默认邀请人，custom 渲染 foot-right 插槽）。
  it('renders the unified three-tag row with bar dividers and metaText fallback', () => {
    expect(component).toContain('MAX_TAGS = 3')
    expect(component).toContain('.filter(tag => !!tag).slice(0, MAX_TAGS)')
    expect(template).toContain('mip-talent-card__figure-tags')
    expect(template).toContain('mip-talent-card__figure-tag-divider')
    expect(template).toContain('wx:elif="{{metaText}}"')
    expect(styles).toContain('.mip-talent-card__figure-tags')
    expect(styles).toContain('.mip-talent-card__figure-tag-divider')
  })

  it('makes the grid foot right configurable with inviter as the default', () => {
    expect(component).toContain('footRightMode: { type: String, value: \'inviter\' }')
    expect(template).toContain('<slot name="foot-right" />')
    // horizontal 的 inviter 是唯一右下内容（MIW-58 起 targetText 只留在 grid 兜底）。
    expect(template.match(/wx:if="\{\{inviter\.name\}\}"/g) || []).toHaveLength(1)
    expect(template.match(/wx:elif="\{\{inviter\.name\}\}"/g) || []).toHaveLength(1)
    expect(template.match(/wx:elif="\{\{targetText\}\}"/g) || []).toHaveLength(1)
    expect(template).toContain('footRightMode === \'custom\'')
  })

  it('shows the platform inviter with platform name and system avatar fallback', () => {
    expect(component).toContain('inviterKind: { type: String, value: \'PLAYER\' }')
    expect(component).toContain('PLATFORM_INVITER_NAME = \'MIP平台\'')
    expect(component).toContain('PLATFORM_INVITER_AVATAR = \'/assets/brand/mip-logo-yellow.png\'')
    expect(template).toContain('邀请人{{inviter.name}}')
  })

  it('falls back to target text only when no inviter is known', () => {
    // MIW-52：grid footer 链为 custom 插槽 → inviter → targetText 兜底；
    // MIW-58：horizontal 只渲染 inviter（设计稿无 target 文案）。
    expect(template.match(/wx:if="\{\{inviter\.name\}\}"/g) || []).toHaveLength(1)
    expect(template.match(/wx:elif="\{\{inviter\.name\}\}"/g) || []).toHaveLength(1)
    expect(template.match(/wx:elif="\{\{targetText\}\}"/g) || []).toHaveLength(1)
  })
})
